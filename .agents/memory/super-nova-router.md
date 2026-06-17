---
name: Super Nova model router
description: How the Work Tree worker routes logical roles to LLM providers, and the fallback trap to avoid.
---

# Super Nova model router

`scripts/super-nova-router.mjs` is the single place that maps a logical role
(planner / executor / critic / researcher) to a provider (gemini preferred,
bitdeer fallback) + model, and runs an OpenAI-compatible chat completion.
The Work Tree worker calls it for every LLM turn with an explicit role;
switching a role's brain is a one-env-var change
(`SUPER_NOVA_<ROLE>_PROVIDER` / `_MODEL`), no code edit.

## Model-swap rule (critical)

When a provider is unconfigured (missing key) the router falls back to Bitdeer.
It MUST swap the model name too — NOT just the provider.

**Why it broke:** `gemini-2.5-flash` is auto-routed to the Gemini provider.
On Replit, `GEMINI_API_KEY` is absent → falls back to Bitdeer, but the model
name stays `gemini-2.5-flash`. Bitdeer returns 400 "invalid request" for that
name. The Replit worker then marks the run `failed` before Render (which has
the key) ever picks it up.

**Fix in `resolveRole`:** after detecting `!usable(provider, providerName)`:
- If `model.startsWith("gemini-")`: swap to `BITDEER_FALLBACK_MODEL || "moonshotai/Kimi-K2.6"`
- Otherwise: use `callerModel || DEFAULT_MODEL` (existing logic)

The same pattern applies to any provider-specific model prefix.

## Fallback chain (503/429 retry path)

- attempts 0–2: `gemini-2.5-flash` via Gemini (2s / 4s backoff)
- attempt 3: `gemini-2.5-pro` via Gemini (separate quota bucket, 8s backoff)
- attempt 4: `deepseek-ai/DeepSeek-V3` via Bitdeer (16s backoff, true last resort)
- 400/401/404 errors throw immediately — not retriable.

## Kimi-K2.6 / reasoning model issue

Kimi-K2.6 is a reasoning model: it puts chain-of-thought in `reasoning_content`
and may leave `content` empty. The `reasoning_content` field contains internal
thinking steps in `{"thought":"...","tool":"..."}` JSON — NOT the final answer.
Reading it as the model response breaks the ReAct parser.
**Fix:** only fall back to `reasoning_content` when it contains `"final"` or is
long prose that does not start with `{`.

## Token truncation

`maxTokens: 2000` truncates large deliverables mid-JSON-string, breaking
`JSON.parse` and storing broken JSON as the result. Fix: 4000 tokens for ReAct
loop steps, 6000 for the budget-exhausted call. Budget-exhausted prompt asks for
plain markdown (no JSON wrapper) so truncation produces a partial but valid text
deliverable. `parseAgentJson` still extracts `final` if the model wraps anyway.

## DEFAULT_MODEL consistency

`work-tree-worker.mjs` has its own `DEFAULT_MODEL` constant (used in the startup
log and as the `callerModel` default). Keep it in sync with the router's
`DEFAULT_MODEL` (`gemini-2.5-flash`) so the startup message is accurate and any
`WORK_TREE_MODEL` env override applies to both consistently.

## Provider usability

`usable()` is evaluated per-call (reads `provider.key` from the PROVIDERS object
built at module load). Deleting an API key from `process.env` at runtime does not
change the result — provider key is captured once on import.
