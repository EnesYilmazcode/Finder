// Per-section seat counts from Barrett's schedule, snapshotted daily by
// scripts/fetch-seats.mjs.
//
// OSU's own API cannot supply these: it reports one enrollment figure per
// course and repeats it onto every section, so it calls a 41/40 section "Open".
// See docs/osu-api.md.
//
// The snapshot is one file per term plus a small index, and a term is fetched
// when it is asked for. All three terms at once would be 154 KB gzipped on the
// eager path, before anything renders, to carry two terms most visitors never
// select. Loading one is 17 to 69 KB and a switch pays for itself once.

let index = null;
let indexLoading = null;

// Term code to that term's snapshot. Seats are only ever read out of this map
// under the key asked for, so a term that has not loaded reads as unknown and
// can never pick up another term's numbers.
const loaded = new Map();
const loadingTerms = new Map();

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`seats ${response.status}`);
  return response.json();
}

function dirOf(url) {
  return url.slice(0, url.lastIndexOf("/") + 1);
}

function entryFor(term) {
  if (!term) return null;
  return index?.terms?.find((t) => String(t.term) === String(term)) ?? null;
}

/**
 * Load the index, and one term's seats if a term is named.
 *
 * Resolves to the index either way. Safe to call repeatedly: the index is
 * fetched once and each term once. Rejects if a fetch fails, and a failed term
 * can be retried by calling again.
 */
export async function loadSeats(term, url = "data/seats.json") {
  if (!index) {
    // Cleared only on failure, so a failed index can be retried while a good
    // one is never fetched twice.
    indexLoading ??= getJson(url).catch((error) => {
      indexLoading = null;
      throw error;
    });
    index = await indexLoading;
  }

  const key = String(term ?? "");
  const entry = entryFor(key);
  // No entry means Barrett publishes nothing for that term. That is an answer,
  // not a failure, so there is nothing to fetch and nothing to throw.
  if (!entry || loaded.has(key)) return index;

  let pending = loadingTerms.get(key);
  if (!pending) {
    pending = getJson(`${dirOf(url)}${entry.file}`)
      .then((snapshot) => loaded.set(key, snapshot))
      .finally(() => loadingTerms.delete(key));
    loadingTerms.set(key, pending);
  }
  await pending;
  return index;
}

/** Every term the snapshot has seats for, oldest first. Empty until the index loads. */
export function seatsTerms() {
  return (index?.terms ?? []).map((t) => String(t.term));
}

/**
 * What is known about one term's seats, without waiting.
 *
 * "ready"    seats are in memory and seatsFor will answer
 * "loading"  a fetch is in flight, so ask again after loadSeats resolves
 * "missing"  the index has no such term, Barrett publishes nothing for it
 * "unknown"  the index is not loaded yet, or the term was never asked for
 *
 * "missing" is settled and "unknown" is not, which is the difference between
 * telling someone there are no seat counts for Summer and saying nothing yet.
 */
export function seatsStatus(term) {
  const key = String(term ?? "");
  if (loaded.has(key)) return "ready";
  if (loadingTerms.has(key)) return "loading";
  if (!index) return indexLoading ? "loading" : "unknown";
  return entryFor(key) ? "unknown" : "missing";
}

/** The term code once its seats are loaded and readable, or null. */
export function seatsTerm(term) {
  return seatsStatus(term) === "ready" ? String(term) : null;
}

/**
 * The date Barrett last refreshed one term, for labelling the numbers as dated.
 * Known as soon as the index is, before that term's seats are fetched.
 *
 * A term is needed. Barrett rebuilds a live term nightly but freezes a term
 * once it is over, so the dates differ: on 2026-08-18 Autumn 2026 was that
 * day, Summer 2026 was 2026-07-29 and Spring 2026 was 2026-04-27. There is no
 * one date for the snapshot, and stamping Autumn's onto Spring's numbers would
 * claim a freshness they do not have.
 */
export function seatsUpdated(term) {
  return entryFor(term)?.sourceUpdated ?? null;
}

/**
 * Seats for one section, or null when unknown. Never waits, since this is
 * called during render.
 *
 * Null covers every way seats can be unknown, and a term still loading is one
 * of them. That is deliberate: the alternative is answering from the term that
 * happens to be in memory, which is exactly the confidently wrong number the
 * term guard exists to prevent. Callers redraw when loadSeats resolves.
 */
export function seatsFor(classNumber, term) {
  if (!term) return null;
  const row = loaded.get(String(term))?.sections?.[String(classNumber)];
  if (!Array.isArray(row) || row.length < 2) return null;

  const [enrolled, limit, waitlist = 0] = row;
  if (typeof enrolled !== "number" || typeof limit !== "number") return null;

  // A capacity of zero is not a section with no seats, it is a section whose
  // capacity is not published. 8.1% of the snapshot looks like this, often as
  // [0, 0, 1]: no stated limit but someone already waiting. Rendering it as
  // 0/0 reads as open, which is the opposite of the truth.
  if (limit <= 0) return null;

  return {
    enrolled,
    limit,
    waitlist,
    full: limit > 0 && enrolled >= limit,
  };
}
