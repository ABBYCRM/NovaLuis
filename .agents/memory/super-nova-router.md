---

name: "Super Nova model router"
description: >-
Central provider and model routing for Super Nova Work Tree roles, with
OpenAI as the primary provider, Gemini and Bitdeer fallbacks, atomic
provider-model switching, provider-aware output limits, and safe final-answer
extraction.
-----------

# Super Nova Model Router

## Scope

The central model router is implemented in:

```text
scripts/super-nova-router.mjs
```

Every Work Tree LLM call must pass through this router.

The router is responsible for:

* Mapping logical roles to providers
* Selecting provider-compatible models
* Using OpenAI as the primary provider
* Falling back to Gemini and Bitdeer
* Resolving environment-variable overrides
* Validating provider usability on every call
* Translating canonical requests into provider-specific API formats
* Enforcing output-token budgets
* Classifying retriable and terminal failures
* Preventing provider-specific model leakage
* Returning final answer content without exposing reasoning traces
* Recording every attempted provider and model

No Work Tree component may independently construct provider or model routes.

---

# 1. Central Routing Invariant

```text
LOGICAL ROLE
→ CENTRAL ROUTER
→ ATOMIC PROVIDER + MODEL ROUTE
→ PROVIDER ADAPTER
→ NORMALIZED RESPONSE
```

Required roles:

```text
planner
executor
critic
researcher
```

The Work Tree worker must pass an explicit role for every LLM request.

---

# 2. Provider Priority

Default provider order:

```text
1. OpenAI
2. Gemini
3. Bitdeer
```

OpenAI is the primary provider whenever:

```text
OPENAI_API_KEY is configured
AND
the selected OpenAI route is usable
AND
the selected model supports the request
```

Fallback order:

```text
OpenAI
→ Gemini
→ Bitdeer
```

A missing provider key must cause that route to be skipped before an HTTP request is attempted.

---

# 3. Default Models

Use one authoritative configuration source.

```js
export const DEFAULT_PROVIDER = "openai";

export const DEFAULT_MODELS = Object.freeze({
  openai:
    process.env.OPENAI_DEFAULT_MODEL ??
    "gpt-5.6",

  gemini:
    process.env.GEMINI_DEFAULT_MODEL ??
    "gemini-2.5-flash",

  bitdeer:
    process.env.BITDEER_DEFAULT_MODEL ??
    "moonshotai/Kimi-K2.6",
});
```

Role defaults:

```js
export const ROLE_DEFAULTS = Object.freeze({
  planner: {
    provider: "openai",
    model:
      process.env.SUPER_NOVA_PLANNER_MODEL ??
      DEFAULT_MODELS.openai,
  },

  executor: {
    provider: "openai",
    model:
      process.env.SUPER_NOVA_EXECUTOR_MODEL ??
      DEFAULT_MODELS.openai,
  },

  critic: {
    provider: "openai",
    model:
      process.env.SUPER_NOVA_CRITIC_MODEL ??
      DEFAULT_MODELS.openai,
  },

  researcher: {
    provider: "openai",
    model:
      process.env.SUPER_NOVA_RESEARCHER_MODEL ??
      DEFAULT_MODELS.openai,
  },
});
```

The exact OpenAI model may be changed through environment variables without editing code.

---

# 4. Environment Overrides

Supported role-specific overrides:

```text
SUPER_NOVA_PLANNER_PROVIDER
SUPER_NOVA_PLANNER_MODEL

SUPER_NOVA_EXECUTOR_PROVIDER
SUPER_NOVA_EXECUTOR_MODEL

SUPER_NOVA_CRITIC_PROVIDER
SUPER_NOVA_CRITIC_MODEL

SUPER_NOVA_RESEARCHER_PROVIDER
SUPER_NOVA_RESEARCHER_MODEL
```

Supported global compatibility overrides:

```text
WORK_TREE_PROVIDER
WORK_TREE_MODEL
```

Precedence:

```text
role-specific override
→ global Work Tree override
→ role default
→ provider default
```

Example:

```js
function roleEnvName(role, suffix) {
  return `SUPER_NOVA_${role.toUpperCase()}_${suffix}`;
}

function readRoleOverride(role) {
  return {
    provider:
      process.env[roleEnvName(role, "PROVIDER")] ??
      process.env.WORK_TREE_PROVIDER,

    model:
      process.env[roleEnvName(role, "MODEL")] ??
      process.env.WORK_TREE_MODEL,
  };
}
```

