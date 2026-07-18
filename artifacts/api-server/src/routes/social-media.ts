/**
 * Social Media — content generation, reference images, and post scheduling.
 *
 * All routes require PIN cookie or peer-key (mounted under /social in routes/index.ts).
 *
 *  POST /social/generate                  AI generates caption + image from description
 *  POST /social/smart-suggest             AI picks optimal platform/format/tone
 *  POST /social/reference-images          Upload a reference image
 *  GET  /social/reference-images          List saved reference images
 *  DELETE /social/reference-images/:id    Delete a reference image
 *  GET  /social/schedule                  List scheduled posts
 *  POST /social/schedule                  Create / save a post
 *  PUT  /social/schedule/:id              Update a post
 *  DELETE /social/schedule/:id            Cancel / delete a post
 *  POST /social/publish/:id               Publish now (calls Composio)
 *  GET  /social/debug                     Composio + last-post diagnostics
 *  GET  /social/due                       Due posts (cron worker)
 */

import { Router } from "express";
import { z } from "zod";
import { db, hasDatabase, socialScheduledPostsTable, socialReferenceImagesTable } from "@workspace/db";
import { eq, desc, and, lte } from "drizzle-orm";
import { saveToPicturesWorkspace, buildImagePrompt, fetchImageBuffer, readImageDimensions, matchesAspect, STYLE_TRANSFER_DIRECTIVE } from "../lib/social-ai";
import { logger as rootLogger } from "../lib/logger";
import { noteIgUserId, resolveIgUserId } from "../lib/instagram";

const router = Router();

