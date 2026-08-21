// The wiring in app.js, driven through the stub document in dom.js. Nothing
// here touches the network: fetch answers the terms endpoint, the search
// endpoint and both seat snapshots from fixtures.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, until, DomEvent } from "./dom.js";
import { meeting, person, section } from "./fixtures.js";

const AUTUMN = "1268";
const SPRING = "1262";

function lecture(classNumber, start, end) {
  return section(classNumber, { meetings: [meeting(["monday", "wednesday", "friday"], start, end, [person("Paolo Bucci")])] });
}

const COURSES = {
  [AUTUMN]: [{
    course: { subject: "CSE", catalogNumber: "2221", title: "Software I", minUnits: 4, maxUnits: 4 },
    sections: [lecture(5477, "9:10 AM", "10:05 AM"), lecture(5478, "11:30 AM", "12:25 PM")],
  }],
  [SPRING]: [{
    course: { subject: "CSE", catalogNumber: "2221", title: "Software I", minUnits: 4, maxUnits: 4 },
    sections: [lecture(3101, "8:00 AM", "8:55 AM")],
  }],
};

// The numbers from #89 rather than the term pair in fixtures.js, so the class
// number that exists in both terms is the one the issue was filed about. 5477
// read from the wrong term gives a real but wrong count instead of a blank.
const SEATS = {
  "data/seats.json": {
    terms: [
      { term: SPRING, termName: "Spring 2026", sourceUpdated: "2026-04-27", sections: 1, file: "seats-1262.json" },
      { term: AUTUMN, termName: "Autumn 2026", sourceUpdated: "2026-08-18", sections: 2, file: "seats-1268.json" },
    ],
  },
  "data/seats-1268.json": { term: AUTUMN, sections: { "5477": [40, 40, 1], "5478": [30, 40, 0] } },
  "data/seats-1262.json": { term: SPRING, sections: { "5477": [0, 50, 0], "3101": [12, 40, 0] } },
};

/** A search the test releases by hand, to hold one term's fetch open. */
function holdTerm(term) {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { term, promise, release: () => open() };
}

