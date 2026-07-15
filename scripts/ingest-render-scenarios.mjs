#!/usr/bin/env node
/**
 * Ingests all 500 Render agentic-runtime scenarios into the vector memory store.
 *
 * Each scenario is embedded as a rich procedural memory so Nova can RAG-query
 * "what should I do when X happens on Render" and get back the correct
 * if_action (recommended fix) and else_action (escalation fallback).
 *
 * Usage:
 *   node scripts/ingest-render-scenarios.mjs
 *   node scripts/ingest-render-scenarios.mjs --dry-run    (parse only, no writes)
 *   node scripts/ingest-render-scenarios.mjs --force      (re-ingest even if already present)
 *
 * Auth: self-signs a wt_session cookie using SESSION_SECRET (same as the worker).
 */
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE   = args.includes("--force");

// ── Config ────────────────────────────────────────────────────────────────────
const CSV_PATH    = resolve(__dirname, "render_scenarios/render_scenarios.csv");
const API_PORT    = Number(process.env.PORT || 8080);
const BASE_URL    = `http://127.0.0.1:${API_PORT}/api`;
const BATCH_SIZE  = 5;   // parallel ingest per batch (each calls OpenAI embed)
const DELAY_MS    = 300; // ms between batches to avoid rate-limiting

// ── Auth cookie (mirrors work-tree-auth.ts sign()) ───────────────────────────
function makeSessionCookie() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expMs = Date.now() + 12 * 60 * 60 * 1000;
  const sig   = createHmac("sha256", secret).update(String(expMs)).digest("hex");
  return `wt_session=${expMs}.${sig}`;
}

// ── Minimal CSV parser (handles quoted fields with commas/newlines) ────────────
function parseCsv(text) {
  const rows = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const row = [];
    while (i < n) {
      if (text[i] === '"') {
        // quoted field
        i++; // skip opening quote
        let field = "";
        while (i < n) {
          if (text[i] === '"' && text[i + 1] === '"') { field += '"'; i += 2; }
          else if (text[i] === '"') { i++; break; }
          else { field += text[i++]; }
        }
        row.push(field);
        if (text[i] === ",") i++;
      } else {
        // unquoted field
        const start = i;
        while (i < n && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") i++;
        row.push(text.slice(start, i));
        if (text[i] === ",") i++;
      }
      if (i >= n || text[i] === "\n" || text[i] === "\r") break;
    }
    // skip \r\n / \n
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
    if (row.length > 1 || (row.length === 1 && row[0])) rows.push(row);
  }
  return rows;
}

function loadScenarios() {
  const raw   = readFileSync(CSV_PATH, "utf8");
  const rows  = parseCsv(raw);
  const [header, ...data] = rows;
  // header: id, category, trigger, condition, if_action, else_action, severity, source_doc
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return data.map(row => ({
    id:         row[idx.id],
    category:   row[idx.category],
    trigger:    row[idx.trigger],
    condition:  row[idx.condition],
    if_action:  row[idx.if_action],
    else_action: row[idx.else_action],
    severity:   row[idx.severity],
    source_doc: row[idx.source_doc],
  }));
}

// ── Build rich content text for embedding ─────────────────────────────────────
function scenarioToText(s) {
  return [
    `[${s.id} | ${s.category} | severity:${s.severity}]`,
    `TRIGGER: ${s.trigger}`,
    `CONDITION: ${s.condition}`,
    `IF (recommended): ${s.if_action}`,
    `ELSE (escalation): ${s.else_action}`,
    `SOURCE: ${s.source_doc}`,
  ].join("\n");
}

// ── Single ingest call ────────────────────────────────────────────────────────
async function ingestScenario(s, cookie) {
  const content = scenarioToText(s);
  const body = {
    content,
    memoryType:   "procedural",
    scope:        "global",
    scopeKey:     "render-scenarios",
    source:       "render-scenarios",
    externalId:   s.id,
    verification: "verified",
    confidence:   0.92,
    importance:   0.85,
    salience:     0.80,
    atomic:       false,  // treat whole chunk as one unit (no further splitting)
    entities:     [s.category, s.severity, "render", "deployment"],
    metadata: {
      scenario_id: s.id,
      category:    s.category,
      severity:    s.severity,
      trigger:     s.trigger,
      condition:   s.condition,
      if_action:   s.if_action,
      else_action: s.else_action,
      source_doc:  s.source_doc,
    },
  };

  const res = await fetch(`${BASE_URL}/vector-memory/ingest`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${s.id}: HTTP ${res.status} — ${err.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.ids?.[0] ?? null;
}

// ── Batch runner with retries ─────────────────────────────────────────────────
async function runBatch(batch, cookie, attempt = 1) {
  return Promise.all(batch.map(async (s) => {
    try {
      const id = await ingestScenario(s, cookie);
      return { ok: true, scenario: s.id, vectorId: id };
    } catch (e) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return runBatch([s], cookie, attempt + 1).then(r => r[0]);
      }
      return { ok: false, scenario: s.id, error: e.message };
    }
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔵 Render scenarios RAG ingest`);
  console.log(`   CSV: ${CSV_PATH}`);
  console.log(`   API: ${BASE_URL}`);
  console.log(`   Batch: ${BATCH_SIZE} | Delay: ${DELAY_MS}ms | Dry: ${DRY_RUN} | Force: ${FORCE}\n`);

  const scenarios = loadScenarios();
  console.log(`   Loaded ${scenarios.length} scenarios from CSV`);

  if (DRY_RUN) {
    console.log("\n✅ Dry run — first 3 content blocks:\n");
    scenarios.slice(0, 3).forEach(s => { console.log(scenarioToText(s)); console.log("---"); });
    return;
  }

  const cookie = makeSessionCookie();

  // Optionally check which are already ingested
  let toIngest = scenarios;
  if (!FORCE) {
    // Quick status check
    const statusRes = await fetch(`${BASE_URL}/vector-memory/status`, {
      headers: { Cookie: cookie },
    }).catch(() => null);
    if (statusRes?.ok) {
      const status = await statusRes.json();
      console.log(`   Vector store: ${status.total ?? "?"} existing memories\n`);
    }
  }

  let ok = 0, fail = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < toIngest.length; i += BATCH_SIZE) {
    const batch = toIngest.slice(i, i + BATCH_SIZE);
    const results = await runBatch(batch, cookie);

    for (const r of results) {
      if (r.ok) {
        ok++;
        process.stdout.write(`\r   ✓ ${ok + fail}/${toIngest.length} (${fail} failed)`);
      } else {
        fail++;
        errors.push(r);
        process.stdout.write(`\r   ✓ ${ok + fail}/${toIngest.length} (${fail} failed)`);
      }
    }

    if (i + BATCH_SIZE < toIngest.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n\n✅ Done: ${ok} ingested, ${fail} failed, ${skipped} skipped`);

  if (errors.length) {
    console.log("\n❌ Failures:");
    errors.forEach(e => console.log(`   ${e.scenario}: ${e.error}`));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
