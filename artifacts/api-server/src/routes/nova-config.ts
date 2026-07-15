import { Router } from "express";

const router = Router();

// ── Model provider registry ────────────────────────────────────────────────
// These are the three user-selectable providers and their canonical model IDs.
// Adding a new provider here is the only place that needs changing on the backend.
export const PROVIDER_MODELS: Record<string, { model: string; label: string }> = {
  bitdeer: { model: "moonshotai/Kimi-K2.6",  label: "Kimi K2.6 (Bitdeer)" },
  openai:  { model: "gpt-4o",                 label: "OpenAI GPT-4o"       },
  kimi:    { model: "kimi-k2",                label: "Kimi (Moonshot)"      },
};

// In-memory preference — survives requests, resets on server restart.
// Seed from NOVA_MODEL_PREFERENCE env var (default: bitdeer).
let currentProvider: string =
  process.env.NOVA_MODEL_PREFERENCE && PROVIDER_MODELS[process.env.NOVA_MODEL_PREFERENCE]
    ? process.env.NOVA_MODEL_PREFERENCE
    : "bitdeer";

/**
 * Returns the currently active provider id and its resolved model string.
 * Called by openai-proxy to override the model on internal OpenClaw calls.
 */
export function getModelPreference(): { provider: string; model: string } {
  const entry = PROVIDER_MODELS[currentProvider] ?? PROVIDER_MODELS.bitdeer;
  return { provider: currentProvider, model: entry.model };
}

// ── GET /api/nova-config ───────────────────────────────────────────────────
// Returns proxy config (apiKey, baseUrl) PLUS the current model preference
// and the full list of selectable options for the settings panel.
router.get("/nova-config", (_req, res) => {
  res.json({
    apiKey:          "proxy",
    baseUrl:         "/api/v1",
    modelPreference: currentProvider,
    modelOptions:    Object.entries(PROVIDER_MODELS).map(([id, { model, label }]) => ({
      id,
      model,
      label,
    })),
  });
});

// ── PATCH /api/nova-config ─────────────────────────────────────────────────
// Switches the active model provider.  Takes effect immediately for the next
// chat request — no gateway restart required.
// Body: { "modelPreference": "openai" | "bitdeer" | "kimi" }
router.patch("/nova-config", (req, res) => {
  const { modelPreference } = (req.body ?? {}) as { modelPreference?: string };

  if (typeof modelPreference !== "string" || !PROVIDER_MODELS[modelPreference]) {
    res.status(400).json({
      error: `Invalid modelPreference. Valid values: ${Object.keys(PROVIDER_MODELS).join(", ")}`,
    });
    return;
  }

  currentProvider = modelPreference;
  const { model, label } = PROVIDER_MODELS[currentProvider];
  res.json({ modelPreference: currentProvider, model, label });
});

export default router;
