// tool-catalog.mjs — Universal Agent Tool Catalog
//
// 80+ tools across runtime, fs, web, browser, agents, sessions, memory,
// automation, messaging, productivity, git, devops, media, mcp, llm, api.
// Source families: openclaw · openclaw_alias · openclaw_plugin · autogpt · mcp · universal
//
// This file is pure data — no side-effects, no credentials, no I/O.
// Implementations live in super-nova-tools.mjs.

function s(description, def) {
  const p = { type: "string", description };
  if (def !== undefined) p.default = def;
  return p;
}
function b(description, def) {
  const p = { type: "boolean", description };
  if (def !== undefined) p.default = def;
  return p;
}
function n(description, def) {
  const p = { type: "integer", description };
  if (def !== undefined) p.default = def;
  return p;
}
function arr(description, itemSchema) {
  return { type: "array", description, items: itemSchema };
}
function obj(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}
function t(name, category, risk, sourceFamily, description, inputSchema, opts = {}) {
  return {
    name, category, risk, sourceFamily, description, inputSchema,
    requiresAuth: false, requiresApproval: false, enabledByDefault: false,
    ...opts,
  };
}

export const TOOL_DEFS = [
  // ── Runtime / Code / Shell ─────────────────────────────────────────────────
  t("exec",                "runtime",      "high",        "openclaw",
    "Run a bounded shell command in the sandbox.",
    obj({ command: s("Shell command."), timeout_sec: n("Timeout.", 30) }, ["command"]),
    { requiresApproval: true }),
  t("bash",                "runtime",      "high",        "openclaw_alias",
    "Alias for exec.",
    obj({ command: s("Shell command."), timeout_sec: n("Timeout.", 30) }, ["command"]),
    { requiresApproval: true }),
  t("process",             "runtime",      "high",        "openclaw",
    "Start, inspect, or kill a long-running background process.",
    obj({ action: { type: "string", enum: ["start","status","kill"] }, command: s("Command when action=start."), process_id: s("Process id for status/kill.") }, ["action"]),
    { requiresApproval: true }),
  t("code_execution",      "runtime",      "high",        "openclaw",
    "Execute code in a controlled runtime (python, javascript, typescript, bash).",
    obj({ language: { type: "string", enum: ["python","javascript","typescript","bash"] }, code: s("Code to execute."), timeout_sec: n("Timeout.", 30) }, ["language","code"]),
    { requiresApproval: true }),
  t("execute_shell",       "runtime",      "high",        "autogpt",
    "AutoGPT-style shell command execution.",
    obj({ command: s("Shell command."), timeout_sec: n("Timeout.", 30) }, ["command"]),
    { requiresApproval: true }),
  t("execute_shell_popen", "runtime",      "high",        "autogpt",
    "AutoGPT-style popen shell execution.",
    obj({ command: s("Shell command."), timeout_sec: n("Timeout.", 30) }, ["command"]),
    { requiresApproval: true }),
  t("execute_python_code", "runtime",      "high",        "autogpt",
    "Execute Python code in a bounded sandbox.",
    obj({ code: s("Python code."), timeout_sec: n("Timeout.", 30) }, ["code"]),
    { requiresApproval: true }),
  t("execute_python_file", "runtime",      "high",        "autogpt",
    "Execute a Python file in the sandbox.",
    obj({ path: s("Sandbox-relative path."), args: arr("CLI args.", { type: "string" }), timeout_sec: n("Timeout.", 30) }, ["path"]),
    { requiresApproval: true }),
  t("calculator",          "runtime",      "low",         "universal",
    "Evaluate a safe arithmetic expression. No code execution.",
    obj({ expression: s("Arithmetic expression (numbers, +−×÷, parens, %, ^).") }, ["expression"]),
    { enabledByDefault: true }),

  // ── Filesystem ────────────────────────────────────────────────────────────
  t("read",                "fs",           "low",         "openclaw",
    "Read a file from the sandbox.",
    obj({ path: s("Sandbox-relative path.") }, ["path"]),
    { enabledByDefault: true }),
  t("write",               "fs",           "medium",      "openclaw",
    "Write a file to the sandbox.",
    obj({ path: s("Sandbox-relative path."), content: s("File content."), overwrite: b("Allow overwrite.", false) }, ["path","content"]),
    { requiresApproval: true }),
  t("edit",                "fs",           "medium",      "openclaw",
    "Replace an exact substring in a sandbox file.",
    obj({ path: s("Sandbox-relative path."), old_text: s("Exact text to replace."), new_text: s("Replacement text.") }, ["path","old_text","new_text"]),
    { requiresApproval: true }),
  t("apply_patch",         "fs",           "medium",      "openclaw",
    "Apply a unified diff patch to sandbox files.",
    obj({ patch: s("Unified diff patch.") }, ["patch"]),
    { requiresApproval: true }),
  t("read_file",           "fs",           "low",         "autogpt",
    "AutoGPT-style: read a sandbox file.",
    obj({ path: s("Sandbox-relative path.") }, ["path"]),
    { enabledByDefault: true }),
  t("write_file",          "fs",           "medium",      "autogpt",
    "AutoGPT-style: write a sandbox file.",
    obj({ path: s("Sandbox-relative path."), content: s("File content."), overwrite: b("Allow overwrite.", false) }, ["path","content"]),
    { requiresApproval: true }),
  t("list_folder",         "fs",           "low",         "autogpt",
    "List files in a sandbox folder.",
    obj({ path: s("Sandbox-relative folder.", ".") }),
    { enabledByDefault: true }),
  t("list_directory",      "fs",           "low",         "universal",
    "List files and directories in the sandbox.",
    obj({ path: s("Sandbox-relative folder.", ".") }),
    { enabledByDefault: true }),
  t("search_files",        "fs",           "low",         "universal",
    "Find sandbox files by glob pattern.",
    obj({ pattern: s("Glob pattern, e.g. **/*.py."), path: s("Root folder.", ".") }, ["pattern"]),
    { enabledByDefault: true }),
  t("grep_files",          "fs",           "low",         "universal",
    "Search sandbox file contents by regex.",
    obj({ pattern: s("Regex pattern."), path: s("Root folder.", "."), glob: s("Glob filter.", "**/*"), max_matches: n("Max matches.", 100) }, ["pattern"]),
    { enabledByDefault: true }),
  t("file_exists",         "fs",           "low",         "universal",
    "Check whether a sandbox path exists.",
    obj({ path: s("Sandbox-relative path.") }, ["path"]),
    { enabledByDefault: true }),
  t("make_directory",      "fs",           "medium",      "universal",
    "Create a sandbox directory.",
    obj({ path: s("Sandbox-relative path.") }, ["path"]),
    { requiresApproval: true }),
  t("delete_path",         "fs",           "destructive", "universal",
    "Delete a sandbox file or empty directory.",
    obj({ path: s("Sandbox-relative path.") }, ["path"]),
    { requiresApproval: true }),

  // ── Context ───────────────────────────────────────────────────────────────
  t("open_file",           "context",      "low",         "autogpt",
    "Open a sandbox file into agent context.",
    obj({ path: s("Sandbox-relative path.") }, ["path"]),
    { enabledByDefault: true }),
  t("open_folder",         "context",      "low",         "autogpt",
    "Open a folder listing into agent context.",
    obj({ path: s("Sandbox-relative folder.") }, ["path"]),
    { enabledByDefault: true }),
  t("close_context_item",  "context",      "low",         "autogpt",
    "Remove a context item by key.",
    obj({ key: s("Context item key.") }, ["key"]),
    { enabledByDefault: true }),
  t("diff_render",         "fs",           "low",         "openclaw_plugin",
    "Render a before/after text diff for review.",
    obj({ before: s("Original content."), after: s("New content.") }, ["before","after"]),
    { enabledByDefault: true }),

  // ── Web / Fetch ───────────────────────────────────────────────────────────
  t("web_search",          "web",          "medium",      "openclaw",
    "Search the web via Firecrawl/Brave. Returns ranked results with title, url, snippet.",
    obj({ query: s("Search query."), max_results: n("Max results.", 5) }, ["query"]),
    { requiresAuth: true }),
  t("x_search",            "web",          "medium",      "openclaw",
    "Search X/Twitter posts via configured provider.",
    obj({ query: s("Search query."), max_results: n("Max results.", 5) }, ["query"]),
    { requiresAuth: true }),
  t("web_fetch",           "web",          "medium",      "openclaw",
    "Fetch readable page content from a URL (SSRF-guarded).",
    obj({ url: s("URL to fetch."), max_chars: n("Max chars.", 20000) }, ["url"])),
  t("search_web",          "web",          "medium",      "autogpt",
    "AutoGPT-style DuckDuckGo web search.",
    obj({ query: s("Search query."), max_results: n("Max results.", 5) }, ["query"])),
  t("google",              "web",          "medium",      "autogpt",
    "Google Custom Search.",
    obj({ query: s("Search query."), max_results: n("Max results.", 5) }, ["query"]),
    { requiresAuth: true }),
  t("read_website",        "web",          "medium",      "autogpt",
    "Read a webpage and extract an answer to a question.",
    obj({ url: s("URL to read."), question: s("Focus question.") }, ["url"])),

  // ── OpenAI cloud tools ───────────────────────────────────────────────────
  t("openai_retrieval",    "search",       "medium",      "openclaw",
    "Semantic search over an OpenAI vector store. Requires OPENAI_VECTOR_STORE_ID env var.",
    obj({ query: s("Search query."), max_results: n("Max results (1-20).", 5), vector_store_id: s("Override OPENAI_VECTOR_STORE_ID."), score_threshold: n("Min relevance score (0-1)."), rewrite_query: { type: "boolean", description: "Let OpenAI rewrite the query for retrieval (default true)." }, attribute_filter: { type: "object", description: "Optional attribute filter object." } }, ["query"]),
    { enabledByDefault: true }),
  t("openai_code_interpreter", "code",    "medium",      "openclaw",
    "Run Python code in OpenAI's sandboxed container via the Responses API. No SUPER_NOVA_EXEC needed.",
    obj({ code: s("Python code to execute."), max_tokens: n("Max output tokens.", 4096) }, ["code"]),
    { enabledByDefault: true }),
  t("openai_hosted_shell", "code",        "medium",      "openclaw",
    "Run a shell command in OpenAI's managed Debian container. Sandboxed, ephemeral, no SUPER_NOVA_EXEC needed.",
    obj({ command: s("Shell command to execute."), max_tokens: n("Max output tokens.", 4096) }, ["command"]),
    { enabledByDefault: true }),

  // ── Browser ───────────────────────────────────────────────────────────────
  t("browser",             "browser",      "high",        "openclaw",
    "Operate a browser session: open, click, type, screenshot, evaluate, close.",
    obj({ action: { type: "string", enum: ["open","click","type","screenshot","evaluate","close"] }, url: s("URL for open."), selector: s("CSS selector for click/type."), text: s("Text to type."), script: s("JS for evaluate.") }, ["action"]),
    { requiresApproval: true }),
  t("playwright_open",     "browser",      "high",        "universal",
    "Open a URL using Playwright.",
    obj({ url: s("URL.") }, ["url"]),
    { requiresApproval: true }),
  t("playwright_click",    "browser",      "high",        "universal",
    "Click a CSS selector using Playwright.",
    obj({ selector: s("CSS selector.") }, ["selector"]),
    { requiresApproval: true }),
  t("playwright_screenshot","browser",     "medium",      "universal",
    "Capture a browser screenshot.",
    obj({ path: s("Output file path.") }, ["path"])),

  // ── Control / Agents ──────────────────────────────────────────────────────
  t("finish",              "control",      "low",         "autogpt",
    "Finish the current task with a final answer.",
    obj({ answer: s("Final answer or result.") }, ["answer"]),
    { enabledByDefault: true }),
  t("ask_user",            "control",      "low",         "autogpt",
    "Ask the user a question and pause for input.",
    obj({ question: s("Question to ask."), options: arr("Optional choices.", { type: "string" }) }, ["question"]),
    { enabledByDefault: true }),
  t("update_plan",         "agents",       "low",         "openclaw",
    "Update the visible task plan/checklist.",
    obj({ steps: arr("Plan steps.", obj({ step: s("Step label."), status: { type: "string", enum: ["pending","in_progress","completed"] } }, ["step","status"])) }, ["steps"]),
    { enabledByDefault: true }),
  t("goal",                "agents",       "low",         "openclaw",
    "Set or get the current agent goal.",
    obj({ action: { type: "string", enum: ["set","get"] }, goal: s("New goal when action=set.") }, ["action"]),
    { enabledByDefault: true }),
  t("steer",               "agents",       "low",         "openclaw",
    "Steer an ongoing run with additional instructions.",
    obj({ instruction: s("Steering instruction.") }, ["instruction"]),
    { enabledByDefault: true }),
  t("agents_list",         "agents",       "low",         "openclaw",
    "List configured agents.",
    obj({}),
    { enabledByDefault: true }),
  t("agent_send",          "agents",       "medium",      "openclaw",
    "Send a task or message to another agent.",
    obj({ agent_id: s("Target agent id."), message: s("Task or message.") }, ["agent_id","message"])),
  t("subagents",           "agents",       "medium",      "openclaw",
    "Spawn, list, or cancel sub-agents.",
    obj({ action: { type: "string", enum: ["spawn","list","cancel"] }, task: s("Task for new subagent."), agent_id: s("Target agent id.") }, ["action"])),

  // ── Sessions ──────────────────────────────────────────────────────────────
  t("sessions_list",       "sessions",     "low",         "openclaw",
    "List visible agent sessions.",
    obj({}),
    { enabledByDefault: true }),
  t("sessions_history",    "sessions",     "medium",      "openclaw",
    "Read a session's message history.",
    obj({ session_id: s("Session id."), limit: n("Max messages.", 50) }, ["session_id"])),
  t("sessions_send",       "sessions",     "medium",      "openclaw",
    "Send a message to a session.",
    obj({ session_id: s("Session id."), message: s("Message.") }, ["session_id","message"])),
  t("sessions_spawn",      "sessions",     "medium",      "openclaw",
    "Spawn a child session / subagent.",
    obj({ prompt: s("Task prompt."), agent_id: s("Optional agent id.") }, ["prompt"])),
  t("sessions_yield",      "sessions",     "low",         "openclaw",
    "Yield control back to the parent or session controller.",
    obj({ message: s("Yield message.") }),
    { enabledByDefault: true }),
  t("session_status",      "sessions",     "low",         "openclaw",
    "Get current session status.",
    obj({}),
    { enabledByDefault: true }),

  // ── Memory / Database ─────────────────────────────────────────────────────
  t("memory_search",       "memory",       "low",         "openclaw",
    "Full-text search of durable memory store.",
    obj({ query: s("Search query."), limit: n("Max results.", 5) }, ["query"]),
    { enabledByDefault: true }),
  t("memory_get",          "memory",       "low",         "openclaw",
    "Get one memory item by key.",
    obj({ key: s("Memory key.") }, ["key"]),
    { enabledByDefault: true }),
  t("memory_put",          "memory",       "medium",      "universal",
    "Save a memory item by key.",
    obj({ key: s("Memory key."), value: { description: "JSON-serializable value." } }, ["key","value"]),
    { requiresApproval: true }),
  t("vector_search",       "memory",       "medium",      "universal",
    "Semantic search against a vector store.",
    obj({ query: s("Search query."), collection: s("Collection name."), limit: n("Max results.", 5) }, ["query","collection"]),
    { requiresAuth: true }),
  t("database_query",      "database",     "high",        "universal",
    "Execute a read-only database query.",
    obj({ connection: s("Connection/profile id."), query: s("SQL or query expression."), read_only: b("Must stay read-only.", true) }, ["connection","query"]),
    { requiresAuth: true, requiresApproval: true }),

  // ── Automation / Gateway / Nodes ──────────────────────────────────────────
  t("cron",                "automation",   "medium",      "openclaw",
    "Create, list, update, or delete scheduled jobs.",
    obj({ action: { type: "string", enum: ["create","list","update","delete"] }, job_id: s("Job id for update/delete."), schedule: s("Cron/iCal schedule."), prompt: s("Task prompt.") }, ["action"]),
    { requiresApproval: true }),
  t("heartbeat_respond",   "automation",   "low",         "openclaw",
    "Respond to a heartbeat / background task ping.",
    obj({ status: s("Heartbeat status.") }, ["status"]),
    { enabledByDefault: true }),
  t("gateway",             "gateway",      "high",        "openclaw",
    "Inspect or operate the local gateway (status, config, restart, logs).",
    obj({ action: { type: "string", enum: ["status","config","restart","logs"] } }, ["action"]),
    { requiresApproval: true }),
  t("nodes",               "nodes",        "high",        "openclaw",
    "Inspect or control paired devices/nodes.",
    obj({ action: { type: "string", enum: ["list","status","send","command"] }, node_id: s("Node id."), payload: { description: "Node-specific payload." } }, ["action"]),
    { requiresApproval: true }),

  // ── Messaging / Productivity ──────────────────────────────────────────────
  t("message",             "messaging",    "medium",      "openclaw",
    "Send a message through an active channel.",
    obj({ channel: s("Channel id/name."), to: s("Recipient/target."), text: s("Message body.") }, ["channel","to","text"]),
    { requiresAuth: true, requiresApproval: true }),
  t("send_email",          "productivity", "high",        "universal",
    "Send an email.",
    obj({ to: arr("Recipients.", { type: "string" }), subject: s("Subject."), body: s("Body."), cc: arr("CC.", { type: "string" }) }, ["to","subject","body"]),
    { requiresAuth: true, requiresApproval: true }),
  t("draft_email",         "productivity", "medium",      "universal",
    "Create an email draft.",
    obj({ to: arr("Recipients.", { type: "string" }), subject: s("Subject."), body: s("Body.") }, ["to","subject","body"]),
    { requiresAuth: true }),
  t("calendar_create_event","productivity","high",        "universal",
    "Create a calendar event.",
    obj({ title: s("Event title."), start: s("ISO start datetime."), end: s("ISO end datetime."), attendees: arr("Attendee emails.", { type: "string" }), location: s("Location.") }, ["title","start","end"]),
    { requiresAuth: true, requiresApproval: true }),
  t("slack_send_message",  "productivity", "medium",      "universal",
    "Send a Slack message.",
    obj({ channel: s("Slack channel/user id."), text: s("Message text.") }, ["channel","text"]),
    { requiresAuth: true, requiresApproval: true }),

  // ── Git / DevOps ──────────────────────────────────────────────────────────
  t("clone_repository",    "git",          "medium",      "autogpt",
    "Clone a git repository into the sandbox.",
    obj({ url: s("Repository URL."), directory: s("Target directory.") }, ["url"]),
    { requiresApproval: true }),
  t("git_status",          "git",          "low",         "universal",
    "Run git status --short in the workspace.",
    obj({ path: s("Repo path.", ".") }),
    { enabledByDefault: true }),
  t("git_diff",            "git",          "low",         "universal",
    "Run git diff --stat HEAD in the workspace.",
    obj({ path: s("Repo path.", ".") }),
    { enabledByDefault: true }),
  t("git_commit",          "git",          "medium",      "universal",
    "Stage all changes and commit in the workspace.",
    obj({ path: s("Repo path.", "."), message: s("Commit message.") }, ["message"]),
    { requiresApproval: true }),
  t("github_create_issue", "devops",       "medium",      "universal",
    "Create a GitHub issue via API.",
    obj({ repo: s("owner/repo."), title: s("Issue title."), body: s("Issue body.") }, ["repo","title","body"]),
    { requiresAuth: true, requiresApproval: true }),
  t("github_create_pr",    "devops",       "high",        "universal",
    "Create a GitHub pull request via API.",
    obj({ repo: s("owner/repo."), title: s("PR title."), body: s("PR body."), head: s("Head branch."), base: s("Base branch.") }, ["repo","title","head","base"]),
    { requiresAuth: true, requiresApproval: true }),
  t("run_tests",           "devops",       "medium",      "universal",
    "Run a test command in the sandbox.",
    obj({ command: s("Test command."), timeout_sec: n("Timeout (s).", 120) }, ["command"]),
    { requiresApproval: true }),
  t("run_build",           "devops",       "medium",      "universal",
    "Run a build command in the sandbox.",
    obj({ command: s("Build command."), timeout_sec: n("Timeout (s).", 300) }, ["command"]),
    { requiresApproval: true }),
  t("deploy_service",      "devops",       "high",        "universal",
    "Deploy a service via configured provider.",
    obj({ provider: s("Provider name/profile."), service: s("Service name."), environment: s("Environment.") }, ["provider","service","environment"]),
    { requiresAuth: true, requiresApproval: true }),

  // ── Media / Canvas ────────────────────────────────────────────────────────
  t("canvas",              "ui",           "medium",      "openclaw",
    "Render or update an agent-controlled canvas.",
    obj({ action: { type: "string", enum: ["render","update","clear"] }, payload: { description: "Canvas payload." } }, ["action"])),
  t("image",               "media",        "medium",      "openclaw",
    "Analyze an image.",
    obj({ path: s("Image path or reference."), prompt: s("Analysis prompt.") }, ["path"])),
  t("image_generate",      "media",        "medium",      "openclaw",
    "Generate an image from a text prompt.",
    obj({ prompt: s("Image prompt."), size: s("Image size.", "1024x1024") }, ["prompt"]),
    { requiresAuth: true }),
  t("generate_image",      "media",        "medium",      "autogpt",
    "AutoGPT-style image generation.",
    obj({ prompt: s("Image prompt.") }, ["prompt"]),
    { requiresAuth: true }),
  t("music_generate",      "media",        "medium",      "openclaw",
    "Generate music/audio from prompt.",
    obj({ prompt: s("Music prompt."), duration_sec: n("Duration (s).", 30) }, ["prompt"]),
    { requiresAuth: true }),
  t("video_generate",      "media",        "medium",      "openclaw",
    "Generate video from prompt.",
    obj({ prompt: s("Video prompt."), duration_sec: n("Duration (s).", 5) }, ["prompt"]),
    { requiresAuth: true }),
  t("tts",                 "media",        "medium",      "openclaw",
    "Text-to-speech synthesis.",
    obj({ text: s("Text to speak."), voice: s("Voice id/profile.") }, ["text"]),
    { requiresAuth: true }),

  // ── Tool Catalog / MCP / LLM / API ───────────────────────────────────────
  t("tool_search",         "tool_catalog", "low",         "openclaw",
    "Search the tool catalog by query and/or category.",
    obj({ query: s("Search query."), category: s("Optional category filter.") }, ["query"]),
    { enabledByDefault: true }),
  t("tool_search_code",    "tool_catalog", "low",         "openclaw",
    "Search tool catalog and return code-style signatures.",
    obj({ query: s("Search query."), language: { type: "string", enum: ["javascript","typescript","json"] } }, ["query"]),
    { enabledByDefault: true }),
  t("tool_describe",       "tool_catalog", "low",         "openclaw",
    "Describe one tool by name (full schema, flags, source).",
    obj({ name: s("Tool name.") }, ["name"]),
    { enabledByDefault: true }),
  t("mcp_list_servers",    "mcp",          "low",         "mcp",
    "List configured MCP servers.",
    obj({}),
    { enabledByDefault: true }),
  t("mcp_list_tools",      "mcp",          "low",         "mcp",
    "List tools exposed by MCP servers.",
    obj({ server: s("Optional MCP server id.") }),
    { enabledByDefault: true }),
  t("mcp_call_tool",       "mcp",          "high",        "mcp",
    "Call a tool exposed by an MCP server.",
    obj({ server: s("MCP server id."), tool: s("Tool name."), arguments: { description: "Arguments object." } }, ["server","tool","arguments"]),
    { requiresApproval: true }),
  t("llm_task",            "llm",          "medium",      "openclaw_plugin",
    "Run a structured JSON-only LLM sub-task.",
    obj({ prompt: s("Task prompt."), schema: { description: "Expected JSON schema." } }, ["prompt"]),
    { requiresAuth: true }),
  t("structured_extract",  "llm",          "medium",      "universal",
    "Extract structured data from text using an LLM.",
    obj({ text: s("Input text."), schema: { description: "Extraction schema." } }, ["text","schema"]),
    { requiresAuth: true }),
  t("http_request",        "api",          "high",        "universal",
    "Make an HTTP request to an external API (SSRF-guarded).",
    obj({ method: { type: "string", enum: ["GET","POST","PUT","PATCH","DELETE"] }, url: s("Request URL."), headers: { description: "Headers object." }, body: { description: "Request body." } }, ["method","url"]),
    { requiresApproval: true }),
];

