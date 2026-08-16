/**
 * research-sources.ts — Academic source pipeline for the research_forms types.
 *
 * Two channels feed the source-verification ledger:
 *   1. Academic channel (always on): OpenAlex + Semantic Scholar — peer-reviewed
 *      literature only, merged by DOI, deduped, ranked by citation count.
 *   2. Web channel (user toggle, handled in routes.ts via Groq browser_search):
 *      primary sources / public opinion. Web results that look like academic
 *      literature (DOI present or publisher-domain) are REJECTED by
 *      isAcademicLookalike() and must never reach the ledger as academic sources.
 *
 * Hard rules enforced here:
 *   - No Wikipedia / encyclopedias (any channel).
 *   - Complete citation or drop: every ledger source must have title + >=1
 *     author + year + DOI-or-URL + venue/publisher. Partial citations are
 *     rejected (user ruling: "if it isn't possible to do a complete citation
 *     that source cannot be used").
 *
 * Costs: OpenAlex free tier ($1/day ≈ 1,000 searches with a free key; keyless
 * works at 1/10 budget). Semantic Scholar: $0, 1 req/sec with key.
 */

/**
 * The research_forms type group (user-approved 2026-08-13).
 * Every member runs the two-channel source pipeline.
 */
export const RESEARCH_FORMS_TYPES: ReadonlySet<string> = new Set([
  "academic_research",
  "bibliography",
  "nonfiction_draft",
  "quick_research",
  "argumentative_essay",
  "questions",
]);

/**
 * Web-channel toggle default per type (user ruling):
 * OFF for pure-literature types, ON for types that need primary/public sources.
 */
export function researchFormWebDefault(type: string): boolean {
  return type !== "academic_research" && type !== "bibliography";
}

export interface ResearchSource {
  /** Stable ledger label, e.g. S1, S2 — assigned after merge. */
  label?: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  url: string | null;
  venue: string | null;
  publisher: string | null;
  citationCount: number;
  /** True when this record carries enough metadata for a complete citation. */
  citable: boolean;
  /** Which API produced the record. */
  provider: "openalex" | "semanticscholar";
  abstract?: string | null;
}

const OPENALEX_BASE = "https://api.openalex.org";
const S2_BASE = "https://api.semanticscholar.org/graph/v1";

function getS2ApiKey(): string | undefined {
  return process.env.SEMANTIC_SCHOLAR_API_KEY?.trim() || undefined;
}

function getOpenAlexApiKey(): string | undefined {
  return process.env.OPENALEX_API_KEY?.trim() || undefined;
}

/** Domains that are NEVER allowed as sources (user ruling). */
const BLOCKED_DOMAINS = new Set([
  "wikipedia.org",
  "en.wikipedia.org",
  "britannica.com",
  "encyclopedia.com",
  "encyclopaedia.com",
  "worldhistory.org",
  "newadvent.org",
]);

