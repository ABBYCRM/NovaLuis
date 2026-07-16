import { Router, type NextFunction, type Request, type Response } from "express";
import { db, hasDatabase, socialCampaignsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function normalizedContentTypes(
  platformsValue: unknown,
  contentTypesValue: unknown,
): JsonRecord | null {
  const platforms = Array.isArray(platformsValue)
    ? platformsValue.filter((value): value is string => typeof value === "string")
    : [];
  const contentTypes = { ...(record(contentTypesValue) || {}) };

  if (platforms.includes("instagram")) {
    const current = typeof contentTypes.instagram === "string"
      ? contentTypes.instagram
      : "";
    if (!current || current === "reel") contentTypes.instagram = "post";
  } else if (contentTypes.instagram === "reel") {
    contentTypes.instagram = "post";
  }

  return Object.keys(contentTypes).length ? contentTypes : null;
}

function normalizeRequestBody(req: Request, _res: Response, next: NextFunction): void {
  const body = record(req.body);
  if (!body) {
    next();
    return;
  }

  const normalized = normalizedContentTypes(body.platforms, body.contentTypes);
  if (normalized) body.contentTypes = normalized;
  next();
}

async function normalizeStoredCampaign(id: number): Promise<void> {
  if (!hasDatabase || !db || !Number.isInteger(id)) return;
  const rows = await db
    .select({
      id: socialCampaignsTable.id,
      platforms: socialCampaignsTable.platforms,
      contentTypes: socialCampaignsTable.contentTypes,
    })
    .from(socialCampaignsTable)
    .where(eq(socialCampaignsTable.id, id))
    .limit(1);
  if (!rows.length) return;

  const campaign = rows[0]!;
  let platforms: unknown = [];
  let contentTypes: unknown = {};
  try { platforms = JSON.parse(campaign.platforms || "[]"); } catch { /* keep empty */ }
  try { contentTypes = JSON.parse(campaign.contentTypes || "{}"); } catch { /* keep empty */ }

  const normalized = normalizedContentTypes(platforms, contentTypes);
  if (!normalized || JSON.stringify(normalized) === JSON.stringify(contentTypes)) return;

  await db
    .update(socialCampaignsTable)
    .set({ contentTypes: JSON.stringify(normalized) })
    .where(eq(socialCampaignsTable.id, campaign.id));
}

async function normalizeOneStoredCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = Number(req.params.id);
  try {
    await normalizeStoredCampaign(id);
    next();
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function normalizeAllStoredCampaigns(_req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!hasDatabase || !db) {
    next();
    return;
  }

  try {
    const campaigns = await db
      .select({
        id: socialCampaignsTable.id,
        platforms: socialCampaignsTable.platforms,
        contentTypes: socialCampaignsTable.contentTypes,
      })
      .from(socialCampaignsTable);

    for (const campaign of campaigns) {
      let platforms: unknown = [];
      let contentTypes: unknown = {};
      try { platforms = JSON.parse(campaign.platforms || "[]"); } catch { /* keep empty */ }
      try { contentTypes = JSON.parse(campaign.contentTypes || "{}"); } catch { /* keep empty */ }
      const normalized = normalizedContentTypes(platforms, contentTypes);
      if (!normalized || JSON.stringify(normalized) === JSON.stringify(contentTypes)) continue;
      await db
        .update(socialCampaignsTable)
        .set({ contentTypes: JSON.stringify(normalized) })
        .where(eq(socialCampaignsTable.id, campaign.id));
    }
    next();
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// The Social Media runtime currently produces still images. Normalize every
// Instagram campaign to image posts until a real public video URL pipeline is
// implemented; otherwise campaigns repeatedly schedule Reels that cannot publish.
router.post("/social/campaigns", normalizeRequestBody);
router.put("/social/campaigns/:id", normalizeRequestBody);
router.post("/social/campaigns/:id/activate", normalizeOneStoredCampaign);
router.post("/social/campaigns/:id/run", normalizeOneStoredCampaign);
router.post("/social/campaigns/run-due", normalizeAllStoredCampaigns);

export default router;
