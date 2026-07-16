import { Router } from "express";

// DB access mirroring the scratchpad pattern — lazy + guarded so a DB outage
// never breaks the chat endpoint.
type DbModule = typeof import("@workspace/db");
type ReadyDbModule = DbModule & { db: NonNullable<DbModule["db"]> };

let _dbPromise: Promise<ReadyDbModule | null> | null = null;
async function getDb(): Promise<ReadyDbModule | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!_dbPromise) {
    _dbPromise = import("@workspace/db")
      .then((mod) => (mod.db ? (mod as ReadyDbModule) : null))
      .catch(() => null);
  }
  return _dbPromise;
}

const router = Router();

/**
 * GET /api/sessions/history?userId=<id>&limit=<n>
 *
 * Returns the most-recent turns for a given userId, in chronological order
 * (oldest first, ready to display top-to-bottom). The userId must be at least
 * 4 chars and contain only alphanumeric / dash / underscore characters.
 */
router.get("/sessions/history", async (req, res) => {
  const rawUserId = String(req.query.userId ?? "").trim();
  if (!rawUserId || rawUserId.length < 4 || !/^[a-zA-Z0-9_-]+$/.test(rawUserId)) {
    res.json({ turns: [] });
    return;
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);

  try {
    const mod = await getDb();
    if (!mod) {
      res.json({ turns: [] });
      return;
    }

    const { desc, like } = await import("drizzle-orm");

    // All conversation_keys for this user are prefixed `{userId}:…`
    const rows = await mod.db
      .select({
        userText: mod.conversationTurnsTable.userText,
        assistantText: mod.conversationTurnsTable.assistantText,
        createdAt: mod.conversationTurnsTable.createdAt,
      })
      .from(mod.conversationTurnsTable)
      .where(like(mod.conversationTurnsTable.conversationKey, `${rawUserId}:%`))
      .orderBy(desc(mod.conversationTurnsTable.createdAt))
      .limit(limit);

    // Reverse to chronological order so the client can render top-to-bottom
    rows.reverse();

    res.json({ turns: rows });
  } catch {
    res.json({ turns: [] });
  }
});

export default router;