/** Publisher / academic domains that mark a web result as academic literature. */
const PUBLISHER_DOMAIN_FRAGMENTS = [
  "nature.com",
  "sciencedirect.com",
  "springer.com",
  "springeropen.com",
  "wiley.com",
  "tandfonline.com",
  "sagepub.com",
  "acs.org",
  "ieee.org",
  "acm.org",
  "aps.org",
  "science.org",
  "cell.com",
  "plos.org",
  "mdpi.com",
  "frontiersin.org",
  "oxfordjournals.org",
  "cambridge.org",
  "degruyter.com",
  "taylorfrancis.com",
  "rsc.org",
  "bmj.com",
  "thelancet.com",
  "nejm.org",
  "jamanetwork.com",
  "researchgate.net",
  "arxiv.org",
  "pubmed.ncbi.nlm.nih.gov",
  "europepmc.org",
  "semanticscholar.org",
  "openalex.org",
  "crossref.org",
  "doi.org",
  "biorxiv.org",
  "medrxiv.org",
  "ssrn.com",
  "jstor.org",
  "ebsco.com",
  "proquest.com",
  "scopus.com",
  "scholar.google.com",
  "eric.ed.gov",
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Wikipedia / encyclopedia check for any URL. */
export function isBlockedSource(url: string): boolean {
  const host = hostnameOf(url);
  return BLOCKED_DOMAINS.has(host) || BLOCKED_DOMAINS.has(host.replace(/^[a-z]{2}\./, ""));
}

/** True when a web result is actually academic literature (DOI or publisher domain). */
export function isAcademicLookalike(url: string): boolean {
  if (/doi\.org\/10\./i.test(url)) return true;
  if (/\/10\.\d{4,9}\//i.test(url)) return true;
  const host = hostnameOf(url);
  return PUBLISHER_DOMAIN_FRAGMENTS.some((frag) => host.includes(frag));
}

/** Reconstruct OpenAlex abstract (word -> positions inverted index). */
function reconstructAbstract(inverted: Record<string, number[]> | null): string | null {
  if (!inverted) return null;
  const entries: { pos: number; word: string }[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) entries.push({ pos, word });
  }
  entries.sort((a, b) => a.pos - b.pos);
  return entries.map((e) => e.word).join(" ");
}

/** Stopwords that carry no topical signal — never used for relevance checks. */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "are",
  "was", "were", "be", "been", "with", "from", "by", "at", "as", "it", "its",
  "this", "that", "these", "those", "their", "they", "we", "you", "i", "me",
  "my", "our", "your", "he", "she", "him", "her", "not", "no", "but", "how",
  "what", "why", "when", "which", "who", "whom", "role", "roles", "study",
  "studies", "research", "review", "analysis", "effect", "effects", "impact",
  "use", "using", "used", "among", "into", "during", "between", "about",
  "after", "before", "more", "most", "such", "than", "then", "there", "here",
  "also", "can", "could", "may", "might", "should", "would", "will", "does",
  "do", "has", "have", "had", "other", "others", "new", "old", "first",
]);

/**
 * Topic-neutral words that appear in almost ANY abstract (methodology,
 * outcomes, framing) and therefore carry no topical signal on their own.
 * "faith + step" or "program + based" is not evidence of relevance — a paper
 * on TV violence can match all four. These are EXCLUDED from the relevance
 * gate count so a source must match on rare, topic-carrying words
 * (spirituality, addiction, recovery, substance, abuse, …).
 */
const GENERIC_TERMS = new Set([
  "step", "steps", "based", "base", "twelve", "program", "programs",
  "programme", "programmes", "outcome", "outcomes", "mechanism", "mechanisms",
  "adult", "adults", "people", "person", "child", "children", "women", "men",
  "patient", "patients", "health", "care", "support", "supportive", "group",
  "groups", "experience", "experiences", "process", "processes", "approach",
  "approaches", "method", "methods", "model", "models", "practice", "practices",
  "finding", "findings", "result", "results", "purpose", "objective",
  "objectives", "background", "conclusion", "discussion", "introduction",
  "paper", "article", "author", "authors", "year", "years", "life", "time",
  "times", "way", "ways", "work", "works", "day", "days", "world", "context",
  "contexts", "related", "associated", "current", "possible", "potential",
  "important", "significant", "various", "different", "specific", "general",
  "national", "local", "public", "social", "personal", "individual",
  "individuals", "services", "service", "community", "communities",
]);

/**
 * Significant (non-stopword) terms from a query, stemmed lightly (plural → singular).
 * Used to verify a returned source actually matches the requested topic.
 */
export function significantTerms(query: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    terms.add(stem(raw));
  }
  return terms;
}

/**
 * First N significant (non-stopword) terms of a query, in original form —
 * used as the fielded-search keyword string for OpenAlex's
 * title_and_abstract.search filter. EBSCO-style: search core keywords in
 * TI+AB, not full sentences (fielded search ANDs every word, so long queries
 * destroy recall).
 */
export function topSignificantTerms(query: string, n: number): string {
  const terms: string[] = [];
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    terms.push(raw);
    if (terms.length >= n) break;
  }
  return terms.join(" ");
}

/**
 * Light English stemmer: strips common inflections so recovery/recovering/
 * recovered and spirituality/spiritual unify. Applied to BOTH query terms and
 * source title/abstract tokens before comparison.
 */
