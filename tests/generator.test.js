import test from "node:test";
import assert from "node:assert/strict";

import {
  describePackage, expandCoursePackages, generateSchedules, instructionModeOf, packageKey, scoreCombination,
} from "../js/generator.js";
import { entry, taught } from "./fixtures.js";

const TERM = "1268";

function linked(rows) {
  return (number) => rows[String(number)] ?? null;
}

function providers(seats = {}, ratings = {}) {
  return {
    seatsFor: (number) => seats[String(number)] ?? null,
    ratingFor: (name) => ratings[name] ?? null,
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
  ));
  assert.equal(pkg.minSeats, 1);
  assert.equal(pkg.hasFull, false);
  assert.equal(pkg.rating, 4.5);
  assert.equal(pkg.ranges.length, 2);
});

test("instruction modes distinguish asynchronous online sections from arranged meetings", () => {
  assert.equal(instructionModeOf({ instructionMode: "Distance Learning", meetings: [] }), "distance");
  assert.equal(instructionModeOf({ instructionMode: "Hybrid Delivery", meetings: [] }), "hybrid");
  assert.equal(instructionModeOf({ instructionMode: "In Person", meetings: [] }), "inPerson");
  assert.equal(instructionModeOf({ meetings: [] }), "arranged");
});

test("a known full linked section is excluded even when another has unknown seats", () => {
  const found = entry("CSE", "2221", "Software 1", [
    taught(1001, ["monday"], "9:00 AM", "9:55 AM", ["Ada Teacher"]),
    taught(1011, ["tuesday"], "10:00 AM", "10:55 AM", ["Ada Teacher"], { component: "Laboratory" }),
  ]);
  const pkg = describePackage({ course: found.course, sections: found.sections }, TERM, providers({
    1011: { enrolled: 20, limit: 20, full: true },
  }));
  assert.equal(pkg.minSeats, null);
  assert.equal(pkg.hasFull, true);
  assert.equal(generateSchedules([{ course: found.course, packages: [pkg] }]).results.length, 0);
});

test("a registration package whose own linked meetings overlap is invalid", () => {
  const a = candidate("CSE", "2221", 1001, ["monday"], "9:00", "10:00");
  const b = candidate("CSE", "2221", 1011, ["monday"], "9:00", "10:00");
  const pkg = { ...a, sections: [...a.sections, ...b.sections], ranges: [...a.ranges, ...b.ranges] };
  assert.equal(generateSchedules([{ course: a.course, packages: [pkg] }]).results.length, 0);
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
      classNumber: String(classNumber),
    })))),
    minSeats: metrics.minSeats ?? 5,
    rating: metrics.rating ?? 4,
    modes: metrics.modes ?? ["inPerson"],
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

test("earliest and latest bounds apply to every linked meeting", () => {
  const early = candidate("CSE", "2221", 1001, ["monday"], "8:00", "9:00");
  const middle = candidate("CSE", "2221", 1002, ["monday"], "10:00", "11:00");
  const late = candidate("CSE", "2221", 1003, ["monday"], "5:00", "6:00");
  // The helper uses hour values directly; replace the afternoon ranges to keep
  // the fixture terse without teaching it am/pm parsing.
  late.ranges = [{ day: "monday", start: 17 * 60, end: 18 * 60, classNumber: "1003" }];
  const generated = generateSchedules([
    { course: middle.course, packages: [early, middle, late] },
  ], { earliest: 9 * 60, latest: 17 * 60 });
  assert.deepEqual(generated.results.map((result) => result.packages[0].sections[0].classNumber), [1002]);
});

test("ranking rewards seats, instructor ratings and compact schedules", () => {
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

test("instruction-mode filters and pins constrain complete packages", () => {
  const inPerson = candidate("CSE", "2221", 1001, ["monday"], "10:00", "11:00");
  const distance = candidate("CSE", "2221", 1002, [], "10:00", "11:00", { modes: ["distance"] });
  const group = { key: "CSE 2221", course: inPerson.course, packages: [inPerson, distance] };

  assert.deepEqual(generateSchedules([group], { allowedModes: ["distance"] }).results
    .map((result) => result.packages[0].sections[0].classNumber), [1002]);
  assert.deepEqual(generateSchedules([group], { pins: { "CSE 2221": packageKey(inPerson.sections) } }).results
    .map((result) => result.packages[0].sections[0].classNumber), [1001]);
});

test("empty results explain blocking constraints and course conflicts", () => {
  const full = candidate("CSE", "2221", 1001, ["monday"], "10:00", "11:00", { minSeats: 0 });
  const blocked = generateSchedules([{ key: "CSE 2221", label: "CSE 2221", packages: [full] }]);
  assert.equal(blocked.diagnostics.blockedGroups[0].removed.full, 1);

  const cse = candidate("CSE", "2221", 1002, ["monday"], "10:00", "11:00");
  const math = candidate("MATH", "1151", 2001, ["monday"], "10:00", "11:00");
  cse.desiredLabel = "CSE 2221";
  math.desiredLabel = "MATH 1151";
  const conflict = generateSchedules([
    { key: "CSE 2221", packages: [cse] },
    { key: "MATH 1151", packages: [math] },
  ]);
  assert.deepEqual(conflict.diagnostics.conflicts[0], {
    a: "CSE 2221", b: "MATH 1151", count: 1, days: ["monday"],
  });
});

test("ranked results prefer alternatives that change more than one course", () => {
  const groups = ["CSE", "MATH", "STAT"].map((subject, groupIndex) => ({
    key: `${subject} 1000`,
    packages: [0, 1].map((variant) => candidate(
      subject, "1000", groupIndex * 10 + variant,
      [groupIndex === 0 ? "monday" : groupIndex === 1 ? "tuesday" : "wednesday"],
      `${9 + variant}:00`, `${10 + variant}:00`, { minSeats: 10 - variant },
    )),
  }));
  const generated = generateSchedules(groups, { maxResults: 2 });
  const changed = generated.results[0].packages.filter((pkg, index) =>
    packageKey(pkg.sections) !== packageKey(generated.results[1].packages[index].sections)).length;
  assert.ok(changed >= 2);
});

test("generation reports when its work budget truncates the search", () => {
  const groups = ["CSE", "MATH", "STAT"].map((subject, i) => ({
    course: { subject, catalogNumber: "1000" },
    packages: [0, 1, 2].map((n) => candidate(subject, "1000", i * 10 + n, ["monday"], `${8 + n}:00`, `${9 + n}:00`)),
  }));
  const generated = generateSchedules(groups, { maxVisited: 2 });
  assert.equal(generated.truncated, true);
});
