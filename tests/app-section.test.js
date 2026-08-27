// What a section says about itself once the app has drawn it: #67's package
// link on the row, and #68's flags on the row and in the pane. tests/seats.test.js
// and tests/detail.test.js pin the rules and the renderers in isolation; both
// renderers are reached from the page only here, so deleting either feature
// leaves the rest of the suite green.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATING_COURSES, RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught, HEADSHOTS } from "./fixtures.js";

const TERM = "1268";
const MWF = ["monday", "wednesday", "friday"];

// Two labs from the seat snapshot's packages. 1010 has seats of its own and
// enrolls into 1002, which is 40/40; 1011 enrolls into 1001, which is 30/40.
// 1003 carries two flags and no package.
const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(1010, MWF, "9:00 AM", "9:55 AM", ["Stephen Gomori"], { component: "Laboratory" }),
    taught(1011, MWF, "10:20 AM", "11:15 AM", ["Stephen Gomori"], { component: "Recitation" }),
    taught(1003, MWF, "1:00 PM", "1:55 PM", ["Stephen Gomori"], { consent: "I", waitlistCapacity: 0 }),
  ]),
];

const TERMS = { data: { data: [{ strm: TERM, descr: "Autumn 2026", startDate: "2026-08-25", endDate: "2026-12-16" }] } };

function serve() {
  return stubFetch(new Map([
    ["data/ratings.json", RATINGS],
    ["data/ratings-courses.json", RATING_COURSES],
    ["data/headshots.json", HEADSHOTS],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [`data/trend-${TERM}.json`, { ok: false, status: 404, json: async () => null }],
    [/searchableTermsV2/, TERMS],
    [/\/classes\/search/, { data: { totalItems: 3, totalPages: 1, courses: COURSES } }],
  ]));
}

const row = (page, number) => page.el(`[data-class-number="${number}"]`);

async function painted() {
  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => page.all(".section").length === 3, "the three sections to paint");
  return page;
}

// Regression, #67. The lecture a lab enrolls you into is nowhere else on the
// row, so a lab showing 5/24 reads as open when nobody can register for it.
test("regression #67: a row names the section it enrolls you into and whether that one is full", async (t) => {
  t.after(serve());
  const page = await painted();

  const links = page.all(".section .linked");
  assert.deepEqual(links.map((node) => node.textContent), ["with 1002 40/40", "with 1001 30/40"]);
  assert.deepEqual(links.map((node) => node.dataset.state), ["full", "open"]);

  assert.equal(row(page, "1010").querySelector(".linked").title,
    "Registering for this also registers you for 1002. That one is 40 enrolled of 40, so this section cannot be registered.");
  assert.equal(row(page, "1011").querySelector(".linked").title,
    "Registering for this also registers you for 1001. That one is 30 enrolled of 40.");
  assert.equal(row(page, "1003").querySelector(".linked"), null, "a section in no package was given a partner");
});

// Regression, #68. The row carries the two flags that change a decision most and
// the pane spells every one of them out. Without the pane's half a student sees
// "Permission required" and is never told what to do about it.
test("regression #68: a flagged section is chipped on the row and explained in the pane", async (t) => {
  t.after(serve());
  const page = await painted();

  const chips = row(page, "1003").querySelectorAll(".flag");
  assert.deepEqual(chips.map((node) => node.dataset.flag), ["consent", "waitlist"]);
  assert.deepEqual(chips.map((node) => node.textContent), ["Permission required", "No waitlist"]);

  row(page, "1003").click();

  const worth = page.all("#detail-body .d-block")
    .find((block) => block.querySelector(".eyebrow")?.textContent === "Worth knowing");
  assert.ok(worth, "the pane chipped a section it never explains");
  assert.deepEqual(worth.querySelectorAll(".d-note").map((note) => note.textContent), [
    "You cannot register for this one yourself. It needs permission first.",
    "No waitlist. Once it fills there is nothing to join.",
  ]);
});
