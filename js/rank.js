// The API matches loosely: "CSE 2221" returns 1281 items across 7 pages, and
// page one alone carries CSE 2231, 2321, 5022 and more. It also splits some
// courses across duplicate records. So results get merged and reordered here
// before anyone sees them.

import { instructorsOf } from "./format.js";

const SUBJECT_RE = /^[A-Z]{2,8}$/;
const NUMBER_RE = /^\d{3,4}(\.\d+)?[A-Z]*$/;

export function parseQuery(raw) {
  const tokens = (raw ?? "").trim().toUpperCase().split(/\s+/).filter(Boolean);
  return {
    raw: (raw ?? "").trim(),
    tokens,
    subject: tokens.find((t) => SUBJECT_RE.test(t)) ?? null,
    number: tokens.find((t) => NUMBER_RE.test(t)) ?? null,
  };
}

/** Merge records that describe the same course, keeping every section. */
export function mergeCourses(entries) {
  const merged = new Map();
  for (const entry of entries ?? []) {
    const course = entry?.course;
    if (!course) continue;
    const key = `${course.subject}|${course.catalogNumber}|${course.title}`;
    const existing = merged.get(key);
    if (existing) {
      const seen = new Set(existing.sections.map((s) => String(s.classNumber)));
      for (const section of entry.sections ?? []) {
        if (!seen.has(String(section.classNumber))) existing.sections.push(section);
      }
    } else {
      merged.set(key, { course, sections: [...(entry.sections ?? [])] });
    }
  }
  return [...merged.values()];
}

function scoreCourse({ course, sections }, parsed) {
  const subject = (course.subject ?? "").toUpperCase();
  const number = (course.catalogNumber ?? "").toUpperCase();
  const title = (course.title ?? "").toUpperCase();

  let score = 0;
  const subjectHit = parsed.subject && subject === parsed.subject;
  const numberHit = parsed.number && number === parsed.number;

  if (subjectHit && numberHit) score += 1000;
  else {
    if (subjectHit) score += 120;
    if (numberHit) score += 90;
  }

  // A bare number query should still favour the course someone meant.
  if (!parsed.subject && numberHit) score += 60;

  for (const token of parsed.tokens) {
    if (token === subject || token === number) continue;
    if (title.includes(token)) score += 25;
  }

  if (parsed.tokens.length) {
    const names = sections.flatMap((s) => instructorsOf(s).map((i) => i.name.toUpperCase()));
    for (const token of parsed.tokens) {
      if (token.length < 3) continue;
      if (names.some((n) => n.includes(token))) { score += 200; break; }
    }
  }

  // Break ties toward the course people are more likely to want: more sections
  // means a bigger, more commonly taken offering.
  score += Math.min(sections.length, 30) / 100;
  return score;
}

const NON_TEACHING_COMPONENTS = new Set([
  "Independent Study",
  "Research",
  "Thesis Research",
  "Dissertation",
]);

/**
 * Independent study, research and thesis courses carry dozens of one-student
 * sections with no meeting pattern. CSE 4193 alone has 66. They are real, but
 * nobody searching a subject wants them, so they stay out of generic results
 * and remain reachable by name.
 */
export function isIndividualStudy({ course, sections }) {
  if (!sections?.length) return false;
  const scheduled = sections.some((s) =>
    (s.meetings ?? []).some((m) => m.monday || m.tuesday || m.wednesday || m.thursday || m.friday || m.saturday || m.sunday)
  );
  if (scheduled) return false;
  const components = new Set(sections.map((s) => s.component).filter(Boolean));
  if ([...components].every((c) => NON_TEACHING_COMPONENTS.has(c))) return true;
  return /individual studies|research|thesis|dissertation/i.test(course.title ?? "");
}

/**
 * Split results into what was asked for and what merely matched.
 *
 * Ranking alone left 103 courses on screen for "CSE 2321". Ordering the noise
 * correctly is not the same as removing it.
 */
export function filterCourses(entries, rawQuery) {
  const parsed = parseQuery(rawQuery);
  const ranked = rankCourses(entries, rawQuery);
  if (!ranked.length) return { primary: [], related: [], reason: "none" };

  const wantsStudy = /individual|research|thesis|dissertation/i.test(parsed.raw);
  const setAside = wantsStudy ? [] : ranked.filter(isIndividualStudy);
  const pool = wantsStudy ? ranked : ranked.filter((e) => !isIndividualStudy(e));
  // Nothing is ever discarded outright. Demoted results move to `related` so a
  // student who really did want CSE 4193 can still reach it.
  if (!pool.length) return { primary: ranked.slice(0, 25), related: ranked.slice(25), reason: "ranked" };

  // Nothing typed means nothing to rank, so cutting at 25 would bury most of a
  // requirement browse under "related" and then report 25 as the whole answer.
  if (!parsed.tokens.length) return { primary: pool, related: setAside, reason: "all" };

  // An exact subject plus number is unambiguous. Answer the question asked.
  if (parsed.subject && parsed.number) {
    const exact = pool.filter(
      (e) =>
        (e.course.subject ?? "").toUpperCase() === parsed.subject &&
        (e.course.catalogNumber ?? "").toUpperCase() === parsed.number
    );
    if (exact.length) {
      const rest = [...pool.filter((e) => !exact.includes(e)), ...setAside];
      return { primary: exact, related: rest, reason: "exact" };
    }
  }

  // Otherwise keep what scores near the top and drop the long tail.
  const scored = pool.map((entry) => ({ entry, score: scoreCourse(entry, parsed) }));
  const best = Math.max(...scored.map((s) => s.score));
  const floor = best > 200 ? best * 0.25 : 0;
  const kept = scored.filter((s) => s.score >= floor).map((s) => s.entry);
  const primary = kept.slice(0, 25);
  const related = [...kept.slice(25), ...pool.filter((e) => !kept.includes(e)), ...setAside];
  return { primary, related, reason: "ranked" };
}

export function rankCourses(entries, rawQuery) {
  const parsed = parseQuery(rawQuery);
  const merged = mergeCourses(entries);
  if (!parsed.tokens.length) return merged;
  return merged
    .map((entry) => ({ entry, score: scoreCourse(entry, parsed) }))
    .sort((a, b) => b.score - a.score || String(a.entry.course.catalogNumber ?? "").localeCompare(String(b.entry.course.catalogNumber ?? "")))
    .map((x) => x.entry);
}
