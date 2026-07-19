# NOVA UI Preservation Contract

**Created:** 2026-07-19 12:11 AM ET  
**Author:** ChatGPT  
**Scope:** `ABBYCRM/NovaLuis` production mobile UI and its supporting runtime contracts

> **Read this before MiniMax, Codex, ChatGPT, or any other agent changes the Nova frontend.**
>
> The operator-provided Android screenshots from 2026-07-19 are the visual baseline. The goal is preservation and surgical repair, not redesign.

## 1. Immutable visual baseline

Preserve the established NOVA presentation:

- near-black ember/constellation background;
- orange-to-pink gradient primary actions;
- slide-out mobile sidebar with Recent, Workspaces, Favorites, Social Media, and Settings;
- compact top header with hamburger, NOVA, status, Copy, and Download;
- bottom composer with Attach, Mic, text field, TTS, Stop/Send;
- full-height mobile Favorites panel;
- full-height rounded Social Media sheet with horizontal platform strip;
- Create, Scheduled, and Campaigns tabs;
- existing workspace names, order, icons, and `+` upload controls;
- current typography, spacing, dark surfaces, borders, and orange active states.

Do not use a broad "modernization," component-library migration, visual refresh, or generated replacement UI as a substitute for fixing an isolated defect.

## 2. Production runtime map

The production frontend is **not** the unused React source tree. The active path is:

```text
Dockerfile
  -> copies artifacts/nova/index.html to /app/nova-static/index.html
  -> copies artifacts/nova/public/* to /app/nova-static/*

scripts/start-openclaw.mjs
  -> starts OpenClaw Gateway
  -> starts artifacts/api-server/dist/index.mjs
  -> starts work-tree and social-media workers

artifacts/api-server/src/app.ts
  -> mounts API routers
  -> serves NOVA_STATIC_DIR in production
  -> injects the cache-busted ui-preservation.css stylesheet

artifacts/nova/index.html
  -> authoritative DOM, inline CSS, and UI event handlers

artifacts/nova/public/assets/ui-preservation.css
  -> additive post-style fixes only
```

The backend/API contracts used by this UI include:

- Favorites: `artifacts/api-server/src/routes/favorites.ts`
- Social creation/scheduling: `artifacts/api-server/src/routes/social-media.ts`
- Hardened Instagram publishing: `artifacts/api-server/src/routes/instagram-publish.ts`
- Campaigns: `artifacts/api-server/src/routes/social-campaigns.ts`
- Workspaces: workspace routes and `workspace_files`
- Chat: `/api/v1/chat/completions` server reroute and `/api/agent/v1/chat/completions`
- PWA/cache stamping: `artifacts/api-server/src/app.ts` and `artifacts/nova/public/sw.js`

## 3. Historical regression — do not repeat

The previous failure came from a partial UI migration:

1. New UI behavior was added inline to `index.html`.
2. An older `bob.js` bundle still loaded later and overrode it.
3. The bundle was neutralized/deleted before every behavior it owned was inventoried.
4. Send, New Chat/history, thinking state, Attach, Mic, TTS, Copy, Download, and Settings behavior then had to be restored piecemeal.
5. Responsive CSS changed during the same unstable period.
6. Playwright was explicitly disabled in CI, so the mobile regression was not blocked.

**Rule:** never delete, stub, replace, or stop loading a frontend source until every DOM handler, storage key, fetch route, keyboard action, and side effect it owns is mapped and proven in a real browser.

## 4. Changes made by the 2026-07-19 final-fix PR

### Favorites mobile Save visibility

Problem: URL + Tags + Save were forced into one non-wrapping row, pushing Save outside a 360–390 px viewport.

Repair: `ui-preservation.css` keeps URL and Tags on the first row and gives Save a full-width second row. No element IDs, click handlers, API calls, or persistence behavior changed.

### Campaign control styling

Problem: Campaign voice/platform controls used `.sm-tone-chip`, but that class had almost no visual CSS, so controls rendered like raw white browser buttons.

