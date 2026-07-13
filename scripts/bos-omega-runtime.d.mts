export interface BosToolContext {
  runId?: string | number | null;
  authenticated?: boolean;
  approvalGranted?: boolean;
  internalWorker?: boolean;
}
export interface OpenAiToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export declare const TOOL_DEFS: Array<Record<string, unknown>>;
export declare function activeToolDefinitions(context?: BosToolContext): OpenAiToolDefinition[];
export declare function catalogSearch(query: unknown, category?: unknown): Array<Record<string, unknown>>;
export declare function catalogDescribe(name: unknown): Record<string, unknown> | null;
export declare function toolCatalogText(input?: boolean | BosToolContext): string;
export declare function toolsEnabledDangerous(): boolean;
export declare function runTool(name: unknown, args?: Record<string, unknown>, context?: BosToolContext): Promise<Record<string, unknown>>;
export declare function runtimeSummary(context?: BosToolContext): Record<string, unknown>;
