#!/usr/bin/env node
// scratchpad-daemon.mjs — distills raw conversation turns into categorized,
// long-lived scratchpad memory so NOVA keeps continuity ("lattice fidelity")
// across conversations.
//
// Flow:
//   1. The api-server proxy captures each assistant reply into
//      conversation_turns (grouped by a stable conversation_key).
//   2. This daemon polls for unprocessed turns, groups them by conversation,
//      folds them (plus the existing entry) through the LLM into a compact
//      {category, title, summary, key_facts} record, and upserts it into
//      scratchpad_entries.
//   3. The proxy reads scratchpad_entries back as a memory digest and injects
//      it into every chat for continuity.
//
// Storage is plain Postgres. The daemon connects to SCRATCHPAD_DATABASE_URL
// when set (the Railway Postgres public URL, so this always-on Replit daemon
// distills the live app's memory), otherwise falls back to DATABASE_URL.

import pg from "pg";

const { Pool } = pg;

const DATABASE_URL =
  process.env.SCRATCHPAD_DATABASE_URL || process.env.DATABASE_URL;
const BITDEER_KEY = process.env.BITDEER_API_KEY;
const KIMI_KEY   = process.env.KIMI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
// Resolve the active LLM key and base URL — BITDEER → KIMI → OPENAI.
const ACTIVE_LLM_KEY = BITDEER_KEY || KIMI_KEY || OPENAI_KEY;
const BASE_URL = BITDEER_KEY
  ? (process.env.BITDEER_BASE_URL || "https://api-inference.bitdeer.ai/v1")
  : KIMI_KEY
  ? (process.env.KIMI_BASE_URL    || "https://api.moonshot.cn/v1")
  : (process.env.OPENAI_BASE_URL  || "https://api.openai.com/v1");
const MODEL = process.env.SCRATCHPAD_MODEL ||
  (BITDEER_KEY ? "moonshotai/Kimi-K2.6" : KIMI_KEY ? "kimi-k2" : "gpt-4o-mini");
const POLL_MS = Number(process.env.SCRATCHPAD_POLL_MS || 15000);
const BATCH_CONVERSATIONS = Number(process.env.SCRATCHPAD_BATCH || 5);
// After this many failed attempts a turn is dead-lettered (marked processed)
// so a poison-pill row can't block the queue forever.
const MAX_ATTEMPTS = Number(process.env.SCRATCHPAD_MAX_ATTEMPTS || 5);
// Global mutual exclusion across daemon instances (Replit + Railway etc.) so a
// conversation is never distilled twice. Arbitrary stable lock id.
const ADVISORY_LOCK_ID = 778120453;

const CATEGORIES = [
  "identity",      // who Robert is, personal facts, relationships, preferences
  "health",        // medical, health, diet, fitness, the body
  "esoteric",      // numerology, astrology, sacred geometry, tarot, mysticism
  "manifestation", // Neville Goddard, law of assumption, desires, goals
  "quantum",       // quantum science, physics, consciousness-science
  "tasks",         // todos, projects, plans, work items
  "general",       // anything else
];

if (!DATABASE_URL) {
  console.error("scratchpad-daemon: FATAL — DATABASE_URL missing");
  process.exit(78);
}
if (!ACTIVE_LLM_KEY) {
  console.warn("scratchpad-daemon: no LLM key (BITDEER_API_KEY or OPENAI_API_KEY) — idling. Distillation will begin once a key is available.");
  setInterval(() => {
    const k = process.env.BITDEER_API_KEY || process.env.OPENAI_API_KEY;
    if (k) { console.log("scratchpad-daemon: LLM key detected — restarting to activate."); process.exit(0); }
  }, 60_000).unref();
}

// Force SSL for any non-localhost Postgres URL (Render, Railway, etc.).
const _poolSsl = (() => {
  if (!DATABASE_URL) return undefined;
  try {
    const host = new URL(DATABASE_URL).hostname;
    if (host === "localhost" || host === "127.0.0.1") return undefined;
  } catch { /* unparseable — default to SSL */ }
  return { rejectUnauthorized: false };
})();
const pool = new Pool({ connectionString: DATABASE_URL, ssl: _poolSsl });
pool.on("error", (err) => {
  console.warn("scratchpad-daemon: pool background error (will retry):", err.message);
});

function clip(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) : s;
}

async function claimConversations() {
  // Distinct conversation keys that have unprocessed turns.
  const { rows } = await pool.query(
    `SELECT conversation_key, COUNT(*)::int AS n
       FROM conversation_turns
      WHERE processed = false
      GROUP BY conversation_key
      ORDER BY MAX(created_at) ASC
      LIMIT $1`,
    [BATCH_CONVERSATIONS],
  );
  return rows;
}

async function loadTurns(conversationKey) {
  const { rows } = await pool.query(
    `SELECT id, user_text, assistant_text
       FROM conversation_turns
      WHERE conversation_key = $1 AND processed = false
      ORDER BY created_at ASC`,
    [conversationKey],
  );
  return rows;
}

async function loadEntry(conversationKey) {
  const { rows } = await pool.query(
    `SELECT category, title, summary, key_facts, turn_count
       FROM scratchpad_entries
      WHERE conversation_key = $1`,
    [conversationKey],
  );
  return rows[0] || null;
}

