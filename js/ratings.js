// RateMyProfessors ratings, joined onto instructor names.
//
// The snapshot is built nightly by scripts/fetch-ratings.mjs because RMP sends
// no CORS headers and a browser can never call it directly.

const SCHOOL_LEGACY_ID = 724;
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

let index = null;
let loading = null;
let failed = false;

// Course codes are their own file, 151 KB gzipped against the roster's 211 KB, and
// only the detail pane ever reads them. Fetched when a section is opened.
let courses = null;
let coursesLoading = null;

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
    // A retry that lands has to stop reading as failed, as seats.js does.
    failed = false;
    return index;
  })().catch((error) => {
    // Every caller swallows this rejection, so unless it is recorded here
    // nothing downstream can tell a dead snapshot from an empty one.
    failed = true;
    throw error;
  });

  return loading;
}

/** True once the snapshot has been asked for and did not arrive. */
export function ratingsFailed() {
  return failed;
}

/**
 * The per-professor course codes, for courseShare.
 *
 * A failure is not cached, matching js/seats.js. Whether anything asks again is
 * the caller's business.
 */
export async function loadRatingCourses(baseUrl = "data/ratings-courses.json") {
  if (courses) return courses;

  coursesLoading ??= (async () => {
    const response = await fetch(baseUrl);
    if (!response.ok) throw new Error(`ratings courses ${response.status}`);
    return (await response.json()).professors ?? {};
  })().catch((error) => {
    coursesLoading = null;
    throw error;
  });

  courses = await coursesLoading;
  return courses;
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

/**
 * The five per-score counts and their total, or null when there is nothing to draw.
 *
 * The total is summed here rather than read off numRatings, which upstream reports
 * as a different number for 616 of the 7367 rated professors, so the segments have
 * to divide by the counts or they will not fill the bar.
 */
export function ratingSpread(person) {
  const counts = person?.distribution;
  if (!Array.isArray(counts) || counts.length !== 5) return null;
  if (!counts.every((n) => typeof n === "number" && n >= 0)) return null;

  const total = counts.reduce((sum, n) => sum + n, 0);
  return total > 0 ? { counts, total } : null;
}

/**
 * Fold a rater's course text onto a subject and a number.
 *
 * Students type this field by hand, so one course arrives as "CSE 2221", "cse2221",
 * "CS2221" and a bare "2221". Text carrying no number ("PHYSICS", "art", "N/A") names
 * no course and gets null, which is 4.2% of the 33041 codes in the snapshot.
 */
export function courseCode(text) {
  const clean = String(text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const parts = /^([A-Z]*)(\d+[A-Z]*)$/.exec(clean);
  return parts ? { subject: parts[1], number: parts[2] } : null;
}

/**
 * How many of an instructor's ratings name the course on screen, and the code to
 * print them against. Null when the file has not loaded or lists nobody by that id.
 *
 * The number decides the match and the subject only narrows it, because a bare "2221"
 * on this professor's own page is this professor's 2221. A number that does not match
 * is left alone, so the pre-semester CSE 321 never becomes a CSE 2221 rating.
 */
export function courseShare(person, course, table = courses) {
  const codes = table?.[person?.legacyId];
  if (!codes) return null;

  const subject = String(course?.subject ?? "").toUpperCase();
  const catalogNumber = String(course?.catalogNumber ?? "").toUpperCase();
  const number = catalogNumber.replace(/[^A-Z0-9]/g, "");

  // Nobody types the dot in "2001.01", so 23% of the catalog needs its stem to count
  // too. Safe because only 9 of those 1136 numbers also exist plain, unlike the 259
  // letter-suffixed ones, where 187 have a plain sibling whose ratings it would steal.
  const stem = /^\d+\./.test(catalogNumber) ? catalogNumber.split(".")[0] : "";
  const names = (code) => code.number === number || (stem !== "" && code.number === stem);

  // Raters abbreviate ("CS2221") and spell out ("CHEMISTRY1250"), so either side
  // can be the longer string.
  const mine = (code) => subject.startsWith(code.subject) || code.subject.startsWith(subject);

  const rows = Object.entries(codes).map(([text, count]) => [courseCode(text), count]);
  const codeTotal = rows.reduce((sum, [, count]) => sum + count, 0);
  if (codeTotal === 0) return null;

  // A bare number is only ambiguous when this professor also carries it under a
  // subject that is not this one, which is the case where their 2221 could be
  // someone else's 2221 and counting it would be the confident wrong answer.
  const contested = rows.some(([code]) => code?.subject && names(code) && !mine(code));

  let matched = 0;
  let exact = true;
  for (const [code, count] of rows) {
    if (!code || !names(code)) continue;
    if (code.subject ? !mine(code) : contested) continue;
    matched += count;
    if (code.number !== number) exact = false;
  }

  // The figure above prints numRatings, so dividing by anything else puts two totals
  // for one professor in the same block.
  const total = person?.numRatings > 0 ? person.numRatings : codeTotal;
  return {
    matched: Math.min(matched, total),
    total,
    code: `${subject} ${exact ? catalogNumber : stem}`,
  };
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