/** The network. `slow` holds one term's search until released, `fails` 429s one. */
function serve({ slow = null, fails = null } = {}) {
  return async (input) => {
    const url = String(input);
    let body = null;
    if (url.includes("searchableTermsV2")) {
      body = { data: { data: [{ strm: AUTUMN, descr: "Autumn 2026" }, { strm: SPRING, descr: "Spring 2026" }] } };
    } else if (url.includes("/classes/search")) {
      const term = new URL(url).searchParams.get("term");
      if (slow?.term === term) await slow.promise;
      if (fails === term) return { ok: false, status: 429, json: async () => ({}) };
      body = { data: { totalItems: 1, totalPages: 1, courses: COURSES[term] ?? [] } };
    } else if (url.includes("ratings.json")) {
      body = { school: {}, count: 0, professors: [] };
    } else {
      body = SEATS[url] ?? null;
    }
    if (!body) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

function rowFor(page, classNumber) {
  return page.el("#results").querySelectorAll(".section")
    .find((node) => node.dataset.classNumber === String(classNumber));
}

/** What one section row says about its seats, or null when it is not on screen. */
function seatsOn(page, classNumber) {
  const seats = rowFor(page, classNumber)?.querySelector(".seats");
  return seats ? { text: seats.textContent, state: seats.dataset.state } : null;
}

function sectionNumbers(page) {
  return page.el("#results").querySelectorAll(".section").map((node) => node.dataset.classNumber);
}

/** One labelled figure out of the detail pane. */
function detailValue(page, label) {
  const row = page.el("#detail-body").querySelectorAll(".d-row")
    .find((node) => node.childNodes[0]?.textContent === label);
  return row?.querySelector(".d-val")?.textContent ?? null;
}

async function searched(page) {
  return until(() => page.el("#results").querySelectorAll(".section").length > 0);
}

/**
 * Give a pending paint time to land. The predicate is positive on purpose, so a
 * failure names the rows that turned up instead of timing out on an absence.
 */
async function quiet(page) {
  await until(() => sectionNumbers(page).length > 0, 100);
}

function switchTerm(page, term) {
  page.el("#term").value = term;
  page.el("#term").dispatchEvent(new DomEvent("change"));
}

function clickSection(page, classNumber) {
  page.el("#results").dispatchEvent(new DomEvent("click", rowFor(page, classNumber)));
}

// Regression, #89. The term handler repainted unconditionally but only
// refetched when the box had text, so clearing the box and switching term left
// the old term's sections on screen with the new term's seats under them.
test("regression #89: switching term drops sections fetched for the old one", async () => {
  const page = await mountApp({ query: "CSE 2221", term: AUTUMN, fetch: serve() });
  assert.ok(await searched(page), "the first search rendered");
  assert.deepEqual(seatsOn(page, 5477), { text: "40/40+1", state: "full" }, "Autumn 5477 is full");

  page.el("#q").value = "";
  switchTerm(page, SPRING);
  await quiet(page);

  assert.deepEqual(sectionNumbers(page), [], "Autumn's rows are gone rather than repainted");
  assert.equal(page.el("#status").textContent, "", "no count claimed for a term nothing was fetched for");
  assert.equal(page.el("#welcome").hidden, false, "the landing screen takes their place");
});

// The same stale rows also reach the screen through a filter change, which is
// why the guard sits in paint() rather than in the term handler.
test("regression #89: a filter change cannot bring the old term's rows back", async () => {
  const page = await mountApp({ query: "CSE 2221", term: AUTUMN, fetch: serve() });
  assert.ok(await searched(page), "the first search rendered");

  page.el("#q").value = "";
  switchTerm(page, SPRING);
  await quiet(page);

  page.el("#filters").hideOnline.checked = true;
  page.el("#filters").dispatchEvent(new DomEvent("change"));
  assert.deepEqual(sectionNumbers(page), [], "still nothing from Autumn");
});

// Switching back lands on the term the old rows were fetched for, so the guard
// in paint() agrees with them and cannot be what stops the repaint.
test("regression #89: switching away and back does not restore the first term's rows", async () => {
  const page = await mountApp({ query: "CSE 2221", term: AUTUMN, fetch: serve() });
  assert.ok(await searched(page), "the first search rendered");

  page.el("#q").value = "";
  switchTerm(page, SPRING);
  switchTerm(page, AUTUMN);
  await quiet(page);

  page.el("#filters").hideOnline.checked = true;
  page.el("#filters").dispatchEvent(new DomEvent("change"));
  assert.deepEqual(sectionNumbers(page), [], "an empty box shows the landing screen, not the last search");
  assert.equal(page.el("#welcome").hidden, false, "and it is not painted over");
});

// A search already running when the term changes carries the old term's
// sections, and paint() cannot catch it: it is handed the term that search
// started with, which is the term its result really belongs to.
test("regression #89: a search still in flight when the term changes never paints", async () => {
  const autumn = holdTerm(AUTUMN);
  const page = await mountApp({ query: "CSE 2221", term: AUTUMN, fetch: serve({ slow: autumn }) });
  assert.ok(await until(() => page.el("#status").textContent === "Searching..."), "the search started");

  page.el("#q").value = "";
  switchTerm(page, SPRING);
  autumn.release();
  await quiet(page);

  assert.deepEqual(sectionNumbers(page), [], "the search that landed late did not paint");
  assert.equal(page.el("#welcome").hidden, false, "the landing screen is still up");
  assert.equal(page.el("#go").getAttribute("aria-disabled"), "false", "and the search button works again");
});

// With a query in the box the rows stay up while the new term is fetched, so a
// filter change in that window is the repaint the guard in paint() refuses.
test("regression #89: a filter change while the new term loads drops the old rows", async () => {
  const spring = holdTerm(SPRING);
  const page = await mountApp({ query: "CSE 2221", term: AUTUMN, fetch: serve({ slow: spring }) });
  assert.ok(await searched(page), "the first search rendered");

  switchTerm(page, SPRING);
  page.el("#filters").hideOnline.checked = true;
  page.el("#filters").dispatchEvent(new DomEvent("change"));
  assert.deepEqual(sectionNumbers(page), [], "Autumn's rows were not repainted against Spring");

  spring.release();
  assert.ok(await until(() => sectionNumbers(page).includes("3101")), "and Spring's own section still arrives");
  assert.deepEqual(seatsOn(page, 3101), { text: "12/40", state: "open" });
});

// The rows deliberately stay up while the new term is fetched, so the detail
// pane has to read seats for the term they came from, not for the selector.
test("regression #89: the detail pane reads seats for the term its section came from", async () => {
  const spring = holdTerm(SPRING);
  const page = await mountApp({ query: "CSE 2221", term: AUTUMN, fetch: serve({ slow: spring }) });
  assert.ok(await searched(page), "the first search rendered");

  switchTerm(page, SPRING);
  clickSection(page, 5477);

  assert.equal(detailValue(page, "Enrolled"), "40 / 40", "Autumn's count for an Autumn section");
  assert.equal(detailValue(page, "Waitlist"), "1 waiting");
  assert.equal(detailValue(page, "As of"), "Aug 18");
  spring.release();
});

// A failed search has already cleared the rows, so the guard has nothing to
// drop and must not wipe the only explanation for an empty pane.
test("regression #89: a failed search for the new term does not bring the old rows back", async () => {
  const page = await mountApp({ query: "CSE 2221", term: AUTUMN, fetch: serve({ fails: SPRING }) });
  assert.ok(await searched(page), "the first search rendered");

  switchTerm(page, SPRING);
  assert.ok(await until(() => page.el("#status").dataset.kind === "error"), "Spring's search failed");
  const message = page.el("#status").textContent;

  page.el("#filters").hideOnline.checked = true;
  page.el("#filters").dispatchEvent(new DomEvent("change"));
  assert.deepEqual(sectionNumbers(page), [], "no Autumn rows under a Spring error");
  assert.equal(page.el("#status").textContent, message, "and the error is still the one thing on screen");
});

test("the term guard leaves results fetched for the term on screen alone", async () => {
  const page = await mountApp({ query: "CSE 2221", term: AUTUMN, fetch: serve() });
  assert.ok(await searched(page), "the first search rendered");

  switchTerm(page, SPRING);
  await until(() => sectionNumbers(page).includes("3101"));

  assert.deepEqual(sectionNumbers(page), ["3101"], "Spring's own section, not Autumn's");
  assert.deepEqual(seatsOn(page, 3101), { text: "12/40", state: "open" });
  assert.match(page.el("#status").textContent, /Spring 2026/);
});
