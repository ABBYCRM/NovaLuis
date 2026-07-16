#!/usr/bin/env python3
"""
OpenClaw agentic-runtime scenario generator.

Generates a CSV of 500 unique (trigger, condition, if_action, else_action)
scenarios grounded in real OpenClaw skills.

OpenClaw is a self-hosted AI agent gateway. Skills are markdown instruction
files (SKILL.md) that teach the agent how to combine tools. They ship from
three sources: bundled, ClawHub community, and workspace-local. Each skill
lives in a directory containing a SKILL.md with YAML frontmatter and a
markdown body.

Output columns: id, category, skill, trigger, condition, if_action,
                else_action, severity, source_doc

Sources (verified):
  - docs.openclaw.ai/tools/skills
  - docs.openclaw.ai/tools
  - docs.openclaw.ai/agent-runtime-architecture
  - openclaw.ai (product site, Skill Card + SkillSpector)
  - clawhub.ai (registry, 5,798+ skills)
  - getopenclaw.ai/docs/skills
  - ramnode.com/guides/series/openclaw/skills-automation
  - yu-wenhao.com (26 tools + 53 skills tutorial)
  - devops-united.com (top 20 skills 2026)
  - openclawconsult.com (built-in skills reference)
  - VoltAgent/awesome-openclaw-skills
  - sundial-org/awesome-openclaw-skills
"""
import csv
import os
import random
from typing import List, Dict

OUT_PATH = "/workspace/render_scenarios/openclaw_scenarios.csv"
TARGET_ROWS = 500
random.seed(20260715)

# ---------------------------------------------------------------------------
# Triggers — one entry per real OpenClaw skill use case
# Each: (category, skill, trigger_text)
# ---------------------------------------------------------------------------
TRIGGERS: List[tuple] = [
    # ---------- CORE / BUILT-IN ----------
    ("T-CORE", "core_shell", "Agent invokes the shell skill to run a command"),
    ("T-CORE", "core_shell", "Agent runs a long-running shell command via nohup / &"),
    ("T-CORE", "core_shell", "Agent pipes shell output into another skill (jq, grep, awk)"),
    ("T-CORE", "core_filesystem", "Agent reads a file with the filesystem skill"),
    ("T-CORE", "core_filesystem", "Agent writes / appends to a file with the filesystem skill"),
    ("T-CORE", "core_filesystem", "Agent lists a directory tree (recursive ls)"),
    ("T-CORE", "core_filesystem", "Agent searches file contents with grep / ripgrep"),
    ("T-CORE", "core_http", "Agent makes an HTTP/HTTPS request via the http skill"),
    ("T-CORE", "core_http", "Agent hits a 4xx / 5xx response on http call"),
    ("T-CORE", "core_websearch", "Agent invokes web_search skill (Brave / Serper / SerpAPI)"),
    ("T-CORE", "core_websearch", "Agent searches and asks for citations"),
    ("T-CORE", "core_memory", "Agent writes a fact to the memory skill (markdown file)"),
    ("T-CORE", "core_memory", "Agent retrieves a memory from the memory skill"),
    ("T-CORE", "core_datetime", "Agent reads the current datetime / timezone"),
    ("T-CORE", "core_datetime", "Agent computes a relative date (3 business days from now)"),

    # ---------- PRODUCTIVITY / GOOGLE ----------
    ("T-PROD", "gmail", "Agent invokes gmail skill to read inbox"),
    ("T-PROD", "gmail", "Agent invokes gmail skill to send a message"),
    ("T-PROD", "gmail", "Agent invokes gmail skill to label / archive / delete"),
    ("T-PROD", "gmail", "Gmail Pub/Sub push notification fires (real-time inbox)"),
    ("T-PROD", "google_calendar", "Agent reads today's events from google_calendar"),
    ("T-PROD", "google_calendar", "Agent creates a calendar event with attendees"),
    ("T-PROD", "google_calendar", "Agent updates / deletes a calendar event"),
    ("T-PROD", "google_calendar", "Calendar free/busy check (no overlap)"),
    ("T-PROD", "gog", "Agent uses the gog (Google Workspace) skill for Gmail + Calendar + Drive"),
    ("T-PROD", "gog", "Agent reads a Google Doc via gog and summarizes it"),
    ("T-PROD", "gog", "Agent writes a Google Sheet row via gog"),
    ("T-PROD", "gog", "Agent uploads a file to Google Drive via gog"),
    ("T-PROD", "google_workspace", "Agent uses google_workspace skill (no Cloud Console, OAuth-only)"),
    ("T-PROD", "outlook", "Agent reads Outlook inbox via Microsoft Graph"),
    ("T-PROD", "outlook", "Agent sends an Outlook email with attachment"),
    ("T-PROD", "apple_calendar", "Agent reads Apple Calendar on macOS (apple-calendar skill)"),
    ("T-PROD", "apple_calendar", "Agent creates an Apple Calendar event"),
    ("T-PROD", "apple_reminders", "Agent adds an Apple Reminder"),
    ("T-PROD", "apple_notes", "Agent reads / writes Apple Notes via apple-notes skill"),
    ("T-PROD", "apple_mail", "Agent searches Apple Mail inbox"),
    ("T-PROD", "acuity_scheduling", "Agent books an Acuity appointment for a user"),

    # ---------- NOTES / PKM ----------
    ("T-NOTES", "notion", "Agent reads a Notion page via the notion skill"),
    ("T-NOTES", "notion", "Agent writes to a Notion page (append block)"),
    ("T-NOTES", "notion", "Agent queries a Notion database with filter"),
    ("T-NOTES", "notion", "Agent creates a Notion page in a database"),
    ("T-NOTES", "better_notion", "Agent uses better-notion for full CRUD on Notion pages, databases, blocks"),
    ("T-NOTES", "obsidian", "Agent reads from an Obsidian vault (markdown file)"),
    ("T-NOTES", "obsidian", "Agent writes to an Obsidian vault"),
    ("T-NOTES", "obsidian", "Agent uses Bases / JSON Canvas / CLI for Obsidian"),
    ("T-NOTES", "bear_notes", "Agent reads / writes Bear notes (macOS)"),

    # ---------- MESSAGING / SOCIAL ----------
    ("T-MSG", "slack", "Agent posts a message to a Slack channel"),
    ("T-MSG", "slack", "Agent reacts to / pins / unpins a Slack message"),
    ("T-MSG", "slack", "Agent DMs a user via Slack"),
    ("T-MSG", "slack", "Agent reads Slack channel history"),
    ("T-MSG", "discord", "Agent posts a message via Discord webhook"),
    ("T-MSG", "discord", "Agent reacts to a Discord message"),
    ("T-MSG", "telegram", "Agent sends a Telegram message"),
    ("T-MSG", "telegram", "Agent receives a Telegram update via webhook"),
    ("T-MSG", "telegram", "Agent uses Telegram Advanced skill (custom keyboards, inline)"),
    ("T-MSG", "whatsapp", "Agent uses wacli skill to send WhatsApp message"),
    ("T-MSG", "whatsapp", "Agent reads WhatsApp history via wacli"),
    ("T-MSG", "imessage", "Agent uses imsg skill to send iMessage"),
    ("T-MSG", "twitter_x", "Agent posts a tweet / reply via bird (X/Twitter) skill"),
    ("T-MSG", "twitter_x", "Agent likes / follows via bird"),
    ("T-MSG", "agentdo", "Agent posts a task to agentdo (agent-to-agent task queue)"),
    ("T-MSG", "agentdo", "Agent picks up a task from the agentdo queue"),

    # ---------- DEVELOPMENT / GITHUB ----------
    ("T-DEV", "github", "Agent reads a GitHub repo (file, issues, PRs)"),
    ("T-DEV", "github", "Agent creates an issue via GitHub skill"),
    ("T-DEV", "github", "Agent opens a PR via GitHub skill"),
    ("T-DEV", "github", "Agent reviews code via GitHub skill (PR review)"),
    ("T-DEV", "github", "Agent runs a workflow_dispatch via GitHub skill"),
    ("T-DEV", "github", "GitHub CI build fails -> agent receives webhook"),
    ("T-DEV", "github_cli", "Agent uses the gh CLI skill (gh issue / gh pr / gh run / gh api)"),
    ("T-DEV", "git", "Agent runs git commands (commit, push, branch)"),
    ("T-DEV", "code_runner", "Agent runs Python / Node code via the code-runner skill"),
    ("T-DEV", "code_runner", "Agent executes a shell script via the code-runner skill"),
    ("T-DEV", "claude_code", "Agent delegates a coding task to Claude Code (via the OpenClaw skill)"),
    ("T-DEV", "autoreview", "Agent runs the autoreview skill (review closeout workflow)"),
    ("T-DEV", "crabbox", "Agent runs the crabbox/Testbox remote-validation workflow"),
    ("T-DEV", "session_viewer", "Agent opens the session_viewer (searchable HTML for JSONL)"),
    ("T-DEV", "handoff", "Agent uses the handoff skill to delegate a task to another agent"),

    # ---------- RESEARCH / WEB ----------
    ("T-RES", "browser", "Agent invokes the browser skill (headless Chromium)"),
    ("T-RES", "browser", "Agent navigates a URL and extracts text"),
    ("T-RES", "browser", "Agent fills a form via browser skill"),
    ("T-RES", "browser", "Agent takes a screenshot via browser skill"),
    ("T-RES", "browser", "Browser skill times out (>30s)"),
    ("T-RES", "web_search", "Agent uses web_search skill (Brave) to look up info"),
    ("T-RES", "web_search", "Agent uses web_search skill (Serper) to look up info"),
    ("T-RES", "web_search", "Agent uses web_search skill (SerpAPI) to look up info"),
    ("T-RES", "prismfy_web_search", "Agent uses prismfy_web_search (10 engines, free tier)"),
    ("T-RES", "tavily", "Agent uses Tavily deep research skill"),
    ("T-RES", "arxiv_watcher", "Agent uses arxiv_watcher to search and summarize papers"),
    ("T-RES", "pubmed_edirect", "Agent queries PubMed via pubmed-edirect skill"),
    ("T-RES", "wikipedia", "Agent searches / retrieves / summarizes Wikipedia"),
    ("T-RES", "newsapi_search", "Agent queries NewsAPI for trends"),
    ("T-RES", "exa_web_search", "Agent uses Exa web search (free)"),
    ("T-RES", "web_scraper_as_a_service", "Agent builds a client-ready web scraper"),
    ("T-RES", "brightdata", "Agent uses Bright Data for web scraping / search"),
    ("T-RES", "rss_reader", "Agent uses rss_reader to monitor feeds for keywords"),
    ("T-RES", "ak_rss_24h_brief", "Agent generates a 24h RSS brief in Chinese (categorized)"),
    ("T-RES", "academic_deep_research", "Agent runs academic_deep_research (transparent, rigorous)"),
    ("T-RES", "serper_search", "Agent uses serper_search for Google SERP data"),

    # ---------- DEVOPS / SYSTEM ----------
    ("T-OPS", "docker_control", "Agent lists Docker containers via docker_control skill"),
    ("T-OPS", "docker_control", "Agent restarts a container via docker_control skill"),
    ("T-OPS", "docker_control", "Agent reads logs from a container"),
    ("T-OPS", "docker_control", "Agent runs a command inside a container (docker exec)"),
    ("T-OPS", "docker_essentials", "Agent uses docker-essentials for image / compose / debug"),
    ("T-OPS", "system_health", "Agent reports CPU / memory / disk / load via system_health"),
    ("T-OPS", "system_health", "System is unhealthy (disk > 90%, memory > 90%) - alert"),
    ("T-OPS", "shell", "Agent runs an arbitrary shell command (allowlisted)"),
    ("T-OPS", "shell", "Shell skill hits a long-running command (>5 min)"),
    ("T-OPS", "deploy_webhook", "Agent receives a CI/CD webhook and triggers a deployment"),
    ("T-OPS", "k8s", "Agent manages Kubernetes resources (kubectl apply / get / delete)"),
    ("T-OPS", "k8s", "Agent reads pod logs in a cluster"),

    # ---------- FINANCE / TRADING ----------
    ("T-FIN", "stock_monitor", "Agent monitors a stock price (Finnhub / Yahoo)"),
    ("T-FIN", "stock_trading_assistant", "Agent executes a paper trade via trading skill"),
    ("T-FIN", "akshare_finance", "Agent uses akshare for Chinese market data"),
    ("T-FIN", "all_market_financial_data_hub", "Agent pulls data via the all-market finance hub"),
    ("T-FIN", "backtest_expert", "Agent runs a backtest with backtest_expert skill"),
    ("T-FIN", "adaptive_reasoning", "Agent uses adaptive_reasoning for financial analysis"),

    # ---------- SECURITY / PASSWORD ----------
    ("T-SEC", "1password", "Agent reads a secret from 1Password via op CLI"),
    ("T-SEC", "1password", "Agent writes a secret to 1Password"),
    ("T-SEC", "age_verification", "Agent verifies a user's age via amai-id / age-verification skill"),
    ("T-SEC", "api_security", "Agent runs api_security skill to scan an API"),
    ("T-SEC", "anti_injection", "Agent uses anti-injection skill to detect prompt-injection attempts"),
    ("T-SEC", "ai_act_risk_check", "Agent runs AI Act risk check on a use case"),
    ("T-SEC", "skillspector", "Agent runs skillspector on a SKILL.md to scan for hidden instructions"),

    # ---------- SMART HOME ----------
    ("T-HOME", "home_assistant", "Agent reads Home Assistant state (lights, switches)"),
    ("T-HOME", "home_assistant", "Agent toggles a Home Assistant entity"),
    ("T-HOME", "philips_hue", "Agent sets a Philips Hue light color / brightness"),
    ("T-HOME", "mqtt", "Agent publishes to an MQTT topic"),
    ("T-HOME", "anova_oven", "Agent sets Anova oven temperature"),
    ("T-HOME", "bambu_3d_printer", "Agent sends a print job to a Bambu 3D printer"),

    # ---------- IMAGE / VIDEO / CREATIVE ----------
    ("T-CRE", "ai_image_gen", "Agent generates an image via AI image gen skill"),
    ("T-CRE", "ai_video_gen", "Agent generates a video via AI video gen skill"),
    ("T-CRE", "ai_image_generation", "Agent uses ai_image_generation skill (alt provider)"),
    ("T-CRE", "ai_video_script_generator", "Agent drafts a video script"),
    ("T-CRE", "ai_pdf_builder", "Agent builds a PDF via ai_pdf_builder skill"),
    ("T-CRE", "ai_ppt_generate", "Agent generates a PPT via ai_ppt_generate skill"),
    ("T-CRE", "adobe_automator", "Agent automates an Adobe workflow"),

    # ---------- VOICE / TRANSCRIPTION ----------
    ("T-VOICE", "kesha_voice_kit", "Agent uses kesha-voice-kit for STT (25 langs) + TTS (Kokoro/Piper) + VAD"),
    ("T-VOICE", "agent_voice", "Agent uses agent_voice skill"),
    ("T-VOICE", "vapi", "Agent builds a Voice AI agent via Vapi"),
    ("T-VOICE", "bland", "Agent builds a Voice AI agent via Bland.ai"),
    ("T-VOICE", "retell", "Agent builds a Voice AI agent via Retell"),
    ("T-VOICE", "voice_call", "Agent places an outbound voice call"),
    ("T-VOICE", "voice_call", "Agent receives an inbound voice call"),
    ("T-VOICE", "voice_transcribe", "Agent transcribes an audio file"),

    # ---------- DATA / ANALYTICS ----------
    ("T-DATA", "data_analyst", "Agent runs a SQL query via data_analyst skill"),
    ("T-DATA", "data_analyst", "Agent charts data via data_analyst skill"),
    ("T-DATA", "automate_excel", "Agent automates an Excel workflow (read, write, formula)"),
    ("T-DATA", "airtable", "Agent reads / writes an Airtable record"),
    ("T-DATA", "supabase", "Agent queries a Supabase table via the supabase skill"),
    ("T-DATA", "asana", "Agent creates an Asana task"),
    ("T-DATA", "linear", "Agent creates a Linear issue"),
    ("T-DATA", "jira", "Agent transitions a Jira ticket"),
    ("T-DATA", "todoist", "Agent creates a Todoist task"),
    ("T-DATA", "attio", "Agent updates an Attio CRM record"),

    # ---------- PDF / DOCUMENTS ----------
    ("T-DOC", "pdf_read", "Agent reads a PDF (extract text / tables)"),
    ("T-DOC", "pdf_build", "Agent builds a PDF from markdown / HTML"),
    ("T-DOC", "add_watermark_to_pdf", "Agent adds a watermark to a PDF"),
    ("T-DOC", "docx", "Agent reads / writes a DOCX file"),

    # ---------- KNOWLEDGE / RESEARCH ----------
    ("T-KNOW", "summarize", "Agent uses Summarize skill to condense a doc / thread / page"),
    ("T-KNOW", "memory", "Agent uses Memory skill (vector store, persistent across sessions)"),
    ("T-KNOW", "arxiv_research_assistant", "Agent uses arXiv Research Assistant for paper discovery"),
    ("T-KNOW", "academic_research_hub", "Agent uses academic research hub for literature review"),
    ("T-KNOW", "academic_writing", "Agent writes an academic paper draft"),
    ("T-KNOW", "academic_writer", "Agent uses academic_writer (LaTeX)"),
    ("T-KNOW", "academic_writing_refiner", "Agent refines an academic paper for top venue (NeurIPS / ICLR)"),

    # ---------- AUTOMATION / WORKFLOWS ----------
    ("T-AUTO", "cron", "Agent schedules a cron job (openclaw webhooks / cron CLI)"),
    ("T-AUTO", "cron", "Agent's cron job fires and runs a task"),
    ("T-AUTO", "webhook", "Agent receives a webhook event (GitHub CI failed, Stripe, etc.)"),
    ("T-AUTO", "webhook", "Agent fires a webhook to an external URL"),
    ("T-AUTO", "automation_workflows", "Agent builds an automation workflow"),
    ("T-AUTO", "agentic_workflow_automation", "Agent orchestrates a multi-step workflow"),
    ("T-AUTO", "decompose", "Agent uses the decompose skill to break a complex request into subtasks"),

    # ---------- AGENT META / MANAGEMENT ----------
    ("T-META", "skill_workshop", "Agent enters Skill Workshop to draft a new skill"),
    ("T-META", "skill_workshop", "Operator reviews an agent-drafted skill proposal"),
    ("T-META", "auto_improve", "Agent uses auto-improve to refine its own behavior"),
    ("T-META", "agent_persona_os", "Agent manages its persona via ai-persona-os skill"),
    ("T-META", "adaptive_learning_agents", "Agent uses adaptive-learning-agents skill"),
    ("T-META", "agent_survival_kit", "Agent uses agent-survival-kit for runtime self-care"),
    ("T-META", "mission_control", "Agent participates in mission-control orchestrator"),
    ("T-META", "mission_control", "Agent dispatched by mission-control to a task"),
    ("T-META", "lossless_claw", "Agent uses lossless-claw for context management"),
    ("T-META", "memU", "Agent uses memU for long-term memory"),
    ("T-META", "memory_lancedb_pro", "Agent uses memory-lancedb-pro (hybrid retrieval + reranking)"),
    ("T-META", "opik_openclaw", "Agent exports traces to Opik via opik-openclaw plugin"),
    ("T-META", "openclaw_mission_control", "Agent coordinates via openclaw-mission-control"),
    ("T-META", "claude_code", "Agent delegates a task to Claude Code"),
    ("T-META", "openclaw_studio", "Agent participates in openclaw-studio dashboard"),

    # ---------- ADAPTIVE / PRODUCTIVITY ----------
    ("T-PROD2", "content_writer", "Agent uses content_writer skill to draft a blog post"),
    ("T-PROD2", "ai_daily_briefing", "Agent generates an AI daily briefing"),
    ("T-PROD2", "ai_meeting_notes", "Agent generates meeting notes with action items + to-do list"),
    ("T-PROD2", "ai_productivity_audit", "Agent runs an AI productivity audit"),
    ("T-PROD2", "adaptlypost", "Agent uses adaptlypost to adapt content to channels"),
    ("T-PROD2", "4to1_planner", "Agent uses 4to1-planner to prioritize"),
    ("T-PROD2", "adaptive_reasoning", "Agent uses adaptive_reasoning for hard problems"),
    ("T-PROD2", "answer_overflow", "Agent searches answer-overflow for prior answers"),

    # ---------- HEALTH / FITNESS ----------
    ("T-HEALTH", "whoop", "Agent pulls Whoop recovery / strain data"),
    ("T-HEALTH", "oura", "Agent pulls Oura sleep / readiness data"),
    ("T-HEALTH", "apple_health", "Agent reads Apple Health data"),

    # ---------- FINANCE / TRADING (more) ----------
    ("T-FIN2", "aave_liquidation_monitor", "Agent monitors Aave for liquidations"),
    ("T-FIN2", "abstract_searcher", "Agent uses abstract-searcher for Abstract chain data"),
    ("T-FIN2", "31third_safe_rebalancer_simple", "Agent runs 31third-safe-rebalancer-simple"),
    ("T-FIN2", "ai_act_risk_check", "Agent runs AI Act risk check on a use case"),

    # ---------- iOS / macOS ----------
    ("T-APPLE", "app_store_changelog", "Agent checks an App Store changelog"),
    ("T-APPLE", "apple_notes", "Agent reads / writes Apple Notes"),
    ("T-APPLE", "apple_calendar", "Agent reads / writes Apple Calendar"),

    # ---------- SECURITY-RELATED (more) ----------
    ("T-SEC2", "amai_id", "Agent verifies a user via amai-id"),
    ("T-SEC2", "1claw", "Agent uses 1claw skill (vendor)"),

    # ---------- AGENT-TO-AGENT ----------
    ("T-A2A", "agentdo", "Agent posts a task to agentdo queue"),
    ("T-A2A", "agentdo", "Agent picks up a task from agentdo queue"),
    ("T-A2A", "agent_team_orchestration", "Agent coordinates a team of agents"),
    ("T-A2A", "agent_commons", "Agent uses agent-commons for shared resources"),
    ("T-A2A", "agent_social", "Agent uses agent-social for social interactions"),
    ("T-A2A", "agent_mail", "Agent sends mail to other agents via agent-mail skill"),
    ("T-A2A", "agent_mail_cli", "Agent uses agent-mail-cli for terminal mail"),
    ("T-A2A", "moltbook", "Agent interacts with MoltBook (agent social network)"),
    ("T-A2A", "agent_voice", "Agent uses agent_voice skill"),

    # ---------- DESKTOP / OS ----------
    ("T-DESK", "shell", "Agent runs a shell command (allowlist scope)"),
    ("T-DESK", "shell", "Shell command needs sudo (rejected)"),
    ("T-DESK", "file_system", "Agent reads a file"),
    ("T-DESK", "file_system", "Agent writes a file"),
    ("T-DESK", "browser", "Agent uses headless Chromium for automation"),

    # ---------- K8S / CLOUD ----------
    ("T-CLOUD", "k8s", "Agent applies a manifest via kubectl"),
    ("T-CLOUD", "k8s", "Agent rolls back a deployment"),
    ("T-CLOUD", "cloud_run", "Agent deploys to Cloud Run"),
    ("T-CLOUD", "lambda", "Agent invokes an AWS Lambda"),
]

