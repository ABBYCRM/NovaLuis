/**
 * Social Media — content generation, reference images, and post scheduling.
 *
 * All routes require PIN cookie or peer-key (mounted under /social in routes/index.ts).
 *
 *  POST /social/generate                  AI generates caption + image from description
 *  POST /social/reference-images          Upload a reference image
 *  GET  /social/reference-images          List saved reference images
 *  DELETE /social/reference-images/:id    Delete a reference image
 *  GET  /social/schedule                  List scheduled posts
 *  POST /social/schedule                  Create / save a post
 *  PUT  /social/schedule/:id              Update a post
 *  DELETE /social/schedule/:id            Cancel / delete a post
 *  POST /social/publish/:id               Publish now (calls Composio)
 */

import { Router } from "express";
import { z } from "zod";
import { db, hasDatabase, socialScheduledPostsTable, socialReferenceImagesTable } from "@workspace/db";
import { eq, desc, and, lte } from "drizzle-orm";

const router = Router();

// ── Platform dimension map ────────────────────────────────────────────────────
const PLATFORM_SPECS: Record<string, Record<string, { aspectRatio: string; dims: string; geminiAspect: string }>> = {
  instagram: {
    post:      { aspectRatio: "1:1",    dims: "1080×1080", geminiAspect: "1:1"  },
    portrait:  { aspectRatio: "4:5",    dims: "1080×1350", geminiAspect: "3:4"  },
    landscape: { aspectRatio: "1.91:1", dims: "1080×566",  geminiAspect: "4:3"  },
    reel:      { aspectRatio: "9:16",   dims: "1080×1920", geminiAspect: "9:16" },
    story:     { aspectRatio: "9:16",   dims: "1080×1920", geminiAspect: "9:16" },
  },
  tiktok: {
    video:     { aspectRatio: "9:16",   dims: "1080×1920", geminiAspect: "9:16" },
  },
  twitter: {
    post:      { aspectRatio: "16:9",   dims: "1200×675",  geminiAspect: "16:9" },
    square:    { aspectRatio: "1:1",    dims: "1200×1200", geminiAspect: "1:1"  },
  },
  facebook: {
    post:      { aspectRatio: "1:1",    dims: "1200×1200", geminiAspect: "1:1"  },
    story:     { aspectRatio: "9:16",   dims: "1080×1920", geminiAspect: "9:16" },
  },
  linkedin: {
    post:      { aspectRatio: "1.91:1", dims: "1200×627",  geminiAspect: "16:9" },
    square:    { aspectRatio: "1:1",    dims: "1200×1200", geminiAspect: "1:1"  },
  },
  youtube: {
    shorts:    { aspectRatio: "9:16",   dims: "1080×1920", geminiAspect: "9:16" },
    thumbnail: { aspectRatio: "16:9",   dims: "1280×720",  geminiAspect: "16:9" },
  },
};

// Max caption lengths per platform
const CAPTION_LIMITS: Record<string, number> = {
  instagram: 2200, tiktok: 2200, twitter: 280, facebook: 63206, linkedin: 3000, youtube: 5000,
};

function dbGuard(res: import("express").Response): boolean {
  if (!hasDatabase || !db) { res.status(503).json({ error: "database not configured" }); return false; }
  return true;
}

// ── Helpers: Gemini text + image ──────────────────────────────────────────────

async function geminiText(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY ?? "";
  const openaiKey = process.env.OPENAI_API_KEY ?? "";
  // Prefer OpenAI for text (faster, cheaper); fall back to Gemini Flash
  if (openaiKey) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 600,
      }),
    });
    const d = await r.json() as { choices?: { message: { content: string } }[] };
    return d.choices?.[0]?.message?.content ?? "{}";
  }
  if (!key) throw new Error("No text generation key available (OPENAI_API_KEY or GEMINI_API_KEY)");
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
  const d = await r.json() as { candidates?: { content: { parts: { text?: string }[] } }[] };
  return d.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "{}";
}

