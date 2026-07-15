/**
 * GitHub Scenarios RAG endpoint.
 *
 * Wraps the vector-memory search scoped to `github-scenarios` so Nova can ask
 * "what should I do when X happens with GitHub Actions / API / repos?" and get
 * back the matching procedural scenarios with their if_action / else_action.
 *
 * Routes:
 *   POST /github-scenarios/search   — semantic search over the scenario corpus
 *   GET  /github-scenarios/status   — how many scenarios are indexed
 */
import { Router } from "express";
import { z } from "zod";
import { retrieveVectorMemory, vectorMemoryStatus } from "../lib/vector-memory";

const router = Router();

// ── Category / severity enums (mirrors the CSV) ───────────────────────────────
const CATEGORIES = [
  "actions_run", "actions_job", "actions_step", "actions_cache",
  "actions_secret", "actions_artifact", "actions_env", "actions_concurrency",
  "actions_matrix", "actions_reusable", "actions_trigger", "actions_permissions",
  "api_rate_limit", "api_auth", "api_pagination", "api_webhook",
  "repo", "branch", "pr", "issue", "release", "deploy",
] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

// ── POST /github-scenarios/search ─────────────────────────────────────────────
const searchSchema = z.object({
  /** Plain-English description of what's happening — e.g. "workflow not triggering on push" */
  query:      z.string().min(1).max(2000),
  /** Max results (default 5, max 15) */
  limit:      z.number().int().min(1).max(15).default(5),
  /** Filter by GitHub category */
  category:   z.enum(CATEGORIES).optional(),
  /** Filter by severity */
  severity:   z.enum(SEVERITIES).optional(),
  /** Minimum semantic similarity (0-1, default 0.3) */
  minScore:   z.number().min(0).max(1).default(0.30),
});

router.post("/github-scenarios/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }

  const { query, limit, category, severity, minScore } = parsed.data;

  const enrichedQuery = [
    query,
    category ? `category:${category}` : "",
    severity ? `severity:${severity}` : "",
  ].filter(Boolean).join(" ");

  try {
    const hits = await retrieveVectorMemory(enrichedQuery, {
      limit:        limit + 5,
      scopeKey:     "github-scenarios",
      minimumScore: minScore,
      memoryTypes:  ["procedural"],
    });

    const filtered = hits.filter(h => {
      const meta = h.metadata as Record<string, string>;
      if (category && meta.category !== category) return false;
      if (severity && meta.severity !== severity) return false;
      return true;
    }).slice(0, limit);

    const scenarios = filtered.map(h => {
      const meta = h.metadata as Record<string, string>;
      return {
        id:          meta.scenario_id ?? h.externalId,
        score:       h.score,
        category:    meta.category,
        severity:    meta.severity,
        trigger:     meta.trigger,
        condition:   meta.condition,
        if_action:   meta.if_action,
        else_action: meta.else_action,
        source_doc:  meta.source_doc,
      };
    });

    res.json({ query, count: scenarios.length, scenarios });
  } catch (error) {
    req.log.error({ err: error }, "github-scenarios search failed");
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ── GET /github-scenarios/status ──────────────────────────────────────────────
router.get("/github-scenarios/status", async (req, res) => {
  try {
    const status = await vectorMemoryStatus();
    res.json({
      ...status,
      note: "Filter to scopeKey=github-scenarios for scenario-specific counts.",
    });
  } catch (error) {
    req.log.error({ err: error }, "github-scenarios status failed");
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
