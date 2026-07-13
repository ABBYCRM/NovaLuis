import { Router } from "express";
import { listGroupedEntries } from "../lib/scratchpad";

const router = Router();

router.get("/scratchpad", async (req, res) => {
  try {
    const groups = await listGroupedEntries();
    res.json({ groups });
  } catch (error) {
    req.log.error({ err: error }, "scratchpad list failed");
    res.status(503).json({
      error: "scratchpad_unavailable",
      message: "Scratchpad storage could not be read.",
    });
  }
});

export default router;
