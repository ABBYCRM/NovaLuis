// super-nova-tools.mjs — the tool registry for SUPER NOVA, the Work Tree's
// tool-using agent loop. Terminal nodes call these tools through a bounded ReAct
// loop (see work-tree-worker.mjs) to do real work instead of LLM text only.
//
// Two tiers:
//   SAFE      — always available, no new secrets, low blast radius:
//               http_fetch (SSRF-guarded), browser_fetch (Steel.dev — bypasses
//               bot-protection / JS-rendered pages), web_search (Firecrawl →
//               Brave fallback), image_generate (Bitdeer).
//   DANGEROUS — code/shell/file execution. OFF by default. Only offered to the
//               model when SUPER_NOVA_EXEC is set, because the Work Tree HTTP
//               endpoint is unauthenticated and these tools run on the host.
//
// Everything runs inside a per-run sandbox dir under the OS temp dir. http_fetch
// blocks private/internal/metadata addresses and does not follow redirects
// (it surfaces the Location so the model must re-fetch through the guard).

import fs from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import dns from "node:dns/promises";
import { lookup as rawLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { catalogSearch, catalogDescribe, catalogText, TOOL_DEFS } from "./tool-catalog.mjs";

const BITDEER_KEY = process.env.BITDEER_API_KEY;
const BASE_URL =
  process.env.BITDEER_BASE_URL || "https://api-inference.bitdeer.ai/v1";

const EXEC_TIMEOUT_MS = Number(process.env.SUPER_NOVA_EXEC_TIMEOUT_MS || 30000);
const FETCH_TIMEOUT_MS = Number(process.env.SUPER_NOVA_FETCH_TIMEOUT_MS || 20000);
const MAX_OUTPUT = 6000;
const MAX_BODY = 8000;

const __tools_dir = path.dirname(fileURLToPath(import.meta.url));
// Workspace root: parent of scripts/
const WORKSPACE_DIR = process.env.NOVA_WORKSPACE || path.resolve(__tools_dir, "..");
// State dir for memory store — same env var used by the workers
const TOOLS_STATE_DIR = process.env.OPENCLAW_STATE_DIR || path.resolve(__tools_dir, "..", ".nova-data");
const MEMORY_FILE = path.join(TOOLS_STATE_DIR, "agent-memory.json");

// ── SSRF guard ───────────────────────────────────────────────────────────────

function ipIsPrivate(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local + cloud metadata
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique-local fc00::/7
  if (s.startsWith("fe80")) return true; // link-local
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return ipIsPrivate(m[1]);
  return false;
}

async function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("only http/https URLs are allowed");
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("blocked internal host");
  }
  if (net.isIP(host) && ipIsPrivate(host)) {
    throw new Error("blocked private address");
  }
  let addrs = [];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("DNS resolution failed");
  }
  for (const a of addrs) {
    if (ipIsPrivate(a.address)) throw new Error("blocked private address");
  }
  return u;
}

// Connect-time DNS guard. net.connect() calls this `lookup` at socket-connect
// time, so the address we validate here is the exact address we connect to —
// closing the DNS-rebinding / TOCTOU window between assertSafeUrl()'s pre-check
// and the actual connection. We always inspect every resolved address and only
// hand back the safe ones.
function guardedLookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  rawLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses)
      ? addresses
      : [{ address: addresses, family: options && options.family === 6 ? 6 : 4 }];
    const safe = list.filter((a) => !ipIsPrivate(a.address));
    if (!safe.length) return callback(new Error("blocked private address"));
    if (options && options.all) return callback(null, safe);
    return callback(null, safe[0].address, safe[0].family);
  });
}

// Low-level fetch built on node:http(s) so we can (a) pin the connect-time DNS
// resolution through guardedLookup and (b) stream-cap the response body instead
// of buffering an unbounded amount into memory. Redirects are NOT followed —
// each hop must be re-fetched so the SSRF guard re-validates it.
function rawFetch({ url, method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      reject(new Error("invalid URL"));
      return;
    }
    const mod = u.protocol === "https:" ? https : http;
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const fail = (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };
    const req = mod.request(
      u,
      { method, headers: headers || {}, lookup: guardedLookup },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400) {
          res.resume();
          done({
            status,
            redirectTo: res.headers.location || "",
            note: "redirect not followed — re-fetch the redirect URL to keep the SSRF guard in effect",
          });
          return;
        }
        const contentType = res.headers["content-type"] || "";
        const chunks = [];
        let received = 0;
        let truncated = false;
        res.on("data", (d) => {
          if (truncated) return;
          received += d.length;
          chunks.push(d);
          if (received >= MAX_BODY) {
            truncated = true;
            req.destroy();
            done({
              status,
              contentType,
              body: Buffer.concat(chunks).toString("utf8").slice(0, MAX_BODY),
              truncated: true,
            });
          }
        });
        res.on("end", () =>
          done({
            status,
            contentType,
            body: Buffer.concat(chunks).toString("utf8").slice(0, MAX_BODY),
            truncated,
          }),
        );
        res.on("error", fail);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("request timeout")));
    req.on("error", fail);
    if (body != null && method !== "GET" && method !== "HEAD") req.write(String(body));
    req.end();
  });
}

