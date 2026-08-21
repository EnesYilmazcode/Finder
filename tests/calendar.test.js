import test from "node:test";
import assert from "node:assert/strict";

import { buildSlots } from "../js/calendar.js";
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

test("a meeting with no day of the week cannot be placed on the grid", () => {
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
  const { slots, unscheduled } = buildSlots(entries, TERM);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].start, 900);
  assert.equal(unscheduled.length, 0, "the section is on the grid, so it is not also listed as unscheduled");
});

// Regression, #82. Class 15671 in Autumn 2026 meets Tu 8:00a-10:55a in CE 310
// and again Th 4:10p-5:05p in MP 1040, and only the Tuesday half was drawn.
test("regression #82: every meeting of a section gets its own slot", () => {
  const entries = [
    entry("CHEM", "1110", "Elementary Chemistry", [
      section(1001, {
        meetings: [
          meeting(["tuesday"], "8:00 AM", "10:55 AM", [person("Mehr Bindra")]),
          meeting(["thursday"], "4:10 PM", "5:05 PM", [person("Laurenda Lamboni")]),
        ],
      }),
    ]),
  ];
  const { slots, unscheduled } = buildSlots(entries, TERM);
  assert.deepEqual(
    slots.map((s) => [s.days.join(","), s.start, s.end]),
    [["tuesday", 480, 655], ["thursday", 970, 1025]]
  );
  for (const slot of slots) assert.equal(slot.items.length, 1);
  assert.equal(unscheduled.length, 0);
});

// Regression, #82. MUSIC 2203.04 section 19215 meets MoWeFr 4:10p-5:05p in two
// Weigel rooms at once, which is two meetings for one block on the grid.
test("regression #82: a section meeting twice in the same hour is listed once", () => {
  const entries = [
    entry("MUSIC", "2203.04", "Men's Glee Club", [
      section(1001, {
        meetings: [
          meeting(MWF, "4:10 PM", "5:05 PM", [person("Robert James Ward")], { buildingDescriptionShort: "WG 174" }),
          meeting(MWF, "4:10 PM", "5:05 PM", [person("Robert James Ward")], { buildingDescriptionShort: "WG 100A" }),
        ],
      }),
    ]),
  ];
  const { slots } = buildSlots(entries, TERM);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].items.length, 1);
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
