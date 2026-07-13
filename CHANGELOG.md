# Changelog

All notable changes to **NOVA** (primary twin of SUPERNOVA/ABBY).

---

## 2026-07-13 — Embed official OpenClaw as the Work-Tree backend

Summary:
- Added the released `openclaw@2026.6.11` runtime to the production image and upgraded the image to Node `24.18.0`.
- Added a loopback-only OpenClaw Gateway with strict token authentication and the official OpenAI-compatible agent endpoint.
- Replaced external Work-Tree dispatch with `openclaw/default` execution while preserving the existing DB and UI contract.
- Routed OpenClaw model traffic through NOVA's existing `/api/v1` provider proxy, retaining server-side OpenAI, Gemini and Bitdeer key handling.
- Added the `nova-services` OpenClaw workspace skill for Gmail, Drive, Docs, Sheets, YouTube, Instagram, knowledge, scratchpad and repository skills.
- Added startup readiness gating, process supervision, stale-run reconciliation, cancellation aborts, runtime status reporting and bounded execution timeouts.
- Stopped launching the competing legacy custom worker in production.

Verification required before declaring production complete:
- JSON syntax for `openclaw/openclaw.json`.
- Node syntax checks for runtime scripts.
- TypeScript parse/type/build checks.
- Docker build and `openclaw --version` output.
- `/api/healthz`, `/api/openclaw/status`, `/v1/models` and a real Work-Tree mission on the deployed revision.

---

## 2026-07-04 — branch `2026-07-04/point-nova-at-new-supernova`

Summary:
- Point NOVA at the NEW SUPERNOVA deployment (https://supernova-ai1.onrender.com),
  replacing the old build (supernova-ekbj.onrender.com):
  - `artifacts/nova/index.html` — both "Open Super Nova" buttons.
  - `artifacts/api-server/src/routes/work-tree.ts` — `SUPERNOVA_BASE_URL` default.
  - docs/ARCHITECTURE.md + .agents/memory/twin-system-doctrine.md.
- Rebuilt the api-server bundle (dist now carries the new URL).
- Added README.md, CHANGELOG.md, AI_NOTES.md (git policy docking).

Broken / known limits:
- Server-to-server Work-Tree dispatch also needs SUPERNOVA_API_KEY (NOVA) to
  match the new SUPERNOVA service's OPENCLAW_API_KEY; the browser "Open Super
  Nova" buttons work regardless. NOVA's own redeploy is controlled by its
  Render service (separate account).

Verified: source + rebuilt dist contain only the new URL (0 old refs);
typecheck clean; new URL returns HTTP 200.
