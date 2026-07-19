// First-class direct-API tools for the NovaLuis custom agent.
//
// Phase 2 of the OpenClaw → custom agent migration. Each tool here
// calls its API directly using a key from the NovaLuis runtime env,
// returning the observed result. No composio indirection, no booking
// flows, no "internal error" fallbacks — every tool returns either a
// real answer or a precise observed failure.
//
// Tools are organized as: { [name]: { definition, invoke } }. The
// server.mjs tool loop iterates the model-emitted tool_call against
// this table. If a tool is requested but its API key is not set, the
// invoke returns { observed: false, error: "X_API_KEY not set" } so
// the model can pick a different tool.

import { Buffer } from "node:buffer";

// ─── helpers ────────────────────────────────────────────────────────────────

async function httpJson(url, opts = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    const text = await r.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 2000) };
    }
    return { status: r.status, ok: r.ok, body };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      body: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function observedSuccess(data) {
  return { observed: true, ok: true, data };
}

function observedFailure(error, status = 0) {
  return { observed: true, ok: false, error, status };
}

function keyNotSet(keyName) {
  return observedFailure(`${keyName} is not configured on the server`);
}

// ─── web search: Exa ────────────────────────────────────────────────────────
// Exa (https://exa.ai) — neural search. Returns titles, URLs, snippets.
// https://docs.exa.ai/reference/search

async function exaSearch({ query, numResults = 5, type = "auto" }) {
  if (!process.env.EXA_API_KEY) return keyNotSet("EXA_API_KEY");
  const r = await httpJson("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.EXA_API_KEY,
    },
    body: JSON.stringify({
      query: String(query || "").slice(0, 500),
      numResults: Math.max(1, Math.min(20, Number(numResults) || 5)),
      type: ["neural", "keyword", "auto"].includes(type) ? type : "auto",
      contents: { highlights: { numSentences: 2, highlightsPerUrl: 1 } },
    }),
  });
  if (!r.ok) {
    return observedFailure(
      `exa ${r.status}: ${typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 500) : String(r.body).slice(0, 500)}`,
      r.status,
    );
  }
  const results = Array.isArray(r.body?.results) ? r.body.results : [];
  return observedSuccess({
    provider: "exa",
    query: String(query || ""),
    count: results.length,
    results: results.slice(0, 10).map((res) => ({
      title: res.title,
      url: res.url,
      publishedDate: res.publishedDate,
      highlights: res.highlights,
    })),
  });
}

// ─── web search: Tavily ────────────────────────────────────────────────────
// Tavily (https://tavily.com) — research-focused web search with optional
// answer synthesis. https://docs.tavily.com

async function tavilySearch({ query, maxResults = 5, searchDepth = "basic", includeAnswer = true }) {
  if (!process.env.TAVILY_API_KEY) return keyNotSet("TAVILY_API_KEY");
  const r = await httpJson("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query: String(query || "").slice(0, 500),
      max_results: Math.max(1, Math.min(20, Number(maxResults) || 5)),
      search_depth: ["basic", "advanced"].includes(searchDepth) ? searchDepth : "basic",
      include_answer: Boolean(includeAnswer),
    }),
  });
  if (!r.ok) {
    return observedFailure(
      `tavily ${r.status}: ${typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 500) : String(r.body).slice(0, 500)}`,
      r.status,
    );
  }
  return observedSuccess({
    provider: "tavily",
    query: String(query || ""),
    answer: r.body?.answer || null,
    count: Array.isArray(r.body?.results) ? r.body.results.length : 0,
    results: (r.body?.results || []).slice(0, 10).map((res) => ({
      title: res.title,
      url: res.url,
      content: (res.content || "").slice(0, 600),
      score: res.score,
    })),
  });
}

// ─── scrape: Firecrawl ─────────────────────────────────────────────────────
// Firecrawl (https://firecrawl.dev) — full-page scrape with markdown output.
// https://docs.firecrawl.dev

