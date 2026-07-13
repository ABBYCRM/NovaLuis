import { getCredentials, setCredentials } from "./integrations";

const COMPOSIO_BASE = "https://backend.composio.dev/api/v3.1";
const DEFAULT_USER_ID = "nova-luis";

export class ComposioApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status = 502, details?: unknown) {
    super(message);
    this.name = "ComposioApiError";
    this.status = status;
    this.details = details;
  }
}

export interface ComposioConfig {
  apiKey: string;
  userId: string;
  storedSessionId: string;
  configured: boolean;
}

export interface ComposioSession {
  sessionId: string;
  apiKey: string;
  userId: string;
}

let processSessionId = "";

export async function getComposioConfig(): Promise<ComposioConfig> {
  const stored = await getCredentials("composio");
  const apiKey = (process.env.COMPOSIO_API_KEY || stored.api_key || "").trim();
  const userId = (process.env.COMPOSIO_USER_ID || stored.user_id || DEFAULT_USER_ID).trim();
  const storedSessionId = (stored.session_id || "").trim();
  return {
    apiKey,
    userId: userId || DEFAULT_USER_ID,
    storedSessionId,
    configured: Boolean(apiKey),
  };
}

function errorMessage(details: unknown): string {
  if (details && typeof details === "object") {
    const root = details as Record<string, unknown>;
    const nested = root.error;
    if (nested && typeof nested === "object") {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    if (typeof root.message === "string" && root.message.trim()) return root.message;
  }
  return "Composio request failed";
}

export async function composioRequest<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!apiKey) {
    throw new ComposioApiError(
      "Composio is not configured. Add COMPOSIO_API_KEY in Render or save a project API key in Settings.",
      503,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  timeout.unref?.();

  try {
    const response = await fetch(`${COMPOSIO_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
        ...(init.body == null ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let details: unknown = null;
    try {
      details = text ? JSON.parse(text) : null;
    } catch {
      details = text ? { raw: text } : null;
    }

    if (!response.ok) {
      throw new ComposioApiError(
        `${errorMessage(details)} (HTTP ${response.status})`,
        response.status,
        details,
      );
    }

    return details as T;
  } catch (error) {
    if (error instanceof ComposioApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ComposioApiError("Composio request timed out", 504);
    }
    throw new ComposioApiError(
      error instanceof Error ? error.message : String(error),
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function sessionExists(apiKey: string, sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  try {
    await composioRequest<unknown>(
      apiKey,
      `/tool_router/session/${encodeURIComponent(sessionId)}`,
    );
    return true;
  } catch (error) {
    if (error instanceof ComposioApiError && error.status === 404) return false;
    throw error;
  }
}

export async function ensureComposioSession(): Promise<ComposioSession> {
  const config = await getComposioConfig();
  if (!config.configured) {
    throw new ComposioApiError(
      "Composio is not configured. Add COMPOSIO_API_KEY in Render or save a project API key in Settings.",
      503,
    );
  }

  const candidate = processSessionId || config.storedSessionId;
  if (candidate && (await sessionExists(config.apiKey, candidate))) {
    processSessionId = candidate;
    return { sessionId: candidate, apiKey: config.apiKey, userId: config.userId };
  }

  const created = await composioRequest<{ session_id?: string }>(
    config.apiKey,
    "/tool_router/session",
    {
      method: "POST",
      body: JSON.stringify({ user_id: config.userId }),
    },
  );

  const sessionId = String(created.session_id || "").trim();
  if (!sessionId) {
    throw new ComposioApiError("Composio created a session without a session_id", 502, created);
  }

  processSessionId = sessionId;
  try {
    await setCredentials("composio", { session_id: sessionId });
  } catch {
    // Environment-only deployments can still keep the session in process memory.
  }

  return { sessionId, apiKey: config.apiKey, userId: config.userId };
}

export function clearComposioSessionCache(): void {
  processSessionId = "";
}
