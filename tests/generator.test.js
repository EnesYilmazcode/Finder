import test from "node:test";
import assert from "node:assert/strict";

import { describePackage, expandCoursePackages, generateSchedules, scoreCombination } from "../js/generator.js";
import { entry, taught } from "./fixtures.js";

const TERM = "1268";

function linked(rows) {
  return (number) => rows[String(number)] ?? null;
}

function providers(seats = {}, ratings = {}, grades = {}) {
  return {
    seatsFor: (number) => seats[String(number)] ?? null,
    ratingFor: (name) => ratings[name] ?? null,
    gradesFor: (person) => grades[person.name] ?? null,
  };
}

test("linked lectures and recitations become complete deduplicated packages", () => {
  const found = entry("CSE", "2221", "Software 1", [
    taught(1001, ["monday"], "9:00 AM", "9:55 AM", ["Ada Teacher"]),
    taught(1011, ["tuesday"], "9:00 AM", "9:55 AM", ["Ada Teacher"], { component: "Recitation" }),
    taught(1012, ["tuesday"], "10:00 AM", "10:55 AM", ["Ada Teacher"], { component: "Recitation" }),
  ]);
  const result = expandCoursePackages(found, TERM, linked({
    1001: { enrolledBy: ["1011", "1012"], enrolls: [] },
    1011: { enrolls: ["1001"], enrolledBy: [] },
    1012: { enrolls: ["1001"], enrolledBy: [] },
  }));

  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.packages.map((pkg) => pkg.sections.map((section) => section.classNumber)), [
    [1001, 1011],
    [1001, 1012],
  ]);
});

test("a shared child satisfies both required parents", () => {
  const found = entry("CHEM", "1110", "Chemistry", [
    taught(2001, ["monday"], "9:00 AM", "9:55 AM", ["Ada Teacher"]),
    taught(2002, ["wednesday"], "9:00 AM", "9:55 AM", ["Ada Teacher"]),
    taught(2010, ["friday"], "9:00 AM", "9:55 AM", ["Ada Teacher"], { component: "Laboratory" }),
  ]);
  const result = expandCoursePackages(found, TERM, linked({
    2001: { enrolledBy: ["2010"], enrolls: [] },
    2002: { enrolledBy: ["2010"], enrolls: [] },
    2010: { enrolls: ["2001", "2002"], enrolledBy: [] },
  }));
  assert.equal(result.packages.length, 1);
  assert.deepEqual(result.packages[0].sections.map((section) => section.classNumber).sort(), [2001, 2002, 2010]);
});

test("missing linked sections are reported and incomplete packages are omitted", () => {
  const found = entry("CSE", "2221", "Software 1", [
    taught(1001, ["monday"], "9:00 AM", "9:55 AM", ["Ada Teacher"]),
  ]);
  const result = expandCoursePackages(found, TERM, linked({
    1001: { enrolledBy: ["1011"], enrolls: [] },
  }));
  assert.deepEqual(result.packages, []);
  assert.deepEqual(result.missing, ["1011"]);
});

test("package evidence uses the scarcest linked section and ignores thin ratings", () => {
  const found = entry("CSE", "2221", "Software 1", [
    taught(1001, ["monday"], "9:00 AM", "9:55 AM", ["Ada Teacher"]),
    taught(1011, ["tuesday"], "10:00 AM", "10:55 AM", ["Thin Teacher"], { component: "Laboratory" }),
  ]);
  const pkg = describePackage({ course: found.course, sections: found.sections }, TERM, providers(
    { 1001: { enrolled: 30, limit: 40 }, 1011: { enrolled: 19, limit: 20 } },
    { "Ada Teacher": { avgRating: 4.5, numRatings: 20 }, "Thin Teacher": { avgRating: 5, numRatings: 1 } },
    { "Ada Teacher": { gpa: 3.4, n: 80 } },
  ));
  assert.equal(pkg.minSeats, 1);
  assert.equal(pkg.rating, 4.5);
  assert.equal(pkg.gpa, 3.4);
  assert.equal(pkg.ranges.length, 2);
});

function candidate(subject, number, classNumber, days, start, end, metrics = {}) {
  const found = entry(subject, number, subject, [taught(classNumber, days, start, end, ["Ada Teacher"])]);
  return {
    course: found.course,
    sections: found.sections,
    ranges: found.sections.flatMap((section) => section.meetings.flatMap((meeting) => days.map((day) => ({
      day,
      start: Number(start.split(":")[0]) * 60,
      end: Number(end.split(":")[0]) * 60,
    })))),
    minSeats: metrics.minSeats ?? 5,
    rating: metrics.rating ?? 4,
    gpa: metrics.gpa ?? 3,
  };
}

test("generation rejects course conflicts, busy periods and full packages", () => {
  const cseMorning = candidate("CSE", "2221", 1001, ["monday"], "9:00", "10:00");
  const cseLate = candidate("CSE", "2221", 1002, ["monday"], "11:00", "12:00");
  const mathConflict = candidate("MATH", "1151", 2001, ["monday"], "9:00", "10:00");
  const mathOpen = candidate("MATH", "1151", 2002, ["tuesday"], "11:00", "12:00");
  const mathFull = candidate("MATH", "1151", 2003, ["wednesday"], "11:00", "12:00", { minSeats: 0 });

  const generated = generateSchedules([
    { course: cseMorning.course, packages: [cseMorning, cseLate] },
    { course: mathOpen.course, packages: [mathConflict, mathOpen, mathFull] },
  ], { busy: [{ days: ["monday"], start: 11 * 60, end: 12 * 60 }] });

  assert.equal(generated.truncated, false);
  assert.equal(generated.results.length, 1);
  assert.deepEqual(generated.results[0].packages.map((pkg) => pkg.sections[0].classNumber).sort(), [1001, 2002]);
});

test("ranking rewards seats, evidence and compact schedules", () => {
  const strong = [
    candidate("CSE", "2221", 1001, ["monday"], "10:00", "11:00", { minSeats: 10, rating: 4.5, gpa: 3.7 }),
    candidate("MATH", "1151", 2001, ["monday"], "11:00", "12:00", { minSeats: 8, rating: 4.2, gpa: 3.5 }),
  ];
  const weak = [
    candidate("CSE", "2221", 1002, ["monday"], "8:00", "9:00", { minSeats: 1, rating: 2.5, gpa: 2.2 }),
    candidate("MATH", "1151", 2002, ["friday"], "4:00", "5:00", { minSeats: 1, rating: 2.8, gpa: 2.4 }),
  ];
  assert.ok(scoreCombination(strong).score > scoreCombination(weak).score);
  assert.equal(scoreCombination(strong).metrics.days, 1);
  assert.equal(scoreCombination(strong).metrics.gaps, 0);
});

test("generation reports when its work budget truncates the search", () => {
  const groups = ["CSE", "MATH", "STAT"].map((subject, i) => ({
    course: { subject, catalogNumber: "1000" },
    packages: [0, 1, 2].map((n) => candidate(subject, "1000", i * 10 + n, ["monday"], `${8 + n}:00`, `${9 + n}:00`)),
  }));
  const generated = generateSchedules(groups, { maxVisited: 2 });
  assert.equal(generated.truncated, true);
});
