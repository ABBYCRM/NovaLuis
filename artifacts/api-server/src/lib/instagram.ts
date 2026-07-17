/**
 * Instagram publish helpers.
 *
 * The Meta Graph API requires the Instagram business user id on every
 * INSTAGRAM_CREATE_MEDIA_CONTAINER and INSTAGRAM_CREATE_POST call. Composio
 * does NOT auto-inject it — the caller has to supply it.
 *
 * Resolution order (cached for the process lifetime):
 *   1. process.env.INSTAGRAM_IG_USER_ID           — operator-set env var
 *   2. globalThis.__novaIgUserId                  — set by an earlier publish
 *      (step-1 responses sometimes echo a fresh value)
 *   3. INSTAGRAM_GET_USER_INFO via Composio       — the OAuth connection we
 *      already have through Composio IS the auth path. This call returns the
 *      id directly, no Meta access token required.
 *
 * The discover call is process-singleton — once we have the id, every later
 * publish reuses it for free.
 */

const IG_USER_ID_ENV = "INSTAGRAM_IG_USER_ID";
const DISCOVER_TOOL = "INSTAGRAM_GET_USER_INFO";

let discoverPromise: Promise<string> | null = null;

function readEnvOrCache(): string {
  const env = String(process.env[IG_USER_ID_ENV] || "").trim();
  if (env) return env;
  const cached = (globalThis as { __novaIgUserId?: string }).__novaIgUserId;
  return typeof cached === "string" ? cached.trim() : "";
}

function rememberIgUserId(value: string): void {
  const trimmed = String(value || "").trim();
  if (!trimmed) return;
  (globalThis as { __novaIgUserId?: string }).__novaIgUserId = trimmed;
}

function findIdentifier(value: unknown, keys: string[], depth = 0): string {
  if (depth > 6 || value == null) return "";
  const root = value as Record<string, unknown> | null;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
  }
  for (const key of keys) {
    const candidate = root[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  for (const key of ["data", "result", "response", "response_data", "output", "details"]) {
    const found = findIdentifier(root[key], keys, depth + 1);
    if (found) return found;
  }
  return "";
}

/**
 * Call the local /api/integrations/composio/execute endpoint. We use the
 * internal loopback path so we don't need to re-authenticate to Composio
 * here — the route already does that.
 */
async function callComposioExecute(
  port: number,
  toolSlug: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const apiKey = process.env.SUPERNOVA_API_KEY || process.env.OPENCLAW_API_KEY || "";
  const response = await fetch(`http://127.0.0.1:${port}/api/integrations/composio/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ toolSlug, arguments: args }),
  });
  return response.json().catch(() => ({ error: "Composio returned an unreadable response" }));
}

/**
 * Discover the Instagram business user id via Composio's INSTAGRAM_GET_USER_INFO
 * tool. Idempotent and process-singleton — concurrent calls share one in-flight
 * promise so we never make more than one discover request at a time.
 */
async function discoverIgUserId(port: number): Promise<string> {
  if (discoverPromise) return discoverPromise;
  discoverPromise = (async () => {
    try {
      const data = await callComposioExecute(port, DISCOVER_TOOL, {});
      const root = data as Record<string, unknown> | null;
      if (!root) throw new Error("INSTAGRAM_GET_USER_INFO returned no data");
      const errorText = typeof root.error === "string" ? root.error.trim() : "";
      if (errorText && errorText !== "null") {
        throw new Error(`INSTAGRAM_GET_USER_INFO failed: ${errorText.slice(0, 300)}`);
      }
      const igUserId = findIdentifier(data, ["id", "user_id", "userId", "ig_user_id", "igUserId"]);
      if (!igUserId) {
        throw new Error(
          `INSTAGRAM_GET_USER_INFO returned no user id. Payload: ${JSON.stringify(data).slice(0, 300)}`,
        );
      }
      rememberIgUserId(igUserId);
      return igUserId;
    } catch (e) {
      // Allow retry on next publish
      discoverPromise = null;
      throw e;
    }
  })();
  return discoverPromise;
}

/**
 * Resolve the IG business user id, auto-discovering via Composio if no env
 * var or in-process cache is set. Throws with an actionable operator message
 * if discovery fails (e.g. Instagram is not connected through Composio).
 */
export async function resolveIgUserId(port: number): Promise<string> {
  const fromEnvOrCache = readEnvOrCache();
  if (fromEnvOrCache) return fromEnvOrCache;
  return discoverIgUserId(port);
}

/**
 * Remember an IG user id we just saw in a step-1 response (some Composio
 * wrappers echo a fresh value back). No-op on empty input.
 */
export function noteIgUserId(value: string): void {
  rememberIgUserId(value);
}

/**
 * True if INSTAGRAM_IG_USER_ID is configured and publish can proceed
 * synchronously without an extra round-trip to Composio.
 */
export function hasIgUserIdSync(): boolean {
  return Boolean(readEnvOrCache());
}