Repair: `.sm-tone-chip` now follows the existing dark NOVA pill language and orange active state. Existing `data-voice`, checkbox, and click behavior remains unchanged.

### Scheduled post media compatibility

Problem: Drizzle returns camelCase fields such as `imageUrl` and `scheduledAt`, while the established renderer reads `image_url` and `scheduled_at`. Valid images therefore fell through to camera placeholders.

Repair:

- `lib/social-schedule-compat.ts` adds aliases in both directions without overwriting explicit values.
- `app.ts` applies that serializer only to the exact `GET /api/social/schedule` list response.
- New camelCase clients continue to work; the legacy renderer receives the fields it already expects.
- The mobile image element now fills its existing full-width thumbnail container instead of retaining the renderer's 52 px inline size.

### Touch access

Problem: history delete, message actions, and reference-image delete were hover-only.

Repair: existing controls are visible on coarse touch pointers. No action logic changed.

### Real browser gate

The Playwright workflow may no longer force an empty browser path. CI must locate hosted Chrome, run the existing chat smoke suite plus the UI preservation suite, and upload screenshots for Favorites, Campaigns, and Scheduled.

## 5. Hard prohibitions for future agents

Do **not**:

1. Replace `artifacts/nova/index.html` with the unused React scaffold without an explicit, separately approved migration plan.
2. Reintroduce `bob.js` or another bundle that owns duplicate handlers.
3. delete an inline script because it "looks duplicated" without tracing every listener and storage/fetch side effect.
4. rename these IDs/classes casually: `#sidebar`, `#hamburger`, `#fav-overlay`, `#sm-overlay`, `.sm-tab`, `.sm-post-card`, `#input-area`, `#user-input`, `#send-btn`.
5. change API response casing destructively. Add compatibility aliases or migrate all consumers atomically.
6. move UI fixes into route/publishing logic unless the defect is genuinely an API contract mismatch.
7. alter database schemas, Composio execution, Instagram publishing, workers, chat routing, or auth while repairing CSS.
8. hide missing capability with a stub, silent rewrite, placeholder success, or fake image.
9. disable/skip Chromium tests to make CI green.
10. claim mobile completion without browser screenshots and overflow/interaction assertions.
11. edit the entire giant `index.html` for a three-selector defect. Prefer an isolated post-style layer.
12. change the operator's visual baseline because a framework default looks cleaner.

## 6. Required verification before merge

Run and record:

```bash
pnpm install --frozen-lockfile --shamefully-hoist
pnpm run typecheck
pnpm run build:api
pnpm --filter @workspace/nova exec vitest run test/api-e2e.test.ts --reporter=verbose
pnpm --filter @workspace/nova exec vitest run \
  test/chat-ui-smoke.test.ts \
  test/ui-preservation.test.ts \
  --reporter=verbose
```

Browser acceptance criteria at 390 × 844:

- no page-level horizontal overflow;
- sidebar opens and closes;
- chat composer accepts text;
- Favorites URL and Tags remain on the first row;
- Favorites Save is fully visible and at least 44 px tall;
- Campaign controls are dark rounded pills, not default white controls;
- changing a Campaign voice still changes the active state;
- Scheduled camelCase media produces an actual `<img>`;
- Scheduled image fills the mobile card width;
- Social tabs still switch;
- screenshots are uploaded as `nova-mobile-ui-proof`.

## 7. Change boundaries and rollback

This repair is intentionally small:

- remove `ui-preservation.css` injection from `app.ts` to roll back visual overrides;
- remove the exact `/api/social/schedule` response middleware to roll back aliasing;
- no database migration or data rewrite is required;
- no existing API request payload changed;
- no existing UI handler was deleted or replaced.

## 8. Known non-goals

This PR does not redesign the UI, replace the handwritten frontend, change the visual baseline, modify Composio credentials, alter Instagram's two-step publisher, or rewrite mobile keyboard behavior without device evidence.

Future keyboard/VisualViewport work must be a separate measured change with Android and iOS browser proof.
