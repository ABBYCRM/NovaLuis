/**
 * Favorites — save, list, delete bookmarked URLs with auto-metadata fetch.
 *
 * GET    /favorites                 list all (newest first)
 * POST   /favorites                 save a URL (auto-fetches title/favicon if not provided)
 * DELETE /favorites/:id             remove a favorite
 * GET    /favorites/metadata?url=…  server-side URL metadata scrape (title, description, favicon)
 */
import { Router } from "express";
import { z } from "zod";
import { db, hasDatabase, favoritesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

function dbGuard(res: import("express").Response): boolean {
  if (!hasDatabase || !db) { res.status(503).json({ error: "database not configured" }); return false; }
  return true;
}

// ── GET /favorites/metadata — fetch URL metadata server-side ─────────────────
router.get("/favorites/metadata", async (req, res) => {
  const url = String(req.query.url ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: "valid http/https URL required" });
    return;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (NOVA Favorites; +https://nova.app)" },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    const html = await r.text();
    const getTag = (prop: string): string => {
      const m =
        html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i")) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
      return m?.[1]?.trim() ?? "";
    };
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = getTag("og:title") || titleMatch?.[1]?.trim() || "";
    const description = getTag("og:description") || getTag("description");

    const origin = new URL(url).origin;
    const favicon =
      (html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
       html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i))?.[1]?.trim() || "";
    const faviconUrl = favicon
      ? (favicon.startsWith("http") ? favicon : favicon.startsWith("//") ? `https:${favicon}` : `${origin}${favicon.startsWith("/") ? "" : "/"}${favicon}`)
      : `${origin}/favicon.ico`;

    res.json({ title: title.slice(0, 500), description: description.slice(0, 1000), favicon: faviconUrl });
  } catch (e) {
    // Return empty metadata on network failure rather than erroring
    const origin = (() => { try { return new URL(url).origin; } catch { return ""; } })();
    res.json({ title: "", description: "", favicon: origin ? `${origin}/favicon.ico` : "" });
  }
});

// ── GET /favorites ────────────────────────────────────────────────────────────
router.get("/favorites", async (_req, res) => {
  if (!dbGuard(res)) return;
  try {
    const rows = await db!.select().from(favoritesTable).orderBy(desc(favoritesTable.createdAt)).limit(500);
    res.json({ favorites: rows });
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

// ── POST /favorites ───────────────────────────────────────────────────────────
const saveSchema = z.object({
  url:         z.string().url(),
  title:       z.string().max(500).default(""),
  description: z.string().max(2000).default(""),
  favicon:     z.string().max(1000).default(""),
  tags:        z.string().max(500).default(""),
});

router.post("/favorites", async (req, res) => {
  if (!dbGuard(res)) return;
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", details: parsed.error.issues }); return; }
  try {
    const rows = await db!.insert(favoritesTable).values(parsed.data).returning();
    res.status(201).json({ ok: true, favorite: rows[0] });
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

// ── DELETE /favorites/:id ─────────────────────────────────────────────────────
router.delete("/favorites/:id", async (req, res) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    await db!.delete(favoritesTable).where(eq(favoritesTable.id, id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

export default router;