// ── Platform dimension map ────────────────────────────────────────────────────
const PLATFORM_SPECS: Record<string, Record<string, {
  aspectRatio: string; dims: string; geminiAspect: string; bitdeerSize: string;
}>> = {
  instagram: {
    post:      { aspectRatio: "1:1",    dims: "1080×1080", geminiAspect: "1:1",  bitdeerSize: "1024x1024" },
    portrait:  { aspectRatio: "4:5",    dims: "1080×1350", geminiAspect: "3:4",  bitdeerSize: "1024x1365" },
    landscape: { aspectRatio: "1.91:1", dims: "1080×566",  geminiAspect: "4:3",  bitdeerSize: "1792x1024" },
    reel:      { aspectRatio: "9:16",   dims: "1080×1920", geminiAspect: "9:16", bitdeerSize: "1024x1792" },
    story:     { aspectRatio: "9:16",   dims: "1080×1920", geminiAspect: "9:16", bitdeerSize: "1024x1792" },
  },
  tiktok: {
    video:     { aspectRatio: "9:16",   dims: "1080×1920", geminiAspect: "9:16", bitdeerSize: "1024x1792" },
  },
  twitter: {
    post:      { aspectRatio: "16:9",   dims: "1200×675",  geminiAspect: "16:9", bitdeerSize: "1792x1024" },
    square:    { aspectRatio: "1:1",    dims: "1200×1200", geminiAspect: "1:1",  bitdeerSize: "1024x1024" },
  },
  facebook: {
    post:      { aspectRatio: "1:1",    dims: "1200×1200", geminiAspect: "1:1",  bitdeerSize: "1024x1024" },
    story:     { aspectRatio: "9:16",   dims: "1080×1920", geminiAspect: "9:16", bitdeerSize: "1024x1792" },
  },
  linkedin: {
    post:      { aspectRatio: "1.91:1", dims: "1200×627",  geminiAspect: "16:9", bitdeerSize: "1792x1024" },
    square:    { aspectRatio: "1:1",    dims: "1200×1200", geminiAspect: "1:1",  bitdeerSize: "1024x1024" },
  },
  youtube: {
    shorts:    { aspectRatio: "9:16",   dims: "1080×1920", geminiAspect: "9:16", bitdeerSize: "1024x1792" },
    thumbnail: { aspectRatio: "16:9",   dims: "1280×720",  geminiAspect: "16:9", bitdeerSize: "1792x1024" },
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

// ── Image generation ──────────────────────────────────────────────────────────

/**
 * PRIMARY: Bitdeer `google/flash-image-2.5` — fast, high quality, returns public URLs.
 * Follows the OpenAI images.generate API format.
 */
async function bitdeerImage(
  prompt: string,
  size: string,
): Promise<{ url: string; source: "bitdeer" }> {
  const key = process.env.BITDEER_API_KEY ?? "";
  if (!key) throw new Error("BITDEER_API_KEY not set");

  // Normalize to supported Bitdeer sizes
  const validSizes = new Set(["1024x1024", "1024x1792", "1792x1024"]);
  const safeSize = validSizes.has(size) ? size : "1024x1024";

  const r = await fetch("https://api-inference.bitdeer.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "google/flash-image-2.5",
      prompt,
      size: safeSize,
      n: 1,
    }),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Bitdeer image error ${r.status}: ${err.slice(0, 300)}`);
  }

  const d = await r.json() as {
    data?: ({ url?: string; b64_json?: string })[];
  };

  const item = d.data?.[0];
  if (!item) throw new Error("Bitdeer returned no image data");

  if (item.url) {
    return { url: item.url, source: "bitdeer" };
  }
  if (item.b64_json) {
    // Return as data URL — client displays directly, and we store it.
    return { url: `data:image/png;base64,${item.b64_json}`, source: "bitdeer" };
  }
  throw new Error("Bitdeer image: no url or b64_json in response");
}

/**
 * FALLBACK: Gemini imagen — used when Bitdeer is unavailable.
 */
async function geminiImage(
  prompt: string,
  _aspectRatio: string,
  refBase64?: string,
  refMime?: string,
): Promise<{ url: string; source: "gemini" }> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const parts: unknown[] = [];
  if (refBase64) {
    parts.push({ inlineData: { mimeType: refMime ?? "image/png", data: refBase64 } });
    parts.push({ text: `Use the style from the reference image. ${prompt}` });
  } else {
    parts.push({ text: prompt });
  }

  // Try current model names in order — Gemini experimental models change frequently.
  // Nano Banana 2 is the current default; the legacy model is the fallback.
  const GEMINI_IMAGE_MODELS = [
    "gemini-3.1-flash-image",
    "gemini-2.5-flash-image",
  ];

  let lastErr: Error = new Error("All Gemini image models unavailable");
  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ["IMAGE", "TEXT"], candidateCount: 1 },
          }),
        },
      );
      if (!r.ok) {
        const errText = await r.text();
        lastErr = new Error(`Gemini ${model} error ${r.status}: ${errText.slice(0, 200)}`);
        continue;
      }
      const d = await r.json() as {
        candidates?: { content: { parts: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
      };
      for (const candidate of d.candidates ?? []) {
        for (const part of candidate.content.parts) {
          if (part.inlineData?.data) {
            const mime = part.inlineData.mimeType ?? "image/png";
            return { url: `data:${mime};base64,${part.inlineData.data}`, source: "gemini" };
          }
        }
      }
      lastErr = new Error(`Gemini ${model} returned no image data`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr;
}

/**
 * Generate an image — Bitdeer primary, Gemini fallback.
 * Returns the image URL (may be a data URL if Bitdeer returns b64_json or Gemini is used).
 */
async function generateImage(
  prompt: string,
  bitdeerSize: string,
  geminiAspect: string,
  refBase64?: string,
  refMime?: string,
): Promise<{ url: string; source: string }> {
  // If there's a reference image, Gemini handles it better (it can condition on the reference).
  if (refBase64) {
    return geminiImage(prompt, geminiAspect, refBase64, refMime);
  }
  // Otherwise Bitdeer is primary.
  try {
    return await bitdeerImage(prompt, bitdeerSize);
  } catch (bitdeerErr) {
    // Fall back to Gemini
    try {
      return await geminiImage(prompt, geminiAspect, refBase64, refMime);
    } catch (geminiErr) {
      throw new Error(
        `Image generation failed. Bitdeer: ${bitdeerErr instanceof Error ? bitdeerErr.message : bitdeerErr}. Gemini: ${geminiErr instanceof Error ? geminiErr.message : geminiErr}`,
      );
    }
  }
}

// ── Text generation ───────────────────────────────────────────────────────────

async function generateCaption(prompt: string): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY ?? "";
  if (openaiKey) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 800,
      }),
    });
    const d = await r.json() as { choices?: { message: { content: string } }[] };
    return d.choices?.[0]?.message?.content ?? "{}";
  }
  const key = process.env.GEMINI_API_KEY ?? "";
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

// ── POST /social/generate ─────────────────────────────────────────────────────
const generateSchema = z.object({
  platform:         z.string().min(1),
  contentType:      z.string().min(1),
  description:      z.string().min(1).max(2000),
  tone:             z.string().default("motivational"),
  referenceImageId: z.number().int().optional(),
  generateImage:    z.boolean().default(true),
});

router.post("/social/generate", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", details: parsed.error.issues }); return; }
  const { platform, contentType, description, tone, referenceImageId, generateImage: doGenImage } = parsed.data;

  const spec = PLATFORM_SPECS[platform]?.[contentType] ?? { aspectRatio: "1:1", dims: "1080×1080", geminiAspect: "1:1", bitdeerSize: "1024x1024" };
  const maxChars = CAPTION_LIMITS[platform] ?? 2200;

  try {
    // 1. Generate caption + hashtags
    const captionPrompt = `You are an elite social media strategist and copywriter who has studied viral content psychology at depth. Your captions consistently achieve 10x average engagement because you understand exactly what triggers human attention, emotion, and action.

PLATFORM: ${platform} (${contentType}) — max ${maxChars} chars
TONE: ${tone}
CONTENT: ${description}
DIMENSIONS: ${spec.dims} (${spec.aspectRatio})

## PSYCHOLOGICAL FRAMEWORKS YOU MUST APPLY

### Hook (First Line — CRITICAL, this is the scroll-stopper):
Choose the most powerful hook type for this content and tone:
- **Curiosity Gap**: "The one thing nobody tells you about ___"
- **Pattern Interrupt**: Start with something surprising, counterintuitive, or paradoxical
- **"Them" Hook**: Speak directly to a specific person's exact emotion ("If you're the type who___")
- **Bold Claim**: Make a confident, slightly controversial statement they can't scroll past
- **Relatability Bomb**: Describe a feeling so precisely it feels personal
- **Social Proof Hook**: "X people fail at ___ because of this one thing"
- **FOMO Trigger**: Create the feeling that they'll miss something important
The hook MUST be the single most compelling sentence. For ${platform}: it must work as a standalone hook because that's all the algorithm shows first.

### Body (Middle):
- Build on the hook with a short story, insight, or value drop
- Use rhythm: short punchy sentences. Then a longer one that breathes and carries weight.
- Create an emotional journey: tension → release OR problem → solution
- For ${tone} tone: ${tone === 'sarcastic' ? 'use dry wit, irony, and self-aware humor' : tone === 'motivational' ? 'use power words, create urgency, make them feel capable of something bigger' : tone === 'funny' ? 'build to a punchline, use unexpected wordplay or absurdist logic' : tone === 'bold' ? 'be direct, no hedging, command attention with confident declarative statements' : tone === 'educational' ? 'teach one surprising insight clearly — give them something to share' : tone === 'inspirational' ? 'connect to a universal human truth, make them feel seen and elevated' : 'sound like a trusted expert sharing insider knowledge'}

### CTA (Last Line):
End with ONE clear, low-friction call to action appropriate for ${platform}:
- Instagram/TikTok: "Save this", "Share with someone who needs this", "Comment your answer below"
- Twitter: "Repost if this is you", "Reply with yours"
- LinkedIn: "Agree? Share your experience below"
- Facebook: "Tag someone who needs to see this"

### Platform-Specific Rules:
${platform === 'instagram' ? '- Use line breaks for readability\n- Emoji used strategically (1-3 max in hook area)\n- Hashtags in first comment or end\n- Story captions: ultra-short, punchy' :
  platform === 'tiktok' ? '- Very short captions (under 150 chars ideally)\n- Hook IS the caption\n- Use 3-5 trending hashtags' :
  platform === 'twitter' ? '- 280 chars MAX — every word must earn its place\n- No hashtags unless essential\n- Conversational, first-person, direct' :
  platform === 'linkedin' ? '- Professional but human\n- First line shows before "see more" — make it count\n- 3-5 relevant hashtags at end' :
  platform === 'facebook' ? '- More conversational, community-focused\n- Ask a genuine question to drive comments' :
  '- Clear title-style hook\n- Descriptive for SEO\n- Include keywords naturally'}

Return ONLY valid JSON with exactly these keys:
{
  "caption": "full caption text with line breaks as \\n",
  "hashtags": "#tag1 #tag2 #tag3..."
}

NO other text. NO markdown. Just the JSON object.`;

    const raw = await generateCaption(captionPrompt);
    let captionData: { caption?: string; hashtags?: string } = {};
    try { captionData = JSON.parse(raw); } catch { captionData = { caption: raw, hashtags: "" }; }

    const caption  = (captionData.caption  ?? "").slice(0, maxChars);
    const hashtags = captionData.hashtags ?? "";

    // 2. Generate image (if requested)
    let imageUrl = "";
    let imageSource = "";
    if (doGenImage) {
      let refBase64: string | undefined;
      let refMime: string | undefined;
      if (referenceImageId) {
        try {
          const rows = await db!
            .select()
            .from(socialReferenceImagesTable)
            .where(eq(socialReferenceImagesTable.id, referenceImageId))
            .limit(1);
          if (rows[0]) { refBase64 = rows[0].dataBase64; refMime = rows[0].mimeType; }
        } catch { /* non-fatal */ }
      }

      const imagePrompt = buildImagePrompt(
        (refBase64 ? `${STYLE_TRANSFER_DIRECTIVE}\n\n` : "") +
        `Professional ${platform} ${contentType} social media image.
Subject/theme: ${description}.
Tone: ${tone}.
Format: ${spec.aspectRatio} aspect ratio optimised for ${platform} (${spec.dims}).
Style: High quality, eye-catching, brand-safe, platform-native aesthetic.`
      );

      try {
        const img = await generateImage(imagePrompt, spec.bitdeerSize, spec.geminiAspect, refBase64, refMime);
        imageUrl = img.url;
        imageSource = img.source;
        // Save every generated image to the Pictures workspace (fire-and-forget)
        void saveToPicturesWorkspace(imageUrl, platform, contentType);
      } catch (e) {
        req.log?.warn?.({ err: e }, "[social/generate] image generation failed, continuing without image");
      }
    }

    res.json({
      ok: true,
      caption,
      hashtags,
      imageUrl,
      imageSource,
      aspectRatio: spec.aspectRatio,
      dimensions:  spec.dims,
      platform,
      contentType,
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /social/smart-suggest — AI picks optimal platform/format/tone ────────
router.post("/social/smart-suggest", async (req, res) => {
  const { description = "", currentPlatform = "" } = req.body ?? {};
  if (!description || typeof description !== "string") {
    res.status(400).json({ error: "description required" }); return;
  }

  const prompt = `You are a world-class social media strategist with deep knowledge of current algorithm performance data.

Analyze this content description and return the single best posting strategy:

DESCRIPTION: "${description.slice(0, 500)}"
CURRENT PLATFORM: ${currentPlatform || "none"}

Platform options: instagram, tiktok, twitter, facebook, linkedin, youtube
Content types per platform — instagram: post|portrait|reel|story, tiktok: video, twitter: post|square, facebook: post|story, linkedin: post|square, youtube: shorts|thumbnail
Tone options: motivational, sarcastic, optimistic, funny, professional, bold, inspirational, educational

Consider: content type (video/image/text), target audience, current algorithm priorities, engagement patterns, virality potential.

Return ONLY valid JSON (no markdown):
{"platform":"instagram","contentType":"reel","tone":"funny","intervalHours":24,"reasoning":"one sentence max","postingTip":"one specific tactical tip"}`;

  try {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 30_000);
    let r: Response;
    try {
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini", temperature: 0.3, max_tokens: 300,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { choices: { message: { content: string } }[] };
    const rawText = (j.choices[0]?.message?.content ?? "{}").trim()
      .replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const rec = JSON.parse(rawText);
    res.json({
      platform:     rec.platform     || currentPlatform || "instagram",
      contentType:  rec.contentType  || "reel",
      tone:         rec.tone         || "motivational",
      intervalHours: Number(rec.intervalHours) || null,
      reasoning:    rec.reasoning    || "",
      postingTip:   rec.postingTip   || "",
    });
  } catch {
    // Keyword fallback
    const d = description.toLowerCase();
    const isVideo = /video|reel|clip|film|anim|motion|shorts/.test(d);
    const isLinkedIn = /professional|career|b2b|saas|business|corporate/.test(d);
    const isTikTok = /tiktok|tik tok|dance|trend/.test(d);
    const platform = isLinkedIn ? "linkedin" : isTikTok ? "tiktok" : currentPlatform || "instagram";
    const toneM = d.match(/funny|humor|motivat|inspir|educati|professional|bold|sarcas/);
    const toneMap: Record<string,string> = { motivat:"motivational", inspir:"inspirational", educati:"educational" };
    const rawTone = toneM?.[0] ?? "motivational";
    const tone = toneMap[rawTone] ?? rawTone;
    res.json({
      platform,
      contentType: isVideo ? (platform === "youtube" ? "shorts" : platform === "instagram" ? "reel" : "video") : "post",
      tone, intervalHours: null,
      reasoning: "Based on content keywords — describe more for deeper AI analysis",
      postingTip: "",
    });
  }
});

// ── Reference images ──────────────────────────────────────────────────────────
const refImageSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().default("image/png"),
  dataBase64: z.string().min(1),
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
  platform:         z.string().min(1),
  contentType:      z.string().min(1),
  description:      z.string().default(""),
  tone:             z.string().default("motivational"),
  caption:          z.string().default(""),
  hashtags:         z.string().default(""),
  imageUrl:         z.string().default(""),
  videoUrl:         z.string().default(""),
  aspectRatio:      z.string().default("1:1"),
  dimensions:       z.string().default("1080×1080"),
  referenceImageId: z.number().int().optional(),
  scheduledAt:      z.string().datetime().optional(),
  status:           z.string().default("pending"),
  intervalHours:    z.number().int().min(1).max(168).optional(),
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
    const { scheduledAt, intervalHours, ...rest } = parsed.data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await db!.insert(socialScheduledPostsTable).values({
      ...rest,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      status: scheduledAt || intervalHours ? "pending" : "draft",
      interval_hours: intervalHours ?? null,
    } as any).returning();
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

// ── Composio tool map & publish ───────────────────────────────────────────────
//
// Composio tool slugs verified against Composio v3 API (2026-07-16).
// Instagram posting is a TWO-STEP process:
//   1. Create media container  → INSTAGRAM_CREATE_MEDIA_CONTAINER
//        content_type: "photo" | "video" | "reel" | "carousel_item"
//        media_type:   "REELS" | "STORIES" | omit for photos
//   2. Publish container       → INSTAGRAM_CREATE_POST  (creation_id from step 1)
//
const COMPOSIO_TOOL_MAP: Record<string, Record<string, string>> = {
  instagram: {
    post:      "INSTAGRAM_CREATE_MEDIA_CONTAINER",
    portrait:  "INSTAGRAM_CREATE_MEDIA_CONTAINER",
    landscape: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
    reel:      "INSTAGRAM_CREATE_MEDIA_CONTAINER",
    story:     "INSTAGRAM_CREATE_MEDIA_CONTAINER",
  },
  twitter:   { post: "TWITTER_CREATION_OF_A_POST", square: "TWITTER_CREATION_OF_A_POST" },
  facebook:  { post: "FACEBOOK_POST_MESSAGE", story: "FACEBOOK_POST_MESSAGE" },
  linkedin:  { post: "LINKEDIN_CREATE_LINKED_IN_POST", square: "LINKEDIN_CREATE_LINKED_IN_POST" },
  tiktok:    { video: "TIKTOK_UPLOAD_VIDEO_TO_TIKTOK" },
  youtube:   { shorts: "YOUTUBE_VIDEOS_INSERT", thumbnail: "YOUTUBE_THUMBNAILS_SET" },
};

// Platforms that use Instagram's two-step container→publish flow
const INSTAGRAM_PLATFORMS = new Set(["instagram"]);

/** True if the URL is fetchable for a header-only aspect check (http or data: URL). */
function hasPublicImageForCheck(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("data:");
}

/** Map a content type to the expected Instagram aspect ratio. */
function expectedAspectFor(contentType: string): "1:1" | "4:5" | "1.91:1" | "9:16" {
  switch (contentType) {
    case "story":
    case "reel":
      return "9:16";
    case "portrait":
      return "4:5";
    case "landscape":
      return "1.91:1";
    case "post":
    default:
      return "1:1";
  }
}

async function composioExecute(
  port: number,
  toolSlug: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const r = await fetch(`http://127.0.0.1:${port}/api/integrations/composio/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolSlug, arguments: args }),
  });
  const data = await r.json().catch(() => ({ raw: "unparseable response" }));
  return { ok: r.ok, status: r.status, data };
}

