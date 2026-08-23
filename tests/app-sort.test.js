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

// One instructor per course, so every section lands in one block and the order
// on screen is the order the sort put them in. Class numbers ascend while start
// times do not, so relevance and "Earliest start time" cannot agree by accident.
//
// The second course is what makes the course-level order visible: an exact
// "CSE 2221" leaves it in the related pile, a bare "CSE" browse puts both in the
// list, and it starts before every CSE 2221 section. Fenwick is the fixture's
// one professor with too few ratings to rank, so his two sections are also the
// ones a rating sort cannot place.
const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, MWF, "1:00 PM", "1:55 PM", ["Stephen Gomori"]),
    taught(1002, MWF, "9:00 AM", "9:55 AM", ["Stephen Gomori"]),
    taught(1003, MWF, "10:20 AM", "11:15 AM", ["Stephen Gomori"]),
  ]),
  entry("CSE", "2231", "Software 2", [
    taught(1004, MWF, "8:00 AM", "8:55 AM", ["Wes Fenwick"]),
    taught(1005, MWF, "2:00 PM", "2:55 PM", ["Wes Fenwick"]),
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
    [/\/classes\/search/, { data: { totalItems: 5, totalPages: 1, courses: COURSES } }],
    ...over,
  ]));
}

const order = (page) => page.all(".section").map((li) => li.dataset.classNumber);
// Related courses live in a collapsed <details> that is not built until it is
// opened, so both of these read the list the page is actually drawing.
const courses = (page) => page.all(".course-code").map((el) => el.textContent);
const note = (page) => page.el("#f-sort-note").textContent;

async function painted(over = [], url) {
  const page = await mountApp({ query: "CSE 2221", term: TERM, url });
  await until(() => order(page).length === 3, "the three sections to paint");
  return page;
}

/** A bare subject browse, which puts both courses in the list. */
async function browsed(url) {
  const page = await mountApp({ query: "CSE", term: TERM, url });
  await until(() => order(page).length === 5, "the five sections to paint");
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
  assert.doesNotMatch(page.location.search, /sort=/, "the link still asks for an order the page is not applying");
  assert.equal(page.el("#f-sort-note").hidden, true);
  restore();
});

// paint() orders the courses and renderCourse orders what is inside each one.
// With a single course on screen the second does all the visible work, so
// dropping the first changed nothing anyone could see.
test("the order runs over the courses, not only inside one", async () => {
  const restore = serve();
  const page = await browsed();
  assert.deepEqual(courses(page), ["CSE 2221", "CSE 2231"], "relevance ranks the exact number first");

  page.el("#f-sort").value = "start";
  fire(page.el("#f-sort"), "change");

  assert.deepEqual(courses(page), ["CSE 2231", "CSE 2221"], "the courses kept their relevance order");
  assert.deepEqual(order(page), ["1004", "1005", "1002", "1003", "1001"]);
  restore();
});

test("the note counts the sections the sort could not place", async () => {
  const restore = serve();
  const page = await browsed();
  assert.equal(page.el("#f-sort-note").hidden, true, "nothing is unplaceable until an order is picked");

  page.el("#f-sort").value = "rating";
  fire(page.el("#f-sort"), "change");

  assert.equal(note(page), "2 sections the sort could not place: too few ratings to rank.");
  assert.equal(page.el("#f-sort-note").hidden, false);
  restore();
});

// #63: the count was taken over primary and related together, so a search whose
// related pile is large reported more unplaceable sections than the status line
// said the page held, about sections that are not in the document at all.
test("the note counts the list on screen, not the folded-away pile", async () => {
  const restore = serve();
  const page = await painted();

  page.el("#f-sort").value = "rating";
  fire(page.el("#f-sort"), "change");

  assert.match(page.el("#status").textContent, /^1 course, 3 sections in Autumn 2026\./);
  assert.equal(page.el("details.related").querySelectorAll(".section").length, 0, "the related pile is not built");
  assert.equal(note(page), "", `every section on screen is placed: ${note(page)}`);
  assert.equal(page.el("#f-sort-note").hidden, true);
  restore();
});
