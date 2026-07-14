const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SNAPSHOT_CHARS = 42_000;
const MAX_TREE_ENTRIES = 2_500;
const MAX_FILE_CHARS = 8_000;

interface CacheEntry {
  expiresAt: number;
  snapshot: string;
}

const cache = new Map<string, CacheEntry>();

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
}

interface GitHubRepoMeta {
  full_name?: string;
  private?: boolean;
  description?: string | null;
  default_branch?: string;
  language?: string | null;
  size?: number;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  archived?: boolean;
  visibility?: string;
  pushed_at?: string;
  updated_at?: string;
  topics?: string[];
  license?: { spdx_id?: string | null; name?: string | null } | null;
}

interface GitHubTreeEntry {
  path?: string;
  mode?: string;
  type?: string;
  size?: number;
  sha?: string;
  url?: string;
}

interface GitHubTreeResponse {
  sha?: string;
  truncated?: boolean;
  tree?: GitHubTreeEntry[];
}

interface GitHubCommit {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string } | null;
    committer?: { name?: string; date?: string } | null;
  };
  author?: { login?: string } | null;
  committer?: { login?: string } | null;
}

interface GitHubContentFile {
  type?: string;
  path?: string;
  encoding?: string;
  content?: string;
  size?: number;
  download_url?: string | null;
}

function githubToken(): string {
  return (
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.NOVA_GITHUB_TOKEN ||
    ""
  ).trim();
}

function safeSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function headers(): Record<string, string> {
  const token = githubToken();
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "NOVA-OpenClaw/1.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson<T>(path: string, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${GITHUB_API}${path}`, {
      headers: headers(),
      signal: controller.signal,
    });
    const text = await response.text();
    let details: unknown = null;
    try {
      details = text ? JSON.parse(text) : null;
    } catch {
      details = text;
    }
    if (!response.ok) {
      const message =
        details && typeof details === "object" && "message" in details
          ? String((details as { message?: unknown }).message || "GitHub API request failed")
          : `GitHub API HTTP ${response.status}`;
      throw new Error(`${message} (HTTP ${response.status})`);
    }
    return details as T;
  } finally {
    clearTimeout(timer);
  }
}

export function extractGitHubRepoRefs(text: string): GitHubRepoRef[] {
  const refs = new Map<string, GitHubRepoRef>();
  const source = String(text || "");
  const urlPattern = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?=$|[\s/#?])/gi;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(source))) {
    const owner = match[1]!.replace(/^\.+|\.+$/g, "");
    const repo = match[2]!.replace(/\.git$/i, "").replace(/^\.+|\.+$/g, "");
    if (!owner || !repo) continue;
    const fullName = `${owner}/${repo}`;
    refs.set(fullName.toLowerCase(), {
      owner,
      repo,
      fullName,
      url: `https://github.com/${owner}/${repo}`,
    });
  }
  return [...refs.values()].slice(0, 3);
}

function decodeContent(file: GitHubContentFile): string {
  if (file.type !== "file" || file.encoding !== "base64" || !file.content) return "";
  try {
    return Buffer.from(file.content.replace(/\s+/g, ""), "base64")
      .toString("utf8")
      .slice(0, MAX_FILE_CHARS);
  } catch {
    return "";
  }
}

function selectHighSignalFiles(tree: GitHubTreeEntry[]): string[] {
  const exactPriority = [
    "README.md",
    "README.MD",
    "README.rst",
    "README.txt",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "pyproject.toml",
    "requirements.txt",
    "Pipfile",
    "Cargo.toml",
    "go.mod",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "render.yaml",
    "tsconfig.json",
    "vite.config.ts",
    "next.config.js",
    "next.config.mjs",
    "src/index.ts",
    "src/main.ts",
    "server.ts",
    "server.mjs",
    "app.py",
    "main.py",
    "CHANGELOG.md",
    "AI_NOTES.md",
  ];
  const files = tree
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
    .map((entry) => entry.path as string);
  const fileSet = new Set(files);
  const selected: string[] = [];
  for (const path of exactPriority) {
    if (fileSet.has(path)) selected.push(path);
  }
  for (const path of files) {
    if (selected.length >= 14) break;
    const depth = path.split("/").length;
    if (depth > 3) continue;
    if (/^(?:\.github\/workflows\/[^/]+\.ya?ml|artifacts\/api-server\/src\/(?:index|app)\.ts|src\/routes?\/index\.ts)$/i.test(path)) {
      if (!selected.includes(path)) selected.push(path);
    }
  }
  return selected.slice(0, 14);
}

function compactTree(tree: GitHubTreeEntry[]): Array<Record<string, unknown>> {
  return tree.slice(0, MAX_TREE_ENTRIES).map((entry) => ({
    path: entry.path || "",
    type: entry.type || "",
    size: typeof entry.size === "number" ? entry.size : undefined,
  }));
}