router.post("/social/publish/:id", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const rows = await db!.select().from(socialScheduledPostsTable).where(eq(socialScheduledPostsTable.id, id)).limit(1);
  if (!rows.length) { res.status(404).json({ error: "post not found" }); return; }
  const post = rows[0]!;

  // Idempotency guard — if the cron and the external worker both pick up the same
  // post simultaneously, the second caller arrives here after the first has already
  // set status to "publishing". We return 200 ok/skipped instead of double-publishing.
  if (post.status === "publishing" || post.status === "published") {
    res.json({ ok: true, skipped: true, status: post.status });
    return;
  }

  // Validate we have a tool for this platform + content type
  const toolSlug = COMPOSIO_TOOL_MAP[post.platform]?.[post.contentType] ?? "";
  if (!toolSlug) {
    const msg = `No Composio tool mapped for platform="${post.platform}" contentType="${post.contentType}"`;
    await db!.update(socialScheduledPostsTable)
      .set({ status: "failed", errorMessage: msg })
      .where(eq(socialScheduledPostsTable.id, id));
    res.status(422).json({ ok: false, error: msg });
    return;
  }

  await db!.update(socialScheduledPostsTable).set({ status: "publishing" }).where(eq(socialScheduledPostsTable.id, id));

  const port = Number(process.env.PORT || 8080);
  const fullCaption = [post.caption, post.hashtags].filter(Boolean).join("\n\n");

  try {
    // Pre-flight aspect ratio check (defensive). Catches the
    // "story posted as square with a black bar" bug — the model returned a
    // 1:1 image when we asked for 9:16. Warn-and-continue; we don't block
    // the publish, we just surface the warning so the UI can show it.
    if (hasPublicImageForCheck(post.imageUrl) && post.platform === "instagram" && post.contentType !== "reel") {
      try {
        const expected = expectedAspectFor(post.contentType);
        const buf = await fetchImageBuffer(post.imageUrl);
        if (buf) {
          const dims = readImageDimensions(buf);
          if (dims && !matchesAspect(dims.width, dims.height, expected)) {
            rootLogger.warn(
              { postId: post.id, contentType: post.contentType, expected, actual: `${dims.width}:${dims.height}` },
              "[social/publish] aspect ratio mismatch — image will likely render with black bars on Instagram",
            );
          }
        }
      } catch (e) {
        rootLogger.debug({ err: e }, "[social/publish] aspect check skipped (non-fatal)");
      }
    }

    // Build Composio arguments — image must be a public URL for Instagram
    // (data URLs are excluded because Instagram's API won't fetch them).
    const hasPublicImage = post.imageUrl && !post.imageUrl.startsWith("data:");
    const hasVideo = !!post.videoUrl;

    const baseArgs: Record<string, unknown> = {
      caption: fullCaption,
      text: fullCaption,
      message: fullCaption,
      ...(hasPublicImage ? { image_url: post.imageUrl } : {}),
      ...(hasVideo ? { video_url: post.videoUrl } : {}),
    };

    // ── Instagram two-step flow ────────────────────────────────────────────
    if (INSTAGRAM_PLATFORMS.has(post.platform)) {
      // Step 1: create media container via INSTAGRAM_CREATE_MEDIA_CONTAINER
      // content_type enum: "photo" | "video" | "reel" | "carousel_item"
      // media_type string: "REELS" | "STORIES" (omit for regular photos)
      const igContentType =
        post.contentType === "reel"  ? "reel"  :
        post.contentType === "story" ? "photo" : "photo";
      const igMediaType =
        post.contentType === "reel"  ? "REELS"  :
        post.contentType === "story" ? "STORIES" : undefined;

      // The IG business user id is required by the Graph API on every call.
      // Resolve it from env → cache → INSTAGRAM_GET_USER_INFO via Composio.
      let cachedIgUserId: string;
      try {
        cachedIgUserId = await resolveIgUserId(port);
      } catch (e) {
        const msg = "Instagram publishing is paused: could not discover the Instagram business user id. " +
          (e instanceof Error ? e.message : String(e)) +
          " — also ensure Instagram is connected via Settings → Integrations → Composio.";
        await db!.update(socialScheduledPostsTable)
          .set({ status: "failed", errorMessage: msg })
          .where(eq(socialScheduledPostsTable.id, id));
        res.status(422).json({ ok: false, error: msg });
        return;
      }

      const step1Args: Record<string, unknown> = {
        ...baseArgs,
        content_type: igContentType,
        ...(igMediaType ? { media_type: igMediaType } : {}),
        ig_user_id: cachedIgUserId,
      };

      const step1 = await composioExecute(port, toolSlug, step1Args);

      // Extract creation_id from step 1 response (Composio wraps Composio wraps IG API)
      const step1Data = step1.data as Record<string, unknown> | null;
      // Try multiple paths for the creation_id
      const creationId =
        (step1Data as any)?.data?.id ||
        (step1Data as any)?.result?.id ||
        (step1Data as any)?.id ||
        (step1Data as any)?.creation_id ||
        (step1Data as any)?.data?.creation_id;

      // Some wrappers also echo the IG business user id back on the container
      // response. If we get a new one, prefer it for the publish step.
      const step1IgUserId = (step1Data as any)?.data?.ig_user_id
        || (step1Data as any)?.result?.ig_user_id
        || (step1Data as any)?.ig_user_id
        || cachedIgUserId;
      if (step1IgUserId && step1IgUserId !== cachedIgUserId) {
        noteIgUserId(step1IgUserId);
      }

      if (!step1.ok || !creationId) {
        const msg = `Instagram container creation failed (step 1): ${JSON.stringify(step1Data).slice(0, 600)}`;
        await db!.update(socialScheduledPostsTable).set({
          status: "failed",
          errorMessage: msg,
          composioResult: JSON.stringify({ step: 1, toolSlug, result: step1Data }),
        }).where(eq(socialScheduledPostsTable.id, id));
        res.json({ ok: false, error: msg, step: 1, composioResult: step1Data, toolSlug });
        return;
      }

      // Step 2: publish the container via INSTAGRAM_CREATE_POST
      const step2 = await composioExecute(port, "INSTAGRAM_CREATE_POST", {
        creation_id: String(creationId),
        ig_user_id: step1IgUserId,
      });

      const success = step2.ok;
      const step2Err = success
        ? undefined
        : `Instagram publish failed (step 2): ${JSON.stringify(step2.data).slice(0, 500)}`;

      await db!.update(socialScheduledPostsTable).set({
        status: success ? "published" : "failed",
        publishedAt: success ? new Date() : undefined,
        composioResult: JSON.stringify({ step: 2, creationId, result: step2.data }),
        errorMessage: step2Err,
      }).where(eq(socialScheduledPostsTable.id, id));

      res.json({ ok: success, composioResult: step2.data, toolSlug, creationId, step: 2, error: step2Err });
      return;
    }

    // ── Single-step platforms (Twitter, LinkedIn, Facebook, TikTok) ───────
    const result = await composioExecute(port, toolSlug, baseArgs);

    const singleStepErr = result.ok
      ? undefined
      : `Composio ${result.status}: ${JSON.stringify(result.data).slice(0, 500)}`;

    await db!.update(socialScheduledPostsTable).set({
      status: result.ok ? "published" : "failed",
      publishedAt: result.ok ? new Date() : undefined,
      composioResult: JSON.stringify(result.data),
      errorMessage: singleStepErr,
    }).where(eq(socialScheduledPostsTable.id, id));

    res.json({ ok: result.ok, composioResult: result.data, toolSlug, error: singleStepErr });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db!.update(socialScheduledPostsTable)
      .set({ status: "failed", errorMessage: msg })
      .where(eq(socialScheduledPostsTable.id, id));
    res.status(502).json({ error: msg });
  }
});

