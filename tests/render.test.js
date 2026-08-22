// groupByInstructor, plus the one row rule that needs a rendered row to see.

import test from "node:test";
import assert from "node:assert/strict";

import { groupByInstructor, renderSection } from "../js/render.js";
import { section, taught, TREND } from "./fixtures.js";
import { setupDom } from "./dom.js";
import { withSeats, withTrend } from "./helpers.js";

const MWF = ["monday", "wednesday", "friday"];

test("groupByInstructor gathers a teacher's sections under one heading", () => {
  const sections = [
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Paolo Bucci"]),
    taught(1002, MWF, "10:20 AM", "11:15 AM", ["Paolo Bucci"]),
    taught(1003, MWF, "9:00 AM", "9:55 AM", ["Steve Gomori"]),
  ];
  const groups = groupByInstructor(sections);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.key === "Paolo Bucci").sections.length, 2);
  assert.equal(groups.find((g) => g.key === "Steve Gomori").sections.length, 1);
});

test("a co-taught section is filed once, under both names together", () => {
  const groups = groupByInstructor([taught(1001, MWF, "9:00 AM", "9:55 AM", ["Ann Taylor", "Bob Roberts"])]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "Ann Taylor & Bob Roberts");
  assert.deepEqual(groups[0].people.map((p) => p.name), ["Ann Taylor", "Bob Roberts"]);
});

test("the key does not depend on the order the API listed the pair", () => {
  const groups = groupByInstructor([
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Ann Taylor", "Bob Roberts"]),
    taught(1002, MWF, "1:00 PM", "1:55 PM", ["Bob Roberts", "Ann Taylor"]),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sections.length, 2);
});

test("a section with no instructor is kept and sorted last", () => {
  const groups = groupByInstructor([
    section(1001),
    taught(1002, MWF, "9:00 AM", "9:55 AM", ["Ann Taylor"]),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ["Ann Taylor", "Instructor not listed"]);
  assert.deepEqual(groups[1].people, []);
});

test("groupByInstructor handles no sections at all", () => {
  assert.deepEqual(groupByInstructor([]), []);
  assert.deepEqual(groupByInstructor(null), []);
});

// Regression, #15. The acceptance criterion was that no section may disappear,
// and filing a co-taught section under each name would inflate the count the
// other way.
test("regression #15: grouping preserves the section count exactly", () => {
  const sections = [
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Paolo Bucci"]),
    taught(1002, MWF, "10:20 AM", "11:15 AM", ["Paolo Bucci"]),
    taught(1003, MWF, "9:00 AM", "9:55 AM", ["Steve Gomori"]),
    taught(1004, MWF, "1:00 PM", "1:55 PM", ["Ann Taylor", "Bob Roberts"]),
    taught(1005, MWF, "2:00 PM", "2:55 PM", ["Bob Roberts", "Ann Taylor"]),
    section(1006),
  ];
  const groups = groupByInstructor(sections);

  const grouped = groups.reduce((n, g) => n + g.sections.length, 0);
  assert.equal(grouped, sections.length, "no section added or lost");

  const numbers = groups.flatMap((g) => g.sections.map((s) => s.classNumber)).sort();
  assert.deepEqual(numbers, [1001, 1002, 1003, 1004, 1005, 1006]);
});

// Regression, #15. "Ivan C. Smith III" sorts under Smith, not under III.
test("regression #15: sorting skips generational suffixes", () => {
  const groups = groupByInstructor([
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Ann Taylor"]),
    taught(1002, MWF, "9:00 AM", "9:55 AM", ["Ivan C. Smith III"]),
    taught(1003, MWF, "9:00 AM", "9:55 AM", ["Bob Roberts"]),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ["Bob Roberts", "Ivan C. Smith III", "Ann Taylor"]);
});

test("regression #15: the suffix is skipped with or without a trailing dot", () => {
  const groups = groupByInstructor([
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Ann Taylor"]),
    taught(1002, MWF, "9:00 AM", "9:55 AM", ["John Doe Jr."]),
    taught(1003, MWF, "9:00 AM", "9:55 AM", ["Henry Ford Sr"]),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ["John Doe Jr.", "Henry Ford Sr", "Ann Taylor"]);
});

test("a co-taught key is alphabetical and sorts on its first name", () => {
  const groups = groupByInstructor([
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Zoe Adams", "Bob Roberts"]),
    taught(1002, MWF, "9:00 AM", "9:55 AM", ["Ann Taylor"]),
  ]);
  // The key is built from the sorted names, so the pair files under Roberts.
  assert.deepEqual(groups.map((g) => g.key), ["Bob Roberts & Zoe Adams", "Ann Taylor"]);
});

// Regression, #60 with #67. 1010 is a lab with 5 of 24 taken that went full to
// open overnight, and 1002, the lecture it auto-enrolls you into, is 40/40. The
// seats it opened cannot be registered, and "hide full" already drops the row
// for that reason, so the badge cannot say otherwise. 1012's lecture is open.
test("regression #60: the opened mark waits on the section it enrolls you into", async () => {
  setupDom();
  await withSeats(["1268"]);
  await withTrend(["1268"], "", { "1268": { ...TREND["1268"], opened: ["1010", "1012"] } });

  const reachable = renderSection(section(1012), "1268");
  assert.equal(
    reachable.querySelector(".opened")?.title,
    "Full in the previous snapshot, open in the one from 2026-08-18.",
    "the fixture's own night, so the trend route really was read"
  );

  const blocked = renderSection(section(1010), "1268");
  assert.equal(blocked.querySelector(".opened"), null, "1002 is 40/40, so nobody can take the seats 1010 opened");
  assert.equal(blocked.querySelector(".seats").textContent, "5/24", "the row still reports its own count");
});
