import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Raw conversation capture. The proxy writes one row per assistant reply,
// grouped by a stable conversationKey (hash of the first user message).
// The scratchpad daemon distills unprocessed rows into scratchpad_entries.
export const conversationTurnsTable = pgTable("conversation_turns", {
  id: serial("id").primaryKey(),
  conversationKey: text("conversation_key").notNull(),
  userText: text("user_text").notNull().default(""),
  assistantText: text("assistant_text").notNull().default(""),
  model: text("model").notNull().default(""),
  processed: boolean("processed").notNull().default(false),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertConversationTurnSchema = createInsertSchema(
  conversationTurnsTable,
).omit({ id: true, processed: true, attempts: true, createdAt: true });
export type InsertConversationTurn = z.infer<
  typeof insertConversationTurnSchema
>;
export type ConversationTurn = typeof conversationTurnsTable.$inferSelect;

// Distilled, categorized memory — one evolving entry per conversation.
export const scratchpadEntriesTable = pgTable("scratchpad_entries", {
  id: serial("id").primaryKey(),
  conversationKey: text("conversation_key").notNull().unique(),
  category: text("category").notNull().default("general"),
  title: text("title").notNull().default("Untitled"),
  summary: text("summary").notNull().default(""),
  keyFacts: text("key_facts").notNull().default(""),
  turnCount: integer("turn_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertScratchpadEntrySchema = createInsertSchema(
  scratchpadEntriesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScratchpadEntry = z.infer<typeof insertScratchpadEntrySchema>;
export type ScratchpadEntry = typeof scratchpadEntriesTable.$inferSelect;
