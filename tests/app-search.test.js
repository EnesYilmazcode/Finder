// The app shell's search-state paths, driven through the real index.html on the
// shared harness in dom.js. Every test gets its own mount, so nothing a search
// leaves behind decides the next test's result.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, fire, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATING_COURSES, RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught, HEADSHOTS } from "./fixtures.js";

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
  const state = { searchFails: false, lostPage: false, asked: [] };
  const restore = stubFetch([
    [/searchableTermsV2/, { data: { data: [{ strm: "1268", descr: "Autumn 2026" }] } }],
    [/\/classes\/search/, (url) => {
      state.asked.push(new URL(url).searchParams.get("q"));
      if (state.searchFails) return { ok: false, status: 503, json: async () => ({}) };
      // A second page that 503s while the first answers, the way a rate limit
      // lands partway through a multi-page pull.
      if (!state.lostPage) return { data: { totalItems: 1, totalPages: 1, courses: COURSES } };
      if (new URL(url).searchParams.get("p") === "2") return { ok: false, status: 503, json: async () => ({}) };
      return { data: { totalItems: 3, totalPages: 2, courses: COURSES } };
    }],
    ["data/ratings.json", RATINGS],
    ["data/ratings-courses.json", RATING_COURSES],
    ["data/headshots.json", HEADSHOTS],
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

test("a result page Ohio State drops is named and offered back, not blamed on the query", async (t) => {
  const { page, state, searching, search } = await start(t);
  state.lostPage = true;
  search("CSE 2221");
  await until(() => !searching() && /did not return/.test(page.el("#status").textContent), "the lost page note");

  const status = page.el("#status").textContent;
  assert.match(status, /Ohio State did not return 1 of 2 result pages/);
  assert.doesNotMatch(status, /Narrow the search/, "narrowing cannot bring back a page that failed");
  const retry = page.el(".retry-note button");
  assert.equal(retry?.textContent, "Try again");

  state.lostPage = false;
  retry.click();
  await until(() => !searching() && !/did not return/.test(page.el("#status").textContent), "the retried search");
  assert.equal(page.el(".retry-note"), null, "the retry offer outlived the pages coming back");
  assert.ok(page.all("#results .section").length > 0, "the retried search left nothing on screen");
});

// Every search used to replace the one history entry, so Back left the site
// after a few searches. A search now gets its own entry, and Back runs the one
// before it again.
test("Back returns to the search before, and runs it again", async (t) => {
  const { page, searching, search, state } = await start(t);
  search("CSE 2221");
  await until(() => !searching() && page.all("#results .section").length > 0, "the first search");
  const entries = page.history.length;

  search("Bucci");
  await until(() => !searching() && /q=Bucci/.test(page.location.search), "the second search");
  assert.equal(page.history.length, entries + 1, "the second search took no history entry of its own");

  const asked = state.asked.length;
  page.history.back();
  await until(() => !searching() && page.el("#q").value === "CSE 2221", "Back to restore the first query");
  await until(() => state.asked.length > asked, "the first search to run again");
  assert.match(page.location.search, /q=CSE\+2221/);
  assert.equal(state.asked.at(-1), "2221", "Back ran some other search");
});

test("running the same search again takes no new history entry", async (t) => {
  const { page, searching, search } = await start(t);
  search("CSE 2221");
  await until(() => !searching() && page.all("#results .section").length > 0, "the first search");
  const entries = page.history.length;

  search("CSE 2221");
  await until(() => !searching(), "the repeat");
  assert.equal(page.history.length, entries);
});

test("a filter changes the entry it belongs to rather than adding one", async (t) => {
  const { page, searching, search, state } = await start(t);
  search("CSE 2221");
  await until(() => !searching() && page.all("#results .section").length > 0, "the search");
  const entries = page.history.length;
  const asked = state.asked.length;

  page.el("#filters").hideFull.checked = true;
  fire(page.el("#filters"), "change");
  assert.equal(page.history.length, entries, "a filter click became a place to go Back to");
  assert.match(page.location.search, /hideFull=1/);
  assert.equal(state.asked.length, asked, "a filter click fetched again");
});

test("Back from an open section closes it without searching again", async (t) => {
  const { page, searching, search, state } = await start(t);
  search("CSE 2221");
  await until(() => !searching() && page.all("#results .section").length > 0, "the search");
  const asked = state.asked.length;

  page.el('#results .section[data-class-number="9001"]').click();
  assert.match(page.location.search, /class=9001/);
  page.history.back();
  assert.doesNotMatch(page.location.search, /class=/);
  assert.equal(page.el("#results .is-selected"), null);
  assert.equal(state.asked.length, asked, "closing the pane ran the search again");
});

// The landing screen is an entry too. Back to it and Forward again has to run
// the search, not repaint a result the landing screen already cleared.
test("Forward from the landing screen runs the search it left", async (t) => {
  const { page, searching, search } = await start(t);
  search("CSE 2221");
  await until(() => !searching() && page.all("#results .section").length > 0, "the search");

  page.history.back();
  await until(() => page.el("#q").value === "" && !page.el("#welcome").hidden, "Back to the landing screen");
  page.history.forward();
  await until(() => !searching() && page.el("#q").value === "CSE 2221" && page.all("#results .section").length > 0,
    "Forward to run the search again");
  assert.equal(page.el("#welcome").hidden, true);
});
