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

// Custom agent backend (artifacts/agent/server.mjs). Replaces the OpenClaw
// gateway dependency for the main chat path. Same wire format, same
// OpenAI-compatible surface, same TOOL_SYSTEM_PROMPT + CONNECTED_APP_RULES.
//
// Routing is controlled by AGENT_BACKEND:
//   "openclaw"           → always use OpenClaw (legacy, default)
//   "custom"             → always use the custom agent
//   "split:<0..100>"     → percentage of NEW conversations routed to custom
//   "both"               → round-robin / parity mode for transition windows
//
// Custom-agent URL/port/token come from CUSTOM_AGENT_URL / CUSTOM_AGENT_TOKEN
// (default http://127.0.0.1:18790 with the shared OPENCLAW_GATEWAY_TOKEN so
// the existing start-openclaw.mjs token reuse works).
const AGENT_BACKEND = String(process.env.AGENT_BACKEND || "openclaw").toLowerCase();
const CUSTOM_AGENT_URL = (
  process.env.CUSTOM_AGENT_URL ||
  `http://127.0.0.1:${process.env.CUSTOM_AGENT_PORT || 18790}`
).replace(/\/$/, "");
const CUSTOM_AGENT_TOKEN =
  process.env.CUSTOM_AGENT_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || "";
const DEFAULT_CUSTOM_AGENT_MODEL = process.env.CUSTOM_AGENT_MODEL || "gpt-4o-mini";

