import { Router } from "express";

const router = Router();

// ── /api/capabilities ─────────────────────────────────────────────────────────
// Returns every named integration with live status (key present or missing).
// No auth required — this is read-only metadata, no secret values returned.

interface Integration {
  id: string;
  name: string;
  category: string;
  description: string;
  tools: string[];
  status: "active" | "missing";
  envKey: string;
}

const INTEGRATIONS: Omit<Integration, "status">[] = [
  // ── LLM providers ──────────────────────────────────────────────────────────
  {
    id: "openai",
    name: "OpenAI",
    category: "LLM",
    description: "GPT-4o-mini for all four agent roles (planner/executor/critic/researcher), Code Interpreter, Hosted Shell, and Responses API.",
    tools: ["chatComplete", "openai_code_interpreter", "openai_hosted_shell", "callModelWithWebSearch"],
    envKey: "OPENAI_API_KEY",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    category: "LLM",
    description: "Gemini models via Bitdeer-compatible endpoint. Used as the default inference backend when configured.",
    tools: ["chatComplete (bitdeer/gemini)"],
    envKey: "GEMINI_API_KEY",
  },
  // ── Search ─────────────────────────────────────────────────────────────────
  {
    id: "exa",
    name: "Exa AI",
    category: "Search",
    description: "Neural web search engine. Higher quality than keyword search — ideal for research tasks.",
    tools: ["exa_search"],
    envKey: "EXA_API_KEY",
  },
  {
    id: "tavily",
    name: "Tavily",
    category: "Search",
    description: "Web search with direct AI-generated answers. Good for factual Q&A and news.",
    tools: ["tavily_search"],
    envKey: "TAVILY_API_KEY",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    category: "Search",
    description: "Primary web search provider for the agent's web_search tool. Crawls and extracts clean text.",
    tools: ["web_search"],
    envKey: "FIRECRAWL_API_KEY",
  },
  // ── Scraping ───────────────────────────────────────────────────────────────
  {
    id: "steel",
    name: "Steel.dev",
    category: "Scraping",
    description: "Headless browser that bypasses Cloudflare and JS-gated pages.",
    tools: ["browser_fetch"],
    envKey: "STEEL_API_KEY",
  },
  {
    id: "scrapingbee",
    name: "ScrapingBee",
    category: "Scraping",
    description: "Proxy-based web scraper with optional JS rendering and premium proxies.",
    tools: ["scrapingbee_fetch"],
    envKey: "SCRAPINGBEE_API_KEY",
  },
  {
    id: "scrapfly",
    name: "Scrapfly",
    category: "Scraping",
    description: "Anti-scraping bypass scraper with JS rendering and anti-bot protection.",
    tools: ["scrapfly_fetch"],
    envKey: "SCRAPFLY_API_KEY",
  },
  // ── Screenshots ────────────────────────────────────────────────────────────
  {
    id: "screenshotone",
    name: "ScreenshotOne",
    category: "Screenshot",
    description: "Full-page and viewport screenshots of any URL. Ad-blocking and cookie-banner removal built in.",
    tools: ["screenshot_url"],
    envKey: "SCREENSHOTONE_ACCESS_KEY",
  },
  // ── Code execution ─────────────────────────────────────────────────────────
  {
    id: "e2b",
    name: "E2B",
    category: "Code Execution",
    description: "Isolated cloud VMs for running Python, JavaScript, and bash code safely.",
    tools: ["e2b_run_code"],
    envKey: "E2B_API_KEY",
  },
  // ── Email ──────────────────────────────────────────────────────────────────
  {
    id: "resend",
    name: "Resend",
    category: "Email",
    description: "Transactional email delivery. Sends from AURA <noreply@notifications.abbycrm.com>.",
    tools: ["send_email"],
    envKey: "RESEND_API_KEY",
  },
  // ── Memory & vector store ──────────────────────────────────────────────────
  {
    id: "pinecone",
    name: "Pinecone",
    category: "Memory",
    description: "Primary vector store for Nova's long-term RAG memory.",
    tools: ["RAG pipeline"],
    envKey: "PINECONE_API_KEY",
  },
  {
    id: "openai-vs",
    name: "OpenAI Vector Store",
    category: "Memory",
    description: "OpenAI-hosted vector store for semantic document retrieval.",
    tools: ["openai_retrieval"],
    envKey: "OPENAI_VECTOR_STORE_ID",
  },
  {
    id: "embeddings",
    name: "Embeddings API",
    category: "Memory",
    description: "Text embedding model used to build the RAG pipeline.",
    tools: ["RAG embedding"],
    envKey: "EMBEDDINGS_API_KEY",
  },
  // ── Integrations ───────────────────────────────────────────────────────────
  {
    id: "composio",
    name: "Composio",
    category: "Integrations",
    description: "300+ app integrations (GitHub, Notion, Slack, etc.). Agent can call any connected app's actions.",
    tools: ["composio_execute"],
    envKey: "COMPOSIO_API_KEY",
  },
  {
    id: "inngest",
    name: "Inngest",
    category: "Integrations",
    description: "Durable event queue for background jobs and scheduled tasks.",
    tools: ["event bus"],
    envKey: "INNGEST_EVENT_KEY",
  },
  // ── Video generation ───────────────────────────────────────────────────────
  {
    id: "a2e",
    name: "A2E AI",
    category: "Media",
    description: "Text-to-video and image-to-video generation via the A2E AI platform.",
    tools: ["video_generate", "image_to_video"],
    envKey: "A2E_AI_API_KEY",
  },
  // ── Observability ──────────────────────────────────────────────────────────
  {
    id: "helicone",
    name: "Helicone",
    category: "Observability",
    description: "LLM observability proxy. Logs every OpenAI request for monitoring, latency tracking, and cost analysis.",
    tools: ["chatComplete (all OpenAI calls)"],
    envKey: "HELICONE_API_KEY",
  },
];

router.get("/capabilities", (_req, res) => {
  const result: Integration[] = INTEGRATIONS.map((i) => ({
    ...i,
    status: process.env[i.envKey] ? "active" : "missing",
  }));

  const active = result.filter((i) => i.status === "active").length;
  const total = result.length;

  const byCategory: Record<string, Integration[]> = {};
  for (const i of result) {
    if (!byCategory[i.category]) byCategory[i.category] = [];
    byCategory[i.category].push(i);
  }

  res.json({ active, total, integrations: result, byCategory });
});

export default router;
