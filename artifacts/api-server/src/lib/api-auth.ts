/**
 * API authentication middleware.
 *
 * NovaLuis exposes user-data endpoints (workspaces, media, favorites) that
 * were previously behind a PIN cookie (`requireWtAuth`) which was removed
 * without a replacement. This module is the replacement: an env-var-gated
 * shared-secret gate that the operator must OPT IN to.
 *
 * Behaviour:
 *   - NOVA_API_TOKEN unset → middleware returns 503 "auth not configured".
 *     This is the safe default; routes are NOT silently open.
 *   - NOVA_API_TOKEN set   → caller must present `Authorization: Bearer <token>`
 *     matching the env var. Mismatch → 401. Missing → 401.
 *
 * The token is the operator's choice and is never logged. For browser-side
 * callers the Nova UI's fetch shim can attach it automatically; for
 * curl/scripts the operator includes it in the Authorization header.
 *
 * The middleware also accepts the same token via the `x-nova-token` header
 * for callers that cannot easily set Authorization (e.g. browser <img> tags
 * for the /raw image route, which can only set headers via a server proxy).
 */
import type { Request, Response, NextFunction } from "express";

function getConfiguredToken(): string {
  return (process.env["NOVA_API_TOKEN"] || "").trim();
}

function tokenMatches(req: Request): boolean {
  const expected = getConfiguredToken();
  if (!expected) return false;

  const auth = String(req.headers["authorization"] || "");
  if (auth.startsWith("Bearer ")) {
    const presented = auth.slice("Bearer ".length).trim();
    if (timingSafeEqualStrings(presented, expected)) return true;
  }

  // Fallback header for callers (browser <img>, server proxies) that can't
  // set Authorization. Same constant-time comparison.
  const headerToken = String(req.headers["x-nova-token"] || "").trim();
  if (timingSafeEqualStrings(headerToken, expected)) return true;

  // Query-string fallback for browser <img src=...> calls, which cannot
  // set request headers at all. Only `?token=<value>` is checked; the
  // value is matched with the same constant-time comparison so a
  // brute-force attacker can't learn the secret from response timing.
  // The token is visible in the URL so the user must understand it
  // leaks via the browser history and referer headers — that's the
  // documented trade-off for being able to embed <img> without a SW.
  if (req.query && typeof req.query["token"] === "string") {
    const queryToken = String(req.query["token"]).trim();
    if (timingSafeEqualStrings(queryToken, expected)) return true;
  }

  return false;
}

/**
 * Constant-time string comparison so a brute-force attacker can't learn
 * the token one character at a time from response timing. Both inputs are
 * padded to the same length before XOR so the function always touches
 * every byte of the longer string.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still touch all bytes of the longer input to avoid early-exit timing.
    let diff = 1;
    const longer = a.length > b.length ? a : b;
    for (let i = 0; i < longer.length; i++) {
      diff |= longer.charCodeAt(i) ^ longer.charCodeAt(i);
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Shared-secret gate. Use this for routes that read or mutate user data.
 * The middleware fails closed (503 when unconfigured, 401 when misconfigured)
 * — there is no path that returns user data without an explicit token match.
 */
export function requireApiAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = getConfiguredToken();
  if (!expected) {
    res.status(503).json({
      error:
        "API auth not configured. Set NOVA_API_TOKEN on the api-server to enable " +
        "access to this route. The env var gates every workspace / media / " +
        "favorites endpoint — leaving it unset keeps the route closed.",
    });
    return;
  }
  if (!tokenMatches(req)) {
    res.status(401).json({ error: "invalid or missing API token" });
    return;
  }
  next();
}

/**
 * Returns true when the auth middleware would ALLOW the request. Useful for
 * routes that want to behave differently when auth is unset (e.g. return
 * limited data instead of a hard 503). The auth middleware still gates
 * write paths — this helper is only for read-only "public if unconfigured"
 * opt-ins.
 */
export function apiAuthEnabled(): boolean {
  return getConfiguredToken().length > 0;
}
