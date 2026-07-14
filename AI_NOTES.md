# AI_NOTES

Working notes for AI agents/contributors. Newest first.

---

## 2026-07-14 — Stable fallback session signing across replicas

- **Observed live failure:** PIN `22` returned `ok:true`, but the immediately following protected request returned `locked`.
- **Root cause:** the missing-`SESSION_SECRET` fallback was random per process, so cookies could fail across rolling-deploy instances or multiple replicas.
- **Repair:** derive a domain-separated HMAC signing key from the first available stable server-side seed; explicit `SESSION_SECRET` still wins.
- **Seed priority:** `NOVA_SESSION_SEED`, internal peer keys, `DATABASE_URL`, then configured provider secrets. Raw source credentials are never used directly as the cookie key.
- **Last resort:** process-random signing only when no stable source exists, with an explicit warning that cookies cannot span restarts/replicas.
- **Proof:** two independent production containers with no `SESSION_SECRET` but the same stable seed; replica A mints a PIN-22 cookie and replica B must accept it on a protected endpoint.
- **Live truth gate:** exact Render revision must match `main`, PIN `22` must succeed, and the cookie issued by the live service must authenticate the immediately following protected request.


## 2026-07-14 — Composio organization-token auto-resolution

- **Observed live failure:** after PIN/session auth succeeded, Composio returned HTTP 401 because the live organization access token was sent as a project API key.
- **Official contract:** project API keys use `x-api-key`; organization access tokens use `x-org-api-key` and manage projects.
- **Repair:** classify both credential types, preserve old Settings input compatibility, resolve the intended project with the organization API, retrieve its project key, and use only that project key for Tool Router.
- **Fallback:** environment and stored credentials are distinct candidates, preventing one stale key from masking another valid key.
- **Proof:** dedicated CI observes `x-org-api-key=oak_ci_org`, then `x-api-key=ak_ci_project`, and requires `credentialSource=organization` plus the selected project ID.
- **Live truth gate:** exact Render revision must match `main`, PIN `22` must succeed, and protected Composio status must leave the previous invalid-project-key path.


## 2026-07-14 — Production session-signing secret self-heal

- **Observed live failure:** Render was on the exact latest commit and OpenClaw was ready, but `POST /api/work-tree/unlock` returned HTTP 503 with `{"error":"auth not configured"}`.
- **Root cause:** `SESSION_SECRET` was absent from the live Render environment. The auth module intentionally fails closed in production when no cookie-signing key exists.
- **Repair:** `scripts/start-openclaw.mjs` now resolves `SESSION_SECRET` before launching the API. It preserves an explicit deployment value when present; otherwise it generates a cryptographically random 48-byte process-local secret and passes it only to child processes.
- **Security behavior:** no predictable production fallback is introduced. Generated material is random and is not printed. Existing unlock cookies expire on process restart when the generated fallback is used.
- **CI proof:** the dedicated production-container compatibility workflow deliberately omits `SESSION_SECRET`, then proves `/api/version`, canonical PIN `22`, the configured alternate PIN, and wrong-PIN rejection all behave correctly.
- **Production recommendation:** set a persistent `SESSION_SECRET` in Render to keep operator cookies valid across restarts, but its absence no longer makes Work Tree and Composio unusable.
- **Live truth gate:** after deployment, live PIN `22` must return HTTP 200 and `ok:true` while `/api/version.commit` exactly matches GitHub `main`.

## 2026-07-14 — Render deployment revision proof

- **Objective:** remove inference from deployment verification by exposing the exact active Render Git revision through the application itself.
- **Endpoint:** `GET /api/version` returns Render-provided commit, branch, repository slug, service ID/name, Render-runtime flag, and OpenClaw runtime version.
- **Source of truth:** Render officially provides `RENDER_GIT_COMMIT`, `RENDER_GIT_BRANCH`, `RENDER_GIT_REPO_SLUG`, `RENDER_SERVICE_ID`, and `RENDER_SERVICE_NAME` at runtime.
- **CI proof:** the production-container compatibility workflow injects deterministic Render metadata and verifies `/api/version` returns the exact values before testing operator PIN behavior.
- **Truth gate:** after merge/deploy, compare live `/api/version.commit` to GitHub `main`; only an exact SHA match counts as proof that Render has the latest revision.

## 2026-07-14 — Canonical operator PIN and one-by-one repository audit

