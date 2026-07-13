#!/usr/bin/env node
import fs from "node:fs/promises";

const API_BASE = (process.env.NOVA_INTERNAL_API_BASE || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const API_KEY = process.env.SUPERNOVA_API_KEY || process.env.OPENCLAW_API_KEY || "";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function required(args, key) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required option --${key}`);
  }
  return value.trim();
}

function intOption(args, key, fallback, min, max) {
  if (args[key] == null) return fallback;
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${key} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function jsonObjectOption(args, key, fallback = {}) {
  if (args[key] == null) return fallback;
  const raw = required(args, key);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--${key} must be valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`--${key} must be a JSON object`);
  }
  return parsed;
}

async function request(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body == null ? {} : { "Content-Type": "application/json" }),
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    ...(options.headers || {}),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 60_000));
  timeout.unref?.();
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const error = new Error(`NOVA API ${response.status} ${response.statusText}`);
      error.details = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function run(command, args) {
  switch (command) {
    case "status": {
      const [api, openclaw, composio] = await Promise.all([
        request("/healthz"),
        request("/openclaw/status").catch((error) => ({
          status: "unavailable",
          error: error.message,
          details: error.details,
        })),
        request("/integrations/composio/status").catch((error) => ({
          configured: false,
          error: error.message,
          details: error.details,
        })),
      ]);
      return { api, openclaw, composio };
    }
    case "integrations":
      return request("/integrations");
    case "gmail": {
      const max = intOption(args, "max", 10, 1, 50);
      const query = typeof args.query === "string" ? args.query : "";
      return request(`/integrations/gmail/messages?max=${max}&q=${encodeURIComponent(query)}`);
    }
    case "drive": {
      const query = typeof args.query === "string" ? args.query : "";
      return request(`/integrations/drive/files?q=${encodeURIComponent(query)}`);
    }
    case "docs":
      return request(`/integrations/docs/${encodeURIComponent(required(args, "id"))}`);
    case "sheets": {
      const id = encodeURIComponent(required(args, "id"));
      const range = encodeURIComponent(typeof args.range === "string" ? args.range : "A1:Z100");
      return request(`/integrations/sheets/${id}?range=${range}`);
    }
    case "youtube":
      return request(`/integrations/youtube/search?q=${encodeURIComponent(required(args, "query"))}`);
    case "instagram":
      return request("/integrations/instagram/media");
    case "composio-status":
      return request("/integrations/composio/status");
    case "composio-apps": {
      const limit = intOption(args, "limit", 25, 1, 50);
      const search = typeof args.search === "string" ? args.search.trim() : "";
      const query = new URLSearchParams({ limit: String(limit) });
      if (search) query.set("search", search);
      return request(`/integrations/composio/toolkits?${query}`);
    }
    case "composio-connections":
      return request("/integrations/composio/connections");
    case "composio-connect":
      return request("/integrations/composio/connect", {
        method: "POST",
        body: JSON.stringify({ toolkit: required(args, "toolkit").toLowerCase() }),
      });
    case "composio-search":
      return request("/integrations/composio/search", {
        method: "POST",
        body: JSON.stringify({ query: required(args, "query") }),
      });
    case "composio-execute": {
      const body = {
        toolSlug: required(args, "tool"),
        arguments: jsonObjectOption(args, "arguments-json", {}),
        ...(typeof args.account === "string" && args.account.trim()
          ? { account: args.account.trim() }
          : {}),
      };
      return request("/integrations/composio/execute", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 180_000,
      });
    }
    case "github-repo": {
      const url = required(args, "url");
      return request("/integrations/composio/search", {
        method: "POST",
        body: JSON.stringify({
          query: `Inspect and analyze the GitHub repository ${url}. Find tools to read repository metadata, default branch, directory tree, important files, commits, issues, and pull requests without modifying the repository.`,
        }),
      });
    }
    case "knowledge-search": {
      const query = required(args, "query");
      const limit = intOption(args, "limit", 5, 1, 20);
      return request("/knowledge/search", {
        method: "POST",
        body: JSON.stringify({ query, limit }),
      });
    }
    case "knowledge-ingest": {
      const source = typeof args.source === "string" ? args.source : "openclaw";
      const title = typeof args.title === "string" ? args.title : "";
      let content = typeof args.content === "string" ? args.content : "";
      if (typeof args.file === "string") {
        content = await fs.readFile(args.file, "utf8");
      }
      if (!content.trim()) throw new Error("Provide --content or --file for knowledge-ingest");
      const body = {
        source,
        title,
        content,
        ...(typeof args["external-id"] === "string"
          ? { externalId: args["external-id"] }
          : {}),
      };
      return request("/knowledge/ingest", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 180_000,
      });
    }
    case "skills": {
      if (typeof args.name === "string" && args.name.trim()) {
        return request(`/skills/${encodeURIComponent(args.name.trim())}`);
      }
      return request("/skills");
    }
    case "scratchpad":
      return request("/scratchpad");
    default:
      throw new Error(
        "Unknown command. Use one of: status, integrations, gmail, drive, docs, sheets, youtube, instagram, composio-status, composio-apps, composio-connections, composio-connect, composio-search, composio-execute, github-repo, knowledge-search, knowledge-ingest, skills, scratchpad",
      );
  }
}

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node nova-services.mjs <command> [--option value]");
  process.exit(2);
}

try {
  const result = await run(command, parseArgs(rest));
  process.stdout.write(`${JSON.stringify({ ok: true, command, result }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        command,
        error: error instanceof Error ? error.message : String(error),
        details: error?.details,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}
