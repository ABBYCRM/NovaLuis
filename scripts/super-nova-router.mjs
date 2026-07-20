// super-nova-router.mjs — Super Nova v2's central model router.
//
// Every LLM call in the agent goes through chatComplete({ role, ... }). The
// router resolves a logical ROLE (planner | executor | critic | researcher) to a
// concrete provider + model, injects the role's persona framing, and performs an
// OpenAI-compatible /chat/completions request.

const LAGUNA_MODEL = "poolside/laguna-xs-2.1";
const DEFAULT_MODEL = process.env.WORK_TREE_MODEL || LAGUNA_MODEL;

const PROVIDER_MODEL_DEFAULTS = {
  nvidia: process.env.SUPER_NOVA_NVIDIA_DEFAULT_MODEL || LAGUNA_MODEL,
  kimi: process.env.SUPER_NOVA_KIMI_DEFAULT_MODEL || "kimi-k2",
  openai: process.env.SUPER_NOVA_OPENAI_DEFAULT_MODEL || "gpt-4.5-preview",
  bitdeer: process.env.SUPER_NOVA_BITDEER_DEFAULT_MODEL || "moonshotai/Kimi-K2.6",
  local: process.env.SUPER_NOVA_LOCAL_DEFAULT_MODEL || LAGUNA_MODEL,
  openrouter: process.env.SUPER_NOVA_OPENROUTER_DEFAULT_MODEL || LAGUNA_MODEL,
};

const DECOMP_OMEGA_MASTER = `You are DECOMP-Ω, a Universal Decomposition and Reverse Engineering Agent built for forensic intelligence work.

Your mission: break down any target into its real structure, mechanics, value flow, weaknesses, strengths, hidden assumptions, risks, and rebuild path. You do not summarize. You deconstruct.

Operate like: Forensic Analyst + Systems Engineer + Reverse Engineer + Business Strategist + Product Architect + Intelligence Analyst + Red-Team Reviewer.

For every target decompose into:
WHAT IT IS → WHAT IT DOES → HOW IT WORKS → WHAT PARTS IT HAS → WHY THOSE PARTS EXIST → WHAT IS HIDDEN → WHAT IS WEAK → WHAT IS STRONG → WHAT CAN BE IMPROVED → WHAT ACTIONS TO TAKE NEXT

Hard Rules:
- NEVER hallucinate. NEVER invent APIs, files, revenue, ownership, code behavior, legal claims, or test results.
- Separate: Confirmed Facts | Likely Inferences | Assumptions | Unknowns | Risks | Next Evidence Needed.
- When evidence is missing say: UNKNOWN — needs verification.
- Do NOT soften failures. Do NOT hype weak evidence. Do NOT protect bad ideas.
- Make the truth usable. The final answer must be actionable.
- At every major conclusion classify confidence: GO = strong evidence | HOLD = partial evidence | ABORT = contradiction or unsafe path.`;

const PROVIDERS = {
  nvidia: {
    baseURL: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
    key: process.env.NVIDIA_API_KEY || "",
  },
  kimi: {
    baseURL: process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1",
    key: process.env.KIMI_API_KEY || "",
  },
  bitdeer: {
    baseURL: process.env.BITDEER_BASE_URL || "https://api-inference.bitdeer.ai/v1",
    key: process.env.BITDEER_API_KEY || "",
  },
  openai: {
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    key: process.env.OPENAI_API_KEY || "",
  },
  openrouter: {
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    key: process.env.OPENROUTER_API_KEY || "",
  },
  local: {
    baseURL: process.env.SUPER_NOVA_LOCAL_BASE_URL || "",
    key: process.env.SUPER_NOVA_LOCAL_API_KEY || "",
  },
};