// ── GET /social/debug — diagnostics ──────────────────────────────────────────
router.get("/social/debug", async (_req, res) => {
  if (!dbGuard(res)) return;
  try {
    // Last 5 posts with status
    const posts = await db!
      .select({
        id: socialScheduledPostsTable.id,
        platform: socialScheduledPostsTable.platform,
        contentType: socialScheduledPostsTable.contentType,
        status: socialScheduledPostsTable.status,
        errorMessage: socialScheduledPostsTable.errorMessage,
        composioResult: socialScheduledPostsTable.composioResult,
        publishedAt: socialScheduledPostsTable.publishedAt,
        updatedAt: socialScheduledPostsTable.updatedAt,
      })
      .from(socialScheduledPostsTable)
      .orderBy(desc(socialScheduledPostsTable.updatedAt))
      .limit(5);

    // Composio status
    const port = Number(process.env.PORT || 8080);
    const composioStatus = await fetch(`http://127.0.0.1:${port}/api/integrations/composio/status`)
      .then(r => r.json())
      .catch(e => ({ error: e instanceof Error ? e.message : String(e) }));

    // Image gen config
    const imageGenConfig = {
      bitdeer: !!process.env.BITDEER_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      primaryImageModel: "google/flash-image-2.5 (Bitdeer)",
      fallbackImageModels: ["gemini-3.1-flash-image", "gemini-2.5-flash-image"],
    };

    res.json({ posts, composioStatus, imageGenConfig, toolMap: COMPOSIO_TOOL_MAP });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /social/due — for the embedded cron ───────────────────────────────────
router.get("/social/due", async (_req, res) => {
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
