import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  ComposioApiError,
  composioRequest,
  ensureComposioSession,
  getComposioConfig,
} from "../lib/composio";

const router = Router();

const toolkitSlug = z.string().trim().min(1).max(100).regex(/^[a-z0-9_-]+$/i);
const connectSchema = z.object({ toolkit: toolkitSlug });
const searchSchema = z.object({ query: z.string().trim().min(3).max(1000) });
const executeSchema = z.object({
  toolSlug: z.string().trim().min(3).max(200),
  arguments: z.record(z.string(), z.unknown()).default({}),
  account: z.string().trim().min(1).max(200).optional(),
});

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function executionSucceeded(data: unknown): boolean {
  const root = record(data);
  if (!root) return true;

  for (const key of ["successful", "success", "ok"]) {
    if (root[key] === false) return false;
  }
  if (root.error != null && root.error !== "") return false;
  const status = String(root.status || root.state || "").toLowerCase();
  if (["failed", "error", "cancelled", "canceled"].includes(status)) return false;

  for (const key of ["data", "result", "response", "response_data", "output"]) {
    const nested = record(root[key]);
    if (nested && !executionSucceeded(nested)) return false;
  }
  return true;
}

function findIdentifier(value: unknown, keys: string[], depth = 0): string {
  if (depth > 6) return "";
  const root = record(value);
  if (!root) return "";

  for (const key of keys) {
    const candidate = root[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  for (const key of ["data", "result", "response", "response_data", "output", "details"]) {
    const found = findIdentifier(root[key], keys, depth + 1);
    if (found) return found;
  }
  return "";
}

function normalizeInstagramExecution(
  toolSlug: string,
  args: JsonRecord,
): { toolSlug: string; arguments: JsonRecord } {
  const normalized = { ...args };

  if (toolSlug === "INSTAGRAM_PUBLISH_MEDIA_CONTAINER") {
    return { toolSlug: "INSTAGRAM_CREATE_POST", arguments: normalized };
  }

  const legacyCreateType: Record<string, { contentType: string; mediaType?: string }> = {
    INSTAGRAM_CREATE_PHOTO_MEDIA_CONTAINER: { contentType: "photo" },
    INSTAGRAM_CREATE_REELS_MEDIA_CONTAINER: { contentType: "reel", mediaType: "REELS" },
    INSTAGRAM_CREATE_STORIES_MEDIA_CONTAINER: {
      contentType: typeof normalized.video_url === "string" && normalized.video_url
        ? "video"
        : "photo",
      mediaType: "STORIES",
    },
  };

  const legacy = legacyCreateType[toolSlug];
  if (legacy) {
    normalized.content_type = legacy.contentType;
    if (legacy.mediaType) normalized.media_type = legacy.mediaType;
    if (normalized.media_type === "IMAGE") delete normalized.media_type;
    return { toolSlug: "INSTAGRAM_CREATE_MEDIA_CONTAINER", arguments: normalized };
  }

  if (toolSlug === "INSTAGRAM_CREATE_MEDIA_CONTAINER") {
    if (!normalized.content_type) {
      normalized.content_type = typeof normalized.video_url === "string" && normalized.video_url
        ? normalized.media_type === "REELS" ? "reel" : "video"
        : "photo";
    }
    if (normalized.media_type === "IMAGE") delete normalized.media_type;
  }

  return { toolSlug, arguments: normalized };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ComposioApiError) {
    const status = error.status === 401 || error.status === 403 ? 502 : error.status;
    res.status(status >= 400 && status < 600 ? status : 502).json({
      error: error.message,
      upstreamStatus: error.status,
      details: error.details,
    });
    return;
  }
  res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
}

function publicBaseUrl(req: Request): string {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0]?.trim();
  const protocol = forwarded === "https" || forwarded === "http" ? forwarded : req.protocol;
  return `${protocol}://${req.get("host")}`;
}

