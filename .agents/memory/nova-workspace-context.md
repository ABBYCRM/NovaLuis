---
name: "Nova workspace context and AI awareness"
description: "How Nova stores workspace files, conditionally attaches their text, and versions system-prompt knowledge that must always reach the model."
---

# Nova Workspace Context and AI Awareness

## Storage

Nova workspace files are stored client-side in IndexedDB:

```text
database: bob-workspaces
store: files
keyPath: id
autoIncrement: true
index: workspace
```

Expected record:

```ts
interface WorkspaceFile {
  id?: number;
  workspace: string;
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
  createdAt: string;
  updatedAt: string;
}
```

These files are local browser data unless a separate synchronization mechanism is implemented.

## Context behavior

For each chat turn, the compiled client builds a `[Workspace context]` block.

The active workspace filename inventory is always listed. File text is attached only when:

- the file belongs to the active workspace
- `mimeType` begins with `text/`
- the user's message literally matches the workspace ID or normalized label
- extraction succeeds

Text excerpts are capped at 1,500 characters per file under the current behavior.

```text
FILE LISTED
≠
FILE CONTENT ATTACHED
```

The current rule is literal matching, not semantic retrieval. Domain phrases such as `SATS`, `life path number`, or `entanglement` may be relevant without matching the workspace name.

## System-prompt rule

Content Nova must reliably know must live in the versioned system prompt in:

```text
artifacts/nova/index.html
```

Use workspace files for user-viewable or editable reference copies. Important content may intentionally exist in both places:

```text
SYSTEM PROMPT
→ always-supplied runtime awareness

WORKSPACE FILE
→ user-visible reference and conditional attachment
```

Do not hand-edit compiled `bob.js`.

## Prompt versioning

Any system-prompt change that must reach existing users requires a `PROMPT_VERSION` increment.

```text
modify prompt
→ bump PROMPT_VERSION
→ test migration
→ build
→ deploy
```

Prompt migration must preserve unrelated user data and settings.

## File seeding

Seed default workspace files through an idempotent script in `artifacts/nova/index.html`.

A managed seed needs a stable identity and version. Running the seed repeatedly must not create duplicates or overwrite unrelated user-created files.

If a managed file was edited by the user, preserve it unless an explicit replacement policy exists.

## Required tests

- filename inventory is always present for the active workspace
- matching workspace ID attaches eligible text
- matching normalized label attaches eligible text
- domain-only phrasing does not falsely claim attachment
- non-text files remain inventory-only
- excerpts are capped and marked as truncated
- seeding is idempotent
- prompt-version migration updates old versions once
- current versions are not reset
- user-created and user-edited files are preserved

## Final invariant

```text
INVENTORY
=
ALWAYS LISTED

FILE TEXT
=
CONDITIONAL UNDER CURRENT MATCH RULE

MUST-ALWAYS-KNOW
=
VERSIONED SYSTEM PROMPT

COMPILED bob.js
=
DO NOT HAND-EDIT
```
