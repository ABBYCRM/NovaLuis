import { Router } from "express";

const router = Router();

// ── Model provider registry ────────────────────────────────────────────────
// These are the three user-selectable providers and their canonical model IDs.
// Adding a new provider here is the only place that needs changing on the backend.
//
// `tuning` is the default agentic tuning applied to every chat request for
// this model. The openai-proxy and agent-chat routes fill in any missing
// fields from this table so the request that reaches the upstream model
// always has the right sampler, output cap, and thinking-mode setting for
// the job (tool use, code generation, multi-turn agent loops).
export interface ModelTuning {
  /** Default output cap. Caller can override up to the upstream's hard limit. */
  maxTokens: number;
  /** Sampler temperature. Moonshot recommends 1.0 for thinking mode. */
  temperature: number;
  /** Nucleus sampling cutoff. */
  topP: number;
  /** Whether the model should run with chain-of-thought reasoning. */
  thinking: { type: "enabled" | "disabled"; keep: "all" | null };
  /** Context window the model supports. Surfaced to the UI for transparency. */
  contextWindow: number;
}
export const MODEL_TUNING: Record<string, ModelTuning> = {
  // Moonshot kimi-k2.6 — 256K context, 32K default output, thinking on.
  // Fast: 193 tok/s after Moonshot's 14-iteration optimization.
  "kimi-k2.6": {
    maxTokens: 32_768,
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: "enabled", keep: null },
    contextWindow: 262_144,
  },
  // Bitdeer-hosted mirror of kimi-k2.6 (org/model style id).
  "moonshotai/Kimi-K2.6": {
    maxTokens: 32_768,
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: "enabled", keep: null },
    contextWindow: 262_144,
  },
  // OpenAI gpt-4o — chat-tuned, 128K context, 16K output.
  "gpt-4o": {
    maxTokens: 16_384,
    temperature: 0.7,
    topP: 1.0,
    thinking: { type: "disabled", keep: null },
    contextWindow: 128_000,
  },
};

export const PROVIDER_MODELS: Record<string, { model: string; label: string }> = {
  bitdeer: { model: "moonshotai/Kimi-K2.6",  label: "Kimi K2.6 (Bitdeer)" },
  openai:  { model: "gpt-4o",                 label: "OpenAI GPT-4o"       },
  kimi:    { model: "kimi-k2.6",              label: "Kimi K2.6 (Moonshot) — agentic" },
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

/**
 * Returns the agentic tuning for a given model id, or undefined if no tuning
 * is registered. Both the openai-proxy and agent-chat routes call this to
 * default the missing fields (max_tokens, temperature, top_p, thinking).
 */
export function getModelTuning(model: string): ModelTuning | undefined {
  return MODEL_TUNING[model];
}

// ── GET /api/nova-config ───────────────────────────────────────────────────
// Returns proxy config (apiKey, baseUrl) PLUS the current model preference,
// the full list of selectable options, and the agentic tuning applied to
// each model. The settings panel uses this to show the user exactly what
// sampler / output cap / thinking mode is in effect.
router.get("/nova-config", (_req, res) => {
  res.json({
    apiKey:          "proxy",
    baseUrl:         "/api/v1",
    modelPreference: currentProvider,
    modelOptions:    Object.entries(PROVIDER_MODELS).map(([id, { model, label }]) => {
      const tuning = MODEL_TUNING[model];
      return {
        id,
        model,
        label,
        tuning: tuning
          ? {
              maxTokens: tuning.maxTokens,
              temperature: tuning.temperature,
              topP: tuning.topP,
              thinking: tuning.thinking,
              contextWindow: tuning.contextWindow,
            }
          : null,
      };
    }),
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
