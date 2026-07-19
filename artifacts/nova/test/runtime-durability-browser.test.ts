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

describe.skipIf(!chromiumExecutable)("durable runtime in mobile Chromium", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let baseURL: string;

  beforeAll(async () => {
    fs.mkdirSync(screenshotsDir, { recursive: true });
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

  async function openPage(): Promise<Page> {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });

    await page.addInitScript(() => {
      const instances: FakeRecognition[] = [];
      class FakeRecognition {
        continuous = false;
        interimResults = false;
        lang = "";
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        onresult: ((event: unknown) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;

        constructor() {
          instances.push(this);
        }

        start() {
          queueMicrotask(() => this.onstart?.());
        }

        stop() {
          queueMicrotask(() => this.onend?.());
        }
      }

      const runtime = window as unknown as {
        SpeechRecognition: typeof FakeRecognition;
        webkitSpeechRecognition: typeof FakeRecognition;
        __fakeSpeechInstances: FakeRecognition[];
      };
      runtime.SpeechRecognition = FakeRecognition;
      runtime.webkitSpeechRecognition = FakeRecognition;
      runtime.__fakeSpeechInstances = instances;
    });

    await page.route("**/api/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/work-tree/runs/42") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            run: {
              id: 42,
              status: "done",
              report: "<!--sn-category:agents-->\nVerified durable report",
              error: "",
            },
            nodes: [],
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto(baseURL, { waitUntil: "load", timeout: 30_000 });
    await page.addScriptTag({ url: `${baseURL}assets/continuous-voice-input.js` });
    await page.addScriptTag({ url: `${baseURL}assets/durable-run-reconcile.js` });
    await page.locator("#user-input").waitFor({ state: "visible", timeout: 15_000 });
    return page;
  }

  it("restarts voice recognition until the user taps stop", async () => {
    const page = await openPage();
    try {
      await page.locator("#mic-btn").click();
      await page.waitForFunction(() => {
        const runtime = window as unknown as { __novaVoiceInput?: { isActive(): boolean } };
        return runtime.__novaVoiceInput?.isActive() === true;
      });

      const first = await page.evaluate(() => {
        const runtime = window as unknown as {
          __fakeSpeechInstances: Array<{ continuous: boolean; interimResults: boolean }>;
        };
        const latest = runtime.__fakeSpeechInstances.at(-1);
        return {
          count: runtime.__fakeSpeechInstances.length,
          continuous: latest?.continuous,
          interim: latest?.interimResults,
        };
      });
      expect(first.continuous).toBe(true);
      expect(first.interim).toBe(true);

      await page.evaluate(() => {
        const runtime = window as unknown as {
          __fakeSpeechInstances: Array<{ onend: (() => void) | null }>;
        };
        runtime.__fakeSpeechInstances.at(-1)?.onend?.();
      });
      await page.waitForFunction(
        (minimum) => {
          const runtime = window as unknown as { __fakeSpeechInstances: unknown[] };
          return runtime.__fakeSpeechInstances.length > minimum;
        },
        first.count,
      );

      expect(await page.evaluate(() => {
        const runtime = window as unknown as { __novaVoiceInput: { isRequested(): boolean } };
        return runtime.__novaVoiceInput.isRequested();
      })).toBe(true);

      await page.locator("#mic-btn").click();
      await page.waitForFunction(() => {
        const runtime = window as unknown as { __novaVoiceInput: { isRequested(): boolean } };
        return runtime.__novaVoiceInput.isRequested() === false;
      });
      await page.screenshot({ path: path.join(screenshotsDir, "continuous-mic-mobile.png"), fullPage: true });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("restores a finished durable mission into chat after reopen", async () => {
    const page = await openPage();
    try {
      await page.evaluate(() => {
        localStorage.setItem("bob-chats", JSON.stringify([{
          id: "chat-durable",
          title: "Durable task",
          createdAt: Date.now(),
          messages: [{
            role: "assistant",
            content: "Background run queued [NOVA_RUN_ID:42]",
            at: Date.now(),
          }],
        }]));
        const bubble = document.createElement("div");
        bubble.className = "bubble bubble-assistant";
        bubble.textContent = "Background run queued [NOVA_RUN_ID:42]";
        document.getElementById("chat-inner")?.appendChild(bubble);
      });

      await page.waitForFunction(() => {
        const chats = JSON.parse(localStorage.getItem("bob-chats") || "[]");
        return String(chats?.[0]?.messages?.[0]?.content || "").includes("Verified durable report");
      }, undefined, { timeout: 10_000 });

      const content = await page.evaluate(() => {
        const chats = JSON.parse(localStorage.getItem("bob-chats") || "[]");
        return String(chats?.[0]?.messages?.[0]?.content || "");
      });
      expect(content).toContain("Background run #42 complete");
      expect(content).toContain("Verified durable report");
      expect(await page.locator("#chat-inner .bubble").last().textContent()).toContain("Verified durable report");
      await page.screenshot({ path: path.join(screenshotsDir, "durable-run-resumed-mobile.png"), fullPage: true });
    } finally {
      await page.close();
    }
  }, 60_000);
});
