// #66 through the page. The Fulfills picker is a third way to start a search,
// after the query box and the subject dropdown, and all three now share one
// request builder and one re-run path. Everything here is a request the page
// really made, because the ways this breaks are all silent: an unknown
// parameter is dropped by destructuring without a word, and a re-run that
// forgets the subject memo just returns a different, wrong result set.

import test from "node:test";
import assert from "node:assert/strict";

import { fire, mountApp, settle, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const TERMS = "searchableTermsV2";
// setupDom's `query` option only fills ?q=, and these links carry ?gen=.
const PAGE = "https://enesyilmazcode.github.io/Finder/";
const linkTo = (gen) => `${PAGE}?gen=${encodeURIComponent(gen)}`;
const SEARCH = /\/classes\/search\?/;
const SUSTAINABILITY = "GEN Theme: Sustainability";
const TERM_LIST = { data: { data: [{ strm: 1268, descr: "Autumn 2026" }] } };
const COURSE_INDEX = {
  built: "2026-08-18",
  terms: { 1268: { subjects: [{ code: "MATH", name: "Mathematics", courses: [["1151", "Calculus I", 5, 5]] }] } },
};
const RESULT = {
  data: {
    totalItems: 1,
    totalPages: 1,
    courses: [entry("MATH", "1151", "Calculus I", [taught(1001, ["monday"], "10:20 AM", "11:15 AM", ["Tim Long"])])],
  },
};

/** Records every search the page sends. `terms` may be a promise held open. */
function rig(t, { terms = TERM_LIST } = {}) {
  const asked = [];
  t.after(stubFetch([
    ["data/ratings.json", RATINGS],
    ["data/seats.json", SEATS_INDEX],
    ["data/seats-1268.json", SEATS_TERMS["1268"]],
    ["data/courses.json", COURSE_INDEX],
    [(url) => url.includes(TERMS), terms],
    [SEARCH, (url) => { asked.push(new URL(url)); return RESULT; }],
  ]));
  return asked;
}

const last = (asked) => asked[asked.length - 1];
const ready = (page) => until(() => page.el("#term").value === "1268", "the term list");

async function pickGen(page, value = SUSTAINABILITY) {
  page.el("#p-gen").value = value;
  fire(page.el("#p-gen"), "change");
}

test("regression #66: picking a requirement browses it upstream", async (t) => {
  const asked = rig(t);
  const page = await mountApp();
  await ready(page);

  await pickGen(page);
  await until(() => asked.length > 0, "the requirement browse to reach the API");

  assert.equal(last(asked).searchParams.get("gen-categories"), SUSTAINABILITY);
  assert.match(page.location.search, /gen=GEN\+Theme/);
});

// The blocker this branch and #76 were held apart for: both add a parameter to
// the same four lines of searchAllPages, and destructuring drops whichever one
// the resolution left out, with no error and a green suite. An empty q with no
// gen-categories returns the whole term's catalogue as "the courses that fulfil
// this requirement"; a picked MATH with no subject returns LATIN and ASTRON.
test("a requirement and a picked subject reach the API together", async (t) => {
  const asked = rig(t);
  const page = await mountApp();
  await ready(page);

  fire(page.el("#p-subject"), "focus");
  await settle(4); // the course index is lazy, so the first focus fetches it
  page.el("#p-subject").value = "MATH";
  fire(page.el("#p-subject"), "input");
  await until(() => asked.length > 0, "the subject browse");
  assert.equal(last(asked).searchParams.get("subject"), "math");

  await pickGen(page);
  await until(() => asked.length > 1, "the requirement to re-run the browse");

  const url = last(asked);
  assert.equal(url.searchParams.get("gen-categories"), SUSTAINABILITY);
  assert.equal(url.searchParams.get("subject"), "math", "the re-run dropped back to a keyword search");
  assert.equal(url.searchParams.get("q"), "", "MATH went back to being matched as text");
});

// #80 hoisted the listeners above the term request, so the picker is live in a
// window where there is no term to search. An empty query fails the queue's
// q.trim() guard, so without the requirement in that test the picker looks
// functional, says nothing, and never runs.
test("a requirement picked before the terms arrive is held and then runs", async (t) => {
  let release;
  const asked = rig(t, { terms: new Promise((r) => { release = r; }) });
  const page = await mountApp();
  await until(() => page.el("#status").textContent === "Loading terms...", "the terms request");

  await pickGen(page);
  await settle(2);
  assert.deepEqual(asked, [], "the browse ran with no term at all");
  assert.equal(page.el("#status").textContent, "Still loading terms. Your search will run when they arrive.");

  release(TERM_LIST);
  await until(() => asked.length > 0, "the held requirement browse to run");
  assert.equal(last(asked).searchParams.get("gen-categories"), SUSTAINABILITY);
});

// The headline entry point: a link to a requirement carries no q, so 80's
// bottom-of-init condition would otherwise drop it on the welcome screen.
test("a shared requirement link runs the browse instead of landing on the welcome screen", async (t) => {
  const asked = rig(t);
  const page = await mountApp({ url: linkTo(SUSTAINABILITY) });
  await until(() => asked.length > 0, "the shared link's browse");

  assert.equal(page.el("#p-gen").value, SUSTAINABILITY);
  assert.equal(last(asked).searchParams.get("gen-categories"), SUSTAINABILITY);
  assert.equal(page.el("#welcome").hidden, true);
});

// Matching is exact upstream, so a reworded category returns zero rather than
// an error. Serving the front page to someone who followed a link is worse
// than saying the link is out of date.
test("a link to a requirement that no longer exists says so", async (t) => {
  const asked = rig(t);
  const page = await mountApp({ url: linkTo("GEN Theme: Sustainable Vibes") });
  await until(() => page.el("#status").textContent !== "Loading terms...", "init to settle");

  assert.deepEqual(asked, [], "an unknown requirement searched for nothing");
  assert.match(page.el("#status").textContent, /^Finder has no requirement called GEN Theme: Sustainable Vibes\./);
  assert.equal(page.el("#p-gen").value, "");
  assert.equal(page.location.search.includes("gen="), false, "the dead value stayed in the URL to be reshared");
});
