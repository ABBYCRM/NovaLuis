#!/usr/bin/env node

const APP_ID = String(process.env.DO_APP_ID || "").trim();
const TOKEN = String(
  process.env.DIGITALOCEAN_API_TOKEN ||
  process.env.DIGITALOCEAN_API_TOKEN_PAID ||
  "",
).trim();
const OPERATOR_PIN = String(process.env.NOVA_OPERATOR_PIN || "22").trim();

if (!APP_ID) throw new Error("DO_APP_ID is required");
if (!TOKEN) throw new Error("DigitalOcean API token is required");
if (!OPERATOR_PIN) throw new Error("NOVA_OPERATOR_PIN is required");

const endpoint = `https://api.digitalocean.com/v2/apps/${APP_ID}`;
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function readJson(response) {
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 1000) };
    }
  }
  if (!response.ok) {
    throw new Error(`DigitalOcean ${response.status}: ${JSON.stringify(payload).slice(0, 1500)}`);
  }
  return payload;
}

const current = await readJson(await fetch(endpoint, {
  headers,
  signal: AbortSignal.timeout(30_000),
}));

const spec = current?.app?.spec;
if (!spec || typeof spec !== "object") {
  throw new Error("DigitalOcean app response did not include app.spec");
}

const appEnvs = Array.isArray(spec.envs) ? spec.envs : [];
const existing = appEnvs.find((entry) => entry?.key === "NOVA_OPERATOR_PIN");

if (existing) {
  console.log(JSON.stringify({
    ok: true,
    changed: false,
    key: "NOVA_OPERATOR_PIN",
    scope: existing.scope || "RUN_TIME",
    type: existing.type || "SECRET",
  }));
  process.exit(0);
}

spec.envs = [
  ...appEnvs,
  {
    key: "NOVA_OPERATOR_PIN",
    value: OPERATOR_PIN,
    scope: "RUN_TIME",
    type: "SECRET",
  },
];

const updated = await readJson(await fetch(endpoint, {
  method: "PUT",
  headers,
  body: JSON.stringify({ spec }),
  signal: AbortSignal.timeout(60_000),
}));

if (!updated?.app?.id) {
  throw new Error("DigitalOcean did not confirm the app spec update");
}

console.log(JSON.stringify({
  ok: true,
  changed: true,
  appId: updated.app.id,
  key: "NOVA_OPERATOR_PIN",
  scope: "RUN_TIME",
  type: "SECRET",
}));
