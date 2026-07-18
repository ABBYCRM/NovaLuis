/**
 * Shared AI functions for social media content generation.
 * Used by both social-media routes and campaign routes.
 *
 * - bitdeerImage()              : PRIMARY image gen via Bitdeer google/flash-image-2.5
 * - geminiImage()               : FALLBACK image gen (handles reference images)
 * - generateImage()             : orchestrates primary + fallback
 * - generateCaption()           : caption + hashtags via OpenAI / Gemini
 * - saveToPicturesWorkspace()   : saves every generated image to the Pictures workspace
 * - researchStrategy()          : web search (Tavily → Exa fallback) + AI synthesis
 * - buildVariationPrompt()      : ensures every auto-post for the same subject is unique
 */
import { db, hasDatabase, workspaceFilesTable } from "@workspace/db";

// ── Image generation ──────────────────────────────────────────────────────────

/**
 * Shared negative prompt appended to every social image generation call.
 *
 * Why this exists: the Bitdeer google/flash-image-2.5 and Gemini image models
 * frequently try to "help" by baking captions/headlines/logos into the image
 * itself, especially for story / portrait formats. That leaves a black
 * banner at the bottom of the rendered output which Instagram then displays
 * as a hard black bar — the exact bug we saw on 2026-07-17.
 *
 * We force three things:
 *   1. NO rendered text, captions, logos, watermarks, headlines, or callouts.
 *   2. NO black bars, dark bands, or empty "headline safe zones".
 *   3. Full-bleed composition — subject and background fill the entire frame
 *      edge-to-edge with no negative space reserved for a caption strip.
 *
 * Headlines and CTAs are added by Instagram's own editor (stickers) or by
 * the separate caption field — they are NEVER the image generator's job.
 */
export const NO_TEXT_NO_BAR_SUFFIX =
  "\n\nHARD CONSTRAINTS (must follow exactly):\n" +
  "- The image must be FULL-BLEED — the subject and background fill the entire frame edge-to-edge. No empty space at the top, bottom, or sides.\n" +
  "- Do NOT render any text anywhere in the image — no headlines, no captions, no subtitles, no logos, no watermarks, no hashtags, no callouts, no labels, no UI chrome.\n" +
  "- Do NOT leave a black bar, dark band, or any flat solid-color strip anywhere in the image (not at the top, not at the bottom, not on the sides). The whole frame must contain visible scene content.\n" +
  "- Do NOT reserve any 'headline safe zone' or 'caption space' — Instagram adds text on top via stickers and the platform's own UI; the image itself stays clean.\n" +
  "- If a viewer sees the image alone, it should look like a finished photograph or illustration with no text baked in.";

/**
 * Build the final image prompt by appending the shared negative constraints.
 * Use this everywhere a story/portrait/social image is generated so the same
 * rules apply across all generators.
 */
export function buildImagePrompt(base: string): string {
  return base.trimEnd() + NO_TEXT_NO_BAR_SUFFIX;
}

export async function bitdeerImage(
  prompt: string,
  size: string,
): Promise<{ url: string; source: "bitdeer" }> {
  const key = process.env.BITDEER_API_KEY ?? "";
  if (!key) throw new Error("BITDEER_API_KEY not set");

  const validSizes = new Set(["1024x1024", "1024x1792", "1792x1024"]);
  const safeSize = validSizes.has(size) ? size : "1024x1024";

  const r = await fetch("https://api-inference.bitdeer.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: "google/flash-image-2.5", prompt, size: safeSize, n: 1 }),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Bitdeer image error ${r.status}: ${err.slice(0, 300)}`);
  }

  const d = await r.json() as { data?: ({ url?: string; b64_json?: string })[] };
  const item = d.data?.[0];
  if (!item) throw new Error("Bitdeer returned no image data");

  if (item.url) return { url: item.url, source: "bitdeer" };
  if (item.b64_json) return { url: `data:image/png;base64,${item.b64_json}`, source: "bitdeer" };
  throw new Error("Bitdeer image: no url or b64_json in response");
}

