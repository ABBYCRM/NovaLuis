/**
 * Playwright E2E — API smoke + Composio surface
 *
 * Drives the running API server over HTTP (no browser needed) and verifies
 * the critical surface the Nova UI depends on:
 *
 *   /healthz                        → { status: "ok" }
 *   /version                        → shape check (Render metadata fields)
 *   /integrations/composio/status   → always responds (configured or not)
 *
 * The browser-based UI smoke tests live in chat-ui-smoke.test.ts.
 *
 * Environment:
 *   API_E2E_BASE_URL   Base URL of the running API server.
 *                      Defaults to http://localhost:5000 (dev workflow port).
 *   TEST_TIMEOUT_MS    Per-assertion timeout. Default 10 000.
 */

import { describe, it, expect, beforeAll } from "vitest";

const BASE = (process.env.API_E2E_BASE_URL ?? "http://localhost:5000").replace(/\/$/, "");
const TIMEOUT = Number(process.env.TEST_TIMEOUT_MS ?? 10_000);

/**
 * Thin fetch wrapper that retries once on ECONNREFUSED so a slow startup
 * doesn't immediately fail CI.
 */
async function api(path: string, init?: RequestInit): Promise<Response> {
  const url = `${BASE}${path}`;
  try {
    return await fetch(url, init);
  } catch (err) {
    // One retry after a short pause for slow server starts.
    await new Promise((r) => setTimeout(r, 2_000));
    return fetch(url, init);
  }
}

// ---------------------------------------------------------------------------
// /healthz
// ---------------------------------------------------------------------------
describe("GET /healthz", () => {
  it("responds 200 with status:ok", async () => {
    const res = await api("/healthz");
    expect(res.status, "HTTP status").toBe(200);
    const body = (await res.json()) as unknown;
    expect(body).toMatchObject({ status: "ok" });
  }, TIMEOUT);

  it("returns JSON content-type", async () => {
    const res = await api("/healthz");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// /version
// ---------------------------------------------------------------------------
describe("GET /version", () => {
  it("responds 200 with expected shape", async () => {
    const res = await api("/version");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // All these fields must be present regardless of value.
    for (const field of ["commit", "branch", "repository", "serviceId", "serviceName", "render"]) {
      expect(body, `field "${field}" missing from /version`).toHaveProperty(field);
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// /integrations/composio/status
// ---------------------------------------------------------------------------
describe("GET /integrations/composio/status", () => {
  it("always responds with a valid JSON body (configured or not)", async () => {
    const res = await api("/integrations/composio/status");
    // The endpoint returns 200 regardless of whether a key is configured.
    expect([200, 502], "unexpected status from composio/status").toContain(res.status);
    const body = (await res.json()) as Record<string, unknown>;
    // Always has 'configured' boolean.
    expect(typeof body.configured, "composio/status.configured must be boolean").toBe("boolean");
  }, TIMEOUT);

  it("reports credentialState when not configured", async () => {
    const res = await api("/integrations/composio/status");
    const body = (await res.json()) as Record<string, unknown>;
    if (!body.configured) {
      expect(body.credentialState).toBe("missing");
      expect(body.ready).toBe(false);
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// /openclaw/status  (may be unavailable in dev — tolerated)
// ---------------------------------------------------------------------------
describe("GET /openclaw/status", () => {
  it("responds with status json (ready or unavailable)", async () => {
    const res = await api("/openclaw/status");
    expect([200, 503]).toContain(res.status);
    const body = (await res.json()) as Record<string, unknown>;
    expect(["ready", "unavailable"]).toContain(body.status);
  }, TIMEOUT);
});
