// Per-instructor grade distributions, from a five-year public records request.
//
// OSU publishes nothing like this. The file behind it arrived under R.C. 149.43
// as a spreadsheet of one row per section, which scripts/fetch-grades.mjs folds
// into one curve per instructor per course. See docs/osu-grades.md for what the
// request covered and what it cannot answer.
//
// Loaded the way data/ratings-courses.json is: only the detail pane reads it, so
// it is fetched when the first section is opened rather than when the page loads.

import { nameKey } from "./ratings.js";

// OSU's eleven graded marks and their points. There is no A+ and no D-; the
// registrar does not award either, so a column for them would never fill.
export const SCALE = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "E"];
const POINTS = [4, 3.7, 3.3, 3, 2.7, 2.3, 2, 1.7, 1.3, 1, 0];

let index = null;
let loading = null;
let failed = false;
// A 404 is the ordinary state of this file until the records request is
// fulfilled, and it is settled rather than broken: nothing is coming, so
// nothing should ask again. Distinct from `failed` for the same reason seats.js
// separates "missing" from "unknown".
let absent = false;

/**
 * The join key, which is the local part of an OSU address: bucci.2@osu.edu is
 * bucci.2. The class API already publishes this beside every instructor, and
 * the records request asked for the same field, so the two sides meet on a
 * string the registrar and the course search both issued.
 *
 * This is the one join in Finder that does not have to guess. Name matching is
 * the fallback for rows that came back without an address, and it inherits
 * ratings.js's refusal to choose between two people with one name.
 */
export function gradeKey(email) {
  const at = String(email ?? "").indexOf("@");
  return at > 0 ? String(email).slice(0, at).toLowerCase() : "";
}

/**
 * Load the snapshot.
 *
 * Resolves to the index, or to null when the file is not published yet. A real
 * failure rejects and is not cached, so a caller may retry; an absent file is
 * an answer and is remembered.
 */
export async function loadGrades(baseUrl = "data/grades.json") {
  if (index || absent) return index;
  if (loading) return loading;

  loading = (async () => {
    const response = await fetch(baseUrl);
    // Only 404 means unpublished. A 500 is a server having a bad day and must
    // stay retryable, or one bad minute would turn the feature off for the tab.
    if (response.status === 404) {
      absent = true;
      return null;
    }
    if (!response.ok) throw new Error(`grades ${response.status}`);
    const data = await response.json();

    const byKey = new Map();
    const byName = new Map();
    for (const [key, row] of Object.entries(data.instructors ?? {})) {
      byKey.set(key.toLowerCase(), row);
      const name = nameKey(row?.name ?? "");
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(row);
    }

    index = { meta: data, byKey, byName };
    failed = false;
    return index;
  })().catch((error) => {
    // A cached rejection would pin the failure for the life of the tab, exactly
    // as in ratings.js, and every caller here swallows the error too.
    loading = null;
    failed = true;
    throw error;
  });

  return loading;
}

/** True once the snapshot was asked for and did not arrive. */
export function gradesFailed() {
  return failed;
}

/** True once the snapshot came back 404, which is not a failure. */
export function gradesAbsent() {
  return absent;
}

/** What the request covered, for labelling the curve as historical. */
export function gradesRange(idx = index) {
  const meta = idx?.meta;
  return meta?.firstTerm && meta?.lastTerm
    ? { first: meta.firstTerm, last: meta.lastTerm, terms: meta.termCount ?? null }
    : null;
}

/**
 * Is this a row of counts at all?
 *
 * One rule, because the status and the mean have to agree about what a broken
 * row is. They did not: a negative count has the right eleven columns, so
 * checking only the length called a bad parse a pass-fail course.
 */
function gradedRow(counts) {
  return Array.isArray(counts)
    && counts.length === SCALE.length
    && counts.every((n) => typeof n === "number" && n >= 0 && Number.isFinite(n));
}

/**
 * Mean grade points over the marks that carry any, or null when none do.
 *
 * S, U, PA, NP, W and I are all outside this on purpose. None of them has a
 * point value, so folding them in at zero would turn a course full of
 * satisfactory marks into a course full of failures.
 */
export function gpaOf(counts) {
  if (!gradedRow(counts)) return null;

  let students = 0;
  let points = 0;
  for (let i = 0; i < counts.length; i++) {
    students += counts[i];
    points += counts[i] * POINTS[i];
  }
  return students > 0 ? { n: students, gpa: points / students } : null;
}

/**
 * The share of graded students who got an A or an A-.
 *
 * Kept separate from the mean because the two disagree in the case students
 * most want to spot: a section that is half A and half E averages the same as
 * a section that is entirely B, and only one of them is a coin flip.
 */
export function aShare(curve) {
  if (!curve?.n) return null;
  return (curve.counts[0] + curve.counts[1]) / curve.n;
}

/** Counts and their total for a bar, or null when there is nothing to draw. Mirrors ratingSpread. */
export function gradeSpread(curve) {
  if (!curve?.n) return null;
  return { counts: curve.counts, total: curve.n };
}