// ── Sandbox ──────────────────────────────────────────────────────────────────

async function sandboxDir(runId) {
  const dir = path.join(os.tmpdir(), "super-nova", String(runId ?? "misc"));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function resolveInSandbox(dir, p) {
  const resolved = path.resolve(dir, p);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
    throw new Error("path escapes the sandbox");
  }
  return resolved;
}

function execProcess(cmd, argv, { cwd, timeoutMs = EXEC_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, argv, { cwd });
    } catch (e) {
      resolve({ error: `spawn failed: ${e.message || e}` });
      return;
    }
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (out.length < MAX_OUTPUT) out += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (err.length < MAX_OUTPUT) err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: `spawn failed: ${e.message || e}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: out.slice(0, MAX_OUTPUT),
        stderr: err.slice(0, MAX_OUTPUT),
        timedOut,
      });
    });
  });
}

// ── SAFE tools ───────────────────────────────────────────────────────────────

async function httpFetch(args) {
  const url = String(args.url || "");
  if (!url) return { error: "url required" };
  const method = String(args.method || "GET").toUpperCase();
  // Fast literal/pre-resolution pre-check (defense in depth); the authoritative
  // guard is guardedLookup, applied at connect time inside rawFetch.
  await assertSafeUrl(url);
  const headers =
    args.headers && typeof args.headers === "object" ? args.headers : {};
  return rawFetch({
    url,
    method,
    headers,
    body: args.body,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
}

async function webSearch(args) {
  const q = String(args.query || "").slice(0, 400);
  if (!q) return { error: "query required" };
  // Try each configured provider in precedence order. A provider failure (bad
  // key → 401, rate limit, network error, or empty result) falls through to the
  // next provider instead of aborting, so one stale key can't disable search.
  // Firecrawl is primary; Brave is the fallback.  Tavily is not used.
  const providers = [
    { key: "FIRECRAWL_API_KEY", run: searchFirecrawl },
    { key: "BRAVE_API_KEY", run: searchBrave },
  ];
  const configured = providers.filter((p) => process.env[p.key]);
  if (!configured.length) {
    return {
      error:
        "web_search unavailable: no search provider key set " +
        "(FIRECRAWL_API_KEY / BRAVE_API_KEY). " +
        "Use http_fetch or browser_fetch on a known URL instead.",
    };
  }
  const errors = [];
  for (const p of configured) {
    try {
      const out = await p.run(q);
      if (out && out.results && out.results.length) return out;
      errors.push(`${out && out.provider ? out.provider : p.key}: no results`);
    } catch (e) {
      errors.push(`${p.key.replace("_API_KEY", "").toLowerCase()}: ${e.message || e}`);
    }
  }
  return { error: `all search providers failed (${errors.join("; ")})` };
}

async function searchBrave(q) {
  const res = await fetch(
    "https://api.search.brave.com/res/v1/web/search?count=5&q=" + encodeURIComponent(q),
    { headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY, Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const j = await res.json();
  return {
    provider: "brave",
    results: ((j.web && j.web.results) || []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: String(r.description || "").slice(0, 300),
    })),
  };
}

async function searchFirecrawl(q) {
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: q, limit: 5 }),
  });
  if (!res.ok) throw new Error(`firecrawl ${res.status}`);
  const j = await res.json();
  // v1 returns {data:[...]}, v2 returns {data:{web:[...]}} — handle both.
  const rows = Array.isArray(j.data) ? j.data : (j.data && j.data.web) || [];
  return {
    provider: "firecrawl",
    results: rows.slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: String(r.description || r.snippet || "").slice(0, 300),
    })),
  };
}

// ── Steel.dev browser fetch ───────────────────────────────────────────────────
// Uses a real headless browser via Steel.dev to fetch pages that block direct
// HTTP (403, Cloudflare, JS-rendered content).  Falls back gracefully when the
// key is absent so local/dev runs without Steel still work.

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function browserFetch(args) {
  const url = String(args.url || "").trim();
  if (!url) return { error: "url required" };
  if (!process.env.STEEL_API_KEY)
    return { error: "browser_fetch unavailable: STEEL_API_KEY not set" };
  const res = await fetch("https://api.steel.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Steel-Api-Key": process.env.STEEL_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, useProxy: true }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`steel ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  // Steel returns {content:{html,markdown?}, metadata, links}
  const text = (j.content && j.content.markdown)
    ? j.content.markdown
    : stripHtml((j.content && j.content.html) || "");
  return {
    url,
    body: text.slice(0, 8000),
    truncated: text.length > 8000,
    links: (j.links || []).slice(0, 20).map((l) =>
      typeof l === "string" ? l : l.href || l.url || ""
    ),
  };
}

