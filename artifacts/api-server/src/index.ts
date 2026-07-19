import app from "./app";
import { logger } from "./lib/logger";
import { resumeOpenClawRuns } from "./routes/work-tree";
import { startSocialCron } from "./social-cron";
import { startAgentCron } from "./agent-cron";
import { ensureSchema } from "./lib/db-migrate";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Self-healing schema bootstrap. Runs BEFORE listen() so the very first
// request after a fresh DB never sees a missing table. Idempotent and safe on
// every boot. Failure is visible but does not prevent health diagnostics.
void ensureSchema().catch((e) => {
  logger.error({ err: e }, "ensureSchema failed during boot");
});

app.listen(port, () => {
  logger.info({ port }, "Server listening");

  // Scheduled social media posts run independently of browser sessions.
  startSocialCron(port);

  // Janitor for stale persisted runs. Heavy execution belongs to the worker.
  startAgentCron(port);

  // When the dedicated DB-backed worker is enabled, it is the sole owner of
  // pending/running work-tree missions. This prevents startup reconciliation
  // from racing the worker and executing the same durable mission twice through
  // the shorter interactive OpenClaw path. API-only deployments can explicitly
  // disable the worker and retain the legacy reconciliation fallback.
  if (process.env.WORK_TREE_WORKER_ENABLED === "0") {
    void resumeOpenClawRuns().catch((resumeErr) => {
      logger.warn({ err: resumeErr }, "OpenClaw run reconciliation skipped");
    });
  } else {
    logger.info("Dedicated work-tree worker owns durable run reconciliation");
  }
});
