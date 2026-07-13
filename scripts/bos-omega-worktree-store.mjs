import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { boundedInt, safeText } from "./bos-omega-core.mjs";

const { Pool } = pg;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(MODULE_DIR, "..");
const GOVERNANCE_PATH = path.join(ROOT, "GOVERNANCE.json");
const STATE_DIR = path.resolve(
  process.env.OPENCLAW_STATE_DIR || path.join(ROOT, ".nova-data"),
);
const DATABASE_URL =
  process.env.DATABASE_URL || process.env.SCRATCHPAD_DATABASE_URL || "";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required by the Work Tree worker");
}

fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
export const pool = new Pool({ connectionString: DATABASE_URL });
export const ADVISORY_LOCK_ID = 778120454;

export function clip(value, maximum) {
  const text = String(value ?? "");
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}
export function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
export function compactJson(value, maximum = 12_000) {
  try {
    const text = JSON.stringify(value);
    return text.length <= maximum
      ? text
      : JSON.stringify({ truncated: true, sha256: hash(text) });
  } catch {
    return JSON.stringify({ error: "not_serializable" });
  }
}

function auditPath(runId) {
  const directory = path.join(STATE_DIR, "runs", String(runId));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.join(directory, "audit.jsonl");
}
export function audit(runId, eventType, payload = {}) {
  try {
    fs.appendFileSync(
      auditPath(runId),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        eventType,
        runId,
        ...payload,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (error) {
    console.error(
      `work-tree audit failed: ${safeText(error?.message || error, 300)}`,
    );
  }
}

export function governance() {
  try {
    const value = JSON.parse(fs.readFileSync(GOVERNANCE_PATH, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("root must be an object");
    }
    if (value.schemaVersion !== 1) {
      throw new Error(`unsupported schemaVersion ${String(value.schemaVersion)}`);
    }
    if (value.enforcementMode !== "FAIL_CLOSED") {
      throw new Error("enforcementMode must be FAIL_CLOSED");
    }
    if (typeof value.autonomyEnabled !== "boolean") {
      throw new Error("autonomyEnabled must be boolean");
    }
    const dailyCap = Number(value.dailyAutonomousRunCap);
    if (!Number.isInteger(dailyCap) || dailyCap < 0) {
      throw new Error("dailyAutonomousRunCap must be non-negative integer");
    }
    return {
      valid: true,
      autonomyEnabled: value.autonomyEnabled,
      dailyCap,
      maxToolCalls: boundedInt(value.maximumToolCallsPerRun, 100, 1, 1_000),
      maxRunMs:
        boundedInt(value.maximumRunDurationSeconds, 1_800, 10, 86_400) * 1_000,
    };
  } catch (error) {
    console.error(
      `work-tree governance invalid; failing closed: ${safeText(error?.message || error, 300)}`,
    );
    return {
      valid: false,
      autonomyEnabled: false,
      dailyCap: 0,
      maxToolCalls: 0,
      maxRunMs: 0,
    };
  }
}

export async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_tree_governance (
      day text PRIMARY KEY,
      run_count integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}
async function countToday(client = pool) {
  const { rows } = await client.query(
    "SELECT run_count FROM work_tree_governance WHERE day = $1",
    [utcDay()],
  );
  return Number(rows[0]?.run_count ?? 0);
}

export async function claimPendingRun(dailyCap) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (dailyCap > 0 && (await countToday(client)) >= dailyCap) {
      await client.query("ROLLBACK");
      return null;
    }
    const { rows } = await client.query(
      `SELECT * FROM work_tree_runs
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    const run = rows[0];
    if (!run) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      "UPDATE work_tree_runs SET status = 'running', updated_at = now() WHERE id = $1",
      [run.id],
    );
    await client.query(
      `INSERT INTO work_tree_governance (day, run_count)
       VALUES ($1, 1)
       ON CONFLICT (day) DO UPDATE
         SET run_count = work_tree_governance.run_count + 1,
             updated_at = now()`,
      [utcDay()],
    );
    await client.query("COMMIT");
    return { ...run, status: "running" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function firstRunningRun() {
  const { rows } = await pool.query(
    "SELECT * FROM work_tree_runs WHERE status = 'running' ORDER BY created_at ASC LIMIT 1",
  );
  return rows[0] || null;
}
export async function freshRun(id) {
  const { rows } = await pool.query(
    "SELECT * FROM work_tree_runs WHERE id = $1",
    [id],
  );
  return rows[0] || null;
}
export async function loadNodes(runId) {
  const { rows } = await pool.query(
    `SELECT * FROM work_tree_nodes
     WHERE run_id = $1
     ORDER BY depth ASC, position ASC, id ASC`,
    [runId],
  );
  return rows;
}
export async function insertNode(value) {
  const { rows } = await pool.query(
    `INSERT INTO work_tree_nodes
       (run_id, parent_id, title, detail, kind, status, depth, position,
        result, verification, attempts, trace, role)
     VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,'','',0,'',$8)
     RETURNING *`,
    [
      value.runId,
      value.parentId,
      clip(value.title, 500),
      clip(value.detail, 8_000),
      value.kind,
      value.depth,
      value.position,
      value.role || "executor",
    ],
  );
  return rows[0];
}

const NODE_FIELDS = new Set([
  "status",
  "result",
  "verification",
  "attempts",
  "trace",
  "role",
  "kind",
]);
const RUN_FIELDS = new Set([
  "status",
  "report",
  "error",
  "stage_trace",
  "model",
]);
async function updateRecord(table, id, fields, allowed) {
  const entries = Object.entries(fields).filter(([key]) => allowed.has(key));
  if (!entries.length) return;
  const values = [];
  const assignments = entries.map(([key, value], index) => {
    values.push(value);
    return `${key} = $${index + 1}`;
  });
  values.push(id);
  await pool.query(
    `UPDATE ${table}
     SET ${assignments.join(", ")}, updated_at = now()
     WHERE id = $${values.length}`,
    values,
  );
}
export async function setNode(id, fields) {
  await updateRecord("work_tree_nodes", id, fields, NODE_FIELDS);
}
export async function setRun(id, fields) {
  await updateRecord("work_tree_runs", id, fields, RUN_FIELDS);
}

export async function recoverOrphans() {
  const { rowCount } = await pool.query(
    `UPDATE work_tree_nodes
     SET status = 'pending', updated_at = now()
     WHERE status = 'running' AND kind = 'terminal'`,
  );
  return Number(rowCount ?? 0);
}

export async function closeStore() {
  await pool.end();
}
