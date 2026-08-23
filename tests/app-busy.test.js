// #62 through the page. tests/filters.test.js pins the overlap rule and
// tests/app-filters.test.js pins that clearing takes the blocks with it; this is
// the rest of the control, which is where the whole feature lives: the URL that
// brings a block back, the chip that takes one off, and the Add button's guard.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const TERM = "1268";
const PAGE = "https://enesyilmazcode.github.io/Finder/";
const MWF = ["monday", "wednesday", "friday"];
const DASH = "\u2013";
// Monday 9:00 to 10:00, which only the 9:00 section overlaps.
const MONDAY_MORNING = "Mo-540-600";
const HINT = "Block out a class you already have. Sections that overlap it drop out.";

const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Stephen Gomori"]),
    taught(1002, MWF, "10:20 AM", "11:15 AM", ["Stephen Gomori"]),
    taught(1003, MWF, "1:00 PM", "1:55 PM", ["Stephen Gomori"]),
    taught(1004, MWF, "2:00 PM", "2:55 PM", ["Stephen Gomori"]),
  ]),
];

const TERMS = { data: { data: [{ strm: TERM, descr: "Autumn 2026", startDate: "2026-08-25", endDate: "2026-12-16" }] } };

function serve() {
  return stubFetch(new Map([
    ["data/ratings.json", RATINGS],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [/searchableTermsV2/, TERMS],
    [/\/classes\/search/, { data: { totalItems: 4, totalPages: 1, courses: COURSES } }],
  ]));
}

const numbers = (page) => page.all(".section").map((row) => row.dataset.classNumber);
const chips = (page) => page.all("#f-busy-list .f-chip").map((chip) => chip.textContent);
const busyKeys = (page) => new URLSearchParams(page.location.search).getAll("busy");
const focus = (page) => page.document.activeElement.id || page.document.activeElement.tagName;

/** A painted page, optionally arriving on a link that already carries blocks. */
async function painted(search = "", { rows = 4 } = {}) {
  const page = await mountApp({ query: "CSE 2221", term: TERM, url: `${PAGE}${search}` });
  await until(() => page.all(".section").length === rows, `${rows} sections to paint`);
  return page;
}

/** Tick a busy day by its position in the rail, Monday first. */
function pickDay(page, index) {
  page.all("#f-busy-days .f-day")[index].click();
}

test("regression #62: a shared busy link comes back as a chip, and the block is in force", async (t) => {
  t.after(serve());
  const page = await painted(`?busy=${MONDAY_MORNING}`, { rows: 3 });

  assert.deepEqual(chips(page), [`Mo 9:00a${DASH}10:00a`], "the link's block never became a chip");
  assert.deepEqual(numbers(page), ["1002", "1003", "1004"], "the 9:00 Monday section survived its own block");
  assert.equal(page.el("#f-clear").hidden, false, "the rail claims nothing is filtered");
  assert.match(page.el(".hidden-note").textContent, /^1 section hidden by your filters/);
});

test("regression #62: removing the chip repaints the page and takes the key out of the URL", async (t) => {
  t.after(serve());
  const page = await painted(`?busy=${MONDAY_MORNING}`, { rows: 3 });

  const chip = page.el("#f-busy-list .f-chip");
  // The chips sit inside <form id="filters">, where a button with no type is a
  // submit button, so removing a block would reload the page instead.
  assert.equal(chip.type, "button");
  assert.equal(chip.getAttribute("aria-label"), `Remove busy time Mo 9:00a${DASH}10:00a`,
    "the chip reads as a time, not as the button that takes it off");
  chip.click();

  assert.deepEqual(chips(page), []);
  assert.deepEqual(numbers(page), ["1001", "1002", "1003", "1004"], "the block held on after its chip went");
  assert.deepEqual(busyKeys(page), [], "the URL still carries a block nothing on screen shows");
  assert.equal(page.el("#f-clear").hidden, true);
  assert.equal(page.el(".hidden-note"), null);
  // In a browser the click focuses the chip, and the chip is about to leave the
  // document, which drops focus to the body past the whole rail.
  assert.equal(focus(page), "f-busy-add");
});

