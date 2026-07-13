---
name: "GLOBAL_STATE scratchpad stripper invariants"
description: "Prevent Nova's client-side signature stripper from leaking genuine trailing state or deleting legitimate reply content."
---

# Nova Chat Signature Stripper Invariants

## Scope

The stripper operates only on rendered assistant transcript content:

```text
.msg-row.bot .md-content
```

It must never scan or mutate:

```text
#scratchpad-list
.scratchpad-list
#settings-modal
textareas
input fields
```

## Core rule

Remove only a trailing signature region that contains an explicit line-start opener.

Recognized opener forms include:

```text
[scratchpad]
scratchpad:
scratchpad
GLOBAL_STATE
GLOBAL_STATE:
GLOBAL_STATE =
GLOBAL_STATE {
GLOBAL_STATE (
GLOBAL_STATE <
```

Every marker must begin at the start of the message or immediately after a newline.

```regex
(^|\n)
```

Mid-line prose must remain visible:

```text
Use GLOBAL_STATE = { ... } in the configuration.
The [scratchpad] token is reserved.
```

## Bare marker behavior

A bare `GLOBAL_STATE` line is valid even when state lines follow it.

```regex
(^|\n)[ \t]*GLOBAL_STATE[ \t]*(?=\n|$)
```

Use `(?=\n|$)`, not end-of-message matching only.

Normalize `<br>` elements to newline boundaries before marker detection. Do not collapse all whitespace into spaces.

## Trailing-region gate

```text
TRAILING STRUCTURED CONTENT
+
NO EXPLICIT OPENER
=
PRESERVE
```

Lists, JSON, code blocks, and key-value lines are removable only after an explicit opener has been found in the same trailing region.

A marker example in the middle of an answer must remain when normal content follows it.

## Required tests

Test file:

```text
artifacts/nova/test/global-state.test.ts
```

Required cases:

- genuine trailing `[scratchpad]` is removed
- genuine trailing bare `GLOBAL_STATE` is removed
- `<br>`-separated signatures are removed
- mid-line `GLOBAL_STATE` prose is preserved
- mid-line `[scratchpad]` prose is preserved
- trailing JSON without an opener is preserved
- non-trailing examples are preserved
- settings and scratchpad UI are untouched
- multiple assistant bubbles are isolated

Release gate:

```bash
pnpm --filter @workspace/nova run test
```

## Final invariant

```text
EXPLICIT LINE-START OPENER
+
TRAILING SIGNATURE REGION
=
REMOVE

NO OPENER OR MID-LINE MENTION
=
PRESERVE
```
