// Turning API shapes into things a student reads at a glance.

import { RESULT_CAP } from "./api.js";

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function formatDays(meeting) {
  if (!meeting) return "";
  return DAY_KEYS.map((key, i) => (meeting[key] ? DAY_LABELS[i] : null)).filter(Boolean).join("");
}

export function formatTime(meeting) {
  if (!meeting?.startTime) return "";
  const start = meeting.startTime.replace(/\s?([ap])m/i, "$1").toLowerCase();
  const end = meeting.endTime?.replace(/\s?([ap])m/i, "$1").toLowerCase();
  return end ? `${start}–${end}` : start;
}

export function formatWhen(meeting) {
  const days = formatDays(meeting);
  const time = formatTime(meeting);
  if (!days && !time) return "Time to be announced";
  return [days, time].filter(Boolean).join(" ");
}

// Exported so a caller keying on the room uses the same field order the
// online check does.
export function buildingOf(meeting) {
  return meeting?.buildingDescriptionShort || meeting?.facilityDescriptionShort || meeting?.facilityDescription || "";
}

/**
 * OSU never writes "online" in the mode, which only ever reads "In Person",
 * "Distance Learning", "Hybrid Delivery" or "Distance Enhanced". The literal
 * ONLINE goes where the building name would be. See #84.
 */
export function isOnlineMeeting(meeting) {
  return buildingOf(meeting).trim().toUpperCase() === "ONLINE";
}

export function formatPlace(meeting, section) {
  if (isOnlineMeeting(meeting)) return section?.instructionMode || "Online";
  const building = buildingOf(meeting);
  if (!building) return "Location to be announced";
  return building;
}

export function formatUnits(course) {
  const min = course?.minUnits;
  const max = course?.maxUnits;
  if (min == null && max == null) return "";
  if (min === max || max == null) return `${min} credit${min === 1 ? "" : "s"}`;
  return `${min}–${max} credits`;
}

/**
 * Owns up to a search that only read part of what matched. Gating on the counts
 * rather than on `sorted` also catches a page that failed and got swallowed.
 */
export function formatCoverage({ primary, related, totalItems }) {
  // A caller that never set the count cannot be reported on, and one is coming:
  // js/app.js writes lastResult from more than one place.
  if (!Number.isFinite(totalItems)) return "";
  const read = [...primary, ...related].reduce((n, e) => n + e.sections.length, 0);
  if (read >= totalItems) return "";
  // At the cap totalItems stopped counting, so "more than" is the only honest word for it.
  const size = totalItems >= RESULT_CAP ? `more than ${RESULT_CAP.toLocaleString()}` : `about ${totalItems.toLocaleString()}`;
  return `This search read ${read.toLocaleString()} of ${size} matching sections. Narrow the search to see the rest.`;
}

/**
 * A trend from js/trend.js as a line a student reads: "-6 seats in 3 days".
 *
 * The enrolled series counts enrolments and a student is counting seats, so its
 * sign is flipped on the way out. A waitlist series already reads the way they
 * would say it.
 */
export function trendLabel(trend) {
  const span = `${trend.days} day${trend.days === 1 ? "" : "s"}`;
  if (trend.field === "waitlist") {
    return `${trend.change > 0 ? "+" : ""}${trend.change} waiting in ${span}`;
  }
  const seats = -trend.change;
  return `${seats > 0 ? "+" : ""}${seats} seat${Math.abs(seats) === 1 ? "" : "s"} in ${span}`;
}

/** Instructors for a section, deduped, since they hang off each meeting. */
export function instructorsOf(section) {
  const seen = new Map();
  for (const meeting of section?.meetings ?? []) {
    for (const person of meeting?.instructors ?? []) {
      const name = person?.displayName?.trim();
      if (name && !seen.has(name)) seen.set(name, { name, email: person.email ?? null, role: person.role ?? null });
    }
  }
  return [...seen.values()];
}
