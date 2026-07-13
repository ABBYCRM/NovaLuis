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
type ReadyDbModule = DbModule & { db: NonNullable<DbModule["db"]> };
let dbModulePromise: Promise<ReadyDbModule | null> | null = null;
async function getDb(): Promise<ReadyDbModule | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!dbModulePromise) {
    dbModulePromise = import("@workspace/db")
      .then((mod) => (mod.db ? (mod as ReadyDbModule) : null))
      .catch(() => null);
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

// ── OpenClaw engine ────────────────────────────────────────────────────────
// The official OpenClaw Gateway runs in this container on loopback. Its
// OpenAI-compatible Chat Completions endpoint executes a normal Gateway agent
// run, including OpenClaw's real tool loop, skills, workspace, sessions and
// verification behavior. Work-Tree keeps its existing DB/UI contract while
// OpenClaw is the single execution backend.
const OPENCLAW_GATEWAY_URL = (
  process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789"
).replace(/\/$/, "");
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const OPENCLAW_AGENT_MODEL = process.env.OPENCLAW_AGENT_MODEL || "openclaw/default";
const OPENCLAW_RUN_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.OPENCLAW_RUN_TIMEOUT_MS || 15 * 60 * 1000),
);
const WS_CATEGORIES = [
  "medical", "health", "dietary", "fitness", "todo", "tasks", "agents",
  "pictures", "numerology", "sacred", "vedic", "mystic", "manifest", "quantum",
];

const activeRuns = new Map<number, AbortController>();

function openClawMessages(goal: string) {
  const system =
    "You are NOVA's OpenClaw execution runtime. Execute the user's goal end to end with your real tools and workspace skills. " +
    "Use the nova-services skill whenever Gmail, Drive, Docs, Sheets, YouTube, Instagram, GitHub, Composio, NOVA knowledge, scratchpad, or skill-catalog data is relevant. For GitHub URLs and connected apps, run composio-status, composio-search, and composio-execute; if the app is disconnected, run composio-connect and return the real Connect Link. Never deny tool access before attempting the bridge. " +
    "Plan, act, inspect every tool result, verify the result against the goal, correct failures within bounded attempts, and never claim an action succeeded without evidence. " +
    "Classify the final finding into EXACTLY ONE category id from this list: " + WS_CATEGORIES.join(", ") + ". " +
    "If none fits, use \"agents\". Respond with ONLY one minified JSON object, without prose or code fences: " +
    "{\"category\":\"<one id>\",\"title\":\"<=80 char title\",\"report\":\"<markdown findings, actions, and verification evidence>\"}";
  return [
    { role: "system", content: system },
    { role: "user", content: goal },
  ];
}

function parseOpenClawResult(content: string): { category: string; title: string; report: string } {
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
    // A non-JSON final response is still preserved rather than fabricated.
  }
  return { category, title, report };
}

function trace(stage: string, detail: string, ok?: boolean): string {
  return JSON.stringify([
    {
      ts: new Date().toISOString(),
      runtime: "openclaw",
      stage,
      detail,
      ...(typeof ok === "boolean" ? { ok } : {}),
    },
  ]);
}