async function imageGenerate(args, ctx) {
  const prompt = String(args.prompt || "").slice(0, 1000);
  if (!prompt) return { error: "prompt required" };
  if (!BITDEER_KEY) return { error: "image_generate unavailable: BITDEER_API_KEY not set" };
  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BITDEER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.SUPER_NOVA_IMAGE_MODEL || "google/imagen-4.0-ultra",
      prompt,
      n: 1,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { error: `image API ${res.status}: ${t.slice(0, 200)}` };
  }
  const j = await res.json();
  const b64 = j.data?.[0]?.b64_json;
  const remoteUrl = j.data?.[0]?.url;
  if (b64) {
    const dir = await sandboxDir(ctx.runId);
    const file = path.join(dir, `image-${Date.now()}.jpg`);
    await fs.writeFile(file, Buffer.from(b64, "base64"));
    return { saved: file, bytes: Buffer.byteLength(b64, "base64") };
  }
  if (remoteUrl) return { url: remoteUrl };
  return { error: "no image returned" };
}

// ── DANGEROUS tools (gated) ──────────────────────────────────────────────────

async function runPython(args, ctx) {
  const code = String(args.code || "");
  if (!code) return { error: "code required" };
  const dir = await sandboxDir(ctx.runId);
  const file = path.join(dir, `script-${Date.now()}.py`);
  await fs.writeFile(file, code);
  return execProcess("python3", [file], { cwd: dir });
}

async function runNode(args, ctx) {
  const code = String(args.code || "");
  if (!code) return { error: "code required" };
  const dir = await sandboxDir(ctx.runId);
  const file = path.join(dir, `script-${Date.now()}.mjs`);
  await fs.writeFile(file, code);
  return execProcess("node", [file], { cwd: dir });
}

async function shellExec(args, ctx) {
  const command = String(args.command || "");
  if (!command) return { error: "command required" };
  const dir = await sandboxDir(ctx.runId);
  return execProcess("bash", ["-lc", command], { cwd: dir });
}

