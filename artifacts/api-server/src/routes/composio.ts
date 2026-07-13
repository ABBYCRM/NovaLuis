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
  try {
    const config = await getComposioConfig();
    if (!config.configured) {
      res.json({
        configured: false,
        userId: config.userId,
        sessionId: null,
        connected: [],
      });
      return;
    }

    const session = await ensureComposioSession();
    const query = new URLSearchParams({ limit: "50", is_connected: "true" });
    const data = await composioRequest<{ items?: unknown[] }>(
      session.apiKey,
      `/tool_router/session/${encodeURIComponent(session.sessionId)}/toolkits?${query}`,
    );

    res.json({
      configured: true,
      userId: session.userId,
      sessionId: session.sessionId,
      connected: Array.isArray(data.items) ? data.items : [],
    });
  } catch (error) {
    sendError(res, error);
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
    const data = await composioRequest<unknown>(
      session.apiKey,
      `/tool_router/session/${encodeURIComponent(session.sessionId)}/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          tool_slug: parsed.data.toolSlug,
          arguments: parsed.data.arguments,
          ...(parsed.data.account ? { account: parsed.data.account } : {}),
        }),
      },
    );
    res.json(data);
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
