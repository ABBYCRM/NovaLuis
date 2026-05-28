import { Router } from "express";

const router = Router();

const BITDEER_BASE = "https://api-inference.bitdeer.ai";
const API_KEY = process.env.BITDEER_API_KEY ?? "";

// Streaming proxy — mounted on the router at /api, so
// req.path within this router is e.g. /v1/chat/completions
router.all("/v1/*splat", async (req, res) => {
  // req.path is relative to the router mount point → /v1/chat/completions
  // req.url includes query string → /v1/chat/completions?foo=bar
  const qs = req.url.slice(req.path.length); // query string only, or ""
  const upstreamUrl = `${BITDEER_BASE}${req.path}${qs}`;

  const hasBody =
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    req.body != null &&
    Object.keys(req.body).length > 0;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        Accept: req.headers.accept ?? "*/*",
      },
      body: hasBody ? JSON.stringify(req.body) : undefined,
      // @ts-expect-error Node 24 fetch supports duplex
      duplex: "half",
    });

    res.status(upstream.status);

    const skipHeaders = new Set([
      "transfer-encoding",
      "connection",
      "keep-alive",
      "upgrade",
      "proxy-authenticate",
      "proxy-authorization",
    ]);
    upstream.headers.forEach((v, k) => {
      if (!skipHeaders.has(k.toLowerCase())) res.setHeader(k, v);
    });

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const pump = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const ok = res.write(value);
        if (!ok) await new Promise<void>((r) => res.once("drain", r));
      }
      res.end();
    };
    pump().catch((e) => {
      req.log.error({ err: e }, "bitdeer-proxy stream error");
      res.end();
    });
  } catch (e) {
    req.log.error({ err: e }, "bitdeer-proxy fetch error");
    if (!res.headersSent) res.status(502).json({ error: "upstream unreachable" });
  }
});

export default router;
