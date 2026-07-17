import { db, knowledgeChunksTable, hasDatabase } from "@workspace/db";
import { sql } from "drizzle-orm";

const OPENAI_BASE = "https://api.openai.com/v1";
const OPENAI_EMBED_MODEL = "text-embedding-3-small";

// Gemini native embedContent — produces 1536-dim vectors via outputDimensionality.
// Model: gemini-embedding-2 (verified working 2026-07-15).
const GEMINI_EMBED_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_EMBED_MODEL = "models/gemini-embedding-2";
const GEMINI_EMBED_DIMS  = 1536; // must match vector(1536) column

async function embedWithOpenAI(input: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  timer.unref?.();
  try {
    const r = await fetch(`${OPENAI_BASE}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`openai embed ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { data: { embedding: number[] }[] };
    return j.data[0]!.embedding;
  } finally {
    clearTimeout(timer);
  }
}

async function embedWithGemini(input: string): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const url = `${GEMINI_EMBED_BASE}/${GEMINI_EMBED_MODEL}:embedContent?key=${key}`;
  const body = JSON.stringify({
    content: { parts: [{ text: input }] },
    outputDimensionality: GEMINI_EMBED_DIMS,
  });

  // Retry budget is intentionally tight so a single embed call stays well
  // under the DigitalOcean App Platform 30s request timeout. The previous
  // 5-attempt / 8s exponential schedule routinely blew that budget and
  // caused the LB to 502 every knowledge/ingest + vector-memory/embed-missing
  // call. With 3 attempts and a 2.5s ceiling the worst-case latency is ~6s.
  const MAX_ATTEMPTS = 3;
  const PER_ATTEMPT_TIMEOUT_MS = 8_000;
  let delay = 400; // ms
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
    timer.unref?.();
    let r: Response;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const reason = e instanceof Error ? e.message : String(e);
      if (attempt === MAX_ATTEMPTS) throw new Error(`gemini embed network error after ${attempt} attempts: ${reason}`);
      const waitMs = delay;
      await new Promise((res) => setTimeout(res, waitMs));
      delay *= 2;
      continue;
    }
    clearTimeout(timer);
    if (r.ok) {
      const j = (await r.json()) as { embedding: { values: number[] } };
      return j.embedding.values;
    }
    const retryable = r.status === 429 || r.status === 503 || r.status === 500 || r.status === 504;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      const text = await r.text().catch(() => "");
      throw new Error(`gemini embed ${r.status}: ${text.slice(0, 500)}`);
    }
    const retryAfter = r.headers.get("Retry-After");
    const waitMs = retryAfter ? Math.min(Number(retryAfter) * 1000, 2_500) : delay;
    await new Promise((res) => setTimeout(res, waitMs));
    delay *= 2;
  }
  throw new Error("gemini embed: exceeded max attempts");
}

// Embed a single string (1536-dim).
// Priority: Gemini → OpenAI fallback (if Gemini fails for any reason).
// Both keys live server-side, so the browser never sees them.
//
// Failover is critical because every embed call is on the request path of:
//   - /api/vector-memory/ingest     (user-driven)
//   - /api/vector-memory/search     (user-driven)
//   - /api/knowledge/ingest         (user-driven)
//   - fillMissingEmbeddings()       (background job)
// When Gemini is slow or rate-limited, falling back to OpenAI keeps the
// pipeline alive instead of silently writing rows without an embedding.
export async function embed(input: string): Promise<number[]> {
  const gemini = process.env.GEMINI_API_KEY ?? "";
  const openai = process.env.OPENAI_API_KEY ?? "";
  if (gemini) {
    try {
      return await embedWithGemini(input);
    } catch (geminiErr) {
      if (!openai) throw geminiErr;
      // Surface a soft warning in the logs so the operator can fix Gemini.
      console.warn(
        "[embed] Gemini embed failed, falling back to OpenAI:",
        geminiErr instanceof Error ? geminiErr.message : String(geminiErr),
      );
    }
  }
  if (openai) {
    return embedWithOpenAI(input);
  }
  throw new Error("No embedding provider configured. Set GEMINI_API_KEY and/or OPENAI_API_KEY.");
}

