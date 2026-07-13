import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const isProduction = process.env.NODE_ENV === "production";
const trustProxyHops = Math.max(
  0,
  Math.min(5, Number(process.env.TRUST_PROXY_HOPS ?? (isProduction ? 1 : 0))),
);
const allowedOrigins = new Set(
  [
    process.env.PUBLIC_APP_ORIGIN,
    ...(process.env.CORS_ALLOWED_ORIGINS ?? "").split(","),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value)),
);

app.disable("x-powered-by");
if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);

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

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), payment=(), usb=()",
  );
  if (isProduction && req.secure) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
});

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.size === 0) {
        callback(null, false);
        return;
      }
      callback(null, allowedOrigins.has(origin));
    },
  }),
);
app.use(express.json({ limit: "2mb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "256kb" }));

app.use("/api", router);

if (isProduction) {
  const staticDir =
    process.env.NOVA_STATIC_DIR ?? path.resolve(process.cwd(), "nova-static");
  const indexHtml = path.join(staticDir, "index.html");

  if (fs.existsSync(indexHtml)) {
    logger.info({ staticDir }, "Serving BOS OMEGA static files");
    app.use(
      express.static(staticDir, {
        index: false,
        dotfiles: "deny",
        fallthrough: true,
      }),
    );

    const BUILD_ID =
      (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 12) ||
      (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 12) ||
      process.env.BUILD_ID ||
      String(Date.now());
    let indexHtmlCache: string | null = null;
    const renderIndexHtml = (): string => {
      if (indexHtmlCache != null) return indexHtmlCache;
      const raw = fs.readFileSync(indexHtml, "utf8");
      indexHtmlCache = raw.replace(
        /(\/assets\/[A-Za-z0-9_\-./]+\.(?:js|css|png|jpe?g|svg|webp|gif|woff2?|ico))/g,
        `$1?v=${BUILD_ID}`,
      );
      logger.info({ buildId: BUILD_ID }, "Static asset build identity");
      return indexHtmlCache;
    };

    app.get("/skills", (_req, res) => {
      const skillsHtml = path.join(staticDir, "skills.html");
      if (!fs.existsSync(skillsHtml)) {
        res.status(404).type("html").send("skills.html not found");
        return;
      }
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").sendFile(skillsHtml);
    });

    app.get(/^(?!\/api).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").send(renderIndexHtml());
    });
  } else {
    logger.warn({ staticDir }, "Static application not found");
  }
}

export default app;
