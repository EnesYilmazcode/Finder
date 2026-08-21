// Turning API shapes into things a student reads at a glance.

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function formatDays(meeting) {
  if (!meeting) return "";
  return dayCodes(DAY_KEYS.filter((key) => meeting[key]));
}

/** The same abbreviation from plain day keys, for filters that have no meeting. */
export function dayCodes(days) {
  return DAY_KEYS.map((key, i) => (days.includes(key) ? DAY_LABELS[i] : null)).filter(Boolean).join("");
}

export function formatTime(meeting) {
  if (!meeting?.startTime) return "";
  const start = meeting.startTime.replace(/\s?([ap])m/i, "$1").toLowerCase();
  const end = meeting.endTime?.replace(/\s?([ap])m/i, "$1").toLowerCase();
  return end ? `${start}–${end}` : start;
}

/** Minutes past midnight on a clock face. The inverse of filters.js toMinutes. */
function fromMinutes(minutes) {
  const hour = Math.floor(minutes / 60) % 24;
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minutes % 60).padStart(2, "0")}${hour < 12 ? "a" : "p"}`;
}

/** A busy block, "TuTh 9:35a–10:55a", written the way the section rows write a meeting. */
export function busyLabel(block) {
  return `${dayCodes(block.days)} ${fromMinutes(block.start)}–${fromMinutes(block.end)}`;
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
