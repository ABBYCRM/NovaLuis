import { createHash } from "node:crypto";
import { db, hasDatabase } from "@workspace/db";
import { sql } from "drizzle-orm";
import { embed } from "./knowledge";

export type MemoryType =
  | "semantic"
  | "episodic"
  | "procedural"
  | "operational"
  | "evidence"
  | "failure"
  | "decision"
  | "preference"
  | "code"
  | "tool"
  | "skill";

export type MemoryScope =
  | "global"
  | "user"
  | "organization"
  | "project"
  | "repository"
  | "mission"
  | "agent"
  | "session";

export type VerificationLevel =
  | "verified"
  | "observed"
  | "inferred"
  | "claimed"
  | "contradicted"
  | "failed";

export type RuntimePhase = "OBSERVE" | "PLAN" | "ACT" | "VERIFY" | "COMPARE" | "CORRECT";
export type QueryIntent = "recall" | "debug" | "plan" | "execute" | "verify" | "compare";

export interface IngestVectorMemoryOptions {
  content: string;
  memoryType?: MemoryType;
  scope?: MemoryScope;
  scopeKey?: string;
  missionId?: string | null;
  agentId?: string | null;
  source?: string;
  externalId?: string | null;
  verification?: VerificationLevel;
  confidence?: number;
  importance?: number;
  salience?: number;
  entities?: string[];
  relationships?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  validFrom?: Date;
  validUntil?: Date | null;
  supersedesId?: number | null;
  atomic?: boolean;
}

export interface VectorMemoryHit {
  id: number;
  content: string;
  contentHash: string;
  memoryType: MemoryType;
  scope: MemoryScope;
  scopeKey: string;
  missionId: string | null;
  agentId: string | null;
  source: string;
  externalId: string | null;
  verification: VerificationLevel;
  confidence: number;
  importance: number;
  salience: number;
  metadata: Record<string, unknown>;
  entities: string[];
  relationships: Record<string, unknown>;
  validFrom: Date;
  validUntil: Date | null;
  supersedesId: number | null;
  accessCount: number;
  successfulUses: number;
  failedUses: number;
  createdAt: Date;
  lastAccessedAt: Date;
  semanticScore: number;
  lexicalScore: number;
  score: number;
}

export interface RetrieveVectorMemoryOptions {
  limit?: number;
  missionId?: string;
  agentId?: string;
  scopeKey?: string;
  phase?: RuntimePhase;
  intent?: QueryIntent;
  memoryTypes?: MemoryType[];
  minimumScore?: number;
}

const VERIFICATION_WEIGHT: Record<VerificationLevel, number> = {
  verified: 1,
  observed: 0.9,
  inferred: 0.6,
  claimed: 0.35,
  contradicted: 0.05,
  failed: 0.25,
};

const HALF_LIFE_MS: Record<MemoryType, number> = {
  operational: 30 * 60 * 1000,
  episodic: 30 * 24 * 60 * 60 * 1000,
  evidence: 90 * 24 * 60 * 60 * 1000,
  failure: 30 * 24 * 60 * 60 * 1000,
  semantic: 180 * 24 * 60 * 60 * 1000,
  procedural: 365 * 24 * 60 * 60 * 1000,
  decision: 180 * 24 * 60 * 60 * 1000,
  preference: 730 * 24 * 60 * 60 * 1000,
  code: 90 * 24 * 60 * 60 * 1000,
  tool: 180 * 24 * 60 * 60 * 1000,
  skill: 365 * 24 * 60 * 60 * 1000,
};

const PHASE_TYPE_WEIGHT: Record<RuntimePhase, Partial<Record<MemoryType, number>>> = {
  OBSERVE: { operational: 1, evidence: 1, failure: 0.85, episodic: 0.75 },
  PLAN: { procedural: 1, skill: 1, semantic: 0.85, decision: 0.8, failure: 0.75 },
  ACT: { tool: 1, code: 1, operational: 0.95, procedural: 0.8 },
  VERIFY: { evidence: 1, operational: 0.9, decision: 0.8, failure: 0.75 },
  COMPARE: { evidence: 1, decision: 0.9, semantic: 0.8, failure: 0.8 },
  CORRECT: { failure: 1, evidence: 0.95, procedural: 0.85, code: 0.8, tool: 0.8 },
};

