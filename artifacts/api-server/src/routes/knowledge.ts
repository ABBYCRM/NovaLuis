import { Router } from "express";
import { z } from "zod";
import { ingestText, searchKnowledge } from "../lib/knowledge";

const router = Router();

const ingestSchema = z.object({
  source: z.string().max(200).default("manual"),
  title: z.string().max(500).default(""),
  content: z.string().min(1).max(200_000),
  externalId: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Add text to the vector knowledge base (chunked + embedded server-side).
router.post("/knowledge/ingest", async (req, res) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const ids = await ingestText(parsed.data);
    res.json({ ok: true, ids, chunks: ids.length });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const searchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
});

// Semantic search over the knowledge base.
router.post("/knowledge/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const results = await searchKnowledge(parsed.data.query, parsed.data.limit);
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
