// Everything here builds DOM nodes rather than HTML strings. Course titles and
// instructor names come from an external API, so they never get interpolated
// into markup.
//
// Seat counts are deliberately absent. The search endpoint reports one
// enrollment figure per course and repeats it onto every section, so rendering
// it per section would tell students a full section is open. See #13.

import { formatWhen, formatPlace, formatUnits, instructorsOf, distinctMeetings, attributeLabel, courseBadges, sectionBadges, sectionFlags } from "./format.js";
import { ratingFor, searchUrl, profileUrl } from "./ratings.js";
import { linkedTo, seatsFor, unreachable } from "./seats.js";
import { openedOn } from "./trend.js";
import { orderBy } from "./sort.js";

export const ROW_CHIPS = 2;
export const COURSE_COLLAPSE_AT = 50;

const COMPONENT_ORDER = ["Lecture", "Seminar", "Studio", "Laboratory", "Recitation"];
const SUPPORT_COMPONENTS = new Set(["Laboratory", "Recitation"]);
const UNLISTED = "Instructor not listed";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** One chip. Flags and attributes are the same object on a row. */
function chip({ key, label, detail }) {
  const node = el("span", "flag", label);
  node.dataset.flag = key;
  if (detail) node.title = detail;
  return node;
}

/** An attribute in the shape a chip takes. */
function asChip(attribute) {
  return { key: attribute.name, label: attributeLabel(attribute), detail: attribute.description };
}

function byComponent(a, b) {
  const ai = COMPONENT_ORDER.indexOf(a.component);
  const bi = COMPONENT_ORDER.indexOf(b.component);
  const aRank = ai === -1 ? COMPONENT_ORDER.length : ai;
  const bRank = bi === -1 ? COMPONENT_ORDER.length : bi;
  return aRank - bRank;
}

function byClassNumber(a, b) {
  return String(a.classNumber).localeCompare(String(b.classNumber));
}

/**
 * A lecture and the recitations under it are one enrolment, so a sort orders
 * sections within a component rather than interleaving them. Sort is stable, so
 * the key goes on first and the component order over the top.
 */
export function sortSections(sections, sort = "", term = "") {
  return orderBy(sections, (section) => [section], sort, term, byClassNumber).sort(byComponent);
}

/**
 * Group a course's sections by who teaches them.
 *
 * Sections are keyed by their whole instructor set, not by each person, so a
 * co-taught section lands in exactly one block. Filing it under every teacher
 * would double-count sections and make a course look bigger than it is.
 */
export function groupByInstructor(sections, sort = "", term = "") {
  const groups = new Map();
  for (const section of sections ?? []) {
    const people = instructorsOf(section);
    const key = people.length ? people.map((p) => p.name).sort().join(" & ") : UNLISTED;
    if (!groups.has(key)) groups.set(key, { key, people, sections: [] });
    groups.get(key).sections.push(section);
  }

  return orderBy([...groups.values()], (group) => group.sections, sort, term, bySurname);
}