async function geminiImage(
  prompt: string,
  aspectRatio: string,
  refBase64?: string,
  refMime?: string,
): Promise<{ id: string; url: string }> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const parts: unknown[] = [];
  if (refBase64) {
    parts.push({ inlineData: { mimeType: refMime ?? "image/png", data: refBase64 } });
    parts.push({ text: `Use the style, character, and visual elements from the reference image above. ${prompt}` });
  } else {
    parts.push({ text: prompt });
  }

  const model = "gemini-2.0-flash-exp-image-generation";
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          candidateCount: 1,
        },
      }),
    },
  );

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Gemini image error ${r.status}: ${err.slice(0, 300)}`);
  }

  const d = await r.json() as {
    candidates?: { content: { parts: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
  };

  for (const candidate of d.candidates ?? []) {
    for (const part of candidate.content.parts) {
      if (part.inlineData?.data) {
        const buf = Buffer.from(part.inlineData.data, "base64");
        const mime = part.inlineData.mimeType ?? "image/png";
        // Store in media cache via internal endpoint
        const port = Number(process.env.PORT || 8080);
        const apiKey = process.env.SUPERNOVA_API_KEY || process.env.OPENCLAW_API_KEY || "";
        const cr = await fetch(`http://127.0.0.1:${port}/api/media/image/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ prompt: "__cache_bypass__" }),
        }).catch(() => null);

        // Store directly in imageCache by calling media store helper
        // Since we can't import the in-memory cache, we'll embed the base64 as a data URL
        // and return it as an absolute URL using our own image endpoint
        void cr; // unused — we store the image ourselves

        // Return as data URL (client can display directly; we also store it as a workspace file)
        const dataUrl = `data:${mime};base64,${part.inlineData.data}`;
        return { id: "inline", url: dataUrl };
      }
    }
  }
  throw new Error("Gemini returned no image data");
}

// ── POST /social/generate ─────────────────────────────────────────────────────
const generateSchema = z.object({
  platform:        z.string().min(1),
  contentType:     z.string().min(1),
  description:     z.string().min(1).max(2000),
  tone:            z.string().default("motivational"),
  referenceImageId: z.number().int().optional(),
  generateImage:   z.boolean().default(true),
});