---

# 5. Provider and Model Are Atomic

Critical invariant:

```text
PROVIDER
+
MODEL
=
ONE ATOMIC ROUTE
```

Changing the provider requires recomputing or validating the model.

Forbidden:

```text
provider = gemini
model = gemini-2.5-flash

Gemini unavailable
→ provider changed to bitdeer
→ model remains gemini-2.5-flash
```

Correct:

```text
Gemini unavailable
→ select Bitdeer route
→ select Bitdeer-compatible fallback model
```

The model must never be carried blindly from one provider to another.

---

# 6. Provider Registry

Provider definitions must store the environment-variable name, not a key value captured at module import.

```js
export const PROVIDERS = Object.freeze({
  openai: {
    name: "openai",
    apiType: "openai-responses",
    baseUrl:
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1",

    keyEnv: "OPENAI_API_KEY",
    defaultModel: DEFAULT_MODELS.openai,
  },

  gemini: {
    name: "gemini",
    apiType: "gemini",
    baseUrl:
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com",

    keyEnv: "GEMINI_API_KEY",
    defaultModel: DEFAULT_MODELS.gemini,
  },

  bitdeer: {
    name: "bitdeer",
    apiType: "openai-chat-compatible",
    baseUrl:
      process.env.BITDEER_BASE_URL,

    keyEnv: "BITDEER_API_KEY",
    defaultModel: DEFAULT_MODELS.bitdeer,
  },
});
```

Read the credential on every route resolution or request:

```js
export function getProviderKey(provider) {
  const value =
    process.env[provider.keyEnv];

  return typeof value === "string"
    ? value.trim()
    : "";
}
```

Do not do this:

```js
const PROVIDERS = {
  openai: {
    key: process.env.OPENAI_API_KEY,
  },
};
```

That captures the value once at module import.

---

# 7. Provider Usability

```js
export function providerUsable(providerName) {
  const provider =
    PROVIDERS[providerName];

  if (!provider) {
    return false;
  }

  const key =
    getProviderKey(provider);

  if (!key) {
    return false;
  }

  if (
    providerName === "bitdeer" &&
    !provider.baseUrl
  ) {
    return false;
  }

  return true;
}
```

Because the key is read from `process.env` during each call:

```text
key added at runtime
→ next request sees it

key removed at runtime
→ next request treats provider as unavailable
```

No process restart is required merely to refresh the key lookup.

---

# 8. Model Compatibility Registry

```js
export const MODEL_RULES = Object.freeze({
  openai: {
    prefixes: [
      "gpt-",
      "o1",
      "o3",
      "o4",
    ],

    defaultModel:
      DEFAULT_MODELS.openai,

    maximumOutputTokens: 131072,
  },

  gemini: {
    prefixes: [
      "gemini-",
    ],

    defaultModel:
      DEFAULT_MODELS.gemini,

    maximumOutputTokens:
      Number(
        process.env
          .GEMINI_MAX_OUTPUT_TOKENS ??
        32768,
      ),
  },

  bitdeer: {
    prefixes: [
      "moonshotai/",
      "deepseek-ai/",
      "qwen/",
      "meta/",
    ],

    defaultModel:
      DEFAULT_MODELS.bitdeer,

    maximumOutputTokens:
      Number(
        process.env
          .BITDEER_MAX_OUTPUT_TOKENS ??
        32768,
      ),
  },
});
```

Provider limits must remain configurable because available models and provider limits can change independently.

---

# 9. Model Ownership Detection

```js
export function inferModelProvider(
  model,
) {
  if (!model) {
    return null;
  }

  for (
    const [
      providerName,
      rules,
    ] of Object.entries(MODEL_RULES)
  ) {
    if (
      rules.prefixes.some(
        (prefix) =>
          model.startsWith(prefix),
      )
    ) {
      return providerName;
    }
  }

  return null;
}
```

Model-prefix detection is advisory.

The authoritative validation must come from:

```text
provider model registry
or
provider model-discovery API
```

when available.

---

# 10. Correct Role Resolution

