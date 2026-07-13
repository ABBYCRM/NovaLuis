---
name: "Super Nova model router"
description: "Route Work Tree roles through OpenAI primary, Gemini secondary, and Bitdeer fallback while keeping provider and model atomic and using provider-aware output budgets."
---

# Super Nova Model Router

## Single routing authority

```text
scripts/super-nova-router.mjs
```

is the only component allowed to map logical roles to provider/model routes and execute LLM requests.

Required roles:

```text
planner
executor
critic
researcher
```

Every Work Tree call supplies an explicit role.

## Provider priority

```text
1. OpenAI
2. Gemini
3. Bitdeer
```

Role overrides:

```text
SUPER_NOVA_<ROLE>_PROVIDER
SUPER_NOVA_<ROLE>_MODEL
```

Compatibility overrides:

```text
WORK_TREE_PROVIDER
WORK_TREE_MODEL
```

Precedence:

```text
role override
→ Work Tree override
→ role default
→ provider default
```

## Atomic route rule

```text
PROVIDER + MODEL
=
ONE ROUTE
```

When a provider is unavailable or rejected, recompute the fallback model for the new provider. Never send `gemini-*` to Bitdeer or OpenAI, and never send an OpenAI-only model to Gemini or Bitdeer.

A provider-only override selects that provider's default model unless an explicitly compatible model is also supplied.

## Dynamic provider usability

Store credential environment-variable names in the provider registry and read `process.env` per call. Do not capture key values once at module import.

```js
function providerUsable(provider) {
  const key = process.env[provider.keyEnv]?.trim();
  return Boolean(key && provider.baseUrl);
}
```

OpenAI and Gemini adapters may have fixed default base URLs; Bitdeer must have both key and base URL.

## Output budgets

The old 2,000-token ceiling is forbidden.

Defaults:

```text
ReAct step:             16,384
normal final:           32,768
budget-exhausted final: 32,768
large deliverable:      65,536 when supported
```

Environment overrides:

```text
SUPER_NOVA_REACT_MAX_OUTPUT_TOKENS
SUPER_NOVA_FINAL_MAX_OUTPUT_TOKENS
SUPER_NOVA_BUDGET_EXHAUSTED_MAX_OUTPUT_TOKENS
SUPER_NOVA_LARGE_MAX_OUTPUT_TOKENS
```

Before every request, clamp the requested budget to the selected model's verified output limit and record both requested and effective values. Do not guess limits solely from provider prefixes.

## Provider adapters

Use one canonical request:

```js
{
  role,
  instructions,
  input,
  outputMode,
  maxOutputTokens,
  reasoningEffort
}
```

Each adapter maps it to the provider's current request schema, including the correct output-token field.

## Reasoning output

`reasoning_content` is not the final answer and must not be exposed, stored as the result, or fed directly into the ReAct parser.

```text
content present
→ use content

content empty + reasoning present
→ request one final-only continuation

continuation empty
→ EMPTY_FINAL_CONTENT
```

Do not infer a final answer from private reasoning JSON.

## JSON and truncation

A token-limited or malformed JSON response is not a successful result.

When the ReAct budget is exhausted, request plain Markdown rather than a JSON wrapper so a partial response remains readable. Clearly label incomplete or unverified sections.

## Retry policy

Retry or fall through for:

```text
408
429
500
502
503
504
transient network failure
```

Honor `Retry-After` when present.

Do not retry unchanged:

```text
400
401
403
404
409
```

A missing key discovered during preflight means skip the route. An invalid configured key is a real configuration failure and must be recorded.

## Worker consistency

`work-tree-worker.mjs` must import router defaults. It must not define an independent `DEFAULT_MODEL`.

Startup logs, route resolution, attempt ledgers, and execution must report the same effective provider and model.

## Required tests

- OpenAI is primary when configured
- missing OpenAI falls through to Gemini
- missing OpenAI and Gemini falls through to Bitdeer
- fallback always swaps to a compatible model
- environment key changes are observed on the next call
- ReAct default is at least 16,384
- provider/model limit clamping is recorded
- reasoning content is never treated as final content
- truncation is not accepted as complete JSON
- 400/401/403/404 are not retried unchanged
- startup route matches the actual route

## Final invariant

```text
PRIMARY
=
OPENAI

FALLBACK
=
RECOMPUTE PROVIDER + MODEL

REACT OUTPUT
>=
16,384

DONE
=
COMPATIBLE ROUTE
+
VALID FINAL CONTENT
+
ATTEMPT EVIDENCE
```
