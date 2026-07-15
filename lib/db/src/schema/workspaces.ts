import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Server-side workspace file store. Mirrors the client's IndexedDB 'bob-workspaces'
// for text-based content so the AI can read and write workspace files without
// requiring a browser session.
export const workspaceFilesTable = pgTable(
  "workspace_files",
  {
    id: serial("id").primaryKey(),
    workspace: varchar("workspace", { length: 100 }).notNull(),
    filename: varchar("filename", { length: 500 }).notNull(),
    content: text("content").notNull().default(""),
    contentType: varchar("content_type", { length: 100 })
      .notNull()
      .default("text/plain"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("workspace_files_ws_filename_uniq").on(t.workspace, t.filename)],
);

export type WorkspaceFile = typeof workspaceFilesTable.$inferSelect;
export type InsertWorkspaceFile = typeof workspaceFilesTable.$inferInsert;
