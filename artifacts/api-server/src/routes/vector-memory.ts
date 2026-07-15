import { Router } from "express";
import { z } from "zod";
import {
  fillMissingEmbeddings,
  formatVectorMemoryContext,
  getFillJobStatus,
  ingestVectorMemory,
  recordVectorMemoryOutcome,
  retrieveVectorMemory,
  vectorMemoryStatus,
} from "../lib/vector-memory";

const router = Router();

const memoryTypes = [
  "semantic",
  "episodic",
  "procedural",
  "operational",
  "evidence",
  "failure",
  "decision",
  "preference",
  "code",
  "tool",
  "skill",
] as const;

const scopes = [
  "global",
  "user",
  "organization",
  "project",
  "repository",
  "mission",
  "agent",
  "session",
] as const;

const verificationLevels = [
  "verified",
  "observed",
  "inferred",
  "claimed",
  "contradicted",
  "failed",
] as const;

const phases = ["OBSERVE", "PLAN", "ACT", "VERIFY", "COMPARE", "CORRECT"] as const;
const intents = ["recall", "debug", "plan", "execute", "verify", "compare"] as const;

const ingestSchema = z.object({
  content: z.string().min(1).max(200_000),
  memoryType: z.enum(memoryTypes).default("semantic"),
  scope: z.enum(scopes).default("global"),
  scopeKey: z.string().max(500).default(""),
  missionId: z.string().max(200).nullable().optional(),
  agentId: z.string().max(200).nullable().optional(),
  source: z.string().max(200).default("runtime-api"),
  externalId: z.string().max(500).nullable().optional(),
  verification: z.enum(verificationLevels).default("claimed"),
  confidence: z.number().min(0).max(1).default(0.5),
  importance: z.number().min(0).max(1).default(0.5),
  salience: z.number().min(0).max(1).default(0.5),
  entities: z.array(z.string().max(300)).max(64).optional(),
  relationships: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  validUntil: z.string().datetime().nullable().optional(),
  supersedesId: z.number().int().positive().nullable().optional(),
  atomic: z.boolean().default(true),
});

router.get("/vector-memory/status", async (req, res) => {
  try {
    res.json(await vectorMemoryStatus());
  } catch (error) {
    req.log.error({ err: error }, "vector memory status failed");
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/vector-memory/ingest", async (req, res) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const { validUntil, ...memory } = parsed.data;
    const ids = await ingestVectorMemory({
      ...memory,
      validUntil: validUntil == null ? validUntil : new Date(validUntil),
    });
    res.json({ ok: true, ids, units: ids.length });
  } catch (error) {
    req.log.error({ err: error }, "vector memory ingest failed");
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

const searchSchema = z.object({
  query: z.string().min(1).max(20_000),
  limit: z.number().int().min(1).max(20).default(8),
  missionId: z.string().max(200).optional(),
  agentId: z.string().max(200).optional(),
  scopeKey: z.string().max(500).optional(),
  phase: z.enum(phases).optional(),
  intent: z.enum(intents).optional(),
  memoryTypes: z.array(z.enum(memoryTypes)).max(memoryTypes.length).optional(),
  minimumScore: z.number().min(0).max(1).default(0.25),
  includeContext: z.boolean().default(true),
});

router.post("/vector-memory/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const { query, includeContext, ...options } = parsed.data;
    const results = await retrieveVectorMemory(query, options);
    const context = includeContext ? formatVectorMemoryContext(results) : undefined;
    res.json({ results, ...(includeContext ? { context } : {}) });
  } catch (error) {
    req.log.error({ err: error }, "vector memory search failed");
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

const feedbackSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  successful: z.boolean(),
});

// POST /vector-memory/embed-missing  — start background embedding fill job
// GET  /vector-memory/embed-missing  — check job status
router.post("/vector-memory/embed-missing", async (req, res) => {
  const job = getFillJobStatus();
  if (job?.running) {
    res.json({ started: false, reason: "job already running", job });
    return;
  }
  // fire-and-forget
  fillMissingEmbeddings().catch((err) => req.log.error({ err }, "fill-embeddings job failed"));
  res.json({ started: true, message: "background fill job started — poll GET /vector-memory/embed-missing for progress" });
});

router.get("/vector-memory/embed-missing", async (req, res) => {
  const job = getFillJobStatus();
  if (!job) {
    res.json({ running: false, message: "no fill job has been started yet" });
    return;
  }
  res.json(job);
});

router.post("/vector-memory/feedback", async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }
  try {
    await recordVectorMemoryOutcome(parsed.data.ids, parsed.data.successful);
    res.json({ ok: true, updated: [...new Set(parsed.data.ids)].length });
  } catch (error) {
    req.log.error({ err: error }, "vector memory feedback failed");
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