```js
export function resolveRole(
  role,
  {
    callerProvider,
    callerModel,
  } = {},
) {
  const normalizedRole =
    String(role).toLowerCase();

  const defaults =
    ROLE_DEFAULTS[normalizedRole];

  if (!defaults) {
    throw new Error(
      `UNKNOWN_SUPER_NOVA_ROLE:${role}`,
    );
  }

  const override =
    readRoleOverride(normalizedRole);

  const requestedProvider =
    override.provider ??
    callerProvider ??
    defaults.provider;

  const requestedModel =
    override.model ??
    callerModel ??
    defaults.model;

  const candidates =
    buildRouteCandidates({
      requestedProvider,
      requestedModel,
    });

  const usableRoutes =
    candidates.filter(
      (route) =>
        providerUsable(route.provider),
    );

  if (usableRoutes.length === 0) {
    throw new Error(
      "NO_USABLE_LLM_PROVIDER",
    );
  }

  return usableRoutes;
}
```

---

# 11. Route Candidate Construction

```js
function routeForProvider(
  providerName,
  requestedModel,
) {
  const provider =
    PROVIDERS[providerName];

  const rules =
    MODEL_RULES[providerName];

  if (!provider || !rules) {
    throw new Error(
      `UNKNOWN_PROVIDER:${providerName}`,
    );
  }

  const inferredProvider =
    inferModelProvider(requestedModel);

  const compatible =
    !inferredProvider ||
    inferredProvider === providerName;

  const model = compatible
    ? requestedModel
    : rules.defaultModel;

  return {
    provider: providerName,
    model:
      model ??
      provider.defaultModel,
  };
}

export function buildRouteCandidates({
  requestedProvider,
  requestedModel,
}) {
  const providerOrder = [
    requestedProvider,
    "openai",
    "gemini",
    "bitdeer",
  ].filter(
    (value, index, array) =>
      value &&
      array.indexOf(value) === index,
  );

  return providerOrder.map(
    (providerName) =>
      routeForProvider(
        providerName,
        requestedModel,
      ),
  );
}
```

Example:

```text
requested provider = gemini
requested model = gemini-2.5-flash
Gemini key missing
```

Resolved candidates:

```text
OpenAI:
provider = openai
model = gpt-5.6

Bitdeer:
provider = bitdeer
model = moonshotai/Kimi-K2.6
```

The Gemini model is not copied into either fallback route.

---

# 12. Output-Token Budgets

The previous limit:

```text
maxTokens: 2000
```

is forbidden.

It is too small for:

* Long ReAct steps
* Repository reports
* Multi-file implementation plans
* Large structured deliverables
* Detailed critiques
* Final mission reports
* JSON outputs

---

## Required Defaults

```js
export const TOKEN_BUDGETS =
  Object.freeze({
    reactStep: 16384,
    normalFinal: 32768,
    budgetExhausted: 32768,
    largeDeliverable: 65536,
  });
```

Minimum standard:

```text
ReAct step:
16,384 tokens

Normal final:
32,768 tokens

Budget-exhausted final:
32,768 tokens

Explicit large deliverable:
65,536 tokens when supported
```

---

# 13. Environment Token Overrides

```text
SUPER_NOVA_REACT_MAX_OUTPUT_TOKENS
SUPER_NOVA_FINAL_MAX_OUTPUT_TOKENS
SUPER_NOVA_BUDGET_EXHAUSTED_MAX_OUTPUT_TOKENS
SUPER_NOVA_LARGE_MAX_OUTPUT_TOKENS
```

Example:

```js
function positiveInteger(
  value,
  fallback,
) {
  const parsed =
    Number.parseInt(value ?? "", 10);

  return Number.isSafeInteger(parsed) &&
    parsed > 0
    ? parsed
    : fallback;
}

export const TOKEN_BUDGETS =
  Object.freeze({
    reactStep: positiveInteger(
      process.env
        .SUPER_NOVA_REACT_MAX_OUTPUT_TOKENS,
      16384,
    ),

    normalFinal: positiveInteger(
      process.env
        .SUPER_NOVA_FINAL_MAX_OUTPUT_TOKENS,
      32768,
    ),

    budgetExhausted: positiveInteger(
      process.env
        .SUPER_NOVA_BUDGET_EXHAUSTED_MAX_OUTPUT_TOKENS,
      32768,
    ),

    largeDeliverable: positiveInteger(
      process.env
        .SUPER_NOVA_LARGE_MAX_OUTPUT_TOKENS,
      65536,
    ),
  });
```