async function writeFile(args, ctx) {
  const rel = String(args.path || "");
  if (!rel) return { error: "path required" };
  const dir = await sandboxDir(ctx.runId);
  const file = resolveInSandbox(dir, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const content = String(args.content ?? "");
  await fs.writeFile(file, content);
  return { saved: file, bytes: Buffer.byteLength(content) };
}

async function readFile(args, ctx) {
  const rel = String(args.path || "");
  if (!rel) return { error: "path required" };
  const dir = await sandboxDir(ctx.runId);
  const file = resolveInSandbox(dir, rel);
  const data = await fs.readFile(file, "utf8");
  return { content: data.slice(0, MAX_BODY), truncated: data.length > MAX_BODY };
}

// ── Memory store (file-backed KV in TOOLS_STATE_DIR) ─────────────────────────

function memLoad() {
  try {
    return JSON.parse(readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function memSave(data) {
  try {
    mkdirSync(TOOLS_STATE_DIR, { recursive: true });
    writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch {}
}

function memGet(args) {
  const key = String(args.key || "");
  if (!key) return { error: "key required" };
  const data = memLoad();
  if (!(key in data)) return { error: "not_found", key };
  return { key, value: data[key] };
}

function memPut(args) {
  const key = String(args.key || "");
  if (!key) return { error: "key required" };
  const data = memLoad();
  data[key] = args.value;
  memSave(data);
  return { key, saved: true };
}

function memSearch(args) {
  const q = String(args.query || "").toLowerCase();
  const limit = Math.max(1, Number(args.limit) || 5);
  const data = memLoad();
  const matches = Object.entries(data)
    .filter(([k, v]) => k.toLowerCase().includes(q) || String(JSON.stringify(v)).toLowerCase().includes(q))
    .slice(0, limit)
    .map(([key, value]) => ({ key, value }));
  return { matches, count: matches.length };
}

// ── Safe tool implementations (new) ──────────────────────────────────────────

function calculator(args) {
  const expr = String(args.expression || "").trim().slice(0, 500);
  if (!expr) return { error: "expression required" };
  // Allow only digits, arithmetic operators, parens, dot, spaces, e/E (sci notation), %, **
  if (!/^[\d\s+\-*/().%eE^]+$/.test(expr.replace(/\*\*/g, "^"))) {
    return { error: "unsafe expression — only arithmetic characters allowed" };
  }
  try {
    // Use ** for exponentiation (replace ^ first)
    const safe = expr.replace(/\^/g, "**");
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + safe + ")")();
    if (typeof result !== "number") return { error: "non-numeric result" };
    if (!isFinite(result)) return { result: String(result), note: "Infinity or NaN" };
    return { expression: expr, result };
  } catch (e) {
    return { error: "eval failed: " + (e.message || e) };
  }
}

async function listDirectory(args, ctx) {
  const dir = await sandboxDir(ctx && ctx.runId);
  const rel = String(args.path || ".");
  const target = resolveInSandbox(dir, rel);
  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch {
    return { error: "not found or not a directory: " + rel };
  }
  const items = entries.map((e) => ({
    name: e.name,
    type: e.isDirectory() ? "dir" : "file",
  }));
  return { path: rel, items, count: items.length };
}

async function fileExists(args, ctx) {
  const dir = await sandboxDir(ctx && ctx.runId);
  const rel = String(args.path || "");
  if (!rel) return { error: "path required" };
  let target;
  try {
    target = resolveInSandbox(dir, rel);
  } catch {
    return { error: "path escapes sandbox" };
  }
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return { path: rel, exists: false };
  }
  return { path: rel, exists: true, isFile: stat.isFile(), isDir: stat.isDirectory(), size: stat.size };
}

async function searchFiles(args, ctx) {
  const dir = await sandboxDir(ctx && ctx.runId);
  const pattern = String(args.pattern || "");
  if (!pattern) return { error: "pattern required" };
  const root = args.path ? resolveInSandbox(dir, String(args.path)) : dir;
  // Simple recursive glob — use find via execProcess
  const result = await execProcess("find", [root, "-name", pattern, "-maxdepth", "8"], { cwd: dir });
  const files = (result.stdout || "")
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => path.relative(dir, f));
  return { pattern, files, count: files.length };
}

async function grepFiles(args, ctx) {
  const dir = await sandboxDir(ctx && ctx.runId);
  const pattern = String(args.pattern || "");
  if (!pattern) return { error: "pattern required" };
  const root = args.path ? resolveInSandbox(dir, String(args.path)) : dir;
  const maxMatches = Math.min(Number(args.max_matches) || 100, 500);
  const result = await execProcess(
    "grep",
    ["-rn", "--include", args.glob || "*", "-m", String(maxMatches), pattern, root],
    { cwd: dir },
  );
  const lines = (result.stdout || "")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.replace(dir + path.sep, ""));
  return { pattern, matches: lines, count: lines.length, truncated: lines.length >= maxMatches };
}

async function gitStatus(args) {
  const repoPath = args.path
    ? path.resolve(WORKSPACE_DIR, String(args.path))
    : WORKSPACE_DIR;
  return execProcess("git", ["status", "--short"], { cwd: repoPath });
}

async function gitDiff(args) {
  const repoPath = args.path
    ? path.resolve(WORKSPACE_DIR, String(args.path))
    : WORKSPACE_DIR;
  return execProcess("git", ["diff", "--stat", "HEAD"], { cwd: repoPath });
}

function toolSearch(args) {
  const results = catalogSearch(args.query, args.category);
  return {
    query: args.query,
    count: results.length,
    tools: results.map((td) => ({
      name: td.name,
      category: td.category,
      risk: td.risk,
      description: td.description,
      enabledByDefault: td.enabledByDefault,
      requiresApproval: td.requiresApproval,
      requiresAuth: td.requiresAuth,
    })),
  };
}

function toolSearchCode(args) {
  const results = catalogSearch(args.query);
  const lang = String(args.language || "json").toLowerCase();
  let sigs;
  if (lang === "javascript") {
    sigs = results.map((td) => `async function ${td.name}(args) { /* ${td.description} */ }`);
  } else if (lang === "typescript") {
    sigs = results.map((td) => `async function ${td.name}(args: Record<string, unknown>): Promise<ToolResult> { /* ${td.description} */ }`);
  } else {
    sigs = results.map((td) => ({
      name: td.name,
      category: td.category,
      risk: td.risk,
      inputSchema: td.inputSchema,
    }));
  }
  return { query: args.query, language: lang, count: sigs.length, signatures: sigs };
}

function toolDescribe(args) {
  const td = catalogDescribe(args.name);
  if (!td) return { error: `no tool named '${args.name}' in catalog` };
  return { tool: td };
}

function finish(args) {
  return { done: true, answer: String(args.answer || "") };
}

function askUser(args) {
  return {
    pending_user_input: true,
    question: String(args.question || ""),
    options: Array.isArray(args.options) ? args.options : [],
  };
}

function updatePlan(args) {
  const steps = Array.isArray(args.steps) ? args.steps : [];
  return { plan_updated: true, steps };
}

function sessionStatus(args, ctx) {
  return {
    runId: (ctx && ctx.runId) || null,
    workspace: WORKSPACE_DIR,
    stateDir: TOOLS_STATE_DIR,
    dangerousEnabled: toolsEnabledDangerous(),
    timestamp: new Date().toISOString(),
  };
}

function heartbeatRespond(args) {
  return { heartbeat: true, status: String(args.status || "ok"), timestamp: new Date().toISOString() };
}

function goalHandler(args) {
  const action = String(args.action || "get");
  if (action === "set") {
    memPut({ key: "_agent_goal", value: args.goal });
    return { action: "set", goal: args.goal };
  }
  const stored = memGet({ key: "_agent_goal" });
  return { action: "get", goal: stored.value || null };
}

function steerHandler(args) {
  return { steered: true, instruction: String(args.instruction || "") };
}

function agentsListHandler() {
  return { agents: ["super-nova/work-tree", "super-nova/deep-worker", "super-nova/poll-events", "super-nova/scratchpad"] };
}

function sessionsListHandler() {
  return { sessions: [], note: "sessions not wired in this runtime" };
}

function sessionsYieldHandler(args) {
  return { yielded: true, message: String(args.message || "") };
}

function closeContextItemHandler(args) {
  return { closed: true, key: String(args.key || "") };
}

function diffRender(args) {
  const before = String(args.before || "").split("\n");
  const after = String(args.after || "").split("\n");
  const lines = [];
  const max = Math.max(before.length, after.length);
  let adds = 0, dels = 0;
  for (let i = 0; i < max; i++) {
    if (i >= before.length) { lines.push("+ " + after[i]); adds++; }
    else if (i >= after.length) { lines.push("- " + before[i]); dels++; }
    else if (before[i] !== after[i]) {
      lines.push("- " + before[i]);
      lines.push("+ " + after[i]);
      dels++; adds++;
    } else {
      lines.push("  " + before[i]);
    }
  }
  return {
    diff: lines.join("\n").slice(0, MAX_OUTPUT),
    additions: adds,
    deletions: dels,
    truncated: lines.join("\n").length > MAX_OUTPUT,
  };
}

function notConfigured(args, name) {
  return {
    error: "not_configured",
    tool: name,
    message: "Tool is declared in the catalog but not wired in this runtime. It needs credentials, policy, and a real handler.",
  };
}

// ── Dangerous tool implementations (new) ─────────────────────────────────────

async function runPythonFile(args, ctx) {
  const rel = String(args.path || "");
  if (!rel) return { error: "path required" };
  const dir = await sandboxDir(ctx && ctx.runId);
  const file = resolveInSandbox(dir, rel);
  const argv = Array.isArray(args.args) ? args.args.map(String) : [];
  const timeoutMs = (Number(args.timeout_sec) || 30) * 1000;
  return execProcess("python3", [file, ...argv], { cwd: dir, timeoutMs });
}

async function runCodeExecution(args, ctx) {
  const lang = String(args.language || "").toLowerCase();
  const code = String(args.code || "");
  if (!code) return { error: "code required" };
  if (lang === "python") return runPython(args, ctx);
  if (lang === "javascript" || lang === "typescript") return runNode(args, ctx);
  if (lang === "bash") return shellExec({ command: code, timeout_sec: args.timeout_sec }, ctx);
  return { error: `unsupported language: ${lang}` };
}

async function editFile(args, ctx) {
  const rel = String(args.path || "");
  if (!rel) return { error: "path required" };
  const dir = await sandboxDir(ctx && ctx.runId);
  const file = resolveInSandbox(dir, rel);
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return { error: "file not found: " + rel };
  }
  const oldText = String(args.old_text || "");
  const newText = String(args.new_text ?? "");
  if (!text.includes(oldText)) return { error: "old_text not found in file" };
  await fs.writeFile(file, text.replace(oldText, newText), "utf8");
  return { path: file, replacements: 1 };
}

