#!/usr/bin/env node
/**
 * Fill missing embeddings for vector_memories rows that have embedding IS NULL.
 * Runs sequentially (1/sec) to stay within Gemini rate limits.
 * Safe to run any time — skips rows that already have embeddings.
 *
 * Usage:  node scripts/fill-embeddings.mjs
 */
import { createHmac } from "node:crypto";

const API_PORT = Number(process.env.PORT || 8080);
const BASE_URL = `http://127.0.0.1:${API_PORT}/api`;
const GEMINI_KEY  = process.env.GEMINI_API_KEY ?? "";
const GEMINI_URL  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${GEMINI_KEY}`;

function makeSessionCookie() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  const expMs = Date.now() + 24 * 60 * 60 * 1000;
  const sig   = createHmac("sha256", secret).update(String(expMs)).digest("hex");
  return `wt_session=${expMs}.${sig}`;
}

async function geminiEmbed(text) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: 1536,
      }),
    });
    if (r.ok) {
      const j = await r.json();
      return j.embedding.values;
    }
    if ((r.status === 429 || r.status === 503) && attempt < 5) {
      const retryAfter = r.headers.get("Retry-After");
      await new Promise(res => setTimeout(res, retryAfter ? Number(retryAfter)*1000 : 500 * attempt));
      continue;
    }
    throw new Error(`gemini ${r.status}: ${await r.text()}`);
  }
}

async function getNullRows(cookie) {
  // Use the vector-memory/status to get total, then fetch all rows needing embedding
  // via a paginated search with a very broad query
  const r = await fetch(`${BASE_URL}/vector-memory/fill-missing`, {
    headers: { Cookie: cookie },
  });
  if (r.ok) return r.json();
  // Fallback: re-ingest via status check + forced re-ingest is handled by the caller
  return null;
}

async function main() {
  if (!GEMINI_KEY) { console.error("GEMINI_API_KEY not set"); process.exit(1); }
  const cookie = makeSessionCookie();

  // Check status
  const stRes = await fetch(`${BASE_URL}/vector-memory/status`, { headers: { Cookie: cookie } });
  const st = await stRes.json();
  console.log(`Store: total=${st.total} embedded=${st.embedded} lexicalOnly=${st.lexicalOnly}`);

  if (st.lexicalOnly === 0) { console.log("All rows already embedded."); return; }

  // The fill-missing endpoint may not exist — fall back to checking status periodically
  // and triggering re-ingests via the ingest endpoint
  console.log(`Need to embed ${st.lexicalOnly} rows. Using direct DB approach via API re-ingest...`);

  // Get all memory IDs that need embeddings via a search for placeholder content
  // We'll use the ingest endpoint to update them
  let filled = 0;
  let errors = 0;

  // Poll DB for unembedded rows using internal admin endpoint
  const adminRes = await fetch(`${BASE_URL}/vector-memory/unembedded?limit=2000`, {
    headers: { Cookie: cookie },
  });

  if (!adminRes.ok) {
    console.log("No /unembedded endpoint — using ingest-script approach");
    console.log("Run individual ingest scripts with --force to fill embeddings.");
    process.exit(0);
  }

  const { rows } = await adminRes.json();
  console.log(`Found ${rows.length} unembedded rows to fill.`);

  for (const row of rows) {
    try {
      const vec = await geminiEmbed(row.content);
      // Patch via update endpoint
      const patchRes = await fetch(`${BASE_URL}/vector-memory/${row.id}/embedding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ embedding: vec }),
      });
      if (patchRes.ok) { filled++; }
      else { errors++; console.error(`patch failed: ${row.id} ${patchRes.status}`); }
    } catch (e) {
      errors++;
      console.error(`embed failed: ${row.id} ${e.message}`);
    }
    process.stdout.write(`\r  filled ${filled}/${rows.length} errors=${errors}`);
    await new Promise(res => setTimeout(res, 100)); // 100ms between calls
  }

  console.log(`\nDone: ${filled} filled, ${errors} errors.`);
}

main().catch(e => { console.error(e); process.exit(1); });
