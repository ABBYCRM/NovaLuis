#!/usr/bin/env node
/**
 * Social Media Cron Worker
 * Polls /api/social/due every 60 seconds and publishes pending posts via /api/social/publish/:id
 *
 * Auth: signs its own wt_session cookie using SESSION_SECRET (same mechanism as PIN unlock).
 */
import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const API_BASE = (process.env.NOVA_INTERNAL_API_BASE || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const INTERVAL = 60_000; // 1 minute

// ── Auth ──────────────────────────────────────────────────────────────────────
const DEV_SECRET = "nova-work-tree-dev-secret";

function authSecret() {
  return process.env.SESSION_SECRET || (process.env.NODE_ENV !== "production" ? DEV_SECRET : null);
}

function signSession(expMs, key) {
  const sig = createHmac("sha256", key).update(String(expMs)).digest("hex");
  return `${expMs}.${sig}`;
}

// Memoised session token — refreshed when within 30 min of expiry
let _session = null;
function sessionCookie() {
  const key = authSecret();
  if (!key) return "";
  const now = Date.now();
  if (!_session || _session.exp - now < 30 * 60 * 1000) {
    const exp = now + 12 * 60 * 60 * 1000; // 12 h
    _session = { token: signSession(exp, key), exp };
  }
  return `wt_session=${encodeURIComponent(_session.token)}`;
}

// ── API helper ────────────────────────────────────────────────────────────────
function log(msg, data) {
  const ts = new Date().toISOString();
  if (data) console.log(`[${ts}] [social-worker] ${msg}`, JSON.stringify(data));
  else       console.log(`[${ts}] [social-worker] ${msg}`);
}

async function apiFetch(path, opts = {}) {
  const cookie = sessionCookie();
  const r = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      Accept: "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  return r.json().catch(() => ({}));
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function tick() {
  try {
    const { posts, error } = await apiFetch("/social/due");
    if (error) { log("due-check error:", { error }); return; }
    if (!posts?.length) return;
    log(`Found ${posts.length} due post(s)`);
    await Promise.all(posts.map(async (post) => {
      log(`Publishing post #${post.id} → ${post.platform}/${post.content_type}`);
      const result = await apiFetch(`/social/publish/${post.id}`, { method: "POST" });
      log(`Post #${post.id}`, result);
    }));
  } catch (e) {
    log("tick error:", { message: e.message });
  }
}

log(`Social Media Worker started (interval ${INTERVAL / 1000}s).`);
if (!authSecret()) log("WARNING: No SESSION_SECRET found — auth will fail in production.");
await tick();
for (;;) {
  await sleep(INTERVAL);
  await tick();
}
