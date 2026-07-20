#!/usr/bin/env node

const LIVE_URL = String(process.env.LIVE_URL || "").replace(/\/$/, "");
const EXPECTED_SHA = String(
  process.env.EXPECTED_SHA || process.env.GITHUB_SHA || "",
).trim();
const DO_APP_ID = String(process.env.DO_APP_ID || "").trim();
const DO_TOKEN = String(
  process.env.DIGITALOCEAN_API_TOKEN ||
    process.env.DIGITALOCEAN_API_TOKEN_PAID ||
    "",
).trim();

const LAGUNA_MODEL = "poolside/laguna-xs-2.1";

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

required("LIVE_URL", LIVE_URL);
required("EXPECTED_SHA", EXPECTED_SHA);
required("DO_APP_ID", DO_APP_ID);
required("DigitalOcean token", DO_TOKEN);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchRetry(url, options = {}, attempts = 12) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(20_000),
      });
      if (response.ok) return response;
      const responseText = await response.text().catch(() => "");
      lastError = new Error(
        `${url} returned HTTP ${response.status}: ${responseText.slice(0, 500)}`,
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(Math.min(2_000 * attempt, 10_000));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function json(url, options) {
  const response = await fetchRetry(url, options);
  return response.json();
}

async function text(url, options) {
  const response = await fetchRetry(url, options);
  return response.text();
}

function collectValues(root, keyName) {
  const values = [];
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === keyName && typeof item === "string" && item.trim()) {
        values.push(item.trim());
      }
      walk(item);
    }
  };
  walk(root);
  return [...new Set(values)];
}

function shaMatches(observed) {
  return EXPECTED_SHA.startsWith(observed) || observed.startsWith(EXPECTED_SHA);
}

async function verifyDigitalOceanRevision() {
  const endpoint = `https://api.digitalocean.com/v2/apps/${DO_APP_ID}/deployments`;
  const payload = await json(endpoint, {
    headers: { Authorization: `Bearer ${DO_TOKEN}` },
  });
  const deployments = Array.isArray(payload.deployments) ? payload.deployments : [];
  const exact = deployments.find((deployment) => {
    const phase = String(deployment?.phase || "").toUpperCase();
    const hashes = collectValues(deployment, "source_commit_hash");
    return phase === "ACTIVE" && hashes.some(shaMatches);
  });

  if (!exact) {
    const observed = deployments.slice(0, 10).map((deployment) => ({
      id: deployment?.id,
      phase: deployment?.phase,
      hashes: collectValues(deployment, "source_commit_hash"),
      createdAt: deployment?.created_at,
      updatedAt: deployment?.updated_at,
    }));
    throw new Error(
      `No ACTIVE DigitalOcean deployment matches ${EXPECTED_SHA}. Observed: ${JSON.stringify(observed)}`,
    );
  }

  const matchingHash = collectValues(exact, "source_commit_hash").find(shaMatches);
  console.log(
    JSON.stringify({
      check: "digitalocean-revision",
      deploymentId: exact.id,
      phase: exact.phase,
      expectedSha: EXPECTED_SHA,
      sourceCommitHash: matchingHash,
    }),
  );
  return { deploymentId: exact.id, sourceCommitHash: matchingHash };
}

