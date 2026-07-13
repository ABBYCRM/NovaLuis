import crypto from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export function boundedInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export const DEFAULT_FETCH_TIMEOUT_MS = boundedInt(
  process.env.BOS_FETCH_TIMEOUT_MS,
  30_000,
  1_000,
  120_000,
);
export const DEFAULT_MAX_BODY_BYTES = boundedInt(
  process.env.BOS_MAX_BODY_BYTES,
  1_048_576,
  1_024,
  10_485_760,
);
export const DEFAULT_MAX_OUTPUT_CHARS = boundedInt(
  process.env.BOS_MAX_OUTPUT_CHARS,
  24_000,
  1_000,
  200_000,
);

export const SECRET_ENV_NAMES = [
  "BITDEER_API_KEY", "BRAVE_API_KEY", "COMPOSIO_API_KEY", "DATABASE_URL",
  "DISCORD_BOT_TOKEN", "E2B_API_KEY", "EMBEDDINGS_API_KEY", "EXA_API_KEY",
  "FIRECRAWL_API_KEY", "GEMINI_API_KEY", "GITHUB_TOKEN", "GH_TOKEN",
  "HELICONE_API_KEY", "INNGEST_EVENT_KEY", "KIMI_API_KEY", "OPENAI_API_KEY",
  "OPENCLAW_API_KEY", "PINECONE_API_KEY", "RESEND_API_KEY", "SCRAPFLY_API_KEY",
  "SCRAPINGBEE_API_KEY", "SCREENSHOTONE_ACCESS_KEY", "SCREENSHOTONE_SECRET_KEY",
  "SESSION_SECRET", "STEEL_API_KEY", "SUPERNOVA_API_KEY", "TAVILY_API_KEY",
];

const SECRET_PATTERNS = [
  /\b(?:github_pat_|ghp_)[A-Za-z0-9_-]{12,}/g,
  /\bsk-(?:proj-|service-|kimi-)?[A-Za-z0-9_-]{12,}/g,
  /\brnd_[A-Za-z0-9_-]{12,}/g,
  /\b(?:tvly-|fc-|ste-|re_|pcsk_|e2b_|ak_|oak_|scp-live-)[A-Za-z0-9_-]{12,}/g,
  /\bBot\s+[A-Za-z0-9._-]{16,}/gi,
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
];

export function env(name) {
  return String(process.env[name] || "").trim();
}

export function truthy(name) {
  const value = env(name).toLowerCase();
  return value !== "" && !["0", "false", "off", "no"].includes(value);
}

export function safeText(value, maximum = 500) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[REDACTED]");
  for (const name of SECRET_ENV_NAMES) {
    const secret = env(name);
    if (secret.length >= 8) text = text.split(secret).join("[REDACTED]");
  }
  return text.slice(0, maximum);
}

export function errorResult(code, message, details) {
  return {
    error: code,
    message: safeText(message, 600),
    ...(details ? { details } : {}),
  };
}

export function stableId(prefix, input) {
  return `${prefix}_${crypto.createHash("sha256").update(String(input)).digest("hex").slice(0, 24)}`;
}

export function jsonSchema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}
export function stringSchema(description, extra = {}) {
  return { type: "string", description, ...extra };
}
export function integerSchema(description, minimum = 1, maximum = 100) {
  return { type: "integer", description, minimum, maximum };
}
export function arraySchema(description, items) {
  return { type: "array", description, items };
}

