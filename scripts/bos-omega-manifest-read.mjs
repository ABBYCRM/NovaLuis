import { arraySchema as A, capabilityReport, integerSchema as I, jsonSchema as O, publicHttpFetch, stringSchema as S } from "./bos-omega-core.mjs";
import { browserFetch, webSearch } from "./bos-omega-search.mjs";
import { githubGetRepo, githubListContents, githubReadFile, githubSearchCode } from "./bos-omega-github.mjs";
import { embeddingsCreate, pineconeQuery, probeProviders, screenshotUrl } from "./bos-omega-services.mjs";
import { calculator, diffRender, fileExists, grepFiles, listDirectory, memoryGet, memorySearch, readFile, searchFiles, workingDirectory } from "./bos-omega-files.mjs";
import { agentsList, askUser, finish, imageGenerate, sessionStatus, updatePlan } from "./bos-omega-exec.mjs";

const str = (d) => S(d);
const int = (d, a = 1, b = 100) => I(d, a, b);
const arr = (d, items) => A(d, items);
const obj = (properties, required = []) => O(properties, required);
const def = (name, category, description, schema, run, options = {}) => ({ name, category, description, schema, run, risk: "low", requiresAuth: false, requiresApproval: false, internalOnly: false, capability: null, aliases: [], ...options });

export const READ_TOOLS = [
  def("capabilities", "runtime", "List capability states without exposing secret values.", obj({}), async () => ({ capabilities: capabilityReport() })),
  def("provider_probes", "runtime", "Probe configured GitHub, OpenAI, and Kimi providers.", obj({}), probeProviders, { requiresAuth: true }),
  def("calculator", "runtime", "Evaluate bounded arithmetic.", obj({ expression: str("Arithmetic expression.") }, ["expression"]), calculator),
  def("http_fetch", "web", "GET/HEAD a public URL with DNS pinning, redirect revalidation, timeout, and body cap.", obj({ url: str("Public URL."), method: { type: "string", enum: ["GET", "HEAD"] }, max_bytes: int("Body cap.", 1024, 10485760), max_redirects: int("Redirect cap.", 0, 5), timeout_ms: int("Timeout ms.", 1000, 120000) }, ["url"]), publicHttpFetch, { risk: "medium", aliases: ["web_fetch"] }),
  def("web_search", "web", "Search via Tavily, Exa, Firecrawl, then Brave with failure fallthrough.", obj({ query: str("Search query."), max_results: int("Result cap.", 1, 20) }, ["query"]), webSearch, { risk: "medium", requiresAuth: true, aliases: ["search_web"] }),
  def("browser_fetch", "browser", "Fetch through Steel, ScrapingBee, Scrapfly, or direct safe HTTP.", obj({ url: str("Public URL.") }, ["url"]), (args) => browserFetch(args, publicHttpFetch), { risk: "medium", requiresAuth: true }),
  def("screenshot_url", "media", "Capture a public URL to a verified PNG in the run directory.", obj({ url: str("Public URL."), full_page: { type: "boolean" } }, ["url"]), (args, ctx) => screenshotUrl(args, ctx, workingDirectory), { risk: "medium", requiresAuth: true, capability: "screenshot.screenshotone" }),
  def("github_get_repo", "git", "Read GitHub repository metadata.", obj({ repo: str("owner/name or URL.") }, ["repo"]), githubGetRepo, { requiresAuth: true, capability: "github.api" }),
  def("github_list_contents", "git", "List a GitHub repository directory.", obj({ repo: str("owner/name or URL."), path: str("Repository path."), ref: str("Optional ref.") }, ["repo"]), githubListContents, { requiresAuth: true, capability: "github.api" }),
  def("github_read_file", "git", "Read a GitHub repository file.", obj({ repo: str("owner/name or URL."), path: str("Repository file path."), ref: str("Optional ref."), max_bytes: int("Byte cap.", 1024, 1000000) }, ["repo", "path"]), githubReadFile, { requiresAuth: true, capability: "github.api" }),
  def("github_search_code", "git", "Search code inside one GitHub repository.", obj({ repo: str("owner/name or URL."), query: str("Search query."), max_results: int("Result cap.", 1, 50) }, ["repo", "query"]), githubSearchCode, { requiresAuth: true, capability: "github.api" }),
  def("embeddings_create", "memory", "Create an OpenAI embedding and return model/dimensions.", obj({ input: str("Text input."), include_vector: { type: "boolean" } }, ["input"]), embeddingsCreate, { risk: "medium", requiresAuth: true, capability: "embeddings.openai" }),
  def("pinecone_query", "memory", "Embed a query and search the configured Pinecone index.", obj({ query: str("Semantic query."), namespace: str("Optional namespace."), top_k: int("Match cap.", 1, 100) }, ["query"]), pineconeQuery, { risk: "medium", requiresAuth: true, capability: "vector.pinecone" }),
  def("image_generate", "media", "Generate and signature-check an image through Bitdeer.", obj({ prompt: str("Image prompt."), size: str("Optional size.") }, ["prompt"]), imageGenerate, { risk: "medium", requiresAuth: true, capability: "model.bitdeer", aliases: ["generate_image"] }),
  def("list_directory", "filesystem", "List a run working-directory path.", obj({ path: str("Run-relative path.") }), listDirectory, { requiresAuth: true, aliases: ["list_folder", "open_folder"] }),
  def("read_file", "filesystem", "Read a run working-directory file.", obj({ path: str("Run-relative path."), max_bytes: int("Byte cap.", 1, 10485760) }, ["path"]), readFile, { requiresAuth: true, aliases: ["read", "open_file"] }),
  def("file_exists", "filesystem", "Check a run path.", obj({ path: str("Run-relative path.") }, ["path"]), fileExists, { requiresAuth: true }),
  def("search_files", "filesystem", "Find run files by bounded glob.", obj({ pattern: str("Glob."), path: str("Run-relative root.") }, ["pattern"]), searchFiles, { requiresAuth: true }),
  def("grep_files", "filesystem", "Regex-search bounded run files.", obj({ pattern: str("Regex."), path: str("Run-relative root."), ignore_case: { type: "boolean" }, max_matches: int("Match cap.", 1, 500) }, ["pattern"]), grepFiles, { requiresAuth: true }),
  def("diff_render", "filesystem", "Render a simple text diff.", obj({ before: str("Original."), after: str("Replacement.") }, ["before", "after"]), diffRender, { requiresAuth: true }),
  def("memory_get", "memory", "Get a local memory key.", obj({ key: str("Key.") }, ["key"]), memoryGet, { requiresAuth: true }),
  def("memory_search", "memory", "Search local memory.", obj({ query: str("Query."), limit: int("Result cap.", 1, 100) }, ["query"]), memorySearch, { requiresAuth: true }),
  def("session_status", "control", "Return redacted execution context.", obj({}), sessionStatus),
  def("agents_list", "control", "List BOS OMEGA runtime agents.", obj({}), agentsList),
  def("update_plan", "control", "Record a plan update.", obj({ steps: arr("Steps.", { type: "object", additionalProperties: true }) }, ["steps"]), updatePlan),
  def("ask_user", "control", "Pause for necessary input.", obj({ question: str("Question."), options: arr("Choices.", { type: "string" }) }, ["question"]), askUser),
  def("finish", "control", "Finish with a final answer.", obj({ answer: str("Answer.") }, ["answer"]), finish),
];
