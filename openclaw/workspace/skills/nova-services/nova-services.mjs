#!/usr/bin/env node
import fs from "node:fs/promises";

const API_BASE = (process.env.NOVA_INTERNAL_API_BASE || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const API_KEY = process.env.SUPERNOVA_API_KEY || process.env.OPENCLAW_API_KEY || "";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function required(args, key) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required option --${key}`);
  }
  return value.trim();
}

function intOption(args, key, fallback, min, max) {
  if (args[key] == null) return fallback;
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${key} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function numberOption(args, key, fallback, min, max) {
  if (args[key] == null) return fallback;
  const value = Number(args[key]);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${key} must be a number from ${min} to ${max}`);
  }
  return value;
}

function jsonObjectOption(args, key, fallback = {}) {
  if (args[key] == null) return fallback;
  const raw = required(args, key);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--${key} must be valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`--${key} must be a JSON object`);
  }
  return parsed;
}

async function request(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body == null ? {} : { "Content-Type": "application/json" }),
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    ...(options.headers || {}),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 60_000));
  timeout.unref?.();
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const error = new Error(`NOVA API ${response.status} ${response.statusText}`);
      error.details = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function run(command, args) {
  switch (command) {
    case "status": {
      const [api, openclaw, composio, vectorMemory] = await Promise.all([
        request("/healthz"),
        request("/openclaw/status").catch((error) => ({
          status: "unavailable",
          error: error.message,
          details: error.details,
        })),
        request("/integrations/composio/status").catch((error) => ({
          configured: false,
          error: error.message,
          details: error.details,
        })),
        request("/vector-memory/status").catch((error) => ({
          available: false,
          error: error.message,
          details: error.details,
        })),
      ]);
      return { api, openclaw, composio, vectorMemory };
    }
    case "integrations":
      return request("/integrations");
    case "gmail": {
      const max = intOption(args, "max", 10, 1, 50);
      const query = typeof args.query === "string" ? args.query : "";
      return request(`/integrations/gmail/messages?max=${max}&q=${encodeURIComponent(query)}`);
    }
    case "drive": {
      const query = typeof args.query === "string" ? args.query : "";
      return request(`/integrations/drive/files?q=${encodeURIComponent(query)}`);
    }
    case "docs":
      return request(`/integrations/docs/${encodeURIComponent(required(args, "id"))}`);
    case "sheets": {
      const id = encodeURIComponent(required(args, "id"));
      const range = encodeURIComponent(typeof args.range === "string" ? args.range : "A1:Z100");
      return request(`/integrations/sheets/${id}?range=${range}`);
    }
    case "youtube":
      return request(`/integrations/youtube/search?q=${encodeURIComponent(required(args, "query"))}`);
    case "instagram":
      return request("/integrations/instagram/media");
    case "composio-status":
      return request("/integrations/composio/status");
    case "composio-apps": {
      const limit = intOption(args, "limit", 25, 1, 50);
      const search = typeof args.search === "string" ? args.search.trim() : "";
      const query = new URLSearchParams({ limit: String(limit) });
      if (search) query.set("search", search);
      return request(`/integrations/composio/toolkits?${query}`);
    }
    case "composio-connections":
      return request("/integrations/composio/connections");
    case "composio-connect":
      return request("/integrations/composio/connect", {
        method: "POST",
        body: JSON.stringify({ toolkit: required(args, "toolkit").toLowerCase() }),
      });
    case "composio-search":
      return request("/integrations/composio/search", {
        method: "POST",
        body: JSON.stringify({ query: required(args, "query") }),
      });
    case "composio-execute": {
      const body = {
        toolSlug: required(args, "tool"),
        arguments: jsonObjectOption(args, "arguments-json", {}),
        ...(typeof args.account === "string" && args.account.trim()
          ? { account: args.account.trim() }
          : {}),
      };
      return request("/integrations/composio/execute", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 180_000,
      });
    }
    case "github-repo": {
      const url = required(args, "url");
      return request("/integrations/composio/search", {
        method: "POST",
        body: JSON.stringify({
          query: `Inspect and analyze the GitHub repository ${url}. Find tools to read repository metadata, default branch, directory tree, important files, commits, issues, and pull requests without modifying the repository.`,
        }),
      });
    }
    case "knowledge-search": {
      const query = required(args, "query");
      const limit = intOption(args, "limit", 5, 1, 20);
      return request("/knowledge/search", {
        method: "POST",
        body: JSON.stringify({ query, limit }),
      });
    }
    case "knowledge-ingest": {
      const source = typeof args.source === "string" ? args.source : "openclaw";
      const title = typeof args.title === "string" ? args.title : "";
      let content = typeof args.content === "string" ? args.content : "";
      if (typeof args.file === "string") {
        content = await fs.readFile(args.file, "utf8");
      }
      if (!content.trim()) throw new Error("Provide --content or --file for knowledge-ingest");
      const body = {
        source,
        title,
        content,
        ...(typeof args["external-id"] === "string"
          ? { externalId: args["external-id"] }
          : {}),
      };
      return request("/knowledge/ingest", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 180_000,
      });
    }
    case "vector-status":
      return request("/vector-memory/status");
    case "vector-search": {
      const body = {
        query: required(args, "query"),
        limit: intOption(args, "limit", 8, 1, 20),
        minimumScore: numberOption(args, "minimum-score", 0.25, 0, 1),
        includeContext: true,
        ...(typeof args["mission-id"] === "string" ? { missionId: args["mission-id"] } : {}),
        ...(typeof args["scope-key"] === "string" ? { scopeKey: args["scope-key"] } : {}),
        ...(typeof args.phase === "string" ? { phase: args.phase.toUpperCase() } : {}),
        ...(typeof args.intent === "string" ? { intent: args.intent.toLowerCase() } : {}),
        ...(typeof args.types === "string"
          ? { memoryTypes: args.types.split(",").map((value) => value.trim()).filter(Boolean) }
          : {}),
      };
      return request("/vector-memory/search", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 180_000,
      });
    }
    case "vector-ingest": {
      let content = typeof args.content === "string" ? args.content : "";
      if (typeof args.file === "string") content = await fs.readFile(args.file, "utf8");
      if (!content.trim()) throw new Error("Provide --content or --file for vector-ingest");
      const body = {
        content,
        memoryType: typeof args.type === "string" ? args.type : "semantic",
        scope: typeof args.scope === "string" ? args.scope : "global",
        scopeKey: typeof args["scope-key"] === "string" ? args["scope-key"] : "",
        source: typeof args.source === "string" ? args.source : "openclaw",
        verification: typeof args.verification === "string" ? args.verification : "claimed",
        confidence: numberOption(args, "confidence", 0.5, 0, 1),
        importance: numberOption(args, "importance", 0.5, 0, 1),
        salience: numberOption(args, "salience", 0.5, 0, 1),
        metadata: jsonObjectOption(args, "metadata-json", {}),
        ...(typeof args["mission-id"] === "string" ? { missionId: args["mission-id"] } : {}),
        ...(typeof args["agent-id"] === "string" ? { agentId: args["agent-id"] } : {}),
        ...(typeof args["external-id"] === "string" ? { externalId: args["external-id"] } : {}),
      };
      return request("/vector-memory/ingest", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 180_000,
      });
    }
    case "vector-feedback": {
      const ids = required(args, "ids")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
      if (!ids.length) throw new Error("--ids must contain at least one positive integer id");
      const successful = String(args.successful ?? "true").toLowerCase() !== "false";
      return request("/vector-memory/feedback", {
        method: "POST",
        body: JSON.stringify({ ids, successful }),
      });
    }
    case "skills": {
      if (typeof args.name === "string" && args.name.trim()) {
        return request(`/skills/${encodeURIComponent(args.name.trim())}`);
      }
      return request("/skills");
    }
    case "scratchpad":
      return request("/scratchpad");

    // ── Media generation ─────────────────────────────────────────────────
    case "image-generate": {
      // Gemini image generation: prompt → image URL served from the API
      const prompt = required(args, "prompt");
      const model  = typeof args.model  === "string" ? args.model  : "gemini"; // gemini | imagen3
      const count  = args.count  != null ? Number(args.count)  : 1;
      const aspect = typeof args["aspect-ratio"] === "string" ? args["aspect-ratio"] : "1:1";
      return request("/media/image/generate", {
        method: "POST",
        body: JSON.stringify({ prompt, model, count, aspectRatio: aspect }),
        timeoutMs: 120_000,
      });
    }
    case "video-avatar": {
      // A2E AI avatar video: script text → speaking-avatar video URL
      const script    = required(args, "script");
      const avatarId  = typeof args["avatar-id"]  === "string" ? args["avatar-id"]  : undefined;
      const voiceId   = typeof args["voice-id"]   === "string" ? args["voice-id"]   : undefined;
      const quality   = typeof args.quality       === "string" ? args.quality       : "standard";
      const background = typeof args.background   === "string" ? args.background    : undefined;
      const body = { script, quality };
      if (avatarId)  body.avatar_id  = avatarId;
      if (voiceId)   body.voice_id   = voiceId;
      if (background) body.background = background;
      return request("/media/video/avatar", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 180_000,
      });
    }
    case "video-from-image": {
      // A2E image-to-video: animated video from a still image (async)
      const imageUrl = required(args, "image-url");
      const prompt   = typeof args.prompt   === "string" ? args.prompt   : undefined;
      const duration = args.duration != null ? Number(args.duration) : 5;
      const body = { image_url: imageUrl, duration };
      if (prompt) body.prompt = prompt;
      return request("/media/video/image-to-video", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 60_000,
      });
    }
    case "video-status": {
      // Poll an A2E async video task
      const id = required(args, "id");
      return request(`/media/video/status/${encodeURIComponent(id)}`);
    }
    case "video-list": {
      // List all A2E video tasks
      return request("/media/video/list");
    }

    // ── Workspace file store ──────────────────────────────────────────────
    case "workspace-view-image": {
      // Read an image stored in a workspace and extract its content via
      // GPT-4o vision. Use this whenever a workspace file has an image
      // contentType (image/png, image/jpeg, image/webp, etc.) — do NOT
      // try to read raw base64 yourself.
      //
      // Usage:
      //   workspace-view-image --workspace pictures --filename 'shot.png'
      //   workspace-view-image --workspace pictures --filename 'shot.png' \
      //     --prompt 'List every GitHub repository URL visible in this image'
      const ws       = required(args, "workspace").toLowerCase();
      const filename = required(args, "filename");
      const prompt   = typeof args.prompt === "string" && args.prompt.trim()
        ? args.prompt.trim()
        : "Extract ALL text visible in this image verbatim. " +
          "If you see any URLs (GitHub repos, websites, or other links), list them clearly on separate lines.";

      // Step 1: fetch the file from the workspace store
      const fileData = await request(
        `/workspaces/${encodeURIComponent(ws)}/files/${encodeURIComponent(filename)}`,
      );
      const rawContent  = fileData.content ?? "";
      const contentType = fileData.contentType || "image/png";

      if (!rawContent) throw new Error(`File '${filename}' in workspace '${ws}' has no content`);

      // Step 2: normalise to a data URL the vision API understands
      const dataUrl = rawContent.startsWith("data:")
        ? rawContent
        : `data:${contentType};base64,${rawContent}`;

      // Step 3: call GPT-4o vision directly (bypass proxy to avoid agent-loop)
      const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
      if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set — vision analysis unavailable");

      const ctrl   = new AbortController();
      const timer  = setTimeout(() => ctrl.abort(), 90_000);
      let visionJson;
      try {
        const visionRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization:  `Bearer ${OPENAI_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [{
              role: "user",
              content: [
                { type: "text",      text: prompt },
                { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
              ],
            }],
            max_tokens: 4096,
          }),
          signal: ctrl.signal,
        });
        if (!visionRes.ok) {
          const errText = await visionRes.text().catch(() => "");
          throw new Error(`Vision API error ${visionRes.status}: ${errText.slice(0, 400)}`);
        }
        visionJson = await visionRes.json();
      } finally {
        clearTimeout(timer);
      }

      const analysis = visionJson.choices?.[0]?.message?.content || "";
      return { filename, workspace: ws, contentType, analysis };
    }

    case "workspace-list": {
      // List all workspaces (no --workspace) or files in one workspace.
      const ws = typeof args.workspace === "string" ? args.workspace.trim().toLowerCase() : "";
      if (ws) {
        return request(`/workspaces/${encodeURIComponent(ws)}/files`);
      }
      return request("/workspaces");
    }
    case "workspace-read": {
      const ws = required(args, "workspace").toLowerCase();
      const filename = required(args, "filename");
      return request(`/workspaces/${encodeURIComponent(ws)}/files/${encodeURIComponent(filename)}`);
    }
    case "workspace-write": {
      const ws = required(args, "workspace").toLowerCase();
      let content = typeof args.content === "string" ? args.content : "";
      if (typeof args.file === "string") {
        content = await fs.readFile(args.file, "utf8");
      }
      if (!content && !args.file) throw new Error("Provide --content 'text' or --file ./path for workspace-write");
      const filename = required(args, "filename");
      const contentType = typeof args["content-type"] === "string" ? args["content-type"] : "text/plain";
      return request(`/workspaces/${encodeURIComponent(ws)}/files`, {
        method: "POST",
        body: JSON.stringify({ filename, content, contentType }),
      });
    }
    case "workspace-delete": {
      const ws = required(args, "workspace").toLowerCase();
      const filename = required(args, "filename");
      return request(`/workspaces/${encodeURIComponent(ws)}/files/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });
    }

    // ── Social media ──────────────────────────────────────────────────────
    case "social-post": {
      // Full pipeline: generate caption + image (Bitdeer primary), schedule, publish.
      //
      // Usage:
      //   social-post --platform instagram --content-type reel --description "morning routine tips" --tone motivational --post-now
      //   social-post --platform twitter --content-type post --description "new product launch" --tone bold --schedule-at "2026-07-17T10:00:00Z"
      //   social-post --platform instagram --content-type post --description "sunset photo" --no-image --post-now
      //
      // Flags:
      //   --platform         instagram | twitter | facebook | linkedin | tiktok | youtube
      //   --content-type     post | reel | story | portrait | landscape | video | shorts | thumbnail | square
      //   --description      what the post is about (required)
      //   --tone             motivational | inspirational | educational | funny | bold | sarcastic | optimistic | professional
      //   --post-now         publish immediately after generating (default: save as draft)
      //   --schedule-at      ISO datetime to schedule the post
      //   --no-image         skip image generation
      //   --caption          provide your own caption (skips AI caption gen)
      //   --hashtags         provide your own hashtags
      //
      const platform    = typeof args.platform     === "string" ? args.platform.toLowerCase()     : "instagram";
      const contentType = typeof args["content-type"] === "string" ? args["content-type"].toLowerCase() : "post";
      const description = required(args, "description");
      const tone        = typeof args.tone         === "string" ? args.tone                        : "motivational";
      const postNow     = args["post-now"] === true || args["post-now"] === "true";
      const scheduleAt  = typeof args["schedule-at"] === "string" ? args["schedule-at"] : undefined;
      const noImage     = args["no-image"] === true || args["no-image"] === "true";
      const customCaption  = typeof args.caption  === "string" ? args.caption  : undefined;
      const customHashtags = typeof args.hashtags === "string" ? args.hashtags : undefined;

      // Step 1: Generate caption + image via the social API
      const generated = await request("/social/generate", {
        method: "POST",
        body: JSON.stringify({
          platform, contentType, description, tone,
          generateImage: !noImage && !customCaption,
        }),
        timeoutMs: 120_000,
      });

      const caption  = customCaption  ?? generated.caption  ?? "";
      const hashtags = customHashtags ?? generated.hashtags ?? "";
      const imageUrl = generated.imageUrl ?? "";

      if (!caption && !imageUrl) {
        throw new Error("Generation produced no caption or image — cannot post");
      }

      // Step 2: Save to schedule table
      const scheduleBody = {
        platform, contentType, description, tone,
        caption, hashtags, imageUrl,
        aspectRatio: generated.aspectRatio ?? "1:1",
        dimensions:  generated.dimensions  ?? "1080×1080",
        ...(scheduleAt ? { scheduledAt: scheduleAt, status: "pending" } : { status: postNow ? "pending" : "draft" }),
      };
      const saved = await request("/social/schedule", {
        method: "POST",
        body: JSON.stringify(scheduleBody),
      });
      const postId = saved?.post?.id;

      if (!postId) {
        return { generated, saved, warning: "Post saved but no ID returned — cannot auto-publish" };
      }

      // Step 3: Publish immediately if --post-now
      if (postNow) {
        const published = await request(`/social/publish/${postId}`, {
          method: "POST",
          timeoutMs: 60_000,
        });
        return {
          generated: { caption, hashtags, imageUrl, imageSource: generated.imageSource },
          postId,
          published,
          status: published.ok ? "published" : "failed",
          composioResult: published.composioResult,
          toolSlug: published.toolSlug,
        };
      }

      // Step 4: Return draft/scheduled summary
      return {
        generated: { caption, hashtags, imageUrl, imageSource: generated.imageSource },
        postId,
        status: scheduleAt ? `scheduled for ${scheduleAt}` : "draft (saved)",
        note: "Call social-publish to post now, or it will auto-publish at the scheduled time.",
      };
    }

    case "social-publish": {
      // Publish a saved post by ID.
      // Usage: social-publish --id 42
      const postId = required(args, "id");
      return request(`/social/publish/${encodeURIComponent(postId)}`, {
        method: "POST",
        timeoutMs: 60_000,
      });
    }

    case "social-debug": {
      // Show Composio status, last 5 posts, and image gen config.
      return request("/social/debug");
    }

    default:
      throw new Error(
        "Unknown command. Use one of: status, integrations, gmail, drive, docs, sheets, youtube, instagram, composio-status, composio-apps, composio-connections, composio-connect, composio-search, composio-execute, github-repo, knowledge-search, knowledge-ingest, vector-status, vector-search, vector-ingest, vector-feedback, skills, scratchpad, image-generate, video-avatar, video-from-image, video-status, video-list, workspace-list, workspace-read, workspace-write, workspace-delete, workspace-view-image, social-post, social-publish, social-debug",
      );
  }
}

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node nova-services.mjs <command> [--option value]");
  process.exit(2);
}

try {
  const result = await run(command, parseArgs(rest));
  process.stdout.write(`${JSON.stringify({ ok: true, command, result }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        command,
        error: error instanceof Error ? error.message : String(error),
        details: error?.details,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}
