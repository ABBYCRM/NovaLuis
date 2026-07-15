/**
 * Social Media Cron — embedded in the API server process.
 *
 * Runs on an interval (default 60s) inside the same Node.js process as the
 * Express server. No separate Render service, no auth overhead — direct DB
 * access + internal HTTP call to the Composio execute endpoint.
 *
 * Usage: call startSocialCron() once after the server starts listening.
 */
import { db, hasDatabase, socialScheduledPostsTable } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { logger } from "./lib/logger";

const POLL_INTERVAL_MS = 60_000; // 1 minute

// ── Reschedule a recurring post ───────────────────────────────────────────────
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

// ── Publish one post (mirrors POST /social/publish/:id but in-process) ────────
async function publishPost(port: number, id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/social/publish/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await r.json() as { ok?: boolean; error?: string };
    return { ok: !!body.ok };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function tick(port: number) {
  if (!hasDatabase || !db) return;

  try {
    // Fetch all due pending posts (up to 20 at a time)
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

    logger.info({ count: duePosts.length }, "[social-cron] publishing due posts");

    await Promise.all(
      duePosts.map(async (post) => {
        const result = await publishPost(port, post.id);
        logger.info(
          { id: post.id, platform: post.platform, ok: result.ok },
          "[social-cron] publish result",
        );

        // Reschedule recurring posts after successful publish
        // interval_hours is not in the Drizzle schema type yet (added via migration),
        // so we access it via the raw DB row cast.
        const intervalHours = (post as Record<string, unknown>)["interval_hours"];
        if (result.ok && typeof intervalHours === "number" && intervalHours >= 1) {
          await reschedule(post.id, intervalHours);
        }
      }),
    );
  } catch (e) {
    logger.warn({ err: e }, "[social-cron] tick error");
  }
}

// ── Public: start the embedded cron ──────────────────────────────────────────
export function startSocialCron(port: number) {
  // Stagger the first run by 5s to let the server finish booting
  setTimeout(() => {
    void tick(port);
    setInterval(() => void tick(port), POLL_INTERVAL_MS);
  }, 5_000);

  logger.info(
    { intervalMs: POLL_INTERVAL_MS },
    "[social-cron] Social media cron started (embedded in API server)",
  );
}