---

# 14. Provider-Aware Token Clamping

Do not send a token value unsupported by the chosen provider or model.

```js
export function resolveMaxOutputTokens(
  providerName,
  requested,
) {
  const providerLimit =
    MODEL_RULES[providerName]
      ?.maximumOutputTokens;

  if (
    !Number.isSafeInteger(
      providerLimit,
    ) ||
    providerLimit <= 0
  ) {
    throw new Error(
      `PROVIDER_OUTPUT_LIMIT_UNKNOWN:${providerName}`,
    );
  }

  return Math.min(
    Math.max(requested, 16),
    providerLimit,
  );
}
```

Record both:

```text
requested output tokens
effective output tokens
```

Example:

```json
{
  "requestedMaxOutputTokens": 65536,
  "effectiveMaxOutputTokens": 32768,
  "provider": "bitdeer",
  "model": "moonshotai/Kimi-K2.6"
}
```

Do not silently clamp without recording it.

---

# 15. Canonical Request Shape

The Work Tree must create one provider-neutral request:

```js
{
  role: "planner",
  instructions: "...",
  input: "...",
  outputMode: "json",
  maxOutputTokens: 16384,
  reasoningEffort: "medium"
}
```

Provider adapters translate this into the correct API request.

---

# 16. OpenAI Primary Adapter

OpenAI requests should use the Responses API.

```js
import OpenAI from "openai";

async function callOpenAI({
  route,
  request,
}) {
  const key =
    getProviderKey(
      PROVIDERS.openai,
    );

  const client = new OpenAI({
    apiKey: key,
    baseURL:
      PROVIDERS.openai.baseUrl,
  });

  const maxOutputTokens =
    resolveMaxOutputTokens(
      "openai",
      request.maxOutputTokens,
    );

  const response =
    await client.responses.create({
      model: route.model,

      instructions:
        request.instructions,

      input:
        request.input,

      max_output_tokens:
        maxOutputTokens,

      reasoning:
        request.reasoningEffort
          ? {
              effort:
                request.reasoningEffort,
            }
          : undefined,
    });

  return normalizeOpenAIResponse(
    response,
    {
      route,
      maxOutputTokens,
    },
  );
}
```

The canonical router property remains:

```text
maxOutputTokens
```

The OpenAI adapter converts it to:

```text
max_output_tokens
```

---

# 17. OpenAI Output Extraction

```js
function normalizeOpenAIResponse(
  response,
  metadata,
) {
  const content =
    response.output_text?.trim();

  if (!content) {
    if (
      response.incomplete_details
        ?.reason ===
      "max_output_tokens"
    ) {
      throw new RouterError(
        "OUTPUT_TRUNCATED",
        {
          provider: "openai",
          model:
            metadata.route.model,
        },
      );
    }

    throw new RouterError(
      "EMPTY_FINAL_CONTENT",
      {
        provider: "openai",
        model:
          metadata.route.model,
      },
    );
  }

  return {
    content,

    provider: "openai",
    model:
      metadata.route.model,

    requestedMaxOutputTokens:
      metadata.maxOutputTokens,

    responseId:
      response.id,

    incompleteReason:
      response.incomplete_details
        ?.reason ??
      null,
  };
}
```

Do not extract internal reasoning as the final answer.

---

# 18. Gemini Adapter

The Gemini adapter must translate:

```text
maxOutputTokens
```

into the correct Gemini generation configuration.

Conceptual shape:

```js
async function callGemini({
  route,
  request,
}) {
  const maxOutputTokens =
    resolveMaxOutputTokens(
      "gemini",
      request.maxOutputTokens,
    );

  return geminiGenerate({
    model: route.model,
    systemInstruction:
      request.instructions,
    contents: request.input,
    generationConfig: {
      maxOutputTokens,
    },
  });
}
```

The exact SDK request must match the installed Gemini SDK version.

---

# 19. Bitdeer Adapter

For OpenAI-compatible Bitdeer chat completion:

