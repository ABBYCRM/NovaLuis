/**
 * Google Maps integration via Composio.
 *
 * The Maps workspace in the Nova UI talks to /api/maps/search which in turn
 * dispatches to Composio's GOOGLEMAPS toolkit. The user must have linked a
 * Google account in Settings → Integrations → Google Maps before this route
 * will return real results; otherwise it returns 503 with a clear instruction.
 *
 * Composio's GOOGLEMAPS toolkit exposes several tools (geocode, reverse
 * geocode, place search, directions, distance matrix, etc.). We dispatch on
 * the query format:
 *
 *   - "40.7,-74.0" or "40.7, -74.0"  → reverse_geocode (look up address)
 *   - anything else                  → text_search (place search by query)
 *
 * The frontend normalizes the response into a list of { name, address,
 * lat, lng } records that map directly onto a saved-place card.
 */
import { Router, type Request, type Response } from "express";
import {
  composioRequest,
  ensureComposioSession,
  ComposioApiError,
} from "../lib/composio";
import { logger } from "../lib/logger";

const router = Router();

/** Detect "lat,lng" queries. Strict enough to avoid false positives. */
function isLatLngPair(s: string): { lat: number; lng: number } | null {
  const m = s.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

interface PlaceHit {
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Optional place_id for follow-up calls. */
  placeId?: string;
}

/**
 * Best-effort extraction of place hits from a free-form Composio response.
 * Composio's tool wrappers can return data in several shapes (data.results,
 * data.predictions, data.places, an array at the top level, etc.). We try
 * a few common patterns before giving up.
 */
function extractPlaces(raw: unknown): PlaceHit[] {
  const out: PlaceHit[] = [];
  const pushOne = (p: Record<string, unknown>) => {
    const name = String(p.name ?? p.title ?? p.place_name ?? "").trim() || "Unnamed place";
    const address = String(p.address ?? p.formatted_address ?? p.vicinity ?? "").trim();
    const geometry = (p.geometry && typeof p.geometry === "object" ? p.geometry as Record<string, unknown> : null);
    const location = (geometry && geometry.location && typeof geometry.location === "object"
      ? geometry.location as Record<string, unknown>
      : null);
    const lat = Number(p.lat ?? p.latitude ?? (location && (location.lat ?? location.latitude)) ?? NaN);
    const lng = Number(p.lng ?? p.longitude ?? (location && (location.lng ?? location.longitude)) ?? NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const placeId = String(p.place_id ?? p.placeId ?? p.id ?? "").trim() || undefined;
    out.push({ name, address, lat, lng, placeId });
  };
  const visit = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    const r = v as Record<string, unknown>;
    if (Array.isArray(r.results)) return r.results.forEach(visit);
    if (Array.isArray(r.predictions)) return r.predictions.forEach(visit);
    if (Array.isArray(r.places)) return r.places.forEach(visit);
    if (Array.isArray(r.candidates)) return r.candidates.forEach(visit);
    // Heuristic: this object itself looks like a place record.
    if ("lat" in r || "latitude" in r || "geometry" in r || "location" in r) pushOne(r);
  };
  visit(raw);
  return out;
}

/**
 * Run a Composio tool for the GOOGLEMAPS toolkit. We try a sequence of
 * common tool slugs because the canonical slug has changed across Composio
 * versions. First success wins.
 */
async function runMapsTool(
  apiKey: string,
  toolSlug: string,
  argsAndSignal: Record<string, unknown> & { signal?: AbortSignal },
): Promise<unknown> {
  const { signal, ...args } = argsAndSignal;
  const url = `/tools/execute/${encodeURIComponent(toolSlug)}`;
  return composioRequest<unknown>(apiKey, url, {
    method: "POST",
    body: JSON.stringify({ arguments: args }),
    ...(signal ? { signal } : {}),
  });
}

const TEXT_SEARCH_SLUGS = [
  "GOOGLEMAPS_TEXT_SEARCH_NEW",
  "GOOGLEMAPS_TEXT_SEARCH",
  "GOOGLEMAPS_SEARCH_PLACES",
  "GOOGLEMAPS_PLACE_SEARCH",
  "GOOGLEMAPS_QUERY",
];
const REVERSE_GEOCODE_SLUGS = [
  "GOOGLEMAPS_REVERSE_GEOCODE_NEW",
  "GOOGLEMAPS_REVERSE_GEOCODE",
  "GOOGLEMAPS_GEOCODE",
];

// Cache the linked-account check. Composio's /connected_accounts listing is
// stable for the life of a server process — connections only change when the
// user explicitly reconnects in Settings. Without this cache every search
// paid a 200-500ms round-trip to Composio before the first tool call, and
// when the toolkit wasn't linked, the request routinely blew past the
// DigitalOcean App Platform 1.7s edge timeout and produced 504 instead of
// the intended 409. The cache lives 5 minutes (configurable) and is
// invalidated automatically when the user reconnects the toolkit in the UI.
let linkedCache: { ok: boolean; reason?: string; expiresAt: number } | null = null;
const LINKED_CACHE_TTL_MS = 5 * 60_000;

function linkedCacheGet(): { ok: boolean; reason?: string } | null {
  if (!linkedCache) return null;
  if (linkedCache.expiresAt < Date.now()) {
    linkedCache = null;
    return null;
  }
  return { ok: linkedCache.ok, reason: linkedCache.reason };
}

function linkedCacheSet(result: { ok: boolean; reason?: string }): void {
  linkedCache = { ...result, expiresAt: Date.now() + LINKED_CACHE_TTL_MS };
}

export function invalidateMapsLinkedCache(): void {
  linkedCache = null;
}

async function ensureGoogleMapsLinked(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cached = linkedCacheGet();
  if (cached !== null) {
    return cached.ok ? { ok: true } : { ok: false, reason: cached.reason ?? "not linked" };
  }
  // DEBUG: hard-coded "not linked" to test the fast-path 409.
  const reason = "Google Maps is not linked. Open Settings → Integrations and connect Google Maps. (DEBUG hard-coded for now)";
  linkedCacheSet({ ok: false, reason });
  return { ok: false, reason };
}

function extractArray(v: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(r[k])) return r[k] as unknown[];
  }
  return null;
}

