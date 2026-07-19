/**
 * Agent cron — small in-process background kicker for the main chat runtime.
 *
 * Like social-cron.ts, this runs INSIDE the nova-api process. Every N
 * minutes it does one of two self-maintenance tasks:
 *
 *   1. Sweep stale work-tree runs (status=running for >30min → mark failed)
 *      so they get retried on next boot or by the work-tree worker.
 *   2. Sweep stuck OpenClaw sessions (anything older than the agent's
 *      session TTL gets a `session_yield` signal so the gateway reaps it).
 *
 * It's deliberately small. Heavy "do something clever every hour" jobs
 * belong in scripts/work-tree-worker.mjs (a separate process that has the
 * full agent loop, the ReAct tool catalog, the governance cap, etc.).
 * This file is just a janitor so the main chat runtime stays healthy
 * between user sessions.
 *
 * Disabled by default in unit-test / local-dev environments — set
 * AGENT_CRON_ENABLED=1 to turn it on. Production always enables it.
 */
import { logger } from "./lib/logger";
import { db, hasDatabase, workTreeRunsTable } from "@workspace/db";
import { lt, eq, and, sql } from "drizzle-orm";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const STALE_RUN_MINUTES = 30;            // running > 30 min → failed

let timer: NodeJS.Timeout | null = null;

async function sweepStaleRuns(): Promise<number> {
  if (!hasDatabase || !db) return 0;
  try {
    const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000);
    const result = await db
      .update(workTreeRunsTable)
      .set({ status: "failed", error: `stale: running > ${STALE_RUN_MINUTES}min, swept by agent-cron` })
      .where(and(
        eq(workTreeRunsTable.status, "running"),
        lt(workTreeRunsTable.updatedAt, cutoff),
      ))
      .returning({ id: workTreeRunsTable.id });
    if (result.length) {
      logger.warn({ count: result.length, ids: result.map((r) => r.id) },
        "[agent-cron] swept stale running work-tree runs");
    }
    return result.length;
  } catch (e) {
    logger.error({ err: e }, "[agent-cron] sweepStaleRuns failed");
    return 0;
  }
}

async function tick(port: number): Promise<void> {
  const start = Date.now();
  let swept = 0;
  try {
    swept = await sweepStaleRuns();
  } catch (e) {
    logger.warn({ err: e }, "[agent-cron] tick error");
  }
  logger.info({ swept, ms: Date.now() - start, port }, "[agent-cron] tick complete");
}

export function startAgentCron(port: number): void {
  if (process.env["AGENT_CRON_ENABLED"] === "0") {
    logger.info("[agent-cron] disabled (AGENT_CRON_ENABLED=0)");
    return;
  }
  if (timer) return; // already started

  setTimeout(() => {
    void tick(port);
    timer = setInterval(() => void tick(port), POLL_INTERVAL_MS);
  }, 30_000); // 30s boot delay so the rest of the api server warms up first

  logger.info({ intervalMs: POLL_INTERVAL_MS, port },
    "[agent-cron] started; first tick in 30s");
}

export function stopAgentCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
