/**
 * Campaign routes — create, manage, and run social media campaigns.
 *
 * A campaign is a named, goal-driven content series that:
 *  - Has a subject / description (drives AI content gen)
 *  - Covers one or more platforms with configurable posting cadence
 *  - Generates FRESH, UNIQUE content on every run (new caption + new image)
 *  - Researches competitive strategies automatically on creation
 *  - Self-reflects to provide post-performance insights
 *
 * Routes (mounted under /social/campaigns via routes/index.ts):
 *
 *  POST   /social/campaigns                 Create campaign + run research
 *  GET    /social/campaigns                 List all campaigns
 *  GET    /social/campaigns/:id             Get campaign detail + recent posts
 *  PUT    /social/campaigns/:id             Update campaign
 *  DELETE /social/campaigns/:id             Delete campaign
 *  POST   /social/campaigns/:id/activate    Set status → active + schedule next run
 *  POST   /social/campaigns/:id/pause       Pause campaign
 *  POST   /social/campaigns/:id/run         Generate + publish a post NOW
 *  GET    /social/campaigns/:id/insights    Analyze past posts, suggest improvements
 */

import { Router } from "express";
import { z } from "zod";
import { db, hasDatabase, socialCampaignsTable, socialScheduledPostsTable } from "@workspace/db";
import { eq, desc, and, isNotNull, sql } from "drizzle-orm";
import {
  generateImage,
  generateCaption,
  researchCampaignStrategy,
  pickVariationAngle,
  saveToPicturesWorkspace,
  buildImagePrompt,
  type CampaignStrategy,
} from "../lib/social-ai";
import { noteIgUserId, resolveIgUserId } from "../lib/instagram";

const router = Router();

function dbGuard(res: import("express").Response): boolean {
  if (!hasDatabase || !db) { res.status(503).json({ error: "database not configured" }); return false; }
  return true;
}

// ── Platform → Bitdeer size + Gemini aspect ratio ─────────────────────────────
const PLATFORM_SPECS: Record<string, Record<string, { bitdeerSize: string; geminiAspect: string; dimensions: string; aspectRatio: string }>> = {
  instagram: {
    post:      { bitdeerSize: "1024x1024", geminiAspect: "1:1",  dimensions: "1080×1080", aspectRatio: "1:1"    },
    portrait:  { bitdeerSize: "1024x1365", geminiAspect: "3:4",  dimensions: "1080×1350", aspectRatio: "4:5"    },
    landscape: { bitdeerSize: "1792x1024", geminiAspect: "16:9", dimensions: "1080×566",  aspectRatio: "1.91:1" },
    reel:      { bitdeerSize: "1024x1792", geminiAspect: "9:16", dimensions: "1080×1920", aspectRatio: "9:16"   },
    story:     { bitdeerSize: "1024x1792", geminiAspect: "9:16", dimensions: "1080×1920", aspectRatio: "9:16"   },
  },
  twitter:   { post: { bitdeerSize: "1792x1024", geminiAspect: "16:9", dimensions: "1200×675",  aspectRatio: "16:9" }, square: { bitdeerSize: "1024x1024", geminiAspect: "1:1", dimensions: "1200×1200", aspectRatio: "1:1" } },
  facebook:  { post: { bitdeerSize: "1024x1024", geminiAspect: "1:1",  dimensions: "1200×1200", aspectRatio: "1:1" }, story: { bitdeerSize: "1024x1792", geminiAspect: "9:16", dimensions: "1080×1920", aspectRatio: "9:16" } },
  linkedin:  { post: { bitdeerSize: "1792x1024", geminiAspect: "16:9", dimensions: "1200×627",  aspectRatio: "1.91:1" }, square: { bitdeerSize: "1024x1024", geminiAspect: "1:1", dimensions: "1200×1200", aspectRatio: "1:1" } },
  tiktok:    { video: { bitdeerSize: "1024x1792", geminiAspect: "9:16", dimensions: "1080×1920", aspectRatio: "9:16" } },
  youtube:   { shorts: { bitdeerSize: "1024x1792", geminiAspect: "9:16", dimensions: "1080×1920", aspectRatio: "9:16" }, thumbnail: { bitdeerSize: "1792x1024", geminiAspect: "16:9", dimensions: "1280×720", aspectRatio: "16:9" } },
};

const CAPTION_LIMITS: Record<string, number> = {
  instagram: 2200, tiktok: 2200, twitter: 280, facebook: 63206, linkedin: 3000, youtube: 5000,
};