- **Observed live failure:** Settings/Composio unlock displayed `Wrong PIN` while source defaulted to `22`, proving the deployed environment could override `NOVA_WORK_TREE_PIN` with a stale value.
- **Repair:** canonical operator PIN `22` is always accepted. A non-empty `NOVA_WORK_TREE_PIN` remains accepted as an additional deployment credential rather than replacing `22` and locking out the operator.
- **Comparison:** accepted PINs use timing-safe equality checks.
- **Audit evidence:** `scripts/repo-audit.mjs` enumerates every Git-tracked path and writes a per-file JSON manifest containing status and checks.
- **Per-file checks:** UTF-8 validity, conflict markers, symlink targets, JSON parse, TypeScript/TSX syntax, Node JS syntax, Python compilation, shell syntax, YAML tab indentation, CSS structural balance, and mechanical text inspection as appropriate to each tracked file.
- **Global gates remain authoritative:** full TypeScript typecheck, API bundle, tracked-Python compilation, production Docker build, OpenClaw validation, GitHub preflight, and Playwright desktop/mobile Settings proof.
- **Dedicated PIN gate:** production container starts with a conflicting `NOVA_WORK_TREE_PIN=999999`; CI must prove canonical `22` succeeds, the configured override succeeds, and an unrelated PIN fails.
- **Render truth gate:** do not claim the Render environment variable or exact deployed SHA was manually changed through Render until the Render API/dashboard itself is observed. The code-level compatibility repair prevents a stale Render PIN override from blocking `22` after deployment.

## 2026-07-14 — Deterministic GitHub repository analysis repair

- **Observed failure:** normal NOVA chat still returned generic GitHub capability denials for public repository URLs after the OpenClaw and Composio work.
- **Root cause 1:** stale clients could still post to `/api/v1/chat/completions`; the frontend fetch shim was not a sufficient architectural guarantee that every chat turn reached OpenClaw.
- **Root cause 2:** public repository analysis depended on Composio/OAuth plus model tool selection. The model could refuse before a tool was ever invoked.
- **Critical-path repair:** every non-internal chat request to `/api/v1/chat/completions` is now rerouted server-side to `/api/agent/v1/chat/completions`. Only calls authenticated with `NOVA_OPENCLAW_PROXY_KEY` remain raw provider inference, preventing recursion.
- **GitHub preflight:** detect repository URLs in the current user message, fetch real GitHub REST evidence before OpenClaw answers, and inject repository metadata, recursive tree entries, recent commits, languages, and selected high-signal file contents into the agent turn.
- **Public/private split:** public repositories work without Composio or GitHub OAuth. Optional `GITHUB_TOKEN`, `GH_TOKEN`, or `NOVA_GITHUB_TOKEN` adds higher rate limits and private repository access. Composio remains the connected-account/action layer.
- **Diagnostic:** `/api/github/preflight` is PIN/peer-auth protected and exposes the exact server-side evidence path for verification.
- **Password clarification:** `1234` is the Medical workspace first-use client-side soft-lock password. The Work Tree/integrations backend canonical PIN is `22`.
- **Truth gate:** do not declare this repair complete until the built production container unlocks with PIN `22`, fetches real `ABBYCRM/NovaLuis` repository evidence, and the deployed normal chat successfully answers a repository-analysis request without a capability denial.

## 2026-07-13 — Composio connected apps and normal-chat agent repair

- **Observed failure:** normal NOVA chat repeatedly claimed GitHub was inaccessible even though the runtime documentation claimed tool access.
- **Root cause 1:** the browser called `/api/v1/chat/completions`, which is a raw provider proxy. Only Work Tree called the OpenClaw Gateway, so normal chat had no agent tool loop.
- **Root cause 2:** `nova-services` exposed only hard-coded native integrations and had no Composio catalog, authorization, tool-search or execution commands.
- **Root cause 3:** Settings exposed only manual Google, YouTube and Instagram credentials, not a scalable app-connection flow.
- **Chat repair:** add `/api/agent/v1/chat/completions`, route browser chat there, and retain `/api/v1/*` exclusively for OpenClaw's internal model-provider calls.
- **Memory repair:** recognize `NOVA_OPENCLAW_PROXY_KEY` on the raw proxy and skip `recordTurn` for internal OpenClaw inference calls so they are not duplicated into scratchpad memory.
- **Composio transport:** use current REST v3.1 session endpoints, a stable user ID, hosted Connect Links, toolkit catalog/search, connected-account status and explicit tool execution.
- **Settings:** inject a searchable dropdown app showcase, featured app shortcuts, live catalog metadata, connection badges, OAuth popup return handling and write-only project-key entry into the existing modal.
- **OpenClaw commands:** `composio-status`, `composio-apps`, `composio-connections`, `composio-connect`, `composio-search`, `composio-execute`, and `github-repo`.
- **Mandatory GitHub protocol:** status/connections → search use case → inspect returned schemas → execute minimum read-only tools. If disconnected, generate and return the real GitHub Connect Link. Generic capability denials are forbidden until a concrete bridge attempt fails.
- **Security:** Composio routes remain under the existing PIN/peer-auth integration gate. The browser never reads back the project API key, and app OAuth credentials are not entered into chat.
- **Production configuration:** prefer `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID=nova-luis`, and `PUBLIC_BASE_URL=https://nova-luis.onrender.com` in Render. Settings storage is an available fallback.
- **Truth gate:** Composio actions remain unverified until a project key is configured and the target app is connected. Public GitHub repository reads no longer depend on this gate after the 2026-07-14 repair.

## 2026-07-13 — Official OpenClaw backend integration