const CAPABILITY_DEFS = [
  { id: "model.openai", category: "model", required: ["OPENAI_API_KEY"] },
  { id: "model.kimi", category: "model", required: ["KIMI_API_KEY"], optional: ["KIMI_BASE_URL", "KIMI_MODEL"] },
  { id: "model.gemini", category: "model", required: ["GEMINI_API_KEY"] },
  { id: "model.bitdeer", category: "model", required: ["BITDEER_API_KEY"] },
  { id: "observability.helicone", category: "middleware", required: ["OPENAI_API_KEY", "HELICONE_API_KEY"] },
  { id: "search.tavily", category: "search", required: ["TAVILY_API_KEY"] },
  { id: "search.exa", category: "search", required: ["EXA_API_KEY"] },
  { id: "search.firecrawl", category: "search", required: ["FIRECRAWL_API_KEY"] },
  { id: "search.brave", category: "search", required: ["BRAVE_API_KEY"] },
  { id: "scrape.steel", category: "browser", required: ["STEEL_API_KEY"] },
  { id: "scrape.scrapingbee", category: "browser", required: ["SCRAPINGBEE_API_KEY"] },
  { id: "scrape.scrapfly", category: "browser", required: ["SCRAPFLY_API_KEY"] },
  { id: "screenshot.screenshotone", category: "media", required: ["SCREENSHOTONE_ACCESS_KEY"], optional: ["SCREENSHOTONE_SECRET_KEY"] },
  { id: "github.api", category: "git", requiredAny: ["GITHUB_TOKEN", "GH_TOKEN"] },
  { id: "email.resend", category: "productivity", required: ["RESEND_API_KEY", "RESEND_FROM"] },
  { id: "messaging.discord", category: "messaging", required: ["DISCORD_BOT_TOKEN"] },
  { id: "embeddings.openai", category: "memory", requiredAny: ["EMBEDDINGS_API_KEY", "OPENAI_API_KEY"] },
  { id: "vector.pinecone", category: "memory", required: ["PINECONE_API_KEY", "PINECONE_INDEX_HOST"] },
  { id: "events.inngest", category: "automation", required: ["INNGEST_EVENT_KEY"] },
  { id: "automation.composio", category: "automation", required: ["COMPOSIO_API_KEY", "COMPOSIO_USER_ID"] },
  {
    id: "sandbox.e2b", category: "runtime", required: ["E2B_API_KEY", "E2B_TEMPLATE_ID"],
    forceStatus: "adapter_not_implemented",
    note: "The repository does not install the E2B SDK; capability remains unavailable until a tested adapter is added.",
  },
  {
    id: "runtime.host_exec", category: "runtime", required: [],
    dynamicStatus: () => truthy("SUPER_NOVA_EXEC") && truthy("BOS_ALLOW_HOST_EXEC") ? "configured_not_probed" : "disabled",
    note: "Temporary-directory execution is not OS isolation and is disabled by default.",
  },
];

export function capabilityReport() {
  return CAPABILITY_DEFS.map((definition) => {
    const missing = (definition.required || []).filter((name) => !env(name));
    if (definition.requiredAny?.length && !definition.requiredAny.some((name) => env(name))) {
      missing.push(`one_of:${definition.requiredAny.join("|")}`);
    }
    let status = missing.length ? "missing_configuration" : "configured_not_probed";
    if (definition.dynamicStatus) status = definition.dynamicStatus();
    if (definition.forceStatus && !missing.length) status = definition.forceStatus;
    return {
      id: definition.id,
      category: definition.category,
      status,
      missing,
      configuredOptional: (definition.optional || []).filter((name) => env(name)),
      note: definition.note || null,
    };
  });
}

export function capabilityStatus(id) {
  return capabilityReport().find((entry) => entry.id === id) || {
    id,
    status: "unknown_capability",
    missing: [],
  };
}
export function capabilityConfigured(id) {
  return capabilityStatus(id).status === "configured_not_probed";
}

export function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false;
    return true;
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return isPublicAddress(mapped[1]);
    if (value === "::" || value === "::1") return false;
    if (value.startsWith("fc") || value.startsWith("fd")) return false;
    if (/^fe[89ab]/.test(value) || value.startsWith("ff")) return false;
    return true;
  }
  return false;
}

export function normalizePublicUrl(raw) {
  const url = new URL(String(raw || ""));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("only http and https URLs are allowed");
  if (url.username || url.password) throw new Error("embedded URL credentials are not allowed");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("non-standard ports are not allowed");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home") || host === "metadata.google.internal") {
    throw new Error("internal hostname is not allowed");
  }
  if (net.isIP(host) && !isPublicAddress(host)) throw new Error("non-public address is not allowed");
  return url;
}

