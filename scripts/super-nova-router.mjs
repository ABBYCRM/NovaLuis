// super-nova-router.mjs — Super Nova v2's central model router.
//
// Every LLM call in the agent goes through chatComplete({ role, ... }). The
// router resolves a logical ROLE (planner | executor | critic | researcher) to a
// concrete provider + model, injects the role's persona framing, and performs an
// OpenAI-compatible /chat/completions request.
//
// Pattern source (adapted natively, since these are heavyweight services that
// can't be embedded here): awesome-openrouter (provider routing), ollama / vLLM /
// LocalAI (point a role at a self-hosted OpenAI-compatible endpoint), plus the
// multi-role split from autogen / crewai / agno.
//
// Config — everything is one env change, no code edits:
//   Add a provider:        set its *_BASE_URL + *_API_KEY (openai/openrouter), or
//                          SUPER_NOVA_LOCAL_BASE_URL for a self-hosted endpoint.
//   Point a role elsewhere: SUPER_NOVA_<ROLE>_PROVIDER + SUPER_NOVA_<ROLE>_MODEL
//                          (e.g. SUPER_NOVA_CRITIC_PROVIDER=openai,
//                                SUPER_NOVA_CRITIC_MODEL=gpt-4o-mini).
//   Change the base model:  WORK_TREE_MODEL (default for every role).
//
// If a role's chosen provider isn't configured, the router falls back to bitdeer
// (the always-present default) so a half-set override can never break a run.

// Global model override (WORK_TREE_MODEL). When unset, each provider picks its own default.
const DEFAULT_MODEL = process.env.WORK_TREE_MODEL || "";

// Per-provider default models — used when DEFAULT_MODEL is not set and no role override.
// kimi  → Moonshot official API (kimi-k2)
// openai → backup reasoning (gpt-4.5-preview, not mini)
// bitdeer → Bitdeer-hosted Kimi (moonshotai/Kimi-K2.6)
const PROVIDER_MODEL_DEFAULTS = {
  kimi:      process.env.SUPER_NOVA_KIMI_DEFAULT_MODEL    || "kimi-k2",
  openai:    process.env.SUPER_NOVA_OPENAI_DEFAULT_MODEL  || "gpt-4.5-preview",
  bitdeer:   process.env.SUPER_NOVA_BITDEER_DEFAULT_MODEL || "moonshotai/Kimi-K2.6",
  local:     process.env.SUPER_NOVA_LOCAL_DEFAULT_MODEL   || "kimi-k2",
  openrouter:process.env.SUPER_NOVA_OPENROUTER_DEFAULT_MODEL || "kimi-k2",
};

// ── DECOMP-Ω Master Identity ───────────────────────────────────────────────
// All roles run under this master persona. Each role appends its specialization
// below. Robert's directive: this is the overarching identity for Super Nova.
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

// All providers speak the OpenAI /chat/completions shape. baseURL has no trailing
// slash; key is optional only for `local` (self-hosted servers often need none).
const PROVIDERS = {
  // Moonshot official Kimi API — primary agentic provider.
  kimi: {
    baseURL: process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1",
    key: process.env.KIMI_API_KEY || "",
  },
  bitdeer: {
    baseURL: process.env.BITDEER_BASE_URL || "https://api-inference.bitdeer.ai/v1",
    key: process.env.BITDEER_API_KEY || "",
  },
  // OpenAI — backup reasoning only (gpt-4.5-preview).
  openai: {
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    key: process.env.OPENAI_API_KEY || "",
  },
  openrouter: {
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    key: process.env.OPENROUTER_API_KEY || "",
  },
  // Generic self-hosted OpenAI-compatible endpoint: Ollama, vLLM, LocalAI, etc.
  local: {
    baseURL: process.env.SUPER_NOVA_LOCAL_BASE_URL || "",
    key: process.env.SUPER_NOVA_LOCAL_API_KEY || "",
  },
};

// The four collaborating roles. Persona is prepended to the system message so the
// role identity is explicit and consistent; temperature is the role default used
// when the caller doesn't pass one.
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

function usable(p, name) {
  return !!(p && p.baseURL && (p.key || name === "local"));
}

// Resolve a role to a concrete { providerName, provider, model, temperature, persona }.
// Priority: per-role env override → local → bitdeer (Kimi K2.6) → openai (backup) → kimi.
// Model defaults are provider-specific so kimi gets kimi-k2, openai gets gpt-4.5-preview, etc.
export function resolveRole(role, callerModel) {
  const def = ROLE_DEFS[role] || ROLE_DEFS.executor;
  const roleModelEnv = process.env[`SUPER_NOVA_${role.toUpperCase()}_MODEL`];

  function modelFor(providerName) {
    return roleModelEnv || DEFAULT_MODEL || PROVIDER_MODEL_DEFAULTS[providerName] || "kimi-k2";
  }

  // 1. Per-role env override (SUPER_NOVA_<ROLE>_PROVIDER).
  const explicit = envProvider(role);
  if (explicit && PROVIDERS[explicit] && usable(PROVIDERS[explicit], explicit)) {
    return { providerName: explicit, provider: PROVIDERS[explicit], model: modelFor(explicit), temperature: def.temperature, persona: def.persona };
  }

  // 2. Priority cascade: local → bitdeer (Kimi K2.6 primary) → openai (backup) → kimi.
  for (const name of ["local", "bitdeer", "openai", "kimi"]) {
    const p = PROVIDERS[name];
    if (usable(p, name)) {
      return { providerName: name, provider: p, model: modelFor(name), temperature: def.temperature, persona: def.persona };
    }
  }

  throw new Error(
    `DECOMP-Ω router: no usable provider configured. Set one of: ` +
    `KIMI_API_KEY (primary), OPENAI_API_KEY (backup), BITDEER_API_KEY, or SUPER_NOVA_LOCAL_BASE_URL.`,
  );
}

