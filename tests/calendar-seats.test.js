// The grid told a student a section was open that nobody could register for.
//
// js/calendar.js imported seatsFor and nothing else, so it judged a section on
// its own row while js/filters.js, js/render.js, js/detail.js and js/sort.js
// all judged the same section on unreachable(). A recitation with free seats
// under a full lecture was dropped by "hide full", refused the "opened" badge,
// and told "This section cannot be registered" by the pane, while the grid
// painted it green and its accessible label read "5 of 24 seats taken" and
// stopped there. Measured on the real snapshot for term 1268: 35 sections.
//
// Both directions of a package have to be covered, since unreachable() answers
// them separately: a section that enrolls you into something full, and a
// lecture whose every listed way in is full.

import test from "node:test";
import assert from "node:assert/strict";

import { renderCalendar } from "../js/calendar.js";
import { entry, taught } from "./fixtures.js";
import { setupDom } from "./dom.js";
import { withSeats } from "./helpers.js";

await withSeats();

const TERM = "1268";
const FRI = ["friday"];

/** One slot's classes and the label each block speaks, in drawn order. */
function drawn(sections) {
  setupDom();
  const cal = renderCalendar([entry("CSE", "2221", "Software I", sections)], TERM);
  return {
    tone: cal.querySelector(".cal-slot").getAttribute("class"),
    blocks: cal.querySelectorAll(".cal-item").map((line) => ({
      said: line.getAttribute("aria-label"),
      seats: line.querySelector(".cal-seats")?.getAttribute("class") ?? null,
    })),
  };
}

const at = (classNumber, who) => taught(classNumber, FRI, "11:30 AM", "12:25 PM", [who]);

// 1010 has 5 of 24 seats free and auto-enrolls into 1002, which is 40/40.
test("regression #67: free seats under a full lecture are drawn shut, not open", () => {
  const { tone, blocks } = drawn([at(1010, "Robert Laurent")]);
  assert.equal(tone, "cal-slot is-full");
  assert.equal(blocks[0].seats, "cal-seats is-full");
  assert.match(blocks[0].said, /cannot be registered/);
});

// 1020 holds 44 of 46 and its only two recitations, 1021 and 1022, are both
// 22/22, so all 44 arrived through a way in that is now closed.
test("regression #67: a lecture no listed way in can reach is drawn shut too", () => {
  const { tone, blocks } = drawn([at(1020, "Nora Whitfield")]);
  assert.equal(tone, "cal-slot is-full");
  assert.equal(blocks[0].seats, "cal-seats is-full");
  assert.match(blocks[0].said, /cannot be registered/);
});

// 1014 publishes no capacity, so seatsFor answers null and there is no seat
// span to colour. Its package still settles it, and the label is all that is
// left to say so.
test("regression #67: a section with no published capacity still reads shut", () => {
  const { tone, blocks } = drawn([at(1014, "Tim Long")]);
  assert.equal(tone, "cal-slot is-full");
  assert.equal(blocks[0].seats, null);
  assert.match(blocks[0].said, /cannot be registered/);
});

// The whole point of the tone: one block, several sections, worst case wins
// without hiding that something in there is takeable.
test("an open section beside a blocked one leaves the slot part full", () => {
  const { tone } = drawn([at(1001, "Charles Estill"), at(1010, "Robert Laurent")]);
  assert.equal(tone, "cal-slot is-part");
});

// The other half. 1001 is 30/40 with a free recitation, and 1030 holds more
// students than its one listed lab accounts for, so Barrett never named the way
// its other 86 got in and calling either shut would be a guess.
test("a section with a way in left is still drawn open and says nothing extra", () => {
  for (const [classNumber, who] of [[1001, "Charles Estill"], [1030, "Diana Kline"]]) {
    const { tone, blocks } = drawn([at(classNumber, who)]);
    assert.equal(tone, "cal-slot is-open", `${classNumber} is not blocked`);
    assert.equal(blocks[0].seats, "cal-seats");
    assert.doesNotMatch(blocks[0].said, /cannot be registered/);
  }
});
