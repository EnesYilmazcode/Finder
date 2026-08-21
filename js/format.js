// Turning API shapes into things a student reads at a glance.

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

export function formatPlace(meeting, section) {
  if (section?.instructionMode && /online/i.test(section.instructionMode)) return section.instructionMode;
  const building = meeting?.buildingDescriptionShort || meeting?.facilityDescriptionShort || meeting?.facilityDescription;
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