async function fetchFile(owner: string, repo: string, path: string): Promise<{ path: string; content: string; error?: string }> {
  try {
    const file = await githubJson<GitHubContentFile>(
      `/repos/${safeSegment(owner)}/${safeSegment(repo)}/contents/${path.split("/").map(safeSegment).join("/")}`,
    );
    const content = decodeContent(file);
    return {
      path,
      content: content || `[Binary, unsupported, or empty file; size=${file.size ?? "unknown"}]`,
    };
  } catch (error) {
    return { path, content: "", error: error instanceof Error ? error.message : String(error) };
  }
}

async function buildSnapshot(ref: GitHubRepoRef): Promise<string> {
  const key = ref.fullName.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;

  const meta = await githubJson<GitHubRepoMeta>(
    `/repos/${safeSegment(ref.owner)}/${safeSegment(ref.repo)}`,
  );
  const defaultBranch = String(meta.default_branch || "main");

  const [treeResult, commitResult, languageResult] = await Promise.allSettled([
    githubJson<GitHubTreeResponse>(
      `/repos/${safeSegment(ref.owner)}/${safeSegment(ref.repo)}/git/trees/${safeSegment(defaultBranch)}?recursive=1`,
      30_000,
    ),
    githubJson<GitHubCommit[]>(
      `/repos/${safeSegment(ref.owner)}/${safeSegment(ref.repo)}/commits?per_page=12`,
      20_000,
    ),
    githubJson<Record<string, number>>(
      `/repos/${safeSegment(ref.owner)}/${safeSegment(ref.repo)}/languages`,
      20_000,
    ),
  ]);

  const tree =
    treeResult.status === "fulfilled" && Array.isArray(treeResult.value.tree)
      ? treeResult.value.tree
      : [];
  const commits = commitResult.status === "fulfilled" ? commitResult.value : [];
  const languages = languageResult.status === "fulfilled" ? languageResult.value : {};
  const selectedFiles = selectHighSignalFiles(tree);
  const fileResults = await Promise.all(
    selectedFiles.map((path) => fetchFile(ref.owner, ref.repo, path)),
  );

  const evidence = {
    source: "GitHub REST API",
    fetchedAt: new Date().toISOString(),
    authenticated: Boolean(githubToken()),
    repository: {
      fullName: meta.full_name || ref.fullName,
      url: ref.url,
      private: Boolean(meta.private),
      visibility: meta.visibility || (meta.private ? "private" : "public"),
      description: meta.description || "",
      defaultBranch,
      primaryLanguage: meta.language || null,
      languages,
      sizeKb: meta.size ?? null,
      stars: meta.stargazers_count ?? null,
      forks: meta.forks_count ?? null,
      openIssues: meta.open_issues_count ?? null,
      archived: Boolean(meta.archived),
      topics: Array.isArray(meta.topics) ? meta.topics : [],
      license: meta.license?.spdx_id || meta.license?.name || null,
      pushedAt: meta.pushed_at || null,
      updatedAt: meta.updated_at || null,
    },
    tree: {
      recursive: true,
      truncated:
        treeResult.status === "fulfilled" ? Boolean(treeResult.value.truncated) : null,
      totalObservedEntries: tree.length,
      entries: compactTree(tree),
      error: treeResult.status === "rejected" ? String(treeResult.reason) : undefined,
    },
    recentCommits: commits.slice(0, 12).map((commit) => ({
      sha: commit.sha || "",
      message: String(commit.commit?.message || "").split("\n")[0],
      author: commit.author?.login || commit.commit?.author?.name || null,
      committedAt: commit.commit?.committer?.date || commit.commit?.author?.date || null,
      url: commit.html_url || null,
    })),
    selectedFiles: fileResults,
  };

  let snapshot = JSON.stringify(evidence, null, 2);
  if (snapshot.length > MAX_SNAPSHOT_CHARS) {
    snapshot = snapshot.slice(0, MAX_SNAPSHOT_CHARS) + "\n... [snapshot truncated by NOVA size guard]";
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, snapshot });
  return snapshot;
}

export async function getGitHubEvidenceForText(text: string): Promise<string> {
  const refs = extractGitHubRepoRefs(text);
  if (!refs.length) return "";

  const blocks: string[] = [];
  for (const ref of refs) {
    try {
      blocks.push(await buildSnapshot(ref));
    } catch (error) {
      blocks.push(
        JSON.stringify(
          {
            source: "GitHub REST API",
            fetchedAt: new Date().toISOString(),
            repository: ref.fullName,
            url: ref.url,
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      );
    }
  }
  return blocks.join("\n\n--- NEXT REPOSITORY ---\n\n");
}
