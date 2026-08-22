// Regression, #86. Collapsed to one column the detail pane covers the results
// and the status line, so anything that replaces what is on screen has to hand
// the column back. Neither of the two paths below reaches the one place that
// already did it, showDetail's counterpart in clearSelection.

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

function serve() {
  return stubFetch([
    [/searchableTermsV2/, { data: { data: [{ strm: "1268", descr: "Autumn 2026" }] } }],
    [/\/classes\/search/, { data: { totalItems: 1, totalPages: 1, courses: COURSES } }],
    ["data/ratings.json", RATINGS],
    ["data/ratings-courses.json", RATING_COURSES],
    ["data/seats.json", SEATS_INDEX],
    ["data/seats-1268.json", SEATS_TERMS["1268"]],
    ["data/trend-1268.json", { ok: false, status: 404, json: async () => null }],
  ]);
}

/** A narrow screen with a section open, which is the only state the bug shows in. */
async function onSection(t) {
  t.after(serve());
  const page = await mountApp();
  await until(() => page.el("#term").options.length > 0, "the term list");
  // The same object app.js holds, so flipping it here is what a phone is.
  page.window.matchMedia("(max-width: 64rem)").matches = true;

  const view = () => page.el(".app").dataset.view;
  const codes = () => page.all("#results .course-code").map((n) => n.textContent);
  const searching = () => page.el("#go").getAttribute("aria-disabled") === "true";
  const search = (text) => {
    page.el("#q").value = text;
    fire(page.el("#search"), "submit");
  };

  search("CSE 2221");
  await until(() => !searching() && codes().length > 0, "the results");
  fire(page.el('.section[data-class-number="9001"]'), "click");
  assert.equal(view(), "detail");
  assert.match(page.el("#detail-body").textContent, /Paolo Bucci/);

  return { page, view, codes, searching, search };
}

test("regression #86: a repaint that empties the detail pane leaves the detail view", async (t) => {
  const { page, view, codes } = await onSection(t);

  // A filter click repaints, and the repaint resets the pane the phone is
  // looking at. Sections meet Tuesday, so the rows survive it.
  fire(page.el('#f-days .f-day[data-day="tuesday"]'), "click");

  assert.match(page.el("#detail-body").textContent, /Pick a section/);
  assert.deepEqual(codes(), ["CSE 2221"]);
  assert.equal(view(), "results");
});

test("regression #86: emptying the query leaves the detail view", async (t) => {
  const { page, view, codes, search } = await onSection(t);

  // The welcome branch of runSearch returns before paint(), so this is the
  // other half of the fix rather than the same line twice.
  search("");
  await until(() => page.el("#welcome").hidden === false, "the welcome screen");

  assert.deepEqual(codes(), []);
  assert.equal(view(), "results");
});