test("regression #62: Add refuses a block with no day and leaves the page alone", async (t) => {
  t.after(serve());
  const page = await painted();

  page.el("#f-busy-start").value = "09:00";
  page.el("#f-busy-end").value = "10:00";
  page.el("#f-busy-add").click();

  assert.equal(page.el("#f-busy-hint").textContent, "Pick at least one day, and a start before the end.");
  assert.deepEqual(chips(page), []);
  assert.deepEqual(busyKeys(page), []);
  assert.equal(page.all(".section").length, 4);
});

test("regression #62: Add refuses a start that is not before the end", async (t) => {
  t.after(serve());
  const page = await painted();

  pickDay(page, 0);
  page.el("#f-busy-start").value = "10:00";
  page.el("#f-busy-end").value = "09:00";
  page.el("#f-busy-add").click();

  assert.equal(page.el("#f-busy-hint").textContent, "Pick at least one day, and a start before the end.");
  assert.equal(page.all("#f-busy-days .f-day")[0].getAttribute("aria-pressed"), "true",
    "the day is ticked on screen and says nothing to a screen reader");
  assert.deepEqual(chips(page), []);
  assert.equal(page.all(".section").length, 4);
});

// The fields are the next block being written, so leaving the last one in them
// offers a second Add that silently does nothing.
test("regression #62: a block that lands clears the fields it was written in", async (t) => {
  t.after(serve());
  const page = await painted();

  pickDay(page, 0);
  page.el("#f-busy-start").value = "09:00";
  page.el("#f-busy-end").value = "10:00";
  page.el("#f-busy-add").click();

  assert.deepEqual(chips(page), [`Mo 9:00a${DASH}10:00a`]);
  assert.equal(page.el("#f-busy-start").value, "");
  assert.equal(page.el("#f-busy-end").value, "");
  assert.deepEqual(page.all("#f-busy-days .f-day").map((day) => day.dataset.state), ["any", "any", "any", "any", "any"]);
  assert.equal(page.el("#f-busy-hint").textContent, HINT);
});

// "MoWe" and "WeMo" are the same hour of the same two days. Two chips for it
// would put the block in the URL twice and grow every time the link is reshared.
test("regression #62: two spellings of one block are one chip", async (t) => {
  t.after(serve());
  const page = await painted("?busy=MoWe-540-600&busy=WeMo-540-600", { rows: 3 });

  assert.deepEqual(chips(page), [`MoWe 9:00a${DASH}10:00a`]);

  // And adding it a third time by hand does not grow the list either.
  pickDay(page, 0);
  pickDay(page, 2);
  page.el("#f-busy-start").value = "09:00";
  page.el("#f-busy-end").value = "10:00";
  page.el("#f-busy-add").click();

  assert.deepEqual(chips(page), [`MoWe 9:00a${DASH}10:00a`]);
  assert.deepEqual(busyKeys(page), ["MoWe-540-600"]);
});

// Clear filters is the one way out, and a block half written in the fields is
// still filter state the rail is showing. Left behind, the rail says nothing is
// filtered over a ticked day and the hint from the Add that was refused.
test("regression #62: clearing the filters takes a half-written block too", async (t) => {
  t.after(serve());
  const page = await painted();

  pickDay(page, 0);
  page.el("#f-busy-start").value = "09:00";
  page.el("#f-busy-end").value = "10:00";
  page.el("#f-busy-add").click();

  pickDay(page, 1);
  page.el("#f-busy-add").click();
  assert.equal(page.el("#f-busy-hint").textContent, "Pick at least one day, and a start before the end.");

  page.el("#f-clear").click();

  assert.deepEqual(chips(page), []);
  assert.deepEqual(page.all("#f-busy-days .f-day").map((day) => day.dataset.state), ["any", "any", "any", "any", "any"]);
  assert.equal(page.el("#f-busy-hint").textContent, HINT);
  assert.equal(page.all(".section").length, 4);
});
