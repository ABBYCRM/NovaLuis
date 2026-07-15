#!/usr/bin/env python3
"""
Firecrawl + Steel.dev agentic-runtime scenario generator.

Joint package for online search and headless browser control.
500 unique (trigger, condition, if_action, else_action) scenarios.

Output columns: id, service, category, trigger, condition, if_action,
                else_action, severity, source_doc

Sources (verified):
  - docs.firecrawl.dev/api-reference/introduction
  - docs.firecrawl.dev/api-reference/endpoint/scrape
  - docs.firecrawl.dev/api-reference/endpoint/crawl-post
  - docs.firecrawl.dev/api-reference/endpoint/map
  - docs.firecrawl.dev/api-reference/endpoint/search
  - docs.firecrawl.dev/api-reference/endpoint/extract
  - docs.firecrawl.dev/api-reference/endpoint/batch-scrape
  - docs.firecrawl.dev/api-reference/errors
  - docs.firecrawl.dev/rate-limits
  - docs.firecrawl.dev/features/stealth-mode
  - docs.firecrawl.dev/features/zero-data-retention
  - docs.firecrawl.dev/features/lockdown
  - docs.firecrawl.dev/features/monitoring
  - docs.firecrawl.dev/webhooks/overview
  - docs.firecrawl.dev/advanced-scraping-guide
  - docs.steel.dev/overview/sessions-api/overview
  - docs.steel.dev/overview/sessions-api/quickstart
  - docs.steel.dev/overview/sessions-api/session-lifecycle
  - docs.steel.dev/overview/sessions-api/multi-region
  - docs.steel.dev/overview/profiles-api/overview
  - docs.steel.dev/overview/pricinglimits
  - docs.steel.dev/llms-full.txt
  - apis.io/rate-limits/steel-dev/steel-dev-rate-limits
"""
import csv
import os
import random
from typing import List, Dict

OUT_PATH = "/workspace/render_scenarios/firecrawl_steel_scenarios.csv"
TARGET_ROWS = 500
random.seed(20260715)

