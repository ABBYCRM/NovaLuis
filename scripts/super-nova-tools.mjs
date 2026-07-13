// Backward-compatible entry point for Work Tree imports.
// The BOS OMEGA runtime is the single executable tool registry.

export {
  TOOL_DEFS,
  activeToolDefinitions,
  catalogDescribe,
  catalogSearch,
  runTool,
  runtimeSummary,
  toolCatalogText,
  toolsEnabledDangerous,
} from "./bos-omega-runtime.mjs";

export { toolCatalogText as catalogText } from "./bos-omega-runtime.mjs";
