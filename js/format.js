// Turning API shapes into things a student reads at a glance.

import { RESULT_CAP } from "./api.js";

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const GE_ORDER = ["GE2", "GE"];
const ROW_ORDER = ["ALX", "HON"];

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

/**
 * A section's meetings with the API's repeats dropped.
 *
 * Upstream lists the same pattern once per room label it holds for the class.
 * CSE 2112 class 8823 comes back with ten meetings that describe three, and
 * CHEM 8893 class 24426 with eight that describe one.
 *
 * The room half of the key is buildingOf(), so two meetings that would print
 * the same line are one meeting. See #84.
 */
export function distinctMeetings(section) {
  const seen = new Set();
  return (section?.meetings ?? []).filter((meeting) => {
    const key = `${formatWhen(meeting)}|${buildingOf(meeting)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A section's attributes on top of its course's, deduped on name and value.
 *
 * Both arrays arrive on every response and they are not copies of each other:
 * a section can add codes the course object never lists, like an Ohio Transfer
 * 36 mapping or its own textbook fee. Deduping on the name alone would drop
 * one of the two themes a course like ENGLISH 3264 counts for.
 *
 * The current GE comes out ahead of the one it replaced so that the header and
 * the detail pane never disagree about which curriculum to read first.
 */
export function attributesOf(course, section) {
  const seen = new Map();
  for (const raw of [...(course?.courseAttributes ?? []), ...(section?.attributes ?? [])]) {
    // A course with nothing to declare sends one all-blank entry rather than an
    // empty array, so a name is what makes an attribute real.
    const name = String(raw?.name ?? "").trim();
    if (!name) continue;
    const value = String(raw.value ?? "").trim();
    const key = `${name}|${value}`;
    if (!seen.has(key)) seen.set(key, { name, value, description: String(raw.description ?? "").trim() });
  }
  const rank = (a) => {
    const i = GE_ORDER.indexOf(a.name);
    return i === -1 ? GE_ORDER.length : i;
  };
  return [...seen.values()].sort((a, b) => rank(a) - rank(b));
}

/**
 * The GE badges a course header is entitled to show.
 *
 * Most courses declare their GEs on the course object, but some send the blank
 * placeholder and carry the credit on every section instead. ART 3009 does, and
 * without the fallback its header says nothing at all. Reading what all of the
 * sections agree on covers those without letting the header claim a GE that
 * only one section carries.
 */
export function courseBadges(course, sections) {
  const isGe = (a) => GE_ORDER.includes(a.name);
  const own = attributesOf(course).filter(isGe);
  return own.length ? own : sharedAttributes(sections).filter(isGe);
}

/** What every one of these sections carries. */
function sharedAttributes(sections) {
  const lists = (sections ?? []).map((section) => attributesOf(null, section));
  if (!lists.length) return [];
  const [first, ...rest] = lists;
  return first.filter((a) => rest.every((list) => list.some((b) => b.name === a.name && b.value === a.value)));
}

/**
 * The badges that belong on a section row.
 *
 * The fee is the one that really differs between siblings, on 63 of the 79
 * multi-section courses that carry one. Honors never varies within a course but
 * it changes what a student is signing up for, so it rides along. The rest is
 * curriculum credit and belongs to the course, not to every row.
 */
export function sectionBadges(section) {
  return attributesOf(null, section).filter((a) => ROW_ORDER.includes(a.name));
}

/**
 * Short badge text for an attribute.
 *
 * `GE2` is the current curriculum and `GE` the one it replaced. Which of them
 * a student can count is decided by their catalog year, which Finder has no
 * way to know, so both are shown and the old one is marked as old.
 */
export function attributeLabel(attribute) {
  const name = attribute?.name ?? "";
  const value = attribute?.value ?? "";
  if (name === "GE2") return `GE ${value}`.trim();
  if (name === "GE") return `Legacy GE ${value}`.trim();
  if (name === "ALX" && value) return `$${value}`;
  // Embedded honors is a strand inside an ordinary section, not an honors
  // section, so the two cannot share a badge.
  if (name === "HON") return value === "EHON" ? "Embedded honors" : "Honors";
  return [name, value].filter(Boolean).join(" ");
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
