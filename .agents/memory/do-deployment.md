---
name: "DigitalOcean App Platform deployment"
description: "Nova-luis live on DO App Platform — account, app ID, URL, known gaps."
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

## Verified working (2026-07-15)
- /healthz → 200
- / (Nova UI) → 200
- /api/nova-config → 200
- /api/scratchpad → 200
- /api/social/platforms → 401 (auth gate working)
- OpenClaw gateway starts cleanly, NOVA API listens on 8080

## Known gaps
- DATABASE_URL not set → integrations/knowledge return empty (same as Render)
- SCRATCHPAD_DATABASE_URL not set → scratchpad won't persist across restarts
- PUBLIC_BASE_URL set to live URL but nova-config not yet returning it (check route)

## How to redeploy
```bash
curl -s -X POST \
  "https://api.digitalocean.com/v2/apps/a1046ca0-ab98-4775-8ed7-24f156432aaf/deployments" \
  -H "Authorization: Bearer $DIGITALOCEAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force_build": false}'
```
