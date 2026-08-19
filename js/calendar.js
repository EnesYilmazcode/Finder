// Week grid. Plots the sections of whatever you searched, and nothing else.
// There is no saved schedule and no course planning here on purpose: Finder is
// a search tool, so the grid answers "when is this taught and by whom".

import { instructorsOf } from "./format.js";
import { toMinutes } from "./filters.js";
import { ratingFor } from "./ratings.js";
import { seatsFor } from "./seats.js";

const DAYS = [
  ["monday", "Mon"], ["tuesday", "Tue"], ["wednesday", "Wed"],
  ["thursday", "Thu"], ["friday", "Fri"], ["saturday", "Sat"], ["sunday", "Sun"],
];

// Sized so a standard 55 minute class has room for its time label plus three
// instructor lines, which is the common worst case: CSE 2321 has three sections
// at MoWeFr 3:00p.
// These are measured from the rendered page, not estimated. Guessed values were
// 25% low and silently clipped 9 of 32 instructor lines, including one hidden
// entirely. If the type scale in the CSS changes, re-measure these.
const PX_PER_MIN = 1.9;    // 55 min gives 104px, which fits three instructors with margin
const MIN_SLOT = 44;
const LINE_H = 21;         // .cal-item
const CHROME_H = 15;       // .cal-time
const COUNT_H = 15;        // .cal-count, only when there is more than one section
const PAD_H = 7;           // .cal-slot vertical padding

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clock(minutes) {
  const hour = Math.floor(minutes / 60);
  const suffix = hour < 12 ? "a" : "p";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  const mins = minutes % 60;
  return mins ? `${display}:${String(mins).padStart(2, "0")}${suffix}` : `${display}${suffix}`;
}

/**
 * Collapse sections into time slots.
 *
 * Several instructors routinely teach the same course at the same hour. CSE
 * 2321 has three sections at MoWeFr 3:00p. Slicing that column three ways is
 * unreadable, and since the point of Finder is comparing instructors, one
 * block naming all three is both clearer and more useful.
 */
export function buildSlots(entries, term) {
  const slots = new Map();
  const unscheduled = [];

  for (const entry of entries) {
    for (const section of entry.sections) {
      const meeting = (section.meetings ?? []).find((m) => m.startTime && DAYS.some(([k]) => m[k]));
      if (!meeting) { unscheduled.push({ entry, section }); continue; }

      const start = toMinutes(meeting.startTime);
      const end = toMinutes(meeting.endTime) ?? (start == null ? null : start + 55);
      if (start == null) { unscheduled.push({ entry, section }); continue; }

      const days = DAYS.filter(([key]) => meeting[key]).map(([key]) => key);
      const id = `${days.join(",")}|${start}|${end}`;
      if (!slots.has(id)) slots.set(id, { id, days, start, end, items: [] });
      slots.get(id).items.push({ entry, section, seats: seatsFor(section.classNumber, term) });
    }
  }

  return { slots: [...slots.values()], unscheduled };
}

/** Worst-case tone for a slot: red if every section in it is full. */
function slotTone(items) {
  const known = items.filter((i) => i.seats);
  if (known.length && known.every((i) => i.seats.full)) return "is-full";
  if (known.some((i) => i.seats.full)) return "is-part";
  return "is-open";
}

