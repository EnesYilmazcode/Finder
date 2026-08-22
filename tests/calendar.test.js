import test from "node:test";
import assert from "node:assert/strict";

import { buildSlots, layOutDay, layOutWeek, slotInsets } from "../js/calendar.js";
import { entry, meeting, person, section, taught } from "./fixtures.js";
import { withSeats } from "./helpers.js";

// buildSlots asks seats.js for each section, so the snapshot has to be loaded.
await withSeats();

const TERM = "1268";
const MWF = ["monday", "wednesday", "friday"];

// The case the collapse exists for: three sections of one course at the same
// hour on the same days, taught by three different people.
const shared = () => [
  entry("CSE", "2321", "Foundations 1", [
    taught(1001, MWF, "3:00 PM", "3:55 PM", ["Charles Estill"]),
    taught(1002, MWF, "3:00 PM", "3:55 PM", ["Ramin Yarinezhad"]),
    taught(1003, MWF, "3:00 PM", "3:55 PM", ["Luan Duong"]),
  ]),
];

// Regression, #33. Slicing one column three ways is unreadable, and the point
// of the view is comparing the instructors in that hour.
test("regression #33: sections sharing a day pattern and time collapse into one slot", () => {
  const { slots, unscheduled } = buildSlots(shared(), TERM);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].items.length, 3);
  assert.deepEqual(slots[0].days, MWF);
  assert.equal(slots[0].start, 900);
  assert.equal(slots[0].end, 955);
  assert.equal(unscheduled.length, 0);
});

test("regression #33: the collapse holds across different courses at the same hour", () => {
  const entries = [
    entry("CSE", "2321", "Foundations 1", [taught(1001, MWF, "3:00 PM", "3:55 PM", ["Charles Estill"])]),
    entry("MATH", "1151", "Calculus", [taught(3001, MWF, "3:00 PM", "3:55 PM", ["Diana Kline"])]),
  ];
  const { slots } = buildSlots(entries, TERM);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].items.length, 2);
});

test("a different time or a different day pattern is a different slot", () => {
  const entries = [
    entry("CSE", "2321", "Foundations 1", [
      taught(1001, MWF, "3:00 PM", "3:55 PM", ["A"]),
      taught(1002, MWF, "4:00 PM", "4:55 PM", ["B"]),
      taught(1003, ["tuesday", "thursday"], "3:00 PM", "3:55 PM", ["C"]),
      taught(1004, ["monday", "wednesday"], "3:00 PM", "3:55 PM", ["D"]),
    ]),
  ];
  const { slots } = buildSlots(entries, TERM);
  assert.equal(slots.length, 4);
  for (const slot of slots) assert.equal(slot.items.length, 1);
});

test("every section lands in exactly one slot or in the unscheduled list", () => {
  const entries = [
    entry("CSE", "2321", "Foundations 1", [
      taught(1001, MWF, "3:00 PM", "3:55 PM", ["A"]),
      taught(1002, MWF, "3:00 PM", "3:55 PM", ["B"]),
      section(1005, { meetings: [] }),
    ]),
  ];
  const { slots, unscheduled } = buildSlots(entries, TERM);
  const placed = slots.reduce((n, s) => n + s.items.length, 0) + unscheduled.length;
  assert.equal(placed, 3);
});

test("a section with no usable meeting is unscheduled rather than dropped", () => {
  const entries = [
    entry("CSE", "2321", "Foundations 1", [
      section(1001, { meetings: [] }),
      section(1002, { instructionMode: "Distance Learning - Online" }),
      // A time but no day, so it cannot be placed on the grid.
      section(1003, { meetings: [meeting([], "3:00 PM", "3:55 PM", [person("A")])] }),
      // A day but no time, likewise.
      section(1004, { meetings: [meeting(MWF, null, null, [person("B")])] }),
      // A time that does not parse.
      section(1005, { meetings: [meeting(MWF, "TBA", "TBA", [person("C")])] }),
    ]),
  ];
  const { slots, unscheduled } = buildSlots(entries, TERM);
  assert.equal(slots.length, 0);
  assert.deepEqual(unscheduled.map((u) => u.section.classNumber), [1001, 1002, 1003, 1004, 1005]);
  assert.equal(unscheduled[0].entry.course.catalogNumber, "2321");
});

test("a missing end time falls back to a 55 minute class", () => {
  const entries = [entry("CSE", "2321", "Foundations 1", [taught(1001, MWF, "3:00 PM", null, ["A"])])];
  const { slots } = buildSlots(entries, TERM);
  assert.equal(slots[0].start, 900);
  assert.equal(slots[0].end, 955);
});

test("buildSlots picks the first meeting that has both a day and a time", () => {
  const entries = [
    entry("CSE", "2321", "Foundations 1", [
      section(1001, {
        meetings: [
          meeting([], "8:00 AM", "9:00 AM", [person("A")]),
          meeting(MWF, "3:00 PM", "3:55 PM", [person("A")]),
        ],
      }),
    ]),
  ];
  const { slots } = buildSlots(entries, TERM);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].start, 900);
});