# ---------------------------------------------------------------------------
# Conditions
# ---------------------------------------------------------------------------
CONDITIONS: Dict[str, List[str]] = {
    "core_shell": [
        "command is in the allowlist (per docs - allowlist carefully)",
        "command is NOT in the allowlist (rejected - safety)",
        "command runs as `openclawops` user (default per docs)",
        "command finishes in < 5s (success)",
        "command takes > 5 min (timeout)",
        "command exits 0 (success)",
        "command exits non-zero (capture stderr, surface to agent)",
        "command writes to stdout (large output - cap returned bytes)",
        "command writes to a file (path inside allowed dirs)",
        "command needs sudo (not allowed in non-root mode)",
        "command is interactive (no TTY - rejected or piped)",
        "command spawns a background process (orphan - flag to operator)",
        "command is in a sandbox / container (isolated)",
    ],
    "core_filesystem": [
        "path is within allowed roots (per openclaw.json config)",
        "path is outside allowed roots (denied)",
        "file exists and is readable",
        "file does not exist (404 from skill)",
        "file is large (>10MB - chunked read)",
        "write target dir exists and is writable",
        "write target dir does not exist (mkdir -p first, if allowed)",
        "read returns binary (use base64 / skip)",
        "search uses regex and finds matches",
        "search uses regex and finds no matches",
        "follow-up read is consistent with prior session (cache hit)",
    ],
    "core_http": [
        "request URL is HTTPS (allowed)",
        "request URL is HTTP (rejected or downgraded with warning)",
        "request returns 2xx (success)",
        "request returns 4xx (client error - surface to agent)",
        "request returns 5xx (transient - retry with backoff)",
        "request returns 429 (rate limit - honor Retry-After)",
        "response has JSON body (parse + return)",
        "response has HTML body (scrape or extract text)",
        "response body is large (>1MB - cap)",
        "request times out (configurable timeout)",
        "request requires auth (Bearer / API key) - in env / vault",
        "TLS cert is invalid (rejected unless skipTlsVerify)",
    ],
    "core_websearch": [
        "query is non-empty (success)",
        "query is empty (400 invalid)",
        "provider is Brave (API key in env)",
        "provider is Serper (API key in env)",
        "provider is SerpAPI (API key in env)",
        "returns N results with snippets",
        "returns 0 results (refine query)",
        "rate limit hit (429) - back off and retry",
        "API key missing (401 - surface to operator)",
    ],
    "core_memory": [
        "memory file is at the configured path (markdown)",
        "write succeeds (append / overwrite per skill)",
        "read returns the stored fact",
        "memory is empty (first session)",
        "memory file is locked by another process (queue)",
        "memory skill is disabled (per config)",
        "memory has grown > 10MB (rotate / summarize)",
    ],
    "core_datetime": [
        "current datetime is in UTC (default)",
        "current datetime is in user's local timezone",
        "computed date is in the past",
        "computed date is in the future",
        "computed date crosses a weekend / holiday (business-day calc)",
    ],
    "gmail": [
        "Gmail OAuth token is valid (per docs - auto-refresh)",
        "Gmail OAuth token is expired (refresh via Pub/Sub)",
        "inbox has unread messages (returns list)",
        "inbox is empty",
        "send target is a valid email address",
        "send target is invalid (rejected)",
        "send includes attachment (file path exists)",
        "send includes attachment (file path missing)",
        "Gmail Pub/Sub push is enabled (real-time notifications)",
        "Gmail API rate limit hit (429 - back off)",
        "label / archive / delete succeeds",
        "search query returns 0 messages (broaden)",
    ],
    "google_calendar": [
        "Calendar OAuth is valid (auto-refresh)",
        "today's events list is non-empty",
        "today's events list is empty",
        "create event with valid attendees",
        "create event with invalid attendee (skipped)",
        "event conflicts with existing (free/busy overlap)",
        "delete / update existing event",
        "reminder is set (popup / email)",
        "timezone is set per event (default UTC)",
        "rate limit hit (429)",
    ],
    "gog": [
        "gog OAuth is valid (covers Gmail / Calendar / Drive / Contacts / Sheets / Docs)",
        "Gmail read via gog",
        "Calendar create via gog",
        "Google Drive upload via gog",
        "Google Sheet append row via gog",
        "Google Doc read via gog (export to markdown)",
        "Google Contacts lookup via gog",
        "rate limit hit on any Google API (back off)",
        "OAuth scope is missing for the operation (re-auth)",
    ],
    "google_workspace": [
        "google_workspace skill is OAuth-only (no Cloud Console - per docs)",
        "OAuth scope covers Gmail / Calendar / Drive / Docs / Sheets",
        "OAuth scope missing (re-auth with broader scope)",
    ],
    "outlook": [
        "Microsoft Graph OAuth is valid",
        "inbox read via Microsoft Graph",
        "send email with attachment",
        "calendar event create",
        "tenant ID is configured",
        "rate limit hit (429)",
    ],
    "apple_calendar": [
        "running on macOS (host platform check)",
        "Calendar.app permission granted (per Apple privacy)",
        "event CRUD succeeds",
        "read-only access (cannot write)",
        "permission denied (TCC prompt) - re-authorize",
    ],
    "apple_reminders": [
        "Reminders.app permission granted",
        "create reminder succeeds",
        "list reminders in a list",
        "permission denied - re-authorize",
    ],
    "apple_notes": [
        "Apple Notes account configured (iCloud)",
        "read note succeeds",
        "write / append note succeeds",
        "note is locked (cannot read without password)",
    ],
    "apple_mail": [
        "Apple Mail permission granted (Automation / Accessibility)",
        "search inbox succeeds",
        "send mail succeeds (avoid anti-spam)",
    ],
    "acuity_scheduling": [
        "Acuity API key is configured",
        "appointment type has availability",
        "create appointment succeeds",
        "client email is valid",
        "slot is already booked (try next)",
    ],
    "notion": [
        "Notion integration token is valid",
        "Notion integration is shared with the target page / database",
        "read page block tree",
        "append block children",
        "query database with filter",
        "create page in database",
        "rate limit hit (Notion: 3 req/s avg)",
        "page is locked (workspace permission)",
    ],
    "better_notion": [
        "better-notion skill has broader CRUD (pages, databases, blocks)",
        "create / read / update / delete block",
        "schema migration is needed (per Notion API change)",
    ],
    "obsidian": [
        "vault path is configured",
        "markdown file read succeeds",
        "markdown file write / append succeeds",
        "Bases / JSON Canvas supported (per skill)",
        "vault is iCloud-backed (sync latency)",
    ],
    "bear_notes": [
        "macOS host (per skill requirement)",
        "Bear database accessible (SQLite)",
        "read / write note succeeds",
    ],
    "slack": [
        "Slack bot token is valid (xoxb-...)",
        "bot is in the target channel",
        "post message succeeds",
        "react / pin / unpin succeeds",
        "DM user succeeds",
        "channel read history succeeds",
        "rate limit hit (Tier 1/2/3/4 per Slack docs)",
    ],
    "discord": [
        "Discord webhook URL is valid (preferred path)",
        "bot token is valid (advanced)",
        "post to channel succeeds",
        "react succeeds",
        "rate limit hit (5 req / 2s per channel)",
    ],
    "telegram": [
        "Telegram bot token is valid",
        "sendMessage succeeds",
        "webhook update received (bot update type)",
        "Telegram rate limit (30 msg / sec per bot globally)",
    ],
    "whatsapp": [
        "wacli is configured (linked device)",
        "send message succeeds",
        "read history succeeds (within rate limit)",
    ],
    "imessage": [
        "macOS host (per imsg skill)",
        "Messages.app permission granted",
        "send iMessage succeeds",
    ],
    "twitter_x": [
        "X / Twitter API key + bearer + access token configured",
        "post tweet / reply succeeds",
        "like / follow succeeds",
        "rate limit hit (300 tweets / 15 min - per X API v2)",
    ],
    "agentdo": [
        "agentdo API key is configured",
        "post task to queue succeeds",
        "pick up task from queue",
        "task is claimed by another agent (skip)",
    ],
    "github": [
        "GitHub PAT is valid (or fine-grained token with required scopes)",
        "GitHub App installation token (per-repo)",
        "repo is accessible (private + repo scope)",
        "rate limit hit (5000/h for PAT, 1000/h for GITHUB_TOKEN)",
        "read file / issues / PRs",
        "create issue",
        "open PR (push branch first)",
        "review PR (approve / request changes / comment)",
        "trigger workflow_dispatch",
        "GitHub CI webhook fires (per docs - build_failed event)",
    ],
    "github_cli": [
        "`gh` CLI is installed and authenticated",
        "`gh issue list` succeeds",
        "`gh pr create` succeeds",
        "`gh run watch` (live tail)",
        "`gh api` advanced query",
    ],
    "git": [
        "git is in PATH and on a configured branch",
        "commit succeeds (hooks run)",
        "push to protected branch (branch protection - may fail)",
        "fetch / pull succeeds (fast-forward)",
        "merge conflict (manual resolution)",
    ],
    "code_runner": [
        "Python / Node is available in the runner env",
        "script runs in a sandbox (network / FS restricted)",
        "script execution time < 30s (success)",
        "script execution time > 30s (timeout)",
        "script returns stdout / stderr",
        "script writes files to a sandbox dir",
    ],
    "claude_code": [
        "Claude Code CLI is installed and authenticated",
        "delegated task runs in a workspace dir",
        "delegated task hits permission prompt (allowlist)",
    ],
    "autoreview": [
        "PR diff is small (in token budget)",
        "PR diff is huge (> 100k tokens - chunked review)",
        "review rubric matches repo (e.g. CODEOWNERS)",
    ],
    "crabbox": [
        "Testbox / Crabbox is reachable",
        "CI-parity proof runs successfully",
        "test run is flaky (retry once, then report)",
    ],
    "session_viewer": [
        "session JSONL is available locally",
        "viewer is served on localhost:port",
        "session is large (> 100MB - chunked load)",
    ],
    "handoff": [
        "target agent is reachable",
        "handoff context is below token budget",
        "handoff context is huge (> budget - summarize first)",
    ],
    "browser": [
        "headless Chromium is available in the runner env",
        "navigate succeeds (page returns 2xx)",
        "navigate times out (30s default)",
        "navigate returns 4xx / 5xx",
        "extract text / HTML from page",
        "fill form / click button",
        "take screenshot (PNG / JPEG)",
        "page is login-walled (cookie / session needed)",
        "page has anti-bot (Cloudflare / DataDome) - escalate",
        "browser session is closed cleanly",
    ],
    "web_search": [
        "provider API key is set (Brave / Serper / SerpAPI)",
        "query returns results with snippets",
        "query returns 0 results (refine)",
        "rate limit hit (per provider)",
    ],
    "prismfy_web_search": [
        "10 engines available (Google, Reddit, GitHub, arXiv, HN, etc.)",
        "free tier is available (per prismfy docs)",
        "search returns results across engines",
        "rate limit hit on free tier",
    ],
    "tavily": [
        "Tavily API key is set",
        "deep research task completes (may take minutes)",
        "research depth = advanced (more tokens)",
    ],
    "arxiv_watcher": [
        "arXiv API is reachable",
        "search returns paper list with abstracts",
        "summarize abstracts (LLM call)",
    ],
    "pubmed_edirect": [
        "PubMed E-utilities API is reachable",
        "query returns PMIDs",
        "fetch full records for PMIDs",
    ],
    "wikipedia": [
        "Wikipedia API / MediaWiki reachable",
        "search / parse article succeeds",
    ],
    "newsapi_search": [
        "NewsAPI key is set",
        "query returns articles with metadata",
        "rate limit hit (free tier 100 req/day)",
    ],
    "exa_web_search": [
        "Exa API key is set",
        "query returns semantic results",
    ],
    "web_scraper_as_a_service": [
        "scraper skill has been built for the target site",
        "target site is in the cache (reuse)",
        "target site needs fresh build (cost / time)",
    ],
    "brightdata": [
        "Bright Data API key is set",
        "proxy bandwidth available (overage billable)",
        "scrape / search request returns data",
    ],
    "rss_reader": [
        "RSS feed URL is reachable",
        "feed parses (valid XML)",
        "new items match keywords",
        "feed is stale (no new items in N days)",
    ],
    "ak_rss_24h_brief": [
        "OPML list is configured",
        "24h window applied",
        "Chinese categorized brief is generated",
    ],
    "academic_deep_research": [
        "research question is well-defined",
        "full pipeline completes (search + synthesize + cite)",
        "source quality is high (peer-reviewed preferred)",
    ],
    "serper_search": [
        "Serper API key is set",
        "SERP data returned (organic, knowledge graph, PAA)",
    ],
    "docker_control": [
        "Docker socket is mounted (per skill)",
        "list / start / stop / restart container succeeds",
        "read logs succeeds (last N lines)",
        "docker exec runs a command in a container",
        "container is not running (auto-start or skip)",
    ],
    "docker_essentials": [
        "image build / pull / push succeeds",
        "compose stack up / down",
        "debug via docker inspect",
    ],
    "system_health": [
        "all metrics in healthy range",
        "disk > 90% (alert)",
        "memory > 90% (alert)",
        "load average > N (alert)",
        "metrics collection succeeds (host accessible)",
    ],
    "shell": [
        "command in allowlist",
        "command exits 0",
        "command exits non-zero (surface stderr)",
        "command needs sudo (deny)",
        "long-running command (>5 min) - background with timeout",
    ],
    "deploy_webhook": [
        "webhook URL is reachable (HTTPS)",
        "webhook secret verifies (HMAC)",
        "deploy task triggers a runbook (shell, k8s, etc.)",
    ],
    "k8s": [
        "kubectl configured and reachable",
        "apply manifest succeeds (resource created)",
        "rollout status reaches healthy",
        "rollback to previous revision succeeds",
        "pod logs retrievable",
    ],
    "stock_monitor": [
        "Finnhub / Yahoo API key is set",
        "price for symbol is returned",
        "alert threshold hit (notify user)",
    ],
    "stock_trading_assistant": [
        "paper-trade account is configured (no real money)",
        "order placed successfully",
        "order rejected (insufficient balance / market closed)",
    ],
    "akshare_finance": [
        "akshare is installed (Chinese market data)",
        "symbol data is returned (with delay vs realtime)",
    ],
    "all_market_financial_data_hub": [
        "hub is reachable",
        "data for market is returned",
    ],
    "backtest_expert": [
        "historical data is available",
        "strategy code parses and runs",
        "backtest report is generated (PnL, Sharpe, drawdown)",
    ],
    "adaptive_reasoning": [
        "problem is well-defined",
        "reasoning chain completes within budget",
    ],
    "1password": [
        "`op` CLI is installed and signed in",
        "vault / item exists",
        "read secret succeeds",
        "secret has expired (re-fetch / rotate)",
    ],
    "age_verification": [
        "user submits age proof",
        "verification skill confirms age",
        "verification fails (privacy preserved)",
    ],
    "api_security": [
        "API spec is OpenAPI / Swagger",
        "scan finds issues (auth, input validation, etc.)",
        "scan is clean",
    ],
    "anti_injection": [
        "incoming content is scanned for prompt-injection",
        "no injection detected (proceed)",
        "injection detected (block + alert)",
    ],
    "ai_act_risk_check": [
        "use case is classified per EU AI Act risk tiers",
        "high-risk use case flagged (operator review)",
    ],
    "skillspector": [
        "SKILL.md is scanned for hidden instructions",
        "scan is clean (safe to install)",
        "scan finds suspicious content (block install)",
    ],
    "home_assistant": [
        "HA URL + token are configured",
        "read entity state succeeds",
        "toggle entity succeeds (light on / off)",
        "HA is unreachable (network issue)",
    ],
    "philips_hue": [
        "Hue bridge is reachable (local network)",
        "API key for bridge is set",
        "set color / brightness succeeds",
    ],
    "mqtt": [
        "MQTT broker is reachable",
        "topic publish succeeds",
        "broker auth (username / password) is configured",
    ],
    "anova_oven": [
        "oven is on the network and paired",
        "set temperature succeeds",
    ],
    "bambu_3d_printer": [
        "printer is paired (MQTT + access code)",
        "send print job succeeds",
        "AMS slot is loaded with correct filament",
    ],
    "ai_image_gen": [
        "image generation API key is set",
        "prompt is non-empty",
        "image is generated and saved to disk / URL",
        "content policy rejects prompt (refusal)",
    ],
    "ai_video_gen": [
        "video generation API key is set",
        "video is generated (takes minutes)",
        "video generation fails (queue full, timeout)",
    ],
    "ai_image_generation": [
        "alt provider key is set",
        "image is generated",
    ],
    "ai_video_script_generator": [
        "topic / brief is provided",
        "script is generated with scenes + narration",
    ],
    "ai_pdf_builder": [
        "source markdown / HTML is provided",
        "PDF is generated and saved",
    ],
    "ai_ppt_generate": [
        "outline is provided",
        "PPT is generated (PPTX) with slides",
    ],
    "adobe_automator": [
        "Adobe API access is configured",
        "automate task succeeds",
    ],
    "kesha_voice_kit": [
        "STT for 25 languages works",
        "TTS via Kokoro / Piper succeeds",
        "VAD (voice activity detection) triggers correctly",
    ],
    "agent_voice": [
        "voice skill is configured",
        "agent speaks / listens successfully",
    ],
    "vapi": [
        "Vapi API key is set",
        "build voice agent (voice + prompt + tools)",
        "make outbound call",
        "retrieve call transcript",
    ],
    "bland": [
        "Bland API key is set",
        "build voice agent",
        "place call",
    ],
    "retell": [
        "Retell API key is set",
        "build voice agent",
        "place call",
    ],
    "voice_call": [
        "outbound call connects (DTMF / human answer)",
        "outbound call fails (no answer / busy / invalid number)",
        "inbound call is answered (per skill setup)",
    ],
    "voice_transcribe": [
        "audio file is accessible",
        "transcription completes with timestamps",
    ],
    "data_analyst": [
        "DB connection string is set",
        "SQL query parses and runs",
        "chart is generated (PNG / SVG)",
    ],
    "automate_excel": [
        "Excel file is accessible (path / S3 / Drive)",
        "read sheet / cell succeeds",
        "write formula succeeds",
        "macro / VBA runs (if skill supports)",
    ],
    "airtable": [
        "Airtable API key is set",
        "base / table is shared with the token",
        "create / read / update / delete record",
    ],
    "supabase": [
        "Supabase URL + anon / service key is set",
        "row-level security allows the operation",
        "query / insert / update / delete succeeds",
        "rate limit hit (per Supabase plan)",
    ],
    "asana": [
        "Asana token is set",
        "create / update task in project",
    ],
    "linear": [
        "Linear API key is set",
        "create / update / transition issue",
    ],
    "jira": [
        "Jira token is set",
        "transition ticket (To Do -> In Progress -> Done)",
        "add comment to ticket",
    ],
    "todoist": [
        "Todoist token is set",
        "create / complete task",
    ],
    "attio": [
        "Attio API key is set",
        "create / update CRM record",
    ],
    "pdf_read": [
        "PDF is accessible (URL or path)",
        "extract text succeeds",
        "extract tables succeeds",
        "PDF is scanned (OCR needed - flag for cost)",
    ],
    "pdf_build": [
        "source markdown / HTML is provided",
        "PDF is generated and saved",
    ],
    "add_watermark_to_pdf": [
        "PDF + watermark image / text provided",
        "watermark applied + saved",
    ],
    "docx": [
        "DOCX file accessible",
        "read paragraphs / tables",
        "write / edit document",
    ],
    "summarize": [
        "source (URL / file / thread) is accessible",
        "summary generated with key takeaways + action items",
    ],
    "memory": [
        "memory vector store is configured (LanceDB / Chroma / etc.)",
        "save fact succeeds (with embedding)",
        "retrieve returns top-K relevant memories",
        "memory backend is unavailable (fall back to file)",
    ],
    "arxiv_research_assistant": [
        "arXiv API reachable",
        "search returns papers + abstracts",
    ],
    "academic_research_hub": [
        "literature search succeeds across sources",
        "summary generated with citations",
    ],
    "academic_writing": [
        "topic + outline provided",
        "draft generated with citations",
    ],
    "academic_writer": [
        "LaTeX template is configured",
        "draft compiled to PDF",
    ],
    "academic_writing_refiner": [
        "draft is provided",
        "refined draft for top venue (NeurIPS / ICLR) is returned",
    ],
    "cron": [
        "cron expression is valid (per OpenClaw cron CLI)",
        "schedule fires on time",
        "task succeeds",
        "task fails (logs + retry policy)",
    ],
    "webhook": [
        "webhook URL is reachable (HTTPS)",
        "webhook secret verifies (HMAC)",
        "receiver processes event idempotently",
    ],
    "automation_workflows": [
        "workflow definition is valid",
        "workflow executes step by step",
        "step fails (retry / rollback)",
    ],
    "agentic_workflow_automation": [
        "multi-step workflow completes",
        "branch / parallel step resolves",
    ],
    "decompose": [
        "complex request is broken into subtasks",
        "skill finder locates existing skills",
        "new skill is drafted for missing capability",
    ],
    "skill_workshop": [
        "skill proposal is drafted by agent",
        "operator approves the proposal",
        "operator rejects the proposal",
    ],
    "auto_improve": [
        "skill self-evaluation succeeds",
        "improvement is logged to memory",
    ],
    "agent_persona_os": [
        "persona is set per agent",
        "persona is consistent across sessions",
    ],
    "adaptive_learning_agents": [
        "agent learns from feedback",
        "behavior adapts to new context",
    ],
    "agent_survival_kit": [
        "agent detects low resources (rate / cost)",
        "agent self-throttles and alerts",
    ],
    "mission_control": [
        "task is dispatched to an agent",
        "agent reports back with result",
    ],
    "lossless_claw": [
        "context grows large",
        "lossless compaction runs (no info loss)",
    ],
    "memU": [
        "long-term memory is stored",
        "retrieval is by similarity + recency",
    ],
    "memory_lancedb_pro": [
        "LanceDB backend is configured",
        "hybrid retrieval (BM25 + vector) + rerank runs",
    ],
    "opik_openclaw": [
        "Opik exporter is configured",
        "agent traces are exported",
    ],
    "openclaw_mission_control": [
        "dashboard shows live agent fleet",
        "operator dispatches task via dashboard",
    ],
    "claude_code": [
        "Claude Code CLI is installed + auth",
        "delegated task runs in workspace",
    ],
    "openclaw_studio": [
        "studio is reachable (WebSocket ws://...)",
        "agent connects to studio",
    ],
    "content_writer": [
        "topic + tone + audience provided",
        "draft is generated (markdown / HTML)",
    ],
    "ai_daily_briefing": [
        "data sources (calendar / email / RSS) are reachable",
        "briefing is generated on schedule",
    ],
    "ai_meeting_notes": [
        "audio recording is available",
        "transcript is generated",
        "action items + to-dos are extracted",
    ],
    "ai_productivity_audit": [
        "audit criteria provided",
        "audit report is generated",
    ],
    "adaptlypost": [
        "source content is provided",
        "channel-specific versions are generated",
    ],
    "4to1_planner": [
        "tasks are listed",
        "4-to-1 prioritization is applied",
    ],
    "answer_overflow": [
        "search query provided",
        "prior answer is returned from the index",
    ],
    "whoop": [
        "Whoop API key is set",
        "recovery / strain data is returned",
    ],
    "oura": [
        "Oura API key is set",
        "sleep / readiness data is returned",
    ],
    "apple_health": [
        "Apple Health export is accessible",
        "metric is parsed from the export",
    ],
    "aave_liquidation_monitor": [
        "Aave subgraph is reachable",
        "liquidation event is detected",
    ],
    "abstract_searcher": [
        "Abstract chain indexer is reachable",
    ],
    "31third_safe_rebalancer_simple": [
        "wallet is connected (read-only)",
        "rebalance plan is generated",
    ],
    "ai_act_risk_check": [
        "use case description is provided",
        "risk tier is assigned (per EU AI Act)",
    ],
    "app_store_changelog": [
        "App Store ID is provided",
        "changelog is fetched",
    ],
    "amai_id": [
        "user submits verification",
        "verification succeeds / fails",
    ],
    "1claw": [
        "1claw service is configured",
    ],
    "agent_team_orchestration": [
        "team of agents is registered",
        "task is dispatched to a team",
    ],
    "agent_commons": [
        "shared resources are accessible",
    ],
    "agent_social": [
        "social network is reachable",
        "post / reply / follow is performed",
    ],
    "agent_mail": [
        "agent-to-agent mail is sent",
        "agent-to-agent mail is received",
    ],
    "agent_mail_cli": [
        "agent_mail CLI is installed",
        "send / read mail via CLI",
    ],
    "moltbook": [
        "MoltBook API key is set",
        "post / follow / message in agent social network",
    ],
    "file_system": [
            "path is within allowed roots (per openclaw.json config)",
            "path is outside allowed roots (denied)",
            "file exists and is readable",
            "file does not exist (404 from skill)",
            "read returns binary (use base64 / skip)",
            "write target dir is writable",
        ],
        "cloud_run": [
            "Cloud Run service is reachable (URL + IAM)",
            "deploy succeeds (image push + traffic shift)",
            "deploy fails (build / IAM)",
            "revision rolls back to previous on crash",
        ],
        "lambda": [
            "Lambda function exists and is callable",
            "IAM allows invocation from OpenClaw",
            "cold start within budget",
            "execution duration within Lambda timeout",
            "payload is valid JSON",
        ],
}

# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------
ACTIONS: Dict[str, Dict[str, List[str]]] = {
    "if_action": {
        "core_shell": [
            "Run the command in an allowlisted shell (per docs - scope carefully)",
            "Reject command (not in allowlist) - log + surface to operator",
            "Run as `openclawops` user (default - per docs)",
            "Return stdout/stderr within 5s (success)",
            "Background the long-running command with timeout (per docs - kill at 5m default)",
            "Return exit 0 result to the agent",
            "Capture stderr and surface as 'shell_error' to the agent",
            "Cap stdout at e.g. 256KB; tail the rest",
            "Write to file inside an allowlisted dir",
            "Reject sudo (no root) - return 'permission denied'",
            "Reject interactive (no TTY) - return 'no_tty' error",
            "Flag orphan background processes to operator (cleanup job)",
            "Run inside a sandbox / container (isolated from host FS)",
        ],
        "core_filesystem": [
            "Read the file (within allowed roots per openclaw.json config)",
            "Deny path (outside allowed roots) - log + return 'path_forbidden'",
            "Return file content to the agent",
            "Return 404 (file does not exist)",
            "Chunked read (file > 10MB) - return first N lines + total line count",
            "Create dir with mkdir -p if allowed, then write",
            "Reject write (dir not writable)",
            "Return base64 / skip on binary read",
            "Apply regex search; return matches with file:line:content",
            "Return 0 matches (inform agent - no results)",
            "Use cached read for repeat within session (saves I/O)",
        ],
        "core_http": [
            "Make the HTTP/HTTPS request with proper headers",
            "Reject HTTP (downgrade to HTTPS with warning, or refuse)",
            "Return 2xx body (parsed JSON / text) to agent",
            "Surface 4xx to agent (don't retry - likely a code bug)",
            "Retry 5xx with exponential backoff (3x max)",
            "Honor Retry-After; back off on 429",
            "Parse JSON body; return parsed object",
            "Extract text from HTML (use a parser)",
            "Cap response at 1MB; tail the rest",
            "Use configurable timeout (default 30s)",
            "Inject auth from env / vault (never from prompt)",
            "Skip TLS verify only for known dev / test endpoints (flag loudly)",
        ],
        "core_websearch": [
            "Query the provider and return summarized results",
            "Reject empty query (400 - 'query required')",
            "Use Brave API (key in env / vault)",
            "Use Serper API (key in env / vault)",
            "Use SerpAPI (key in env / vault)",
            "Return N results with snippets + URLs to the agent",
            "Refine query (broaden terms) and re-search if 0 results",
            "Back off and retry on 429 (per provider limits)",
            "Surface 401 (API key missing) to operator; do not proceed",
        ],
        "core_memory": [
            "Write fact to the configured memory file (markdown)",
            "Read and return the stored fact",
            "Create empty memory file (first session) - path will be created",
            "Queue the write (memory file locked)",
            "Skip write (memory skill disabled in config)",
            "Rotate / summarize memory if file > 10MB (preserve oldest entries)",
        ],
        "core_datetime": [
            "Return current datetime in UTC (default)",
            "Return current datetime in user's local timezone",
            "Return computed past date (e.g. 3 business days ago)",
            "Return computed future date (e.g. next meeting)",
            "Skip weekends / holidays (business-day calc)",
        ],
        "gmail": [
            "Read inbox (with auto-refreshed OAuth token - per docs)",
            "Send email (Gmail API with auto-refreshed OAuth)",
            "Label / archive / delete email via Gmail API",
            "Receive Pub/Sub push (real-time inbox events)",
            "Reject invalid email target (validation)",
            "Validate attachment file path exists and is readable",
            "Reject (attachment path missing)",
            "Enable Gmail Pub/Sub push (project-id + topic-name)",
            "Back off on Gmail API rate limit (429)",
            "Return success (label / archive / delete)",
            "Broaden search query (if 0 results)",
        ],
        "google_calendar": [
            "Read today's events list",
            "Create event with valid attendees + reminders",
            "Update / delete existing event",
            "Run free/busy check (no overlap)",
            "Skip invalid attendee (validation)",
            "Suggest next available slot (when conflict)",
            "Set reminder (popup / email)",
            "Use timezone from event (default UTC if not set)",
            "Back off on Calendar API 429",
        ],
        "gog": [
            "Use the gog CLI for the requested Google Workspace operation (covers Gmail / Calendar / Drive / Contacts / Sheets / Docs per docs)",
            "Read a Google Doc and export as markdown",
            "Append a row to a Google Sheet",
            "Upload a file to Google Drive",
            "Look up a Google Contact",
            "Back off on any Google API 429 (per API quota)",
            "Re-auth via OAuth with broader scope (missing scope)",
        ],
        "google_workspace": [
            "Use the OAuth-only flow (no Cloud Console per docs)",
            "Re-auth when scope is missing for the operation",
        ],
        "outlook": [
            "Read Outlook inbox via Microsoft Graph",
            "Send Outlook email with attachment",
            "Create Outlook calendar event",
            "Use tenant ID from config (if multi-tenant)",
            "Back off on Graph API 429",
        ],
        "apple_calendar": [
            "CRUD event on macOS Calendar.app",
            "Read-only mode (cannot write - return helpful error)",
            "Re-authorize Calendar permission (TCC prompt)",
        ],
        "apple_reminders": [
            "Create / list reminders in Apple Reminders",
            "Re-authorize Reminders permission",
        ],
        "apple_notes": [
            "Read / write Apple Notes (iCloud account configured)",
            "Prompt for note password (locked note)",
        ],
        "apple_mail": [
            "Search Apple Mail inbox",
            "Send mail (avoid being flagged as spam)",
        ],
        "acuity_scheduling": [
            "Book an Acuity appointment with valid client email",
            "Try next available slot (current one is booked)",
            "Validate client email (invalid - reject)",
        ],
        "notion": [
            "Read Notion page (block tree)",
            "Append block children to a Notion page",
            "Query database with filter",
            "Create page in a database",
            "Back off on Notion 429 (3 req/s avg)",
            "Prompt to share the integration with the page (not shared)",
        ],
        "better_notion": [
            "Use better-notion for full CRUD (pages / databases / blocks)",
            "Migrate schema if Notion API changed",
        ],
        "obsidian": [
            "Read / write markdown in the configured vault",
            "Use Bases / JSON Canvas / CLI per the skill",
            "Wait for iCloud sync (vault is iCloud-backed)",
        ],
        "bear_notes": [
            "Read / write Bear notes via SQLite (macOS)",
        ],
        "slack": [
            "Post message to a Slack channel (xoxb-... token)",
            "React / pin / unpin a message",
            "DM a user",
            "Read channel history",
            "Back off per Slack Tier (Tier 1/2/3/4 per Slack docs)",
        ],
        "discord": [
            "Post via Discord webhook (preferred)",
            "React to a message (bot token)",
            "Back off per Discord rate limit (5 req/2s per channel)",
        ],
        "telegram": [
            "Send a Telegram message (bot token)",
            "Receive bot update via webhook",
            "Back off per Telegram rate limit (30 msg/s per bot globally)",
        ],
        "whatsapp": [
            "Send WhatsApp via wacli (linked device)",
            "Read WhatsApp history (within rate limit)",
        ],
        "imessage": [
            "Send iMessage via imsg (macOS)",
        ],
        "twitter_x": [
            "Post tweet / reply via X API v2 (API key + bearer + access token)",
            "Like / follow via bird skill",
            "Back off per X rate limit (300 tweets / 15 min)",
        ],
        "agentdo": [
            "Post task to agentdo queue (agent-to-agent)",
            "Pick up task from agentdo queue (agent-to-agent)",
            "Skip task (claimed by another agent)",
        ],
        "github": [
            "Read a GitHub repo (file, issues, PRs) with PAT or installation token",
            "Create an issue",
            "Open a PR (push branch first)",
            "Review a PR (approve / request changes / comment)",
            "Trigger a workflow via workflow_dispatch",
            "Receive GitHub CI build_failed webhook (curl to /webhooks/github-ci)",
            "Back off on GitHub 429 (rate limit per docs)",
        ],
        "github_cli": [
            "Run `gh issue` / `gh pr` / `gh run` / `gh api` (per the gh skill)",
            "Tail a workflow run with `gh run watch`",
        ],
        "git": [
            "Run git commit / push / branch (within allowed repo)",
            "Reject push to protected branch (branch protection - per docs)",
            "Reject non-fast-forward (suggest rebase)",
            "Mark conflict for manual resolution",
        ],
        "code_runner": [
            "Run Python / Node in the sandboxed runner env",
            "Network / FS restricted (sandboxed)",
            "Return stdout / stderr within 30s",
            "Timeout at 30s and surface 'runner_timeout'",
            "Return parsed output to agent",
            "Write files to a sandbox dir (not host FS)",
        ],
        "claude_code": [
            "Delegate task to Claude Code CLI (workspace dir)",
            "Allowlist common safe operations (avoid prompt storms)",
        ],
        "autoreview": [
            "Run review closeout workflow on the PR",
            "Chunked review if diff > 100k tokens (review rubric applied per chunk)",
        ],
        "crabbox": [
            "Run CI-parity proof in Crabbox",
            "Retry once on flaky test, then report",
        ],
        "session_viewer": [
            "Serve session JSONL in a searchable HTML viewer (localhost)",
            "Chunked load for sessions > 100MB",
        ],
        "handoff": [
            "Delegate to target agent (path-free prompt handoff)",
            "Summarize context first if > budget (avoid handoff bloat)",
        ],
        "browser": [
            "Navigate a URL in headless Chromium",
            "Extract text / HTML from the page",
            "Fill a form / click a button",
            "Take a screenshot (PNG / JPEG)",
            "Retry on timeout (30s default)",
            "Surface 4xx / 5xx to agent (with status code)",
            "Detect login wall and request profile / cookie injection",
            "Escalate to anti-bot if Cloudflare / DataDome detected",
            "Close browser session cleanly (release resources)",
        ],
        "web_search": [
            "Query the configured search provider (Brave / Serper / SerpAPI)",
            "Return N results with snippets + URLs",
            "Refine query (broaden) on 0 results",
            "Back off on per-provider rate limit",
        ],
        "prismfy_web_search": [
            "Search across 10 engines (Google, Reddit, GitHub, arXiv, HN, ...)",
            "Use free tier (per prismfy docs)",
        ],
        "tavily": [
            "Run Tavily deep research task",
            "Set depth = advanced (more tokens, more sources)",
        ],
        "arxiv_watcher": [
            "Search arXiv and return paper list with abstracts",
            "Summarize abstracts via LLM call",
        ],
        "pubmed_edirect": [
            "Query PubMed and return PMIDs",
            "Fetch full records for PMIDs (E-utilities)",
        ],
        "wikipedia": [
            "Search / retrieve / summarize Wikipedia article",
        ],
        "newsapi_search": [
            "Query NewsAPI and return articles with metadata",
            "Free tier 100 req/day (per NewsAPI docs) - back off accordingly",
        ],
        "exa_web_search": [
            "Query Exa semantic search and return results",
        ],
        "web_scraper_as_a_service": [
            "Build a client-ready web scraper (clean data output)",
            "Reuse cached scraper if site is in cache",
            "Build fresh scraper if site needs new selectors",
        ],
        "brightdata": [
            "Query Bright Data for web scraping / search (API key)",
            "Track proxy bandwidth cost (overage billable)",
        ],
        "rss_reader": [
            "Monitor RSS feeds for new items matching keywords",
            "Mark feed as stale if no new items in N days",
        ],
        "ak_rss_24h_brief": [
            "Generate a 24h Chinese categorized brief from OPML list",
        ],
        "academic_deep_research": [
            "Run transparent, rigorous research with full citations",
        ],
        "serper_search": [
            "Query Serper for Google SERP data (organic, knowledge graph, PAA)",
        ],
        "docker_control": [
            "List containers via docker_control",
            "Restart a container",
            "Read last N lines of logs",
            "docker exec a command in a container",
            "Auto-start the container if not running (if allowed)",
        ],
        "docker_essentials": [
            "Build / pull / push image",
            "Compose stack up / down",
            "Debug via docker inspect",
        ],
        "system_health": [
            "Report CPU / memory / disk / load average",
            "Alert on disk > 90% (page operator)",
            "Alert on memory > 90%",
            "Alert on load average > N",
            "Retry metric collection on transient failure",
        ],
        "shell": [
            "Run the allowlisted shell command",
            "Reject (not in allowlist) - surface 'forbidden'",
            "Return exit 0 result",
            "Surface stderr on non-zero exit",
            "Deny sudo (return 'permission denied')",
            "Background with timeout (long-running command)",
        ],
        "deploy_webhook": [
            "Receive CI/CD webhook (HMAC-verified) and trigger deployment",
            "Reject (webhook signature invalid) - return 401",
            "Run runbook (shell / k8s / docker) on trigger",
        ],
        "k8s": [
            "Apply manifest (kubectl apply) - resource created",
            "Wait for rollout to be healthy",
            "Roll back to previous revision",
            "Read pod logs for the target pod",
        ],
        "stock_monitor": [
            "Pull stock price from Finnhub / Yahoo",
            "Fire alert when threshold is hit (notify user)",
        ],
        "stock_trading_assistant": [
            "Place a paper trade (no real money)",
            "Reject order (insufficient balance / market closed)",
        ],
        "akshare_finance": [
            "Pull Chinese market data via akshare",
        ],
        "all_market_financial_data_hub": [
            "Query the all-market hub for data",
        ],
        "backtest_expert": [
            "Run a backtest with historical data",
            "Generate PnL / Sharpe / drawdown report",
        ],
        "adaptive_reasoning": [
            "Run adaptive reasoning chain on the problem",
        ],
        "1password": [
            "Read secret from 1Password via `op` CLI",
            "Write secret to 1Password",
            "Re-fetch (secret expired)",
        ],
        "age_verification": [
            "Verify user age via amai-id / age-verification",
            "Block action (verification failed - privacy preserved)",
        ],
        "api_security": [
            "Scan an API spec for security issues",
            "Report findings (auth, input validation, etc.)",
        ],
        "anti_injection": [
            "Scan incoming content for prompt-injection (per docs)",
            "Block content (injection detected) + alert",
        ],
        "ai_act_risk_check": [
            "Classify use case per EU AI Act risk tiers",
            "Flag high-risk use case (operator review)",
        ],
        "skillspector": [
            "Scan SKILL.md for hidden instructions (per docs)",
            "Block install (suspicious content found)",
        ],
        "home_assistant": [
            "Read entity state from Home Assistant (URL + token)",
            "Toggle a Home Assistant entity",
            "Surface HA unreachable (network issue)",
        ],
        "philips_hue": [
            "Set Philips Hue light color / brightness (bridge API key)",
        ],
        "mqtt": [
            "Publish to MQTT topic (broker auth)",
        ],
        "anova_oven": [
            "Set Anova oven temperature (paired device)",
        ],
        "bambu_3d_printer": [
            "Send print job to Bambu 3D printer (paired + access code)",
            "Verify AMS slot is loaded with correct filament",
        ],
        "ai_image_gen": [
            "Generate image from prompt (API key)",
            "Save image to disk / return URL",
            "Refusal (content policy rejected prompt)",
        ],
        "ai_video_gen": [
            "Generate video (takes minutes)",
            "Surface queue-full / timeout error",
        ],
        "ai_image_generation": [
            "Generate image via alt provider",
        ],
        "ai_video_script_generator": [
            "Generate script with scenes + narration",
        ],
        "ai_pdf_builder": [
            "Build PDF from markdown / HTML",
        ],
        "ai_ppt_generate": [
            "Generate PPTX deck from outline",
        ],
        "adobe_automator": [
            "Automate Adobe workflow (API access)",
        ],
        "kesha_voice_kit": [
            "STT in 25 languages (kit is open source)",
            "TTS via Kokoro / Piper",
            "VAD (voice activity detection) triggers correctly",
        ],
        "agent_voice": [
            "Speak / listen via agent_voice skill",
        ],
        "vapi": [
            "Build voice AI agent on Vapi (per docs)",
            "Make outbound call",
            "Retrieve call transcript",
        ],
        "bland": [
            "Build voice AI agent on Bland.ai",
            "Place call",
        ],
        "retell": [
            "Build voice AI agent on Retell",
            "Place call",
        ],
        "voice_call": [
            "Connect outbound call (DTMF / human answer)",
            "Surface call failure (no answer / busy / invalid number)",
        ],
        "voice_transcribe": [
            "Transcribe audio file with timestamps",
        ],
        "data_analyst": [
            "Run SQL query against the configured DB",
            "Generate chart (PNG / SVG) and return",
        ],
        "automate_excel": [
            "Read sheet / cell from Excel file",
            "Write formula / data to Excel file",
            "Run macro (if supported)",
        ],
        "airtable": [
            "Read / write Airtable record (token shared with base)",
        ],
        "supabase": [
            "Query / insert / update / delete on Supabase",
            "Surface RLS denial (row-level security)",
        ],
        "asana": [
            "Create / update Asana task in project",
        ],
        "linear": [
            "Create / update / transition Linear issue",
        ],
        "jira": [
            "Transition Jira ticket (To Do -> In Progress -> Done)",
            "Add comment to ticket",
        ],
        "todoist": [
            "Create / complete Todoist task",
        ],
        "attio": [
            "Create / update Attio CRM record",
        ],
        "pdf_read": [
            "Extract text from PDF",
            "Extract tables from PDF",
            "Flag scanned PDF (OCR needed - cost / time)",
        ],
        "pdf_build": [
            "Build PDF from markdown / HTML",
        ],
        "add_watermark_to_pdf": [
            "Apply watermark (text or image) to PDF",
        ],
        "docx": [
            "Read paragraphs / tables from DOCX",
            "Write / edit DOCX document",
        ],
        "summarize": [
            "Summarize source (URL / file / thread) with key takeaways + action items",
        ],
        "memory": [
            "Save fact to vector store (with embedding)",
            "Retrieve top-K relevant memories (by similarity)",
            "Fall back to file-based memory (vector backend unavailable)",
        ],
        "arxiv_research_assistant": [
            "Search arXiv and return papers + abstracts",
        ],
        "academic_research_hub": [
            "Run literature search across sources",
            "Generate summary with citations",
        ],
        "academic_writing": [
            "Draft academic paper with citations",
        ],
        "academic_writer": [
            "Compile LaTeX draft to PDF",
        ],
        "academic_writing_refiner": [
            "Refine draft for top venue (NeurIPS / ICLR)",
        ],
        "cron": [
            "Schedule cron job via openclaw cron CLI",
            "Run scheduled task on time",
            "Retry on transient task failure (per cron config)",
        ],
        "webhook": [
            "Receive webhook (HTTPS, HMAC verified)",
            "Process event idempotently (delivery_id dedup)",
        ],
        "automation_workflows": [
            "Execute workflow step by step",
            "Retry / rollback on step failure",
        ],
        "agentic_workflow_automation": [
            "Run multi-step workflow (branch / parallel)",
        ],
        "decompose": [
            "Decompose complex request into subtasks",
            "Find existing skills for subtasks",
            "Draft a new skill for missing capability (per docs)",
        ],
        "skill_workshop": [
            "Draft skill proposal (via Skill Workshop)",
            "Operator approves the proposal",
            "Operator rejects the proposal (with feedback)",
        ],
        "auto_improve": [
            "Self-evaluate and log improvement to memory",
        ],
        "agent_persona_os": [
            "Set / use persona consistently across sessions",
        ],
        "adaptive_learning_agents": [
            "Learn from feedback and adapt behavior",
        ],
        "agent_survival_kit": [
            "Detect low resources and self-throttle + alert",
        ],
        "mission_control": [
            "Dispatch task to an agent (per mission-control)",
            "Wait for agent to report back with result",
        ],
        "lossless_claw": [
            "Run lossless context compaction (preserve info)",
        ],
        "memU": [
            "Store / retrieve long-term memory (similarity + recency)",
        ],
        "memory_lancedb_pro": [
            "Run hybrid retrieval (BM25 + vector) + rerank on LanceDB",
        ],
        "opik_openclaw": [
            "Export agent traces to Opik",
        ],
        "openclaw_mission_control": [
            "Connect agent to mission-control dashboard",
        ],
        "claude_code": [
            "Delegate coding task to Claude Code CLI",
        ],
        "openclaw_studio": [
            "Connect agent to studio dashboard (WebSocket)",
        ],
        "content_writer": [
            "Draft content (topic + tone + audience provided)",
        ],
        "ai_daily_briefing": [
            "Generate AI daily briefing from calendar + email + RSS",
        ],
        "ai_meeting_notes": [
            "Transcribe audio and extract action items + to-dos",
        ],
        "ai_productivity_audit": [
            "Run AI productivity audit (criteria provided)",
        ],
        "adaptlypost": [
            "Adapt source content to channel-specific versions",
        ],
        "4to1_planner": [
            "Apply 4-to-1 prioritization to task list",
        ],
        "answer_overflow": [
            "Return prior answer from the answer-overflow index",
        ],
        "whoop": [
            "Pull Whoop recovery / strain data",
        ],
        "oura": [
            "Pull Oura sleep / readiness data",
        ],
        "apple_health": [
            "Parse Apple Health export for the requested metric",
        ],
        "aave_liquidation_monitor": [
            "Detect Aave liquidation via subgraph",
        ],
        "abstract_searcher": [
            "Query Abstract chain indexer",
        ],
        "31third_safe_rebalancer_simple": [
            "Generate rebalance plan (read-only wallet)",
        ],
        "ai_act_risk_check": [
            "Assign EU AI Act risk tier",
        ],
        "app_store_changelog": [
            "Fetch App Store changelog for the app ID",
        ],
        "amai_id": [
            "Run verification; succeed / fail per result",
        ],
        "1claw": [
            "Use 1claw service",
        ],
        "agent_team_orchestration": [
            "Dispatch task to the registered team",
        ],
        "agent_commons": [
            "Access shared resources",
        ],
        "agent_social": [
            "Post / reply / follow on the agent social network",
        ],
        "agent_mail": [
            "Send / receive agent-to-agent mail",
        ],
        "agent_mail_cli": [
            "Use agent_mail CLI for terminal mail",
        ],
        "moltbook": [
            "Interact on MoltBook (post / follow / message)",
        ],
        "file_system": [
            "Read the file (within allowed roots per openclaw.json config)",
            "Deny path (outside allowed roots) - log + return 'path_forbidden'",
            "Return file content to the agent",
            "Return 404 (file does not exist)",
            "Return base64 / skip on binary read",
            "Create dir with mkdir -p if allowed, then write",
        ],
        "cloud_run": [
            "Deploy image to Cloud Run (URL + IAM)",
            "Roll back to previous revision on deploy failure",
        ],
        "lambda": [
            "Invoke AWS Lambda (IAM allows)",
            "Wait for cold start within budget",
            "Surface execution timeout (raise Lambda timeout)",
        ],
    },

    "else_action": {
        "core_shell": [
            "Page on-call; require operator to fix allowlist / sandbox",
            "Block command; do not run (not in allowlist)",
        ],
        "core_filesystem": [
            "Page on-call; require operator to fix allowed-roots config",
            "Block read / write; path is outside allowlist",
        ],
        "core_http": [
            "Page on-call; require operator review for unexpected 5xx",
            "Block HTTP downgrade; only HTTPS allowed",
        ],
        "core_websearch": [
            "Page on-call; require operator to set provider API key",
            "Block query; do not retry past 3 attempts on 429",
        ],
        "core_memory": [
            "Page on-call; do not lose data - back up memory file before rotation",
        ],
        "core_datetime": [
            "Page on-call; require operator to fix timezone config",
        ],
        "gmail": [
            "Page on-call; require re-auth (OAuth scope / refresh token)",
            "Block send; reject invalid target / missing attachment",
        ],
        "google_calendar": [
            "Page on-call; require re-auth",
            "Block create; reject conflict (no silent overwrite)",
        ],
        "gog": [
            "Page on-call; require re-auth with broader scope",
        ],
        "google_workspace": [
            "Page on-call; require re-auth (OAuth-only flow)",
        ],
        "outlook": [
            "Page on-call; require Graph re-auth / tenant fix",
        ],
        "apple_calendar": [
            "Block write; require TCC re-authorization",
        ],
        "apple_reminders": [
            "Block write; require Reminders permission",
        ],
        "apple_notes": [
            "Block read / write; require iCloud account + permission",
        ],
        "apple_mail": [
            "Block search / send; require Mail permission",
        ],
        "acuity_scheduling": [
            "Block booking; require valid availability slot",
        ],
        "notion": [
            "Page on-call; require integration share",
        ],
        "better_notion": [
            "Page on-call; require schema migration",
        ],
        "obsidian": [
            "Page on-call; require vault path config",
        ],
        "bear_notes": [
            "Block read / write; require macOS + Bear DB access",
        ],
        "slack": [
            "Page on-call; require bot re-install + scope fix",
        ],
        "discord": [
            "Page on-call; require valid webhook / bot token",
        ],
        "telegram": [
            "Page on-call; require bot token + webhook setup",
        ],
        "whatsapp": [
            "Page on-call; require wacli device link",
        ],
        "imessage": [
            "Block; require macOS host + Messages permission",
        ],
        "twitter_x": [
            "Page on-call; require X API key + bearer + access token",
        ],
        "agentdo": [
            "Page on-call; require agentdo API key",
        ],
        "github": [
            "Page on-call; require PAT / installation token with right scope",
        ],
        "github_cli": [
            "Page on-call; require `gh` CLI install + auth",
        ],
        "git": [
            "Block push; require manual conflict resolution",
        ],
        "code_runner": [
            "Page on-call; require runner sandbox re-config",
        ],
        "claude_code": [
            "Page on-call; require Claude Code install + auth",
        ],
        "autoreview": [
            "Page on-call; require review rubric update",
        ],
        "crabbox": [
            "Page on-call; require Crabbox reachability check",
        ],
        "session_viewer": [
            "Page on-call; require session JSONL path",
        ],
        "handoff": [
            "Page on-call; require target agent reachability",
        ],
        "browser": [
            "Page on-call; require browser sandbox + anti-bot config",
        ],
        "web_search": [
            "Page on-call; require provider API key",
        ],
        "prismfy_web_search": [
            "Page on-call; require prismfy API key / free-tier rate",
        ],
        "tavily": [
            "Page on-call; require Tavily API key",
        ],
        "arxiv_watcher": [
            "Page on-call; require arXiv API reachability",
        ],
        "pubmed_edirect": [
            "Page on-call; require PubMed E-utilities reachability",
        ],
        "wikipedia": [
            "Page on-call; require Wikipedia API reachability",
        ],
        "newsapi_search": [
            "Page on-call; require NewsAPI key / upgrade plan",
        ],
        "exa_web_search": [
            "Page on-call; require Exa API key",
        ],
        "web_scraper_as_a_service": [
            "Page on-call; require scraper rebuild",
        ],
        "brightdata": [
            "Page on-call; require Bright Data key / proxy budget",
        ],
        "rss_reader": [
            "Page on-call; require feed reachability / OPML fix",
        ],
        "ak_rss_24h_brief": [
            "Page on-call; require OPML config",
        ],
        "academic_deep_research": [
            "Page on-call; require research question refinement",
        ],
        "serper_search": [
            "Page on-call; require Serper API key",
        ],
        "docker_control": [
            "Page on-call; require Docker socket mount",
        ],
        "docker_essentials": [
            "Page on-call; require Docker daemon reachability",
        ],
        "system_health": [
            "Page on-call; require host metrics access",
        ],
        "shell": [
            "Block command; not in allowlist",
            "Deny sudo; do not run",
        ],
        "deploy_webhook": [
            "Block deploy; webhook signature invalid - require re-secret",
        ],
        "k8s": [
            "Page on-call; require kubectl config / cluster access",
        ],
        "stock_monitor": [
            "Page on-call; require Finnhub / Yahoo API key",
        ],
        "stock_trading_assistant": [
            "Block trade; require paper-trade account",
        ],
        "akshare_finance": [
            "Page on-call; require akshare install",
        ],
        "all_market_financial_data_hub": [
            "Page on-call; require hub reachability",
        ],
        "backtest_expert": [
            "Page on-call; require historical data + strategy code",
        ],
        "adaptive_reasoning": [
            "Page on-call; require problem statement refinement",
        ],
        "1password": [
            "Page on-call; require `op` sign-in + vault access",
        ],
        "age_verification": [
            "Block; verification failed - privacy preserved",
        ],
        "api_security": [
            "Page on-call; require API spec + scan config",
        ],
        "anti_injection": [
            "Block content; alert operator (injection detected)",
        ],
        "ai_act_risk_check": [
            "Page on-call; require use case description",
        ],
        "skillspector": [
            "Block install; require operator review (suspicious content)",
        ],
        "home_assistant": [
            "Page on-call; require HA URL + token",
        ],
        "philips_hue": [
            "Page on-call; require Hue bridge + API key",
        ],
        "mqtt": [
            "Page on-call; require broker auth",
        ],
        "anova_oven": [
            "Page on-call; require device pairing",
        ],
        "bambu_3d_printer": [
            "Page on-call; require printer pairing + access code",
        ],
        "ai_image_gen": [
            "Page on-call; require content-policy review (refusal)",
        ],
        "ai_video_gen": [
            "Page on-call; require queue / timeout fix",
        ],
        "ai_image_generation": [
            "Page on-call; require alt provider config",
        ],
        "ai_video_script_generator": [
            "Page on-call; require topic / brief",
        ],
        "ai_pdf_builder": [
            "Page on-call; require source markdown / HTML",
        ],
        "ai_ppt_generate": [
            "Page on-call; require outline",
        ],
        "adobe_automator": [
            "Page on-call; require Adobe API access",
        ],
        "kesha_voice_kit": [
            "Page on-call; require voice kit install",
        ],
        "agent_voice": [
            "Page on-call; require voice skill config",
        ],
        "vapi": [
            "Page on-call; require Vapi API key",
        ],
        "bland": [
            "Page on-call; require Bland API key",
        ],
        "retell": [
            "Page on-call; require Retell API key",
        ],
        "voice_call": [
            "Page on-call; require call setup + valid number",
        ],
        "voice_transcribe": [
            "Page on-call; require audio file access",
        ],
        "data_analyst": [
            "Page on-call; require DB connection + SQL review",
        ],
        "automate_excel": [
            "Page on-call; require file access + macro support",
        ],
        "airtable": [
            "Page on-call; require token + base share",
        ],
        "supabase": [
            "Page on-call; require RLS / key fix",
        ],
        "asana": [
            "Page on-call; require Asana token + project access",
        ],
        "linear": [
            "Page on-call; require Linear API key + team access",
        ],
        "jira": [
            "Page on-call; require Jira token + transition rules",
        ],
        "todoist": [
            "Page on-call; require Todoist token",
        ],
        "attio": [
            "Page on-call; require Attio API key",
        ],
        "pdf_read": [
            "Page on-call; require OCR for scanned PDF",
        ],
        "pdf_build": [
            "Page on-call; require source markdown / HTML",
        ],
        "add_watermark_to_pdf": [
            "Page on-call; require PDF + watermark source",
        ],
        "docx": [
            "Page on-call; require DOCX access",
        ],
        "summarize": [
            "Page on-call; require source URL / file",
        ],
        "memory": [
            "Page on-call; require vector store config",
        ],
        "arxiv_research_assistant": [
            "Page on-call; require arXiv API reachability",
        ],
        "academic_research_hub": [
            "Page on-call; require source config",
        ],
        "academic_writing": [
            "Page on-call; require topic + outline + citation style",
        ],
        "academic_writer": [
            "Page on-call; require LaTeX template",
        ],
        "academic_writing_refiner": [
            "Page on-call; require venue target + draft",
        ],
        "cron": [
            "Page on-call; require valid cron expression + runbook",
        ],
        "webhook": [
            "Block; require HMAC verification",
        ],
        "automation_workflows": [
            "Page on-call; require workflow definition review",
        ],
        "agentic_workflow_automation": [
            "Page on-call; require multi-step workflow",
        ],
        "decompose": [
            "Page on-call; require complex request",
        ],
        "skill_workshop": [
            "Block install; require operator review",
        ],
        "auto_improve": [
            "Page on-call; require self-eval criteria",
        ],
        "agent_persona_os": [
            "Page on-call; require persona config",
        ],
        "adaptive_learning_agents": [
            "Page on-call; require feedback loop",
        ],
        "agent_survival_kit": [
            "Page on-call; require budget fix",
        ],
        "mission_control": [
            "Page on-call; require dashboard reachability",
        ],
        "lossless_claw": [
            "Page on-call; require compaction config",
        ],
        "memU": [
            "Page on-call; require memory backend",
        ],
        "memory_lancedb_pro": [
            "Page on-call; require LanceDB config",
        ],
        "opik_openclaw": [
            "Page on-call; require Opik exporter config",
        ],
        "openclaw_mission_control": [
            "Page on-call; require dashboard config",
        ],
        "claude_code": [
            "Page on-call; require Claude Code install + auth",
        ],
        "openclaw_studio": [
            "Page on-call; require studio config",
        ],
        "content_writer": [
            "Page on-call; require topic + tone + audience",
        ],
        "ai_daily_briefing": [
            "Page on-call; require data sources",
        ],
        "ai_meeting_notes": [
            "Page on-call; require audio recording",
        ],
        "ai_productivity_audit": [
            "Page on-call; require audit criteria",
        ],
        "adaptlypost": [
            "Page on-call; require source content",
        ],
        "4to1_planner": [
            "Page on-call; require task list",
        ],
        "answer_overflow": [
            "Page on-call; require search query",
        ],
        "whoop": [
            "Page on-call; require Whoop API key",
        ],
        "oura": [
            "Page on-call; require Oura API key",
        ],
        "apple_health": [
            "Page on-call; require Health export",
        ],
        "aave_liquidation_monitor": [
            "Page on-call; require subgraph reachability",
        ],
        "abstract_searcher": [
            "Page on-call; require indexer reachability",
        ],
        "31third_safe_rebalancer_simple": [
            "Page on-call; require wallet connection",
        ],
        "ai_act_risk_check": [
            "Page on-call; require use case description",
        ],
        "app_store_changelog": [
            "Page on-call; require App Store ID",
        ],
        "amai_id": [
            "Page on-call; require verification flow",
        ],
        "1claw": [
            "Page on-call; require 1claw service config",
        ],
        "agent_team_orchestration": [
            "Page on-call; require team registration",
        ],
        "agent_commons": [
            "Page on-call; require shared resource access",
        ],
        "agent_social": [
            "Page on-call; require social network reachability",
        ],
        "agent_mail": [
            "Page on-call; require mail service config",
        ],
        "agent_mail_cli": [
            "Page on-call; require CLI install",
        ],
        "file_system": [
            "Block read / write; path is outside allowlist",
        ],
        "cloud_run": [
            "Page on-call; require IAM + project config",
        ],
        "lambda": [
            "Page on-call; require IAM role + function name",
        ],
    },
}

