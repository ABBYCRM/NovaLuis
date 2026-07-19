#!/usr/bin/env node

import fs from "node:fs";

const LIVE_URL = String(process.env.LIVE_URL || "").replace(/\/$/, "");
if (!LIVE_URL) throw new Error("LIVE_URL is required");

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
}

async function requiredText(pathname) {
  const response = await fetchWithTimeout(`${LIVE_URL}${pathname}`);
  const body = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}: ${body.slice(0, 500)}`);
  return body;
}

async function requiredJson(pathname) {
  const text = await requiredText(pathname);
  return JSON.parse(text);
}

const session = await requiredJson("/api/operator/session");
if (session.configured !== true) {
  throw new Error("live operator PIN session is not configured");
}

const protectedResponse = await fetchWithTimeout(
  `${LIVE_URL}/api/workspaces/pictures/files?meta=1`,
  { headers: { Accept: "application/json" } },
);
const protectedBody = await protectedResponse.json().catch(() => ({}));
if (protectedResponse.status !== 401 || protectedBody.needPin !== true) {
  throw new Error(
    `workspace challenge returned ${protectedResponse.status}: ${JSON.stringify(protectedBody).slice(0, 500)}`,
  );
}

const [authAsset, navigationAsset, durableAsset] = await Promise.all([
  requiredText("/assets/operator-session-auth.js"),
  requiredText("/assets/ui-navigation-preservation.js"),
  requiredText("/assets/durable-run-reconcile.js"),
]);

if (!authAsset.includes("/api/operator/unlock") || !authAsset.includes("first.status !== 401")) {
  throw new Error("live operator-session recovery asset is incomplete");
}
if (authAsset.includes("localStorage.setItem")) {
  throw new Error("operator PIN recovery must not persist the PIN in localStorage");
}
if (!navigationAsset.includes("/assets/operator-session-auth.js") ||
    !navigationAsset.includes("script.async = false")) {
  throw new Error("runtime loader does not deterministically load auth recovery first");
}
if (!durableAsset.includes("durable-thinking-indicator") ||
    !durableAsset.includes("Working in background")) {
  throw new Error("live durable 3D thinking indicator is missing");
}

const durableSource = fs.readFileSync(
  "artifacts/api-server/src/routes/durable-agent-chat.ts",
  "utf8",
);
if (!durableSource.includes("respondToContinuation") ||
    durableSource.indexOf("respondToContinuation") > durableSource.indexOf("isDurableAgentTask(userText)")) {
  throw new Error("durable continuation interception is missing or ordered after fallback routing");
}

const serverSource = fs.readFileSync("artifacts/api-server/src/index.ts", "utf8");
if (!serverSource.includes("await ensureSchema()") ||
    serverSource.indexOf("await ensureSchema()") > serverSource.indexOf("app.listen")) {
  throw new Error("schema bootstrap is not completed before listen");
}

const socialSource = fs.readFileSync("artifacts/api-server/src/social-cron.ts", "utf8");
if (!socialSource.includes("if (fresh.imageUrl) update.imageUrl = fresh.imageUrl") ||
    !socialSource.includes("preserving existing media")) {
  throw new Error("social cron can still erase existing media during regeneration failure");
}

console.log(JSON.stringify({
  ok: true,
  check: "regression-runtime",
  operatorSessionConfigured: session.configured,
  workspaceChallenge: protectedResponse.status,
  thinkingCube: true,
  durableContinuation: true,
  schemaBeforeListen: true,
  socialMediaPreserved: true,
  verifiedAt: new Date().toISOString(),
}));
