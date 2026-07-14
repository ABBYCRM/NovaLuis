import { Router, type IRouter } from "express";
import healthRouter from "./health";
import novaConfigRouter from "./nova-config";
import scratchpadRouter from "./scratchpad";
import workTreeRouter from "./work-tree";
import integrationsRouter from "./integrations";
import composioRouter from "./composio";
import githubRouter from "./github";
import agentChatRouter from "./agent-chat";
import knowledgeRouter from "./knowledge";
import openaiProxyRouter from "./openai-proxy";
import voiceRouter from "./voice";
import skillsRouter from "./skills";
import { requireWtAuth } from "../lib/work-tree-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(novaConfigRouter);
router.use(voiceRouter);
router.use(scratchpadRouter);
router.use(workTreeRouter);
// The credential store, knowledge base, and direct GitHub diagnostic surface are
// sensitive, so they sit behind the same PIN gate as Work Tree. One /unlock
// cookie (scoped to /api) covers these routes. Normal public-repository preflight
// used by agent chat still happens server-side without exposing this diagnostic.
router.use(["/integrations", "/knowledge", "/github"], requireWtAuth);
router.use(integrationsRouter);
router.use(composioRouter);
router.use(githubRouter);
router.use(knowledgeRouter);
// Browser chat uses the OpenClaw agent loop. OpenClaw's own model provider still
// calls /v1/* below, keeping the agent endpoint and raw inference endpoint separate.
router.use(agentChatRouter);
router.use(openaiProxyRouter);
router.use(skillsRouter);

export default router;
