import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { db, integrationCredentialsTable, hasDatabase } from "@workspace/db";
import { eq } from "drizzle-orm";

export type ServiceFields = Record<string, string>;

const SERVICE_FIELDS: Record<string, ReadonlySet<string>> = {
  google: new Set([
    "client_id",
    "client_secret",
    "refresh_token",
    "access_token",
  ]),
  youtube: new Set(["api_key"]),
  instagram: new Set(["access_token", "ig_user_id"]),
};
const ENCRYPTED_PREFIX = "enc:v1:";
const MAX_FIELD_BYTES = 16 * 1024;

function serviceFields(service: string): ReadonlySet<string> {
  const fields = SERVICE_FIELDS[service];
  if (!fields) throw new Error("unsupported integration service");
  return fields;
}

function encryptionKey(): Buffer | null {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim() ?? "";
  if (!raw) return null;
  return createHash("sha256").update(raw, "utf8").digest();
}

function encrypt(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTED_PREFIX.slice(0, -1),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function decrypt(value: string, key: Buffer | null): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;
  if (!key) throw new Error("integration encryption key is unavailable");
  const parts = value.split(":");
  if (parts.length !== 6 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("invalid encrypted integration value");
  }
  const iv = Buffer.from(parts[3]!, "base64url");
  const tag = Buffer.from(parts[4]!, "base64url");
  const ciphertext = Buffer.from(parts[5]!, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function validateIncoming(
  service: string,
  incoming: ServiceFields,
): ServiceFields {
  const allowed = serviceFields(service);
  const output: ServiceFields = {};
  for (const [name, raw] of Object.entries(incoming)) {
    if (!allowed.has(name)) throw new Error(`unsupported field for ${service}`);
    const value = String(raw);
    if (Buffer.byteLength(value) > MAX_FIELD_BYTES) {
      throw new Error(`integration field '${name}' exceeds size limit`);
    }
    output[name] = value;
  }
  return output;
}

export function supportedIntegrationServices(): string[] {
  return Object.keys(SERVICE_FIELDS);
}

export async function getCredentials(service: string): Promise<ServiceFields> {
  serviceFields(service);
  if (!hasDatabase || !db) return {};
  const rows = await db
    .select()
    .from(integrationCredentialsTable)
    .where(eq(integrationCredentialsTable.service, service));
  const stored = (rows[0]?.fields as ServiceFields | undefined) ?? {};
  const allowed = serviceFields(service);
  const key = encryptionKey();
  const output: ServiceFields = {};
  for (const [name, value] of Object.entries(stored)) {
    if (!allowed.has(name) || typeof value !== "string") continue;
    output[name] = decrypt(value, key);
  }
  return output;
}

export async function setCredentials(
  service: string,
  incoming: ServiceFields,
): Promise<void> {
  if (!hasDatabase || !db) {
    throw new Error("database not configured");
  }
  const key = encryptionKey();
  if (!key) {
    throw new Error("INTEGRATIONS_ENCRYPTION_KEY is required");
  }
  const validated = validateIncoming(service, incoming);
  const merged: ServiceFields = { ...(await getCredentials(service)) };
  for (const [name, value] of Object.entries(validated)) {
    if (value === "") delete merged[name];
    else merged[name] = value;
  }
  const encrypted = Object.fromEntries(
    Object.entries(merged).map(([name, value]) => [name, encrypt(value, key)]),
  );
  await db
    .insert(integrationCredentialsTable)
    .values({ service, fields: encrypted })
    .onConflictDoUpdate({
      target: integrationCredentialsTable.service,
      set: { fields: encrypted, updatedAt: new Date() },
    });
}

export function maskFields(fields: ServiceFields): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [name, Boolean(value)]),
  );
}
