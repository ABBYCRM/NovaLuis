---
name: web-artifacts-builder
description: Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using modern frontend web technologies (React, Tailwind CSS, shadcn/ui). Use for complex artifacts requiring state management, routing, or shadcn/ui components — not for simple single-file HTML/JSX artifacts.
license: Complete terms in LICENSE.txt
---

Stack: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui. Initialize projects with
init-artifact.sh, then bundle into a single HTML file with bundle-artifact.sh when done.
Targets complex applications (dashboards, multi-view tools, interactive prototypes)
requiring state management or routing — unlike simple single-file artifacts.

Emphasizes avoiding "AI aesthetic homogeneity": no excessive centered layouts, purple
gradients, or cookie-cutter rounded corners by default.

---
NOTE: Condensed SKILL.md summary compiled from github.com/anthropics/skills (Apache 2.0).
For the full file with init/bundle scripts: git clone https://github.com/anthropics/skills.git
