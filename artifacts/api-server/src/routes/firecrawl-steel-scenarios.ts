/**
 * Firecrawl + Steel Scenarios RAG endpoint.
 *
 * Wraps the vector-memory search scoped to `firecrawl-steel-scenarios` so Nova
 * can ask "what should I do when X happens with Firecrawl scraping / Steel
 * browser sessions?" and get back the matching procedural scenarios.
 *
 * Routes:
 *   POST /firecrawl-steel-scenarios/search   — semantic search over the corpus
 *   GET  /firecrawl-steel-scenarios/status   — how many scenarios are indexed
 */
import { Router } from "express";
import { z } from "zod";
import { retrieveVectorMemory, vectorMemoryStatus } from "../lib/vector-memory";

const router = Router();

// ── Enums (mirrors the CSV) ───────────────────────────────────────────────────
const SERVICES   = ["firecrawl", "steel", "joint"] as const;
const CATEGORIES = [
  "fc_scrape", "fc_crawl", "fc_map", "fc_search", "fc_extract",
  "fc_batch", "fc_webhook", "fc_errors", "fc_billing", "fc_monitor",
  "fc_zdr", "fc_agent",
  "st_session", "st_profile", "st_capture", "st_captcha",
  "st_proxy", "st_region", "st_errors",
  "agent", "pipeline", "security",
] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

// ── POST /firecrawl-steel-scenarios/search ────────────────────────────────────
const searchSchema = z.object({
  query:    z.string().min(1).max(2000),
  limit:    z.number().int().min(1).max(15).default(5),
  service:  z.enum(SERVICES).optional(),
  category: z.enum(CATEGORIES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  minScore: z.number().min(0).max(1).default(0.30),
});

router.post("/firecrawl-steel-scenarios/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }

  const { query, limit, service, category, severity, minScore } = parsed.data;

  const enrichedQuery = [
    query,
    service  ? `service:${service}`   : "",
    category ? `category:${category}` : "",
    severity ? `severity:${severity}` : "",
  ].filter(Boolean).join(" ");

  try {
    const hits = await retrieveVectorMemory(enrichedQuery, {
      limit:        limit + 5,
      scopeKey:     "firecrawl-steel-scenarios",
      minimumScore: minScore,
      memoryTypes:  ["procedural"],
    });

    const filtered = hits.filter(h => {
      const meta = h.metadata as Record<string, string>;
      if (service  && meta.service   !== service)  return false;
      if (category && meta.category  !== category) return false;
      if (severity && meta.severity  !== severity) return false;
      return true;
    }).slice(0, limit);

    const scenarios = filtered.map(h => {
      const meta = h.metadata as Record<string, string>;
      return {
        id:          meta.scenario_id ?? h.externalId,
        score:       h.score,
        service:     meta.service,
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
    req.log.error({ err: error }, "firecrawl-steel-scenarios search failed");
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ── GET /firecrawl-steel-scenarios/status ─────────────────────────────────────
router.get("/firecrawl-steel-scenarios/status", async (req, res) => {
  try {
    const status = await vectorMemoryStatus();
    res.json({
      ...status,
      note: "Filter to scopeKey=firecrawl-steel-scenarios for scenario-specific counts.",
    });
  } catch (error) {
    req.log.error({ err: error }, "firecrawl-steel-scenarios status failed");
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
