import { Router } from "express";
import {
  conversationKeyFor,
  lastUserText,
  recordTurn,
  type ChatMessage,
} from "../lib/scratchpad";
import { getGitHubEvidenceForText } from "../lib/github-repo";
import {
  ComposioApiError,
  composioRequest,
  ensureComposioSession,
} from "../lib/composio";
import { getModelTuning } from "./nova-config";

const router = Router();

const OPENCLAW_GATEWAY_URL = (
  process.env.NOVA_AGENT_CHAT_GATEWAY_URL ||
  process.env.OPENCLAW_GATEWAY_URL ||
  "http://127.0.0.1:18789"
).replace(/\/$/, "");
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";

// Default agent model for the main chat route. Set this to a model id that the
// openai-proxy already knows how to route: "kimi-k2.6" (Moonshot), "gpt-4o"
// (OpenAI), "gemini-2.5-pro" (Google), or any "org/model" string for Bitdeer.
//
// Why the explicit kimi-k2.6 default: the previous fallback was
// "openclaw/default" which the openclaw gateway has no built-in resolver
// for on a fresh deploy. Result: the main chat "thinks and stops" — starts
// streaming, then dies silently with no model to call. Pinning to kimi-k2.6
// here forces a real upstream model to be selected. Override with the env
// var if you need a different default for a specific deploy.
const OPENCLAW_AGENT_MODEL = process.env.OPENCLAW_AGENT_MODEL || "kimi-k2.6";

interface ConnectedAppIntent {
  app: string;
  toolkitHints: string[];
}

const CONNECTED_APP_RULES: Array<{
  pattern: RegExp;
  intent: ConnectedAppIntent;
}> = [
  {
    pattern: /\bmicrosoft\s+teams?\b|\bms\s+teams?\b|\bteams\b/i,
    intent: { app: "Microsoft Teams", toolkitHints: ["microsoft_teams", "microsoftteams", "teams"] },
  },
  {
    pattern: /\boutlook\b|\bmicrosoft\s+365\b|\boffice\s*365\b/i,
    intent: { app: "Microsoft 365 / Outlook", toolkitHints: ["outlook", "microsoft_365", "office365"] },
  },
  {
    pattern: /\bslack\b/i,
    intent: { app: "Slack", toolkitHints: ["slack"] },
  },
  {
    pattern: /\bnotion\b/i,
    intent: { app: "Notion", toolkitHints: ["notion"] },
  },
  {
    pattern: /\bgmail\b/i,
    intent: { app: "Gmail", toolkitHints: ["gmail"] },
  },
  {
    pattern: /\bgoogle\s+(?:drive|docs|sheets|calendar)\b/i,
    intent: { app: "Google Workspace", toolkitHints: ["googledrive", "googledocs", "googlesheets", "googlecalendar"] },
  },
  {
    pattern: /\bsalesforce\b/i,
    intent: { app: "Salesforce", toolkitHints: ["salesforce"] },
  },
  {
    pattern: /\bhubspot\b/i,
    intent: { app: "HubSpot", toolkitHints: ["hubspot"] },
  },
];

const TOOL_SYSTEM_PROMPT = [
  "You are NOVA running inside the real OpenClaw agent runtime, not a raw chat model.",
  "You have executable workspace tools and the nova-services skill. Discover and use them before answering capability questions.",
  "Public GitHub repository URLs are preflighted server-side through the real GitHub REST API. When a GITHUB_PREFLIGHT_EVIDENCE system message is present, treat it as observed tool evidence and analyze it directly instead of claiming GitHub is unavailable.",
  "For Microsoft Teams, Outlook, Slack, Notion, Gmail, Google Workspace, Salesforce, HubSpot, and every other connected external account, use Composio through nova-services before answering. Microsoft Teams requests include checking new messages, chats, channels, teams, groups, memberships, notifications, and counts.",
  "When CONNECTED_APP_PREFLIGHT_EVIDENCE is present, NOVA attempted a real Composio preflight for the user's exact request. Inspect its observed field. If observed is true, use the returned discovery evidence and execute the relevant tool slug with nova-services composio-execute before answering. If observed is false, report or recover from the concrete observed Composio failure instead of inventing access or replacing execution with generic manual UI instructions.",
  "If execution reports that the app is disconnected, use composio-connect with the best toolkit slug discovered from the evidence and return the real Connect Link. Never claim a supported connected app is unavailable until a real Composio preflight or execution produced a concrete error.",
  "Use Composio for connected-account actions and apps that require OAuth. It is optional for ordinary public GitHub repository inspection.",
  "For private GitHub repositories or GitHub write actions, use available authenticated GitHub/Composio capabilities and report the exact observed authentication or permission error if access is missing.",
  "Never invent tool calls, repository contents, connection state, messages, counts, memberships, or success. Show evidence from actual tool results or the server-side preflight.",
].join(" ");

