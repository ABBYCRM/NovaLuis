---
name: nova-services
description: Access NOVA's connected apps through Composio, mission-aware vector memory, Gmail, Google Drive, Docs, Sheets, YouTube, Instagram, knowledge, scratchpad, and repository skills through authenticated loopback APIs.
metadata: {"openclaw":{"emoji":"🔌","requires":{"bins":["node"],"env":["NOVA_INTERNAL_API_BASE"]}}}
---

# NOVA Services

Use this skill whenever a mission needs prior runtime memory, an external app, GitHub repository, connected account, or capability exposed by the NOVA backend. The helper returns structured JSON and exits nonzero on failed or unauthorized requests.

Run commands with:

```bash
node {baseDir}/nova-services.mjs <command> [options]
```

## Mandatory mission memory protocol

For non-trivial missions, use the runtime memory as part of the execution loop rather than treating it as a passive document database.

1. Before planning or acting, run `vector-search` with the exact current goal and the current phase.
2. Inspect verification labels literally. `verified` and `observed` evidence outrank `claimed` model text. Never convert a claim into verified evidence without a real check.
3. During correction, search failure memory before repeating an equivalent failed action.
4. Persist high-value observations, failures, decisions, procedures, and evidence with `vector-ingest`. Do not save hidden reasoning, speculative chain-of-thought, or repetitive summaries.
5. After retrieved memories materially contribute to an outcome, call `vector-feedback` with the returned memory ids and the real success/failure result.

```bash
node {baseDir}/nova-services.mjs vector-status
node {baseDir}/nova-services.mjs vector-search --query 'exact mission or current problem' --phase PLAN --intent plan --limit 8 --mission-id <run-id>
node {baseDir}/nova-services.mjs vector-search --query 'current failure and exact error' --phase CORRECT --intent debug --types failure,evidence,code,tool --limit 10 --mission-id <run-id>
node {baseDir}/nova-services.mjs vector-ingest --type failure --scope mission --mission-id <run-id> --verification observed --importance 0.9 --content 'Observed command, error, environment, and failed result'
node {baseDir}/nova-services.mjs vector-ingest --type evidence --scope mission --mission-id <run-id> --verification verified --importance 1 --content 'Exact verification command and observed result'
node {baseDir}/nova-services.mjs vector-feedback --ids 12,19,22 --successful true
```

Use `verified` only for evidence established by an actual test, command, API response, build, deployment check, browser check, or other directly observed proof. A model response, plan, or assertion is `claimed` or at most `inferred`.

## Mandatory capability discovery

Before saying GitHub or another app is unavailable, inspect the real bridge:

```bash
node {baseDir}/nova-services.mjs status
node {baseDir}/nova-services.mjs composio-status
node {baseDir}/nova-services.mjs composio-connections
node {baseDir}/nova-services.mjs composio-apps --search github --limit 10
```

If Composio reports the toolkit is not connected, generate the real hosted connection link:

```bash
node {baseDir}/nova-services.mjs composio-connect --toolkit github
```

Return the `redirectUrl` to the operator and explain that execution can continue after connection. Never replace this check with a generic denial.

## Composio tool discovery and execution

Composio provides the dynamic app tool layer. Search by the user's intended action, inspect returned tool slugs and schemas, then execute the selected tool with exact arguments.

```bash
node {baseDir}/nova-services.mjs composio-search --query 'Read the default branch and important files in a GitHub repository without modifying it'
node {baseDir}/nova-services.mjs composio-execute --tool GITHUB_TOOL_SLUG --arguments-json '{"owner":"ABBYCRM","repo":"NovaLuis"}'
```

Use `--account <connected-account-id-or-alias>` when Composio reports multiple accounts.

### GitHub repository protocol

For any GitHub repository URL:

1. Run `composio-status` and `composio-connections`.
2. Run `github-repo --url <repository-url>` or a precise `composio-search` query.
3. Read the returned `primary_tool_slugs`, execution guidance, schemas, and connection status.
4. Execute the minimum read-only GitHub tools required to obtain repository metadata, default branch, tree, important source/config/docs, recent commits, issues, and pull requests.
5. Inspect actual results and report evidence. Do not say the repository is inaccessible unless a real bridge call failed or GitHub is not connected.

Convenience search:

```bash
node {baseDir}/nova-services.mjs github-repo --url https://github.com/ABBYCRM/NovaLuis
```

## Native NOVA connected services

```bash
node {baseDir}/nova-services.mjs integrations
node {baseDir}/nova-services.mjs gmail --max 10 --query 'is:unread newer_than:7d'
node {baseDir}/nova-services.mjs drive --query "name contains 'report'"
node {baseDir}/nova-services.mjs docs --id <google-document-id>
node {baseDir}/nova-services.mjs sheets --id <spreadsheet-id> --range 'Sheet1!A1:Z100'
node {baseDir}/nova-services.mjs youtube --query 'search terms'
node {baseDir}/nova-services.mjs instagram
```

