// Automatic schedule generation. This module owns no DOM and performs no
// fetches: app.js supplies complete course entries and the snapshots already
// loaded for the selected term.

import { instructorsOf, isOnlineMeeting } from "./format.js";
import { toMinutes } from "./filters.js";

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export const DEFAULT_GENERATOR_WEIGHTS = {
  seats: 1,
  rating: 1,
  lateStart: 1,
  earlyEnd: 1,
  compactGaps: 1,
};

export const INSTRUCTION_MODES = ["inPerson", "hybrid", "distance", "arranged"];

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function sectionRanges(section) {
  const found = [];
  for (const meeting of section?.meetings ?? []) {
    const start = toMinutes(meeting.startTime);
    if (start == null) continue;
    const end = toMinutes(meeting.endTime) ?? start + 55;
    for (const day of DAY_KEYS) {
      if (meeting[day]) found.push({ day, start, end, classNumber: String(section.classNumber) });
    }
  }
  return found;
}

function overlaps(a, b) {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

function hasConflict(left, right) {
  return left.some((a) => right.some((b) => overlaps(a, b)));
}

function hasInternalConflict(ranges) {
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[i].classNumber !== ranges[j].classNumber && overlaps(ranges[i], ranges[j])) return true;
    }
  }
  return false;
}

function uniqueSections(sections) {
  return [...new Map(sections.map((section) => [String(section.classNumber), section])).values()];
}

export function packageKey(sections) {
  return sections.map((section) => String(section.classNumber)).sort().join(",");
}

