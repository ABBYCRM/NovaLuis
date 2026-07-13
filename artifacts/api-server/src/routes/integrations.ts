import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  getCredentials,
  maskFields,
  setCredentials,
  supportedIntegrationServices,
} from "../lib/integrations";
import { getGoogleAccessToken, googleGet } from "../lib/google";

const router = Router();
const SERVICES = supportedIntegrationServices();
const PROVIDER_TIMEOUT_MS = 20_000;
const SAFE_RESOURCE_ID = /^[A-Za-z0-9_-]{5,256}$/;

function isService(value: string): boolean {
  return SERVICES.includes(value);
}
function providerSignal(): AbortSignal {
  return AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
}
function providerFailure(req: Request, res: Response, error: unknown): void {
  req.log.error({ err: error }, "integration provider request failed");
  res.status(502).json({ error: "integration provider unavailable" });
}

interface DocElement {
  paragraph?: { elements?: { textRun?: { content?: string } }[] };
}
function extractDocText(doc: { body?: { content?: DocElement[] } }): string {
  const output: string[] = [];
  for (const element of doc.body?.content ?? []) {
    for (const paragraphElement of element.paragraph?.elements ?? []) {
      const text = paragraphElement.textRun?.content;
      if (typeof text === "string") output.push(text);
    }
  }
  return output.join("").slice(0, 1_000_000);
}

router.get("/integrations", async (req, res) => {
  try {
    const services: Record<string, Record<string, boolean>> = {};
    for (const service of SERVICES) {
      services[service] = maskFields(await getCredentials(service));
    }
    res.json({ services });
  } catch (error) {
    req.log.error({ err: error }, "integration credential status failed");
    res.status(503).json({ error: "integration credentials unavailable" });
  }
});

const saveSchema = z.object({
  fields: z.record(z.string().max(128), z.string().max(16 * 1024)),
});
router.post("/integrations/:service", async (req, res) => {
  const service = req.params.service;
  if (!isService(service)) {
    res.status(400).json({ error: "unknown service" });
    return;
  }
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid credential fields" });
    return;
  }
  try {
    await setCredentials(service, parsed.data.fields);
    res.json({
      ok: true,
      service,
      fields: maskFields(await getCredentials(service)),
    });
  } catch (error) {
    req.log.error({ err: error, service }, "integration credential save failed");
    const message = error instanceof Error ? error.message : "save failed";
    const configurationError =
      message.includes("INTEGRATIONS_ENCRYPTION_KEY") ||
      message.includes("database not configured");
    res.status(configurationError ? 503 : 400).json({
      error: configurationError
        ? "integration credential storage is not configured"
        : "credential fields were rejected",
    });
  }
});

router.get("/integrations/gmail/messages", async (req, res) => {
  try {
    const token = await getGoogleAccessToken();
    const maximum = Math.min(Math.max(Number(req.query.max ?? 10) || 10, 1), 25);
    const query = String(req.query.q ?? "").slice(0, 500);
    const url = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    url.searchParams.set("maxResults", String(maximum));
    if (query) url.searchParams.set("q", query);
    const list = await googleGet<{ messages?: { id: string }[] }>(
      url.toString(),
      token,
    );
    const messages = await Promise.all(
      (list.messages ?? []).slice(0, maximum).map(async ({ id }) => {
        const metadataUrl = new URL(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
        );
        metadataUrl.searchParams.set("format", "metadata");
        for (const header of ["Subject", "From", "Date"]) {
          metadataUrl.searchParams.append("metadataHeaders", header);
        }
        const message = await googleGet<{
          snippet?: string;
          payload?: { headers?: { name: string; value: string }[] };
        }>(metadataUrl.toString(), token);
        const headers = Object.fromEntries(
          (message.payload?.headers ?? []).map((header) => [
            header.name,
            header.value,
          ]),
        );
        return {
          id,
          snippet: String(message.snippet ?? "").slice(0, 1_000),
          subject: String(headers.Subject ?? "").slice(0, 1_000),
          from: String(headers.From ?? "").slice(0, 1_000),
          date: String(headers.Date ?? "").slice(0, 200),
        };
      }),
    );
    res.json({ messages });
  } catch (error) {
    providerFailure(req, res, error);
  }
});

router.get("/integrations/sheets/:id", async (req, res) => {
  if (!SAFE_RESOURCE_ID.test(req.params.id)) {
    res.status(400).json({ error: "invalid spreadsheet id" });
    return;
  }
  try {
    const token = await getGoogleAccessToken();
    const range = String(req.query.range ?? "A1:Z100").slice(0, 200);
    const data = await googleGet<{ range?: string; values?: unknown[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(req.params.id)}/values/${encodeURIComponent(range)}`,
      token,
    );
    res.json({ range: data.range ?? range, values: data.values ?? [] });
  } catch (error) {
    providerFailure(req, res, error);
  }
});

router.get("/integrations/docs/:id", async (req, res) => {
  if (!SAFE_RESOURCE_ID.test(req.params.id)) {
    res.status(400).json({ error: "invalid document id" });
    return;
  }
  try {
    const token = await getGoogleAccessToken();
    const document = await googleGet<{
      title?: string;
      body?: { content?: DocElement[] };
    }>(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(req.params.id)}`,
      token,
    );
    res.json({
      title: String(document.title ?? "").slice(0, 1_000),
      text: extractDocText(document),
    });
  } catch (error) {
    providerFailure(req, res, error);
  }
});

router.get("/integrations/drive/files", async (req, res) => {
  try {
    const token = await getGoogleAccessToken();
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("pageSize", "25");
    url.searchParams.set(
      "fields",
      "files(id,name,mimeType,modifiedTime,webViewLink)",
    );
    const query = String(req.query.q ?? "").slice(0, 500);
    if (query) url.searchParams.set("q", query);
    const data = await googleGet<{ files?: unknown[] }>(url.toString(), token);
    res.json({ files: (data.files ?? []).slice(0, 25) });
  } catch (error) {
    providerFailure(req, res, error);
  }
});

router.get("/integrations/youtube/search", async (req, res) => {
  try {
    const credentials = await getCredentials("youtube");
    if (!credentials.api_key) {
      res.status(409).json({ error: "YouTube API key not configured" });
      return;
    }
    const query = String(req.query.q ?? "").trim().slice(0, 500);
    if (!query) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "10");
    url.searchParams.set("q", query);
    url.searchParams.set("key", credentials.api_key);
    const response = await fetch(url, { signal: providerSignal() });
    if (!response.ok) throw new Error(`YouTube HTTP ${response.status}`);
    res.json(await response.json());
  } catch (error) {
    providerFailure(req, res, error);
  }
});

router.get("/integrations/instagram/media", async (req, res) => {
  try {
    const credentials = await getCredentials("instagram");
    if (!credentials.access_token) {
      res.status(409).json({ error: "Instagram access token not configured" });
      return;
    }
    const url = new URL("https://graph.instagram.com/me/media");
    url.searchParams.set(
      "fields",
      "id,caption,media_type,media_url,permalink,timestamp",
    );
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
      signal: providerSignal(),
    });
    if (!response.ok) throw new Error(`Instagram HTTP ${response.status}`);
    res.json(await response.json());
  } catch (error) {
    providerFailure(req, res, error);
  }
});

export default router;