async function applyPatch(args, ctx) {
  const patch = String(args.patch || "");
  if (!patch) return { error: "patch required" };
  const dir = await sandboxDir(ctx && ctx.runId);
  const patchFile = path.join(dir, `patch-${Date.now()}.diff`);
  await fs.writeFile(patchFile, patch, "utf8");
  return execProcess("patch", ["-p1", "-i", patchFile], { cwd: dir });
}

async function makeDir(args, ctx) {
  const rel = String(args.path || "");
  if (!rel) return { error: "path required" };
  const dir = await sandboxDir(ctx && ctx.runId);
  const target = resolveInSandbox(dir, rel);
  await fs.mkdir(target, { recursive: true });
  return { path: path.relative(dir, target), created: true };
}

async function deletePath(args, ctx) {
  const rel = String(args.path || "");
  if (!rel) return { error: "path required" };
  const dir = await sandboxDir(ctx && ctx.runId);
  const target = resolveInSandbox(dir, rel);
  await fs.rm(target, { recursive: false }); // non-recursive for safety
  return { path: path.relative(dir, target), deleted: true };
}

async function gitCommit(args) {
  const message = String(args.message || "");
  if (!message) return { error: "message required" };
  const repoPath = args.path ? path.resolve(WORKSPACE_DIR, String(args.path)) : WORKSPACE_DIR;
  const add = await execProcess("git", ["add", "-A"], { cwd: repoPath });
  if (add.exitCode !== 0) return { error: "git add failed", stdout: add.stdout, stderr: add.stderr };
  return execProcess("git", ["commit", "-m", message], { cwd: repoPath });
}

