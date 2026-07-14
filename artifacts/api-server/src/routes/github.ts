import { Router } from "express";
import { z } from "zod";
import {
  extractGitHubRepoRefs,
  getGitHubEvidenceForText,
} from "../lib/github-repo";

const router = Router();

const preflightSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
});

router.post("/github/preflight", async (req, res) => {
  const parsed = preflightSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request", details: parsed.error.issues });
    return;
  }

  const repositories = extractGitHubRepoRefs(parsed.data.text);
  if (!repositories.length) {
    res.status(400).json({
      error: "no GitHub repository URL found",
      expected: "https://github.com/OWNER/REPOSITORY",
    });
    return;
  }

  try {
    const evidence = await getGitHubEvidenceForText(parsed.data.text);
    res.json({
      ok: true,
      repositories,
      evidence,
    });
  } catch (error) {
    req.log.error({ err: error }, "GitHub preflight endpoint failed");
    res.status(502).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
