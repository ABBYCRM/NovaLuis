#!/usr/bin/env node
// deep-worker.mjs — background reasoning daemon for NOVA.
//
// Runs as a separate Node process inside the container, started by the
// entrypoint alongside the gateway and poll-events. The main agent (or
// any other client with filesystem access to /data) can dispatch a hard
// task by writing a JSON file to /data/jobs/pending/<id>.json, then
// reading /data/jobs/done/<id>.json when it appears.
//
// Why a daemon instead of a tool call? Two reasons:
//   1. Decouples slow reasoning from the user-facing chat loop, so NOVA
//      can keep answering while the worker grinds on a hard problem.
//   2. Lets the worker use a different (slower, smarter) model — e.g.
//      Kimi-K2.6 for agentic reasoning, DeepSeek-R1 for pure logic —
//      without changing the primary chat model.
//
// Job file shape (write to /data/jobs/pending/<id>.json):
//   {
//     "id": "<unique-id>",
//     "prompt": "<the hard question>",
//     "model": "moonshotai/Kimi-K2.6",  // optional; default below
//     "systemPrompt": "...",            // optional
//     "maxTokens": 8192,                // optional
//     "submittedAt": <epoch-ms>
//   }
//
// Result file shape (worker writes /data/jobs/done/<id>.json):
//   {
//     "id": "<same-id>",
//     "ok": true|false,
//     "result": "<answer text>",        // if ok
//     "error": "<message>",             // if !ok
//     "model": "<model id used>",
//     "elapsedMs": <number>,
//     "usage": { ...openai usage object... },
//     "completedAt": <epoch-ms>
//   }

