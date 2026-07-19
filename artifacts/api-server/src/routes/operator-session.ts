import { Router } from "express";
import {
  clearOperatorSession,
  handleOperatorSessionStatus,
  handleOperatorUnlock,
} from "../lib/operator-session";

const router = Router();

router.get("/operator/session", handleOperatorSessionStatus);
router.post("/operator/unlock", handleOperatorUnlock);
router.post("/operator/logout", clearOperatorSession);

export default router;
