import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(indexHtml);
    });
  } else {
    logger.warn({ staticDir }, "Nova static dir not found, skipping static serve");
  }
}

export default app;