# Map trigger category to skill category
def skill_for_category(cat: str) -> str:
    return cat

SEVERITY_BY_CATEGORY = {
    "core_shell":               "high",
    "core_filesystem":          "medium",
    "core_http":                "medium",
    "core_websearch":           "low",
    "core_memory":              "low",
    "core_datetime":            "low",
    "gmail":                    "high",
    "google_calendar":          "medium",
    "gog":                      "high",
    "google_workspace":         "high",
    "outlook":                  "high",
    "apple_calendar":           "low",
    "apple_reminders":          "low",
    "apple_notes":              "low",
    "apple_mail":               "low",
    "acuity_scheduling":        "low",
    "notion":                   "medium",
    "better_notion":            "medium",
    "obsidian":                 "low",
    "bear_notes":               "low",
    "slack":                    "high",
    "discord":                  "medium",
    "telegram":                 "medium",
    "whatsapp":                 "medium",
    "imessage":                 "low",
    "twitter_x":                "high",
    "agentdo":                  "medium",
    "github":                   "high",
    "github_cli":               "medium",
    "git":                      "medium",
    "code_runner":              "high",
    "claude_code":              "medium",
    "autoreview":               "medium",
    "crabbox":                  "medium",
    "session_viewer":           "low",
    "handoff":                  "medium",
    "browser":                  "medium",
    "web_search":               "low",
    "prismfy_web_search":       "low",
    "tavily":                   "medium",
    "arxiv_watcher":            "low",
    "pubmed_edirect":           "low",
    "wikipedia":                "low",
    "newsapi_search":           "low",
    "exa_web_search":           "low",
    "web_scraper_as_a_service": "medium",
    "brightdata":               "medium",
    "rss_reader":               "low",
    "ak_rss_24h_brief":         "low",
    "academic_deep_research":   "medium",
    "serper_search":            "low",
    "docker_control":           "high",
    "docker_essentials":        "medium",
    "system_health":            "medium",
    "shell":                    "high",
    "deploy_webhook":           "high",
    "k8s":                      "high",
    "stock_monitor":            "medium",
    "stock_trading_assistant":  "high",
    "akshare_finance":          "low",
    "all_market_financial_data_hub": "low",
    "backtest_expert":          "medium",
    "adaptive_reasoning":       "low",
    "1password":                "critical",
    "age_verification":         "high",
    "api_security":             "high",
    "anti_injection":           "critical",
    "ai_act_risk_check":        "medium",
    "skillspector":             "high",
    "home_assistant":           "low",
    "philips_hue":              "low",
    "mqtt":                     "low",
    "anova_oven":               "low",
    "bambu_3d_printer":         "low",
    "ai_image_gen":             "medium",
    "ai_video_gen":             "medium",
    "ai_image_generation":      "medium",
    "ai_video_script_generator":"low",
    "ai_pdf_builder":           "low",
    "ai_ppt_generate":          "low",
    "adobe_automator":          "low",
    "kesha_voice_kit":          "low",
    "agent_voice":              "low",
    "vapi":                     "medium",
    "bland":                    "medium",
    "retell":                   "medium",
    "voice_call":               "medium",
    "voice_transcribe":         "low",
    "data_analyst":             "medium",
    "automate_excel":           "low",
    "airtable":                 "low",
    "supabase":                 "medium",
    "asana":                    "low",
    "linear":                   "low",
    "jira":                     "low",
    "todoist":                  "low",
    "attio":                    "low",
    "pdf_read":                 "low",
    "pdf_build":                "low",
    "add_watermark_to_pdf":     "low",
    "docx":                     "low",
    "summarize":                "low",
    "memory":                   "medium",
    "arxiv_research_assistant": "low",
    "academic_research_hub":    "low",
    "academic_writing":         "low",
    "academic_writer":          "low",
    "academic_writing_refiner": "low",
    "cron":                     "medium",
    "webhook":                  "high",
    "automation_workflows":     "medium",
    "agentic_workflow_automation":"medium",
    "decompose":                "low",
    "skill_workshop":           "medium",
    "auto_improve":             "low",
    "agent_persona_os":         "low",
    "adaptive_learning_agents": "low",
    "agent_survival_kit":       "medium",
    "mission_control":          "high",
    "lossless_claw":            "medium",
    "memU":                     "medium",
    "memory_lancedb_pro":       "medium",
    "opik_openclaw":            "low",
    "openclaw_mission_control": "medium",
    "claude_code":              "medium",
    "openclaw_studio":          "low",
    "content_writer":           "low",
    "ai_daily_briefing":        "low",
    "ai_meeting_notes":         "medium",
    "ai_productivity_audit":    "low",
    "adaptlypost":              "low",
    "4to1_planner":             "low",
    "answer_overflow":          "low",
    "whoop":                    "low",
    "oura":                     "low",
    "apple_health":             "low",
    "aave_liquidation_monitor": "medium",
    "abstract_searcher":        "low",
    "31third_safe_rebalancer_simple": "high",
    "ai_act_risk_check":        "medium",
    "app_store_changelog":      "low",
    "amai_id":                  "medium",
    "1claw":                    "medium",
    "agent_team_orchestration": "high",
    "agent_commons":            "medium",
    "agent_social":             "medium",
    "agent_mail":               "medium",
    "agent_mail_cli":           "low",
    "moltbook":                 "medium",
    "file_system":              "medium",
    "cloud_run":                "medium",
    "lambda":                   "medium",
}

