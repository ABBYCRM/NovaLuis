#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import ts from "typescript";

const root = process.cwd();
const outPath = process.env.REPO_AUDIT_OUTPUT || "/tmp/repo-audit.json";
const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });
const binaryExts = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
  ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".webm", ".wav", ".sqlite",
]);
const textExtensions = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc",
  ".py", ".md", ".mdx", ".yaml", ".yml", ".sh", ".bash", ".html", ".htm", ".css",
  ".scss", ".sql", ".toml", ".ini", ".env", ".txt", ".xml", ".svg", ".graphql", ".gql",
]);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim().slice(-4000),
    stderr: (result.stderr || "").trim().slice(-4000),
    error: result.error?.message,
  };
}

function gitFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "buffer" });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr?.toString() || "unknown"}`);
  return result.stdout.toString("utf8").split("\0").filter(Boolean).sort();
}

function checkTs(file, text) {
  const ext = path.extname(file).toLowerCase();
  const kind = ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".jsx" ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, kind);
  const diagnostics = Array.isArray(sourceFile.parseDiagnostics) ? sourceFile.parseDiagnostics : [];
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

function balance(text, open, close) {
  let count = 0;
  for (const ch of text) {
    if (ch === open) count += 1;
    else if (ch === close) count -= 1;
    if (count < 0) return false;
  }
  return count === 0;
}

const files = gitFiles();
const results = [];
let failures = 0;

for (const file of files) {
  const absolute = path.join(root, file);
  const stat = fs.lstatSync(absolute);
  const record = {
    file,
    kind: stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : "other",
    size: stat.size,
    checks: [],
    status: "pass",
  };

  function add(name, ok, details = "") {
    record.checks.push({ name, ok, details: String(details || "").slice(0, 4000) });
    if (!ok) record.status = "fail";
  }

  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(absolute);
    add("symlink-target", fs.existsSync(path.resolve(path.dirname(absolute), target)), target);
    if (record.status === "fail") failures += 1;
    results.push(record);
    continue;
  }

  if (!stat.isFile()) {
    add("regular-file", false, "tracked path is not a regular file or symlink");
    failures += 1;
    results.push(record);
    continue;
  }

  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file);
  const buffer = fs.readFileSync(absolute);
  const likelyBinary = binaryExts.has(ext) || buffer.includes(0);

  add("readable", true, `${buffer.length} bytes`);
  if (likelyBinary && !textExtensions.has(ext)) {
    add("binary-nonempty", buffer.length > 0 || stat.size === 0, ext || "no extension");
    if (record.status === "fail") failures += 1;
    results.push(record);
    continue;
  }

  let text = "";
  try {
    text = fatalUtf8.decode(buffer);
    add("utf8", true);
  } catch (error) {
    add("utf8", false, error instanceof Error ? error.message : String(error));
  }

  if (record.status === "pass") {
    const conflict = /^(<{7}|={7}|>{7})(?:\s|$)/m.test(text);
    add("merge-conflict-markers", !conflict, conflict ? "conflict marker found" : "none");
  }

  if (record.status === "pass") {
    if (ext === ".json") {
      try { JSON.parse(text); add("json-parse", true); }
      catch (error) { add("json-parse", false, error instanceof Error ? error.message : String(error)); }
    } else if ([".ts", ".tsx", ".mts", ".cts", ".jsx"].includes(ext)) {
      const diagnostics = checkTs(file, text);
      add("typescript-syntax", diagnostics.length === 0, diagnostics.join(" | "));
    } else if ([".js", ".mjs", ".cjs"].includes(ext)) {
      const checked = run(process.execPath, ["--check", absolute]);
      add("node-syntax", checked.ok, checked.stderr || checked.stdout || checked.error || "");
    } else if (ext === ".py") {
      const checked = run("python", ["-m", "py_compile", absolute]);
      add("python-syntax", checked.ok, checked.stderr || checked.stdout || checked.error || "");
    } else if ([".sh", ".bash"].includes(ext) || base === "Dockerfile") {
      if (base !== "Dockerfile") {
        const checked = run("bash", ["-n", absolute]);
        add("shell-syntax", checked.ok, checked.stderr || checked.stdout || checked.error || "");
      } else {
        add("dockerfile-present", text.trim().length > 0);
      }
    } else if ([".css", ".scss"].includes(ext)) {
      add("brace-balance", balance(text, "{", "}"), "basic structural check; production build is authoritative");
    } else if ([".yaml", ".yml"].includes(ext)) {
      add("yaml-no-tabs", !/^\t/m.test(text), "YAML indentation must not begin with tabs");
    } else {
      add("text-reviewed-mechanically", true, ext || base);
    }
  }

  if (record.status === "fail") failures += 1;
  results.push(record);
}

const byExtension = {};
for (const result of results) {
  const ext = path.extname(result.file).toLowerCase() || "[none]";
  byExtension[ext] = (byExtension[ext] || 0) + 1;
}
const report = {
  generatedAt: new Date().toISOString(),
  root,
  trackedFiles: results.length,
  passedFiles: results.length - failures,
  failedFiles: failures,
  byExtension,
  results,
};
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: outPath, trackedFiles: report.trackedFiles, passedFiles: report.passedFiles, failedFiles: report.failedFiles, byExtension }, null, 2));
if (failures) process.exit(1);
