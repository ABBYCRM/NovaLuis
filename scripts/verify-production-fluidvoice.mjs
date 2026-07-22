#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const LIVE_URL = String(process.env.LIVE_URL || "").trim().replace(/\/$/, "");
const PIN = String(process.env.NOVA_OPERATOR_PIN || "").trim();
const EXPECTED_MODEL = "poolside/laguna-xs-2.1";
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
    throw new Error(`${label} did not return JSON: ${text.slice(0, 300)}`);
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

// 3. Establish the existing signed operator session. The PIN and cookie are never written to artifacts.
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
  console.log(`::add-mask::${operatorCookie}`);
}

// 4. Pair a short-lived verifier device and validate the token structure without persisting the token.
let deviceToken = "";
let deviceId = "";
{
  const { response, text } = await request("/api/fluidvoice/pair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: operatorCookie,
    },
    body: JSON.stringify({ deviceName: "Production verifier", ttlDays: 1 }),
  });
  const body = parseJson(text, "authenticated pairing");
  assert(response.status === 200 && body?.ok === true, `authenticated pairing failed with HTTP ${response.status}`);
  deviceToken = String(body?.token || "");
  deviceId = String(body?.deviceId || "");
  assert(deviceToken.split(".").length === 2, "paired device token is not the expected signed two-part token");
  assert(deviceId.length >= 16, "paired device ID is missing");
  assert(body?.model === EXPECTED_MODEL, `pairing reported unexpected model ${body?.model}`);
  assert(body?.provider === "NOVA OpenClaw", `pairing reported unexpected provider ${body?.provider}`);
  assert(String(body?.baseUrl || "") === `${LIVE_URL}/api/fluidvoice/v1`, "pairing returned the wrong FluidVoice Base URL");
  console.log(`::add-mask::${deviceToken}`);

  const encoded = deviceToken.split(".")[0];
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert(payload?.aud === "fluidvoice", "device token audience is not fluidvoice");
  assert(payload?.deviceId === deviceId, "device token ID does not match pairing response");
  assert(!Object.prototype.hasOwnProperty.call(payload, "pin"), "device token payload contains a PIN field");

  proof.pairing = {
    status: response.status,
    provider: body.provider,
    model: body.model,
    baseUrl: body.baseUrl,
    setupUrl: body.setupUrl,
    deviceId,
    expiresAt: body.expiresAt,
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
  assert(body?.backend === "openclaw", `FluidVoice backend is ${body?.backend}, not openclaw`);
  assert(body?.provider === "nvidia", `FluidVoice provider is ${body?.provider}, not nvidia`);
  assert(body?.model === EXPECTED_MODEL, `FluidVoice status reported unexpected model ${body?.model}`);
  assert(body?.device?.id === deviceId, "FluidVoice status returned the wrong device");
  proof.deviceStatus = {
    status: response.status,
    backend: body.backend,
    provider: body.provider,
    model: body.model,
    deviceId: body.device.id,
  };
}

// 6. Exercise the actual OpenAI-compatible FluidVoice route through OpenClaw.
{
  const startedAt = Date.now();
  const { response, text } = await request(
    "/api/fluidvoice/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deviceToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: EXPECTED_MODEL,
        stream: false,
        messages: [
          {
            role: "user",
            content: "Reply with the single token FLUIDVOICE_OK and do not use tools.",
          },
        ],
      }),
    },
    180_000,
  );
  const body = parseJson(text, "FluidVoice completion");
  const content = String(body?.choices?.[0]?.message?.content || "").trim();
  const backendHeader = response.headers.get("x-nova-agent-backend") || "";
  const modelHeader = response.headers.get("x-nova-model") || "";
  assert(response.status === 200, `FluidVoice completion returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  assert(content.length > 0, "FluidVoice completion returned no assistant content");
  assert(backendHeader === "openclaw", `FluidVoice completion backend header is ${backendHeader}`);
  assert(modelHeader === EXPECTED_MODEL, `FluidVoice completion model header is ${modelHeader}`);
  proof.openClawCompletion = {
    status: response.status,
    backendHeader,
    modelHeader,
    contentPresent: true,
    contentLength: content.length,
    latencyMs: Date.now() - startedAt,
  };
}

fs.writeFileSync(OUT_FILE, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({
    ok: true,
    setupPage: proof.setupPage,
    pairing: {
      provider: proof.pairing.provider,
      model: proof.pairing.model,
      baseUrl: proof.pairing.baseUrl,
      tokenPersisted: false,
    },
    deviceStatus: proof.deviceStatus,
    openClawCompletion: proof.openClawCompletion,
    proofFile: OUT_FILE,
  }),
);
