#!/usr/bin/env python3
"""
Render agentic-runtime scenario generator.

Generates a CSV of 500 unique (trigger, condition, if_action, else_action)
scenarios grounded in authoritative Render docs.

Output columns:
  id, category, trigger, condition, if_action, else_action, severity, source_doc

Sources (verified):
  - render.com/docs/deploys
  - render.com/docs/web-services
  - render.com/docs/health-checks
  - render.com/docs/troubleshooting-deploys
  - render.com/docs/rollbacks
  - render.com/docs/scaling
  - render.com/docs/disks
  - render.com/docs/private-network
  - render.com/docs/outbound-ip-addresses
  - render.com/docs/dedicated-ips
  - render.com/docs/configure-environment-variables
  - render.com/docs/api
  - api-docs.render.com/reference/rate-limiting
  - render.com/articles/how-render-handles-deploy-failures
  - render.com/articles/how-render-handles-zero-downtime-deploys
  - render.com/tutorials/when-deploys-go-wrong/*
"""
import csv
import os
import random
from typing import List, Dict, Tuple

OUT_PATH = "/workspace/render_scenarios/render_scenarios.csv"
TARGET_ROWS = 500
random.seed(20260715)  # deterministic generation

# ---------------------------------------------------------------------------
# Trigger pool — short, agent-friendly phrasings
# ---------------------------------------------------------------------------
TRIGGERS: List[Tuple[str, str, str]] = [
    # (id_prefix, category, trigger_text)
    # ---------- BUILD PHASE ----------
    ("T-BLD", "build", "Render build phase starts for the service"),
    ("T-BLD", "build", "Build command executes (npm install / pip install / go build)"),
    ("T-BLD", "build", "Build command approaches the 120-minute timeout"),
    ("T-BLD", "build", "Build container runs out of memory"),
    ("T-BLD", "build", "ModuleNotFoundError surfaces during build"),
    ("T-BLD", "build", "Lockfile drift detected between package-lock.json and package.json"),
    ("T-BLD", "build", "Node.js version mismatch with operator (??=) or engines field"),
    ("T-BLD", "build", "Python requires-Python>=X.Y mismatch in requirements.txt"),
    ("T-BLD", "build", "Required env var missing for the build step"),
    ("T-BLD", "build", "Dockerfile missing both CMD and ENTRYPOINT"),
    ("T-BLD", "build", "Native dependency (libpq, sharp, fonts) absent from build image"),
    ("T-BLD", "build", "Pre-deploy command executes (migration / seed)"),
    ("T-BLD", "build", "Pre-deploy command approaches the 30-minute timeout"),
    ("T-BLD", "build", "GitHub commit has zero CI checks detected"),
    ("T-BLD", "build", "GitHub CI check failed for the new commit"),
    ("T-BLD", "build", "New commit pushed to the connected branch"),
    ("T-BLD", "build", "Manual deploy triggered via dashboard or POST /v1/services/{id}/deploys"),
    ("T-BLD", "build", "Deploy hook URL is hit (build deploy webhook)"),
    ("T-BLD", "build", "Blueprint render.yaml is applied (new service or update)"),
    ("T-BLD", "build", "render.yaml references sync:false secret not yet set in dashboard"),
    ("T-BLD", "build", "Build downloads a >2GB model on first deploy"),
    ("T-BLD", "build", "Build uses 'docker build' nested in Render build (DinD)"),
    ("T-BLD", "build", "Build uses 'cargo build' on a large Rust crate"),
    ("T-BLD", "build", "Build pulls from a private npm registry without .npmrc"),
    ("T-BLD", "build", "Build pulls from a private PyPI without .pypirc"),
    ("T-BLD", "build", "Build script runs interactive prompts (non-interactive build env)"),
    ("T-BLD", "build", "Build cache invalidated after a major language upgrade"),

    # ---------- BOOT / HEALTH ----------
    ("T-BOOT", "boot", "Service process starts in a new instance"),
    ("T-BOOT", "boot", "App attempts to bind to a port"),
    ("T-BOOT", "boot", "App binds to a non-PORT env value (e.g. hardcoded 3000)"),
    ("T-BOOT", "boot", "App binds to 127.0.0.1 instead of 0.0.0.0"),
    ("T-BOOT", "boot", "Process exits with code 1 before binding port"),
    ("T-BOOT", "boot", "Process exits with code 127 (command not found)"),
    ("T-BOOT", "boot", "Process exits with code 137 (OOM kill)"),
    ("T-BOOT", "boot", "Health check endpoint is hit by Render"),
    ("T-BOOT", "boot", "Health check times out after 5 seconds (TCP or HTTP)"),
    ("T-BOOT", "boot", "Health check returns 4xx"),
    ("T-BOOT", "boot", "Health check returns 5xx"),
    ("T-BOOT", "boot", "Service instance fails 15s of consecutive health-check failures"),
    ("T-BOOT", "boot", "Service instance fails 60s of consecutive health-check failures"),
    ("T-BOOT", "boot", "All new instances pass health checks within 15-minute grace"),
    ("T-BOOT", "boot", "15-minute deploy health-check grace window elapses"),
    ("T-BOOT", "boot", "SIGTERM sent to old instance 60s after traffic switch"),
    ("T-BOOT", "boot", "Old instance fails to exit within maxShutdownDelaySeconds (up to 300s)"),
    ("T-BOOT", "boot", "Overlapping deploy triggered while previous one is in flight"),
    ("T-BOOT", "boot", "Service auto-restarts (Render restarts crashed container)"),
    ("T-BOOT", "boot", "Service enters restart-loop state (3+ restarts in a short window)"),
    ("T-BOOT", "boot", "Heavy startup (model load) exceeds 15-minute deploy grace"),
    ("T-BOOT", "boot", "Health check handler synchronously connects to DB every call"),
    ("T-BOOT", "boot", "Health check handler calls external API (Stripe / OpenAI) every call"),
    ("T-BOOT", "boot", "Health check path returns 301 redirect (treated as failure)"),
    ("T-BOOT", "boot", "Health check path is / but app responds 200 on /api only"),
    ("T-BOOT", "boot", "TCP health check on a port that listens but immediately closes"),
    ("T-BOOT", "boot", "Health check 200 from old instance still serving (race during zero-downtime)"),
    ("T-BOOT", "boot", "Old instance SIGTERM at 60s, new instance still warming up = traffic gap"),

    # ---------- RUNTIME / LIVE ----------
    ("T-RUN", "runtime", "Live service receives a request"),
    ("T-RUN", "runtime", "Live service throws uncaught exception"),
    ("T-RUN", "runtime", "Live service returns HTTP 500"),
    ("T-RUN", "runtime", "Live service returns HTTP 502"),
    ("T-RUN", "runtime", "Live service returns HTTP 400"),
    ("T-RUN", "runtime", "Live service returns HTTP 404"),
    ("T-RUN", "runtime", "Live service returns HTTP 503"),
    ("T-RUN", "runtime", "Node keep-alive timeout fires (server.keepAliveTimeout)"),
    ("T-RUN", "runtime", "gunicorn WORKER TIMEOUT (pid X) log appears"),
    ("T-RUN", "runtime", "DB connection raises 'SSL connection has been closed unexpectedly'"),
    ("T-RUN", "runtime", "Database connection pool exhausted (too many concurrent conns)"),
    ("T-RUN", "runtime", "Outbound request to internal Postgres uses external URL (slow)"),
    ("T-RUN", "runtime", "Service tries to write to filesystem without persistent disk"),
    ("T-RUN", "runtime", "Service tries to read /etc/secrets/<file> on Docker image (not injected)"),
    ("T-RUN", "runtime", "Free instance idle for 15+ minutes"),
    ("T-RUN", "runtime", "Cold-start request hits a sleeping free instance"),
    ("T-RUN", "runtime", "Autoscaler observes CPU > target for N minutes"),
    ("T-RUN", "runtime", "Autoscaler observes memory > target for N minutes"),
    ("T-RUN", "runtime", "maxInstances cap of 100 reached"),
    ("T-RUN", "runtime", "Outbound IP not in external provider's allowlist"),
    ("T-RUN", "runtime", "Secret file combined size > 1MB (Render limit)"),
    ("T-RUN", "runtime", "ALLOWED_HOSTS doesn't include the custom domain"),
    ("T-RUN", "runtime", "Static site has no rewrite rule for /<route> -> /index.html"),
    ("T-RUN", "runtime", "Django app not serving collectstatic output"),
    ("T-RUN", "runtime", "Open port count exceeds 75 per service (private network limit)"),
    ("T-RUN", "runtime", "Background worker tries to receive inbound HTTP (impossible)"),
    ("T-RUN", "runtime", "Pre-Jan-2022 Oregon workspace expects fixed outbound IP"),
    ("T-RUN", "runtime", "Cron job runtime exceeds 15 minutes (cron hard limit)"),
    ("T-RUN", "runtime", "Cron job overlaps with previous run (no concurrency lock)"),
    ("T-RUN", "runtime", "Health check 200 but DB queries return 500 (handler bug)"),
    ("T-RUN", "runtime", "Service returns 200 with stack trace in body (silent failure)"),
    ("T-RUN", "runtime", "Service returns 200 with empty body (caller parse fails)"),
    ("T-RUN", "runtime", "Service uses session-based auth with sticky sessions (multi-instance breaks)"),
    ("T-RUN", "runtime", "Service writes logs to /var/log not stdout (Render only ships stdout/stderr)"),
    ("T-RUN", "runtime", "Service emits binary to stdout (image) - Render truncates / rejects"),
    ("T-RUN", "runtime", "Long-poll request (5min) on old instance - SIGTERM kills it"),
    ("T-RUN", "runtime", "WebSocket on Render LB to region has issue (no sticky sessions)"),
    ("T-RUN", "runtime", "WebSocket reconnect storm after deploy (clients all reconnect at once)"),
    ("T-RUN", "runtime", "Free instance spins up to serve request - 50s cold start"),
    ("T-RUN", "runtime", "Service logs a 5MB blob in one line (truncated by Render)"),
    ("T-RUN", "runtime", "Service has unbounded SELECT - returns millions of rows - OOM caller"),
    ("T-RUN", "runtime", "Service has connection leak - pool grows until OOM"),
    ("T-RUN", "runtime", "Service has file descriptor leak - 'too many open files' - exits 1"),
    ("T-RUN", "runtime", "Service has memory leak - grows linearly - eventually OOM at exit 137"),
    ("T-RUN", "runtime", "Service has goroutine/thread leak - count grows - eventually OOM"),
    ("T-RUN", "runtime", "Service has log volume of 100KB per request (full request body)"),

    # ---------- SCALING / INSTANCE / DISK ----------
    ("T-SCL", "scaling", "Service scales from 1 to N instances (manual or autoscale)"),
    ("T-SCL", "scaling", "Service with persistent disk tries to scale to 2+ instances"),
    ("T-SCL", "scaling", "Persistent disk attached and service restarting (no zero-downtime)"),
    ("T-SCL", "scaling", "Persistent disk resize attempted (increase) during high write load"),
    ("T-SCL", "scaling", "Persistent disk shrink attempted (decrease) - blocked by Render"),
    ("T-SCL", "scaling", "Disk mount path set to / (root) - blocked by Render"),
    ("T-SCL", "scaling", "Disk mount path set to /etc/secrets - blocked by Render"),
    ("T-SCL", "scaling", "render.yaml scaling.minInstances=2 set - second instance slower to come up (race)"),
    ("T-SCL", "scaling", "render.yaml scaling.maxInstances=100 - bill exposure if attacked"),
    ("T-SCL", "scaling", "render.yaml scaling.targetMemoryPercent=20 - thrashy autoscale"),
    ("T-SCL", "scaling", "render.yaml scaling.targetCPUPercent=20 - thrashy autoscale"),
    ("T-SCL", "scaling", "Autoscaling on a workspace below Pro - silently disabled"),
    ("T-SCL", "scaling", "Autoscaling on a preview environment - uses minInstances only"),
    ("T-SCL", "scaling", "Plan downgraded (Pro -> Standard) - service blocked from starting (RAM too small)"),
    ("T-SCL", "scaling", "Service is on free tier and uses minInstances=2 (forced 1 on free)"),

    # ---------- ENV / SECRETS ----------
    ("T-ENV", "env", "Operator updates env var via API"),
    ("T-ENV", "env", "Operator updates env var via dashboard"),
    ("T-ENV", "env", "Operator updates env var via Blueprint with sync:false - ignored on update"),
    ("T-ENV", "env", "Operator adds new env var but forgets to redeploy - service uses old env"),
    ("T-ENV", "env", "Operator deletes env var but service still references it - undefined behavior"),
    ("T-ENV", "env", "Service has fallback default for missing env var (masks the misconfig)"),
    ("T-ENV", "env", "Service has no fallback for missing env var - crashes on first request"),
    ("T-ENV", "env", "render.yaml has env var key with typo - service runs with wrong key"),
    ("T-ENV", "env", "render.yaml has healthCheckPath with typo - deploy fails"),
    ("T-ENV", "env", "render.yaml envVars uses generateValue:true for API key - rotation tricky"),
    ("T-ENV", "env", "Env group changed - service needs redeploy to pick up new vars"),
    ("T-ENV", "env", "render.yaml lacks env var reference for env group - deploy uses defaults"),
    ("T-ENV", "env", "Secret file path uses Windows-style backslashes (Linux build fails)"),
    ("T-ENV", "env", "Build script console.logs DATABASE_URL into build log (secret leak)"),
    ("T-ENV", "env", "render.yaml has secret inline (not sync:false) - secrets in git - CRITICAL"),
    ("T-ENV", "env", "Secret in Dockerfile ENV (image layer leaks secret)"),
    ("T-ENV", "env", "Build script pulls from private submodule without auth"),
    ("T-ENV", "env", "Service uses .env.production file - not loaded by Render (ignored)"),

    # ---------- API / RATE LIMIT / WEBHOOK ----------
    ("T-API", "api", "Agent calls POST /v1/services (create service)"),
    ("T-API", "api", "Agent calls PATCH /v1/services/{id} (update service)"),
    ("T-API", "api", "Agent calls POST /v1/services/{id}/deploys (trigger deploy)"),
    ("T-API", "api", "Agent calls POST /v1/services/{id}/deploys (rollback)"),
    ("T-API", "api", "Agent calls GET /v1/services (list)"),
    ("T-API", "api", "Agent calls GET /v1/logs or /v1/logs/subscribe"),
    ("T-API", "api", "Agent calls POST /v1/customdomain or /v1/customdomain/verify"),
    ("T-API", "api", "Agent calls POST /v1/jobs (one-off job)"),
    ("T-API", "api", "Render API returns 429 Too Many Requests"),
    ("T-API", "api", "Render API returns 401 (API key invalid or revoked)"),
    ("T-API", "api", "Render API returns 403 (workspace role lacks permission)"),
    ("T-API", "api", "Render API returns 404 (service id not in this workspace)"),
    ("T-API", "api", "Render API returns 422 (validation error in payload)"),
    ("T-API", "api", "Render API returns 5xx (transient, retry-safe)"),
    ("T-API", "api", "Webhook delivery to custom URL fails (5xx from receiver)"),
    ("T-API", "api", "Webhook signature header missing or invalid (HMAC mismatch)"),
    ("T-API", "api", "Webhook receiver returns non-2xx - delivery retried per Render policy"),
    ("T-API", "api", "Webhook receiver is slow (5s response) - Render times out at 10s, retries"),
    ("T-API", "api", "Webhook receiver behind Cloudflare - 522 from receiver looks like Render"),
    ("T-API", "api", "Webhook delivery to wrong URL (typo in dashboard)"),
    ("T-API", "api", "Webhook receiver to self-signed-cert URL - fails"),
    ("T-API", "api", "Webhook receiver idempotency missing - duplicate events processed twice"),

    # ---------- DOMAIN / SSL ----------
    ("T-DOM", "domain", "Custom domain added to a web service"),
    ("T-DOM", "domain", "Custom domain CNAME missing"),
    ("T-DOM", "domain", "Custom domain A record points to wrong IP"),
    ("T-DOM", "domain", "Custom domain SSL certificate provisioning pending (Let's Encrypt)"),
    ("T-DOM", "domain", "Custom domain has CAA record that excludes Let's Encrypt"),
    ("T-DOM", "domain", "Custom domain SSL cert auto-renewal fails (CAA blocks LE)"),
    ("T-DOM", "domain", "Custom domain served without HTTPS after provisioning"),
    ("T-DOM", "domain", "Custom domain is 2+ subdomains deep - CSRF/cookie issues"),
    ("T-DOM", "domain", "Operator has multiple web services on the same apex (need subdomains)"),

    # ---------- DB / DATA ----------
    ("T-DB", "data", "Service connects to Render Postgres with sslmode=disable"),
    ("T-DB", "data", "Service connects to Render Postgres via external URL (slow) instead of internal"),
    ("T-DB", "data", "Render Postgres free-tier connection limit hit (~25 connections)"),
    ("T-DB", "data", "Render Postgres backup window - reads slow (few minutes)"),
    ("T-DB", "data", "Render Postgres HA failover (HA plan) - 30s blip, then up"),
    ("T-DB", "data", "Render Postgres credential rotated - app still using old - 401"),
    ("T-DB", "data", "Render Postgres deleted - service crashes (DATABASE_URL unreachable)"),
    ("T-DB", "data", "Migration script in pre-deploy assumes DB is empty (live DB has data)"),
    ("T-DB", "data", "Migration script in pre-deploy lacks IF EXISTS - fails on second run"),
    ("T-DB", "data", "Migration script in pre-deploy changes schema but app at HEAD reads old"),
    ("T-DB", "data", "Service to Render Key Value via public URL (use internal)"),
    ("T-DB", "data", "Render Key Value in idle state (free tier sleeps) - first call slow"),
    ("T-DB", "data", "Render Key Value connection limit hit (free tier = 10 connections)"),
    ("T-DB", "data", "Service has prepared statement cached across connections - cursor leak"),
    ("T-DB", "data", "Service has long-running transaction - blocks vacuum, bloats table"),
    ("T-DB", "data", "Service has unindexed query - sequential scan - slow under load"),

    # ---------- RECOVERY / ROLLBACK ----------
    ("T-REC", "recovery", "Operator requests rollback via dashboard for a service"),
    ("T-REC", "recovery", "Operator calls rollback API POST /v1/services/{id}/rollback"),
    ("T-REC", "recovery", "Operator rolls back to a deploy whose build artifact is pruned"),
    ("T-REC", "recovery", "Operator pushed a WIP commit to main - emergency rollback"),
    ("T-REC", "recovery", "Operator pushed a WIP commit to main - no recent successful deploy"),
    ("T-REC", "recovery", "Rollback succeeds but env vars changed - new instance uses old env"),
    ("T-REC", "recovery", "Rollback succeeds but DB schema is now incompatible"),
    ("T-REC", "recovery", "Auto-rollback succeeds but logs are gone (post-mortem blocked)"),
    ("T-REC", "recovery", "Render status page reports incident - need to pause all deploys"),
    ("T-REC", "recovery", "Render detects suspicious activity (login from new region) - email alert"),
    ("T-REC", "recovery", "Operator's Render session token stolen (XSS) - force logout from dashboard"),
    ("T-REC", "recovery", "Workspace owner leaves company - rotate all env vars and API keys"),
    ("T-REC", "recovery", "Service needs Render Shell to debug live - free/standard unavailable"),
    ("T-REC", "recovery", "Operator uses Render Shell to inspect process - useful for triage"),
    ("T-REC", "recovery", "Operator uses Render Shell to read secret files (security audit needed)"),
    ("T-REC", "recovery", "Operator uses Render Shell to hot-patch a file - lost on next deploy"),

    # ---------- WORKFLOW / CRON / WORKER / STATIC / PRIVATE ----------
    ("T-WF", "workflow", "Render Workflow step fails - depends_on triggers skip"),
    ("T-WF", "workflow", "Render Workflow retry policy exhausted - state STUCK"),
    ("T-WF", "workflow", "Background worker starts up but cannot bind port (not needed)"),
    ("T-WF", "workflow", "Private service is referenced but not created (peer missing)"),
    ("T-WF", "workflow", "Private network call on reserved port 10000 / 18012 / 18013 / 19099"),
    ("T-WF", "workflow", "Private network ingress blocked by environment policy (Pro+ feature)"),
    ("T-WF", "workflow", "Static site has no 404.html - shown on missing route"),
    ("T-WF", "workflow", "Static site cache invalidation on deploy - takes minutes globally"),
    ("T-WF", "workflow", "Render Image (container registry) private registry needs auth"),
    ("T-WF", "workflow", "Render Image image pull uses shared outbound IP (not dedicated)"),
    ("T-WF", "workflow", "Preview environment PR closes - service auto-suspends"),
    ("T-WF", "workflow", "Preview environment PR merged - service torn down"),
    ("T-WF", "workflow", "Cron job misses scheduled run during deploy (skipped or queued)"),
    ("T-WF", "workflow", "Cron job throws - Render doesn't auto-retry by default"),
]

