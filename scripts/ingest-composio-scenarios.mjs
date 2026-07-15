#!/usr/bin/env node
/**
 * Ingests all 500 Composio agentic-runtime scenarios into the vector memory store.
 *
 * Usage:
 *   node scripts/ingest-composio-scenarios.mjs
 *   node scripts/ingest-composio-scenarios.mjs --dry-run
 *   node scripts/ingest-composio-scenarios.mjs --force
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE   = args.includes("--force");

const CSV_PATH   = resolve(__dirname, "composio_scenarios/composio_scenarios.csv");
const API_PORT   = Number(process.env.PORT || 8080);
const BASE_URL   = `http://127.0.0.1:${API_PORT}/api`;
const BATCH_SIZE = 1;
const DELAY_MS   = 50;

function makeSessionCookie() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expMs = Date.now() + 12 * 60 * 60 * 1000;
  const sig   = createHmac("sha256", secret).update(String(expMs)).digest("hex");
  return `wt_session=${expMs}.${sig}`;
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const row = [];
    while (i < n) {
      if (text[i] === '"') {
        i++;
        let field = "";
        while (i < n) {
          if (text[i] === '"' && text[i + 1] === '"') { field += '"'; i += 2; }
          else if (text[i] === '"') { i++; break; }
          else { field += text[i++]; }
        }
        row.push(field);
        if (text[i] === ",") i++;
      } else {
        const start = i;
        while (i < n && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") i++;
        row.push(text.slice(start, i));
        if (text[i] === ",") i++;
      }
      if (i >= n || text[i] === "\n" || text[i] === "\r") break;
    }
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
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return data.map(row => ({
    id:          row[idx.id],
    category:    row[idx.category],
    trigger:     row[idx.trigger],
    condition:   row[idx.condition],
    if_action:   row[idx.if_action],
    else_action: row[idx.else_action],
    severity:    row[idx.severity],
    source_doc:  row[idx.source_doc],
  }));
}

function scenarioToText(s) {
  return [
    `[${s.id} | ${s.category} | severity:${s.severity}]`,
    `TRIGGER: ${s.trigger}`,
    `CONDITION: ${s.condition}`,
    `IF: ${s.if_action}`,
    `ELSE: ${s.else_action}`,
    `SOURCE: ${s.source_doc}`,
  ].join("\n");
}

async function ingestOne(scenario, cookie) {
  const body = {
    content:      scenarioToText(scenario),
    memoryType:   "procedural",
    scope:        "global",
    scopeKey:     "composio-scenarios",
    verification: "verified",
    importance:   0.85,
    confidence:   0.92,
    metadata: {
      scenario_id: scenario.id,
      category:    scenario.category,
      severity:    scenario.severity,
      trigger:     scenario.trigger,
      condition:   scenario.condition,
      if_action:   scenario.if_action,
      else_action: scenario.else_action,
      source_doc:  scenario.source_doc,
    },
  };

  const res = await fetch(`${BASE_URL}/vector-memory/ingest`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function runBatch(batch, cookie) {
  return Promise.all(
    batch.map(s =>
      ingestOne(s, cookie)
        .then(() => ({ ok: true, scenario: s.id }))
        .catch(e  => ({ ok: false, scenario: s.id, error: e.message }))
    )
  );
}

async function main() {
  console.log("\n🔵 Composio scenarios RAG ingest");
  console.log(`   CSV: ${CSV_PATH}`);
  console.log(`   API: ${BASE_URL}`);
  console.log(`   Batch: ${BATCH_SIZE} | Delay: ${DELAY_MS}ms | Dry: ${DRY_RUN} | Force: ${FORCE}\n`);

  const scenarios = loadScenarios();
  console.log(`   Loaded ${scenarios.length} scenarios from CSV`);

  if (DRY_RUN) {
    console.log("\n✅ Dry run complete — no writes.");
    return;
  }

  const cookie = makeSessionCookie();

  const statusRes = await fetch(`${BASE_URL}/vector-memory/status`, {
    headers: { Cookie: cookie },
  }).catch(() => null);
  if (statusRes?.ok) {
    const status = await statusRes.json();
    console.log(`   Vector store: ${status.total ?? "?"} existing memories\n`);
  }

  let ok = 0, fail = 0;
  const errors = [];

  for (let i = 0; i < scenarios.length; i += BATCH_SIZE) {
    const batch   = scenarios.slice(i, i + BATCH_SIZE);
    const results = await runBatch(batch, cookie);
    for (const r of results) {
      if (r.ok) { ok++; } else { fail++; errors.push(r); }
      process.stdout.write(`\r   ✓ ${ok + fail}/${scenarios.length} (${fail} failed)`);
    }
    if (i + BATCH_SIZE < scenarios.length) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n\n✅ Done: ${ok} ingested, ${fail} failed`);
  if (errors.length) {
    console.log("\n❌ Failures:");
    errors.forEach(e => console.log(`   ${e.scenario}: ${e.error}`));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
