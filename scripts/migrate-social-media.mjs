#!/usr/bin/env node
/**
 * Idempotent migration: create social_reference_images and social_scheduled_posts tables.
 * Runs against both DATABASE_URL and SCRATCHPAD_DATABASE_URL (they may be separate instances).
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("/home/runner/workspace/node_modules/.pnpm/pg@8.22.0/node_modules/pg");
const { Pool } = pg;

const DDL = `
CREATE TABLE IF NOT EXISTS social_reference_images (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  mime_type    VARCHAR(100) NOT NULL DEFAULT 'image/png',
  data_base64  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_scheduled_posts (
  id                  SERIAL PRIMARY KEY,
  platform            VARCHAR(50)  NOT NULL,
  content_type        VARCHAR(50)  NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  tone                VARCHAR(50)  NOT NULL DEFAULT 'motivational',
  caption             TEXT NOT NULL DEFAULT '',
  hashtags            TEXT NOT NULL DEFAULT '',
  image_url           TEXT NOT NULL DEFAULT '',
  video_url           TEXT NOT NULL DEFAULT '',
  aspect_ratio        VARCHAR(20)  NOT NULL DEFAULT '1:1',
  dimensions          VARCHAR(20)  NOT NULL DEFAULT '1080x1080',
  reference_image_id  INTEGER REFERENCES social_reference_images(id) ON DELETE SET NULL,
  scheduled_at        TIMESTAMPTZ,
  status              VARCHAR(20)  NOT NULL DEFAULT 'draft',
  published_at        TIMESTAMPTZ,
  error_message       TEXT,
  composio_result     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_posts_status_idx ON social_scheduled_posts (status, scheduled_at);
`;

async function migrate(url) {
  const noSsl = /sslmode=disable/i.test(url);
  const clean = url.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
  const pool = new Pool({
    connectionString: clean,
    ssl: noSsl ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query(DDL);
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('social_reference_images','social_scheduled_posts')
       ORDER BY table_name`
    );
    console.log(`  ✓ Tables: ${rows.map(r => r.table_name).join(", ")}`);
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
  console.log(`Migrating ${url.replace(/:\/\/[^@]+@/, "://*@").split("/").pop()}`);
  try { await migrate(url); }
  catch (err) { console.error(`  ✗ ${err.message}`); process.exit(1); }
}
