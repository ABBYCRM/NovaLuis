#!/usr/bin/env python3
"""
Quick query helper for openclaw_scenarios.csv.

Usage:
  python3 query.py <skill> [condition_keyword]
  python3 query.py --search <keyword>
  python3 query.py --severity high
  python3 query.py --stats

Examples:
  python3 query.py github
  python3 query.py slack "rate limit"
  python3 query.py --search webhook
  python3 query.py --severity critical
  python3 query.py --stats
"""

import csv
import sys
import os

CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "openclaw_scenarios.csv")

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

def load():
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def print_row(r):
    sev_icon = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(r["severity"], "⚪")
    print(f"{r['id']} {sev_icon} [{r['skill']}] [{r['severity']}]")
    print(f"  TRIGGER:   {r['trigger']}")
    print(f"  CONDITION: {r['condition']}")
    print(f"  IF MET:    {r['if_action']}")
    print(f"  IF NOT:    {r['else_action']}")
    print(f"  SOURCE:    {r['source_doc']}")
    print()

def cmd_skill(rows, skill, cond_kw=None):
    hits = [r for r in rows if r["skill"] == skill]
    if cond_kw:
        hits = [r for r in hits if cond_kw.lower() in r["condition"].lower()
                or cond_kw.lower() in r["trigger"].lower()]
    if not hits:
        print(f"No scenarios found for skill='{skill}'" + (f" condition~='{cond_kw}'" if cond_kw else ""))
        print(f"Available skills: {', '.join(sorted(set(r['skill'] for r in rows)))}")
        sys.exit(1)
    hits.sort(key=lambda r: SEVERITY_ORDER.get(r["severity"], 9))
    print(f"Found {len(hits)} scenario(s) for '{skill}'" + (f" / '{cond_kw}'" if cond_kw else "") + "\n")
    for r in hits:
        print_row(r)

def cmd_search(rows, keyword):
    kw = keyword.lower()
    hits = [r for r in rows if kw in " ".join(r.values()).lower()]
    if not hits:
        print(f"No scenarios matching '{keyword}'")
        sys.exit(1)
    hits.sort(key=lambda r: SEVERITY_ORDER.get(r["severity"], 9))
    print(f"Found {len(hits)} scenario(s) matching '{keyword}'\n")
    for r in hits:
        print_row(r)

def cmd_severity(rows, sev):
    hits = [r for r in rows if r["severity"] == sev]
    if not hits:
        print(f"No scenarios with severity='{sev}'")
        sys.exit(1)
    print(f"Found {len(hits)} scenario(s) with severity='{sev}'\n")
    for r in hits:
        print_row(r)

def cmd_stats(rows):
    from collections import Counter
    print(f"Total scenarios : {len(rows)}")
    print(f"Unique skills   : {len(set(r['skill'] for r in rows))}")
    print(f"Unique categories: {len(set(r['category'] for r in rows))}")
    sev = Counter(r["severity"] for r in rows)
    print("\nBy severity:")
    for s in ["critical", "high", "medium", "low"]:
        print(f"  {s:10s}: {sev.get(s, 0)}")
    cats = Counter(r["category"] for r in rows)
    print("\nTop 15 categories:")
    for cat, n in cats.most_common(15):
        print(f"  {cat:35s}: {n}")

def main():
    rows = load()
    args = sys.argv[1:]

    if not args:
        print(__doc__)
        sys.exit(0)

    if args[0] == "--search" and len(args) >= 2:
        cmd_search(rows, " ".join(args[1:]))
    elif args[0] == "--severity" and len(args) >= 2:
        cmd_severity(rows, args[1])
    elif args[0] == "--stats":
        cmd_stats(rows)
    elif args[0].startswith("--"):
        print(__doc__)
        sys.exit(1)
    else:
        skill = args[0]
        cond_kw = " ".join(args[1:]) if len(args) > 1 else None
        cmd_skill(rows, skill, cond_kw)

if __name__ == "__main__":
    main()