// Split long text into overlapping chunks suitable for embedding.
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size));
    i += size - overlap;
  }
  return chunks;
}

export interface IngestOpts {
  source?: string;
  title?: string;
  content: string;
  externalId?: string | null;
  metadata?: Record<string, unknown>;
}

// Cap chunks per ingest call: each chunk is one embeddings API call, so an
// unbounded document would let a single request rack up cost/latency.
const MAX_CHUNKS_PER_INGEST = 60;

// Idempotently ensure the pgvector extension + knowledge_chunks table exist.
// Self-heals databases that never ran the drizzle migration (so cross-app
// "save to NOVA workspace" works on a fresh DB). Runs once per process.
let schemaReady: Promise<void> | null = null;
export function ensureKnowledgeSchema(): Promise<void> {
  if (!hasDatabase || !db) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id serial PRIMARY KEY,
        source text NOT NULL DEFAULT 'manual',
        external_id text,
        title text NOT NULL DEFAULT '',
        content text NOT NULL DEFAULT '',
        embedding vector(1536),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await db.execute(
        sql`CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)`,
      );
    })().catch((e) => {
      schemaReady = null; // allow retry on next call
      throw e;
    });
  }
  return schemaReady;
}

// Chunk → embed → store. Returns the inserted row ids.
export async function ingestText(opts: IngestOpts): Promise<number[]> {
  if (!hasDatabase || !db) return [];
  await ensureKnowledgeSchema();
  const chunks = chunkText(opts.content);
  if (chunks.length > MAX_CHUNKS_PER_INGEST) {
    throw new Error(
      `content too large: ${chunks.length} chunks exceeds limit of ${MAX_CHUNKS_PER_INGEST}`,
    );
  }
  const ids: number[] = [];
  for (const ch of chunks) {
    const vec = await embed(ch);
    const [row] = await db
      .insert(knowledgeChunksTable)
      .values({
        source: opts.source ?? "manual",
        title: opts.title ?? "",
        content: ch,
        externalId: opts.externalId ?? null,
        embedding: vec,
        metadata: (opts.metadata ?? {}) as Record<string, unknown>,
      })
      .returning({ id: knowledgeChunksTable.id });
    if (row) ids.push(row.id);
  }
  return ids;
}

export interface KnowledgeHit {
  id: number;
  source: string;
  title: string;
  content: string;
  score: number;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  const r = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(r.rows)) return r.rows;
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

// Cosine-similarity search. Higher score = closer match (1 - distance).
export async function searchKnowledge(
  query: string,
  limit = 5,
): Promise<KnowledgeHit[]> {
  if (!hasDatabase || !db) return [];
  const vec = await embed(query);
  const lit = `[${vec.join(",")}]`;
  const result = await db.execute(sql`
    SELECT id, source, title, content, 1 - (embedding <=> ${lit}::vector) AS score
    FROM knowledge_chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${lit}::vector
    LIMIT ${limit}
  `);
  return rowsOf(result).map((r) => ({
    id: Number(r.id),
    source: String(r.source ?? ""),
    title: String(r.title ?? ""),
    content: String(r.content ?? ""),
    score: Number(r.score ?? 0),
  }));
}

export async function hasKnowledge(): Promise<boolean> {
  if (!hasDatabase || !db) return false;
  const result = await db.execute(
    sql`SELECT 1 FROM knowledge_chunks WHERE embedding IS NOT NULL LIMIT 1`,
  );
  return rowsOf(result).length > 0;
}

// Build a compact retrieval context for a user message. Returns "" when the KB
// is empty, nothing is relevant, or anything fails — callers inject it
// best-effort and must never let it break the chat.
export async function getKnowledgeContext(
  query: string,
  limit = 3,
): Promise<string> {
  try {
    if (!query.trim()) return "";
    if (!(await hasKnowledge())) return "";
    const hits = await searchKnowledge(query, limit);
    const good = hits.filter((h) => h.score > 0.2);
    if (!good.length) return "";
    return good
      .map((h, i) => `[${i + 1}] ${h.title ? h.title + " — " : ""}${h.content}`)
      .join("\n\n");
  } catch {
    return "";
  }
}
