import { boundedInt, env, errorResult, providerJson } from "./bos-omega-core.mjs";

function token() { return env("GITHUB_TOKEN") || env("GH_TOKEN"); }
function headers() {
  if (!token()) throw new Error("GitHub is not configured");
  return {
    Authorization: `Bearer ${token()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "BOS-OMEGA/1.0",
  };
}
function repoName(input) {
  const value = String(input || "").trim();
  const match = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(value);
  if (!match) throw new Error("repo must be owner/name or a GitHub repository URL");
  return `${match[1]}/${match[2]}`;
}
function branchName(input) {
  const value = String(input || "").trim();
  if (!value || value.length > 200 || value.startsWith("/") || value.endsWith("/") || value.includes("..") || /[~^:?*\[\\\s]/.test(value)) {
    throw new Error("invalid branch name");
  }
  return value;
}
function encodedPath(value) {
  return String(value || "").split("/").filter(Boolean).map((segment) => {
    if (segment === "." || segment === "..") throw new Error("path traversal is not allowed");
    return encodeURIComponent(segment);
  }).join("/");
}
async function request(pathname, options = {}) {
  return providerJson(`https://api.github.com${pathname}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  }, "github");
}

export async function githubGetRepo(args) {
  try {
    const repo = repoName(args.repo);
    const data = await request(`/repos/${repo}`);
    return {
      repo: data.full_name,
      description: data.description || "",
      private: Boolean(data.private),
      defaultBranch: data.default_branch,
      archived: Boolean(data.archived),
      disabled: Boolean(data.disabled),
      updatedAt: data.updated_at,
      pushedAt: data.pushed_at,
      openIssues: data.open_issues_count,
      language: data.language,
      htmlUrl: data.html_url,
    };
  } catch (error) { return errorResult("github_repo_failed", error?.message || error); }
}

export async function githubListContents(args) {
  try {
    const repo = repoName(args.repo);
    const path = encodedPath(args.path || "");
    const query = args.ref ? `?ref=${encodeURIComponent(String(args.ref))}` : "";
    const data = await request(`/repos/${repo}/contents/${path}${query}`);
    const rows = Array.isArray(data) ? data : [data];
    return {
      repo,
      path: String(args.path || ""),
      entries: rows.slice(0, 200).map((row) => ({
        name: row.name,
        path: row.path,
        type: row.type,
        size: row.size,
        sha: row.sha,
        downloadUrl: row.download_url || null,
      })),
      truncated: rows.length > 200,
    };
  } catch (error) { return errorResult("github_list_failed", error?.message || error); }
}

export async function githubReadFile(args) {
  try {
    const repo = repoName(args.repo);
    const path = encodedPath(args.path);
    if (!path) throw new Error("path is required");
    const query = args.ref ? `?ref=${encodeURIComponent(String(args.ref))}` : "";
    const data = await request(`/repos/${repo}/contents/${path}${query}`);
    if (data.type !== "file" || !data.content) throw new Error("path is not a readable file");
    const buffer = Buffer.from(String(data.content).replace(/\n/g, ""), data.encoding === "base64" ? "base64" : "utf8");
    const maximum = boundedInt(args.max_bytes, 200_000, 1_024, 1_000_000);
    return {
      repo,
      path: data.path,
      sha: data.sha,
      size: data.size,
      content: buffer.subarray(0, maximum).toString("utf8"),
      truncated: buffer.length > maximum,
    };
  } catch (error) { return errorResult("github_read_failed", error?.message || error); }
}

export async function githubSearchCode(args) {
  try {
    const repo = repoName(args.repo);
    const query = String(args.query || "").trim().slice(0, 256);
    if (!query) throw new Error("query is required");
    const count = boundedInt(args.max_results, 20, 1, 50);
    const data = await request(`/search/code?q=${encodeURIComponent(`${query} repo:${repo}`)}&per_page=${count}`);
    return {
      repo,
      query,
      results: (data.items || []).map((row) => ({ name: row.name, path: row.path, sha: row.sha, htmlUrl: row.html_url })),
      totalCount: data.total_count || 0,
      incompleteResults: Boolean(data.incomplete_results),
    };
  } catch (error) { return errorResult("github_search_failed", error?.message || error); }
}

export async function githubCreateBranch(args) {
  try {
    const repo = repoName(args.repo);
    const branch = branchName(args.branch);
    const source = String(args.source_sha || "").trim();
    if (!/^[0-9a-f]{40}$/i.test(source)) throw new Error("source_sha must be a full 40-character commit SHA");
    const data = await request(`/repos/${repo}/git/refs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: source }),
    });
    return { repo, branch, ref: data.ref, sha: data.object?.sha || source };
  } catch (error) { return errorResult("github_branch_failed", error?.message || error); }
}

export async function githubUpdateFile(args) {
  try {
    const repo = repoName(args.repo);
    const path = encodedPath(args.path);
    const branch = branchName(args.branch);
    const message = String(args.message || "").trim().slice(0, 1000);
    const content = String(args.content ?? "");
    const sha = String(args.sha || "").trim();
    if (!path || !message) throw new Error("path and message are required");
    if (Buffer.byteLength(content) > 1_000_000) throw new Error("content exceeds 1 MB limit");
    if (sha && !/^[0-9a-f]{40}$/i.test(sha)) throw new Error("sha must be a full blob SHA when supplied");
    const data = await request(`/repos/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        branch,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });
    return {
      repo,
      branch,
      path: data.content?.path || String(args.path),
      contentSha: data.content?.sha || null,
      commitSha: data.commit?.sha || null,
      htmlUrl: data.content?.html_url || null,
    };
  } catch (error) { return errorResult("github_update_failed", error?.message || error); }
}

export async function githubCreateIssue(args) {
  try {
    const repo = repoName(args.repo);
    const title = String(args.title || "").trim().slice(0, 256);
    if (!title) throw new Error("title is required");
    const data = await request(`/repos/${repo}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body: String(args.body || "").slice(0, 60_000) }),
    });
    return { repo, number: data.number, htmlUrl: data.html_url, state: data.state, title: data.title };
  } catch (error) { return errorResult("github_issue_failed", error?.message || error); }
}

export async function githubCreatePullRequest(args) {
  try {
    const repo = repoName(args.repo);
    const title = String(args.title || "").trim().slice(0, 256);
    const head = branchName(args.head);
    const base = branchName(args.base || "main");
    if (!title) throw new Error("title is required");
    const data = await request(`/repos/${repo}/pulls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body: String(args.body || "").slice(0, 60_000), head, base, draft: args.draft !== false }),
    });
    return { repo, number: data.number, htmlUrl: data.html_url, state: data.state, draft: Boolean(data.draft) };
  } catch (error) { return errorResult("github_pr_failed", error?.message || error); }
}

export async function githubProbe() { return request("/user"); }
