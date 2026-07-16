/**
 * Social Media Cron — embedded in the API server process.
 *
 * Every tick (default 60s):
 *  1. Run due CAMPAIGNS via POST /social/campaigns/run-due
 *     → each campaign generates FRESH, UNIQUE content (new caption + new image) then publishes
 *  2. Run due STANDALONE recurring posts via the scheduled-posts table
 *     → REGENERATES caption + image before publishing (different content every time)
 *
 * This guarantees: auto-posts for the same subject are NEVER identical.
 */
import { db, hasDatabase, socialScheduledPostsTable } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { logger } from "./lib/logger";
import { generateCaption, generateImage, pickVariationAngle } from "./lib/social-ai";

const POLL_INTERVAL_MS = 60_000;

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
  const description = (post as Record<string, unknown>).description as string | undefined;
  if (!description) return null; // no description = can't regenerate

  const platform = post.platform;
  const contentType = post.contentType;
  const tone = post.tone || "motivational";
  const spec = PLATFORM_SPECS[platform]?.[contentType] ?? { bitdeerSize: "1024x1024", geminiAspect: "1:1" };
  const maxChars = CAPTION_LIMITS[platform] ?? 2200;

  // Pick a different angle each time — the full set cycles across 18 distinct approaches
  const variationAngle = pickVariationAngle(); // time-based rotation

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

    // Regenerate image too
    const imagePrompt = `Professional ${platform} ${contentType} social media image.
Subject: ${description}. Angle: ${variationAngle}. Tone: ${tone}.
Do NOT include text overlays or watermarks.`;

    let imageUrl = "";
    try {
      const img = await generateImage(imagePrompt, spec.bitdeerSize, spec.geminiAspect);
      imageUrl = img.url;
    } catch { /* non-fatal — post without image */ }

    return { caption, hashtags, imageUrl };
  } catch (e) {
    logger.warn({ err: e, postId: post.id }, "[social-cron] content regeneration failed, using stored content");
    return null;
  }
}

// ── Step 2: publish a post via the social publish endpoint ───────────────────
async function publishPost(port: number, id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/social/publish/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await r.json() as { ok?: boolean; error?: string };
    return { ok: !!body.ok, error: body.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Step 3: reschedule a recurring standalone post ───────────────────────────
async function reschedule(id: number, intervalHours: number) {
  const nextAt = new Date(Date.now() + intervalHours * 60 * 60 * 1000);
  await db!
    .update(socialScheduledPostsTable)
    .set({
      status: "pending",
      scheduledAt: nextAt,
      publishedAt: undefined as unknown as Date,
      errorMessage: undefined as unknown as string,
    })
    .where(eq(socialScheduledPostsTable.id, id));
  logger.info({ id, nextAt, intervalHours }, "[social-cron] rescheduled recurring post");
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function tick(port: number) {
  if (!hasDatabase || !db) return;

  // ── A. Run due campaigns (fresh content every time) ───────────────────────
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/social/campaigns/run-due`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await r.json() as { ran?: number; campaigns?: unknown[] };
    if (body.ran && body.ran > 0) {
      logger.info({ ran: body.ran, campaigns: body.campaigns }, "[social-cron] campaigns ran");
    }
  } catch (e) {
    logger.warn({ err: e }, "[social-cron] campaign run-due error");
  }

  // ── B. Publish due standalone scheduled posts ─────────────────────────────
  try {
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

    if (!duePosts.length) return;

    logger.info({ count: duePosts.length }, "[social-cron] publishing due standalone posts");

    await Promise.all(
      duePosts.map(async (post) => {
        const intervalHours = (post as Record<string, unknown>)["interval_hours"];
        const isRecurring = typeof intervalHours === "number" && intervalHours >= 1;

        // For recurring posts: regenerate fresh caption + image BEFORE publishing.
        // This ensures every auto-post on the same subject is unique.
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
        logger.info(
          { id: post.id, platform: post.platform, ok: result.ok, recurring: isRecurring },
          "[social-cron] publish result",
        );

        // Reschedule recurring posts after successful publish
        if (result.ok && isRecurring) {
          await reschedule(post.id, intervalHours as number);
        }
      }),
    );
  } catch (e) {
    logger.warn({ err: e }, "[social-cron] standalone posts tick error");
  }
}

// ── Public ────────────────────────────────────────────────────────────────────
export function startSocialCron(port: number) {
  setTimeout(() => {
    void tick(port);
    setInterval(() => void tick(port), POLL_INTERVAL_MS);
  }, 5_000);

  logger.info(
    { intervalMs: POLL_INTERVAL_MS },
    "[social-cron] Social media cron started (embedded in API server)",
  );
}