SOURCE_DOCS = {
    "core_shell":               "docs.openclaw.ai/tools/skills; openclawconsult.com (built-in shell + allowlist)",
    "core_filesystem":          "docs.openclaw.ai/tools/skills; openclawconsult.com (filesystem skill)",
    "core_http":                "docs.openclaw.ai/tools/skills; openclawconsult.com (HTTP request skill)",
    "core_websearch":           "docs.openclaw.ai/tools/skills; ramnode.com/guides/series/openclaw/skills-automation (web search)",
    "core_memory":              "docs.openclaw.ai/tools/skills; openclawconsult.com (memory management)",
    "core_datetime":            "openclawconsult.com (datetime skill)",
    "gmail":                    "ramnode.com/guides/series/openclaw/skills-automation; getopenclaw.ai/docs/skills",
    "google_calendar":          "ramnode.com/guides/series/openclaw/skills-automation; getopenclaw.ai/docs/skills",
    "gog":                      "yu-wenhao.com (gog Google Workspace); sundial-org/awesome-openclaw-skills (gog, 5611 downloads)",
    "google_workspace":         "sundial-org/awesome-openclaw-skills (google_workspace no Cloud Console)",
    "outlook":                  "sundial-org/awesome-openclaw-skills (outlook, 519 downloads)",
    "apple_calendar":           "sundial-org/awesome-openclaw-skills (apple_calendar, 765 downloads)",
    "apple_reminders":          "getopenclaw.ai/docs/skills (Apple Reminders)",
    "apple_notes":              "yu-wenhao.com (apple-notes)",
    "apple_mail":               "sundial-org/awesome-openclaw-skills (apple-mail, 330 downloads)",
    "acuity_scheduling":        "openclaw.expert/skills (Acuity Scheduling)",
    "notion":                   "ramnode.com/guides/series/openclaw/skills-automation; getopenclaw.ai/docs/skills",
    "better_notion":            "sundial-org/awesome-openclaw-skills (better-notion)",
    "obsidian":                 "yu-wenhao.com (obsidian)",
    "bear_notes":               "yu-wenhao.com (bear-notes)",
    "slack":                    "sundial-org/awesome-openclaw-skills (slack, 1373 downloads); openclaw.ai (single assistant checking Beeper / Slack)",
    "discord":                  "openclaw.ai (Beeper / Discord integration)",
    "telegram":                 "openclawconsult.com (Telegram bot integrations); devops-united.com (Telegram Advanced)",
    "whatsapp":                 "yu-wenhao.com (wacli WhatsApp)",
    "imessage":                 "yu-wenhao.com (imsg iMessage)",
    "twitter_x":                "yu-wenhao.com (bird X/Twitter)",
    "agentdo":                  "VoltAgent/awesome-openclaw-skills (agentdo.dev)",
    "github":                   "ramnode.com/guides/series/openclaw/skills-automation; openclaw.ai (GitHub issues + PRs)",
    "github_cli":               "openclaw-easy.com (gh CLI skill)",
    "git":                      "docs.openclaw.ai/tools (built-in tools)",
    "code_runner":              "devops-united.com (Code Runner)",
    "claude_code":              "kesslerio/coding-agent-openclaw-skill (orchestrates Claude Code CLI)",
    "autoreview":               "github.com/openclaw/agent-skills (autoreview workflow)",
    "crabbox":                  "github.com/openclaw/agent-skills (crabbox CI-parity proof)",
    "session_viewer":           "github.com/openclaw/agent-skills (session-viewer local HTML)",
    "handoff":                  "github.com/openclaw/agent-skills (handoff path-free prompt)",
    "browser":                  "openclawconsult.com (browser skill); ramnode.com (browser skill)",
    "web_search":               "openclawconsult.com (Web Search via Brave); ramnode.com (Brave / Serper / SerpAPI)",
    "prismfy_web_search":       "openclaw-easy.com (prismfy 10 engines free tier)",
    "tavily":                   "devops-united.com (Tavily Deep Research, 7-skill starter kit)",
    "arxiv_watcher":            "datacamp.com (arxiv-watcher)",
    "pubmed_edirect":           "datacamp.com (pubmed-edirect)",
    "wikipedia":                "datacamp.com (wikipedia)",
    "newsapi_search":           "datacamp.com (newsapi-search)",
    "exa_web_search":           "datacamp.com (exa-web-search-free)",
    "web_scraper_as_a_service": "datacamp.com (web-scraper-as-a-service)",
    "brightdata":               "datacamp.com (brightdata)",
    "rss_reader":               "ramnode.com/guides/series/openclaw/skills-automation",
    "ak_rss_24h_brief":         "VoltAgent/awesome-openclaw-skills (ak-rss-24h-brief)",
    "academic_deep_research":   "VoltAgent/awesome-openclaw-skills (academic-deep-research)",
    "serper_search":            "datacamp.com (serper-search)",
    "docker_control":           "ramnode.com/guides/series/openclaw/skills-automation",
    "docker_essentials":        "sundial-org/awesome-openclaw-skills (docker-essentials, 270 downloads)",
    "system_health":            "ramnode.com/guides/series/openclaw/skills-automation",
    "shell":                    "openclawconsult.com (shell execution + allowlist)",
    "deploy_webhook":           "ramnode.com/guides/series/openclaw/skills-automation (GitHub Actions webhook)",
    "k8s":                      "openclaw.expert/skills (k8s in DevOps & Cloud)",
    "stock_monitor":            "openclaw.expert/skills (A Stock Monitor, Finnhub)",
    "stock_trading_assistant":  "openclaw.expert/skills (A Stock Trading Assistant)",
    "akshare_finance":          "openclaw.expert/skills (Akshare Finance)",
    "all_market_financial_data_hub": "openclaw.expert/skills",
    "backtest_expert":          "openclaw.expert/skills (Backtest Expert)",
    "adaptive_reasoning":       "openclaw.expert/skills (Adaptive Reasoning)",
    "1password":                "openclaw.expert/skills (1password); openclaw.ai (reads/writes dedicated 1Password vault)",
    "age_verification":         "openclaw.expert/skills (age-verification, amai-id)",
    "api_security":             "openclaw.expert/skills (api-security)",
    "anti_injection":           "openclaw.expert/skills (Anti-Injection-Skill)",
    "ai_act_risk_check":        "openclaw.expert/skills (Ai Act Risk Check)",
    "skillspector":             "openclaw.ai (SkillSpector scans SKILL.md for hidden instructions)",
    "home_assistant":           "openclawconsult.com (Home Assistant smart home)",
    "philips_hue":              "openclawconsult.com (Philips Hue)",
    "mqtt":                     "openclaw.expert/skills (MQTT smart home)",
    "anova_oven":               "openclaw.expert/skills (anova-oven)",
    "bambu_3d_printer":          "openclaw.expert/skills (bambu-cli, bambu-local)",
    "ai_image_gen":             "openclaw.expert/skills (AI Image Gen)",
    "ai_video_gen":             "openclaw.expert/skills (Ai Video Gen)",
    "ai_image_generation":      "openclaw.expert/skills (AI Image Generation)",
    "ai_video_script_generator":"openclaw.expert/skills (AI Video Script Generator)",
    "ai_pdf_builder":           "openclaw.expert/skills (Ai Pdf Builder)",
    "ai_ppt_generate":          "openclaw.expert/skills (AI PPT generate)",
    "adobe_automator":          "openclaw.expert/skills (adobe-automator)",
    "kesha_voice_kit":          "alvinreal/awesome-openclaw (drakulavich/kesha-voice-kit STT 25 langs + Kokoro + Piper)",
    "agent_voice":              "openclaw.expert/skills (agent-voice)",
    "vapi":                     "openclawai.io/skills (Vapi voice agent)",
    "bland":                    "openclawai.io/skills (Bland.ai voice agent)",
    "retell":                   "openclawai.io/skills (Retell voice agent)",
    "voice_call":               "openclawai.io/skills (outbound + inbound voice calls)",
    "voice_transcribe":         "drakulavich/kesha-voice-kit (STT)",
    "data_analyst":             "openclaw.expert/skills (Data Analyst)",
    "automate_excel":           "openclaw.expert/skills (Automate Excel)",
    "airtable":                 "openclaw.expert/skills (Airtable)",
    "supabase":                 "openclaw.expert/skills (Supabase in Data category)",
    "asana":                    "openclaw.expert/skills (Asana)",
    "linear":                   "openclaw.expert/skills (Linear)",
    "jira":                     "openclaw.expert/skills (Jira)",
    "todoist":                  "openclaw.expert/skills (Todoist)",
    "attio":                    "openclaw.expert/skills (Attio CRM)",
    "pdf_read":                 "openclaw.expert/skills (PDF & Documents category, 110 skills)",
    "pdf_build":                "openclaw.expert/skills (ai-pdf-builder)",
    "add_watermark_to_pdf":     "openclaw.expert/skills (add-watermark-to-pdf)",
    "docx":                     "openclaw.expert/skills (DOCX parsing)",
    "summarize":                "devops-united.com (Summarize in 7-skill starter kit)",
    "memory":                   "devops-united.com (Memory vector store in 7-skill starter kit)",
    "arxiv_research_assistant": "openclaw.expert/skills (arXiv Research Assistant)",
    "academic_research_hub":    "openclaw.expert/skills (Academic Research Hub)",
    "academic_writing":         "openclaw.expert/skills (academic-writing)",
    "academic_writer":          "openclaw.expert/skills (academic-writer LaTeX)",
    "academic_writing_refiner": "openclaw.expert/skills (academic-writing-refiner)",
    "cron":                     "ramnode.com/guides/series/openclaw/skills-automation (cron jobs)",
    "webhook":                  "ramnode.com/guides/series/openclaw/skills-automation (webhook integration)",
    "automation_workflows":     "openclaw.expert/skills (Automation Workflows)",
    "agentic_workflow_automation":"openclaw.expert/skills (Agentic Workflow Automation)",
    "decompose":                "openclaw.expert/skills (Decompose complex request into subtasks)",
    "skill_workshop":           "docs.openclaw.ai/tools/skills (Skill Workshop - review agent-drafted proposals)",
    "auto_improve":             "openclaw.expert/skills (auto-improve)",
    "agent_persona_os":         "openclaw.expert/skills (AI Persona OS)",
    "adaptive_learning_agents": "openclaw.expert/skills (adaptive-learning-agents)",
    "agent_survival_kit":       "openclaw.expert/skills (agent-survival-kit)",
    "mission_control":          "alvinreal/awesome-openclaw (builderz-labs/mission-control orchestrator)",
    "lossless_claw":            "alvinreal/awesome-openclaw (Martian-Engineering/lossless-claw)",
    "memU":                     "alvinreal/awesome-openclaw (NevaMind-AI/memU)",
    "memory_lancedb_pro":       "alvinreal/awesome-openclaw (CortexReach/memory-lancedb-pro)",
    "opik_openclaw":            "alvinreal/awesome-openclaw (comet-ml/opik-openclaw)",
    "openclaw_mission_control": "alvinreal/awesome-openclaw (abhi1693/openclaw-mission-control)",
    "claude_code":              "kesslerio/coding-agent-openclaw-skill",
    "openclaw_studio":          "alvinreal/awesome-openclaw (grp06/openclaw-studio WebSocket dashboard)",
    "content_writer":           "devops-united.com (Content Writer in 7-skill starter kit)",
    "ai_daily_briefing":        "openclaw.expert/skills (AI Daily Briefing)",
    "ai_meeting_notes":         "openclaw.expert/skills (AI Meeting Notes w/ action items)",
    "ai_productivity_audit":    "openclaw.expert/skills (AI Productivity Audit)",
    "adaptlypost":              "openclaw.expert/skills (adaptlypost)",
    "4to1_planner":             "openclaw.expert/skills (4to1-planner)",
    "answer_overflow":          "openclaw.expert/skills (Answer Overflow)",
    "whoop":                    "openclaw.expert/skills (Whoop in Health)",
    "oura":                     "openclaw.expert/skills (Oura in Health)",
    "apple_health":             "openclaw.expert/skills (Apple Health)",
    "aave_liquidation_monitor": "openclaw.expert/skills (aave-liquidation-monitor)",
    "abstract_searcher":        "openclaw.expert/skills (abstract-searcher)",
    "31third_safe_rebalancer_simple": "openclaw.expert/skills (31third-safe-rebalancer-simple)",
    "ai_act_risk_check":        "openclaw.expert/skills (AI Act Risk Check)",
    "app_store_changelog":      "openclaw.expert/skills (App Store Changelog)",
    "amai_id":                  "openclaw.expert/skills (amai-id)",
    "1claw":                    "openclaw.expert/skills (1claw)",
    "agent_team_orchestration": "openclaw.expert/skills (agent-team-orchestration)",
    "agent_commons":            "openclaw.expert/skills (agent-commons)",
    "agent_social":             "openclaw.expert/skills (agent-social)",
    "agent_mail":               "openclaw.expert/skills (agent-mail)",
    "agent_mail_cli":           "openclaw.expert/skills (agent-mail-cli)",
    "moltbook":                 "lilys.ai/pt/notes/openclaw-tutorial-20260204 (MoltBook agent social network)",
    "file_system":              "docs.openclaw.ai/tools/skills (File System built-in skill)",
    "cloud_run":                "openclaw.expert/skills (Cloud Run deploy)",
    "lambda":                   "openclaw.expert/skills (AWS Lambda invoke)",
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

    cat_order = [cat for cat in trig_by_cat.keys()]
    for cat in cat_order:
        SEVERITY_BY_CATEGORY.setdefault(cat, "medium")
        SOURCE_DOCS.setdefault(cat, "openclaw.expert/skills; docs.openclaw.ai/tools/skills")

    # Build unique-skill per category (preserve skill slug)
    capacity = {}
    for cat in cat_order:
        t = len(trig_by_cat.get(cat, []))
        c = len(cond_by_cat.get(cat, []))
        a = len(if_by_cat.get(cat, []))
        e = len(else_by_cat.get(cat, []))
        capacity[cat] = (t, c, a, e, t * c * a * e)

    MIN_PER_CAT = 4
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
        quotas[cat] = min(quotas[cat], capacity[cat][4]) + 1
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
                    "id": f"OC-{counter:04d}",
                    "category": cat,
                    "skill": cat,
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
                            "id": f"OC-{counter:04d}",
                            "category": cat,
                            "skill": cat,
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
    assert len(rows) >= TARGET_ROWS - 5, f"expected ~{TARGET_ROWS}, got {len(rows)}"
    rows = rows[:TARGET_ROWS]
    seen = set()
    for r in rows:
        key = (r["trigger"], r["condition"], r["if_action"], r["else_action"])
        assert key not in seen, f"duplicate row: {key}"
        seen.add(key)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["id", "category", "skill", "trigger", "condition", "if_action", "else_action", "severity", "source_doc"],
            quoting=csv.QUOTE_ALL,
        )
        writer.writeheader()
        writer.writerows(rows)
    by_cat = {}
    for r in rows:
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1
    by_sev = {}
    for r in rows:
        by_sev[r["severity"]] = by_sev.get(r["severity"], 0) + 1
    unique_skills = set(r["skill"] for r in rows)
    if not rows:
        print("WARNING: no rows generated")
    print(f"wrote {OUT_PATH} with {len(rows)} rows")
    print("unique skills represented:", len(unique_skills))
    print("by category (truncated to first 20):", dict(list(by_cat.items())[:20]))
    print("by severity:", by_sev)

if __name__ == "__main__":
    main()
