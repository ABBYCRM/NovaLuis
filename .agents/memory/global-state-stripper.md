---

name: "GLOBAL_STATE scratchpad stripper invariants"
description: >-
Design and regression rules for Nova's client-side signature stripper so it
removes genuine trailing GLOBAL_STATE or scratchpad signatures without
leaking fragments or deleting legitimate reply content.
-------------------------------------------------------

# Nova Chat Signature Stripper Invariants

## Scope

The client-side signature stripper is implemented in the inline `<script>` near the end of:

```text
artifacts/nova/index.html
```

Its responsibility is to remove the model’s trailing `GLOBAL_STATE` or scratchpad signature from the visible chat transcript while preserving the same state for:

* The sidebar graph
* Server-side memory
* Internal state processing

The stripper operates only on rendered assistant-message content.

It must not modify the underlying state pipeline or unrelated interface elements.

---

# Competing Failure Modes

## Leak

A genuine state or scratchpad signature remains visible inside an assistant chat bubble.

Examples:

```text
[scratchpad]
current_goal: inspect repository
```

```text
GLOBAL_STATE
status: running
```

```text
GLOBAL_STATE = {
  "status": "complete"
}
```

---

## Over-Strip

Legitimate answer content is removed because it merely mentions a marker-like term.

Examples that must remain visible:

```text
Use GLOBAL_STATE = { ... } in the configuration.
```

```text
The [scratchpad] token is reserved.
```

```text
Do not remove prose that mentions scratchpad.
```

```json
{
  "example": "GLOBAL_STATE"
}
```

The stripper must optimize for both:

```text
NO SIGNATURE LEAK
AND
NO LEGITIMATE CONTENT LOSS
```

---

# Core Invariant 1 — Removal Requires an Explicit Marker

Trailing block-region removal must be gated by an explicit signature opener.

The stripper may inspect a trailing run of candidate blocks, but it must remove that run only when at least one block contains a recognized marker.

Recognized openers include:

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

A trailing code block, list, JSON object, paragraph, or key-value region is not sufficient by itself.

Required rule:

```text
TRAILING STRUCTURED CONTENT
WITHOUT EXPLICIT SIGNATURE MARKER
=
PRESERVE
```

---

# Core Invariant 2 — Inline Markers Must Begin a Line

Every recognized marker form must be anchored to the beginning of a logical line.

Accepted position:

```text
start of message
OR
immediately after a newline
```

Required anchor:

```regex
(^|\n)
```

This applies to all marker forms, including:

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

Mid-line mentions must never trigger stripping.

Preserve:

```text
Use GLOBAL_STATE = { ... } for state storage.
```

Preserve:

```text
The [scratchpad] token appears in the prompt.
```

Preserve:

```text
This sentence discusses scratchpad: behavior.
```

---

# Core Invariant 3 — Bare `GLOBAL_STATE` Is a Valid Opener

A bare `GLOBAL_STATE` token on its own line is a valid signature marker even when additional state lines follow.

Correct lookahead:

```regex
(?=\n|$)
```

Do not require `GLOBAL_STATE` to be the final text in the entire message.

Correct:

```regex
(^|\n)[ \t]*GLOBAL_STATE[ \t]*(?=\n|$)
```

This must match:

```text
Assistant reply.

GLOBAL_STATE
status: complete
memory: updated
```

It must also catch content where browser rendering or Markdown conversion produces soft line breaks or `<br>`-fused multiline state blocks.

---

# Core Invariant 4 — Prose Is Never a Continuation Marker

A prose line that merely mentions `GLOBAL_STATE`, `scratchpad`, or `[scratchpad]` must not cause a trailing region to be classified as a signature.

Examples to preserve:

```text
The response may include GLOBAL_STATE examples.
```

```text
Use the [scratchpad] token only internally.
```

```text
This paragraph explains scratchpad behavior.
```

Candidate continuation blocks may be removed only after a recognized opener has already been found in the same trailing signature region.

Required state machine:

```text
NO OPENER FOUND
→ preserve all candidate blocks

EXPLICIT OPENER FOUND
→ allow removal of associated trailing signature blocks
```

---

# Core Invariant 5 — Process Only the Trailing Signature Region

The stripper must inspect only the trailing region of the assistant message.

It must not remove matching text from the middle of a legitimate reply.

Example to preserve:

```text
The application uses the following syntax:

GLOBAL_STATE = {
  "status": "example"
}

The next section explains deployment.
```

Because normal reply content follows the example, this is not a trailing signature.

Required rule:

```text
SIGNATURE REMOVAL
=
TRAILING REGION ONLY
```

---

# Core Invariant 6 — Preserve Unrelated UI Elements

The stripper must never modify or scan these elements:

```text
#scratchpad-list
.scratchpad-list
#settings-modal
```

These interface areas legitimately display scratchpad-related text.

They include:

* Settings → Scratch pad panel
* Scratchpad history or list elements
* System-prompt textareas
* Configuration content
* Administrative state views

The stripper must be scoped to assistant transcript bubbles only.