import { readdir, readFile, writeFile, rename, mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || "/data";
const JOBS_ROOT = path.join(STATE_DIR, "jobs");
const PENDING_DIR = path.join(JOBS_ROOT, "pending");
const RUNNING_DIR = path.join(JOBS_ROOT, "running");
const DONE_DIR = path.join(JOBS_ROOT, "done");
const FAILED_DIR = path.join(JOBS_ROOT, "failed");

const BITDEER_KEY = process.env.BITDEER_API_KEY;
const BITDEER_BASE_URL = process.env.BITDEER_BASE_URL || "https://api-inference.bitdeer.ai/v1";
// Moonshot / Kimi API — activated when KIMI_API_KEY is set and BITDEER_API_KEY is not.
const KIMI_KEY = process.env.KIMI_API_KEY;
const KIMI_BASE_URL = process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1";
// Primary inference: Bitdeer (moonshotai/Kimi-K2.6) → Kimi API (kimi-k2) → idle.
const ACTIVE_KEY = BITDEER_KEY || KIMI_KEY || "";
const BASE_URL = BITDEER_KEY ? BITDEER_BASE_URL : KIMI_BASE_URL;
const DEFAULT_MODEL = process.env.DEEP_WORKER_DEFAULT_MODEL ||
  (BITDEER_KEY ? "moonshotai/Kimi-K2.6" : "kimi-k2");
// OpenAI — backup reasoning for web_search and code-interpreter jobs only.
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const WEB_SEARCH_MODEL = process.env.DEEP_WORKER_WEB_SEARCH_MODEL || "gpt-4.5-preview";
const POLL_MS = Number(process.env.DEEP_WORKER_POLL_MS || 2000);
const MAX_CONCURRENT = Number(process.env.DEEP_WORKER_CONCURRENCY || 1);
const REQUEST_TIMEOUT_MS = Number(process.env.DEEP_WORKER_TIMEOUT_MS || 300_000); // 5 min

if (!ACTIVE_KEY) {
  console.warn("deep-worker: neither BITDEER_API_KEY nor KIMI_API_KEY set — worker is idle. Set either to enable inference.");
  // Idle loop: check every 60 s in case a key appears at runtime
  setInterval(() => {
    if (process.env.BITDEER_API_KEY || process.env.KIMI_API_KEY) {
      console.log("deep-worker: inference key detected at runtime — restarting to activate.");
      process.exit(0); // supervisor will restart us
    }
  }, 60_000).unref();
  // Stay alive but do nothing until the key is set
}

async function ensureDirs() {
  for (const d of [PENDING_DIR, RUNNING_DIR, DONE_DIR, FAILED_DIR]) {
    await mkdir(d, { recursive: true });
  }
}

async function listPending() {
  try {
    const entries = await readdir(PENDING_DIR);
    return entries.filter(n => n.endsWith(".json")).sort();
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

async function claimJob(name) {
  const src = path.join(PENDING_DIR, name);
  const dst = path.join(RUNNING_DIR, name);
  try { await rename(src, dst); return dst; }
  catch (e) {
    if (e.code === "ENOENT") return null; // another worker picked it up
    throw e;
  }
}

async function callModel(prompt, systemPrompt, model, maxTokens) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt || "You are a reasoning subagent for NOVA, the personal AI assistant to Robert Matthews. Robert dispatched this task to you because it needs deeper thought than the primary chat model can provide on the live conversation timeline. Reason carefully, produce a complete answer, and cite sources you used internally if relevant. Output the final answer only; no commentary about the dispatch process." },
      { role: "user", content: prompt }
    ],
    max_tokens: maxTokens || 8192,
    temperature: 0.1,
    top_p: 1.0,
    stream: false
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${ACTIVE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const j = await res.json();
    return {
      result: j.choices?.[0]?.message?.content || "",
      usage: j.usage,
      model: j.model || model
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── OpenAI Responses API — web search path ────────────────────────────────────
// Used when a job sets  webSearch: true  in its JSON file.
// Calls the Responses API with the built-in web_search_preview tool so the model
// can fetch live search results before composing its answer.
// Falls back to a regular callModel() if OPENAI_API_KEY is not set.
async function callModelWithWebSearch(prompt, systemPrompt, maxTokens) {
  if (!OPENAI_KEY) {
    console.warn("deep-worker: OPENAI_API_KEY not set — falling back to regular model for web-search job");
    return callModel(prompt, systemPrompt, DEFAULT_MODEL, maxTokens);
  }
  const DEFAULT_SYSTEM =
    "You are a deep-research subagent for NOVA, the personal AI assistant to Robert Matthews. " +
    "You have live web search access. Use it to find current, accurate information before answering. " +
    "Cite the URLs you relied on. Produce a complete, well-structured answer — no meta-commentary about the process.";
  const body = {
    model: WEB_SEARCH_MODEL,
    tools: [{ type: "web_search_preview" }],
    tool_choice: "auto",
    input: [
      { role: "system", content: systemPrompt || DEFAULT_SYSTEM },
      { role: "user",   content: prompt }
    ],
    max_output_tokens: maxTokens || 8192,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENAI_BASE}/responses`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Responses API HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const j = await res.json();
    // Extract the assistant message text from the output array.
    const msgItem = (j.output || []).find(o => o.type === "message");
    const text = (msgItem?.content || []).find(c => c.type === "output_text")?.text || "";
    return {
      result: text,
      usage: j.usage,
      model: j.model || WEB_SEARCH_MODEL,
      webSearch: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Responses API — Code Interpreter ─────────────────────────────────────────
// Used when a job sets  codeInterpreter: true  in its JSON file.
// Runs the prompt through a model that has Python sandbox access.
async function callModelWithCodeInterpreter(prompt, systemPrompt, maxTokens) {
  if (!OPENAI_KEY) {
    console.warn("deep-worker: OPENAI_API_KEY not set — falling back to regular model for code-interpreter job");
    return callModel(prompt, systemPrompt, DEFAULT_MODEL, maxTokens);
  }
  const model = process.env.OPENAI_CI_MODEL || WEB_SEARCH_MODEL;
  const DEFAULT_SYSTEM =
    "You are a data-analysis and computation subagent for NOVA. " +
    "Use the code_interpreter tool to execute Python and return accurate results. " +
    "Show your working and explain any outputs clearly.";
  const body = {
    model,
    tools: [{ type: "code_interpreter", container: { type: "auto" } }],
    tool_choice: "auto",
    input: [
      { role: "system", content: systemPrompt || DEFAULT_SYSTEM },
      { role: "user",   content: prompt },
    ],
    max_output_tokens: maxTokens || 8192,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENAI_BASE}/responses`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Responses API (CI) HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const j = await res.json();
    const msgItem = (j.output || []).find(o => o.type === "message");
    const text = (msgItem?.content || []).find(c => c.type === "output_text")?.text || "";
    return { result: text, usage: j.usage, model: j.model || model, codeInterpreter: true };
  } finally {
    clearTimeout(timer);
  }
}

// ── Responses API — Hosted Shell ──────────────────────────────────────────────
// Used when a job sets  hostedShell: true  in its JSON file.
async function callModelWithHostedShell(prompt, systemPrompt, maxTokens) {
  if (!OPENAI_KEY) {
    console.warn("deep-worker: OPENAI_API_KEY not set — falling back to regular model for hosted-shell job");
    return callModel(prompt, systemPrompt, DEFAULT_MODEL, maxTokens);
  }
  const model = process.env.OPENAI_SHELL_MODEL || WEB_SEARCH_MODEL;
  const DEFAULT_SYSTEM =
    "You are a shell-execution subagent for NOVA. " +
    "Use the shell tool to run commands in a Debian container and return the output accurately.";
  const body = {
    model,
    tools: [{ type: "shell", environment: { type: "container_auto" } }],
    tool_choice: "auto",
    input: [
      { role: "system", content: systemPrompt || DEFAULT_SYSTEM },
      { role: "user",   content: prompt },
    ],
    max_output_tokens: maxTokens || 8192,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENAI_BASE}/responses`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Responses API (shell) HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const j = await res.json();
    const msgItem = (j.output || []).find(o => o.type === "message");
    const text = (msgItem?.content || []).find(c => c.type === "output_text")?.text || "";
    return { result: text, usage: j.usage, model: j.model || model, hostedShell: true };
  } finally {
    clearTimeout(timer);
  }
}

async function processJob(name) {
  const runningPath = await claimJob(name);
  if (!runningPath) return;
  const t0 = Date.now();
  let job;
  try { job = JSON.parse(await readFile(runningPath, "utf8")); }
  catch (e) {
    console.error(`deep-worker: skipping ${name} — invalid JSON: ${e.message}`);
    await rename(runningPath, path.join(FAILED_DIR, name));
    return;
  }
  const id = job.id || name.replace(/\.json$/, "");
  console.log(`deep-worker: picked up job ${id} model=${job.model || DEFAULT_MODEL}`);

  let outcome;
  try {
    // Route to specialised Responses API paths based on job flags.
    const r = job.codeInterpreter
      ? await callModelWithCodeInterpreter(job.prompt, job.systemPrompt, job.maxTokens)
      : job.hostedShell
        ? await callModelWithHostedShell(job.prompt, job.systemPrompt, job.maxTokens)
        : job.webSearch
          ? await callModelWithWebSearch(job.prompt, job.systemPrompt, job.maxTokens)
          : await callModel(job.prompt, job.systemPrompt, job.model || DEFAULT_MODEL, job.maxTokens);
    outcome = {
      id, ok: true,
      result: r.result, model: r.model, usage: r.usage,
      elapsedMs: Date.now() - t0,
      completedAt: Date.now()
    };
    await writeFile(path.join(DONE_DIR, name), JSON.stringify(outcome, null, 2));
    await unlink(runningPath).catch(() => {});
    console.log(`deep-worker: ${id} ok in ${outcome.elapsedMs}ms (${r.usage?.total_tokens || "?"} tokens)`);
  } catch (e) {
    outcome = {
      id, ok: false,
      error: String(e.message || e),
      elapsedMs: Date.now() - t0,
      completedAt: Date.now()
    };
    await writeFile(path.join(FAILED_DIR, name), JSON.stringify(outcome, null, 2));
    await unlink(runningPath).catch(() => {});
    console.error(`deep-worker: ${id} FAILED in ${outcome.elapsedMs}ms — ${outcome.error}`);
  }
}

const inFlight = new Set();
async function tick() {
  if (inFlight.size >= MAX_CONCURRENT) return;
  const names = await listPending();
  for (const name of names) {
    if (inFlight.size >= MAX_CONCURRENT) break;
    if (inFlight.has(name)) continue;
    inFlight.add(name);
    processJob(name)
      .catch(e => console.error("deep-worker: tick error", e))
      .finally(() => inFlight.delete(name));
  }
}

await ensureDirs();
console.log(`deep-worker: ready — default model ${DEFAULT_MODEL}, concurrency ${MAX_CONCURRENT}, poll ${POLL_MS}ms`);
setInterval(() => tick().catch(e => console.error("deep-worker: poll error", e)), POLL_MS);

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`deep-worker: ${sig} received; ${inFlight.size} jobs in flight; will exit when they finish`);
    const wait = setInterval(() => {
      if (inFlight.size === 0) { clearInterval(wait); process.exit(0); }
    }, 200);
    setTimeout(() => process.exit(0), 30_000).unref(); // hard cap
  });
}
