/**
 * Vitest globalSetup — builds and starts the API server before any test
 * file runs, provides its base URL and peer key via vitest inject().
 *
 * The server process inherits the test process's full environment so all
 * Replit secrets / env vars are available. We add PORT and SUPERNOVA_API_KEY
 * on top so the server binds to a known port and the test can authenticate
 * to gated routes without a PIN cookie.
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_PEER_KEY = "nova-e2e-test-peer-key";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..", "..");
const API_SERVER_DIR = path.join(WORKSPACE_ROOT, "artifacts", "api-server");
const API_DIST = path.join(API_SERVER_DIR, "dist", "index.mjs");

/** Pick a random free TCP port on localhost. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close((err) => {
        if (err) return reject(err);
        if (!addr || typeof addr === "string") return reject(new Error("bad addr"));
        resolve(addr.port);
      });
    });
  });
}

/** Poll until the server's /api/healthz responds 200, or timeout. */
async function waitForServer(base: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/healthz`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (r.ok) return;
    } catch {
      // server not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`API server did not become ready within ${timeoutMs}ms`);
}

let serverProcess: ChildProcess | null = null;

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  // Build the api-server so all workspace deps are bundled into dist/index.mjs.
  // esbuild is fast (~2s); we always rebuild to pick up source changes.
  console.log("[global-setup] Building api-server…");
  execSync("pnpm run build", {
    cwd: API_SERVER_DIR,
    stdio: ["ignore", "inherit", "inherit"],
  });
  console.log("[global-setup] Build complete.");

  const port = await freePort();
  const apiBase = `http://127.0.0.1:${port}/api`;

  serverProcess = spawn(process.execPath, ["--enable-source-maps", API_DIST], {
    cwd: API_SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      // Server-to-server peer-key bypass so the test can call gated routes
      // without going through the PIN unlock flow.
      SUPERNOVA_API_KEY: TEST_PEER_KEY,
      OPENCLAW_API_KEY: TEST_PEER_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) process.stdout.write(`[api-server] ${line}\n`);
  });
  serverProcess.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) process.stderr.write(`[api-server] ${line}\n`);
  });

  serverProcess.on("error", (err) => {
    console.error("[global-setup] server process error:", err.message);
  });

  await waitForServer(apiBase);
  console.log(`[global-setup] API server ready at ${apiBase}`);

  provide("apiBase", apiBase);
  provide("peerKey", TEST_PEER_KEY);
}

export async function teardown() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    serverProcess = null;
  }
}