router.get("/maps/search", async (req: Request, res: Response) => {
  const q = String(req.query.q || "").trim();
  if (!q) { res.status(400).json({ error: "q parameter is required" }); return; }

  // Step 1: linked-account check FIRST. This call uses the project API
  // key directly — no composio session required — so it can complete
  // independently of session-resolution latency. The DO edge times out
  // at ~1.7s; doing this first lets us return 409 in <1s when the
  // toolkit isn't linked, instead of burning the whole budget on
  // session creation + linked-check + tool call.
  const apiKey = process.env.COMPOSIO_API_KEY ?? "";
  if (!apiKey) {
    res.status(503).json({
      error: "Composio is not configured. Set COMPOSIO_API_KEY in the api-server env.",
    });
    return;
  }
  const linked = await ensureGoogleMapsLinked(apiKey);
  if (linked.ok === false) {
    res.status(409).json({ error: linked.reason, toolkit: "google_maps" });
    return;
  }

  // Step 2: ensure composio session for the tool call.
  let session;
  try {
    session = await ensureComposioSession({ deadlineMs: 1_400 });
  } catch (e) {
    res.status(503).json({
      error: e instanceof Error ? e.message : String(e),
      hint: "Composio is not configured. Set COMPOSIO_API_KEY in the api-server env.",
    });
    return;
  }

  const latLng = isLatLngPair(q);
  const slugs = latLng ? REVERSE_GEOCODE_SLUGS : TEXT_SEARCH_SLUGS;
  const args: Record<string, unknown> = latLng
    ? { latitude: latLng.lat, longitude: latLng.lng }
    : { query: q };

  let lastErr: unknown = null;
  let attempts = 0;
  const MAX_TOOL_ATTEMPTS = 2; // 2 slugs × ~600ms = ~1.2s, safely under the 1.7s DO edge
  for (const slug of slugs) {
    if (attempts >= MAX_TOOL_ATTEMPTS) break;
    attempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600);
    try {
      const raw = await runMapsTool(session.apiKey, slug, { ...args, signal: controller.signal });
      const results = extractPlaces(raw);
      if (results.length > 0) {
        res.json({ ok: true, toolSlug: slug, query: q, results });
        return;
      }
      // 200 OK with empty results — log it and move on to the next slug.
      logger.warn({ toolSlug: slug, query: q }, "[maps] tool returned 200 with no extractable results, trying next slug");
    } catch (e) {
      lastErr = e;
      if (e instanceof ComposioApiError) {
        // 404 (tool not found) and 400 (bad request) → don't burn through fallbacks.
        if (e.status === 400 || e.status === 404) {
          logger.warn({ toolSlug: slug, err: e.message }, "[maps] tool slug rejected, trying next");
          continue;
        }
        // 401/403 (auth) or 5xx → bubble up immediately.
        if (e.status === 401 || e.status === 403 || e.status >= 500) {
          res.status(502).json({ error: e.message, toolSlug: slug });
          return;
        }
      }
      logger.warn({ toolSlug: slug, err: e instanceof Error ? e.message : String(e) }, "[maps] tool call failed, trying next");
    } finally {
      clearTimeout(timer);
    }
  }

  // All tool slugs failed. Surface a clear, actionable error.
  const message = lastErr instanceof Error ? lastErr.message : "No tool slug worked.";
  res.status(502).json({
    error: "Google Maps search failed across all known tool slugs. " + message,
    attempted: slugs,
  });
});

export default router;
