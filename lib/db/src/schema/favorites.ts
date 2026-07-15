import { pgTable, serial, text, varchar, timestamp } from "drizzle-orm/pg-core";

export const favoritesTable = pgTable("favorites", {
  id:          serial("id").primaryKey(),
  url:         text("url").notNull(),
  title:       varchar("title", { length: 500 }).notNull().default(""),
  description: text("description").notNull().default(""),
  favicon:     text("favicon").notNull().default(""),
  tags:        varchar("tags", { length: 500 }).notNull().default(""),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Favorite = typeof favoritesTable.$inferSelect;
