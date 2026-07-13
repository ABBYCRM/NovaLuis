import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    censor: "[REDACTED]",
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
      "req.headers['x-subscription-token']",
      "req.headers['steel-api-key']",
      "res.headers['set-cookie']",
      "authorization",
      "cookie",
      "apiKey",
      "accessToken",
      "refreshToken",
      "clientSecret",
      "password",
      "pin",
      "token",
      "fields.client_secret",
      "fields.refresh_token",
      "fields.access_token",
      "err.config.headers.Authorization",
      "err.config.headers.authorization",
      "err.request.headers.Authorization",
      "err.request.headers.authorization",
    ],
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
