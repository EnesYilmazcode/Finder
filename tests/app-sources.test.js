// The other half of tests/app-outage.test.js: every snapshot arrived.
//
// Two files reach the page after it has already painted, and neither is on the
// first-paint path. The trend rides along with the search, and the course codes
// are fetched on the first section opened and redraw the pane in place. Both
// are pinned by what turns up on screen, since the modules under them answer
// the same whether or not app.js ever asks.

import test from "node:test";
import assert from "node:assert/strict";

import { fire, mountApp, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATINGS, RATING_COURSES, SEATS_INDEX, SEATS_TERMS, TREND, entry, taught } from "./fixtures.js";

const TERM = "1268";
const NO_SEATS = "1262";
const MWF = ["monday", "wednesday", "friday"];

// Paolo Bucci is the professor the course-code fixture carries. 1001 is open
// and moved on three nights; 1002 is full, so its trend is the waitlist and the
// seat line below can only have come from 1001.
const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Paolo Bucci"]),
    taught(1002, MWF, "10:20 AM", "11:15 AM", ["Paolo Bucci"]),
  ]),
];

const TERMS = { data: { data: [
  { strm: TERM, descr: "Autumn 2026" },
  { strm: NO_SEATS, descr: "Spring 2026" },
] } };

const asked = [];

function serve(over = []) {
  const restore = stubFetch(new Map([
    ["data/ratings.json", RATINGS],
    ["data/ratings-courses.json", RATING_COURSES],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [`data/trend-${TERM}.json`, TREND[TERM]],
    [/searchableTermsV2/, { data: TERMS.data }],
    [(url) => url.includes("/classes/search"), { data: { totalItems: 2, totalPages: 1, courses: COURSES } }],
    ...over,
  ]));
  const stubbed = globalThis.fetch;
  globalThis.fetch = async (url) => { asked.push(String(url)); return stubbed(url); };
  return restore;
}

const searched = await (async () => {
  const restore = serve();
  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => page.all(".section").length > 0, "the first results");
  fire(page.el(".section"), "click");
  await until(() => page.el("#detail-body").textContent.includes("ratings are for"), "the course codes");
  restore();
  return page;
})();
const bySearch = asked.splice(0);

const landing = await (async () => {
  // js/seats.js is warm, so only a term the search never asked for can fail here.
  const restore = serve([[`data/seats-${NO_SEATS}.json`, { ok: false, status: 404, json: async () => null }]]);
  const page = await mountApp({ term: NO_SEATS });
  await until(() => page.el("#w-stats").textContent !== "", "the landing screen");
  restore();
  return page;
})();
const byFirstPaint = asked.splice(0);

test("nothing is switched off and nothing is blamed when every snapshot arrived", () => {
  // The date is left off the end: formatDate is locale-dependent and this box
  // is not the runner.
  assert.match(searched.el("#status").textContent, /^1 course, 2 sections in Autumn 2026\. Seats as of /);
  assert.doesNotMatch(searched.el("#status").textContent, /Could not load/);
  assert.equal(searched.el("#f-rating").disabled, false);
  assert.equal(searched.el("#f-rated").disabled, false);
  assert.equal(searched.el("#f-full").disabled, false);
});

test("the trend is fetched by the search, never by first paint", () => {
  // init used to open with loadTrend(els.term.value), copied off the loadSeats
  // line above it, where #term is still the empty select index.html ships.
  assert.deepEqual(bySearch.filter((url) => url.includes("trend-")), [`data/trend-${TERM}.json`]);
  assert.deepEqual(byFirstPaint.filter((url) => url.includes("trend-")), []);
});

test("the pane carries the trend the search loaded alongside it", () => {
  const values = searched.all("#detail-body .d-val").map((node) => node.textContent);
  assert.ok(values.includes("-6 seats in 3 days"), values.join(" | "));
});

test("the pane redraws with the course codes once they land", () => {
  assert.match(searched.el("#detail-body").textContent, /52 of 147 ratings are for CSE 2221\./);
});

test("only the filter whose snapshot died is switched off", () => {
  assert.equal(
    landing.el("#status").textContent,
    "Could not load seat counts, so the filter that needs them is off."
  );
  assert.equal(landing.el("#f-full").disabled, true);
  assert.equal(landing.el("#f-rating").disabled, false);
  assert.equal(landing.el("#f-rated").disabled, false);
});
