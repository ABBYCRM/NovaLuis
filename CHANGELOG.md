# Changelog

All notable changes to **NOVA** (primary twin of SUPERNOVA/ABBY).

---

## 2026-07-13 — repair frozen dependency installation and add CI verification

Summary:
- Aligned the repository and Docker image on `pnpm@10.32.1`, matching the
  workspace configuration and lockfile format.
- Added `.github/workflows/repo-verify.yml` to validate JSON, install with the
  frozen lockfile, typecheck, build the API, compile-check Python files, and
  build the production Docker image.

Defect fixed:
- `pnpm@9.15.4` rejected the existing lockfile with
  `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` because the workspace-level overrides
  configuration was generated for the pnpm 10 configuration model.

Verification:
- GitHub Actions run is the authoritative clean-run evidence for dependency,
  typecheck, build, Python syntax, and Docker validation.

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
