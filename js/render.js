// Everything here builds DOM nodes rather than HTML strings. Course titles and
// instructor names come from an external API, so they never get interpolated
// into markup.
//
// Seat counts are deliberately absent. The search endpoint reports one
// enrollment figure per course and repeats it onto every section, so rendering
// it per section would tell students a full section is open. See #13.

import { formatWhen, formatPlace, formatUnits, instructorsOf } from "./format.js";

const COMPONENT_ORDER = ["Lecture", "Seminar", "Studio", "Laboratory", "Recitation"];

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

export function renderSection(section) {
  const li = el("li", "section");
  const meeting = section.meetings?.[0] ?? null;

  li.append(el("span", "section-number", section.classNumber ?? ""));

  const when = el("span", "section-when");
  when.append(document.createTextNode(formatWhen(meeting) + " "));
  if (section.component) when.append(el("span", "component", section.component));
  li.append(when);

  li.append(el("span", "section-where", formatPlace(meeting, section)));

  const people = instructorsOf(section);
  li.append(el("span", "section-who", people.length ? people.map((p) => p.name).join(", ") : "Instructor not listed"));

  return li;
}

export function renderCourse({ course, sections }) {
  const article = el("article", "course");

  const head = el("header", "course-head");
  head.append(el("span", "course-code", `${course.subject} ${course.catalogNumber}`));
  head.append(el("span", "course-title", course.title ?? ""));

  const units = formatUnits(course);
  const count = `${sections.length} section${sections.length === 1 ? "" : "s"}`;
  head.append(el("span", "course-meta", units ? `${units} · ${count}` : count));
  article.append(head);

  const list = el("ul", "sections");
  for (const section of sortSections(sections)) list.append(renderSection(section));
  article.append(list);

  return article;
}

export function renderResults(container, entries) {
  container.replaceChildren(...entries.map(renderCourse));
}
