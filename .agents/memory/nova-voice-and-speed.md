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
