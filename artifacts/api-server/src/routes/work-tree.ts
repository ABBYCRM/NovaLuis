import { Router, type IRouter } from "express";
import {
  CreateWorkTreeRunBody,
  GetWorkTreeRunParams,
  CancelWorkTreeRunParams,
  RetryWorkTreeNodeParams,
} from "@workspace/api-zod";
import { requireWtAuth, handleUnlock } from "../lib/work-tree-auth";

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
    stageTrace: String(r.stageTrace ?? ""),
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
    trace: String(n.trace ?? ""),
    role: String(n.role ?? ""),
    createdAt: new Date(n.createdAt as string).toISOString(),
    updatedAt: new Date(n.updatedAt as string).toISOString(),
  };
}

// ── Super Nova engine ───────────────────────────────────────────────────
// A run dispatches the goal to the supernova swarm, which executes it with its
// inline agentic tool loop and returns a final report. We ask it to classify
// the finding into one NOVA workspace category; the client files the report
// into that workspace (the report carries an <!--sn-category:X--> marker).
const SUPERNOVA_BASE_URL = (
  process.env.SUPERNOVA_BASE_URL || "https://supernova-ekbj.onrender.com"
).replace(/\/$/, "");
const SUPERNOVA_API_KEY =
  process.env.SUPERNOVA_API_KEY || process.env.OPENCLAW_API_KEY || "";
const WS_CATEGORIES = [
  "medical", "health", "dietary", "fitness", "todo", "tasks", "agents",
  "pictures", "numerology", "sacred", "vedic", "mystic", "manifest", "quantum",
];

function supernovaMessages(goal: string) {
  const system =
    "You are Super Nova, an autonomous operator. Execute the user's goal end to end using your real tools " +
    "(web fetch/search/compute) — plan, act, verify, correct — then produce a final report of your findings. " +
    "Classify the finding into EXACTLY ONE category id from this list: " + WS_CATEGORIES.join(", ") + ". " +
    "If none fits, use \"agents\". Respond with ONLY a single minified JSON object — no prose, no code fences: " +
    "{\"category\":\"<one id>\",\"title\":\"<=80 char title>\",\"report\":\"<markdown findings>\"}";
  return [
    { role: "system", content: system },
    { role: "user", content: goal },
  ];
}

function parseSupernovaResult(content: string): { category: string; title: string; report: string } {
  let category = "agents";
  let title = "";
  let report = content || "";
  try {
    const s = content.indexOf("{");
    const e = content.lastIndexOf("}");
    if (s !== -1 && e > s) {
      const obj = JSON.parse(content.slice(s, e + 1)) as Record<string, unknown>;
      const c = String(obj.category ?? "").toLowerCase().trim();
      category = WS_CATEGORIES.includes(c) ? c : "agents";
      title = String(obj.title ?? "").slice(0, 200);
      report = String(obj.report ?? content);
    }
  } catch {
    // Non-JSON reply: keep the raw content, file it under "agents".
  }
  return { category, title, report };
}

async function dispatchToSupernova(mod: DbModule, runId: number, goal: string): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const set = async (vals: Record<string, unknown>) => {
    try {
      await mod.db
        .update(mod.workTreeRunsTable)
        .set({ ...vals, updatedAt: new Date() })
        .where(eq(mod.workTreeRunsTable.id, runId));
    } catch {
      /* best effort */
    }
  };
  if (!SUPERNOVA_API_KEY) {
    await set({ status: "failed", error: "SUPERNOVA_API_KEY is not configured on this server." });
    return;
  }
  await set({ status: "running" });
  try {
    const resp = await fetch(`${SUPERNOVA_BASE_URL}/api/external/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPERNOVA_API_KEY}` },
      body: JSON.stringify({ model: "abby", stream: false, max_tokens: 4096, messages: supernovaMessages(goal) }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      await set({ status: "failed", error: `supernova HTTP ${resp.status}: ${body.slice(0, 300)}` });
      return;
    }
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content ?? "";
    const { category, title, report } = parseSupernovaResult(content);
    const stored = `<!--sn-category:${category}-->\n` + (title ? `# ${title}\n\n` : "") + report;
    await set({ status: "done", report: stored.slice(0, 60000), model: "supernova/abby" });
  } catch (e) {
    await set({ status: "failed", error: `supernova dispatch failed: ${String((e as Error)?.message ?? e).slice(0, 300)}` });
  }
}