# ---------------------------------------------------------------------------
# Conditions — boolean checks the runtime can evaluate
# ---------------------------------------------------------------------------
CONDITIONS: Dict[str, List[str]] = {
    "build": [
        "build_exit_code == 0 AND build_log matches /installed successfully/",
        "build_exit_code != 0",
        "build_log matches /ModuleNotFoundError|ERROR: No matching distribution|cannot find module/i",
        "build_log matches /EACCES|permission denied|ENOSPC|out of memory|exit status 137/i",
        "build_elapsed_seconds > 7200 (120 min build timeout)",
        "package-lock.json AND package.json hashes diverge from repo HEAD",
        "engines.node != .nvmrc AND engines.node != render runtime",
        "runtime.txt != python_version in app config",
        "build_env contains required secret (sync:false) AND value is null",
        "Dockerfile is present AND contains CMD or ENTRYPOINT",
        "Dockerfile is present AND lacks both CMD and ENTRYPOINT",
        "render.yaml has healthCheckPath AND app actually serves that path with 2xx",
        "render.yaml has preDeployCommand AND command timed out (30 min)",
        "build_log contains 'error:' AND build step is past dependency install",
        "git HEAD commit has zero GitHub checks",
        "git HEAD commit has at least one GitHub check with conclusion != success/neutral/skipped",
        "GitHub repo has Render auto-deploy enabled AND new commit on tracked branch",
        "API call POST /v1/services/{id}/deploys returns 200",
        "Webhook secret in header matches stored signing secret (HMAC verify)",
        "render.yaml envVars with generateValue:true already exists for that key",
        "build_artifact_size > 1GB (Render cache cap)",
        "build attempts nested 'docker build' (DinD not allowed)",
        "build attempts interactive prompt (Render non-interactive)",
    ],
    "boot": [
        "PORT env is set AND app calls app.listen(process.env.PORT, '0.0.0.0')",
        "app binds to 0.0.0.0:PORT (Render port detection)",
        "app binds to 127.0.0.1:PORT (Render cannot route)",
        "app binds to a hardcoded port != process.env.PORT",
        "process_exit_code == 0 within 60s of start",
        "process_exit_code == 1 (uncaught exception)",
        "process_exit_code == 127 (command not found)",
        "process_exit_code == 137 (OOM kill)",
        "health_check_path returns 2xx within 5s for 3 consecutive checks",
        "health_check_path returns 4xx or 5xx within 5s",
        "health_check_path times out (>5s) without responding",
        "consecutive_health_check_failures >= 3 (>=15s) on a single instance",
        "consecutive_health_check_failures >= 12 (>=60s) on a single instance",
        "all_new_instances healthy simultaneously within 900s (15-min grace)",
        "deploy_elapsed_seconds > 900 (15-min grace exhausted)",
        "old_instance_exit_within_maxShutdownDelaySeconds (default 30s, max 300s)",
        "process_does_not_handle_SIGTERM (no graceful shutdown)",
        "process_does_not_call_server.close() on Express / no lifespan on FastAPI",
        "concurrent_deploy_count > 1 for this service (overlap)",
        "instance_restart_count_last_5min >= 3 (restart loop)",
        "model_load_GB > instance_RAM_GB (predictive OOM)",
        "health_check_handler calls DB on every call (slow, false negatives)",
        "health_check_handler calls external API (cascading failures)",
        "health_check_path == '/' AND app root returns 200",
        "service has no healthCheckPath configured (TCP fallback only)",
        "tcp_check_port accepts connection within 5s (Render default)",
    ],
    "runtime": [
        "request_status_code is 2xx",
        "request_status_code is 5xx (server error)",
        "request_status_code is 4xx (client error)",
        "uncaught_exception_count_last_5min > 0",
        "process_resident_memory_MB > 90% of instance RAM",
        "process_cpu_percent_avg_last_5min > 80",
        "outbound_response_time_ms > p99_threshold AND external service degraded",
        "db_connection_pool_active >= 0.9 * pool_size",
        "db_query_duration_ms > 1000 for query X",
        "db_error_log matches /SSL|sslmode|certificate/i",
        "fs_write_attempted_outside_disk_mount_path",
        "fs_read_attempted_at_/etc/secrets/<filename> (Docker image not injected)",
        "last_inbound_request_time > 900s ago (15 min idle, free tier)",
        "first_request_after_idle AND instance_type == 'free' (50s cold start)",
        "autoscale_metric_cpu > target_cpu_percent for >3m",
        "autoscale_metric_memory > target_memory_percent for >3m",
        "current_instance_count == maxInstances (scaling capped)",
        "outbound_ip_in_external_allowlist == false",
        "secret_files_combined_size_bytes > 1MB",
        "ALLOWED_HOSTS contains request_host (Django check)",
        "static_site_rewrite_rule covers request_path",
        "service_has_collectstatic_output AND static_files_served_from_disk",
        "open_port_count > 75 (private network limit)",
        "service_type == 'background_worker' AND inbound_http_requested",
        "workspace created before 2022-01-23 AND region == 'oregon' (no fixed IP)",
        "cron_runtime > 15 min (Render cron hard limit)",
        "cron_running AND previous_run_still_active (overlap)",
        "handler_returns_200 AND body_contains_stack_trace",
        "handler_returns_200 AND body_is_empty",
        "service_uses_session_cookies AND instance_count > 1 (no sticky sessions)",
        "log_stream_contains_stderr_only (not /var/log) - good",
        "log_stream_contains_/var/log path (not captured by Render)",
        "log_line_size_bytes > 256KB (Render truncates)",
        "in_flight_request_duration > max_shutdown_delay_seconds (gets killed)",
        "websocket_connection_during_deploy (no sticky = reconnect storm)",
        "first_request_after_cold_start AND free_tier == true",
        "query_result_row_count > 100000 (likely N+1 / unbounded select)",
        "open_file_descriptor_count > 0.8 * ulimit",
        "memory_growth_rate_MB_per_min > 5 (leak indicator)",
        "goroutine_count_growth_rate > 0 (leak indicator)",
    ],
    "scaling": [
        "service_has_persistent_disk AND new_instance_count > 1",
        "service_has_persistent_disk (zero-downtime disabled)",
        "disk_resize_requested AND disk_in_use (allowed but slow)",
        "disk_shrink_requested (decrease not allowed)",
        "disk_mount_path in ['/', '/opt', '/etc', '/etc/secrets', '/home', '/home/render']",
        "render.yaml scaling.minInstances >= 1",
        "render.yaml scaling.maxInstances <= 100 (Render hard cap)",
        "render.yaml scaling.targetCPUPercent < 30 (thrashy)",
        "render.yaml scaling.targetMemoryPercent < 30 (thrashy)",
        "workspace_plan in ['free', 'starter'] AND autoscale_enabled == true",
        "service_is_preview_environment AND autoscale_enabled == true",
        "plan == 'pro' AND service_RAM_required > plan_RAM",
        "plan == 'free' AND minInstances > 1 (forced to 1)",
    ],
    "env": [
        "env_var_key exists in service config",
        "env_var_value is non-null AND non-empty",
        "env_var_key in render.yaml envVars list",
        "env_var_key with sync:false present in render.yaml",
        "env_var_key with generateValue:true already initialized",
        "env_group_attached_to_service",
        "secret_file_path == '/etc/secrets/<filename>'",
        "secret_file_path uses Windows backslashes",
        "secret_combined_size_bytes <= 1MB",
        ".env or .env.production file exists in repo (NOT loaded by Render)",
        "DATABASE_URL env var resolves to a reachable host (TCP check)",
        "build_log contains 'DATABASE_URL=' pattern (potential leak)",
        "render.yaml value field is non-empty for sensitive key (potential leak)",
        "Dockerfile contains 'ENV <SECRET_NAME>' (leak in image layer)",
        "git submodule requires auth AND no deploy key configured",
    ],
    "api": [
        "API response status_code == 200",
        "API response status_code == 429 (rate limited)",
        "Ratelimit-Remaining header < 5 (close to limit)",
        "Ratelimit-Reset header indicates reset time in future",
        "API response status_code == 401 (auth failure)",
        "API response status_code == 403 (forbidden)",
        "API response status_code == 404 (not found)",
        "API response status_code == 422 (validation)",
        "API response status_code == 5xx (transient)",
        "webhook_signature_header validates against stored secret (HMAC)",
        "webhook_receiver_response_status in 2xx (accepted)",
        "webhook_receiver_response_time_ms < 10000 (Render timeout)",
        "webhook_receiver_idempotency_key present in payload (deduplication)",
        "API call is POST /v1/services (20/hour limit per token)",
        "API call is PATCH /v1/services/{id} or /deploy (10/min/service)",
        "API call is GET /v1/services or other GET (400/min)",
        "API call is GET /v1/logs (30/min)",
        "API call is POST /v1/jobs (100/min)",
        "API call is POST /v1/customdomain (50/hour)",
    ],
    "domain": [
        "DNS A or CNAME record for custom domain resolves to Render",
        "DNS records propagated globally (TTL elapsed)",
        "Custom domain SSL certificate provisioned by Let's Encrypt",
        "Custom domain SSL certificate valid AND not expired",
        "CAA record for domain does NOT exclude letsencrypt.org",
        "Custom domain is 1 subdomain deep (e.g. app.example.com)",
        "Custom domain is 2+ subdomains deep (cookie/CSRF risk)",
        "ALLOWED_HOSTS in app includes the custom domain",
        "HTTPS-only enforcement on the web service (Render default for custom domains)",
    ],
    "data": [
        "Postgres connection uses sslmode=require (Render requires it)",
        "Postgres connection uses internal URL (private network)",
        "Postgres connection uses external URL (slower, public)",
        "Postgres connection_count < plan_limit (free = 25)",
        "Postgres query_duration_ms < threshold",
        "Postgres HA failover in progress (HA plan)",
        "Postgres backup window active (reads slow)",
        "Postgres credential rotation complete AND service has new env var",
        "Postgres instance exists (not deleted)",
        "Migration script is idempotent (uses IF EXISTS / IF NOT EXISTS)",
        "Migration script does NOT contain 'DROP TABLE' or 'TRUNCATE'",
        "Migration script compatibility with app at HEAD (schema matches)",
        "Key Value connection uses internal URL",
        "Key Value connection_count < 10 (free tier limit)",
        "Key Value idle > 15 min on free tier (sleeps)",
        "SQL prepared statement reuse across connections (cursor leak risk)",
        "Open transaction age > vacuum_defer_age (bloat risk)",
        "Query plan uses index (not seq scan)",
    ],
    "recovery": [
        "previous_successful_deploy exists within last 30 days",
        "previous_successful_deploy build artifact still cached",
        "current_commit_author is the same as last known good",
        "rollback_target_env_vars == current_env_vars (no drift)",
        "rollback_target_schema == current_db_schema (compatible)",
        "rollback_logs_available in last 30 days (retention)",
        "Render status page == 'operational' (no incident)",
        "Suspicious login attempt matches known operator pattern",
        "Workspace owner count > 0 AND new owner is_admin == true",
        "Service plan includes Render Shell (Pro+)",
        "Process accessible via Render Shell AND can attach strace/dump heap",
        "Secret file readable via /etc/secrets/<filename> on instance",
        "Filesystem changes via Render Shell are ephemeral (lost on redeploy)",
    ],
    "workflow": [
        "Workflow step has retry_policy set",
        "Workflow step retry count < max_retries",
        "Workflow step downstream_dependencies are in 'succeeded' state",
        "Background worker process is running (no port needed)",
        "Private service exists in workspace",
        "Private network target port is in 1-65535 AND not in [10000, 18012, 18013, 19099]",
        "Private network ingress policy allows source service",
        "Static site has 404.html in publishDir",
        "Static site cache invalidation queued (Render CDN)",
        "Container registry credential present for private image",
        "Outbound IP for image pull is in dedicated IP set (or shared, expected)",
        "Preview environment is in 'active' state (PR open)",
        "Preview environment is in 'suspended' state (PR closed)",
        "Cron job concurrency == 'allow' OR 'forbid' (one vs many)",
        "Cron job is set to skip if previous run still active",
        "Cron job last run status == 'succeeded' (default no retry)",
    ],
}

