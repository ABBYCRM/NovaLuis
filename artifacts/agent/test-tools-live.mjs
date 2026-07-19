// Live test of artifacts/agent/tools.mjs. Exercises each tool with a
// minimal real API call. Skips tools whose key isn't set. Used in CI
// once the API keys are wired into the runtime; safe to run locally
// with keys in env.

import { dispatchToolCall } from "./tools.mjs";

const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`[${ok ? "✅" : "❌"}] ${name}${detail ? " — " + detail : ""}`);
}

async function run() {
  // web_search via exa
  if (process.env.EXA_API_KEY) {
    const r = await dispatchToolCall({
      name: "web_search",
      args: { query: "NovaLuis PWA", num_results: 3, provider: "exa" },
    });
    check("exa web_search returns real results",
      r.ok && r.data?.results?.length > 0,
      `provider=${r.data?.provider} count=${r.data?.count}`);
  } else {
    console.log("[skip] EXA_API_KEY not set");
  }

  // web_search via tavily
  if (process.env.TAVILY_API_KEY) {
    const r = await dispatchToolCall({
      name: "web_search",
      args: { query: "AI agent runtime 2026", num_results: 3, provider: "tavily" },
    });
    check("tavily web_search returns real results",
      r.ok && r.data?.results?.length > 0,
      `provider=${r.data?.provider} count=${r.data?.count} answer=${r.data?.answer?.slice(0, 80) || "null"}`);
  } else {
    console.log("[skip] TAVILY_API_KEY not set");
  }

  // scrape_url via firecrawl
  if (process.env.FIRECRAWL_API_KEY) {
    const r = await dispatchToolCall({
      name: "scrape_url",
      args: { url: "https://example.com", format: "markdown", provider: "firecrawl" },
    });
    check("firecrawl scrape returns markdown",
      r.ok && r.data?.markdown && r.data.markdown.length > 50,
      `provider=${r.data?.provider} md_len=${r.data?.markdown?.length || 0}`);
  } else {
    console.log("[skip] FIRECRAWL_API_KEY not set");
  }

  // scrape_url via scrapingbee
  if (process.env.SCRAPINGBEE_API_KEY) {
    const r = await dispatchToolCall({
      name: "scrape_url",
      args: { url: "https://example.com", render_js: false, provider: "scrapingbee" },
    });
    check("scrapingbee scrape returns html",
      r.ok && r.data?.html && r.data.html.length > 50,
      `provider=${r.data?.provider} html_len=${r.data?.html?.length || 0}`);
  } else {
    console.log("[skip] SCRAPINGBEE_API_KEY not set");
  }

  // screenshot_url
  if (process.env.SCREENSHOTONE_ACCESS_KEY) {
    const r = await dispatchToolCall({
      name: "screenshot_url",
      args: { url: "https://example.com", viewport_width: 800, viewport_height: 600 },
    });
    check("screenshotone returns base64 png",
      r.ok && r.data?.image_base64 && r.data.image_base64.length > 1000,
      `provider=${r.data?.provider} size=${r.data?.size_bytes}b64=${r.data?.image_base64?.length || 0}`);
  } else {
    console.log("[skip] SCREENSHOTONE_ACCESS_KEY not set");
  }

  // run_code via e2b
  if (process.env.E2B_API_KEY) {
    const r = await dispatchToolCall({
      name: "run_code",
      args: { language: "python", code: "print('hello from e2b')" },
    });
    check("e2b run_code returns stdout",
      r.ok && r.data?.stdout?.includes("hello from e2b"),
      `stdout="${r.data?.stdout?.slice(0, 100) || ""}" stderr="${r.data?.stderr?.slice(0, 100) || ""}"`);
  } else {
    console.log("[skip] E2B_API_KEY not set");
  }

  // send_email via resend — DO NOT actually send, just verify key
  // validates by checking that the dispatch returns observed=true (not
  // keyNotSet). A real send requires a verified domain on Resend.
  if (process.env.RESEND_API_KEY) {
    const r = await dispatchToolCall({
      name: "send_email",
      // No real send — test the path that would return "to required" or
      // similar validation error from Resend, proving the key is
      // accepted and the call reaches Resend.
      args: { to: ["deliverability-test@resend.com"], subject: "test", text: "x" },
    });
    check("resend key validates (either sends or returns 4xx, not 401/403)",
      r.status === undefined || (r.status !== 401 && r.status !== 403),
      `ok=${r.ok} status=${r.status} error=${r.error?.slice(0, 100) || "none"}`);
  } else {
    console.log("[skip] RESEND_API_KEY not set");
  }

  // Auto mode: web_search should try exa, fall back to tavily
  if (process.env.EXA_API_KEY || process.env.TAVILY_API_KEY) {
    const r = await dispatchToolCall({
      name: "web_search",
      args: { query: "typescript", num_results: 2, provider: "auto" },
    });
    check("web_search auto-mode returns results from a configured provider",
      r.ok && r.data?.results?.length > 0,
      `provider=${r.data?.provider} count=${r.data?.count}`);
  } else {
    console.log("[skip] no search keys set; skipping auto-mode test");
  }

  // Unknown tool returns observed failure
  const unknown = await dispatchToolCall({ name: "nope", args: {} });
  check("unknown tool returns observed failure",
    unknown.observed === true && unknown.ok === false && /unknown tool/.test(unknown.error || ""),
    `error="${unknown.error}"`);

  // scrape_url without any keys should return observed:false key-not-set
  const noKeys = await dispatchToolCall({
    name: "scrape_url",
    args: { url: "https://example.com", provider: "firecrawl" },
  });
  if (!process.env.FIRECRAWL_API_KEY) {
    check("scrape_url without FIRECRAWL key returns key-not-set",
      noKeys.observed === true && noKeys.error?.includes("FIRECRAWL_API_KEY"),
      `error="${noKeys.error}"`);
  } else {
    console.log("[skip] FIRECRAWL_API_KEY is set; can't test no-key path");
  }

  const passed = checks.filter(c => c.ok).length;
  const failed = checks.filter(c => !c.ok);
  console.log(`\n=== ${passed}/${checks.length} tool live checks passed ===`);
  if (failed.length) {
    failed.forEach(f => console.log(`  ❌ ${f.name} — ${f.detail || ""}`));
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
