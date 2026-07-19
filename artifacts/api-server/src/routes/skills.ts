import { Router } from "express";
import fs from "node:fs";
import path from "node:path";

const router = Router();
const MAX_SKILL_DEPTH = 6;
const MAX_CONTENT_CHARS = 24_000;

interface SkillMeta {
  name: string;
  description: string;
  tags: string[];
  content: string;
  source: "workspace" | "catalog";
  relativePath: string;
}

interface SkillRoot {
  source: SkillMeta["source"];
  root: string;
}

// Workspace skills have the same precedence used by OpenClaw. The legacy root
// catalog remains supported for existing UI-only skills and indexes.
const SKILL_ROOTS: SkillRoot[] = [
  {
    source: "workspace",
    root: path.resolve(process.cwd(), "openclaw", "workspace", "skills"),
  },
  {
    source: "catalog",
    root: path.resolve(process.cwd(), "skills"),
  },
];

function withinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function frontmatterValue(content: string, key: string): string {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"));
  if (!match) return "";
  return match[1]!.trim().replace(/^['"]|['"]$/g, "");
}

function skillFromFile(root: SkillRoot, filePath: string): SkillMeta | null {
  const resolved = path.resolve(filePath);
  if (!withinRoot(root.root, resolved)) return null;

  let content = "";
  try {
    content = fs.readFileSync(resolved, "utf8").slice(0, MAX_CONTENT_CHARS);
  } catch {
    return null;
  }

  const directoryName = path.basename(path.dirname(resolved));
  const fileName = path.basename(resolved, path.extname(resolved));
  const name = frontmatterValue(content, "name") ||
    (path.basename(resolved) === "SKILL.md" ? directoryName : fileName);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(name)) return null;

  const firstHeading = content
    .split("\n")
    .find((line) => line.trim().startsWith("#"))
    ?.replace(/^#+\s*/, "")
    .trim();
  const description = frontmatterValue(content, "description") || firstHeading || name;
  const tagMatch = content.match(/<!--\s*tags:(.*?)\s*-->/i);
  const tags = tagMatch
    ? tagMatch[1]!.split(",").map((tag) => tag.trim()).filter(Boolean)
    : [];

  return {
    name,
    description,
    tags,
    content,
    source: root.source,
    relativePath: path.relative(root.root, resolved).replaceAll(path.sep, "/"),
  };
}

function discoverRoot(root: SkillRoot): SkillMeta[] {
  if (!fs.existsSync(root.root)) return [];
  const discovered: SkillMeta[] = [];

  const walk = (directory: string, depth: number): void => {
    if (depth > MAX_SKILL_DEPTH || !withinRoot(root.root, directory)) return;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    const skillFile = entries.find((entry) => entry.isFile() && entry.name === "SKILL.md");
    if (skillFile) {
      const meta = skillFromFile(root, path.join(directory, skillFile.name));
      if (meta) discovered.push(meta);
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (
        depth === 0 &&
        entry.isFile() &&
        (entry.name.endsWith("-catalog.md") || entry.name.endsWith("-index.md"))
      ) {
        const meta = skillFromFile(root, fullPath);
        if (meta) discovered.push(meta);
      }
    }
  };

  walk(root.root, 0);
  return discovered;
}

function discoverSkills(): SkillMeta[] {
  const byName = new Map<string, SkillMeta>();
  // Roots are already ordered by precedence. first definition wins.
  for (const root of SKILL_ROOTS) {
    for (const skill of discoverRoot(root)) {
      if (!byName.has(skill.name)) byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

router.get("/", (_req, res) => {
  const skills = discoverSkills();
  res.json({
    count: skills.length,
    skills: skills.map(({ name, description, tags, source, relativePath }) => ({
      name,
      description,
      tags,
      source,
      relativePath,
    })),
  });
});

router.get("/:name", (req, res) => {
  const requested = String(req.params.name || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(requested)) {
    res.status(400).json({ error: "invalid skill name" });
    return;
  }

  const skill = discoverSkills().find((item) => item.name === requested);
  if (!skill) {
    res.status(404).json({ error: `Skill '${requested}' not found` });
    return;
  }
  res.json(skill);
});

export default router;