```js
async function callBitdeer({
  route,
  request,
}) {
  const maxTokens =
    resolveMaxOutputTokens(
      "bitdeer",
      request.maxOutputTokens,
    );

  const response =
    await fetch(
      `${PROVIDERS.bitdeer.baseUrl}/chat/completions`,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${getProviderKey(
              PROVIDERS.bitdeer,
            )}`,

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          model: route.model,

          messages: [
            {
              role: "system",
              content:
                request.instructions,
            },
            {
              role: "user",
              content:
                request.input,
            },
          ],

          max_tokens:
            maxTokens,
        }),
      },
    );

  return normalizeCompatibleChatResponse(
    response,
    route,
    maxTokens,
  );
}
```

If Bitdeer expects `max_completion_tokens` instead of `max_tokens`, that must be declared in the provider adapter rather than guessed globally.

---

# 20. Reasoning Content Is Not Final Content

Some reasoning models return:

```text
reasoning_content
```

separately from:

```text
content
```

`reasoning_content` must be treated as internal reasoning data.

It must not be:

* Returned to the Work Tree as the final answer
* Fed into the ReAct parser as an action
* Displayed to the user
* Stored as the final result
* Used merely because `content` is empty

Forbidden:

```js
const output =
  message.content ||
  message.reasoning_content;
```

---

# 21. Empty Final Content Recovery

Correct behavior:

```text
content present
→ use content

content empty
+ reasoning_content present
→ do not expose reasoning_content
→ request a final-only continuation once

continuation still empty
→ EMPTY_FINAL_CONTENT
```

Example:

```js
async function recoverFinalContent({
  route,
  originalRequest,
  previousResponse,
}) {
  const retryRequest = {
    ...originalRequest,

    instructions: [
      originalRequest.instructions,
      "",
      "Return only the final answer.",
      "Do not return analysis, reasoning traces,",
      "thought JSON, or tool-planning data.",
    ].join("\n"),

    input: [
      originalRequest.input,
      "",
      "Your previous response did not contain",
      "a visible final answer. Produce the",
      "final result now.",
    ].join("\n"),

    maxOutputTokens:
      Math.max(
        originalRequest
          .maxOutputTokens,
        TOKEN_BUDGETS.normalFinal,
      ),
  };

  return executeSingleRoute(
    route,
    retryRequest,
    {
      recoveryAttempt: true,
      previousResponse,
    },
  );
}
```

Maximum final-content recovery attempts:

```text
1
```

Do not create an infinite retry loop.

---

# 22. JSON Output Handling

For normal ReAct steps, structured JSON may be requested.

Required behavior:

```text
complete JSON
→ parse

JSON wrapped in Markdown fence
→ extract and parse

valid object with final property
→ extract final

truncated or invalid JSON
→ classify parsing failure
→ do not store broken JSON as success
```

---

# 23. Budget-Exhausted Final Call

When the ReAct step budget is exhausted, request plain Markdown rather than a JSON wrapper.

```js
const budgetExhaustedRequest = {
  role,
  instructions: [
    baseInstructions,
    "",
    "The execution-step budget is exhausted.",
    "Return the best verified final deliverable",
    "in plain Markdown.",
    "Do not wrap it in JSON.",
    "Clearly label incomplete or unverified parts.",
  ].join("\n"),

  input: accumulatedContext,

  outputMode: "markdown",

  maxOutputTokens:
    TOKEN_BUDGETS
      .budgetExhausted,
};
```

Default:

```text
32,768 output tokens
```

For exceptionally large deliverables:

```text
65,536 output tokens
```

may be requested when the chosen model supports it.

---

# 24. Truncation Detection

A response that ends because of the token limit is not complete.

Normalized finish classes:

```text
COMPLETE
OUTPUT_TRUNCATED
CONTENT_FILTERED
EMPTY_FINAL_CONTENT
PROVIDER_FAILED
```

If truncation is detected:

```text
do not parse as complete JSON
do not mark mission complete
do not store as verified final
```

Recovery options:

```text
increase output budget within model limit
or
request continuation using previous response state
or
switch final output to plain Markdown
or
split the deliverable into bounded sections
```

---

# 25. Retry and Fallback Chain

Default chain for transient provider failures:

```text
Attempt 0:
OpenAI primary model
no delay

Attempt 1:
OpenAI primary model
2-second backoff

Attempt 2:
OpenAI primary model
4-second backoff

Attempt 3:
Gemini flash route
8-second backoff

