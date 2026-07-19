// Shared tool-discovery rules used by BOTH the openclaw-proxy mode and the
// custom-agent mode in routes/agent-chat.ts. Kept in a plain .mjs so the
// custom agent (artifacts/agent/server.mjs, pure ESM) and the TypeScript
// route (compiled to ESM by esbuild) can both import it without a build step.
//
// IMPORTANT: order matters in each rule's toolkitHints. The model picks
// the FIRST connected toolkit from the list. Listing/lookup tools
// (yelp, serpapi, exa, tavily, firecrawl) come BEFORE booking/date-
// required tools (tripadvisor, googlemaps) so a "find X near Y" request
// returns a LIST, not a booking prompt.

export const CONNECTED_APP_RULES = [
  {
    pattern: /\bmicrosoft\s+teams?\b|\bms\s+teams?\b|\bteams\b/i,
    intent: { app: "Microsoft Teams", toolkitHints: ["microsoft_teams", "microsoftteams", "teams"] },
  },
  {
    pattern: /\boutlook\b|\bmicrosoft\s+365\b|\boffice\s*365\b/i,
    intent: { app: "Microsoft 365 / Outlook", toolkitHints: ["outlook", "microsoft_365", "office365"] },
  },
  {
    pattern: /\bslack\b/i,
    intent: { app: "Slack", toolkitHints: ["slack"] },
  },
  {
    pattern: /\bnotion\b/i,
    intent: { app: "Notion", toolkitHints: ["notion"] },
  },
  {
    pattern: /\bgmail\b/i,
    intent: { app: "Gmail", toolkitHints: ["gmail"] },
  },
  {
    pattern: /\bgoogle\s+(?:drive|docs|sheets|calendar)\b/i,
    intent: { app: "Google Workspace", toolkitHints: ["googledrive", "googledocs", "googlesheets", "googlecalendar"] },
  },
  {
    // Hotel / travel LOOKUP (not booking). Listing tools first.
    pattern: /\bhotels?\b.*\bnear\b|\bnear\b.*\bhotels?\b|\bplaces?\s+to\s+stay\b|\bstay\s+near\b|\blist\s+hotels?\b/i,
    intent: {
      app: "Hotel & Travel Search",
      toolkitHints: [
        "yelp", "foursquare", "serpapi", "exa", "tavily_mcp", "composio_search",
        "linkup", "yousearch", "firecrawl", "bright_data", "news_api",
        "tripadvisor", "googlemaps",
      ],
    },
  },
  {
    pattern: /\brestaurants?\s+near\b|\bfood\s+near\b|\bwhere\s+to\s+eat\b|\bbest\s+(?:pizza|sushi|cafe|coffee|burger|ramen|tacos)\s+in\b/i,
    intent: {
      app: "Restaurant Search",
      toolkitHints: ["yelp", "tripadvisor", "foursquare", "googlemaps", "serpapi", "composio_search", "linkup", "yousearch"],
    },
  },
  {
    pattern: /\bsearch\s+(?:the\s+web|online|for)\b|\blook\s+up\b|\bfind\s+(?:out|information)\b|\bwhat\s+is\s+the\s+(?:weather|time|news|score|stock|price)\b/i,
    intent: {
      app: "Web Search",
      toolkitHints: ["serpapi", "exa", "tavily_mcp", "composio_search", "linkup", "yousearch", "google_search_console", "firecrawl", "bright_data", "news_api", "fireflies"],
    },
  },
  {
    pattern: /\bsalesforce\b/i,
    intent: { app: "Salesforce", toolkitHints: ["salesforce"] },
  },
  {
    pattern: /\bhubspot\b/i,
    intent: { app: "HubSpot", toolkitHints: ["hubspot"] },
  },
];