async function callLLM(prompt) {
  const body = {
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are NOVA's memory archivist. Distill a conversation into a compact, durable note Robert's assistant can reuse later. " +
          "Output STRICT JSON only, no markdown, with keys: category, title, summary, key_facts. " +
          `category MUST be one of: ${CATEGORIES.join(", ")}. ` +
          "title: <=8 words. summary: 1-3 sentences capturing what matters for continuity (decisions, preferences, facts, open threads). " +
          "key_facts: a single string of short bullet lines separated by \\n, each a concrete fact, preference, or commitment. Keep it tight.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 16384,
    temperature: 0.2,
    stream: false,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACTIVE_LLM_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    const j = await res.json();
    return j.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

function parseDistillation(raw) {
  let text = String(raw || "").trim();
  // Strip code fences if the model wrapped JSON.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // Grab the outermost JSON object.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    // Model returned non-JSON; treat entire raw response as the summary text.
    return {
      category: "general",
      title: "Untitled",
      summary: clip(String(raw || ""), 1200),
      keyFacts: "",
    };
  }
  let category = String(obj.category || "general").toLowerCase().trim();
  if (!CATEGORIES.includes(category)) category = "general";
  return {
    category,
    title: clip(obj.title || "Untitled", 120),
    summary: clip(obj.summary || "", 1200),
    keyFacts: clip(
      Array.isArray(obj.key_facts) ? obj.key_facts.join("\n") : obj.key_facts || "",
      2000,
    ),
  };
}

async function upsertEntry(conversationKey, d, addedTurns) {
  await pool.query(
    `INSERT INTO scratchpad_entries
       (conversation_key, category, title, summary, key_facts, turn_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())
     ON CONFLICT (conversation_key) DO UPDATE SET
       category = EXCLUDED.category,
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       key_facts = EXCLUDED.key_facts,
       turn_count = scratchpad_entries.turn_count + $6,
       updated_at = now()`,
    [conversationKey, d.category, d.title, d.summary, d.keyFacts, addedTurns],
  );
}

async function markProcessed(ids) {
  if (!ids.length) return;
  await pool.query(
    `UPDATE conversation_turns SET processed = true WHERE id = ANY($1::int[])`,
    [ids],
  );
}

async function processConversation(conversationKey) {
  const turns = await loadTurns(conversationKey);
  if (!turns.length) return;
  const existing = await loadEntry(conversationKey);

  const convText = turns
    .map((t) => `User: ${clip(t.user_text, 1500)}\nNOVA: ${clip(t.assistant_text, 1500)}`)
    .join("\n\n");

  let prompt = "";
  if (existing) {
    prompt =
      `EXISTING NOTE (category: ${existing.category}; title: ${existing.title}):\n` +
      `${existing.summary}\nKey facts:\n${existing.key_facts}\n\n` +
      `NEW EXCHANGES TO FOLD IN:\n${convText}\n\n` +
      "Update the note so it reflects the whole conversation so far. Keep what's still true, add what's new, drop nothing important.";
  } else {
    prompt = `CONVERSATION:\n${convText}\n\nDistill it into the note.`;
  }

  const raw = await callLLM(clip(prompt, 12000));
  const d = parseDistillation(raw);
  await upsertEntry(conversationKey, d, turns.length);
  await markProcessed(turns.map((t) => t.id));
  console.log(
    `scratchpad-daemon: ${conversationKey} -> [${d.category}] "${d.title}" (+${turns.length} turns)`,
  );
}

// On failure: bump attempts (so the work is retried next tick) and only
// dead-letter — mark processed — once a turn has exhausted MAX_ATTEMPTS, so a
// transient LLM/network/JSON error never silently drops memory.
async function markFailed(ids) {
  if (!ids.length) return;
  await pool.query(
    `UPDATE conversation_turns
        SET attempts = attempts + 1,
            processed = (attempts + 1 >= $2)
      WHERE id = ANY($1::int[])`,
    [ids, MAX_ATTEMPTS],
  );
}

// Exponential back-off for DB connection failures.
let _dbBackoffMs = POLL_MS;
const _dbBackoffMax = 120_000;

let running = false;
async function tick() {
  if (running) return;
  running = true;
  // Acquire a global advisory lock on its own session so only one daemon
  // instance processes per tick, even if several are deployed.
  let client;
  try {
    client = await pool.connect();
    _dbBackoffMs = POLL_MS; // reset on success
  } catch (connErr) {
    console.warn(`scratchpad-daemon: DB connect failed (retry in ${Math.round(_dbBackoffMs / 1000)}s):`, connErr.message);
    const wait = _dbBackoffMs;
    _dbBackoffMs = Math.min(_dbBackoffMs * 2, _dbBackoffMax);
    running = false;
    setTimeout(() => tick(), wait);
    return;
  }
  let locked = false;
  try {
    const lk = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [
      ADVISORY_LOCK_ID,
    ]);
    locked = lk.rows[0]?.ok === true;
    if (!locked) return;

    const convs = await claimConversations();
    for (const c of convs) {
      try {
        await processConversation(c.conversation_key);
      } catch (e) {
        console.error(
          `scratchpad-daemon: failed ${c.conversation_key} — ${e.message || e}`,
        );
        const turns = await loadTurns(c.conversation_key).catch(() => []);
        await markFailed(turns.map((t) => t.id)).catch(() => {});
      }
    }
  } catch (e) {
    console.error("scratchpad-daemon: tick error", e.message || e);
  } finally {
    if (client) {
      if (locked) {
        await client
          .query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID])
          .catch(() => {});
      }
      client.release();
    }
    running = false;
  }
}

console.log(
  `scratchpad-daemon: ready — model ${MODEL}, poll ${POLL_MS}ms, batch ${BATCH_CONVERSATIONS}`,
);
await tick();
const interval = setInterval(() => tick(), POLL_MS);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`scratchpad-daemon: ${sig} received; shutting down`);
    clearInterval(interval);
    pool.end().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
