// Self-healing schema bootstrap. Runs at api-server startup; creates any
// table that's missing from the live Postgres DB. This is a runtime safety
// net because we have no separate migration step in the deploy pipeline
// (drizzle-kit push is a manual one-shot, and the live DB has no migration
// history). Every CREATE is idempotent (IF NOT EXISTS) so it's safe to
// re-run on every boot.
//
// CRITICAL: the column lists below MUST match lib/db/src/schema/*.ts EXACTLY.
// If they drift, runtime drizzle-orm queries will reference columns that
// don't exist → 500 errors. The previous version of this file had wrong
// column names for work_tree_runs, social_reference_images, social_campaigns,
// and social_scheduled_posts, which would have created wrong-shape tables
// on a fresh DB and broken the social-media UI permanently. Always cross-
// check against the schema file before adding a new table here.
//
// The list below mirrors lib/db/src/schema/*.ts. If you add a new table
// there, add the matching CREATE here. We deliberately keep the SQL
// hand-written rather than introspecting the schema so the migration is
// reviewable in plain SQL and survives any future drizzle API change.

import { pool, hasDatabase } from "@workspace/db";
import { logger } from "./logger";

const STATEMENTS: { name: string; sql: string }[] = [
  // ── lib/db/src/schema/integrations.ts ───────────────────────────────────
  {
    name: "integration_credentials",
    sql: `
      CREATE TABLE IF NOT EXISTS integration_credentials (
        service    text PRIMARY KEY,
        fields     jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  // ── lib/db/src/schema/favorites.ts ──────────────────────────────────────
  {
    name: "favorites",
    sql: `
      CREATE TABLE IF NOT EXISTS favorites (
        id          serial PRIMARY KEY,
        url         text NOT NULL,
        title       varchar(500) NOT NULL DEFAULT '',
        description text NOT NULL DEFAULT '',
        favicon     text NOT NULL DEFAULT '',
        tags        varchar(500) NOT NULL DEFAULT '',
        created_at  timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  // ── lib/db/src/schema/scratchpad.ts ─────────────────────────────────────
  {
    name: "conversation_turns",
    sql: `
      CREATE TABLE IF NOT EXISTS conversation_turns (
        id               serial PRIMARY KEY,
        conversation_key text NOT NULL,
        user_text        text NOT NULL DEFAULT '',
        assistant_text   text NOT NULL DEFAULT '',
        model            text NOT NULL DEFAULT '',
        processed        boolean NOT NULL DEFAULT false,
        attempts         integer NOT NULL DEFAULT 0,
        created_at       timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "scratchpad_entries",
    sql: `
      CREATE TABLE IF NOT EXISTS scratchpad_entries (
        id               serial PRIMARY KEY,
        conversation_key text NOT NULL UNIQUE,
        category         text NOT NULL DEFAULT 'general',
        title            text NOT NULL DEFAULT 'Untitled',
        summary          text NOT NULL DEFAULT '',
        key_facts        text NOT NULL DEFAULT '',
        turn_count       integer NOT NULL DEFAULT 0,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  // ── lib/db/src/schema/workspaces.ts ─────────────────────────────────────
  {
    name: "workspace_files",
    sql: `
      CREATE TABLE IF NOT EXISTS workspace_files (
        id           serial PRIMARY KEY,
        workspace    varchar(100) NOT NULL,
        filename     varchar(500) NOT NULL,
        content      text NOT NULL DEFAULT '',
        content_type varchar(100) NOT NULL DEFAULT 'text/plain',
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS workspace_files_ws_filename_uniq
        ON workspace_files (workspace, filename);
    `,
  },
  // ── lib/db/src/schema/work-tree.ts ──────────────────────────────────────
  {
    name: "work_tree_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS work_tree_runs (
        id          serial PRIMARY KEY,
        goal        text NOT NULL,
        status      text NOT NULL DEFAULT 'pending',
        model       text NOT NULL DEFAULT '',
        report      text NOT NULL DEFAULT '',
        error       text NOT NULL DEFAULT '',
        stage_trace text NOT NULL DEFAULT '',
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "work_tree_nodes",
    sql: `
      CREATE TABLE IF NOT EXISTS work_tree_nodes (
        id           serial PRIMARY KEY,
        run_id       integer NOT NULL,
        parent_id    integer,
        title        text NOT NULL,
        detail       text NOT NULL DEFAULT '',
        kind         text NOT NULL DEFAULT 'terminal',
        status       text NOT NULL DEFAULT 'pending',
        depth        integer NOT NULL DEFAULT 0,
        position     integer NOT NULL DEFAULT 0,
        result       text NOT NULL DEFAULT '',
        verification text NOT NULL DEFAULT '',
        attempts     integer NOT NULL DEFAULT 0,
        trace        text NOT NULL DEFAULT '',
        role         text NOT NULL DEFAULT '',
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "work_tree_governance",
    sql: `
      CREATE TABLE IF NOT EXISTS work_tree_governance (
        day        text PRIMARY KEY,
        run_count  integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  // ── lib/db/src/schema/knowledge.ts ──────────────────────────────────────
  // Note: the embedding column is pgvector type. The extension must exist
  // in the database. The startup logs a warning if it's missing; the
  // runtime helper knowledge.ts will surface a clear "no embeddings"
  // status. Schema still creates the table — the embedding column is
  // nullable so lexical-only operation is fine.
  {
    name: "knowledge_chunks",
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id          serial PRIMARY KEY,
        source      text NOT NULL DEFAULT 'manual',
        external_id text,
        title       text NOT NULL DEFAULT '',
        content     text NOT NULL DEFAULT '',
        embedding   vector(1536),
        metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  // ── lib/db/src/schema/vector-memory.ts ──────────────────────────────────
  {
    name: "vector_memories",
    sql: `
      CREATE TABLE IF NOT EXISTS vector_memories (
        id              bigserial PRIMARY KEY,
        content         text NOT NULL,
        content_hash    text NOT NULL,
        memory_type     text NOT NULL DEFAULT 'semantic',
        scope           text NOT NULL DEFAULT 'global',
        scope_key       text NOT NULL DEFAULT '',
        mission_id      text,
        agent_id        text,
        source          text NOT NULL DEFAULT 'runtime',
        external_id     text,
        verification    text NOT NULL DEFAULT 'claimed',
        confidence      real NOT NULL DEFAULT 0.5,
        importance      real NOT NULL DEFAULT 0.5,
        salience        real NOT NULL DEFAULT 0.5,
        embedding       vector(1536),
        metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
        entities        jsonb NOT NULL DEFAULT '[]'::jsonb,
        relationships   jsonb NOT NULL DEFAULT '{}'::jsonb,
        valid_from      timestamptz NOT NULL DEFAULT now(),
        valid_until     timestamptz,
        supersedes_id   integer,
        access_count    integer NOT NULL DEFAULT 0,
        successful_uses integer NOT NULL DEFAULT 0,
        failed_uses     integer NOT NULL DEFAULT 0,
        created_at      timestamptz NOT NULL DEFAULT now(),
        last_accessed_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  // ── lib/db/src/schema/social-media.ts ───────────────────────────────────
  // The previous version of this file had wrong column names and missing
  // columns for every social-media table, which would have created broken
  // tables on a fresh DB. The columns below match social-media.ts exactly.
  {
    name: "social_reference_images",
    sql: `
      CREATE TABLE IF NOT EXISTS social_reference_images (
        id         serial PRIMARY KEY,
        name       varchar(255) NOT NULL,
        mime_type  varchar(100) NOT NULL DEFAULT 'image/png',
        data_base64 text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "social_campaigns",
    sql: `
      CREATE TABLE IF NOT EXISTS social_campaigns (
        id                  serial PRIMARY KEY,
        name                varchar(255) NOT NULL,
        description         text NOT NULL DEFAULT '',
        goals               text NOT NULL DEFAULT '',
        target_audience     text NOT NULL DEFAULT '',
        brand_voice         varchar(50) NOT NULL DEFAULT 'motivational',
        platforms           text NOT NULL DEFAULT '[]',
        content_types       text NOT NULL DEFAULT '{}',
        interval_hours      integer NOT NULL DEFAULT 24,
        start_at            timestamptz NOT NULL DEFAULT now(),
        end_at              timestamptz,
        next_run_at         timestamptz,
        status              varchar(20) NOT NULL DEFAULT 'draft',
        research_notes      text NOT NULL DEFAULT '',
        strategy_notes      text NOT NULL DEFAULT '',
        reference_image_id  integer,
        posts_generated     integer NOT NULL DEFAULT 0,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "social_scheduled_posts",
    sql: `
      CREATE TABLE IF NOT EXISTS social_scheduled_posts (
        id                 serial PRIMARY KEY,
        campaign_id        integer,
        interval_hours     integer,
        platform           varchar(50) NOT NULL,
        content_type       varchar(50) NOT NULL,
        description        text NOT NULL DEFAULT '',
        tone               varchar(50) NOT NULL DEFAULT 'motivational',
        caption            text NOT NULL DEFAULT '',
        hashtags           text NOT NULL DEFAULT '',
        image_url          text NOT NULL DEFAULT '',
        video_url          text NOT NULL DEFAULT '',
        aspect_ratio       varchar(20) NOT NULL DEFAULT '1:1',
        dimensions         varchar(20) NOT NULL DEFAULT '1080x1080',
        reference_image_id integer,
        scheduled_at       timestamptz,
        status             varchar(20) NOT NULL DEFAULT 'draft',
        published_at       timestamptz,
        error_message      text,
        composio_result    text,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
];

let ranOnce = false;

export async function ensureSchema(): Promise<void> {
  if (!hasDatabase || !pool) {
    logger.warn(
      "[db-migrate] DATABASE_URL not set — skipping schema bootstrap (no DB configured)",
    );
    return;
  }
  if (ranOnce) return; // guard against re-entry inside the same process
  ranOnce = true;

  const client = await pool.connect();
  let ok = 0;
  let failed = 0;
  const failedTables: string[] = [];
  // Best-effort: install pgvector extension. If the database doesn't allow
  // it (e.g. managed Postgres with restricted superuser) we skip the
  // vector tables below rather than crashing the whole bootstrap. The
  // runtime helpers (vector-memory.ts, knowledge.ts) detect "no embeddings"
  // and fall back to lexical-only operation.
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    logger.info("[db-migrate] pgvector extension ensured");
  } catch (e) {
    logger.warn(
      { err: e },
      "[db-migrate] pgvector extension could not be installed; vector tables will be skipped",
    );
  }
  try {
    for (const { name, sql } of STATEMENTS) {
      // Skip tables that need pgvector if the extension install failed
      // above. vector_memories and knowledge_chunks both have vector(1536)
      // columns that can't exist without the extension.
      if (
        (name === "vector_memories" || name === "knowledge_chunks")
      ) {
        const ext = await client.query(
          "SELECT 1 FROM pg_extension WHERE extname = 'vector'",
        );
        if (ext.rowCount === 0) {
          logger.warn(
            { table: name },
            "[db-migrate] skipping vector table (pgvector extension not present)",
          );
          continue;
        }
      }
      try {
        await client.query(sql);
        ok += 1;
      } catch (e) {
        failed += 1;
        failedTables.push(name);
        logger.error(
          { err: e, table: name },
          "[db-migrate] create table failed",
        );
      }
    }
  } finally {
    client.release();
  }
  if (failed > 0) {
    logger.error(
      { ok, failed, failedTables, total: STATEMENTS.length },
      "[db-migrate] schema bootstrap FAILED for some tables — runtime queries on those tables will 500",
    );
  } else {
    logger.info(
      { ok, total: STATEMENTS.length },
      "[db-migrate] schema bootstrap complete",
    );
  }
}
