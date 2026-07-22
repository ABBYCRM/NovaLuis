#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const LIVE_URL = String(process.env.LIVE_URL || "").trim().replace(/\/$/, "");
const PIN = String(process.env.NOVA_OPERATOR_PIN || "").trim();
const EXPECTED_MODEL = "poolside/laguna-xs-2.1";
const EXPECTED_TOKEN_VERSION = 2;
const OUT_DIR = path.resolve("artifacts", "production-runtime");
const OUT_FILE = path.join(OUT_DIR, "fluidvoice-live-proof.json");

if (!LIVE_URL) throw new Error("LIVE_URL is required");
if (!PIN) throw new Error("NOVA_OPERATOR_PIN is required for live FluidVoice pairing verification");

fs.mkdirSync(OUT_DIR, { recursive: true });

async function request(urlPath, init = {}, timeoutMs = 120_000) {
  const response = await fetch(`${LIVE_URL}${urlPath}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  return { response, text };
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieFrom(response) {
  const raw = response.headers.get("set-cookie") || "";
  const cookie = raw.split(";")[0]?.trim() || "";
  assert(cookie.startsWith("nova_operator_session="), "operator unlock did not return the signed session cookie");
  return cookie;
}

function parseSse(text) {
  let content = "";
  let eventCount = 0;
  let doneSeen = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload) continue;
    if (payload === "[DONE]") {
      doneSeen = true;
      continue;
    }
    try {
      const json = JSON.parse(payload);
      const delta = json?.choices?.[0]?.delta?.content;
      const message = json?.choices?.[0]?.message?.content;
      if (typeof delta === "string") content += delta;
      else if (typeof message === "string") content += message;
      eventCount += 1;
    } catch {
      // Ignore non-JSON SSE metadata; content events must still be present below.
    }
  }
  return { content: content.trim(), eventCount, doneSeen };
}

const proof = {
  checkedAt: new Date().toISOString(),
  liveUrl: LIVE_URL,
  setupPage: null,
  unauthenticatedBoundary: null,
  pairing: null,
  deviceStatus: null,
  openClawCompletion: null,
};

// 1. The clean setup URL must resolve to HTML, not an extensionless download or SPA fallback.
{
  const { response, text } = await request("/fluidvoice", {
    headers: { Accept: "text/html" },
  });
  const contentType = response.headers.get("content-type") || "";
  assert(response.status === 200, `/fluidvoice returned HTTP ${response.status}`);
  assert(/text\/html/i.test(contentType), `/fluidvoice content-type is not text/html: ${contentType}`);
  assert(text.includes("FluidVoice pairing"), "/fluidvoice is missing the pairing-page marker");
  assert(text.includes("NOVA × FluidVoice"), "/fluidvoice is missing the NOVA FluidVoice title");
  proof.setupPage = {
    status: response.status,
    contentType,
    markerPresent: true,
  };
}

// 2. Pairing must remain locked before operator authentication.
{
  const { response, text } = await request("/api/fluidvoice/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceName: "Production verifier" }),
  });
  const body = parseJson(text, "unauthenticated pairing");
  assert(response.status === 401, `unauthenticated pairing returned HTTP ${response.status}`);
  assert(body?.needPin === true, "unauthenticated pairing did not require the operator PIN");
  proof.unauthenticatedBoundary = {
    status: response.status,
    needPin: true,
  };
}

// 3. Establish the existing signed operator session. The PIN and cookie are never logged or persisted.
let operatorCookie = "";
{
  const { response, text } = await request("/api/operator/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: PIN }),
  });
  const body = parseJson(text, "operator unlock");
  assert(response.status === 200 && body?.ok === true, `operator unlock failed with HTTP ${response.status}`);
  operatorCookie = cookieFrom(response);
}

// 4. Pair a ten-minute verifier device. The token stays in memory only.
let deviceToken = "";
let deviceId = "";
{
  const { response, text } = await request("/api/fluidvoice/pair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: operatorCookie,
    },
    body: JSON.stringify({ deviceName: "Production verifier", ttlMinutes: 10 }),
  });
  const body = parseJson(text, "authenticated pairing");
  assert(response.status === 200 && body?.ok === true, `authenticated pairing failed with HTTP ${response.status}`);
  deviceToken = String(body?.token || "");
  deviceId = String(body?.deviceId || "");
  assert(deviceToken.split(".").length === 2, "paired device token is not the expected signed two-part token");
  assert(deviceId.length >= 16, "paired device ID is missing");
  assert(body?.tokenVersion === EXPECTED_TOKEN_VERSION, `pairing reported token version ${body?.tokenVersion}`);
  assert(body?.model === EXPECTED_MODEL, `pairing reported unexpected model ${body?.model}`);
  assert(body?.provider === "NOVA OpenClaw", `pairing reported unexpected provider ${body?.provider}`);
  assert(String(body?.baseUrl || "") === `${LIVE_URL}/api/fluidvoice/v1`, "pairing returned the wrong FluidVoice Base URL");

  const encoded = deviceToken.split(".")[0];
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert(payload?.v === EXPECTED_TOKEN_VERSION, "device token payload has the wrong version");
  assert(payload?.aud === "fluidvoice", "device token audience is not fluidvoice");
  assert(payload?.deviceId === deviceId, "device token ID does not match pairing response");
  assert(!Object.prototype.hasOwnProperty.call(payload, "pin"), "device token payload contains a PIN field");
  const remainingMs = Number(payload.exp) - Date.now();
  assert(remainingMs > 0 && remainingMs <= 11 * 60 * 1000, "verifier device token is not short-lived");

  proof.pairing = {
    status: response.status,
    tokenVersion: body.tokenVersion,
    provider: body.provider,
    model: body.model,
    baseUrl: body.baseUrl,
    setupUrl: body.setupUrl,
    deviceId,
    expiresAt: body.expiresAt,
    shortLived: true,
    tokenPresent: true,
    tokenPersisted: false,
    pinPresentInPayload: false,
  };
}

// 5. The paired token must authenticate the scoped status endpoint.
{
  const { response, text } = await request("/api/fluidvoice/status", {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  const body = parseJson(text, "FluidVoice status");
  assert(response.status === 200 && body?.ok === true, `FluidVoice status failed with HTTP ${response.status}`);
  assert(body?.tokenVersion === EXPECTED_TOKEN_VERSION, `FluidVoice status reported token version ${body?.tokenVersion}`);
  assert(body?.backend === "openclaw", `FluidVoice backend is ${body?.backend}, not openclaw`);
  assert(body?.provider === "nvidia", `FluidVoice provider is ${body?.provider}, not nvidia`);
  assert(body?.model === EXPECTED_MODEL, `FluidVoice status reported unexpected model ${body?.model}`);
  assert(body?.device?.id === deviceId, "FluidVoice status returned the wrong device");
  proof.deviceStatus = {
    status: response.status,
    tokenVersion: body.tokenVersion,
    backend: body.backend,
    provider: body.provider,
    model: body.model,
    deviceId: body.device.id,
  };
}

// 6. Exercise the real streaming route used by FluidVoice. Streaming keeps the
// edge connection active while OpenClaw and Laguna generate the completion.
{
  const startedAt = Date.now();
  const response = await fetch(`${LIVE_URL}/api/fluidvoice/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deviceToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: EXPECTED_MODEL,
      stream: true,
      messages: [
        {
          role: "user",
          content: "Reply with the single token FLUIDVOICE_OK and do not use tools.",
        },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const contentType = response.headers.get("content-type") || "";
  const backendHeader = response.headers.get("x-nova-agent-backend") || "";
  const modelHeader = response.headers.get("x-nova-model") || "";
  const text = await response.text();

  assert(
    response.status === 200,
    `FluidVoice streaming completion returned HTTP ${response.status} (${contentType || "no content-type"})`,
  );
  assert(/text\/event-stream/i.test(contentType), `FluidVoice completion is not SSE: ${contentType}`);
  assert(backendHeader === "openclaw", `FluidVoice completion backend header is ${backendHeader}`);
  assert(modelHeader === EXPECTED_MODEL, `FluidVoice completion model header is ${modelHeader}`);

  const parsed = parseSse(text);
  assert(parsed.eventCount > 0, "FluidVoice completion returned no SSE events");
  assert(parsed.content.length > 0, "FluidVoice completion returned no assistant content");
  assert(parsed.content.includes("FLUIDVOICE_OK"), "FluidVoice completion did not contain the requested proof token");

  proof.openClawCompletion = {
    status: response.status,
    contentType,
    backendHeader,
    modelHeader,
    transport: "sse",
    eventCount: parsed.eventCount,
    doneSeen: parsed.doneSeen,
    proofTokenPresent: true,
    contentPresent: true,
    contentLength: parsed.content.length,
    latencyMs: Date.now() - startedAt,
  };
}

fs.writeFileSync(OUT_FILE, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({
    ok: true,
    setupPage: proof.setupPage,
    pairing: {
      tokenVersion: proof.pairing.tokenVersion,
      provider: proof.pairing.provider,
      model: proof.pairing.model,
      baseUrl: proof.pairing.baseUrl,
      shortLived: proof.pairing.shortLived,
      tokenPersisted: false,
    },
    deviceStatus: proof.deviceStatus,
    openClawCompletion: proof.openClawCompletion,
    proofFile: OUT_FILE,
  }),
);