# ---------------------------------------------------------------------------
# Trigger pool
# ---------------------------------------------------------------------------
TRIGGERS: List[tuple] = [
    # ---------- FIRECRAWL: SCRAPE ----------
    ("T-FC", "fc_scrape", "Agent calls /v2/scrape on a single URL"),
    ("T-FC", "fc_scrape", "Scrape returns markdown format (default)"),
    ("T-FC", "fc_scrape", "Scrape returns HTML / rawHtml format"),
    ("T-FC", "fc_scrape", "Scrape returns JSON format (structured extraction)"),
    ("T-FC", "fc_scrape", "Scrape returns screenshot format"),
    ("T-FC", "fc_scrape", "Scrape returns links / summary / branding formats"),
    ("T-FC", "fc_scrape", "Scrape uses onlyMainContent=true (default) to strip nav/footer"),
    ("T-FC", "fc_scrape", "Scrape uses onlyMainContent=false to keep full page"),
    ("T-FC", "fc_scrape", "Scrape sets wait_for to wait for JS to render (ms)"),
    ("T-FC", "fc_scrape", "Scrape sets timeout (up to 60000ms)"),
    ("T-FC", "fc_scrape", "Scrape uses location to geo-target the request"),
    ("T-FC", "fc_scrape", "Scrape uses includeTags / excludeTags to filter the DOM"),
    ("T-FC", "fc_scrape", "Scrape uses headers (custom User-Agent etc.)"),
    ("T-FC", "fc_scrape", "Scrape targets a PDF URL with parsers: [pdf]"),
    ("T-FC", "fc_scrape", "Scrape targets a DOCX / image URL"),
    ("T-FC", "fc_scrape", "Scrape uses max_age for cache freshness"),
    ("T-FC", "fc_scrape", "Scrape uses store_in_cache to seed the cache"),
    ("T-FC", "fc_scrape", "Scrape runs browser actions (click, write, wait, scroll, press) before capture"),
    ("T-FC", "fc_scrape", "Scrape uses proxy: 'auto' (basic first, stealth retry on 401/403/500)"),
    ("T-FC", "fc_scrape", "Scrape uses proxy: 'stealth' (always stealth, 5 credits)"),
    ("T-FC", "fc_scrape", "Scrape uses proxy: 'basic' (default)"),
    ("T-FC", "fc_scrape", "Scrape uses skipTlsVerification:true to bypass SSL errors"),
    ("T-FC", "fc_scrape", "Scrape uses zeroDataRetention:true (ZDR mode)"),
    ("T-FC", "fc_scrape", "Scrape uses lockdown:true (cache only, no live fetch)"),

    # ---------- FIRECRAWL: CRAWL ----------
    ("T-FC", "fc_crawl", "Agent calls /v2/crawl with a starting URL"),
    ("T-FC", "fc_crawl", "Crawl uses includePaths to limit scope"),
    ("T-FC", "fc_crawl", "Crawl uses excludePaths to skip paths"),
    ("T-FC", "fc_crawl", "Crawl uses crawlEntireDomain:true"),
    ("T-FC", "fc_crawl", "Crawl uses sitemap: include / skip / only"),
    ("T-FC", "fc_crawl", "Crawl sets limit (max pages)"),
    ("T-FC", "fc_crawl", "Crawl sets delay between page requests (concurrency=1)"),
    ("T-FC", "fc_crawl", "Crawl sets maxConcurrency (parallel pages per job)"),
    ("T-FC", "fc_crawl", "Crawl runs in Enhanced Mode (stealth + geo + adaptive retry)"),
    ("T-FC", "fc_crawl", "Crawl fails to start (insufficient credits) — 402 Payment Required"),
    ("T-FC", "fc_crawl", "Crawl job is cancelled mid-run"),
    ("T-FC", "fc_crawl", "Crawl returns to /v2/crawl/{id} for status"),
    ("T-FC", "fc_crawl", "Crawl errors endpoint returns robots_blocked URLs"),

    # ---------- FIRECRAWL: MAP ----------
    ("T-FC", "fc_map", "Agent calls /v2/map to list all URLs on a site"),
    ("T-FC", "fc_map", "Map returns empty list (no links found)"),
    ("T-FC", "fc_map", "Map hits 429 (rate limit)"),
    ("T-FC", "fc_map", "Map results feed into a subsequent /scrape (combine with crawl)"),

    # ---------- FIRECRAWL: SEARCH ----------
    ("T-FC", "fc_search", "Agent calls /v2/search with a natural-language query"),
    ("T-FC", "fc_search", "Search adds scrapeOptions to scrape each result (combined search+scrape)"),
    ("T-FC", "fc_search", "Search returns 0 results (too narrow query)"),
    ("T-FC", "fc_search", "Search returns limit results (default 3, max 20)"),
    ("T-FC", "fc_search", "Search is keyless (from MCP / CLI / SDK on Cloud with research index)"),
    ("T-FC", "fc_search", "Keyless search hits IP-based daily request cap (429)"),
    ("T-FC", "fc_search", "Keyless search hits IP-based daily credits cap (429)"),
    ("T-FC", "fc_search", "Search costs 2 credits per 10 results (rounded up)"),
    ("T-FC", "fc_search", "Search+scrape charges scrape cost on top (1 credit / page + extras)"),

    # ---------- FIRECRAWL: EXTRACT ----------
    ("T-FC", "fc_extract", "Agent calls /v2/extract with a JSON schema and URLs"),
    ("T-FC", "fc_extract", "Extract uses prompt (NL schema description) instead of schema"),
    ("T-FC", "fc_extract", "Extract returns JSON object matching schema"),
    ("T-FC", "fc_extract", "Extract returns empty fields (page didn't have data)"),
    ("T-FC", "fc_extract", "Extract fails: schema validation error (422)"),
    ("T-FC", "fc_extract", "Extract costs 4 credits per page (advanced)"),
    ("T-FC", "fc_extract", "Extract webhooks: started / completed / failed"),

    # ---------- FIRECRAWL: BATCH SCRAPE ----------
    ("T-FC", "fc_batch", "Agent calls /v2/batch/scrape with multiple URLs"),
    ("T-FC", "fc_batch", "Batch scrape uses ignoreInvalidURLs:true (default)"),
    ("T-FC", "fc_batch", "Batch scrape returns invalidURLs list (some URLs were malformed)"),
    ("T-FC", "fc_batch", "Batch scrape sets maxConcurrency per job"),
    ("T-FC", "fc_batch", "Batch scrape is async (startBatchScrape) - poll or webhook"),
    ("T-FC", "fc_batch", "Batch scrape fires batch_scrape.started / .page / .completed / .failed webhooks"),
    ("T-FC", "fc_batch", "Batch scrape results are available for 24h after completion"),

    # ---------- FIRECRAWL: AGENT ----------
    ("T-FC", "fc_agent", "Agent calls /v2/agent (autonomous, NL goal)"),
    ("T-FC", "fc_agent", "Agent job is in preview (5 free daily runs, dynamic pricing)"),
    ("T-FC", "fc_agent", "Agent job fires webhooks: started / action / completed / failed / cancelled"),
    ("T-FC", "fc_agent", "Agent job polls /v2/agent/{id} for status"),
    ("T-FC", "fc_agent", "Agent job cancelled by user"),

    # ---------- FIRECRAWL: MONITOR / CHANGE TRACKING ----------
    ("T-FC", "fc_monitor", "Agent creates a page monitor with changeTracking"),
    ("T-FC", "fc_monitor", "Agent creates a website monitor (multi-page)"),
    ("T-FC", "fc_monitor", "Monitor diff returns changeStatus in {same, changed, new, removed, error}"),
    ("T-FC", "fc_monitor", "Monitor uses JSON mode changeTracking with schema"),
    ("T-FC", "fc_monitor", "Monitor check.completed webhook fires"),
    ("T-FC", "fc_monitor", "Monitor alerts on new results (web-search mode)"),

    # ---------- FIRECRAWL: ZDR / LOCKDOWN ----------
    ("T-FC", "fc_zdr", "Scrape uses zeroDataRetention:true but also needs screenshot (ZDR violation)"),
    ("T-FC", "fc_zdr", "ZDR requires contacting help@firecrawl.dev to enable"),
    ("T-FC", "fc_zdr", "Lockdown enabled but no cached data for URL (404 SCRAPE_LOCKDOWN_CACHE_MISS)"),
    ("T-FC", "fc_zdr", "Lockdown cache is seeded by a non-lockdown scrape first"),

    # ---------- FIRECRAWL: WEBHOOKS ----------
    ("T-FC", "fc_webhook", "Firecrawl POSTs webhook to a public HTTPS URL"),
    ("T-FC", "fc_webhook", "Webhook receiver URL is down (5xx, retry with backoff)"),
    ("T-FC", "fc_webhook", "Webhook receiver is slow (>30s, may time out)"),
    ("T-FC", "fc_webhook", "Webhook payload includes user-supplied metadata"),
    ("T-FC", "fc_webhook", "Webhook payload includes idempotency key (job id)"),
    ("T-FC", "fc_webhook", "Webhook signature is missing or invalid"),

    # ---------- FIRECRAWL: RATE LIMITS / BILLING ----------
    ("T-FC", "fc_billing", "Free plan: 5 req/min, 1000 credits/month"),
    ("T-FC", "fc_billing", "Hobby plan: 50 req/min"),
    ("T-FC", "fc_billing", "Standard plan: 250 req/min"),
    ("T-FC", "fc_billing", "Growth plan: 2500 req/min"),
    ("T-FC", "fc_billing", "All API keys on same team share rate limit counters"),
    ("T-FC", "fc_billing", "Concurrency limit hit (in-flight browsers full) - 429"),
    ("T-FC", "fc_billing", "Credits run out mid-crawl (crawl marked failed)"),
    ("T-FC", "fc_billing", "Subscription lapsed - 402 Payment Required"),

    # ---------- FIRECRAWL: ERRORS ----------
    ("T-FC", "fc_errors", "SCRAPE_TIMEOUT (408) - page took too long"),
    ("T-FC", "fc_errors", "SCRAPE_ALL_ENGINES_FAILED (500)"),
    ("T-FC", "fc_errors", "SCRAPE_SSL_ERROR (500) - invalid cert"),
    ("T-FC", "fc_errors", "SCRAPE_SITE_ERROR (500) - unrecoverable"),
    ("T-FC", "fc_errors", "SCRAPE_DNS_RESOLUTION_ERROR (500)"),
    ("T-FC", "fc_errors", "SCRAPE_ACTION_ERROR (500) - browser action failed"),
    ("T-FC", "fc_errors", "SCRAPE_PDF_PREFETCH_FAILED / PDF_INSUFFICIENT_TIME / PDF_ANTIBOT"),
    ("T-FC", "fc_errors", "SCRAPE_UNSUPPORTED_FILE_ERROR - file > 10MB"),
    ("T-FC", "fc_errors", "UNKNOWN_ERROR (500) - retry per SDK policy"),

    # ---------- STEEL: SESSIONS ----------
    ("T-ST", "st_session", "Agent calls client.sessions.create() (Node SDK)"),
    ("T-ST", "st_session", "Agent calls client.sessions.create() (Python SDK)"),
    ("T-ST", "st_session", "Session is created with default 5-minute timeout"),
    ("T-ST", "st_session", "Session is created with explicit timeout (e.g. 1800000 = 30 min)"),
    ("T-ST", "st_session", "Session is created with inactivityTimeout (e.g. 300000 = 5 min)"),
    ("T-ST", "st_session", "Session is created with useProxy:true (residential proxies)"),
    ("T-ST", "st_session", "Session is created with solveCaptcha:true"),
    ("T-ST", "st_session", "Session is created with custom userAgent"),
    ("T-ST", "st_session", "Session is created in a specific region (LAX / IAD / etc.)"),
    ("T-ST", "st_session", "Session is created with isSelenium:true (Selenium-compatible)"),
    ("T-ST", "st_session", "Session is created with persistProfile:true (snapshot user data dir)"),
    ("T-ST", "st_session", "Session is created with blockAds:true"),
    ("T-ST", "st_session", "Agent calls client.sessions.release(sessionId) explicitly (best practice)"),
    ("T-ST", "st_session", "Agent calls client.sessions.releaseAll() (cleanup)"),
    ("T-ST", "st_session", "Session hard-timeout elapses (auto-release)"),
    ("T-ST", "st_session", "Session inactivity-timeout elapses (auto-release on idle)"),
    ("T-ST", "st_session", "Agent connects Playwright over CDP via chromium.connectOverCDP(websocketUrl&apiKey=...)"),
    ("T-ST", "st_session", "Agent connects Puppeteer over CDP via browserWSEndpoint"),
    ("T-ST", "st_session", "Agent connects Selenium WebDriver via isSelenium:true"),
    ("T-ST", "st_session", "Agent connects Playwright (Python) via chromium.connect_over_cdp()"),
    ("T-ST", "st_session", "Session returns sessionViewerUrl (live viewer)"),

    # ---------- STEEL: PROFILES ----------
    ("T-ST", "st_profile", "Agent creates a profile from a session with persistProfile:true"),
    ("T-ST", "st_profile", "Profile transitions to READY after session release"),
    ("T-ST", "st_profile", "Agent starts a new session from a profileId (cookies, auth, extensions preserved)"),
    ("T-ST", "st_profile", "Profile snapshot upload fails (file > 300MB) - profile set to FAILED"),
    ("T-ST", "st_profile", "Profile not used for 30 days - auto-deleted"),
    ("T-ST", "st_profile", "Profile state is one of: CREATING / READY / FAILED / DELETED"),
    ("T-ST", "st_profile", "Profile is shared between multiple agents (anti-pattern - separate per use case)"),
    ("T-ST", "st_profile", "Profile credentials rotated at provider (need to re-login in profile)"),

    # ---------- STEEL: PROXIES ----------
    ("T-ST", "st_proxy", "Session uses useProxy:true (residential proxy network)"),
    ("T-ST", "st_proxy", "Proxy bandwidth quota exceeded (Launch $10/GB, Scale $6/GB)"),
    ("T-ST", "st_proxy", "Proxy IP is allowlisted at the target site (good)"),
    ("T-ST", "st_proxy", "Proxy IP is blocked at the target site (rotate or escalate)"),
    ("T-ST", "st_proxy", "Custom proxy URL passed (user:pass@host:port)"),
    ("T-ST", "st_proxy", "Dedicated IP is allocated on Scale plan ($5/IP/month)"),

    # ---------- STEEL: CAPTCHA ----------
    ("T-ST", "st_captcha", "Session uses solveCaptcha:true (automatic solving)"),
    ("T-ST", "st_captcha", "Captcha quota exceeded (Launch $3/1k solves, Scale $1/1k)"),
    ("T-ST", "st_captcha", "Captcha type is unsupported (hCaptcha, reCAPTCHA, etc.)"),
    ("T-ST", "st_captcha", "Captcha solve fails after retries"),

    # ---------- STEEL: QUICK ACTIONS / CAPTURES ----------
    ("T-ST", "st_capture", "Agent calls /scrape quick action (content extraction)"),
    ("T-ST", "st_capture", "Agent calls /screenshot quick action (page capture)"),
    ("T-ST", "st_capture", "Agent calls /pdf quick action (save as PDF)"),
    ("T-ST", "st_capture", "Quick action costs 5 calls per 1k (Launch / Scale flat)"),
    ("T-ST", "st_capture", "Agent drives Playwright to take screenshot manually"),
    ("T-ST", "st_capture", "Agent drives Playwright to save page as PDF"),
    ("T-ST", "st_capture", "Agent downloads a file from a page (Playwright download event)"),
    ("T-ST", "st_capture", "Agent fills a form (write / press / click) via Playwright"),
    ("T-ST", "st_capture", "Agent intercepts network (Playwright route)"),
    ("T-ST", "st_capture", "Agent scrapes a page (Playwright page.evaluate)"),

    # ---------- STEEL: REGION / DATA RESIDENCY ----------
    ("T-ST", "st_region", "Session is auto-routed to closest region (default)"),
    ("T-ST", "st_region", "Session is pinned to LAX (Los Angeles)"),
    ("T-ST", "st_region", "Session is pinned to IAD (Washington DC)"),
    ("T-ST", "st_region", "Region is requested but unavailable (capacity)"),
    ("T-ST", "st_region", "Data residency requirement: session must be in EU (not yet supported)"),

    # ---------- STEEL: ERRORS / LIMITS ----------
    ("T-ST", "st_errors", "API key missing / invalid (401)"),
    ("T-ST", "st_errors", "API key lacks permissions (403)"),
    ("T-ST", "st_errors", "Rate limit hit (429) - per docs, throttle is per concurrent browsers + monthly hours"),
    ("T-ST", "st_errors", "Concurrent session limit hit (Launch 10, Scale 100, Enterprise 1000+)"),
    ("T-ST", "st_errors", "Monthly browser hours exhausted (Launch $30 credits / Scale $100 credits)"),
    ("T-ST", "st_errors", "Proxy bandwidth exhausted (Launch $10/GB, Scale $6/GB)"),
    ("T-ST", "st_errors", "Captcha solve quota exhausted (Launch $3/1k, Scale $1/1k)"),
    ("T-ST", "st_errors", "Max session time hit (Launch 15 min, Scale 1 hour, Enterprise 24 hours)"),
    ("T-ST", "st_errors", "Network connectivity to Steel servers (firewall, DNS)"),
    ("T-ST", "st_errors", "CDP websocket disconnects mid-session"),
    ("T-ST", "st_errors", "Playwright / Puppeteer / Selenium library version mismatch"),
    ("T-ST", "st_errors", "Profile upload failed (size > 300MB, malformed)"),
    ("T-ST", "st_errors", "Region parameter invalid (typo)"),
    ("T-ST", "st_errors", "Data retention hit (Launch 7d, Scale 14d, Enterprise custom)"),

    # ---------- PIPELINE: FIRECRAWL → STEEL (handoff) ----------
    ("T-PL", "pipeline", "Agent uses Firecrawl search to find candidate URLs"),
    ("T-PL", "pipeline", "Agent passes Firecrawl search results into Steel for deep interaction (login walls)"),
    ("T-PL", "pipeline", "Firecrawl scrape returns 401/403/500 (anti-bot) - escalate to Steel with stealth"),
    ("T-PL", "pipeline", "Firecrawl scrape times out (JS-rendered SPA) - escalate to Steel with wait_for or Playwright"),
    ("T-PL", "pipeline", "Firecrawl scrape blocked by login wall - escalate to Steel profile with auth cookies"),
    ("T-PL", "pipeline", "Steel session returns HTML, agent hands to Firecrawl for structured extraction"),
    ("T-PL", "pipeline", "Firecrawl batch scrape fans out URLs, Steel handles the interactive subset"),
    ("T-PL", "pipeline", "Firecrawl change-tracking fires 'changed' event, Steel session re-captures new state"),
    ("T-PL", "pipeline", "Firecrawl monitor (web search mode) fires new result, Steel opens and verifies"),

    # ---------- AGENT: ORCHESTRATION / LLM ----------
    ("T-AG", "agent", "Agent LLM hallucinates a non-existent endpoint (e.g. /v3/scrape)"),
    ("T-AG", "agent", "Agent LLM produces invalid params (wrong types, missing required fields)"),
    ("T-AG", "agent", "Agent LLM exceeds context window (returns truncated markdown)"),
    ("T-AG", "agent", "Agent LLM picks the wrong tool (search vs scrape vs map)"),
    ("T-AG", "agent", "Agent loop makes > N API calls (cost runaway)"),
    ("T-AG", "agent", "Agent passes PII in URL query (logged)"),
    ("T-AG", "agent", "Agent requests stealth unnecessarily (cost waste)"),
    ("T-AG", "agent", "Agent forgets to release Steel session (cost waste)"),

    # ---------- SECURITY / COMPLIANCE ----------
    ("T-SC", "security", "API key is in client-side code (must be server-side)"),
    ("T-SC", "security", "API key is committed to git (rotate, audit)"),
    ("T-SC", "security", "Steel session is shared across users (anti-pattern)"),
    ("T-SC", "security", "Steel profile contains user PII (handle per GDPR)"),
    ("T-SC", "security", "Firecrawl result contains PII (redact before downstream)"),
    ("T-SC", "security", "Target site is on a denylist (ToS / robots.txt / court order)"),
    ("T-SC", "security", "ZDR / Lockdown requested for compliance but not enabled on plan"),
    ("T-SC", "security", "Webhook receiver logs full payload (PII risk)"),
    ("T-SC", "security", "Login wall broken via stolen cookies (re-auth + rotate)"),
    ("T-SC", "security", "Captcha solver abused (rate limit / vendor block)"),
]

