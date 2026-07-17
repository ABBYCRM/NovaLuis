import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  Router,
  type NextFunction,
  type Request,
  type Response as ExpressResponse,
} from "express";
import {
  db,
  hasDatabase,
  socialScheduledPostsTable,
  workspaceFilesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

const router = Router();
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PUBLISHING_LOCK_MS = 5 * 60 * 1000;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const PUBLIC_ASSET_NAME = /^instagram-[a-z0-9_-]{1,50}-[a-z0-9_-]{1,50}-\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpe?g|webp)$/i;

type JsonRecord = Record<string, unknown>;

interface ComposioExecution {
  ok: boolean;
  status: number;
  data: unknown;
}

interface InstagramPublishResult {
  ok: boolean;
  step: 1 | 2;
  toolSlug: string;
  creationId?: string;
  mediaId?: string;
  data: unknown;
  error?: string;
}

function dbGuard(res: ExpressResponse): boolean {
  if (!hasDatabase || !db) {
    res.status(503).json({ error: "database not configured" });
    return false;
  }
  return true;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

// Instagram's Graph API requires the IG Business User ID on every media and
// publish call. The Composio toolkit no longer injects it for
// INSTAGRAM_CREATE_POST, so we have to look it up ourselves. We check the
// env var first, then fall back to a cache file written by the discovery
// endpoint, then to the most recent value embedded in any step-1 response.
function readIgUserId(): string {
  const env = String(process.env.INSTAGRAM_IG_USER_ID || "").trim();
  if (env) return env;
  // Process-level cache set by /api/integrations/instagram/discover-user-id
  const cached = (globalThis as { __novaIgUserId?: string }).__novaIgUserId;
  return typeof cached === "string" ? cached.trim() : "";
}

function rememberIgUserId(value: string): void {
  const trimmed = String(value || "").trim();
  if (!trimmed) return;
  (globalThis as { __novaIgUserId?: string }).__novaIgUserId = trimmed;
}

function publicBaseUrl(req: Request): string {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    ?.trim();
  const protocol = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : req.protocol;
  return `${protocol}://${req.get("host")}`.replace(/\/$/, "");
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0]!;
  const family = isIP(normalized);

  if (family === 4) {
    const parts = normalized.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }
    const [a, b, c] = parts as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }

  if (family === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("::ffff:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    );
  }

  return true;
}

async function assertSafeImageUrl(url: URL, baseUrl: URL): Promise<void> {
  if (url.username || url.password) {
    throw new Error("Generated image URL must not contain embedded credentials");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const baseHostname = baseUrl.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === baseHostname) {
    if (url.protocol !== "https:") {
      throw new Error("Local generated media must use HTTPS");
    }
    return;
  }

  if (url.protocol !== "https:") {
    throw new Error("Remote generated media must use HTTPS");
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home")
  ) {
    throw new Error("Generated image URL points to a private hostname");
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("Generated image URL resolves to a private or reserved network address");
  }
}

async function fetchImage(imageUrl: string, baseUrl: string): Promise<Response> {
  const base = new URL(baseUrl);
  let current = new URL(imageUrl, base);

  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    await assertSafeImageUrl(current, base);
    const response = await fetch(current, {
      signal: AbortSignal.timeout(20_000),
      redirect: "manual",
      headers: { Accept: "image/*" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Generated image redirect did not include a location");
      current = new URL(location, current);
      continue;
    }
    return response;
  }

  throw new Error("Generated image exceeded the redirect limit");
}

async function readImage(imageUrl: string, baseUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) throw new Error("Generated image data URL is malformed");
    const mimeType = match[1]!.toLowerCase();
    if (!IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(`Unsupported generated image type: ${mimeType}`);
    }
    const buffer = Buffer.from(match[2]!, "base64");
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(`Generated image must be between 1 byte and ${MAX_IMAGE_BYTES} bytes`);
    }
    return { buffer, mimeType };
  }

  const response = await fetchImage(imageUrl, baseUrl);
  if (!response.ok) {
    throw new Error(`Could not download generated image (HTTP ${response.status})`);
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_IMAGE_BYTES) {
    throw new Error(`Generated image exceeds ${MAX_IMAGE_BYTES} bytes`);
  }

  const mimeType = String(response.headers.get("content-type") || "image/png")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error(`Downloaded media is not a supported image (${mimeType || "unknown"})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Generated image must be between 1 byte and ${MAX_IMAGE_BYTES} bytes`);
  }
  return { buffer, mimeType };
}

async function persistPublicImage(
  req: Request,
  imageUrl: string,
  platform: string,
  contentType: string,
): Promise<string> {
  if (!db) throw new Error("database not configured");
  const baseUrl = publicBaseUrl(req);
  if (!baseUrl.startsWith("https://")) {
    throw new Error("PUBLIC_BASE_URL must be an HTTPS URL before Instagram can fetch generated media");
  }

  const assetPrefix = `${baseUrl}/api/social/assets/`;
  if (imageUrl.startsWith(assetPrefix)) return imageUrl;

  const { buffer, mimeType } = await readImage(imageUrl, baseUrl);
  const filename = [
    "instagram",
    platform.replace(/[^a-z0-9_-]/gi, "-").slice(0, 50),
    contentType.replace(/[^a-z0-9_-]/gi, "-").slice(0, 50),
    Date.now(),
    randomUUID(),
  ].join("-") + `.${extensionForMime(mimeType)}`;

  await db!.insert(workspaceFilesTable).values({
    workspace: "pictures",
    filename,
    content: buffer.toString("base64"),
    contentType: mimeType,
  });

  return `${assetPrefix}${encodeURIComponent(filename)}`;
}

