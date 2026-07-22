# FluidVoice × NOVA companion integration

## What this is

FluidVoice remains a native macOS dictation client. NOVA remains the hosted agent runtime.

```text
Microphone on Mac
  → FluidVoice local speech recognition
  → NOVA FluidVoice bridge
  → OpenClaw agent runtime
  → NVIDIA NIM / poolside/laguna-xs-2.1
  → OpenAI-compatible response back to FluidVoice
```

FluidVoice is **not** executed inside the DigitalOcean Linux container. Its macOS microphone, Accessibility and Keychain APIs are platform-specific. The upstream source is pinned under `integrations/fluidvoice/upstream` as a Git submodule so its history and GPLv3 license remain explicit and isolated.

## Upstream

- Repository: `https://github.com/altic-dev/FluidVoice`
- Pinned commit: `1b070a8e90e4f9cdba6e3ea6f4a4b03352c26729`
- License: GPLv3; retain upstream copyright and license notices.

## Pair a Mac

1. Deploy this branch after CI and review.
2. Open `https://nova-luis-8hjvt.ondigitalocean.app/fluidvoice`.
3. Enter a device name and the NOVA operator PIN.
4. Copy the generated Base URL, Model and device token.
5. In FluidVoice, choose a custom OpenAI-compatible provider and enter:
   - Base URL: `https://nova-luis-8hjvt.ondigitalocean.app/api/fluidvoice/v1`
   - Model: `poolside/laguna-xs-2.1`
   - API key: the paired device token
6. Store the device token in macOS Keychain when FluidVoice prompts.

Do **not** place `NVIDIA_API_KEY`, `SESSION_SECRET`, `NOVA_OPERATOR_PIN` or any DigitalOcean credential in FluidVoice.

## Security model

- Pairing requires NOVA's existing signed operator session.
- The operator PIN is used only to establish the HTTPS session and is never embedded in the device token.
- Device tokens are stateless HMAC-signed credentials derived through a FluidVoice-specific domain separator from `SESSION_SECRET` or `NOVA_API_TOKEN`.
- Default lifetime is 90 days; maximum lifetime is 365 days.
- The bridge never returns or forwards the NVIDIA credential.
- Every FluidVoice completion is routed to NOVA's local agent endpoint, preserving OpenClaw tools, Composio preflight, GitHub evidence, memory and the active Laguna model policy.

## API surface

### Pair

`POST /api/fluidvoice/pair`

Requires a valid `nova_operator_session` cookie.

```json
{
  "deviceName": "Luis MacBook",
  "ttlDays": 90
}
```

### Verify device

`GET /api/fluidvoice/status`

Header:

```text
Authorization: Bearer <paired-device-token>
```

### Chat completions

`POST /api/fluidvoice/v1/chat/completions`

OpenAI-compatible request body. The server pins the active production model and forwards the request into the OpenClaw agent loop.

## Updating upstream

Change `FLUIDVOICE_UPSTREAM_COMMIT` in `.github/workflows/sync-fluidvoice-upstream.yml` on a dated branch, review the upstream diff and license, then let the workflow update the gitlink. Never float the submodule at an unreviewed branch head.
