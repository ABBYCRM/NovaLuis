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
import vectorMemoryRouter from "./vector-memory";
import openaiProxyRouter from "./openai-proxy";
import voiceRouter from "./voice";
import skillsRouter from "./skills";
import workspacesRouter from "./workspaces";
import mediaRouter from "./media";
import socialMediaRouter from "./social-media";
import instagramCampaignGuardRouter from "./instagram-campaign-guard";
import campaignsRouter from "./campaigns";
import favoritesRouter from "./favorites";
import renderScenariosRouter from "./render-scenarios";
import githubScenariosRouter from "./github-scenarios";
import composioScenariosRouter from "./composio-scenarios";
import firecrawlSteelScenariosRouter from "./firecrawl-steel-scenarios";
import capabilitiesRouter from "./capabilities";
import sessionsRouter from "./sessions";
const router: IRouter = Router();

router.use(healthRouter);
router.use(novaConfigRouter);
router.use(voiceRouter);
router.use(scratchpadRouter);
router.use(workTreeRouter);
router.use(integrationsRouter);
router.use(composioRouter);
router.use(githubRouter);
router.use(knowledgeRouter);
router.use(vectorMemoryRouter);
router.use(workspacesRouter);
router.use(mediaRouter);
// The hardened Instagram publisher is mounted directly in app.ts before this
// aggregate router so the legacy social publisher cannot intercept the route.
router.use(socialMediaRouter);
// Normalize image-only Instagram campaign formats before the legacy campaign
// implementation creates or executes them.
router.use(instagramCampaignGuardRouter);
router.use(campaignsRouter);
router.use(favoritesRouter);
router.use(renderScenariosRouter);
router.use(githubScenariosRouter);
router.use(composioScenariosRouter);
router.use(firecrawlSteelScenariosRouter);
// Browser chat uses the OpenClaw agent loop. OpenClaw's own model provider still
// calls /v1/* below, keeping the agent endpoint and raw inference endpoint separate.
router.use(sessionsRouter);
router.use(agentChatRouter);
router.use(openaiProxyRouter);
router.use("/skills", skillsRouter);
router.use(capabilitiesRouter);

export default router;
