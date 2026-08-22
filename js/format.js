// Turning API shapes into things a student reads at a glance.

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const GE_ORDER = ["GE2", "GE"];
const ROW_ORDER = ["ALX", "HON"];

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
