import { Router, type IRouter } from "express";
import healthRouter from "./health";
import novaConfigRouter from "./nova-config";
import scratchpadRouter from "./scratchpad";
import workTreeRouter from "./work-tree";
import integrationsRouter from "./integrations";
import knowledgeRouter from "./knowledge";
import bosOmegaRouter from "./bos-omega";
import openaiProxyRouter from "./openai-proxy";
import voiceRouter from "./voice";
import skillsRouter from "./skills";
import { requireWtAuth } from "../lib/work-tree-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(novaConfigRouter);
router.use(bosOmegaRouter);
router.use(workTreeRouter);

// Explicit path-scoped gates prevent private notes, credentials, paid voice
// providers, and scratchpad memory from becoming public spend/data surfaces.
router.use(
  ["/voice", "/scratchpad", "/integrations", "/knowledge"],
  requireWtAuth,
);
router.use(voiceRouter);
router.use(scratchpadRouter);
router.use(integrationsRouter);
router.use(knowledgeRouter);

// Keep the legacy OpenAI-compatible proxy for non-chat compatibility while the
// browser chat uses /api/bos/v1 through nova-config.
router.use(openaiProxyRouter);
router.use(skillsRouter);

export default router;
