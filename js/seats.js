// Per-section seat counts from Barrett's schedule, snapshotted daily by
// scripts/fetch-seats.mjs.
//
// OSU's own API cannot supply these: it reports one enrollment figure per
// course and repeats it onto every section, so it calls a 41/40 section "Open".
// See docs/osu-api.md.

let snapshot = null;
let loading = null;

export async function loadSeats(url = "data/seats.json") {
  if (snapshot) return snapshot;
  if (loading) return loading;

  loading = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`seats ${response.status}`);
    snapshot = await response.json();
    return snapshot;
  })();

  return loading;
}

/**
 * The term code if this snapshot covers it, or null.
 *
 * The snapshot holds every term the API reports as searchable, but a term can
 * still be missing: Barrett publishes on its own schedule, and a term added
 * upstream today is not in yesterday's file.
 */
export function seatsTerm(term) {
  if (!term) return null;
  return snapshot?.terms?.[String(term)] ? String(term) : null;
}

/**
 * The date Barrett last refreshed one term, for labelling the numbers as dated.
 *
 * A term is needed. Barrett rebuilds a live term nightly but freezes a term
 * once it is over, so the dates differ: on 2026-08-18 Autumn 2026 was that
 * day, Summer 2026 was 2026-07-29 and Spring 2026 was 2026-04-27. There is no
 * one date for the file, and stamping Autumn's onto Spring's numbers would
 * claim a freshness they do not have.
 */
export function seatsUpdated(term) {
  if (!term) return null;
  return snapshot?.terms?.[String(term)]?.sourceUpdated ?? null;
}

/**
 * Seats for one section, or null when unknown.
 *
 * Seats are read out of the term asked for, never out of whichever term the
 * file happens to lead with, since showing Autumn's numbers against a Spring
 * section would be confidently wrong. A term the snapshot does not cover is
 * unknown, and so is a class number that is simply absent, never zero.
 */
export function seatsFor(classNumber, term) {
  if (!term) return null;
  const row = snapshot?.terms?.[String(term)]?.sections?.[String(classNumber)];
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
