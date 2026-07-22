import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "nova_operator_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MS = 10 * 60 * 1000;
const SESSION_SIGNATURE_DOMAIN = "nova-operator-session:v2";

const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    const max = Math.max(a.length, b.length);
    const paddedA = Buffer.alloc(max);
    const paddedB = Buffer.alloc(max);
    a.copy(paddedA);
    b.copy(paddedB);
    timingSafeEqual(paddedA, paddedB);
    return false;
  }
  return timingSafeEqual(a, b);
}

function signingSecret(): string {
  return String(process.env.SESSION_SECRET || process.env.NOVA_API_TOKEN || "").trim();
}

function configuredPin(): string {
  const configured = String(
    process.env.NOVA_OPERATOR_PIN || process.env.NOVA_WORK_TREE_PIN || "",
  ).trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "" : "22";
}

export function operatorSessionConfigured(): boolean {
  return Boolean(signingSecret() && configuredPin());
}

function signature(expiresAt: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${SESSION_SIGNATURE_DOMAIN}:${expiresAt}`)
    .digest("hex");
}

function encodeSession(expiresAtMs: number, secret: string): string {
  const expiresAt = String(expiresAtMs);
  return `${expiresAt}.${signature(expiresAt, secret)}`;
}

function readCookie(req: Request, name: string): string {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export function hasValidOperatorSession(req: Request): boolean {
  const secret = signingSecret();
  if (!secret) return false;
  const token = readCookie(req, COOKIE_NAME);
  const separator = token.indexOf(".");
  if (separator <= 0) return false;
  const expiresAt = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  const expiresAtMs = Number(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return false;
  return constantTimeEqual(suppliedSignature, signature(expiresAt, secret));
}

export function requireOperatorSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (hasValidOperatorSession(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "operator session required", needPin: true });
}

export function handleOperatorSessionStatus(req: Request, res: Response): void {
  res.json({
    configured: operatorSessionConfigured(),
    authenticated: hasValidOperatorSession(req),
  });
}

export function handleOperatorUnlock(req: Request, res: Response): void {
  const secret = signingSecret();
  const expectedPin = configuredPin();
  if (!secret || !expectedPin) {
    res.status(503).json({
      error: "operator authentication is not configured",
      required: ["NOVA_OPERATOR_PIN or NOVA_WORK_TREE_PIN", "SESSION_SECRET or NOVA_API_TOKEN"],
    });
    return;
  }

  const clientKey = String(req.ip || req.socket.remoteAddress || "unknown");
  const now = Date.now();
  const state = failedAttempts.get(clientKey);
  if (state && state.lockedUntil > now) {
    res.status(429).json({ error: "too many failed PIN attempts", retryAfterMs: state.lockedUntil - now });
    return;
  }

  const suppliedPin = String(
    req.body && typeof req.body === "object"
      ? (req.body as { pin?: unknown }).pin ?? ""
      : "",
  ).trim();

  if (!constantTimeEqual(suppliedPin, expectedPin)) {
    const nextCount = (state?.count || 0) + 1;
    const lockedUntil = nextCount >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_MS : 0;
    failedAttempts.set(clientKey, { count: nextCount, lockedUntil });
    res.status(403).json({ error: "wrong PIN" });
    return;
  }

  failedAttempts.delete(clientKey);
  const expiresAtMs = now + SESSION_TTL_MS;
  res.cookie(COOKIE_NAME, encodeSession(expiresAtMs, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true, expiresAt: new Date(expiresAtMs).toISOString() });
}

export function clearOperatorSession(_req: Request, res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
  });
  res.json({ ok: true });
}
