// #76 through the page: what the subject dropdown puts on the wire, and what a
// re-run does with it. The api.test.js block covers searchAllPages on its own;
// this covers the half that decides what it gets called with, which is the half
// a later branch adding a re-run trigger can quietly drop.

import test from "node:test";
import assert from "node:assert/strict";

import { fire, mountApp, settle, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const SEARCH = /\/classes\/search\?/;
const TERM_LIST = { data: { data: [{ strm: 1268, descr: "Autumn 2026" }, { strm: 1262, descr: "Spring 2026" }] } };
const COURSE_INDEX = {
  built: "2026-08-18",
  terms: {
    1268: { subjects: [{ code: "MATH", name: "Mathematics", courses: [["1151", "Calculus I", 5, 5]] }] },
    1262: { subjects: [{ code: "MATH", name: "Mathematics", courses: [["1151", "Calculus I", 5, 5]] }] },
  },
};
const RESULT = {
  data: {
    totalItems: 1,
    totalPages: 1,
    courses: [entry("MATH", "1151", "Calculus I", [taught(1001, ["monday"], "10:20 AM", "11:15 AM", ["Tim Long"])])],
  },
};

/** Mounts a page whose subject picker is ready, and records what it asks for. */
async function picked(t) {
  const asked = [];
  t.after(stubFetch([
    ["data/ratings.json", RATINGS],
    ["data/seats.json", SEATS_INDEX],
    ["data/seats-1268.json", SEATS_TERMS["1268"]],
    ["data/seats-1262.json", SEATS_TERMS["1262"]],
    ["data/courses.json", COURSE_INDEX],
    [(url) => url.includes("searchableTermsV2"), TERM_LIST],
    [SEARCH, (url) => { asked.push(url); return RESULT; }],
  ]));
  const page = await mountApp();
  await until(() => page.el("#term").value === "1268", "the term list to fill the picker");

  fire(page.el("#p-subject"), "focus");
  await settle(4); // the course index is lazy, so the first focus fetches it
  page.el("#p-subject").value = "MATH";
  fire(page.el("#p-subject"), "input");
  await until(() => asked.length > 0, "the picked subject to reach the API");
  return { page, asked };
}

test("regression #76: a picked subject is scoped upstream, not matched as text", async (t) => {
  const { asked } = await picked(t);
  const url = new URL(asked[0]);
  assert.equal(url.searchParams.get("subject"), "math");
  assert.equal(url.searchParams.get("q"), "", "MATH as free text returns LATIN, ASTRON and professors named McMath");
});

// The memo exists for this: a re-run reads the query box, and the box says
// "MATH", which is a guess again unless something remembers it was a pick.
test("regression #76: switching term re-runs the picked subject still scoped", async (t) => {
  const { page, asked } = await picked(t);

  page.el("#term").value = "1262";
  fire(page.el("#term"), "change");
  await until(() => asked.length > 1, "the term change to re-run the search");

  const url = new URL(asked[asked.length - 1]);
  assert.equal(url.searchParams.get("term"), "1262");
  assert.equal(url.searchParams.get("subject"), "math", "the re-run dropped back to a keyword search");
});
