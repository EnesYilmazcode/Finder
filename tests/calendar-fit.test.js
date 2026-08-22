// What renderSlot draws has to fit the box renderSlot sized, and nothing has
// ever rendered a block to check: the budget it works to is arithmetic over
// four heights in js/calendar.js, and no test in this suite calls
// renderCalendar at all.
//
// It is already off by one line. The budget subtracts .cal-slot padding, the
// .cal-time label and the .cal-count label, then appends a "+N more" note it
// never subtracted, so on a bare CHEM pull in term 1268 34 of 35 notes are
// drawn past the block's own height. That costs nothing today: the note's line
// box hangs over by at most 3.08px, all of it leading and font descender, and
// a browser measurement of the glyph extents put the deepest ink 0.31px clear
// of the edge on the worst of the 35. Every instructor button is fully painted
// and hit-tests to itself, with 11.31px to 21.05px of clear space beneath it.
//
// The instructor lines are the half that must never slip, since a clipped
// button is unreachable and the whole view exists to compare instructors. So
// this pins the two things separately: the lines always fit, and the note is
// the only thing ever allowed past the edge.
//
// Heights below are measured in headless Chrome at a 16px root over 488 blocks
// between 12px and 427px wide. They do not move with block width, because
// .cal-who, .cal-time, .cal-count and .cal-more are all pinned to one line.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderCalendar } from "../js/calendar.js";
import { entry, taught } from "./fixtures.js";
import { setupDom } from "./dom.js";
import { withSeats } from "./helpers.js";

await withSeats();

/** Measured, not declared: what the browser actually paints. */
const PAINTED = {
  "cal-item": 20, "cal-time": 14, "cal-count": 14, "cal-more": 14, PADDING: 6.4,
};

const SOURCE = readFileSync(new URL("../js/calendar.js", import.meta.url), "utf8");

/** Read a height out of the module rather than copying it, so this cannot drift. */
function declared(name) {
  const found = SOURCE.match(new RegExp("const " + name + " = ([0-9.]+);"));
  assert.ok(found, "js/calendar.js no longer declares " + name);
  return Number(found[1]);
}

const MWF = ["monday", "wednesday", "friday"];

/** One course, `n` sections all at the same hour: what the collapse exists for. */
function crowd(n, start, end) {
  return [entry("CHEM", "1210", "General Chemistry",
    Array.from({ length: n }, (_, i) => taught(9000 + i, MWF, start, end, ["Teacher " + i])))];
}

/** Every block drawn, with the height it set and the height each part fills. */
function blocks(n, start, end) {
  setupDom();
  return renderCalendar(crowd(n, start, end), "1268").querySelectorAll(".cal-slot").map((box) => {
    let lines = PAINTED.PADDING; // everything up to and including the last instructor
    let note = 0;
    for (const child of box.childNodes) {
      if (child.nodeType !== 1) continue;
      const name = (child.getAttribute("class") || "").split(" ")[0];
      assert.ok(PAINTED[name] != null, "nothing in this test measures ." + name);
      if (name === "cal-more") note += PAINTED[name];
      else lines += PAINTED[name];
    }
    return { height: Number.parseFloat(box.style.height), lines, note, box };
  });
}

// 55 minutes is the standard class the constants were sized for, 30 is short
// enough to reach MIN_SLOT's floor, 80 is a lab block.
const SHAPES = [["3:00 PM", "3:55 PM"], ["3:00 PM", "3:30 PM"], ["3:00 PM", "4:20 PM"]];

test("regression #83: every instructor line a block draws fits inside it", () => {
  // The one that must not slip. .cal-slot is overflow:hidden, so a line past
  // the edge is a button nobody can click.
  for (const [start, end] of SHAPES) {
    for (let n = 1; n <= 12; n += 1) {
      for (const { height, lines } of blocks(n, start, end)) {
        assert.ok(lines <= height,
          n + " sections at " + start + "-" + end + ": instructor lines fill " + lines
          + "px of a " + height + "px block");
      }
    }
  }
});

test('regression #83: only the "+N more" note is ever allowed past the edge', () => {
  // It hangs into its own leading and no ink is lost. Anything else over the
  // edge is a real clip, and this is what says so.
  for (const [start, end] of SHAPES) {
    for (let n = 1; n <= 12; n += 1) {
      for (const { height, lines, note } of blocks(n, start, end)) {
        if (lines + note <= height) continue;
        assert.ok(lines <= height && lines + note - height <= PAINTED["cal-more"],
          n + " sections at " + start + "-" + end + ": " + (lines + note - height)
          + "px over the edge is more than one note");
      }
    }
  }
});

test("the heights renderSlot budgets with still cover what the page paints", () => {
  // Rounded up from PAINTED. #33 found the guessed values 25% low, which
  // silently clipped 9 of 32 instructor lines.
  for (const [name, painted] of [["LINE_H", PAINTED["cal-item"]], ["CHROME_H", PAINTED["cal-time"]],
    ["COUNT_H", PAINTED["cal-count"]], ["PAD_H", PAINTED.PADDING]]) {
    assert.ok(declared(name) >= painted,
      name + " is " + declared(name) + ", under the " + painted + "px the page paints");
  }
});
