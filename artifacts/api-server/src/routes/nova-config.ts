import { Router } from "express";

const router = Router();

// The browser uses a non-secret placeholder token. Model credentials and all
// tool integrations remain server-side. Anonymous chat is model-only; the same
// signed Work Tree session unlocks BOS OMEGA's configured read-only tools.
router.get("/nova-config", (_req, res) => {
  res.json({
    apiKey: "proxy",
    baseUrl: "/api/bos/v1",
    defaultModel:
      process.env.OPENAI_MODEL ?? process.env.WORK_TREE_MODEL ?? "gpt-5.6",
    identity: "BOS OMEGA",
    capabilitiesUrl: "/api/bos/capabilities",
    unlockUrl: "/api/work-tree/unlock",
  });
});

export default router;
