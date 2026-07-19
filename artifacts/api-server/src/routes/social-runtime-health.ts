import { Router } from "express";
import { getSocialCronStatus } from "../social-cron";

const router = Router();

router.get("/social/cron/status", (_req, res) => {
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  res.json({
    ...getSocialCronStatus(),
    pollIntervalMs: 60_000,
    publicBaseUrlConfigured: publicBaseUrl.startsWith("https://"),
    publicBaseUrl,
    embeddedWorker: true,
    siblingWorkerEnabled: process.env.SOCIAL_MEDIA_WORKER_ENABLED !== "0",
  });
});

export default router;
