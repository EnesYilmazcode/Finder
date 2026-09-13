import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, fire, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { HEADSHOTS, RATING_COURSES, RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const TERM = "1268";
const COURSES = [entry("CSE", "2221", "Software 1", [
  taught(1001, ["monday", "wednesday", "friday"], "9:00 AM", "9:55 AM", ["Paolo Bucci"]),
  taught(1011, ["tuesday", "thursday"], "10:20 AM", "11:15 AM", ["Paolo Bucci"], { component: "Recitation" }),
])];

function serve() {
  return stubFetch([
    [/searchableTermsV2/, { data: { data: [{ strm: TERM, descr: "Autumn 2026" }] } }],
    [/\/classes\/search/, { data: { totalItems: 2, totalPages: 1, courses: COURSES } }],
    ["data/ratings.json", RATINGS],
    ["data/ratings-courses.json", RATING_COURSES],
    ["data/headshots.json", HEADSHOTS],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [`data/trend-${TERM}.json`, { ok: false, status: 404, json: async () => null }],
  ]);
}

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
}

test("a section can be saved, viewed, opened and removed", async (t) => {
  t.after(serve());
  const before = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  t.after(() => { globalThis.localStorage = before; });

  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => page.el('.section[data-class-number="1011"]'), "the section row");
  page.el('.section[data-class-number="1011"]').click();
  page.el("#detail-body .d-plan").click();

  assert.equal(page.el("#schedule-count").textContent, "1");
  assert.match(page.location.search, /plan=1011/);
  assert.equal(page.el("#detail-body .d-plan").textContent, "Remove from schedule");

  page.el("#view-schedule").click();
  await until(() => page.el(".plan-item"), "the saved schedule");
  assert.match(page.el(".plan-item").textContent, /CSE 2221/);
  assert.match(page.el(".plan-item").textContent, /Includes section 1001/);
  assert.deepEqual(new Set(page.all(".plan .cal-item").map((node) => node.dataset.classNumber)),
    new Set(["1001", "1011"]), "the required lecture is on the calendar too");
  assert.match(page.el(".plan-ok").textContent, /No time conflicts/);

  page.el(".plan-open").click();
  assert.match(page.el("#detail-body").textContent, /Paolo Bucci/);

  page.el(".plan-remove").click();
  assert.equal(page.el("#schedule-count").textContent, "0");
  assert.equal(page.el(".plan-item"), null);
  assert.doesNotMatch(page.location.search, /plan=/);
});

test("a shared class-number plan is refreshed and opens in schedule view", async (t) => {
  t.after(serve());
  const before = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  t.after(() => { globalThis.localStorage = before; });

  const page = await mountApp({ url: `https://enesyilmazcode.github.io/Finder/?term=${TERM}&plan=1001` });
  await until(() => page.el(".plan-item"), "the shared schedule");

  assert.equal(page.el("#view-schedule").getAttribute("aria-pressed"), "true");
  assert.match(page.el(".plan-item").textContent, /CSE 2221/);
  assert.match(page.el("#status").textContent, /refreshed/i);
});
