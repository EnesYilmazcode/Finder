// The wiring, driven through the real index.html. app.js is imported for its
// side effect: importing it runs init(), which reads the URL below and paints.

import test from "node:test";
import assert from "node:assert/strict";

import { installDom, fire } from "./dom.js";
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

const document = installDom(`https://enesyilmazcode.github.io/Finder/?q=CSE+2221&term=${TERM}`);

// Not helpers.stubFetch, which keys routes by exact URL. The two API calls
// carry query strings that vary with the search.
globalThis.fetch = async (input) => {
  const url = String(input);
  const body =
    url.includes("searchableTermsV2") ? TERMS
    : url.includes("/classes/search") ? { data: { totalItems: 4, totalPages: 1, courses: COURSES } }
    : url.endsWith("data/ratings.json") ? RATINGS
    : url.endsWith("data/seats.json") ? SEATS_INDEX
    : url.endsWith(`data/seats-${TERM}.json`) ? SEATS_TERMS[TERM]
    : null;
  if (!body) throw new Error(`unexpected fetch: ${url}`);
  return { ok: true, status: 200, json: async () => body };
};

await import("../js/app.js");

const els = {
  filters: document.querySelector("#filters"),
  full: document.querySelector("#f-full"),
  rating: document.querySelector("#f-rating"),
  clear: document.querySelector("#f-clear"),
  status: document.querySelector("#status"),
};

const rows = () => document.querySelectorAll(".section").length;
const note = () => document.querySelector(".hidden-note");
const days = () => document.querySelectorAll(".f-day");

/** init() is not awaitable from here, so wait for the paint it ends with. */
async function settle(done) {
  for (let i = 0; i < 200; i++) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the page never finished painting");
}

await settle(() => rows() === 4);

function applyBothFilters() {
  els.full.checked = true;
  els.rating.value = "4";
  fire(els.filters, "change");
}

test("the filters take three of the four sections off the page", () => {
  applyBothFilters();
  assert.equal(rows(), 1);
  assert.match(note().textContent, /^3 sections hidden by your filters/);
  assert.equal(els.clear.hidden, false);
  assert.match(location.search, /hideFull=1/);
  assert.match(location.search, /rating=4/);
});

// Regression, #78. Showing the hidden sections used to override the filters
// instead of clearing them, which left the rail, the status line and the URL
// describing a result set that was no longer on screen. Reloading the URL then
// gave a different page than the one that produced it.
test("regression #78: showing the hidden sections clears the filters everywhere", () => {
  // Every section meets Monday, so requiring it hides nothing and still has to
  // come back to "any" like the two filters that did hide something.
  days()[0].click();
  applyBothFilters();
  assert.equal(rows(), 1);
  assert.match(location.search, /day=monday/);

  note().querySelector("button").click();

  assert.equal(rows(), 4);
  assert.equal(els.full.checked, false);
  assert.equal(els.rating.value, "");
  assert.deepEqual(days().map((chip) => chip.dataset.state), ["any", "any", "any", "any", "any"]);
  assert.equal(els.clear.hidden, true);
  assert.equal(note(), null);
  assert.match(els.status.textContent, /1 course, 4 sections/);
  assert.deepEqual([...new URLSearchParams(location.search)], [["q", "CSE 2221"], ["term", TERM]]);
});
