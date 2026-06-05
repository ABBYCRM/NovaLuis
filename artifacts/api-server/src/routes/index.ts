import { Router, type IRouter } from "express";
import healthRouter from "./health";
import novaConfigRouter from "./nova-config";
import scratchpadRouter from "./scratchpad";
import workTreeRouter from "./work-tree";
import integrationsRouter from "./integrations";
import knowledgeRouter from "./knowledge";
import openaiProxyRouter from "./openai-proxy";
import { requireWtAuth } from "../lib/work-tree-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(novaConfigRouter);
router.use(scratchpadRouter);
router.use(workTreeRouter);
// The credential store and knowledge base are sensitive (they hold Robert's API
// tokens and private notes), so they sit behind the same PIN gate as Work Tree.
// One /unlock (cookie scoped to /api) covers all three. Knowledge context is
// still injected into chat server-side in-process, which does not pass through
// these gated HTTP routes.
router.use(requireWtAuth, integrationsRouter);
router.use(requireWtAuth, knowledgeRouter);
router.use(openaiProxyRouter);

export default router;
