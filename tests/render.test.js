// Only the two pure orderings are covered here. Everything else in render.js
// builds DOM nodes and needs a document, which is out of scope for this suite.

import test from "node:test";
import assert from "node:assert/strict";

import { groupByInstructor, sortSections } from "../js/render.js";
import { section, taught } from "./fixtures.js";
import { withRatings, withSeats } from "./helpers.js";

await withRatings();
await withSeats();

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

// #63. Alphabetical is an ordering, not an answer. MATH 1151 returned 74
// sections on 2026-08-20, and the best rated instructor can sit anywhere in them.
test("a sort key orders instructor blocks by their best rating", () => {
  const groups = groupByInstructor([
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Ivan C. Smith III"]),
    taught(1002, MWF, "10:00 AM", "10:55 AM", ["Timothy Long"]),
    taught(1003, MWF, "11:00 AM", "11:55 AM", ["Nobody Here"]),
    taught(1004, MWF, "1:00 PM", "1:55 PM", ["Diana Ikenberry Kline"]),
  ], "rating");
  assert.deepEqual(groups.map((g) => g.key), [
    "Diana Ikenberry Kline",
    "Ivan C. Smith III",
    "Timothy Long",
    "Nobody Here",
  ]);
});

test("blocks the sort cannot place keep their alphabetical order at the end", () => {
  const groups = groupByInstructor([
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Zoe Zephyr"]),
    taught(1002, MWF, "10:00 AM", "10:55 AM", ["Ann Abbott"]),
    taught(1003, MWF, "11:00 AM", "11:55 AM", ["Timothy Long"]),
    section(1004),
  ], "rating");
  assert.deepEqual(groups.map((g) => g.key), [
    "Timothy Long",
    "Ann Abbott",
    "Zoe Zephyr",
    "Instructor not listed",
  ]);
});

test("sections inside a block order by start time when that is the sort", () => {
  const sections = [
    taught(1001, MWF, "1:00 PM", "1:55 PM", ["Timothy Long"]),
    taught(1002, MWF, "8:30 AM", "9:25 AM", ["Timothy Long"]),
    taught(1003, MWF, "10:20 AM", "11:15 AM", ["Timothy Long"]),
  ];
  assert.deepEqual(sortSections(sections, "start").map((s) => s.classNumber), [1002, 1003, 1001]);
});

// Every section in a block shares its instructors, so a rating sort ties across
// the whole block and must leave the lecture-first order alone.
test("a rating sort does not shuffle the sections inside a block", () => {
  const sections = [
    taught(1002, MWF, "9:00 AM", "9:55 AM", ["Timothy Long"], { component: "Recitation" }),
    taught(1001, MWF, "10:00 AM", "10:55 AM", ["Timothy Long"]),
  ];
  assert.deepEqual(sortSections(sections, "rating").map((s) => s.classNumber), [1001, 1002]);
  assert.deepEqual(sortSections(sections).map((s) => s.classNumber), [1001, 1002]);
});

// A recitation with seats is not a substitute for the lecture it hangs off, so
// seats and start order sections within a component instead of across them.
test("a seats or start sort leaves the lecture above its recitations", () => {
  const sections = [
    // 1001 has 10 seats left, 1003 is over cap, and the lecture is exactly full.
    taught(1001, MWF, "1:00 PM", "1:55 PM", ["Timothy Long"], { component: "Recitation" }),
    taught(1002, MWF, "10:00 AM", "10:55 AM", ["Timothy Long"]),
    taught(1003, MWF, "8:30 AM", "9:25 AM", ["Timothy Long"], { component: "Recitation" }),
  ];
  assert.deepEqual(sortSections(sections, "seats", "1268").map((s) => s.classNumber), [1002, 1001, 1003]);
  assert.deepEqual(sortSections(sections, "start", "1268").map((s) => s.classNumber), [1002, 1003, 1001]);
  assert.deepEqual(sortSections(sections).map((s) => s.classNumber), [1002, 1001, 1003]);
});