function pickBackendForConversation(conversationKey: string): "openclaw" | "custom" {
  // The conversation key is the per-tab (per-session) id. Use a stable
  // hash so the same session always lands on the same backend — critical
  // for the split mode so a single chat doesn't bounce between backends
  // mid-conversation and produce inconsistent history.
  if (AGENT_BACKEND === "openclaw") return "openclaw";
  if (AGENT_BACKEND === "custom") return "custom";
  if (AGENT_BACKEND === "both") {
    // "both" = parity, alternate by conversation key parity
    let h = 0;
    for (let i = 0; i < conversationKey.length; i++) {
      h = (h * 31 + conversationKey.charCodeAt(i)) >>> 0;
    }
    return h % 2 === 0 ? "custom" : "openclaw";
  }
  if (AGENT_BACKEND.startsWith("split:")) {
    const pct = Math.max(0, Math.min(100, Number(AGENT_BACKEND.slice(6)) || 0));
    let h = 0;
    for (let i = 0; i < conversationKey.length; i++) {
      h = (h * 31 + conversationKey.charCodeAt(i)) >>> 0;
    }
    return h % 100 < pct ? "custom" : "openclaw";
  }
  return "openclaw";
}

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
  // Web search / travel / hotel / restaurant / local place lookup. When the
  // user asks for things like "find hotels near 33442" or "best pizza in NYC"
  // we MUST preflight a real web-search tool (yelp, tripadvisor, serpapi,
  // exa, tavily, etc.) instead of falling through to OpenClaw's generic
  // web_fetch — which can't render JS-only pages and surfaces a generic
  // "failed" message that the user rightly calls an internal error.
  //
  // IMPORTANT: order matters. The model picks the FIRST connected toolkit
  // from this list. tripadvisor and googlemaps default to BOOKING flows that
  // require check-in/check-out dates, so they go LAST. web-search-oriented
  // tools (yelp, serpapi, exa, etc.) come first so a "find hotels near X"
  // request returns a LIST, not a booking prompt.
  {
    pattern: /\bhotels?\b.*\bnear\b|\bnear\b.*\bhotels?\b|\bplaces?\s+to\s+stay\b|\bstay\s+near\b|\blist\s+hotels?\b/i,
    intent: {
      app: "Hotel & Travel Search",
      toolkitHints: [
        // Listing/lookup first — these work with just a location string.
        "yelp",
        "foursquare",
        "serpapi",
        "exa",
        "tavily_mcp",
        "composio_search",
        "linkup",
        "yousearch",
        "firecrawl",
        "bright_data",
        "news_api",
        // Booking/date-required tools last.
        "tripadvisor",
        "googlemaps",
      ],
    },
  },
  {
    pattern: /\brestaurants?\s+near\b|\bfood\s+near\b|\bwhere\s+to\s+eat\b|\bbest\s+(?:pizza|sushi|cafe|coffee|burger|ramen|tacos)\s+in\b/i,
    intent: {
      app: "Restaurant Search",
      toolkitHints: ["yelp", "tripadvisor", "foursquare", "googlemaps", "serpapi", "composio_search", "linkup", "yousearch"],
    },
  },
  {
    pattern: /\bsearch\s+(?:the\s+web|online|for)\b|\blook\s+up\b|\bfind\s+(?:out|information)\b|\bwhat\s+is\s+the\s+(?:weather|time|news|score|stock|price)\b/i,
    intent: {
      app: "Web Search",
      toolkitHints: ["serpapi", "exa", "tavily_mcp", "composio_search", "linkup", "yousearch", "google_search_console", "firecrawl", "bright_data", "news_api", "fireflies"],
    },
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
  "For hotel, travel, restaurant, local place, weather, news, and generic web-search requests (e.g. 'find hotels near 33442', 'best pizza in NYC', 'what's the weather in Tokyo'), the CONNECTED_APP_PREFLIGHT_EVIDENCE will include the toolkitHints the server discovered for that request. Pick the FIRST connected toolkit from toolkitHints and use it with nova-services composio-execute. If no connected toolkit is available for the request, say precisely which toolkits would be needed and ask the user to connect one \u2014 do NOT fall through to OpenClaw's generic web_fetch and surface a generic internal error.",
  "Interpret these requests as LOOKUPS, not bookings. 'find hotels near X' / 'best pizza in Y' means return a LIST of options with name, rating, address, and price range \u2014 NOT a reservation flow. If the only available toolkit insists on check-in/check-out dates (e.g. tripadvisor, googlemaps booking), skip it and try the next toolkit in toolkitHints (yelp, serpapi, exa, tavily, firecrawl, etc.). Only ask the user for dates if they explicitly said 'book' or 'reserve'. A bare 'find hotels near X' is a list request, full stop.",
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
  // Only enforce the openclaw token gate when at least one conversation
  // could still be routed to the openclaw backend. If AGENT_BACKEND is
  // "custom" 100% and CUSTOM_AGENT_TOKEN is set, we don't need the
  // openclaw token to answer chats.
  const needsOpenclawToken = AGENT_BACKEND !== "custom";
  if (needsOpenclawToken && !OPENCLAW_GATEWAY_TOKEN) {
    res.status(503).json({ error: "OpenClaw Gateway token is not configured" });
    return;
  }
  if (AGENT_BACKEND === "custom" && !CUSTOM_AGENT_TOKEN) {
    res.status(503).json({ error: "Custom agent token is not configured" });
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
  // Capture the original model id BEFORE the body initializer overwrites
  // it with OPENCLAW_AGENT_MODEL. We need the user's actual model choice
  // to decide whether the custom-agent path should rewrite to a default.
  const originalModel = String(incoming.model || "").trim().toLowerCase();

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
  let body: Record<string, unknown> = {
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

  // Pick the backend for this conversation. The decision is stable per
  // session so a chat doesn't bounce between backends mid-turn. In split
  // mode, the conversationKey hash decides which side handles the request.
  const backend = pickBackendForConversation(conversationKey);
  const upstreamUrl =
    backend === "custom"
      ? `${CUSTOM_AGENT_URL}/v1/chat/completions`
      : `${OPENCLAW_GATEWAY_URL}/v1/chat/completions`;
  // When routing to the custom agent, conditionally rewrite the model
  // id. The browser chat UI historically sent "kimi-k2.6" or
  // "openclaw/default" because OpenClaw accepted those. The custom
  // agent's upstream may be api.openai.com (which rejects kimi-*) so
  // those two model ids need to be rewritten to CUSTOM_AGENT_MODEL.
  // Any other model id (e.g. "gpt-4o-mini", "z-ai/glm-5.2",
  // "deepseek-ai/deepseek-v4-pro") is passed through unchanged so the
  // custom agent's upstream router can pick the right provider.
  //
  // We use `originalModel` (captured before the body initializer
  // overwrote it with OPENCLAW_AGENT_MODEL) so we see what the user
  // actually requested, not the post-init kimi-k2.6 placeholder.
  if (backend === "custom") {
    const customModel = process.env.CUSTOM_AGENT_MODEL || DEFAULT_CUSTOM_AGENT_MODEL;
    if (
      !originalModel ||
      originalModel === "openclaw/default" ||
      originalModel.startsWith("kimi") ||
      originalModel.startsWith("moonshot")
    ) {
      body = { ...body, model: customModel };
    }
  }
  const upstreamAuth =
    backend === "custom" ? CUSTOM_AGENT_TOKEN : OPENCLAW_GATEWAY_TOKEN;
  const upstreamHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: (req.headers.accept as string) ?? "text/event-stream, application/json",
    Authorization: `Bearer ${upstreamAuth}`,
  };
  if (backend === "openclaw") {
    upstreamHeaders["x-openclaw-session-key"] = `nova-chat-${conversationKey}`;
    upstreamHeaders["x-openclaw-message-channel"] = "webchat";
  } else {
    upstreamHeaders["x-nova-agent-backend"] = "custom";
    upstreamHeaders["x-nova-conversation-key"] = conversationKey;
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
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

    // Persist the assistant turn. The two earlier call sites (one for
    // client-close, one for clean-completion) had a bug where both would
    // run when a partial response was streamed before the tab closed,
    // inserting TWO rows for the same user message and doubling the
    // history on reload. Fix: a single recordTurn call with the correct
    // assistant text (suffix "⏹ stopped" only when the tab was actually
    // closed mid-stream).
    if (assistantText.trim()) {
      const textToSave = clientClosed
        ? assistantText + "\n\n_⏹ stopped when tab closed_"
        : assistantText;
      void recordTurn({
        conversationKey,
        userText,
        assistantText: textToSave,
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
