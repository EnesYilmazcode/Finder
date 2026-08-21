import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, toMinutes, isActive, applyFilters } from "../js/filters.js";
import { entry, section, taught } from "./fixtures.js";
import { withRatings, withSeats } from "./helpers.js";

// filters.js reads seats and ratings through the shared module state, so the
// real snapshots have to be in place before any of that is exercised.
await withSeats();
await withRatings();

const TERM = "1268";
const filters = (over = {}) => ({ ...DEFAULTS, term: TERM, ...over });

// 1001 is open in the snapshot and 1002 is full. 5003 and 5004 are absent from
// it, which is the unknown case.
const morning = taught(1001, ["monday", "wednesday", "friday"], "9:10 AM", "10:05 AM", ["Diana Ikenberry Kline"]);
const evening = taught(1002, ["tuesday", "thursday"], "6:30 PM", "7:50 PM", ["Nobody Here"]);
const online = section(5003, {
  instructionMode: "Distance Learning - Online",
  meetings: [],
});
const arranged = section(5004, { meetings: [] });

const course = () => entry("CSE", "2221", "Software I", [morning, evening, online, arranged]);

test("toMinutes reads a twelve hour clock", () => {
  assert.equal(toMinutes("8:00 am"), 480);
  assert.equal(toMinutes("9:10 AM"), 550);
  assert.equal(toMinutes("12:30 pm"), 750);
  assert.equal(toMinutes("6:30 pm"), 1110);
  assert.equal(toMinutes("11:59 pm"), 1439);
});

test("toMinutes puts midnight and noon on the right side of the day", () => {
  assert.equal(toMinutes("12:00 am"), 0);
  assert.equal(toMinutes("12:45 am"), 45);
  assert.equal(toMinutes("12:00 pm"), 720);
});

test("toMinutes tolerates a missing m and stray whitespace", () => {
  assert.equal(toMinutes("8:00a"), 480);
  assert.equal(toMinutes("  8:00   p  "), 1200);
});

test("toMinutes returns null rather than guessing", () => {
  for (const junk of ["", "   ", null, undefined, "8:00", "800am", "Time to be announced", "8:0 am"]) {
    assert.equal(toMinutes(junk), null, `${junk} should not parse`);
  }
});

test("isActive is false for the defaults", () => {
  assert.equal(isActive(DEFAULTS), false);
  assert.equal(isActive(filters()), false);
});

test("isActive notices any one filter", () => {
  assert.equal(isActive(filters({ days: ["monday"] })), true);
  assert.equal(isActive(filters({ from: "540" })), true);
  assert.equal(isActive(filters({ to: "1020" })), true);
  assert.equal(isActive(filters({ rating: "4" })), true);
  assert.equal(isActive(filters({ hideFull: true })), true);
  assert.equal(isActive(filters({ hideOnline: true })), true);
  assert.equal(isActive(filters({ ratedOnly: true })), true);
});

test("applyFilters is a pass through when nothing is set", () => {
  const entries = [course()];
  const result = applyFilters(entries, filters());
  assert.equal(result.entries, entries, "the same array comes back, not a copy");
  assert.equal(result.hiddenSections, 0);
  assert.equal(result.hiddenCourses, 0);
});

test("a day filter keeps sections that meet on all the chosen days", () => {
  const { entries } = applyFilters([course()], filters({ days: ["monday", "friday"] }));
  const kept = entries[0].sections.map((s) => s.classNumber);
  assert.ok(kept.includes(1001));
  assert.ok(!kept.includes(1002), "a TuTh section fails a MoFr filter");
});

test("unknown days never fail a day filter", () => {
  const { entries } = applyFilters([course()], filters({ days: ["monday"] }));
  const kept = entries[0].sections.map((s) => s.classNumber);
  assert.ok(kept.includes(5003), "an online section has no pattern to judge");
  assert.ok(kept.includes(5004), "neither does an arranged section");
});

test("a time window filters on start and end", () => {
  const early = applyFilters([course()], filters({ to: "780" })).entries[0].sections;
  assert.deepEqual(early.map((s) => s.classNumber), [1001, 5003, 5004]);

  const late = applyFilters([course()], filters({ from: "720" })).entries[0].sections;
  assert.deepEqual(late.map((s) => s.classNumber), [1002, 5003, 5004]);
});

