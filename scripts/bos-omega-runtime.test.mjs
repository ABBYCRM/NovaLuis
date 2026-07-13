import assert from "node:assert/strict";
import test from "node:test";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function resetEnv() {
  for (const name of Object.keys(process.env)) {
    if (!(name in originalEnv)) delete process.env[name];
  }
  Object.assign(process.env, originalEnv);
  for (const name of [
    "TAVILY_API_KEY", "EXA_API_KEY", "FIRECRAWL_API_KEY", "BRAVE_API_KEY",
    "GITHUB_TOKEN", "GH_TOKEN", "RESEND_API_KEY", "RESEND_FROM",
    "SUPER_NOVA_EXEC", "BOS_ALLOW_HOST_EXEC", "PINECONE_API_KEY",
    "PINECONE_INDEX_HOST", "SCREENSHOTONE_ACCESS_KEY",
  ]) delete process.env[name];
}

const runtime = await import("./bos-omega-runtime.mjs");
const core = await import("./bos-omega-core.mjs");

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test.afterEach(() => {
  resetEnv();
  globalThis.fetch = originalFetch;
});

test("calculator executes bounded arithmetic", async () => {
  const result = await runtime.runTool("calculator", { expression: "(2+3)*4" });
  assert.equal(result.result, 20);
});

test("unauthenticated context cannot use GitHub tools", async () => {
  process.env.GITHUB_TOKEN = "test-token-not-a-real-secret";
  const definitions = runtime.activeToolDefinitions({ authenticated: false });
  assert.equal(definitions.some((entry) => entry.function.name === "github_get_repo"), false);
  const result = await runtime.runTool("github_get_repo", { repo: "ABBYCRM/NovaLuis" });
  assert.equal(result.error, "authentication_required");
});

test("approval-only GitHub writes stay blocked without approval", async () => {
  process.env.GITHUB_TOKEN = "test-token-not-a-real-secret";
  const result = await runtime.runTool(
    "github_create_issue",
    { repo: "ABBYCRM/NovaLuis", title: "test" },
    { authenticated: true },
  );
  assert.equal(result.error, "approval_required");
});

test("GitHub path traversal is rejected before network access", async () => {
  process.env.GITHUB_TOKEN = "test-token-not-a-real-secret";
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse(200, {});
  };
  const result = await runtime.runTool(
    "github_read_file",
    { repo: "ABBYCRM/NovaLuis", path: "../private" },
    { authenticated: true },
  );
  assert.equal(result.error, "github_read_failed");
  assert.equal(called, false);
});

test("web search falls through failed and empty providers", async () => {
  process.env.TAVILY_API_KEY = "test-tavily";
  process.env.EXA_API_KEY = "test-exa";
  process.env.FIRECRAWL_API_KEY = "test-firecrawl";
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("tavily")) return jsonResponse(401, { error: "bad key" });
    if (url.includes("exa.ai")) return jsonResponse(200, { results: [] });
    if (url.includes("firecrawl")) {
      return jsonResponse(200, {
        data: { web: [{ title: "Result", url: "https://example.com", description: "ok" }] },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await runtime.runTool(
    "web_search",
    { query: "nova", max_results: 5 },
    { authenticated: true },
  );
  assert.equal(result.provider, "firecrawl");
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.attempts.map((entry) => entry.status), ["failed", "empty", "success"]);
  assert.equal(calls.length, 3);
});

test("Firecrawl legacy data array is parsed", async () => {
  delete process.env.TAVILY_API_KEY;
  delete process.env.EXA_API_KEY;
  process.env.FIRECRAWL_API_KEY = "test-firecrawl";
  globalThis.fetch = async () => jsonResponse(200, {
    data: [{ title: "Legacy", url: "https://example.org", snippet: "legacy" }],
  });
  const result = await runtime.runTool(
    "web_search",
    { query: "legacy" },
    { authenticated: true },
  );
  assert.equal(result.provider, "firecrawl");
  assert.equal(result.results[0].title, "Legacy");
});

test("public HTTP tool rejects private and mutating targets before connection", async () => {
  const privateResult = await runtime.runTool("http_fetch", { url: "http://127.0.0.1" });
  assert.equal(privateResult.error, "http_fetch_failed");
  const methodResult = await runtime.runTool("http_fetch", {
    url: "https://example.com",
    method: "POST",
  });
  assert.equal(methodResult.error, "method_not_allowed");
});

test("capability output never contains environment secret values", async () => {
  const sentinel = "super-secret-sentinel-value";
  process.env.GITHUB_TOKEN = sentinel;
  const result = await runtime.runTool("capabilities", {});
  const text = JSON.stringify(result);
  assert.equal(text.includes(sentinel), false);
  assert.equal(result.capabilities.some((entry) => entry.id === "github.api"), true);
});

test("secret redaction removes known values and URL credentials", () => {
  const sentinel = "another-secret-sentinel";
  process.env.OPENAI_API_KEY = sentinel;
  const redacted = core.safeText(`token=${sentinel} postgres://user:pass@example.com/db`, 500);
  assert.equal(redacted.includes(sentinel), false);
  assert.equal(redacted.includes("user:pass"), false);
});

test("host execution is absent from the registered runtime", async () => {
  process.env.SUPER_NOVA_EXEC = "1";
  process.env.BOS_ALLOW_HOST_EXEC = "1";
  const definitions = runtime.activeToolDefinitions({
    authenticated: true,
    approvalGranted: true,
    internalWorker: true,
  });
  assert.equal(definitions.some((entry) => ["run_node", "run_python", "shell"].includes(entry.function.name)), false);
  const denied = await runtime.runTool(
    "run_node",
    { code: "console.log('ok')" },
    { authenticated: true, approvalGranted: true, internalWorker: true },
  );
  assert.equal(denied.error, "unknown_tool");
});