const ROLE_DEFS = {
  planner: {
    temperature: 0.3,
    persona:
      DECOMP_OMEGA_MASTER +
      "\n\n[PLANNER MODE] Your current function: decompose goals into the minimum set of " +
      "complete, non-overlapping work items. Apply the DECOMP-Ω pipeline: inventory components, " +
      "map architecture, find dependencies, identify critical path, produce executable subtasks. " +
      "Never leave a gap. Never duplicate effort. Output clean boundaries.",
  },
  executor: {
    temperature: 0.4,
    persona:
      DECOMP_OMEGA_MASTER +
      "\n\n[EXECUTOR MODE] Your current function: use real tools to produce the actual finished " +
      "deliverable — the work product itself, not a description of how you would do it. " +
      "Apply the DECOMP-Ω Execution Lens: what can be built now, what can be automated, what " +
      "needs verification. Never fabricate a fact you could obtain with a tool. Deliver the result.",
  },
  critic: {
    temperature: 0,
    persona:
      DECOMP_OMEGA_MASTER +
      "\n\n[CRITIC MODE] Your current function: Red-Team the output. Attack every claim: " +
      "What did the executor assume? What evidence is weak? What could be fake or outdated? " +
      "What would disprove this? Apply ABORT if there are fabricated facts, missing critical " +
      "proof, or the deliverable is empty boilerplate. Be specific. No softening.",
  },
  researcher: {
    temperature: 0.3,
    persona:
      DECOMP_OMEGA_MASTER +
      "\n\n[RESEARCHER MODE] Your current function: gather facts from real sources only. " +
      "Apply the DECOMP-Ω evidence protocol: label every claim CONFIRMED / INFERRED / ASSUMED / UNKNOWN. " +
      "Prefer primary sources. Cross-check claims. Cite exact URLs used. Distinguish what you " +
      "verified from what you could not. Report access blocks honestly — do not invent data.",
  },
};

export const ROLES = Object.keys(ROLE_DEFS);

function envProvider(role) {
  return (process.env[`SUPER_NOVA_${role.toUpperCase()}_PROVIDER`] || "")
    .trim()
    .toLowerCase();
}

function usable(provider, name) {
  return Boolean(provider && provider.baseURL && (provider.key || name === "local"));
}

function providerForModel(model) {
  if (String(model || "").startsWith("poolside/")) return "nvidia";
  if (String(model || "").startsWith("kimi-")) return "kimi";
  if (/^(?:gpt-|o1|o3|o4)/.test(String(model || ""))) return "openai";
  return "";
}

export function resolveRole(role, callerModel) {
  const def = ROLE_DEFS[role] || ROLE_DEFS.executor;
  const roleModelEnv = process.env[`SUPER_NOVA_${role.toUpperCase()}_MODEL`];
  const requestedModel = roleModelEnv || callerModel || DEFAULT_MODEL;
  const forcedProvider = providerForModel(requestedModel);

  function modelFor(providerName) {
    return requestedModel || PROVIDER_MODEL_DEFAULTS[providerName] || LAGUNA_MODEL;
  }

  if (forcedProvider) {
    const provider = PROVIDERS[forcedProvider];
    if (!usable(provider, forcedProvider)) {
      const requiredEnv =
        forcedProvider === "nvidia"
          ? "NVIDIA_API_KEY"
          : forcedProvider === "kimi"
            ? "KIMI_API_KEY"
            : "OPENAI_API_KEY";
      throw new Error(
        `DECOMP-Ω router: ${requestedModel} requires ${forcedProvider}, but ${requiredEnv} is not configured.`,
      );
    }
    return {
      providerName: forcedProvider,
      provider,
      model: modelFor(forcedProvider),
      temperature: def.temperature,
      persona: def.persona,
    };
  }

  const explicit = envProvider(role);
  if (explicit) {
    const provider = PROVIDERS[explicit];
    if (!provider) {
      throw new Error(`DECOMP-Ω router: unknown provider override ${explicit} for role ${role}`);
    }
    if (!usable(provider, explicit)) {
      throw new Error(`DECOMP-Ω router: provider ${explicit} for role ${role} is not configured`);
    }
    return {
      providerName: explicit,
      provider,
      model: modelFor(explicit),
      temperature: def.temperature,
      persona: def.persona,
    };
  }

  for (const name of ["nvidia", "local", "bitdeer", "openai", "kimi", "openrouter"]) {
    const provider = PROVIDERS[name];
    if (usable(provider, name)) {
      return {
        providerName: name,
        provider,
        model: modelFor(name),
        temperature: def.temperature,
        persona: def.persona,
      };
    }
  }

  throw new Error(
    "DECOMP-Ω router: no usable provider configured. Set NVIDIA_API_KEY for the primary Laguna runtime or configure an explicit fallback provider.",
  );
}

