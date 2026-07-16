#!/usr/bin/env node
/**
 * Idempotent migration: add social_campaigns table and campaign_id to social_scheduled_posts.
 * Also backfills interval_hours column on social_scheduled_posts if missing.
 * Safe to run multiple times.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("/home/runner/workspace/node_modules/.pnpm/pg@8.22.0/node_modules/pg");
const { Pool } = pg;

const DDL = `
-- ── Campaigns table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_campaigns (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(255) NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  goals               TEXT NOT NULL DEFAULT '',
  target_audience     TEXT NOT NULL DEFAULT '',
  brand_voice         VARCHAR(50)  NOT NULL DEFAULT 'motivational',
  platforms           TEXT NOT NULL DEFAULT '[]',
  content_types       TEXT NOT NULL DEFAULT '{}',
  interval_hours      INTEGER NOT NULL DEFAULT 24,
  start_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_at              TIMESTAMPTZ,
  next_run_at         TIMESTAMPTZ,
  status              VARCHAR(20)  NOT NULL DEFAULT 'draft',
  research_notes      TEXT NOT NULL DEFAULT '',
  strategy_notes      TEXT NOT NULL DEFAULT '',
  reference_image_id  INTEGER REFERENCES social_reference_images(id) ON DELETE SET NULL,
  posts_generated     INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_campaigns_status_idx
  ON social_campaigns (status, next_run_at);

-- ── Add campaign_id to posts (idempotent) ─────────────────────────────────────
ALTER TABLE social_scheduled_posts
  ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES social_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS social_posts_campaign_idx
  ON social_scheduled_posts (campaign_id)
  WHERE campaign_id IS NOT NULL;

-- ── Backfill interval_hours column if it was added earlier as a raw alter ─────
ALTER TABLE social_scheduled_posts
  ADD COLUMN IF NOT EXISTS interval_hours INTEGER;
`;

async function migrate(url) {
  const noSsl = /sslmode=disable/i.test(url);
  const clean = url.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
  const pool = new Pool({
    connectionString: clean,
    ssl: noSsl ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query(DDL);
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('social_campaigns','social_scheduled_posts')
       ORDER BY table_name`
    );
    const { rows: cols } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'social_scheduled_posts'
         AND column_name IN ('campaign_id','interval_hours')`
    );
    console.log(`  ✓ Tables: ${rows.map(r => r.table_name).join(", ")}`);
    console.log(`  ✓ New columns: ${cols.map(r => r.column_name).join(", ")}`);
  } finally {
    client?.release();
    await pool.end();
  }
}

const urls = [...new Set(
  [process.env.DATABASE_URL, process.env.SCRATCHPAD_DATABASE_URL].filter(Boolean)
)];

if (!urls.length) { console.error("No DATABASE_URL set"); process.exit(1); }

for (const url of urls) {
  const label = url.replace(/:\/\/[^@]+@/, "://*@").split("/").pop();
  console.log(`Migrating ${label}`);
  try { await migrate(url); }
  catch (err) { console.error(`  ✗ ${err.message}`); process.exit(1); }
}

console.log("✓ Campaign migration complete");