function bySurname(a, b) {
  if (a.key === UNLISTED) return 1;
  if (b.key === UNLISTED) return -1;
  return surname(a.key).localeCompare(surname(b.key));
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Last name for sorting, skipping generational suffixes like "Smith III". */
function surname(name) {
  const parts = name.split(" & ")[0].trim().split(/\s+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const word = parts[i].replace(/\.$/, "").toLowerCase();
    if (!SUFFIXES.has(word)) return parts[i];
  }
  return name;
}

/**
 * Instructor heading, with a rating when we have one.
 *
 * Only about a third of instructors appear on RateMyProfessors, so the
 * unmatched case has to cost nothing visually. The name itself is the link,
 * which means an unrated professor adds no extra marks to the page at all.
 */
function renderTeacher(group) {
  const nodes = [];
  const people = group.people.length ? group.people : [{ name: group.key }];

  people.forEach((person, i) => {
    if (i) nodes.push(document.createTextNode(" & "));
    const rating = ratingFor(person.name);

    const link = el("a", "teacher-link", person.name);
    link.href = rating ? profileUrl(rating.legacyId) : searchUrl(person.name);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    nodes.push(link);

    if (!rating) return;

    const score = el("span", "score", Number(rating.avgRating).toFixed(1));
    // A 4.9 from two people is not a 4.9 from two hundred, so the count is
    // never optional and thin evidence is marked as thin.
    score.dataset.thin = rating.numRatings < 5 ? "true" : "false";
    score.append(el("span", "score-count", `${rating.numRatings}`));
    score.title = `${rating.avgRating} out of 5 from ${rating.numRatings} rating${rating.numRatings === 1 ? "" : "s"} on RateMyProfessors`;
    nodes.push(score);
  });

  return nodes;
}

// Lecture rows show only the section they register with. The reverse direction
// is useful in the quieter support block, where it identifies the lecture a lab
// belongs to without turning the lecturer comparison into a wall of links.
function renderLinked(parent, term, reverse = false) {
  const seats = seatsFor(parent, term);
  const node = el("span", "linked", seats ? `with ${parent} ${seats.enrolled}/${seats.limit}` : `with ${parent}`);
  if (seats) node.dataset.state = seats.full ? "full" : "open";

  const note = reverse
    ? `Section ${parent} registers with this one.`
    : `Registering for this also registers you for ${parent}.`;
  node.title = seats
    ? `${note} That one is ${seats.enrolled} enrolled of ${seats.limit}${seats.full ? ", so this section cannot be registered" : ""}.`
    : note;
  return node;
}

export function renderSection(section, term, { showInstructor = false } = {}) {
  const li = el("li", "section");
  // Selecting a section is the primary action in the three-pane layout, so the
  // row has to be a real control rather than a div with a click handler.
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.dataset.classNumber = String(section.classNumber ?? "");
  const meetings = distinctMeetings(section);
  const meeting = meetings[0] ?? null;

  li.append(el("span", "section-number", section.classNumber ?? ""));

  const when = el("span", "section-when");
  when.append(document.createTextNode(formatWhen(meeting) + " "));
  if (section.component) when.append(el("span", "component", section.component));
  li.append(when);

  li.append(el("span", "section-where", formatPlace(meeting, section)));

  // Lecture instructors are the headings students compare. Labs and
  // recitations live in their own quieter block, so their names belong on the
  // row without a rating rather than masquerading as another course choice.
  if (showInstructor) {
    const people = instructorsOf(section).map((person) => person.name).join(" & ");
    if (people) li.append(el("span", "section-who", people));
  }

  // The row's first line has room for one pattern, and a section can hold more.
  for (const extra of meetings.slice(1)) {
    li.append(el("span", "section-also", `${formatWhen(extra)} · ${formatPlace(extra, section)}`));
  }

  // A row is scanned rather than read, so it carries the two that change a
  // decision most and the pane spells out the rest. One strip and one cap: the
  // fee and the honors marking are chips of the same kind as the flags, and a
  // second run of them in a second colour tells a student nothing.
  const sectionLevelFlags = sectionFlags(section).filter((flag) => !showInstructor || flag.key !== "assistant");
  const flags = [...sectionLevelFlags, ...sectionBadges(section).map(asChip)].slice(0, ROW_CHIPS);
  if (flags.length) {
    const strip = el("span", "flags");
    for (const flag of flags) strip.append(chip(flag));
    li.append(strip);
  }

  // Everything the third column holds goes in one cell, so a later row extra
  // added to the grid cannot slide the seat count onto somebody else's line.
  const seatCell = el("span", "seat-cell");

  const linked = linkedTo(section.classNumber, term);

  // Absent means unknown, never zero. A section with no snapshot row simply
  // shows nothing rather than implying it is empty.
  const seats = seatsFor(section.classNumber, term);
  if (seats) {
    const node = el("span", "seats", `${seats.enrolled}/${seats.limit}`);
    node.dataset.state = seats.full ? "full" : "open";
    if (seats.waitlist > 0) node.append(el("span", "waitlist", `+${seats.waitlist}`));
    node.title = seats.full
      ? `Full. ${seats.enrolled} enrolled of ${seats.limit}${seats.waitlist ? `, ${seats.waitlist} waiting` : ""}.`
      : `${seats.enrolled} enrolled of ${seats.limit}.`;

    // Barrett rebuilds once a day, so this is a night's difference, not a seat
    // anyone is holding open. Never on a full row: seats and trend are two
    // fetches and can skew by a night, and 99 of the 248 sections that opened
    // on 2026-08-19 were full again the next night. Never on a row "hide full"
    // drops either, since the seats it opened cannot be registered. #67.
    const opened = !seats.full && !unreachable(section.classNumber, term)
      ? openedOn(section.classNumber, term)
      : null;
    if (opened) {
      const mark = el("span", "opened", "opened");
      mark.title = `Full in the previous snapshot, open in the one from ${opened}.`;
      node.append(mark);
    }
    seatCell.append(node);
  }

  // A lab with seats left is not open if the lecture it enrolls you into is
  // full, and that lecture is nowhere else on the row.
  const direct = linked?.enrolls ?? [];
  const reverse = showInstructor ? linked?.enrolledBy ?? [] : [];
  const partners = [...new Set([...direct, ...reverse])];
  for (const parent of partners.slice(0, 3)) {
    seatCell.append(renderLinked(parent, term, !direct.includes(parent)));
  }
  if (partners.length > 3) {
    const more = el("span", "linked", `with ${partners.length} linked sections`);
    more.title = `Linked sections: ${partners.join(", ")}. Open this row for the full list.`;
    seatCell.append(more);
  }

  if (seatCell.childNodes.length) li.append(seatCell);

  return li;
}

export function renderCourse({ course, sections }, term, sort = "", { forceOpen = false } = {}) {
  const article = el("article", "course");

  const head = el("header", "course-head");
  head.append(el("span", "course-code", `${course.subject} ${course.catalogNumber}`));
  head.append(el("span", "course-title", course.title ?? ""));

  for (const attribute of courseBadges(course, sections)) head.append(chip(asChip(attribute)));

  const units = formatUnits(course);
  const count = `${sections.length} section${sections.length === 1 ? "" : "s"}`;
  const actions = el("span", "course-actions");
  actions.append(el("span", "course-meta", units ? `${units} · ${count}` : count));

  const body = el("div", "course-body");
  const bodyId = `course-${term}-${course.subject}-${course.catalogNumber}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
  body.setAttribute("id", bodyId);
  const initiallyOpen = forceOpen || sections.length < COURSE_COLLAPSE_AT;
  body.hidden = !initiallyOpen;

  const courseCode = `${course.subject} ${course.catalogNumber}`;
  const toggle = el("button", "course-toggle", initiallyOpen ? "Hide sections" : "Show sections");
  toggle.setAttribute("type", "button");
  toggle.setAttribute("aria-controls", bodyId);
  toggle.setAttribute("aria-expanded", String(initiallyOpen));
  toggle.setAttribute("aria-label", `${initiallyOpen ? "Hide" : "Show"} sections for ${courseCode}`);
  actions.append(toggle);
  head.append(actions);
  article.append(head);

  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    const support = sections.filter((section) => SUPPORT_COMPONENTS.has(section.component));
    const primary = sections.filter((section) => !SUPPORT_COMPONENTS.has(section.component));

    for (const group of groupByInstructor(primary, sort, term)) {
      const block = el("section", "teacher");

      const heading = el("h3", "teacher-name");
      if (group.key === UNLISTED) {
        heading.classList.add("is-unlisted");
        heading.textContent = group.key;
      } else {
        heading.append(...renderTeacher(group));
      }
      block.append(heading);

      const list = el("ul", "sections");
      for (const section of sortSections(group.sections, sort, term)) list.append(renderSection(section, term));
      block.append(list);

      body.append(block);
    }

    if (support.length) {
      const block = el("section", "supporting");
      block.append(el("h3", "supporting-title", "Labs and recitations"));
      block.append(el("p", "supporting-note", "Pick these after the lecture. When registration links are published, the paired section is shown on the row."));
      const list = el("ul", "sections");
      for (const section of sortSections(support, sort, term)) {
        list.append(renderSection(section, term, { showInstructor: true }));
      }
      block.append(list);
      body.append(block);
    }
  };

  if (initiallyOpen) build();
  toggle.addEventListener("click", () => {
    const open = body.hidden;
    if (open) build();
    body.hidden = !open;
    toggle.textContent = open ? "Hide sections" : "Show sections";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", `${open ? "Hide" : "Show"} sections for ${courseCode}`);
  });

  article.append(body);

  return article;
}

export function renderResults(container, { primary, related, openRelated, openClass }, term, sort = "") {
  const hasClass = (entry) => Boolean(openClass) && entry.sections.some((section) => String(section.classNumber) === String(openClass));
  const nodes = primary.map((entry) => renderCourse(entry, term, sort, { forceOpen: hasClass(entry) }));

  if (related?.length) {
    const details = el("details", "related");
    details.append(el("summary", null, `Show ${related.length} related course${related.length === 1 ? "" : "s"}`));

    // <details> hides its content, it does not defer building it. Rendering
    // these up front costs thousands of nodes to display none of them, so they
    // are built on first open instead.
    let built = false;
    const build = () => {
      if (built) return;
      built = true;
      details.append(...related.map((entry) => renderCourse(entry, term, sort, { forceOpen: hasClass(entry) })));
    };
    details.addEventListener("toggle", () => { if (details.open) build(); });
    // A link into a related course has to land on a row that exists. The toggle
    // event is queued rather than fired, so opening alone is not enough.
    if (openRelated) { details.open = true; build(); }

    nodes.push(details);
  }

  container.replaceChildren(...nodes);
}
