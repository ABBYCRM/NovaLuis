import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// PIN gate for the Work Tree ("Super Nova") API. These endpoints can trigger
// dangerous tool execution (shell/code/file) in the worker when SUPER_NOVA_EXEC
// is on, so they must not be reachable unauthenticated. Unlocking with the PIN
// issues an HMAC-signed, 12h httpOnly cookie; every other route requires it.

const COOKIE = "wt_session";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
// Dev-only fallback PIN — never accepted in production.
const DEV_FALLBACK_PIN = "22";

// Brute-force throttle: the PIN is short by design, so cap failed unlock
// attempts per client IP and lock out for a cooldown once exceeded.
const MAX_FAILS = 8;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes
const attempts = new Map<string, { fails: number; until: number }>();

function acceptedPins(): string[] {
  const configured = String(process.env.NOVA_WORK_TREE_PIN || "").trim();
  // The dev fallback PIN is never a valid credential in production; callers
  // must set NOVA_WORK_TREE_PIN. This mirrors the SESSION_SECRET policy.
  const devPin = process.env.NODE_ENV !== "production" ? DEV_FALLBACK_PIN : null;
  return [...new Set([devPin, configured].filter((p): p is string => Boolean(p)))];
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function isAcceptedPin(supplied: string): boolean {
  if (!supplied) return false;
  return acceptedPins().some((candidate) => sameSecret(supplied, candidate));
}

// Fail closed: a missing SESSION_SECRET must NOT silently fall back to a
// predictable value (that would let anyone forge a valid cookie). We only
// allow a dev fallback when not running in production.
function secret(): string | null {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") return null;
  return "nova-work-tree-dev-secret";
}

function mac(expStr: string, key: string): string {
  return createHmac("sha256", key).update(expStr).digest("hex");
}

function sign(expMs: number, key: string): string {
  return `${expMs}.${mac(String(expMs), key)}`;
}

function isValid(token: string | undefined): boolean {
  if (!token) return false;
  const key = secret();
  if (!key) return false; // fail closed when no signing secret is configured
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expMs = Number(expStr);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expected = mac(expStr, key);
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return undefined;
}

// Server-to-server bypass: a trusted peer (Supernova) may call gated endpoints
// with the shared API key instead of the operator PIN cookie. This is the same
// key Supernova validates inbound dispatches with, so it's a symmetric trust.
function hasValidPeerKey(req: Request): boolean {
  const shared = process.env.SUPERNOVA_API_KEY || process.env.OPENCLAW_API_KEY || "";
  if (!shared) return false;
  const auth = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return false;
  const supplied = m[1]!.trim();
  if (supplied.length !== shared.length) return false;
  try {
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(shared));
  } catch {
    return false;
  }
}

export function requireWtAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isValid(readCookie(req, COOKIE)) || hasValidPeerKey(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "locked", needPin: true });
}

export function handleUnlock(req: Request, res: Response): void {
  const key = secret();
  if (!key) {
    res.status(503).json({ error: "auth not configured" });
    return;
  }

  const who = req.ip ?? "unknown";
  const now = Date.now();
  const rec = attempts.get(who);
  if (rec && rec.until > now) {
    res.status(429).json({ error: "too many attempts" });
    return;
  }

  const supplied = String(
    (req.body as { pin?: unknown } | undefined)?.pin ?? "",
  ).trim();
  if (!isAcceptedPin(supplied)) {
    const fails = (rec?.fails ?? 0) + 1;
    attempts.set(who, {
      fails,
      until: fails >= MAX_FAILS ? now + LOCKOUT_MS : 0,
    });
    res.status(403).json({ error: "wrong pin" });
    return;
  }

  attempts.delete(who);
  const expMs = now + TTL_MS;
  res.cookie(COOKIE, sign(expMs, key), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_MS,
    // Scoped to /api so a single PIN unlock also covers the other sensitive
    // surfaces (integrations credential store + knowledge base), not just
    // /api/work-tree.
    path: "/api",
  });
  res.json({ ok: true, expiresAt: new Date(expMs).toISOString() });
}
