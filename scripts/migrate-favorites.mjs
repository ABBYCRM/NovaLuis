#!/usr/bin/env node
/**
 * Idempotent migration: favorites table + interval_hours column for social_scheduled_posts.
 * Runs against ALL configured database URLs.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("/home/runner/workspace/node_modules/.pnpm/pg@8.22.0/node_modules/pg");

const DDL = `
CREATE TABLE IF NOT EXISTS favorites (
  id          SERIAL PRIMARY KEY,
  url         TEXT NOT NULL,
  title       VARCHAR(500) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  favicon     TEXT NOT NULL DEFAULT '',
  tags        VARCHAR(500) NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS favorites_created_at_idx ON favorites (created_at DESC);

-- Add recurring interval column to social posts (idempotent)
ALTER TABLE social_scheduled_posts ADD COLUMN IF NOT EXISTS interval_hours INTEGER;
`;

async function migrate(url) {
  const noSsl = /sslmode=disable/i.test(url);
  const clean = url.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
  const pool = new Pool({ connectionString: clean, ssl: noSsl ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
  let client;
  try {
    client = await pool.connect();
    await client.query(DDL);
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='favorites'`
    );
    console.log(`  ✓ favorites: ${rows.length ? "ready" : "MISSING"}; interval_hours column added`);
  } finally { client?.release(); await pool.end(); }
}

const urls = [...new Set([process.env.DATABASE_URL, process.env.SCRATCHPAD_DATABASE_URL].filter(Boolean))];
if (!urls.length) { console.error("No DATABASE_URL"); process.exit(1); }
for (const url of urls) {
  console.log(`Migrating ${url.split("/").pop()?.split("?")[0]}`);
  try { await migrate(url); } catch (e) { console.error(`  ✗ ${e.message}`); process.exit(1); }
}
