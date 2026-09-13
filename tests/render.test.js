// The pure orderings, plus the one row rule that needs a rendered row to see.

import test from "node:test";
import assert from "node:assert/strict";

import { groupByInstructor, renderCourse, renderSection, sortSections } from "../js/render.js";
import { attr, entry, meeting, section, taught, TREND } from "./fixtures.js";
import { setupDom } from "./dom.js";
import { withRatings, withSeats, withTrend } from "./helpers.js";

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

// #68. The strip is one primitive with one cap, and it is a column-2 extra like
// the section's own place line, so it lands ahead of the third column's cell.
// Four flags are true here and the row shows the two that decide the most.
test("the row carries the first two flags and the pane takes the rest", () => {
  setupDom();
  const li = renderSection(
    section(1001, { consent: "I", career: "GRAD", waitlistCapacity: 0, sessionCode: "B" }),
    "1268"
  );
  const chips = li.querySelectorAll(".flags .flag");
  assert.deepEqual(chips.map((chip) => chip.dataset.flag), ["consent", "career"]);
  assert.deepEqual(chips.map((chip) => chip.textContent), ["Permission required", "Graduate"]);
  assert.equal(chips[0].title, "You cannot register for this one yourself. It needs permission first.");
  assert.deepEqual(
    li.children.map((node) => node.className),
    ["section-number", "section-when", "section-where", "flags", "seat-cell"]
  );
});

// Regression, #82. Class 15613 meets Fr 11:10a in CE 310 and again Mo 8:00a in
// EL 2002, and the row named only the Friday half.
test("regression #82: a second meeting gets its own line on the row", () => {
  setupDom();
  const li = renderSection(section(1001, {
    meetings: [
      meeting(["friday"], "11:10 AM", "2:05 PM", [], { buildingDescriptionShort: "CE 310" }),
      meeting(["monday"], "8:00 AM", "8:55 AM", [], { buildingDescriptionShort: "EL 2002" }),
    ],
  }), "1268");
  assert.equal(li.querySelector(".section-where").textContent, "CE 310");
  assert.deepEqual(
    li.querySelectorAll(".section-also").map((node) => node.textContent),
    ["Mo 8:00a–8:55a · EL 2002"]
  );
  // The extra sits under the line it belongs to, ahead of the seat cell, or the
  // grid slides the seat count onto the Monday meeting's row.
  assert.deepEqual(
    li.children.map((node) => node.className),
    ["section-number", "section-when", "section-where", "section-also", "seat-cell"]
  );
});

// The API lists one pattern once per room label it holds, so a repeat is not a
// second meeting. CSE 2112 class 8823 sends ten of them for one Tuesday class.
test("regression #82: a pattern repeated per room label is one line", () => {
  setupDom();
  const li = renderSection(section(1002, {
    meetings: [
      meeting(["tuesday"], "2:20 PM", "3:40 PM", [], { buildingDescriptionShort: "BE 120", buildingDescription: "Baker Systems 120" }),
      meeting(["tuesday"], "2:20 PM", "3:40 PM", [], { buildingDescriptionShort: "BE 120", buildingDescription: "Baker Systems 470" }),
    ],
  }), "1268");
  assert.equal(li.querySelectorAll(".section-also").length, 0);
});

// #65 feeding #68's strip. A fee and an honors marking are chips of the same
// kind as a flag, so they share the strip and the cap rather than running a
// second identical set inline on the time line in a second colour.
test("a section's own attributes are chips in the same strip", () => {
  setupDom();
  const fee = attr("ALX", "72", "Digital Txtbook Fee(s): $72");
  const row = renderSection(section(1001, { attributes: [fee, attr("HON", "CHON", "Honors Course")] }), "1268");
  assert.deepEqual(
    row.querySelectorAll(".flags .flag").map((chip) => [chip.dataset.flag, chip.textContent]),
    [["ALX", "$72"], ["HON", "Honors"]]
  );
  assert.equal(row.querySelectorAll(".flag").length, 2, "every chip on the row is in the one strip");

  // The cap is the strip's, and something that can keep a student out outranks
  // what it will cost them.
  const blocked = renderSection(section(1002, { consent: "I", career: "GRAD", attributes: [fee] }), "1268");
  assert.deepEqual(blocked.querySelectorAll(".flags .flag").map((chip) => chip.dataset.flag), ["consent", "career"]);
});

// #65. ART 3009 declares nothing at the course level and carries the credit on
// every section, so without the fallback its header says nothing at all.
test("a course header badges the GE all of its sections agree on", () => {
  setupDom();
  const art = entry("ART", "3009", "Film/Video I", [
    section(1, { attributes: [attr("GE2", "F3", "GEN Foundation: Literary, Visual & Performing Arts")] }),
    section(2, { attributes: [attr("GE2", "F3", "GEN Foundation: Literary, Visual & Performing Arts")] }),
  ], { courseAttributes: [attr("", "", "")] });
  const head = renderCourse(art, "1268").querySelector(".course-head");
  assert.deepEqual(head.querySelectorAll(".flag").map((chip) => [chip.dataset.flag, chip.textContent]), [["GE2", "GE F3"]]);
});

test("labs and recitations follow the lecturer groups without TA ratings", () => {
  setupDom();
  const course = entry("CSE", "2221", "Software 1", [
    taught(1011, MWF, "10:20 AM", "11:15 AM", ["Timothy Long"], { component: "Recitation" }),
    taught(1001, MWF, "9:00 AM", "9:55 AM", ["Diana Ikenberry Kline"]),
    taught(1012, MWF, "11:30 AM", "12:25 PM", ["Ivan C. Smith III"], { component: "Laboratory" }),
  ]);

  const rendered = renderCourse(course, "1268");
  assert.deepEqual(rendered.querySelectorAll(".teacher .section").map((row) => row.dataset.classNumber), ["1001"]);
  assert.deepEqual(rendered.querySelectorAll(".supporting .section").map((row) => row.dataset.classNumber), ["1012", "1011"]);
  assert.deepEqual(rendered.querySelectorAll(".supporting .section-who").map((node) => node.textContent), [
    "Ivan C. Smith III", "Timothy Long",
  ]);
  assert.equal(rendered.querySelector(".supporting .score"), null);
  assert.equal(rendered.querySelector(".supporting [data-flag='assistant']"), null);
  assert.deepEqual(rendered.querySelectorAll(".supporting .linked").map((node) => node.textContent), ["with 1001 30/40", "with 1001 30/40"]);
  assert.match(rendered.querySelector(".supporting-note").textContent, /after the lecture/i);
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