Attempt 4:
Gemini pro route
16-second backoff

Attempt 5:
Bitdeer last-resort route
32-second backoff
```

Example route construction:

```js
export function buildAttemptPlan(
  role,
  request,
) {
  const openAIModel =
    resolveProviderModel(
      role,
      "openai",
    );

  const geminiFlash =
    process.env
      .GEMINI_FLASH_MODEL ??
    "gemini-2.5-flash";

  const geminiPro =
    process.env
      .GEMINI_PRO_MODEL ??
    "gemini-2.5-pro";

  const bitdeerLastResort =
    process.env
      .BITDEER_LAST_RESORT_MODEL ??
    "deepseek-ai/DeepSeek-V3";

  return [
    {
      provider: "openai",
      model: openAIModel,
      delayMs: 0,
    },
    {
      provider: "openai",
      model: openAIModel,
      delayMs: 2000,
    },
    {
      provider: "openai",
      model: openAIModel,
      delayMs: 4000,
    },
    {
      provider: "gemini",
      model: geminiFlash,
      delayMs: 8000,
    },
    {
      provider: "gemini",
      model: geminiPro,
      delayMs: 16000,
    },
    {
      provider: "bitdeer",
      model:
        bitdeerLastResort,
      delayMs: 32000,
    },
  ].filter(
    (route) =>
      providerUsable(
        route.provider,
      ),
  );
}
```

---

# 26. Failure Classification

```js
export function classifyProviderError(
  error,
) {
  const status =
    Number(
      error?.status ??
      error?.response?.status,
    );

  if (status === 400) {
    return "INVALID_REQUEST";
  }

  if (
    status === 401 ||
    status === 403
  ) {
    return "AUTHENTICATION_FAILED";
  }

  if (status === 404) {
    return "MODEL_OR_ENDPOINT_NOT_FOUND";
  }

  if (status === 408) {
    return "REQUEST_TIMEOUT";
  }

  if (status === 409) {
    return "PROVIDER_CONFLICT";
  }

  if (status === 429) {
    return "RATE_LIMITED";
  }

  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return "PROVIDER_UNAVAILABLE";
  }

  return "UNKNOWN_PROVIDER_FAILURE";
}
```

---

# 27. Retriable Failures

Retry or fall through for:

```text
REQUEST_TIMEOUT
RATE_LIMITED
PROVIDER_UNAVAILABLE
transient network errors
```

Honor:

```text
Retry-After
```

when supplied.

---

# 28. Terminal Failures

Do not spend same-route retry budget on:

```text
INVALID_REQUEST
AUTHENTICATION_FAILED
MODEL_OR_ENDPOINT_NOT_FOUND
PROVIDER_CONFLICT
```

Default behavior:

```text
400
→ throw immediately

401 or 403
→ throw immediately

404
→ throw immediately
```

A missing key is different:

```text
key absent during route preflight
→ skip provider
→ select next usable provider
```

An invalid configured key is a real configuration failure and must not be silently hidden by repeated retries.

---

# 29. Attempt Ledger

Every attempt must record:

```js
{
  attempt: 0,
  role: "planner",
  provider: "openai",
  model: "gpt-5.6",
  requestedMaxOutputTokens: 16384,
  effectiveMaxOutputTokens: 16384,
  startedAt: "...",
  completedAt: "...",
  status: "SUCCEEDED",
  failureClass: null,
  responseId: "..."
}
```

Never record raw API keys.

---

# 30. Router Execution

```js
export async function runRole({
  role,
  instructions,
  input,
  outputMode = "json",
  maxOutputTokens =
    TOKEN_BUDGETS.reactStep,
  reasoningEffort = "medium",
  callerProvider,
  callerModel,
}) {
  const routes =
    resolveRole(role, {
      callerProvider,
      callerModel,
    });

  const request = {
    role,
    instructions,
    input,
    outputMode,
    maxOutputTokens,
    reasoningEffort,
  };

  const attempts = [];

  for (
    let index = 0;
    index < routes.length;
    index += 1
  ) {
    const route =
      routes[index];

    const startedAt =
      new Date().toISOString();

    try {
      const result =
        await executeSingleRoute(
          route,
          request,
        );

      attempts.push({
        attempt: index,
        provider:
          route.provider,
        model: route.model,
        startedAt,
        completedAt:
          new Date().toISOString(),
        status: "SUCCEEDED",
      });

      return {
        ...result,
        attempts,
      };
    } catch (error) {
      const failureClass =
        classifyProviderError(
          error,
        );

      attempts.push({
        attempt: index,
        provider:
          route.provider,
        model: route.model,
        startedAt,
        completedAt:
          new Date().toISOString(),
        status: "FAILED",
        failureClass,
      });

      if (
        [
          "INVALID_REQUEST",
          "AUTHENTICATION_FAILED",
          "MODEL_OR_ENDPOINT_NOT_FOUND",
          "PROVIDER_CONFLICT",
        ].includes(failureClass)
      ) {
        throw new RouterExecutionError(
          failureClass,
          attempts,
          {
            cause: error,
          },
        );
      }

      if (
        index ===
        routes.length - 1
      ) {
        throw new RouterExecutionError(
          "ALL_PROVIDER_ROUTES_FAILED",
          attempts,
          {
            cause: error,
          },
        );
      }

      const delayMs =
        routes[index + 1]
          ?.delayMs ??
        0;

      await sleep(delayMs);
    }
  }

  throw new RouterExecutionError(
    "NO_ROUTE_EXECUTED",
    attempts,
  );
}
```

---

# 31. Worker Default Consistency

`work-tree-worker.mjs` must not define an independent model constant.

Forbidden:

```js
const DEFAULT_MODEL =
  "gemini-2.5-flash";
