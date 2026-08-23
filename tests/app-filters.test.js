// The filter rail driven through the real index.html: hide sections behind two
// filters, then take the way back out and check the rail, the status line and
// the URL still describe what is on screen.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, fire, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATINGS, SEATS_INDEX, SEATS_TERMS, entry, onlineMeeting, section, taught } from "./fixtures.js";

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
const busyChips = (page) => page.all("#f-busy-list .f-chip").map((chip) => chip.textContent);
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

// Regression, #62 with #78. The busy blocks live on their chips, and a chip is
// not a form control, so els.filters.reset() cannot see one. Left out of
// clearFilters the rail says nothing is filtered while every block is still in
// force, and reloading the URL gives a different page than the one on screen.
test("regression #62: clearing the filters takes the busy blocks with them", async () => {
  const restore = serve();
  const page = await painted();

  page.all("#f-busy-days .f-day")[0].click();
  page.el("#f-busy-start").value = "09:00";
  page.el("#f-busy-end").value = "10:00";
  page.el("#f-busy-add").click();

  assert.deepEqual(busyChips(page), ["Mo 9:00a–10:00a"]);
  assert.equal(rows(page), 3, "the 9:00 Monday section overlaps the block");
  assert.match(page.location.search, /busy=Mo-540-600/);

  note(page).querySelector("button").click();

  assert.deepEqual(busyChips(page), []);
  assert.deepEqual(page.all("#f-busy-days .f-day").map((chip) => chip.dataset.state), ["any", "any", "any", "any", "any"]);
  assert.equal(page.el("#f-busy-start").value, "");
  assert.equal(rows(page), 4);
  assert.equal(page.el("#f-clear").hidden, true);
  assert.doesNotMatch(page.location.search, /busy=/);
  restore();
});

// Regression, #77. The grid plots the primary pile only, so a note that counts
// the related pile there offers back sections the calendar will never draw.
// Searching the exact code puts Software 1 in the primary pile and Software 2
// in the related one; hiding online costs each of them one section.
const SPLIT = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Stephen Gomori"]),
    section(5003, { instructionMode: "Distance Learning", meetings: [onlineMeeting()] }),
  ]),
  entry("CSE", "2231", "Software 2", [
    section(5005, { instructionMode: "Distance Learning", meetings: [onlineMeeting()] }),
  ]),
];

/** The filters note, which in calendar view sits behind the not-on-the-grid one. */
const filterNote = (page) =>
  page.all(".hidden-note").find((n) => n.textContent.includes("hidden by your filters"))?.textContent ?? "";

test("regression #77: switching to the calendar drops what the grid cannot plot", async () => {
  const restore = stubFetch(new Map([
    ["data/ratings.json", RATINGS],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [/searchableTermsV2/, TERMS],
    [/\/classes\/search/, { data: { totalItems: 3, totalPages: 1, courses: SPLIT } }],
  ]));
  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => rows(page) === 2, "the primary course to paint");

  page.el("#f-online").checked = true;
  fire(page.el("#filters"), "change");
  assert.match(filterNote(page), /^2 sections and 1 course hidden by your filters/);

  page.el("#view-cal").click();
  assert.match(filterNote(page), /^1 section hidden by your filters/,
    "Software 2 is not on the grid, so offering it back there is an offer the grid cannot keep");

  page.el("#view-list").click();
  assert.match(filterNote(page), /^2 sections and 1 course hidden by your filters/);
  restore();
});

// Regression, #68. The two flag checkboxes reach the filter rule through
// readFilters and come back from a link through writeFilters, and nothing else
// on the page reads them, so both boxes can be inert without a test objecting.
// 1002 needs permission and 1003 is a graduate section, one flag each.
const FLAGGED = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Stephen Gomori"]),
    taught(1002, MWF, "10:20 AM", "11:15 AM", ["Stephen Gomori"], { consent: "I" }),
    taught(1003, MWF, "1:00 PM", "1:55 PM", ["Stephen Gomori"], { career: "GRAD" }),
  ]),
];

