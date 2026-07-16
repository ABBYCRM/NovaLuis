import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
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

function dbGuard(res: Response): boolean {
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

  const absoluteUrl = imageUrl.startsWith("/") ? `${baseUrl}${imageUrl}` : imageUrl;
  let parsed: URL;
  try {
    parsed = new URL(absoluteUrl);
  } catch {
    throw new Error("Instagram image URL is invalid");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("Instagram image URL must use HTTP or HTTPS");
  }

  const response = await fetch(parsed, {
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
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
    platform.replace(/[^a-z0-9_-]/gi, "-"),
    contentType.replace(/[^a-z0-9_-]/gi, "-"),
    Date.now(),
    randomUUID(),
  ].join("-") + `.${extensionForMime(mimeType)}`;

  await db.insert(workspaceFilesTable).values({
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
  const response = await fetch(`http://127.0.0.1:${port}/api/integrations/composio/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

  const contentMediaArgs = isReel
    ? { video_url: videoUrl }
    : { image_url: imageUrl };
  const createArgs: JsonRecord = {
    caption,
    ...contentMediaArgs,
    content_type: isReel ? "reel" : "photo",
    ...(isReel ? { media_type: "REELS" } : isStory ? { media_type: "STORIES" } : {}),
  };

  const step1 = await composioExecute(port, "INSTAGRAM_CREATE_MEDIA_CONTAINER", createArgs);
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
// serves only image files from the Pictures workspace and exposes no file listing.
router.get("/social/assets/:filename", async (req, res) => {
  if (!dbGuard(res)) return;
  const filename = String(req.params.filename || "");
  if (!/^[a-zA-Z0-9._-]{1,500}$/.test(filename)) {
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
router.post("/social/publish/:id", async (req: Request, res: Response, next: NextFunction) => {
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