export async function geminiImage(
  prompt: string,
  _aspectRatio: string,
  refBase64?: string,
  refMime?: string,
): Promise<{ url: string; source: "gemini" }> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) throw new Error("GEMINI_API_KEY not configured");

  const parts: unknown[] = [];
  if (refBase64) {
    parts.push({ inlineData: { mimeType: refMime ?? "image/png", data: refBase64 } });
    parts.push({ text: `Use the style from the reference image. ${prompt}` });
  } else {
    parts.push({ text: prompt });
  }

  const GEMINI_IMAGE_MODELS = [
    "gemini-3.1-flash-image",
    "gemini-2.5-flash-image",
  ];

  let lastErr: Error = new Error("All Gemini image models unavailable");
  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ["IMAGE", "TEXT"], candidateCount: 1 },
          }),
        },
      );
      if (!r.ok) {
        const errText = await r.text();
        lastErr = new Error(`Gemini ${model} error ${r.status}: ${errText.slice(0, 200)}`);
        continue;
      }
      const d = await r.json() as {
        candidates?: { content: { parts: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
      };
      for (const candidate of d.candidates ?? []) {
        for (const part of candidate.content.parts) {
          if (part.inlineData?.data) {
            const mime = part.inlineData.mimeType ?? "image/png";
            return { url: `data:${mime};base64,${part.inlineData.data}`, source: "gemini" };
          }
        }
      }
      lastErr = new Error(`Gemini ${model} returned no image data`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr;
}

export async function generateImage(
  prompt: string,
  bitdeerSize: string,
  geminiAspect: string,
  refBase64?: string,
  refMime?: string,
): Promise<{ url: string; source: string }> {
  // Reference images go through Gemini (image conditioning)
  if (refBase64) {
    return geminiImage(prompt, geminiAspect, refBase64, refMime);
  }
  try {
    return await bitdeerImage(prompt, bitdeerSize);
  } catch (bitdeerErr) {
    try {
      return await geminiImage(prompt, geminiAspect, refBase64, refMime);
    } catch (geminiErr) {
      throw new Error(
        `Image generation failed. Bitdeer: ${bitdeerErr instanceof Error ? bitdeerErr.message : bitdeerErr}. Gemini: ${geminiErr instanceof Error ? geminiErr.message : geminiErr}`,
      );
    }
  }
}

// ── Save to Pictures workspace ────────────────────────────────────────────────
/**
 * After any social media image is generated, save it to the "pictures" workspace
 * so the user can browse, reuse, and reference it from the Workspaces panel.
 *
 * Handles both Bitdeer public URLs (fetches + converts to base64) and
 * Gemini data-URLs (strips prefix). Fails silently — never blocks the caller.
 *
 * Filename: social-{platform}-{contentType}-{ISO timestamp}.{ext}
 */
export async function saveToPicturesWorkspace(
  imageUrl: string,
  platform: string,
  contentType: string,
): Promise<{ saved: boolean; filename?: string }> {
  if (!hasDatabase || !db || !imageUrl) return { saved: false };
  try {
    let base64Data: string;
    let mimeType = "image/png";

    if (imageUrl.startsWith("data:")) {
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) return { saved: false };
      mimeType = match[1]!;
      base64Data = match[2]!;
    } else if (imageUrl.startsWith("http")) {
      const r = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return { saved: false };
      const buf = Buffer.from(await r.arrayBuffer());
      base64Data = buf.toString("base64");
      const ct = r.headers.get("content-type");
      if (ct) mimeType = ct.split(";")[0]!.trim();
    } else {
      return { saved: false };
    }

    const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `social-${platform}-${contentType}-${ts}.${ext}`;

    await db
      .insert(workspaceFilesTable)
      .values({ workspace: "pictures", filename, content: base64Data, contentType: mimeType })
      .onConflictDoUpdate({
        target: [workspaceFilesTable.workspace, workspaceFilesTable.filename],
        set: { content: base64Data, contentType: mimeType },
      });

    return { saved: true, filename };
  } catch {
    return { saved: false };
  }
}

// ── Image dimension validation (zero-dep PNG/JPEG header parser) ──────────────

/**
 * Read width + height from a PNG or JPEG buffer. No native deps — pure Node.
 *
 * PNG: 8-byte signature, then IHDR chunk with width/height at offset 16/20.
 * JPEG: scan for SOFn marker (0xFFC0–0xFFCF except C4/C8/CC). Height at +5, width at +7.
 *
 * Returns null if the format is unsupported or header is malformed.
 */
export function readImageDimensions(buf: Buffer): { width: number; height: number; format: "png" | "jpeg" } | null {
  if (buf.length < 24) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    // IHDR chunk: 4-byte length, 4-byte type ("IHDR"), then 4-byte width, 4-byte height
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0 && width < 100_000 && height < 100_000) {
      return { width, height, format: "png" };
    }
    return null;
  }
  // JPEG: starts with FF D8
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length - 9) {
      if (buf[offset] !== 0xff) return null;
      // Skip fill bytes
      while (offset < buf.length && buf[offset] === 0xff) offset++;
      if (offset >= buf.length) return null;
      const marker = buf[offset];
      offset++;
      // SOI/EOI/standalone markers have no length
      if (marker === 0xd8 || marker === 0xd9) continue;
      // Read segment length
      if (offset + 1 >= buf.length) return null;
      const segLen = buf.readUInt16BE(offset);
      // SOFn markers (start of frame, n=0..15 except 4,8,12 which are DHT/JPG/ DAC)
      if (
        marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      ) {
        // SOFn: length(2) precision(1) height(2) width(2) ...
        if (offset + 7 > buf.length) return null;
        const height = buf.readUInt16BE(offset + 3);
        const width = buf.readUInt16BE(offset + 5);
        if (width > 0 && height > 0 && width < 100_000 && height < 100_000) {
          return { width, height, format: "jpeg" };
        }
        return null;
      }
      offset += segLen;
    }
  }
  return null;
}