// Composio tool slugs verified against Composio v3 API (2026-07-16).
// Instagram posting is a TWO-STEP process:
//   1. Create media container → INSTAGRAM_CREATE_MEDIA_CONTAINER
//        content_type: "photo" | "video" | "reel" | "carousel_item"
//        media_type:   "REELS" | "STORIES" (omit for photos)
//        image_url, caption, ig_user_id (required by Graph API)
//   2. Publish container      → INSTAGRAM_CREATE_POST  (creation_id from step 1)
//        creation_id, ig_user_id
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

// ── Validation schemas ────────────────────────────────────────────────────────
const createSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1).max(2000),
  goals: z.string().default(""),
  targetAudience: z.string().default(""),
  brandVoice: z.string().default("motivational"),
  platforms: z.array(z.string()).min(1),
  contentTypes: z.record(z.string(), z.string()).default({}),
  intervalHours: z.number().int().min(1).max(168).default(24),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  runResearch: z.boolean().default(true),
  referenceImageId: z.number().int().optional(),
});

const updateSchema = createSchema.partial().omit({ runResearch: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate ONE fresh post for a campaign (unique content every time). */
async function generateCampaignPost(
  campaign: typeof socialCampaignsTable.$inferSelect,
  platform: string,
  contentType: string,
  postIndex: number,
): Promise<{
  caption: string;
  hashtags: string;
  imageUrl: string;
  imageSource: string;
  aspectRatio: string;
  dimensions: string;
  variationAngle: string;
}> {
  const spec = PLATFORM_SPECS[platform]?.[contentType] ??
    { bitdeerSize: "1024x1024", geminiAspect: "1:1", dimensions: "1080×1080", aspectRatio: "1:1" };
  const maxChars = CAPTION_LIMITS[platform] ?? 2200;

  // Pull strategy for post angles
  let strategy: Partial<CampaignStrategy> = {};
  try { strategy = JSON.parse(campaign.strategyNotes || "{}"); } catch { /* use defaults */ }

  // Pick a variation angle — cycles through postAngles (if present) then VARIATION_ANGLES
  let variationAngle: string;
  const postAngles = strategy.postAngles ?? [];
  if (postAngles.length > 0) {
    variationAngle = postAngles[postIndex % postAngles.length]!;
  } else {
    variationAngle = pickVariationAngle(postIndex);
  }

  // Build caption prompt with strategy context + variation angle
  const captionFormula = strategy.captionFormula || "powerful hook → body value → CTA";
  const hashtagStrategy = strategy.hashtagStrategy || "5-10 relevant hashtags";
  const visualStyle = strategy.visualStyle || "professional, high contrast, eye-catching";
  const contentPillar = (strategy.contentPillars ?? [])[postIndex % Math.max((strategy.contentPillars ?? []).length, 1)] || "";

  const captionPrompt = `You are an elite social media copywriter specialising in campaign content.

CAMPAIGN: ${campaign.name}
SUBJECT: ${campaign.description}
${contentPillar ? `CONTENT PILLAR: ${contentPillar}` : ""}
BRAND VOICE: ${campaign.brandVoice}
TARGET AUDIENCE: ${campaign.targetAudience || "engaged followers"}
PLATFORM: ${platform} (${contentType}) — max ${maxChars} characters
POST #${postIndex + 1} IN CAMPAIGN

THIS POST'S SPECIFIC ANGLE — you MUST use this angle exclusively, do NOT repeat ideas from other posts:
"${variationAngle}"

CAPTION FORMULA: ${captionFormula}
HASHTAG APPROACH: ${hashtagStrategy}

Rules:
1. The hook must be built around the ANGLE above — not a generic hook about ${campaign.description}
2. NEVER repeat the same hook, opener, or structure used in previous posts
3. The post should feel like a completely different entry point to the subject
4. Apply ${campaign.brandVoice} tone throughout

Return ONLY valid JSON:
{"caption": "full caption text", "hashtags": "#tag1 #tag2 ..."}`;

  const raw = await generateCaption(captionPrompt);
  let captionData: { caption?: string; hashtags?: string } = {};
  try { captionData = JSON.parse(raw); } catch { captionData = { caption: raw, hashtags: "" }; }

  const caption = (captionData.caption ?? "").slice(0, maxChars);
  const hashtags = captionData.hashtags ?? "";

  // Generate image with the visual style from strategy
  const imagePrompt = buildImagePrompt(
    `Professional ${platform} ${contentType} social media image for a campaign post.
Campaign: ${campaign.name}
Subject: ${campaign.description}
This post's angle: ${variationAngle}
Visual style: ${visualStyle}
Mood: ${campaign.brandVoice}
Format: ${spec.aspectRatio} for ${platform}.`
  );

  let imageUrl = "";
  let imageSource = "";
  try {
    const img = await generateImage(imagePrompt, spec.bitdeerSize, spec.geminiAspect);
    imageUrl = img.url;
    imageSource = img.source;
    // Save to Pictures workspace so the user can browse all generated images
    void saveToPicturesWorkspace(imageUrl, platform, contentType);
  } catch { /* non-fatal — post without image */ }

  return { caption, hashtags, imageUrl, imageSource, aspectRatio: spec.aspectRatio, dimensions: spec.dimensions, variationAngle };
}

/** Internal: execute a Composio tool. */
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
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

/** Publish one post to a platform via Composio. */
async function publishToComposio(
  port: number,
  platform: string,
  contentType: string,
  caption: string,
  imageUrl: string,
): Promise<{ ok: boolean; error?: string; result?: unknown; creationId?: string; mediaId?: string }> {
  const toolSlug = COMPOSIO_TOOL_MAP[platform]?.[contentType] ?? "";
  if (!toolSlug) {
    return { ok: false, error: `No Composio tool for ${platform}/${contentType}` };
  }

  const hasPublicImage = imageUrl && !imageUrl.startsWith("data:");
  const baseArgs: Record<string, unknown> = {
    caption, text: caption, message: caption,
    ...(hasPublicImage ? { image_url: imageUrl } : {}),
  };

  if (platform === "instagram") {
    // Instagram requires the IG business user id on every Graph API call.
    // env → cache → INSTAGRAM_GET_USER_INFO via Composio.
    let igUserId: string;
    try {
      igUserId = await resolveIgUserId(port);
    } catch (e) {
      return {
        ok: false,
        error:
          "Instagram publishing is paused: could not discover the Instagram business user id. " +
          (e instanceof Error ? e.message : String(e)) +
          " — also ensure Instagram is connected via Settings → Integrations → Composio.",
      };
    }
    // Step 1: create container
    const step1 = await composioExecute(port, toolSlug, {
      ...baseArgs,
      content_type: contentType === "reel" ? "reel" : "photo",
      media_type: contentType === "reel" ? "REELS" : contentType === "story" ? "STORIES" : undefined,
      ig_user_id: igUserId,
    });
    const d1 = step1.data as Record<string, unknown> | null;
    const step1IgUserId = (d1 as any)?.data?.ig_user_id
      || (d1 as any)?.result?.ig_user_id
      || (d1 as any)?.ig_user_id
      || igUserId;
    if (step1IgUserId && step1IgUserId !== igUserId) {
      noteIgUserId(step1IgUserId);
    }
    const creationId = (d1 as any)?.data?.id || (d1 as any)?.result?.id || (d1 as any)?.id || (d1 as any)?.creation_id;
    if (!step1.ok || !creationId) {
      return { ok: false, error: `Instagram container creation failed: ${JSON.stringify(d1).slice(0, 600)}`, result: d1 };
    }
    // Step 2: publish
    const step2 = await composioExecute(port, "INSTAGRAM_CREATE_POST", {
      creation_id: String(creationId),
      ig_user_id: step1IgUserId,
    });
    const d2 = step2.data as Record<string, unknown> | null;
    const mediaId = (d2 as any)?.data?.id || (d2 as any)?.result?.id || (d2 as any)?.id || (d2 as any)?.media_id;
    if (!step2.ok || !mediaId) {
      return { ok: false, error: `Publish step failed: ${JSON.stringify(d2).slice(0, 400)}`, result: d2, creationId };
    }
    return { ok: true, result: d2, creationId, mediaId };
  }

  const result = await composioExecute(port, toolSlug, baseArgs);
  return { ok: result.ok, result: result.data, error: result.ok ? undefined : `Composio ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}` };
}

// ── POST /social/campaigns ────────────────────────────────────────────────────
router.post("/social/campaigns", async (req, res) => {
  if (!dbGuard(res)) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", details: parsed.error.issues }); return; }

  const { name, description, goals, targetAudience, brandVoice, platforms, contentTypes,
          intervalHours, startAt, endAt, runResearch, referenceImageId } = parsed.data;

  // Default content types (reel for instagram, post for others)
  const defaultContentTypes: Record<string, string> = {};
  for (const p of platforms) {
    defaultContentTypes[p] = contentTypes[p] ?? (p === "instagram" ? "reel" : p === "tiktok" ? "video" : p === "youtube" ? "shorts" : "post");
  }

  let rawResearch = "";
  let strategyNotes = "";

  if (runResearch) {
    try {
      const r = await researchCampaignStrategy(name, description, platforms, targetAudience, goals);
      rawResearch = r.rawResearch;
      strategyNotes = JSON.stringify(r.strategy, null, 2);
    } catch (e) {
      // Research failure is non-fatal
      rawResearch = `Research failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const start = startAt ? new Date(startAt) : new Date();
  const nextRun = new Date(start.getTime()); // campaigns start running immediately by default

  try {
    const rows = await db!.insert(socialCampaignsTable).values({
      name, description, goals, targetAudience, brandVoice,
      platforms: JSON.stringify(platforms),
      contentTypes: JSON.stringify(defaultContentTypes),
      intervalHours,
      startAt: start,
      endAt: endAt ? new Date(endAt) : undefined,
      nextRunAt: nextRun,
      status: "draft",
      researchNotes: rawResearch,
      strategyNotes,
      referenceImageId,
    }).returning();

    res.status(201).json({
      ok: true,
      campaign: rows[0],
      research: { conducted: runResearch, snippetCount: rawResearch.split("\n\n").length },
      strategy: strategyNotes ? JSON.parse(strategyNotes) : null,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /social/campaigns ─────────────────────────────────────────────────────
router.get("/social/campaigns", async (_req, res) => {
  if (!dbGuard(res)) return;
  try {
    const campaigns = await db!
      .select()
      .from(socialCampaignsTable)
      .orderBy(desc(socialCampaignsTable.createdAt))
      .limit(50);
    res.json({ campaigns });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /social/campaigns/:id ─────────────────────────────────────────────────
router.get("/social/campaigns/:id", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    const [campaign] = await db!.select().from(socialCampaignsTable).where(eq(socialCampaignsTable.id, id)).limit(1);
    if (!campaign) { res.status(404).json({ error: "campaign not found" }); return; }

    const posts = await db!
      .select()
      .from(socialScheduledPostsTable)
      .where(eq(socialScheduledPostsTable.campaignId, id))
      .orderBy(desc(socialScheduledPostsTable.createdAt))
      .limit(20);

    let strategy = null;
    try { strategy = JSON.parse(campaign.strategyNotes || "null"); } catch { /* ok */ }

    res.json({ campaign, posts, strategy });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── PUT /social/campaigns/:id ─────────────────────────────────────────────────
router.put("/social/campaigns/:id", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", details: parsed.error.issues }); return; }
  try {
    const { startAt, endAt, platforms, contentTypes, ...rest } = parsed.data;
    await db!.update(socialCampaignsTable).set({
      ...rest,
      ...(platforms ? { platforms: JSON.stringify(platforms) } : {}),
      ...(contentTypes ? { contentTypes: JSON.stringify(contentTypes) } : {}),
      ...(startAt ? { startAt: new Date(startAt) } : {}),
      ...(endAt ? { endAt: new Date(endAt) } : {}),
    }).where(eq(socialCampaignsTable.id, id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── DELETE /social/campaigns/:id ──────────────────────────────────────────────
router.delete("/social/campaigns/:id", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    await db!.delete(socialCampaignsTable).where(eq(socialCampaignsTable.id, id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /social/campaigns/:id/activate ──────────────────────────────────────
router.post("/social/campaigns/:id/activate", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    const [c] = await db!.select().from(socialCampaignsTable).where(eq(socialCampaignsTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "campaign not found" }); return; }
    const nextRun = new Date(); // run at next cron tick
    await db!.update(socialCampaignsTable).set({ status: "active", nextRunAt: nextRun }).where(eq(socialCampaignsTable.id, id));
    res.json({ ok: true, status: "active", nextRunAt: nextRun });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /social/campaigns/:id/pause ─────────────────────────────────────────
router.post("/social/campaigns/:id/pause", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    await db!.update(socialCampaignsTable).set({ status: "paused" }).where(eq(socialCampaignsTable.id, id));
    res.json({ ok: true, status: "paused" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /social/campaigns/:id/run — generate + publish NOW ──────────────────
router.post("/social/campaigns/:id/run", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [campaign] = await db!.select().from(socialCampaignsTable).where(eq(socialCampaignsTable.id, id)).limit(1);
  if (!campaign) { res.status(404).json({ error: "campaign not found" }); return; }

  const platforms: string[] = JSON.parse(campaign.platforms || "[]");
  const contentTypes: Record<string, string> = JSON.parse(campaign.contentTypes || "{}");
  const postIndex = campaign.postsGenerated;
  const port = Number(process.env.PORT || 8080);

  const results: unknown[] = [];
  let totalPublished = 0;

  for (const platform of platforms) {
    const contentType = contentTypes[platform] ?? "post";
    try {
      // Generate FRESH, UNIQUE content for this run
      const generated = await generateCampaignPost(campaign, platform, contentType, postIndex + results.length);

      const fullCaption = [generated.caption, generated.hashtags].filter(Boolean).join("\n\n");

      // Save post record
      const [saved] = await db!.insert(socialScheduledPostsTable).values({
        campaignId: id,
        platform, contentType,
        description: campaign.description,
        tone: campaign.brandVoice,
        caption: generated.caption,
        hashtags: generated.hashtags,
        imageUrl: generated.imageUrl,
        aspectRatio: generated.aspectRatio,
        dimensions: generated.dimensions,
        status: "publishing",
        scheduledAt: new Date(),
      } as any).returning();

      // Publish
      const published = await publishToComposio(port, platform, contentType, fullCaption, generated.imageUrl);

      await db!.update(socialScheduledPostsTable).set({
        status: published.ok ? "published" : "failed",
        publishedAt: published.ok ? new Date() : undefined,
        composioResult: JSON.stringify(published.result),
        errorMessage: published.error,
      }).where(eq(socialScheduledPostsTable.id, saved!.id));

      if (published.ok) totalPublished++;
      results.push({ platform, contentType, postId: saved!.id, ok: published.ok, variationAngle: generated.variationAngle, error: published.error });
    } catch (e) {
      results.push({ platform, contentType, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Update campaign: increment counter, schedule next run
  const nextRun = new Date(Date.now() + campaign.intervalHours * 3600_000);
  await db!.update(socialCampaignsTable).set({
    postsGenerated: campaign.postsGenerated + platforms.length,
    nextRunAt: nextRun,
    status: campaign.status === "draft" ? "active" : campaign.status,
  }).where(eq(socialCampaignsTable.id, id));

  res.json({
    ok: true,
    results,
    totalPublished,
    totalAttempted: platforms.length,
    nextRunAt: nextRun,
    postIndex,
  });
});

// ── GET /social/campaigns/:id/insights — self-reflection ─────────────────────
router.get("/social/campaigns/:id/insights", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [campaign] = await db!.select().from(socialCampaignsTable).where(eq(socialCampaignsTable.id, id)).limit(1);
  if (!campaign) { res.status(404).json({ error: "campaign not found" }); return; }

  const posts = await db!
    .select()
    .from(socialScheduledPostsTable)
    .where(eq(socialScheduledPostsTable.campaignId, id))
    .orderBy(desc(socialScheduledPostsTable.createdAt))
    .limit(50);

  const published = posts.filter(p => p.status === "published");
  const failed = posts.filter(p => p.status === "failed");
  const publishRate = posts.length > 0 ? Math.round((published.length / posts.length) * 100) : 0;

  // Self-reflection: analyse what worked and suggest improvements
  let aiInsights = "";
  if (posts.length > 0) {
    const postsForAnalysis = posts.slice(0, 10).map(p => ({
      platform: p.platform, contentType: p.contentType,
      caption: p.caption?.slice(0, 200), status: p.status,
      error: p.errorMessage?.slice(0, 200),
    }));

    const insightPrompt = `You are a social media campaign analyst. Analyse this campaign's post history and provide strategic recommendations.

CAMPAIGN: ${campaign.name}
SUBJECT: ${campaign.description}
GOAL: ${campaign.goals || "engagement and growth"}
TOTAL POSTS: ${posts.length}
PUBLISHED: ${published.length} (${publishRate}%)
FAILED: ${failed.length}

RECENT POSTS (most recent first):
${JSON.stringify(postsForAnalysis, null, 2)}

Provide a self-reflection analysis:
1. What patterns do you see in successful vs failed posts?
2. Are the captions diverse enough or repeating patterns?
3. What specific improvements should be made to content strategy?
4. Is the posting frequency (every ${campaign.intervalHours}h) optimal?
5. Which platform/format is performing best?

Return valid JSON:
{
  "overallHealth": "green|yellow|red",
  "summary": "2-3 sentence executive summary",
  "strengths": ["strength1", "strength2"],
  "improvements": ["improvement1", "improvement2", "improvement3"],
  "contentDiversityScore": 0-100,
  "recommendedNextAngles": ["angle1", "angle2", "angle3"],
  "frequencyRecommendation": "keep|increase|decrease with reason",
  "topPerformingFormula": "what worked best in the captions"
}`;

    try {
      const raw = await generateCaption(insightPrompt);
      aiInsights = raw;
    } catch { aiInsights = "{}"; }
  }

  let insights: Record<string, unknown> = {};
  try { insights = JSON.parse(aiInsights); } catch { /* ok */ }

  res.json({
    campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
    stats: {
      totalPosts: posts.length, published: published.length, failed: failed.length,
      publishRate, postsGenerated: campaign.postsGenerated,
    },
    insights,
    recentErrors: failed.slice(0, 3).map(p => ({ id: p.id, platform: p.platform, error: p.errorMessage?.slice(0, 200) })),
  });
});

// ── POST /social/campaigns/run-due — called by the cron ──────────────────────
// Processes all active campaigns whose nextRunAt has passed.
router.post("/social/campaigns/run-due", async (_req, res) => {
  if (!dbGuard(res)) return;
  try {
    const now = new Date();
    const dueCampaigns = await db!
      .select()
      .from(socialCampaignsTable)
      .where(
        and(
          eq(socialCampaignsTable.status, "active"),
          sql`next_run_at <= ${now}`,
        ),
      )
      .limit(10);

    if (!dueCampaigns.length) { res.json({ ran: 0, campaigns: [] }); return; }

    const port = Number(process.env.PORT || 8080);
    const outcomes: unknown[] = [];

    for (const campaign of dueCampaigns) {
      // Check if campaign has expired
      if (campaign.endAt && new Date(campaign.endAt) <= now) {
        await db!.update(socialCampaignsTable).set({ status: "ended" }).where(eq(socialCampaignsTable.id, campaign.id));
        outcomes.push({ id: campaign.id, name: campaign.name, outcome: "ended (past end date)" });
        continue;
      }

      const platforms: string[] = JSON.parse(campaign.platforms || "[]");
      const contentTypes: Record<string, string> = JSON.parse(campaign.contentTypes || "{}");
      const postIndex = campaign.postsGenerated;
      let published = 0;

      for (const platform of platforms) {
        const contentType = contentTypes[platform] ?? "post";
        try {
          const generated = await generateCampaignPost(campaign, platform, contentType, postIndex + published);
          const fullCaption = [generated.caption, generated.hashtags].filter(Boolean).join("\n\n");

          const [saved] = await db!.insert(socialScheduledPostsTable).values({
            campaignId: campaign.id,
            platform, contentType,
            description: campaign.description,
            tone: campaign.brandVoice,
            caption: generated.caption,
            hashtags: generated.hashtags,
            imageUrl: generated.imageUrl,
            aspectRatio: generated.aspectRatio,
            dimensions: generated.dimensions,
            status: "publishing",
            scheduledAt: now,
          } as any).returning();

          const pubResult = await publishToComposio(port, platform, contentType, fullCaption, generated.imageUrl);

          await db!.update(socialScheduledPostsTable).set({
            status: pubResult.ok ? "published" : "failed",
            publishedAt: pubResult.ok ? new Date() : undefined,
            composioResult: JSON.stringify(pubResult.result),
            errorMessage: pubResult.error,
          }).where(eq(socialScheduledPostsTable.id, saved!.id));

          if (pubResult.ok) published++;
        } catch { /* continue to next platform */ }
      }

      // Schedule next run
      const nextRun = new Date(now.getTime() + campaign.intervalHours * 3600_000);
      await db!.update(socialCampaignsTable).set({
        postsGenerated: campaign.postsGenerated + platforms.length,
        nextRunAt: nextRun,
      }).where(eq(socialCampaignsTable.id, campaign.id));

      outcomes.push({ id: campaign.id, name: campaign.name, published, total: platforms.length, nextRunAt: nextRun });
    }

    res.json({ ran: dueCampaigns.length, campaigns: outcomes });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