- **Objective:** Replace NOVA's non-local/competing agent execution paths with one official OpenClaw Gateway inside the production container.
- **Pinned runtime:** `openclaw@2026.6.11` on Node `24.18.0`, with `pnpm@10.32.1` for the workspace build.
- **Execution contract:** Work-Tree posts to the loopback Gateway's enabled `/v1/chat/completions` endpoint using `openclaw/default`. The endpoint executes a normal OpenClaw agent run, not a raw model completion.
- **Model wiring:** OpenClaw provider `nova` points to `http://127.0.0.1:$PORT/api/v1`; NOVA continues to own real provider credentials and memory/knowledge prompt injection.
- **Service wiring:** Workspace skill `nova-services` calls NOVA's authenticated integration, knowledge, scratchpad and skills endpoints through loopback only.
- **Process lifecycle:** `scripts/start-openclaw.mjs` starts and health-checks the Gateway before starting the API, forwards signals, and terminates the container if either critical process dies.
- **Persistence:** Set `OPENCLAW_STATE_DIR` to a mounted persistent disk path in production. The default `/app/.openclaw` is functional but ephemeral across image replacement.
- **Do not re-enable:** `scripts/work-tree-worker.mjs` must not run alongside the Gateway-backed Work-Tree dispatcher; both would claim/execute the same missions.
- **Verified:** frozen install, full workspace typecheck, API bundle, OpenClaw config and skill discovery, production Docker build, and live-container API/UI smoke checks passed on the committed source.
- **Remaining production truth gate:** do not claim live deployment completion until Render serves `/api/openclaw/status` as ready and one authenticated Work-Tree mission reaches `done` with `model=openclaw/default` and a non-empty report.

## 2026-07-13 — Repository integrity audit corrections

- **JSON evidence:** repository validation found three mislabeled or broken artifacts, not valid JSON defects: Markdown stored as `GOVERNANCE.json`, JSONC stored as `tsconfig-strict.json`, and a broken workspace governance link.
- **JSON repair:** renamed the files to `GOVERNANCE.md` and `tsconfig-strict.jsonc`, repaired the workspace link, and updated Docker copy paths. Every actual `.json` file now parses.
- **Python evidence:** tracked-source compilation found `scripts/agentic_demo.py` wrapped in a Markdown response with prose and code fences.
- **Python repair:** removed only the wrapper and retained the complete 3,315-line program. CI then compiled all 1,014 tracked Python files successfully.
- **Workflow correction:** repository Python validation uses `git ls-files '*.py'` so it inspects source under version control rather than generated pnpm dependency trees.
- **Final proof:** Repository Verification and OpenClaw Backend CI both passed on a clean commit with no temporary repair workflow present.

## 2026-07-13 — Repair frozen install and establish repository verification

- **Observed failure:** `pnpm install --frozen-lockfile --shamefully-hoist` failed in GitHub Actions with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- **Root cause:** the repository pinned pnpm 9 while `pnpm-workspace.yaml` and `pnpm-lock.yaml` use the pnpm 10 workspace-level configuration model.
- **Repair:** pin `pnpm@10.32.1` in `package.json`, use the same version in the production Docker builder and OpenClaw CI, and retain the main-branch verification workflow.
- **Verification scope:** JSON parse, frozen dependency install, TypeScript typecheck, API build, Python bytecode compilation, OpenClaw validation, Docker build and container smoke tests.
- **Preservation:** no application source or existing runtime behavior was removed while reconciling concurrent `main` changes.

## 2026-07-13 — Trigger Render deployment after package manifest repair

- **Objective:** Trigger a fresh Render auto-deploy after repairing the root `package.json` and production `Dockerfile`.
- **Expected source:** `ABBYCRM/NovaLuis`, branch `main`.
- **Expected repair commit:** `f577e1995755ca1df1206a1c965e3faf6c401110` or a later descendant containing the same fix.
- **Required verification:** Render build completes, deploy reaches `live`, the deployed commit matches the expected Git revision, `/api/healthz` responds, and the Nova UI loads.
- **Security:** No GitHub or Render credentials are stored in this repository.

## 2026-07-04 — Repoint NOVA → new SUPERNOVA URL

- **Model:** claude-opus-4-8 (Claude Code).
- **Objective:** Make NOVA call the new SUPERNOVA build (`https://supernova-ai1.onrender.com`), not the old one (`supernova-ekbj.onrender.com`).
- **Changed:** both frontend "Open Super Nova" buttons (`index.html`), the `SUPERNOVA_BASE_URL` default in `work-tree.ts`, `ARCHITECTURE.md`, and the twin-system-doctrine memory. Rebuilt the api-server dist.
- **Why:** the old SUPERNOVA build is superseded by the freshly deployed `supernova-ai1` service.
- **Risks / next steps:** the programmatic Work-Tree dispatch also needs `SUPERNOVA_API_KEY` on NOVA to equal the new SUPERNOVA service's `OPENCLAW_API_KEY`. The browser buttons need no key. NOVA's live redeploy is controlled by its own Render service.
- **Verified:** 0 old-URL refs remain in source or rebuilt dist; typecheck clean; new URL HTTP 200.