export function stem(word: string): string {
  let t = word;
  if (t.endsWith("ing") && t.length > 5) t = t.slice(0, -3);
  else if (t.endsWith("ity") && t.length > 5) t = t.slice(0, -3); // spirituality → spiritual
  else if (t.endsWith("ed") && t.length > 4) t = t.slice(0, -2);
  else if (t.endsWith("ies") && t.length > 4) t = t.slice(0, -3) + "y";
  else if (t.endsWith("es") && t.length > 4 && !t.endsWith("ss")) t = t.slice(0, -2);
  else if (t.endsWith("s") && !t.endsWith("ss") && t.length > 3) t = t.slice(0, -1);
  if (t.endsWith("y") && t.length > 4) t = t.slice(0, -1);
  return t;
}

/** Stemmed forms of the topic-neutral terms (for gate comparison). */
const GENERIC_STEMMED = new Set<string>([...GENERIC_TERMS].map(stem));

/**
 * Relevance gate (user ruling: "it wasn't even relevant info"): a source is
 * topically relevant only if its title or abstract shares at least TWO
 * SIGNAL terms with the query. "Signal" excludes topic-neutral words that
 * appear in any abstract (step, program, based, outcome, …) — a paper on TV
 * violence can legitimately mention "twelve", "step", "program" and "based",
 * so those must not count toward relevance. Rare topic-carrying words
 * (spirituality, addiction, recovery, substance, abuse, …) are what prove a
 * source is actually about the requested topic. If the query itself has
 * fewer than two signal terms, fall back to counting all significant terms.
 */
export function isTopicallyRelevant(source: Pick<ResearchSource, "title" | "abstract">, query: string): boolean {
  const queryTerms = significantTerms(query);
  if (queryTerms.size === 0) return true; // nothing meaningful to match — allow
  const querySignal = new Set([...queryTerms].filter((t) => !GENERIC_STEMMED.has(t)));
  const mustMatch = querySignal.size >= 2 ? querySignal : queryTerms;
  const haystackTerms = significantTerms(`${source.title || ""} ${source.abstract || ""}`);
  let shared = 0;
  for (const term of mustMatch) {
    if (haystackTerms.has(term)) shared++;
    if (shared >= 2) return true;
  }
  return false;
}

/** Completeness gate — a source is citable only with full citation metadata. */
export function isCitable(s: Omit<ResearchSource, "citable">): boolean {
  const hasTitle = !!(s.title && s.title.trim().length > 1);
  const hasAuthor = Array.isArray(s.authors) && s.authors.some((a) => a && a.trim().length > 1);
  const hasYear = typeof s.year === "number" && s.year > 1900 && s.year <= new Date().getFullYear() + 1;
  const hasLocator = !!s.doi || !!s.url;
  const hasVenue = !!(s.venue && s.venue.trim().length > 1) || !!(s.publisher && s.publisher.trim().length > 1);
  return hasTitle && hasAuthor && hasYear && hasLocator && hasVenue;
}

