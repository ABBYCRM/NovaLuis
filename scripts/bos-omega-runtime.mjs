import { capabilityReport, capabilityStatus, errorResult } from "./bos-omega-core.mjs";
import { READ_TOOLS } from "./bos-omega-manifest-read.mjs";
import { WRITE_TOOLS } from "./bos-omega-manifest-write.mjs";

const MANIFEST = [...READ_TOOLS, ...WRITE_TOOLS];
const MAP = new Map();
for (const entry of MANIFEST) {
  MAP.set(entry.name, entry);
  for (const alias of entry.aliases || []) {
    MAP.set(alias, { ...entry, name: alias, canonicalName: entry.name });
  }
}

export const TOOL_DEFS = MANIFEST.map(({ run, schema, ...entry }) => ({
  ...entry,
  inputSchema: schema,
  enabledByDefault: !entry.requiresAuth && !entry.internalOnly,
}));

export function catalogSearch(query, category) {
  const needle = String(query || "").toLowerCase();
  const targetCategory = category ? String(category).toLowerCase() : null;
  return TOOL_DEFS.filter((entry) => {
    const haystack = `${entry.name} ${entry.category} ${entry.description}`.toLowerCase();
    return haystack.includes(needle) && (!targetCategory || entry.category === targetCategory);
  });
}

export function catalogDescribe(name) {
  const entry = MAP.get(String(name || ""));
  return entry
    ? {
        name: entry.name,
        canonicalName: entry.canonicalName || entry.name,
        category: entry.category,
        risk: entry.risk,
        description: entry.description,
        inputSchema: entry.schema,
        requiresAuth: entry.requiresAuth,
        requiresApproval: entry.requiresApproval,
        internalOnly: entry.internalOnly,
        capability: entry.capability,
      }
    : null;
}

function configured(entry) {
  if (!entry.capability) return true;
  const status = capabilityStatus(entry.capability).status;
  return ![
    "missing_configuration",
    "adapter_not_implemented",
    "disabled",
    "unknown_capability",
  ].includes(status);
}

function allowed(entry, context = {}) {
  if (entry.requiresAuth && context.authenticated !== true && context.internalWorker !== true) return false;
  if (entry.requiresApproval && context.approvalGranted !== true) return false;
  if (entry.internalOnly && context.internalWorker !== true) return false;
  return true;
}

export function activeToolDefinitions(context = {}) {
  return [...MAP.entries()]
    .filter(([name, entry]) => name === entry.name)
    .filter(([, entry]) => configured(entry) && allowed(entry, context))
    .map(([, entry]) => ({
      type: "function",
      function: {
        name: entry.name,
        description: entry.description,
        parameters: entry.schema,
      },
    }));
}

export function toolCatalogText(input = false) {
  const context = typeof input === "object"
    ? input
    : {
        authenticated: input === true,
        approvalGranted: input === true,
        internalWorker: input === true,
      };
  return [
    "=== BOS OMEGA TOOL REGISTRY ===",
    ...MANIFEST.map((entry) => {
      const capability = entry.capability ? capabilityStatus(entry.capability).status : "available";
      return `  ${entry.name} [${allowed(entry, context) ? "ACTIVE" : "LOCKED"}; ${entry.risk}; ${capability}] — ${entry.description}`;
    }),
  ].join("\n");
}

export function toolsEnabledDangerous() {
  return false;
}

export async function runTool(name, args = {}, context = {}) {
  const entry = MAP.get(String(name || ""));
  if (!entry) return errorResult("unknown_tool", `unknown tool '${String(name || "")}'`);
  if (!configured(entry)) {
    return errorResult(
      "tool_unavailable",
      `tool '${entry.canonicalName || entry.name}' is not configured`,
      entry.capability ? { capability: capabilityStatus(entry.capability) } : undefined,
    );
  }
  if (entry.requiresAuth && context.authenticated !== true && context.internalWorker !== true) {
    return errorResult("authentication_required", `tool '${entry.canonicalName || entry.name}' requires authenticated context`);
  }
  if (entry.requiresApproval && context.approvalGranted !== true) {
    return errorResult("approval_required", `tool '${entry.canonicalName || entry.name}' requires explicit per-call approval`);
  }
  if (entry.internalOnly && context.internalWorker !== true) {
    return errorResult("internal_tool", `tool '${entry.canonicalName || entry.name}' is available only to an internal worker`);
  }
  try {
    const safeContext = {
      runId: context.runId || null,
      authenticated: context.authenticated === true,
      approvalGranted: context.approvalGranted === true,
      internalWorker: context.internalWorker === true,
    };
    const result = await entry.run(args || {}, safeContext);
    return result && typeof result === "object" ? result : { result };
  } catch (error) {
    return errorResult("tool_failed", error?.message || error);
  }
}

export function runtimeSummary(context = {}) {
  return {
    capabilities: capabilityReport(),
    activeTools: activeToolDefinitions(context).map((entry) => entry.function.name),
    hostExecutionEnabled: false,
  };
}
