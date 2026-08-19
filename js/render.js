// Everything here builds DOM nodes rather than HTML strings. Course titles and
// instructor names come from an external API, so they never get interpolated
// into markup.
//
// Seat counts are deliberately absent. The search endpoint reports one
// enrollment figure per course and repeats it onto every section, so rendering
// it per section would tell students a full section is open. See #13.

import { formatWhen, formatPlace, formatUnits, instructorsOf } from "./format.js";
import { ratingFor, searchUrl, profileUrl } from "./ratings.js";
import { seatsFor } from "./seats.js";

const COMPONENT_ORDER = ["Lecture", "Seminar", "Studio", "Laboratory", "Recitation"];
const UNLISTED = "Instructor not listed";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function sortSections(sections) {
  return [...sections].sort((a, b) => {
    const ai = COMPONENT_ORDER.indexOf(a.component);
    const bi = COMPONENT_ORDER.indexOf(b.component);
    const aRank = ai === -1 ? COMPONENT_ORDER.length : ai;
    const bRank = bi === -1 ? COMPONENT_ORDER.length : bi;
    if (aRank !== bRank) return aRank - bRank;
    return String(a.classNumber).localeCompare(String(b.classNumber));
  });
}

/**
 * Group a course's sections by who teaches them.
 *
 * Sections are keyed by their whole instructor set, not by each person, so a
 * co-taught section lands in exactly one block. Filing it under every teacher
 * would double-count sections and make a course look bigger than it is.
 */
export function groupByInstructor(sections) {
  const groups = new Map();
  for (const section of sections ?? []) {
    const people = instructorsOf(section);
    const key = people.length ? people.map((p) => p.name).sort().join(" & ") : UNLISTED;
    if (!groups.has(key)) groups.set(key, { key, people, sections: [] });
    groups.get(key).sections.push(section);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === UNLISTED) return 1;
    if (b.key === UNLISTED) return -1;
    return surname(a.key).localeCompare(surname(b.key));
  });
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

export function renderSection(section, term) {
  const li = el("li", "section");
  // Selecting a section is the primary action in the three-pane layout, so the
  // row has to be a real control rather than a div with a click handler.
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.dataset.classNumber = String(section.classNumber ?? "");
  const meeting = section.meetings?.[0] ?? null;

  li.append(el("span", "section-number", section.classNumber ?? ""));

  const when = el("span", "section-when");
  when.append(document.createTextNode(formatWhen(meeting) + " "));
  if (section.component) when.append(el("span", "component", section.component));
  li.append(when);

  li.append(el("span", "section-where", formatPlace(meeting, section)));

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
    li.append(node);
  }

  return li;
}

export function renderCourse({ course, sections }, term) {
  const article = el("article", "course");

  const head = el("header", "course-head");
  head.append(el("span", "course-code", `${course.subject} ${course.catalogNumber}`));
  head.append(el("span", "course-title", course.title ?? ""));

  const units = formatUnits(course);
  const count = `${sections.length} section${sections.length === 1 ? "" : "s"}`;
  head.append(el("span", "course-meta", units ? `${units} · ${count}` : count));
  article.append(head);

  for (const group of groupByInstructor(sections)) {
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
    for (const section of sortSections(group.sections)) list.append(renderSection(section, term));
    block.append(list);

    article.append(block);
  }

  return article;
}

export function renderResults(container, { primary, related }, term) {
  const nodes = primary.map((entry) => renderCourse(entry, term));

  if (related?.length) {
    const details = el("details", "related");
    details.append(el("summary", null, `Show ${related.length} related course${related.length === 1 ? "" : "s"}`));

    // <details> hides its content, it does not defer building it. Rendering
    // these up front costs thousands of nodes to display none of them, so they
    // are built on first open instead.
    let built = false;
    details.addEventListener("toggle", () => {
      if (built || !details.open) return;
      built = true;
      details.append(...related.map((entry) => renderCourse(entry, term)));
    });

    nodes.push(details);
  }

  container.replaceChildren(...nodes);
}
