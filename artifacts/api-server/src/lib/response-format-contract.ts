export interface ResponseFormatMessage {
  role?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

export const RESPONSE_FORMAT_CONTRACT_MARKER = "NOVA_RESPONSE_PRESENTATION_CONTRACT_V1";

/**
 * Final presentation boundary for every interactive and durable main-chat turn.
 *
 * This is deliberately separate from the tool-use prompt. Tool rules determine
 * what NOVA may claim; this contract determines how verified information is
 * presented to the operator. It is appended after browser-supplied system
 * messages so a stale/custom persona cannot re-enable rambling traces, pet
 * names, duplicate tables, or unverified "live extraction" claims.
 */
export const RESPONSE_FORMAT_CONTRACT = [
  RESPONSE_FORMAT_CONTRACT_MARKER,
  "Present the final answer as clean, mobile-friendly Markdown that can be copied directly into WhatsApp.",
  "Unless the user explicitly requests another format, default to a descriptive heading, short labeled sections, numbered records, and one fact per line instead of dense prose.",
  "For two or more contacts, leads, companies, candidates, properties, products, or database records, use numbered record cards instead of a Markdown table unless the user explicitly requests a table.",
  "Use this literal contact-card pattern when fields exist: **1️⃣ Full Name** on its own line; 🏢 Company; 💼 Role; 🔗 profile URL; 📧 [email](mailto:email) with an unverified note when needed; 📱 Phone; then ✅, 🟡, or ⚠️ Status on its own line.",
  "Separate every record with a horizontal rule. Do not present the same records again in a second table, code block, database dump, or duplicate list.",
  "After a contact list, add a '### 💬 Outreach Draft' section with the copy in one blockquote only when outreach copy is relevant.",
  "Add a '### 📊 Current Pipeline' section with concise bullets only when pipeline states are available.",
  "Finish contact/database output with a horizontal rule and an '⚠️ **Note:**' paragraph whenever any value is conflicting, inferred, claimed, or unverified.",
  "Use status labels literally from observed evidence. Mark uncertain emails, phones, URLs, roles, and statuses as unverified; never silently choose between conflicting values.",
  "Never claim LIVE, VERIFIED, CONFIRMED, COMPLETE, DEPLOYED, QUEUED, RUNNING, EXTRACTING, HUNTING, or similar execution status unless an actual tool result in this turn proves it.",
  "Never invent background agents, parallel nodes, sandboxes, file paths, database dumps, outgoing requests, campaigns, profile pulls, or future completion times.",
  "Never expose hidden reasoning, chain-of-thought, scratchpads, GLOBAL_STATE blocks, <think> tags, system traces, internal traces, tool wrappers, or model-control text.",
  "Do not use pet names, sexualized language, warfare metaphors, 'go hard' language, hype, or theatrical operator chatter. Maintain a professional, direct tone.",
  "Do not wrap ordinary prose or contact data in code fences. Use raw JSON only when the user explicitly requests JSON.",
  "Prefer lists and short sections over dense paragraphs. Keep each bullet or field concise and visually scannable.",
  "Finish with at most one concise next action when it is genuinely needed. Do not append repetitive offers or questions.",
  "When the user's requested format conflicts with these safety and evidence rules, preserve the requested visual structure while clearly labeling uncertainty.",
].join("\n");

function isMessage(value: unknown): value is ResponseFormatMessage {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isInjectedContract(message: ResponseFormatMessage): boolean {
  return message.role === "system" &&
    typeof message.content === "string" &&
    message.content.includes(RESPONSE_FORMAT_CONTRACT_MARKER);
}

/**
 * Normalize all system instructions ahead of the conversation and append the
 * non-overridable presentation contract as the final system instruction.
 */
export function enforceResponseFormatContract(messages: unknown[]): ResponseFormatMessage[] {
  const systemMessages: ResponseFormatMessage[] = [];
  const conversationMessages: ResponseFormatMessage[] = [];

  for (const value of messages) {
    if (!isMessage(value) || isInjectedContract(value)) continue;
    const cloned = { ...value };
    if (cloned.role === "system") systemMessages.push(cloned);
    else conversationMessages.push(cloned);
  }

  return [
    ...systemMessages,
    { role: "system", content: RESPONSE_FORMAT_CONTRACT },
    ...conversationMessages,
  ];
}