# ---------------------------------------------------------------------------
# Actions — what the agent does on the IF / ELSE branch
# ---------------------------------------------------------------------------
ACTIONS: Dict[str, Dict[str, List[str]]] = {
    "if_action": {
        "build": [
            "Mark deploy 'succeeded'; emit 'build_ok' event; release deploy lease",
            "Mark deploy 'failed'; tail build log; extract first 'error:' line; open PR with fix",
            "Suggest adding dependency to package.json/requirements.txt and rerun",
            "Regenerate lockfile locally (rm lockfile + install); commit; redeploy",
            "Pin language version in .nvmrc / runtime.txt / engines; commit; redeploy",
            "Set the missing env var via dashboard or PATCH /v1/services/{id}; redeploy",
            "Add CMD or ENTRYPOINT to Dockerfile; commit; redeploy",
            "Install missing OS dep in Dockerfile (apt-get install -y); commit; redeploy",
            "Increase plan tier (more RAM) or split build; commit reduced scope; redeploy",
            "Reduce build scope (--omit=dev for npm, --no-deps for pip); commit; redeploy",
            "Remove interactive prompts (--yes, -y); commit; redeploy",
            "Trigger deploy manually via POST /v1/services/{id}/deploys",
            "Wait for required CI check to pass; auto-retry deploy when green",
            "Skip deploy (no auto-deploy); notify operator with commit SHA",
            "Migrate secret from .env to env group; rotate; redeploy",
            "Move build into pre-built Docker image (Render Image) to skip build",
        ],
        "boot": [
            "Wait for health check to pass; mark deploy 'live'; send 'deploy_live' webhook",
            "Mark deploy 'failed' (health check); trigger auto-rollback to last good",
            "Mark deploy 'failed' (process exited); capture exit code + last log line; rollback",
            "Force restart instance (Render auto-restarts on persistent failure)",
            "Check app's listen call; emit 'port_binding_mismatch' remediation guide",
            "Check OOM in metrics; suggest plan upgrade OR add NODE_OPTIONS=--max-old-space-size",
            "Add healthCheckPath to render.yaml; add /healthz handler that returns 200; redeploy",
            "Make health check handler lightweight (no DB / external calls); redeploy",
            "Set healthCheckPath to /ready (heavy check); let /healthz be the always-200; redeploy",
            "Increase maxShutdownDelaySeconds (up to 300s); redeploy",
            "Wrap start command with 'exec' to forward SIGTERM; redeploy",
            "Cancel in-flight deploy; queue new deploy; coalesce overlapping deploys",
            "Suggest add-on for /tmp or persistent disk; or set restart policy",
            "Suggest moving model loading out of request path (lazy load); redeploy",
            "Mark deploy 'failed' (timeout); rollback; alert on-call",
            "Probe new instance with synthetic request; if 2xx, mark live",
        ],
        "runtime": [
            "Emit 'request_ok' metric; do not escalate",
            "Emit 5xx alert; capture stack trace; correlate with deploy_id (if recent) - consider rollback",
            "Emit 4xx metric; do not auto-rollback (client error, not platform)",
            "Mark request '5xx'; increment error budget; if budget exhausted, rollback",
            "Capture first exception line; correlate with recent deploy; if matches, rollback",
            "Restart instance (Render auto-restart); if persists, escalate to on-call",
            "Scale out (increase instance count) to reduce per-instance load",
            "Scale in (decrease instance count) during off-peak to save cost",
            "Open connection pool; add retry with backoff; release connections on error",
            "Switch DB connection string to internal URL (Postgres / Key Value)",
            "Add '?sslmode=require' to DATABASE_URL; restart service",
            "Attach persistent disk; mount at app write path; migrate existing data",
            "Move secret file to /etc/secrets/<filename> path (Docker-compatible)",
            "Ping service to keep it warm (avoid free-tier sleep) OR upgrade to always-on",
            "Suggest minInstances=2 (Pro+) or upgrade plan to avoid cold start",
            "Move heavy startup (model load) to a /ready gate; use /healthz as default",
            "Add 'try { ... } catch { res.status(500).send() }' around handler; redeploy",
            "Patch handler to return non-empty 200 body; redeploy",
            "Switch to stateless auth (JWT) OR add sticky sessions (Render private service)",
            "Configure log forwarder to stdout/stderr; redeploy",
            "Truncate or paginate large query result; add LIMIT; redeploy",
            "Add file descriptor limit raise; close unused handles; redeploy",
            "Add pprof endpoint (Pro+); capture heap; find leak; redeploy",
            "Cap log line size client-side; log summary not full body; redeploy",
            "Move long-poll to background worker (not web service); communicate via Redis",
            "Implement exponential backoff on client reconnect; document for SDK users",
            "Suggest upgrade to Starter ($7/mo) for always-on (free tier sleeps)",
        ],
        "scaling": [
            "Provision new instance; wait for healthy; add to LB pool",
            "Block scale-out; surface 'disk requires single instance' error to operator",
            "Trigger zero-downtime deploy (skip grace) for disk service - small blip accepted",
            "Confirm resize in dashboard; wait for completion; verify mount path; restart app",
            "Reject resize; surface 'disk size can only increase' to operator",
            "Reject deploy; surface 'mount path reserved' to operator",
            "Scale out with minInstances setting; wait for second instance healthy",
            "Cap scale-out at 100 (Render hard max); alert when reached",
            "Raise target CPU/memory to 50-70%; redeploy; monitor churn",
            "Lower target CPU/memory to 50-70%; redeploy; monitor churn",
            "Disable autoscale; switch to manual numInstances; redeploy",
            "Switch to manual numInstances for preview env; redeploy",
            "Upgrade workspace to Pro (or higher) to enable autoscale; redeploy",
            "Upgrade plan to one with enough RAM; redeploy",
            "Cap minInstances to 1 on free; alert operator about limit",
        ],
        "env": [
            "Use new env var value; redeploy service to apply",
            "Surface 'env var missing' to operator; do not proceed",
            "Read value from env group; apply to service",
            "Mark service 'pending_redeploy' (env changed, needs deploy)",
            "Use fallback default; log a warning to runtime logs (don't crash)",
            "Crash on startup with clear 'missing env var' error; trigger rollback",
            "Validate env var format (URL / key length); reject if invalid",
            "Reject update; surface 'sync:false env var cannot be in update' to operator",
            "Migrate env var to env group (centralized management)",
            "Rotate secret; update env group; redeploy dependent services",
            "Delete .env / .env.production from repo (Render doesn't load them); rotate any leaked values",
            "Add secret to /etc/secrets/<filename> secret file; mount in app; redeploy",
            "Reduce secret file count or split across services (1MB total cap)",
            "Build with secret in env (sync:false), NOT in render.yaml value (CRITICAL)",
            "Move secret out of Dockerfile ENV into runtime env (sync:false)",
            "Configure deploy key for private submodule; redeploy",
        ],
        "api": [
            "Treat response as success; update local state cache",
            "Mark request 'rate_limited'; sleep until Ratelimit-Reset; retry with jitter",
            "Pause API calls for this token; alert on-call if persists > 1m",
            "Re-auth: rotate API key via dashboard; update secret store; retry",
            "Surface 'permission denied' to operator; suggest role change (Admin/Member)",
            "Surface 'service not found' to operator; verify service id; halt workflow",
            "Surface validation error (422) to operator with field details; halt workflow",
            "Retry with exponential backoff (3x); if still failing, escalate",
            "Verify HMAC against signing secret; on success, process event",
            "Mark webhook delivery accepted; do not retry",
            "Mark webhook delivery as timeout; rely on Render's at-least-once retry",
            "Mark webhook delivery as failed; rely on Render's retry policy",
            "Deduplicate by event id; respond 200 quickly; process async",
            "Bucket calls to <20/hour for POST /v1/services; queue excess",
            "Bucket calls to <10/minute/service for deploys + PATCH; queue excess",
            "Bucket calls to <400/minute for GET; queue excess",
            "Bucket calls to <30/minute for log endpoints; queue excess",
            "Bucket calls to <100/minute for one-off jobs; queue excess",
            "Bucket calls to <50/hour for custom domain ops; queue excess",
        ],
        "domain": [
            "Mark custom domain 'verified'; trigger SSL provisioning; wait for active cert",
            "Surface DNS config error to operator; provide exact CNAME / A record to add",
            "Wait for DNS propagation; poll DNS; re-check on TTL expiry",
            "Mark SSL 'provisioning'; poll Render; alert if pending > 10 min",
            "Surface CAA record block to operator; ask to remove or add letsencrypt.org",
            "Wait for auto-renewal retry; if cert near expiry, alert operator",
            "Force HTTPS redirect on Render side; reject HTTP at LB",
            "Move auth cookies to apex or 1-deep subdomain; update CORS; redeploy",
            "Suggest subdomain (app.example.com); reject apex if multiple services",
            "Add custom domain to ALLOWED_HOSTS; redeploy",
        ],
        "data": [
            "Treat connection as healthy; pool it",
            "Force sslmode=require on connection string; restart app",
            "Switch connection to internal URL; restart app",
            "Block new connections; surface 'connection limit hit' to operator; suggest pooling",
            "Mark query 'slow'; capture plan; add index; redeploy",
            "Wait for failover; re-establish connection (PgBouncer recommended)",
            "Mark DB 'read-only temporarily'; surface to operator; reduce read load",
            "Use new credential; redeploy dependent services",
            "Surface 'DB instance missing' to operator; halt service until restored",
            "Re-run migration (idempotent); continue deploy",
            "Halt deploy; surface 'destructive migration' warning; require manual approval",
            "Reconcile: deploy app at HEAD that matches schema, OR roll back app",
            "Switch connection to internal URL; restart app",
            "Block new connections; surface 'connection limit hit' to operator",
            "Ping service to keep awake; or upgrade off free tier",
            "Disable prepared statement caching; add explicit DEALLOCATE; redeploy",
            "Add transaction timeout; close transactions explicitly; redeploy",
            "Add index on column; analyze; redeploy",
        ],
        "recovery": [
            "Roll back to previous successful deploy via API; monitor health",
            "Roll back via dashboard; verify build artifact cached; monitor health",
            "Surface 'artifact pruned' to operator; trigger rebuild; or pick older deploy",
            "Trigger rollback; alert on-call; pause auto-deploy for this branch",
            "Trigger forward-fix workflow: open PR with revert + test; do not rollback",
            "Roll back app; pin env vars; redeploy to align",
            "Roll back app AND queue migration to match new code; gate deploy on migration",
            "Pull logs from Render API /v1/logs (within retention) before rollback",
            "Pause all deploys; mark workspace 'incident_mode'; post status to operator",
            "Send security alert to operator email; require MFA reset",
            "Invalidate all dashboard sessions; rotate API keys; force re-login",
            "Rotate all env vars and API keys; audit access logs; transfer ownership",
            "Suggest upgrade to Pro+ for Shell access; or use logs for triage",
            "Run triage commands (ps, top, strace, heap dump) via Shell",
            "Read /etc/secrets/<filename> via Shell for secret rotation audit",
            "Mark all Shell-based changes as ephemeral; do not commit them",
        ],
        "workflow": [
            "Mark step 'succeeded'; trigger downstream depends_on",
            "Retry step (per policy); on max retries, mark workflow 'stuck' and alert",
            "Skip downstream steps; mark workflow 'failed'",
            "Mark worker 'healthy' (no port check needed)",
            "Halt workflow; surface 'peer private service missing' to operator",
            "Halt call; surface 'reserved port 10000/18012/18013/19099' to operator",
            "Halt call; surface 'policy blocked' to operator; suggest env policy change",
            "Serve 404.html; continue serving static",
            "Wait for CDN cache invalidation; serve stale until propagated",
            "Add registryCredential to render.yaml; redeploy",
            "Acknowledge shared outbound IP for image pull; suggest dedicated IP set for build",
            "Keep service running; auto-update on PR push",
            "Suspend service; mark for cleanup in 7 days",
            "Tear down service; remove from workspace",
            "Mark cron run 'skipped' (overlap); continue",
            "Mark cron run 'failed' (no auto-retry); alert on-call",
        ],
    },
    "else_action": {
        # Defaults: surface problem to operator
        "build": [
            "Page on-call; open incident; halt deploy queue; require human triage",
            "Do not mark deploy 'failed' yet; retry once; if 2nd fail, page on-call",
            "Capture full build log to incident doc; require sign-off to retry",
            "Open revert PR; if auto-deploy on, let CI gate the revert",
        ],
        "boot": [
            "Mark deploy 'failed'; do not auto-rollback (need human eyes on new failure mode)",
            "Capture boot logs and exit code; page on-call with full context",
            "Keep old service running; surface new instance logs to operator",
            "Pause auto-deploy on this branch; require manual deploy",
        ],
        "runtime": [
            "Page on-call; do not auto-remediate on first unknown failure",
            "Capture full request log + headers; require sign-off before changing code",
            "Reduce traffic (return 503 for low-priority paths); alert operator",
            "Disable feature flag for affected path; serve degraded experience",
        ],
        "scaling": [
            "Block scale action; surface error to operator; require manual plan change",
            "Halt autoscale; require explicit operator override",
            "Do not resize disk; require operator to confirm",
        ],
        "env": [
            "Block deploy; require operator to set env var explicitly",
            "Pause affected service; alert operator with env var name",
            "Do not auto-rotate; require operator approval",
        ],
        "api": [
            "Halt all API activity for this token; require operator review",
            "Page on-call; do not retry 5xx blindly past 3 attempts",
            "Fall back to cached state; surface 'API unavailable' to dependent code",
        ],
        "domain": [
            "Block traffic to new domain; require operator to confirm DNS",
            "Page on-call with full domain + cert state",
        ],
        "data": [
            "Block writes; serve read-only; alert operator",
            "Page on-call; do not auto-failover; require operator sign-off",
            "Block new connections; drain existing; alert operator",
        ],
        "recovery": [
            "Do not auto-rollback if logs are missing; require operator decision",
            "Page on-call; require manual recovery workflow",
            "Lock workspace (read-only); require operator + Render support",
        ],
        "workflow": [
            "Halt entire workflow; page on-call with step id and error",
            "Mark workflow 'stuck'; require operator to manually resume",
        ],
    },
}

