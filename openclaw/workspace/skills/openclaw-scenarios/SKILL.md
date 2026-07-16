---
name: openclaw-scenarios
description: Runtime decision table for OpenClaw skill invocations. 500 grounded scenarios (trigger → condition → if_action / else_action) covering every major skill category. Query by skill, trigger keyword, or severity to get the correct handling policy before executing an action.
metadata: {"openclaw":{"emoji":"📋","requires":{"bins":["python3","grep","awk"]}}}
---

# OpenClaw Scenarios — Runtime Decision Table

Use this skill **before acting** whenever you are about to invoke an OpenClaw skill and need to know the correct handling policy for a given situation. The table answers: *"Given this trigger and this condition, what is the right action — and what do I do if the condition is NOT met?"*

The CSV lives at `{baseDir}/openclaw_scenarios.csv`.  
The generator lives at `{baseDir}/generate_scenarios.py`.

---

## Schema

| Column | Description |
|---|---|
| `id` | Unique scenario ID (OC-0001 … OC-0500) |
| `category` | Skill category (e.g. `github`, `slack`, `core_shell`) |
| `skill` | Exact OpenClaw skill slug |
| `trigger` | What the agent is about to do |
| `condition` | The condition that determines the branch |
| `if_action` | What to do **if** the condition is met |
| `else_action` | What to do **if** the condition is NOT met |
| `severity` | `low` / `medium` / `high` / `critical` |
| `source_doc` | Authoritative source for this policy |

---

## When to use this skill

- Before invoking any shell command → look up `core_shell` scenarios
- Before an OAuth-gated skill (Gmail, GitHub, Slack…) → check token condition rows
- Before a destructive action (delete, push, trade, deploy) → check `high`/`critical` severity rows
- When a skill call fails → grep for the skill + failure condition → apply the `else_action`
- When writing a new automation → scan scenarios for edge cases you may have missed

---

## Query patterns

### 1. Look up all scenarios for a skill

```bash
python3 -c "
import csv, sys
skill = sys.argv[1]
with open('{baseDir}/openclaw_scenarios.csv') as f:
    for r in csv.DictReader(f):
        if r['skill'] == skill:
            print(f'{r[\"id\"]} [{r[\"severity\"]}]')
            print(f'  TRIGGER:   {r[\"trigger\"]}')
            print(f'  CONDITION: {r[\"condition\"]}')
            print(f'  IF:        {r[\"if_action\"]}')
            print(f'  ELSE:      {r[\"else_action\"]}')
            print()
" github
```

### 2. Search by keyword across all fields

```bash
python3 -c "
import csv, sys
kw = sys.argv[1].lower()
with open('{baseDir}/openclaw_scenarios.csv') as f:
    for r in csv.DictReader(f):
        row_text = ' '.join(r.values()).lower()
        if kw in row_text:
            print(f'{r[\"id\"]} [{r[\"skill\"]}] [{r[\"severity\"]}]')
            print(f'  TRIGGER:   {r[\"trigger\"]}')
            print(f'  CONDITION: {r[\"condition\"]}')
            print(f'  IF:        {r[\"if_action\"]}')
            print(f'  ELSE:      {r[\"else_action\"]}')
            print()
" webhook
```

### 3. List all high / critical severity scenarios

```bash
python3 -c "
import csv
with open('{baseDir}/openclaw_scenarios.csv') as f:
    rows = [r for r in csv.DictReader(f) if r['severity'] in ('high','critical')]
print(f'{len(rows)} high/critical scenarios')
for r in rows[:20]:
    print(f'  {r[\"id\"]} [{r[\"skill\"]}] {r[\"trigger\"][:60]}')
"
```

### 4. Quick grep for fast scanning

```bash
# All scenarios that mention rate limiting
grep -i "rate limit\|429" {baseDir}/openclaw_scenarios.csv

# All scenarios for a category prefix
grep '"docker' {baseDir}/openclaw_scenarios.csv | awk -F'","' '{print $1, $5, $6}'

# Count unique skills covered
awk -F'","' 'NR>1{print $3}' {baseDir}/openclaw_scenarios.csv | sort -u | wc -l
```

### 5. Get the handling policy for a specific trigger + condition