async function verifyApiRuntime() {
  const [health, openclaw, cron, skills, evidenceSkill, workTree, novaConfig] =
    await Promise.all([
      json(`${LIVE_URL}/api/healthz`),
      json(`${LIVE_URL}/api/openclaw/status`),
      json(`${LIVE_URL}/api/social/cron/status`),
      json(`${LIVE_URL}/api/skills`),
      json(`${LIVE_URL}/api/skills/evidence-first-execution`),
      json(`${LIVE_URL}/api/work-tree/runs`),
      json(`${LIVE_URL}/api/nova-config`),
    ]);

  if (health.status !== "ok") throw new Error(`healthz status is ${health.status}`);
  if (openclaw.status !== "ready") {
    throw new Error(`OpenClaw status is ${openclaw.status}`);
  }
  if (cron.running !== true) throw new Error("embedded social cron is not running");
  if (cron.publicBaseUrlConfigured !== true) {
    throw new Error("PUBLIC_BASE_URL is not HTTPS");
  }
  if (cron.publicBaseUrl !== LIVE_URL) {
    throw new Error(`unexpected PUBLIC_BASE_URL: ${cron.publicBaseUrl}`);
  }
  if (cron.embeddedWorker !== true) {
    throw new Error("embedded social worker is not active");
  }
  if (cron.siblingWorkerEnabled !== true) {
    throw new Error("sibling social worker is disabled");
  }
  if (!Array.isArray(workTree.runs)) {
    throw new Error("work-tree route did not return a runs array");
  }

  if (novaConfig.modelPreference !== "nvidia") {
    throw new Error(`active model provider is ${novaConfig.modelPreference}, not nvidia`);
  }
  if (novaConfig.activeModel !== LAGUNA_MODEL) {
    throw new Error(`active model is ${novaConfig.activeModel}, not ${LAGUNA_MODEL}`);
  }
  if (novaConfig.activeProviderConfigured !== true) {
    throw new Error(
      `NVIDIA model provider is not configured; required ${novaConfig.activeProviderRequiredEnv || "NVIDIA_API_KEY"}`,
    );
  }
  const lagunaOption = (novaConfig.modelOptions || []).find(
    (option) => option?.model === LAGUNA_MODEL,
  );
  if (!lagunaOption || lagunaOption.configured !== true) {
    throw new Error("Laguna is missing or unconfigured in the live model registry");
  }
  if (
    lagunaOption.tuning?.maxTokens !== 8192 ||
    lagunaOption.tuning?.topP !== 0.95 ||
    lagunaOption.tuning?.temperature !== 1 ||
    lagunaOption.tuning?.contextWindow !== 262144
  ) {
    throw new Error(`unexpected Laguna tuning: ${JSON.stringify(lagunaOption.tuning)}`);
  }

  const requiredSkills = [
    "evidence-first-execution",
    "tool-orchestration-accuracy",
    "polyglot-software-engineering",
    "github-connected-operations",
    "durable-runtime-engineering",
    "osint-deep-research",
    "social-seo-attention",
    "personal-assistant-operations",
    "novaluis-runtime-operator",
  ];
  const byName = new Map((skills.skills || []).map((skill) => [skill.name, skill]));
  for (const name of requiredSkills) {
    const skill = byName.get(name);
    if (!skill) throw new Error(`live skill catalog missing ${name}`);
    if (skill.source !== "workspace") {
      throw new Error(`${name} is not sourced from workspace skills`);
    }
  }
  if (evidenceSkill.name !== "evidence-first-execution") {
    throw new Error("wrong evidence skill detail");
  }
  if (!String(evidenceSkill.content || "").includes("Mandatory pre-output self-check")) {
    throw new Error("evidence skill content is incomplete");
  }

  const missingAsset = `${LIVE_URL}/api/social/assets/instagram-instagram-post-0000000000000-00000000-0000-0000-0000-000000000000.png`;
  const missingResponse = await fetch(missingAsset, {
    signal: AbortSignal.timeout(20_000),
  });
  const missingBody = await missingResponse.text();
  if (missingResponse.status !== 404 || !missingBody.includes("asset not found")) {
    throw new Error(
      `hardened Instagram asset boundary returned ${missingResponse.status}: ${missingBody.slice(0, 300)}`,
    );
  }

  console.log(
    JSON.stringify({
      check: "api-runtime",
      openclaw: openclaw.status,
      activeProvider: novaConfig.modelPreference,
      activeModel: novaConfig.activeModel,
      socialCronRunning: cron.running,
      socialLastTickFinishedAt: cron.lastTickFinishedAt,
      skillCount: skills.count,
      durableRunCount: workTree.runs.length,
    }),
  );
}

