#!/usr/bin/env node
// NovaLuis custom agent — OpenAI-compatible chat-completions HTTP server.
//
// Replaces the OpenClaw gateway dependency for the chat path. Same wire
// format (POST /v1/chat/completions, GET /v1/models, GET /healthz, GET
// /readyz), same streaming semantics (SSE), same model id resolution
// (kimi-k2.6 by default, proxied through Helicone).
//
// What this gives NovaLuis that OpenClaw didn't:
//   - Direct control over the tool loop (no composio indirection in phase 1;
//     phase 2 adds first-class tools for resend, exa, tavily, firecrawl,
//     scrapingbee, scrapfly, screenshotone, e2b).
//   - Real error messages instead of "Web Fetch failed" / "internal error".
//   - Single process boundary; same token-auth as OpenClaw.
//
// What stays the same:
//   - The work-tree worker, social-media worker, and agent-cron (in
//     api-server) are untouched. They don't depend on OpenClaw.
//   - The connected-app preflight still goes through Composio for the
//     user-OAuth tools (gmail, slack, etc.) — that path is owned by
//     api-server, not the agent. This server just consumes the
//     preflight evidence injected by api-server and dispatches
//     composio-execute when the model asks for it.
//
// Phase 1 scope: receive chat-completions, run the model loop with the
// same TOOL_SYSTEM_PROMPT and CONNECTED_APP_RULES as the openclaw proxy,
// stream tokens back. Tool calls are dispatched to composio-execute
// over the loopback api-server's REST API (NOVA_INTERNAL_API_BASE).
// Phases 2 and 3 swap composio for first-class direct tools and remove
// the openclaw dependency entirely.

import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  CONNECTED_APP_RULES,
  TOOL_SYSTEM_PROMPT,
  GITHUB_EVIDENCE_HEADER,
  CONNECTED_APP_EVIDENCE_HEADER,
  connectedAppIntentForText,
} from "./intent-rules.mjs";
import { TOOL_DEFINITIONS, dispatchToolCall as dispatchDirectTool } from "./tools.mjs";

const PORT = Number(process.env.CUSTOM_AGENT_PORT || 18790);
const HOST = process.env.CUSTOM_AGENT_HOST || "127.0.0.1";
const TOKEN =
  process.env.CUSTOM_AGENT_TOKEN ||
  process.env.OPENCLAW_GATEWAY_TOKEN ||
  // Auto-generate a token so the agent can boot in isolation.
  // (api-server's start-openclaw.mjs sets OPENCLAW_GATEWAY_TOKEN in the
  // child env, so this only fires in dev.)
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error(
          "CUSTOM_AGENT_TOKEN or OPENCLAW_GATEWAY_TOKEN must be set in production",
        );
      })()
    : require_("node:crypto").randomBytes(32).toString("hex"));

const HELICONE_BASE = process.env.HELICONE_BASE_URL || "https:// helicone.ai";

// Multi-upstream provider map. The custom agent picks an upstream based on
// the model id in the request body. Each provider has:
//   - key:    the env var name holding the API key
//   - base:   the env var name holding the base URL (with a default)
//   - match:  a function that decides if a given model id routes to this
//             provider (first match wins)
//   - defaultModel: used when the model id is missing or unknown
//
// Adding a new provider is a 4-line change below. The model id is then
// forwarded verbatim to that provider's OpenAI-compatible endpoint.
const UPSTREAM_PROVIDERS = [
  {
    name: "openai",
    key: "CUSTOM_AGENT_UPSTREAM_KEY",
    base: "CUSTOM_AGENT_UPSTREAM_BASE",
    baseDefault: "https://api.openai.com/v1",
    keyFallbacks: ["OPENAI_API_KEY"],
    match: (model) => /^(gpt-|o1-|o3-|o4-|chatgpt-)/i.test(model || ""),
    defaultModel: "gpt-4o-mini",
  },
  {
    name: "nvidia-nim",
    key: "CUSTOM_AGENT_NVIDIA_NIM_KEY",
    base: "CUSTOM_AGENT_NVIDIA_NIM_BASE",
    baseDefault: "https://integrate.api.nvidia.com/v1",
    keyFallbacks: ["NVIDIA_NIM_API_KEY", "NVIDIA_API_KEY"],
    // NVIDIA NIM model ids are org/model slugs like "z-ai/glm-5.2" or
    // "deepseek-ai/deepseek-v4-pro". Match by the slash.
    match: (model) => /^[a-z0-9._-]+\/[a-z0-9._-]+/i.test(model || ""),
    defaultModel: "meta/llama-3.1-70b-instruct",
  },
  {
    name: "moonshot",
    key: "CUSTOM_AGENT_MOONSHOT_KEY",
    base: "CUSTOM_AGENT_MOONSHOT_BASE",
    baseDefault: "https://api.moonshot.ai/v1",
    keyFallbacks: ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
    match: (model) => /^(kimi|moonshot)/i.test(model || ""),
    defaultModel: "kimi-k2.6",
  },
];

