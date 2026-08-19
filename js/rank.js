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

export function rankCourses(entries, rawQuery) {
  const parsed = parseQuery(rawQuery);
  const merged = mergeCourses(entries);
  if (!parsed.tokens.length) return merged;
  return merged
    .map((entry) => ({ entry, score: scoreCourse(entry, parsed) }))
    .sort((a, b) => b.score - a.score || String(a.entry.course.catalogNumber ?? "").localeCompare(String(b.entry.course.catalogNumber ?? "")))
    .map((x) => x.entry);
}