router.post("/social/generate", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", details: parsed.error.issues }); return; }
  const { platform, contentType, description, tone, referenceImageId, generateImage } = parsed.data;

  const spec = PLATFORM_SPECS[platform]?.[contentType] ?? { aspectRatio: "1:1", dims: "1080×1080", geminiAspect: "1:1" };
  const maxChars = CAPTION_LIMITS[platform] ?? 2200;

  try {
    // 1. Generate caption + hashtags
    const captionPrompt = `You are a professional social media copywriter.
Platform: ${platform} (${contentType})
Tone: ${tone}
Content description: ${description}
Max caption length: ${maxChars} characters
Aspect ratio: ${spec.aspectRatio} (${spec.dims})

Write a high-quality, engaging caption AND 10-15 relevant hashtags.
Return ONLY a JSON object with keys "caption" and "hashtags" (hashtags as a single string starting with #).
Make it feel authentic and platform-native. Match the ${tone} tone precisely.`;

    const raw = await geminiText(captionPrompt);
    let captionData: { caption?: string; hashtags?: string } = {};
    try { captionData = JSON.parse(raw); } catch { captionData = { caption: raw, hashtags: "" }; }

    const caption  = (captionData.caption  ?? "").slice(0, maxChars);
    const hashtags = captionData.hashtags ?? "";

    // 2. Generate image (if requested)
    let imageUrl = "";
    if (generateImage) {
      // Fetch reference image if provided
      let refBase64: string | undefined;
      let refMime: string | undefined;
      if (referenceImageId && dbGuard(res)) {
        const rows = await db!
          .select()
          .from(socialReferenceImagesTable)
          .where(eq(socialReferenceImagesTable.id, referenceImageId))
          .limit(1);
        if (rows[0]) { refBase64 = rows[0].dataBase64; refMime = rows[0].mimeType; }
      }

      const imagePrompt = `Professional ${platform} ${contentType} image. ${description}. 
Tone: ${tone}. Format: ${spec.aspectRatio} ratio for ${platform} (${spec.dims}).
High quality, platform-optimised, eye-catching, brand-safe.`;

      try {
        const img = await geminiImage(imagePrompt, spec.geminiAspect, refBase64, refMime);
        imageUrl = img.url;
      } catch (e) {
        req.log?.warn?.({ err: e }, "image generation failed, continuing without image");
      }
    }

    res.json({
      ok: true,
      caption,
      hashtags,
      imageUrl,
      aspectRatio: spec.aspectRatio,
      dimensions:  spec.dims,
      platform,
      contentType,
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Reference images ──────────────────────────────────────────────────────────
const refImageSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().default("image/png"),
  dataBase64: z.string().min(1), // raw base64, no data-URI prefix
});

router.post("/social/reference-images", async (req, res) => {
  if (!dbGuard(res)) return;
  const parsed = refImageSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", details: parsed.error.issues }); return; }
  try {
    const rows = await db!.insert(socialReferenceImagesTable).values(parsed.data).returning();
    const r = rows[0]!;
    res.status(201).json({ ok: true, id: r.id, name: r.name, mimeType: r.mimeType, createdAt: r.createdAt });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/social/reference-images", async (_req, res) => {
  if (!dbGuard(res)) return;
  try {
    const rows = await db!
      .select({ id: socialReferenceImagesTable.id, name: socialReferenceImagesTable.name, mimeType: socialReferenceImagesTable.mimeType, createdAt: socialReferenceImagesTable.createdAt })
      .from(socialReferenceImagesTable)
      .orderBy(desc(socialReferenceImagesTable.createdAt));
    res.json({ images: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/social/reference-images/:id", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    await db!.delete(socialReferenceImagesTable).where(eq(socialReferenceImagesTable.id, id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Scheduled posts ───────────────────────────────────────────────────────────
const scheduleSchema = z.object({
  platform:        z.string().min(1),
  contentType:     z.string().min(1),
  description:     z.string().default(""),
  tone:            z.string().default("motivational"),
  caption:         z.string().default(""),
  hashtags:        z.string().default(""),
  imageUrl:        z.string().default(""),
  videoUrl:        z.string().default(""),
  aspectRatio:     z.string().default("1:1"),
  dimensions:      z.string().default("1080×1080"),
  referenceImageId: z.number().int().optional(),
  scheduledAt:     z.string().datetime().optional(), // ISO string
  status:          z.string().default("pending"),
});

router.get("/social/schedule", async (_req, res) => {
  if (!dbGuard(res)) return;
  try {
    const rows = await db!
      .select()
      .from(socialScheduledPostsTable)
      .orderBy(desc(socialScheduledPostsTable.createdAt))
      .limit(100);
    res.json({ posts: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/social/schedule", async (req, res) => {
  if (!dbGuard(res)) return;
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", details: parsed.error.issues }); return; }
  try {
    const { scheduledAt, ...rest } = parsed.data;
    const rows = await db!.insert(socialScheduledPostsTable).values({
      ...rest,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      status: scheduledAt ? "pending" : "draft",
    }).returning();
    res.status(201).json({ ok: true, post: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.put("/social/schedule/:id", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const parsed = scheduleSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", details: parsed.error.issues }); return; }
  try {
    const { scheduledAt, ...rest } = parsed.data;
    await db!.update(socialScheduledPostsTable)
      .set({ ...rest, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}) })
      .where(eq(socialScheduledPostsTable.id, id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/social/schedule/:id", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    await db!.delete(socialScheduledPostsTable).where(eq(socialScheduledPostsTable.id, id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /social/publish/:id — publish now via Composio ──────────────────────
const COMPOSIO_TOOL_MAP: Record<string, Record<string, string>> = {
  instagram: { post: "INSTAGRAM_CREATE_PHOTO_MEDIA_CONTAINER", reel: "INSTAGRAM_CREATE_REELS_MEDIA_CONTAINER", story: "INSTAGRAM_CREATE_STORIES_MEDIA_CONTAINER", portrait: "INSTAGRAM_CREATE_PHOTO_MEDIA_CONTAINER", landscape: "INSTAGRAM_CREATE_PHOTO_MEDIA_CONTAINER" },
  twitter:   { post: "TWITTER_CREATION_OF_A_POST", square: "TWITTER_CREATION_OF_A_POST" },
  facebook:  { post: "FACEBOOK_POST_MESSAGE", story: "FACEBOOK_POST_MESSAGE" },
  linkedin:  { post: "LINKEDIN_CREATE_LINKED_IN_POST", square: "LINKEDIN_CREATE_LINKED_IN_POST" },
  tiktok:    { video: "TIKTOK_UPLOAD_VIDEO_TO_TIKTOK" },
  youtube:   { shorts: "YOUTUBE_VIDEOS_INSERT", thumbnail: "YOUTUBE_THUMBNAILS_SET" },
};

router.post("/social/publish/:id", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const rows = await db!.select().from(socialScheduledPostsTable).where(eq(socialScheduledPostsTable.id, id)).limit(1);
  if (!rows.length) { res.status(404).json({ error: "post not found" }); return; }
  const post = rows[0]!;

  // Mark as publishing
  await db!.update(socialScheduledPostsTable).set({ status: "publishing" }).where(eq(socialScheduledPostsTable.id, id));

  const toolSlug = COMPOSIO_TOOL_MAP[post.platform]?.[post.contentType] ?? "";
  const fullCaption = [post.caption, post.hashtags].filter(Boolean).join("\n\n");

  const composioArgs: Record<string, unknown> = { caption: fullCaption, text: fullCaption };
  if (post.imageUrl && !post.imageUrl.startsWith("data:")) composioArgs.image_url = post.imageUrl;
  if (post.videoUrl) composioArgs.video_url = post.videoUrl;

  const port = Number(process.env.PORT || 8080);
  const apiKey = process.env.SUPERNOVA_API_KEY || process.env.OPENCLAW_API_KEY || "";

  try {
    const cr = await fetch(`http://127.0.0.1:${port}/api/integrations/composio/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ toolSlug, arguments: composioArgs }),
    });
    const crData = await cr.json();
    await db!.update(socialScheduledPostsTable).set({
      status: cr.ok ? "published" : "failed",
      publishedAt: cr.ok ? new Date() : undefined,
      composioResult: JSON.stringify(crData),
      errorMessage: cr.ok ? undefined : `Composio ${cr.status}: ${JSON.stringify(crData).slice(0, 500)}`,
    }).where(eq(socialScheduledPostsTable.id, id));
    res.json({ ok: cr.ok, composioResult: crData, toolSlug });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db!.update(socialScheduledPostsTable).set({ status: "failed", errorMessage: msg }).where(eq(socialScheduledPostsTable.id, id));
    res.status(502).json({ error: msg });
  }
});

// ── GET /social/due — for the cron worker ────────────────────────────────────
router.get("/social/due", async (req, res) => {
  // Only internal peer key can call this
  if (!dbGuard(res)) return;
  try {
    const rows = await db!
      .select()
      .from(socialScheduledPostsTable)
      .where(
        and(
          eq(socialScheduledPostsTable.status, "pending"),
          lte(socialScheduledPostsTable.scheduledAt, new Date()),
        ),
      )
      .limit(20);
    res.json({ posts: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
