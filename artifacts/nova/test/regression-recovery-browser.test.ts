import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const novaRoot = path.resolve(here, "..");
const screenshotsDir = path.join(novaRoot, "test-results", "ui-preservation");
const chromiumExecutable = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe.skipIf(!chromiumExecutable)("regression recovery in mobile Chromium", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let baseURL: string;

  beforeAll(async () => {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    process.env.BASE_PATH = "/";
    const port = await freePort();
    server = await createServer({
      configFile: path.join(novaRoot, "vite.config.ts"),
      root: novaRoot,
      logLevel: "silent",
      server: { port, strictPort: true, host: "127.0.0.1" },
    });
    await server.listen(port);
    baseURL = `http://127.0.0.1:${port}/`;
    browser = await chromium.launch({
      executablePath: chromiumExecutable,
      headless: true,
      args: ["--no-sandbox"],
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function mobilePage(): Promise<Page> {
    return browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  }

  it("recovers Pictures from HTTP 401 through a signed operator session", async () => {
    const page = await mobilePage();
    let listCalls = 0;
    let unlockCalls = 0;
    try {
      await page.addInitScript(() => {
        const runtime = window as unknown as {
          __operatorPromptCount: number;
          prompt: (message?: string) => string;
        };
        runtime.__operatorPromptCount = 0;
        runtime.prompt = () => {
          runtime.__operatorPromptCount += 1;
          return "22";
        };
      });

      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (pathname === "/api/operator/unlock") {
          unlockCalls += 1;
          expect(request.postDataJSON()).toEqual({ pin: "22" });
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: {
              "set-cookie": "nova_operator_session=test-session; Path=/api; HttpOnly; SameSite=Lax",
            },
            body: JSON.stringify({ ok: true }),
          });
          return;
        }
        if (pathname === "/api/workspaces/pictures/files") {
          listCalls += 1;
          const cookie = request.headers().cookie || "";
          if (!cookie.includes("nova_operator_session=test-session")) {
            await route.fulfill({
              status: 401,
              contentType: "application/json",
              body: JSON.stringify({ error: "operator authentication required", needPin: true }),
            });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ workspace: "pictures", files: [] }),
          });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });

      await page.goto(baseURL, { waitUntil: "load", timeout: 30_000 });
      await page.addScriptTag({ url: `${baseURL}assets/operator-session-auth.js` });

      // Follow the exact mobile user path: open drawer, expand Workspaces, open Pictures.
      await page.locator("#hamburger").click();
      await page.locator("#ws-toggle").click();
      await page.locator('.workspace-tab[data-ws="pictures"]').click();

      await page.waitForFunction(() => {
        const panel = document.getElementById("ws-overlay");
        const list = document.getElementById("ws-list");
        return panel && panel.hidden === false && !String(list?.textContent || "").includes("Failed to load");
      });

      expect(listCalls).toBe(2);
      expect(unlockCalls).toBe(1);
      expect(await page.evaluate(() => {
        return (window as unknown as { __operatorPromptCount: number }).__operatorPromptCount;
      })).toBe(1);
      await page.screenshot({
        path: path.join(screenshotsDir, "workspace-auth-recovered-mobile.png"),
        fullPage: true,
      });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("keeps the 3D cube visible until a durable run reaches terminal state", async () => {
    const page = await mobilePage();
    let finishRun = false;
    try {
      await page.route("**/api/**", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === "/api/work-tree/runs/42") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              run: finishRun
                ? { id: 42, status: "done", report: "Verified durable report", error: "" }
                : { id: 42, status: "running", report: "", error: "" },
              nodes: [],
            }),
          });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });

      await page.goto(baseURL, { waitUntil: "load", timeout: 30_000 });
      await page.addScriptTag({ url: `${baseURL}assets/durable-run-reconcile.js` });
      await page.evaluate(() => {
        localStorage.setItem("bob-chats", JSON.stringify([{
          id: "chat-durable-cube",
          title: "Durable task",
          createdAt: Date.now(),
          messages: [{
            role: "assistant",
            content: "Background run queued [NOVA_RUN_ID:42]",
            at: Date.now(),
          }],
        }]));
        const row = document.createElement("div");
        row.className = "msg-row msg-assistant";
        const body = document.createElement("div");
        body.className = "msg-body";
        const bubble = document.createElement("div");
        bubble.className = "bubble bubble-assistant";
        bubble.textContent = "Background run queued [NOVA_RUN_ID:42]";
        body.appendChild(bubble);
        row.appendChild(body);
        document.getElementById("chat-inner")?.appendChild(row);
      });

      const indicator = page.locator('.durable-thinking-indicator[data-nova-run-id="42"]');
      await indicator.waitFor({ state: "visible", timeout: 10_000 });
      expect(await indicator.locator(".cube3d-f").count()).toBe(6);
      expect(await indicator.locator(".think-label").textContent()).toContain("Working in background");
      await page.screenshot({
        path: path.join(screenshotsDir, "durable-thinking-cube-mobile.png"),
        fullPage: true,
      });

      finishRun = true;
      await page.waitForFunction(() => {
        const text = String(document.querySelector("#chat-inner .bubble")?.textContent || "");
        return text.includes("Verified durable report") &&
          document.querySelectorAll(".durable-thinking-indicator").length === 0;
      }, undefined, { timeout: 15_000 });
    } finally {
      await page.close();
    }
  }, 60_000);
});
