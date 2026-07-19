import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import pinoHttp from "pino-http";
import router from "./routes";
import instagramPublishRouter from "./routes/instagram-publish";
import { logger } from "./lib/logger";
import { normalizeSocialSchedulePayload } from "./lib/social-schedule-compat";
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

// The established Scheduled renderer reads legacy snake_case fields, while
// Drizzle returns camelCase properties. Normalize only the exact GET list
// response, additively, before the aggregate router sends it. Request bodies,
// database columns, publishing routes, and newer camelCase clients are unchanged.
app.use("/api/social/schedule", (req, res, next) => {
  if (req.method !== "GET" || req.path !== "/") {
    next();
    return;
  }
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => originalJson(normalizeSocialSchedulePayload(body))) as typeof res.json;
  next();
});

app.use("/api", router);

// Global error handler — every API error returns JSON, not Express's
// default HTML error page. This makes the actual cause visible in the
// Settings → Integrations "Save failed" toast and in curl, instead of
// hiding it behind "<pre>Internal Server Error</pre>". Without this
// the operator has no way to tell the difference between "DB is down",
// "schema not migrated", "value too long", and "DB write conflict".
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Duplicate the request logger's signature so the operator can grep
  // these in the DO runtime log stream the same way as every other
  // error. We deliberately include the stack when not in production.
  logger.error({ err, path: _req.path, method: _req.method }, "api error");
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({
    error: message,
    kind: err instanceof Error ? err.name : "unknown",
  });
});

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

      // UI preservation boundary — keep the large, handwritten index.html as
      // the visual and behavioral source of truth. Confirmed post-style and
      // navigation repairs load after the inline implementation, so they cannot
      // replace chat storage, API routes, persistence, or workspace behavior.
      // Guards keep injection idempotent if either asset is linked directly later.
      let rendered = raw;
      if (!rendered.includes("/assets/ui-preservation.css")) {
        rendered = rendered.replace(
          "</head>",
          '  <link rel="stylesheet" href="/assets/ui-preservation.css" />\n</head>',
        );
      }
      // The auth recovery wrapper must be parser-loaded before the navigation
      // repair so a fast first tap on Pictures cannot race its installation.
      if (!rendered.includes("/assets/operator-session-auth.js")) {
        rendered = rendered.replace(
          "</body>",
          '  <script src="/assets/operator-session-auth.js"></script>\n</body>',
        );
      }
      if (!rendered.includes("/assets/ui-navigation-preservation.js")) {
        rendered = rendered.replace(
          "</body>",
          '  <script src="/assets/ui-navigation-preservation.js"></script>\n</body>',
        );
      }

      // The 2026-07-18 Reel removal: the social-media-guard.js stub used
      // to silently rewrite reel→post behind the user's back. It was a
      // stub the user explicitly flagged. The UI now no longer offers
      // "reel" as a content-type option (see PLATFORMS in index.html),
      // so the guard is no longer needed and is no longer injected.
      // The Reel option can come back when a real video pipeline ships.
      indexHtmlCache = rendered.replace(
        /(\/assets\/[A-Za-z0-9_\-./]+\.(?:js|css|png|jpe?g|svg|webp|gif|woff2?|ico))/g,
        `$1?v=${BUILD_ID}`,
      );
      // Also stamp the service-worker registration with the same BUILD_ID
      // so a new deploy immediately invalidates the user's cached bundle.
      // Without this, returning users stay on the old sw.js (and therefore
      // the old index.html) for up to 24h, which would freeze them on
      // any code bug fixed in a later deploy.
      indexHtmlCache = indexHtmlCache.replace(
        /navigator\.serviceWorker\.register\((['"])(\/sw\.js)(['"])\)/,
        "navigator.serviceWorker.register($1$2?v=" + BUILD_ID + "$3)",
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