```

Correct:

```js
import {
  DEFAULT_PROVIDER,
  DEFAULT_MODELS,
  resolveRole,
  TOKEN_BUDGETS,
} from "./super-nova-router.mjs";
```

Startup logging:

```js
const startupRoute =
  resolveRole("planner")[0];

logger.info({
  provider:
    startupRoute.provider,
  model:
    startupRoute.model,
  reactMaxOutputTokens:
    TOKEN_BUDGETS.reactStep,
  finalMaxOutputTokens:
    TOKEN_BUDGETS.normalFinal,
});
```

This guarantees the startup message reflects the route the router will actually use.

---

# 32. `WORK_TREE_MODEL` Consistency

When set:

```text
WORK_TREE_MODEL=<model>
```

the same value must be observed by:

* Startup logging
* Role resolution
* Worker caller defaults
* Attempt ledger
* Provider compatibility validation

A worker must not log one model while invoking another.

---

# 33. Provider Override Rule

Provider-only override:

```text
SUPER_NOVA_PLANNER_PROVIDER=openai
```

Result:

```text
OpenAI selected
+ OpenAI default model selected
```

Provider and compatible model:

```text
SUPER_NOVA_PLANNER_PROVIDER=openai
SUPER_NOVA_PLANNER_MODEL=gpt-5.6
```

Result:

```text
OpenAI selected
+ requested OpenAI model selected
```

Provider and incompatible model:

```text
SUPER_NOVA_PLANNER_PROVIDER=bitdeer
SUPER_NOVA_PLANNER_MODEL=gemini-2.5-flash
```

Result:

```text
configuration rejected
or
Bitdeer model recomputed from Bitdeer defaults
```

The router must never send `gemini-2.5-flash` to Bitdeer.

---

# 34. Required Tests

Test location:

```text
scripts/test/super-nova-router.test.mjs
```

Required tests:

```text
OpenAI is selected first when OPENAI_API_KEY exists.

Missing OpenAI key falls through to Gemini.

Missing OpenAI and Gemini keys falls through to Bitdeer.

Missing every provider key fails with NO_USABLE_LLM_PROVIDER.

Provider-only override selects that provider's default model.

Provider-specific model does not leak into a fallback provider.

Gemini model is replaced when falling back to OpenAI.

Gemini model is replaced when falling back to Bitdeer.

OpenAI model is replaced when falling back to Gemini.

OpenAI model is replaced when falling back to Bitdeer.

Provider key changes in process.env are observed on the next call.

ReAct default output budget is 16,384.

Final default output budget is 32,768.

Large deliverable budget can request 65,536.

Requested tokens are clamped to the provider limit.

Token clamping is recorded in the attempt ledger.

OpenAI adapter sends max_output_tokens.

Bitdeer adapter sends its supported token parameter.

Truncated output is not accepted as complete JSON.

