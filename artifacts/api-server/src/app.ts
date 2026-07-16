import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import pinoHttp from "pino-http";
import router from "./routes";
import instagramPublishRouter from "./routes/instagram-publish";
import { logger } from "./lib/logger";
import "./lib/vector-memory-fetch-hook";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Normalize and validate Instagram media arguments at the application boundary.
// This catches legacy or external callers that use imageUrl/videoUrl and stops an
// invalid container request before it reaches Composio. URLs are never logged.
app.use("/api/integrations/composio/execute", (req, res, next) => {
  const body = req.body && typeof req.body === "object"
    ? req.body as Record<string, unknown>
    : null;
  if (!body) {
    next();
    return;
  }

  const toolSlug = String(body.toolSlug || body.tool_slug || "");
  if (toolSlug !== "INSTAGRAM_CREATE_MEDIA_CONTAINER") {
    next();
    return;
  }

  const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
    ? body.arguments as Record<string, unknown>
    : {};
  const imageUrl = String(args.image_url || args.imageUrl || body.image_url || body.imageUrl || "").trim();
  const videoUrl = String(args.video_url || args.videoUrl || body.video_url || body.videoUrl || "").trim();

  if (imageUrl) args.image_url = imageUrl;
  if (videoUrl) args.video_url = videoUrl;
  delete args.imageUrl;
  delete args.videoUrl;
  body.arguments = args;

  if (!imageUrl && !videoUrl) {
    res.status(422).json({
      error: "Instagram container request blocked before Composio: image_url or video_url is required.",
      code: "INSTAGRAM_MEDIA_URL_MISSING",
      toolSlug,
      argumentKeys: Object.keys(args).sort(),
    });
    return;
  }

  next();
});

// Instagram publishing is mounted at the application boundary, before the
// legacy aggregate router. This guarantees POST /api/social/publish/:id reaches
// the durable-media/two-step publisher and cannot fall through to the older
// social-media.ts implementation that removes data: images and sends no
// image_url. The response marker makes the active production path observable.
app.use(
  "/api",
  (req, res, next) => {
    if (req.method === "POST" && /^\/social\/publish\/\d+$/.test(req.path)) {
      res.setHeader("X-Nova-Instagram-Publisher", "hardened-v3");
    }
    next();
  },
  instagramPublishRouter,
);
app.use("/api", router);

// In production (Railway etc), serve the Nova UI as static files.
// NOVA_STATIC_DIR can override the location.
if (process.env["NODE_ENV"] === "production") {
  const staticDir =
    process.env["NOVA_STATIC_DIR"] ?? path.resolve(process.cwd(), "nova-static");
  const indexHtml = path.join(staticDir, "index.html");

  if (fs.existsSync(indexHtml)) {
    logger.info({ staticDir }, "Serving Nova UI static files");
    app.use(express.static(staticDir, { index: false }));

    // Cache-busting: stamp a per-deploy version onto fixed-name static assets
    // (e.g. /assets/bob.js, /assets/nova-bg.png) so every new build is a "new
    // URL" the browser must re-fetch. Vite-style hashing isn't used here, so we
    // derive the version from the deploy's git commit (Render injects it),
    // falling back to server start time. The HTML itself is always revalidated.
    const BUILD_ID =
      (process.env["RENDER_GIT_COMMIT"] ?? "").slice(0, 8) ||
      (process.env["BUILD_ID"] ?? "") ||
      String(Date.now());
    let indexHtmlCache: string | null = null;
    const renderIndexHtml = (): string => {
      if (indexHtmlCache != null) return indexHtmlCache;
      const raw = fs.readFileSync(indexHtml, "utf8");
      // Keep the handwritten production HTML intact while loading a small guard
      // after its inline Social Media script. The guard removes image-only Reel
      // selection until a real video URL pipeline exists.
      const withSocialGuard = raw.includes("/assets/social-media-guard.js")
        ? raw
        : raw.replace(
            /<\/body>/i,
            '<script src="/assets/social-media-guard.js"></script>\n</body>',
          );
      indexHtmlCache = withSocialGuard.replace(
        /(\/assets\/[A-Za-z0-9_\-./]+\.(?:js|css|png|jpe?g|svg|webp|gif|woff2?|ico))/g,
        `$1?v=${BUILD_ID}`,
      );
      logger.info({ buildId: BUILD_ID }, "Index HTML cache-busting version");
      return indexHtmlCache;
    };

    // Serve skills catalog page at /skills (before the SPA catch-all)
    app.get("/skills", (_req, res) => {
      const skillsHtml = path.join(staticDir, "skills.html");
      if (fs.existsSync(skillsHtml)) {
        res.setHeader("Cache-Control", "no-cache");
        res.type("html").sendFile(skillsHtml);
      } else {
        res.status(404).type("html").send("skills.html not found");
      }
    });

    app.get(/^(?!\/api).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").send(renderIndexHtml());
    });
  } else {
    logger.warn({ staticDir }, "Nova static dir not found, skipping static serve");
  }
}

export default app;
