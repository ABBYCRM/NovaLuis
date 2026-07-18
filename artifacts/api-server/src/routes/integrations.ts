import { Router } from "express";
import { z } from "zod";
import { getCredentials, setCredentials, maskFields } from "../lib/integrations";
import {
  clearComposioSessionCache,
  normalizeComposioCredentialFields,
} from "../lib/composio";
import { getGoogleAccessToken, googleGet } from "../lib/google";

const router = Router();

const SERVICES = ["google", "youtube", "instagram", "composio"] as const;
type Service = (typeof SERVICES)[number];

function isService(s: string): s is Service {
  return (SERVICES as readonly string[]).includes(s);
}

// ── Credential status + save ────────────────────────────────────────────────

// Masked status of every service — only "set / not set" per field, no secrets.
router.get("/integrations", async (_req, res) => {
  const services: Record<string, Record<string, boolean>> = {};
  for (const s of SERVICES) services[s] = maskFields(await getCredentials(s));
  if (process.env.COMPOSIO_API_KEY) services.composio.api_key = true;
  if (process.env.COMPOSIO_ORG_API_KEY) services.composio.org_api_key = true;
  if (process.env.COMPOSIO_USER_ID) services.composio.user_id = true;
  if (process.env.COMPOSIO_PROJECT_ID) services.composio.project_id = true;
  res.json({ services });
});

const saveSchema = z.object({ fields: z.record(z.string(), z.string()) });

router.post("/integrations/:service", async (req, res) => {
  const service = req.params.service;
  if (!isService(service)) {
    res.status(400).json({ error: "unknown service" });
    return;
  }
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.issues });
    return;
  }
  const fields =
    service === "composio"
      ? normalizeComposioCredentialFields(parsed.data.fields)
      : parsed.data.fields;
  await setCredentials(service, fields);
  if (service === "composio") clearComposioSessionCache();
  res.json({ ok: true, service, fields: maskFields(await getCredentials(service)) });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function fail(res: import("express").Response, e: unknown) {
  res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
}

interface DocElement {
  paragraph?: { elements?: { textRun?: { content?: string } }[] };
}
function extractDocText(doc: { body?: { content?: DocElement[] } }): string {
  const out: string[] = [];
  for (const el of doc.body?.content ?? []) {
    for (const pe of el.paragraph?.elements ?? []) {
      const t = pe.textRun?.content;
      if (typeof t === "string") out.push(t);
    }
  }
  return out.join("");
}

// ── Gmail ───────────────────────────────────────────────────────────────────

router.get("/integrations/gmail/messages", async (req, res) => {
  try {
    const token = await getGoogleAccessToken();
    const max = Math.min(Math.max(Number(req.query.max ?? 10) || 10, 1), 50);
    const q = req.query.q ? `&q=${encodeURIComponent(String(req.query.q))}` : "";
    const list = await googleGet<{ messages?: { id: string }[] }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}${q}`,
      token,
    );
    const messages = [];
    for (const { id } of list.messages ?? []) {
      const m = await googleGet<{
        snippet?: string;
        payload?: { headers?: { name: string; value: string }[] };
      }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        token,
      );
      const h = Object.fromEntries(
        (m.payload?.headers ?? []).map((x) => [x.name, x.value]),
      );
      messages.push({
        id,
        snippet: m.snippet ?? "",
        subject: h.Subject ?? "",
        from: h.From ?? "",
        date: h.Date ?? "",
      });
    }
    res.json({ messages });
  } catch (e) {
    fail(res, e);
  }
});

// ── Google Sheets ─────────────────────────────────────────────────────────────

router.get("/integrations/sheets/:id", async (req, res) => {
  try {
    const token = await getGoogleAccessToken();
    const range = String(req.query.range ?? "A1:Z100");
    const data = await googleGet<{ range?: string; values?: unknown[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        req.params.id,
      )}/values/${encodeURIComponent(range)}`,
      token,
    );
    res.json({ range: data.range ?? range, values: data.values ?? [] });
  } catch (e) {
    fail(res, e);
  }
});

// ── Google Docs ───────────────────────────────────────────────────────────────

