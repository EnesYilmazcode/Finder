// Automatic schedule generation. This module owns no DOM and performs no
// fetches: app.js supplies complete course entries and the snapshots already
// loaded for the selected term.

import { instructorsOf } from "./format.js";
import { toMinutes } from "./filters.js";

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export const DEFAULT_GENERATOR_WEIGHTS = {
  seats: 1,
  rating: 1,
  grades: 1,
  lateStart: 1,
  earlyEnd: 1,
  compactDays: 1,
  compactGaps: 1,
};

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function sectionRanges(section) {
  const found = [];
  for (const meeting of section?.meetings ?? []) {
    const start = toMinutes(meeting.startTime);
    if (start == null) continue;
    const end = toMinutes(meeting.endTime) ?? start + 55;
    for (const day of DAY_KEYS) if (meeting[day]) found.push({ day, start, end });
  }
  return found;
}

function overlaps(a, b) {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

function hasConflict(left, right) {
  return left.some((a) => right.some((b) => overlaps(a, b)));
}

function uniqueSections(sections) {
  return [...new Map(sections.map((section) => [String(section.classNumber), section])).values()];
}

function packageKey(sections) {
  return sections.map((section) => String(section.classNumber)).sort().join(",");
}

/**
 * Expand one course into complete registration packages.
 *
 * Barrett's relationship is directional: a child enrolls in every parent in
 * `enrolls`, while each parent requires one child from `enrolledBy`. Starting
 * from every section and repeatedly satisfying both rules handles a child that
 * belongs to two parents without guessing from component labels or times.
 */
export function expandCoursePackages(entry, term, linkedFor) {
  const sections = entry?.sections ?? [];
  const byNumber = new Map(sections.map((section) => [String(section.classNumber), section]));
  const links = new Map();
  const missing = new Set();

  for (const number of byNumber.keys()) {
    const linked = linkedFor(number, term);
    const row = {
      enrolls: (linked?.enrolls ?? []).map(String),
      enrolledBy: (linked?.enrolledBy ?? []).map(String),
    };
    links.set(number, row);
    for (const partner of [...row.enrolls, ...row.enrolledBy]) if (!byNumber.has(partner)) missing.add(partner);
  }

  const complete = new Map();
  const seenStates = new Set();

  function walk(selected) {
    const key = [...selected].sort().join(",");
    if (seenStates.has(key)) return;
    seenStates.add(key);

    // Selecting a child may require one or several parent sections.
    for (const number of [...selected]) {
      for (const parent of links.get(number)?.enrolls ?? []) {
        if (!byNumber.has(parent)) return;
        if (!selected.has(parent)) return walk(new Set([...selected, parent]));
      }
    }

    // Every selected parent needs one of its listed children. Branch rather
    // than choosing the first, since those alternatives are the schedules.
    for (const number of [...selected]) {
      const choices = links.get(number)?.enrolledBy ?? [];
      if (!choices.length || choices.some((child) => selected.has(child))) continue;
      for (const child of choices) if (byNumber.has(child)) walk(new Set([...selected, child]));
      return;
    }

    const members = uniqueSections([...selected].map((number) => byNumber.get(number)).filter(Boolean));
    complete.set(packageKey(members), { course: entry.course, sections: members });
  }

  for (const number of byNumber.keys()) walk(new Set([number]));
  return { packages: [...complete.values()], missing: [...missing].sort() };
}

function knownAverage(values) {
  const known = values.filter((value) => Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

/** Add ranges and ranking evidence to a registration package. */
export function describePackage(pkg, term, { seatsFor, ratingFor, gradesFor }) {
  const sections = uniqueSections(pkg.sections ?? []);
  const ranges = sections.flatMap(sectionRanges);
  const seatCounts = sections.map((section) => {
    const seats = seatsFor(section.classNumber, term);
    return seats ? Math.max(0, seats.limit - seats.enrolled) : null;
  }).filter(Number.isFinite);

  const people = new Map();
  for (const section of sections) {
    for (const person of instructorsOf(section)) {
      const key = person.email || person.name;
      if (key && !people.has(key)) people.set(key, person);
    }
  }

  const ratings = [];
  const grades = [];
  for (const person of people.values()) {
    const rating = ratingFor(person.name);
    if (rating && rating.numRatings >= 5 && Number.isFinite(Number(rating.avgRating))) {
      ratings.push(Number(rating.avgRating));
    }
    const curve = gradesFor(person, pkg.course);
    if (curve && Number.isFinite(Number(curve.gpa)) && curve.n >= 10) grades.push(Number(curve.gpa));
  }

  return {
    ...pkg,
    sections,
    ranges,
    minSeats: seatCounts.length === sections.length ? Math.min(...seatCounts) : null,
    rating: knownAverage(ratings),
    gpa: knownAverage(grades),
  };
}

function scheduleShape(packages) {
  const ranges = packages.flatMap((pkg) => pkg.ranges);
  const byDay = new Map();
  for (const range of ranges) {
    if (!byDay.has(range.day)) byDay.set(range.day, []);
    byDay.get(range.day).push(range);
  }

  let gaps = 0;
  let starts = 0;
  let ends = 0;
  for (const day of byDay.values()) {
    day.sort((a, b) => a.start - b.start || a.end - b.end);
    starts += day[0].start;
    ends += Math.max(...day.map((range) => range.end));
    let until = day[0].end;
    for (const range of day.slice(1)) {
      if (range.start > until) gaps += range.start - until;
      until = Math.max(until, range.end);
    }
  }

  const days = byDay.size;
  return {
    ranges,
    days,
    gaps,
    averageStart: days ? starts / days : null,
    averageEnd: days ? ends / days : null,
  };
}

export function scoreCombination(packages, weights = DEFAULT_GENERATOR_WEIGHTS) {
  const shape = scheduleShape(packages);
  const minSeats = packages.every((pkg) => Number.isFinite(pkg.minSeats))
    ? Math.min(...packages.map((pkg) => pkg.minSeats)) : null;
  const rating = knownAverage(packages.map((pkg) => pkg.rating));
  const gpa = knownAverage(packages.map((pkg) => pkg.gpa));

  const factors = {
    seats: minSeats == null ? null : clamp(minSeats * 10),
    rating: rating == null ? null : clamp((rating - 1) * 25),
    grades: gpa == null ? null : clamp(gpa * 25),
    lateStart: shape.averageStart == null ? null : clamp((shape.averageStart - 420) / 6.6),
    earlyEnd: shape.averageEnd == null ? null : clamp((1320 - shape.averageEnd) / 7.2),
    compactDays: shape.days ? clamp((6 - shape.days) * 20) : null,
    compactGaps: clamp(100 - shape.gaps / 4.8),
  };

  let points = 0;
  let totalWeight = 0;
  for (const [key, value] of Object.entries(factors)) {
    const weight = Math.max(0, Number(weights[key]) || 0);
    if (value == null || weight === 0) continue;
    points += value * weight;
    totalWeight += weight;
  }

  return {
    score: totalWeight ? points / totalWeight : 0,
    metrics: { minSeats, rating, gpa, ...shape },
    factors,
  };
}

/**
 * Pick one package per course, rejecting time conflicts and busy periods.
 * The limit is a safety valve for pathological catalogues and is reported to
 * the caller rather than silently presenting a partial search as exhaustive.
 */
export function generateSchedules(coursePackages, {
  busy = [], weights = DEFAULT_GENERATOR_WEIGHTS, maxResults = 25, maxVisited = 100000,
  excludeFull = true,
} = {}) {
  const busyRanges = busy.flatMap((block) => (block.days ?? []).map((day) => ({ day, start: block.start, end: block.end })));
  const prepared = coursePackages.map((group) => ({
    ...group,
    packages: (group.packages ?? []).filter((pkg) => {
      if (excludeFull && pkg.minSeats === 0) return false;
      return !hasConflict(pkg.ranges, busyRanges);
    }),
  })).sort((a, b) => a.packages.length - b.packages.length);

  if (prepared.some((group) => !group.packages.length)) {
    return { results: [], visited: 0, truncated: false };
  }

  const results = [];
  let visited = 0;
  let truncated = false;

  function keep(packages) {
    const scored = scoreCombination(packages, weights);
    const key = packages.map((pkg) => packageKey(pkg.sections)).sort().join("|");
    results.push({ packages: [...packages], ...scored, key });
    results.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    if (results.length > maxResults) results.length = maxResults;
  }

  function walk(index, chosen, occupied) {
    if (visited >= maxVisited) { truncated = true; return; }
    if (index === prepared.length) { keep(chosen); return; }

    for (const pkg of prepared[index].packages) {
      visited += 1;
      if (visited > maxVisited) { truncated = true; return; }
      if (hasConflict(pkg.ranges, occupied)) continue;
      walk(index + 1, [...chosen, pkg], [...occupied, ...pkg.ranges]);
      if (truncated) return;
    }
  }

  walk(0, [], []);
  return { results, visited, truncated };
}