async function cloneRepo(args, ctx) {
  const url = String(args.url || "");
  if (!url) return { error: "url required" };
  const dir = await sandboxDir(ctx && ctx.runId);
  const dest = args.directory ? resolveInSandbox(dir, String(args.directory)) : dir;
  return execProcess("git", ["clone", "--depth=1", url, dest], { cwd: dir, timeoutMs: 90000 });
}

async function runCommand(args, ctx) {
  const command = String(args.command || "");
  if (!command) return { error: "command required" };
  const dir = await sandboxDir(ctx && ctx.runId);
  const timeoutMs = (Number(args.timeout_sec) || 120) * 1000;
  return execProcess("bash", ["-lc", command], { cwd: dir, timeoutMs });
}

// http_request: same SSRF guard as http_fetch, but exposed in dangerous tier
// because POST/PUT/DELETE can mutate external state.
async function httpRequest(args) {
  return httpFetch(args);
}

// ── Registry ─────────────────────────────────────────────────────────────────

const SAFE_TOOLS = {
  // ── Network ──────────────────────────────────────────────────────────────
  http_fetch: {
    run: httpFetch,
    desc: "fetch an http/https URL. args: {url, method?, headers?, body?}. SSRF-guarded; private addresses and metadata endpoints are blocked; redirects are NOT auto-followed. Returns {status, contentType, body}. For bot-blocked pages use browser_fetch.",
  },
  browser_fetch: {
    run: browserFetch,
    desc: "fetch a URL using a real headless browser (Steel.dev). args: {url}. Bypasses Cloudflare, 403, and JS-rendered pages. Returns {body (text ≤8000 chars), links}.",
  },
  web_search: {
    run: webSearch,
    desc: "search the web via Firecrawl (primary) or Brave (fallback). args: {query}. Returns ranked {title, url, snippet} results. Discover URLs, then fetch with http_fetch or browser_fetch.",
  },
  web_fetch: { run: httpFetch, desc: "alias for http_fetch. args: {url, max_chars?}." },
  search_web: { run: webSearch, desc: "alias for web_search. args: {query}." },

  // ── Image ────────────────────────────────────────────────────────────────
  image_generate: {
    run: imageGenerate,
    desc: "generate an image from a text prompt (Bitdeer). args: {prompt, size?}. Saves locally and returns the file path.",
  },
  generate_image: { run: imageGenerate, desc: "alias for image_generate. args: {prompt}." },

  // ── Calculator ───────────────────────────────────────────────────────────
  calculator: {
    run: calculator,
    desc: "evaluate a safe arithmetic expression. args: {expression}. Only numbers, +−×÷, parens, %, ^ allowed. Returns {expression, result}.",
  },

  // ── File system (read-only safe, sandbox) ────────────────────────────────
  read_file:       { run: readFile,       desc: "read a file in the sandbox. args: {path}." },
  read:            { run: readFile,       desc: "alias for read_file. args: {path}." },
  open_file:       { run: readFile,       desc: "alias for read_file. args: {path}." },
  list_directory:  { run: listDirectory,  desc: "list files in a sandbox folder. args: {path?}." },
  list_folder:     { run: listDirectory,  desc: "alias for list_directory. args: {path?}." },
  open_folder:     { run: listDirectory,  desc: "alias for list_directory. args: {path?}." },
  file_exists:     { run: fileExists,     desc: "check if a sandbox path exists. args: {path}. Returns {exists, isFile, isDir, size}." },
  search_files:    { run: searchFiles,    desc: "find files by glob in sandbox. args: {pattern, path?}." },
  grep_files:      { run: grepFiles,      desc: "regex-search sandbox file contents. args: {pattern, path?, glob?, max_matches?}." },
  diff_render:     { run: diffRender,     desc: "render a before/after text diff. args: {before, after}. Returns {diff, additions, deletions}." },
  close_context_item: { run: closeContextItemHandler, desc: "close a context item. args: {key}. No-op in this runtime." },

  // ── Git (read-only) ───────────────────────────────────────────────────────
  git_status:      { run: gitStatus,      desc: "run git status --short in the workspace. args: {path?}." },
  git_diff:        { run: gitDiff,        desc: "run git diff --stat HEAD in the workspace. args: {path?}." },

  // ── Memory ────────────────────────────────────────────────────────────────
  memory_get:      { run: memGet,         desc: "get a memory item by key. args: {key}." },
  memory_put:      { run: memPut,         desc: "save a memory item. args: {key, value}." },
  memory_search:   { run: memSearch,      desc: "search memory by query. args: {query, limit?}." },

  // ── Tool catalog ──────────────────────────────────────────────────────────
  tool_search:     { run: toolSearch,     desc: "search the tool catalog. args: {query, category?}. Returns matching tool metadata." },
  tool_search_code:{ run: toolSearchCode, desc: "search catalog, return code signatures. args: {query, language?}." },
  tool_describe:   { run: toolDescribe,   desc: "describe one tool by name. args: {name}. Returns full schema and flags." },

  // ── Control ───────────────────────────────────────────────────────────────
  finish:          { run: finish,         desc: "finish the current task. args: {answer}. Returns {done:true, answer}." },
  ask_user:        { run: askUser,        desc: "pause and ask the user a question. args: {question, options?}. Returns {pending_user_input:true, question, options}." },
  update_plan:     { run: updatePlan,     desc: "update the visible task plan. args: {steps:[{step,status}]}." },
  goal:            { run: goalHandler,    desc: "set or get the current goal. args: {action:'set'|'get', goal?}." },
  steer:           { run: steerHandler,   desc: "steer the run with new instruction. args: {instruction}." },
  agents_list:     { run: agentsListHandler, desc: "list known agents. args: {}." },
  sessions_list:   { run: sessionsListHandler, desc: "list sessions. args: {}." },
  session_status:  { run: sessionStatus,  desc: "get current session status. args: {}." },
  sessions_yield:  { run: sessionsYieldHandler, desc: "yield control. args: {message?}." },
  heartbeat_respond:{ run: heartbeatRespond, desc: "respond to a heartbeat ping. args: {status}." },
};