test("unknown times never fail a time filter", () => {
  const { entries } = applyFilters([course()], filters({ from: "540", to: "660" }));
  const kept = entries[0].sections.map((s) => s.classNumber);
  assert.deepEqual(kept, [1001, 5003, 5004]);
});

test("a section with no end time is judged on its start", () => {
  const open = entry("CSE", "1", "T", [taught(7001, ["monday"], "9:00 AM", null, ["Someone"])]);
  assert.equal(applyFilters([open], filters({ to: "600" })).entries.length, 1);
  assert.equal(applyFilters([open], filters({ to: "500" })).entries.length, 0);
});

test("hideOnline drops only what the instruction mode says is online", () => {
  const { entries, hiddenSections } = applyFilters([course()], filters({ hideOnline: true }));
  assert.deepEqual(entries[0].sections.map((s) => s.classNumber), [1001, 1002, 5004]);
  assert.equal(hiddenSections, 1);
});

test("hideFull drops a full section and keeps one with no seat data", () => {
  const { entries } = applyFilters([course()], filters({ hideFull: true }));
  const kept = entries[0].sections.map((s) => s.classNumber);
  assert.ok(kept.includes(1001), "an open section stays");
  assert.ok(!kept.includes(1002), "a full section goes");
  assert.ok(kept.includes(5003) && kept.includes(5004), "unknown seats never fail the filter");
});

// Regression, #67. Barrett's autoenroll column says 1010 also puts you in
// 1002, and 1002 is full, so nobody can take 1010's nineteen free seats.
// Live equivalent in the 2026-08-20 snapshot: AEDECON 2005 lab 30779 reads
// 17/20 while the lecture it enrolls you into, 30778, is 40/40.
test("regression #67: hideFull drops a section whose registration includes a full one", () => {
  const linked = entry("CSE", "2221", "Software I", [
    taught(1010, ["tuesday"], "1:00 PM", "2:20 PM", ["Nobody Here"]),
  ]);
  const { entries, hiddenSections } = applyFilters([linked], filters({ hideFull: true }));
  assert.equal(entries.length, 0, "a lab you cannot register for is not an open section");
  assert.equal(hiddenSections, 1);
});

test("a lecture is not full because one of its recitations is", () => {
  // 1001 is reached through 1011, which is full, and 1012, which is not.
  // Treating the package as one undirected blob would hide the lecture and
  // every other recitation with it.
  const lecture = entry("MATH", "1151", "Calculus I", [
    taught(1001, ["monday"], "8:00 AM", "8:55 AM", ["Diana Ikenberry Kline"]),
    taught(1012, ["tuesday"], "8:00 AM", "8:55 AM", ["Nobody Here"]),
  ]);
  const { entries } = applyFilters([lecture], filters({ hideFull: true }));
  assert.deepEqual(entries[0].sections.map((s) => s.classNumber), [1001, 1012]);
});

// Regression, #67, the other direction. 1020 reads 44/46 and both recitations
// that lead into it are 22/22, which is all 44 of its students, so there is no
// way left to register. Live equivalent: MATH 1125 lecture 18027.
test("regression #67: hideFull drops a lecture whose every way in is full", () => {
  const lecture = entry("MATH", "1125", "Precalculus", [
    taught(1020, ["monday"], "9:00 AM", "9:55 AM", ["Nobody Here"]),
  ]);
  const { entries, hiddenSections } = applyFilters([lecture], filters({ hideFull: true }));
  assert.equal(entries.length, 0);
  assert.equal(hiddenSections, 1);
});

test("a lecture holding more students than its labs explain stays", () => {
  // 1030 is 107/126 and its one listed lab accounts for 21 of those, so Barrett
  // is not naming every way in and hiding the lecture would be a guess. Live
  // equivalent: MECHENG 4870 lecture 6243, 107/126 over a single 21/21 lab.
  const lecture = entry("MECHENG", "4870", "Design", [
    taught(1030, ["monday"], "9:00 AM", "9:55 AM", ["Nobody Here"]),
  ]);
  assert.equal(applyFilters([lecture], filters({ hideFull: true })).entries.length, 1);
});