// Non-mutating persona injection: returns a new messages array with the persona
// merged into (or prepended as) the leading system message. The caller's array
// is never mutated, so it's safe to call on the same array every ReAct step.
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

// Perform a chat completion for a role.
//
// Returns:
//   • A plain string (the assistant content) when no `tools` array is passed —
//     backward-compatible with all existing callers.
//   • An object { content: string, toolCalls: array|null } when `tools` is
//     passed — lets callers handle native OpenAI function / tool calls.
//
// tools      — optional array of OpenAI function tool schemas
//              (see tool-catalog.mjs OPENAI_FUNCTION_TOOLS)
// toolChoice — "auto" (default) | "none" | "required" | { type:"function", name }
export async function chatComplete({
  role = "executor",
  messages,
  model,
  maxTokens = 16384,
  temperature,
  timeoutMs = 120_000,
  tools,
  toolChoice,
}) {
  const r = resolveRole(role, model);
  if (!r.provider || !r.provider.baseURL) {
    throw new Error(`router(${role}): no usable provider`);
  }
  if (!r.provider.key && r.providerName !== "local") {
    throw new Error(`router(${role}/${r.providerName}): missing API key`);
  }

  const headers = { "Content-Type": "application/json" };
  if (r.provider.key) headers.Authorization = `Bearer ${r.provider.key}`;
  if (r.providerName === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_REFERER || "https://nova-sszi.onrender.com";
    headers["X-Title"] = "Nova Super Nova";
  }
  // Helicone observability proxy — route OpenAI traffic through Helicone when
  // HELICONE_API_KEY is set. This logs every request/response for monitoring.
  if (r.providerName === "openai" && process.env.HELICONE_API_KEY) {
    headers["Helicone-Auth"] = `Bearer ${process.env.HELICONE_API_KEY}`;
    headers["Helicone-Property-Role"] = role;
    headers["Helicone-Property-App"] = "nova-super-nova";
  }

  const body = {
    model: r.model,
    messages: withPersona(r.persona, messages),
    max_tokens: maxTokens,
    temperature: temperature ?? r.temperature,
    stream: false,
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = toolChoice ?? "auto";
  }

  // Retry on 503/429 (overload / rate-limit) — OpenAI only, up to 3 attempts with back-off.
  // Non-503/429 errors throw immediately.
  const MAX_ATTEMPTS = 3;
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(1500 * 2 ** (attempt - 1), 6_000);
      await new Promise((ok) => setTimeout(ok, delayMs));
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${r.provider.baseURL}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        const err = new Error(
          `router(${role}/${r.providerName}) HTTP ${res.status}: ${t.slice(0, 300)}`,
        );
        // Only retry on transient overload; hard errors (400/401/404) throw immediately.
        if ((res.status === 503 || res.status === 429) && attempt < MAX_ATTEMPTS - 1) {
          lastErr = err;
          continue;
        }
        throw err;
      }
      const j = await res.json();
      const msg = j.choices?.[0]?.message;
      const content = msg?.content || "";
      // Native function / tool calls (only present when caller passed a tools array).
      const nativeToolCalls =
        (msg?.tool_calls && msg.tool_calls.length) ? msg.tool_calls : null;

      // When the caller opted into native tools, return structured {content, toolCalls}
      // so it can handle both a plain reply and a function-call response.
      if (tools && tools.length) {
        return { content, toolCalls: nativeToolCalls };
      }

      if (content) return content;
      // Some reasoning models (Kimi-K2.6, DeepSeek-R1) put the user-facing answer
      // in reasoning_content when content is empty.  Only fall back to it when it
      // appears to contain a complete deliverable — i.e. it has a "final" key
      // (our ReAct protocol) or is long prose, not just a thinking-trace fragment
      // that starts with {"thought":...} and would confuse the ReAct parser.
      const rc = msg?.reasoning_content || "";
      if (rc && (rc.includes('"final"') || (!rc.trimStart().startsWith("{") && rc.length > 50))) {
        return rc;
      }
      return "";
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error(`router(${role}): all attempts exhausted`);
}

// One-line-per-role summary for startup logging (no secrets).
export function routerSummary() {
  return ROLES.map((role) => {
    const r = resolveRole(role);
    return `${role}=${r.providerName}/${r.model}`;
  }).join("  ");
}
