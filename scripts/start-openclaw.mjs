#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LAGUNA_MODEL = "poolside/laguna-xs-2.1";

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeModelId(value) {
  const raw = String(value || "").trim() || LAGUNA_MODEL;
  return raw.replace(/^(?:openai|google|gemini|bitdeer|nova)\//i, "");
}

function resolveSessionSecret() {
  if (process.env.SESSION_SECRET) {
    return { value: process.env.SESSION_SECRET, source: "SESSION_SECRET", stable: true };
  }

  const stableCandidates = [
    ["NOVA_SESSION_SEED", process.env.NOVA_SESSION_SEED],
    ["SUPERNOVA_API_KEY", process.env.SUPERNOVA_API_KEY],
    ["OPENCLAW_API_KEY", process.env.OPENCLAW_API_KEY],
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["NVIDIA_API_KEY", process.env.NVIDIA_API_KEY],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["GEMINI_API_KEY", process.env.GEMINI_API_KEY],
    ["BITDEER_API_KEY", process.env.BITDEER_API_KEY],
  ];
  const candidate = stableCandidates.find(([, value]) => String(value || "").trim());
  if (candidate) {
    const [source, seed] = candidate;
    const value = createHmac("sha256", String(seed))
      .update("nova-session-signing-key:v1")
      .digest("hex");
    return { value, source, stable: true };
  }

  return {
    value: randomBytes(48).toString("hex"),
    source: "process-random",
    stable: false,
  };
}

const apiPort = positiveInt(process.env.PORT, 8080);
const gatewayPort = positiveInt(process.env.OPENCLAW_GATEWAY_PORT, 18789);
const appRoot = process.env.NOVA_APP_ROOT || "/app";
const configPath =
  process.env.OPENCLAW_CONFIG_PATH || path.join(appRoot, "openclaw", "openclaw.json");
const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(appRoot, ".openclaw");
const workspaceDir =
  process.env.OPENCLAW_WORKSPACE_DIR || path.join(appRoot, "openclaw", "workspace");
const sharedInternalKey =
  process.env.SUPERNOVA_API_KEY ||
  process.env.OPENCLAW_API_KEY ||
  randomBytes(32).toString("hex");
const gatewayToken =
  process.env.OPENCLAW_GATEWAY_TOKEN || randomBytes(32).toString("hex");
const sessionSecret = resolveSessionSecret();
const modelId = normalizeModelId(
  process.env.NOVA_OPENCLAW_MODEL_ID || process.env.WORK_TREE_MODEL || LAGUNA_MODEL,
);

if (modelId.startsWith("poolside/") && !String(process.env.NVIDIA_API_KEY || "").trim()) {
  console.error(
    `start-openclaw: FATAL — ${modelId} requires NVIDIA_API_KEY; refusing to start on a different provider`,
  );
  process.exit(78);
}

fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(workspaceDir, { recursive: true });

if (!fs.existsSync(configPath)) {
  console.error(`start-openclaw: FATAL — config not found: ${configPath}`);
  process.exit(78);
}

if (!process.env.SESSION_SECRET) {
  if (sessionSecret.stable) {
    console.warn(
      `start-openclaw: SESSION_SECRET not provided; derived a domain-separated stable session-signing key from ${sessionSecret.source}. Configure SESSION_SECRET explicitly to decouple session signing from other server credentials.`,
    );
  } else {
    console.warn(
      "start-openclaw: SESSION_SECRET and all stable server-side seed sources are absent; generated a process-local random session secret. Existing operator cookies will expire on restart and cannot be shared across replicas.",
    );
  }
}

const childEnv = {
  ...process.env,
  PORT: String(apiPort),
  SESSION_SECRET: sessionSecret.value,
  OPENCLAW_GATEWAY_PORT: String(gatewayPort),
  OPENCLAW_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
  OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_WORKSPACE_DIR: workspaceDir,
  OPENCLAW_RUNTIME_VERSION:
    process.env.OPENCLAW_RUNTIME_VERSION || "2026.6.11",
  OPENCLAW_AGENT_MODEL: process.env.OPENCLAW_AGENT_MODEL || modelId,
  OPENCLAW_API_KEY: sharedInternalKey,
  SUPERNOVA_API_KEY: sharedInternalKey,
  SUPERNOVA_BASE_URL: `http://127.0.0.1:${apiPort}`,
  NOVA_INTERNAL_API_BASE: `http://127.0.0.1:${apiPort}/api`,
  NOVA_INTERNAL_MODEL_BASE_URL: `http://127.0.0.1:${apiPort}/api/v1`,
  NOVA_OPENCLAW_PROXY_KEY:
    process.env.NOVA_OPENCLAW_PROXY_KEY || randomBytes(24).toString("hex"),
  NOVA_OPENCLAW_MODEL_ID: modelId,
  NOVA_MODEL_PREFERENCE: process.env.NOVA_MODEL_PREFERENCE || "nvidia",
  WORK_TREE_MODEL: process.env.WORK_TREE_MODEL || modelId,
};

const children = new Map();
let shuttingDown = false;

function launch(name, command, args) {
  const child = spawn(command, args, {
    cwd: appRoot,
    env: childEnv,
    stdio: "inherit",
  });
  children.set(name, child);
  child.once("error", (error) => {
    console.error(`start-openclaw: ${name} process error`, error);
  });
  return child;
}

function closePromise(name, child) {
  return new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ name, code, signal }));
  });
}

