---
name: Nova voice & speed levers
description: How response-speed and TTS-voice are controlled in the Nova chat UI, and a migration-matching bug to avoid.
---

# Speed

- The only runtime speed lever reachable without editing the compiled `bob.js` is `settings.model` (from `bob-settings` localStorage, seeded by the migration IIFE in `artifacts/nova/index.html`). `max_tokens` (4096) and `temperature` (0.7) are hardcoded in `bob.js`'s `/chat/completions` request body — not settable via settings.
- Fastest validated Bitdeer models: `XiaomiMiMo/MiMo-V2-Flash` (default), `ByteDance-Seed/Seed-1.6-Flash`, `Qwen/Qwen3-Next-80B-A3B-Instruct`. The starred dropdown default used to be the 675B `mistralai/Mistral-Large-3-675B-Instruct-2512`, which is slow.

## Migration id-match bug (durable lesson)
- **Rule:** model-migration "stale model" lists must match the *full* model id, not a truncated prefix. The old check listed `mistralai/Mistral-Large-3-675B` but used array `.includes()` (exact equality), so users on the full id `...-675B-Instruct-2512` were never migrated and stayed stuck on the slow model.
- **Why:** caused the reported "responses are slow" — the speed default never actually applied to anyone who had the starred 675B selected.
- **How to apply:** when forcing/upgrading a default model in the migration block, list exact full ids, and use a one-time guard flag (e.g. `s.speedMigration`) so a user's later deliberate Settings choice is not overridden on every reload.

# Voice / TTS

- `bob.js` `speak()` uses OpenAI neural TTS (`api.openai.com`, model `tts-1`, voice `settings.ttsVoice`, speed `settings.speechRate`) ONLY if `settings.openaiKey` is a real key (not the placeholder `{env:OPENAI_API_KEY}`). No `OPENAI_API_KEY` secret exists, so it always falls back to browser `speechSynthesis`.
- **The browser fallback ignores `settings.ttsVoice`** — it uses `settings.voiceName` (via `pickBestVoice`) + `settings.speechRate`. `utt.pitch` is not set and is not a setting.
- **Consequence:** setting `ttsVoice` (e.g. `'shimmer'`) is inert for current users; only `speechRate` actually affects the current voice. A genuinely "sweet/human" voice requires neural TTS, which requires an OpenAI key AND a UI field to set `settings.openaiKey` (none exists yet).
- Bitdeer offers no TTS/audio model (models list is LLM + image + embedding/rerank only), so neural TTS must go through OpenAI.

## Adding a settings field bob.js doesn't know about (durable pattern)
- `bob.js` `loadSettings()` does `Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage 'bob-settings'))` and `saveAndClose()` only writes the *known* input fields — it never deletes unknown keys. So a new setting (e.g. `openaiKey`) can be persisted from an inline `index.html` script without editing the compiled bundle.
- **Pattern:** add the input to the modal; an inline IIFE populates it from `bob-settings` on Settings-open, and on the Save button click defers with `setTimeout(0)` so it runs AFTER bob.js's synchronous `saveAndClose()` rewrites localStorage, then merges the new key into `bob-settings` and `location.reload()`s if it changed (so `loadSettings` re-reads it into the in-memory `settings`).
- **Why the setTimeout(0):** bob.js's save handler is synchronous and rewrites the whole settings blob; running before it would get clobbered. Deferring to the next macrotask guarantees you patch the post-save object. Inline scripts load before `/assets/bob.js`, so this ordering holds.

## Persona / "talks like a teacher" (durable lesson)
- The system prompt lives in `index.html` (gated by `promptVersion`). A "name the specific link when it backs your answer" + bulleted source list made Nova sound like a citing professor. To keep grounding WITHOUT the teacher tone: keep source URLs inline as model-only reference, but explicitly instruct "don't quote sources or drop links unless asked." Bump `PROMPT_VERSION` to push to existing users.

## Authoritative persona = "PROJECT NOVA-ROSE" (do not alter)
- Robert later replaced the prompt with a verbatim "PROJECT NOVA-ROSE" spec (flirty/volatile/deeply-attached human-woman persona, uses emoji, appends a GLOBAL_STATE JSON scratchpad block per reply) and declared it FINAL: "must never deviate." Don't soften, paraphrase, or professionalize it.
- **Why it's stored as `<script type="text/plain" id="nova-rose-prompt">` instead of a JS template literal:** the spec contains backticks (`tier-one-sources.md`), LaTeX backslashes (`\epsilon`, `\propto` → `\t` would become a TAB), and `$$...$$`. A template literal would corrupt all of that. Reading `el.textContent.trim()` preserves it byte-for-byte. The text block must sit in the DOM *before* the migration `<script>` so it's parsed when the IIFE runs. Only `</script>` would break the block (the spec has none).
- replit.md "no emoji / no theater" is about how the **Replit agent** talks to Robert in build chats — NOT how Nova behaves in-app. Keep them separate.
