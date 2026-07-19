import { Router, type NextFunction, type Request, type Response } from "express";
import { db, hasDatabase, workTreeRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

interface ChatMessage {
  role?: unknown;
  content?: unknown;
}

const RUN_MARKER = /\[NOVA_RUN_ID:(\d+)\]/;

function lastUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "user" && typeof message.content === "string") {
      return message.content.trim();
    }
  }
  return "";
}

function latestRunId(messages: ChatMessage[]): number | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index]?.content;
    if (typeof content !== "string") continue;
    const match = RUN_MARKER.exec(content);
    if (match) return Number(match[1]);
  }
  return null;
}

function isContinuation(text: string): boolean {
  return /^(?:yes[,.! ]*)?(?:go ahead|continue|proceed|keep going|do it|run it|finish it|carry on|resume|yes|okay|ok|start)(?:\s+(?:please|now))?[.! ]*$/i.test(
    String(text || "").trim(),
  );
}

export function isDurableAgentTask(text: string): boolean {
  const value = String(text || "").trim();
  if (!value) return false;

  const explicitBackground =
    /\b(?:run|keep running|continue|work)\b[\s\S]{0,80}\b(?:background|until (?:it is|it's|the job is) done|after i close|when i close|even if i close)\b/i.test(value) ||
    /\b(?:autonomous|agentic|long[- ]running|end[- ]to[- ]end|e2e)\b/i.test(value);

  const repositoryTarget =
    /https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(value) ||
    /\b(?:github|repository|repo|codebase|runtime)\b/i.test(value);

  const executionVerb =
    /\b(?:debug|diagnose|audit|inspect|analy[sz]e|fix|repair|remediate|test|verify|clone|build|deploy|merge|implement|refactor|review)\b/i.test(value);

  return explicitBackground || (repositoryTarget && executionVerb);
}

function buildGoal(messages: ChatMessage[], userText: string): string {
  const recent = messages
    .slice(-8)
    .filter((message) => typeof message.content === "string" && String(message.content).trim())
    .map((message) => `${String(message.role || "user").toUpperCase()}: ${String(message.content).trim()}`)
    .join("\n\n");

  return [
    "DURABLE MAIN-CHAT MISSION",
    "Continue independently until the requested repository/debug task reaches a verified terminal state.",
    "The browser or installed PWA may close. Do not stop because the client disconnects.",
    "Use the repository execution loop: observe, plan, act, verify, compare, correct, repeat, and report evidence.",
    "Never claim completion without tool/runtime evidence.",
    "",
    "RECENT CHAT CONTEXT:",
    recent || userText,
  ].join("\n").slice(0, 8000);
}

function queuedMessage(runId: number): string {
  return `⏳ Background run #${runId} queued and working. This mission is stored in the database and continues if the tab or installed app closes. [NOVA_RUN_ID:${runId}]`;
}

function cleanReport(report: unknown): string {
  return String(report || "").replace(/^<!--sn-category:[^>]+-->\s*/i, "").trim();
}

function sendStreamingResponse(
  res: Response,
  content: string,
  runId: number | null,
  httpStatus = 202,
): void {
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-nova-run-${runId || created}`;
  res.status(httpStatus);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (runId) res.setHeader("X-Nova-Background-Run", String(runId));
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model: "nova-durable-work-tree",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  })}\n\n`);
  res.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model: "nova-durable-work-tree",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

async function respondToContinuation(
  messages: ChatMessage[],
  userText: string,
  res: Response,
): Promise<boolean> {
  const runId = latestRunId(messages);
  if (!runId || !isContinuation(userText)) return false;
  if (!hasDatabase || !db) {
    res.status(503).json({ error: "durable execution database is unavailable" });
    return true;
  }

  const [run] = await db
    .select()
    .from(workTreeRunsTable)
    .where(eq(workTreeRunsTable.id, runId))
    .limit(1);

  if (!run) {
    sendStreamingResponse(res, `⚠ Background run #${runId} was not found.`, runId, 404);
    return true;
  }

  const status = String(run.status || "pending");
  if (status === "pending" || status === "running") {
    sendStreamingResponse(
      res,
      `⏳ Background run #${runId} is already ${status}. NOVA will continue until it reaches a verified terminal result.`,
      runId,
    );
    return true;
  }

  if (status === "done") {
    sendStreamingResponse(
      res,
      `✅ Background run #${runId} is complete.\n\n${cleanReport(run.report) || "The run completed without a report."}`,
      runId,
      200,
    );
    return true;
  }

  const [retry] = await db
    .insert(workTreeRunsTable)
    .values({
      goal: `${String(run.goal || "")}\n\nUSER FOLLOW-UP: ${userText}`.slice(0, 8000),
      status: "pending",
      model: String(run.model || process.env.WORK_TREE_MODEL || process.env.OPENCLAW_AGENT_MODEL || "nova-durable-work-tree"),
    })
    .returning({ id: workTreeRunsTable.id });

  if (!retry) throw new Error("database did not return the retried run");
  sendStreamingResponse(
    res,
    `⏳ Previous run #${runId} was ${status}. Recovery run #${retry.id} is queued and working. [NOVA_RUN_ID:${retry.id}]`,
    retry.id,
  );
  return true;
}

router.post(
  "/agent/v1/chat/completions",
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body && typeof req.body === "object"
      ? req.body as { messages?: unknown; stream?: unknown }
      : {};
    if (!Array.isArray(body.messages)) {
      next();
      return;
    }

    const messages = body.messages as ChatMessage[];
    const userText = lastUserText(messages);

    try {
      if (await respondToContinuation(messages, userText, res)) return;
    } catch (error) {
      req.log.error({ err: error }, "durable continuation failed");
      res.status(500).json({
        error: "failed to continue background mission",
        details: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (!isDurableAgentTask(userText)) {
      next();
      return;
    }

    if (!hasDatabase || !db) {
      res.status(503).json({
        error: "Durable background execution requires DATABASE_URL, but the database is unavailable.",
      });
      return;
    }

    try {
      const [run] = await db
        .insert(workTreeRunsTable)
        .values({
          goal: buildGoal(messages, userText),
          status: "pending",
          model: process.env.WORK_TREE_MODEL || process.env.OPENCLAW_AGENT_MODEL || "nova-durable-work-tree",
        })
        .returning({ id: workTreeRunsTable.id, status: workTreeRunsTable.status });

      if (!run) throw new Error("Database did not return the queued work-tree run");
      const content = queuedMessage(run.id);
      req.log.info({ runId: run.id, status: run.status }, "queued durable main-chat mission");

      if (body.stream !== false) {
        sendStreamingResponse(res, content, run.id);
        return;
      }

      res.status(202)
        .setHeader("X-Nova-Background-Run", String(run.id))
        .json({
          id: `chatcmpl-nova-run-${run.id}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "nova-durable-work-tree",
          choices: [{
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          }],
          nova: { durable: true, runId: run.id, status: run.status },
        });
    } catch (error) {
      req.log.error({ err: error }, "failed to queue durable main-chat mission");
      res.status(500).json({
        error: "Failed to queue durable background mission",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

export default router;