const DANGEROUS_TOOLS = {
  // ── Code execution ────────────────────────────────────────────────────────
  run_python: {
    run: runPython,
    desc: "run Python 3 code in the sandbox. args: {code, timeout_sec?}. Returns {exitCode, stdout, stderr, timedOut}.",
  },
  execute_python_code: { run: runPython,        desc: "alias for run_python. args: {code, timeout_sec?}." },
  execute_python_file: { run: runPythonFile,    desc: "execute a Python file in the sandbox. args: {path, args?, timeout_sec?}." },
  run_node: {
    run: runNode,
    desc: "run Node.js (ESM) code in the sandbox. args: {code, timeout_sec?}. Returns {exitCode, stdout, stderr, timedOut}.",
  },
  code_execution: { run: runCodeExecution, desc: "run code by language. args: {language:'python'|'javascript'|'typescript'|'bash', code, timeout_sec?}." },

  // ── Shell ─────────────────────────────────────────────────────────────────
  shell:               { run: shellExec, desc: "run a bash command in the sandbox. args: {command, timeout_sec?}. Returns {exitCode, stdout, stderr}." },
  exec:                { run: shellExec, desc: "alias for shell. args: {command, timeout_sec?}." },
  bash:                { run: shellExec, desc: "alias for shell. args: {command, timeout_sec?}." },
  execute_shell:       { run: shellExec, desc: "alias for shell. args: {command, timeout_sec?}." },
  execute_shell_popen: { run: shellExec, desc: "alias for shell. args: {command, timeout_sec?}." },

  // ── File write / edit / delete ────────────────────────────────────────────
  write_file: { run: writeFile,  desc: "write a file in the sandbox. args: {path, content, overwrite?}." },
  write:      { run: writeFile,  desc: "alias for write_file. args: {path, content, overwrite?}." },
  edit:       { run: editFile,   desc: "replace exact text in a sandbox file. args: {path, old_text, new_text}." },
  apply_patch:{ run: applyPatch, desc: "apply a unified diff patch in the sandbox. args: {patch}." },
  make_directory: { run: makeDir,    desc: "create a sandbox directory. args: {path}." },
  delete_path:    { run: deletePath, desc: "delete a sandbox file (non-recursive). args: {path}. DESTRUCTIVE." },

  // ── Git (write) ───────────────────────────────────────────────────────────
  git_commit:         { run: gitCommit,  desc: "stage all and commit in the workspace. args: {message, path?}." },
  clone_repository:   { run: cloneRepo,  desc: "clone a git repo into the sandbox. args: {url, directory?}." },

  // ── DevOps ────────────────────────────────────────────────────────────────
  run_tests: { run: runCommand, desc: "run a test command in the sandbox. args: {command, timeout_sec?}." },
  run_build:  { run: runCommand, desc: "run a build command in the sandbox. args: {command, timeout_sec?}." },

  // ── HTTP (mutating methods) ────────────────────────────────────────────────
  http_request: { run: httpRequest, desc: "make any HTTP request (SSRF-guarded). args: {method, url, headers?, body?}. POST/PUT/DELETE can mutate external state." },
};

