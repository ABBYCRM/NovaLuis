#!/usr/bin/env node

const APP_ID = String(process.env.DO_APP_ID || "").trim();
const DO_TOKEN = String(
  process.env.DIGITALOCEAN_API_TOKEN ||
    process.env.DIGITALOCEAN_API_TOKEN_PAID ||
    "",
).trim();
const NVIDIA_KEY = String(process.env.NVIDIA_API_KEY || "").trim();

if (!APP_ID) throw new Error("DO_APP_ID is required");
if (!DO_TOKEN) throw new Error("DigitalOcean API token is required");

const endpoint = `https://api.digitalocean.com/v2/apps/${APP_ID}`;
const headers = {
  Authorization: `Bearer ${DO_TOKEN}`,
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

function envCollections(spec) {
  const collections = [];
  if (Array.isArray(spec.envs)) collections.push({ owner: "app", envs: spec.envs });
  for (const collectionName of [
    "services",
    "workers",
    "jobs",
    "static_sites",
    "functions",
  ]) {
    const components = Array.isArray(spec[collectionName]) ? spec[collectionName] : [];
    for (const component of components) {
      if (Array.isArray(component?.envs)) {
        collections.push({
          owner: `${collectionName}:${component.name || "unnamed"}`,
          envs: component.envs,
        });
      }
    }
  }
  return collections;
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

const collections = envCollections(spec);
const existingLocation = collections.find(({ envs }) =>
  envs.some((entry) => entry?.key === "NVIDIA_API_KEY"),
);

if (existingLocation) {
  const existing = existingLocation.envs.find(
    (entry) => entry?.key === "NVIDIA_API_KEY",
  );
  console.log(
    JSON.stringify({
      ok: true,
      changed: false,
      key: "NVIDIA_API_KEY",
      owner: existingLocation.owner,
      scope: existing?.scope || "RUN_TIME",
      type: existing?.type || "SECRET",
    }),
  );
  process.exit(0);
}

if (!NVIDIA_KEY) {
  throw new Error(
    "NVIDIA_API_KEY is absent from both DigitalOcean and GitHub Actions. Add the NVIDIA key as a repository secret before deploying Poolside Laguna XS 2.1.",
  );
}

spec.envs = [
  ...(Array.isArray(spec.envs) ? spec.envs : []),
  {
    key: "NVIDIA_API_KEY",
    value: NVIDIA_KEY,
    scope: "RUN_TIME",
    type: "SECRET",
  },
];

const updated = await readJson(
  await fetch(endpoint, {
    method: "PUT",
    headers,
    body: JSON.stringify({ spec }),
    signal: AbortSignal.timeout(60_000),
  }),
);

if (!updated?.app?.id) {
  throw new Error("DigitalOcean did not confirm the NVIDIA secret update");
}

console.log(
  JSON.stringify({
    ok: true,
    changed: true,
    appId: updated.app.id,
    key: "NVIDIA_API_KEY",
    owner: "app",
    scope: "RUN_TIME",
    type: "SECRET",
  }),
);
