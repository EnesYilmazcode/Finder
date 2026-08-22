// Regression, #74. Five controls on this page delete themselves when they are
// used, and focus goes to the body when a focused node leaves the document: a
// keyboard user lands past the rail at the end of the page and has to tab back
// through every filter. Each of the five is exercised here, because the bug is
// per control and a shared helper covers nothing it is not called from.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, until, settle } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATING_COURSES, RATINGS, SEATS_INDEX, SEATS_TERMS, entry, onlineMeeting, person, section, taught } from "./fixtures.js";

const TERM = "1268";
const PAGE = "https://enesyilmazcode.github.io/Finder/";
const MWF = ["monday", "wednesday", "friday"];

// 1002 is online, so "Hide online sections" is what removes it and brings up
// both notes. CSE 2231 is demoted to related, which is what the calendar's own
// note is about.
const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Stephen Gomori"]),
    section(1002, { meetings: [onlineMeeting(["tuesday"], "1:00 PM", "1:55 PM", [person("Timothy Long")])] }),
  ]),
  entry("CSE", "2231", "Software 2", [
    taught(2001, MWF, "11:10 AM", "12:05 PM", ["Stephen Gomori"]),
  ]),
];

const TERMS = { data: { data: [{ strm: TERM, descr: "Autumn 2026", startDate: "2026-08-25", endDate: "2026-12-16" }] } };

function serve() {
  return stubFetch(new Map([
    ["data/ratings.json", RATINGS],
    ["data/ratings-courses.json", RATING_COURSES],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [`data/trend-${TERM}.json`, { ok: false, status: 404, json: async () => null }],
    [/searchableTermsV2/, TERMS],
    [/\/classes\/search/, { data: { totalItems: 2, totalPages: 1, courses: COURSES } }],
  ]));
}

// The id of whatever holds focus, so a failure names the node instead of
// printing the whole element.
const focus = (page) => page.document.activeElement.id || page.document.activeElement.tagName;

/** A page that has run its search and painted. */
async function searched(url, { rows = 2 } = {}) {
  const page = await mountApp({ query: "CSE 2221", term: TERM, url });
  await until(() => page.all(".section").length >= rows, "the search to paint");
  await settle(2); // openLinked runs inside that same paint
  return page;
}

test("the clear button hands focus on before it hides itself", async (t) => {
  t.after(serve());
  const page = await searched(`${PAGE}?hideOnline=1`, { rows: 1 });
  assert.equal(page.el("#f-clear").hidden, false);

  page.el("#f-clear").click();

  assert.equal(page.el("#f-clear").hidden, true, "the button is still on screen, so nothing was lost");
  assert.equal(focus(page), "results");
});

test("the filters note's button hands focus on before the repaint deletes it", async (t) => {
  t.after(serve());
  const page = await searched(`${PAGE}?hideOnline=1`, { rows: 1 });

  const button = page.el(".hidden-note button");
  assert.equal(button.textContent, "Show them anyway");
  button.click();

  assert.equal(page.all(".section").length, 2, "the hidden section did not come back");
  assert.equal(focus(page), "results");
});

test("the calendar's related-courses button hands focus on", async (t) => {
  t.after(serve());
  const page = await searched(PAGE);

  page.el("#view-cal").click();
  const button = page.el(".hidden-note button");
  assert.equal(button.textContent, "See them in list view");
  button.click();

  assert.equal(page.el("#view-list").getAttribute("aria-pressed"), "true");
  assert.equal(focus(page), "results");
});

// The fifth control, and the one that shipped after #74 was written. It sits in
// a paragraph its own handler replaces, exactly like the other four.
test("regression #74: the shared link's offer hands focus on", async (t) => {
  t.after(serve());
  const page = await searched(`${PAGE}?class=1002&hideOnline=1`, { rows: 1 });

  const button = page.el(".link-note button");
  assert.equal(button.textContent, "Show it anyway");
  button.click();

  assert.equal(page.el(".section.is-selected")?.dataset.classNumber, "1002");
  assert.equal(focus(page), "results");
});

// Collapsed the results column is not on screen, so handing focus to it is the
// same loss by another route. The pane the link just opened takes it instead.
test("regression #74: collapsed, the offer leaves focus on the pane it opened", async (t) => {
  t.after(serve());
  const page = await searched(`${PAGE}?class=1002&hideOnline=1`, { rows: 1 });
  // The object app.js holds, so flipping it here is what a phone is.
  page.window.matchMedia("(max-width: 64rem)").matches = true;

  page.el(".link-note button").click();

  assert.equal(page.el(".app").dataset.view, "detail");
  assert.equal(focus(page), "detail");
});

test("a welcome example hands focus on before the welcome screen goes", async (t) => {
  t.after(serve());
  const page = await mountApp({ term: TERM, url: PAGE });
  await until(() => page.el("#welcome").hidden === false, "the welcome screen");
  // init fills the landing screen twice on purpose, at the end of init, and
  // neither fill is superseded by a later search: clicking between them un-hides
  // the welcome screen over the results. A separate bug, not this one, so let
  // both land first.
  await settle(5);

  page.el(".w-example").click();
  await until(() => page.all(".section").length > 0, "the results");

  assert.equal(page.el("#welcome").hidden, true, "the button is still on screen, so nothing was lost");
  assert.equal(focus(page), "results");
});