const router: IRouter = Router();

// PIN unlock is the one open endpoint; everything else requires the cookie.
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
    res.json({ runs: rows.map((r) => apiRun(r as Row)) });
  } catch (e) {
    req.log.error({ err: e }, "work-tree list runs failed");
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
        goal: parsed.data.goal.slice(0, 8000),
        model: (parsed.data.model ?? "").slice(0, 200),
        status: "pending",
      })
      .returning();
    // Fire-and-forget: the supernova swarm runs in the background; the client
    // polls the run until it reaches "done" (or "failed").
    void dispatchToSupernova(mod, (row as Row).id as number, parsed.data.goal.slice(0, 8000));
    res.status(201).json(apiRun(row as Row));
  } catch (e) {
    req.log.error({ err: e }, "work-tree create run failed");
    res.status(500).json({ error: "failed to create run" });
  }
});

router.get("/work-tree/runs/:id", requireWtAuth, async (req, res) => {
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

router.post("/work-tree/runs/:id/cancel", requireWtAuth, async (req, res) => {
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

router.post("/work-tree/nodes/:id/retry", requireWtAuth, async (req, res) => {
  const parsed = RetryWorkTreeNodeParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const nodeId = Number(parsed.data.id);
  const mod = await getDb();
  if (!mod) {
    res.status(503).json({ error: "database unavailable" });
    return;
  }
  try {
    const { eq, and, inArray } = await import("drizzle-orm");

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

    const runId = node.runId as number;
    const [run] = await mod.db
      .select()
      .from(mod.workTreeRunsTable)
      .where(eq(mod.workTreeRunsTable.id, runId));
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    if (String(run.status) === "cancelled") {
      res.status(409).json({ error: "run is cancelled" });
      return;
    }

    // Load all nodes so we can walk the parent chain and re-open ancestors.
    const allNodes = await mod.db
      .select()
      .from(mod.workTreeNodesTable)
      .where(eq(mod.workTreeNodesTable.runId, runId));
    const byId = new Map<number, Row>(
      allNodes.map((n) => [n.id as number, n as Row]),
    );

    // Reset the failed node back to pending so the worker re-executes it. Clear
    // its prior result/verification but retain the attempts counter for history.
    await mod.db
      .update(mod.workTreeNodesTable)
      .set({ status: "pending", result: "", verification: "" })
      .where(eq(mod.workTreeNodesTable.id, nodeId));

    // Re-open settled (done/failed) ancestor composites to "running" so
    // settleComposites re-evaluates them once the retried leaf resolves. They
    // must NOT go to "pending" — that would trigger a duplicate decomposition.
    const ancestorIds: number[] = [];
    let parentId = (node.parentId ?? null) as number | null;
    while (parentId != null) {
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.status === "done" || parent.status === "failed") {
        ancestorIds.push(parent.id as number);
      }
      parentId = (parent.parentId ?? null) as number | null;
    }
    if (ancestorIds.length) {
      await mod.db
        .update(mod.workTreeNodesTable)
        .set({ status: "running" })
        .where(inArray(mod.workTreeNodesTable.id, ancestorIds));
    }

    // Re-open the run if it had already finished, clearing the stale report.
    if (run.status === "done" || run.status === "failed") {
      const [updated] = await mod.db
        .update(mod.workTreeRunsTable)
        .set({ status: "running", report: "", error: "" })
        .where(
          and(
            eq(mod.workTreeRunsTable.id, runId),
            inArray(mod.workTreeRunsTable.status, ["done", "failed"]),
          ),
        )
        .returning();
      res.json(apiRun((updated ?? run) as Row));
      return;
    }
    res.json(apiRun(run as Row));
  } catch (e) {
    req.log.error({ err: e }, "work-tree retry node failed");
    res.status(500).json({ error: "failed to retry node" });
  }
});

export default router;
