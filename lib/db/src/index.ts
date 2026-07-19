import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const hasDatabase = Boolean(process.env.DATABASE_URL);
let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

if (hasDatabase) {
  const configuredTimeout = Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10_000);
  const connectionTimeoutMillis = Number.isFinite(configuredTimeout)
    ? Math.max(1_000, configuredTimeout)
    : 10_000;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis,
  });
  db = drizzle(pool, { schema });
} else {
  console.warn("[db] DATABASE_URL not set — running without database (integrations/knowledge will return empty)");
}

export { db, pool, hasDatabase };
export * from "./schema";
