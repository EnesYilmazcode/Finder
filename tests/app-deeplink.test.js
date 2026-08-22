// #64 through the page. tests/deeplink.test.js pins the pure rules; this is what
// a student following a shared link actually gets: the section opens, a section
// the filters hid is offered back, and Back closes the pane.
//
// Nothing else in the suite loads js/render.js's related-courses branch or the
// popstate listener, so both are only measured here.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, until, settle } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATING_COURSES, RATINGS, SEATS_INDEX, SEATS_TERMS, entry, onlineMeeting, person, section, taught } from "./fixtures.js";

const TERM = "1268";
const PAGE = "https://enesyilmazcode.github.io/Finder/";
const MWF = ["monday", "wednesday", "friday"];

// 1002 is online, so "Hide online sections" is the filter that removes it.
// 2001 belongs to a course the search demotes to related, which is the only way
// to reach a row inside the folded <details>.
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

const selected = (page) => page.el(".section.is-selected");
const linkNote = (page) => page.el(".link-note");

/** A page that has followed a shared link and finished its search. */
async function followed(url, { rows = 2 } = {}) {
  const page = await mountApp({ query: "CSE 2221", term: TERM, url });
  await until(() => page.all(".section").length >= rows, "the search to paint");
  await settle(2); // openLinked runs inside the same paint, so nothing else to wait on
  return page;
}

test("a shared link opens the section it names", async () => {
  const restore = serve();
  const page = await followed(`${PAGE}?class=1002`);

  assert.equal(selected(page)?.dataset.classNumber, "1002", "the link did not select its section");
  assert.match(page.el("#detail-body").textContent, /Section 1002/);
  assert.equal(linkNote(page), null, "the link landed and still explained itself");
  assert.match(page.location.search, /class=1002/, "the open pane stopped naming its section");
  restore();
});

// The related list is built on first open, so a link into it has to force the
// build rather than only setting `open`. Taking integration's side of that hunk
// in js/render.js leaves openRelated destructured and unused, and the link falls
// through to "not in these results" with the row on the page all along.
test("a shared link into a related course opens the folded list", async () => {
  const restore = serve();
  const page = await followed(`${PAGE}?class=2001`);

  assert.equal(page.el("details.related")?.open, true, "the related list stayed folded");
  assert.equal(selected(page)?.dataset.classNumber, "2001", "the row inside it was never built");
  assert.doesNotMatch(page.el("#status").textContent, /not in these results/);
  restore();
});

test("a section the filters hid is offered back, and the offer clears the filters", async () => {
  const restore = serve();
  const page = await followed(`${PAGE}?class=1002&hideOnline=1`, { rows: 1 });

  assert.equal(page.el("#f-online").checked, true);
  assert.equal(selected(page), null, "a hidden section was selected anyway");
  assert.match(linkNote(page).textContent, /^Section 1002 is hidden by your filters\./);
  assert.match(page.el("#status").textContent, /Section 1002 is hidden by your filters\./);

  linkNote(page).querySelector("button").click();

  assert.equal(page.el("#f-online").checked, false, "the offer overrode the filter instead of clearing it");
  assert.equal(selected(page)?.dataset.classNumber, "1002");
  assert.equal(page.el("#f-clear").hidden, true, "the rail still claims a filter is on");
  restore();
});

// Regression, #64 with #78. The popstate handler used to reset the deleted
// `showHidden`, which is a ReferenceError under module strict mode: Back threw
// before it closed anything, and looked dead.
test("regression #64: browser Back closes the pane rather than throwing", async () => {
  const restore = serve();
  const page = await followed(`${PAGE}`);

  page.el('[data-class-number="1001"]').click();
  assert.equal(selected(page)?.dataset.classNumber, "1001");
  assert.match(page.location.search, /class=1001/);

  page.history.back();

  assert.equal(selected(page), null, "Back left the section selected");
  assert.equal(page.el("#detail-body").textContent.includes("Section 1001"), false, "Back left the pane open");
  assert.doesNotMatch(page.location.search, /class=/);
  restore();
});

// node:test ships a navigator with no clipboard, so js/detail.js draws no copy
// button at all and a suite that never defines one measures nothing.
test("the class number is copyable where the browser has a clipboard", async (t) => {
  const copied = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (text) => { copied.push(text); } } },
  });
  t.after(() => Object.defineProperty(globalThis, "navigator", original));

  const restore = serve();
  const page = await followed(`${PAGE}?class=1001`);

  const copy = page.el(".d-act");
  assert.equal(copy?.textContent, "Copy number");
  copy.click();
  await until(() => copied.length === 1, "the class number to reach the clipboard");
  assert.deepEqual(copied, ["1001"]);
  restore();
});
