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
