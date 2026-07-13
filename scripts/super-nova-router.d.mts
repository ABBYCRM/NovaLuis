export type BosMessage = Record<string, unknown> & { role: string; content?: unknown };
export interface BosCompletionInput {
  role?: "planner" | "executor" | "critic" | "researcher";
  messages: BosMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: unknown;
}
export declare const ROLES: string[];
export declare const DEFAULT_MAX_TOKENS: number;
export declare const BOS_IDENTITY: string;
export declare function completeMessage(input: BosCompletionInput): Promise<{ message: BosMessage; provider: string; model: string; usage: unknown; attempts: Array<Record<string, unknown>> }>;
export declare function chatComplete(input: BosCompletionInput): Promise<string>;
export declare function resolveRole(role?: string, model?: string): Record<string, unknown>;
export declare function routerSummary(): string;