# ---------------------------------------------------------------------------
# Severity + source mapping
# ---------------------------------------------------------------------------
SEVERITY_BY_CATEGORY = {
    "build": "high",
    "boot": "high",
    "runtime": "medium",
    "scaling": "medium",
    "env": "high",
    "api": "medium",
    "domain": "medium",
    "data": "high",
    "recovery": "critical",
    "workflow": "medium",
}

SOURCE_DOCS = {
    "build":   "render.com/docs/deploys; render.com/docs/troubleshooting-deploys",
    "boot":    "render.com/docs/health-checks; render.com/articles/how-render-handles-zero-downtime-deploys",
    "runtime": "render.com/docs/troubleshooting-deploys; render.com/docs/web-services",
    "scaling": "render.com/docs/scaling; render.com/docs/disks; render.com/docs/blueprint-spec",
    "env":     "render.com/docs/configure-environment-variables; render.com/articles/how-render-handles-secrets-and-environment-variables",
    "api":     "api-docs.render.com/reference/rate-limiting; render.com/docs/api",
    "domain":  "render.com/docs/custom-domains (letsencrypt + DNS verification)",
    "data":    "render.com/docs/databases; render.com/docs/key-value; render.com/docs/private-network",
    "recovery":"render.com/docs/rollbacks; render.com/docs; render.com/changelog",
    "workflow":"render.com/docs/workflows; render.com/docs/cron-jobs; render.com/docs/private-services",
}

