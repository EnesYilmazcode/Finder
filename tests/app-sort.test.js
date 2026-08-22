// The sort control driven through the real index.html. It sits outside
// <form id="filters">, so nothing the form does reaches it: the reset, the URL
// and the dead-snapshot switch-off each have to name it.

import test from "node:test";
import assert from "node:assert/strict";

import { fire, mountApp, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const TERM = "1268";
const MWF = ["monday", "wednesday", "friday"];

// One instructor, so every section lands in one block and the order on screen
// is the order the sort put them in. Class numbers ascend while start times do
// not, so relevance and "Earliest start time" cannot agree by accident.
const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, MWF, "1:00 PM", "1:55 PM", ["Stephen Gomori"]),
    taught(1002, MWF, "9:00 AM", "9:55 AM", ["Stephen Gomori"]),
    taught(1003, MWF, "10:20 AM", "11:15 AM", ["Stephen Gomori"]),
  ]),
];

const TERMS = { data: { data: [{ strm: TERM, descr: "Autumn 2026" }] } };

function serve(over = []) {
  return stubFetch(new Map([
    ["data/ratings.json", RATINGS],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [/trend-/, { ok: false, status: 404, json: async () => null }],
    [/searchableTermsV2/, TERMS],
    [/\/classes\/search/, { data: { totalItems: 3, totalPages: 1, courses: COURSES } }],
    ...over,
  ]));
}

const order = (page) => page.all(".section").map((li) => li.dataset.classNumber);

async function painted(over = [], url) {
  const page = await mountApp({ query: "CSE 2221", term: TERM, url });
  await until(() => order(page).length === 3, "the three sections to paint");
  return page;
}

test("picking an order reorders the sections and says so in the URL", async () => {
  const restore = serve();
  const page = await painted();
  assert.deepEqual(order(page), ["1001", "1002", "1003"]);

  page.el("#f-sort").value = "start";
  fire(page.el("#f-sort"), "change");

  assert.deepEqual(order(page), ["1002", "1003", "1001"]);
  assert.match(page.location.search, /sort=start/);
  restore();
});

// #f-sort is not in the filters form, so els.filters.reset() cannot see it. Left
// out of clearFilters, "Show them anyway" hands back every section in an order
// the rail no longer claims to be applying.
test("clearing the filters puts the order back to relevance", async () => {
  const restore = serve();
  const page = await painted();

  page.el("#f-sort").value = "start";
  fire(page.el("#f-sort"), "change");
  page.el("#f-full").checked = true;
  fire(page.el("#filters"), "change");
  assert.equal(order(page).length, 1, "1002 is exactly full and 1003 is over cap");

  page.el(".hidden-note").querySelector("button").click();

  assert.equal(page.el("#f-sort").value, "");
  assert.deepEqual(order(page), ["1001", "1002", "1003"]);
  assert.doesNotMatch(page.location.search, /sort=/);
  restore();
});

// Regression, #63 with #85. The two orders that read the ratings file are the
// same evidence markSources already turns the rating filters off for. Left on,
// they rank the whole page against an empty index and the note under the
// control blames every section on screen for being unplaceable.
test("an order whose snapshot never arrived is offered to nobody", async () => {
  const restore = serve([["data/ratings.json", { ok: false, status: 503, json: async () => null }]]);
  const page = await painted([], "https://enesyilmazcode.github.io/Finder/?sort=rating");

  const disabled = Object.fromEntries(page.all("#f-sort option").map((o) => [o.value, o.disabled]));
  assert.deepEqual(disabled, { "": false, rating: true, difficulty: true, seats: false, start: false });
  assert.equal(page.el("#f-sort").value, "", "the order the link asked for cannot be honoured");
  assert.equal(page.el("#f-sort-note").hidden, true);
  restore();
});