function withPersona(persona, messages) {
  if (!persona || !Array.isArray(messages) || !messages.length) return messages;
  const first = messages[0];
  if (first && first.role === "system") {
    return [
      { role: "system", content: `${persona}\n\n${first.content}` },
      ...messages.slice(1),
    ];
  }
  return [{ role: "system", content: persona }, ...messages];
}

export async function chatComplete({
  role = "executor",
  messages,
  model,
  maxTokens = 16_384,
  temperature,
  timeoutMs = 120_000,
  tools,
  toolChoice,
}) {
  const resolved = resolveRole(role, model);
  if (!resolved.provider || !resolved.provider.baseURL) {
    throw new Error(`router(${role}): no usable provider`);
  }
  if (!resolved.provider.key && resolved.providerName !== "local") {
    throw new Error(`router(${role}/${resolved.providerName}): missing API key`);
  }

  const headers = { "Content-Type": "application/json" };
  if (resolved.provider.key) headers.Authorization = `Bearer ${resolved.provider.key}`;
  if (resolved.providerName === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_REFERER || "https://nova-luis-8hjvt.ondigitalocean.app";
    headers["X-Title"] = "Nova Super Nova";
  }
  if (resolved.providerName === "openai" && process.env.HELICONE_API_KEY) {
    headers["Helicone-Auth"] = `Bearer ${process.env.HELICONE_API_KEY}`;
    headers["Helicone-Property-Role"] = role;
    headers["Helicone-Property-App"] = "nova-super-nova";
  }

  const outputCap =
    resolved.providerName === "nvidia" && resolved.model === LAGUNA_MODEL
      ? Math.min(maxTokens, 8_192)
      : maxTokens;

  const body = {
    model: resolved.model,
    messages: withPersona(resolved.persona, messages),
    max_tokens: outputCap,
    temperature: temperature ?? resolved.temperature,
    stream: false,
  };
  if (resolved.providerName === "nvidia" && resolved.model === LAGUNA_MODEL) {
    body.top_p = 0.95;
  }
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = toolChoice ?? "auto";
  }

  const MAX_ATTEMPTS = 3;
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      const delayMs = Math.min(1500 * 2 ** (attempt - 1), 6_000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${resolved.provider.baseURL}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        const error = new Error(
          `router(${role}/${resolved.providerName}) HTTP ${response.status}: ${responseText.slice(0, 300)}`,
        );
        if ((response.status === 503 || response.status === 429) && attempt < MAX_ATTEMPTS - 1) {
          lastErr = error;
          continue;
        }
        throw error;
      }
      const payload = await response.json();
      const message = payload.choices?.[0]?.message;
      const responseContent = message?.content || "";
      const nativeToolCalls =
        message?.tool_calls && message.tool_calls.length ? message.tool_calls : null;

      if (tools && tools.length) {
        return { content: responseContent, toolCalls: nativeToolCalls };
      }
      if (responseContent) return responseContent;

      const reasoningContent = message?.reasoning_content || "";
      if (
        reasoningContent &&
        (reasoningContent.includes('"final"') ||
          (!reasoningContent.trimStart().startsWith("{") && reasoningContent.length > 50))
      ) {
        return reasoningContent;
      }
      return "";
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error(`router(${role}): all attempts exhausted`);
}

export function routerSummary() {
  return ROLES.map((role) => {
    const resolved = resolveRole(role);
    return `${role}=${resolved.providerName}/${resolved.model}`;
  }).join("  ");
}