function curveFrom(row, meta) {
  const counts = row?.counts;
  const summed = gpaOf(counts);
  if (!summed) return null;

  const other = row.other ?? {};
  return {
    counts,
    n: summed.n,
    gpa: summed.gpa,
    withdrew: other.W ?? 0,
    // S/U and PA/NP are a pass-fail enrolment, not a grade anyone can compare.
    ungraded: (other.S ?? 0) + (other.U ?? 0) + (other.PA ?? 0) + (other.NP ?? 0),
    incomplete: other.I ?? 0,
    sections: row.sections ?? 0,
    terms: row.terms ?? 0,
    // Sections the registrar withheld under the small-enrolment rule. Held on
    // the curve rather than dropped, because a curve missing its smallest
    // sections is a different claim from a complete one, and only this number
    // says which of the two is on screen.
    suppressed: row.suppressed ?? 0,
    ...(meta ? { instructor: meta } : {}),
  };
}

/**
 * One instructor's curve in one course, or null.
 *
 * Null covers every way this can be unknown: the file is not loaded, not
 * published, lists nobody by that key, or lists them without this course. None
 * of those is evidence that a professor grades any particular way, so none of
 * them may render as a number.
 */
export function gradesFor(person, course, idx = index) {
  const row = instructorRow(person, idx);
  if (!row) return null;

  // Exact course match only. The registrar issued both the subject and the
  // catalog number, so unlike the free text students type into RMP there is
  // nothing here to normalise, and 1110.01 really is not 1110.02.
  const subject = String(course?.subject ?? "").toUpperCase();
  const number = String(course?.catalogNumber ?? "").toUpperCase();
  if (!subject || !number) return null;

  return curveFrom(row.courses?.[`${subject} ${number}`], null);
}

/**
 * What is known about one instructor's curve in one course, without waiting.
 *
 * "ready"       a curve exists and gradesFor will answer
 * "withheld"    the registrar published nothing, every section being too small
 * "ungraded"    students finished, but on marks that carry no grade points
 * "unknown"     no row for this instructor, or the file is not loaded yet
 * "unpublished" the records request is not fulfilled, so there is no file
 *
 * The middle two exist because the pane has three different true sentences to
 * say and gradesFor returns null for all three. "Every section was too small to
 * publish" is not "this professor has no record", and neither is "this course is
 * pass-fail". Printing the same blank for all of them would invent an absence.
 */
export function gradesStatus(person, course, idx = index) {
  if (absent) return "unpublished";
  if (!idx) return "unknown";

  const row = instructorRow(person, idx);
  if (!row) return "unknown";

  const subject = String(course?.subject ?? "").toUpperCase();
  const number = String(course?.catalogNumber ?? "").toUpperCase();
  const entry = subject && number ? row.courses?.[`${subject} ${number}`] : null;
  if (!entry) return "unknown";

  if (curveFrom(entry, null)) return "ready";
  // A row that parses but grades nobody is one of the two honest absences. The
  // suppression count is what tells them apart.
  if (!gradedRow(entry.counts)) return "unknown";
  return (entry.suppressed ?? 0) > 0 ? "withheld" : "ungraded";
}

/** How many of a course's sections the registrar withheld, whether or not a curve survived. */
export function withheldFor(person, course, idx = index) {
  const row = instructorRow(person, idx);
  const subject = String(course?.subject ?? "").toUpperCase();
  const number = String(course?.catalogNumber ?? "").toUpperCase();
  const entry = subject && number ? row?.courses?.[`${subject} ${number}`] : null;
  return entry?.suppressed ?? 0;
}

/**
 * Everything one instructor taught, newest-heaviest first, for the case where
 * they have a record but not in this course.
 */
export function gradesOverall(person, idx = index) {
  const row = instructorRow(person, idx);
  const courses = Object.entries(row?.courses ?? {});
  if (!courses.length) return null;

  const total = new Array(SCALE.length).fill(0);
  let sections = 0;
  let suppressed = 0;
  for (const [, entry] of courses) {
    if (!Array.isArray(entry?.counts) || entry.counts.length !== SCALE.length) continue;
    for (let i = 0; i < total.length; i++) total[i] += entry.counts[i];
    sections += entry.sections ?? 0;
    suppressed += entry.suppressed ?? 0;
  }
  return curveFrom({ counts: total, sections, suppressed, terms: row.terms ?? 0 }, null);
}

/**
 * Find one instructor's row.
 *
 * The address is exact and settles it. Falling back to a name repeats
 * ratingFor's rule rather than a looser one: two people under a single name
 * return nothing, because a wrong curve is worse than no curve, and a curve
 * carries more authority than a rating does precisely because it came from the
 * registrar.
 */
function instructorRow(person, idx = index) {
  if (!idx) return null;

  const key = gradeKey(person?.email);
  const exact = key ? idx.byKey.get(key) : null;
  if (exact) return exact;

  const named = idx.byName.get(nameKey(person?.name ?? "")) ?? [];
  return named.length === 1 ? named[0] : null;
}
