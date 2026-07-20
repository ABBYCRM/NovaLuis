#!/usr/bin/env node

const APP_ID = String(process.env.DO_APP_ID || "").trim();
const TOKEN = String(
  process.env.DIGITALOCEAN_API_TOKEN ||
    process.env.DIGITALOCEAN_API_TOKEN_PAID ||
    "",
).trim();

const LAGUNA_MODEL = "poolside/laguna-xs-2.1";
const REQUIRED_ENV = {
  NOVA_MODEL_PREFERENCE: "nvidia",
  OPENCLAW_AGENT_MODEL: LAGUNA_MODEL,
  NOVA_OPENCLAW_MODEL_ID: LAGUNA_MODEL,
  WORK_TREE_MODEL: LAGUNA_MODEL,
  CUSTOM_AGENT_NVIDIA_NIM_DEFAULT_MODEL: LAGUNA_MODEL,
};
const NVIDIA_SECRET_KEY = "CUSTOM_AGENT_NVIDIA_NIM_KEY";

if (!APP_ID) throw new Error("DO_APP_ID is required");
if (!TOKEN) throw new Error("DigitalOcean API token is required");

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
    throw new Error(
      `DigitalOcean ${response.status}: ${JSON.stringify(payload).slice(0, 1500)}`,
    );
  }
  return payload;
}

function findNovaService(spec) {
  const services = Array.isArray(spec.services) ? spec.services : [];
  const exact = services.find((service) => service?.name === "nova");
  if (exact) return exact;
  if (services.length === 1) return services[0];
  throw new Error("DigitalOcean app spec does not contain an unambiguous nova service");
}

function upsertGeneral(envs, key, value) {
  const existing = envs.find((entry) => entry?.key === key);
  if (existing) {
    const changed =
      existing.value !== value ||
      existing.type === "SECRET" ||
      existing.scope !== "RUN_TIME";
    existing.value = value;
    existing.type = "GENERAL";
    existing.scope = "RUN_TIME";
    return changed;
  }
  envs.push({ key, value, type: "GENERAL", scope: "RUN_TIME" });
  return true;
}

const current = await readJson(
  await fetch(endpoint, {
    headers,
    signal: AbortSignal.timeout(30_000),
  }),
);

const spec = current?.app?.spec;
if (!spec || typeof spec !== "object") {
  throw new Error("DigitalOcean app response did not include app.spec");
}

const service = findNovaService(spec);
const envs = Array.isArray(service.envs) ? service.envs : [];
service.envs = envs;

let changed = false;
for (const [key, value] of Object.entries(REQUIRED_ENV)) {
  if (upsertGeneral(envs, key, value)) changed = true;
}

const nvidiaSecret = envs.find((entry) => entry?.key === NVIDIA_SECRET_KEY);
if (!nvidiaSecret || typeof nvidiaSecret.value !== "string" || !nvidiaSecret.value.trim()) {
  throw new Error(
    `${NVIDIA_SECRET_KEY} is missing or empty in the DigitalOcean nova service`,
  );
}
if (nvidiaSecret.type !== "SECRET" || nvidiaSecret.scope !== "RUN_TIME") {
  // DigitalOcean returns existing secret values in a reusable encrypted form.
  // Preserve the value verbatim while correcting its metadata.
  nvidiaSecret.type = "SECRET";
  nvidiaSecret.scope = "RUN_TIME";
  changed = true;
}

if (changed) {
  const updated = await readJson(
    await fetch(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({ spec }),
      signal: AbortSignal.timeout(60_000),
    }),
  );
  if (!updated?.app?.id) {
    throw new Error("DigitalOcean did not confirm the Laguna environment update");
  }
}

console.log(
  JSON.stringify({
    ok: true,
    changed,
    appId: APP_ID,
    service: service.name || "nova",
    provider: "nvidia",
    model: LAGUNA_MODEL,
    nvidiaCredential: {
      key: NVIDIA_SECRET_KEY,
      present: true,
      type: "SECRET",
      scope: "RUN_TIME",
    },
    enforcedKeys: Object.keys(REQUIRED_ENV),
  }),
);
