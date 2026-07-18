// Self-healing schema bootstrap. Runs at api-server startup; creates any
// table that's missing from the live Postgres DB. This is a runtime safety
// net because we have no separate migration step in the deploy pipeline
// (drizzle-kit push is a manual one-shot, and the live DB has no migration
// history). Every CREATE is idempotent (IF NOT EXISTS) so it's safe to
// re-run on every boot.
//
// The list below mirrors lib/db/src/schema/*.ts. If you add a new table
// there, add the matching CREATE here. We deliberately keep the SQL
// hand-written rather than introspecting the schema so the migration is
// reviewable in plain SQL and survives any future drizzle API change.

import { pool, hasDatabase } from "@workspace/db";
import { logger } from "./logger";

const STATEMENTS: { name: string; sql: string }[] = [
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
  {
    name: "work_tree_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS work_tree_runs (
        id          serial PRIMARY KEY,
        run_id      text NOT NULL UNIQUE,
        project_key text NOT NULL,
        status      text NOT NULL DEFAULT 'pending',
        input       jsonb NOT NULL DEFAULT '{}'::jsonb,
        output      jsonb NOT NULL DEFAULT '{}'::jsonb,
        error       text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "social_reference_images",
    sql: `
      CREATE TABLE IF NOT EXISTS social_reference_images (
        id         serial PRIMARY KEY,
        name       varchar(255) NOT NULL,
        mime_type  varchar(100) NOT NULL DEFAULT 'image/png',
        image_url  text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "social_campaigns",
    sql: `
      CREATE TABLE IF NOT EXISTS social_campaigns (
        id              serial PRIMARY KEY,
        name            text NOT NULL,
        description     text NOT NULL DEFAULT '',
        target_audience text NOT NULL DEFAULT '',
        brand_voice     text NOT NULL DEFAULT '',
        platforms       jsonb NOT NULL DEFAULT '[]'::jsonb,
        cadence         text NOT NULL DEFAULT 'weekly',
        status          text NOT NULL DEFAULT 'draft',
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "social_scheduled_posts",
    sql: `
      CREATE TABLE IF NOT EXISTS social_scheduled_posts (
        id              serial PRIMARY KEY,
        campaign_id     integer,
        platform        text NOT NULL,
        caption         text NOT NULL DEFAULT '',
        image_url       text NOT NULL DEFAULT '',
        scheduled_for   timestamptz NOT NULL,
        status          text NOT NULL DEFAULT 'pending',
        posted_at       timestamptz,
        error           text,
        platform_post_id text,
        created_at      timestamptz NOT NULL DEFAULT now()
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
  try {
    for (const { name, sql } of STATEMENTS) {
      try {
        await client.query(sql);
        ok += 1;
      } catch (e) {
        failed += 1;
        logger.error(
          { err: e, table: name },
          "[db-migrate] create table failed",
        );
      }
    }
  } finally {
    client.release();
  }
  logger.info(
    { ok, failed, total: STATEMENTS.length },
    "[db-migrate] schema bootstrap complete",
  );
}
