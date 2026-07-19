/**
 * Social Media Cron — embedded in the API server process.
 *
 * Every tick (default 60s):
 *  1. Run due CAMPAIGNS via POST /social/campaigns/run-due
 *     → each campaign generates FRESH, UNIQUE content (new caption + new image)
 *  2. Recover image-only Instagram campaign posts through the hardened
 *     durable-media publisher when the legacy campaign path could not provide
 *     Meta with a public image_url.
 *  3. Run due STANDALONE recurring posts via the scheduled-posts table
 *     → REGENERATES caption + image before publishing (different content every time)
 *
 * This guarantees: auto-posts for the same subject are NEVER identical, and
 * loopback cron execution still publishes media through the public HTTPS origin.
 */
import { db, hasDatabase, socialScheduledPostsTable } from "@workspace/db";
import { and, desc, eq, lte } from "drizzle-orm";
import { logger } from "./lib/logger";
import { generateCaption, generateImage, pickVariationAngle, saveToPicturesWorkspace, buildImagePrompt } from "./lib/social-ai";

const POLL_INTERVAL_MS = 60_000;
const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECOVERY_FINAL_PREFIX = "[campaign-recovery-final]";

export interface SocialCronStatus {
  running: boolean;
  tickRunning: boolean;
  startedAt: string | null;
  lastTickStartedAt: string | null;
  lastTickFinishedAt: string | null;
  lastCampaignsRan: number;
  lastDuePosts: number;
  lastPublishSuccesses: number;
  lastPublishFailures: number;
  lastRecoveredCampaignPosts: number;
  skippedOverlappingTicks: number;
  lastError: string;
}

const cronStatus: SocialCronStatus = {
  running: false,
  tickRunning: false,
  startedAt: null,
  lastTickStartedAt: null,
  lastTickFinishedAt: null,
  lastCampaignsRan: 0,
  lastDuePosts: 0,
  lastPublishSuccesses: 0,
  lastPublishFailures: 0,
  lastRecoveredCampaignPosts: 0,
  skippedOverlappingTicks: 0,
  lastError: "",
};

let cronTimer: NodeJS.Timeout | null = null;

export function getSocialCronStatus(): SocialCronStatus {
  return { ...cronStatus };
}

// ── Platform specs (needed for regeneration) ─────────────────────────────────
const PLATFORM_SPECS: Record<string, Record<string, { bitdeerSize: string; geminiAspect: string }>> = {
  instagram: { post: { bitdeerSize: "1024x1024", geminiAspect: "1:1" }, portrait: { bitdeerSize: "1024x1365", geminiAspect: "3:4" }, landscape: { bitdeerSize: "1792x1024", geminiAspect: "16:9" }, reel: { bitdeerSize: "1024x1792", geminiAspect: "9:16" }, story: { bitdeerSize: "1024x1792", geminiAspect: "9:16" } },
  twitter:   { post: { bitdeerSize: "1792x1024", geminiAspect: "16:9" }, square: { bitdeerSize: "1024x1024", geminiAspect: "1:1" } },
  facebook:  { post: { bitdeerSize: "1024x1024", geminiAspect: "1:1" }, story: { bitdeerSize: "1024x1792", geminiAspect: "9:16" } },
  linkedin:  { post: { bitdeerSize: "1792x1024", geminiAspect: "16:9" }, square: { bitdeerSize: "1024x1024", geminiAspect: "1:1" } },
  tiktok:    { video: { bitdeerSize: "1024x1792", geminiAspect: "9:16" } },
  youtube:   { shorts: { bitdeerSize: "1024x1792", geminiAspect: "9:16" }, thumbnail: { bitdeerSize: "1792x1024", geminiAspect: "16:9" } },
};

const CAPTION_LIMITS: Record<string, number> = {
  instagram: 2200, tiktok: 2200, twitter: 280, facebook: 63206, linkedin: 3000, youtube: 5000,
};

