import { Router } from "express";
import fs from "node:fs";
import path from "node:path";

const router = Router();
const SKILLS_ROOT = path.resolve(process.cwd(), "skills");
const MAX_SKILL_BYTES = 64 * 1024;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface SkillMeta {
  name: string;
  description: string;
  tags: string[];
  content: string;
}

function contained(candidate: string): boolean {
  const relative = path.relative(SKILLS_ROOT, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function skillPath(name: string): string | null {
  if (!SAFE_NAME.test(name)) return null;
  const candidates = [
    path.join(SKILLS_ROOT, name, "SKILL.md"),
    path.join(SKILLS_ROOT, `${name}.md`),
  ];
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync(candidate);
      if (contained(real) && fs.statSync(real).isFile()) return real;
    } catch {
      // Try the next supported shape.
    }
  }
  return null;
}

function getSkillMeta(name: string): SkillMeta {
  const source = skillPath(name);
  if (!source) return { name, description: name, tags: [], content: "" };
  const content = fs.readFileSync(source, "utf8").slice(0, MAX_SKILL_BYTES);
  const heading = content
    .split("\n")
    .find((line) => line.trim().startsWith("#"));
  const description = heading?.replace(/^#+\s*/, "").trim() || name;
  const tagMatch = content.match(/<!--\s*tags:(.*?)\s*-->/i);
  const tags = tagMatch
    ? tagMatch[1]
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];
  return { name, description, tags, content };
}

function listSkillNames(): string[] {
  if (!fs.existsSync(SKILLS_ROOT)) return [];
  const names = new Set<string>();
  for (const entry of fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && SAFE_NAME.test(entry.name)) {
      if (skillPath(entry.name)) names.add(entry.name);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const base = entry.name.slice(0, -3);
    if (
      SAFE_NAME.test(base) &&
      (base.endsWith("-catalog") || base.endsWith("-index")) &&
      skillPath(base)
    ) {
      names.add(base);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

router.get("/", (_req, res) => {
  try {
    const skills = listSkillNames().map((name) => {
      const meta = getSkillMeta(name);
      return { name, description: meta.description, tags: meta.tags };
    });
    res.json({ count: skills.length, skills });
  } catch {
    res.status(500).json({ error: "skills catalog unavailable" });
  }
});

router.get("/:name", (req, res) => {
  if (!SAFE_NAME.test(req.params.name)) {
    res.status(400).json({ error: "invalid skill name" });
    return;
  }
  try {
    const meta = getSkillMeta(req.params.name);
    if (!meta.content) {
      res.status(404).json({ error: "skill not found" });
      return;
    }
    res.json(meta);
  } catch {
    res.status(500).json({ error: "failed to read skill" });
  }
});

export default router;