let schemaReady: Promise<void> | null = null;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  const candidate = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(candidate?.rows)) return candidate.rows;
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function asDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function asOptionalDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  return asDate(value);
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

export function contentHash(content: string): string {
  return createHash("sha256").update(normalizeContent(content)).digest("hex");
}

export function classifyQueryIntent(query: string): QueryIntent {
  const q = query.toLowerCase();
  if (/\b(why|error|failed|failure|bug|broken|debug|exception|timeout|crash)\b/.test(q)) return "debug";
  if (/\b(verify|prove|evidence|confirm|test|audit|validate)\b/.test(q)) return "verify";
  if (/\b(compare|difference|versus|vs\.?|changed|delta)\b/.test(q)) return "compare";
  if (/\b(plan|design|architecture|approach|strategy|steps)\b/.test(q)) return "plan";
  if (/\b(run|execute|build|deploy|fix|create|write|update|implement|wire)\b/.test(q)) return "execute";
  return "recall";
}

export function inferRuntimePhase(query: string): RuntimePhase {
  const intent = classifyQueryIntent(query);
  if (intent === "debug") return "CORRECT";
  if (intent === "verify") return "VERIFY";
  if (intent === "compare") return "COMPARE";
  if (intent === "plan") return "PLAN";
  if (intent === "execute") return "ACT";
  return "OBSERVE";
}

export function atomicMemoryUnits(text: string, maxChars = 1600): string[] {
  const clean = normalizeContent(text);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const paragraphs = clean.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const units: string[] = [];
  let current = "";

  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) units.push(trimmed);
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) {
        push(current);
        current = "";
      }
      const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
      let sentenceBlock = "";
      for (const sentence of sentences) {
        if (sentence.length > maxChars) {
          if (sentenceBlock) {
            push(sentenceBlock);
            sentenceBlock = "";
          }
          for (let i = 0; i < sentence.length; i += maxChars) push(sentence.slice(i, i + maxChars));
          continue;
        }
        const joined = sentenceBlock ? `${sentenceBlock} ${sentence}` : sentence;
        if (joined.length > maxChars) {
          push(sentenceBlock);
          sentenceBlock = sentence;
        } else {
          sentenceBlock = joined;
        }
      }
      if (sentenceBlock) push(sentenceBlock);
      continue;
    }

    const joined = current ? `${current}\n\n${paragraph}` : paragraph;
    if (joined.length > maxChars) {
      push(current);
      current = paragraph;
    } else {
      current = joined;
    }
  }
  if (current) push(current);
  return units;
}

function extractEntities(content: string, supplied: string[] = []): string[] {
  const exact = content.match(/\b(?:[A-Z][A-Z0-9_]{2,}|[a-f0-9]{7,40}|[\w.-]+\.(?:ts|tsx|js|mjs|cjs|json|py|md|yaml|yml|sql))\b/g) ?? [];
  return [...new Set([...supplied, ...exact].map((item) => item.trim()).filter(Boolean))].slice(0, 64);
}

async function maybeEmbed(input: string): Promise<number[] | null> {
  try {
    return await embed(input);
  } catch {
    return null;
  }
}

