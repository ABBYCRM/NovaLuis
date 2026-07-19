import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...segments), "utf8");
}

describe("PWA regression contract", () => {
  it("stores and serves the latest successful navigation shell offline", () => {
    const serviceWorker = read("artifacts", "nova", "public", "sw.js");
    expect(serviceWorker).toContain("NAVIGATION_FALLBACK");
    expect(serviceWorker).toContain("cache.put(NAVIGATION_FALLBACK");
    expect(serviceWorker).toContain("caches.match(NAVIGATION_FALLBACK)");
    expect(serviceWorker).toContain("if (response.ok)");
    expect(serviceWorker).not.toContain("caches.match(request)\n");
  });
});