const GITHUB_EVIDENCE_HEADER = [
  "GITHUB_PREFLIGHT_EVIDENCE follows.",
  "This JSON was fetched by NOVA server-side from the GitHub REST API for repository URL(s) in the user's current message before this OpenClaw turn.",
  "Use it as primary observed evidence. Do not say you cannot access the repository when this evidence contains repository metadata, tree entries, commits, or file contents.",
  "State any limitations precisely, such as a truncated tree, unavailable private repository, rate limit, or a file that was not fetched.",
].join(" ");

const CONNECTED_APP_EVIDENCE_HEADER = [
  "CONNECTED_APP_PREFLIGHT_EVIDENCE follows.",
  "This JSON was produced by NOVA server-side while attempting to establish a real Composio Tool Router session and search for tools for the user's exact current request.",
  "Read the observed field literally: observed=true means the real Tool Router search completed and toolSearch contains discovery evidence; observed=false means preflight failed and the included error/status/details are the observed evidence.",
  "Discovery is not completion. When observed=true, you MUST use nova-services composio-execute with the relevant returned tool slug or slugs and inspect the real execution result before answering the user.",
  "For read requests such as new messages, team memberships, groups, channels, unread items, or counts, execute the necessary read-only tools and compute the answer only from observed results.",
  "If execution reports a disconnected account, use nova-services composio-connect with a toolkit slug supported by the discovery evidence and return the real Connect Link.",
  "Do not answer with generic manual instructions or say you cannot directly access the app unless the preflight evidence or a subsequent real execution contains a concrete failure.",
].join(" ");

export function connectedAppIntentForText(text: string): ConnectedAppIntent | null {
  const normalized = String(text || "").trim();
  if (!normalized) return null;
  for (const rule of CONNECTED_APP_RULES) {
    if (rule.pattern.test(normalized)) return rule.intent;
  }
  return null;
}

