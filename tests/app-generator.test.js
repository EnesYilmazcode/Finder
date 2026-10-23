import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, fire, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { RATINGS, SEATS_INDEX, SEATS_TERMS, entry, taught } from "./fixtures.js";

const TERM = "1268";
const CSE = entry("CSE", "2221", "Software 1", [
  taught(1101, ["monday", "wednesday"], "10:00 AM", "10:55 AM", ["Paolo Bucci"]),
  taught(1102, ["monday", "wednesday"], "1:00 PM", "1:55 PM", ["Paolo Bucci"]),
]);
const MATH = entry("MATH", "1151", "Calculus 1", [
  taught(2001, ["tuesday", "thursday"], "10:00 AM", "10:55 AM", ["Diana Ikenberry Kline"]),
  taught(2002, ["monday", "wednesday"], "10:00 AM", "10:55 AM", ["Diana Ikenberry Kline"]),
]);
const ENGLISH = [
  entry("ENGLISH", "1110.01", "First-Year English Composition", [
    taught(3001, [], null, null, ["Online Teacher"], { instructionMode: "Distance Learning" }),
  ]),
  entry("ENGLISH", "1110.02", "First-Year English Composition", [
    taught(3002, [], null, null, ["Online Teacher"], { instructionMode: "Distance Learning" }),
  ]),
];
const COURSE_INDEX = {
  terms: { [TERM]: { subjects: [
    { code: "CSE", name: "Computer Science and Engineering", courses: [["2221", "Software 1", 4, 4]] },
    { code: "MATH", name: "Mathematics", courses: [["1151", "Calculus 1", 5, 5]] },
    { code: "ENGLISH", name: "English", courses: [
      ["1110.01", "First-Year English Composition", 3, 3],
      ["1110.02", "First-Year English Composition", 3, 3],
    ] },
  ] } },
};

function serve() {
  return stubFetch([
    [/searchableTermsV2/, { data: { data: [{ strm: TERM, descr: "Autumn 2026" }] } }],
    [/\/classes\/search/, (raw) => {
      const url = new URL(raw);
      const subject = url.searchParams.get("subject")?.toUpperCase();
      const courses = subject === "CSE" ? [CSE] : subject === "MATH" ? [MATH] : subject === "ENGLISH" ? ENGLISH : [];
      return { data: { totalItems: courses.length, totalPages: 1, courses } };
    }],
    ["data/ratings.json", RATINGS],
    ["data/courses.json", COURSE_INDEX],
    ["data/seats.json", SEATS_INDEX],
    [`data/seats-${TERM}.json`, SEATS_TERMS[TERM]],
    ["data/grades.json", { ok: false, status: 404, json: async () => null }],
  ]);
}

test("the schedule view generates and adopts a ranked multi-course schedule", async (t) => {
  t.after(serve());
  const page = await mountApp();
  await until(() => page.el("#term").options.length, "the term list");

  page.el("#view-schedule").click();
  page.el(".plan-generate").click();
  assert.match(page.el(".generator").textContent, /Build a conflict-free schedule/);

  for (const code of ["CSE 2221", "MATH 1151"]) {
    page.el("#gen-course").value = code;
    fire(page.el(".gen-add"), "submit");
    await until(() => page.all(".gen-course-chip").length >= (code.startsWith("CSE") ? 1 : 2), `${code} to be added`);
  }
  assert.equal(page.all(".gen-course-chip").length, 2);

  fire(page.el(".gen-preferences"), "submit");
  await until(() => page.el(".gen-result"), "a generated schedule");
  assert.match(page.el("#status").textContent, /conflict-free schedules/);
  assert.doesNotMatch(page.el(".gen-result").textContent, /Sections 1101.*Sections 2002/s,
    "the overlapping pair is not offered together");

  page.el(".gen-pin").click();
  await until(() => page.el(".gen-pin.is-pinned"), "the pinned course to be regenerated");
  assert.equal(page.el(".gen-pin.is-pinned").getAttribute("aria-pressed"), "true");

  page.el(".gen-use").click();
  assert.equal(page.all(".plan-item").length, 2);
  assert.equal(page.el("#schedule-count").textContent, "2");
  assert.match(page.el("#status").textContent, /Using generated schedule with 2 courses/);
});

test("an unsuffixed course can select any decimal version, including asynchronous online sections", async (t) => {
  t.after(serve());
  const page = await mountApp();
  await until(() => page.el("#term").options.length, "the term list");
  page.el("#view-schedule").click();
  page.el(".plan-generate").click();

  for (const [index, code] of ["ENGLISH 1110", "CSE 2221"].entries()) {
    page.el("#gen-course").value = code;
    fire(page.el(".gen-add"), "submit");
    await until(() => page.all(".gen-course-chip").length === index + 1, `${code} to be added`);
  }
  assert.match(page.all(".gen-course-chip")[0].textContent, /ENGLISH 1110 \(any version\)/);
  fire(page.el(".gen-preferences"), "submit");
  await until(() => page.el(".gen-result"), "a schedule with a decimal English version");
  assert.match(page.el(".gen-result").textContent, /ENGLISH 1110\.0[12]/);
  assert.match(page.el(".gen-result").textContent, /Time to be announced/);
});