async function firecrawlScrape({ url, formats = ["markdown"] }) {
  if (!process.env.FIRECRAWL_API_KEY) return keyNotSet("FIRECRAWL_API_KEY");
  const r = await httpJson("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url: String(url || "").slice(0, 2000),
      formats: Array.isArray(formats) ? formats : ["markdown"],
    }),
  }, 60_000);
  if (!r.ok) {
    return observedFailure(
      `firecrawl ${r.status}: ${typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 500) : String(r.body).slice(0, 500)}`,
      r.status,
    );
  }
  const data = r.body?.data || r.body;
  return observedSuccess({
    provider: "firecrawl",
    url: String(url || ""),
    title: data?.metadata?.title,
    description: data?.metadata?.description,
    markdown: (data?.markdown || data?.content || "").slice(0, 8000),
  });
}

// ─── scrape: ScrapingBee ───────────────────────────────────────────────────
// ScrapingBee (https://scrapingbee.com) — JS-rendered HTML with stealth.
// https://www.scrapingbee.com/documentation/

async function scrapingbeeScrape({ url, renderJs = false }) {
  if (!process.env.SCRAPINGBEE_API_KEY) return keyNotSet("SCRAPINGBEE_API_KEY");
  const apiUrl = new URL("https://app.scrapingbee.com/api/v1/");
  apiUrl.searchParams.set("api_key", process.env.SCRAPINGBEE_API_KEY);
  apiUrl.searchParams.set("url", String(url || "").slice(0, 2000));
  if (renderJs) apiUrl.searchParams.set("render_js", "true");
  const r = await httpJson(apiUrl.toString(), {}, 60_000);
  if (!r.ok) {
    return observedFailure(
      `scrapingbee ${r.status}: ${String(r.body?.raw || JSON.stringify(r.body)).slice(0, 500)}`,
      r.status,
    );
  }
  const html = typeof r.body?.raw === "string" ? r.body.raw : "";
  return observedSuccess({
    provider: "scrapingbee",
    url: String(url || ""),
    html_length: html.length,
    html: html.slice(0, 8000),
  });
}

// ─── scrape: Scrapfly ──────────────────────────────────────────────────────
// Scrapfly (https://scrapfly.io) — premium scraping with anti-bot bypass.
// https://scrapfly.io/docs

async function scrapflyScrape({ url, renderJs = true }) {
  if (!process.env.SCRAPFLY_API_KEY) return keyNotSet("SCRAPFLY_API_KEY");
  const r = await httpJson("https://api.scrapfly.io/scrape", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: process.env.SCRAPFLY_API_KEY,
      url: String(url || "").slice(0, 2000),
      render_js: Boolean(renderJs),
      format: "raw",
    }),
  }, 60_000);
  if (!r.ok) {
    return observedFailure(
      `scrapfly ${r.status}: ${typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 500) : String(r.body).slice(0, 500)}`,
      r.status,
    );
  }
  return observedSuccess({
    provider: "scrapfly",
    url: String(url || ""),
    status_code: r.body?.result?.status_code,
    content_length: r.body?.result?.content?.length || 0,
    content: (r.body?.result?.content || "").slice(0, 8000),
  });
}

// ─── scrape: Steel ─────────────────────────────────────────────────────────
// Steel (https://steel.dev) — browser automation as a service.

