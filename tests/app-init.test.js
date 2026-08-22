// #80: init() registers the search handlers before it waits on the term list,
// and a search asked for in that window is held and replayed once the list
// lands, rather than eaten by the browser.
//
// Everything here is behaviour through the page. init() is rewritten by four
// other branches in this train, so asserting on where its listeners sit in the
// source text is a regex racing eighteen merges; what actually has to hold is
// what a student can do while the cross-origin terms request is in flight.

import test from "node:test";
import assert from "node:assert/strict";

import { fire, mountApp, settle, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const TERMS = "/classes/searchableTermsV2";
const SEARCH = /\/classes\/search\?/;

const TERM_LIST = { data: { data: [{ strm: 1268, descr: "Autumn 2026" }] } };
const HELD = "Still loading terms. Your search will run when they arrive.";

const results = (subject, number, title) => ({
  data: {
    totalItems: 1,
    totalPages: 1,
    courses: [entry(subject, number, title, [taught(1001, ["monday"], "10:20", "11:15", ["Tim Long"])])],
  },
});

/** A request the test opens and closes by hand. */
function gate() {
  // A route answering with a pending promise is a request still in flight:
  // stubFetch hands the body to response.json(), so js/api.js suspends there.
  let release;
  const body = new Promise((resolve) => { release = resolve; });
  return { body, release };
}

const SNAPSHOTS = [
  ["data/ratings.json", RATINGS],
  ["data/seats.json", SEATS_INDEX],
  ["data/seats-1268.json", SEATS_TERMS["1268"]],
];

function serve({ terms = TERM_LIST, search = results("CSE", "2221", "Software I") } = {}) {
  return stubFetch([...SNAPSHOTS, [(url) => url.includes(TERMS), terms], [SEARCH, search]]);
}

const status = (page) => page.el("#status").textContent;
const loading = (page) => until(() => status(page) === "Loading terms...", "init to reach the terms request");

test("a search submitted before the terms arrive is held rather than eaten by the browser", async (t) => {
  const terms = gate();
  t.after(serve({ terms: terms.body }));
  const page = await mountApp();
  await loading(page);

  page.el("#q").value = "CSE 2221";
  const submitted = fire(page.el("#search"), "submit");

  assert.equal(submitted.defaultPrevented, true, "Enter fell through to the browser, which navigates away and loses the query");
  assert.equal(status(page), HELD, "the refused search said nothing");
  assert.match(page.location.search, /q=CSE\+2221/, "the query never reached the URL");

  terms.release(TERM_LIST);
  await until(() => page.all(".section").length > 0, "the held search to run once the terms land");
  assert.match(status(page), /1 course, 1 sections in Autumn 2026/);
  assert.equal(page.el("#term").value, "1268", "the term list never filled the picker");
});

test("a shared link's query is in the box before the terms request answers", async (t) => {
  const terms = gate();
  t.after(serve({ terms: terms.body }));
  const page = await mountApp({ query: "CSE 2221" });
  await loading(page);

  assert.equal(page.el("#q").value, "CSE 2221", "?q= only reaches the box after the terms request");
  assert.equal(page.el("#p-subject").value, "CSE", "the pickers only reflect the query after the terms request");
  assert.equal(page.el("#p-number").value, "2221");

  terms.release(TERM_LIST);
  await until(() => page.all(".section").length > 0, "the shared link's search to run");
});

test("a query typed over a shared link's is the one that runs when the terms land", async (t) => {
  const terms = gate();
  t.after(serve({ terms: terms.body, search: results("MATH", "1151", "Calculus I") }));
  const page = await mountApp({ query: "CSE 2221" });
  await loading(page);

  page.el("#q").value = "MATH 1151";
  fire(page.el("#search"), "submit");
  assert.equal(status(page), HELD);

  terms.release(TERM_LIST);
  await until(() => page.all(".course").length > 0, "the typed search to run");
  assert.match(page.el("#results").textContent, /MATH\s*1151/, "the shared link's query ran instead of the typed one");
});

test("Enter stays on the page and says why when the term list fails", async (t) => {
  t.after(serve({ terms: { ok: false, status: 503 } }));
  const page = await mountApp();
  await until(() => /503/.test(status(page)), "the terms request to fail");

  page.el("#q").value = "CSE 2221";
  const submitted = fire(page.el("#search"), "submit");

  assert.equal(submitted.defaultPrevented, true, "Enter fell through to the browser once the term list failed");
  assert.match(status(page), /503/, "the search left the reason it cannot run unsaid");
  assert.equal(page.el("#status").dataset.kind, "error");
});

test("the search runs against the term the list settled on, not the empty one", async (t) => {
  const terms = gate();
  const asked = [];
  t.after(stubFetch([
    ...SNAPSHOTS,
    [(url) => url.includes(TERMS), terms.body],
    [SEARCH, (url) => { asked.push(url); return results("CSE", "2221", "Software I"); }],
  ]));
  const page = await mountApp();
  await loading(page);

  page.el("#q").value = "CSE 2221";
  fire(page.el("#search"), "submit");
  await settle(2); // the refusal is synchronous, so any request at all is one too many
  assert.deepEqual(asked, [], "the search ran with no term at all");

  terms.release(TERM_LIST);
  await until(() => asked.length > 0, "the held search to reach the API");
  assert.ok(asked.every((url) => url.includes("term=1268")), `searched without the term: ${asked[0]}`);
});
