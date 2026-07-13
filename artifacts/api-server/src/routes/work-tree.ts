import { Router, type IRouter } from "express";
import {
  CancelWorkTreeRunParams,
  CreateWorkTreeRunBody,
  GetWorkTreeRunParams,
  RetryWorkTreeNodeParams,
} from "@workspace/api-zod";
import { handleUnlock, requireWtAuth } from "../lib/work-tree-auth";

type DbModule = typeof import("@workspace/db");
type Row = Record<string, unknown>;

let dbModulePromise: Promise<DbModule | null> | null = null;
async function getDb(): Promise<DbModule | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!dbModulePromise) {
    dbModulePromise = import("@workspace/db").catch(() => null);
  }
  return dbModulePromise;
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.valueOf()) ? new Date(0).toISOString() : date.toISOString();
}

function apiRun(row: Row) {
  return {
    id: Number(row.id),
    goal: String(row.goal ?? ""),
    status: String(row.status ?? ""),
    model: String(row.model ?? ""),
    report: String(row.report ?? ""),
    error: String(row.error ?? ""),
    stageTrace: String(row.stageTrace ?? ""),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function apiNode(row: Row) {
  return {
    id: Number(row.id),
    runId: Number(row.runId),
    parentId: row.parentId == null ? null : Number(row.parentId),
    title: String(row.title ?? ""),
    detail: String(row.detail ?? ""),
    kind: String(row.kind ?? ""),
    status: String(row.status ?? ""),
    depth: Number(row.depth ?? 0),
    position: Number(row.position ?? 0),
    result: String(row.result ?? ""),
    verification: String(row.verification ?? ""),
    attempts: Number(row.attempts ?? 0),
    trace: String(row.trace ?? ""),
    role: String(row.role ?? ""),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

const router: IRouter = Router();
router.post("/work-tree/unlock", handleUnlock);

router.get("/work-tree/runs", requireWtAuth, async (req, res) => {
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
    res.json({ runs: rows.map((row) => apiRun(row as Row)) });
  } catch (error) {
    req.log.error({ err: error }, "work-tree list failed");
    res.status(500).json({ error: "failed to list runs" });
  }
});

router.post("/work-tree/runs", requireWtAuth, async (req, res) => {
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
        goal: parsed.data.goal.slice(0, 8_000),
        model: (parsed.data.model ?? "").slice(0, 200),
        status: "pending",
        report: "",
        error: "",
        stageTrace: "[]",
      })
      .returning();
    res.status(201).json(apiRun(row as Row));
  } catch (error) {
    req.log.error({ err: error }, "work-tree create failed");
    res.status(500).json({ error: "failed to create run" });
  }
});

router.get("/work-tree/runs/:id", requireWtAuth, async (req, res) => {
  const parsed = GetWorkTreeRunParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const mod = await getDb();
  if (!mod) {
    res.status(503).json({ error: "database unavailable" });
    return;
  }
  try {
    const { asc, eq } = await import("drizzle-orm");
    const id = Number(parsed.data.id);
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
      nodes: nodes.map((node) => apiNode(node as Row)),
    });
  } catch (error) {
    req.log.error({ err: error }, "work-tree get failed");
    res.status(500).json({ error: "failed to get run" });
  }
});

router.post("/work-tree/runs/:id/cancel", requireWtAuth, async (req, res) => {
  const parsed = CancelWorkTreeRunParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const mod = await getDb();
  if (!mod) {
    res.status(503).json({ error: "database unavailable" });
    return;
  }
  try {
    const { and, eq, inArray } = await import("drizzle-orm");
    const id = Number(parsed.data.id);
    const [updated] = await mod.db
      .update(mod.workTreeRunsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
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
    const [existing] = await mod.db
      .select()
      .from(mod.workTreeRunsTable)
      .where(eq(mod.workTreeRunsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    res.json(apiRun(existing as Row));
  } catch (error) {
    req.log.error({ err: error }, "work-tree cancel failed");
    res.status(500).json({ error: "failed to cancel run" });
  }
});

router.post("/work-tree/nodes/:id/retry", requireWtAuth, async (req, res) => {
  const parsed = RetryWorkTreeNodeParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const mod = await getDb();
  if (!mod) {
    res.status(503).json({ error: "database unavailable" });
    return;
  }
  try {
    const { and, eq, inArray } = await import("drizzle-orm");
    const nodeId = Number(parsed.data.id);
    const [node] = await mod.db
      .select()
      .from(mod.workTreeNodesTable)
      .where(eq(mod.workTreeNodesTable.id, nodeId));
    if (!node) {
      res.status(404).json({ error: "node not found" });
      return;
    }
    if (String(node.status) !== "failed") {
      res.status(409).json({ error: "only failed nodes can be retried" });
      return;
    }

    const runId = Number(node.runId);
    const [run] = await mod.db
      .select()
      .from(mod.workTreeRunsTable)
      .where(eq(mod.workTreeRunsTable.id, runId));
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }

    const allNodes = await mod.db
      .select()
      .from(mod.workTreeNodesTable)
      .where(eq(mod.workTreeNodesTable.runId, runId));
    const byId = new Map<number, Row>(
      allNodes.map((value) => [Number(value.id), value as Row]),
    );

    await mod.db
      .update(mod.workTreeNodesTable)
      .set({
        status: "pending",
        result: "",
        verification: "",
        trace: "",
        updatedAt: new Date(),
      })
      .where(eq(mod.workTreeNodesTable.id, nodeId));

    const ancestorIds: number[] = [];
    let parentId = node.parentId == null ? null : Number(node.parentId);
    while (parentId != null) {
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.status === "done" || parent.status === "failed") {
        ancestorIds.push(Number(parent.id));
      }
      parentId = parent.parentId == null ? null : Number(parent.parentId);
    }
    if (ancestorIds.length > 0) {
      await mod.db
        .update(mod.workTreeNodesTable)
        .set({ status: "running", updatedAt: new Date() })
        .where(inArray(mod.workTreeNodesTable.id, ancestorIds));
    }

    const [updatedRun] = await mod.db
      .update(mod.workTreeRunsTable)
      .set({ status: "running", report: "", error: "", updatedAt: new Date() })
      .where(
        and(
          eq(mod.workTreeRunsTable.id, runId),
          inArray(mod.workTreeRunsTable.status, ["done", "failed", "running"]),
        ),
      )
      .returning();
    res.json(apiRun((updatedRun ?? run) as Row));
  } catch (error) {
    req.log.error({ err: error }, "work-tree retry failed");
    res.status(500).json({ error: "failed to retry node" });
  }
});

export default router;