async function steelScrape({ url, format = "html" }) {
  if (!process.env.STEEL_API_KEY) return keyNotSet("STEEL_API_KEY");
  const r = await httpJson("https://api.steel.dev/v1/scrape", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${process.env.STEEL_API_KEY}`,
    },
    body: JSON.stringify({
      url: String(url || "").slice(0, 2000),
      format: ["html", "markdown"].includes(format) ? format : "html",
    }),
  }, 60_000);
  if (!r.ok) {
    return observedFailure(
      `steel ${r.status}: ${typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 500) : String(r.body).slice(0, 500)}`,
      r.status,
    );
  }
  return observedSuccess({
    provider: "steel",
    url: String(url || ""),
    content: (r.body?.content || r.body?.data || "").toString().slice(0, 8000),
  });
}

// ─── screenshot: ScreenshotOne ─────────────────────────────────────────────
// ScreenshotOne (https://screenshotone.com) — render any URL as an image.
// https://screenshotone.com/docs/

async function screenshotUrl({ url, fullPage = false, viewportWidth = 1280, viewportHeight = 800 }) {
  if (!process.env.SCREENSHOTONE_ACCESS_KEY) return keyNotSet("SCREENSHOTONE_ACCESS_KEY");
  const apiUrl = new URL("https://api.screenshotone.com/take");
  apiUrl.searchParams.set("access_key", process.env.SCREENSHOTONE_ACCESS_KEY);
  apiUrl.searchParams.set("url", String(url || "").slice(0, 2000));
  apiUrl.searchParams.set("full_page", fullPage ? "true" : "false");
  apiUrl.searchParams.set("viewport_width", String(Math.max(320, Math.min(3840, Number(viewportWidth) || 1280))));
  apiUrl.searchParams.set("viewport_height", String(Math.max(240, Math.min(2160, Number(viewportHeight) || 800))));
  apiUrl.searchParams.set("format", "png");
  if (process.env.SCREENSHOTONE_SECRET_KEY) {
    // ScreenshotOne supports signed URLs via the `signature` query param.
    // We use the secret for HMAC if present but skip the signature otherwise
    // — the access_key alone is sufficient for the take endpoint.
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const r = await fetch(apiUrl.toString(), { signal: controller.signal });
    if (!r.ok) {
      const text = await r.text();
      return observedFailure(`screenshotone ${r.status}: ${text.slice(0, 500)}`, r.status);
    }
    const contentType = r.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await r.arrayBuffer());
    return observedSuccess({
      provider: "screenshotone",
      url: String(url || ""),
      content_type: contentType,
      size_bytes: buffer.length,
      image_base64: buffer.toString("base64").slice(0, 200_000),
    });
  } catch (error) {
    return observedFailure(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

// ─── email: Resend ─────────────────────────────────────────────────────────
// Resend (https://resend.com) — transactional email.
// https://resend.com/docs/api-reference/emails/send-email

async function resendSendEmail({ to, subject, html, text, from }) {
  if (!process.env.RESEND_API_KEY) return keyNotSet("RESEND_API_KEY");
  const fromAddr = from || process.env.RESEND_FROM || "AURA <noreply@notifications.abbycrm.com>";
  const r = await httpJson("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: String(fromAddr).slice(0, 200),
      to: Array.isArray(to) ? to.slice(0, 50).map(String) : [String(to || "").slice(0, 200)],
      subject: String(subject || "").slice(0, 500),
      ...(html ? { html: String(html).slice(0, 200_000) } : {}),
      ...(text ? { text: String(text).slice(0, 200_000) } : {}),
    }),
  });
  if (!r.ok) {
    return observedFailure(
      `resend ${r.status}: ${typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 500) : String(r.body).slice(0, 500)}`,
      r.status,
    );
  }
  return observedSuccess({
    provider: "resend",
    id: r.body?.id,
    to,
    subject: String(subject || "").slice(0, 200),
  });
}

// ─── code execution: E2B ───────────────────────────────────────────────────
// E2B (https://e2b.dev) — sandboxed code execution in a remote Linux box.
// https://e2b.dev/docs

async function e2bRunCode({ language = "python", code, timeout = 30 }) {
  if (!process.env.E2B_API_KEY) return keyNotSet("E2B_API_KEY");
  const lang = ["python", "javascript", "bash", "ruby"].includes(language) ? language : "python";
  const r = await httpJson("https://api.e2b.dev/v0/sandboxes/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${process.env.E2B_API_KEY}`,
    },
    body: JSON.stringify({
      language: lang,
      code: String(code || "").slice(0, 50_000),
      timeout: Math.max(5, Math.min(120, Number(timeout) || 30)),
    }),
  }, 120_000);
  if (!r.ok) {
    return observedFailure(
      `e2b ${r.status}: ${typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 500) : String(r.body).slice(0, 500)}`,
      r.status,
    );
  }
  return observedSuccess({
    provider: "e2b",
    language: lang,
    stdout: (r.body?.stdout || "").slice(0, 8000),
    stderr: (r.body?.stderr || "").slice(0, 8000),
    exit_code: r.body?.exitCode ?? r.body?.exit_code ?? 0,
  });
}

