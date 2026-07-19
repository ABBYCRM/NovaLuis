import { db, hasDatabase, socialScheduledPostsTable } from "@workspace/db";
import { and, desc, eq, lte } from "drizzle-orm";
import { logger } from "./lib/logger";
import {
  buildImagePrompt,
  generateCaption,
  generateImage,
  pickVariationAngle,
  saveToPicturesWorkspace,
} from "./lib/social-ai";

const configuredPollMs = Number(process.env.SOCIAL_CRON_INTERVAL_MS || 60_000);
const POLL_INTERVAL_MS = Number.isFinite(configuredPollMs)
  ? Math.max(10_000, configuredPollMs)
  : 60_000;
const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECOVERY_FINAL_PREFIX = "[campaign-recovery-final]";
const RECOVERY_RETRY_PREFIX = "[campaign-recovery-retry]";

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

let startTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

export function getSocialCronStatus(): SocialCronStatus {
  return { ...cronStatus };
}

const PLATFORM_SPECS: Record<string, Record<string, { bitdeerSize: string; geminiAspect: string }>> = {
  instagram: {
    post: { bitdeerSize: "1024x1024", geminiAspect: "1:1" },
    portrait: { bitdeerSize: "1024x1365", geminiAspect: "3:4" },
    landscape: { bitdeerSize: "1792x1024", geminiAspect: "16:9" },
    reel: { bitdeerSize: "1024x1792", geminiAspect: "9:16" },
    story: { bitdeerSize: "1024x1792", geminiAspect: "9:16" },
  },
  twitter: {
    post: { bitdeerSize: "1792x1024", geminiAspect: "16:9" },
    square: { bitdeerSize: "1024x1024", geminiAspect: "1:1" },
  },
  facebook: {
    post: { bitdeerSize: "1024x1024", geminiAspect: "1:1" },
    story: { bitdeerSize: "1024x1792", geminiAspect: "9:16" },
  },
  linkedin: {
    post: { bitdeerSize: "1792x1024", geminiAspect: "16:9" },
    square: { bitdeerSize: "1024x1024", geminiAspect: "1:1" },
  },
  tiktok: { video: { bitdeerSize: "1024x1792", geminiAspect: "9:16" } },
  youtube: {
    shorts: { bitdeerSize: "1024x1792", geminiAspect: "9:16" },
    thumbnail: { bitdeerSize: "1792x1024", geminiAspect: "16:9" },
  },
};

const CAPTION_LIMITS: Record<string, number> = {
  instagram: 2200,
  tiktok: 2200,
  twitter: 280,
  facebook: 63206,
  linkedin: 3000,
  youtube: 5000,
};

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : { value: parsed };
  } catch {
    return { raw: text.slice(0, 1000) };
  }
}

async function regeneratePostContent(
  post: typeof socialScheduledPostsTable.$inferSelect,
): Promise<{ caption: string; hashtags: string; imageUrl?: string } | null> {
  if (!post.description) return null;

  const platform = post.platform;
  const contentType = post.contentType;
  const tone = post.tone || "motivational";
  const spec = PLATFORM_SPECS[platform]?.[contentType] ?? {
    bitdeerSize: "1024x1024",
    geminiAspect: "1:1",
  };
  const maxChars = CAPTION_LIMITS[platform] ?? 2200;
  const variationAngle = pickVariationAngle();

  const captionPrompt = `You are an elite social media copywriter.

PLATFORM: ${platform} (${contentType}) — max ${maxChars} chars
SUBJECT: ${post.description}
TONE: ${tone}
THIS POST'S UNIQUE ANGLE: "${variationAngle}"

Create a fresh take using that angle. Return ONLY valid JSON: {"caption":"...","hashtags":"#tag1 #tag2"}`;

  try {
    const raw = await generateCaption(captionPrompt);
    const parsed = JSON.parse(raw) as { caption?: string; hashtags?: string };
    const caption = String(parsed.caption || post.caption || "").slice(0, maxChars);
    const hashtags = String(parsed.hashtags || post.hashtags || "");

    let imageUrl: string | undefined;
    try {
      const imagePrompt = buildImagePrompt(
        `Professional ${platform} ${contentType} social media image. Subject: ${post.description}. Angle: ${variationAngle}. Tone: ${tone}.`,
      );
      const image = await generateImage(imagePrompt, spec.bitdeerSize, spec.geminiAspect);
      if (image.url) {
        imageUrl = image.url;
        void saveToPicturesWorkspace(image.url, platform, contentType).catch((error) => {
          logger.warn({ err: error, postId: post.id }, "[social-cron] failed to archive generated image");
        });
      }
    } catch (error) {
      logger.warn(
        { err: error, postId: post.id },
        "[social-cron] image regeneration failed; preserving existing media",
      );
    }

    return { caption, hashtags, ...(imageUrl ? { imageUrl } : {}) };
  } catch (error) {
    logger.warn(
      { err: error, postId: post.id },
      "[social-cron] caption regeneration failed; preserving stored content",
    );
    return null;
  }
}

