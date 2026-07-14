import {
  pgTable,
  bigserial,
  text,
  real,
  integer,
  jsonb,
  timestamp,
  vector,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Mission-aware runtime memory.
 *
 * `embedding` is intentionally nullable: NOVA can still ingest and retrieve
 * memories lexically when an embeddings provider is temporarily unavailable.
 * The runtime self-heals the physical table and generated full-text index in
 * artifacts/api-server/src/lib/vector-memory.ts.
 */
export const vectorMemoriesTable = pgTable(
  "vector_memories",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    memoryType: text("memory_type").notNull().default("semantic"),
    scope: text("scope").notNull().default("global"),
    scopeKey: text("scope_key").notNull().default(""),
    missionId: text("mission_id"),
    agentId: text("agent_id"),
    source: text("source").notNull().default("runtime"),
    externalId: text("external_id"),
    verification: text("verification").notNull().default("claimed"),
    confidence: real("confidence").notNull().default(0.5),
    importance: real("importance").notNull().default(0.5),
    salience: real("salience").notNull().default(0.5),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata").notNull().default({}),
    entities: jsonb("entities").notNull().default([]),
    relationships: jsonb("relationships").notNull().default({}),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    supersedesId: integer("supersedes_id"),
    accessCount: integer("access_count").notNull().default(0),
    successfulUses: integer("successful_uses").notNull().default(0),
    failedUses: integer("failed_uses").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vector_memories_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
    index("vector_memories_mission_idx").on(t.missionId),
    index("vector_memories_scope_idx").on(t.scope, t.scopeKey),
    uniqueIndex("vector_memories_identity_idx").on(
      t.contentHash,
      t.memoryType,
      t.scope,
      t.scopeKey,
    ),
  ],
);

export type VectorMemory = typeof vectorMemoriesTable.$inferSelect;