# ---------------------------------------------------------------------------
# Conditions
# ---------------------------------------------------------------------------
CONDITIONS: Dict[str, List[str]] = {
    "fc_scrape": [
        "scrape.url is a valid http(s) URL",
        "scrape.url is invalid / unreachable (DNS / 4xx / 5xx)",
        "scrape formats includes 'markdown' (default)",
        "scrape formats includes 'html' / 'rawHtml' (alternative)",
        "scrape formats includes 'screenshot' (needs storage)",
        "scrape formats includes 'json' (structured extraction)",
        "scrape formats includes 'summary' (LLM summary)",
        "scrape formats includes 'branding' (design system)",
        "scrape formats includes 'links' (all URLs)",
        "scrape formats includes 'changeTracking' (with modes)",
        "scrape onlyMainContent == true (default - strip boilerplate)",
        "scrape onlyMainContent == false (keep nav/footer)",
        "scrape wait_for is set (0-60000ms)",
        "scrape wait_for is unset (default 0)",
        "scrape timeout <= 60000ms (max)",
        "scrape timeout > 60000ms (clamped to 60s)",
        "scrape.location is set (country / languages) - geo-targeted proxy",
        "scrape.location is unset (default IP)",
        "scrape includeTags / excludeTags target existing DOM elements",
        "scrape includeTags / excludeTags target nonexistent selectors (no-op)",
        "scrape headers is set (custom UA etc.)",
        "scrape URL is a PDF",
        "scrape URL is a DOCX",
        "scrape URL is an image",
        "scrape URL is a JS-rendered SPA (needs wait_for)",
        "scrape URL returns 4xx (client error)",
        "scrape URL returns 5xx (server error)",
        "scrape URL requires login (cookie wall)",
        "scrape URL has anti-bot detection (Cloudflare, DataDome)",
        "scrape max_age allows cache hit (<= now - scraped_at)",
        "scrape max_age forces fresh fetch (now)",
        "scrape store_in_cache seeds the cache for future lockdown use",
        "scrape.actions is set (browser actions before capture)",
        "scrape.actions selector is invalid (action fails - SCRAPE_ACTION_ERROR)",
        "scrape.proxy == 'auto' (basic first, stealth retry on 401/403/500)",
        "scrape.proxy == 'stealth' (always 5 credits)",
        "scrape.proxy == 'basic' (default)",
        "scrape.skipTlsVerification == true (bypass invalid cert)",
        "scrape.skipTlsVerification == false (default - reject invalid cert)",
        "scrape.zeroDataRetention == true (compliance mode)",
        "scrape.zeroDataRetention == true AND screenshot requested (ZDR violation)",
        "scrape.lockdown == true (cache only, no live fetch)",
        "scrape.lockdown == true AND no cached data for URL (404 SCRAPE_LOCKDOWN_CACHE_MISS)",
    ],
    "fc_crawl": [
        "crawl.url is a valid start URL",
        "crawl.url is a sitemap.xml (sitemap-only mode)",
        "crawl.url is invalid (404 at start)",
        "crawl.includePaths set (regex/list of paths to keep)",
        "crawl.excludePaths set (skip paths)",
        "crawl.crawlEntireDomain == true (no path filter)",
        "crawl.limit set (max pages)",
        "crawl.limit unset (uses plan default, may be huge)",
        "crawl.limit * estimated_credits <= plan_credits (covered)",
        "crawl.limit * estimated_credits > plan_credits (402 Payment Required)",
        "crawl.delay > 0 (concurrency forced to 1)",
        "crawl.maxConcurrency <= plan_concurrency",
        "crawl.maxConcurrency > plan_concurrency (clamped)",
        "crawl.enhancedMode (stealth + geo + adaptive retry) is on",
        "crawl.status == 'scraping' (in progress)",
        "crawl.status == 'completed'",
        "crawl.status == 'failed'",
        "crawl.cancelled by user (job stops, partial results retained)",
        "crawl.data array has < limit pages (some failed)",
        "crawl.errors endpoint returns robots_blocked list (respect robots.txt)",
        "crawl.errors endpoint returns network errors (DNS, timeout)",
        "crawl.webhook is set (events: started / page / completed)",
        "crawl.webhook URL is unreachable (retry with backoff)",
        "crawl.parsers includes 'pdf' (PDF parsing on each page)",
        "crawl.fast_mode PDF parsing (text-only)",
        "crawl.ocr_mode PDF parsing (force OCR for scanned docs)",
    ],
    "fc_map": [
        "map.url is valid",
        "map.url is invalid (4xx)",
        "map returns list of URLs",
        "map returns empty list (no links found / noindex / no follow)",
        "map hits 429 (rate limit)",
        "map results feed into /scrape (URL discovery pipeline)",
    ],
    "fc_search": [
        "search.query is non-empty (natural language)",
        "search.query is empty (400 invalid query)",
        "search.limit is 3 (default)",
        "search.limit is 20 (max)",
        "search.limit > 20 (clamped or rejected)",
        "search.scrapeOptions is set (combined search+scrape)",
        "search.scrapeOptions is unset (return snippets only)",
        "search returns 0 results (query too narrow)",
        "search returns 1-10 results",
        "search returns 11-20 results",
        "search is keyless (MCP / CLI / SDK on Cloud with research index)",
        "keyless search hits IP daily request cap (429)",
        "keyless search hits IP daily credits cap (429)",
        "search costs 2 credits per 10 results (rounded up)",
        "search+scrape charges scrape cost on top",
        "search 5xx (transient, retry)",
        "search 401 (bad API key)",
        "search 402 (subscription lapsed)",
    ],
    "fc_extract": [
        "extract.urls is non-empty",
        "extract.urls is empty (422)",
        "extract.schema is a valid JSON Schema",
        "extract.schema is invalid (422)",
        "extract.prompt is set (NL schema description)",
        "extract.prompt is empty (no schema - rejected)",
        "extract returns object matching schema (success)",
        "extract returns object with empty fields (page didn't have data)",
        "extract webhooks: started / completed / failed",
        "extract costs 4 credits per page (advanced)",
        "extract status == 'completed'",
        "extract status == 'failed' (parse error, schema mismatch)",
    ],
    "fc_batch": [
        "batch.urls is non-empty",
        "batch.urls contains invalid URLs (ignored if ignoreInvalidURLs=true)",
        "batch.urls contains only invalid URLs (empty result)",
        "batch.maxConcurrency set",
        "batch.ignoreInvalidURLs == true (default - skip bad URLs)",
        "batch.ignoreInvalidURLs == false (fail whole batch on bad URL)",
        "batch is sync (batchScrape - waits for completion)",
        "batch is async (startBatchScrape - returns job ID)",
        "batch.webhook is set (page events fire per URL)",
        "batch.webhook URL is down (5xx, retry)",
        "batch results are < 24h old (available via API)",
        "batch results are > 24h old (still in activity logs)",
        "batch status == 'completed'",
        "batch status == 'failed' (one URL fatal?)",
    ],
    "fc_agent": [
        "agent.goal is non-empty (NL goal)",
        "agent.goal is empty (422)",
        "agent in preview (5 free daily runs, dynamic pricing)",
        "agent status == 'in_progress' (autonomous navigation)",
        "agent status == 'completed' (results returned)",
        "agent status == 'failed' (could not complete goal)",
        "agent status == 'cancelled' (user stopped)",
        "agent webhooks: started / action / completed / failed / cancelled",
        "agent hits 5 free daily cap (429 if not upgraded)",
    ],
    "fc_monitor": [
        "monitor is for a single page (page monitor)",
        "monitor is for a whole website (multi-page, periodic crawl)",
        "monitor changeStatus == 'same' (no change since last check)",
        "monitor changeStatus == 'changed' (content changed)",
        "monitor changeStatus == 'new' (newly seen URL)",
        "monitor changeStatus == 'removed' (URL no longer present)",
        "monitor changeStatus == 'error' (scrape failed during check)",
        "monitor uses JSON mode (modes: [json]) with schema",
        "monitor check.completed webhook fires",
        "monitor alerts on new results (web-search mode)",
        "monitor has snapshot.json with full current extraction (JSON mode)",
    ],
    "fc_zdr": [
        "zeroDataRetention == true AND screenshot requested (ZDR violation)",
        "zeroDataRetention == true AND no screenshot (OK)",
        "ZDR requires help@firecrawl.dev to enable (default off)",
        "lockdown == true AND cache hit (returns cached data)",
        "lockdown == true AND no cached data (404 SCRAPE_LOCKDOWN_CACHE_MISS)",
        "lockdown cache is seeded by a non-lockdown scrape first",
    ],
    "fc_webhook": [
        "webhook.url is HTTPS and public",
        "webhook.url is HTTP (rejected)",
        "webhook.url is localhost (cannot deliver)",
        "webhook.url is on private IP (cannot deliver)",
        "webhook.url returns 2xx (delivered)",
        "webhook.url returns 5xx (transient, retry with backoff)",
        "webhook.url is slow (>30s, may time out)",
        "webhook.url returns 4xx (no retry - mark failed)",
        "webhook.payload includes user-supplied metadata",
        "webhook.payload includes idempotency key (job id)",
        "webhook signature is valid (HMAC)",
        "webhook signature is invalid (reject)",
        "webhook events filter includes 'started' / 'page' / 'completed' / 'failed'",
    ],
    "fc_billing": [
        "free plan: 5 req/min, 1000 credits/month",
        "hobby plan: 50 req/min",
        "standard plan: 250 req/min",
        "growth plan: 2500 req/min",
        "all API keys on same team share rate limit counters",
        "concurrency limit hit (in-flight browsers full) - 429",
        "credits run out mid-crawl (crawl marked failed)",
        "subscription lapsed - 402 Payment Required",
        "Retry-After header present (seconds to wait)",
    ],
    "fc_errors": [
        "SCRAPE_TIMEOUT (408) - page took too long, retry with higher timeout",
        "SCRAPE_ALL_ENGINES_FAILED (500) - all engines failed, escalate to stealth",
        "SCRAPE_SSL_ERROR (500) - invalid cert, retry with skipTlsVerification:true",
        "SCRAPE_SITE_ERROR (500) - unrecoverable, may need manual intervention",
        "SCRAPE_DNS_RESOLUTION_ERROR (500) - DNS failed, retry later",
        "SCRAPE_ACTION_ERROR (500) - browser action failed, fix selector or skip",
        "SCRAPE_PDF_PREFETCH_FAILED (500) - PDF fetch failed, retry",
        "SCRAPE_PDF_INSUFFICIENT_TIME_ERROR (500) - not enough time, raise timeout",
        "SCRAPE_PDF_ANTIBOT_ERROR (500) - PDF blocked by anti-bot, escalate to stealth",
        "SCRAPE_UNSUPPORTED_FILE_ERROR (500) - file > 10MB or unsupported",
        "SCRAPE_ZDR_VIOLATION_ERROR (500) - ZDR + screenshot conflict",
        "SCRAPE_LOCKDOWN_CACHE_MISS (404) - no cached data, seed cache first",
        "UNKNOWN_ERROR (500) - retry per SDK policy with backoff",
    ],
    "st_session": [
        "sessions.create returns session.id AND session.websocketUrl",
        "sessions.create fails (401 bad key, 403 no perm, 5xx transient)",
        "session.timeout unset (default 5 minutes)",
        "session.timeout = 1800000 (30 minutes)",
        "session.timeout = 86400000 (24 hours - Enterprise only)",
        "session.timeout exceeded plan max (Launch 15m, Scale 1h, Enterprise 24h)",
        "session.inactivityTimeout is set (release on idle)",
        "session.inactivityTimeout > timeout (no effect, timeout wins)",
        "session.useProxy == true (residential proxy network)",
        "session.solveCaptcha == true (automatic CAPTCHA solving)",
        "session.customUserAgent is set",
        "session.region == 'LAX' (pinned)",
        "session.region == 'IAD' (pinned)",
        "session.region unset (auto-route to closest)",
        "session.isSelenium == true (Selenium-compatible)",
        "session.persistProfile == true (snapshot after release)",
        "session.blockAds == true",
        "session.release is called explicitly (best practice)",
        "session.releaseAll() is called (cleanup)",
        "session hard-timeout elapses (auto-release)",
        "session inactivity-timeout elapses (auto-release on idle)",
        "Playwright connectOverCDP(websocketUrl&apiKey=...) attaches",
        "Puppeteer browserWSEndpoint = wss://connect.steel.dev?apiKey=...&sessionId=...",
        "Python connect_over_cdp(...) attaches",
        "Selenium WebDriver attaches via isSelenium:true",
        "session.sessionViewerUrl is open (live viewer)",
    ],
    "st_profile": [
        "profile created from session with persistProfile:true",
        "profile state == 'READY' (after session release)",
        "profile state == 'CREATING' (in progress)",
        "profile state == 'FAILED' (upload failed - too large, etc.)",
        "new session starts with profileId (cookies / auth / extensions restored)",
        "profile file size > 300MB (upload fails - FAILED state)",
        "profile file size <= 300MB (upload OK)",
        "profile not used for 30 days (auto-deleted)",
        "profile shared between agents (anti-pattern)",
        "profile contains cookies for a different user (cross-user leak)",
        "profile credentials rotated at provider (need to re-login)",
    ],
    "st_proxy": [
        "session.useProxy == true (residential proxy network)",
        "proxy bandwidth quota remaining (Launch $10/GB, Scale $6/GB)",
        "proxy bandwidth quota exceeded (overage billable)",
        "proxy IP is allowlisted at target (good)",
        "proxy IP is blocked at target (rotate or escalate to dedicated IP)",
        "custom proxy URL passed (user:pass@host:port)",
        "dedicated IP allocated on Scale plan ($5/IP/month)",
    ],
    "st_captcha": [
        "session.solveCaptcha == true (automatic solving)",
        "captcha type is reCAPTCHA v2 / v3",
        "captcha type is hCaptcha",
        "captcha type is unsupported (per vendor coverage)",
        "captcha solve quota remaining (Launch $3/1k, Scale $1/1k)",
        "captcha solve quota exceeded (overage billable)",
        "captcha solve fails after retries (escalate or report)",
    ],
    "st_capture": [
        "agent calls /scrape quick action (content extraction)",
        "agent calls /screenshot quick action (page capture)",
        "agent calls /pdf quick action (save as PDF)",
        "quick action quota remaining ($5/1k on Launch/Scale)",
        "quick action quota exceeded",
        "Playwright takes screenshot manually (page.screenshot)",
        "Playwright saves page as PDF (page.pdf)",
        "Playwright downloads a file (page.on('download'))",
        "Playwright fills a form (page.fill / page.click / page.press)",
        "Playwright intercepts network (page.route)",
        "Playwright scrapes via page.evaluate (extract DOM data)",
        "CDP websocket disconnects mid-session (Playwright reconnect needed)",
    ],
    "st_region": [
        "region unset (auto-route to closest)",
        "region == 'LAX' (Los Angeles)",
        "region == 'IAD' (Washington DC)",
        "region requested but unavailable (capacity)",
        "data residency requirement: must be in EU (not yet supported)",
    ],
    "st_errors": [
        "API key missing / invalid (401)",
        "API key lacks permissions (403)",
        "rate limit hit (429) - throttle on concurrent browsers + monthly hours",
        "concurrent session limit hit (Launch 10, Scale 100, Enterprise 1000+)",
        "monthly browser hours exhausted (Launch $30 / Scale $100 / Enterprise custom)",
        "proxy bandwidth exhausted (overage billable)",
        "captcha solve quota exhausted (overage billable)",
        "max session time hit (Launch 15m / Scale 1h / Enterprise 24h)",
        "network connectivity to Steel servers (firewall, DNS)",
        "CDP websocket disconnects mid-session",
        "Playwright / Puppeteer / Selenium library version mismatch",
        "profile upload failed (size > 300MB, malformed)",
        "region parameter invalid (typo)",
        "data retention hit (Launch 7d, Scale 14d, Enterprise custom)",
        "Retry-After header present (seconds to wait)",
    ],
    "pipeline": [
        "Firecrawl search returns 5 candidate URLs",
        "Firecrawl search returns 0 candidates (fall back to map or seed URLs)",
        "Firecrawl scrape returns 401/403/500 on a URL (anti-bot) - escalate to Steel",
        "Firecrawl scrape times out on JS-rendered SPA (escalate to Steel with wait_for)",
        "Firecrawl scrape blocked by login wall (escalate to Steel profile with auth)",
        "Steel session returns HTML for a login-walled page",
        "Steel session returns HTML, agent hands to Firecrawl for structured extraction",
        "Firecrawl batch scrape fans out URLs, Steel handles the interactive subset",
        "Firecrawl change-tracking fires 'changed' event, Steel re-captures new state",
        "Firecrawl monitor (web search mode) fires new result, Steel opens and verifies",
        "Both Firecrawl and Steel budget caps are in play (cost guardrail)",
        "Both return empty results (cascading failure - escalate to operator)",
    ],
    "agent": [
        "agent LLM hallucinates a non-existent endpoint (e.g. /v3/scrape) - 404",
        "agent LLM produces invalid params (wrong types, missing required fields) - 422",
        "agent LLM exceeds context window (truncate markdown response)",
        "agent LLM picks wrong tool (search vs scrape vs map)",
        "agent LLM loops on same call (runaway cost)",
        "agent LLM passes PII in URL query (logged at Firecrawl / Steel)",
        "agent requests stealth unnecessarily (cost waste - 5 credits vs 1)",
        "agent forgets to release Steel session (cost waste until timeout)",
        "agent issues too many concurrent scrapes (concurrency limit)",
        "agent uses wrong region for target site (latency / wrong content)",
    ],
    "security": [
        "API key is in client-side code (must be server-side)",
        "API key is committed to git (rotate, audit)",
        "Steel session is shared across users (anti-pattern)",
        "Steel profile contains user PII (handle per GDPR / CCPA)",
        "Firecrawl result contains PII (redact before downstream)",
        "target site is on a denylist (ToS / robots.txt / court order)",
        "ZDR / Lockdown requested for compliance but not enabled on plan",
        "webhook receiver logs full payload (PII risk)",
        "login wall broken via stolen cookies (re-auth + rotate)",
        "captcha solver abused (rate limit / vendor block)",
    ],
}

# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------
ACTIONS: Dict[str, Dict[str, List[str]]] = {
    "if_action": {
        "fc_scrape": [
            "Mark scrape 'success'; emit markdown / HTML / JSON to caller",
            "Retry with higher timeout (up to 60000ms) on SCRAPE_TIMEOUT",
            "Retry with skipTlsVerification:true on SCRAPE_SSL_ERROR",
            "Escalate to proxy='stealth' on 401/403/500 (5 credits)",
            "Add wait_for and re-render for JS-heavy SPAs",
            "Use Steel session for login-walled pages (cookies from profile)",
            "Use /v2/map first to discover URLs, then /v2/scrape each",
            "Strip nav/footer via onlyMainContent:true (default)",
            "Use includeTags / excludeTags to filter DOM",
            "Set custom User-Agent via headers (bypass naive UA blocks)",
            "Use location to geo-target (country / languages)",
            "Parse PDF with parsers:['pdf'] (auto / fast / ocr modes)",
            "Parse DOCX / image (parsers includes right type)",
            "Set max_age=0 for fresh fetch (no cache)",
            "Store result in cache (store_in_cache:true) for later lockdown use",
            "Re-render after a click / write / wait action (page.screenshot mid-flow)",
            "Take screenshot (formats:['screenshot']) for visual record",
            "Extract structured JSON (formats:['json']) with schema or prompt",
            "Use proxy='auto' (cheap basic, fallback stealth)",
            "Always use stealth (proxy='stealth', 5 credits) for known hard targets",
            "Reject scrape with ZDR (don't add screenshot etc.)",
            "Seed cache once with non-lockdown, then enable lockdown for compliance",
            "Fall back to no-cache when SCRAPE_LOCKDOWN_CACHE_MISS",
            "Return cached version of URL (cache hit)",
        ],
        "fc_crawl": [
            "Start crawl; poll /v2/crawl/{id} or use webhooks for events",
            "Set includePaths / excludePaths to bound scope",
            "Set crawlEntireDomain:true to traverse the whole domain",
            "Set sitemap:include / skip / only to control sitemap use",
            "Set limit (crawl size) AND verify credits cover it (avoid 402)",
            "Set delay to stay under target site's rate limit (forces concurrency=1)",
            "Set maxConcurrency to cap parallelism (per job)",
            "Enable Enhanced Mode (stealth + geo + adaptive retry) for hard sites",
            "Check /v2/crawl/{id}/errors for robots_blocked + network errors",
            "Resume or accept partial results if status != completed",
            "Cancel crawl if user requests (job stops, partial data kept)",
            "Use Steel session for the interactive subset of crawled pages",
            "Use changeTracking format on crawl to diff each page",
        ],
        "fc_map": [
            "Return URL list; pick top-K to scrape",
            "Map empty - fall back to sitemap.xml or seed URLs",
            "Back off and retry on 429",
            "Map results feed directly into /v2/scrape batch (one round trip)",
            "Map results feed directly into /v2/crawl (continue discovery)",
        ],
        "fc_search": [
            "Return ranked results (full page content if scrapeOptions set)",
            "Set scrapeOptions to scrape each result in the same call (combined)",
            "Set limit 1-20 (default 3, max 20)",
            "Back off and retry on 429",
            "Use keyless mode from MCP / CLI / SDK on Cloud (free, IP-capped)",
            "Stop on keyless daily cap (429) - surface to operator",
            "Refine query if 0 results (broader terms, remove quotes)",
            "Charge 2 credits per 10 results (rounded up) - surface cost to user",
            "Charge scrape cost on top of search cost (transparency)",
        ],
        "fc_extract": [
            "Return structured JSON matching schema (success)",
            "Use prompt for NL schema description (alternative to JSON Schema)",
            "Treat empty fields as 'data not present' (don't fail)",
            "Validate schema client-side before sending (avoid 422)",
            "Use webhooks (started / completed / failed) instead of polling",
            "Charge 4 credits per page (advanced) - surface cost",
            "Retry on failure (transient)",
        ],
        "fc_batch": [
            "Start batch; poll /v2/batch/scrape/{id} or use webhooks",
            "Set ignoreInvalidURLs:true (default) - bad URLs are reported, batch runs",
            "Surface invalidURLs list to operator for cleanup",
            "Set maxConcurrency per batch (vs per team)",
            "Use async (startBatchScrape) for large batches - avoids client timeout",
            "Receive batch_scrape.started / .page / .completed / .failed webhooks",
            "Fetch results within 24h of completion (API window)",
            "Fall back to activity logs after 24h",
        ],
        "fc_agent": [
            "Start agent job; poll /v2/agent/{id} or use webhooks (action events fire)",
            "Free preview: 5 daily runs (rate limited)",
            "Cancel agent job (user / timeout)",
            "Receive started / action / completed / failed / cancelled webhooks",
            "Use for multi-step research without specifying URLs",
        ],
        "fc_monitor": [
            "Create page monitor; alerts on change (same / changed / new / removed / error)",
            "Create website monitor; multi-page periodic crawl + diff",
            "Use JSON mode (modes:['json']) with schema for per-field diff",
            "Receive check.completed webhook on each check",
            "Use web-search mode monitor for new-result alerts (not page diff)",
            "Use snapshot.json to get full current extraction without re-fetch",
        ],
        "fc_zdr": [
            "Use ZDR (no temporary storage) for compliance-bound scraping",
            "Don't add screenshot / formats that require temporary storage (ZDR violation)",
            "Enable ZDR via help@firecrawl.dev (default off)",
            "Use lockdown mode (cache only) for repeatable, low-risk targets",
            "Seed cache with a non-lockdown scrape before enabling lockdown",
            "Re-scrape and re-cache when SCRAPE_LOCKDOWN_CACHE_MISS",
        ],
        "fc_webhook": [
            "Return 2xx fast (enqueue and ACK)",
            "Use HTTPS endpoint with valid cert (TLS verify required)",
            "Don't use localhost / private IPs (cannot deliver)",
            "Honor 5xx with backoff (Firecrawl retries)",
            "Don't honor 4xx (Firecrawl marks failed, no retry)",
            "Use user-supplied metadata to route events (job_id, etc.)",
            "Use job_id as idempotency key (dedup duplicate deliveries)",
            "Verify HMAC signature (reject unsigned / modified)",
            "Filter events (started / page / completed / failed) to reduce noise",
        ],
        "fc_billing": [
            "Treat 5 req/min as hard cap (Free plan)",
            "Bucket calls under 50 req/min (Hobby plan)",
            "Bucket calls under 250 req/min (Standard plan)",
            "Bucket calls under 2500 req/min (Growth plan)",
            "Count per-team, not per-key (all keys share the same bucket)",
            "Wait for in-flight jobs to finish on concurrency 429",
            "Surface 402 to operator (credits exhausted mid-crawl)",
            "Honor Retry-After header (seconds to wait)",
            "Switch to higher plan or wait for billing cycle",
        ],
        "fc_errors": [
            "Mark scrape 'success'; release Steel session",
            "Retry on SCRAPE_TIMEOUT with higher timeout (up to 60000ms)",
            "Retry on SCRAPE_SSL_ERROR with skipTlsVerification:true",
            "Mark SCRAPE_SITE_ERROR unrecoverable; surface to operator",
            "Retry on SCRAPE_DNS_RESOLUTION_ERROR after delay (transient)",
            "Fix selector and retry on SCRAPE_ACTION_ERROR",
            "Retry SCRAPE_PDF_PREFETCH_FAILED with backoff",
            "Raise timeout on SCRAPE_PDF_INSUFFICIENT_TIME_ERROR",
            "Escalate to stealth proxy on SCRAPE_PDF_ANTIBOT_ERROR",
            "Skip file on SCRAPE_UNSUPPORTED_FILE_ERROR (>10MB / wrong type)",
            "Refuse ZDR + screenshot (SCRAPE_ZDR_VIOLATION_ERROR) - drop the screenshot",
            "Seed cache on SCRAPE_LOCKDOWN_CACHE_MISS",
            "Retry UNKNOWN_ERROR (500) per SDK policy with backoff",
        ],
        "st_session": [
            "Create session; return session.id, websocketUrl, sessionViewerUrl",
            "Set timeout (default 5 min; raise to 30 min / 1 hour / 24 hours per plan)",
            "Set inactivityTimeout so a stalled client doesn't keep billing",
            "Set useProxy:true for residential proxy network (geo + rotation)",
            "Set solveCaptcha:true for sites with CAPTCHA",
            "Set custom userAgent (per site policy)",
            "Pin region (LAX / IAD / auto) for latency / data residency",
            "Set isSelenium:true for Selenium-compatible sessions",
            "Set persistProfile:true to snapshot user data dir on release",
            "Set blockAds:true (faster pages, fewer popups)",
            "Release session explicitly when done (best practice, avoids billing leak)",
            "Release all sessions on shutdown (releaseAll) for cleanup",
            "Wait for hard-timeout auto-release if not explicit (acceptable fallback)",
            "Wait for inactivity-timeout auto-release (idle client)",
            "Connect Playwright via chromium.connectOverCDP(websocketUrl&apiKey=...)",
            "Connect Puppeteer via browserWSEndpoint = wss://connect.steel.dev?apiKey=...&sessionId=...",
            "Connect Python via playwright.chromium.connect_over_cdp(...)",
            "Connect Selenium WebDriver via isSelenium:true",
            "Open sessionViewerUrl in operator tab for live debugging",
        ],
        "st_profile": [
            "Create profile from session with persistProfile:true (snapshot on release)",
            "Wait for profile state == 'READY' (snapshot uploaded)",
            "Reuse profileId for new sessions (cookies, auth, extensions restored)",
            "Reject profile if size > 300MB (FAILED state - needs smaller profile)",
            "Auto-delete profile if unused 30 days (TTL)",
            "Use one profile per use case (LinkedIn / GitHub / etc.) - do not share",
            "Never share profiles across users (cross-tenant leak)",
            "Re-login in profile when provider credentials rotate",
        ],
        "st_proxy": [
            "Enable useProxy:true for residential proxy network (geo + rotation)",
            "Track proxy bandwidth cost ($10/GB Launch, $6/GB Scale, overage billable)",
            "Use proxy IP that's allowlisted at target (good)",
            "Rotate proxy or escalate to dedicated IP when blocked",
            "Pass custom proxy URL (user:pass@host:port) for whitelisted egress",
            "Allocate dedicated IP on Scale ($5/IP/month) for stable allowlisting",
        ],
        "st_captcha": [
            "Enable solveCaptcha:true (auto-solve supported types)",
            "Use reCAPTCHA v2 / v3, hCaptcha (vendor-supported types)",
            "Skip unsupported CAPTCHA types (report to operator)",
            "Track captcha solve cost ($3/1k Launch, $1/1k Scale)",
            "Stop on quota exceeded; surface to operator",
            "Retry on captcha solve failure; escalate after N tries",
        ],
        "st_capture": [
            "Use /scrape quick action (content extraction)",
            "Use /screenshot quick action (page capture)",
            "Use /pdf quick action (page-to-PDF)",
            "Track quick-action cost ($5/1k on Launch/Scale)",
            "Stop on quota exceeded; surface to operator",
            "Use Playwright page.screenshot for custom viewport / clip",
            "Use Playwright page.pdf for full page PDF",
            "Use Playwright download event (page.on('download')) for files",
            "Use Playwright page.fill / click / press for forms",
            "Use Playwright page.route for network interception",
            "Use Playwright page.evaluate for custom DOM extraction",
            "Reconnect Playwright on CDP websocket disconnect (driver.relaunch)",
        ],
        "st_region": [
            "Auto-route to closest region (default)",
            "Pin region=LAX (Los Angeles)",
            "Pin region=IAD (Washington DC)",
            "Surface region unavailable (capacity) - try a different region",
            "Use dedicated IP / private deployment for EU residency (not in default plan)",
        ],
        "st_errors": [
            "Mark 'success'; release session if needed",
            "Re-auth with valid API key; surface to operator",
            "Surface 403 (permissions) to operator; check key role",
            "Back off on 429 (per docs - exponential with jitter, honor Retry-After)",
            "Wait for in-flight sessions to finish on concurrent limit",
            "Wait for billing cycle / upgrade plan on monthly hours exhausted",
            "Track proxy bandwidth; stop on overage (or accept billable overage)",
            "Track captcha solve quota; stop on overage",
            "Re-create session if max time hit; design for resume / idempotency",
            "Diagnose network (firewall, DNS) - check egress to *.steel.dev",
            "Reconnect Playwright on CDP disconnect; driver.relaunch",
            "Lock Playwright / Puppeteer / Selenium to a tested version",
            "Recreate profile with smaller user data dir if upload > 300MB",
            "Validate region parameter (typo = 4xx)",
            "Export data within data retention window (Launch 7d / Scale 14d)",
        ],
        "pipeline": [
            "Use Firecrawl search → scrape as cheap fast path",
            "Use Firecrawl map → scrape to discover URLs on a site",
            "Escalate to Steel when Firecrawl hits anti-bot (401/403/500)",
            "Escalate to Steel when Firecrawl times out on JS-heavy SPA",
            "Escalate to Steel when Firecrawl blocked by login wall (use profile with auth cookies)",
            "Hand Steel HTML output to Firecrawl for structured extraction",
            "Use Firecrawl batch scrape for fan-out, Steel for interactive subset",
            "On Firecrawl 'changed' event, re-open in Steel and verify",
            "On Firecrawl monitor 'new' result, open in Steel and verify",
            "Enforce joint cost guardrail (Firecrawl credits + Steel browser hours)",
            "Escalate cascading empty results to operator (manual investigation)",
        ],
        "agent": [
            "Use only canonical endpoints (/v2/scrape, /v2/crawl, /v2/map, /v2/search, /v2/extract, /v2/batch/scrape, /v2/agent)",
            "Validate params client-side (avoid 422)",
            "Truncate / chunk markdown if response too long for context",
            "Pick cheapest tool: search → map → scrape → batch scrape → crawl → agent",
            "Cap tool call count per turn (cost runaway guard)",
            "Redact PII from URL queries (privacy)",
            "Use proxy='auto' by default; only 'stealth' for known hard sites",
            "Always release Steel session explicitly (cost guardrail)",
            "Limit concurrent scrapes to plan concurrency (avoid 429)",
            "Auto-route region for target site (geo-aware)",
        ],
        "security": [
            "Keep API key in server env / secrets manager (never client-side)",
            "Rotate API key if leaked; audit usage; force-rotate other devs",
            "Use one Steel session per user (never share across users)",
            "Don't store user PII in shared profiles (handle per GDPR / CCPA)",
            "Redact PII from Firecrawl results before downstream / log",
            "Respect denylist (ToS / robots.txt / court order)",
            "Enable ZDR / Lockdown for compliance (contact help@firecrawl.dev)",
            "Don't log full webhook payload (PII risk); log only job_id",
            "Re-auth and rotate cookies on suspicious session activity",
            "Rate-limit captcha solver usage (vendor block risk)",
        ],
    },
    "else_action": {
        "fc_scrape": [
            "Page on-call; capture scrape request + URL; require human triage for non-retryable errors",
            "Do not blindly retry on 4xx (likely a code / config bug)",
            "Do not blindly retry on 5xx past 3 attempts; surface to operator",
            "Do not escalate to stealth on a fresh target (waste credits); try basic first",
        ],
        "fc_crawl": [
            "Page on-call; capture crawl id; require human triage if crawl fails irrecoverably",
            "Do not exceed limit beyond plan credits (402 stops the crawl mid-run)",
        ],
        "fc_map": [
            "Page on-call; require operator to seed URLs manually if map empty",
        ],
        "fc_search": [
            "Page on-call; do not retry 4xx blindly (bad query, not transient)",
        ],
        "fc_extract": [
            "Page on-call; do not retry on schema validation failure (422) without schema fix",
        ],
        "fc_batch": [
            "Page on-call; do not silently drop invalid URLs without alerting",
        ],
        "fc_agent": [
            "Page on-call; do not auto-retry agent on failure without budget check",
        ],
        "fc_monitor": [
            "Page on-call; do not spam alert on every 'same' (batch alerts)",
        ],
        "fc_zdr": [
            "Block scrape; require ZDR plan upgrade or compliance review",
        ],
        "fc_webhook": [
            "Do not process unsigned / modified payload (security)",
            "Do not block webhook response on heavy work (use async worker)",
        ],
        "fc_billing": [
            "Page on-call; do not bypass rate limit by switching keys (will be caught)",
            "Block scrape; require plan upgrade or wait for billing cycle",
        ],
        "fc_errors": [
            "Page on-call; capture error code + URL; require human triage for unknown 5xx",
        ],
        "st_session": [
            "Page on-call; capture session id; require human triage if release fails repeatedly",
            "Do not create new session if concurrent limit hit (wait for in-flight)",
        ],
        "st_profile": [
            "Page on-call; do not use FAILED profile (orphan state)",
        ],
        "st_proxy": [
            "Page on-call; do not blast proxy IPs at a single target (will be banned harder)",
        ],
        "st_captcha": [
            "Page on-call; do not retry unsupported captcha infinitely (cost / vendor risk)",
        ],
        "st_capture": [
            "Page on-call; do not run quick actions on every page (cost explosive)",
        ],
        "st_region": [
            "Page on-call; do not silently fall back to a different region without operator consent (data residency)",
        ],
        "st_errors": [
            "Page on-call; capture error + session state; require human triage for unknown errors",
            "Do not bypass rate limits by switching keys (will be caught)",
        ],
        "pipeline": [
            "Page on-call; do not silently degrade Firecrawl → Steel → operator (escalate each transition)",
        ],
        "agent": [
            "Page on-call; do not let agent retry a 4xx blindly (likely a tool bug)",
            "Block agent loop after N calls; require operator reset",
        ],
        "security": [
            "Page on-call; rotate key immediately if leaked",
            "Block cross-user session sharing (security incident)",
            "Block scrape against denylist (legal / ToS / court order)",
        ],
    },
}