async function getConnectedAppEvidenceForText(text: string): Promise<string> {
  const intent = connectedAppIntentForText(text);
  if (!intent) return "";

  try {
    const session = await ensureComposioSession();
    const searchResult = await composioRequest<unknown>(
      session.apiKey,
      `/tool_router/session/${encodeURIComponent(session.sessionId)}/search`,
      {
        method: "POST",
        body: JSON.stringify({
          queries: [
            {
              use_case: `Use ${intent.app} to satisfy this exact user request: ${text}`,
            },
          ],
        }),
      },
    );

    return JSON.stringify(
      {
        observed: true,
        app: intent.app,
        toolkitHints: intent.toolkitHints,
        credentialSource: session.credentialSource,
        projectId: session.projectId || null,
        userId: session.userId,
        toolSearch: searchResult,
      },
      null,
      2,
    );
  } catch (error) {
    return JSON.stringify(
      {
        observed: false,
        app: intent.app,
        toolkitHints: intent.toolkitHints,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof ComposioApiError
          ? { upstreamStatus: error.status, details: error.details }
          : {}),
      },
      null,
      2,
    );
  }
}

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

  // Stable user identity sent by the Nova client as X-Nova-User-Id.
  // Scoping the conversationKey to the userId means history from one user
  // never bleeds into another and history can be queried by userId prefix.
  const rawUserId = String(req.headers["x-nova-user-id"] ?? "").trim().slice(0, 64);
  const userId = /^[a-zA-Z0-9_-]+$/.test(rawUserId) ? rawUserId : "";

  const baseKey = conversationKeyFor(messages) ?? "nova-chat-default";
  const conversationKey = userId ? `${userId}:${baseKey}` : baseKey;

  const userText = lastUserText(messages);
  const stream = incoming.stream !== false;

  const [githubEvidence, connectedAppEvidence] = await Promise.all([
    getGitHubEvidenceForText(userText).catch((error) => {
      req.log.warn({ err: error }, "GitHub repository preflight failed");
      return "";
    }),
    getConnectedAppEvidenceForText(userText),
  ]);

  const forwardedMessages: ChatMessage[] = [
    { role: "system", content: TOOL_SYSTEM_PROMPT },
    ...(githubEvidence
      ? [
          {
            role: "system",
            content: `${GITHUB_EVIDENCE_HEADER}\n\n${githubEvidence}`,
          } as ChatMessage,
        ]
      : []),
    ...(connectedAppEvidence
      ? [
          {
            role: "system",
            content: `${CONNECTED_APP_EVIDENCE_HEADER}\n\n${connectedAppEvidence}`,
          } as ChatMessage,
        ]
      : []),
    ...messages,
  ];

  // Build the forwarded body and apply the model's agentic tuning (output
  // cap, sampler, thinking mode). Same registry as openai-proxy uses so
  // every kimi-k2.6 call in the system gets the same treatment — whether
  // it originates from the browser chat, the work-tree worker, or any
  // future client. Caller can override any field explicitly.
  const body: Record<string, unknown> = {
    ...incoming,
    model: OPENCLAW_AGENT_MODEL,
    stream,
    user: `nova-chat:${conversationKey}`,
    messages: forwardedMessages,
  };
  const tuning = getModelTuning(OPENCLAW_AGENT_MODEL);
  if (tuning) {
    if (body.max_tokens == null) body.max_tokens = tuning.maxTokens;
    if (body.temperature == null) body.temperature = tuning.temperature;
    if (body.top_p == null) body.top_p = tuning.topP;
    if (tuning.thinking.type !== "disabled") {
      const extra = (body.extra_body && typeof body.extra_body === "object"
        ? body.extra_body as Record<string, unknown>
        : {});
      if (extra.thinking == null) {
        extra.thinking = { type: tuning.thinking.type, keep: tuning.thinking.keep };
        body.extra_body = extra;
      }
    }
  }

  // Track whether the client (browser tab) is still connected. If the user
  // closes the tab or navigates away, `req.on("close")` fires and we abort
  // the upstream OpenClaw fetch so the model stops generating. Without
  // this, every tab close leaves the model running to completion in the
  // background and bills tokens for a response nobody is listening for.
  // The OpenClaw-side abort also stops the underlying tool loop cleanly.
  let clientClosed = false;
  const clientCloseController = new AbortController();
  req.on("close", () => {
    if (!res.writableEnded) {
      clientClosed = true;
      clientCloseController.abort();
    }
  });

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
      // Abort the upstream call if the browser tab closes. `clientCloseController`
      // is signalled by the req.on("close") handler above. Combined with the
      // OpenClaw-side abort this stops the model + tool loop immediately when
      // the user closes the app, so we never bill tokens for a response that
      // nobody is listening for.
      signal: clientCloseController.signal,
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
      // If the browser tab closed mid-stream, stop the upstream read
      // immediately. The signal propagates into the upstream fetch and
      // cancels the model + tool loop on the gateway side too. We still
      // end `res` so Express doesn't log a half-written response.
      if (clientClosed) {
        try { await reader.cancel(); } catch (_) { /* already closed */ }
        req.log.info({ conversationKey }, "agent chat: client closed, upstream cancelled");
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (upstream.ok && value) {
        sseBuffer += decoder.decode(value, { stream: true });
        const parsed = extractDeltas(sseBuffer);
        assistantText += parsed.text;
        sseBuffer = parsed.rest;
      }
      if (!clientClosed) {
        const writable = res.write(value);
        if (!writable) await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
    res.end();

    // If the user closed the tab mid-stream, persist whatever partial
    // assistant text the model had already produced so reloading the app
    // (or opening a different tab) shows the conversation in the
    // history. Without this the user loses everything they typed in that
    // session because recordTurn was previously only called on a
    // successful end-of-stream.
    if (clientClosed && assistantText.trim()) {
      void recordTurn({
        conversationKey,
        userText,
        assistantText: assistantText + "\n\n_⏹ stopped when tab closed_",
        model: OPENCLAW_AGENT_MODEL,
      }).catch((error) => req.log.warn({ err: error }, "agent chat recordTurn after client close failed"));
    }

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
  } finally {
    // Make sure we always release the clientCloseController so the GC
    // can collect the listener; even on success the req.on("close")
    // registration stays live until the request object is freed.
    if (!clientClosed && res.writableEnded) {
      clientCloseController.abort();
    }
  }
});

export default router;
