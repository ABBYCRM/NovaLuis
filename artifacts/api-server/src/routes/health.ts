import { Router, type IRouter } from "express";

const router: IRouter = Router();
const startedAt = new Date().toISOString();

router.get("/healthz", (_req, res) => {
  const commit =
    process.env.RENDER_GIT_COMMIT ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    "unknown";
  res.json({
    status: "ok",
    system: "BOS OMEGA",
    service: "nova-api",
    commit,
    buildId: process.env.BUILD_ID ?? commit.slice(0, 12),
    startedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    node: process.version,
  });
});

export default router;
