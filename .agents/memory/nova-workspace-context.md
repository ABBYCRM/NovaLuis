---
name: Nova workspace context & AI awareness
description: How workspace files reach the AI in the Nova chat UI, and why AI awareness must live in the system prompt
---

Nova workspace files are stored client-side in IndexedDB (`bob-workspaces` DB, `files` store, keyPath `id` autoincrement, `workspace` index; record `{workspace,name,mimeType,size,blob,createdAt,updatedAt}`). The compiled `bob.js` builds a `[Workspace context]` block per chat turn: it ALWAYS lists a filename inventory, but only inlines a file's text (mimeType `text/*`, capped 1500 chars) when the user's message literally contains the workspace id or normalized label.

**Rule:** to make Nova reliably *use* reference content for a subject, put it in the system prompt (set in `artifacts/nova/index.html`, gated by `PROMPT_VERSION`), NOT only as a seeded workspace file.
**Why:** the inline-on-mention heuristic misses domain phrasing (e.g. "life path number", "SATS", "entanglement" don't contain the workspace name), so workspace-file content alone won't be attached for many on-topic questions.
**How to apply:** seed workspace files for user-viewable/editable copies via an idempotent inline script in index.html (never hand-edit compiled bob.js); duplicate the must-always-know content into the system prompt and bump PROMPT_VERSION to push it to existing users.
