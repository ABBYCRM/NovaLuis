import { Router } from "express";

const router = Router();

// The chat UI sends requests to the server-side proxy at /api/v1, which injects
// the real OPENAI_API_KEY. The browser only needs a non-empty placeholder token
// so bob.js will send the request — the real key never leaves the server.
router.get("/nova-config", (_req, res) => {
  res.json({
    apiKey: "proxy",
    baseUrl: "/api/v1",
  });
});

export default router;
