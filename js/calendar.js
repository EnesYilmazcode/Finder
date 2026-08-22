// Week grid. Plots the sections of whatever you searched, and nothing else.
// There is no saved schedule and no course planning here on purpose: Finder is
// a search tool, so the grid answers "when is this taught and by whom".

import { instructorsOf } from "./format.js";
import { toMinutes } from "./filters.js";
import { ratingFor } from "./ratings.js";
import { seatsFor } from "./seats.js";

// Short label for the column head, full name for the accessible name: a screen
// reader gets the day from the label, since the grid only says it by position.
const DAYS = [
  ["monday", "Mon", "Monday"], ["tuesday", "Tue", "Tuesday"], ["wednesday", "Wed", "Wednesday"],
  ["thursday", "Thu", "Thursday"], ["friday", "Fri", "Friday"],
  ["saturday", "Sat", "Saturday"], ["sunday", "Sun", "Sunday"],
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
// These are single-line heights, so .cal-time, .cal-count and .cal-more are
// pinned to one line in the CSS: a wrapped label would eat an instructor line
// out of the budget renderSlot works to without anything here knowing it had.

// Past three, widening the track costs more sideways scrolling than the names
// it saves, so a fourth column shares the room rather than adding to it. The
// CSS drops the rating and the seat count first, so the name keeps the room.
const MAX_SPLIT = 3;

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

// A block is never painted shorter than MIN_SLOT, so a very short class covers
// more of its column than its end time claims.
function paintedEnd(slot) {
  return slot.start + Math.max(slot.end - slot.start, MIN_SLOT / PX_PER_MIN);
}

/**
 * Split a day's slots into side-by-side columns.
 *
 * Blocks are placed absolutely, so two classes at overlapping times want the
 * same pixels and whichever draws last takes them, along with the clicks: on
 * ENGLISH 1110.01 six instructor buttons could not be reached at all, and one
 * button's own centre opened a different section.
 */
export function layOutDay(slots) {
  // The id breaks ties, since two slots can share a time and paged search does
  // not return sections in a stable order. See docs/osu-api.md.
  const order = [...slots].sort((a, b) =>
    a.start - b.start || a.end - b.end || String(a.id).localeCompare(String(b.id)));

  const laid = [];
  let run = [];
  let runEnd = -Infinity;

  // A run is a stretch of the day with no gap in it. Nothing in one run can
  // touch anything in the next, so each is packed on its own.
  for (const slot of order) {
    if (slot.start >= runEnd) { laid.push(...pack(run)); run = []; }
    run.push(slot);
    runEnd = Math.max(runEnd, paintedEnd(slot));
  }
  return [...laid, ...pack(run)];
}

function overlaps(a, b) {
  return a.start < paintedEnd(b) && b.start < paintedEnd(a);
}

/** Greedy leftmost free column, which is the usual week-view packing. */
function pack(run) {
  const ends = []; // when each column is free again
  const blocks = run.map((slot) => {
    let column = ends.findIndex((end) => end <= slot.start);
    if (column < 0) column = ends.length;
    ends[column] = paintedEnd(slot);
    return { slot, column, span: 1 };
  });

  // A run is a whole stretch of the day with no gap in it, so its column count
  // is its busiest single moment, and charging that to every block narrows
  // classes that overlap nothing beside them. Each block widens rightwards
  // until it meets something it does overlap: 15 of the 160 blocks on a bare
  // CSE search in term 1268 take room that was being left empty.
  for (const block of blocks) {
    while (block.column + block.span < ends.length
      && !blocks.some((other) => other.column === block.column + block.span
        && overlaps(other.slot, block.slot))) {
      block.span += 1;
    }
    block.columns = ends.length;
  }
  return blocks;
}

/**
 * Left and right insets for one block of a split run, or null when the block
 * has its run to itself and the CSS inset already has it right.
 *
 * The 2px matches the inset the CSS uses; the extra 2px on the right is the
 * gutter between neighbours.
 */
export function slotInsets(column, columns, span = 1) {
  if (columns < 2) return null;
  const share = `(100% - 4px) / ${columns}`;
  return {
    left: `calc(2px + ${column} * ${share})`,
    right: `calc(4px + ${columns - column - span} * ${share})`,
  };
}

/** Worst-case tone for a slot: red if every section in it is full. */
function slotTone(items) {
  const known = items.filter((i) => i.seats);
  if (known.length && known.every((i) => i.seats.full)) return "is-full";
  if (known.some((i) => i.seats.full)) return "is-part";
  return "is-open";
}

/**
 * Lay out every day that has something on it.
 *
 * Split is what the CSS floors the day's track at, so it is capped here rather
 * than at the point of use: past MAX_SPLIT the blocks share the room instead.
 */
export function layOutWeek(slots) {
  return DAYS
    .filter(([key]) => slots.some((s) => s.days.includes(key)))
    .map(([key, label, fullDay]) => {
      const blocks = layOutDay(slots.filter((s) => s.days.includes(key)));
      const widest = Math.max(1, ...blocks.map((b) => b.columns));
      return { key, label, fullDay, blocks, split: Math.min(widest, MAX_SPLIT) };
    });
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

  // Laid out before the grid is sized, since each column's floor depends on how
  // many columns that day needs.
  const days = layOutWeek(slots);

  const grid = el("div", "cal");
  grid.style.setProperty("--cal-days", days.length);
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

  for (const { label, fullDay, blocks, split } of days) {
    const column = el("div", "cal-col");
    // Sizes this day's track and no other, so a Wednesday that splits three
    // ways does not widen a Monday holding one class into sideways scrolling.
    column.style.setProperty("--cal-split", split);
    column.append(el("div", "cal-head", label));

    const body = el("div", "cal-body");
    body.style.height = `${(last - first) * PX_PER_MIN}px`;
    for (let m = first; m < last; m += 60) {
      const line = el("div", "cal-line");
      line.style.height = `${60 * PX_PER_MIN}px`;
      body.append(line);
    }

    for (const block of blocks) {
      body.append(renderSlot(block, first, fullDay));
    }
    column.append(body);
    grid.append(column);
  }

  // A week is two-dimensional, so it scrolls sideways rather than crushing its
  // columns. #38 measured the instructor name at 0-8px wide on every phone
  // width while the grid was squeezing to fit.
  const scroll = el("div", "cal-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "group");
  scroll.setAttribute("aria-label", "Week grid");
  scroll.append(grid);
  wrap.append(scroll);
  if (unscheduled.length) wrap.append(unscheduledList(unscheduled));
  return wrap;
}

function renderSlot({ slot, column, columns, span }, first, fullDay) {
  const box = el("div", `cal-slot ${slotTone(slot.items)}`);
  const height = Math.max((slot.end - slot.start) * PX_PER_MIN, MIN_SLOT);
  box.style.top = `${(slot.start - first) * PX_PER_MIN}px`;
  box.style.height = `${height}px`;

  const insets = slotInsets(column, columns, span);
  if (insets) {
    box.style.left = insets.left;
    box.style.right = insets.right;
  }

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

    // Spoken, "Paolo Bucci 3.0 32/40" is three numbers with no units, and the
    // day and time exist only as a position in the grid. The label says all of
    // it out loud.
    const said = [`${fullDay} ${clock(slot.start)} to ${clock(slot.end)}`, name];

    const rating = people.length === 1 ? ratingFor(people[0].name) : null;
    if (rating) {
      line.append(el("span", "cal-rate", Number(rating.avgRating).toFixed(1)));
      said.push(`rated ${Number(rating.avgRating).toFixed(1)} out of 5`);
    }
    if (item.seats) {
      line.append(el("span", item.seats.full ? "cal-seats is-full" : "cal-seats",
        `${item.seats.enrolled}/${item.seats.limit}`));
      said.push(item.seats.full
        ? `full, ${item.seats.enrolled} of ${item.seats.limit} seats taken`
        : `${item.seats.enrolled} of ${item.seats.limit} seats taken`);
    }
    line.setAttribute("aria-label", said.join(", "));
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
    const who = people.map((p) => p.name).join(" & ") || "Instructor not listed";
    const course = `${entry.course.subject} ${entry.course.catalogNumber}`;
    const line = el("button", "cal-item");
    line.type = "button";
    line.dataset.classNumber = String(section.classNumber);
    line.append(el("span", "cal-who", `${course} · ${who}`));
    line.append(el("span", "cal-seats", section.instructionMode ?? ""));
    line.setAttribute("aria-label",
      [course, who, "no set time", section.instructionMode].filter(Boolean).join(", "));
    wrap.append(line);
  }
  if (items.length > 12) wrap.append(el("p", "d-note", `and ${items.length - 12} more`));
  return wrap;
}
