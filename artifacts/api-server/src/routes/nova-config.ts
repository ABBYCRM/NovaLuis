import { Router } from "express";

const router = Router();

export interface ModelTuning {
  /** Default output cap. Caller can override up to the upstream hard limit. */
  maxTokens: number;
  /** Sampler temperature. */
  temperature: number;
  /** Nucleus sampling cutoff. */
  topP: number;
  /** Provider-specific reasoning extension, when supported. */
  thinking: { type: "enabled" | "disabled"; keep: "all" | null };
  /** Context window surfaced to the UI for transparency. */
  contextWindow: number;
}

export const MODEL_TUNING: Record<string, ModelTuning> = {
  // Poolside Laguna XS 2.1 on NVIDIA NIM — 262K context and 8K output.
  "poolside/laguna-xs-2.1": {
    maxTokens: 8_192,
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: "disabled", keep: null },
    contextWindow: 262_144,
  },
  "kimi-k2.6": {
    maxTokens: 32_768,
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: "enabled", keep: null },
    contextWindow: 262_144,
  },
  "moonshotai/Kimi-K2.6": {
    maxTokens: 32_768,
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: "enabled", keep: null },
    contextWindow: 262_144,
  },
  "gpt-4o": {
    maxTokens: 16_384,
    temperature: 0.7,
    topP: 1.0,
    thinking: { type: "disabled", keep: null },
    contextWindow: 128_000,
  },
};

export const PROVIDER_MODELS: Record<
  string,
  { model: string; label: string; requiredEnv: string }
> = {
  nvidia: {
    model: "poolside/laguna-xs-2.1",
    label: "Poolside Laguna XS 2.1 (NVIDIA NIM) — primary",
    requiredEnv: "NVIDIA_API_KEY",
  },
  bitdeer: {
    model: "moonshotai/Kimi-K2.6",
    label: "Kimi K2.6 (Bitdeer)",
    requiredEnv: "BITDEER_API_KEY",
  },
  openai: {
    model: "gpt-4o",
    label: "OpenAI GPT-4o",
    requiredEnv: "OPENAI_API_KEY",
  },
  kimi: {
    model: "kimi-k2.6",
    label: "Kimi K2.6 (Moonshot) — agentic",
    requiredEnv: "KIMI_API_KEY",
  },
};

const DEFAULT_PROVIDER = "nvidia";

function providerConfigured(provider: string): boolean {
  const entry = PROVIDER_MODELS[provider];
  return Boolean(entry && String(process.env[entry.requiredEnv] || "").trim());
}

let currentProvider: string =
  process.env.NOVA_MODEL_PREFERENCE && PROVIDER_MODELS[process.env.NOVA_MODEL_PREFERENCE]
    ? process.env.NOVA_MODEL_PREFERENCE
    : DEFAULT_PROVIDER;

export function getModelPreference(): { provider: string; model: string } {
  const entry = PROVIDER_MODELS[currentProvider] ?? PROVIDER_MODELS[DEFAULT_PROVIDER];
  return { provider: currentProvider, model: entry.model };
}

export function getModelTuning(model: string): ModelTuning | undefined {
  return MODEL_TUNING[model];
}

router.get("/nova-config", (_req, res) => {
  const active = PROVIDER_MODELS[currentProvider] ?? PROVIDER_MODELS[DEFAULT_PROVIDER];
  res.json({
    apiKey: "proxy",
    baseUrl: "/api/v1",
    modelPreference: currentProvider,
    activeModel: active.model,
    activeProviderConfigured: providerConfigured(currentProvider),
    activeProviderRequiredEnv: active.requiredEnv,
    modelOptions: Object.entries(PROVIDER_MODELS).map(
      ([id, { model, label, requiredEnv }]) => {
        const tuning = MODEL_TUNING[model];
        return {
          id,
          model,
          label,
          configured: providerConfigured(id),
          requiredEnv,
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
      },
    ),
  });
});

router.patch("/nova-config", (req, res) => {
  const { modelPreference } = (req.body ?? {}) as { modelPreference?: string };

  if (typeof modelPreference !== "string" || !PROVIDER_MODELS[modelPreference]) {
    res.status(400).json({
      error: `Invalid modelPreference. Valid values: ${Object.keys(PROVIDER_MODELS).join(", ")}`,
    });
    return;
  }

  if (!providerConfigured(modelPreference)) {
    const requiredEnv = PROVIDER_MODELS[modelPreference].requiredEnv;
    res.status(409).json({
      error: `${modelPreference} is not configured`,
      requiredEnv,
    });
    return;
  }

  currentProvider = modelPreference;
  const { model, label, requiredEnv } = PROVIDER_MODELS[currentProvider];
  res.json({
    modelPreference: currentProvider,
    model,
    label,
    configured: true,
    requiredEnv,
  });
});

export default router;
