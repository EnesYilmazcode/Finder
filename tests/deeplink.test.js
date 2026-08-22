import test from "node:test";
import assert from "node:assert/strict";

import { classFromParams, setClassParam, sameSearch, hasSection, missOutcome } from "../js/deeplink.js";
import { entry, section } from "./fixtures.js";

const params = (search) => new URLSearchParams(search);
const url = (search) => new URL(`https://enesyilmazcode.github.io/Finder/${search}`);

test("a link naming a section gives up its class number", () => {
  assert.equal(classFromParams(params("?q=CSE+2221&term=1268&class=5168")), "5168");
});

test("a link naming no section gives up nothing", () => {
  assert.equal(classFromParams(params("?q=CSE+2221&term=1268")), "");
  assert.equal(classFromParams(params("?class=")), "");
});

// The number is quoted back into the page when it is not on screen, so anything
// that is not a class number has to stop here.
test("anything that is not a class number is ignored", () => {
  for (const junk of ["<script>alert(1)</script>", "abc", "51 68", "5168x", "-5168"]) {
    assert.equal(classFromParams(params(`?class=${encodeURIComponent(junk)}`)), "", junk);
  }
});

test("writing a section puts it on the URL", () => {
  assert.equal(
    setClassParam(url("?q=CSE+2221&term=1268"), "5168").search,
    "?q=CSE+2221&term=1268&class=5168"
  );
});

test("the number survives a round trip through the URL", () => {
  const written = setClassParam(url("?q=CSE+2221"), 5168);
  assert.equal(classFromParams(written.searchParams), "5168");
});

test("no section means the param goes away rather than sitting there empty", () => {
  assert.equal(setClassParam(url("?q=CSE+2221&class=5168"), "").search, "?q=CSE+2221");
  assert.equal(setClassParam(url("?q=CSE+2221&class=5168"), null).search, "?q=CSE+2221");
});

// The filters are in the URL too, and two of them are repeated keys. Every new
// search clears the section through here, so clearing has to leave them alone.
test("writing or clearing the section leaves the rest of the link alone", () => {
  const search = "?q=CSE+2221&term=1268&day=monday&day=friday&noday=tuesday&rating=4";
  for (const [wanted, expected] of [["5168", "5168"], ["", null]]) {
    const written = setClassParam(url(`${search}&class=5169`), wanted);
    assert.deepEqual(written.searchParams.getAll("day"), ["monday", "friday"]);
    assert.deepEqual(written.searchParams.getAll("noday"), ["tuesday"]);
    assert.equal(written.searchParams.get("rating"), "4");
    assert.equal(written.searchParams.get("class"), expected);
  }
});

// The API 429s and times out, so a shared link has to survive the retry that
// follows. Anything else the student searches for is a different question and
// the section they were sent goes with the old answer.
test("a retry is the same search, another query is not", () => {
  const here = url("?q=CSE+2221&term=1268&class=5168");
  assert.equal(sameSearch(here, "CSE 2221", "1268"), true);
  assert.equal(sameSearch(here, "CSE 2231", "1268"), false);
  assert.equal(sameSearch(here, "CSE 2221", "1264"), false);
});

test("a link with no term rides on the term the page picked", () => {
  assert.equal(sameSearch(url("?q=CSE+2221&class=5168"), "CSE 2221", "1268"), true);
});

const results = () => [
  entry("CSE", "2221", "Software I", [section(5168), section(5169)]),
  entry("CSE", "2231", "Software II", [section(5170)]),
];

test("a class number is found wherever it sits in the results", () => {
  assert.equal(hasSection(results(), "5168"), true);
  assert.equal(hasSection(results(), 5170), true);
  assert.equal(hasSection(results(), "9999"), false);
  assert.equal(hasSection([], "5168"), false);
});

// Three different problems, and the fix for a section the grid leaves out is
// not the fix for one the filters removed. Telling them apart is the whole
// reason the DOM is not asked whether the section is there.
test("the three ways a link can miss are told apart", () => {
  const grid = missOutcome("5168", { inResults: true, inSearch: true });
  const filtered = missOutcome("5168", { inResults: false, inSearch: true });
  const gone = missOutcome("5168", { inResults: false, inSearch: false });

  assert.equal(grid.offer, "list");
  assert.equal(filtered.offer, "filters");
  assert.equal(gone.offer, "");
  for (const { message } of [grid, filtered, gone]) assert.match(message, /5168/);
  assert.match(filtered.message, /filters/);
});
