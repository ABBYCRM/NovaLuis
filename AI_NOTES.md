# AI_NOTES

Working notes for AI agents/contributors. Newest first.

---

## 2026-07-13 — Official OpenClaw backend integration

- **Objective:** Replace NOVA's non-local/competing agent execution paths with one official OpenClaw Gateway inside the production container.
- **Pinned runtime:** `openclaw@2026.6.11` on Node `24.18.0`.
- **Execution contract:** Work-Tree posts to the loopback Gateway's enabled `/v1/chat/completions` endpoint using `openclaw/default`. The endpoint executes a normal OpenClaw agent run, not a raw model completion.
- **Model wiring:** OpenClaw provider `nova` points to `http://127.0.0.1:$PORT/api/v1`; NOVA continues to own real provider credentials and memory/knowledge prompt injection.
- **Service wiring:** Workspace skill `nova-services` calls NOVA's authenticated integration, knowledge, scratchpad and skills endpoints through loopback only.
- **Process lifecycle:** `scripts/start-openclaw.mjs` starts and health-checks the Gateway before starting the API, forwards signals, and terminates the container if either critical process dies.
- **Persistence:** Set `OPENCLAW_STATE_DIR` to a mounted persistent disk path in production. The default `/app/.openclaw` is functional but ephemeral across image replacement.
- **Do not re-enable:** `scripts/work-tree-worker.mjs` must not run alongside the new Gateway-backed Work-Tree dispatcher; both would claim/execute the same missions.
- **Truth gate:** Do not mark this deployment complete until the image builds, the Gateway status endpoint is ready, and one real mission reaches `done` with `model=openclaw/default` and a non-empty report.

## 2026-07-13 — Trigger Render deployment after package manifest repair

- **Objective:** Trigger a fresh Render auto-deploy after repairing the root
  `package.json` and production `Dockerfile`.
- **Expected source:** `ABBYCRM/NovaLuis`, branch `main`.
- **Expected repair commit:** `f577e1995755ca1df1206a1c965e3faf6c401110` or a later descendant containing the same fix.
- **Required verification:** Render build completes, deploy reaches `live`, the
  deployed commit matches the expected Git revision, `/api/healthz` responds,
  and the Nova UI loads.
- **Security:** No GitHub or Render credentials are stored in this repository.

## 2026-07-04 — Repoint NOVA → new SUPERNOVA URL

- **Model:** claude-opus-4-8 (Claude Code).
- **Objective:** Make NOVA call the new SUPERNOVA build
  (https://supernova-ai1.onrender.com), not the old one
  (supernova-ekbj.onrender.com).
- **Changed:** both frontend "Open Super Nova" buttons (index.html), the
  `SUPERNOVA_BASE_URL` default in work-tree.ts, ARCHITECTURE.md, and the
  twin-system-doctrine memory. Rebuilt the api-server dist.
- **Why:** the old SUPERNOVA build is superseded by the freshly deployed
  supernova-ai1 service.
- **Risks / next steps:** the programmatic Work-Tree dispatch (server→server)
  also needs `SUPERNOVA_API_KEY` on NOVA to equal the new SUPERNOVA service's
  `OPENCLAW_API_KEY`. The browser buttons need no key. NOVA's live redeploy is
  controlled by its own Render service (not the ABBY-AI team account used for
  the SUPERNOVA deploy), so a redeploy of NOVA is required for the server
  default to take effect in production.
- **Verified:** 0 old-URL refs remain in source or rebuilt dist; typecheck
  clean; new URL HTTP 200.
