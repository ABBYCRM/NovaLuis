import { createHash } from "node:crypto";

// DB access is lazy + guarded so the memory feature can never crash the server
// or break chat: if DATABASE_URL is missing or the DB is unreachable, every
// scratchpad operation degrades to a no-op.
type DbModule = typeof import("@workspace/db");

let dbModulePromise: Promise<DbModule | null> | null = null;

async function getDb(): Promise<DbModule | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!dbModulePromise) {
    dbModulePromise = import("@workspace/db").catch(() => null);
  }
  return dbModulePromise;
}

export interface ChatMessage {
  role: string;
  content: unknown;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text: unknown }).text)
          : "",
      )
      .join(" ");
  }
  return "";
}

// Stable key for a conversation, derived from its first user message so the
// proxy can group turns without the client sending a chat id.
export function conversationKeyFor(messages: ChatMessage[]): string | null {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return null;
  const seed = messageText(firstUser.content).trim().slice(0, 500);
  if (!seed) return null;
  return createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

export function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return messageText(messages[i]!.content);
  }
  return "";
}

export async function recordTurn(params: {
  conversationKey: string;
  userText: string;
  assistantText: string;
  model: string;
}): Promise<void> {
  const mod = await getDb();
  if (!mod) return;
  const userText = params.userText.slice(0, 8000);
  const assistantText = params.assistantText.slice(0, 8000);
  if (!userText && !assistantText) return;
  await mod.db.insert(mod.conversationTurnsTable).values({
    conversationKey: params.conversationKey,
    userText,
    assistantText,
    model: params.model.slice(0, 200),
  });
}

// Compact cross-conversation memory injected into each chat for continuity.
// Kept tight on purpose so it doesn't bloat latency.
export async function getMemoryDigest(maxChars = 1400): Promise<string> {
  const mod = await getDb();
  if (!mod) return "";
  const { desc } = await import("drizzle-orm");
  const rows = await mod.db
    .select()
    .from(mod.scratchpadEntriesTable)
    .orderBy(desc(mod.scratchpadEntriesTable.updatedAt))
    .limit(20);
  if (!rows.length) return "";

  const lines: string[] = [];
  let used = 0;
  for (const r of rows) {
    const summary = r.summary.replace(/\s+/g, " ").trim();
    const line = `- [${r.category}] ${r.title}: ${summary}`.slice(0, 240);
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

export interface GroupedEntry {
  id: number;
  title: string;
  summary: string;
  keyFacts: string;
  turnCount: number;
  updatedAt: Date;
}

export interface GroupedEntries {
  category: string;
  entries: GroupedEntry[];
}

export async function listGroupedEntries(): Promise<GroupedEntries[]> {
  const mod = await getDb();
  if (!mod) return [];
  const { desc } = await import("drizzle-orm");
  const rows = await mod.db
    .select()
    .from(mod.scratchpadEntriesTable)
    .orderBy(desc(mod.scratchpadEntriesTable.updatedAt));

  const byCategory = new Map<string, GroupedEntry[]>();
  for (const r of rows) {
    const list = byCategory.get(r.category) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      summary: r.summary,
      keyFacts: r.keyFacts,
      turnCount: r.turnCount,
      updatedAt: r.updatedAt,
    });
    byCategory.set(r.category, list);
  }

  return [...byCategory.entries()]
    .map(([category, entries]) => ({ category, entries }))
    .sort((a, b) => a.category.localeCompare(b.category));
}