test("each item carries the seats for its own section", () => {
  const entries = [
    entry("CSE", "2321", "Foundations 1", [
      taught(1001, MWF, "3:00 PM", "3:55 PM", ["A"]),  // open
      taught(1002, MWF, "3:00 PM", "3:55 PM", ["B"]),  // full
      taught(5555, MWF, "3:00 PM", "3:55 PM", ["C"]),  // not in the snapshot
    ]),
  ];
  const { slots } = buildSlots(entries, TERM);
  const [open, full, unknown] = slots[0].items;
  assert.equal(open.seats.full, false);
  assert.equal(full.seats.full, true);
  assert.equal(unknown.seats, null);
});

test("seats stay absent when the term does not match the snapshot", () => {
  const { slots } = buildSlots(shared(), "1262");
  for (const item of slots[0].items) assert.equal(item.seats, null);
});

test("buildSlots handles an empty result set", () => {
  assert.deepEqual(buildSlots([], TERM), { slots: [], unscheduled: [] });
  assert.deepEqual(buildSlots([entry("CSE", "2321", "Foundations 1", [])], TERM), { slots: [], unscheduled: [] });
});

// layOutDay reads nothing but the times, so a bare slot stands in for one out
// of buildSlots.
const at = (start, end) => ({ id: `${start}|${end}`, days: ["wednesday"], start, end, items: [] });

// Regression, #83. Both blocks were drawn full width, so the later one covered
// the earlier one and took its clicks.
test("regression #83: overlapping slots go into separate columns", () => {
  const laid = layOutDay([at(760, 815), at(765, 845)]);
  assert.deepEqual(laid.map((p) => [p.slot.start, p.column, p.columns]), [[760, 0, 2], [765, 1, 2]]);
});

test("regression #83: the ENGLISH 1110.01 overlap splits only on the days it happens", () => {
  const WF = ["wednesday", "friday"];
  const entries = [
    entry("ENGLISH", "1110.01", "Writing and Information Literacy", [
      taught(17458, WF, "12:40 PM", "1:35 PM", ["Cathy Lynne Ryan"]),
      taught(17463, WF, "12:45 PM", "2:05 PM", ["Scott L DeWitt"]),
      taught(17480, ["monday"], "12:40 PM", "1:35 PM", ["Nan Johnson"]),
    ]),
  ];
  const { slots } = buildSlots(entries, TERM);

  const wednesday = layOutDay(slots.filter((s) => s.days.includes("wednesday")));
  assert.deepEqual(wednesday.map((p) => [p.column, p.columns]), [[0, 2], [1, 2]]);

  // Monday holds one class, so nothing there gets narrowed.
  const monday = layOutDay(slots.filter((s) => s.days.includes("monday")));
  assert.deepEqual(monday.map((p) => [p.column, p.columns]), [[0, 1]]);
});

test("a day with no overlap keeps every block full width", () => {
  const laid = layOutDay([at(540, 595), at(600, 655), at(700, 755)]);
  assert.deepEqual(laid.map((p) => [p.column, p.columns]), [[0, 1], [0, 1], [0, 1]]);
});

test("a block ending exactly when the next starts does not split the column", () => {
  const laid = layOutDay([at(540, 600), at(600, 660)]);
  assert.deepEqual(laid.map((p) => p.columns), [1, 1]);
});

test("a column is free again once its block has ended", () => {
  // The middle block overlaps both of its neighbours, but the outer two never
  // touch each other, so they share the first column.
  const laid = layOutDay([at(540, 600), at(570, 630), at(600, 660)]);
  assert.deepEqual(laid.map((p) => [p.column, p.columns]), [[0, 2], [1, 2], [0, 2]]);
});

// MIN_SLOT holds a very short block at 44px, which is 23 minutes of grid, so
// the times alone would put a block on top of it.
test("a block painted taller than its end time still holds its column", () => {
  assert.deepEqual(layOutDay([at(700, 710), at(715, 775)]).map((p) => [p.column, p.columns]),
    [[0, 2], [1, 2]]);
  assert.deepEqual(layOutDay([at(700, 710), at(730, 790)]).map((p) => [p.column, p.columns]),
    [[0, 1], [0, 1]]);
});

// Two slots can share a time and still be two slots, since the id keys on the
// day list too, and a paged search does not return sections in a stable order.
test("the order buildSlots happened to emit slots in does not change the layout", () => {
  const early = { ...at(760, 815), id: "a" };
  const late = { ...at(760, 815), id: "b" };
  const shape = (laid) => laid.map((p) => [p.slot.id, p.column, p.columns]);
  assert.deepEqual(shape(layOutDay([early, late])), [["a", 0, 2], ["b", 1, 2]]);
  assert.deepEqual(shape(layOutDay([late, early])), [["a", 0, 2], ["b", 1, 2]]);
});

