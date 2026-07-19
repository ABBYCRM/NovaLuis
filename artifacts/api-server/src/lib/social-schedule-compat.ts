type UnknownRecord = Record<string, unknown>;

const FIELD_PAIRS = [
  ["campaignId", "campaign_id"],
  ["intervalHours", "interval_hours"],
  ["contentType", "content_type"],
  ["imageUrl", "image_url"],
  ["videoUrl", "video_url"],
  ["aspectRatio", "aspect_ratio"],
  ["referenceImageId", "reference_image_id"],
  ["scheduledAt", "scheduled_at"],
  ["publishedAt", "published_at"],
  ["errorMessage", "error_message"],
  ["composioResult", "composio_result"],
  ["createdAt", "created_at"],
  ["updatedAt", "updated_at"],
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Additive compatibility serializer for the handwritten Nova Scheduled UI.
 *
 * Drizzle returns camelCase property names, while the established renderer in
 * artifacts/nova/index.html still reads legacy snake_case names. Both shapes
 * are returned so old and new clients keep working. Existing values always win.
 */
export function addScheduledPostAliases(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const post: UnknownRecord = { ...value };

  for (const [camel, snake] of FIELD_PAIRS) {
    if (post[snake] == null && post[camel] != null) post[snake] = post[camel];
    if (post[camel] == null && post[snake] != null) post[camel] = post[snake];
  }

  return post;
}

/** Normalize only payloads shaped like { posts: [...] }; pass everything else through. */
export function normalizeSocialSchedulePayload(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.posts)) return payload;
  return {
    ...payload,
    posts: payload.posts.map(addScheduledPostAliases),
  };
}