// ── Step 1: regenerate fresh content for a standalone recurring post ──────────
async function regeneratePostContent(
  post: typeof socialScheduledPostsTable.$inferSelect,
): Promise<{ caption: string; hashtags: string; imageUrl: string } | null> {
  const description = post.description;
  if (!description) return null;

  const platform = post.platform;
  const contentType = post.contentType;
  const tone = post.tone || "motivational";
  const spec = PLATFORM_SPECS[platform]?.[contentType] ?? { bitdeerSize: "1024x1024", geminiAspect: "1:1" };
  const maxChars = CAPTION_LIMITS[platform] ?? 2200;
  const variationAngle = pickVariationAngle();

  const captionPrompt = `You are an elite social media copywriter.

PLATFORM: ${platform} (${contentType}) — max ${maxChars} chars
SUBJECT: ${description}
TONE: ${tone}
THIS POST'S UNIQUE ANGLE (you MUST use this — do not repeat previous posts):
"${variationAngle}"

Create a completely fresh take on this subject using the angle above.
Every word must reflect that specific angle — not a generic post about the subject.

Return ONLY valid JSON: {"caption": "...", "hashtags": "#tag1 #tag2 ..."}`;

  try {
    const raw = await generateCaption(captionPrompt);
    const parsed = JSON.parse(raw) as { caption?: string; hashtags?: string };
    const caption = (parsed.caption ?? "").slice(0, maxChars);
    const hashtags = parsed.hashtags ?? "";

    const imagePrompt = buildImagePrompt(
      `Professional ${platform} ${contentType} social media image.
Subject: ${description}. Angle: ${variationAngle}. Tone: ${tone}.`,
    );

    let imageUrl = "";
    try {
      const img = await generateImage(imagePrompt, spec.bitdeerSize, spec.geminiAspect);
      imageUrl = img.url;
      void saveToPicturesWorkspace(imageUrl, platform, contentType);
    } catch {
      /* non-fatal — post without image */
    }

    return { caption, hashtags, imageUrl };
  } catch (e) {
    logger.warn({ err: e, postId: post.id }, "[social-cron] content regeneration failed, using stored content");
    return null;
  }
}

// ── Publish through the single hardened application boundary ─────────────────
async function publishPost(
  port: number,
  id: number,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/social/publish/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await r.json() as { ok?: boolean; error?: string };
    return { ok: !!body.ok, status: r.status, error: body.error };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function regenerateMissingCampaignImage(
  port: number,
  post: typeof socialScheduledPostsTable.$inferSelect,
): Promise<{ caption?: string; hashtags?: string; imageUrl?: string }> {
  if (!post.description) return {};
  const contentType = post.contentType === "reel" && !post.videoUrl ? "post" : post.contentType;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/social/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: post.platform,
        contentType,
        description: post.description,
        tone: post.tone || "motivational",
        generateImage: true,
      }),
    });
    if (!response.ok) return {};
    const body = await response.json() as {
      caption?: string;
      hashtags?: string;
      imageUrl?: string;
    };
    return body;
  } catch {
    return {};
  }
}

function isRecoverableCampaignFailure(post: typeof socialScheduledPostsTable.$inferSelect): boolean {
  if (post.platform !== "instagram" || post.campaignId == null) return false;
  const age = Date.now() - new Date(post.updatedAt).getTime();
  if (!Number.isFinite(age) || age > RECOVERY_WINDOW_MS) return false;
  const error = String(post.errorMessage || "");
  if (error.startsWith(RECOVERY_FINAL_PREFIX)) return false;
  return (
    !post.imageUrl ||
    /image_url|video_url|public https|container creation|media id|instagram publish|composio/i.test(error)
  );
}

async function recoverFailedInstagramCampaignPosts(port: number): Promise<number> {
  const failedRows = await db!
    .select()
    .from(socialScheduledPostsTable)
    .where(
      and(
        eq(socialScheduledPostsTable.platform, "instagram"),
        eq(socialScheduledPostsTable.status, "failed"),
      ),
    )
    .orderBy(desc(socialScheduledPostsTable.updatedAt))
    .limit(20);

  let recovered = 0;
  for (const post of failedRows) {
    if (!isRecoverableCampaignFailure(post)) continue;

    let contentType = post.contentType;
    let caption = post.caption;
    let hashtags = post.hashtags;
    let imageUrl = post.imageUrl;

    // Historical image-only campaigns could still contain the retired Reel type.
    if (contentType === "reel" && !post.videoUrl) contentType = "post";

    if (!imageUrl) {
      const generated = await regenerateMissingCampaignImage(port, post);
      caption = generated.caption || caption;
      hashtags = generated.hashtags || hashtags;
      imageUrl = generated.imageUrl || imageUrl;
    }

    if (!imageUrl && !post.videoUrl) {
      await db!.update(socialScheduledPostsTable).set({
        errorMessage: `${RECOVERY_FINAL_PREFIX} Instagram campaign post has no generated image or public video to publish.`,
      }).where(eq(socialScheduledPostsTable.id, post.id));
      continue;
    }

    await db!.update(socialScheduledPostsTable).set({
      status: "pending",
      contentType,
      caption,
      hashtags,
      imageUrl,
      errorMessage: null,
    }).where(eq(socialScheduledPostsTable.id, post.id));

    const result = await publishPost(port, post.id);
    if (result.ok) {
      recovered++;
      logger.info({ id: post.id, campaignId: post.campaignId }, "[social-cron] recovered Instagram campaign post");
      continue;
    }

    // A 409 means the sibling worker or embedded cron already owns the publish
    // lock. Leave its status untouched; that owner will finish the attempt.
    if (result.status === 409) continue;

    await db!.update(socialScheduledPostsTable).set({
      status: "failed",
      errorMessage: `${RECOVERY_FINAL_PREFIX} ${result.error || `HTTP ${result.status}`}`.slice(0, 2000),
    }).where(eq(socialScheduledPostsTable.id, post.id));
  }

  return recovered;
}