Expected selector boundary:

```text
.msg-row.bot .md-content
```

Do not run the stripping logic against:

```text
document.body
all .md-content elements
settings content
sidebar scratchpad content
textareas
input fields
```

---

# Marker Detection Contract

Use explicit, line-anchored marker detection.

```js
const SIGNATURE_START_PATTERNS = [
  /(^|\n)[ \t]*\[scratchpad\][ \t]*(?=\n|$)/i,
  /(^|\n)[ \t]*scratchpad[ \t]*:[ \t]*(?=\n|$)/i,
  /(^|\n)[ \t]*scratchpad[ \t]*(?=\n|$)/i,
  /(^|\n)[ \t]*GLOBAL_STATE[ \t]*(?=\n|$)/,
  /(^|\n)[ \t]*GLOBAL_STATE[ \t]*[:=({<][^\n]*/,
];
```

Do not use unanchored patterns such as:

```js
/GLOBAL_STATE/
/\[scratchpad\]/i
/scratchpad:/i
```

Those expressions match legitimate prose.

---

# Region Detection Contract

The implementation should:

1. Locate the assistant bubble.
2. Identify its trailing candidate blocks.
3. Walk backward through the trailing region.
4. Determine whether the region contains an explicit opener.
5. Preserve the entire region when no opener exists.
6. Remove only the confirmed signature region when an opener exists.
7. Leave all earlier reply content unchanged.

Pseudocode:

```js
function stripTrailingSignature(messageRoot) {
  const blocks = getVisibleContentBlocks(messageRoot);
  const trailingRegion = collectTrailingCandidateBlocks(blocks);

  if (trailingRegion.length === 0) {
    return {
      stripped: false,
      reason: "NO_TRAILING_REGION",
    };
  }

  const containsExplicitOpener = trailingRegion.some((block) =>
    isSignatureStart(block.textContent ?? ""),
  );

  if (!containsExplicitOpener) {
    return {
      stripped: false,
      reason: "NO_EXPLICIT_OPENER",
    };
  }

  for (const block of trailingRegion) {
    block.remove();
  }

  return {
    stripped: true,
    reason: "CONFIRMED_TRAILING_SIGNATURE",
  };
}
```

---

# Candidate Block Rule

A block may be considered part of a trailing signature region when it is structurally compatible with state output, including:

* Marker lines
* Key-value lines
* JSON-like state
* Lists following a marker
* Code blocks following a marker
* `<br>`-separated state lines
* Short structured paragraphs following a marker

However:

```text
CANDIDATE BLOCK
≠
REMOVABLE BLOCK
```

Removal still requires an explicit opener in the same trailing region.

---

# DOM Normalization

Marker detection must account for browser-rendered line boundaries.

Normalize:

```html
<br>
```

to:

```text
\n
```

before applying line-anchored detection.

Example:

```js
function normalizedText(element) {
  const clone = element.cloneNode(true);

  clone.querySelectorAll("br").forEach((br) => {
    br.replaceWith("\n");
  });

  return (clone.textContent ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ");
}
```

Do not flatten all whitespace into single spaces before marker detection because doing so destroys line boundaries.

---

# Required Regression Tests

Tests are located at:

```text
artifacts/nova/test/global-state.test.ts
```

The suite must cover all of the following.

## Genuine signatures removed

```text
[scratchpad]
key: value
```

```text
scratchpad:
key: value
```

```text
scratchpad
key: value
```

```text
GLOBAL_STATE
key: value
```

```text
GLOBAL_STATE:
key: value
```

```text
GLOBAL_STATE = {
  "key": "value"
}
```

```text
GLOBAL_STATE {
  "key": "value"
}
```

---

## Mid-line prose preserved

```text
Use GLOBAL_STATE = { ... } in the configuration.
```

```text
The [scratchpad] token must remain internal.
```

```text
This paragraph discusses scratchpad: handling.
```

---

## Trailing non-signature content preserved

```json
{
  "status": "complete",
  "result": "success"
}
```

```text
- First item
- Second item
```

```text
status: complete
result: success
```

No explicit opener means no removal.

---

## Non-trailing marker examples preserved

```text
Here is an example:

GLOBAL_STATE = {
  "status": "sample"
}

Now continue with the actual explanation.
```

---

## Bare marker followed by state removed

```text
Normal reply.

GLOBAL_STATE
status: complete
```

---

## Soft-break rendering removed

Equivalent DOM:

```html
<p>
  GLOBAL_STATE<br>
  status: complete<br>
  memory: updated
</p>
```

---

## Protected interface elements untouched

Verify no mutation of:

```text
#scratchpad-list
.scratchpad-list
#settings-modal
```

---

## Multiple bot messages isolated

Removing the signature from one assistant bubble must not modify:

* Earlier assistant bubbles
* Later assistant bubbles
* User messages
* Sidebar content
* Settings content

---

# Example jsdom Tests

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

import {
  stripGlobalStateFromBubble,
} from "../src/global-state-stripper";

