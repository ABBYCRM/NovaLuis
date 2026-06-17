import { Router } from "express";
import { listGroupedEntries } from "../lib/scratchpad";

const router = Router();

// Grouped, categorized scratchpad memory for the Settings → Scratch pad view.
router.get("/scratchpad", async (req, res) => {
  try {
    const groups = await listGroupedEntries();
    res.json({ groups });
  } catch (e) {
    // Never hard-fail the viewer — degrade to an empty pad.
    req.log.warn({ err: e }, "scratchpad list error");
    res.json({ groups: [] });
  }
});

export default router;
