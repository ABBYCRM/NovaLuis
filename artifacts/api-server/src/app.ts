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
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

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

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err, path: req.path, method: req.method }, "api error");
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({
    error: message,
    kind: err instanceof Error ? err.name : "unknown",
  });
});

if (process.env.NODE_ENV === "production") {
  const staticDir = process.env.NOVA_STATIC_DIR ?? path.resolve(process.cwd(), "nova-static");
  const indexHtml = path.join(staticDir, "index.html");

  if (fs.existsSync(indexHtml)) {
    logger.info({ staticDir }, "Serving Nova UI static files");
    app.use(express.static(staticDir, { index: false }));

    const BUILD_ID =
      (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 8) ||
      process.env.BUILD_ID ||
      String(Date.now());
    let indexHtmlCache: string | null = null;

    const renderIndexHtml = (): string => {
      if (indexHtmlCache != null) return indexHtmlCache;
      const raw = fs.readFileSync(indexHtml, "utf8");
      let rendered = raw;

      if (!rendered.includes("/assets/ui-preservation.css")) {
        rendered = rendered.replace(
          "</head>",
          '  <link rel="stylesheet" href="/assets/ui-preservation.css" />\n</head>',
        );
      }

      // Authentication must be parser-blocking and execute before the page is
      // interactive. Loading this only as a dynamically inserted child script
      // allowed a fast tap on Pictures to race the wrapper and surface HTTP 401.
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

      indexHtmlCache = rendered.replace(
        /(\/assets\/[A-Za-z0-9_\-./]+\.(?:js|css|png|jpe?g|svg|webp|gif|woff2?|ico))/g,
        `$1?v=${BUILD_ID}`,
      );
      indexHtmlCache = indexHtmlCache.replace(
        /navigator\.serviceWorker\.register\((['"])(\/sw\.js)(['"])\)/,
        "navigator.serviceWorker.register($1$2?v=" + BUILD_ID + "$3)",
      );
      logger.info({ buildId: BUILD_ID }, "Index HTML cache-busting version");
      return indexHtmlCache;
    };

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
