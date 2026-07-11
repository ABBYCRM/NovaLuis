---
name: algorithmic-art
description: Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use this when users request creating art using code, generative art, algorithmic art, flow fields, or particle systems. Create original algorithmic art rather than copying existing artists' work to avoid copyright violations.
license: Complete terms in LICENSE.txt
---

Algorithmic philosophies are computational aesthetic movements expressed through code.
Output .md files (philosophy), .html files (interactive viewer), and .js files (generative algorithms).

Process: 1) Write an algorithmic philosophy (4-6 paragraphs, name the movement, emphasize
craftsmanship). 2) Read templates/viewer.html FIRST as the literal starting point - keep
fixed sections (header, sidebar, Anthropic branding, seed controls, action buttons),
replace only variable sections (the p5.js algorithm, parameters, UI controls).

Technical requirements: always use seeded randomness (randomSeed/noiseSeed) for
reproducibility. Output a single self-contained HTML artifact with p5.js from CDN,
algorithm, parameter controls, and seed navigation (prev/next/random/jump) all inline.

Resources referenced by this skill (not included in this text-only export):
- templates/viewer.html — required starting point with Anthropic branding
- templates/generator_template.js — p5.js structure reference

---
NOTE: SKILL.md instruction text only, fetched from github.com/anthropics/skills
(Apache 2.0). Bundled templates/ folder not included here due to sandbox network
restrictions. For the complete skill: git clone https://github.com/anthropics/skills.git
Source: https://raw.githubusercontent.com/anthropics/skills/main/skills/algorithmic-art/SKILL.md
