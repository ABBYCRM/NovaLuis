import app from "./app";
import { logger } from "./lib/logger";
import { resumeOpenClawRuns } from "./routes/work-tree";
import { startSocialCron } from "./social-cron";
import { startAgentCron } from "./agent-cron";
import { ensureSchema } from "./lib/db-migrate";

const rawPort = process.env.PORT;
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");

const port = Number(rawPort);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Complete the idempotent schema bootstrap before the server accepts traffic.
// The previous fire-and-forget call contradicted this contract and allowed the
// first workspace/social request to race missing-table creation.
try {
  await ensureSchema();
} catch (error) {
  logger.error({ err: error }, "ensureSchema failed during boot");
}

app.listen(port, () => {
  logger.info({ port }, "Server listening");
  startSocialCron(port);
  startAgentCron(port);

  if (process.env.WORK_TREE_WORKER_ENABLED === "0") {
    void resumeOpenClawRuns().catch((resumeError) => {
      logger.warn({ err: resumeError }, "OpenClaw run reconciliation skipped");
    });
  } else {
    logger.info("Dedicated work-tree worker owns durable run reconciliation");
  }
});
