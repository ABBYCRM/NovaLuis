import { getCredentials } from "./integrations";

// Read the saved credential bag for Google, then overlay any server-side
// env-var values on top so operators who configured once via the deploy
// platform don't have to re-type the same client_id/secret into every
// browser. Env vars take precedence; the browser-saved DB values fill the
// gap only when no env var is set. The refresh_token is always browser-
// saved (it's user-specific and can't be shared across instances).
function withEnvOverrides(c: Record<string, string>): Record<string, string> {
  const envId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  const envSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  const out: Record<string, string> = { ...c };
  if (envId) out["client_id"] = envId;
  if (envSecret) out["client_secret"] = envSecret;
  return out;
}

// Resolve a usable Google OAuth2 access token. Preferred path: client_id +
// client_secret + refresh_token, which lets the server mint a fresh access token
// on every call (the durable "plug in tokens once" model). Fallback: a directly
// pasted short-lived access_token. The same Google OAuth credential powers Gmail,
// Sheets, Docs and Drive (scopes are granted when the refresh token is created).
//
// Two ways to provide the client_id and client_secret:
//   1. Server env vars GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
//      (recommended for production; set once in the deploy platform).
//   2. Browser-saved via Settings → Integrations → Google (per-user; useful
//      for development or for users with multiple Google projects).
// The refresh_token is always browser-saved because it's user-specific and
// can't be reused across instances.
export async function getGoogleAccessToken(): Promise<string> {
  const c = withEnvOverrides(await getCredentials("google"));
  if (c.client_id && c.client_secret && c.refresh_token) {
    const body = new URLSearchParams({
      client_id: c.client_id,
      client_secret: c.client_secret,
      refresh_token: c.refresh_token,
      grant_type: "refresh_token",
    });
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) {
      throw new Error(`Google token refresh failed: ${r.status} ${await r.text()}`);
    }
    const j = (await r.json()) as { access_token?: string };
    if (!j.access_token) throw new Error("Google token refresh returned no access_token");
    return j.access_token;
  }
  if (c.access_token) return c.access_token;
  throw new Error(
    "Google not configured. In Settings → Integrations add client_id + client_secret + refresh_token (recommended), or a short-lived access_token.",
  );
}

// Authenticated GET against a Google API, returning parsed JSON.
export async function googleGet<T = unknown>(
  url: string,
  token: string,
): Promise<T> {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Google API ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}