function serveFlagged() {
  return stubFetch(new Map([
    ["data/ratings.json", RATINGS],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [/searchableTermsV2/, TERMS],
    [/\/classes\/search/, { data: { totalItems: 3, totalPages: 1, courses: FLAGGED } }],
  ]));
}

const numbers = (page) => page.all(".section").map((row) => row.dataset.classNumber);

test("regression #68: hiding permission-only sections takes 1002 off the page and into the URL", async (t) => {
  t.after(serveFlagged());
  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => rows(page) === 3, "the three sections to paint");

  page.el("#f-consent").checked = true;
  fire(page.el("#filters"), "change");

  assert.deepEqual(numbers(page), ["1001", "1003"]);
  assert.match(note(page).textContent, /^1 section hidden by your filters/);
  assert.equal(page.el("#f-clear").hidden, false);
  assert.match(page.location.search, /hideConsent=1/);
});

test("regression #68: only-undergraduate takes the graduate section off the page and into the URL", async (t) => {
  t.after(serveFlagged());
  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => rows(page) === 3, "the three sections to paint");

  page.el("#f-undergrad").checked = true;
  fire(page.el("#filters"), "change");

  assert.deepEqual(numbers(page), ["1001", "1002"]);
  assert.equal(page.el("#f-clear").hidden, false);
  assert.match(page.location.search, /undergradOnly=1/);
});

// The other half of the round trip. A rail that never reads the two keys back
// shows both boxes clear over a page that is filtered anyway, which is the same
// lie #78 fixed for the boxes above them.
test("regression #68: a link carrying both keys comes back with both boxes ticked", async (t) => {
  t.after(serveFlagged());
  const page = await mountApp({
    query: "CSE 2221",
    term: TERM,
    url: "https://enesyilmazcode.github.io/Finder/?hideConsent=1&undergradOnly=1",
  });
  await until(() => rows(page) === 1, "the one section both filters keep");

  assert.equal(page.el("#f-consent").checked, true, "the permission box came back clear over a filtered page");
  assert.equal(page.el("#f-undergrad").checked, true, "the undergraduate box came back clear over a filtered page");
  assert.deepEqual(numbers(page), ["1001"]);
  assert.equal(page.el("#f-clear").hidden, false);
});

// Regression, #63. #f-sort sits outside <form id="filters">, so the only thing
// that puts a link's order back on it is writeFilters naming it. Left out, a
// shared "Earliest start time" link paints in relevance order under a control
// reading Relevance, and the link looks like it worked. The later class number
// starts earlier, so the two orders cannot agree by accident.
const OUT_OF_ORDER = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, MWF, "2:00 PM", "2:55 PM", ["Stephen Gomori"]),
    taught(1002, MWF, "9:00 AM", "9:55 AM", ["Stephen Gomori"]),
  ]),
];

async function sorted(sort) {
  const page = await mountApp({
    query: "CSE 2221",
    term: TERM,
    url: `https://enesyilmazcode.github.io/Finder/?sort=${sort}`,
  });
  await until(() => rows(page) === 2, "both sections to paint");
  return page;
}

test("regression #63: a link's order comes back on the control and on the page", async (t) => {
  t.after(stubFetch(new Map([
    ["data/ratings.json", RATINGS],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [/searchableTermsV2/, TERMS],
    [/\/classes\/search/, { data: { totalItems: 2, totalPages: 1, courses: OUT_OF_ORDER } }],
  ])));

  const start = await sorted("start");
  assert.equal(start.el("#f-sort").value, "start", "the rail claims relevance over a sorted page");
  assert.deepEqual(numbers(start), ["1002", "1001"]);

  // A select set to a value it has no option for shows nothing at all, so an
  // order the app does not offer has to come back as relevance rather than blank.
  const bogus = await sorted("cheapest");
  assert.equal(bogus.el("#f-sort").value, "");
  assert.deepEqual(numbers(bogus), ["1001", "1002"]);
});
