import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  boundedInt,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_OUTPUT_CHARS,
  errorResult,
  safeText,
} from "./bos-omega-core.mjs";

const MODULE_DIR = path.dirname(new URL(import.meta.url).pathname);
export const WORKSPACE_ROOT = path.resolve(process.env.NOVA_WORKSPACE || path.resolve(MODULE_DIR, ".."));
const STATE_ROOT = path.resolve(process.env.OPENCLAW_STATE_DIR || path.join(WORKSPACE_ROOT, ".nova-data"));
const MEMORY_FILE = path.join(STATE_ROOT, "agent-memory.json");

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function workspacePath(input = ".") {
  const candidate = path.resolve(WORKSPACE_ROOT, String(input || "."));
  if (!within(WORKSPACE_ROOT, candidate)) throw new Error("path escapes workspace");
  return candidate;
}

export async function workingDirectory(runId = "chat") {
  const safeId = String(runId || "chat").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 96);
  const directory = path.join(os.tmpdir(), "bos-omega", safeId || "chat");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function runPath(directory, input = ".") {
  const candidate = path.resolve(directory, String(input || "."));
  if (!within(directory, candidate)) throw new Error("path escapes working directory");
  return candidate;
}

async function atomicWrite(file, content, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, content, { encoding: "utf8", mode });
  await fs.rename(temporary, file);
}

export function calculator(args) {
  const expression = String(args.expression || "").trim().slice(0, 500);
  if (!expression) return errorResult("expression_required", "expression is required");
  if (!/^[\d\s+\-*/().%eE^]+$/.test(expression)) return errorResult("unsafe_expression", "only arithmetic characters are allowed");
  try {
    const value = Function(`"use strict"; return (${expression.replace(/\^/g, "**")});`)();
    if (typeof value !== "number" || Number.isNaN(value)) return errorResult("non_numeric_result", "expression did not produce a number");
    return { expression, result: Number.isFinite(value) ? value : String(value) };
  } catch (error) { return errorResult("calculation_failed", error?.message || error); }
}

export async function listDirectory(args, ctx) {
  try {
    const root = await workingDirectory(ctx?.runId);
    const target = runPath(root, args.path || ".");
    const entries = await fs.readdir(target, { withFileTypes: true });
    return {
      path: path.relative(root, target) || ".",
      entries: entries.slice(0, 500).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other" })),
      truncated: entries.length > 500,
    };
  } catch (error) { return errorResult("list_failed", error?.message || error); }
}

export async function readFile(args, ctx) {
  try {
    const root = await workingDirectory(ctx?.runId);
    const target = runPath(root, args.path);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error("path is not a regular file");
    const maximum = boundedInt(args.max_bytes, DEFAULT_MAX_BODY_BYTES, 1, 10_485_760);
    const handle = await fs.open(target, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, maximum));
      const result = await handle.read(buffer, 0, buffer.length, 0);
      return { path: path.relative(root, target), content: buffer.subarray(0, result.bytesRead).toString("utf8"), bytes: stat.size, truncated: stat.size > maximum };
    } finally { await handle.close(); }
  } catch (error) { return errorResult("read_failed", error?.message || error); }
}

