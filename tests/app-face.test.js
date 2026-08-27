// The instructor face reached from the page rather than from renderDetail.
//
// tests/detail-face.test.js pins what the renderer draws. What only the app can
// answer is that nothing waits on data/headshots.json: it is fetched on the first
// section opened, and the pane has already painted a monogram by then.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, settle, until } from "./dom.js";
import { HEADSHOTS, RATING_COURSES, RATINGS, SEATS_INDEX, SEATS_TERMS, entry, meeting, person, section } from "./fixtures.js";

const TERM = "1268";
const MWF = ["monday", "wednesday", "friday"];

const taughtBy = (classNumber, name, email) => section(classNumber, {
  meetings: [meeting(MWF, "9:00 AM", "9:55 AM", [person(name, { email })])],
});

const COURSES = [
  entry("CSE", "2221", "Software 1", [
    taughtBy(1001, "Paolo Bucci", "bucci.2@osu.edu"),
    taughtBy(1002, "Stephen Gomori", "gomori.1@osu.edu"),
  ]),
];

const TERMS = { data: { data: [{ strm: TERM, descr: "Autumn 2026", startDate: "2026-08-25", endDate: "2026-12-16" }] } };

/** A fetch the test releases by hand, to hold one file open. */
function hold() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, release: () => open() };
}

/**
 * `held` keeps headshots.json in flight, `fails` 404s it, and `heldCodes` holds
 * the rating course codes, which is what keeps the pane's one-attempt latch in
 * play while headshots.json has already come back.
 */
function serve({ held = null, fails = false, heldCodes = null } = {}) {
  return async (input) => {
    const url = String(input);
    let body = null;

    if (url.includes("headshots.json")) {
      if (held) await held.promise;
      if (fails) return { ok: false, status: 404, json: async () => ({}) };
      body = HEADSHOTS;
    } else if (url.includes("ratings-courses.json")) {
      if (heldCodes) await heldCodes.promise;
      body = RATING_COURSES;
    } else if (url.includes("searchableTermsV2")) {
      body = TERMS;
    } else if (url.includes("/classes/search")) {
      body = { data: { totalItems: 2, totalPages: 1, courses: COURSES } };
    } else if (url.includes("ratings.json")) {
      body = RATINGS;
    } else if (url.includes("seats.json")) {
      body = SEATS_INDEX;
    } else if (url.includes(`seats-${TERM}.json`)) {
      body = SEATS_TERMS[TERM];
    }
    if (!body) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

async function opened(fetch) {
  const page = await mountApp({ query: "CSE 2221", term: TERM, fetch });
  await until(() => page.all(".section").length === 2, "the sections to paint");
  click(page, 1001);
  return page;
}

const face = (page) => page.el("#detail-body .d-face");
const click = (page, number) =>
  page.el(`[data-class-number="${number}"]`).dispatchEvent({ type: "click", bubbles: true });

test("the pane draws initials first and the photo once the snapshot lands", async () => {
  const held = hold();
  const page = await opened(serve({ held }));

  assert.equal(face(page).tagName, "SPAN", "the pane painted without waiting");
  assert.equal(face(page).dataset.initials, "PB");

  held.release();
  await settle();
  assert.equal(face(page).tagName, "IMG", "the redraw picked the photo up");
  assert.equal(face(page).src, "https://opic.osu.edu/bucci.2?width=100");
});

// js/headshots.js drops its in-flight memo when a load fails, so it has nothing
// left to dedupe against. Without the flag being latched up front, every later
// click started the dead fetch again.
test("a snapshot that failed is not asked for again on the next click", async () => {
  const asked = [];
  // The course codes stay in flight, which is the window the latch has to cover.
  const heldCodes = hold();
  const answer = serve({ fails: true, heldCodes });
  const page = await mountApp({
    query: "CSE 2221",
    term: TERM,
    fetch: async (input) => { asked.push(String(input)); return answer(input); },
  });
  await until(() => page.all(".section").length === 2, "the sections to paint");

  for (let i = 0; i < 4; i++) { click(page, 1001); await settle(); }

  assert.equal(asked.filter((url) => url.includes("headshots.json")).length, 1,
    "one dead snapshot must not be refetched on every section opened");
  assert.equal(face(page).dataset.initials, "PB");
});

test("a snapshot that never arrives leaves the initials, not a gap", async () => {
  const page = await opened(serve({ fails: true }));
  await settle();

  assert.equal(face(page).tagName, "SPAN");
  assert.equal(face(page).dataset.initials, "PB");
  assert.equal(page.all("#detail-body img").length, 0);
});

test("the snapshot is fetched once the first section opens, not at startup", async () => {
  const asked = [];
  const page = await mountApp({
    query: "CSE 2221",
    term: TERM,
    fetch: async (input) => {
      asked.push(String(input));
      return serve()(input);
    },
  });
  await until(() => page.all(".section").length === 2, "the sections to paint");

  assert.equal(asked.filter((url) => url.includes("headshots.json")).length, 0,
    "nothing on the first paint should pay for a file only the pane reads");

  click(page, 1001);
  await settle();
  assert.equal(asked.filter((url) => url.includes("headshots.json")).length, 1,
    "one attempt per page load, because a missing snapshot will not appear on the next click");
});

// The snapshot is fetched once, but the redraw has to belong to whichever section
// is open when it lands. Binding it to the first one opened left a section picked
// during that window showing initials for a face the snapshot had just supplied.
test("a section opened while the snapshot is in flight still gets its photo", async () => {
  const held = hold();
  const page = await mountApp({ query: "CSE 2221", term: TERM, fetch: serve({ held }) });
  await until(() => page.all(".section").length === 2, "the sections to paint");

  click(page, 1001);
  click(page, 1002);
  assert.equal(face(page).dataset.initials, "SG", "the second section painted without waiting");

  held.release();
  await settle();
  assert.equal(face(page).tagName, "IMG");
  assert.equal(face(page).src, "https://opic.osu.edu/gomori.1?width=100");
});
