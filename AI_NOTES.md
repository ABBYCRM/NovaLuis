# AI_NOTES

Working notes for AI agents/contributors. Newest first.

---

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