export async function writeFile(args, ctx) {
  try {
    if (!String(args.path || "")) throw new Error("path is required");
    const root = await workingDirectory(ctx?.runId);
    const target = runPath(root, args.path);
    const content = String(args.content ?? "");
    if (Buffer.byteLength(content) > 5 * 1024 * 1024) throw new Error("content exceeds 5 MB limit");
    if (args.overwrite === false) {
      try { await fs.access(target); throw new Error("target already exists and overwrite=false"); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    await atomicWrite(target, content);
    return { path: path.relative(root, target), bytes: Buffer.byteLength(content), sha256: crypto.createHash("sha256").update(content).digest("hex") };
  } catch (error) { return errorResult("write_failed", error?.message || error); }
}

export async function fileExists(args, ctx) {
  try {
    const root = await workingDirectory(ctx?.runId);
    const target = runPath(root, args.path);
    const stat = await fs.stat(target);
    return { path: path.relative(root, target), exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory(), bytes: stat.size };
  } catch (error) {
    if (error?.code === "ENOENT") return { path: String(args.path || ""), exists: false };
    return errorResult("exists_failed", error?.message || error);
  }
}

async function walk(root, maximum = 2000) {
  const files = [];
  async function visit(directory, depth) {
    if (depth > 12 || files.length >= maximum) return;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (files.length >= maximum) return;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, depth + 1);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(root, 0);
  return files;
}

function glob(pattern) {
  const escaped = String(pattern || "*").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export async function searchFiles(args, ctx) {
  try {
    const root = await workingDirectory(ctx?.runId);
    const base = runPath(root, args.path || ".");
    const matcher = glob(args.pattern || "**/*");
    const files = (await walk(base)).map((file) => path.relative(root, file).split(path.sep).join("/")).filter((file) => matcher.test(file)).slice(0, 500);
    return { pattern: String(args.pattern || "**/*"), files, count: files.length };
  } catch (error) { return errorResult("search_files_failed", error?.message || error); }
}

export async function grepFiles(args, ctx) {
  try {
    if (!String(args.pattern || "")) throw new Error("pattern is required");
    const regex = new RegExp(String(args.pattern), args.ignore_case ? "i" : "");
    const root = await workingDirectory(ctx?.runId);
    const base = runPath(root, args.path || ".");
    const maximum = boundedInt(args.max_matches, 100, 1, 500);
    const matches = [];
    for (const file of await walk(base)) {
      if (matches.length >= maximum) break;
      const stat = await fs.stat(file);
      if (stat.size > 2 * 1024 * 1024) continue;
      let text;
      try { text = await fs.readFile(file, "utf8"); } catch { continue; }
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < maximum; index += 1) {
        if (regex.test(lines[index])) matches.push({ path: path.relative(root, file).split(path.sep).join("/"), line: index + 1, text: safeText(lines[index], 500) });
      }
    }
    return { pattern: String(args.pattern), matches, count: matches.length, truncated: matches.length >= maximum };
  } catch (error) { return errorResult("grep_failed", error?.message || error); }
}

export function diffRender(args) {
  const before = String(args.before || "").split("\n");
  const after = String(args.after || "").split("\n");
  const output = [];
  let additions = 0;
  let deletions = 0;
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (index >= before.length) { output.push(`+ ${after[index]}`); additions += 1; }
    else if (index >= after.length) { output.push(`- ${before[index]}`); deletions += 1; }
    else if (before[index] !== after[index]) { output.push(`- ${before[index]}`, `+ ${after[index]}`); additions += 1; deletions += 1; }
    else output.push(`  ${before[index]}`);
  }
  const diff = output.join("\n");
  return { diff: diff.slice(0, DEFAULT_MAX_OUTPUT_CHARS), additions, deletions, truncated: diff.length > DEFAULT_MAX_OUTPUT_CHARS };
}

async function memory() {
  try {
    const value = JSON.parse(await fs.readFile(MEMORY_FILE, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`memory file invalid: ${error?.message || error}`);
  }
}

export async function memoryGet(args) {
  try {
    const key = String(args.key || "").slice(0, 256);
    if (!key) throw new Error("key is required");
    const data = await memory();
    return Object.hasOwn(data, key) ? { key, value: data[key] } : errorResult("not_found", "memory key not found", { key });
  } catch (error) { return errorResult("memory_get_failed", error?.message || error); }
}

export async function memoryPut(args) {
  try {
    const key = String(args.key || "").slice(0, 256);
    if (!key) throw new Error("key is required");
    const data = await memory();
    data[key] = args.value;
    const content = `${JSON.stringify(data, null, 2)}\n`;
    if (Buffer.byteLength(content) > 5 * 1024 * 1024) throw new Error("memory store exceeds 5 MB limit");
    await atomicWrite(MEMORY_FILE, content);
    return { key, saved: true };
  } catch (error) { return errorResult("memory_put_failed", error?.message || error); }
}

export async function memorySearch(args) {
  try {
    const query = String(args.query || "").trim().toLowerCase();
    if (!query) throw new Error("query is required");
    const data = await memory();
    const matches = Object.entries(data).filter(([key, value]) => `${key} ${JSON.stringify(value)}`.toLowerCase().includes(query)).slice(0, boundedInt(args.limit, 5, 1, 100)).map(([key, value]) => ({ key, value }));
    return { query, matches, count: matches.length };
  } catch (error) { return errorResult("memory_search_failed", error?.message || error); }
}
