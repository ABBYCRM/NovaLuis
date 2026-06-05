import { db, integrationCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type ServiceFields = Record<string, string>;

// Read the stored credential bag for a service. Returns {} when nothing is set.
export async function getCredentials(service: string): Promise<ServiceFields> {
  const rows = await db
    .select()
    .from(integrationCredentialsTable)
    .where(eq(integrationCredentialsTable.service, service));
  return (rows[0]?.fields as ServiceFields | undefined) ?? {};
}

// Merge incoming fields into the stored bag. An empty-string value clears that
// field; omitted fields are left untouched (so the UI can save partial updates
// without wiping secrets the user didn't re-type).
export async function setCredentials(
  service: string,
  incoming: ServiceFields,
): Promise<void> {
  const merged: ServiceFields = { ...(await getCredentials(service)) };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === "") delete merged[k];
    else merged[k] = v;
  }
  await db
    .insert(integrationCredentialsTable)
    .values({ service, fields: merged })
    .onConflictDoUpdate({
      target: integrationCredentialsTable.service,
      set: { fields: merged },
    });
}

// Return only which fields are set — never the secret values themselves.
export function maskFields(fields: ServiceFields): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = Boolean(v);
  return out;
}