SEVERITY_BY_CATEGORY = {
    "fc_scrape":   "medium",
    "fc_crawl":    "medium",
    "fc_map":      "low",
    "fc_search":   "low",
    "fc_extract":  "medium",
    "fc_batch":    "medium",
    "fc_agent":    "medium",
    "fc_monitor":  "low",
    "fc_zdr":      "high",
    "fc_webhook":  "high",
    "fc_billing":  "medium",
    "fc_errors":   "high",
    "st_session":  "high",
    "st_profile":  "high",
    "st_proxy":    "medium",
    "st_captcha":  "medium",
    "st_capture":  "low",
    "st_region":   "low",
    "st_errors":   "high",
    "pipeline":    "high",
    "agent":       "medium",
    "security":    "critical",
}

SERVICE_BY_CATEGORY = {
    "fc_scrape":   "firecrawl",
    "fc_crawl":    "firecrawl",
    "fc_map":      "firecrawl",
    "fc_search":   "firecrawl",
    "fc_extract":  "firecrawl",
    "fc_batch":    "firecrawl",
    "fc_agent":    "firecrawl",
    "fc_monitor":  "firecrawl",
    "fc_zdr":      "firecrawl",
    "fc_webhook":  "firecrawl",
    "fc_billing":  "firecrawl",
    "fc_errors":   "firecrawl",
    "st_session":  "steel",
    "st_profile":  "steel",
    "st_proxy":    "steel",
    "st_captcha":  "steel",
    "st_capture":  "steel",
    "st_region":   "steel",
    "st_errors":   "steel",
    "pipeline":    "joint",
    "agent":       "joint",
    "security":    "joint",
}

