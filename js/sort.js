// Ordering results that are already on screen. No DOM, no fetch, so the same
// aggregate orders courses, instructor blocks and the sections inside them.

import { instructorsOf } from "./format.js";
import { toMinutes } from "./filters.js";
import { ratingFor } from "./ratings.js";
import { seatsFor } from "./seats.js";

const AGGREGATES = {
  rating: { of: bestRating, order: "desc" },
  difficulty: { of: lowestDifficulty, order: "asc" },
  seats: { of: mostSeatsLeft, order: "desc" },
  start: { of: earliestStart, order: "asc" },
};

// Own keys only. A plain lookup would answer "toString" with a function and
// crash on whatever a shared link happens to carry.
function specFor(key) {
  return Object.hasOwn(AGGREGATES, String(key ?? "")) ? AGGREGATES[key] : null;
}

/** Is this a sort the app offers? Guards whatever a shared link carries. */
export function isSortKey(key) {
  return Boolean(specFor(key));
}

/** Every rating we hold for the people teaching these sections, deduped by name. */
function ratingsOf(sections) {
  const seen = new Map();
  for (const section of sections) {
    for (const person of instructorsOf(section)) {
      if (!seen.has(person.name)) seen.set(person.name, ratingFor(person.name));
    }
  }
  return [...seen.values()].filter(Boolean);
}

// Thin evidence must not top the list: 1105 of the 1329 professors sitting at
// exactly 5.0 in the snapshot have fewer than five ratings, so a raw score sort
// opens with one-review names. Five is the bar render.js already calls thin.
const MIN_RATINGS = 5;

// RateMyProfessors reports a missing score as -1, which the snapshot stores as
// null, and Number(null) is 0. Neither is a score, so neither may be ranked.
function scores(ratings, field) {
  return ratings
    .filter((r) => r.numRatings >= MIN_RATINGS)
    .map((r) => Number(r[field]))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function bestRating(sections) {
  const found = scores(ratingsOf(sections), "avgRating");
  return found.length ? Math.max(...found) : null;
}

function lowestDifficulty(sections) {
  const found = scores(ratingsOf(sections), "avgDifficulty");
  return found.length ? Math.min(...found) : null;
}

function mostSeatsLeft(sections, term) {
  let best = null;
  for (const section of sections) {
    const seats = seatsFor(section.classNumber, term);
    if (!seats) continue;
    // An over-enrolled section has no seats left, not negative seats.
    const left = Math.max(0, seats.limit - seats.enrolled);
    if (best == null || left > best) best = left;
  }
  return best;
}

function earliestStart(sections) {
  let best = null;
  for (const section of sections) {
    for (const meeting of section.meetings ?? []) {
      const start = toMinutes(meeting.startTime);
      if (start != null && (best == null || start < best)) best = start;
    }
  }
  return best;
}

/**
 * What one set of sections is worth under a sort key, or null when nothing in
 * them is known.
 *
 * Null is not zero. A section with no seat snapshot row, or no instructor with
 * enough ratings to rank, cannot be placed, and scoring it zero would rank "we
 * do not know" alongside "nobody can register".
 */
export function sortValue(sections, key, term) {
  const spec = specFor(key);
  return spec ? spec.of(sections ?? [], term) : null;
}

/**
 * Order anything that carries sections: courses, instructor blocks, sections.
 *
 * `tiebreak` is the ordering that already applied, so an inactive sort and a
 * tie both leave the list where it was. Items with no value keep that order
 * too, at the end.
 */
export function orderBy(items, sectionsOf, key, term, tiebreak = () => 0) {
  const list = [...(items ?? [])];
  const spec = specFor(key);
  if (!spec) return list.sort(tiebreak);

  const values = new Map(list.map((item) => [item, spec.of(sectionsOf(item) ?? [], term)]));
  return list.sort((a, b) => {
    const av = values.get(a);
    const bv = values.get(b);
    if (av == null && bv == null) return tiebreak(a, b);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av !== bv) return spec.order === "desc" ? bv - av : av - bv;
    return tiebreak(a, b);
  });
}

/** Course-level ordering, over the entries that survived the filters. */
export function sortEntries(entries, key, term) {
  return orderBy(entries, (entry) => entry.sections, key, term);
}

/**
 * How many sections the sort cannot place, so the page can say so rather than
 * leave an unexplained tail at the bottom.
 */
export function unknownSections(entries, key, term) {
  if (!specFor(key)) return 0;
  let count = 0;
  for (const entry of entries ?? []) {
    for (const section of entry.sections ?? []) {
      if (sortValue([section], key, term) == null) count += 1;
    }
  }
  return count;
}
