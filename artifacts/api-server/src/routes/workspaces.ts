/**
 * Workspace file store — server-side CRUD for NOVA workspace files.
 *
 * Mirrors the client-side IndexedDB 'bob-workspaces' so the AI can read and
 * write workspace files via nova-services without requiring a browser session.
 *
 * Every route in this file is gated by the NOVA_API_TOKEN shared-secret
 * middleware (see lib/api-auth.ts). When the env var is unset the route
 * returns 503 "auth not configured" — there is no silent-open path.
 *
 * Routes
 *   GET  /workspaces                         list all workspaces with counts
 *   GET  /workspaces/:ws/files               list + full content of files in a workspace
 *   GET  /workspaces/:ws/files/:filename     read one file
 *   GET  /workspaces/:ws/files/:filename/raw serve raw bytes (for <img src>)
 *   POST /workspaces/:ws/files               upsert a file  { filename, content, contentType? }
 *   DELETE /workspaces/:ws/files/:filename   delete a file
 */

import { Router } from "express";
import { z } from "zod";
import { db, hasDatabase, workspaceFilesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireApiAuth } from "../lib/api-auth";

const router = Router();

// IMPORTANT: apply requireApiAuth PER-ROUTE, not via `router.use(...)` at the
// top. Express sub-routers mounted at the parent root (no path prefix) leak
// `router.use()` middleware into EVERY sibling sub-router, which previously
// caused every /api/* call (chat, maps, capabilities, …) to 401 with "invalid
// or missing API token" instead of only the workspace routes. The per-route
// form below scopes the gate to just /api/workspaces/*. /raw is included so
// image thumbnails served to <img> tags go through the same gate; the browser
// shim or service worker attaches x-nova-token (or ?token= for <img>).

// Valid workspace slugs – must match the client-side workspace list in
// `artifacts/nova/index.html`. The validWs() regex below is the actual gate;
// this file is the single source of truth for which workspace names the API
// will accept.
function validWs(ws: string): boolean {
  return /^[a-z0-9_-]{1,100}$/i.test(ws);
}

function dbGuard(res: import("express").Response): boolean {
  if (!hasDatabase || !db) {
    res.status(503).json({ error: "database not configured" });
    return false;
  }
  return true;
}