export function renderCalendar(entries, term) {
  const { slots, unscheduled } = buildSlots(entries, term);
  const wrap = el("div", "cal-wrap");

  if (!slots.length) {
    wrap.append(el("p", "cal-empty", "Nothing here meets at a scheduled time."));
    if (unscheduled.length) wrap.append(unscheduledList(unscheduled));
    return wrap;
  }

  // Only draw the hours actually used, so a grid of afternoon classes does not
  // open with four empty morning rows.
  const first = Math.floor(Math.min(...slots.map((s) => s.start)) / 60) * 60;
  const last = Math.ceil(Math.max(...slots.map((s) => s.end)) / 60) * 60;
  const usedDays = DAYS.filter(([key]) => slots.some((s) => s.days.includes(key)));

  const grid = el("div", "cal");
  grid.style.setProperty("--cal-days", usedDays.length);
  grid.style.setProperty("--cal-height", `${(last - first) * PX_PER_MIN}px`);

  const gutter = el("div", "cal-gutter");
  gutter.append(el("div", "cal-head"));
  for (let m = first; m < last; m += 60) {
    const mark = el("div", "cal-hour");
    mark.style.height = `${60 * PX_PER_MIN}px`;
    mark.append(el("span", null, clock(m)));
    gutter.append(mark);
  }
  grid.append(gutter);

  for (const [key, label] of usedDays) {
    const column = el("div", "cal-col");
    column.append(el("div", "cal-head", label));

    const body = el("div", "cal-body");
    body.style.height = `${(last - first) * PX_PER_MIN}px`;
    for (let m = first; m < last; m += 60) {
      const line = el("div", "cal-line");
      line.style.height = `${60 * PX_PER_MIN}px`;
      body.append(line);
    }

    for (const slot of slots.filter((s) => s.days.includes(key))) {
      body.append(renderSlot(slot, first));
    }
    column.append(body);
    grid.append(column);
  }

  wrap.append(grid);
  if (unscheduled.length) wrap.append(unscheduledList(unscheduled));
  return wrap;
}

function renderSlot(slot, first) {
  const box = el("div", `cal-slot ${slotTone(slot.items)}`);
  const height = Math.max((slot.end - slot.start) * PX_PER_MIN, MIN_SLOT);
  box.style.top = `${(slot.start - first) * PX_PER_MIN}px`;
  box.style.height = `${height}px`;

  box.append(el("p", "cal-time", `${clock(slot.start)}–${clock(slot.end)}`));

  // Only draw what actually fits. Clipping silently would hide instructors,
  // which is the one thing this view exists to show, so anything that does not
  // fit is counted rather than dropped.
  const budget = height - PAD_H - CHROME_H - (slot.items.length > 1 ? COUNT_H : 0);
  const room = Math.max(1, Math.floor(budget / LINE_H));
  const shown = slot.items.slice(0, room);
  const spare = slot.items.length - shown.length;

  for (const item of shown) {
    const people = instructorsOf(item.section);
    const name = people.length ? people.map((p) => p.name).join(" & ") : "Instructor not listed";

    const line = el("button", "cal-item");
    line.type = "button";
    line.dataset.classNumber = String(item.section.classNumber);

    line.append(el("span", "cal-who", name));

    const rating = people.length === 1 ? ratingFor(people[0].name) : null;
    if (rating) line.append(el("span", "cal-rate", Number(rating.avgRating).toFixed(1)));
    if (item.seats) {
      line.append(el("span", item.seats.full ? "cal-seats is-full" : "cal-seats",
        `${item.seats.enrolled}/${item.seats.limit}`));
    }
    box.append(line);
  }

  if (spare > 0) box.append(el("p", "cal-more", `+${spare} more, see list view`));

  if (slot.items.length > 1) {
    box.prepend(el("p", "cal-count", `${slot.items.length} sections`));
  }
  return box;
}

/** Online and arranged sections have no place on a grid, but must not vanish. */
function unscheduledList(items) {
  const wrap = el("section", "cal-unscheduled");
  wrap.append(el("p", "eyebrow", `${items.length} without a set time`));
  for (const { entry, section } of items.slice(0, 12)) {
    const people = instructorsOf(section);
    const line = el("button", "cal-item");
    line.type = "button";
    line.dataset.classNumber = String(section.classNumber);
    line.append(el("span", "cal-who",
      `${entry.course.subject} ${entry.course.catalogNumber} · ${people.map((p) => p.name).join(" & ") || "Instructor not listed"}`));
    line.append(el("span", "cal-seats", section.instructionMode ?? ""));
    wrap.append(line);
  }
  if (items.length > 12) wrap.append(el("p", "d-note", `and ${items.length - 12} more`));
  return wrap;
}
