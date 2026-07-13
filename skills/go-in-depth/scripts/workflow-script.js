export const meta = {
  name: "go-in-depth",
  description:
    "Fan-out web research, source extraction, adversarial claim verification, and cited synthesis.",
  whenToUse:
    "Use for deep, multi-source, fact-checked research after the question has enough scope, region, timeframe, and constraints.",
  phases: [
    { title: "Scope", detail: "Decompose the question into complementary search angles" },
    { title: "Search", detail: "Search each angle in parallel" },
    { title: "Fetch", detail: "Deduplicate URLs and extract falsifiable claims" },
    { title: "Verify", detail: "Run three adversarial votes per claim" },
    { title: "Synthesize", detail: "Merge verified claims into a cited report" },
  ],
}

const VOTES_PER_CLAIM = 3
const REFUTATIONS_REQUIRED = 2
const MAX_FETCH = 15
const MAX_VERIFY_CLAIMS = 25

const SCOPE_SCHEMA = {
  type: "object",
  required: ["question", "angles", "summary"],
  properties: {
    question: { type: "string" },
    summary: { type: "string" },
    angles: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        required: ["label", "query"],
        properties: {
          label: { type: "string" },
          query: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
  },
}

const SEARCH_SCHEMA = {
  type: "object",
  required: ["results"],
  properties: {
    results: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        required: ["url", "title", "relevance"],
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          snippet: { type: "string" },
          relevance: { enum: ["high", "medium", "low"] },
        },
      },
    },
  },
}

