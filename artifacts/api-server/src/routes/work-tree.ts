import { Router, type IRouter } from "express";
import {
  CreateWorkTreeRunBody,
  GetWorkTreeRunParams,
  CancelWorkTreeRunParams,
} from "@workspace/api-zod";

// DB access is lazy + guarded so a missing/unreachable DATABASE_URL degrades to
// a clear 503 instead of crashing the server at boot (mirrors scratchpad.ts).
type DbModule = typeof import("@workspace/db");
let dbModulePromise: Promise<DbModule | null> | null = null;
async function getDb(): Promise<DbModule | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!dbModulePromise) {
    dbModulePromise = import("@workspace/db").catch(() => null);
  }
  return dbModulePromise;
}

type Row = Record<string, unknown>;

function apiRun(r: Record<string, unknown>) {
  return {
    id: r.id as number,
    goal: String(r.goal ?? ""),
    status: String(r.status ?? ""),
    model: String(r.model ?? ""),
    report: String(r.report ?? ""),
    error: String(r.error ?? ""),
    createdAt: new Date(r.createdAt as string).toISOString(),
    updatedAt: new Date(r.updatedAt as string).toISOString(),
  };
}

function apiNode(n: Record<string, unknown>) {
  return {
    id: n.id as number,
    runId: n.runId as number,
    parentId: (n.parentId ?? null) as number | null,
    title: String(n.title ?? ""),
    detail: String(n.detail ?? ""),
    kind: String(n.kind ?? ""),
    status: String(n.status ?? ""),
    depth: Number(n.depth ?? 0),
    position: Number(n.position ?? 0),
    result: String(n.result ?? ""),
    verification: String(n.verification ?? ""),
    attempts: Number(n.attempts ?? 0),
    createdAt: new Date(n.createdAt as string).toISOString(),
    updatedAt: new Date(n.updatedAt as string).toISOString(),
  };
}

const router: IRouter = Router();

router.get("/work-tree/runs", async (req, res) => {
  const mod = await getDb();
  if (!mod) {
    res.status(503).json({ error: "database unavailable" });
    return;
  }
  try {
    const { desc } = await import("drizzle-orm");
    const rows = await mod.db
      .select()
      .from(mod.workTreeRunsTable)
      .orderBy(desc(mod.workTreeRunsTable.createdAt));
    res.json({ runs: rows.map((r) => apiRun(r as Row)) });
  } catch (e) {
    req.log.error({ err: e }, "work-tree list runs failed");
    res.status(500).json({ error: "failed to list runs" });
  }
});

router.post("/work-tree/runs", async (req, res) => {
  const parsed = CreateWorkTreeRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body" });
    return;
  }
  const mod = await getDb();
  if (!mod) {
    res.status(503).json({ error: "database unavailable" });
    return;
  }
  try {
    const [row] = await mod.db
      .insert(mod.workTreeRunsTable)
      .values({
        goal: parsed.data.goal.slice(0, 8000),
        model: (parsed.data.model ?? "").slice(0, 200),
        status: "pending",
      })
      .returning();
    res.status(201).json(apiRun(row as Row));
  } catch (e) {
    req.log.error({ err: e }, "work-tree create run failed");
    res.status(500).json({ error: "failed to create run" });
  }
});

router.get("/work-tree/runs/:id", async (req, res) => {
  const parsed = GetWorkTreeRunParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const id = Number(parsed.data.id);
  const mod = await getDb();
  if (!mod) {
    res.status(503).json({ error: "database unavailable" });
    return;
  }
  try {
    const { eq, asc } = await import("drizzle-orm");
    const [run] = await mod.db
      .select()
      .from(mod.workTreeRunsTable)
      .where(eq(mod.workTreeRunsTable.id, id));
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    const nodes = await mod.db
      .select()
      .from(mod.workTreeNodesTable)
      .where(eq(mod.workTreeNodesTable.runId, id))
      .orderBy(
        asc(mod.workTreeNodesTable.depth),
        asc(mod.workTreeNodesTable.position),
        asc(mod.workTreeNodesTable.id),
      );
    res.json({
      run: apiRun(run as Row),
      nodes: nodes.map((n) => apiNode(n as Row)),
    });
  } catch (e) {
    req.log.error({ err: e }, "work-tree get run failed");
    res.status(500).json({ error: "failed to get run" });
  }
});

router.post("/work-tree/runs/:id/cancel", async (req, res) => {
  const parsed = CancelWorkTreeRunParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const id = Number(parsed.data.id);
  const mod = await getDb();
  if (!mod) {
    res.status(503).json({ error: "database unavailable" });
    return;
  }
  try {
    const { eq, inArray, and } = await import("drizzle-orm");
    const [updated] = await mod.db
      .update(mod.workTreeRunsTable)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(mod.workTreeRunsTable.id, id),
          inArray(mod.workTreeRunsTable.status, ["pending", "running"]),
        ),
      )
      .returning();
    if (updated) {
      res.json(apiRun(updated as Row));
      return;
    }
    // Either it doesn't exist or it's already terminal — disambiguate.
    const [existing] = await mod.db
      .select()
      .from(mod.workTreeRunsTable)
      .where(eq(mod.workTreeRunsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    res.json(apiRun(existing as Row));
  } catch (e) {
    req.log.error({ err: e }, "work-tree cancel run failed");
    res.status(500).json({ error: "failed to cancel run" });
  }
});

export default router;
