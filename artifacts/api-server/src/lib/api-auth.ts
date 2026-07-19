import type { Request, Response, NextFunction } from "express";
import {
  hasValidOperatorSession,
  operatorSessionConfigured,
} from "./operator-session";

function getConfiguredToken(): string {
  return (process.env.NOVA_API_TOKEN || "").trim();
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let diff = 1;
    const longer = a.length > b.length ? a : b;
    for (let index = 0; index < longer.length; index++) {
      diff |= longer.charCodeAt(index) ^ longer.charCodeAt(index);
    }
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function tokenMatches(req: Request): boolean {
  const expected = getConfiguredToken();
  if (!expected) return false;

  const authorization = String(req.headers.authorization || "");
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  if (bearer && timingSafeEqualStrings(bearer[1]!.trim(), expected)) return true;

  const headerToken = String(req.headers["x-nova-token"] || "").trim();
  if (timingSafeEqualStrings(headerToken, expected)) return true;

  // Backward compatibility for existing installed PWAs. The handwritten
  // Pictures grid appends ?token= to <img> requests because image elements
  // cannot set custom headers. New browser sessions use the safer HttpOnly
  // cookie path, but removing this fallback would break existing thumbnails.
  const queryToken = typeof req.query?.token === "string"
    ? String(req.query.token).trim()
    : "";
  return timingSafeEqualStrings(queryToken, expected);
}

/**
 * Protect user-data and media routes through either a server API token or a
 * signed HttpOnly operator browser session created by /api/operator/unlock.
 */
export function requireApiAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (tokenMatches(req) || hasValidOperatorSession(req)) {
    next();
    return;
  }

  const tokenConfigured = Boolean(getConfiguredToken());
  const sessionConfigured = operatorSessionConfigured();
  if (!tokenConfigured && !sessionConfigured) {
    res.status(503).json({
      error: "protected API authentication is not configured",
      required: [
        "NOVA_API_TOKEN for server callers, or",
        "NOVA_OPERATOR_PIN/NOVA_WORK_TREE_PIN plus SESSION_SECRET for browser sessions",
      ],
    });
    return;
  }

  res.status(401).json({
    error: "operator authentication required",
    needPin: sessionConfigured,
  });
}

export function apiAuthEnabled(): boolean {
  return Boolean(getConfiguredToken()) || operatorSessionConfigured();
}
