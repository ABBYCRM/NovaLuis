import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isDurableAgentTask } from "../../api-server/src/routes/durable-agent-chat";

const here = path.dirname(fileURLToPath(import.meta.url));
const novaRoot = path.resolve(here, "..");
const repoRoot = path.resolve(novaRoot, "..", "..");

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...segments), "utf8");
}

describe("durable runtime contracts", () => {
  it("classifies repository execution as durable but leaves ordinary chat interactive", () => {
    expect(isDurableAgentTask("Debug https://github.com/ABBYCRM/NovaLuis end to end")).toBe(true);
    expect(isDurableAgentTask("Audit this repo and keep running even if I close the app")).toBe(true);
    expect(isDurableAgentTask("Deploy the GitHub repository and verify production")).toBe(true);
    expect(isDurableAgentTask("Explain what a repository is")).toBe(false);
    expect(isDurableAgentTask("Write a friendly hello message")).toBe(false);
  });

  it("keeps continuation turns attached to the latest durable run", () => {
    const route = read("artifacts", "api-server", "src", "routes", "durable-agent-chat.ts");
    expect(route).toContain("latestRunId");
    expect(route).toContain("isContinuation");
    expect(route).toContain("respondToContinuation");
    expect(route).toContain("is already ${status}");
    expect(route.indexOf("respondToContinuation")).toBeLessThan(route.indexOf("isDurableAgentTask(userText)"));
  });

  it("persists missions for the worker instead of the browser request", () => {
    const route = read("artifacts", "api-server", "src", "routes", "durable-agent-chat.ts");
    const server = read("artifacts", "api-server", "src", "index.ts");
    const dockerfile = read("Dockerfile");

    expect(route).toContain("workTreeRunsTable");
    expect(route).toContain('status: "pending"');
    expect(route).toContain("[NOVA_RUN_ID:");
    expect(server).toContain("await ensureSchema()");
    expect(server.indexOf("await ensureSchema()")).toBeLessThan(server.indexOf("app.listen"));
    expect(server).toContain('process.env.WORK_TREE_WORKER_ENABLED === "0"');
    expect(server).toContain("Dedicated work-tree worker owns durable run reconciliation");
    expect(dockerfile).toContain("WORK_TREE_WORKER_ENABLED=1");
    expect(dockerfile).toContain("SUPER_NOVA_EXEC=1");
  });

  it("routes interactive and durable inference to Poolside Laguna through NVIDIA NIM", () => {
    const config = read("artifacts", "api-server", "src", "routes", "nova-config.ts");
    const proxy = read("artifacts", "api-server", "src", "routes", "openai-proxy.ts");
    const router = read("scripts", "super-nova-router.mjs");
    const bootstrap = read("scripts", "start-nvidia-laguna.mjs");
    const openclaw = read("openclaw", "openclaw.json");
    const dockerfile = read("Dockerfile");
    const appSpec = read(".do", "app.yaml");
    const verifier = read("scripts", "verify-production-runtime.mjs");

    for (const source of [config, router, bootstrap, openclaw, dockerfile, appSpec, verifier]) {
      expect(source).toContain("poolside/laguna-xs-2.1");
    }
    expect(config).toContain('nvidia: {');
    expect(config).toContain("maxTokens: 8_192");
    expect(config).toContain("topP: 0.95");
    expect(config).toContain("contextWindow: 262_144");
    expect(proxy).toContain("process.env.NVIDIA_API_KEY");
    expect(proxy).toContain('model.startsWith("poolside/")');
    expect(proxy).toContain('requiredEnv: "NVIDIA_API_KEY"');
    expect(router).toContain('baseURL: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"');
    expect(router).toContain("Math.min(maxTokens, 8_192)");
    expect(router).toContain("body.top_p = 0.95");
    expect(bootstrap).toContain("CUSTOM_AGENT_NVIDIA_NIM_KEY");
    expect(bootstrap).toContain("process.env.NVIDIA_API_KEY = existingNimKey");
    expect(bootstrap).toContain('process.env.NOVA_MODEL_PREFERENCE ||= "nvidia"');
    expect(bootstrap).toContain('await import("./start-openclaw.mjs")');
    expect(openclaw).toContain('"maxTokens": 8192');
    expect(dockerfile).toContain("NOVA_MODEL_PREFERENCE=nvidia");
    expect(dockerfile).toContain("WORK_TREE_MODEL=poolside/laguna-xs-2.1");
    expect(dockerfile).toContain('CMD ["node", "./scripts/start-nvidia-laguna.mjs"]');
    expect(dockerfile).toContain("COPY artifacts/agent/ ./artifacts/agent/");
    expect(appSpec).toContain('value: "poolside/laguna-xs-2.1"');
    expect(appSpec).toContain("CUSTOM_AGENT_NVIDIA_NIM_KEY");
    expect(verifier).toContain('check: "nvidia-laguna-inference"');
    expect(verifier).toContain("MODEL_OK");
  });

  it("keeps Instagram cron publishing on the public HTTPS boundary without erasing media", () => {
    const cron = read("artifacts", "api-server", "src", "social-cron.ts");
    const dockerfile = read("Dockerfile");

    expect(dockerfile).toContain("PUBLIC_BASE_URL=https://nova-luis-8hjvt.ondigitalocean.app");
    expect(dockerfile).toContain("SOCIAL_MEDIA_WORKER_ENABLED=1");
    expect(cron).toContain("recoverFailedInstagramCampaignPosts");
    expect(cron).toContain("publishPost(port, post.id)");
    expect(cron).toContain("getSocialCronStatus");
    expect(cron).toContain("skippedOverlappingTicks");
    expect(cron).toContain("preserving existing media");
    expect(cron).toContain("if (fresh.imageUrl) update.imageUrl = fresh.imageUrl");
    expect(cron).toContain("if (!response.ok)");
    expect(cron).toContain("stopSocialCron");
  });

  it("restores browser auth, continuous voice, and durable result reconciliation", () => {
    const auth = read("artifacts", "nova", "public", "assets", "operator-session-auth.js");
    const voice = read("artifacts", "nova", "public", "assets", "continuous-voice-input.js");
    const reconcile = read("artifacts", "nova", "public", "assets", "durable-run-reconcile.js");
    const loader = read("artifacts", "nova", "public", "assets", "ui-navigation-preservation.js");

    expect(auth).toContain("/api/operator/unlock");
    expect(auth).toContain("first.status !== 401");
    expect(auth).not.toContain("localStorage.setItem");
    expect(voice).toContain("instance.continuous = true");
    expect(voice).toContain("instance.onend");
    expect(voice).toContain("window.__novaVoiceInput");
    expect(reconcile).toContain("/api/work-tree/runs/");
    expect(reconcile).toContain("[NOVA_RUN_ID:");
    expect(reconcile).toContain("durable-thinking-indicator");
    expect(reconcile).toContain("Working in background");
    expect(loader).toContain("/assets/operator-session-auth.js");
    expect(loader).toContain("/assets/continuous-voice-input.js");
    expect(loader).toContain("/assets/durable-run-reconcile.js");
    expect(loader).toContain("script.async = false");
  });

  it("makes cron startup and shutdown idempotent", () => {
    const agentCron = read("artifacts", "api-server", "src", "agent-cron.ts");
    expect(agentCron).toContain("if (startTimer || intervalTimer) return");
    expect(agentCron).toContain("clearTimeout(startTimer)");
    expect(agentCron).toContain("clearInterval(intervalTimer)");
    expect(agentCron).toContain("updatedAt: new Date()");
  });
});
