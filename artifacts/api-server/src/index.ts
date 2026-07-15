import app from "./app";
import { logger } from "./lib/logger";
import { resumeOpenClawRuns } from "./routes/work-tree";
import { startSocialCron } from "./social-cron";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Scheduled social media posts — runs inside this process, no separate worker needed.
  startSocialCron(port);

  void resumeOpenClawRuns().catch((resumeErr) => {
    logger.warn({ err: resumeErr }, "OpenClaw run reconciliation skipped");
  });
});
