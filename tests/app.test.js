// The app shell, driven through the real index.html on the stub document in
// dom.js. Only the search-state paths are covered here.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { setupDom, fire, until } from "./dom.js";
import { entry, taught } from "./fixtures.js";

const dom = setupDom(new URL("../index.html", import.meta.url));

const TR = ["tuesday", "thursday"];
const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(9001, TR, "9:35 AM", "10:55 AM", ["Paolo Bucci"]),
    taught(9002, TR, "11:10 AM", "12:30 PM", ["Steve Gomori"]),
  ]),
];

let searchFails = false;
const ok = (data) => ({ ok: true, status: 200, json: async () => data });

// stubFetch from helpers.js matches a whole URL and only ever answers ok. These
// routes have to match the query strings api.js builds, and one has to fail.
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("searchableTermsV2")) return ok({ data: { data: [{ strm: "1268", descr: "Autumn 2026" }] } });
  if (url.includes("/classes/search")) {
    if (searchFails) return { ok: false, status: 503, json: async () => ({}) };
    return ok({ data: { totalItems: 1, totalPages: 1, courses: COURSES } });
  }
  if (url.endsWith("data/ratings.json")) return ok({ professors: [] });
  if (url.endsWith("data/seats.json")) return ok({ terms: [] });
  throw new Error(`unexpected fetch: ${url}`);
};

await import("../js/app.js");
await until(() => dom.el("#term").options.length > 0, "the term list");

const codes = () => dom.el("#results").querySelectorAll(".course-code").map((n) => n.textContent);
// Searching disables the button until the request settles, so this is also how
// a test knows the results on screen belong to the search it just ran.
const searching = () => dom.el("#go").getAttribute("aria-disabled") === "true";

function search(text) {
  dom.el("#q").value = text;
  fire(dom.el("#search"), "submit");
}

// Filters and the fetch stub live in the page and the module, not in a test, so
// a test that leaves either one set would decide the next one's result.
beforeEach(() => {
  searchFails = false;
  fire(dom.el("#f-clear"), "click");
});

// Regression, #81. A filter click repaints from the last search, so a search
// that left nothing on screen has to leave nothing to repaint either.
test("regression #81: a failed search is not undone by a filter click", async () => {
  search("CSE 2221");
  await until(() => !searching() && codes().length > 0, "the first results");
  assert.deepEqual(codes(), ["CSE 2221"]);

  searchFails = true;
  search("MATH 1151");
  await until(() => dom.el("#status").dataset.kind === "error", "the error status");
  assert.deepEqual(codes(), []);

  fire(dom.el('.f-day[data-day="tuesday"]'), "click");
  assert.deepEqual(codes(), []);
  assert.equal(dom.el("#status").dataset.kind, "error");
});

test("regression #81: an emptied search is not undone by a filter click", async () => {
  search("CSE 2221");
  await until(() => !searching() && codes().length > 0, "the results");

  search("");
  await until(() => dom.el("#welcome").hidden === false, "the welcome screen");
  assert.deepEqual(codes(), []);

  dom.el("#f-full").checked = true;
  fire(dom.el("#filters"), "change");

  assert.deepEqual(codes(), []);
  assert.equal(dom.el("#welcome").hidden, false);
  assert.equal(dom.el("#status").textContent, "");

  // The clear button is filter chrome, not part of the result, so it keeps
  // tracking the filters when there is nothing left to repaint.
  assert.equal(dom.el("#f-clear").hidden, false);
  dom.el("#f-full").checked = false;
  fire(dom.el("#filters"), "change");
  assert.equal(dom.el("#f-clear").hidden, true);
});

test("regression #81: a failed search clears the detail pane", async () => {
  search("CSE 2221");
  await until(() => !searching() && codes().length > 0, "the results");
  fire(dom.el('.section[data-class-number="9001"]'), "click");
  assert.match(dom.el("#detail-body").textContent, /Paolo Bucci/);

  searchFails = true;
  search("MATH 1151");
  await until(() => dom.el("#status").dataset.kind === "error", "the error status");
  assert.match(dom.el("#detail-body").textContent, /Pick a section/);
});
