import { getCredentials, setCredentials, type ServiceFields } from "./integrations";

const COMPOSIO_BASE = (
  process.env.COMPOSIO_BASE_URL || "https://backend.composio.dev/api/v3.1"
).replace(/\/$/, "");
const DEFAULT_USER_ID = "nova-luis";

export class ComposioApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status = 502, details?: unknown) {
    super(message);
    this.name = "ComposioApiError";
    this.status = status;
    this.details = details;
  }
}

export interface ComposioConfig {
  projectApiKeys: string[];
  orgApiKeys: string[];
  userId: string;
  storedSessionId: string;
  projectId: string;
  projectName: string;
  configured: boolean;
}

export interface ComposioSession {
  sessionId: string;
  apiKey: string;
  userId: string;
  credentialSource: "project" | "organization";
  projectId?: string;
}

interface DerivedProjectCredential {
  orgApiKey: string;
  projectId: string;
  apiKey: string;
}

let processSessionId = "";
let derivedProjectCredential: DerivedProjectCredential | null = null;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function looksLikeComposioOrgApiKey(value: string): boolean {
  return /^oak(?:_|-)?/i.test(value.trim());
}

export function normalizeComposioCredentialFields(fields: ServiceFields): ServiceFields {
  const normalized = { ...fields };
  const supplied = clean(normalized.api_key);
  if (supplied && looksLikeComposioOrgApiKey(supplied)) {
    normalized.org_api_key = supplied;
    normalized.api_key = "";
  }
  return normalized;
}

export async function getComposioConfig(): Promise<ComposioConfig> {
  const stored = await getCredentials("composio");
  const rawProjectCandidates = unique([
    clean(process.env.COMPOSIO_API_KEY),
    clean(stored.api_key),
  ]);
  const explicitOrgCandidates = unique([
    clean(process.env.COMPOSIO_ORG_API_KEY),
    clean(stored.org_api_key),
  ]);

  const projectApiKeys = rawProjectCandidates.filter(
    (key) => !looksLikeComposioOrgApiKey(key),
  );
  const orgApiKeys = unique([
    ...explicitOrgCandidates,
    ...rawProjectCandidates.filter(looksLikeComposioOrgApiKey),
  ]);
  const userId = clean(process.env.COMPOSIO_USER_ID || stored.user_id || DEFAULT_USER_ID);
  const storedSessionId = clean(stored.session_id);
  const projectId = clean(process.env.COMPOSIO_PROJECT_ID || stored.project_id);
  const projectName = clean(process.env.COMPOSIO_PROJECT_NAME || stored.project_name);

  return {
    projectApiKeys,
    orgApiKeys,
    userId: userId || DEFAULT_USER_ID,
    storedSessionId,
    projectId,
    projectName,
    configured: projectApiKeys.length > 0 || orgApiKeys.length > 0,
  };
}