async function publishPost(
  port: number,
  id: number,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/social/publish/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(180_000),
    });
    const body = await responsePayload(response);
    const ok = response.ok && body.ok === true;
    const error = typeof body.error === "string"
      ? body.error
      : !response.ok
        ? `HTTP ${response.status}: ${String(body.raw || "publish failed").slice(0, 500)}`
        : undefined;
    return { ok, status: response.status, ...(error ? { error } : {}) };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
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
      signal: AbortSignal.timeout(180_000),
    });
    const body = await responsePayload(response);
    if (!response.ok) {
      logger.warn(
        { postId: post.id, status: response.status, error: body.error || body.raw },
        "[social-cron] campaign image regeneration request failed",
      );
      return {};
    }
    return {
      ...(typeof body.caption === "string" ? { caption: body.caption } : {}),
      ...(typeof body.hashtags === "string" ? { hashtags: body.hashtags } : {}),
      ...(typeof body.imageUrl === "string" && body.imageUrl ? { imageUrl: body.imageUrl } : {}),
    };
  } catch (error) {
    logger.warn({ err: error, postId: post.id }, "[social-cron] campaign image regeneration failed");
    return {};
  }
}

function isRecoverableCampaignFailure(
  post: typeof socialScheduledPostsTable.$inferSelect,
): boolean {
  if (post.platform !== "instagram" || post.campaignId == null) return false;
  const age = Date.now() - new Date(post.updatedAt).getTime();
  if (!Number.isFinite(age) || age > RECOVERY_WINDOW_MS) return false;
  const error = String(post.errorMessage || "");
  if (error.startsWith(RECOVERY_FINAL_PREFIX)) return false;
  return !post.imageUrl ||
    /image_url|video_url|public https|container creation|media id|instagram publish|composio/i.test(error);
}

