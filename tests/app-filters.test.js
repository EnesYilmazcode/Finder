// The filter rail driven through the real index.html: hide sections behind two
// filters, then take the way back out and check the rail, the status line and
// the URL still describe what is on screen.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, fire, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const TERM = "1268";
const MWF = ["monday", "wednesday", "friday"];

// 1002 is exactly full and 1003 is over cap, so "Hide full sections" removes
// both. Tim Long is rated 3.4, so a 4.0 floor removes his two sections. One
// section survives both filters.
const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Stephen Gomori"]),
    taught(1002, MWF, "10:20 AM", "11:15 AM", ["Stephen Gomori"]),
    taught(1003, MWF, "1:00 PM", "1:55 PM", ["Timothy Long"]),
    taught(1004, MWF, "2:00 PM", "2:55 PM", ["Timothy Long"]),
  ]),
];

const TERMS = { data: { data: [{ strm: TERM, descr: "Autumn 2026", startDate: "2026-08-25", endDate: "2026-12-16" }] } };

/** The two API calls carry query strings that vary with the search, so they are keyed by pattern. */
function serve() {
  return stubFetch(new Map([
    ["data/ratings.json", RATINGS],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [/searchableTermsV2/, TERMS],
    [/\/classes\/search/, { data: { totalItems: 4, totalPages: 1, courses: COURSES } }],
  ]));
}

const rows = (page) => page.all(".section").length;
const note = (page) => page.el(".hidden-note");
// Scoped through #f-days the way app.js scopes its own reads. Unscoped this
// also counts the busy-time chips, which are a second .f-day group in the rail.
const days = (page) => page.all("#f-days .f-day");

/** A painted page, the state both tests start from. */
async function painted() {
  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => rows(page) === 4, "the four sections to paint");
  return page;
}

function applyBothFilters(page) {
  page.el("#f-full").checked = true;
  page.el("#f-rating").value = "4";
  fire(page.el("#filters"), "change");
}

test("the filters take three of the four sections off the page", async () => {
  const restore = serve();
  const page = await painted();
  applyBothFilters(page);

  assert.equal(rows(page), 1);
  assert.match(note(page).textContent, /^3 sections hidden by your filters/);
  assert.equal(page.el("#f-clear").hidden, false);
  assert.match(page.location.search, /hideFull=1/);
  assert.match(page.location.search, /rating=4/);
  restore();
});

// Regression, #78. Showing the hidden sections used to override the filters
// instead of clearing them, which left the rail, the status line and the URL
// describing a result set that was no longer on screen. Reloading the URL then
// gave a different page than the one that produced it.
test("regression #78: showing the hidden sections clears the filters everywhere", async () => {
  const restore = serve();
  const page = await painted();

  // Every section meets Monday, so requiring it hides nothing and still has to
  // come back to "any" like the two filters that did hide something.
  days(page)[0].click();
  applyBothFilters(page);
  assert.equal(rows(page), 1);
  assert.match(page.location.search, /day=monday/);

  note(page).querySelector("button").click();

  assert.equal(rows(page), 4);
  assert.equal(page.el("#f-full").checked, false);
  assert.equal(page.el("#f-rating").value, "");
  assert.deepEqual(days(page).map((chip) => chip.dataset.state), ["any", "any", "any", "any", "any"]);
  assert.equal(page.el("#f-clear").hidden, true);
  assert.equal(note(page), null);
  assert.match(page.el("#status").textContent, /1 course, 4 sections/);
  assert.deepEqual([...new URLSearchParams(page.location.search)], [["q", "CSE 2221"], ["term", TERM]]);
  restore();
});
