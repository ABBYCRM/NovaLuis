import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import {
  addScheduledPostAliases,
  normalizeSocialSchedulePayload,
} from "../../api-server/src/lib/social-schedule-compat";

const here = path.dirname(fileURLToPath(import.meta.url));
const novaRoot = path.resolve(here, "..");
const apiRoot = path.resolve(novaRoot, "..", "api-server");
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

function asJson(body: unknown): string {
  return JSON.stringify(body);
}

describe("Nova UI preservation contracts", () => {
  it("adds legacy Scheduled aliases without removing camelCase fields", () => {
    const normalized = addScheduledPostAliases({
      id: 7,
      contentType: "portrait",
      imageUrl: "data:image/png;base64,abc",
      scheduledAt: "2026-07-19T04:00:00.000Z",
    }) as Record<string, unknown>;

    expect(normalized.contentType).toBe("portrait");
    expect(normalized.content_type).toBe("portrait");
    expect(normalized.imageUrl).toBe("data:image/png;base64,abc");
    expect(normalized.image_url).toBe("data:image/png;base64,abc");
    expect(normalized.scheduledAt).toBe("2026-07-19T04:00:00.000Z");
    expect(normalized.scheduled_at).toBe("2026-07-19T04:00:00.000Z");
  });

  it("preserves explicit values and passes unrelated payloads through", () => {
    const post = addScheduledPostAliases({
      imageUrl: "camel",
      image_url: "legacy",
    }) as Record<string, unknown>;
    expect(post.imageUrl).toBe("camel");
    expect(post.image_url).toBe("legacy");

    const unrelated = { ok: true };
    expect(normalizeSocialSchedulePayload(unrelated)).toBe(unrelated);
  });

  it("keeps the repair additive and loaded from the production boundary", () => {
    const css = fs.readFileSync(
      path.join(novaRoot, "public", "assets", "ui-preservation.css"),
      "utf8",
    );
    const appSource = fs.readFileSync(path.join(apiRoot, "src", "app.ts"), "utf8");

    expect(css).toContain(".fav-add-bar");
    expect(css).toContain("grid-column: 1 / -1");
    expect(css).toContain(".sm-tone-chip.active");
    expect(css).toContain(".sm-post-thumb img");
    expect(css).toContain("@media (hover: none) and (pointer: coarse)");

    expect(appSource).toContain("/assets/ui-preservation.css");
    expect(appSource).toContain("normalizeSocialSchedulePayload");
    expect(appSource).not.toContain("/assets/ui-preservation.js");
  });
});

