import { Router } from "express";
import {
  conversationKeyFor,
  lastUserText,
  recordTurn,
  type ChatMessage,
} from "../lib/scratchpad";

const router = Router();

const OPENCLAW_GATEWAY_URL = (
  process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789"
).replace(/\/$/, "");
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const OPENCLAW_AGENT_MODEL = process.env.OPENCLAW_AGENT_MODEL || "openclaw/default";

const TOOL_SYSTEM_PROMPT = [
  "You are NOVA running inside the real OpenClaw agent runtime, not a raw chat model.",
  "You have executable workspace tools and the nova-services skill. Discover and use them before answering capability questions.",
  "For GitHub URLs, repositories, issues, pull requests, email, calendars, CRMs, social apps, or any connected external service, use the Composio commands documented in nova-services.",
  "For a GitHub repository analysis: call composio-status, search for the correct GitHub tools with composio-search, execute the returned tool slugs, inspect the real results, and only then report findings.",
  "If an app is not connected, call composio-connect for that toolkit and return the real Connect Link. Never claim GitHub or another supported app is unavailable until you attempted the bridge and observed a concrete error.",
  "Never invent tool calls, repository contents, connection state, or success. Show evidence from actual tool results.",
].join(" ");

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
      // Keep buffering partial or non-standard SSE payloads.
    }
  }
  return { text, rest };
}

router.post("/agent/v1/chat/completions", async (req, res) => {
  if (!OPENCLAW_GATEWAY_TOKEN) {
    res.status(503).json({ error: "OpenClaw Gateway token is not configured" });
    return;
  }

  const incoming = req.body as {
    messages?: unknown;
    stream?: unknown;
    model?: unknown;
    [key: string]: unknown;
  };
  if (!Array.isArray(incoming.messages)) {
    res.status(400).json({ error: "messages must be an array" });
    return;
  }

  const messages = incoming.messages as ChatMessage[];
  const conversationKey = conversationKeyFor(messages);
  const userText = lastUserText(messages);
  const stream = incoming.stream !== false;
  const forwardedMessages = [
    { role: "system", content: TOOL_SYSTEM_PROMPT },
    ...messages,
  ];

  const body = {
    ...incoming,
    model: OPENCLAW_AGENT_MODEL,
    stream,
    user: `nova-chat:${conversationKey}`,
    messages: forwardedMessages,
  };

  try {
    const upstream = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: req.headers.accept ?? "text/event-stream, application/json",
        Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
        "x-openclaw-session-key": `nova-chat-${conversationKey}`,
        "x-openclaw-message-channel": "webchat",
      },
      body: JSON.stringify(body),
      duplex: "half",
    });

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

    if (!stream) {
      const payload = await upstream.text();
      res.send(payload);
      if (upstream.ok) {
        try {
          const json = JSON.parse(payload);
          const content = json?.choices?.[0]?.message?.content;
          if (typeof content === "string" && content.trim()) {
            void recordTurn({
              conversationKey,
              userText,
              assistantText: content,
              model: OPENCLAW_AGENT_MODEL,
            });
          }
        } catch {
          // Response forwarding must not fail because persistence did.
        }
      }
      return;
    }

    let assistantText = "";
    let sseBuffer = "";
    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (upstream.ok && value) {
        sseBuffer += decoder.decode(value, { stream: true });
        const parsed = extractDeltas(sseBuffer);
        assistantText += parsed.text;
        sseBuffer = parsed.rest;
      }
      const writable = res.write(value);
      if (!writable) await new Promise<void>((resolve) => res.once("drain", resolve));
    }
    res.end();

    if (upstream.ok && assistantText.trim()) {
      void recordTurn({
        conversationKey,
        userText,
        assistantText,
        model: OPENCLAW_AGENT_MODEL,
      }).catch((error) => req.log.warn({ err: error }, "agent chat recordTurn failed"));
    }
  } catch (error) {
    req.log.error({ err: error }, "OpenClaw agent chat failed");
    if (!res.headersSent) {
      res.status(502).json({
        error: "OpenClaw agent runtime unreachable",
        details: error instanceof Error ? error.message : String(error),
      });
    } else {
      res.end();
    }
  }
});

export default router;