// ── Reschedule a recurring standalone post ───────────────────────────────────
async function reschedule(id: number, intervalHours: number) {
  const nextAt = new Date(Date.now() + intervalHours * 60 * 60 * 1000);
  await db!
    .update(socialScheduledPostsTable)
    .set({
      status: "pending",
      scheduledAt: nextAt,
      publishedAt: null,
      errorMessage: null,
    })
    .where(eq(socialScheduledPostsTable.id, id));
  logger.info({ id, nextAt, intervalHours }, "[social-cron] rescheduled recurring post");
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function tick(port: number) {
  if (!hasDatabase || !db) return;
  if (cronStatus.tickRunning) {
    cronStatus.skippedOverlappingTicks++;
    logger.warn("[social-cron] skipped overlapping tick");
    return;
  }

  cronStatus.tickRunning = true;
  cronStatus.lastTickStartedAt = new Date().toISOString();
  cronStatus.lastCampaignsRan = 0;
  cronStatus.lastDuePosts = 0;
  cronStatus.lastPublishSuccesses = 0;
  cronStatus.lastPublishFailures = 0;
  cronStatus.lastRecoveredCampaignPosts = 0;
  cronStatus.lastError = "";

  try {
    // ── A. Run due campaigns (fresh content every time) ─────────────────────
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/social/campaigns/run-due`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await r.json() as { ran?: number; campaigns?: unknown[] };
      cronStatus.lastCampaignsRan = Number(body.ran || 0);
      if (body.ran && body.ran > 0) {
        logger.info({ ran: body.ran, campaigns: body.campaigns }, "[social-cron] campaigns ran");
      }
    } catch (e) {
      logger.warn({ err: e }, "[social-cron] campaign run-due error");
      cronStatus.lastError = e instanceof Error ? e.message : String(e);
    }

    // The legacy campaign path can save a failed Instagram row before the
    // hardened publisher sees it. Recover it immediately in the same tick.
    try {
      cronStatus.lastRecoveredCampaignPosts = await recoverFailedInstagramCampaignPosts(port);
    } catch (e) {
      logger.warn({ err: e }, "[social-cron] campaign recovery error");
      cronStatus.lastError = e instanceof Error ? e.message : String(e);
    }

    // ── B. Publish due standalone scheduled posts ───────────────────────────
    const duePosts = await db
      .select()
      .from(socialScheduledPostsTable)
      .where(
        and(
          eq(socialScheduledPostsTable.status, "pending"),
          lte(socialScheduledPostsTable.scheduledAt, new Date()),
        ),
      )
      .limit(20);

    cronStatus.lastDuePosts = duePosts.length;
    if (!duePosts.length) return;

    logger.info({ count: duePosts.length }, "[social-cron] publishing due standalone posts");

    await Promise.all(
      duePosts.map(async (post) => {
        const intervalHours = post.intervalHours;
        const isRecurring = typeof intervalHours === "number" && intervalHours >= 1;

        if (isRecurring) {
          const freshContent = await regeneratePostContent(post);
          if (freshContent) {
            try {
              await db!
                .update(socialScheduledPostsTable)
                .set({
                  caption: freshContent.caption,
                  hashtags: freshContent.hashtags,
                  imageUrl: freshContent.imageUrl,
                })
                .where(eq(socialScheduledPostsTable.id, post.id));
              logger.info({ id: post.id }, "[social-cron] recurring post content regenerated");
            } catch (e) {
              logger.warn({ err: e, id: post.id }, "[social-cron] failed to save regenerated content");
            }
          }
        }

        const result = await publishPost(port, post.id);
        if (result.ok) cronStatus.lastPublishSuccesses++;
        else if (result.status !== 409) cronStatus.lastPublishFailures++;

        logger.info(
          { id: post.id, platform: post.platform, ok: result.ok, status: result.status, recurring: isRecurring },
          "[social-cron] publish result",
        );

        if (result.ok && isRecurring) {
          await reschedule(post.id, intervalHours as number);
        }
      }),
    );
  } catch (e) {
    cronStatus.lastError = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e }, "[social-cron] tick error");
  } finally {
    cronStatus.tickRunning = false;
    cronStatus.lastTickFinishedAt = new Date().toISOString();
  }
}

// ── Public ────────────────────────────────────────────────────────────────────
export function startSocialCron(port: number) {
  if (cronTimer) return;
  cronStatus.running = true;
  cronStatus.startedAt = new Date().toISOString();

  cronTimer = setTimeout(() => {
    void tick(port);
    cronTimer = setInterval(() => void tick(port), POLL_INTERVAL_MS);
  }, 5_000);

  logger.info(
    { intervalMs: POLL_INTERVAL_MS, publicBaseUrl: process.env.PUBLIC_BASE_URL || "missing" },
    "[social-cron] Social media cron started (embedded in API server)",
  );
}
