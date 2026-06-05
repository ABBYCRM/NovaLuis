import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Per-service integration credentials (Google, YouTube, Instagram, …). One row
// per service; `fields` holds the service-specific secret bag (e.g. client_id,
// refresh_token, api_key). Values are written by the Settings → Integrations
// panel and read server-side when calling the provider APIs. Secrets are never
// echoed back to the client — only a boolean "set / not set" status is returned.
export const integrationCredentialsTable = pgTable("integration_credentials", {
  service: text("service").primaryKey(),
  fields: jsonb("fields").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type IntegrationCredentials =
  typeof integrationCredentialsTable.$inferSelect;