export function instructionModeOf(section) {
  const mode = String(section?.instructionMode ?? "").toLowerCase();
  if (mode.includes("hybrid") || mode.includes("enhanced")) return "hybrid";
  if (mode.includes("distance") || mode.includes("online")) return "distance";
  const meetings = section?.meetings ?? [];
  if (meetings.length && meetings.every(isOnlineMeeting)) return "distance";
  if (mode.includes("person") || meetings.length) return "inPerson";
  return "arranged";
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
export function describePackage(pkg, term, { seatsFor, ratingFor }) {
  const sections = uniqueSections(pkg.sections ?? []);
  const ranges = sections.flatMap(sectionRanges);
  const seatCounts = sections.map((section) => {
    const seats = seatsFor(section.classNumber, term);
    return seats ? Math.max(0, seats.limit - seats.enrolled) : null;
  }).filter(Number.isFinite);
  const hasFull = sections.some((section) => seatsFor(section.classNumber, term)?.full === true);

  const people = new Map();
  for (const section of sections) {
    for (const person of instructorsOf(section)) {
      const key = person.email || person.name;
      if (key && !people.has(key)) people.set(key, person);
    }
  }

  const ratings = [];
  for (const person of people.values()) {
    const rating = ratingFor(person.name);
    if (rating && rating.numRatings >= 5 && Number.isFinite(Number(rating.avgRating))) {
      ratings.push(Number(rating.avgRating));
    }
  }

  return {
    ...pkg,
    sections,
    ranges,
    minSeats: seatCounts.length === sections.length ? Math.min(...seatCounts) : null,
    hasFull,
    rating: knownAverage(ratings),
    modes: [...new Set(sections.map(instructionModeOf))],
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

  const factors = {
    seats: minSeats == null ? null : clamp(minSeats * 10),
    rating: rating == null ? null : clamp((rating - 1) * 25),
    lateStart: shape.averageStart == null ? null : clamp((shape.averageStart - 420) / 6.6),
    earlyEnd: shape.averageEnd == null ? null : clamp((1320 - shape.averageEnd) / 7.2),
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
    metrics: { minSeats, rating, ...shape },
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
  excludeFull = true, earliest = null, latest = null, allowedModes = INSTRUCTION_MODES,
  pins = {},
} = {}) {
  const busyRanges = busy.flatMap((block) => (block.days ?? []).map((day) => ({ day, start: block.start, end: block.end })));
  const allowed = new Set(allowedModes);
  const blockedGroups = [];
  const prepared = coursePackages.map((group) => {
    const removed = { full: 0, internal: 0, time: 0, busy: 0, mode: 0, pin: 0 };
    const wantedPin = pins[group.key];
    const packages = (group.packages ?? []).filter((pkg) => {
      if (wantedPin && packageKey(pkg.sections) !== wantedPin) { removed.pin += 1; return false; }
      if (excludeFull && (pkg.hasFull || pkg.minSeats === 0)) { removed.full += 1; return false; }
      if (hasInternalConflict(pkg.ranges)) { removed.internal += 1; return false; }
      if (Number.isFinite(earliest) && pkg.ranges.some((range) => range.start < earliest)) { removed.time += 1; return false; }
      if (Number.isFinite(latest) && pkg.ranges.some((range) => range.end > latest)) { removed.time += 1; return false; }
      if (pkg.modes?.some((mode) => !allowed.has(mode))) { removed.mode += 1; return false; }
      if (hasConflict(pkg.ranges, busyRanges)) { removed.busy += 1; return false; }
      return true;
    });
    if (!packages.length) blockedGroups.push({ key: group.key, label: group.label ?? group.key, total: group.packages?.length ?? 0, removed });
    return { ...group, packages };
  }).sort((a, b) => a.packages.length - b.packages.length);

  if (prepared.some((group) => !group.packages.length)) {
    return { results: [], visited: 0, truncated: false, diagnostics: { blockedGroups, conflicts: [] } };
  }

  const results = [];
  const conflicts = new Map();
  let visited = 0;
  let truncated = false;

  function recordConflict(pkg, chosen) {
    for (const other of chosen) {
      const pairs = pkg.ranges.flatMap((a) => other.ranges.filter((b) => overlaps(a, b)).map((b) => [a, b]));
      if (!pairs.length) continue;
      const labels = [pkg.desiredLabel ?? `${pkg.course.subject} ${pkg.course.catalogNumber}`,
        other.desiredLabel ?? `${other.course.subject} ${other.course.catalogNumber}`].sort();
      const key = labels.join("|");
      const row = conflicts.get(key) ?? { a: labels[0], b: labels[1], count: 0, days: new Set() };
      row.count += 1;
      for (const [range] of pairs) row.days.add(range.day);
      conflicts.set(key, row);
    }
  }

  function keep(packages) {
    const scored = scoreCombination(packages, weights);
    const key = packages.map((pkg) => packageKey(pkg.sections)).sort().join("|");
    results.push({ packages: [...packages], ...scored, key });
    results.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    if (results.length > maxResults * 8) results.length = maxResults * 8;
  }

  function walk(index, chosen, occupied) {
    if (visited >= maxVisited) { truncated = true; return; }
    if (index === prepared.length) { keep(chosen); return; }

    for (const pkg of prepared[index].packages) {
      visited += 1;
      if (visited > maxVisited) { truncated = true; return; }
      if (hasConflict(pkg.ranges, occupied)) { recordConflict(pkg, chosen); continue; }
      walk(index + 1, [...chosen, pkg], [...occupied, ...pkg.ranges]);
      if (truncated) return;
    }
  }

  walk(0, [], []);
  const diverse = [];
  const remaining = [...results];
  const signature = (result) => new Map(result.packages.map((pkg) => [pkg.desiredKey ?? `${pkg.course.subject} ${pkg.course.catalogNumber}`, packageKey(pkg.sections)]));
  const differences = (left, right) => {
    const a = signature(left);
    const b = signature(right);
    return [...a].reduce((count, [key, value]) => count + (b.get(key) === value ? 0 : 1), 0);
  };
  while (remaining.length && diverse.length < maxResults) {
    const index = diverse.length === 0 ? 0 : remaining.findIndex((candidate) =>
      diverse.every((picked) => differences(candidate, picked) >= (candidate.packages.length >= 3 ? 2 : 1))
    );
    if (index < 0) break;
    diverse.push(remaining.splice(index, 1)[0]);
  }
  for (const result of remaining) {
    if (diverse.length >= maxResults) break;
    diverse.push(result);
  }
  const explained = [...conflicts.values()]
    .sort((a, b) => b.count - a.count)
    .map((row) => ({ ...row, days: [...row.days].sort() }));
  return { results: diverse, visited, truncated, diagnostics: { blockedGroups, conflicts: explained } };
}