export function ensureVectorMemorySchema(): Promise<void> {
  const database = db;
  if (!hasDatabase || !database) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      await database.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
      await database.execute(sql`
        CREATE TABLE IF NOT EXISTS vector_memories (
          id bigserial PRIMARY KEY,
          content text NOT NULL,
          content_hash text NOT NULL,
          memory_type text NOT NULL DEFAULT 'semantic',
          scope text NOT NULL DEFAULT 'global',
          scope_key text NOT NULL DEFAULT '',
          mission_id text,
          agent_id text,
          source text NOT NULL DEFAULT 'runtime',
          external_id text,
          verification text NOT NULL DEFAULT 'claimed',
          confidence real NOT NULL DEFAULT 0.5,
          importance real NOT NULL DEFAULT 0.5,
          salience real NOT NULL DEFAULT 0.5,
          embedding vector(1536),
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          entities jsonb NOT NULL DEFAULT '[]'::jsonb,
          relationships jsonb NOT NULL DEFAULT '{}'::jsonb,
          valid_from timestamptz NOT NULL DEFAULT now(),
          valid_until timestamptz,
          supersedes_id bigint,
          access_count integer NOT NULL DEFAULT 0,
          successful_uses integer NOT NULL DEFAULT 0,
          failed_uses integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_accessed_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (content_hash, memory_type, scope, scope_key)
        )
      `);
      await database.execute(sql`
        ALTER TABLE vector_memories
        ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (
          to_tsvector('simple', coalesce(content, '') || ' ' || coalesce(source, '') || ' ' || coalesce(external_id, ''))
        ) STORED
      `);
      await database.execute(sql`CREATE INDEX IF NOT EXISTS vector_memories_embedding_idx ON vector_memories USING hnsw (embedding vector_cosine_ops)`);
      await database.execute(sql`CREATE INDEX IF NOT EXISTS vector_memories_search_idx ON vector_memories USING gin (search_vector)`);
      await database.execute(sql`CREATE INDEX IF NOT EXISTS vector_memories_mission_idx ON vector_memories (mission_id)`);
      await database.execute(sql`CREATE INDEX IF NOT EXISTS vector_memories_scope_idx ON vector_memories (scope, scope_key)`);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

export async function ingestVectorMemory(options: IngestVectorMemoryOptions): Promise<number[]> {
  const database = db;
  if (!hasDatabase || !database) return [];
  await ensureVectorMemorySchema();

  const normalized = normalizeContent(options.content);
  if (!normalized) return [];
  const units = options.atomic === false ? [normalized] : atomicMemoryUnits(normalized);
  if (units.length > 80) throw new Error(`vector memory ingest exceeds 80 atomic units (${units.length})`);

  const memoryType = options.memoryType ?? "semantic";
  const scope = options.scope ?? "global";
  const scopeKey = options.scopeKey ?? "";
  const verification = options.verification ?? "claimed";
  const confidence = clamp(options.confidence ?? 0.5);
  const importance = clamp(options.importance ?? 0.5);
  const salience = clamp(options.salience ?? 0.5);
  const metadata = JSON.stringify(options.metadata ?? {});
  const relationships = JSON.stringify(options.relationships ?? {});
  const validFrom = options.validFrom ?? new Date();
  const ids: number[] = [];

  for (const unit of units) {
    const hash = contentHash(unit);
    const entities = JSON.stringify(extractEntities(unit, options.entities));
    const vector = await maybeEmbed(unit);
    const vectorLiteral = vector ? `[${vector.join(",")}]` : null;

    const result = vectorLiteral
      ? await database.execute(sql`
          INSERT INTO vector_memories (
            content, content_hash, memory_type, scope, scope_key, mission_id, agent_id,
            source, external_id, verification, confidence, importance, salience,
            embedding, metadata, entities, relationships, valid_from, valid_until, supersedes_id
          ) VALUES (
            ${unit}, ${hash}, ${memoryType}, ${scope}, ${scopeKey}, ${options.missionId ?? null}, ${options.agentId ?? null},
            ${options.source ?? "runtime"}, ${options.externalId ?? null}, ${verification}, ${confidence}, ${importance}, ${salience},
            ${vectorLiteral}::vector, ${metadata}::jsonb, ${entities}::jsonb, ${relationships}::jsonb,
            ${validFrom}, ${options.validUntil ?? null}, ${options.supersedesId ?? null}
          )
          ON CONFLICT (content_hash, memory_type, scope, scope_key) DO UPDATE SET
            last_accessed_at = now(),
            confidence = GREATEST(vector_memories.confidence, EXCLUDED.confidence),
            importance = GREATEST(vector_memories.importance, EXCLUDED.importance),
            salience = GREATEST(vector_memories.salience, EXCLUDED.salience),
            metadata = vector_memories.metadata || EXCLUDED.metadata,
            entities = EXCLUDED.entities,
            relationships = vector_memories.relationships || EXCLUDED.relationships,
            embedding = COALESCE(vector_memories.embedding, EXCLUDED.embedding)
          RETURNING id
        `)
      : await database.execute(sql`
          INSERT INTO vector_memories (
            content, content_hash, memory_type, scope, scope_key, mission_id, agent_id,
            source, external_id, verification, confidence, importance, salience,
            metadata, entities, relationships, valid_from, valid_until, supersedes_id
          ) VALUES (
            ${unit}, ${hash}, ${memoryType}, ${scope}, ${scopeKey}, ${options.missionId ?? null}, ${options.agentId ?? null},
            ${options.source ?? "runtime"}, ${options.externalId ?? null}, ${verification}, ${confidence}, ${importance}, ${salience},
            ${metadata}::jsonb, ${entities}::jsonb, ${relationships}::jsonb,
            ${validFrom}, ${options.validUntil ?? null}, ${options.supersedesId ?? null}
          )
          ON CONFLICT (content_hash, memory_type, scope, scope_key) DO UPDATE SET
            last_accessed_at = now(),
            confidence = GREATEST(vector_memories.confidence, EXCLUDED.confidence),
            importance = GREATEST(vector_memories.importance, EXCLUDED.importance),
            salience = GREATEST(vector_memories.salience, EXCLUDED.salience),
            metadata = vector_memories.metadata || EXCLUDED.metadata,
            entities = EXCLUDED.entities,
            relationships = vector_memories.relationships || EXCLUDED.relationships
          RETURNING id
        `);
    const row = rowsOf(result)[0];
    if (row) ids.push(Number(row.id));
  }
  return ids;
}

function mapCandidate(row: Record<string, unknown>): VectorMemoryHit {
  return {
    id: Number(row.id),
    content: String(row.content ?? ""),
    contentHash: String(row.content_hash ?? ""),
    memoryType: String(row.memory_type ?? "semantic") as MemoryType,
    scope: String(row.scope ?? "global") as MemoryScope,
    scopeKey: String(row.scope_key ?? ""),
    missionId: row.mission_id == null ? null : String(row.mission_id),
    agentId: row.agent_id == null ? null : String(row.agent_id),
    source: String(row.source ?? "runtime"),
    externalId: row.external_id == null ? null : String(row.external_id),
    verification: String(row.verification ?? "claimed") as VerificationLevel,
    confidence: Number(row.confidence ?? 0.5),
    importance: Number(row.importance ?? 0.5),
    salience: Number(row.salience ?? 0.5),
    metadata: asJsonObject(row.metadata),
    entities: asStringArray(row.entities),
    relationships: asJsonObject(row.relationships),
    validFrom: asDate(row.valid_from),
    validUntil: asOptionalDate(row.valid_until),
    supersedesId: row.supersedes_id == null ? null : Number(row.supersedes_id),
    accessCount: Number(row.access_count ?? 0),
    successfulUses: Number(row.successful_uses ?? 0),
    failedUses: Number(row.failed_uses ?? 0),
    createdAt: asDate(row.created_at),
    lastAccessedAt: asDate(row.last_accessed_at),
    semanticScore: Number(row.semantic_score ?? 0),
    lexicalScore: Number(row.lexical_score ?? 0),
    score: 0,
  };
}

function temporalScore(hit: VectorMemoryHit, now = Date.now()): number {
  const age = Math.max(0, now - hit.createdAt.getTime());
  const halfLife = HALF_LIFE_MS[hit.memoryType] ?? HALF_LIFE_MS.semantic;
  return Math.exp((-Math.LN2 * age) / halfLife);
}

function intentCompatibility(intent: QueryIntent, type: MemoryType): number {
  const preferred: Record<QueryIntent, MemoryType[]> = {
    recall: ["semantic", "episodic", "preference", "decision"],
    debug: ["failure", "evidence", "code", "operational", "tool"],
    plan: ["procedural", "skill", "semantic", "decision", "failure"],
    execute: ["tool", "code", "procedural", "operational", "skill"],
    verify: ["evidence", "operational", "failure", "decision"],
    compare: ["evidence", "decision", "semantic", "episodic"],
  };
  const index = preferred[intent].indexOf(type);
  if (index === -1) return 0.35;
  return Math.max(0.55, 1 - index * 0.1);
}

function missionCompatibility(hit: VectorMemoryHit, options: RetrieveVectorMemoryOptions): number {
  if (options.missionId && hit.missionId === options.missionId) return 1;
  if (options.scopeKey && hit.scopeKey === options.scopeKey) return 0.95;
  if (hit.scope === "global") return 0.7;
  if (hit.scope === "repository" || hit.scope === "project") return 0.8;
  if (hit.scope === "mission" && options.missionId && hit.missionId !== options.missionId) return 0.2;
  return 0.5;
}

function historicalUtility(hit: VectorMemoryHit): number {
  return clamp((hit.successfulUses + 1) / (hit.successfulUses + hit.failedUses + 2));
}

export function scoreVectorMemoryHit(
  hit: VectorMemoryHit,
  options: RetrieveVectorMemoryOptions,
  intent = options.intent ?? "recall",
  phase = options.phase ?? "OBSERVE",
): number {
  const evidence = VERIFICATION_WEIGHT[hit.verification] ?? 0.3;
  const recency = temporalScore(hit);
  const phaseWeight = PHASE_TYPE_WEIGHT[phase]?.[hit.memoryType] ?? 0.45;
  const intentScore = intentCompatibility(intent, hit.memoryType) * 0.7 + phaseWeight * 0.3;
  const missionScore = missionCompatibility(hit, options);
  const utility = historicalUtility(hit);
  const contradictionPenalty = hit.verification === "contradicted" ? 1 : 0;
  const stalePenalty = hit.memoryType === "operational" && recency < 0.15 ? 1 - recency : 0;

  const positive =
    clamp(hit.semanticScore) * 0.24 +
    clamp(hit.lexicalScore) * 0.13 +
    intentScore * 0.1 +
    missionScore * 0.15 +
    evidence * 0.14 +
    recency * 0.08 +
    clamp(hit.importance) * 0.05 +
    clamp(hit.salience) * 0.04 +
    utility * 0.05 +
    phaseWeight * 0.02;

  return clamp(positive - contradictionPenalty * 0.2 - stalePenalty * 0.15);
}

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9_./:-]{3,}/g) ?? []);
}

