// The harness itself, checked against the real index.html.
//
// Ten branches assert through this file, so a hole in it reads as a green suite
// that tested nothing. Everything below is a piece js/ or one of those suites
// depends on and no single invented shim had.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mountApp, setupDom, fire, until, settle } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const TERM = "1268";
const MWF = ["monday", "wednesday", "friday"];

const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Stephen Gomori"]),
    taught(1002, MWF, "10:20 AM", "11:15 AM", ["Timothy Long"]),
  ]),
];

const TERMS = { data: { data: [{ strm: TERM, descr: "Autumn 2026" }] } };

/** RegExp and predicate keys, since both API calls carry a varying query string. */
function serve() {
  return stubFetch(new Map([
    ["data/ratings.json", RATINGS],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [/searchableTermsV2/, { data: TERMS.data }],
    [(url) => url.includes("/classes/search"), { data: { totalItems: 2, totalPages: 1, courses: COURSES } }],
  ]));
}

const rows = (page) => page.all(".section").map((node) => node.dataset.classNumber);

test("a search driven through the harness renders the sections it fetched", async () => {
  const restore = serve();
  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => rows(page).length > 0, "the first results");

  assert.deepEqual(rows(page), ["1001", "1002"]);
  assert.match(page.el("#status").textContent, /1 course, 2 sections in Autumn 2026/);
  assert.equal(page.el("#welcome").hidden, true);
  restore();
});

test("a second mount starts its own app rather than hitting the import cache", async () => {
  const restore = serve();
  const page = await mountApp({ term: TERM });
  await until(() => page.el("#term").options.length > 0, "the term list");

  page.el("#q").value = "CSE 2221";
  fire(page.el("#search"), "submit");
  await until(() => rows(page).length > 0, "the results of a typed search");

  assert.deepEqual(rows(page), ["1001", "1002"]);
  restore();
});

test("the parser picks the controls up from index.html rather than a list", async () => {
  const page = setupDom();
  assert.equal(page.all("#f-days .f-day").length, 5);
  assert.equal(page.el("#filters").hideFull.checked, false);
  assert.equal(page.el("#term").disabled, true);
  assert.equal(page.el("#welcome").hidden, true);
});

// The reason the harness parses instead of listing. 62, 63, 66 and 68 each add a
// control, and the three shims this file replaced all threw at import the first
// time that happened. Grow the page and nothing here changes.
test("a control index.html does not have yet arrives without a harness edit", async () => {
  const grown = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
    '<div class="f-days" id="f-days"',
    '<select id="f-sort"><option value="">Relevance</option><option value="rating">Rating</option></select>'
    + '<input id="f-busy-add" type="button">'
    + '<select id="p-gen"><option value=""></option></select>'
    + '<input name="hideConsent" type="checkbox" form="filters">'
    + '<div class="f-days" id="f-days"',
  );
  const page = setupDom(grown);

  assert.equal(page.el("#f-sort").tagName, "SELECT");
  assert.equal(page.el("#f-busy-add").type, "button");
  assert.equal(page.el("#p-gen").tagName, "SELECT");
  assert.equal(page.el("#filters").hideConsent.checked, false);

  // and the controls that were already there still resolve
  assert.equal(page.all("#f-days .f-day").length, 5);
});

test("the descendant combinator scopes a repeated class to its own group", () => {
  const page = setupDom(`<body>
    <div id="f-days"><button class="f-day" data-day="monday"></button></div>
    <div id="f-busy-days"><button class="f-day" data-day="monday"></button></div>
  </body>`);

  assert.equal(page.all(".f-day").length, 2);
  assert.equal(page.all("#f-days .f-day").length, 1);
  assert.equal(page.all("#f-days > .f-day").length, 1);
  assert.equal(page.all('#f-busy-days .f-day[data-day="monday"]').length, 1);
  assert.throws(() => page.all("#f-days + .f-day"), /unsupported selector/);
});