function executionSucceeded(data: unknown): boolean {
  const root = record(data);
  if (!root) return true;

  for (const key of ["successful", "success", "ok"]) {
    if (root[key] === false) return false;
  }
  if (root.error != null && root.error !== "") return false;
  const status = String(root.status || root.state || "").toLowerCase();
  if (["failed", "error", "cancelled", "canceled"].includes(status)) return false;

  for (const key of ["data", "result", "response", "response_data", "output"]) {
    const nested = record(root[key]);
    if (nested && !executionSucceeded(nested)) return false;
  }
  return true;
}

function findIdentifier(value: unknown, keys: string[], depth = 0): string {
  if (depth > 6) return "";
  const root = record(value);
  if (!root) return "";

  for (const key of keys) {
    const candidate = root[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }

  for (const key of ["data", "result", "response", "response_data", "output", "details"]) {
    const found = findIdentifier(root[key], keys, depth + 1);
    if (found) return found;
  }
  return "";
}

async function composioExecute(
  port: number,
  toolSlug: string,
  args: JsonRecord,
): Promise<ComposioExecution> {
  const apiKey = process.env.SUPERNOVA_API_KEY || process.env.OPENCLAW_API_KEY || "";
  const response = await fetch(`http://127.0.0.1:${port}/api/integrations/composio/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ toolSlug, arguments: args }),
  });
  const data = await response.json().catch(() => ({ error: "Composio returned an unreadable response" }));
  return {
    ok: response.ok && executionSucceeded(data),
    status: response.status,
    data,
  };
}

async function publishInstagram(
  port: number,
  contentType: string,
  caption: string,
  imageUrl: string,
  videoUrl: string,
): Promise<InstagramPublishResult> {
  const isReel = contentType === "reel";
  const isStory = contentType === "story";

  if (isReel && !videoUrl.startsWith("https://")) {
    return {
      ok: false,
      step: 1,
      toolSlug: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
      data: null,
      error: "Instagram Reels require a real public HTTPS video URL. The current Social Media generator creates images only.",
    };
  }
  if (!isReel && !imageUrl.startsWith("https://")) {
    return {
      ok: false,
      step: 1,
      toolSlug: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
      data: null,
      error: "Instagram image publishing requires a durable public HTTPS image URL.",
    };
  }

  // Resolve the Instagram business user id. Composio no longer auto-injects
  // it on INSTAGRAM_CREATE_POST, and the Meta Graph API requires it. We accept
  // it from the env, the in-process cache (set by the discover endpoint), or
  // any step-1 response that happens to include it.
  const knownIgUserId = readIgUserId();
  if (!knownIgUserId) {
    return {
      ok: false,
      step: 1,
      toolSlug: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
      data: null,
      error:
        "Instagram publishing is paused: INSTAGRAM_IG_USER_ID is not set. " +
        "Visit Settings → Integrations → Instagram and click “Discover IG User ID” " +
        "or set the env var in DigitalOcean and redeploy.",
    };
  }

  const contentMediaArgs = isReel
    ? { video_url: videoUrl }
    : { image_url: imageUrl };
  const createArgs: JsonRecord = {
    caption,
    ...contentMediaArgs,
    content_type: isReel ? "reel" : "photo",
    ...(isReel ? { media_type: "REELS" } : isStory ? { media_type: "STORIES" } : {}),
    ig_user_id: knownIgUserId,
  };

  const step1 = await composioExecute(port, "INSTAGRAM_CREATE_MEDIA_CONTAINER", createArgs);
  // Some Composio wrappers echo the IG business user id back on the container
  // response. If a new value appears, prefer it (the env value is a fallback).
  const step1IgUserId = findIdentifier(step1.data, ["ig_user_id", "igUserId", "ig_userId"]);
  if (step1IgUserId && step1IgUserId !== knownIgUserId) rememberIgUserId(step1IgUserId);
  const creationId = findIdentifier(
    step1.data,
    ["creation_id", "creationId", "container_id", "containerId", "id"],
  );
  if (!step1.ok || !creationId) {
    return {
      ok: false,
      step: 1,
      toolSlug: "INSTAGRAM_CREATE_MEDIA_CONTAINER",
      data: step1.data,
      error: `Instagram container creation failed: ${JSON.stringify(step1.data).slice(0, 700)}`,
    };
  }

  const step2 = await composioExecute(port, "INSTAGRAM_CREATE_POST", {
    creation_id: creationId,
    ig_user_id: step1IgUserId || knownIgUserId,
  });
  const mediaId = findIdentifier(
    step2.data,
    ["media_id", "mediaId", "post_id", "postId", "id"],
  );
  if (!step2.ok || !mediaId) {
    return {
      ok: false,
      step: 2,
      toolSlug: "INSTAGRAM_CREATE_POST",
      creationId,
      data: step2.data,
      error: `Instagram publish failed or returned no media ID: ${JSON.stringify(step2.data).slice(0, 700)}`,
    };
  }

  return {
    ok: true,
    step: 2,
    toolSlug: "INSTAGRAM_CREATE_POST",
    creationId,
    mediaId,
    data: step2.data,
  };
}

// Public, immutable media endpoint used by Instagram's servers. It deliberately
// serves only opaque Instagram-generated files from the Pictures workspace and
// exposes neither a file listing nor arbitrary user workspace images.
router.get("/social/assets/:filename", async (req, res) => {
  if (!dbGuard(res)) return;
  const filename = String(req.params.filename || "");
  if (!PUBLIC_ASSET_NAME.test(filename)) {
    res.status(400).json({ error: "invalid asset filename" });
    return;
  }

  const rows = await db!
    .select()
    .from(workspaceFilesTable)
    .where(
      and(
        eq(workspaceFilesTable.workspace, "pictures"),
        eq(workspaceFilesTable.filename, filename),
      ),
    )
    .limit(1);
  if (!rows.length) {
    res.status(404).json({ error: "asset not found" });
    return;
  }

  const asset = rows[0]!;
  if (!asset.contentType.startsWith("image/")) {
    res.status(415).json({ error: "asset is not an image" });
    return;
  }

  const body = Buffer.from(asset.content, "base64");
  res.setHeader("Content-Type", asset.contentType);
  res.setHeader("Content-Length", String(body.length));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(body);
});

// Mounted before the legacy social-media router. Instagram requests are handled
// here; other platforms continue to the existing route with next().
router.post("/social/publish/:id", async (req: Request, res: ExpressResponse, next: NextFunction) => {
  if (!dbGuard(res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const rows = await db!
    .select()
    .from(socialScheduledPostsTable)
    .where(eq(socialScheduledPostsTable.id, id))
    .limit(1);
  if (!rows.length) {
    res.status(404).json({ error: "post not found" });
    return;
  }
  const post = rows[0]!;
  if (post.platform !== "instagram") {
    next();
    return;
  }

  if (post.status === "published") {
    res.json({ ok: true, skipped: true, status: "published" });
    return;
  }
  if (
    post.status === "publishing" &&
    Date.now() - new Date(post.updatedAt).getTime() < PUBLISHING_LOCK_MS
  ) {
    res.status(409).json({
      ok: false,
      error: "This Instagram post is already being published. Retry after the five-minute lock expires.",
    });
    return;
  }

  await db!.update(socialScheduledPostsTable).set({
    status: "publishing",
    errorMessage: null,
  }).where(eq(socialScheduledPostsTable.id, id));

  try {
    let durableImageUrl = post.imageUrl;
    if (post.contentType !== "reel") {
      if (!post.imageUrl) {
        throw new Error("Instagram posts require an image. Generate or upload an image before publishing.");
      }
      durableImageUrl = await persistPublicImage(
        req,
        post.imageUrl,
        post.platform,
        post.contentType,
      );
      if (durableImageUrl !== post.imageUrl) {
        await db!.update(socialScheduledPostsTable)
          .set({ imageUrl: durableImageUrl })
          .where(eq(socialScheduledPostsTable.id, id));
      }
    }

    const fullCaption = [post.caption, post.hashtags].filter(Boolean).join("\n\n");
    const result = await publishInstagram(
      Number(process.env.PORT || 8080),
      post.contentType,
      fullCaption,
      durableImageUrl,
      post.videoUrl,
    );

    const auditResult = JSON.stringify({
      step: result.step,
      toolSlug: result.toolSlug,
      creationId: result.creationId,
      mediaId: result.mediaId,
      result: result.data,
    });

    if (!result.ok || !result.mediaId) {
      await db!.update(socialScheduledPostsTable).set({
        status: "failed",
        errorMessage: result.error || "Instagram publishing failed",
        composioResult: auditResult,
      }).where(eq(socialScheduledPostsTable.id, id));
      res.status(result.step === 1 ? 422 : 502).json({
        ok: false,
        error: result.error,
        step: result.step,
        creationId: result.creationId,
        composioResult: result.data,
      });
      return;
    }

    await db!.update(socialScheduledPostsTable).set({
      status: "published",
      publishedAt: new Date(),
      errorMessage: null,
      composioResult: auditResult,
    }).where(eq(socialScheduledPostsTable.id, id));

    res.json({
      ok: true,
      step: 2,
      creationId: result.creationId,
      mediaId: result.mediaId,
      imageUrl: durableImageUrl,
      composioResult: result.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db!.update(socialScheduledPostsTable).set({
      status: "failed",
      errorMessage: message,
    }).where(eq(socialScheduledPostsTable.id, id));
    res.status(422).json({ ok: false, error: message });
  }
});

export default router;
