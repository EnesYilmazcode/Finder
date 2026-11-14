import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, fire, settle, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { HEADSHOTS, RATING_COURSES, RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const TERM = "1268";
const COURSES = [entry("CSE", "2221", "Software 1", [
  taught(1001, ["monday", "wednesday", "friday"], "9:00 AM", "9:55 AM", ["Paolo Bucci"]),
  taught(1011, ["tuesday", "thursday"], "10:20 AM", "11:15 AM", ["Paolo Bucci"], { component: "Recitation" }),
  taught(1012, ["tuesday", "thursday"], "11:30 AM", "12:25 PM", ["Paolo Bucci"], { component: "Recitation" }),
  taught(1013, ["tuesday", "thursday"], "12:40 PM", "1:35 PM", ["Paolo Bucci"], { component: "Laboratory" }),
])];

function serve(queries = [], gate = null) {
  return stubFetch([
    [/searchableTermsV2/, { data: { data: [{ strm: TERM, descr: "Autumn 2026" }] } }],
    [/\/classes\/search/, (raw) => {
      const q = new URL(raw).searchParams.get("q");
      queries.push(q);
      // Reproduce the live API behavior that exposed the regression: a lookup
      // by class number can return that section without its linked partner.
      const numeric = /^\d+$/.test(q ?? "");
      const courses = numeric
        ? COURSES.map((found) => ({ ...found, sections: found.sections.filter((section) => String(section.classNumber) === q) }))
          .filter((found) => found.sections.length)
        : COURSES;
      const body = { data: { totalItems: courses.length, totalPages: 1, courses } };
      // A held gate keeps the schedule refresh's class-number lookups in flight.
      // "CSE 2221" goes out as q=2221 with a subject, so a bare number is the tell.
      const lookup = numeric && !new URL(raw).searchParams.get("subject");
      return lookup && gate ? gate.wait.then(() => body) : body;
    }],
    ["data/ratings.json", RATINGS],
    ["data/ratings-courses.json", RATING_COURSES],
    ["data/headshots.json", HEADSHOTS],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    [`data/trend-${TERM}.json`, { ok: false, status: 404, json: async () => null }],
  ]);
}

function gated() {
  let open;
  return { wait: new Promise((resolve) => { open = resolve; }), open: () => open() };
}

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
}

test("a section can be saved, viewed, opened and removed", async (t) => {
  const queries = [];
  t.after(serve(queries));
  const before = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  t.after(() => { globalThis.localStorage = before; });

  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => page.el('.section[data-class-number="1011"]'), "the section row");
  page.el('.section[data-class-number="1011"]').click();
  page.el("#detail-body .d-plan").click();

  assert.equal(page.el("#schedule-count").textContent, "1");
  assert.match(page.location.search, /plan=1011/);
  assert.equal(page.el("#detail-body .d-plan").getAttribute("aria-label"), "Remove from schedule");
  assert.equal(page.el("#detail-body .d-plan").textContent, "Saved");

  page.el("#view-schedule").click();
  await until(() => page.el(".plan-item"), "the saved schedule");
  await until(() => queries.includes("1001"), "the linked lecture refresh");
  await until(() => /linked sections refreshed/i.test(page.el("#status").textContent), "the completed schedule refresh");
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

test("submitting a course search from the schedule opens its list results", async (t) => {
  t.after(serve());
  const page = await mountApp();
  await until(() => page.el("#term").options.length > 0, "the term list");

  page.el("#view-schedule").click();
  assert.equal(page.el("#view-schedule").getAttribute("aria-pressed"), "true");

  page.el("#q").value = "CSE 2221";
  fire(page.el("#search"), "submit");
  await until(() => page.el('.section[data-class-number="1001"]'), "the searched course");

  assert.equal(page.el("#view-list").getAttribute("aria-pressed"), "true");
  assert.equal(page.el("#view-schedule").getAttribute("aria-pressed"), "false");
  assert.equal(page.el(".app").dataset.view, "results");
});

test("a section with several valid linked components asks instead of guessing", async (t) => {
  const queries = [];
  t.after(serve(queries));
  const before = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  t.after(() => { globalThis.localStorage = before; });

  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => page.el('.section[data-class-number="1001"]'), "the lecture row");
  page.el('.section[data-class-number="1001"]').click();
  page.el("#detail-body .d-plan").click();
  page.el("#view-schedule").click();

  await until(() => page.all(".plan-choice-button").length === 3, "the linked-section choices");
  assert.deepEqual(page.all(".plan-choice-button").map((button) => button.textContent), [
    "Recitation 1011 · TuTh 10:20a–11:15a",
    "Recitation 1012 · TuTh 11:30a–12:25p",
    "Laboratory 1013 · TuTh 12:40p–1:35p",
  ]);

  page.all(".plan-choice-button")[1].click();
  assert.equal(page.el(".plan-needs"), null);
  assert.match(page.el(".plan-item").textContent, /Includes section 1012/);
  assert.deepEqual(new Set(page.all(".plan .cal-item").map((node) => node.dataset.classNumber)),
    new Set(["1001", "1012"]));
});

/** Save 1011 from a search, then open the schedule with its refresh held. */
async function savedWithRefreshHeld(t) {
  const gate = gated();
  const queries = [];
  t.after(serve(queries, gate));
  const before = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  t.after(() => { globalThis.localStorage = before; });

  const page = await mountApp({ query: "CSE 2221", term: TERM });
  await until(() => page.el('.section[data-class-number="1011"]'), "the section row");
  page.el('.section[data-class-number="1011"]').click();
  page.el("#detail-body .d-plan").click();
  page.el("#view-schedule").click();
  await until(() => queries.includes("1011"), "the refresh request");
  return { page, gate };
}

test("removing a section while the schedule refreshes keeps it removed", async (t) => {
  const { page, gate } = await savedWithRefreshHeld(t);
  page.el(".plan-remove").click();
  assert.equal(page.el("#schedule-count").textContent, "0");

  gate.open();
  await settle();
  assert.equal(page.el(".plan-item"), null, "the refresh drew the removed section back");
  assert.equal(page.el("#schedule-count").textContent, "0");
  assert.doesNotMatch(globalThis.localStorage.getItem("finder.schedule.v1") ?? "", /1011/,
    "the refresh saved the removed section again");
});

test("leaving the schedule while it refreshes does not pull the page back to it", async (t) => {
  const { page, gate } = await savedWithRefreshHeld(t);
  page.el("#view-list").click();
  await until(() => page.el('.section[data-class-number="1001"]'), "the list results");

  gate.open();
  await settle();
  assert.equal(page.el("#view-list").getAttribute("aria-pressed"), "true");
  assert.equal(page.el(".plan-item"), null, "the finished refresh replaced the list with the schedule");
  assert.ok(page.el('.section[data-class-number="1001"]'), "the list results are still on screen");
  assert.equal(page.el("#schedule-count").textContent, "1", "the saved section is kept");
});