function readKey(provider) {
  // Direct env var first
  const direct = process.env[provider.key];
  if (direct) return direct;
  // Then fallbacks
  for (const fb of provider.keyFallbacks || []) {
    const v = process.env[fb];
    if (v) return v;
  }
  return "";
}

function readBase(provider) {
  return process.env[provider.base] || provider.baseDefault;
}

function resolveUpstream(model) {
  for (const p of UPSTREAM_PROVIDERS) {
    try {
      if (p.match(model)) {
        const key = readKey(p);
        if (!key) continue; // provider matches but no key — try next
        return { ...p, key, base: readBase(p) };
      }
    } catch {
      // skip
    }
  }
  // Fallback: first provider that has a key configured
  for (const p of UPSTREAM_PROVIDERS) {
    const key = readKey(p);
    if (key) return { ...p, key, base: readBase(p) };
  }
  // Last resort: return the first provider with no key (will 401 on use)
  const p = UPSTREAM_PROVIDERS[0];
  return { ...p, key: "", base: readBase(p) };
}

const DEFAULT_MODEL = process.env.CUSTOM_AGENT_MODEL || "gpt-4o-mini";
const TOOL_TIMEOUT_MS = Number(process.env.CUSTOM_AGENT_TOOL_TIMEOUT_MS || 60_000);
const MAX_TOOL_ITERATIONS = Number(process.env.CUSTOM_AGENT_MAX_ITER || 8);

const NOVA_INTERNAL_API_BASE =
  process.env.NOVA_INTERNAL_API_BASE || "http://127.0.0.1:8080/api";
const NOVA_INTERNAL_PROXY_KEY =
  process.env.NOVA_OPENCLAW_PROXY_KEY || process.env.CUSTOM_AGENT_PROXY_KEY || "";

// --- helpers -----------------------------------------------------------------

function log(...args) {
  console.log(`[custom-agent ${new Date().toISOString()}]`, ...args);
}

function require_(name) {
  // Lazy import so the auto-token path doesn't crash at top-level in
  // environments where node:crypto isn't always available — it always
  // is, but keeping this defensive avoids confusing stack traces.
  return require(name);
}

function nowMs() {
  return Date.now();
}

function timedFetch(url, opts = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

function unauthorized(res) {
  res.statusCode = 401;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: { message: "invalid agent token", type: "auth" } }));
}

function badRequest(res, message) {
  res.statusCode = 400;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: { message, type: "invalid_request" } }));
}

function serverError(res, error) {
  res.statusCode = 500;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: "server_error",
      },
    }),
  );
}

function authOk(req) {
  // Accept the same auth shape openclaw accepts so a single token works
  // for both backends during the 50/50 split.
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) {
    return constantTimeEqual(auth.slice(7), TOKEN);
  }
  const xToken = req.headers["x-custom-agent-token"];
  if (typeof xToken === "string") return constantTimeEqual(xToken, TOKEN);
  return false;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function readJsonBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(new Error(`invalid JSON body: ${err.message}`));
      }
    });
    req.on("error", reject);
  });
}