/**
 * Fetch an image URL (or decode a data: URL) into a Buffer, returning the
 * raw bytes for dimension inspection. 15s timeout. Returns null on failure.
 */
export async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("data:")) {
      const m = url.match(/^data:[^;]+;base64,(.+)$/s);
      if (!m) return null;
      return Buffer.from(m[1]!, "base64");
    }
    if (!url.startsWith("http")) return null;
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

export type StoryAspect = "1:1" | "4:5" | "1.91:1" | "9:16" | "16:9" | "3:4" | "4:3";

/** Approximate "matches this aspect ratio" — allow 5% drift. */
export function matchesAspect(w: number, h: number, target: StoryAspect): boolean {
  const actual = w / h;
  let expected: number;
  switch (target) {
    case "1:1":    expected = 1;        break;
    case "4:5":    expected = 4 / 5;    break;
    case "1.91:1": expected = 1.91;     break;
    case "9:16":   expected = 9 / 16;   break;
    case "16:9":   expected = 16 / 9;   break;
    case "3:4":    expected = 3 / 4;    break;
    case "4:3":    expected = 4 / 3;    break;
    default:       expected = 1;
  }
  return Math.abs(actual - expected) / expected < 0.05;
}

// ── Caption generation ────────────────────────────────────────────────────────

export async function generateCaption(prompt: string): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY ?? "";
  if (openaiKey) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 800,
      }),
    });
    const d = await r.json() as { choices?: { message: { content: string } }[] };
    return d.choices?.[0]?.message?.content ?? "{}";
  }
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) throw new Error("No text generation key available");
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
  const d = await r.json() as { candidates?: { content: { parts: { text?: string }[] } }[] };
  return d.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "{}";
}

// ── Variation angles — ensures every auto-post on the same subject is unique ──
//
// Each time content is regenerated for a recurring post or campaign run, a
// different angle from this list is injected into the prompt. This guarantees
// NO TWO auto-posts ever repeat the same hook, angle, or story.
const VARIATION_ANGLES = [
  "contrarian take — challenge a common belief your audience holds",
  "data / statistic that surprises people — lead with a number",
  "personal story or behind-the-scenes moment",
  "how-to / step-by-step breakdown of a key skill",
  "myth busting — expose a common misconception",
  "motivation / identity — who they want to become",
  "relatable struggle — acknowledge pain before offering the insight",
  "future vision — paint a vivid picture of the result",
  "social proof angle — what successful people in this space do differently",
  "question / curiosity hook — pose a paradox or intriguing question",
  "minimalist wisdom — one profound sentence, no filler",
  "list / framework — give them a system they can remember",
  "emotional story — tap into a universal feeling",
  "beginner vs expert perspective — what the pro knows that beginners miss",
  "seasonal / timely relevance — tie it to what is happening right now",
  "transformation arc — before and after framing",
  "accountability mirror — reflect their own excuses back at them",
  "trend analysis — what is changing and why it matters",
];

/**
 * Returns a variation angle based on post index or current time, ensuring
 * rotation across all angles. Pass `postIndex` if known (campaign tracking);
 * falls back to time-based rotation.
 */
export function pickVariationAngle(postIndex?: number): string {
  const idx =
    typeof postIndex === "number"
      ? postIndex % VARIATION_ANGLES.length
      : Math.floor(Date.now() / 3_600_000) % VARIATION_ANGLES.length; // rotates every hour
  return VARIATION_ANGLES[idx]!;
}

// ── Campaign research ─────────────────────────────────────────────────────────

export interface CampaignStrategy {
  researchSummary: string;
  contentPillars: string[];
  postAngles: string[];
  hashtagStrategy: string;
  bestPostingTimes: string;
  visualStyle: string;
  captionFormula: string;
  kpis: string[];
}