const EXTRACT_SCHEMA = {
  type: "object",
  required: ["claims", "sourceQuality"],
  properties: {
    sourceQuality: {
      enum: ["primary", "secondary", "blog", "forum", "unreliable"],
    },
    publishDate: { type: "string" },
    claims: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        required: ["claim", "quote", "importance"],
        properties: {
          claim: { type: "string" },
          quote: { type: "string" },
          importance: { enum: ["central", "supporting", "tangential"] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: "object",
  required: ["refuted", "evidence", "confidence"],
  properties: {
    refuted: { type: "boolean" },
    evidence: { type: "string" },
    confidence: { enum: ["high", "medium", "low"] },
    counterSource: { type: "string" },
  },
}

const REPORT_SCHEMA = {
  type: "object",
  required: ["summary", "findings", "caveats"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["claim", "confidence", "sources", "evidence"],
        properties: {
          claim: { type: "string" },
          confidence: { enum: ["high", "medium", "low"] },
          sources: { type: "array", items: { type: "string" } },
          evidence: { type: "string" },
          vote: { type: "string" },
        },
      },
    },
    caveats: { type: "string" },
    openQuestions: { type: "array", items: { type: "string" } },
  },
}

function runtimeFunctions(runtime) {
  if (!runtime || typeof runtime !== "object") {
    throw new Error("go-in-depth runtime is required")
  }
  const { phase, agent, pipeline, parallel, log } = runtime
  for (const [name, value] of Object.entries({
    phase,
    agent,
    pipeline,
    parallel,
    log,
  })) {
    if (typeof value !== "function") {
      throw new Error(`go-in-depth runtime.${name} must be a function`)
    }
  }
  return { phase, agent, pipeline, parallel, log }
}

function normalizedUrl(value) {
  try {
    const url = new URL(String(value))
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key)
    }
    url.hash = ""
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}${url.search}`
  } catch {
    return String(value).trim().toLowerCase()
  }
}

function questionFrom(args) {
  if (typeof args === "string") return args.trim()
  if (args && typeof args === "object") {
    return String(args.query || args.question || "").trim()
  }
  return ""
}

export async function run(args, runtime) {
  const { phase, agent, pipeline, parallel, log } = runtimeFunctions(runtime)
  const question = questionFrom(args)
  if (!question) {
    return {
      error:
        "No research question provided. Pass a specific question in args or args.query.",
    }
  }

  phase("Scope")
  const scope = await agent(
    `Decompose the following research question into five complementary, non-duplicate search angles.\n\nQuestion: ${question}\n\nPrefer primary sources, current material, technical evidence, skeptical or contrary evidence, and practical implementation evidence. Return structured output only.`,
    { label: "scope", schema: SCOPE_SCHEMA },
  )
  if (!scope || !Array.isArray(scope.angles) || scope.angles.length === 0) {
    return { error: "Scope agent returned no usable search angles." }
  }

  log(`Question: ${question.slice(0, 120)}`)
  log(`Angles: ${scope.angles.map((angle) => angle.label).join(", ")}`)

  const seen = new Set()
  const duplicates = []
  const dropped = []
  let slots = MAX_FETCH
  const relevance = { high: 0, medium: 1, low: 2 }

  const sources = (
    await pipeline(
      scope.angles,
      (angle) =>
        agent(
          `Search the web for the original question from this angle.\n\nQuestion: ${question}\nAngle: ${angle.label}\nQuery: ${angle.query}\nRationale: ${angle.rationale || ""}\n\nReturn 4-6 high-signal results. Prefer authoritative and primary sources. Reject SEO spam. Structured output only.`,
          {
            label: `search:${angle.label}`,
            phase: "Search",
            schema: SEARCH_SCHEMA,
          },
        ).then((result) => ({ angle, results: result?.results || [] })),
      ({ angle, results }) => {
        const selected = [...results]
          .sort(
            (left, right) =>
              (relevance[left.relevance] ?? 9) -
              (relevance[right.relevance] ?? 9),
          )
          .filter((result) => {
            const key = normalizedUrl(result.url)
            if (!key || seen.has(key)) {
              duplicates.push(result)
              return false
            }
            if (slots <= 0) {
              dropped.push(result)
              return false
            }
            seen.add(key)
            slots -= 1
            return true
          })

        return parallel(
          selected.map((source) => () =>
            agent(
              `Fetch and inspect this source for the original research question.\n\nQuestion: ${question}\nURL: ${source.url}\nTitle: ${source.title}\nSearch angle: ${angle.label}\n\nExtract 2-5 concrete falsifiable claims. Include a direct supporting quote, source quality, publication date when available, and importance. If inaccessible or irrelevant, return an empty claims array and unreliable quality. Structured output only.`,
              {
                label: `fetch:${angle.label}`,
                phase: "Fetch",
                schema: EXTRACT_SCHEMA,
              },
            )
              .then((extraction) => ({
                url: source.url,
                title: source.title,
                angle: angle.label,
                sourceQuality: extraction?.sourceQuality || "unreliable",
                publishDate: extraction?.publishDate || "",
                claims: (extraction?.claims || []).map((claim) => ({
                  ...claim,
                  sourceUrl: source.url,
                  sourceQuality:
                    extraction?.sourceQuality || "unreliable",
                })),
              }))
              .catch((error) => {
                log(`Fetch failed for ${source.url}: ${error?.message || error}`)
                return {
                  url: source.url,
                  title: source.title,
                  angle: angle.label,
                  sourceQuality: "unreliable",
                  claims: [],
                }
              }),
          ),
        )
      },
    )
  )
    .flat()
    .filter(Boolean)

  const importance = { central: 0, supporting: 1, tangential: 2 }
  const quality = { primary: 0, secondary: 1, blog: 2, forum: 3, unreliable: 4 }
  const claims = sources
    .flatMap((source) => source.claims || [])
    .sort(
      (left, right) =>
        (importance[left.importance] ?? 9) -
          (importance[right.importance] ?? 9) ||
        (quality[left.sourceQuality] ?? 9) -
          (quality[right.sourceQuality] ?? 9),
    )
    .slice(0, MAX_VERIFY_CLAIMS)

  if (claims.length === 0) {
    return {
      question,
      summary: "No usable claims were extracted from the retrieved sources.",
      findings: [],
      refuted: [],
      sources,
      stats: {
        angles: scope.angles.length,
        sources: sources.length,
        claims: 0,
        duplicates: duplicates.length,
        budgetDropped: dropped.length,
      },
    }
  }

  phase("Verify")
  const voted = await parallel(
    claims.map((claim) => async () => {
      const verdicts = (
        await parallel(
          Array.from({ length: VOTES_PER_CLAIM }, (_, index) => () =>
            agent(
              `Act as adversarial verifier ${index + 1}/${VOTES_PER_CLAIM}. Try to refute this claim using credible current evidence.\n\nResearch question: ${question}\nClaim: ${claim.claim}\nSource: ${claim.sourceUrl}\nSource quality: ${claim.sourceQuality}\nSupporting quote: ${claim.quote}\n\nSet refuted=true for unsupported, contradicted, outdated, overstated, or inadequately sourced claims. Structured output only.`,
              {
                label: `verify:${index}:${String(claim.claim).slice(0, 40)}`,
                phase: "Verify",
                schema: VERDICT_SCHEMA,
              },
            ),
          ),
        )
      ).filter(Boolean)
      const refutedVotes = verdicts.filter((verdict) => verdict.refuted).length
      const survives =
        verdicts.length >= REFUTATIONS_REQUIRED &&
        refutedVotes < REFUTATIONS_REQUIRED
      return { ...claim, verdicts, refutedVotes, survives }
    }),
  )

  const confirmed = voted.filter((claim) => claim.survives)
  const refuted = voted.filter((claim) => !claim.survives)
  if (confirmed.length === 0) {
    return {
      question,
      summary:
        "All extracted claims failed adversarial verification or lacked a voting quorum.",
      findings: [],
      refuted: refuted.map((claim) => ({
        claim: claim.claim,
        source: claim.sourceUrl,
        vote: `${claim.verdicts.length - claim.refutedVotes}-${claim.refutedVotes}`,
      })),
      sources,
      stats: {
        angles: scope.angles.length,
        sources: sources.length,
        claims: claims.length,
        confirmed: 0,
        refuted: refuted.length,
      },
    }
  }

  phase("Synthesize")
  const evidenceBlock = confirmed
    .map(
      (claim, index) =>
        `### ${index + 1}. ${claim.claim}\nSource: ${claim.sourceUrl}\nQuote: ${claim.quote}\nVote: ${claim.verdicts.length - claim.refutedVotes}-${claim.refutedVotes}\nVerifier evidence: ${claim.verdicts.map((verdict) => verdict.evidence).join(" | ")}`,
    )
    .join("\n\n")

  const report = await agent(
    `Synthesize a cited, evidence-based report that directly answers the question. Merge duplicate claims, preserve source URLs, assign confidence, identify weak evidence and time-sensitive caveats, and list open questions.\n\nQuestion: ${question}\n\nVerified claims:\n${evidenceBlock}\n\nStructured output only.`,
    { label: "synthesize", phase: "Synthesize", schema: REPORT_SCHEMA },
  )

  return {
    question,
    ...(report || {
      summary:
        "Synthesis failed; verified claims are returned without narrative merging.",
      findings: confirmed.map((claim) => ({
        claim: claim.claim,
        confidence: "medium",
        sources: [claim.sourceUrl],
        evidence: claim.quote,
        vote: `${claim.verdicts.length - claim.refutedVotes}-${claim.refutedVotes}`,
      })),
      caveats: "Automated synthesis was unavailable.",
      openQuestions: [],
    }),
    refuted: refuted.map((claim) => ({
      claim: claim.claim,
      source: claim.sourceUrl,
      vote: `${claim.verdicts.length - claim.refutedVotes}-${claim.refutedVotes}`,
    })),
    sources: sources.map((source) => ({
      url: source.url,
      title: source.title,
      quality: source.sourceQuality,
      angle: source.angle,
      claimCount: source.claims.length,
    })),
    stats: {
      angles: scope.angles.length,
      sourcesFetched: sources.length,
      claimsExtracted: claims.length,
      confirmed: confirmed.length,
      refuted: refuted.length,
      urlDuplicates: duplicates.length,
      budgetDropped: dropped.length,
    },
  }
}

export default { meta, run }