// --- composio bridge ---------------------------------------------------------
// Phase 1: tools are limited to composio-execute for the user-OAuth apps.
// The model emits a tool_call with name="composio_execute" and
// arguments={tool_slug, arguments, account?}; we forward to the api-server
// over loopback. Phase 2 adds first-class direct tools (exa, tavily,
// firecrawl, etc.) — those replace this with native function calls and
// skip the round-trip.

async function callComposioExecute({ toolSlug, args, account }) {
  if (!NOVA_INTERNAL_PROXY_KEY) {
    return {
      ok: false,
      observed: false,
      error: "NOVA_OPENCLAW_PROXY_KEY (or CUSTOM_AGENT_PROXY_KEY) is not set",
    };
  }
  try {
    const r = await timedFetch(
      `${NOVA_INTERNAL_API_BASE}/integrations/composio/execute`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nova-internal-key": NOVA_INTERNAL_PROXY_KEY,
        },
        body: JSON.stringify({
          toolSlug,
          arguments: args || {},
          ...(account ? { account } : {}),
        }),
      },
      TOOL_TIMEOUT_MS,
    );
    const text = await r.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 2000) };
    }
    return {
      ok: r.ok,
      status: r.status,
      observed: r.ok,
      data: body,
    };
  } catch (error) {
    return {
      ok: false,
      observed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Define the tool schema we expose to the model. Phase 1 = composio only.
const TOOLS_PHASE_1 = TOOL_DEFINITIONS;

// --- chat completion core ----------------------------------------------------

function buildMessages({ messages, systemPrompt, model }) {
  const out = [];
  if (systemPrompt) {
    out.push({ role: "system", content: systemPrompt });
  }
  for (const msg of messages || []) {
    if (!msg || !msg.role) continue;
    if (msg.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: msg.tool_call_id || msg.name || randomUUID(),
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || ""),
      });
    } else if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      out.push({
        role: "assistant",
        content: msg.content || "",
        tool_calls: msg.tool_calls,
      });
    } else {
      out.push({ role: msg.role, content: msg.content || "" });
    }
  }
  return out;
}

function pickIntentForLastUser(messages) {
  if (!Array.isArray(messages) || !messages.length) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && typeof m.content === "string" && m.content.trim()) {
      return connectedAppIntentForText(m.content);
    }
  }
  return null;
}