test("a moved node leaves its old parent", () => {
  const page = setupDom();
  const row = page.document.createElement("div");
  page.el("#results").append(row);
  page.el("#detail-body").append(row);

  assert.equal(page.el("#results").childNodes.length, 0);
  assert.equal(row.parentNode, page.el("#detail-body"));

  row.remove();
  assert.equal(row.parentNode, null);
  assert.deepEqual(page.el("#detail-body").children.map((n) => n.className), ["detail-idle"]);
});

test("click() reaches a delegated handler through the tree", () => {
  const page = setupDom();
  const seen = [];
  page.el("#results").addEventListener("click", (event) => seen.push(event.target.className));

  const button = page.document.createElement("button");
  button.className = "show-anyway";
  page.el("#results").append(button);
  button.click();

  assert.deepEqual(seen, ["show-anyway"]);
});

test("a submit button and Enter both reach the form", () => {
  const page = setupDom();
  const seen = [];
  page.body.addEventListener("submit", (event) => { event.preventDefault(); seen.push(event.target.id); });

  fire(page.el("#go"), "click");
  page.el("#go").click();
  fire(page.el("#q"), "keydown", { key: "Enter" });

  assert.deepEqual(seen, ["search", "search", "search"]);
});

test("a plain button, another key and a cancelled click leave the form alone", () => {
  const page = setupDom();
  const seen = [];
  page.body.addEventListener("submit", (event) => seen.push(event.target.id));
  page.el("#go").addEventListener("click", (event) => event.preventDefault());

  fire(page.el("#f-clear"), "click");
  fire(page.el("#q"), "keydown", { key: "Escape" });
  fire(page.el("#go"), "click");

  assert.deepEqual(seen, []);
});

test("history.replaceState resolves against the page URL", async () => {
  const restore = serve();
  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => rows(page).length > 0, "the results");

  page.el("#filters").hideFull.checked = true;
  fire(page.el("#filters"), "change");

  assert.match(page.location.search, /hideFull=1/);
  assert.match(page.location.href, /^https:\/\/enesyilmazcode\.github\.io\/Finder\//);
  assert.deepEqual(
    [...new URLSearchParams(page.location.search)].filter(([key]) => key !== "hideFull"),
    [["q", "CSE 2221"], ["term", TERM]]
  );
  restore();
});

test("window.addEventListener exists and dispatches", () => {
  const page = setupDom();
  const seen = [];
  page.window.addEventListener("popstate", () => seen.push(page.location.search));

  page.history.pushState(null, "", "?q=MATH+1151");
  page.history.back();

  assert.deepEqual(seen, [""]);
  assert.equal(page.location.search, "");
});

test("dataset writes are visible to an attribute selector", () => {
  const page = setupDom();
  const chip = page.document.createElement("span");
  chip.className = "flag";
  chip.dataset.flag = "consent";
  page.el("#results").append(chip);

  assert.deepEqual(page.all('.flag[data-flag="consent"]'), [chip]);
  assert.equal(chip.getAttribute("data-flag"), "consent");
});

test("until names what it waited for, and refuses 89's argument order", async () => {
  await assert.rejects(
    () => until(() => false, "the term list", 2),
    /timed out waiting for the term list/
  );
  await assert.rejects(() => until(() => false, 100), /needs a label/);
});

test("settle drains without asserting anything arrived", async () => {
  let ran = false;
  setTimeout(() => { ran = true; }, 0);
  await settle(2);
  assert.equal(ran, true);
});

test("stubFetch keeps exact keys ahead of the patterns", async () => {
  const restore = stubFetch(new Map([
    [/seats/, { which: "pattern" }],
    ["data/seats.json", { which: "exact" }],
    [(url) => url.endsWith("page"), (url) => ({ url })],
  ]));

  assert.deepEqual(await (await fetch("data/seats.json")).json(), { which: "exact" });
  assert.deepEqual(await (await fetch("data/seats-1268.json")).json(), { which: "pattern" });
  assert.deepEqual(await (await fetch("a/page")).json(), { url: "a/page" });
  await assert.rejects(() => fetch("nothing"), /unexpected fetch: nothing/);
  restore();
});
