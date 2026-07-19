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

  it("persists missions for the worker instead of the browser request", () => {
    const route = read("artifacts", "api-server", "src", "routes", "durable-agent-chat.ts");
    const server = read("artifacts", "api-server", "src", "index.ts");
    const dockerfile = read("Dockerfile");

    expect(route).toContain("workTreeRunsTable");
    expect(route).toContain('status: "pending"');
    expect(route).toContain("[NOVA_RUN_ID:");
    expect(server).toContain('process.env.WORK_TREE_WORKER_ENABLED === "0"');
    expect(server).toContain("Dedicated work-tree worker owns durable run reconciliation");
    expect(dockerfile).toContain("WORK_TREE_WORKER_ENABLED=1");
    expect(dockerfile).toContain("SUPER_NOVA_EXEC=1");
  });

  it("keeps Instagram cron publishing on the public HTTPS boundary", () => {
    const cron = read("artifacts", "api-server", "src", "social-cron.ts");
    const dockerfile = read("Dockerfile");

    expect(dockerfile).toContain("PUBLIC_BASE_URL=https://nova-luis-8hjvt.ondigitalocean.app");
    expect(dockerfile).toContain("SOCIAL_MEDIA_WORKER_ENABLED=1");
    expect(cron).toContain("recoverFailedInstagramCampaignPosts");
    expect(cron).toContain("publishPost(port, post.id)");
    expect(cron).toContain("getSocialCronStatus");
    expect(cron).toContain("skippedOverlappingTicks");
  });

  it("loads continuous voice and durable result reconciliation", () => {
    const voice = read("artifacts", "nova", "public", "assets", "continuous-voice-input.js");
    const reconcile = read("artifacts", "nova", "public", "assets", "durable-run-reconcile.js");
    const loader = read("artifacts", "nova", "public", "assets", "ui-navigation-preservation.js");

    expect(voice).toContain("instance.continuous = true");
    expect(voice).toContain("instance.onend");
    expect(voice).toContain("window.__novaVoiceInput");
    expect(reconcile).toContain("/api/work-tree/runs/");
    expect(reconcile).toContain("[NOVA_RUN_ID:");
    expect(loader).toContain("/assets/continuous-voice-input.js");
    expect(loader).toContain("/assets/durable-run-reconcile.js");
  });
});