function buildPreflightEvidenceBlock({ intent, toolSearch, app }) {
  if (!intent) return "";
  if (toolSearch) {
    return JSON.stringify(
      {
        observed: true,
        app,
        toolkitHints: intent.toolkitHints,
        toolSearch,
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      observed: false,
      app,
      toolkitHints: intent.toolkitHints,
      error: "no tool_router session available",
    },
    null,
    2,
  );
}

async function runToolLoop({
  upstreamPayload,
  intent,
  stream,
  onToken,
  onToolCall,
  signal,
  upstreamConfig,
}) {
  // Loop: send the conversation to the model, stream back any tool
  // calls, execute them, append tool results, repeat until the model
  // emits a final assistant message with no tool calls. Mirrors the
  // OpenClaw ReAct loop but in this process so we can return exact
  // observed errors instead of generic internal errors.
  const messages = upstreamPayload.messages;
  const tools = upstreamPayload.tools && upstreamPayload.tools.length
    ? upstreamPayload.tools
    : TOOLS_PHASE_1;
  const model = upstreamPayload.model || DEFAULT_MODEL;
  const maxIter = MAX_TOOL_ITERATIONS;
  let iter = 0;
  let lastAssistant = null;
  const trace = { iterations: 0, toolCalls: [] };

  while (iter < maxIter) {
    iter += 1;
    if (signal?.aborted) throw new Error("aborted");

    const body = {
      model,
      messages,
      tools,
      tool_choice: iter === 1 && intent ? "auto" : "auto",
      stream: false,
      temperature: upstreamPayload.temperature ?? 0.4,
      max_tokens: upstreamPayload.max_tokens ?? 4096,
    };

    const upstream = await timedFetch(
      `${upstreamConfig.base}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${upstreamConfig.key}`,
          ...(process.env.HELICONE_API_KEY && upstreamConfig.name === "openai"
            ? { "helicone-auth": `Bearer ${process.env.HELICONE_API_KEY}` }
            : {}),
        },
        body: JSON.stringify(body),
      },
      90_000,
    );
    if (!upstream.ok) {
      const errText = await upstream.text();
      throw new Error(
        `upstream ${upstreamConfig.name} ${upstream.status} at ${upstreamConfig.base}/chat/completions model=${model}: ${errText.slice(0, 500)}`,
      );
    }
    const data = await upstream.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error("upstream returned no choices");
    const assistant = choice.message || {};
    lastAssistant = assistant;

    // Surface any partial content to the client as we get it. (Phase 1
    // is non-streaming internally; the outer response can still be SSE.)
    if (typeof assistant.content === "string" && assistant.content) {
      onToken?.(assistant.content);
    }

    const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (!toolCalls.length) break;

    messages.push({
      role: "assistant",
      content: assistant.content || "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const fn = call.function || {};
      const name = fn.name || "";
      let parsedArgs = {};
      try {
        parsedArgs = fn.arguments ? JSON.parse(fn.arguments) : {};
      } catch {
        parsedArgs = {};
      }
      const toolResult = await dispatchToolCall({ name, args: parsedArgs, intent, onToolCall });
      trace.toolCalls.push({ name, args: parsedArgs, observed: toolResult.observed !== false });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  trace.iterations = iter;
  return { assistant: lastAssistant, trace };
}

async function dispatchToolCall({ name, args, intent, onToolCall }) {
  if (name === "composio_execute") {
    const result = await callComposioExecute({
      toolSlug: args.tool_slug || args.toolSlug,
      args: args.arguments || {},
      account: args.account,
    });
    onToolCall?.({ name, observed: result.observed, ok: result.ok });
    return result;
  }
  // Phase 2: first-class direct tools (web_search, scrape_url, screenshot_url,
  // send_email, run_code) — all defined in tools.mjs.
  const direct = await dispatchDirectTool({ name, args });
  onToolCall?.({ name, observed: direct.observed !== false, ok: direct.ok });
  return direct;
}

// --- HTTP routes -------------------------------------------------------------

function handleListModels(req, res) {
  if (!authOk(req)) return unauthorized(res);
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      object: "list",
      data: [
        {
          id: DEFAULT_MODEL,
          object: "model",
          created: Math.floor(nowMs() / 1000),
          owned_by: "novaluis",
        },
        {
          id: "openclaw/default",
          object: "model",
          created: Math.floor(nowMs() / 1000),
          owned_by: "novaluis",
        },
      ],
    }),
  );
}

function handleHealthz(req, res) {
  // Public liveness — no auth.
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ status: "ok", backend: "custom-agent" }));
}

function handleReadyz(req, res) {
  if (!authOk(req)) return unauthorized(res);
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      status: "ready",
      backend: "custom-agent",
      model: DEFAULT_MODEL,
      providers: UPSTREAM_PROVIDERS.map((p) => ({
        name: p.name,
        base: readBase(p),
        key_set: Boolean(readKey(p)),
        default_model: p.defaultModel,
      })),
      rules: CONNECTED_APP_RULES.length,
      tools: TOOL_DEFINITIONS.length,
      tool_names: TOOL_DEFINITIONS.map((t) => t.function.name),
      token_set: Boolean(TOKEN),
    }),
  );
}

