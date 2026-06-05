import { Router } from "express";
import { z } from "zod";
import { getCredentials, setCredentials, maskFields } from "../lib/integrations";
import { getGoogleAccessToken, googleGet } from "../lib/google";

const router = Router();

const SERVICES = ["google", "youtube", "instagram"] as const;
type Service = (typeof SERVICES)[number];

function isService(s: string): s is Service {
  return (SERVICES as readonly string[]).includes(s);
}

// ── Credential status + save ────────────────────────────────────────────────

// Masked status of every service — only "set / not set" per field, no secrets.
router.get("/integrations", async (_req, res) => {
  const services: Record<string, Record<string, boolean>> = {};
  for (const s of SERVICES) services[s] = maskFields(await getCredentials(s));
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
  await setCredentials(service, parsed.data.fields);
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

router.get("/integrations/instagram/media", async (req, res) => {
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

export default router;