async function dispatchToOpenClaw(mod: ReadyDbModule, runId: number, goal: string): Promise<void> {
  if (activeRuns.has(runId)) return;

  const controller = new AbortController();
  activeRuns.set(runId, controller);
  const { eq, and, inArray } = await import("drizzle-orm");

  const setWhileActive = async (vals: Record<string, unknown>) => {
    try {
      await mod.db
        .update(mod.workTreeRunsTable)
        .set({ ...vals, updatedAt: new Date() })
        .where(
          and(
            eq(mod.workTreeRunsTable.id, runId),
            inArray(mod.workTreeRunsTable.status, ["pending", "running"]),
          ),
        );
    } catch {
      /* best effort; execution result must not be hidden by observability failure */
    }
  };

  const timeout = setTimeout(() => controller.abort(), OPENCLAW_RUN_TIMEOUT_MS);
  timeout.unref?.();

  try {
    if (!OPENCLAW_GATEWAY_TOKEN) {
      await setWhileActive({
        status: "failed",
        model: OPENCLAW_AGENT_MODEL,
        error: "OPENCLAW_GATEWAY_TOKEN is not configured on this server.",
        stageTrace: trace("configuration", "OpenClaw Gateway token missing", false),
      });
      return;
    }

    await setWhileActive({
      status: "running",
      model: OPENCLAW_AGENT_MODEL,
      error: "",
      stageTrace: trace("dispatch", `Dispatching run ${runId} to the loopback OpenClaw Gateway`),
    });

    const resp = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
        "x-openclaw-session-key": `nova-work-tree-${runId}`,
        "x-openclaw-message-channel": "webchat",
      },
      body: JSON.stringify({
        model: OPENCLAW_AGENT_MODEL,
        user: `nova-work-tree:${runId}`,
        stream: false,
        max_completion_tokens: 4096,
        messages: openClawMessages(goal),
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      await setWhileActive({
        status: "failed",
        model: OPENCLAW_AGENT_MODEL,
        error: `OpenClaw Gateway HTTP ${resp.status}: ${body.slice(0, 500)}`,
        stageTrace: trace("gateway-response", `HTTP ${resp.status}`, false),
      });
      return;
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const rawContent = data?.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string"
      ? rawContent
      : rawContent == null
        ? ""
        : JSON.stringify(rawContent);

    if (!content.trim()) {
      await setWhileActive({
        status: "failed",
        model: OPENCLAW_AGENT_MODEL,
        error: "OpenClaw completed without a final text payload.",
        stageTrace: trace("final-response", "Empty final payload", false),
      });
      return;
    }

    const { category, title, report } = parseOpenClawResult(content);
    const stored = `<!--sn-category:${category}-->\n` + (title ? `# ${title}\n\n` : "") + report;
    await setWhileActive({
      status: "done",
      report: stored.slice(0, 60000),
      error: "",
      model: OPENCLAW_AGENT_MODEL,
      stageTrace: trace("verified-final", "OpenClaw returned a non-empty final report", true),
    });
  } catch (e) {
    const aborted = controller.signal.aborted;
    await setWhileActive({
      status: "failed",
      model: OPENCLAW_AGENT_MODEL,
      error: aborted
        ? `OpenClaw run exceeded ${OPENCLAW_RUN_TIMEOUT_MS}ms or was cancelled.`
        : `OpenClaw dispatch failed: ${String((e as Error)?.message ?? e).slice(0, 500)}`,
      stageTrace: trace(aborted ? "aborted" : "dispatch-error", String((e as Error)?.message ?? e).slice(0, 500), false),
    });
  } finally {
    clearTimeout(timeout);
    activeRuns.delete(runId);
  }
}

export async function resumeOpenClawRuns(): Promise<void> {
  const mod = await getDb();
  if (!mod) return;
  try {
    const { inArray, asc } = await import("drizzle-orm");
    const limit = Math.min(Math.max(Number(process.env.OPENCLAW_RESUME_LIMIT || 10), 1), 25);
    const rows = await mod.db
      .select()
      .from(mod.workTreeRunsTable)
      .where(inArray(mod.workTreeRunsTable.status, ["pending", "running"]))
      .orderBy(asc(mod.workTreeRunsTable.updatedAt))
      .limit(limit);
    for (const row of rows) {
      void dispatchToOpenClaw(mod, Number(row.id), String(row.goal ?? ""));
    }
  } catch {
    // Startup reconciliation is best-effort; normal API health must remain up.
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
        model: OPENCLAW_AGENT_MODEL,
        status: "pending",
      })
      .returning();
    // Fire-and-forget: OpenClaw runs the mission while the client polls the DB.
    void dispatchToOpenClaw(mod, (row as Row).id as number, parsed.data.goal.slice(0, 8000));
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
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(mod.workTreeRunsTable.id, id),
          inArray(mod.workTreeRunsTable.status, ["pending", "running"]),
        ),
      )
      .returning();
    if (updated) {
      activeRuns.get(id)?.abort();
      res.json(apiRun(updated as Row));
      return;
    }
    // Either it doesn't exist or it is already terminal — disambiguate.
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

// Legacy node retry remains for pre-OpenClaw runs. It reopens the historical
// node for UI continuity, then retries the complete mission through OpenClaw.
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

    const allNodes = await mod.db
      .select()
      .from(mod.workTreeNodesTable)
      .where(eq(mod.workTreeNodesTable.runId, runId));
    const byId = new Map<number, Row>(
      allNodes.map((n) => [n.id as number, n as Row]),
    );

    await mod.db
      .update(mod.workTreeNodesTable)
      .set({ status: "pending", result: "", verification: "" })
      .where(eq(mod.workTreeNodesTable.id, nodeId));

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

    if (run.status === "done" || run.status === "failed") {
      const [updated] = await mod.db
        .update(mod.workTreeRunsTable)
        .set({
          status: "pending",
          report: "",
          error: "",
          model: OPENCLAW_AGENT_MODEL,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mod.workTreeRunsTable.id, runId),
            inArray(mod.workTreeRunsTable.status, ["done", "failed"]),
          ),
        )
        .returning();
      if (updated) {
        void dispatchToOpenClaw(mod, runId, String(run.goal ?? ""));
      }
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
