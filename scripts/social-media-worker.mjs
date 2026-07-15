#!/usr/bin/env node
/**
 * Social Media Cron Worker
 * - Polls /api/social/due every 60 seconds
 * - Publishes due posts via /api/social/publish/:id
 * - For recurring posts (interval_hours set), reschedules after publish
 *
 * Auth: self-signs a wt_session cookie using SESSION_SECRET.
 */
import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const API_BASE = (process.env.NOVA_INTERNAL_API_BASE || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const INTERVAL_MS = 60_000;

// ── Auth ──────────────────────────────────────────────────────────────────────
const DEV_SECRET = "nova-work-tree-dev-secret";
function authSecret() {
  return process.env.SESSION_SECRET || (process.env.NODE_ENV !== "production" ? DEV_SECRET : null);
}
function signSession(expMs, key) {
  return `${expMs}.${createHmac("sha256", key).update(String(expMs)).digest("hex")}`;
}
let _session = null;
function sessionCookie() {
  const key = authSecret();
  if (!key) return "";
  const now = Date.now();
  if (!_session || _session.exp - now < 30 * 60 * 1000) {
    const exp = now + 12 * 60 * 60 * 1000;
    _session = { token: signSession(exp, key), exp };
  }
  return `wt_session=${encodeURIComponent(_session.token)}`;
}

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, data) {
  const ts = new Date().toISOString();
  if (data) console.log(`[${ts}] [social-worker] ${msg}`, JSON.stringify(data));
  else       console.log(`[${ts}] [social-worker] ${msg}`);
}

// ── API fetch ─────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const cookie = sessionCookie();
  const r = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

// ── Reschedule recurring post ─────────────────────────────────────────────────
async function reschedulePost(post) {
  if (!post.interval_hours || post.interval_hours < 1) return;
  const nextAt = new Date(Date.now() + post.interval_hours * 60 * 60 * 1000).toISOString();
  const r = await apiFetch(`/social/schedule/${post.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "pending", scheduledAt: nextAt }),
  });
  if (r.ok) {
    log(`Post #${post.id} rescheduled → ${nextAt} (+${post.interval_hours}h)`);
  } else {
    log(`Post #${post.id} reschedule failed`, r.data);
  }
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function tick() {
  try {
    const { ok, data } = await apiFetch("/social/due");
    if (!ok) { log("due-check error", data); return; }
    const posts = data.posts || [];
    if (!posts.length) return;
    log(`${posts.length} due post(s) to publish`);

    await Promise.all(posts.map(async (post) => {
      log(`Publishing #${post.id} → ${post.platform}/${post.content_type} (interval: ${post.interval_hours || "none"}h)`);
      const result = await apiFetch(`/social/publish/${post.id}`, { method: "POST" });
      log(`#${post.id} publish result`, { ok: result.ok, status: result.status });
      if (result.ok) await reschedulePost(post);
    }));
  } catch (e) {
    log("tick error", { message: e.message });
  }
}

log(`Social Media Worker started (polling every ${INTERVAL_MS / 1000}s)`);
if (!authSecret()) log("WARNING: No SESSION_SECRET — auth will fail in production");

await tick();
for (;;) {
  await sleep(INTERVAL_MS);
  await tick();
}