SOURCE_DOCS = {
    "fc_scrape":  "docs.firecrawl.dev/api-reference/endpoint/scrape; docs.firecrawl.dev/api-reference/errors; docs.firecrawl.dev/advanced-scraping-guide; docs.firecrawl.dev/features/stealth-mode",
    "fc_crawl":   "docs.firecrawl.dev/api-reference/endpoint/crawl-post; firecrawl.dev/blog/mastering-the-crawl-endpoint-in-firecrawl",
    "fc_map":     "docs.firecrawl.dev/api-reference/endpoint/map",
    "fc_search":  "docs.firecrawl.dev/api-reference/endpoint/search; firecrawl.dev/blog/mastering-firecrawl-search-endpoint; docs.firecrawl.dev/rate-limits",
    "fc_extract": "docs.firecrawl.dev/api-reference/endpoint/extract",
    "fc_batch":   "docs.firecrawl.dev/api-reference/endpoint/batch-scrape; docs.firecrawl.dev/features/batch-scrape",
    "fc_agent":   "docs.firecrawl.dev/advanced-scraping-guide (agent section)",
    "fc_monitor": "docs.firecrawl.dev/features/monitoring; firecrawl.dev/blog/launch-week-iii-day-1-introducing-change-tracking",
    "fc_zdr":     "docs.firecrawl.dev/features/zero-data-retention; docs.firecrawl.dev/features/lockdown",
    "fc_webhook": "docs.firecrawl.dev/webhooks/overview",
    "fc_billing": "docs.firecrawl.dev/rate-limits; firecrawl.dev (pricing)",
    "fc_errors":  "docs.firecrawl.dev/api-reference/errors",
    "st_session": "docs.steel.dev/overview/sessions-api/quickstart; docs.steel.dev/overview/sessions-api/session-lifecycle; docs.steel.dev/llms-full.txt",
    "st_profile": "docs.steel.dev/overview/profiles-api/overview; steel.dev/blog/profiles",
    "st_proxy":   "docs.steel.dev/overview/pricinglimits (proxy rates); docs.steel.dev/llms-full.txt",
    "st_captcha": "docs.steel.dev/overview/pricinglimits (captcha rates); docs.steel.dev/overview/sessions-api/quickstart",
    "st_capture": "docs.steel.dev/overview/sessions-api/quickstart; docs.steel.dev/llms-full.txt",
    "st_region":  "docs.steel.dev/overview/sessions-api/multi-region",
    "st_errors":  "docs.steel.dev/overview/pricinglimits; apis.io/rate-limits/steel-dev/steel-dev-rate-limits; steel.dev/blog/beginner-s-guide-to-steel",
    "pipeline":   "docs.firecrawl.dev/api-reference/introduction; docs.steel.dev/llms-full.txt; firecrawl.dev/scrape",
    "agent":      "docs.firecrawl.dev/api-reference/introduction; docs.steel.dev/llms-full.txt",
    "security":   "docs.firecrawl.dev/features/zero-data-retention; docs.firecrawl.dev/features/lockdown; docs.steel.dev/llms-full.txt",
}

