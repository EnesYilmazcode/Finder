import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, toMinutes, isActive, applyFilters } from "../js/filters.js";
import { entry, meeting, onlineMeeting, section, taught } from "./fixtures.js";
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
  instructionMode: "Distance Learning",
  meetings: [onlineMeeting()],
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

test("regression #84: hideOnline drops a section OSU marks ONLINE", () => {
  // The mode never carries the word "online". The old version of this test
  // only passed because its fixture invented a mode that did.
  const { entries, hiddenSections } = applyFilters([course()], filters({ hideOnline: true }));
  assert.deepEqual(entries[0].sections.map((s) => s.classNumber), [1001, 1002, 5004]);
  assert.equal(hiddenSections, 1);
});

test("hideOnline leaves an arranged section alone", () => {
  // 5004 has no meetings, so there is nothing to judge it on.
  const { entries } = applyFilters([course()], filters({ hideOnline: true }));
  assert.ok(entries[0].sections.some((s) => s.classNumber === 5004));
});

test("hideOnline keeps a hybrid that still meets in a room", () => {
  // Hybrid Delivery mixes online and in person meetings. You still have to
  // show up for the in person half, so it is not an online section.
  const hybrid = entry("CSE", "2231", "Software II", [
    section(6001, {
      instructionMode: "Hybrid Delivery",
      meetings: [
        onlineMeeting(["monday"]),
        meeting(["wednesday"], "1:00 PM", "1:55 PM", [], { buildingDescriptionShort: "DL 266" }),
      ],
    }),
  ]);
  const { entries, hiddenSections } = applyFilters([hybrid], filters({ hideOnline: true }));
  assert.deepEqual(entries[0].sections.map((s) => s.classNumber), [6001]);
  assert.equal(hiddenSections, 0);
});

test("hideFull drops a full section and keeps one with no seat data", () => {
  const { entries } = applyFilters([course()], filters({ hideFull: true }));
  const kept = entries[0].sections.map((s) => s.classNumber);
  assert.ok(kept.includes(1001), "an open section stays");
  assert.ok(!kept.includes(1002), "a full section goes");
  assert.ok(kept.includes(5003) && kept.includes(5004), "unknown seats never fail the filter");
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
