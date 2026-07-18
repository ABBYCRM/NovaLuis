/**
 * Media generation routes
 *
 * Image generation  →  Google Gemini  (GEMINI_API_KEY)
 * Video generation  →  A2E AI         (A2E_AI_API_KEY)
 *
 * Every route in this file is gated by the NOVA_API_TOKEN shared-secret
 * middleware (see lib/api-auth.ts). When the env var is unset the route
 * returns 503 "auth not configured" — there is no silent-open path.
 *
 * Routes
 *   POST /media/image/generate          prompt → Gemini image → served URL
 *   GET  /media/images/:id              serve a generated image by session id
 *   POST /media/video/avatar            script → A2E avatar video
 *   POST /media/video/image-to-video    image URL + prompt → A2E async task
 *   GET  /media/video/status/:id        poll A2E task status
 *   GET  /media/video/list              list A2E tasks
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireApiAuth } from "../lib/api-auth";

const router = Router();

// IMPORTANT: apply requireApiAuth PER-ROUTE, not via `router.use(...)` at the
// top. See the matching comment in routes/index.ts and routes/workspaces.ts
// for the full explanation of why this matters: a top-level
// `router.use(requireApiAuth)` leaks into every sibling sub-router when the
// sub-router is mounted at "/" on the parent, which previously caused every
// /api/* call to 401.

// ── Config ───────────────────────────────────────────────────────────────────
const GEMINI_KEY = () => process.env.GEMINI_API_KEY ?? "";
const A2E_KEY    = () => process.env.A2E_AI_API_KEY  ?? "";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Primary model for native image generation (supports responseModalities IMAGE)
const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-exp-image-generation";

const A2E_BASE = "https://video.a2e.ai";

// ── In-memory image cache (lives until server restart — sufficient for session use) ──
interface CachedImage { data: Buffer; mimeType: string; }
const imageCache = new Map<string, CachedImage>();
const IMAGE_CACHE_MAX = 200;

function storeImage(data: Buffer, mimeType: string): string {
  const id = randomUUID();
  imageCache.set(id, { data, mimeType });
  // Evict oldest entries if cache is large
  if (imageCache.size > IMAGE_CACHE_MAX) {
    const first = imageCache.keys().next().value;
    if (first) imageCache.delete(first);
  }
  return id;
}

// ── Helper: A2E authenticated request ────────────────────────────────────────
async function a2eFetch(
  path: string,
  opts: RequestInit = {},
  timeoutMs = 120_000,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const key = A2E_KEY();
  if (!key) throw new Error("A2E_AI_API_KEY is not configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${A2E_BASE}${path}`, {
      ...opts,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers ?? {}),
      },
      signal: ctrl.signal,
    });
    let data: unknown;
    try { data = await res.json(); } catch { data = { raw: await res.text() }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// ── GET /media/images/:id — serve a cached generated image ──────────────────
router.get("/media/images/:id", requireApiAuth, (req: import("express").Request<{ id: string }>, res: import("express").Response) => {
  const img = imageCache.get(req.params.id);
  if (!img) { res.status(404).json({ error: "image not found or expired" }); return; }
  res.setHeader("Content-Type", img.mimeType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(img.data);
});

// ── POST /media/image/generate ───────────────────────────────────────────────
const imageGenSchema = z.object({
  prompt: z.string().min(1).max(4000),
  // "gemini" (default) uses gemini-2.0-flash-exp-image-generation
  // "imagen3" uses imagen-3.0-generate-002 (higher quality, Imagen API)
  model: z.enum(["gemini", "imagen3"]).default("gemini"),
  count: z.number().int().min(1).max(4).default(1),
  // aspect ratio hint included in the prompt automatically
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1"),
});

router.post("/media/image/generate", requireApiAuth, async (req, res) => {
  const key = GEMINI_KEY();
  if (!key) { res.status(503).json({ error: "GEMINI_API_KEY not configured" }); return; }

  const parsed = imageGenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }
  const { prompt, model, count, aspectRatio } = parsed.data;

  try {
    if (model === "imagen3") {
      // Imagen 3 — predict API
      const url = `${GEMINI_BASE}/imagen-3.0-generate-002:predict?key=${key}`;
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: count,
            aspectRatio,
            safetySetting: "block_only_high",
          },
        }),
      });
      const payload = (await upstream.json()) as {
        predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
        error?: { message: string };
      };
      if (!upstream.ok) {
        res.status(502).json({ error: payload?.error?.message ?? `Gemini Imagen3 ${upstream.status}` });
        return;
      }
      const images = (payload.predictions ?? []).map((p) => {
        const buf = Buffer.from(p.bytesBase64Encoded ?? "", "base64");
        const mime = p.mimeType ?? "image/png";
        const id = storeImage(buf, mime);
        return { id, url: `/api/media/images/${id}`, mimeType: mime };
      });
      res.json({ ok: true, model: "imagen-3.0-generate-002", images });
    } else {
      // Gemini 2.0 Flash native image generation
      const url = `${GEMINI_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`;
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            candidateCount: count,
          },
        }),
      });
      const payload = (await upstream.json()) as {
        candidates?: {
          content: {
            parts: { inlineData?: { data?: string; mimeType?: string }; text?: string }[];
          };
        }[];
        error?: { message: string };
      };
      if (!upstream.ok) {
        res.status(502).json({ error: payload?.error?.message ?? `Gemini ${upstream.status}`, raw: payload });
        return;
      }
      const images: { id: string; url: string; mimeType: string }[] = [];
      for (const candidate of payload.candidates ?? []) {
        for (const part of candidate.content.parts) {
          if (part.inlineData?.data) {
            const buf = Buffer.from(part.inlineData.data, "base64");
            const mime = part.inlineData.mimeType ?? "image/png";
            const id = storeImage(buf, mime);
            images.push({ id, url: `/api/media/images/${id}`, mimeType: mime });
          }
        }
      }
      res.json({ ok: true, model: GEMINI_IMAGE_MODEL, images });
    }
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /media/video/avatar ─────────────────────────────────────────────────
const avatarVideoSchema = z.object({
  script: z.string().min(1).max(5000),
  avatar_id: z.string().optional(),
  voice_id: z.string().optional(),
  quality: z.enum(["standard", "ultra"]).default("standard"),
  background: z.string().optional(),
});

router.post("/media/video/avatar", requireApiAuth, async (req, res) => {
  if (!A2E_KEY()) { res.status(503).json({ error: "A2E_AI_API_KEY not configured" }); return; }
  const parsed = avatarVideoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const result = await a2eFetch("/api/v1/video/generate", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    }, 180_000);
    res.status(result.ok ? 200 : 502).json(result.data);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /media/video/image-to-video ─────────────────────────────────────────
const img2vidSchema = z.object({
  image_url: z.string().url(),
  prompt: z.string().max(2000).optional(),
  duration: z.number().int().min(2).max(30).default(5),
});

router.post("/media/video/image-to-video", requireApiAuth, async (req, res) => {
  if (!A2E_KEY()) { res.status(503).json({ error: "A2E_AI_API_KEY not configured" }); return; }
  const parsed = img2vidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const result = await a2eFetch("/api/v1/userImage2Video/start", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    res.status(result.ok ? 200 : 502).json(result.data);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /media/video/status/:id ───────────────────────────────────────────────
router.get("/media/video/status/:id", requireApiAuth, async (req: import("express").Request<{ id: string }>, res: import("express").Response) => {
  if (!A2E_KEY()) { res.status(503).json({ error: "A2E_AI_API_KEY not configured" }); return; }
  try {
    const result = await a2eFetch(`/api/v1/userImage2Video/${encodeURIComponent(req.params.id)}`);
    res.status(result.ok ? 200 : 502).json(result.data);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /media/video/list ────────────────────────────────────────────────────
router.get("/media/video/list", requireApiAuth, async (_req, res) => {
  if (!A2E_KEY()) { res.status(503).json({ error: "A2E_AI_API_KEY not configured" }); return; }
  try {
    const result = await a2eFetch("/api/v1/userImage2Video/allRecords");
    res.status(result.ok ? 200 : 502).json(result.data);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