# ---------------------------------------------------------------------------
# Build rows
# ---------------------------------------------------------------------------

def build_rows(target: int) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    seen_keys = set()

    trig_by_cat: Dict[str, List[str]] = {}
    for prefix, cat, text in TRIGGERS:
        trig_by_cat.setdefault(cat, []).append(text)
    cond_by_cat = CONDITIONS
    if_by_cat = ACTIONS["if_action"]
    else_by_cat = ACTIONS["else_action"]

    cat_order = [
        "fc_scrape", "fc_crawl", "fc_map", "fc_search", "fc_extract", "fc_batch",
        "fc_agent", "fc_monitor", "fc_zdr", "fc_webhook", "fc_billing", "fc_errors",
        "st_session", "st_profile", "st_proxy", "st_captcha", "st_capture",
        "st_region", "st_errors", "pipeline", "agent", "security",
    ]

    capacity = {}
    for cat in cat_order:
        t = len(trig_by_cat.get(cat, []))
        c = len(cond_by_cat.get(cat, []))
        a = len(if_by_cat.get(cat, []))
        e = len(else_by_cat.get(cat, []))
        capacity[cat] = (t, c, a, e, t * c * a * e)

    MIN_PER_CAT = 20
    quotas = {cat: MIN_PER_CAT for cat in cat_order}
    remaining = target - sum(quotas.values())
    total_trig = sum(capacity[c][0] for c in cat_order) or 1
    for cat in cat_order:
        extra = int(round(remaining * capacity[cat][0] / total_trig))
        quotas[cat] += extra
        remaining -= extra
    if remaining:
        biggest = max(cat_order, key=lambda c: capacity[c][0])
        quotas[biggest] += remaining
    for cat in cat_order:
        quotas[cat] = min(quotas[cat], capacity[cat][4])
    total_quota = sum(quotas.values())
    if total_quota < target:
        biggest = max(cat_order, key=lambda c: capacity[c][0])
        quotas[biggest] += (target - total_quota)
    elif total_quota > target:
        biggest = max(cat_order, key=lambda c: quotas[c])
        quotas[biggest] -= (total_quota - target)

    counter = 0
    for cat in cat_order:
        want = quotas[cat]
        triggers = trig_by_cat.get(cat, [])
        conds = cond_by_cat.get(cat, [])
        ifs = if_by_cat.get(cat, [])
        elses = else_by_cat.get(cat, [])
        if not (triggers and conds and ifs and elses):
            continue
        produced = 0
        for ti, t in enumerate(triggers):
            for ci, c in enumerate(conds):
                if produced >= want:
                    break
                if_action = ifs[(ti + ci) % len(ifs)]
                else_action = elses[ci % len(elses)]
                key = (t, c, if_action, else_action)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                counter += 1
                produced += 1
                rows.append({
                    "id": f"FS-{counter:04d}",
                    "service": SERVICE_BY_CATEGORY[cat],
                    "category": cat,
                    "trigger": t,
                    "condition": c,
                    "if_action": if_action,
                    "else_action": else_action,
                    "severity": SEVERITY_BY_CATEGORY[cat],
                    "source_doc": SOURCE_DOCS[cat],
                })
            if produced >= want:
                break
        if produced < want:
            for ti, t in enumerate(triggers):
                for ci, c in enumerate(conds):
                    if produced >= want:
                        break
                    for ai in range(len(ifs)):
                        if produced >= want:
                            break
                        if_action = ifs[(ti + ci + ai) % len(ifs)]
                        else_action = elses[(ci + ai) % len(elses)]
                        key = (t, c, if_action, else_action)
                        if key in seen_keys:
                            continue
                        seen_keys.add(key)
                        counter += 1
                        produced += 1
                        rows.append({
                            "id": f"FS-{counter:04d}",
                            "service": SERVICE_BY_CATEGORY[cat],
                            "category": cat,
                            "trigger": t,
                            "condition": c,
                            "if_action": if_action,
                            "else_action": else_action,
                            "severity": SEVERITY_BY_CATEGORY[cat],
                            "source_doc": SOURCE_DOCS[cat],
                        })
                    if produced >= want:
                        break
                if produced >= want:
                    break
    return rows

def main() -> None:
    rows = build_rows(TARGET_ROWS)
    assert len(rows) == TARGET_ROWS, f"expected {TARGET_ROWS}, got {len(rows)}"
    seen = set()
    for r in rows:
        key = (r["trigger"], r["condition"], r["if_action"], r["else_action"])
        assert key not in seen, f"duplicate row: {key}"
        seen.add(key)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["id", "service", "category", "trigger", "condition", "if_action", "else_action", "severity", "source_doc"],
            quoting=csv.QUOTE_ALL,
        )
        writer.writeheader()
        writer.writerows(rows)
    by_svc = {}
    for r in rows:
        by_svc[r["service"]] = by_svc.get(r["service"], 0) + 1
    by_cat = {}
    for r in rows:
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1
    by_sev = {}
    for r in rows:
        by_sev[r["severity"]] = by_sev.get(r["severity"], 0) + 1
    print(f"wrote {OUT_PATH} with {len(rows)} rows")
    print("by service:", by_svc)
    print("by category:", by_cat)
    print("by severity:", by_sev)

if __name__ == "__main__":
    main()
