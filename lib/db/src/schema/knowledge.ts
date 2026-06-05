import {
  pgTable,
  serial,
  text,
  jsonb,
  timestamp,
  vector,
  index,
} from "drizzle-orm/pg-core";

// Vector knowledge base for AI retrieval over notes, files, SOPs, leads and
// transcripts. Each row is a single embedded chunk. `embedding` is a pgvector
// column (text-embedding-3-small → 1536 dims) with an HNSW cosine index for
// fast similarity search.
export const knowledgeChunksTable = pgTable(
  "knowledge_chunks",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("knowledge_chunks_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export type KnowledgeChunk = typeof knowledgeChunksTable.$inferSelect;