// ── OpenAI native function calling format ─────────────────────────────────────

// Convert one TOOL_DEF to OpenAI Chat Completions / Responses API function tool
// shape.  The inputSchema produced by obj() already carries additionalProperties:false
// and a required array, so it is a valid JSON Schema for the parameters field.
export function toOpenAIFunctionTool(td) {
  return {
    type: "function",
    name: td.name,
    description: td.description,
    parameters: td.inputSchema,
  };
}

// Safe subset of the catalog exported as OpenAI function schemas.
// Excludes:  requiresApproval (code/shell/file ops that need SUPER_NOVA_EXEC=1)
//            destructive risk level (delete ops)
// Callers should further filter by which tool names are wired in their runtime
// (e.g. keep only names present in their TOOL_RISK map).
export const OPENAI_FUNCTION_TOOLS = TOOL_DEFS
  .filter(td => !td.requiresApproval && td.risk !== "destructive")
  .map(toOpenAIFunctionTool);

// ── Lookup helpers ────────────────────────────────────────────────────────────

const CATALOG_MAP = new Map(TOOL_DEFS.map((td) => [td.name, td]));

export function catalogSearch(query, category) {
  const q = String(query || "").toLowerCase();
  const cat = category ? String(category).toLowerCase() : null;
  return TOOL_DEFS.filter((td) => {
    const hay = `${td.name} ${td.category} ${td.description} ${td.sourceFamily}`.toLowerCase();
    return hay.includes(q) && (!cat || td.category === cat);
  });
}

export function catalogDescribe(name) {
  return CATALOG_MAP.get(String(name || "")) || null;
}

// ── Text for LLM context ─────────────────────────────────────────────────────

export function catalogText(activeNames = new Set()) {
  const byCat = new Map();
  for (const td of TOOL_DEFS) {
    if (!byCat.has(td.category)) byCat.set(td.category, []);
    byCat.get(td.category).push(td);
  }
  const sections = [];
  for (const [cat, tools] of byCat) {
    const lines = tools.map((td) => {
      const active = activeNames.has(td.name);
      const flags = [
        active ? "ACTIVE" : "catalog-only",
        td.risk,
        td.requiresApproval ? "needs-approval" : null,
        td.requiresAuth ? "needs-auth" : null,
      ].filter(Boolean).join(", ");
      return `  ${td.name} [${flags}] — ${td.description}`;
    });
    sections.push(`## ${cat}\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}
