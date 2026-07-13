import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const OPENCLAW_GATEWAY_URL = (
  process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789"
).replace(/\/$/, "");

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/openclaw/status", async (_req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  timeout.unref?.();
  try {
    const headers: Record<string, string> = {};
    if (process.env.OPENCLAW_GATEWAY_TOKEN) {
      headers.Authorization = `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN}`;
    }
    const response = await fetch(`${OPENCLAW_GATEWAY_URL}/readyz`, {
      headers,
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => undefined);
    res.status(response.ok ? 200 : 503).json({
      status: response.ok ? "ready" : "unavailable",
      gateway: "loopback",
      version: process.env.OPENCLAW_RUNTIME_VERSION || "unknown",
      httpStatus: response.status,
    });
  } catch (error) {
    res.status(503).json({
      status: "unavailable",
      gateway: "loopback",
      version: process.env.OPENCLAW_RUNTIME_VERSION || "unknown",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