async function recoverFailedInstagramCampaignPosts(port: number): Promise<number> {
  const failedRows = await db!
    .select()
    .from(socialScheduledPostsTable)
    .where(and(
      eq(socialScheduledPostsTable.platform, "instagram"),
      eq(socialScheduledPostsTable.status, "failed"),
    ))
    .orderBy(desc(socialScheduledPostsTable.updatedAt))
    .limit(20);

  let recovered = 0;
  for (const post of failedRows) {
    if (!isRecoverableCampaignFailure(post)) continue;

    let contentType = post.contentType;
    let caption = post.caption;
    let hashtags = post.hashtags;
    let imageUrl = post.imageUrl;
    if (contentType === "reel" && !post.videoUrl) contentType = "post";

    if (!imageUrl) {
      const generated = await regenerateMissingCampaignImage(port, post);
      caption = generated.caption || caption;
      hashtags = generated.hashtags || hashtags;
      imageUrl = generated.imageUrl || imageUrl;
    }

    if (!imageUrl && !post.videoUrl) {
      const permanentlyMissing = !post.description;
      await db!.update(socialScheduledPostsTable).set({
        errorMessage: permanentlyMissing
          ? `${RECOVERY_FINAL_PREFIX} No description or media is available to rebuild this Instagram campaign post.`
          : `${RECOVERY_RETRY_PREFIX} Media regeneration is temporarily unavailable; the cron will retry within the recovery window.`,
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
      logger.info(
        { id: post.id, campaignId: post.campaignId },
        "[social-cron] recovered Instagram campaign post",
      );
      continue;
    }
    if (result.status === 409) continue;

    await db!.update(socialScheduledPostsTable).set({
      status: "failed",
      errorMessage: `${RECOVERY_RETRY_PREFIX} ${result.error || `HTTP ${result.status}`}`.slice(0, 2000),
    }).where(eq(socialScheduledPostsTable.id, post.id));
  }
  return recovered;
}

async function reschedule(id: number, intervalHours: number): Promise<void> {
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

async function runDueCampaigns(port: number): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/api/social/campaigns/run-due`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180_000),
  });
  const body = await responsePayload(response);
  if (!response.ok) {
    throw new Error(`campaign run-due HTTP ${response.status}: ${String(body.error || body.raw || "unknown error").slice(0, 500)}`);
  }
  const ran = Number(body.ran || 0);
  if (ran > 0) logger.info({ ran, campaigns: body.campaigns }, "[social-cron] campaigns ran");
  return Number.isFinite(ran) ? ran : 0;
}

async function tick(port: number): Promise<void> {
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
    try {
      cronStatus.lastCampaignsRan = await runDueCampaigns(port);
    } catch (error) {
      logger.warn({ err: error }, "[social-cron] campaign run-due error");
      cronStatus.lastError = error instanceof Error ? error.message : String(error);
    }

    try {
      cronStatus.lastRecoveredCampaignPosts = await recoverFailedInstagramCampaignPosts(port);
    } catch (error) {
      logger.warn({ err: error }, "[social-cron] campaign recovery error");
      cronStatus.lastError = error instanceof Error ? error.message : String(error);
    }

    const duePosts = await db
      .select()
      .from(socialScheduledPostsTable)
      .where(and(
        eq(socialScheduledPostsTable.status, "pending"),
        lte(socialScheduledPostsTable.scheduledAt, new Date()),
      ))
      .limit(20);

    cronStatus.lastDuePosts = duePosts.length;
    if (!duePosts.length) return;

    await Promise.all(duePosts.map(async (post) => {
      const intervalHours = post.intervalHours;
      const recurring = typeof intervalHours === "number" && intervalHours >= 1;

      if (recurring) {
        const fresh = await regeneratePostContent(post);
        if (fresh) {
          const update: Partial<typeof socialScheduledPostsTable.$inferInsert> = {
            caption: fresh.caption,
            hashtags: fresh.hashtags,
          };
          if (fresh.imageUrl) update.imageUrl = fresh.imageUrl;
          await db!.update(socialScheduledPostsTable)
            .set(update)
            .where(eq(socialScheduledPostsTable.id, post.id));
        }
      }

      const result = await publishPost(port, post.id);
      if (result.ok) cronStatus.lastPublishSuccesses++;
      else if (result.status !== 409) cronStatus.lastPublishFailures++;

      logger.info(
        { id: post.id, platform: post.platform, ok: result.ok, status: result.status, recurring },
        "[social-cron] publish result",
      );

      if (result.ok && recurring) await reschedule(post.id, intervalHours as number);
    }));
  } catch (error) {
    cronStatus.lastError = error instanceof Error ? error.message : String(error);
    logger.warn({ err: error }, "[social-cron] tick error");
  } finally {
    cronStatus.tickRunning = false;
    cronStatus.lastTickFinishedAt = new Date().toISOString();
  }
}

export function startSocialCron(port: number): void {
  if (startTimer || intervalTimer) return;
  cronStatus.running = true;
  cronStatus.startedAt = new Date().toISOString();

  startTimer = setTimeout(() => {
    startTimer = null;
    void tick(port);
    intervalTimer = setInterval(() => void tick(port), POLL_INTERVAL_MS);
  }, 5_000);

  logger.info(
    { intervalMs: POLL_INTERVAL_MS, publicBaseUrl: process.env.PUBLIC_BASE_URL || "missing" },
    "[social-cron] Social media cron started (embedded in API server)",
  );
}

export function stopSocialCron(): void {
  if (startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  cronStatus.running = false;
  cronStatus.tickRunning = false;
}
