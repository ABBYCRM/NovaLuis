---
name: novaluis-runtime-operator
description: Repository-specific operating contract for safely modifying, testing, deploying, and recovering ABBYCRM/NovaLuis without breaking mobile UI, PWA, chat, durable workers, or social publishing.
metadata: {"openclaw":{"emoji":"🟠","requires":{"bins":["node"],"env":["NOVA_INTERNAL_API_BASE"]}}}
---
<!-- tags: novaluis, runtime, mobile, pwa, social, openclaw, digitalocean -->

# NovaLuis Runtime Operator

Use for every task targeting `ABBYCRM/NovaLuis`. Combine with `evidence-first-execution`, `polyglot-software-engineering`, `github-connected-operations`, and `durable-runtime-engineering`.

## Runtime map

The production UI is the handwritten `artifacts/nova/index.html`, not the React scaffold. Production assets live in `artifacts/nova/public`.

The production container:

- builds `artifacts/api-server`;
- copies `artifacts/nova/index.html` to `/app/nova-static/index.html`;
- copies `artifacts/nova/public` to `/app/nova-static`;
- starts `scripts/start-openclaw.mjs`;
- launches the OpenClaw gateway, NOVA API, work-tree worker, and social-media worker.

Key files:

- `Dockerfile` — runtime image, public origin, worker enablement, static assets.
- `scripts/start-openclaw.mjs` — process supervision and shared runtime environment.
- `artifacts/api-server/src/app.ts` — API boundary, hardened Instagram publisher, static UI injection.
- `artifacts/api-server/src/index.ts` — schema bootstrap and embedded cron startup.
- `artifacts/nova/index.html` — chat, history, settings, social UI, PWA metadata/registration.
- `artifacts/nova/public/manifest.webmanifest` and `sw.js` — installable PWA.
- `artifacts/nova/public/assets/ui-preservation.css` — additive mobile styling fixes.
- `artifacts/nova/public/assets/ui-navigation-preservation.js` — mobile chat navigation and runtime-module loader.
- `artifacts/nova/public/assets/continuous-voice-input.js` — continuous microphone lifecycle.
- `artifacts/nova/public/assets/durable-run-reconcile.js` — background-run result restoration.
- `artifacts/api-server/src/routes/durable-agent-chat.ts` — durable main-chat task classification and queueing.
- `scripts/work-tree-worker.mjs` — database-backed autonomous execution.
- `artifacts/api-server/src/social-cron.ts` — scheduled/campaign publishing and recovery.
- `artifacts/api-server/src/routes/instagram-publish.ts` — durable public media and two-step Instagram publish.
- `openclaw/workspace/skills` — executable local skills.

## Hard preservation invariants

Never break or remove:

1. Mobile chat header, composer, hamburger sidebar, overlays, favorites, campaigns, and scheduled cards.
2. New Chat creating a new persisted conversation and returning to the chat screen.
3. Touch-visible and functional chat deletion.
4. PWA manifest, icons, standalone display, service-worker registration, cache invalidation, and installability.
5. Microphone listening until the user deliberately stops it, including recognition auto-restart.
6. Chat history persistence and restoration.
7. Durable repository/debug missions continuing after tab/app closure.
8. Work-tree database status, worker ownership, restart recovery, cancellation, and result reconciliation.
9. Instagram publishing through a durable public HTTPS media URL and verified platform media ID.
10. Embedded and sibling social workers running without overlapping duplicate publication.
11. Existing workspace, Composio, GitHub, memory, settings, and OpenClaw routes.

## Prohibited regressions

Do not:

- load or restore stale `bob.js` behavior that overrides inline handlers;
- replace the production UI with an unrelated framework scaffold;
- add competing click/send/history handlers without proving event ordering;
- abort durable work when the browser request closes;
- use `data:`, loopback, private, or authenticated URLs as Instagram media;
- schedule image-only Instagram Reels without a real public video pipeline;
- mark a post published without a returned media/post ID;
- reschedule recurring social content after a failed publish;
- disable Chromium tests or hide failures behind skipped checks;
- modify `AI_NOTES.md` from a partial read;
- add secrets to source, workflow files, logs, or reports;
- report a deployment live without provider state and functional probes.

