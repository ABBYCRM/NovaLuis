---
name: "DigitalOcean App Platform deployment"
description: "Nova-luis live on DO App Platform — account, app ID, URL, env vars, and verified working state."
---

# DigitalOcean App Platform — nova-luis

## Account
- email: intake@abbycrm.com (same account as Render)
- Both DIGITALOCEAN_API_TOKEN and DIGITALOCEAN_API_TOKEN_PAID resolve to the same account UUID: f0b6e90f-affe-4f8f-affb-d7b2779b79df

## App
- App ID: a1046ca0-ab98-4775-8ed7-24f156432aaf
- Live URL: https://nova-luis-8hjvt.ondigitalocean.app
- Region: nyc, instance: basic-s (2GB RAM)
- Dockerfile build from GitHub: ABBYCRM/NovaLuis main
- autoDeploy: false (manual trigger required)
- Spec file: .do/app.yaml (no secret values — committed to repo)

## Verified working (2026-07-16, commit 076abae)
- /healthz → 200
- / (Nova UI) → 200
- /api/nova-config → 200 (apiKey present)
- /api/scratchpad → 200 (groups: 0)
- /api/favorites → 200 (favorites: [])
- /api/agent/v1/chat/completions → real responses (gpt-4o model)
- OpenClaw gateway starts cleanly, NOVA API listens on 8080

## Key env vars set in DO app
- NOVA_OPENCLAW_MODEL_ID = moonshotai/Kimi-K2.6  ← gateway startup model
- NOVA_MODEL_PREFERENCE  = bitdeer  ← proxy override default (openai/bitdeer/kimi)
- BITDEER_API_KEY (SECRET) — routes moonshotai/Kimi-K2.6 inference
- KIMI_API_KEY    (SECRET) — dormant fallback (Moonshot native API, key unverified)
- DATABASE_URL = postgresql://...supernova_db_q5bt?sslmode=require  (Render supernova-db)
- SCRATCHPAD_DATABASE_URL = same as DATABASE_URL

## Critical lessons
- gpt-4o-mini FAILS with the 75K-char NOVA workspace system prompt — returns only 3
  completion tokens, triggering OpenClaw's loop detector ("No response from OpenClaw.").
  gpt-4o handles the prompt correctly. Always use gpt-4o or better.
- DATABASE_URL / SCRATCHPAD_DATABASE_URL must include ?sslmode=require for Render PG.
  lib/db uses bare connectionString (no explicit ssl: object), so URL param is safe.
- The Render supernova-db favorites table had legacy columns (owner/label/position) and
  was missing the nova-luis schema columns (title/description/favicon/tags).
  Fixed with ALTER TABLE ADD COLUMN IF NOT EXISTS on 2026-07-15.
- NOVA_OPENCLAW_PROXY_KEY is randomly generated per start-openclaw.mjs run; both
  OpenClaw gateway and express server receive the same key via childEnv, so no mismatch.
  No need to set it explicitly for single-replica deployments.

## How to redeploy
```bash
# After git push, trigger a new build:
curl -s -X POST \
  "https://api.digitalocean.com/v2/apps/a1046ca0-ab98-4775-8ed7-24f156432aaf/deployments" \
  -H "Authorization: Bearer $DIGITALOCEAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force_build": false}'
```

## Render supernova-db (shared with DO)
- DB ID: dpg-d94pgbnaqgkc73e7u8hg-a
- External host: dpg-d94pgbnaqgkc73e7u8hg-a.oregon-postgres.render.com:5432
- DB: supernova_db_q5bt, user: supernova
- IP allowlist: 0.0.0.0/0 (open — required for DO egress)
