import { Router, type IRouter } from "express";
import healthRouter from "./health";
import novaConfigRouter from "./nova-config";
import scratchpadRouter from "./scratchpad";
import workTreeRouter from "./work-tree";
import integrationsRouter from "./integrations";
import composioRouter from "./composio";
import githubRouter from "./github";
import agentChatRouter from "./agent-chat";
import durableAgentChatRouter from "./durable-agent-chat";
import knowledgeRouter from "./knowledge";
import vectorMemoryRouter from "./vector-memory";
import openaiProxyRouter from "./openai-proxy";
import voiceRouter from "./voice";
import skillsRouter from "./skills";
import operatorSessionRouter from "./operator-session";
import workspacesRouter from "./workspaces";
import mediaRouter from "./media";
import socialMediaRouter from "./social-media";
import socialRuntimeHealthRouter from "./social-runtime-health";
import instagramCampaignGuardRouter from "./instagram-campaign-guard";
import campaignsRouter from "./campaigns";
import favoritesRouter from "./favorites";
import mapsRouter from "./maps";
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
// The signed operator session lifecycle must be available before the protected
// workspace/media routers so their 401 challenge can unlock and retry in place.
router.use(operatorSessionRouter);
// Workspaces and media are mounted at root, but the auth gate is registered
// per-route (see requireApiAuthCall below) so it scopes only to the
// /api/workspaces/* and /api/media/* paths. The previous
// `router.use(requireApiAuth)` at the top of those sub-routers leaked
// the gate into every other API route on the parent, causing chat,
// maps, and every other endpoint to 401. See workspaces.ts / media.ts
// for the per-route fix.
router.use(workspacesRouter);
router.use(mediaRouter);
// The hardened Instagram publisher is mounted directly in app.ts before this
// aggregate router so the legacy social publisher cannot intercept the route.
router.use(socialRuntimeHealthRouter);
router.use(socialMediaRouter);
// Normalize image-only Instagram campaign formats before the legacy campaign
// implementation creates or executes them.
router.use(instagramCampaignGuardRouter);
router.use(campaignsRouter);
router.use(favoritesRouter);
router.use(mapsRouter);
router.use(renderScenariosRouter);
router.use(githubScenariosRouter);
router.use(composioScenariosRouter);
router.use(firecrawlSteelScenariosRouter);
// Browser chat uses the OpenClaw agent loop. Durable repository/debug missions
// are intercepted first and persisted to work_tree_runs so closing the tab or
// installed PWA cannot cancel them. Ordinary conversation continues to stream
// through the interactive OpenClaw route below.
router.use(sessionsRouter);
router.use(durableAgentChatRouter);
router.use(agentChatRouter);
router.use(openaiProxyRouter);
router.use("/skills", skillsRouter);
router.use(capabilitiesRouter);

export default router;