// ── GET /workspaces ──────────────────────────────────────────────────────────
router.get("/workspaces", requireApiAuth, async (_req, res) => {
  if (!dbGuard(res)) return;
  try {
    const rows = await db!
      .select({
        workspace: workspaceFilesTable.workspace,
        count: sql<number>`count(*)::int`,
      })
      .from(workspaceFilesTable)
      .groupBy(workspaceFilesTable.workspace);
    res.json({ workspaces: rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /workspaces/:ws/files ────────────────────────────────────────────────
// `?meta=1` returns metadata only (no `content` field). This keeps the
// Pictures workspace — where files are images and the client loads them
// via /raw — from shipping multi-megabyte JSON responses on every
// panel open. Other workspaces that need the content (Calendar events,
// Maps saved places, Notes previews) omit the param.
router.get("/workspaces/:ws/files", requireApiAuth, async (req: import("express").Request<{ ws: string }>, res: import("express").Response) => {
  const ws = req.params.ws.toLowerCase();
  if (!validWs(ws)) { res.status(400).json({ error: "invalid workspace" }); return; }
  if (!dbGuard(res)) return;
  const metaOnly = req.query.meta === "1" || req.query.meta === "true";
  try {
    const rows = await db!
      .select()
      .from(workspaceFilesTable)
      .where(eq(workspaceFilesTable.workspace, ws))
      .orderBy(workspaceFilesTable.updatedAt);
    const files = rows.map(r => {
      const base = {
        filename: r.filename,
        contentType: r.contentType,
        size: Buffer.byteLength(r.content, "utf8"),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
      if (metaOnly) return base;
      return { ...base, content: r.content };
    });
    res.json({ workspace: ws, files });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /workspaces/:ws/files/:filename ──────────────────────────────────────
router.get("/workspaces/:ws/files/:filename", requireApiAuth, async (req: import("express").Request<{ ws: string; filename: string }>, res: import("express").Response) => {
  const ws = req.params.ws.toLowerCase();
  const filename = req.params.filename;
  if (!validWs(ws) || !filename) { res.status(400).json({ error: "invalid params" }); return; }
  if (!dbGuard(res)) return;
  try {
    const rows = await db!
      .select()
      .from(workspaceFilesTable)
      .where(
        and(
          eq(workspaceFilesTable.workspace, ws),
          eq(workspaceFilesTable.filename, filename),
        ),
      )
      .limit(1);
    if (!rows.length) { res.status(404).json({ error: "file not found" }); return; }
    const r = rows[0]!;
    res.json({
      filename: r.filename,
      content: r.content,
      contentType: r.contentType,
      size: Buffer.byteLength(r.content, "utf8"),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const upsertSchema = z.object({
  filename: z.string().min(1).max(500),
  content: z.string().max(10_000_000), // 10 MB — images stored as base64 can be large
  contentType: z.string().max(100).default("text/plain"),
});

// ── GET /workspaces/:ws/files/:filename/raw — serve raw bytes ────────────────
// Returns the file content as raw bytes with the correct Content-Type, so
// the browser can use it directly in <img src="..."> without parsing JSON.
// This is the route the Pictures workspace grid uses to render image
// thumbnails. Authenticated by the NOVA_API_TOKEN middleware at the top of
// this file; the browser fetch shim attaches the token via x-nova-token.
router.get("/workspaces/:ws/files/:filename/raw", requireApiAuth, async (req: import("express").Request<{ ws: string; filename: string }>, res: import("express").Response) => {
  const ws = req.params.ws.toLowerCase();
  const filename = req.params.filename;
  if (!validWs(ws) || !filename) { res.status(400).json({ error: "invalid params" }); return; }
  if (!dbGuard(res)) return;
  try {
    const rows = await db!
      .select()
      .from(workspaceFilesTable)
      .where(
        and(
          eq(workspaceFilesTable.workspace, ws),
          eq(workspaceFilesTable.filename, filename),
        ),
      )
      .limit(1);
    if (!rows.length) { res.status(404).json({ error: "file not found" }); return; }
    const r = rows[0]!;
    // content is stored as base64 in the DB (no data: prefix). Decode and
    // serve as the actual binary the browser expects.
    let raw: Buffer;
    try {
      raw = Buffer.from(r.content, "base64");
    } catch {
      // Fallback for plain-text workspaces (e.g. .md files) — serve as UTF-8.
      raw = Buffer.from(r.content, "utf8");
    }
    res.setHeader("Content-Type", r.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(raw.length));
    // Aggressive browser cache: workspace files are immutable per filename.
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    res.status(200).end(raw);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /workspaces/:ws/files ───────────────────────────────────────────────
router.post("/workspaces/:ws/files", requireApiAuth, async (req: import("express").Request<{ ws: string }>, res: import("express").Response) => {
  const ws = req.params.ws.toLowerCase();
  if (!validWs(ws)) { res.status(400).json({ error: "invalid workspace" }); return; }
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", details: parsed.error.issues }); return; }
  if (!dbGuard(res)) return;
  const { filename, content, contentType } = parsed.data;
  try {
    const rows = await db!
      .insert(workspaceFilesTable)
      .values({ workspace: ws, filename, content, contentType })
      .onConflictDoUpdate({
        target: [workspaceFilesTable.workspace, workspaceFilesTable.filename],
        set: { content, contentType, updatedAt: new Date() },
      })
      .returning();
    const r = rows[0]!;
    res.status(201).json({
      ok: true,
      filename: r.filename,
      workspace: r.workspace,
      size: Buffer.byteLength(r.content, "utf8"),
      updatedAt: r.updatedAt,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── DELETE /workspaces/:ws/files/:filename ───────────────────────────────────
router.delete("/workspaces/:ws/files/:filename", requireApiAuth, async (req: import("express").Request<{ ws: string; filename: string }>, res: import("express").Response) => {
  const ws = req.params.ws.toLowerCase();
  const filename = req.params.filename;
  if (!validWs(ws) || !filename) { res.status(400).json({ error: "invalid params" }); return; }
  if (!dbGuard(res)) return;
  try {
    const rows = await db!
      .delete(workspaceFilesTable)
      .where(
        and(
          eq(workspaceFilesTable.workspace, ws),
          eq(workspaceFilesTable.filename, filename),
        ),
      )
      .returning({ filename: workspaceFilesTable.filename });
    if (!rows.length) { res.status(404).json({ error: "file not found" }); return; }
    res.json({ ok: true, deleted: rows[0]!.filename });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
