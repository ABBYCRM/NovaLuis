#!/usr/bin/env node
// migrate-supernova-db.mjs — idempotent schema migration for supernova-db.
// Run once to create all tables the Nova daemons depend on.
// Usage: node scripts/migrate-supernova-db.mjs

import pg from "pg";
const { Client } = pg;

const DATABASE_URL =
  process.env.SCRATCHPAD_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("FATAL: SCRATCHPAD_DATABASE_URL or DATABASE_URL must be set");
  process.exit(1);
}

const url = new URL(DATABASE_URL.split("?")[0]);
const client = new Client({
  host: url.hostname,
  port: Number(url.port) || 5432,
  database: url.pathname.slice(1),
  user: url.username,
  password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

const DDL = `
-- conversation_turns: raw turn capture for scratchpad distillation
CREATE TABLE IF NOT EXISTS conversation_turns (
  id              SERIAL PRIMARY KEY,
  conversation_key TEXT   NOT NULL,
  user_text       TEXT   NOT NULL DEFAULT '',
  assistant_text  TEXT   NOT NULL DEFAULT '',
  model           TEXT   NOT NULL DEFAULT '',
  processed       BOOLEAN NOT NULL DEFAULT false,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ct_unprocessed
  ON conversation_turns (conversation_key)
  WHERE processed = false;

-- scratchpad_entries: distilled long-lived memory per conversation
CREATE TABLE IF NOT EXISTS scratchpad_entries (
  id               SERIAL PRIMARY KEY,
  conversation_key TEXT    NOT NULL UNIQUE,
  category         TEXT    NOT NULL DEFAULT 'general',
  title            TEXT    NOT NULL DEFAULT 'Untitled',
  summary          TEXT    NOT NULL DEFAULT '',
  key_facts        TEXT    NOT NULL DEFAULT '',
  turn_count       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- work_tree_runs: one row per autonomous work-tree execution
CREATE TABLE IF NOT EXISTS work_tree_runs (
  id          SERIAL PRIMARY KEY,
  goal        TEXT   NOT NULL,
  status      TEXT   NOT NULL DEFAULT 'pending',
  model       TEXT   NOT NULL DEFAULT '',
  report      TEXT   NOT NULL DEFAULT '',
  error       TEXT   NOT NULL DEFAULT '',
  stage_trace TEXT   NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wtr_pending
  ON work_tree_runs (created_at)
  WHERE status = 'pending';

-- work_tree_nodes: adjacency-list tree of tasks within a run
CREATE TABLE IF NOT EXISTS work_tree_nodes (
  id           SERIAL PRIMARY KEY,
  run_id       INTEGER NOT NULL REFERENCES work_tree_runs(id) ON DELETE CASCADE,
  parent_id    INTEGER,
  title        TEXT    NOT NULL,
  detail       TEXT    NOT NULL DEFAULT '',
  kind         TEXT    NOT NULL DEFAULT 'terminal',
  status       TEXT    NOT NULL DEFAULT 'pending',
  depth        INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0,
  result       TEXT    NOT NULL DEFAULT '',
  verification TEXT    NOT NULL DEFAULT '',
  attempts     INTEGER NOT NULL DEFAULT 0,
  trace        TEXT    NOT NULL DEFAULT '',
  role         TEXT    NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wtn_run ON work_tree_nodes (run_id, depth, position);

-- work_tree_governance: durable daily run counter for autonomy cap
CREATE TABLE IF NOT EXISTS work_tree_governance (
  day        TEXT PRIMARY KEY,
  run_count  INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function main() {
  await client.connect();
  console.log("Connected to:", url.hostname, "/", url.pathname.slice(1));
  await client.query(DDL);
  console.log("✓ All tables created (idempotent — existing tables unchanged)");

  // Verify
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN
     ('conversation_turns','scratchpad_entries','work_tree_runs','work_tree_nodes','work_tree_governance')
     ORDER BY tablename`,
  );
  console.log("Tables confirmed:", rows.map((r) => r.tablename).join(", "));
  await client.end();
}

main().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});