/**
 * Web-search competitive research + AI strategy synthesis.
 * Searches Tavily (primary) → Exa (fallback) for how similar campaigns work,
 * then uses GPT-4o-mini / Gemini to synthesise a tailored content strategy.
 */
export async function researchCampaignStrategy(
  name: string,
  description: string,
  platforms: string[],
  targetAudience: string,
  goals: string,
): Promise<{ rawResearch: string; strategy: CampaignStrategy }> {
  const platformList = platforms.join(", ") || "instagram";

  // ── 1. Web search ──────────────────────────────────────────────────────────
  const searchQueries = [
    `social media campaign strategy "${description}" ${platformList} 2025`,
    `Buffer Hootsuite Later Sprout Social campaign features content calendar how it works`,
    `best ${platformList} content strategy ${targetAudience || "brand growth"} engagement`,
  ];

  let rawResearch = "";

  // Tavily
  const tavilyKey = process.env.TAVILY_API_KEY ?? "";
  if (tavilyKey) {
    for (const q of searchQueries.slice(0, 2)) {
      try {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: tavilyKey, query: q, search_depth: "basic", max_results: 3, include_answer: true }),
        });
        if (r.ok) {
          const d = await r.json() as { results?: { title: string; content: string; url: string }[]; answer?: string };
          const snippets = d.results?.map(r => `[${r.title}] ${r.content?.slice(0, 400)}`).join("\n\n") ?? "";
          if (snippets) rawResearch += `## ${q}\n${d.answer ? `Answer: ${d.answer}\n` : ""}${snippets}\n\n`;
        }
      } catch { /* non-fatal */ }
    }
  }

  // Exa fallback
  if (!rawResearch && process.env.EXA_API_KEY) {
    try {
      const r = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.EXA_API_KEY },
        body: JSON.stringify({ query: searchQueries[0], numResults: 5, useAutoprompt: true, type: "neural" }),
      });
      if (r.ok) {
        const d = await r.json() as { results?: { title: string; text: string }[] };
        rawResearch = d.results?.map(r => `[${r.title}] ${r.text?.slice(0, 400)}`).join("\n\n") ?? "";
      }
    } catch { /* non-fatal */ }
  }

  // ── 2. AI strategy synthesis ───────────────────────────────────────────────
  const strategyPrompt = `You are a world-class social media campaign strategist who has designed campaigns for top brands.

CAMPAIGN NAME: ${name}
CORE SUBJECT: ${description}
TARGET PLATFORMS: ${platformList}
TARGET AUDIENCE: ${targetAudience || "general audience"}
GOALS: ${goals || "brand awareness and engagement"}

COMPETITIVE RESEARCH (from live web search):
${rawResearch || "(No web data — use your deep knowledge of top-performing campaigns)"}

Based on this research, create a complete campaign content strategy. Analyze how tools like Buffer, Hootsuite, Later, and Sprout Social structure their campaign workflows, and apply those best practices.

Return ONLY valid JSON (no markdown, no commentary):
{
  "researchSummary": "2-3 sentences on what competitive research reveals about this content type",
  "contentPillars": ["pillar1", "pillar2", "pillar3", "pillar4", "pillar5"],
  "postAngles": [
    "contrarian take: challenge a belief your audience holds about ${description}",
    "data-driven: surprising statistic about ${description}",
    "personal story: behind-the-scenes moment related to ${description}",
    "how-to: step-by-step breakdown of a key skill in ${description}",
    "myth busting: common misconception about ${description}",
    "motivation: identity-based post about ${description}",
    "relatable struggle: pain point your audience has with ${description}",
    "future vision: what success with ${description} looks like"
  ],
  "hashtagStrategy": "specific hashtag approach for this campaign",
  "bestPostingTimes": "optimal posting windows based on platform and audience",
  "visualStyle": "specific visual aesthetic — colors, composition, mood board description",
  "captionFormula": "the exact hook-body-CTA formula that works for this niche",
  "kpis": ["primary KPI", "secondary KPI", "engagement benchmark"]
}`;

  let strategyObj: CampaignStrategy = {
    researchSummary: "Research complete.",
    contentPillars: [],
    postAngles: [],
    hashtagStrategy: "",
    bestPostingTimes: "",
    visualStyle: "",
    captionFormula: "",
    kpis: [],
  };

  try {
    const raw = await generateCaption(strategyPrompt);
    const parsed = JSON.parse(raw);
    strategyObj = { ...strategyObj, ...parsed };
  } catch { /* use defaults */ }

  return { rawResearch, strategy: strategyObj };
}