function createPinnedLookup(expectedHostname) {
  return (hostname, options, callback) => {
    if (String(hostname).toLowerCase().replace(/\.$/, "") !== expectedHostname.toLowerCase().replace(/\.$/, "")) {
      callback(new Error("lookup hostname mismatch"));
      return;
    }
    dns.lookup(hostname, { ...(options || {}), all: true, verbatim: true }, (error, records) => {
      if (error) return callback(error);
      const list = Array.isArray(records) ? records : [records];
      if (!list.length) return callback(new Error("DNS returned no addresses"));
      if (list.some((record) => !record?.address || !isPublicAddress(record.address))) {
        return callback(new Error("DNS returned a non-public address"));
      }
      if (options?.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

const SAFE_REQUEST_HEADERS = new Set([
  "accept", "accept-language", "user-agent", "if-none-match", "if-modified-since",
]);
function sanitizeOutboundHeaders(input) {
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const [name, value] of Object.entries(input)) {
    if (SAFE_REQUEST_HEADERS.has(name.toLowerCase())) result[name] = String(value).slice(0, 1000);
  }
  return result;
}

export async function publicHttpFetch(args) {
  const method = String(args.method || "GET").toUpperCase();
  if (!["GET", "HEAD"].includes(method)) return errorResult("method_not_allowed", "http_fetch allows GET and HEAD only");
  const maxBytes = boundedInt(args.max_bytes, DEFAULT_MAX_BODY_BYTES, 1_024, 10_485_760);
  const maxRedirects = boundedInt(args.max_redirects, 4, 0, 5);
  const timeoutMs = boundedInt(args.timeout_ms, DEFAULT_FETCH_TIMEOUT_MS, 1_000, 120_000);

  async function requestOne(rawUrl, redirects) {
    const url = normalizePublicUrl(rawUrl);
    const transport = url.protocol === "https:" ? https : http;
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (!settled) {
          settled = true;
          fn(value);
        }
      };
      const request = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          servername: url.hostname,
          port: url.port || undefined,
          method,
          path: `${url.pathname}${url.search}`,
          lookup: createPinnedLookup(url.hostname),
          rejectUnauthorized: true,
          maxHeaderSize: 32 * 1024,
          headers: {
            Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.5",
            "Accept-Encoding": "identity",
            "User-Agent": "BOS-OMEGA/1.0",
            ...sanitizeOutboundHeaders(args.headers),
          },
        },
        (response) => {
          const status = response.statusCode || 0;
          const location = response.headers.location;
          if (status >= 300 && status < 400 && location) {
            response.resume();
            if (redirects >= maxRedirects) return finish(reject, new Error("maximum redirects exceeded"));
            return requestOne(new URL(location, url).toString(), redirects + 1).then(
              (value) => finish(resolve, value),
              (error) => finish(reject, error),
            );
          }
          const declared = Number(response.headers["content-length"] || 0);
          if (declared > maxBytes) return response.destroy(new Error("response body limit exceeded"));
          const chunks = [];
          let received = 0;
          response.on("data", (chunk) => {
            received += chunk.length;
            if (received > maxBytes) return response.destroy(new Error("response body limit exceeded"));
            chunks.push(Buffer.from(chunk));
          });
          response.once("error", (error) => finish(reject, error));
          response.once("end", () => finish(resolve, {
            url: url.toString(),
            status,
            contentType: String(response.headers["content-type"] || ""),
            body: Buffer.concat(chunks).toString("utf8"),
            bytes: received,
            truncated: false,
          }));
        },
      );
      request.setTimeout(timeoutMs, () => request.destroy(new Error("request timeout")));
      request.once("socket", (socket) => {
        socket.once(url.protocol === "https:" ? "secureConnect" : "connect", () => {
          if (!socket.remoteAddress || !isPublicAddress(socket.remoteAddress)) request.destroy(new Error("connected peer is not public"));
        });
      });
      request.once("error", (error) => finish(reject, error));
      request.end();
    });
  }

  try {
    return await requestOne(args.url, 0);
  } catch (error) {
    return errorResult("http_fetch_failed", error?.message || error);
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function readResponseLimited(response, maximumBytes = DEFAULT_MAX_BODY_BYTES) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel("response body limit exceeded").catch(() => {});
        throw new Error("response body limit exceeded");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function providerJson(url, options, label, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const text = (await readResponseLimited(response)).toString("utf8");
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${safeText(text, 300)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