async function verifyLagunaInference() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${LIVE_URL}/api/v1/chat/completions`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: LAGUNA_MODEL,
          stream: false,
          messages: [
            {
              role: "user",
              content:
                "Runtime verification. Reply with the token MODEL_OK. Do not call tools.",
            },
          ],
          max_tokens: 32,
          temperature: 0,
          top_p: 0.95,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `Laguna inference returned HTTP ${response.status}: ${responseText.slice(0, 1000)}`,
        );
      }
      let payload;
      try {
        payload = JSON.parse(responseText);
      } catch {
        throw new Error(`Laguna inference was not JSON: ${responseText.slice(0, 500)}`);
      }
      const content = String(payload?.choices?.[0]?.message?.content || "").trim();
      if (!content) throw new Error("Laguna inference returned empty assistant content");
      if (/internal error|upstream unreachable|not configured/i.test(content)) {
        throw new Error(`Laguna inference returned a runtime failure: ${content.slice(0, 500)}`);
      }
      if (!content.includes("MODEL_OK")) {
        throw new Error(`Laguna inference did not return the verification token: ${content}`);
      }
      console.log(
        JSON.stringify({
          check: "nvidia-laguna-inference",
          model: LAGUNA_MODEL,
          responseVerified: true,
          attempt,
        }),
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 5_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function verifyPwaAndMobileAssets() {
  const version = encodeURIComponent(EXPECTED_SHA.slice(0, 12));
  const [html, manifest, sw, navigation, voice, durable, icon192, icon512] =
    await Promise.all([
      text(`${LIVE_URL}/`),
      json(`${LIVE_URL}/manifest.webmanifest?v=${version}`),
      text(`${LIVE_URL}/sw.js?v=${version}`),
      text(`${LIVE_URL}/assets/ui-navigation-preservation.js?v=${version}`),
      text(`${LIVE_URL}/assets/continuous-voice-input.js?v=${version}`),
      text(`${LIVE_URL}/assets/durable-run-reconcile.js?v=${version}`),
      fetchRetry(`${LIVE_URL}/icon-192.png?v=${version}`).then((response) =>
        response.arrayBuffer(),
      ),
      fetchRetry(`${LIVE_URL}/icon-512.png?v=${version}`).then((response) =>
        response.arrayBuffer(),
      ),
    ]);

  if (!html.includes('rel="manifest" href="/manifest.webmanifest"')) {
    throw new Error("manifest link missing from live HTML");
  }
  if (!/\/assets\/ui-navigation-preservation\.js\?v=/.test(html)) {
    throw new Error("versioned navigation runtime missing from live HTML");
  }
  if (!/navigator\.serviceWorker\.register\(['"]\/sw\.js\?v=/.test(html)) {
    throw new Error("versioned service-worker registration missing from live HTML");
  }

  if (
    manifest.display !== "standalone" ||
    manifest.start_url !== "/" ||
    manifest.scope !== "/"
  ) {
    throw new Error("live manifest is not installable at root scope");
  }
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) {
    throw new Error("live manifest icons are incomplete");
  }
  for (const eventName of ["install", "activate", "fetch"]) {
    if (!sw.includes(`addEventListener('${eventName}'`)) {
      throw new Error(`service worker missing ${eventName} handler`);
    }
  }
  if (!navigation.includes("/assets/continuous-voice-input.js")) {
    throw new Error("voice module loader missing");
  }
  if (!navigation.includes("/assets/durable-run-reconcile.js")) {
    throw new Error("durable module loader missing");
  }
  if (!navigation.includes("versionQuery")) {
    throw new Error("child runtime modules are not versioned");
  }
  if (!voice.includes("instance.continuous = true")) {
    throw new Error("continuous microphone runtime missing");
  }
  if (!voice.includes("window.__novaVoiceInput")) {
    throw new Error("voice observability handle missing");
  }
  if (!durable.includes("/api/work-tree/runs/")) {
    throw new Error("durable reconciliation endpoint missing");
  }
  if (!durable.includes("[NOVA_RUN_ID:")) {
    throw new Error("durable run marker missing");
  }
  if (icon192.byteLength < 100 || icon512.byteLength < 100) {
    throw new Error("PWA icon payload is empty");
  }

  console.log(
    JSON.stringify({
      check: "pwa-mobile-assets",
      manifestDisplay: manifest.display,
      icon192Bytes: icon192.byteLength,
      icon512Bytes: icon512.byteLength,
      versionedRuntime: true,
    }),
  );
}

const deployment = await verifyDigitalOceanRevision();
await verifyApiRuntime();
await verifyLagunaInference();
await verifyPwaAndMobileAssets();
console.log(
  JSON.stringify({
    ok: true,
    liveUrl: LIVE_URL,
    expectedSha: EXPECTED_SHA,
    model: LAGUNA_MODEL,
    deployment,
    verifiedAt: new Date().toISOString(),
  }),
);
