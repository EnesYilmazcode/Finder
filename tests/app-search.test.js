// The app shell's search-state paths, driven through the real index.html on the
// shared harness in dom.js. Every test gets its own mount, so nothing a search
// leaves behind decides the next test's result.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, fire, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATING_COURSES, RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const TR = ["tuesday", "thursday"];
const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(9001, TR, "9:35 AM", "10:55 AM", ["Paolo Bucci"]),
    taught(9002, TR, "11:10 AM", "12:30 PM", ["Steve Gomori"]),
  ]),
];

// The search URL carries a query string that varies with the search, so the
// routes are patterns rather than exact URLs. One of them has to be able to
// fail on demand, which is what the function route is for.
function serve() {
  const state = { searchFails: false };
  const restore = stubFetch([
    [/searchableTermsV2/, { data: { data: [{ strm: "1268", descr: "Autumn 2026" }] } }],
    [/\/classes\/search/, () => (state.searchFails
      ? { ok: false, status: 503, json: async () => ({}) }
      : { data: { totalItems: 1, totalPages: 1, courses: COURSES } })],
    ["data/ratings.json", RATINGS],
    ["data/ratings-courses.json", RATING_COURSES],
    ["data/seats.json", SEATS_INDEX],
    ["data/seats-1268.json", SEATS_TERMS["1268"]],
    ["data/trend-1268.json", { ok: false, status: 404, json: async () => null }],
  ]);
  return { state, restore };
}

async function start(t) {
  const { state, restore } = serve();
  t.after(restore);
  const page = await mountApp();
  await until(() => page.el("#term").options.length > 0, "the term list");

  const codes = () => page.all("#results .course-code").map((n) => n.textContent);
  // Searching disables the button until the request settles, so this is also
  // how a test knows the results on screen belong to the search it just ran.
  const searching = () => page.el("#go").getAttribute("aria-disabled") === "true";
  const search = (text) => {
    page.el("#q").value = text;
    fire(page.el("#search"), "submit");
  };
  return { page, state, codes, searching, search };
}

// Regression, #81. A filter click repaints from the last search, so a search
// that left nothing on screen has to leave nothing to repaint either.
test("regression #81: a failed search is not undone by a filter click", async (t) => {
  const { page, state, codes, searching, search } = await start(t);

  search("CSE 2221");
  await until(() => !searching() && codes().length > 0, "the first results");
  assert.deepEqual(codes(), ["CSE 2221"]);

  state.searchFails = true;
  search("MATH 1151");
  await until(() => page.el("#status").dataset.kind === "error", "the error status");
  assert.deepEqual(codes(), []);

  // Scoped: #62 adds a second .f-day group for busy hours, and an unscoped
  // '.f-day' would then quietly start clicking whichever one is first in the DOM.
  fire(page.el('#f-days .f-day[data-day="tuesday"]'), "click");
  assert.deepEqual(codes(), []);
  assert.equal(page.el("#status").dataset.kind, "error");
});

test("regression #81: an emptied search is not undone by a filter click", async (t) => {
  const { page, codes, searching, search } = await start(t);

  search("CSE 2221");
  await until(() => !searching() && codes().length > 0, "the results");

  search("");
  await until(() => page.el("#welcome").hidden === false, "the welcome screen");
  assert.deepEqual(codes(), []);

  page.el("#f-full").checked = true;
  fire(page.el("#filters"), "change");

  assert.deepEqual(codes(), []);
  assert.equal(page.el("#welcome").hidden, false);
  assert.equal(page.el("#status").textContent, "");

  // The clear button is filter chrome, not part of the result, so it keeps
  // tracking the filters when there is nothing left to repaint.
  assert.equal(page.el("#f-clear").hidden, false);
  page.el("#f-full").checked = false;
  fire(page.el("#filters"), "change");
  assert.equal(page.el("#f-clear").hidden, true);
});

test("regression #81: a failed search clears the detail pane", async (t) => {
  const { page, state, codes, searching, search } = await start(t);

  search("CSE 2221");
  await until(() => !searching() && codes().length > 0, "the results");
  fire(page.el('.section[data-class-number="9001"]'), "click");
  assert.match(page.el("#detail-body").textContent, /Paolo Bucci/);

  state.searchFails = true;
  search("MATH 1151");
  await until(() => page.el("#status").dataset.kind === "error", "the error status");
  assert.match(page.el("#detail-body").textContent, /Pick a section/);
});
