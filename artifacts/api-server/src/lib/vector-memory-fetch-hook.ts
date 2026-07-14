import {
  formatVectorMemoryContext,
  inferRuntimePhase,
  ingestVectorMemory,
  retrieveVectorMemory,
} from "./vector-memory";

const ORIGINAL_FETCH = globalThis.fetch.bind(globalThis);
const CONTEXT_MARKER = "NOVA_VECTOR_MEMORY_CONTEXT";
const REPOSITORY_SCOPE = process.env.RENDER_GIT_REPO_SLUG || "ABBYCRM/NovaLuis";
type FetchInput = Parameters<typeof globalThis.fetch>[0];

const gatewayOrigins = new Set(
  [
    process.env.NOVA_AGENT_CHAT_GATEWAY_URL,
    process.env.OPENCLAW_GATEWAY_URL,
    "http://127.0.0.1:18789",
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\/$/, "")),
);

interface GatewayMessage {
  role?: unknown;
  content?: unknown;
}

interface GatewayBody {
  messages?: GatewayMessage[];
  stream?: unknown;
  user?: unknown;
  [key: string]: unknown;
}

function requestUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isOpenClawChat(url: string): boolean {
  return [...gatewayOrigins].some((origin) => url === `${origin}/v1/chat/completions`);
}

function stringHeader(headers: Headers, name: string): string {
  return String(headers.get(name) || "").trim();
}

function lastUserText(messages: GatewayMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "user" && typeof message.content === "string") return message.content.trim();
  }
  return "";
}

function hasInjectedContext(messages: GatewayMessage[]): boolean {
  return messages.some(
    (message) =>
      message?.role === "system" &&
      typeof message.content === "string" &&
      message.content.includes(CONTEXT_MARKER),
  );
}

function missionIdFromSession(sessionKey: string): string | undefined {
  const match = /^nova-work-tree-(\d+)$/.exec(sessionKey);
  return match?.[1];
}

function insertSystemContext(messages: GatewayMessage[], context: string): GatewayMessage[] {
  const next = [...messages];
  const firstNonSystem = next.findIndex((message) => message.role !== "system");
  const at = firstNonSystem === -1 ? next.length : firstNonSystem;
  next.splice(at, 0, {
    role: "system",
    content: [
      CONTEXT_MARKER,
      "The following runtime memories were retrieved by NOVA before this OpenClaw turn.",
      "Treat verification labels literally: verified/observed evidence outranks inferred or claimed text.",
      "Failure memories describe prior failed attempts and should prevent blind repetition when state has not changed.",
      "Do not claim a memory is current when its content or verification does not establish that.",
      "Use relevant memories as context, then verify the current mission with real tools.",
      "",
      context,
    ].join("\n"),
  });
  return next;
}

async function captureDispatchInput(
  userText: string,
  sessionKey: string,
  missionId: string | undefined,
): Promise<void> {
  if (!userText) return;
  await ingestVectorMemory({
    content: missionId ? `Work Tree mission ${missionId}: ${userText}` : `Observed user request: ${userText}`,
    memoryType: missionId ? "operational" : "episodic",
    scope: missionId ? "mission" : "session",
    scopeKey: (missionId ?? sessionKey) || "nova-chat",
    missionId: missionId ?? null,
    source: "openclaw-dispatch",
    verification: "observed",
    confidence: 1,
    importance: missionId ? 0.9 : 0.55,
    salience: missionId ? 0.9 : 0.5,
    metadata: {
      event: "dispatch-input",
      repository: REPOSITORY_SCOPE,
      sessionKey,
    },
  });
}

async function captureNonStreamingOutcome(
  response: Response,
  userText: string,
  sessionKey: string,
  missionId: string | undefined,
): Promise<void> {
  if (!missionId) return;
  if (!response.ok) {
    const details = await response.clone().text().catch(() => "");
    await ingestVectorMemory({
      content: `Work Tree mission ${missionId} OpenClaw dispatch failed with HTTP ${response.status}. ${details.slice(0, 4000)}`,
      memoryType: "failure",
      scope: "mission",
      scopeKey: missionId,
      missionId,
      source: "openclaw-dispatch",
      verification: "observed",
      confidence: 1,
      importance: 0.95,
      salience: 1,
      metadata: { event: "gateway-http-failure", status: response.status, sessionKey },
    });
    return;
  }

  const payload = await response.clone().json().catch(() => null) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;
  const raw = payload?.choices?.[0]?.message?.content;
  const content = typeof raw === "string" ? raw.trim() : raw == null ? "" : JSON.stringify(raw);
  if (!content) return;

  await ingestVectorMemory({
    content: `Work Tree mission ${missionId} response for goal: ${userText}\n\nOpenClaw final payload:\n${content.slice(0, 30000)}`,
    memoryType: "episodic",
    scope: "mission",
    scopeKey: missionId,
    missionId,
    source: "openclaw-dispatch",
    // A returned model payload is observed as a payload, but its substantive
    // claims are not automatically promoted to verified evidence.
    verification: "claimed",
    confidence: 0.6,
    importance: 0.75,
    salience: 0.75,
    metadata: { event: "gateway-final-payload", httpStatus: response.status, sessionKey },
  });
}

export function installVectorMemoryFetchHook(): void {
  if ((globalThis as typeof globalThis & { __novaVectorMemoryFetchHook?: boolean }).__novaVectorMemoryFetchHook) return;
  (globalThis as typeof globalThis & { __novaVectorMemoryFetchHook?: boolean }).__novaVectorMemoryFetchHook = true;

  globalThis.fetch = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (!isOpenClawChat(url) || typeof init?.body !== "string") {
      return ORIGINAL_FETCH(input, init);
    }

    let parsed: GatewayBody;
    try {
      parsed = JSON.parse(init.body) as GatewayBody;
    } catch {
      return ORIGINAL_FETCH(input, init);
    }
    if (!Array.isArray(parsed.messages) || hasInjectedContext(parsed.messages)) {
      return ORIGINAL_FETCH(input, init);
    }

    const userText = lastUserText(parsed.messages);
    if (!userText) return ORIGINAL_FETCH(input, init);

    const headers = new Headers(init.headers);
    const sessionKey = stringHeader(headers, "x-openclaw-session-key") || String(parsed.user ?? "nova-session");
    const missionId = missionIdFromSession(sessionKey);

    try {
      const hits = await retrieveVectorMemory(userText, {
        limit: missionId ? 10 : 8,
        missionId,
        scopeKey: REPOSITORY_SCOPE,
        phase: inferRuntimePhase(userText),
        minimumScore: 0.25,
      });
      const context = formatVectorMemoryContext(hits);
      if (context) parsed.messages = insertSystemContext(parsed.messages, context);
      void captureDispatchInput(userText, sessionKey, missionId).catch(() => undefined);
    } catch {
      // Memory is an enhancement, never a reason to make OpenClaw unavailable.
    }

    const response = await ORIGINAL_FETCH(input, { ...init, body: JSON.stringify(parsed) });
    if (parsed.stream === false) {
      void captureNonStreamingOutcome(response, userText, sessionKey, missionId).catch(() => undefined);
    }
    return response;
  };
}

installVectorMemoryFetchHook();