test("a way in with no published capacity is not a full one", () => {
  // 1041 is full but 1042 publishes no capacity, so whether 1040 can still be
  // reached is unknown. This is what keeps MATH 1151 lecture 17826 on screen:
  // two of its six recitations have no capacity in Barrett.
  const lecture = entry("MATH", "1151", "Calculus I", [
    taught(1040, ["monday"], "9:00 AM", "9:55 AM", ["Nobody Here"]),
  ]);
  assert.equal(applyFilters([lecture], filters({ hideFull: true })).entries.length, 1);
});

test("no seat data of its own does not save a section under a full one", () => {
  // 1014 publishes no capacity, so nothing is known about its own seats, but
  // 1002 is 40/40 and registering for 1014 means registering for 1002.
  const lab = entry("CSE", "2221", "Software I", [
    taught(1014, ["friday"], "1:00 PM", "2:20 PM", ["Nobody Here"]),
  ]);
  assert.equal(applyFilters([lab], filters({ hideFull: true })).entries.length, 0);
});

test("hideFull hides nothing when the term does not match the snapshot", () => {
  const { entries, hiddenSections } = applyFilters([course()], filters({ hideFull: true, term: "1262" }));
  assert.equal(entries[0].sections.length, 4);
  assert.equal(hiddenSections, 0);
});

test("ratedOnly keeps sections whose instructor was matched", () => {
  const { entries } = applyFilters([course()], filters({ ratedOnly: true }));
  assert.deepEqual(entries[0].sections.map((s) => s.classNumber), [1001]);
});

test("a minimum rating compares against the best rated instructor on the section", () => {
  const cotaught = entry("CSE", "2231", "Software II", [
    taught(8001, ["monday"], "9:00 AM", "9:55 AM", ["Diana Ikenberry Kline", "Nobody Here"]),
  ]);
  assert.equal(applyFilters([cotaught], filters({ rating: "4" })).entries.length, 1);
  assert.equal(applyFilters([cotaught], filters({ rating: "4.5" })).entries.length, 0);
});

test("regression #50: a minimum rating keeps sections nobody has rated", () => {
  // Unrated is unknown, not bad. This used to seed the comparison at -1, so
  // every unrated instructor failed every threshold. With only about a third
  // of instructors rated, that silently removed most of the catalogue and made
  // this control imply the rated-only checkbox.
  const { entries } = applyFilters([course()], filters({ rating: "1" }));
  assert.deepEqual(
    entries[0].sections.map((s) => s.classNumber),
    [1001, 1002, 5003, 5004],
    "unrated instructors survive a minimum rating"
  );
});

test("regression #50: ratedOnly is what excludes the unrated", () => {
  // The two controls have to stay independent: rating filters quality,
  // ratedOnly filters presence.
  const { entries } = applyFilters([course()], filters({ ratedOnly: true }));
  assert.deepEqual(entries[0].sections.map((s) => s.classNumber), [1001]);
});

test("regression #50: a known rating below the threshold still fails", () => {
  // The fix must not turn the control off. Kline is rated 4.2 in the fixture.
  const { entries } = applyFilters([course()], filters({ rating: "4.5" }));
  assert.deepEqual(
    entries[0].sections.map((s) => s.classNumber),
    [1002, 5003, 5004],
    "the rated instructor below 4.5 is dropped, the unrated are not"
  );
});

test("applyFilters counts what it removed", () => {
  const other = entry("CSE", "2231", "Software II", [
    taught(9001, ["tuesday", "thursday"], "6:30 PM", "7:50 PM", ["Nobody Here"]),
  ]);
  const { entries, hiddenSections, hiddenCourses } = applyFilters(
    [course(), other],
    filters({ days: ["monday"] })
  );
  assert.equal(entries.length, 1, "the course with nothing left drops out");
  assert.equal(hiddenCourses, 1);
  assert.equal(hiddenSections, 2, "one TuTh section in each course");
});

test("applyFilters does not mutate the entries it was given", () => {
  const entries = [course()];
  applyFilters(entries, filters({ days: ["monday"] }));
  assert.equal(entries[0].sections.length, 4);
});