function errorMessage(details: unknown): string {
  if (details && typeof details === "object") {
    const root = details as Record<string, unknown>;
    const nested = root.error;
    if (nested && typeof nested === "object") {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    if (typeof root.message === "string" && root.message.trim()) return root.message;
  }
  return "Composio request failed";
}

async function requestWithAuth<T>(
  headerName: "x-api-key" | "x-org-api-key",
  key: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!key) {
    throw new ComposioApiError(
      "Composio is not configured. Add a Composio project or organization API key in Render or Settings.",
      503,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  timeout.unref?.();

  // Merge any external signal (e.g. a per-route deadline) with the
  // internal 60s timeout. Either signal aborts the fetch.
  const externalSignal = init.signal;
  const onExternalAbort = (): void => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const response = await fetch(`${COMPOSIO_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        [headerName]: key,
        ...(init.body == null ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let details: unknown = null;
    try {
      details = text ? JSON.parse(text) : null;
    } catch {
      details = text ? { raw: text } : null;
    }

    if (!response.ok) {
      throw new ComposioApiError(
        `${errorMessage(details)} (HTTP ${response.status})`,
        response.status,
        details,
      );
    }

    return details as T;
  } catch (error) {
    if (error instanceof ComposioApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ComposioApiError("Composio request timed out", 504);
    }
    throw new ComposioApiError(
      error instanceof Error ? error.message : String(error),
      502,
    );
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

export async function composioRequest<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return requestWithAuth<T>("x-api-key", apiKey, path, init);
}

export async function composioOrgRequest<T>(
  orgApiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return requestWithAuth<T>("x-org-api-key", orgApiKey, path, init);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function projectList(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(record(item)));
  }
  const root = record(value);
  if (!root) return [];
  for (const key of ["items", "projects", "results", "data"]) {
    if (Array.isArray(root[key])) return projectList(root[key], depth + 1);
  }
  for (const key of ["data", "result", "response"]) {
    const nested = projectList(root[key], depth + 1);
    if (nested.length) return nested;
  }
  return [];
}

function projectId(project: Record<string, unknown>): string {
  return clean(project.id || project.nano_id || project.nanoId || project.project_id);
}

function projectName(project: Record<string, unknown>): string {
  return clean(project.name || project.project_name || project.slug);
}

function extractProjectApiKey(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") {
    const candidate = value.trim();
    return /^ak(?:_|-)?/i.test(candidate) ? candidate : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractProjectApiKey(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  const root = record(value);
  if (!root) return "";

  for (const key of ["api_key", "apiKey", "project_api_key", "projectApiKey"]) {
    const found = extractProjectApiKey(root[key], depth + 1);
    if (found) return found;
  }
  for (const key of ["api_keys", "apiKeys", "keys", "project", "data", "result"]) {
    const found = extractProjectApiKey(root[key], depth + 1);
    if (found) return found;
  }
  for (const item of Object.values(root)) {
    const found = extractProjectApiKey(item, depth + 1);
    if (found) return found;
  }
  return "";
}

function chooseProject(
  projects: Record<string, unknown>[],
  preferredId: string,
  preferredName: string,
): Record<string, unknown> | null {
  if (!projects.length) return null;
  if (preferredId) {
    const exact = projects.find((project) => projectId(project) === preferredId);
    if (exact) return exact;
  }

  const names = unique([
    preferredName,
    "nova-luis",
    "novaluis",
    "nova",
    "production",
  ]).map((name) => name.toLowerCase());

  for (const wanted of names) {
    const exact = projects.find(
      (project) => projectName(project).toLowerCase() === wanted,
    );
    if (exact) return exact;
  }
  for (const wanted of names) {
    const partial = projects.find((project) =>
      projectName(project).toLowerCase().includes(wanted),
    );
    if (partial) return partial;
  }
  return null;
}

function autoCreateDedicatedProjectEnabled(): boolean {
  return process.env.COMPOSIO_AUTO_CREATE_PROJECT !== "0";
}

async function credentialFromExistingProject(
  orgApiKey: string,
  selected: Record<string, unknown>,
): Promise<DerivedProjectCredential> {
  const selectedId = projectId(selected);
  if (!selectedId) {
    throw new ComposioApiError(
      "Composio returned a project without an identifier",
      502,
      selected,
    );
  }

  let apiKey = extractProjectApiKey(selected);
  if (!apiKey) {
    const details = await composioOrgRequest<unknown>(
      orgApiKey,
      `/org/owner/project/${encodeURIComponent(selectedId)}`,
    );
    apiKey = extractProjectApiKey(details);
  }
  if (!apiKey) {
    throw new ComposioApiError(
      `Composio project ${projectName(selected) || selectedId} did not expose a project API key to the organization token`,
      409,
    );
  }
  return { orgApiKey, projectId: selectedId, apiKey };
}

async function createDedicatedProjectCredential(
  orgApiKey: string,
  requestedName: string,
): Promise<DerivedProjectCredential> {
  const name = requestedName || "nova-luis";
  try {
    const created = await composioOrgRequest<unknown>(
      orgApiKey,
      "/org/owner/project/new",
      {
        method: "POST",
        body: JSON.stringify({ name, should_create_api_key: true }),
      },
    );
    const createdRecord = record(created);
    const createdId = createdRecord ? projectId(createdRecord) : "";
    const apiKey = extractProjectApiKey(created);
    if (!createdId || !apiKey) {
      throw new ComposioApiError(
        `Composio created project ${name} without returning its project API key`,
        502,
        created,
      );
    }
    return { orgApiKey, projectId: createdId, apiKey };
  } catch (error) {
    if (!(error instanceof ComposioApiError) || ![400, 409].includes(error.status)) {
      throw error;
    }

    // A concurrent process may have created the same dedicated project. Re-list
    // and reuse it instead of creating duplicates or rotating any existing key.
    const refreshed = await listOrgProjects(orgApiKey);
    const existing = chooseProject(refreshed, "", name);
    if (!existing) throw error;
    return credentialFromExistingProject(orgApiKey, existing);
  }
}

async function listOrgProjects(orgApiKey: string): Promise<Record<string, unknown>[]> {
  let lastError: unknown = null;
  for (const path of [
    "/org/owner/project/list?limit=100",
    "/org/project/list?limit=100",
  ]) {
    try {
      const data = await composioOrgRequest<unknown>(orgApiKey, path);
      const projects = projectList(data);
      if (projects.length) return projects;
    } catch (error) {
      lastError = error;
      if (!(error instanceof ComposioApiError) || error.status !== 404) throw error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  return [];
}

async function resolveProjectApiKeyFromOrgKey(
  orgApiKey: string,
  preferredId: string,
  preferredName: string,
): Promise<DerivedProjectCredential> {
  if (
    derivedProjectCredential &&
    derivedProjectCredential.orgApiKey === orgApiKey &&
    (!preferredId || derivedProjectCredential.projectId === preferredId)
  ) {
    return derivedProjectCredential;
  }

  const projects = await listOrgProjects(orgApiKey);
  const selected = chooseProject(projects, preferredId, preferredName);

  if (selected) {
    derivedProjectCredential = await credentialFromExistingProject(orgApiKey, selected);
    return derivedProjectCredential;
  }

  if (!autoCreateDedicatedProjectEnabled()) {
    throw new ComposioApiError(
      "Composio organization key is valid but no matching NOVA project exists. Set COMPOSIO_PROJECT_ID/COMPOSIO_PROJECT_NAME or enable project auto-creation.",
      409,
    );
  }

  derivedProjectCredential = await createDedicatedProjectCredential(
    orgApiKey,
    preferredName || "nova-luis",
  );
  return derivedProjectCredential;
}

async function sessionExists(apiKey: string, sessionId: string, signal?: AbortSignal): Promise<boolean> {
  if (!sessionId) return false;
  try {
    await composioRequest<unknown>(
      apiKey,
      `/tool_router/session/${encodeURIComponent(sessionId)}`,
      signal ? { signal } : {},
    );
    return true;
  } catch (error) {
    if (
      error instanceof ComposioApiError &&
      (error.status === 401 || error.status === 403 || error.status === 404)
    ) {
      return false;
    }
    throw error;
  }
}

async function ensureSessionForProjectKey(
  apiKey: string,
  config: ComposioConfig,
  credentialSource: "project" | "organization",
  resolvedProjectId?: string,
  signal?: AbortSignal,
): Promise<ComposioSession> {
  const candidate = processSessionId || config.storedSessionId;
  if (candidate && (await sessionExists(apiKey, candidate, signal))) {
    processSessionId = candidate;
    return {
      sessionId: candidate,
      apiKey,
      userId: config.userId,
      credentialSource,
      ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
    };
  }

  const created = await composioRequest<{ session_id?: string }>(
    apiKey,
    "/tool_router/session",
    {
      method: "POST",
      body: JSON.stringify({ user_id: config.userId }),
      ...(signal ? { signal } : {}),
    },
  );

  const sessionId = clean(created.session_id);
  if (!sessionId) {
    throw new ComposioApiError("Composio created a session without a session_id", 502, created);
  }

  processSessionId = sessionId;
  try {
    await setCredentials("composio", {
      session_id: sessionId,
      ...(resolvedProjectId ? { project_id: resolvedProjectId } : {}),
    });
  } catch {
    // Environment-only deployments can still keep the session in process memory.
  }

  return {
    sessionId,
    apiKey,
    userId: config.userId,
    credentialSource,
    ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
  };
}

export async function ensureComposioSession(opts: { deadlineMs?: number } = {}): Promise<ComposioSession> {
  const config = await getComposioConfig();
  if (!config.configured) {
    throw new ComposioApiError(
      "Composio is not configured. Add a Composio project or organization API key in Render or Settings.",
      503,
    );
  }
  // Bound the whole session-resolution flow so a slow Composio can never
  // eat the request budget. The DO App Platform edge times out at ~1.7s;
  // routes that need composio should pass a deadlineMs below that.
  const deadlineMs = opts.deadlineMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    let lastAuthError: unknown = null;
    for (const apiKey of config.projectApiKeys) {
      try {
        // The internal requestWithAuth now honors external signals.
        return await ensureSessionForProjectKey(apiKey, config, "project", undefined, controller.signal);
      } catch (error) {
        if (
          error instanceof ComposioApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          lastAuthError = error;
          processSessionId = "";
          continue;
        }
        throw error;
      }
    }

    for (const orgApiKey of config.orgApiKeys) {
      try {
        const resolved = await resolveProjectApiKeyFromOrgKey(
          orgApiKey,
          config.projectId,
          config.projectName,
        );
        return await ensureSessionForProjectKey(
          resolved.apiKey,
          config,
          "organization",
          resolved.projectId,
          controller.signal,
        );
      } catch (error) {
        if (
          error instanceof ComposioApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          lastAuthError = error;
          processSessionId = "";
          derivedProjectCredential = null;
          continue;
        }
        throw error;
      }
    }

    if (lastAuthError instanceof Error) throw lastAuthError;
    throw new ComposioApiError("No usable Composio credential was found", 503);
  } finally {
    clearTimeout(timer);
  }
}

export function clearComposioSessionCache(): void {
  processSessionId = "";
  derivedProjectCredential = null;
}