## Change protocol

1. Resolve latest `main` SHA and active deployment revision.
2. Read complete affected files and callers.
3. Reproduce the issue or add a failing focused test.
4. Make the smallest additive correction.
5. Inspect every patch and cumulative diff.
6. Run complete type, build, API, browser, worker, and deployment checks relevant to the change.
7. Keep unrelated skill, UI, API, and infrastructure changes out of the mission unless explicitly requested.

When direct-to-main work is authorized, keep each commit reversible and never stack unverified changes after a red head.

## Mobile and PWA verification

Required mobile viewport: at minimum `390×844`; also inspect `360px` width when clipping is possible.

Verify:

- no horizontal overflow;
- composer and buttons remain reachable with virtual keyboard behavior considered;
- sidebar opens/closes correctly;
- New Chat changes the persisted chat ID and focuses `#user-input`;
- history deletion changes local storage and list count;
- favorites Save button is visible and touch-sized;
- social campaign controls retain NOVA visual language;
- scheduled images fill their cards;
- manifest link, Apple touch icon, service worker, scope `/`, start URL `/`, standalone display, and icons are served correctly;
- installed/reopened PWA receives current cache-busted assets.

## Voice verification

Use a browser test with a controllable SpeechRecognition implementation. Prove:

- `continuous=true` and interim results are enabled;
- the listening state remains active;
- an `onend` event restarts recognition while requested;
- tapping the mic stops and prevents restart;
- existing text is preserved and new transcript is appended;
- unsupported-browser behavior remains understandable.

## Durable-agent verification

Repository URLs plus execution verbs, explicit background requests, and end-to-end debug/deploy missions must queue into `work_tree_runs` and return a run ID.

Prove:

- HTTP/client disconnect does not cancel execution;
- production worker is the sole owner when enabled;
- mission survives process restart;
- stale timeout does not kill legitimate long work;
- `/api/work-tree/runs/:id` returns progress and terminal result;
- reopened chat replaces `[NOVA_RUN_ID:<id>]` with the final report;
- cancellation and failure remain distinct terminal states.

## Social publishing verification

Before publishing Instagram:

- Composio connection and IG business user ID resolve;
- generated image exists;
- `PUBLIC_BASE_URL` is the production HTTPS origin;
- media is persisted behind `/api/social/assets/:filename`;
- public asset route returns correct image bytes without authentication;
- container creation returns a creation ID;
- publish step returns a media ID;
- database status, result, error, and timestamps reconcile correctly.

Check `/api/social/cron/status` for worker state and last tick. Test failed campaign recovery and duplicate-lock behavior.

## Required checks

Run the repository’s pinned toolchain:

```bash
pnpm install --frozen-lockfile --shamefully-hoist
pnpm run typecheck
pnpm run build:api
pnpm --filter @workspace/nova exec vitest run test/api-e2e.test.ts --reporter=verbose
pnpm --filter @workspace/nova exec vitest run test/chat-ui-smoke.test.ts test/ui-preservation.test.ts test/runtime-durability-contract.test.ts test/runtime-durability-browser.test.ts --reporter=verbose
```

For production changes also build the Docker image, deploy the exact head through `.github/workflows/deploy-digitalocean.yml`, wait for `digitalocean/deploy=success`, and probe health, OpenClaw, social cron, PWA assets, and changed feature paths.

## Deployment target

Canonical production origin:

`https://nova-luis-8hjvt.ondigitalocean.app`

The source SHA, workflow SHA, DigitalOcean deployment, and live revision must be distinguished. A successful build is not a successful live deployment.

## Final audit

Before `GO`, confirm exact-head green checks, live probes, intended file inventory, no secrets, no dead/duplicate assets, no UI regression, no PWA regression, no worker race, and no unverified social publication claim.
