import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE = "wt_session";
const TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILS = 8;
const LOCKOUT_MS = 10 * 60 * 1000;
const attempts = new Map<string, { fails: number; until: number }>();

function configuredPin(): string | null {
  const value = process.env.NOVA_WORK_TREE_PIN?.trim() ?? "";
  if (value) return value;
  if (process.env.NODE_ENV !== "production") return "22";
  return null;
}

function secret(): string | null {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") return null;
  return "nova-work-tree-dev-secret";
}

function mac(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}
function sign(expMs: number, key: string): string {
  return `${expMs}.${mac(String(expMs), key)}`;
}
function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(Buffer.from(left), Buffer.from(right));
  } catch {
    return false;
  }
}
function validSession(token: string | undefined): boolean {
  if (!token) return false;
  const key = secret();
  if (!key) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiry = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return safeEqual(signature, mac(expiry, key));
}
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}
function validPeerKey(req: Request): boolean {
  const shared = process.env.SUPERNOVA_API_KEY || process.env.OPENCLAW_API_KEY || "";
  if (!shared) return false;
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  return Boolean(match && safeEqual(match[1]!.trim(), shared));
}

export function isWtAuthorized(req: Request): boolean {
  return validSession(readCookie(req, COOKIE)) || validPeerKey(req);
}

export function requireWtAuth(req: Request, res: Response, next: NextFunction): void {
  if (isWtAuthorized(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "locked", needPin: true });
}

export function handleUnlock(req: Request, res: Response): void {
  const key = secret();
  const expectedPin = configuredPin();
  if (!key || !expectedPin) {
    res.status(503).json({ error: "auth not configured" });
    return;
  }

  const who = req.ip ?? "unknown";
  const now = Date.now();
  const current = attempts.get(who);
  if (current && current.until > now) {
    res.status(429).json({ error: "too many attempts" });
    return;
  }

  const supplied = String((req.body as { pin?: unknown } | undefined)?.pin ?? "").trim();
  if (!supplied || !safeEqual(supplied, expectedPin)) {
    const fails = (current?.fails ?? 0) + 1;
    attempts.set(who, { fails, until: fails >= MAX_FAILS ? now + LOCKOUT_MS : 0 });
    res.status(403).json({ error: "wrong pin" });
    return;
  }

  attempts.delete(who);
  const expiresAt = now + TTL_MS;
  res.cookie(COOKIE, sign(expiresAt, key), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_MS,
    path: "/api",
  });
  res.json({ ok: true, expiresAt: new Date(expiresAt).toISOString() });
}
