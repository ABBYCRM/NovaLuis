import { logger } from "./lib/logger";
import { db, hasDatabase, workTreeRunsTable } from "@workspace/db";
import { lt, eq, and } from "drizzle-orm";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const configuredStaleMinutes = Number(process.env.AGENT_STALE_RUN_MINUTES || 180);
const STALE_RUN_MINUTES = Number.isFinite(configuredStaleMinutes)
  ? Math.max(30, configuredStaleMinutes)
  : 180;

let startTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

async function sweepStaleRuns(): Promise<number> {
  if (!hasDatabase || !db) return 0;
  try {
    const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000);
    const result = await db
      .update(workTreeRunsTable)
      .set({
        status: "failed",
        error: `stale: no durable-run progress for >${STALE_RUN_MINUTES}min, swept by agent-cron`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(workTreeRunsTable.status, "running"),
        lt(workTreeRunsTable.updatedAt, cutoff),
      ))
      .returning({ id: workTreeRunsTable.id });
    if (result.length) {
      logger.warn(
        { count: result.length, ids: result.map((row) => row.id), staleMinutes: STALE_RUN_MINUTES },
        "[agent-cron] swept stale running work-tree runs",
      );
    }
    return result.length;
  } catch (error) {
    logger.error({ err: error }, "[agent-cron] sweepStaleRuns failed");
    return 0;
  }
}

async function tick(port: number): Promise<void> {
  const startedAt = Date.now();
  let swept = 0;
  try {
    swept = await sweepStaleRuns();
  } catch (error) {
    logger.warn({ err: error }, "[agent-cron] tick error");
  }
  logger.info(
    { swept, ms: Date.now() - startedAt, port, staleMinutes: STALE_RUN_MINUTES },
    "[agent-cron] tick complete",
  );
}

export function startAgentCron(port: number): void {
  if (process.env.AGENT_CRON_ENABLED === "0") {
    logger.info("[agent-cron] disabled (AGENT_CRON_ENABLED=0)");
    return;
  }
  if (startTimer || intervalTimer) return;

  startTimer = setTimeout(() => {
    startTimer = null;
    void tick(port);
    intervalTimer = setInterval(() => void tick(port), POLL_INTERVAL_MS);
  }, 30_000);

  logger.info(
    { intervalMs: POLL_INTERVAL_MS, port, staleMinutes: STALE_RUN_MINUTES },
    "[agent-cron] started; first tick in 30s",
  );
}

export function stopAgentCron(): void {
  if (startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