async function openAlexSearch(query: string, perPage = 15): Promise<ResearchSource[]> {
  // EBSCO-style fielded search: title + abstract only. OpenAlex's `search`
  // param matches FULL TEXT (references, citations, acknowledgements), which
  // drags in off-topic works that merely cite the topic. The
  // title_and_abstract.search FILTER is the fielded equivalent (TI+AB) and
  // must be composed inside `filter` — passing it as a top-level param is
  // invalid.
  //
  // Fielded search ANDs every word, so long extracted queries (6-12 words)
  // collapse recall (e.g. 6 hits vs 234 with the core terms). Trim to the
  // first ~4 significant terms — the same way EBSCO searches TI+AB with
  // core keywords, not full sentences. isTopicallyRelevant() below still
  // gates on the FULL query, and the model evaluates each source, so
  // precision is preserved.
  const cleanQuery = query
    .replace(/[,|:()"'\u0060]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const searchTerms = topSignificantTerms(cleanQuery, 4) || cleanQuery;
  const params = new URLSearchParams({
    filter: `title_and_abstract.search:${searchTerms},type:article|review,primary_location.source.type:journal,has_doi:true,is_retracted:false`,
    per_page: String(perPage),
    // Academic channel = PEER-REVIEWED JOURNAL literature ONLY (user ruling):
    //   - type article|review (no posters, zines, editorials, datasets)
    //   - primary_location.source.type:journal (established journals only)
    //   - has_doi:true (verifiable DOI required)
    //   - is_retracted:false (no retracted works)
    select: "id,doi,title,publication_year,authorships,primary_location,cited_by_count,abstract_inverted_index",
  });
  const key = getOpenAlexApiKey();
  if (key) params.set("api_key", key);
  const res = await fetch(`${OPENALEX_BASE}/works?${params.toString()}`, {
    headers: { "User-Agent": "Proset-research/1.0 (mailto:contact@schoedel.design)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("openalex_rate_limited");
    throw new Error(`openalex_http_${res.status}`);
  }
  const data = (await res.json()) as {
    results?: {
      id?: string;
      doi?: string | null;
      title?: string | null;
      publication_year?: number | null;
      cited_by_count?: number;
      authorships?: { author?: { display_name?: string } }[];
      primary_location?: { source?: { display_name?: string | null; host_organization_name?: string | null } | null } | null;
      abstract_inverted_index?: Record<string, number[]> | null;
    }[];
  };
  const out: ResearchSource[] = [];
  for (const w of data.results || []) {
    const source = w.primary_location?.source;
    const src: Omit<ResearchSource, "citable"> = {
      title: w.title || "",
      authors: (w.authorships || []).map((a) => a.author?.display_name || "").filter(Boolean),
      year: w.publication_year ?? null,
      doi: w.doi || null,
      url: w.doi || null,
      venue: source?.display_name || null,
      publisher: source?.host_organization_name || null,
      citationCount: w.cited_by_count || 0,
      provider: "openalex",
      abstract: reconstructAbstract(w.abstract_inverted_index ?? null),
    };
    // Relevance gate: drop results that don't share a significant term with
    // the query in title/abstract (full-text search matches citations too).
    if (!isTopicallyRelevant(src, query)) continue;
    out.push({ ...src, citable: isCitable(src) });
  }
  return out;
}

async function semanticScholarSearch(query: string, limit = 15): Promise<ResearchSource[]> {
  const key = getS2ApiKey();
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: "title,authors,year,externalIds,venue,publicationVenue,citationCount,abstract,openAccessPdf,url,publicationTypes,journal",
  });
  const res = await fetch(`${S2_BASE}/paper/search?${params.toString()}`, {
    headers: {
      ...(key ? { "x-api-key": key } : {}),
      "User-Agent": "Proset-research/1.0 (mailto:contact@schoedel.design)",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("s2_rate_limited");
    throw new Error(`s2_http_${res.status}`);
  }
  const data = (await res.json()) as {
    data?: {
      title?: string | null;
      year?: number | null;
      venue?: string | null;
      citationCount?: number;
      abstract?: string | null;
      externalIds?: { DOI?: string | null } | null;
      url?: string | null;
      publicationVenue?: { name?: string | null } | null;
      publicationTypes?: string[] | null;
      journal?: { name?: string | null } | null;
      authors?: { name?: string }[];
    }[];
  };
  const out: ResearchSource[] = [];
  for (const p of data.data || []) {
    // Peer-reviewed journal rule (user ruling): keep only papers whose
    // publication type is a journal article / review / meta-analysis, or
    // that carry a real journal name (S2 sometimes omits publicationTypes).
    const types = p.publicationTypes || [];
    const hasJournal = !!(p.journal?.name || p.publicationVenue?.name || p.venue);
    const isPeerReviewed = types.some((t) =>
      ["JournalArticle", "Review", "MetaAnalysis", "ClinicalTrial", "CaseReport", "BookChapter"].includes(t),
    );
    if (!isPeerReviewed && !(types.length === 0 && hasJournal)) continue;
    const src: Omit<ResearchSource, "citable"> = {
      title: p.title || "",
      authors: (p.authors || []).map((a) => a.name || "").filter(Boolean),
      year: p.year ?? null,
      doi: p.externalIds?.DOI || null,
      url: p.url || null,
      venue: p.publicationVenue?.name || p.venue || p.journal?.name || null,
      publisher: null,
      citationCount: p.citationCount || 0,
      provider: "semanticscholar",
      abstract: p.abstract || null,
    };
    // Relevance gate (same as OpenAlex): drop results whose title/abstract
    // share no significant term with the query.
    if (!isTopicallyRelevant(src, query)) continue;
    out.push({ ...src, citable: isCitable(src) });
  }
  return out;
}

function normalizeDoi(doi: string | null): string | null {
  if (!doi) return null;
  return doi.replace(/^https?:\/\/doi\.org\//i, "").trim().toLowerCase();
}

/** Merge OpenAlex + S2 results: dedupe by DOI, keep the richer record. */
export function mergeByDoi(openAlex: ResearchSource[], s2: ResearchSource[]): ResearchSource[] {
  const byDoi = new Map<string, ResearchSource>();
  const noDoi: ResearchSource[] = [];

  const mergeInto = (src: ResearchSource) => {
    const doi = normalizeDoi(src.doi);
    if (!doi) {
      noDoi.push(src);
      return;
    }
    const existing = byDoi.get(doi);
    if (!existing) {
      byDoi.set(doi, src);
      return;
    }
    // Keep the record with more complete metadata.
    const score = (r: ResearchSource) =>
      (r.abstract ? 1 : 0) + (r.venue ? 1 : 0) + Math.min(r.citationCount, 1000) / 1000;
    if (score(src) > score(existing)) byDoi.set(doi, src);
  };

  for (const s of [...openAlex, ...s2]) mergeInto(s);
  const merged = [...Array.from(byDoi.values()), ...noDoi];
  // Rank: citable first, then by citation count desc.
  return merged.sort((a, b) => {
    if (a.citable !== b.citable) return a.citable ? -1 : 1;
    return b.citationCount - a.citationCount;
  });
}

/** Normalize DOIs to bare form (https://doi.org/10.x → 10.x) for ledger display. */
export function formatDoi(doi: string | null): string | null {
  return normalizeDoi(doi);
}

export interface AcademicSearchOptions {
  /** Number of results per API (default 15 each). */
  perProvider?: number;
  /** Max results after merge/dedupe (default 20). */
  maxResults?: number;
}

/**
 * Run the academic channel for one query: OpenAlex + S2 in parallel, merged by
 * DOI, filtered to citable records, capped at maxResults (default 20).
 */
export async function searchAcademicSources(
  query: string,
  options: AcademicSearchOptions = {},
): Promise<ResearchSource[]> {
  const perProvider = options.perProvider ?? 15;
  const [oaResult, s2Result] = await Promise.allSettled([
    openAlexSearch(query, perProvider),
    semanticScholarSearch(query, perProvider),
  ]);
  const openAlex = oaResult.status === "fulfilled" ? oaResult.value : [];
  const s2Papers = s2Result.status === "fulfilled" ? s2Result.value : [];
  const merged = mergeByDoi(openAlex, s2Papers);
  const citable = merged.filter((s) => s.citable).slice(0, 20);
  return citable;
}

/**
 * Run the academic channel for MULTIPLE queries (e.g. derived from a real
 * transcript by query extraction). Each query hits both APIs; results are
 * merged by DOI and deduped, then capped at maxResults (default 20).
 */
export async function searchAcademicSourcesMulti(
  queries: string[],
  options: AcademicSearchOptions = {},
): Promise<ResearchSource[]> {
  const unique = [...Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean)))];
  if (unique.length === 0) return [];
  const perProvider = options.perProvider ?? 15;
  const settled = await Promise.allSettled(
    unique.map((q) => searchAcademicSources(q, { perProvider })),
  );
  const all: ResearchSource[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") all.push(...r.value);
  }
  const merged = mergeByDoi(all, []);
  return merged.filter((s) => s.citable).slice(0, options.maxResults ?? 20);
}

/** Format the merged ledger for prompt injection. */
export function formatLedger(sources: ResearchSource[], prefix = "S"): string {
  if (sources.length === 0) return "";
  const lines = sources.map((s, i) => {
    const label = `${prefix}${i + 1}`;
    const doi = normalizeDoi(s.doi);
    const locator = doi ? `https://doi.org/${doi}` : s.url;
    const venue = s.venue || s.publisher || "Unknown venue";
    const authors = s.authors.join(", ");
    return `[${label}] ${s.title} — ${authors} (${s.year ?? "n.d."}). ${venue}. ${locator}`;
  });
  return lines.join("\n");
}
