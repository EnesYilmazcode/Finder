// Client for OSU's public class API. See docs/osu-api.md.

const BASE = "https://content.osu.edu/v2";
const CAMPUS = "col";

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
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }

  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (cause) {
    throw new ApiError("Could not reach Ohio State's course service. Check your connection and try again.", { cause });
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
 * Paging is non-deterministic upstream, so callers should keep queries narrow
 * enough to fit on one page rather than trying to enumerate everything.
 */
export async function searchClasses({ q, term, page = 1 }) {
  if (!term) throw new ApiError("Pick a term before searching.");
  const data = await getJson("/classes/search", { q: q ?? "", campus: CAMPUS, term, p: page });
  return {
    totalItems: data?.totalItems ?? 0,
    totalPages: data?.totalPages ?? 0,
    page,
    courses: data?.courses ?? [],
  };
}