async function stopChildren(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) {
    if (child.exitCode == null && !child.killed) child.kill(signal);
  }
  const deadline = setTimeout(() => {
    for (const child of children.values()) {
      if (child.exitCode == null && !child.killed) child.kill("SIGKILL");
    }
  }, 10_000);
  deadline.unref?.();
  await Promise.allSettled(
    [...children.values()].map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode != null) resolve(undefined);
          else child.once("close", () => resolve(undefined));
        }),
    ),
  );
  clearTimeout(deadline);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    void stopChildren(signal).then(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  });
}

async function waitForGateway(child) {
  const timeoutMs = positiveInt(process.env.OPENCLAW_STARTUP_TIMEOUT_MS, 120_000);
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${gatewayPort}/readyz`;

  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`OpenClaw Gateway exited before readiness (code ${child.exitCode})`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    timer.unref?.();
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${gatewayToken}` },
        signal: controller.signal,
      });
      if (response.ok) return;
    } catch {
      // Gateway is still booting.
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`OpenClaw Gateway did not become ready within ${timeoutMs}ms`);
}

async function main() {
  console.log(
    `start-openclaw: launching OpenClaw ${childEnv.OPENCLAW_RUNTIME_VERSION} on loopback:${gatewayPort} with ${modelId}`,
  );
  const gateway = launch("openclaw-gateway", "openclaw", [
    "gateway",
    "--port",
    String(gatewayPort),
    "--verbose",
  ]);

  await waitForGateway(gateway);
  console.log("start-openclaw: Gateway ready; launching NOVA API");

  const api = launch("nova-api", "node", [
    "--enable-source-maps",
    "./dist/index.mjs",
  ]);

  if (process.env.WORK_TREE_WORKER_ENABLED !== "0" && process.env.DATABASE_URL) {
    console.log("start-openclaw: launching work-tree worker daemon");
    launch("work-tree-worker", "node", [
      "--enable-source-maps",
      "./scripts/work-tree-worker.mjs",
    ]);
  } else {
    console.log(
      "start-openclaw: work-tree worker disabled (WORK_TREE_WORKER_ENABLED=0 or no DATABASE_URL)",
    );
  }

  if (process.env.SOCIAL_MEDIA_WORKER_ENABLED !== "0") {
    console.log("start-openclaw: launching social-media worker daemon");
    launch("social-media-worker", "node", [
      "./scripts/social-media-worker.mjs",
    ]);
  } else {
    console.log(
      "start-openclaw: social-media worker disabled (SOCIAL_MEDIA_WORKER_ENABLED=0)",
    );
  }

  const exited = await Promise.race([
    closePromise("openclaw-gateway", gateway),
    closePromise("nova-api", api),
  ]);

  if (!shuttingDown) {
    console.error(
      `start-openclaw: ${exited.name} exited unexpectedly (code=${exited.code}, signal=${exited.signal ?? "none"})`,
    );
    await stopChildren("SIGTERM");
    process.exit(exited.code && exited.code > 0 ? exited.code : 1);
  }
}

main().catch(async (error) => {
  console.error("start-openclaw: FATAL", error);
  await stopChildren("SIGTERM");
  process.exit(1);
});
