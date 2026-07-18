import app from "./app";
import { logger } from "./lib/logger";
import { resumeOpenClawRuns } from "./routes/work-tree";
import { startSocialCron } from "./social-cron";
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
// /api/integrations/google POST after a fresh DB never sees a missing
// table. Idempotent (every CREATE is IF NOT EXISTS), so safe to run on
// every boot. A failure here is logged but does NOT prevent the server
// from starting — the operator can still hit the API to see what's wrong.
void ensureSchema().catch((e) => {
  logger.error({ err: e }, "ensureSchema failed during boot");
});

app.listen(port, () => {
  logger.info({ port }, "Server listening");

  // Scheduled social media posts — runs inside this process, no separate worker needed.
  startSocialCron(port);

  void resumeOpenClawRuns().catch((resumeErr) => {
    logger.warn({ err: resumeErr }, "OpenClaw run reconciliation skipped");
  });
});