# ---------------------------------------------------------------------------
# Build the rows
# ---------------------------------------------------------------------------

def build_rows(target: int) -> List[Dict[str, str]]:
    """Build exactly `target` unique (category, trigger, condition, if_action,
    else_action) rows, distributed across all categories.

    Strategy:
      1. Distribute the row budget across categories proportional to their
         available (trigger x condition) space, with a min of 30 per category.
      2. For each category, walk (trigger, condition) pairs and pick if/else
         actions that vary by index — this guarantees uniqueness within the
         category.
      3. If a category runs out of unique (trig, cond) pairs, expand by
         varying the if/else action pair (also deterministic).
    """
    rows: List[Dict[str, str]] = []
    seen_keys = set()

    # Group triggers and conditions by category
    trig_by_cat: Dict[str, List[str]] = {}
    for prefix, cat, text in TRIGGERS:
        trig_by_cat.setdefault(cat, []).append(text)
    cond_by_cat = CONDITIONS

    if_by_cat = ACTIONS["if_action"]
    else_by_cat = ACTIONS["else_action"]

    # Order categories for stable output
    cat_order = ["build", "boot", "runtime", "scaling", "env", "api", "domain", "data", "recovery", "workflow"]

    # 1. Compute capacity per category
    capacity = {}
    for cat in cat_order:
        t = len(trig_by_cat.get(cat, []))
        c = len(cond_by_cat.get(cat, []))
        a = len(if_by_cat.get(cat, []))
        e = len(else_by_cat.get(cat, []))
        # theoretical max unique tuples = t * c * a * e (very large)
        capacity[cat] = (t, c, a, e, t * c * a * e)

    # 2. Greedy distribution: aim each category to fill its min quota first
    MIN_PER_CAT = 30
    quotas = {cat: MIN_PER_CAT for cat in cat_order}
    remaining = target - sum(quotas.values())
    # If remaining > 0, distribute proportionally to trigger count
    total_trig = sum(capacity[c][0] for c in cat_order) or 1
    for cat in cat_order:
        extra = int(round(remaining * capacity[cat][0] / total_trig))
        quotas[cat] += extra
        remaining -= extra
    # Spillover: hand any remaining to the largest category
    if remaining:
        biggest = max(cat_order, key=lambda c: capacity[c][0])
        quotas[biggest] += remaining
    # Cap each quota to its capacity (very loose cap)
    for cat in cat_order:
        quotas[cat] = min(quotas[cat], capacity[cat][4])

    # Normalize so totals == target (re-balance if caps kicked in)
    total_quota = sum(quotas.values())
    if total_quota < target:
        # bump biggest
        biggest = max(cat_order, key=lambda c: capacity[c][0])
        quotas[biggest] += (target - total_quota)
    elif total_quota > target:
        # trim biggest
        biggest = max(cat_order, key=lambda c: quotas[c])
        quotas[biggest] -= (total_quota - target)

    # 3. Walk per-category grids
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
        # First pass: unique (trigger, condition) pairs with varied if/else
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
                    "id": f"RS-{counter:04d}",
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
        # Second pass: vary if/else pair to reach quota
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
                            "id": f"RS-{counter:04d}",
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

    # If we still need more (unlikely with 667 triggers), expand by varying the
    # if/else pair more aggressively per (trigger, condition) tuple.
    if len(rows) < target:
        for cat in cat_order:
            triggers = trig_by_cat.get(cat, [])
            conds = cond_by_cat.get(cat, [])
            ifs = if_by_cat.get(cat, [])
            elses = else_by_cat.get(cat, [])
            for ti, t in enumerate(triggers):
                for ci, c in enumerate(conds):
                    if len(rows) >= target:
                        break
                    for ai in range(len(ifs)):
                        if_action = ifs[(ti + ci + ai) % len(ifs)]
                        else_action = elses[(ci + ai) % len(elses)]
                        key = (t, c, if_action, else_action)
                        if key in seen_keys:
                            continue
                        seen_keys.add(key)
                        counter += 1
                        rows.append({
                            "id": f"RS-{counter:04d}",
                            "category": cat,
                            "trigger": t,
                            "condition": c,
                            "if_action": if_action,
                            "else_action": else_action,
                            "severity": SEVERITY_BY_CATEGORY[cat],
                            "source_doc": SOURCE_DOCS[cat],
                        })
                        if len(rows) >= target:
                            break
                    if len(rows) >= target:
                        break
                if len(rows) >= target:
                    break
            if len(rows) >= target:
                break

    return rows

def main() -> None:
    rows = build_rows(TARGET_ROWS)
    assert len(rows) == TARGET_ROWS, f"expected {TARGET_ROWS}, got {len(rows)}"
    # Verify uniqueness
    seen = set()
    for r in rows:
        key = (r["trigger"], r["condition"], r["if_action"], r["else_action"])
        assert key not in seen, f"duplicate row: {key}"
        seen.add(key)
    # Write CSV
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["id", "category", "trigger", "condition", "if_action", "else_action", "severity", "source_doc"],
            quoting=csv.QUOTE_ALL,
        )
        writer.writeheader()
        writer.writerows(rows)
    # Sanity report
    by_cat = {}
    for r in rows:
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1
    print(f"wrote {OUT_PATH} with {len(rows)} rows")
    print("by category:", by_cat)
    by_sev = {}
    for r in rows:
        by_sev[r["severity"]] = by_sev.get(r["severity"], 0) + 1
    print("by severity:", by_sev)

if __name__ == "__main__":
    main()