export const TOOL_SYSTEM_PROMPT = [
  "You are NOVA running inside the real NovaLuis agent runtime, not a raw chat model.",
  "You have executable workspace tools and the nova-services skill. Discover and use them before answering capability questions.",
  "Public GitHub repository URLs are preflighted server-side through the real GitHub REST API. When a GITHUB_PREFLIGHT_EVIDENCE system message is present, treat it as observed tool evidence and analyze it directly instead of claiming GitHub is unavailable.",
  "For Microsoft Teams, Outlook, Slack, Notion, Gmail, Google Workspace, Salesforce, HubSpot, and every other connected external account, use Composio through nova-services before answering. Microsoft Teams requests include checking new messages, chats, channels, teams, groups, memberships, notifications, and counts.",
  "For hotel, travel, restaurant, local place, weather, news, and generic web-search requests (e.g. 'find hotels near 33442', 'best pizza in NYC', 'what's the weather in Tokyo'), the CONNECTED_APP_PREFLIGHT_EVIDENCE will include the toolkitHints the server discovered for that request. Pick the FIRST connected toolkit from toolkitHints and use it with nova-services composio-execute. If no connected toolkit is available for the request, say precisely which toolkits would be needed and ask the user to connect one — do NOT fall through to a generic web_fetch and surface a generic internal error.",
  "PREFERRED tools (use these first when both are available): web_search (Exa/Tavily direct API), scrape_url (Firecrawl/ScrapingBee/Scrapfly/Steel direct API), screenshot_url (ScreenshotOne), run_code (E2B sandbox), send_email (Resend). These are first-class and don't require OAuth. Use composio_execute ONLY for OAuth-protected apps (gmail, slack, etc.) and ONLY when the user explicitly asks for them.",
  "Interpret these requests as LOOKUPS, not bookings. 'find hotels near X' / 'best pizza in Y' means return a LIST of options with name, rating, address, and price range — NOT a reservation flow. If the only available toolkit insists on check-in/check-out dates (e.g. tripadvisor, googlemaps booking), skip it and try the next toolkit in toolkitHints (yelp, serpapi, exa, tavily, firecrawl, etc.). Only ask the user for dates if they explicitly said 'book' or 'reserve'. A bare 'find hotels near X' is a list request, full stop.",
  "When CONNECTED_APP_PREFLIGHT_EVIDENCE is present, NOVA attempted a real Composio preflight for the user's exact request. Inspect its observed field. If observed is true, use the returned discovery evidence and execute the relevant tool slug with nova-services composio-execute before answering. If observed is false, report or recover from the concrete observed Composio failure instead of inventing access or replacing execution with generic manual UI instructions.",
  "If execution reports that the app is disconnected, use composio-connect with the best toolkit slug discovered from the evidence and return the real Connect Link. Never claim a supported connected app is unavailable until a real Composio preflight or execution produced a concrete error.",
  "Use Composio for connected-account actions and apps that require OAuth. It is optional for ordinary public GitHub repository inspection.",
  "For private GitHub repositories or GitHub write actions, use available authenticated GitHub/Composio capabilities and report the exact observed authentication or permission error if access is missing.",
  "Never invent tool calls, repository contents, connection state, messages, counts, memberships, or success. Show evidence from actual tool results or the server-side preflight.",
].join(" ");

export const GITHUB_EVIDENCE_HEADER = [
  "GITHUB_PREFLIGHT_EVIDENCE follows.",
  "This JSON was fetched by NOVA server-side from the GitHub REST API for repository URL(s) in the user's current message before this turn.",
  "Use it as primary observed evidence. Do not say you cannot access the repository when this evidence contains repository metadata, tree entries, commits, or file contents.",
  "State any limitations precisely, such as a truncated tree, unavailable private repository, rate limit, or a file that was not fetched.",
].join(" ");

export const CONNECTED_APP_EVIDENCE_HEADER = [
  "CONNECTED_APP_PREFLIGHT_EVIDENCE follows.",
  "This JSON was produced by NOVA server-side while attempting to establish a real Composio Tool Router session and search for tools for the user's exact current request.",
  "Read the observed field literally: observed=true means the real Tool Router search completed and toolSearch contains discovery evidence; observed=false means preflight failed and the included error/status/details are the observed evidence.",
  "Discovery is not completion. When observed=true, you MUST use nova-services composio-execute with the relevant returned tool slug or slugs and inspect the real execution result before answering the user.",
  "For read requests such as new messages, team memberships, groups, channels, unread items, or counts, execute the necessary read-only tools and compute the answer only from observed results.",
  "If execution reports a disconnected account, use nova-services composio-connect with a toolkit slug supported by the discovery evidence and return the real Connect Link.",
  "Do not answer with generic manual instructions or say you cannot directly access the app unless the preflight evidence or a subsequent real execution contains a concrete failure.",
].join(" ");

export function connectedAppIntentForText(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return null;
  for (const rule of CONNECTED_APP_RULES) {
    if (rule.pattern.test(normalized)) return rule.intent;
  }
  return null;
}
