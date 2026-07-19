import { Router } from "express";
import {
  conversationKeyFor,
  lastUserText,
  recordTurn,
  getMemoryDigest,
  type ChatMessage,
} from "../lib/scratchpad";
import { getKnowledgeContext } from "../lib/knowledge";
import { getModelPreference, getModelTuning } from "./nova-config";

const router = Router();

const OPENAI_BASE = "https://api.openai.com";
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";

const NVIDIA_BASE = (
  process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com"
).replace(/\/$/, "");
const NVIDIA_KEY = process.env.NVIDIA_API_KEY ?? "";

// Bitdeer: OpenAI-compatible endpoint that hosts OSS + proprietary models.
const BITDEER_BASE = "https://api-inference.bitdeer.ai";
const BITDEER_KEY = process.env.BITDEER_API_KEY ?? "";

// Moonshot / Kimi — official Kimi API (kimi-k2, kimi-k2.6, etc.)
const KIMI_BASE = "https://api.moonshot.cn";
const KIMI_KEY = process.env.KIMI_API_KEY ?? "";

// Google Gemini via their OpenAI-compatible shim.
// Path stripping: their base already includes /v1beta/openai, so drop the
// leading /v1 that the client sends (e.g. /v1/chat/completions → /chat/completions).
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";

interface ProviderSelection {
  name: string;
  url: (path: string) => string;
  key: string;
  requiredEnv: string;
}

function pickProvider(model: string): ProviderSelection {
  // Poolside Laguna is served by NVIDIA's OpenAI-compatible NIM endpoint.
  // Keep this selection even when the key is missing so the request fails with
  // an exact NVIDIA_API_KEY configuration error instead of being misrouted.
  if (model.startsWith("poolside/")) {
    return {
      name: "nvidia",
      url: (path) => `${NVIDIA_BASE}${path}`,
      key: NVIDIA_KEY,
      requiredEnv: "NVIDIA_API_KEY",
    };
  }
  if (model.startsWith("gemini-") && GEMINI_KEY) {
    return {
      name: "gemini",
      url: (path) => `${GEMINI_BASE}${path.replace(/^\/v1/, "")}`,
      key: GEMINI_KEY,
      requiredEnv: "GEMINI_API_KEY",
    };
  }
  if (
    (model.startsWith("gpt-") ||
      model.startsWith("o1") ||
      model.startsWith("o3") ||
      model.startsWith("o4")) &&
    OPENAI_KEY
  ) {
    return {
      name: "openai",
      url: (path) => `${OPENAI_BASE}${path}`,
      key: OPENAI_KEY,
      requiredEnv: "OPENAI_API_KEY",
    };
  }
  if (model.startsWith("kimi-") && KIMI_KEY) {
    return {
      name: "kimi",
      url: (path) => `${KIMI_BASE}${path}`,
      key: KIMI_KEY,
      requiredEnv: "KIMI_API_KEY",
    };
  }
  if (BITDEER_KEY) {
    return {
      name: "bitdeer",
      url: (path) => `${BITDEER_BASE}${path}`,
      key: BITDEER_KEY,
      requiredEnv: "BITDEER_API_KEY",
    };
  }
  return {
    name: "openai",
    url: (path) => `${OPENAI_BASE}${path}`,
    key: OPENAI_KEY,
    requiredEnv: "OPENAI_API_KEY",
  };
}

const MEMORY_HEADER =
  "Continuity memory — things you already know about Robert from past conversations. " +
  "Use it naturally for context; do not recite it or mention that you have notes.\n";

const KNOWLEDGE_HEADER =
  "Knowledge base — relevant passages retrieved from Robert's notes, files, SOPs, " +
  "leads and transcripts. Ground your answer in these when applicable; cite naturally, " +
  "do not mention that they were retrieved.\n";

function extractDeltas(buffer: string): { text: string; rest: string } {
  let text = "";
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload);
      const delta = json?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
    } catch {
      // Partial JSON across chunks is retained in the caller buffer.
    }
  }
  return { text, rest };
}