test("no two blocks ever share a column and a moment", () => {
  const input = [at(540, 600), at(545, 700), at(570, 630), at(600, 660), at(800, 900), at(850, 870)];
  const laid = layOutDay(input);
  assert.equal(laid.length, input.length);
  for (const a of laid) {
    for (const b of laid) {
      if (a === b || a.column !== b.column) continue;
      assert.ok(a.slot.end <= b.slot.start || b.slot.end <= a.slot.start,
        `${a.slot.id} and ${b.slot.id} both sit in column ${a.column}`);
    }
  }
});

test("layOutDay handles a day with nothing on it", () => {
  assert.deepEqual(layOutDay([]), []);
});

// A run is the whole stretch of the day, so its column count is its busiest
// moment. Charging that to every block in it divides classes that have nobody
// beside them, and on a split track that is what takes the name to 0px.
test("a block widens into a column its neighbours have left free", () => {
  // 8:50 runs all morning and 9:00 and 9:10 pile up under it, so the run is
  // three columns wide. By 10:00 the third column is empty, and the 10:00
  // block takes the room rather than sitting in a third of the track.
  const laid = layOutDay([at(530, 660), at(540, 580), at(550, 590), at(600, 640)]);
  assert.deepEqual(laid.map((p) => [p.slot.start, p.column, p.span, p.columns]),
    [[530, 0, 1, 3], [540, 1, 1, 3], [550, 2, 1, 3], [600, 1, 2, 3]]);
});

test("widening never reaches into a column something overlapping is in", () => {
  const input = [at(540, 600), at(545, 700), at(570, 630), at(600, 660), at(800, 900), at(850, 870)];
  const laid = layOutDay(input);
  for (const a of laid) {
    for (const b of laid) {
      if (a === b) continue;
      if (a.slot.end <= b.slot.start || b.slot.end <= a.slot.start) continue;
      assert.ok(a.column + a.span <= b.column || b.column + b.span <= a.column,
        `${a.slot.id} and ${b.slot.id} overlap in time and in columns`);
    }
  }
});

// What renderCalendar hands the CSS. Every day is laid out on its own, and the
// split it reports is what floors that day's track.
test("each day is laid out from its own slots", () => {
  const entries = [
    entry("CSE", "2321", "Foundations 1", [
      taught(1001, ["wednesday"], "9:00 AM", "10:30 AM", ["A"]),
      taught(1002, ["wednesday"], "9:10 AM", "10:30 AM", ["B"]),
      taught(1003, ["wednesday"], "9:20 AM", "10:30 AM", ["C"]),
      taught(1004, ["wednesday"], "9:30 AM", "10:30 AM", ["D"]),
      taught(1005, ["monday", "wednesday"], "9:40 AM", "10:30 AM", ["E"]),
      taught(1006, ["monday"], "1:00 PM", "1:55 PM", ["F"]),
    ]),
  ];
  const { slots } = buildSlots(entries, TERM);
  const week = layOutWeek(slots);

  assert.deepEqual(week.map((d) => d.key), ["monday", "wednesday"]);
  assert.deepEqual(week.map((d) => d.blocks.length), [2, 5]);
  for (const day of week) {
    for (const block of day.blocks) assert.ok(block.slot.days.includes(day.key));
  }
});

test("the split a day's track is floored at is that day's own, and capped", () => {
  const wide = [at(540, 600), at(545, 605), at(550, 610), at(555, 615), at(560, 620)]
    .map((s) => ({ ...s, days: ["wednesday"] }));
  const quiet = [{ ...at(540, 600), id: "q", days: ["monday"] }];
  const week = layOutWeek([...wide, ...quiet]);

  // Five overlapping classes still get five columns to sit in. It is only the
  // floor under the track that stops, so past three they share the room.
  assert.deepEqual(week.map((d) => [d.key, d.split]), [["monday", 1], ["wednesday", 3]]);
  assert.deepEqual(week.find((d) => d.key === "wednesday").blocks.map((b) => b.columns),
    [5, 5, 5, 5, 5]);
});

// The insets are what the reader actually sees, and they are easy to get
// backwards: reversing the right-hand term still passes every test above.
test("regression #83: a split block is inset to its own column", () => {
  assert.equal(slotInsets(0, 1), null);
  assert.deepEqual(slotInsets(0, 2),
    { left: "calc(2px + 0 * (100% - 4px) / 2)", right: "calc(4px + 1 * (100% - 4px) / 2)" });
  assert.deepEqual(slotInsets(1, 2),
    { left: "calc(2px + 1 * (100% - 4px) / 2)", right: "calc(4px + 0 * (100% - 4px) / 2)" });
  assert.deepEqual(slotInsets(1, 3),
    { left: "calc(2px + 1 * (100% - 4px) / 3)", right: "calc(4px + 1 * (100% - 4px) / 3)" });
  // A block that was widened covers its own column and the free ones after it.
  assert.deepEqual(slotInsets(1, 3, 2),
    { left: "calc(2px + 1 * (100% - 4px) / 3)", right: "calc(4px + 0 * (100% - 4px) / 3)" });
});
