import { Router, type IRouter } from "express";
import healthRouter from "./health";
import novaConfigRouter from "./nova-config";

const router: IRouter = Router();

router.use(healthRouter);
router.use(novaConfigRouter);

export default router;