async function handleChatCompletions(req, res) {
  if (!authOk(req)) return unauthorized(res);
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return badRequest(res, err.message);
  }
  const stream = Boolean(body.stream);
  const model = String(body.model || DEFAULT_MODEL);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return badRequest(res, "messages[] is required");

  // The api-server injects GITHUB_PREFLIGHT_EVIDENCE and
  // CONNECTED_APP_PREFLIGHT_EVIDENCE system messages before forwarding
  // to us. Honor them as system context; our TOOL_SYSTEM_PROMPT
  // teaches the model how to read them.
  const forwardedSystemPrompt = TOOL_SYSTEM_PROMPT;
  const intent = pickIntentForLastUser(messages);

  // OpenAI-compatible SSE headers
  if (stream) {
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
  } else {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
  }

  const startedAt = nowMs();
  const id = `chatcmpl-${randomUUID()}`;
  const clientSignal = req.socket ? { aborted: false } : { aborted: false };
  req.on("close", () => {
    clientSignal.aborted = true;
  });

  const emitDelta = (delta) => {
    if (clientSignal.aborted) return;
    if (stream) {
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created: Math.floor(startedAt / 1000),
          model,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
        })}\n\n`,
      );
    }
  };

  const emitFinal = (assistant, trace) => {
    if (clientSignal.aborted) return;
    if (stream) {
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created: Math.floor(startedAt / 1000),
          model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
          novaluis_trace: trace,
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.end(
        JSON.stringify({
          id,
          object: "chat.completion",
          created: Math.floor(startedAt / 1000),
          model,
          choices: [
            {
              index: 0,
              message: assistant,
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
          novaluis_trace: trace,
        }),
      );
    }
  };

  try {
    const prepared = buildMessages({
      messages,
      systemPrompt: forwardedSystemPrompt,
      model,
    });
    // Resolve which upstream provider to talk to based on the model id.
    // For a model like 'z-ai/glm-5.2' this picks NVIDIA NIM. For 'gpt-4o-mini'
    // it picks OpenAI. For 'kimi-k2.6' it picks Moonshot. The custom agent
    // does the routing so the api-server can stay provider-agnostic.
    const upstreamConfig = resolveUpstream(model);
    log(`resolved upstream: provider=${upstreamConfig.name} base=${upstreamConfig.base} model=${model} key_set=${Boolean(upstreamConfig.key)}`);
    const { assistant, trace } = await runToolLoop({
      upstreamPayload: { ...body, messages: prepared, model },
      intent,
      stream,
      onToken: emitDelta,
      onToolCall: () => {},
      signal: clientSignal,
      upstreamConfig,
    });
    emitFinal(assistant, trace);
    log(
      `chat-complete id=${id} model=${model} iter=${trace.iterations} toolCalls=${trace.toolCalls.length} duration=${nowMs() - startedAt}ms`,
    );
  } catch (error) {
    if (clientSignal.aborted) {
      log(`chat-aborted id=${id} after ${nowMs() - startedAt}ms`);
      try { res.end(); } catch {}
      return;
    }
    log(`chat-error id=${id}`, error);
    if (stream) {
      try {
        res.write(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created: Math.floor(startedAt / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: {
                  content: `\n\n[custom-agent error: ${error instanceof Error ? error.message : String(error)}]`,
                },
                finish_reason: "stop",
              },
            ],
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {
        // socket already closed
      }
    } else {
      serverError(res, error);
    }
  }
}

// --- server bootstrap --------------------------------------------------------

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    return res.end();
  }
  // CORS for browser chat (PWA on the same origin in production, but
  // tools.cors.io tools.dev and curl benefit from permissive headers).
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type, x-custom-agent-token");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/v1/models") return handleListModels(req, res);
  if (req.method === "GET" && url.pathname === "/healthz") return handleHealthz(req, res);
  if (req.method === "GET" && url.pathname === "/readyz") return handleReadyz(req, res);
  if (req.method === "POST" && url.pathname === "/v1/chat/completions")
    return handleChatCompletions(req, res);
  res.statusCode = 404;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: { message: "not found", type: "not_found" } }));
});

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT} model=${DEFAULT_MODEL}`);
  for (const p of UPSTREAM_PROVIDERS) {
    if (readKey(p)) {
      log(`  provider ready: ${p.name} (default: ${p.defaultModel}, base: ${readBase(p)})`);
    } else {
      log(`  provider NOT ready: ${p.name} (no key for ${p.key} or fallbacks ${(p.keyFallbacks || []).join(",")})`);
    }
  }
  const anyReady = UPSTREAM_PROVIDERS.some((p) => readKey(p));
  if (!anyReady) {
    log("WARN: no upstream provider has a key; chat will 401 until one is configured");
  }
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log(`received ${signal}, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
