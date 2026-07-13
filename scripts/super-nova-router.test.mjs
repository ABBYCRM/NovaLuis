import assert from "node:assert/strict";
import test from "node:test";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const router = await import("./super-nova-router.mjs");

function reset() {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  for (const key of ["OPENAI_API_KEY", "KIMI_API_KEY", "KIMI_MODEL", "GEMINI_API_KEY", "BITDEER_API_KEY", "BITDEER_MODEL", "HELICONE_API_KEY"]) delete process.env[key];
  globalThis.fetch = originalFetch;
}

test.afterEach(reset);

test("OpenAI is primary and max tokens defaults to at least 16K", async () => {
  process.env.OPENAI_API_KEY = "test-openai";
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200 });
  };
  const result = await router.completeMessage({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(result.provider, "openai");
  assert.ok(body.max_tokens >= 16384);
  assert.match(body.messages[0].content, /BOS OMEGA/);
});

test("router falls from OpenAI hard failure to configured Kimi", async () => {
  process.env.OPENAI_API_KEY = "test-openai";
  process.env.KIMI_API_KEY = "test-kimi";
  process.env.KIMI_MODEL = "configured-kimi-model";
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("openai.com")) return new Response("bad auth", { status: 401 });
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "kimi" } }] }), { status: 200 });
  };
  const result = await router.completeMessage({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(result.provider, "kimi");
  assert.equal(result.message.content, "kimi");
  assert.equal(calls.length, 2);
});

test("reasoning_content is never returned as user content", async () => {
  process.env.OPENAI_API_KEY = "test-openai";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", reasoning_content: "private reasoning" } }] }), { status: 200 });
  const result = await router.chatComplete({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(result, "");
});