describe.skipIf(!chromiumExecutable)("Nova mobile UI preservation in Chromium", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let baseURL: string;

  beforeAll(async () => {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const port = await freePort();
    process.env.PORT = String(port);
    process.env.BASE_PATH = "/";
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

  async function openMobilePage(): Promise<Page> {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.pathname;

      if (pathname === "/api/nova-config") {
        await route.fulfill({ status: 200, contentType: "application/json", body: asJson({ apiKey: "" }) });
        return;
      }
      if (pathname === "/api/favorites") {
        await route.fulfill({ status: 200, contentType: "application/json", body: asJson({ favorites: [] }) });
        return;
      }
      if (pathname === "/api/social/reference-images") {
        await route.fulfill({ status: 200, contentType: "application/json", body: asJson({ images: [] }) });
        return;
      }
      if (pathname === "/api/social/schedule") {
        const payload = normalizeSocialSchedulePayload({
          posts: [
            {
              id: 1,
              platform: "instagram",
              contentType: "portrait",
              caption: "Preserved scheduled-card image and caption",
              hashtags: "#nova",
              imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              scheduledAt: "2026-07-19T04:00:00.000Z",
              status: "published",
            },
          ],
        });
        await route.fulfill({ status: 200, contentType: "application/json", body: asJson(payload) });
        return;
      }

      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto(baseURL, { waitUntil: "load", timeout: 30_000 });
    await page.addStyleTag({ url: `${baseURL}assets/ui-preservation.css` });
    await page.locator("#empty-state").waitFor({ state: "visible", timeout: 15_000 });
    return page;
  }

  async function openSidebar(page: Page): Promise<void> {
    await page.locator("#hamburger").click();
    await page.waitForFunction(
      () => document.getElementById("sidebar")?.classList.contains("open") === true,
      undefined,
      { timeout: 5_000 },
    );
  }

  async function expectNoHorizontalOverflow(page: Page): Promise<void> {
    const widths = await page.evaluate(() => ({
      scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewport: window.innerWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.viewport + 1);
  }

  it("keeps Favorites Save visible without changing the reference panel", async () => {
    const page = await openMobilePage();
    try {
      await openSidebar(page);
      await page.locator("#fav-btn").click();
      await page.locator("#fav-overlay").waitFor({ state: "visible", timeout: 5_000 });

      const urlBox = await page.locator("#fav-url-input").boundingBox();
      const tagBox = await page.locator("#fav-tag-input").boundingBox();
      const saveBox = await page.locator("#fav-save-btn").boundingBox();
      expect(urlBox).not.toBeNull();
      expect(tagBox).not.toBeNull();
      expect(saveBox).not.toBeNull();
      expect(Math.abs((urlBox?.y ?? 0) - (tagBox?.y ?? 0))).toBeLessThanOrEqual(2);
      expect((saveBox?.y ?? 0)).toBeGreaterThan((urlBox?.y ?? 0) + (urlBox?.height ?? 0));
      expect((saveBox?.x ?? 0) + (saveBox?.width ?? 0)).toBeLessThanOrEqual(390);
      expect((saveBox?.height ?? 0)).toBeGreaterThanOrEqual(44);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: path.join(screenshotsDir, "favorites-mobile.png"), fullPage: true });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("keeps Campaign controls inside the NOVA dark pill language", async () => {
    const page = await openMobilePage();
    try {
      await openSidebar(page);
      await page.locator("#social-btn").click();
      await page.locator("#sm-overlay").waitFor({ state: "visible", timeout: 5_000 });
      await page.locator('[data-sm-tab="campaigns"]').click();

      const motivational = page.locator('#sm-camp-voice-chips [data-voice="motivational"]');
      const sarcastic = page.locator('#sm-camp-voice-chips [data-voice="sarcastic"]');
      const computed = await motivational.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          color: style.color,
          radius: Number.parseFloat(style.borderRadius),
        };
      });
      expect(computed.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(computed.color).not.toBe("rgb(0, 0, 0)");
      expect(computed.radius).toBeGreaterThanOrEqual(18);

      await sarcastic.click();
      expect(await sarcastic.evaluate((element) => element.classList.contains("active"))).toBe(true);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: path.join(screenshotsDir, "campaigns-mobile.png"), fullPage: true });
    } finally {
      await page.close();
    }
  }, 60_000);

  it("renders camelCase Scheduled media through the additive server contract", async () => {
    const page = await openMobilePage();
    try {
      await openSidebar(page);
      await page.locator("#social-btn").click();
      await page.locator("#sm-overlay").waitFor({ state: "visible", timeout: 5_000 });
      await page.locator('[data-sm-tab="scheduled"]').click();
      await page.locator(".sm-post-card").waitFor({ state: "visible", timeout: 5_000 });
      await page.locator(".sm-post-thumb img").waitFor({ state: "visible", timeout: 5_000 });

      const imageBox = await page.locator(".sm-post-thumb img").boundingBox();
      expect(imageBox).not.toBeNull();
      expect(imageBox?.width ?? 0).toBeGreaterThan(300);
      expect(imageBox?.height ?? 0).toBeGreaterThanOrEqual(150);

      const meta = await page.locator(".sm-post-meta").textContent();
      expect(meta).toContain("Instagram");
      expect(meta).toMatch(/2026/);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: path.join(screenshotsDir, "scheduled-mobile.png"), fullPage: true });
    } finally {
      await page.close();
    }
  }, 60_000);
});
