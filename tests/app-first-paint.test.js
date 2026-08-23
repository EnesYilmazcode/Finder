import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, until, settle } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATING_COURSES, RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

// init() runs on import, so the only way to see what first paint waits on is to
// give app.js a page and hold one answer back. Everything stubbed below is
// something init touches on a visit with no query.

const TERMS_URL = "https://content.osu.edu/v2/classes/searchableTermsV2";
const TERM_NAMES = { "1268": "Autumn 2026", "1262": "Spring 2026" };

const TERMS = {
  data: { data: Object.entries(TERM_NAMES).map(([strm, descr]) => ({ strm, descr })) },
};

// One course, so the count on the status line says which screen wrote it.
const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taught(1001, ["monday", "wednesday", "friday"], "9:00 AM", "9:55 AM", ["Stephen Gomori"]),
  ]),
];

// Read off the fixture, never a literal: the index is shared and its section
// counts move whenever a branch edits the snapshot.
function sectionsIn(term) {
  return SEATS_INDEX.terms.find((t) => String(t.term) === term).sections;
}

/** A route that stays unanswered until release(), and says whether it answered. */
function held(body) {
  let release;
  let answered = false;
  const gate = new Promise((resolve) => {
    release = () => { answered = true; resolve(); };
  });
  return {
    release: () => release(),
    get answered() { return answered; },
    response: { ok: true, status: 200, json: () => gate.then(() => body) },
  };
}

/** stubFetch, plus the request log that says why a screen never painted. */
function watch(routes) {
  const seen = [];
  const restore = stubFetch(routes);
  const served = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(String(url)); return served(url); };
  return { seen, restore };
}

async function waitFor(condition, label, seen) {
  try {
    await until(condition, label);
  } catch (error) {
    throw new Error(`${error.message}; fetched ${seen.join(", ") || "nothing"}`, { cause: error });
  }
}

test("the welcome screen paints without waiting for the term's seats", async (t) => {
  const seats1268 = held(SEATS_TERMS["1268"]);
  const { seen, restore } = watch({
    [TERMS_URL]: TERMS,
    "data/ratings.json": RATINGS,
    "data/seats.json": SEATS_INDEX,
    "data/seats-1268.json": seats1268.response,
  });
  t.after(() => { seats1268.release(); restore(); });

  const page = await mountApp();
  const stats = page.el("#w-stats");

  await waitFor(() => stats.textContent !== "", "the welcome screen to paint", seen);

  // If the term file had already answered, painting proves nothing.
  assert.equal(seats1268.answered, false, "the held term seats answered before the assertion");

  // The stats line comes from the index, so the section count and the date are
  // both there. The date is locale-formatted, so it is left unpinned.
  assert.equal(page.el("#welcome").hidden, false);
  assert.ok(
    stats.textContent.startsWith(`Autumn 2026 · ${sectionsIn("1268").toLocaleString()} sections · seats as of `),
    `stats line degraded to: ${stats.textContent}`
  );
  assert.ok(page.all("#w-list li").length > 0, "the rated-instructor list is empty");

  // The term's seats are still started, so the first search does not pay for them.
  await waitFor(() => seen.includes("data/seats-1268.json"), "the term's seats to be requested", seen);
});

test("a shared ?term= link paints before that term's seats arrive", async (t) => {
  const seats1262 = held(SEATS_TERMS["1262"]);
  const { seen, restore } = watch({
    [TERMS_URL]: TERMS,
    "data/ratings.json": RATINGS,
    "data/seats.json": SEATS_INDEX,
    "data/seats-1262.json": seats1262.response,
  });
  t.after(() => { seats1262.release(); restore(); });

  const page = await mountApp({ term: "1262" });
  const stats = page.el("#w-stats");

  await waitFor(() => stats.textContent !== "", "the welcome screen to paint", seen);

  assert.equal(seats1262.answered, false, "the held term seats answered before the assertion");
  assert.ok(
    stats.textContent.startsWith(`Spring 2026 · ${sectionsIn("1262").toLocaleString()} sections · seats as of `),
    `stats line degraded to: ${stats.textContent}`
  );
  await waitFor(() => seen.includes("data/seats-1262.json"), "the term's seats to be requested", seen);
});

// Measured, #58 with #85. The note is written the moment the index settles,
// which is a tick before the term's own file answers, so a term file that dies
// used to be announced nowhere: the landing screen read clean and "Hide full
// sections" stayed live over seats that never arrived. Only the second describe
// catches it, and the instant stubs above would not have shown that either way.
test("a term's seats that die after the index still reach the note", async (t) => {
  let release;
  const arrives = new Promise((resolve) => { release = resolve; });
  const restore = stubFetch({
    [TERMS_URL]: TERMS,
    "data/ratings.json": RATINGS,
    "data/seats.json": SEATS_INDEX,
    "data/seats-1268.json": { ok: false, status: 503, json: async () => null },
  });
  // The delay is on the fetch, not the body: a response that resolves late is
  // what the index beating the term file actually looks like.
  const served = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === "data/seats-1268.json") await arrives;
    return served(url);
  };
  t.after(restore);

  const page = await mountApp();
  await until(() => page.el("#w-stats").textContent !== "", "the welcome screen to paint");

  assert.equal(page.el("#status").textContent, "", "nothing is known to be wrong while the file is in flight");
  assert.equal(page.el("#f-full").disabled, false);

  release();
  await until(
    () => page.el("#status").textContent === "Could not load seat counts, so the filter that needs them is off.",
    "the dead term file to be announced"
  );
  assert.equal(page.el("#f-full").disabled, true, "the filter with no snapshot stayed live");
  assert.doesNotMatch(page.el("#w-stats").textContent, /seats as of/, "a term with no seats still dated them");
});

// Regression, #58. Neither describe above is superseded by a later search, so a
// welcome example clicked while the term's own seat file was still on the wire
// used to bring the landing screen back over the finished results: the sections
// and the status line were intact, underneath it.
test("a welcome example clicked before the term's seats land keeps the results", async (t) => {
  let release;
  let landed = false;
  const arrives = new Promise((resolve) => { release = () => { landed = true; resolve(); }; });
  const restore = stubFetch(new Map([
    [TERMS_URL, TERMS],
    ["data/ratings.json", RATINGS],
    ["data/ratings-courses.json", RATING_COURSES],
    ["data/seats.json", SEATS_INDEX],
    ["data/seats-1268.json", SEATS_TERMS["1268"]],
    ["data/trend-1268.json", { ok: false, status: 404, json: async () => null }],
    [/\/classes\/search/, { data: { totalItems: 1, totalPages: 1, courses: COURSES } }],
  ]));
  // Held at the fetch, not in the body: the index answers and fills the landing
  // screen while this term's own file is still in flight, which is the window.
  const served = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === "data/seats-1268.json") await arrives;
    return served(url);
  };
  t.after(() => { release(); restore(); });

  const page = await mountApp();
  await until(() => page.el("#welcome").hidden === false, "the welcome screen to paint");
  assert.equal(landed, false, "the term's seats landed before the click, so nothing raced");

  page.el(".w-example").click();
  assert.equal(page.el("#welcome").hidden, true, "the search never took the screen");

  release();
  await until(() => page.all(".section").length > 0, "the results");
  await settle(10);

  assert.equal(page.el("#welcome").hidden, true, "the landing screen came back over the results");
  assert.equal(page.all(".section").length, 1, "the results left the screen");
  assert.match(page.el("#status").textContent, /^1 course, 1 section in Autumn 2026\./);
});
