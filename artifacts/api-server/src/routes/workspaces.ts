/**
 * Workspace file store — server-side CRUD for NOVA workspace files.
 *
 * Mirrors the client-side IndexedDB 'bob-workspaces' so the AI can read and
 * write workspace files via nova-services without requiring a browser session.
 * All routes require the work-tree PIN cookie or the SUPERNOVA_API_KEY bearer
 * token (set upstream in routes/index.ts via requireWtAuth).
 *
 * Routes
 *   GET  /workspaces                         list all workspaces with counts
 *   GET  /workspaces/:ws/files               list + full content of files in a workspace
 *   GET  /workspaces/:ws/files/:filename     read one file
 *   POST /workspaces/:ws/files               upsert a file  { filename, content, contentType? }
 *   DELETE /workspaces/:ws/files/:filename   delete a file
 */

import { Router } from "express";
import { z } from "zod";
import { db, hasDatabase, workspaceFilesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router = Router();

// Valid workspace slugs – must match client-side WS_DEFS in bob.js
const VALID_WORKSPACES = new Set([
  "medical", "health", "dietary", "fitness", "todo", "tasks", "agents",
  "pictures", "numerology", "sacred", "vedic", "mystic", "manifest", "quantum",
]);

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
router.get("/workspaces", async (_req, res) => {
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
router.get("/workspaces/:ws/files", async (req, res) => {
  const ws = req.params.ws.toLowerCase();
  if (!validWs(ws)) { res.status(400).json({ error: "invalid workspace" }); return; }
  if (!dbGuard(res)) return;
  try {
    const rows = await db!
      .select()
      .from(workspaceFilesTable)
      .where(eq(workspaceFilesTable.workspace, ws))
      .orderBy(workspaceFilesTable.updatedAt);
    const files = rows.map(r => ({
      filename: r.filename,
      content: r.content,
      contentType: r.contentType,
      size: Buffer.byteLength(r.content, "utf8"),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    res.json({ workspace: ws, files });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /workspaces/:ws/files/:filename ──────────────────────────────────────
router.get("/workspaces/:ws/files/:filename", async (req, res) => {
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

// ── POST /workspaces/:ws/files ───────────────────────────────────────────────
router.post("/workspaces/:ws/files", async (req, res) => {
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
router.delete("/workspaces/:ws/files/:filename", async (req, res) => {
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