function jaccard(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

function diversify(hits: VectorMemoryHit[], threshold = 0.86): VectorMemoryHit[] {
  const selected: VectorMemoryHit[] = [];
  for (const hit of hits) {
    if (selected.some((existing) => jaccard(existing.content, hit.content) >= threshold)) continue;
    selected.push(hit);
  }
  return selected;
}

export async function retrieveVectorMemory(
  query: string,
  options: RetrieveVectorMemoryOptions = {},
): Promise<VectorMemoryHit[]> {
  const database = db;
  if (!hasDatabase || !database || !query.trim()) return [];
  await ensureVectorMemorySchema();

  const intent = options.intent ?? classifyQueryIntent(query);
  const phase = options.phase ?? inferRuntimePhase(query);
  const candidateLimit = Math.min(Math.max((options.limit ?? 8) * 8, 40), 120);
  const vector = await maybeEmbed(query);
  const candidates = new Map<number, VectorMemoryHit>();

  if (vector) {
    const literal = `[${vector.join(",")}]`;
    const result = await database.execute(sql`
      SELECT *,
        1 - (embedding <=> ${literal}::vector) AS semantic_score,
        ts_rank_cd(search_vector, websearch_to_tsquery('simple', ${query})) AS lexical_score
      FROM vector_memories
      WHERE embedding IS NOT NULL
        AND verification <> 'contradicted'
        AND (valid_until IS NULL OR valid_until > now())
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${candidateLimit}
    `);
    for (const row of rowsOf(result)) {
      const hit = mapCandidate(row);
      candidates.set(hit.id, hit);
    }
  }

  const lexical = await database.execute(sql`
    SELECT *,
      0::real AS semantic_score,
      ts_rank_cd(search_vector, websearch_to_tsquery('simple', ${query})) AS lexical_score
    FROM vector_memories
    WHERE search_vector @@ websearch_to_tsquery('simple', ${query})
      AND verification <> 'contradicted'
      AND (valid_until IS NULL OR valid_until > now())
    ORDER BY lexical_score DESC
    LIMIT ${candidateLimit}
  `);
  for (const row of rowsOf(lexical)) {
    const hit = mapCandidate(row);
    const existing = candidates.get(hit.id);
    if (existing) existing.lexicalScore = Math.max(existing.lexicalScore, hit.lexicalScore);
    else candidates.set(hit.id, hit);
  }

  let hits = [...candidates.values()];
  if (options.memoryTypes?.length) {
    const allowed = new Set(options.memoryTypes);
    hits = hits.filter((hit) => allowed.has(hit.memoryType));
  }
  hits = hits
    .map((hit) => ({ ...hit, score: scoreVectorMemoryHit(hit, options, intent, phase) }))
    .filter((hit) => hit.score >= (options.minimumScore ?? 0.25))
    .sort((a, b) => b.score - a.score);

  const selected = diversify(hits).slice(0, Math.min(Math.max(options.limit ?? 8, 1), 20));
  for (const hit of selected) {
    void database.execute(sql`
      UPDATE vector_memories
      SET access_count = access_count + 1, last_accessed_at = now()
      WHERE id = ${hit.id}
    `).catch(() => undefined);
  }
  return selected;
}

export function formatVectorMemoryContext(hits: VectorMemoryHit[]): string {
  if (!hits.length) return "";
  return hits
    .map((hit, index) => {
      const header = [
        `MEMORY ${index + 1}`,
        `type=${hit.memoryType}`,
        `verification=${hit.verification}`,
        `score=${hit.score.toFixed(3)}`,
        `source=${hit.source}`,
        hit.missionId ? `mission=${hit.missionId}` : "",
      ].filter(Boolean).join(" | ");
      return `[${header}]\n${hit.content}`;
    })
    .join("\n\n");
}

export async function getRuntimeMemoryContext(
  query: string,
  options: RetrieveVectorMemoryOptions = {},
): Promise<string> {
  try {
    return formatVectorMemoryContext(await retrieveVectorMemory(query, options));
  } catch {
    return "";
  }
}

export async function recordVectorMemoryOutcome(ids: number[], successful: boolean): Promise<void> {
  const database = db;
  if (!hasDatabase || !database || !ids.length) return;
  await ensureVectorMemorySchema();
  for (const id of [...new Set(ids.filter((value) => Number.isInteger(value) && value > 0))].slice(0, 100)) {
    if (successful) {
      await database.execute(sql`
        UPDATE vector_memories SET successful_uses = successful_uses + 1, last_accessed_at = now() WHERE id = ${id}
      `);
    } else {
      await database.execute(sql`
        UPDATE vector_memories SET failed_uses = failed_uses + 1, last_accessed_at = now() WHERE id = ${id}
      `);
    }
  }
}

export async function vectorMemoryStatus(): Promise<Record<string, unknown>> {
  const database = db;
  if (!hasDatabase || !database) return { available: false, reason: "database unavailable" };
  await ensureVectorMemorySchema();
  const result = await database.execute(sql`
    SELECT
      count(*)::int AS total,
      count(embedding)::int AS embedded,
      count(*) FILTER (WHERE verification = 'verified')::int AS verified,
      count(*) FILTER (WHERE verification = 'observed')::int AS observed,
      count(*) FILTER (WHERE memory_type = 'failure')::int AS failures,
      max(created_at) AS newest
    FROM vector_memories
  `);
  const row = rowsOf(result)[0] ?? {};
  return {
    available: true,
    total: Number(row.total ?? 0),
    embedded: Number(row.embedded ?? 0),
    lexicalOnly: Math.max(0, Number(row.total ?? 0) - Number(row.embedded ?? 0)),
    verified: Number(row.verified ?? 0),
    observed: Number(row.observed ?? 0),
    failures: Number(row.failures ?? 0),
    newest: row.newest ? asDate(row.newest).toISOString() : null,
  };
}