// Dangerous tools are only offered/runnable when SUPER_NOVA_EXEC is set to a
// truthy value. This is the kill switch that keeps code/shell execution off the
// unauthenticated Work Tree endpoint by default.
export function toolsEnabledDangerous() {
  const v = process.env.SUPER_NOVA_EXEC;
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s !== "" && s !== "0" && s !== "false" && s !== "off" && s !== "no";
}

export function toolCatalogText(dangerous) {
  const activeReg = { ...SAFE_TOOLS, ...(dangerous ? DANGEROUS_TOOLS : {}) };
  const activeNames = new Set(Object.keys(activeReg));

  // Active tools: grouped by section
  const safeLines = Object.entries(SAFE_TOOLS).map(([name, t]) => `  ${name}: ${t.desc}`);
  const sections = ["=== ACTIVE — SAFE TOOLS (always callable) ===", ...safeLines];

  if (dangerous) {
    const danLines = Object.entries(DANGEROUS_TOOLS).map(([name, t]) => `  ${name}: ${t.desc}`);
    sections.push("", "=== ACTIVE — DANGEROUS TOOLS (SUPER_NOVA_EXEC=1) ===", ...danLines);
  } else {
    sections.push("", "(dangerous tools — code/shell/file/git-write — are OFF. Set SUPER_NOVA_EXEC=1 to enable.)");
  }

  // Catalog-only tools not yet wired, organized by category
  const catalogOnly = TOOL_DEFS.filter((td) => !activeNames.has(td.name));
  if (catalogOnly.length) {
    const byCat = new Map();
    for (const td of catalogOnly) {
      if (!byCat.has(td.category)) byCat.set(td.category, []);
      byCat.get(td.category).push(td.name);
    }
    sections.push("", "=== CATALOG (declared, not yet wired — use tool_describe for schema) ===");
    for (const [cat, names] of byCat) {
      sections.push(`  ${cat}: ${names.join(", ")}`);
    }
  }

  return sections.join("\n");
}

export async function runTool(name, args, ctx) {
  const dangerous = toolsEnabledDangerous();
  const reg = { ...SAFE_TOOLS, ...(dangerous ? DANGEROUS_TOOLS : {}) };
  const tool = reg[name];
  if (!tool) {
    // Give a more helpful error than generic "unknown tool"
    if (DANGEROUS_TOOLS[name]) {
      return {
        error: `tool '${name}' is disabled. Set SUPER_NOVA_EXEC=1 to enable code/shell/file tools.`,
      };
    }
    const catalogEntry = catalogDescribe(name);
    if (catalogEntry) {
      return {
        error: `tool '${name}' is in the catalog (category:${catalogEntry.category}, risk:${catalogEntry.risk}) but not wired in this runtime. Call tool_describe('${name}') for its full schema.`,
      };
    }
    return { error: `unknown tool '${name}'. Use tool_search to find available tools.` };
  }
  try {
    return await tool.run(args || {}, ctx || {});
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// Export the catalog for external consumers
export { TOOL_DEFS, catalogSearch, catalogDescribe };
