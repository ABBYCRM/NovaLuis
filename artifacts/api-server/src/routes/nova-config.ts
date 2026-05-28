import { Router } from "express";

const router = Router();

router.get("/nova-config", (req, res) => {
  const apiKey = process.env.BITDEER_API_KEY ?? "";
  res.json({
    apiKey,
    baseUrl: "/api-proxy/v1",
  });
});

export default router;
