import {
  boundedInt,
  capabilityConfigured,
  capabilityStatus,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_OUTPUT_CHARS,
  env,
  errorResult,
  fetchWithTimeout,
  normalizePublicUrl,
  providerJson,
  readResponseLimited,
  safeText,
} from "./bos-omega-core.mjs";

const ORDER = String(process.env.BOS_SEARCH_ORDER || "tavily,exa,firecrawl,brave")
  .split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);

function normalized(provider, row) {
  return {
    provider,
    title: String(row?.title || row?.name || "").slice(0, 300),
    url: String(row?.url || row?.id || "").slice(0, 2000),
    snippet: String(row?.content || row?.description || row?.snippet || row?.text || "").slice(0, 1200),
    ...(Number.isFinite(Number(row?.score)) ? { score: Number(row.score) } : {}),
    ...(row?.publishedDate || row?.published_at
      ? { publishedAt: String(row.publishedDate || row.published_at) }
      : {}),
  };
}

async function tavily(query, limit) {
  const data = await providerJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("TAVILY_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: limit, search_depth: "basic", include_answer: false, include_raw_content: false }),
  }, "tavily");
  return (data.results || []).map((row) => normalized("tavily", row));
}

async function exa(query, limit) {
  const data = await providerJson("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": env("EXA_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ query, numResults: limit, contents: { highlights: true } }),
  }, "exa");
  return (data.results || []).map((row) => normalized("exa", {
    ...row,
    content: Array.isArray(row.highlights) ? row.highlights.join(" ") : row.text,
  }));
}

async function firecrawl(query, limit) {
  const data = await providerJson("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("FIRECRAWL_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit, sources: ["web"] }),
  }, "firecrawl");
  const rows = Array.isArray(data?.data?.web) ? data.data.web : Array.isArray(data?.data) ? data.data : [];
  return rows.map((row) => normalized("firecrawl", row));
}

async function brave(query, limit) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(limit, 20)));
  const data = await providerJson(url, {
    headers: { "X-Subscription-Token": env("BRAVE_API_KEY"), Accept: "application/json" },
  }, "brave");
  return (data?.web?.results || []).map((row) => normalized("brave", row));
}

const HANDLERS = { tavily, exa, firecrawl, brave };

export async function webSearch(args) {
  const query = String(args.query || "").trim().slice(0, 1000);
  if (!query) return errorResult("query_required", "query is required");
  const limit = boundedInt(args.max_results, 5, 1, 20);
  const attempts = [];
  for (const provider of ORDER) {
    const handler = HANDLERS[provider];
    if (!handler) continue;
    if (capabilityStatus(`search.${provider}`).status !== "configured_not_probed") {
      attempts.push({ provider, status: "unconfigured" });
      continue;
    }
    try {
      const results = await handler(query, limit);
      if (results.length) return { provider, results, attempts: [...attempts, { provider, status: "success", count: results.length }] };
      attempts.push({ provider, status: "empty" });
    } catch (error) {
      attempts.push({ provider, status: "failed", error: safeText(error?.message || error, 240) });
    }
  }
  return errorResult("all_search_providers_failed", "No configured search provider returned results", { attempts });
}

export async function browserFetch(args, directFetch) {
  let target;
  try { target = normalizePublicUrl(args.url).toString(); }
  catch (error) { return errorResult("invalid_url", error?.message || error); }
  const attempts = [];
  if (capabilityConfigured("scrape.steel")) {
    try {
      const data = await providerJson("https://api.steel.dev/v1/scrape", {
        method: "POST",
        headers: { "Steel-Api-Key": env("STEEL_API_KEY"), "Content-Type": "application/json" },
        body: JSON.stringify({ url: target, useProxy: true }),
      }, "steel", 60_000);
      const body = String(data?.content?.markdown || data?.content?.html || "");
      if (body) return { provider: "steel", url: target, body: body.slice(0, DEFAULT_MAX_OUTPUT_CHARS), truncated: body.length > DEFAULT_MAX_OUTPUT_CHARS, attempts };
      attempts.push({ provider: "steel", status: "empty" });
    } catch (error) { attempts.push({ provider: "steel", status: "failed", error: safeText(error?.message || error, 240) }); }
  }
  if (capabilityConfigured("scrape.scrapingbee")) {
    try {
      const url = new URL("https://app.scrapingbee.com/api/v1/");
      url.searchParams.set("api_key", env("SCRAPINGBEE_API_KEY"));
      url.searchParams.set("url", target);
      url.searchParams.set("render_js", "true");
      const response = await fetchWithTimeout(url, {}, 60_000);
      const text = (await readResponseLimited(response)).toString("utf8");
      if (!response.ok) throw new Error(`scrapingbee HTTP ${response.status}`);
      return { provider: "scrapingbee", url: target, body: text.slice(0, DEFAULT_MAX_OUTPUT_CHARS), truncated: text.length > DEFAULT_MAX_OUTPUT_CHARS, attempts };
    } catch (error) { attempts.push({ provider: "scrapingbee", status: "failed", error: safeText(error?.message || error, 240) }); }
  }
  if (capabilityConfigured("scrape.scrapfly")) {
    try {
      const url = new URL("https://api.scrapfly.io/scrape");
      url.searchParams.set("key", env("SCRAPFLY_API_KEY"));
      url.searchParams.set("url", target);
      url.searchParams.set("render_js", "true");
      const data = await providerJson(url, {}, "scrapfly", 60_000);
      const body = String(data?.result?.content || data?.content || "");
      if (body) return { provider: "scrapfly", url: target, body: body.slice(0, DEFAULT_MAX_OUTPUT_CHARS), truncated: body.length > DEFAULT_MAX_OUTPUT_CHARS, attempts };
      attempts.push({ provider: "scrapfly", status: "empty" });
    } catch (error) { attempts.push({ provider: "scrapfly", status: "failed", error: safeText(error?.message || error, 240) }); }
  }
  const direct = await directFetch({ url: target, max_bytes: DEFAULT_MAX_BODY_BYTES });
  if (!direct.error) return { provider: "direct", ...direct, attempts };
  attempts.push({ provider: "direct", status: "failed", error: direct.message });
  return errorResult("all_scrape_providers_failed", "No scraping provider returned content", { attempts });
}