function createDom(html: string): Document {
  return new JSDOM(`
    <body>
      ${html}
    </body>
  `).window.document;
}

describe("GLOBAL_STATE signature stripper", () => {
  it("removes a bare GLOBAL_STATE trailing signature", () => {
    const document = createDom(`
      <div class="msg-row bot">
        <div class="md-content">
          <p>Completed successfully.</p>
          <p>GLOBAL_STATE<br>status: complete</p>
        </div>
      </div>
    `);

    const bubble = document.querySelector(
      ".msg-row.bot .md-content",
    ) as HTMLElement;

    stripGlobalStateFromBubble(bubble);

    expect(bubble.textContent).toContain(
      "Completed successfully.",
    );

    expect(bubble.textContent).not.toContain(
      "GLOBAL_STATE",
    );
  });

  it("preserves a mid-line GLOBAL_STATE example", () => {
    const document = createDom(`
      <div class="msg-row bot">
        <div class="md-content">
          <p>Use GLOBAL_STATE = { ... } in the configuration.</p>
        </div>
      </div>
    `);

    const bubble = document.querySelector(
      ".msg-row.bot .md-content",
    ) as HTMLElement;

    stripGlobalStateFromBubble(bubble);

    expect(bubble.textContent).toContain(
      "Use GLOBAL_STATE = { ... } in the configuration.",
    );
  });

  it("preserves a mid-line scratchpad mention", () => {
    const document = createDom(`
      <div class="msg-row bot">
        <div class="md-content">
          <p>The [scratchpad] token is reserved.</p>
        </div>
      </div>
    `);

    const bubble = document.querySelector(
      ".msg-row.bot .md-content",
    ) as HTMLElement;

    stripGlobalStateFromBubble(bubble);

    expect(bubble.textContent).toContain(
      "The [scratchpad] token is reserved.",
    );
  });

  it("preserves trailing JSON without an opener", () => {
    const document = createDom(`
      <div class="msg-row bot">
        <div class="md-content">
          <p>Result:</p>
          <pre>{
  "status": "complete"
}</pre>
        </div>
      </div>
    `);

    const bubble = document.querySelector(
      ".msg-row.bot .md-content",
    ) as HTMLElement;

    stripGlobalStateFromBubble(bubble);

    expect(bubble.textContent).toContain(
      '"status": "complete"',
    );
  });

  it("does not modify scratchpad settings elements", () => {
    const document = createDom(`
      <div id="settings-modal">
        <div id="scratchpad-list">
          GLOBAL_STATE
          status: retained
        </div>
      </div>

      <div class="msg-row bot">
        <div class="md-content">
          <p>Visible answer.</p>
        </div>
      </div>
    `);

    const bubble = document.querySelector(
      ".msg-row.bot .md-content",
    ) as HTMLElement;

    stripGlobalStateFromBubble(bubble);

    expect(
      document.querySelector("#scratchpad-list")
        ?.textContent,
    ).toContain("GLOBAL_STATE");
  });
});
```

---

# Release Gate

Run:

```bash
pnpm --filter @workspace/nova run test
```

Required result:

```text
exit code = 0
AND
global-state.test.ts passes
```

A successful typecheck alone is insufficient.

The release must be blocked when the stripper regression suite fails.

---

# Live Verification

After deployment, verify against the live application using the testing workflow.

Inject or render a synthetic assistant bubble matching:

```text
.msg-row.bot .md-content
```

Test at minimum:

1. Genuine trailing `[scratchpad]` signature disappears.
2. Genuine trailing bare `GLOBAL_STATE` signature disappears.
3. Mid-line `GLOBAL_STATE` prose remains visible.
4. Mid-line `[scratchpad]` prose remains visible.
5. Trailing JSON without a marker remains visible.
6. `#scratchpad-list` remains unchanged.
7. `#settings-modal` remains unchanged.

Live verification must inspect the rendered DOM, not only the raw response payload.

---

# Change-Control Rule

Any modification to the stripper requires:

```text
update implementation
→ add regression fixture for the reported leak or over-strip
→ run Nova test suite
→ verify protected UI elements
→ verify synthetic live assistant bubble
→ deploy only after all checks pass
```

Every newly observed leak shape must become a permanent regression test.

Every over-strip incident must also become a permanent regression test.

---

# Prohibited Regressions

```text
Do not strip based on prose mentions.
Do not use unanchored marker regexes.
Do not require bare GLOBAL_STATE to be end-of-message.
Do not remove trailing structured content without an opener.
Do not scan the entire document.
Do not modify scratchpad settings UI.
Do not flatten line boundaries before marker detection.
Do not treat typecheck success as functional verification.
Do not deploy without running the jsdom regression suite.
```

---

# Final Invariant

```text
EXPLICIT LINE-START MARKER
+
TRAILING SIGNATURE REGION
=
REMOVE

NO EXPLICIT MARKER
=
PRESERVE

MID-LINE MARKER MENTION
=
PRESERVE

SETTINGS OR SCRATCHPAD UI
=
NEVER TOUCH
```

**END OF SPEC**
