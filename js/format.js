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

// Session "1" is the whole Autumn or Spring term and "1S" the whole Summer one.
// Every other code is a part of term that fits inside one of those.
const FULL_TERM_SESSIONS = new Set(["1", "1S"]);

// The API sends a career code and never a description for it. A code that is
// not listed here is still flagged, it just does not get a name.
const CAREERS = {
  GRAD: "Graduate",
  LAW: "Law",
  MED: "Medicine",
  DENT: "Dentistry",
  VMED: "Veterinary medicine",
  OPT: "Optometry",
  PHP: "Pharmacy",
};

/**
 * What a section is that its heading does not say.
 *
 * Ranked by how much each one changes a decision, so a row can show the first
 * two and still be showing the one that matters most.
 */
export function sectionFlags(section) {
  const flags = [];

  // consent is false when none is needed and a code like "I" or "D" when it is,
  // so this has to be a truth test rather than a comparison.
  if (section?.consent) {
    flags.push({
      key: "consent",
      label: "Permission required",
      detail: "You cannot register for this one yourself. It needs permission first.",
    });
  }

  // Eight careers exist, not two, so this tests for anything that is not the
  // undergraduate one rather than for graduate alone.
  if (section?.career && section.career !== "UGRD") {
    const named = CAREERS[section.career];
    flags.push({
      key: "career",
      label: named ?? "Not undergraduate",
      detail: named
        ? `Listed under the ${named.toLowerCase()} career, not the undergraduate one.`
        : "Listed under a career other than the undergraduate one.",
    });
  }

  // PI is the primary instructor. Every other role is somebody standing in for
  // one, and a third of sections list nobody else.
  const people = instructorsOf(section);
  if (people.length && !people.some((p) => p.role === "PI")) {
    const ta = people.some((p) => p.role === "TA");
    flags.push({
      key: "assistant",
      label: ta ? "TA-taught" : "No primary instructor",
      detail: ta
        ? "A teaching assistant is listed here, not the section's primary instructor."
        : "Nobody listed here is the section's primary instructor.",
    });
  }

  // 999 is the API's stand-in for unbounded, so only a hard zero says anything.
  if (section?.waitlistCapacity === 0) {
    flags.push({
      key: "waitlist",
      label: "No waitlist",
      detail: "No waitlist. Once it fills there is nothing to join.",
    });
  }

  const session = section?.sessionCode ? String(section.sessionCode).toUpperCase() : "";
  if (session && !FULL_TERM_SESSIONS.has(session)) {
    flags.push({
      key: "session",
      label: "Not full term",
      detail: section.sessionDescription
        ? `${section.sessionDescription}, not the full term.`
        : "Does not run the full term.",
    });
  }

  return flags;
}
