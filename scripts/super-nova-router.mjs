import { boundedInt, env, safeText } from "./bos-omega-core.mjs";

export const ROLES = ["planner", "executor", "critic", "researcher"];
const DEFAULT_MAX_TOKENS = boundedInt(process.env.BOS_MAX_OUTPUT_TOKENS, 16_384, 1_024, 65_536);
const BOS_IDENTITY = `You are BOS OMEGA, Luis Lacerda's evidence-gated agentic operating system.
Discover and use only tools actually supplied to you. Never claim a tool call, file read, code change, test, deployment, or external action occurred unless its result is present in the conversation. Treat UNKNOWN as unknown. Protect credentials. Prefer concise execution-focused answers. Historical Bob or Robert identities are stale; the operator is Luis Lacerda.`;
const ROLE_PROMPTS = {
  planner: "Decompose the mission into complete, non-overlapping executable steps with measurable acceptance criteria.",
  executor: "Produce the actual deliverable. Use real tools when available; do not describe an action as though it happened.",
  critic: "Red-team the result, identify unsupported claims, missing proof, regressions, and unsafe assumptions.",
  researcher: "Use primary sources and real retrieval tools. Separate confirmed evidence, inference, assumptions, and unknowns.",
};

function configuredRoutes(role, callerModel) {
  const roleName = ROLES.includes(role) ? role : "executor";
  const roleModel = env(`SUPER_NOVA_${roleName.toUpperCase()}_MODEL`);
  const openAiModel = callerModel || roleModel || env("OPENAI_MODEL") || env("WORK_TREE_MODEL") || "gpt-5.6";
  const routes = [];
  if (env("OPENAI_API_KEY")) {
    const helicone = env("HELICONE_API_KEY");
    routes.push({
      provider: "openai",
      baseUrl: helicone ? (env("HELICONE_OPENAI_BASE_URL") || "https://oai.helicone.ai/v1") : (env("OPENAI_BASE_URL") || "https://api.openai.com/v1"),
      key: env("OPENAI_API_KEY"),
      model: openAiModel,
      headers: helicone ? { "Helicone-Auth": `Bearer ${helicone}`, "Helicone-Property-System": "BOS-OMEGA" } : {},
    });
  }
  if (env("KIMI_API_KEY") && env("KIMI_MODEL")) {
    routes.push({ provider: "kimi", baseUrl: env("KIMI_BASE_URL") || "https://api.moonshot.ai/v1", key: env("KIMI_API_KEY"), model: env("KIMI_MODEL"), headers: {} });
  }
  if (env("GEMINI_API_KEY")) {
    routes.push({ provider: "gemini", baseUrl: env("GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com/v1beta/openai", key: env("GEMINI_API_KEY"), model: env("GEMINI_MODEL") || "gemini-2.5-flash", headers: {} });
  }
  if (env("BITDEER_API_KEY") && (env("BITDEER_MODEL") || env("SUPER_NOVA_FALLBACK_MODEL"))) {
    routes.push({ provider: "bitdeer", baseUrl: env("BITDEER_BASE_URL") || "https://api-inference.bitdeer.ai/v1", key: env("BITDEER_API_KEY"), model: env("BITDEER_MODEL") || env("SUPER_NOVA_FALLBACK_MODEL"), headers: {} });
  }
  return { roleName, routes };
}

function systemMessages(role, messages) {
  const prompt = `${BOS_IDENTITY}\n\n[${role.toUpperCase()} MODE] ${ROLE_PROMPTS[role] || ROLE_PROMPTS.executor}`;
  if (messages?.[0]?.role === "system") {
    return [{ ...messages[0], content: `${prompt}\n\n${messages[0].content}` }, ...messages.slice(1)];
  }
  return [{ role: "system", content: prompt }, ...(messages || [])];
}

function transient(status) { return status === 408 || status === 409 || status === 429 || status >= 500; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function callRoute(route, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${route.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${route.key}`, "Content-Type": "application/json", ...route.headers },
      body: JSON.stringify({ ...payload, model: route.model }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`${route.provider} HTTP ${response.status}: ${safeText(text, 300)}`);
      error.status = response.status;
      throw error;
    }
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`${route.provider} returned invalid JSON`); }
    const message = data?.choices?.[0]?.message;
    if (!message || typeof message !== "object") throw new Error(`${route.provider} returned no assistant message`);
    return { message, usage: data.usage || null, provider: route.provider, model: route.model };
  } finally { clearTimeout(timer); }
}

export async function completeMessage({ role = "executor", messages, model, maxTokens = DEFAULT_MAX_TOKENS, temperature, timeoutMs = 120_000, tools, toolChoice = "auto" }) {
  const { roleName, routes } = configuredRoutes(role, model);
  if (!routes.length) throw new Error("BOS OMEGA router has no configured model provider");
  const payload = {
    messages: systemMessages(roleName, messages),
    max_tokens: boundedInt(maxTokens, DEFAULT_MAX_TOKENS, 1_024, 65_536),
    temperature: temperature ?? (roleName === "critic" ? 0 : 0.2),
    stream: false,
    ...(Array.isArray(tools) && tools.length ? { tools, tool_choice: toolChoice } : {}),
  };
  const attempts = [];
  for (const route of routes) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt > 1) await delay(Math.min(1000 * 2 ** (attempt - 2), 4000));
      try {
        const result = await callRoute(route, payload, timeoutMs);
        return { ...result, attempts: [...attempts, { provider: route.provider, model: route.model, attempt, status: "success" }] };
      } catch (error) {
        const status = Number(error?.status || 0);
        attempts.push({ provider: route.provider, model: route.model, attempt, status: "failed", httpStatus: status || null, error: safeText(error?.message || error, 300) });
        if (!transient(status) || attempt === 3) break;
      }
    }
  }
  const failure = new Error("all BOS OMEGA model routes failed");
  failure.attempts = attempts;
  throw failure;
}

export async function chatComplete(options) {
  const result = await completeMessage(options);
  const content = typeof result.message.content === "string" ? result.message.content : "";
  if (content) return content;
  if (Array.isArray(result.message.tool_calls) && result.message.tool_calls.length) return JSON.stringify({ tool_calls: result.message.tool_calls });
  return "";
}

export function resolveRole(role, callerModel) {
  const { roleName, routes } = configuredRoutes(role, callerModel);
  const first = routes[0];
  if (!first) throw new Error("BOS OMEGA router has no configured model provider");
  return { providerName: first.provider, provider: { baseURL: first.baseUrl, key: first.key }, model: first.model, temperature: roleName === "critic" ? 0 : 0.2, persona: `${BOS_IDENTITY}\n${ROLE_PROMPTS[roleName]}` };
}

export function routerSummary() {
  return ROLES.map((role) => {
    try { const route = resolveRole(role); return `${role}=${route.providerName}/${route.model}`; }
    catch { return `${role}=unconfigured`; }
  }).join("  ");
}

export { DEFAULT_MAX_TOKENS, BOS_IDENTITY };
