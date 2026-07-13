import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  boundedInt,
  capabilityConfigured,
  env,
  errorResult,
  fetchWithTimeout,
  normalizePublicUrl,
  providerJson,
  readResponseLimited,
  safeText,
  stableId,
} from "./bos-omega-core.mjs";
import { githubProbe } from "./bos-omega-github.mjs";

function email(value) {
  const result = String(value || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error(`invalid email address: ${result}`);
  return result;
}

export async function resendSendEmail(args) {
  try {
    const key = env("RESEND_API_KEY");
    const from = env("RESEND_FROM");
    if (!key || !from) throw new Error("Resend is not configured");
    const to = (Array.isArray(args.to) ? args.to : [args.to]).filter(Boolean).map(email).slice(0, 50);
    if (!to.length) throw new Error("at least one recipient is required");
    const subject = String(args.subject || "").trim().slice(0, 998);
    if (!subject) throw new Error("subject is required");
    const idempotencyKey = String(args.idempotency_key || stableId("bos_email", `${to.join(",")}|${subject}|${args.text || args.html || ""}`)).slice(0, 256);
    const data = await providerJson("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        from, to, subject,
        ...(args.text ? { text: String(args.text).slice(0, 200_000) } : {}),
        ...(args.html ? { html: String(args.html).slice(0, 500_000) } : {}),
      }),
    }, "resend");
    return { id: data.id, to, subject, idempotencyKey };
  } catch (error) { return errorResult("email_send_failed", error?.message || error); }
}

export async function discordSendMessage(args) {
  try {
    const token = env("DISCORD_BOT_TOKEN");
    if (!token) throw new Error("Discord is not configured");
    const channelId = String(args.channel_id || "").trim();
    if (!/^\d{5,30}$/.test(channelId)) throw new Error("valid Discord channel_id is required");
    const content = String(args.content || "").trim().slice(0, 2000);
    if (!content) throw new Error("content is required");
    const data = await providerJson(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }, "discord");
    return { id: data.id, channelId: data.channel_id, timestamp: data.timestamp };
  } catch (error) { return errorResult("discord_send_failed", error?.message || error); }
}

export async function inngestSendEvent(args) {
  try {
    const key = env("INNGEST_EVENT_KEY");
    if (!key) throw new Error("Inngest is not configured");
    const name = String(args.name || "").trim().slice(0, 256);
    if (!name) throw new Error("event name is required");
    const id = String(args.id || stableId("bos_event", `${name}|${JSON.stringify(args.data || {})}`)).slice(0, 256);
    const data = await providerJson(`https://inn.gs/e/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, id, data: args.data && typeof args.data === "object" ? args.data : {} }),
    }, "inngest");
    return { ids: data.ids || [], status: data.status || 200, id };
  } catch (error) { return errorResult("inngest_event_failed", error?.message || error); }
}

export async function createEmbedding(input) {
  const key = env("EMBEDDINGS_API_KEY") || env("OPENAI_API_KEY");
  if (!key) throw new Error("embeddings provider is not configured");
  const model = env("EMBEDDINGS_MODEL") || "text-embedding-3-small";
  const data = await providerJson("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  }, "openai embeddings", 60_000);
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || !vector.length) throw new Error("embedding response was empty");
  return { vector, model, usage: data.usage || null };
}

export async function embeddingsCreate(args) {
  try {
    const input = String(args.input || "").slice(0, 100_000);
    if (!input) throw new Error("input is required");
    const result = await createEmbedding(input);
    return { model: result.model, dimensions: result.vector.length, ...(args.include_vector ? { vector: result.vector } : {}), usage: result.usage };
  } catch (error) { return errorResult("embedding_failed", error?.message || error); }
}

function pineconeHost() {
  const raw = env("PINECONE_INDEX_HOST");
  if (!raw) throw new Error("PINECONE_INDEX_HOST is required");
  const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  if (url.protocol !== "https:") throw new Error("Pinecone host must use https");
  return url.origin;
}

export async function pineconeQuery(args) {
  try {
    if (!env("PINECONE_API_KEY")) throw new Error("Pinecone is not configured");
    const query = String(args.query || "").slice(0, 100_000);
    if (!query) throw new Error("query is required");
    const embedding = await createEmbedding(query);
    const data = await providerJson(`${pineconeHost()}/query`, {
      method: "POST",
      headers: {
        "Api-Key": env("PINECONE_API_KEY"),
        "Content-Type": "application/json",
        ...(env("PINECONE_API_VERSION") ? { "X-Pinecone-API-Version": env("PINECONE_API_VERSION") } : {}),
      },
      body: JSON.stringify({
        vector: embedding.vector,
        topK: boundedInt(args.top_k, 5, 1, 100),
        includeMetadata: true,
        ...(args.namespace ? { namespace: String(args.namespace).slice(0, 256) } : {}),
      }),
    }, "pinecone");
    return { matches: data.matches || [], namespace: args.namespace || "" };
  } catch (error) { return errorResult("pinecone_query_failed", error?.message || error); }
}

export async function screenshotUrl(args, ctx, workingDirectory) {
  try {
    if (!env("SCREENSHOTONE_ACCESS_KEY")) throw new Error("ScreenshotOne is not configured");
    const target = normalizePublicUrl(args.url).toString();
    const url = new URL("https://api.screenshotone.com/take");
    url.searchParams.set("access_key", env("SCREENSHOTONE_ACCESS_KEY"));
    url.searchParams.set("url", target);
    url.searchParams.set("format", "png");
    url.searchParams.set("full_page", args.full_page === false ? "false" : "true");
    url.searchParams.set("block_ads", "true");
    url.searchParams.set("block_cookie_banners", "true");
    const response = await fetchWithTimeout(url, {}, 90_000);
    if (!response.ok) throw new Error(`ScreenshotOne HTTP ${response.status}`);
    const mimeType = String(response.headers.get("content-type") || "");
    if (!mimeType.includes("image/")) throw new Error("ScreenshotOne did not return an image");
    const buffer = await readResponseLimited(response, 15 * 1024 * 1024);
    const directory = await workingDirectory(ctx?.runId || "chat");
    const file = path.join(directory, `screenshot-${Date.now()}.png`);
    await fs.writeFile(file, buffer, { mode: 0o600 });
    return { saved: file, bytes: buffer.length, mimeType, sha256: crypto.createHash("sha256").update(buffer).digest("hex"), url: target };
  } catch (error) { return errorResult("screenshot_failed", error?.message || error); }
}

export async function probeProviders() {
  const probes = [
    ["github.api", githubProbe],
    ["model.openai", async () => providerJson("https://api.openai.com/v1/models?limit=1", { headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` } }, "openai probe")],
    ["model.kimi", async () => providerJson(`${(env("KIMI_BASE_URL") || "https://api.moonshot.ai/v1").replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${env("KIMI_API_KEY")}` } }, "kimi probe")],
  ];
  const results = [];
  for (const [id, probe] of probes) {
    if (!capabilityConfigured(id)) { results.push({ id, status: "missing_configuration" }); continue; }
    try { await probe(); results.push({ id, status: "operational" }); }
    catch (error) { results.push({ id, status: "probe_failed", error: safeText(error?.message || error, 240) }); }
  }
  return { results };
}
