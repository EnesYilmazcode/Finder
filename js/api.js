// Client for OSU's public class API. See docs/osu-api.md.

const BASE = "https://content.osu.edu/v2";
const CAMPUS = "col";
const TIMEOUT_MS = 12000;
// Relevance is the upstream default and it reshuffles between identical
// requests. Catalog order does not. See docs/osu-api.md.
const SORT = "catalogNumber";
// Broad queries saturate totalItems here instead of counting it. See docs/osu-api.md.
export const RESULT_CAP = 10000;

export class ApiError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.cause = cause;
  }
}

async function getJson(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    // Empty strings are kept. Omitting q entirely makes the upstream API 500,
    // because it dereferences the parameter without checking it exists.
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") {
      throw new ApiError("Ohio State's course service is taking too long to answer. Try again.", { cause });
    }
    throw new ApiError("Could not reach Ohio State's course service. Check your connection and try again.", { cause });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ApiError(
      `Ohio State's course service returned an error (${response.status}). Try again in a moment.`,
      { status: response.status }
    );
  }

  let body;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ApiError("Ohio State's course service sent a response we could not read.", { cause });
  }

  if (!body || typeof body !== "object" || !("data" in body)) {
    throw new ApiError("Ohio State's course service sent an unexpected response.");
  }
  return body.data;
}

/**
 * Terms currently open to search, newest first.
 * Shape: { code, name, startDate, endDate }
 */
export async function fetchTerms() {
  const data = await getJson("/classes/searchableTermsV2");
  const terms = (data?.data ?? [])
    .filter((t) => t?.strm)
    .map((t) => ({
      code: String(t.strm),
      name: t.descr ?? String(t.strm),
      startDate: t.startDate ?? null,
      endDate: t.endDate ?? null,
    }));
  terms.sort((a, b) => b.code.localeCompare(a.code));
  return terms;
}

/**
 * The term code for a date, using OSU's strm format: "1" + two-digit year +
 * a term digit. Derived rather than hardcoded so the default does not rot,
 * but always checked against the live term list before use, since a
 * well-formed code does not mean the API has data for it.
 */
export function termCodeFor(date = new Date()) {
  const month = date.getMonth() + 1;
  const digit = month <= 4 ? "2" : month <= 7 ? "4" : "8";
  const year = String(date.getFullYear() % 100).padStart(2, "0");
  return `1${year}${digit}`;
}

/** The term to select on load: today's term if searchable, otherwise the newest. */
export function defaultTerm(terms, date = new Date()) {
  if (!terms?.length) return null;
  const wanted = termCodeFor(date);
  return terms.find((t) => t.code === wanted) ?? terms[0];
}

/**
 * Search classes. Returns { totalItems, totalPages, page, courses }.
 *
 * `sort`, `subject` and `gen-categories` are all real upstream parameters,
 * documented in docs/osu-api.md. `subject` has to be lowercase: `subject=CSE`
 * returns zero.
 */
export async function searchClasses({ q, term, page = 1, sort, subject, genCategory }) {
  if (!term) throw new ApiError("Pick a term before searching.");
  const data = await getJson("/classes/search", {
    q: q ?? "",
    campus: CAMPUS,
    term,
    p: page,
    sort,
    subject,
    // Sending it empty is not the same as leaving it off: `gen-categories=`
    // returns zero.
    "gen-categories": genCategory || undefined,
  });
  return {
    totalItems: data?.totalItems ?? 0,
    totalPages: data?.totalPages ?? 0,
    page,
    courses: data?.courses ?? [],
  };
}

const SUBJECT_TOKEN = /^[A-Za-z]{2,8}$/;
const NUMBER_TOKEN = /^\d{3,4}(\.\d+)?[A-Za-z]*$/;

/**
 * Read "CSE 2331" as a subject plus a catalog number.
 *
 * Only a query that carries both shapes is treated this way. A lone word is
 * left alone because "Smith" and "MATH" look identical from here, and guessing
 * wrong on a professor's name costs a wasted round trip on the commonest
 * search there is.
 */
export function subjectScope(raw) {
  const tokens = String(raw ?? "").trim().split(/\s+/).filter(Boolean);
  const s = tokens.findIndex((t) => SUBJECT_TOKEN.test(t));
  if (s < 0 || !tokens.some((t, i) => i !== s && NUMBER_TOKEN.test(t))) return null;
  return { subject: tokens[s].toLowerCase(), q: tokens.filter((_, i) => i !== s).join(" ") };
}

/**
 * Scope to a subject the caller already knows is real, like one picked out of
 * the subject dropdown. Same request shape as subjectScope, the code moved out
 * of `q` and into `subject`, with nothing left to guess at.
 */
function pickedScope(raw, subject) {
  const code = String(subject ?? "").trim().toLowerCase();
  if (!code) return null;
  const tokens = String(raw ?? "").trim().split(/\s+/).filter(Boolean);
  return { subject: code, q: tokens.filter((t) => t.toLowerCase() !== code).join(" ") };
}

/**
 * Search across several pages and merge.
 *
 * Two things upstream shape this, both measured in docs/osu-api.md.
 *
 * Relevance order does not reliably put a match on page 1: "Smith" returns 674
 * sections over 4 pages with zero of that professor's courses on either of the
 * first two, which is why this fetches more than one page at all.
 *
 * Relevance order is also not repeatable. Three identical "Smith" pulls
 * returned 93, 86 and 93 of his courses. `sort=catalogNumber` pins it, so it is
 * the default here.
 *
 * The catch is that a sorted page 1 is the lowest catalog numbers rather than
 * the best matches, which only hurts when the result runs past `maxPages` and
 * gets truncated. Bare "MATH" is the worst case: 11 pages, and five of them in
 * catalog order carry 21 of the 89 courses that relevance finds in three. So
 * when the answer does not fit, the relevance pass runs as well and both are
 * merged. rank.js dedupes by class number, so the extra page is free coverage.
 */
export async function searchAllPages({ q, term, maxPages = 5, subject, genCategory }) {
  const picked = pickedScope(q, subject);
  const scope = picked ?? subjectScope(q);
  let params = scope ? { q: scope.q, subject: scope.subject, genCategory } : { q, genCategory };

  let first = await searchClasses({ ...params, term, sort: SORT, page: 1 });

  // The subject guess was wrong, so that word was a name or a title, not a
  // subject code. Nothing matches a subject that is not offered. A picked code
  // is not a guess, so zero results there are real.
  if (scope && !picked && first.totalItems === 0) {
    params = { q, genCategory };
    first = await searchClasses({ ...params, term, sort: SORT, page: 1 });
  }

  const totalPages = first.totalPages ?? 1;
  const truncated = totalPages > maxPages;

  // When the whole result fits, catalog order is both complete and repeatable,
  // so the rest of it comes back the same way. When it does not fit, that first
  // sorted page is the wrong 200 sections, so the pull restarts in relevance
  // order and the sorted page stays in as extra coverage rather than a waste.
  const pending = truncated
    ? Array.from({ length: maxPages }, (_, i) => searchClasses({ ...params, term, page: i + 1 }))
    : Array.from({ length: totalPages - 1 }, (_, i) =>
        searchClasses({ ...params, term, sort: SORT, page: i + 2 })
      );

  const rest = await Promise.all(pending.map((r) => r.catch(() => ({ courses: [] }))));

  return {
    ...first,
    courses: [...first.courses, ...rest.flatMap((r) => r.courses)],
    pagesFetched: 1 + pending.length,
    sorted: !truncated,
    subject: params.subject ?? null,
  };
}