router.get("/integrations/docs/:id", async (req, res) => {
  try {
    const token = await getGoogleAccessToken();
    const doc = await googleGet<{
      title?: string;
      body?: { content?: DocElement[] };
    }>(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(req.params.id)}`,
      token,
    );
    res.json({ title: doc.title ?? "", text: extractDocText(doc) });
  } catch (e) {
    fail(res, e);
  }
});

// ── Google Drive ──────────────────────────────────────────────────────────────

router.get("/integrations/drive/files", async (req, res) => {
  try {
    const token = await getGoogleAccessToken();
    const q = req.query.q ? `&q=${encodeURIComponent(String(req.query.q))}` : "";
    const data = await googleGet<{ files?: unknown[] }>(
      `https://www.googleapis.com/drive/v3/files?pageSize=25&fields=files(id,name,mimeType,modifiedTime,webViewLink)${q}`,
      token,
    );
    res.json({ files: data.files ?? [] });
  } catch (e) {
    fail(res, e);
  }
});

// ── YouTube (Data API key) ────────────────────────────────────────────────────

router.get("/integrations/youtube/search", async (req, res) => {
  try {
    const c = await getCredentials("youtube");
    if (!c.api_key) {
      res.status(400).json({ error: "YouTube API key not set" });
      return;
    }
    const query = encodeURIComponent(String(req.query.q ?? ""));
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${query}&key=${c.api_key}`,
    );
    if (!r.ok) {
      res.status(502).json({ error: `YouTube API ${r.status}: ${await r.text()}` });
      return;
    }
    res.json(await r.json());
  } catch (e) {
    fail(res, e);
  }
});

// ── Instagram (Meta Graph access token) ───────────────────────────────────────

router.get("/integrations/instagram/media", async (_req, res) => {
  try {
    const c = await getCredentials("instagram");
    if (!c.access_token) {
      res.status(400).json({ error: "Instagram access token not set" });
      return;
    }
    const fields = "id,caption,media_type,media_url,permalink,timestamp";
    const r = await fetch(
      `https://graph.instagram.com/me/media?fields=${fields}&access_token=${encodeURIComponent(
        c.access_token,
      )}`,
    );
    if (!r.ok) {
      res
        .status(502)
        .json({ error: `Instagram API ${r.status}: ${await r.text()}` });
      return;
    }
    res.json(await r.json());
  } catch (e) {
    fail(res, e);
  }
});

// Discover the Instagram business user id from the stored Meta Graph access
// token. The IG business user id (a 17-19 digit number) is required by the
// Instagram Graph API for every media container and publish call. Without it,
// INSTAGRAM_CREATE_POST returns "Following fields are missing: {'ig_user_id'}".
//
// We look it up by asking the Graph API for the connected Facebook Pages and
// reading the linked instagram_business_account.id from the first page that
// has one. The endpoint persists the result to the integration creds bag and
// returns it so the operator can confirm it before redeploying.
router.get("/integrations/instagram/discover-user-id", async (_req, res) => {
  try {
    const c = await getCredentials("instagram");
    if (!c.access_token) {
      res.status(400).json({
        error: "Instagram access token not set. Save one in Settings → Integrations first.",
      });
      return;
    }
    const pagesResp = await fetch(
      `https://graph.facebook.com/v20.0/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=${encodeURIComponent(c.access_token)}`,
    );
    if (!pagesResp.ok) {
      const body = await pagesResp.text();
      res.status(502).json({ error: `Meta Graph API ${pagesResp.status}: ${body}` });
      return;
    }
    const pagesJson = (await pagesResp.json()) as {
      data?: { id: string; name?: string; instagram_business_account?: { id: string; username?: string } }[];
    };
    const candidates = (pagesJson.data ?? []).filter((p) => p.instagram_business_account?.id);
    if (!candidates.length) {
      res.status(404).json({
        error: "No Facebook Page with a linked Instagram business account was found for this token. Connect an IG Business account to a Page in Meta Business Suite and retry.",
        pagesChecked: (pagesJson.data ?? []).map((p) => ({ id: p.id, name: p.name, hasInstagram: Boolean(p.instagram_business_account) })),
      });
      return;
    }
    const pick = candidates[0]!;
    const igUserId = pick.instagram_business_account!.id;
    const igUsername = pick.instagram_business_account!.username ?? null;
    // Persist to the credentials bag so the next deploy picks it up.
    await setCredentials("instagram", { ...c, ig_user_id: igUserId });
    res.json({
      ok: true,
      igUserId,
      igUsername,
      pageId: pick.id,
      pageName: pick.name ?? null,
      candidates: candidates.map((p) => ({ pageId: p.id, pageName: p.name ?? null, igUserId: p.instagram_business_account!.id, igUsername: p.instagram_business_account!.username ?? null })),
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
