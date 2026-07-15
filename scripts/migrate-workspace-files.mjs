#!/usr/bin/env node
/**
 * Idempotent migration: create the workspace_files table in supernova-db.
 * Safe to run multiple times — uses CREATE TABLE IF NOT EXISTS.
 */
import pg from "pg";

const { Pool } = pg;

const url = process.env.SCRATCHPAD_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("SCRATCHPAD_DATABASE_URL or DATABASE_URL is required");
  process.exit(1);
}

// Strip sslmode param from URL; pass ssl object instead.
const cleanUrl = url.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
const pool = new Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10_000,
});

const DDL = `
CREATE TABLE IF NOT EXISTS workspace_files (
  id           SERIAL PRIMARY KEY,
  workspace    VARCHAR(100) NOT NULL,
  filename     VARCHAR(500) NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  content_type VARCHAR(100) NOT NULL DEFAULT 'text/plain',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_files_ws_filename_uniq UNIQUE (workspace, filename)
);

CREATE INDEX IF NOT EXISTS workspace_files_workspace_idx
  ON workspace_files (workspace);
`;

let client;
try {
  client = await pool.connect();
  await client.query(DDL);
  console.log("✓ workspace_files table ready");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  client?.release();
  await pool.end();
}
