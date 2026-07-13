# Changelog

All notable changes to **NOVA** (primary twin of SUPERNOVA/ABBY).

---

## 2026-07-13 — Add Composio connected apps and repair normal chat tool execution

Root cause:
- The browser chat posted directly to the raw `/api/v1/chat/completions` model proxy. Only Work Tree reached OpenClaw, so normal chat could describe tools but could not invoke them.
- The Settings integration panel only exposed hard-coded Google, YouTube and Instagram credential fields.
- The `nova-services` skill had no Composio or GitHub discovery/execution commands, causing generic GitHub capability denials.

Summary:
- Added `/api/agent/v1/chat/completions` and routed normal browser chat through the real loopback OpenClaw agent runtime.
- Kept `/api/v1/*` as the internal model-provider path, avoiding a recursive OpenClaw proxy loop.
- Added a Composio Tool Router client with persistent stable-user sessions.
- Added catalog, connection status, hosted Connect Link, natural-language tool search and tool execution routes.
- Added a searchable dropdown-style Composio app showcase to Settings with featured GitHub, Gmail, Calendar, Drive, Sheets, Slack, Notion, Linear, Shopify, HubSpot, Supabase and Discord entries.
- Added connection badges, OAuth popup return handling, catalog search, masked project-key storage and PIN protection.
- Added `composio-status`, `composio-apps`, `composio-connections`, `composio-connect`, `composio-search`, `composio-execute` and `github-repo` commands to the OpenClaw service skill.
- Updated Work Tree and `TOOLS.md` so GitHub and connected-app requests must attempt the real Composio bridge before reporting a capability failure.
- Prevented OpenClaw's internal model-provider calls from being written into scratchpad memory as duplicate user conversations.

Required production acceptance:
- Configure `COMPOSIO_API_KEY` in Render or Settings.
- Connect GitHub through Settings.
- Ask normal NOVA chat to analyze a repository URL and verify that it discovers and executes real GitHub tools rather than returning a generic denial.

## 2026-07-13 — Embed official OpenClaw as the Work-Tree backend

Summary:
- Added the released `openclaw@2026.6.11` runtime to the production image and upgraded the image to Node `24.18.0`.
- Added a loopback-only OpenClaw Gateway with strict token authentication and the official OpenAI-compatible agent endpoint.
- Replaced external Work-Tree dispatch with `openclaw/default` execution while preserving the existing DB and UI contract.
- Routed OpenClaw model traffic through NOVA's existing `/api/v1` provider proxy, retaining server-side OpenAI, Gemini and Bitdeer key handling.
- Added the `nova-services` OpenClaw workspace skill for Gmail, Drive, Docs, Sheets, YouTube, Instagram, knowledge, scratchpad and repository skills.
- Added startup readiness gating, process supervision, stale-run reconciliation, cancellation aborts, runtime status reporting and bounded execution timeouts.
- Stopped launching the competing legacy custom worker in production.

Verification:
- Frozen dependency installation, full TypeScript typecheck and API bundle passed.
- Exact OpenClaw configuration and `nova-services` skill discovery passed.
- The production Docker image built and booted successfully.
- `/api/healthz`, `/api/openclaw/status`, the NOVA UI and `/assets/bob.js` passed live-container smoke checks.

## 2026-07-13 — Repair repository integrity defects exposed by CI

Summary:
- Renamed the Markdown governance design from `GOVERNANCE.json` to `GOVERNANCE.md` and repaired its workspace link.
- Renamed the commented TypeScript configuration reference from `tsconfig-strict.json` to `tsconfig-strict.jsonc`.
- Extracted the complete runnable Python body from the Markdown-wrapped `scripts/agentic_demo.py` paste without changing its runtime implementation.
- Improved repository verification so invalid JSON and Python syntax failures preserve exact diagnostics.
- Restricted Python compilation to every Git-tracked `.py` source rather than generated dependency files.

Verification:
- Every real JSON file parsed successfully.
- All 1,014 Git-tracked Python files compiled successfully.
- Both Repository Verification and OpenClaw Backend CI passed on the clean committed tree.

## 2026-07-13 — Repair frozen dependency installation and add CI verification

Summary:
- Aligned the repository, Docker image and CI on `pnpm@10.32.1`, matching the workspace configuration and lockfile format.
- Preserved the workspace-level platform overrides in `pnpm-workspace.yaml`.
- Added `.github/workflows/repo-verify.yml` to validate JSON, install with the frozen lockfile, typecheck, build the API, compile-check Python files, and build the production Docker image.

Defect fixed:
- `pnpm@9.15.4` rejected the existing lockfile with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` because the workspace-level overrides configuration was generated for the pnpm 10 configuration model.

---

## 2026-07-04 — branch `2026-07-04/point-nova-at-new-supernova`

Summary:
- Point NOVA at the NEW SUPERNOVA deployment (https://supernova-ai1.onrender.com), replacing the old build (supernova-ekbj.onrender.com):
  - `artifacts/nova/index.html` — both "Open Super Nova" buttons.
  - `artifacts/api-server/src/routes/work-tree.ts` — `SUPERNOVA_BASE_URL` default.
  - docs/ARCHITECTURE.md + .agents/memory/twin-system-doctrine.md.
- Rebuilt the api-server bundle (dist now carries the new URL).
- Added README.md, CHANGELOG.md, AI_NOTES.md (git policy docking).

Broken / known limits:
- Server-to-server Work-Tree dispatch also needs SUPERNOVA_API_KEY (NOVA) to match the new SUPERNOVA service's OPENCLAW_API_KEY; the browser "Open Super Nova" buttons work regardless. NOVA's own redeploy is controlled by its Render service.

Verified: source + rebuilt dist contain only the new URL (0 old refs); typecheck clean; new URL returns HTTP 200.
