import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { requireOperatorSession } from "../lib/operator-session";

const router = Router();
const TOKEN_AUDIENCE = "fluidvoice";
const TOKEN_VERSION = 2;
const DEFAULT_TOKEN_TTL_DAYS = 90;
const MAX_TOKEN_TTL_DAYS = 365;
const MIN_SHORT_TOKEN_TTL_MINUTES = 5;
const MAX_SHORT_TOKEN_TTL_MINUTES = 60;
const DEFAULT_MODEL = "poolside/laguna-xs-2.1";
const SSE_HEARTBEAT_MS = 10_000;

interface FluidVoiceTokenPayload {
  v: number;
  aud: string;
  deviceId: string;
  deviceName: string;
  iat: number;
  exp: number;
  nonce: string;
}

interface FluidVoiceRequest extends Request {
  fluidVoiceDevice?: FluidVoiceTokenPayload;
}

interface FluidVoicePairBody {
  deviceName?: unknown;
  ttlDays?: unknown;
  /** Short-lived automation/verifier credential. The public setup UI uses ttlDays. */
  ttlMinutes?: unknown;
}

function baseSigningSecret(): string {
  return String(process.env.SESSION_SECRET || process.env.NOVA_API_TOKEN || "").trim();
}

function fluidVoiceSigningSecret(): string {
  const secret = baseSigningSecret();
  if (!secret) return "";
  return createHmac("sha256", secret)
    .update("nova-fluidvoice-device-token:v2")
    .digest("hex");
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function encodeToken(payload: FluidVoiceTokenPayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

function decodeToken(token: string, secret: string): FluidVoiceTokenPayload | null {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;

  const encodedPayload = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  const expectedSignature = signPayload(encodedPayload, secret);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as FluidVoiceTokenPayload;
    if (
      payload.v !== TOKEN_VERSION ||
      payload.aud !== TOKEN_AUDIENCE ||
      !payload.deviceId ||
      !payload.deviceName ||
      !Number.isFinite(payload.iat) ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function bearerToken(req: Request): string {
  const authorization = String(req.headers.authorization || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function requireFluidVoiceToken(
  req: FluidVoiceRequest,
  res: Response,
  next: NextFunction,
): void {
  const secret = fluidVoiceSigningSecret();
  if (!secret) {
    res.status(503).json({
      error: "FluidVoice pairing is not configured",
      requiredEnv: "SESSION_SECRET or NOVA_API_TOKEN",
    });
    return;
  }

  const payload = decodeToken(bearerToken(req), secret);
  if (!payload) {
    res.status(401).json({ error: "valid FluidVoice device token required" });
    return;
  }

  req.fluidVoiceDevice = payload;
  next();
}

function sanitizeDeviceName(value: unknown): string {
  const normalized = String(value || "FluidVoice Mac")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "FluidVoice Mac").slice(0, 80);
}

function publicBaseUrl(req: Request): string {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function tokenTtlMs(body: FluidVoicePairBody): number {
  const requestedMinutes = Number(body.ttlMinutes);
  if (Number.isFinite(requestedMinutes) && requestedMinutes > 0) {
    const minutes = Math.max(
      MIN_SHORT_TOKEN_TTL_MINUTES,
      Math.min(MAX_SHORT_TOKEN_TTL_MINUTES, Math.floor(requestedMinutes)),
    );
    return minutes * 60 * 1000;
  }

  const requestedDays = Number(body.ttlDays);
  const days = Number.isFinite(requestedDays)
    ? Math.max(1, Math.min(MAX_TOKEN_TTL_DAYS, Math.floor(requestedDays)))
    : DEFAULT_TOKEN_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

function openSse(res: Response): NodeJS.Timeout {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Nova-Agent-Backend", "openclaw");
  res.setHeader("X-Nova-Model", process.env.OPENCLAW_AGENT_MODEL || DEFAULT_MODEL);
  res.flushHeaders();
  // SSE comments are ignored by OpenAI-compatible clients but force the public
  // edge to establish and retain the response while OpenClaw is still planning.
  res.write(": nova-fluidvoice-openclaw\n\n");
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();
  return heartbeat;
}

function writeSseError(res: Response, status: number, message: string): void {
  if (res.writableEnded || res.destroyed) return;
  const payload = JSON.stringify({
    error: {
      message,
      type: "nova_fluidvoice_upstream_error",
      status,
    },
  });
  res.write(`event: error\ndata: ${payload}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

router.post("/fluidvoice/pair", requireOperatorSession, (req, res) => {
  const secret = fluidVoiceSigningSecret();
  if (!secret) {
    res.status(503).json({
      error: "FluidVoice pairing is not configured",
      requiredEnv: "SESSION_SECRET or NOVA_API_TOKEN",
    });
    return;
  }

  const pairBody: FluidVoicePairBody =
    req.body && typeof req.body === "object" ? req.body as FluidVoicePairBody : {};
  const now = Date.now();
  const deviceName = sanitizeDeviceName(pairBody.deviceName);
  const payload: FluidVoiceTokenPayload = {
    v: TOKEN_VERSION,
    aud: TOKEN_AUDIENCE,
    deviceId: randomBytes(16).toString("hex"),
    deviceName,
    iat: now,
    exp: now + tokenTtlMs(pairBody),
    nonce: randomBytes(16).toString("hex"),
  };
  const token = encodeToken(payload, secret);
  const baseUrl = publicBaseUrl(req);

  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    token,
    tokenVersion: TOKEN_VERSION,
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    expiresAt: new Date(payload.exp).toISOString(),
    provider: "NOVA OpenClaw",
    model: process.env.OPENCLAW_AGENT_MODEL || DEFAULT_MODEL,
    baseUrl: `${baseUrl}/api/fluidvoice/v1`,
    setupUrl: `${baseUrl}/fluidvoice`,
  });
});

router.get("/fluidvoice/status", requireFluidVoiceToken, (req: FluidVoiceRequest, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    tokenVersion: TOKEN_VERSION,
    backend: "openclaw",
    provider: "nvidia",
    model: process.env.OPENCLAW_AGENT_MODEL || DEFAULT_MODEL,
    device: req.fluidVoiceDevice
      ? {
          id: req.fluidVoiceDevice.deviceId,
          name: req.fluidVoiceDevice.deviceName,
          expiresAt: new Date(req.fluidVoiceDevice.exp).toISOString(),
        }
      : null,
  });
});

router.post(
  "/fluidvoice/v1/chat/completions",
  requireFluidVoiceToken,
  async (req: FluidVoiceRequest, res) => {
    const incoming = req.body as Record<string, unknown> | undefined;
    if (!incoming || !Array.isArray(incoming.messages)) {
      res.status(400).json({ error: "messages must be an array" });
      return;
    }

    const port = Number(process.env.PORT || 8080);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000);
    timeout.unref?.();
    // Track the response socket, not the already-consumed request body. This
    // prevents normal request completion from cancelling the agent call.
    res.on("close", () => controller.abort());

    const deviceId = req.fluidVoiceDevice?.deviceId || "unknown";
    const wantsStream = incoming.stream !== false;
    const body = {
      ...incoming,
      model: process.env.OPENCLAW_AGENT_MODEL || DEFAULT_MODEL,
      stream: wantsStream,
      user: `fluidvoice:${deviceId}`,
    };
    const heartbeat = wantsStream ? openSse(res) : null;

    try {
      const upstream = await fetch(
        `http://127.0.0.1:${port}/api/agent/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: wantsStream ? "text/event-stream" : "application/json",
            "x-nova-user-id": `fv-${deviceId}`,
            "x-nova-client": "fluidvoice",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
          duplex: "half",
        },
      );

      if (wantsStream) {
        if (!upstream.ok) {
          const details = (await upstream.text().catch(() => "")).slice(0, 300);
          writeSseError(
            res,
            upstream.status,
            details || `OpenClaw returned HTTP ${upstream.status}`,
          );
          return;
        }
        if (!upstream.body) {
          writeSseError(res, 502, "OpenClaw returned no streaming body");
          return;
        }

        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) {
            await new Promise<void>((resolve) => res.once("drain", resolve));
          }
        }
        res.end();
        return;
      }

      res.status(upstream.status);
      const blockedHeaders = new Set([
        "connection",
        "content-encoding",
        "content-length",
        "keep-alive",
        "transfer-encoding",
        "upgrade",
      ]);
      upstream.headers.forEach((value, key) => {
        if (!blockedHeaders.has(key.toLowerCase())) res.setHeader(key, value);
      });
      res.setHeader("X-Nova-Agent-Backend", "openclaw");
      res.setHeader(
        "X-Nova-Model",
        process.env.OPENCLAW_AGENT_MODEL || DEFAULT_MODEL,
      );

      if (!upstream.body) {
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
      res.end();
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      const status = aborted ? 504 : 502;
      const message = aborted
        ? "FluidVoice request timed out"
        : `NOVA OpenClaw runtime unreachable: ${error instanceof Error ? error.message : String(error)}`;
      if (wantsStream && res.headersSent) {
        writeSseError(res, status, message);
      } else if (!res.headersSent) {
        res.status(status).json({ error: message });
      } else {
        res.end();
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      clearTimeout(timeout);
    }
  },
);

export default router;