async function proxyBrowserChatToAgent(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  const port = Number(process.env.PORT || 8080);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);
  timer.unref?.();
  try {
    const upstream = await fetch(
      `http://127.0.0.1:${port}/api/agent/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: req.headers.accept ?? "text/event-stream, application/json",
          "x-nova-rerouted-from": "/api/v1/chat/completions",
        },
        body: JSON.stringify(req.body),
        signal: controller.signal,
        duplex: "half",
      },
    );

    res.status(upstream.status);
    const skipHeaders = new Set([
      "transfer-encoding",
      "connection",
      "keep-alive",
      "upgrade",
      "content-encoding",
      "content-length",
    ]);
    upstream.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) res.setHeader(key, value);
    });

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const writable = res.write(value);
      if (!writable) await new Promise<void>((resolve) => res.once("drain", resolve));
    }
    res.end();
  } catch (error) {
    req.log.error({ err: error }, "browser chat reroute to OpenClaw failed");
    if (!res.headersSent) {
      res.status(502).json({
        error: "OpenClaw agent runtime unreachable",
        details: error instanceof Error ? error.message : String(error),
      });
    } else {
      res.end();
    }
  } finally {
    clearTimeout(timer);
  }
}

router.all("/v1/*splat", async (req, res) => {
  const qs = req.url.slice(req.path.length);

  const isChat =
    req.method === "POST" &&
    req.path === "/v1/chat/completions" &&
    req.body != null &&
    Array.isArray(req.body.messages);

  const internalProxyKey = process.env.NOVA_OPENCLAW_PROXY_KEY || "";
  const authHeader = String(req.headers.authorization || "");
  const isInternalOpenClaw = Boolean(
    internalProxyKey && authHeader === `Bearer ${internalProxyKey}`,
  );

  if (isChat && !isInternalOpenClaw) {
    await proxyBrowserChatToAgent(req, res);
    return;
  }

  if (isChat && isInternalOpenClaw) {
    req.body.model = getModelPreference().model;
  }

  if (isChat) {
    const chatBody = req.body as Record<string, unknown>;
    const chatModel = String(chatBody.model ?? "");
    const tuning = getModelTuning(chatModel);
    if (tuning) {
      if (chatBody.max_tokens == null && chatBody.max_completion_tokens == null) {
        chatBody.max_tokens = tuning.maxTokens;
      }
      if (chatBody.temperature == null) chatBody.temperature = tuning.temperature;
      if (chatBody.top_p == null) chatBody.top_p = tuning.topP;
      if (tuning.thinking.type !== "disabled") {
        const extra =
          chatBody.extra_body && typeof chatBody.extra_body === "object"
            ? (chatBody.extra_body as Record<string, unknown>)
            : {};
        if (extra.thinking == null) {
          extra.thinking = {
            type: tuning.thinking.type,
            keep: tuning.thinking.keep,
          };
          chatBody.extra_body = extra;
        }
      }
    }
  }

  let convKey: string | null = null;
  let userText = "";
  const model: string = isChat ? String(req.body.model ?? "") : "";
  const provider = pickProvider(model);
  const upstreamUrl = `${provider.url(req.path)}${qs}`;
  const API_KEY = provider.key;

  if (!API_KEY) {
    res.status(503).json({
      error: `${provider.name} model provider is not configured`,
      requiredEnv: provider.requiredEnv,
      model: model || null,
    });
    return;
  }

  if (isChat) {
    const messages = req.body.messages as ChatMessage[];
    convKey = conversationKeyFor(messages);
    userText = lastUserText(messages);
    try {
      const digest = await getMemoryDigest();
      if (digest) {
        const memoryMsg = { role: "system", content: MEMORY_HEADER + digest };
        const firstNonSystem = messages.findIndex((m) => m.role !== "system");
        const at = firstNonSystem === -1 ? messages.length : firstNonSystem;
        messages.splice(at, 0, memoryMsg);
      }
    } catch (e) {
      req.log.warn({ err: e }, "scratchpad memory injection skipped");
    }
    if (process.env.NOVA_KNOWLEDGE_RETRIEVAL !== "0") {
      try {
        const ctx = await getKnowledgeContext(userText, 3);
        if (ctx) {
          const knowledgeMsg = { role: "system", content: KNOWLEDGE_HEADER + ctx };
          const firstNonSystem = messages.findIndex((m) => m.role !== "system");
          const at = firstNonSystem === -1 ? messages.length : firstNonSystem;
          messages.splice(at, 0, knowledgeMsg);
        }
      } catch (e) {
        req.log.warn({ err: e }, "knowledge retrieval skipped");
      }
    }
  }

  const hasBody =
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    req.body != null &&
    Object.keys(req.body).length > 0;

  const proxyAbort = new AbortController();
  const proxyTimeout = setTimeout(
    () => proxyAbort.abort(),
    Number(process.env.OPENAI_PROXY_TIMEOUT_MS) || 15 * 60 * 1000,
  );

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        Accept: req.headers.accept ?? "*/*",
      },
      body: hasBody ? JSON.stringify(req.body) : undefined,
      duplex: "half",
      signal: proxyAbort.signal,
    });

    res.status(upstream.status);

    const skipHeaders = new Set([
      "transfer-encoding",
      "connection",
      "keep-alive",
      "upgrade",
      "proxy-authenticate",
      "proxy-authorization",
      "content-encoding",
      "content-length",
    ]);
    upstream.headers.forEach((v, k) => {
      if (!skipHeaders.has(k.toLowerCase())) res.setHeader(k, v);
    });

    if (!upstream.body) {
      res.end();
      return;
    }

    const captureOk = isChat && !isInternalOpenClaw && convKey && upstream.ok;
    let assistantText = "";
    let sseBuffer = "";
    const decoder = new TextDecoder();

    const reader = upstream.body.getReader();
    const pump = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (captureOk && value) {
          sseBuffer += decoder.decode(value, { stream: true });
          const { text, rest } = extractDeltas(sseBuffer);
          assistantText += text;
          sseBuffer = rest;
        }
        const ok = res.write(value);
        if (!ok) await new Promise<void>((resolve) => res.once("drain", resolve));
      }
      clearTimeout(proxyTimeout);
      res.end();

      if (captureOk) {
        recordTurn({
          conversationKey: convKey!,
          userText,
          assistantText,
          model,
        }).catch((e) => req.log.warn({ err: e }, "scratchpad recordTurn failed"));
      }
    };
    pump().catch((e) => {
      clearTimeout(proxyTimeout);
      req.log.error({ err: e }, "openai-proxy stream error");
      res.end();
    });
  } catch (e) {
    clearTimeout(proxyTimeout);
    req.log.error({ err: e }, "openai-proxy fetch error");
    if (!res.headersSent) {
      res.status(502).json({
        error: `${provider.name} upstream unreachable`,
        details: e instanceof Error ? e.message : String(e),
        model: model || null,
      });
    }
  }
});

export default router;
