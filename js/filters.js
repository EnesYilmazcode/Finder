// Client-side filtering over results already fetched. No filter triggers a
// network request, so dragging a time slider does not hammer OSU.

import { instructorsOf, isOnlineMeeting } from "./format.js";
import { ratingFor } from "./ratings.js";
import { seatsFor } from "./seats.js";

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export const DEFAULTS = {
  days: [],          // days that must be met; empty means no constraint
  avoid: [],         // days that must not be met
  from: "",          // earliest start, as minutes past midnight
  to: "",            // latest end
  rating: "",        // minimum average rating
  hideFull: false,
  hideOnline: false,
  ratedOnly: false,
};

/** "8:00 am" to minutes past midnight. Returns null when unparseable. */
export function toMinutes(text) {
  const match = /^(\d{1,2}):(\d{2})\s*([ap])m?$/i.exec(String(text ?? "").trim());
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "p") hour += 12;
  return hour * 60 + Number(match[2]);
}

function sectionDays(section) {
  const days = new Set();
  for (const meeting of section.meetings ?? []) {
    for (const key of DAY_KEYS) if (meeting[key]) days.add(key);
  }
  return days;
}

/**
 * Does one section survive the filters?
 *
 * Unknown data never fails a filter. A section with no meeting pattern cannot
 * be judged on time or day, and dropping it would hide online and arranged
 * sections from anyone who touched a slider.
 */
function keepSection(section, filters) {
  // Online-ness lives on the meeting, not on the mode. See #84.
  if (filters.hideOnline) {
    const meetings = section.meetings ?? [];
    if (meetings.length && meetings.every((m) => isOnlineMeeting(m))) return false;
  }

  if (filters.hideFull) {
    const seats = seatsFor(section.classNumber, filters.term);
    if (seats?.full) return false;
  }

  const people = instructorsOf(section);
  if (filters.ratedOnly && !people.some((p) => ratingFor(p.name))) return false;

  if (filters.rating) {
    // Unrated is unknown, not bad. Seeding this at -1 made every unrated
    // instructor fail every threshold, which silently removed most of the
    // catalogue since only about a third are rated, and made this control
    // imply the rated-only checkbox. Judge only instructors we have a rating
    // for; use ratedOnly to exclude the rest.
    const known = people.map((p) => ratingFor(p.name)).filter(Boolean);
    if (known.length) {
      const best = known.reduce((max, r) => Math.max(max, Number(r.avgRating) || 0), 0);
      if (best < Number(filters.rating)) return false;
    }
  }

  // A section with no meeting pattern has no days to judge, so neither rule
  // applies to it. Online and arranged sections must not vanish either way.
  const meetsOn = sectionDays(section);
  if (meetsOn.size) {
    if (filters.days.length && !filters.days.every((d) => meetsOn.has(d))) return false;
    if (filters.avoid.length && filters.avoid.some((d) => meetsOn.has(d))) return false;
  }

  const meeting = section.meetings?.find((m) => m.startTime) ?? null;
  if (meeting) {
    const start = toMinutes(meeting.startTime);
    const end = toMinutes(meeting.endTime) ?? start;
    if (filters.from && start != null && start < Number(filters.from)) return false;
    if (filters.to && end != null && end > Number(filters.to)) return false;
  }

  return true;
}

export function isActive(filters) {
  return Boolean(
    filters.days.length || filters.avoid.length || filters.from || filters.to || filters.rating ||
    filters.hideFull || filters.hideOnline || filters.ratedOnly
  );
}

/**
 * Apply filters to ranked entries.
 *
 * Returns the surviving entries plus how much was removed, because hiding
 * things without saying so is how a search quietly lies to you.
 */
export function applyFilters(entries, filters) {
  if (!isActive(filters)) {
    return { entries, hiddenSections: 0, hiddenCourses: 0 };
  }

  let hiddenSections = 0;
  let hiddenCourses = 0;
  const kept = [];

  for (const entry of entries) {
    const sections = entry.sections.filter((s) => keepSection(s, filters));
    hiddenSections += entry.sections.length - sections.length;
    if (!sections.length) { hiddenCourses += 1; continue; }
    kept.push({ course: entry.course, sections });
  }

  return { entries: kept, hiddenSections, hiddenCourses };
}
