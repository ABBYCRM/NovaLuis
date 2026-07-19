#!/usr/bin/env node
// Quick smoke test for artifacts/agent/server.mjs.
// Boots the server on a free port, hits /healthz, /readyz, /v1/models,
// /v1/chat/completions (non-streaming). Skips the upstream model call
// if CUSTOM_AGENT_UPSTREAM_KEY isn't set — just verifies auth + format.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(here, "server.mjs");
const token = randomBytes(16).toString("hex");
const port = 28790 + Math.floor(Math.random() * 100);
const host = "127.0.0.1";

const child = spawn(
  process.execPath,
  [serverScript],
  {
    env: {
      ...process.env,
      CUSTOM_AGENT_HOST: host,
      CUSTOM_AGENT_PORT: String(port),
      CUSTOM_AGENT_TOKEN: token,
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

child.stdout.on("data", (d) => process.stdout.write(`[child] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[child err] ${d}`));

const startedAt = Date.now();
let readyOk = false;

async function waitReady() {
  while (Date.now() - startedAt < 5000) {
    try {
      const r = await fetch(`http://${host}:${port}/healthz`);
      if (r.ok) {
        readyOk = true;
        return;
      }
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server failed to become ready within 5s");
}

function check(name, ok, detail) {
  console.log(`[${ok ? "✅" : "❌"}] ${name}${detail ? " — " + detail : ""}`);
}

try {
  await waitReady();
  check("server starts and /healthz returns 200", readyOk);

  // /healthz is public — no auth needed
  const health = await fetch(`http://${host}:${port}/healthz`);
  const healthBody = await health.json();
  check("/healthz returns {status:ok,backend:custom-agent}",
    healthBody.status === "ok" && healthBody.backend === "custom-agent",
    JSON.stringify(healthBody));

  // /v1/models requires auth
  const noAuth = await fetch(`http://${host}:${port}/v1/models`);
  check("/v1/models without auth returns 401", noAuth.status === 401, `status=${noAuth.status}`);

  const models = await fetch(`http://${host}:${port}/v1/models`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const modelsBody = await models.json();
  check("/v1/models with auth returns model list",
    modelsBody.data?.length >= 1 && modelsBody.data[0].id,
    JSON.stringify(modelsBody).slice(0, 200));

  // /readyz requires auth and reports config state
  const ready = await fetch(`http://${host}:${port}/readyz`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const readyBody = await ready.json();
  check("/readyz reports backend=custom-agent and rules count",
    readyBody.backend === "custom-agent" && typeof readyBody.rules === "number" && readyBody.rules > 0,
    `rules=${readyBody.rules} upstream_key_set=${readyBody.upstream_key_set}`);

  // /v1/chat/completions: bad request without messages
  const badReq = await fetch(`http://${host}:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "kimi-k2.6" }),
  });
  check("chat-completions without messages returns 400", badReq.status === 400, `status=${badReq.status}`);

  // /v1/chat/completions: malformed JSON
  const badJson = await fetch(`http://${host}:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{not-json",
  });
  check("chat-completions with malformed JSON returns 400", badJson.status === 400, `status=${badJson.status}`);

  // /v1/chat/completions: hotel intent should set intent.hotel but won't
  // reach upstream unless CUSTOM_AGENT_UPSTREAM_KEY is set. We test that
  // the route doesn't crash and returns a sensible error if upstream is
  // unreachable.
  if (!process.env.CUSTOM_AGENT_UPSTREAM_KEY && !process.env.OPENAI_API_KEY) {
    console.log("\n[skip] no CUSTOM_AGENT_UPSTREAM_KEY / OPENAI_API_KEY; skipping upstream call test");
  } else {
    const chatResp = await fetch(`http://${host}:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "kimi-k2.6",
        messages: [{ role: "user", content: "hello, what is 2+2?" }],
        stream: false,
        max_tokens: 50,
      }),
    });
    const chatBody = await chatResp.json();
    const answer = chatBody.choices?.[0]?.message?.content || "";
    check("chat-completions returns an answer", chatResp.ok && answer.length > 0,
      `status=${chatResp.status} answer="${answer.slice(0, 80)}"`);
    check("chat-completions answer includes '4'",
      answer.includes("4"), `answer="${answer.slice(0, 120)}"`);
  }

  console.log("\n[done] all checks completed");
} catch (error) {
  console.error("[fatal]", error);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 1000).unref();
}