## NOVA knowledge and skill catalog

The legacy `knowledge-*` commands remain available for document/SOP retrieval. Use `vector-*` for agentic runtime memory because it preserves memory type, scope, mission, verification, temporal validity, and utility feedback.

```bash
node {baseDir}/nova-services.mjs skills
node {baseDir}/nova-services.mjs skills --name <skill-name>
node {baseDir}/nova-services.mjs scratchpad
node {baseDir}/nova-services.mjs knowledge-search --query 'what to retrieve' --limit 5
node {baseDir}/nova-services.mjs knowledge-ingest --source openclaw --title 'Title' --content 'Text to store'
node {baseDir}/nova-services.mjs knowledge-ingest --source openclaw --title 'Title' --file ./path/to/file.md --external-id optional-id
```

## Image generation (Gemini)

Generate images from text prompts using Google Gemini. Returns one or more image URLs served from the NOVA API.

```bash
# Standard image generation (Gemini 2.0 Flash)
node {baseDir}/nova-services.mjs image-generate --prompt 'A sunset over the ocean, golden hour, cinematic'

# Multiple images
node {baseDir}/nova-services.mjs image-generate --prompt 'Portrait of a futuristic city' --count 2

# Higher quality with Imagen 3
node {baseDir}/nova-services.mjs image-generate --prompt 'Hyper-realistic product photo of sneakers' --model imagen3

# Different aspect ratios: 1:1 (default), 16:9, 9:16, 4:3, 3:4
node {baseDir}/nova-services.mjs image-generate --prompt 'Wide landscape' --aspect-ratio 16:9
```

Response includes `images[].url` — share this URL directly with Robert in markdown: `![description](url)`.

## Video generation (A2E AI)

A2E provides AI avatar videos (avatar speaks a script) and image-to-video animation. Video tasks are async — start the task, then poll status until `completed`.

```bash
# AI avatar video: text script → speaking avatar video
node {baseDir}/nova-services.mjs video-avatar --script 'Hello Robert, here is your daily briefing...'
node {baseDir}/nova-services.mjs video-avatar --script 'Your report is ready.' --quality ultra

# Image to video: animate a still image (async task)
node {baseDir}/nova-services.mjs video-from-image --image-url 'https://example.com/photo.jpg' --prompt 'slow zoom in' --duration 5

# Poll status of an async video task (returns videoUrl when completed)
node {baseDir}/nova-services.mjs video-status --id '<task-id-from-start>'

# List all video tasks
node {baseDir}/nova-services.mjs video-list
```

**Workflow for image-to-video:**
1. Call `video-from-image` → get back a task `_id`
2. Call `video-status --id <_id>` every 10-15 seconds
3. When `status === "completed"`, share the `videoUrl` with Robert

## Workspace file store (read and write)

Robert's eight personal workspaces (and six esoteric workspaces) are persisted server-side so you can read and write files directly. Valid workspace slugs: `medical`, `health`, `dietary`, `fitness`, `todo`, `tasks`, `agents`, `pictures`, `numerology`, `sacred`, `vedic`, `mystic`, `manifest`, `quantum`.

```bash
# List all workspaces and their file counts
node {baseDir}/nova-services.mjs workspace-list

# List all files (with content) in a specific workspace
node {baseDir}/nova-services.mjs workspace-list --workspace tasks

# Read a single file
node {baseDir}/nova-services.mjs workspace-read --workspace tasks --filename 'my-list.md'

# Write or update a file (creates if it doesn't exist, updates if it does)
node {baseDir}/nova-services.mjs workspace-write --workspace tasks --filename 'my-list.md' --content 'Buy groceries\nCall doctor'

# Write from a local file
node {baseDir}/nova-services.mjs workspace-write --workspace health --filename 'vitals.md' --file ./output.md

# Delete a file
node {baseDir}/nova-services.mjs workspace-delete --workspace todo --filename 'done.md'
```

```bash
# View / analyze an image in a workspace (screenshots, photos)
# Returns extracted text, URLs, and any other visible content via GPT-4o vision.
node {baseDir}/nova-services.mjs workspace-view-image --workspace pictures --filename 'screenshot.png'

# With a custom extraction prompt
node {baseDir}/nova-services.mjs workspace-view-image --workspace pictures --filename 'screenshot.png' \
  --prompt 'List every GitHub repository URL visible in this image'
```