// ─── register ──────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the public web for a query. Tries Exa first (neural search), then Tavily (research). Returns real, current results with title, URL, and snippet. Use for 'search the web for X', 'look up X', 'what is the latest X'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
          num_results: { type: "integer", minimum: 1, maximum: 20, default: 5 },
          provider: {
            type: "string",
            enum: ["auto", "exa", "tavily"],
            default: "auto",
            description: "auto = try Exa then Tavily; exa = neural; tavily = research.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scrape_url",
      description:
        "Scrape the full content of a public URL as markdown or HTML. Tries Firecrawl (best for markdown), then ScrapingBee (JS-rendered), then Scrapfly (anti-bot), then Steel (browser). Use for 'summarize this page', 'what's on X website', 'extract data from this URL'.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to scrape (must be http/https)." },
          format: { type: "string", enum: ["markdown", "html"], default: "markdown" },
          render_js: { type: "boolean", default: false, description: "Set true for JS-heavy sites." },
          provider: {
            type: "string",
            enum: ["auto", "firecrawl", "scrapingbee", "scrapfly", "steel"],
            default: "auto",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "screenshot_url",
      description:
        "Render a URL as a PNG screenshot. Returns base64-encoded PNG (truncated to 200KB). Use for 'screenshot this page', 'show me what the homepage looks like'.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to capture." },
          full_page: { type: "boolean", default: false },
          viewport_width: { type: "integer", default: 1280 },
          viewport_height: { type: "integer", default: 800 },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description:
        "Send a transactional email via Resend. Subject + html or text body. Returns the Resend message id on success. Use ONLY when the user explicitly asks to send email.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "array",
            items: { type: "string" },
            description: "Recipient email addresses (1-50).",
          },
          subject: { type: "string", description: "Email subject line." },
          html: { type: "string", description: "HTML body (preferred)." },
          text: { type: "string", description: "Plain-text body (fallback)." },
        },
        required: ["to", "subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_code",
      description:
        "Execute sandboxed code in a remote Linux container (E2B). Use for 'run this python script', 'compute X', 'test this regex'. Output is stdout/stderr and exit code.",
      parameters: {
        type: "object",
        properties: {
          language: {
            type: "string",
            enum: ["python", "javascript", "bash", "ruby"],
            default: "python",
          },
          code: { type: "string", description: "The code to run." },
          timeout: { type: "integer", minimum: 5, maximum: 120, default: 30 },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "composio_execute",
      description:
        "Execute a Composio tool against a connected account (gmail, slack, googledrive, etc.). Phase 1 tool. Phase 3 will replace this with first-class Gmail/Slack tools. Use when the user asks for an OAuth-protected app action and the toolkitHints list contains that slug.",
      parameters: {
        type: "object",
        properties: {
          tool_slug: { type: "string" },
          arguments: { type: "object" },
          account: { type: "string" },
        },
        required: ["tool_slug", "arguments"],
      },
    },
  },
];

export async function dispatchToolCall({ name, args }) {
  switch (name) {
    case "web_search": {
      const provider = String(args.provider || "auto");
      if (provider === "exa") return exaSearch(args);
      if (provider === "tavily") return tavilySearch(args);
      // auto: exa first, fall back to tavily
      const exa = await exaSearch(args);
      if (exa.ok) return exa;
      if (exa.error && exa.error.includes("EXA_API_KEY")) {
        return tavilySearch(args);
      }
      return exa;
    }
    case "scrape_url": {
      const provider = String(args.provider || "auto");
      if (provider === "firecrawl") return firecrawlScrape(args);
      if (provider === "scrapingbee") return scrapingbeeScrape(args);
      if (provider === "scrapfly") return scrapflyScrape(args);
      if (provider === "steel") return steelScrape(args);
      // auto: firecrawl first, then scrapingbee, then scrapfly, then steel
      const order = [
        () => firecrawlScrape(args),
        () => scrapingbeeScrape({ ...args, renderJs: args.render_js ?? true }),
        () => scrapflyScrape(args),
        () => steelScrape(args),
      ];
      let lastError = null;
      for (const fn of order) {
        const r = await fn();
        if (r.ok) return r;
        lastError = r;
        if (r.error && /not configured/.test(r.error)) continue;
        return r; // hard failure from the first provider that has its key
      }
      return lastError || observedFailure("all scrape providers failed or missing keys");
    }
    case "screenshot_url":
      return screenshotUrl(args);
    case "send_email":
      return resendSendEmail(args);
    case "run_code":
      return e2bRunCode(args);
    case "composio_execute":
      // Phase 1 fallback — handled by the server.mjs bridge.
      return { observed: false, error: "composio_execute should be dispatched by server.mjs, not tools.mjs" };
    default:
      return observedFailure(`unknown tool '${name}'`);
  }
}
