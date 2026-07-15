/**
 * /api/skills — Skills catalog API for Nova-Aura-Tools.
 * Mounted at /api/skills via the workspace index.ts mount point.
 */
import { Router } from "express";
import fs from "fs";
import path from "path";

const router = Router();

// Skills dir is at repo root (next to package.json)
const SKILLS_ROOT = path.resolve(process.cwd(), "skills");

interface SkillMeta {
  name: string;
  description: string;
  tags: string[];
  content: string;
}

function getSkillMeta(name: string): SkillMeta {
  // Prevent path traversal: resolve and confirm it stays inside SKILLS_ROOT.
  const skillDir = path.resolve(SKILLS_ROOT, name);
  if (!skillDir.startsWith(SKILLS_ROOT + path.sep) && skillDir !== SKILLS_ROOT) {
    return { name, description: name, tags: [], content: "" };
  }
  const skillMd = path.join(skillDir, "SKILL.md");
  const composioMd = path.join(SKILLS_ROOT, `${name}.md`);

  const readmePath = fs.existsSync(skillMd)
    ? skillMd
    : fs.existsSync(composioMd) ? composioMd : null;

  if (readmePath) {
    const content = fs.readFileSync(readmePath, "utf-8").slice(0, 8000);
    const firstLine = content.split("\n").find((l) => l.trim().startsWith("#"));
    const description = firstLine?.replace(/^#+\s*/, "").trim() || name;
    const tagMatch = content.match(/<!--\s*tags:(.*?)\s*-->/i);
    const tags = tagMatch ? tagMatch[1].split(",").map((t) => t.trim()).filter(Boolean) : [];
    return { name, description, tags, content };
  }

  return { name, description: name, tags: [], content: "" };
}

// GET /api/skills — list all skills
router.get("/", (_req, res) => {
  if (!fs.existsSync(SKILLS_ROOT)) {
    res.json({ count: 0, skills: [] });
    return;
  }

  let names: string[] = [];
  try {
    names = fs.readdirSync(SKILLS_ROOT).filter((name) => {
      try {
        const stat = fs.statSync(path.join(SKILLS_ROOT, name));
        if (stat.isDirectory()) {
          return fs.existsSync(path.join(SKILLS_ROOT, name, "SKILL.md"));
        }
        return name.endsWith("-catalog.md") || name.endsWith("-index.md");
      } catch {
        return false;
      }
    });
  } catch {
    res.json({ count: 0, skills: [] });
    return;
  }

  const skills = names.map((name) => {
    const meta = getSkillMeta(name);
    return { name, description: meta.description, tags: meta.tags };
  });

  res.json({ count: skills.length, skills });
});

// GET /api/skills/:name — skill detail
router.get("/:name", (req, res) => {
  const meta = getSkillMeta(req.params.name);
  if (!meta.content) {
    res.status(404).json({ error: `Skill '${req.params.name}' not found` });
    return;
  }
  res.json(meta);
});

export default router;