**When to use workspace tools:**
- Robert asks you to save, update, remember, or create a note/list/file in a workspace → use `workspace-write`
- Robert asks what's in a workspace → use `workspace-list --workspace <slug>`
- Robert asks to update or append to an existing file → `workspace-read` first, merge, then `workspace-write`
- Robert asks to delete a workspace file → use `workspace-delete`
- **Robert references screenshots, photos, or images in a workspace (especially `pictures`)** → ALWAYS use `workspace-view-image`, never `workspace-read`. Images are stored as base64 — you cannot read them as text. `workspace-view-image` calls GPT-4o vision and returns the extracted text, URLs, or whatever is visible in the image.

**Pictures workspace workflow — step by step:**
1. `workspace-list --workspace pictures` → see what files are stored
2. For each image file: `workspace-view-image --workspace pictures --filename '<name>'` → extract content
3. Act on the extracted information (URLs, text, etc.)

Do NOT call `workspace-read` on image files (contentType starting with `image/`) — you will receive raw base64 that is useless to you. Always use `workspace-view-image` for images.

Files written here are immediately visible in Robert's UI (the client merges server files with local files on next workspace open).

## Social Media Posting

Three commands for the full generate→publish pipeline. Image generation uses **Bitdeer `google/flash-image-2.5`** as primary (fast, returns public URL), Gemini as fallback.

### `social-post` — full pipeline (generate + save + optionally publish)

```bash
# Generate + publish immediately to Instagram Reel
node {baseDir}/nova-services.mjs social-post \
  --platform instagram --content-type reel \
  --description "morning routine tips for busy founders" \
  --tone motivational --post-now

# Generate + schedule for a specific time
node {baseDir}/nova-services.mjs social-post \
  --platform twitter --content-type post \
  --description "new product launch announcement" \
  --tone bold --schedule-at "2026-07-18T14:00:00Z"

# Provide your own caption, skip image gen
node {baseDir}/nova-services.mjs social-post \
  --platform linkedin --content-type post \
  --description "thought leadership piece" \
  --caption "The best leaders do X..." --no-image --post-now
```

**Flags:**
- `--platform` — instagram | twitter | facebook | linkedin | tiktok | youtube
- `--content-type` — post | reel | story | portrait | landscape | video | shorts | thumbnail | square
- `--description` — what the post is about (REQUIRED — drives both caption and image gen)
- `--tone` — motivational | inspirational | educational | funny | bold | sarcastic | optimistic | professional
- `--post-now` — publish immediately via Composio after generating
- `--schedule-at` — ISO datetime to auto-publish at that time
- `--no-image` — skip image generation (text-only post)
- `--caption` — use your own caption instead of AI-generated
- `--hashtags` — use your own hashtags

Returns: `{ postId, status, generated: { caption, hashtags, imageUrl, imageSource }, composioResult }`

### `social-publish` — publish a saved post by ID

```bash
node {baseDir}/nova-services.mjs social-publish --id 42
```

### `social-debug` — diagnostics (Composio status + last 5 posts + image gen config)

```bash
node {baseDir}/nova-services.mjs social-debug
```

**ALWAYS run `social-debug` first if a post fails** — it shows whether Composio is connected, the actual error from the last attempt, and which image gen models are configured.

### Instagram two-step flow
Instagram posting is automatically handled as a two-step process:
1. Create media container (`INSTAGRAM_CREATE_PHOTO_MEDIA_CONTAINER` / `INSTAGRAM_CREATE_REELS_MEDIA_CONTAINER`)
2. Publish container (`INSTAGRAM_PUBLISH_MEDIA_CONTAINER`)

The image **must be a public URL** — data URLs are not accepted by Instagram's API. Bitdeer-generated images return public URLs. If generation falls back to Gemini (which returns base64 data URLs), the image won't be included in the Instagram post.

### Composio connection check
Before posting, verify Instagram (or the target platform) is connected:
```bash
node {baseDir}/nova-services.mjs composio-status
```
If not connected, use `composio-connect --toolkit instagram` and return the Connect Link to Robert.

## Execution rules

1. Inspect the returned `ok` field and actual payload before using a result.
2. Never fabricate service data, tool availability, repository contents, memory evidence, or success.
3. Search mission memory before a non-trivial plan and search failure memory before repeating a failed action.
4. Search for the correct Composio tool before executing. Do not guess tool slugs or arguments.
5. Prefer read-only tools for inspection and analysis. Perform writes only when the operator requested the external change.
6. If a connection is missing, call `composio-connect` and return the real Connect Link.
7. Do not print or inspect environment variables. Authentication is injected at runtime and must remain secret.
8. Cite concrete repository names, file paths, SHAs, memory ids, timestamps, counts, tool slugs, log IDs, test outputs, or API errors in the final verification report.
