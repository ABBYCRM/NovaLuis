#!/usr/bin/env node

const LAGUNA_MODEL = "poolside/laguna-xs-2.1";

// DigitalOcean already exposes an encrypted NVIDIA NIM credential for the
// custom-agent runtime. Reuse it inside this process when the canonical key is
// absent; never log, persist, or return either value.
if (!String(process.env.NVIDIA_API_KEY || "").trim()) {
  const existingNimKey = String(
    process.env.CUSTOM_AGENT_NVIDIA_NIM_KEY || "",
  ).trim();
  if (existingNimKey) process.env.NVIDIA_API_KEY = existingNimKey;
}

// Secretless CI containers must still start so health, schema, and UI checks can
// run. Model requests will return an explicit NVIDIA_API_KEY configuration error,
// and the post-deployment verifier rejects production unless real Laguna
// inference succeeds. There is no fallback to a different model or provider.
if (!String(process.env.NVIDIA_API_KEY || "").trim()) {
  console.warn(
    "start-nvidia-laguna: NVIDIA credential absent; health diagnostics enabled, inference disabled",
  );
}

process.env.NOVA_MODEL_PREFERENCE ||= "nvidia";
process.env.OPENCLAW_AGENT_MODEL ||= LAGUNA_MODEL;
process.env.NOVA_OPENCLAW_MODEL_ID ||= LAGUNA_MODEL;
process.env.WORK_TREE_MODEL ||= LAGUNA_MODEL;
process.env.CUSTOM_AGENT_NVIDIA_NIM_DEFAULT_MODEL ||= LAGUNA_MODEL;

await import("./start-openclaw.mjs");