Empty content does not fall back directly to reasoning_content.

Final-only recovery is attempted at most once.

400 errors are not retried.

401 and 403 errors are not retried.

404 errors are not retried.

429 errors follow the fallback policy.

503 errors follow the fallback policy.

Startup log route matches actual planner route.

WORK_TREE_MODEL affects both startup logging and execution.
```

---

# 35. Regression Test: Provider-Model Swap

```js
it(
  "swaps a Gemini model when Gemini is unavailable",
  () => {
    delete process.env
      .GEMINI_API_KEY;

    process.env
      .OPENAI_API_KEY =
      "test-openai-key";

    const routes =
      resolveRole(
        "planner",
        {
          callerProvider:
            "gemini",

          callerModel:
            "gemini-2.5-flash",
        },
      );

    expect(routes[0]).toEqual({
      provider: "openai",
      model: "gpt-5.6",
    });
  },
);
```

---

# 36. Regression Test: Dynamic Provider Key

```js
it(
  "reads provider credentials per call",
  () => {
    delete process.env
      .OPENAI_API_KEY;

    expect(
      providerUsable("openai"),
    ).toBe(false);

    process.env
      .OPENAI_API_KEY =
      "runtime-added-key";

    expect(
      providerUsable("openai"),
    ).toBe(true);

    delete process.env
      .OPENAI_API_KEY;

    expect(
      providerUsable("openai"),
    ).toBe(false);
  },
);
```

---

# 37. Regression Test: 16K Minimum

```js
it(
  "uses at least 16K for ReAct output",
  () => {
    expect(
      TOKEN_BUDGETS.reactStep,
    ).toBeGreaterThanOrEqual(
      16384,
    );
  },
);
```

---

# 38. Regression Test: No Reasoning Leakage

```js
it(
  "does not treat reasoning_content as final output",
  async () => {
    const message = {
      content: "",
      reasoning_content:
        JSON.stringify({
          thought:
            "private reasoning",
          tool:
            "internal action",
        }),
    };

    expect(() =>
      extractCompatibleFinalContent(
        message,
      ),
    ).toThrow(
      "EMPTY_FINAL_CONTENT",
    );
  },
);
```

---

# 39. Release Gate

Before deployment:

```text
router tests pass
+ worker tests pass
+ build passes
+ OpenAI route tested
+ Gemini fallback tested
+ Bitdeer fallback tested
+ provider/model swap tested
+ 16K ReAct output verified
+ 32K final output verified
+ truncation behavior verified
+ reasoning_content leakage test passes
```

Required command evidence:

```text
test command
exit code
build command
exit code
provider/model attempt ledger
```

---

# 40. Prohibited Regressions

```text
Do not use Gemini as the default primary provider.

Do not define a duplicate DEFAULT_MODEL in work-tree-worker.mjs.

Do not change provider without changing or validating the model.

Do not capture API-key values only once at module import.

Do not use maxTokens: 2000.

Do not hardcode one output limit for every provider.

Do not send an unsupported output limit without clamping.

Do not silently truncate structured output.

Do not store malformed JSON as a successful result.

Do not use reasoning_content as the final answer.

Do not expose chain-of-thought or internal reasoning traces.

Do not retry 400, 401, 403, or 404 errors unchanged.

Do not claim a fallback succeeded without recording the provider and model.

Do not allow startup logs to disagree with actual routing.
```

---

# 41. Final Invariant

```text
PRIMARY PROVIDER
=
OPENAI

DEFAULT OPENAI MODEL
=
gpt-5.6
unless overridden

FALLBACK ORDER
=
OPENAI
→ GEMINI
→ BITDEER

REACT OUTPUT
=
16,384 TOKENS MINIMUM

FINAL OUTPUT
=
32,768 TOKENS DEFAULT

LARGE DELIVERABLE
=
65,536 TOKENS WHEN SUPPORTED

PROVIDER FALLBACK
=
RECOMPUTE MODEL

EMPTY CONTENT
=
DO NOT USE REASONING_CONTENT

DONE
=
CORRECT ROLE
+ CORRECT PROVIDER
+ COMPATIBLE MODEL
+ SUFFICIENT OUTPUT BUDGET
+ VALID FINAL CONTENT
+ RECORDED EVIDENCE
```

**END OF SPEC**
