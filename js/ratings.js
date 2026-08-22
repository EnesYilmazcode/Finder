// RateMyProfessors ratings, joined onto instructor names.
//
// The snapshot is built nightly by scripts/fetch-ratings.mjs because RMP sends
// no CORS headers and a browser can never call it directly.

const SCHOOL_LEGACY_ID = 724;
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

let index = null;
let loading = null;

/**
 * OSU returns full legal names ("Diana Ikenberry Kline") while RMP holds the
 * everyday form ("Diana Kline"), so exact matching misses. Key on first and
 * last name only, ignoring middle names and generational suffixes.
 */
export function nameKey(full) {
  const parts = String(full ?? "")
    .toLowerCase()
    .replace(/[.,'`’-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";

  let end = parts.length - 1;
  while (end > 0 && SUFFIXES.has(parts[end])) end--;
  return end === 0 ? parts[0] : `${parts[0]} ${parts[end]}`;
}

/** Surname alone, for the fallback pass. */
export function surnameKey(full) {
  const key = nameKey(full);
  const parts = key.split(" ");
  return parts[parts.length - 1] ?? "";
}

function firstName(full) {
  return nameKey(full).split(" ")[0] ?? "";
}

/**
 * Do two first names plausibly belong to the same person?
 *
 * OSU uses legal names, RMP uses whatever students typed, so "Timothy" appears
 * as "Tim" and "Steve" as "Stephen". A prefix covers the first case. The second
 * needs a shared initial, which is only safe when the surname is unique, so the
 * caller enforces that.
 */
function compatibleFirstNames(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  return a[0] === b[0];
}

export async function loadRatings(baseUrl = "data/ratings.json") {
  if (index) return index;
  if (loading) return loading;

  loading = (async () => {
    const response = await fetch(baseUrl);
    if (!response.ok) throw new Error(`ratings ${response.status}`);
    const data = await response.json();

    const byKey = new Map();
    const bySurname = new Map();
    for (const person of data.professors ?? []) {
      const full = `${person.firstName} ${person.lastName}`;
      const key = nameKey(full);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(person);

      const last = surnameKey(full);
      if (!bySurname.has(last)) bySurname.set(last, []);
      bySurname.get(last).push(person);
    }
    index = { byKey, bySurname };
    return index;
  })().catch((error) => {
    // A cached rejection would pin the failure for the life of the tab.
    loading = null;
    throw error;
  });

  return loading;
}

/**
 * Look up one instructor.
 *
 * Returns null when the name is absent, and also when two different professors
 * share a first and last name. Showing one of them would be a coin flip, and a
 * wrong rating is worse than no rating.
 */
export function ratingFor(name, idx = index) {
  if (!idx) return null;

  const exact = idx.byKey.get(nameKey(name));
  if (exact?.length === 1) return exact[0];
  if (exact?.length > 1) return null; // genuinely ambiguous, do not guess

  // Fallback: same surname, plausible first name, resolving to exactly one person.
  const candidates = idx.bySurname.get(surnameKey(name)) ?? [];
  if (!candidates.length) return null;
  const first = firstName(name);
  const viable = candidates.filter((p) => {
    const theirs = firstName(`${p.firstName} ${p.lastName}`);
    if (theirs === first || theirs.startsWith(first) || first.startsWith(theirs)) return true;
    // A shared initial is weak evidence, so only trust it when nobody else
    // could be meant.
    return candidates.length === 1 && compatibleFirstNames(first, theirs);
  });
  return viable.length === 1 ? viable[0] : null;
}

export function searchUrl(name) {
  return `https://www.ratemyprofessors.com/search/professors/${SCHOOL_LEGACY_ID}?q=${encodeURIComponent(name)}`;
}

export function profileUrl(legacyId) {
  return `https://www.ratemyprofessors.com/professor/${legacyId}`;
}

/**
 * Best rated instructors, restricted to those with enough ratings to mean
 * anything. 332 people clear 50 ratings; a 5.0 from two students does not
 * belong on a leaderboard.
 */
export function topRated({ minRatings = 50, limit = 8 } = {}) {
  const people = index?.byKey ? [...index.byKey.values()].flat() : [];
  return people
    .filter((p) => p.numRatings >= minRatings && p.avgRating != null)
    .sort((a, b) => b.avgRating - a.avgRating || b.numRatings - a.numRatings)
    .slice(0, limit);
}

/** How many instructors carry at least one rating. */
export function ratedCount() {
  return index?.byKey ? [...index.byKey.values()].reduce((n, list) => n + list.length, 0) : 0;
}
