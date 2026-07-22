/**
 * API E2E — smoke tests for the critical API surface the Nova UI depends on.
 *
 * Drives the running API server over HTTP (no browser needed):
 *
 *   GET /healthz                      → { status: "ok" }
 *   GET /version                      → shape check (Render metadata fields)
 *   GET /integrations/composio/status → always responds (configured or not)
 *   GET /openclaw/status              → ready or unavailable
 *   POST /fluidvoice/pair             → operator-session protected pairing
 *   GET /fluidvoice/status            → paired device-token verification
 *
 * The server is started by the vitest globalSetup (test/global-setup.ts) on a
 * random free port. The base URL and peer key are injected via vitest's
 * provide/inject mechanism — no manual env vars needed.
 */

import { describe, it, expect, inject } from "vitest";

const BASE = (inject("apiBase") as string | undefined) ?? "http://localhost:5000/api";
const PEER_KEY = (inject("peerKey") as string | undefined) ?? "";
const TIMEOUT = Number(process.env.TEST_TIMEOUT_MS ?? 15_000);

/** Fetch helper — always sends the peer-key so gated routes pass auth. */
async function api(path: string, init?: RequestInit): Promise<Response> {
  const url = `${BASE}${path}`;
  const headers = {
    ...(PEER_KEY ? { Authorization: `Bearer ${PEER_KEY}` } : {}),
    ...(init?.headers ?? {}),
  };
  try {
    return await fetch(url, { ...init, headers });
  } catch {
    // One retry after a short pause.
    await new Promise((r) => setTimeout(r, 2_000));
    return fetch(url, { ...init, headers });
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
    for (const field of ["commit", "branch", "repository", "serviceId", "serviceName", "render"]) {
      expect(body, `field "${field}" missing from /version`).toHaveProperty(field);
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// /integrations/composio/status  (gated — peer key sent automatically)
// ---------------------------------------------------------------------------
describe("GET /integrations/composio/status", () => {
  it("always responds with a valid JSON body (configured or not)", async () => {
    const res = await api("/integrations/composio/status");
    expect([200, 502], "unexpected status from composio/status").toContain(res.status);
    const body = (await res.json()) as Record<string, unknown>;
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

// ---------------------------------------------------------------------------
// FluidVoice pairing and scoped device authentication
// ---------------------------------------------------------------------------
describe("FluidVoice companion bridge", () => {
  it("rejects pairing without a signed operator session", async () => {
    const res = await fetch(`${BASE}/fluidvoice/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: "E2E Mac" }),
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ needPin: true });
  }, TIMEOUT);

  it("pairs a device after unlock and validates the scoped token", async () => {
    const unlock = await fetch(`${BASE}/operator/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "22" }),
    });
    expect(unlock.status).toBe(200);
    const cookie = unlock.headers.get("set-cookie");
    expect(cookie).toContain("nova_operator_session=");

    const pair = await fetch(`${BASE}/fluidvoice/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie ?? "",
      },
      body: JSON.stringify({ deviceName: "E2E Mac", ttlDays: 30 }),
    });
    expect(pair.status).toBe(200);
    const pairing = (await pair.json()) as Record<string, unknown>;
    expect(pairing).toMatchObject({
      ok: true,
      deviceName: "E2E Mac",
      provider: "NOVA OpenClaw",
      model: "poolside/laguna-xs-2.1",
    });
    expect(String(pairing.baseUrl)).toMatch(/\/api\/fluidvoice\/v1$/);

    const token = String(pairing.token || "");
    expect(token.split(".")).toHaveLength(2);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[0] || "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({ aud: "fluidvoice", deviceName: "E2E Mac" });
    expect(payload).not.toHaveProperty("pin");

    const status = await fetch(`${BASE}/fluidvoice/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      ok: true,
      backend: "openclaw",
      provider: "nvidia",
      model: "poolside/laguna-xs-2.1",
      device: { name: "E2E Mac" },
    });

    const invalid = await fetch(`${BASE}/fluidvoice/status`, {
      headers: { Authorization: "Bearer invalid.invalid" },
    });
    expect(invalid.status).toBe(401);
  }, TIMEOUT);
});
