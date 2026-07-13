import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  boundedInt,
  DEFAULT_MAX_OUTPUT_CHARS,
  env,
  errorResult,
  safeText,
  truthy,
} from "./bos-omega-core.mjs";
import { workingDirectory, workspacePath, WORKSPACE_ROOT } from "./bos-omega-files.mjs";

function childEnv() {
  const allowed = new Set(["HOME", "LANG", "LC_ALL", "PATH", "PWD", "SHELL", "TERM", "TMPDIR", "NODE_OPTIONS", "PYTHONIOENCODING"]);
  const result = {};
  for (const [name, value] of Object.entries(process.env)) if (allowed.has(name) && value != null) result[name] = value;
  result.BOS_CHILD_PROCESS = "1";
  return result;
}

function execute(command, argv, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, argv, { cwd: options.cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"], detached: false });
    } catch (error) { resolve(errorResult("spawn_failed", error?.message || error)); return; }
    const maximum = boundedInt(options.maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS, 1000, 200_000);
    const timeoutMs = boundedInt(options.timeoutMs, 30_000, 1000, 300_000);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < maximum) stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { if (stderr.length < maximum) stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); finish(errorResult("process_failed", error?.message || error)); });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      finish({ exitCode, signal, timedOut, stdout: safeText(stdout, maximum), stderr: safeText(stderr, maximum) });
    });
  });
}

export function hostExecutionEnabled() {
  return truthy("SUPER_NOVA_EXEC") && truthy("BOS_ALLOW_HOST_EXEC");
}

export async function runNode(args, ctx) {
  if (!hostExecutionEnabled()) return errorResult("host_exec_disabled", "host execution is disabled");
  try {
    const code = String(args.code || "");
    if (!code) throw new Error("code is required");
    const directory = await workingDirectory(ctx?.runId);
    const file = path.join(directory, `node-${Date.now()}.mjs`);
    await fs.writeFile(file, code, { encoding: "utf8", mode: 0o600 });
    return execute(process.execPath, [file], { cwd: directory, timeoutMs: boundedInt(args.timeout_sec, 30, 1, 300) * 1000 });
  } catch (error) { return errorResult("node_exec_failed", error?.message || error); }
}

export async function runPython(args, ctx) {
  if (!hostExecutionEnabled()) return errorResult("host_exec_disabled", "host execution is disabled");
  try {
    const code = String(args.code || "");
    if (!code) throw new Error("code is required");
    const directory = await workingDirectory(ctx?.runId);
    const file = path.join(directory, `python-${Date.now()}.py`);
    await fs.writeFile(file, code, { encoding: "utf8", mode: 0o600 });
    return execute("python3", [file], { cwd: directory, timeoutMs: boundedInt(args.timeout_sec, 30, 1, 300) * 1000 });
  } catch (error) { return errorResult("python_exec_failed", error?.message || error); }
}

export async function shellExec(args, ctx) {
  if (!hostExecutionEnabled()) return errorResult("host_exec_disabled", "host execution is disabled");
  try {
    const command = String(args.command || "");
    if (!command) throw new Error("command is required");
    const directory = await workingDirectory(ctx?.runId);
    return execute("bash", ["-lc", command], { cwd: directory, timeoutMs: boundedInt(args.timeout_sec, 30, 1, 300) * 1000 });
  } catch (error) { return errorResult("shell_exec_failed", error?.message || error); }
}

export async function gitStatus(args) {
  try { return execute("git", ["status", "--short", "--branch"], { cwd: workspacePath(args.path || "."), timeoutMs: 30_000 }); }
  catch (error) { return errorResult("git_status_failed", error?.message || error); }
}
export async function gitDiff(args) {
  try { return execute("git", ["diff", "--stat", "HEAD"], { cwd: workspacePath(args.path || "."), timeoutMs: 30_000 }); }
  catch (error) { return errorResult("git_diff_failed", error?.message || error); }
}

export async function imageGenerate(args, ctx) {
  try {
    if (!env("BITDEER_API_KEY")) throw new Error("BITDEER_API_KEY is not configured");
    const prompt = String(args.prompt || "").trim().slice(0, 4000);
    if (!prompt) throw new Error("prompt is required");
    const base = (env("BITDEER_BASE_URL") || "https://api-inference.bitdeer.ai/v1").replace(/\/$/, "");
    const response = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("BITDEER_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env("SUPER_NOVA_IMAGE_MODEL") || "google/imagen-4.0-ultra", prompt, n: 1, ...(args.size ? { size: String(args.size).slice(0, 40) } : {}) }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`image provider HTTP ${response.status}: ${safeText(text, 300)}`);
    const item = JSON.parse(text)?.data?.[0] || {};
    if (item.url) return { url: String(item.url), provider: "bitdeer" };
    if (!item.b64_json) throw new Error("image provider returned no image");
    const buffer = Buffer.from(String(item.b64_json), "base64");
    const png = buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (!png && !jpeg) throw new Error("image provider returned an unsupported file signature");
    const directory = await workingDirectory(ctx?.runId);
    const file = path.join(directory, `image-${Date.now()}.${png ? "png" : "jpg"}`);
    await fs.writeFile(file, buffer, { mode: 0o600 });
    return { saved: file, bytes: buffer.length, mimeType: png ? "image/png" : "image/jpeg", sha256: crypto.createHash("sha256").update(buffer).digest("hex"), provider: "bitdeer" };
  } catch (error) { return errorResult("image_generate_failed", error?.message || error); }
}

export function sessionStatus(_args, ctx) {
  return {
    runId: ctx?.runId || null,
    authenticated: ctx?.authenticated === true,
    approvalGranted: ctx?.approvalGranted === true,
    internalWorker: ctx?.internalWorker === true,
    workspace: WORKSPACE_ROOT,
    hostExecutionEnabled: hostExecutionEnabled(),
    timestamp: new Date().toISOString(),
  };
}
export function finish(args) { return { done: true, answer: String(args.answer || "") }; }
export function askUser(args) { return { pendingUserInput: true, question: String(args.question || ""), options: Array.isArray(args.options) ? args.options.map(String).slice(0, 20) : [] }; }
export function updatePlan(args) { return { planUpdated: true, steps: Array.isArray(args.steps) ? args.steps.slice(0, 100) : [] }; }
export function agentsList() { return { agents: ["bos-omega/chat", "bos-omega/work-tree", "bos-omega/deep-worker", "bos-omega/poll-events", "bos-omega/scratchpad"] }; }
