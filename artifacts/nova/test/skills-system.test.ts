import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const skillsRoot = path.join(repoRoot, "openclaw", "workspace", "skills");

const requiredSkills = [
  "evidence-first-execution",
  "tool-orchestration-accuracy",
  "polyglot-software-engineering",
  "github-connected-operations",
  "durable-runtime-engineering",
  "osint-deep-research",
  "social-seo-attention",
  "personal-assistant-operations",
  "novaluis-runtime-operator",
];

function parseField(content: string, field: string): string {
  return content.match(new RegExp(`^${field}:\\s*(.+)$`, "mi"))?.[1]?.trim() ?? "";
}

describe("OpenClaw professional skill suite", () => {
  it("contains every required executable workspace skill", () => {
    for (const name of requiredSkills) {
      expect(fs.existsSync(path.join(skillsRoot, name, "SKILL.md")), name).toBe(true);
    }
  });

  it("uses valid unique frontmatter names and descriptions", () => {
    const seen = new Set<string>();
    for (const directory of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const file = path.join(skillsRoot, directory.name, "SKILL.md");
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf8");
      expect(content.startsWith("---\n"), directory.name).toBe(true);
      expect(content.indexOf("\n---\n", 4), directory.name).toBeGreaterThan(4);

      const name = parseField(content, "name");
      const description = parseField(content, "description");
      expect(name, directory.name).toMatch(/^[a-z0-9][a-z0-9-]{0,79}$/);
      expect(description.length, directory.name).toBeGreaterThan(24);
      expect(seen.has(name), `duplicate skill name ${name}`).toBe(false);
      seen.add(name);

      const metadata = parseField(content, "metadata");
      if (metadata) expect(() => JSON.parse(metadata), `${name} metadata`).not.toThrow();
      expect(content.length, `${name} catalog size`).toBeLessThanOrEqual(24_000);
    }
  });

  it("makes workspace skills visible through the NOVA skills API", () => {
    const route = fs.readFileSync(
      path.join(repoRoot, "artifacts", "api-server", "src", "routes", "skills.ts"),
      "utf8",
    );
    expect(route).toContain('path.resolve(process.cwd(), "openclaw", "workspace", "skills")');
    expect(route).toContain("MAX_SKILL_DEPTH = 6");
    expect(route).toContain('source: "workspace"');
    expect(route).toContain("first definition wins");
  });

  it("anchors specialized skills to evidence and verification", () => {
    const evidence = fs.readFileSync(
      path.join(skillsRoot, "evidence-first-execution", "SKILL.md"),
      "utf8",
    );
    expect(evidence).toContain("Mandatory pre-output self-check");
    expect(evidence).toContain("GO");
    expect(evidence).toContain("HOLD");
    expect(evidence).toContain("ABORT");

    for (const name of requiredSkills.filter((skill) => skill !== "evidence-first-execution")) {
      const content = fs.readFileSync(path.join(skillsRoot, name, "SKILL.md"), "utf8");
      expect(content).toMatch(/verify|evidence|verification/i);
    }
  });
});