```bash
python3 -c "
import csv, sys
skill, kw = sys.argv[1], sys.argv[2].lower()
with open('{baseDir}/openclaw_scenarios.csv') as f:
    hits = [r for r in csv.DictReader(f)
            if r['skill'] == skill and kw in r['condition'].lower()]
if not hits:
    print('No match — check skill slug or broaden keyword')
else:
    for r in hits:
        print(f'{r[\"id\"]} [{r[\"severity\"]}]')
        print(f'  IF {r[\"condition\"]}:')
        print(f'    → {r[\"if_action\"]}')
        print(f'  ELSE:')
        print(f'    → {r[\"else_action\"]}')
" slack "rate limit"
```

---

## Skill categories covered

| Category prefix | Skills included |
|---|---|
| `core_*` | shell, filesystem, http, websearch, memory, datetime |
| Productivity | gmail, google_calendar, gog, outlook, apple_calendar, apple_reminders, apple_notes, apple_mail, acuity_scheduling |
| Notes / PKM | notion, better_notion, obsidian, bear_notes |
| Messaging | slack, discord, telegram, whatsapp, imessage, twitter_x, agentdo |
| Dev / GitHub | github, github_cli, git, code_runner, claude_code, autoreview, crabbox, handoff |
| Research | browser, web_search, tavily, arxiv_watcher, pubmed_edirect, wikipedia, newsapi_search, exa_web_search, brightdata, rss_reader |
| DevOps | docker_control, docker_essentials, system_health, shell, deploy_webhook, k8s |
| Finance | stock_monitor, stock_trading_assistant, akshare_finance, backtest_expert, adaptive_reasoning |
| Security | 1password, age_verification, api_security, anti_injection, ai_act_risk_check, skillspector |
| Smart home | home_assistant, philips_hue, mqtt, anova_oven, bambu_3d_printer |
| Creative | ai_image_gen, ai_video_gen, ai_pdf_builder, ai_ppt_generate, adobe_automator |
| Voice | kesha_voice_kit, vapi, bland, retell, voice_call, voice_transcribe |
| Data | data_analyst, automate_excel, airtable, supabase, asana, linear, jira, todoist, attio |
| Documents | pdf_read, pdf_build, docx |
| Knowledge | summarize, memory, arxiv_research_assistant, academic_writing |
| Automation | cron, webhook, automation_workflows, decompose |
| Agent meta | skill_workshop, auto_improve, mission_control, lossless_claw, memU, claude_code |
| Agent-to-agent | agentdo, agent_team_orchestration, agent_commons, agent_social |

---

## Regenerating or extending the table

The generator at `{baseDir}/generate_scenarios.py` produces a deterministic 500-row CSV from structured TRIGGERS, CONDITIONS, ACTIONS, SEVERITY_BY_CATEGORY, and SOURCE_DOCS data.

**To regenerate the current table** (same seed, same output):

```bash
python3 {baseDir}/generate_scenarios.py
```

Output is written directly to `{baseDir}/openclaw_scenarios.csv`.

**To add new scenarios:**
1. Open `generate_scenarios.py`
2. Add entries to `TRIGGERS`, `CONDITIONS[skill]`, `ACTIONS["if_action"][skill]`, `ACTIONS["else_action"][skill]`
3. Set `SEVERITY_BY_CATEGORY[skill]` and `SOURCE_DOCS[skill]`
4. Increase `TARGET_ROWS` if needed
5. Run `python3 {baseDir}/generate_scenarios.py`

**To query statistics:**

```bash
python3 -c "
import csv
from collections import Counter
with open('{baseDir}/openclaw_scenarios.csv') as f:
    rows = list(csv.DictReader(f))
print('Total rows:', len(rows))
print('Unique skills:', len(set(r['skill'] for r in rows)))
sev = Counter(r['severity'] for r in rows)
print('By severity:', dict(sev))
cats = Counter(r['category'] for r in rows)
print('Top 10 categories:', cats.most_common(10))
"
```

---

## Decision-making protocol

When you encounter a skill invocation, follow this order:

1. **Identify** the skill slug and the current condition (what is true right now)
2. **Query** the scenario table: `python3 {baseDir}/query.py <skill> "<condition keyword>"`
3. **Apply** the `if_action` if the condition is met, the `else_action` if not
4. **For `high`/`critical` severity** — log the outcome and surface to the operator
5. **If no scenario matches** — fall back to the authoritative source_doc URLs in the table

Never skip this check for `critical` severity skills (1password, stock_trading, security scans).