router.get("/integrations/composio/status", async (_req, res) => {
  const config = await getComposioConfig();
  if (!config.configured) {
    res.json({
      configured: false,
      ready: false,
      credentialState: "missing",
      userId: config.userId,
      sessionId: null,
      connected: [],
    });
    return;
  }

  try {
    const session = await ensureComposioSession();
    const query = new URLSearchParams({ limit: "50", is_connected: "true" });
    const data = await composioRequest<{ items?: unknown[] }>(
      session.apiKey,
      `/tool_router/session/${encodeURIComponent(session.sessionId)}/toolkits?${query}`,
    );

    res.json({
      configured: true,
      ready: true,
      credentialState: "ready",
      credentialSource: session.credentialSource,
      projectId: session.projectId || config.projectId || null,
      userId: session.userId,
      sessionId: session.sessionId,
      connected: Array.isArray(data.items) ? data.items : [],
    });
  } catch (error) {
    if (error instanceof ComposioApiError) {
      const invalid = error.status === 401 || error.status === 403;
      const needsProject = error.status === 409;
      res.json({
        configured: true,
        ready: false,
        credentialState: invalid ? "invalid" : needsProject ? "needs_project" : "error",
        userId: config.userId,
        sessionId: null,
        connected: [],
        upstreamStatus: error.status,
        error: error.message,
      });
      return;
    }
    res.json({
      configured: true,
      ready: false,
      credentialState: "error",
      userId: config.userId,
      sessionId: null,
      connected: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get("/integrations/composio/toolkits", async (req, res) => {
  try {
    const session = await ensureComposioSession();
    const limit = Math.min(Math.max(Number(req.query.limit || 25) || 25, 1), 50);
    const query = new URLSearchParams({ limit: String(limit) });
    const search = String(req.query.search || "").trim();
    const cursor = String(req.query.cursor || "").trim();
    if (search) query.set("search", search.slice(0, 200));
    if (cursor) query.set("cursor", cursor.slice(0, 500));

    const data = await composioRequest<unknown>(
      session.apiKey,
      `/tool_router/session/${encodeURIComponent(session.sessionId)}/toolkits?${query}`,
    );
    res.json(data);
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/integrations/composio/connections", async (_req, res) => {
  try {
    const session = await ensureComposioSession();
    const query = new URLSearchParams({
      user_ids: session.userId,
      limit: "100",
      account_type: "ALL",
    });
    const data = await composioRequest<unknown>(
      session.apiKey,
      `/connected_accounts?${query}`,
    );
    res.json(data);
  } catch (error) {
    sendError(res, error);
  }
});

// Authoritative per-toolkit health: the live status of every connected account
// as reported by /connected_accounts (source of truth) — NOT the toolkits list
// which can be stale or scoped to a different project. Returns
// { configured, toolkits: { [slug]: { status, statusReason, id, isHealthy } } }.
router.get("/integrations/composio/health", async (_req, res) => {
  const config = await getComposioConfig();
  if (!config.configured) {
    res.json({ configured: false, ready: false, toolkits: {} });
    return;
  }

  try {
    const session = await ensureComposioSession();
    const query = new URLSearchParams({
      user_ids: session.userId,
      limit: "100",
      account_type: "ALL",
    });
    const data = await composioRequest<{ items?: unknown[] }>(
      session.apiKey,
      `/connected_accounts?${query}`,
    );

    const toolkits: Record<string, { status: string; statusReason: string; id: string | null; isHealthy: boolean; toolkitName: string | null }> = {};
    for (const item of data.items || []) {
      const rec = record(item);
      if (!rec) continue;
      const tk = record(rec.toolkit) || record(record(rec.connected_account)?.toolkit);
      const slug = String(tk?.slug || rec.toolkit_slug || "").toLowerCase();
      if (!slug) continue;
      const status = String(rec.status || "").toUpperCase();
      const stateRec = record(rec.state);
      const stateVal = stateRec ? record(stateRec.val) : null;
      const statusReason = String(
        rec.status_reason || stateVal?.status_reason || "",
      );
      const isHealthy = status === "ACTIVE" || status === "CONNECTED";
      // If a slug has multiple accounts, the MOST RECENT wins (Composio returns
      // them ordered by created_at desc), so this loops in the right order.
      if (toolkits[slug] && toolkits[slug].isHealthy) continue;
      toolkits[slug] = {
        status: status || "UNKNOWN",
        statusReason,
        id: typeof rec.id === "string" ? rec.id : null,
        isHealthy,
        toolkitName: typeof tk?.name === "string" ? tk.name : null,
      };
    }

    res.json({ configured: true, ready: true, toolkits });
  } catch (error) {
    if (error instanceof ComposioApiError) {
      res.json({
        configured: true,
        ready: false,
        toolkits: {},
        upstreamStatus: error.status,
        error: error.message,
      });
      return;
    }
    res.json({
      configured: true,
      ready: false,
      toolkits: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/integrations/composio/connect", async (req, res) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid toolkit", details: parsed.error.issues });
    return;
  }

  try {
    const session = await ensureComposioSession();
    const callback = new URL(publicBaseUrl(req));
    callback.searchParams.set("composio", "connected");
    callback.searchParams.set("toolkit", parsed.data.toolkit.toLowerCase());
    callback.hash = "settings";

    const data = await composioRequest<{
      redirect_url?: string;
      connected_account_id?: string;
      link_token?: string;
    }>(
      session.apiKey,
      `/tool_router/session/${encodeURIComponent(session.sessionId)}/link`,
      {
        method: "POST",
        body: JSON.stringify({
          toolkit: parsed.data.toolkit.toLowerCase(),
          callback_url: callback.toString(),
        }),
      },
    );

    const redirectUrl = String(data.redirect_url || "").trim();
    if (!redirectUrl) {
      throw new ComposioApiError("Composio did not return a Connect Link", 502, data);
    }
    res.status(201).json({
      redirectUrl,
      connectedAccountId: data.connected_account_id || null,
      linkToken: data.link_token || null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/integrations/composio/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid search query", details: parsed.error.issues });
    return;
  }

  try {
    const session = await ensureComposioSession();
    const data = await composioRequest<unknown>(
      session.apiKey,
      `/tool_router/session/${encodeURIComponent(session.sessionId)}/search`,
      {
        method: "POST",
        body: JSON.stringify({ queries: [{ use_case: parsed.data.query }] }),
      },
    );
    res.json(data);
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/integrations/composio/execute", async (req, res) => {
  const parsed = executeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid execution request", details: parsed.error.issues });
    return;
  }

  try {
    const session = await ensureComposioSession();
    const normalized = normalizeInstagramExecution(
      parsed.data.toolSlug,
      parsed.data.arguments,
    );
    const data = await composioRequest<unknown>(
      session.apiKey,
      `/tool_router/session/${encodeURIComponent(session.sessionId)}/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          tool_slug: normalized.toolSlug,
          arguments: normalized.arguments,
          ...(parsed.data.account ? { account: parsed.data.account } : {}),
        }),
      },
    );

    if (!executionSucceeded(data)) {
      res.status(502).json({
        error: `Composio tool ${normalized.toolSlug} reported failure`,
        details: data,
      });
      return;
    }

    if (normalized.toolSlug === "INSTAGRAM_CREATE_MEDIA_CONTAINER") {
      const creationId = findIdentifier(
        data,
        ["creation_id", "creationId", "container_id", "containerId", "id"],
      );
      if (!creationId) {
        res.status(502).json({
          error: "Instagram container creation returned no creation ID",
          details: data,
        });
        return;
      }
    }

    if (normalized.toolSlug === "INSTAGRAM_CREATE_POST") {
      const mediaId = findIdentifier(
        data,
        ["media_id", "mediaId", "post_id", "postId", "id"],
      );
      if (!mediaId) {
        res.status(502).json({
          error: "Instagram publish returned no media ID",
          details: data,
        });
        return;
      }
    }

    res.json(data);
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
