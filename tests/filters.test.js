import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, toMinutes, isActive, applyFilters, parseBusy, formatBusy } from "../js/filters.js";
import { entry, meeting, section, taught } from "./fixtures.js";
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
  assert.equal(isActive(filters({ busy: [{ days: ["monday"], start: 540, end: 600 }] })), true);
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

// A lecture and its lab, which is what the first-meeting-only rule got wrong.
const split = section(6001, {
  meetings: [
    meeting(["monday", "wednesday"], "9:00 AM", "9:55 AM", []),
    meeting(["friday"], "6:00 PM", "8:00 PM", []),
  ],
});
const splitCourse = () => entry("BIOLOGY", "2105", "Lab", [split]);

test("regression #62: a time window judges every meeting, not just the first", () => {
  // The Friday lab runs to 8:00 pm, so this section does not end by noon. The
  // old rule read the 9:55 am lecture, the first meeting listed, and kept it.
  assert.equal(applyFilters([splitCourse()], filters({ to: "720" })).entries.length, 0);
});

test("regression #62: a floor on start reads past the first meeting too", () => {
  // Mirrored: the API lists the 2:00 pm lecture first, so reading only that hid
  // an 8:00 am lab from "starts no earlier than noon".
  const reversed = entry("CHEM", "1110", "Lab", [section(6002, {
    meetings: [
      meeting(["monday"], "2:00 PM", "3:00 PM", []),
      meeting(["friday"], "8:00 AM", "9:00 AM", []),
    ],
  })]);
  assert.equal(applyFilters([reversed], filters({ from: "720" })).entries.length, 0);
});

test("parseBusy reads the URL form", () => {
  assert.deepEqual(parseBusy("TuTh-575-655"), { days: ["tuesday", "thursday"], start: 575, end: 655 });
  assert.deepEqual(parseBusy("mo-480-540"), { days: ["monday"], start: 480, end: 540 });
  assert.deepEqual(parseBusy("MoWeFr-780-825").days, ["monday", "wednesday", "friday"]);
});

test("parseBusy returns null rather than guessing", () => {
  for (const junk of ["", "  ", null, undefined, "TuTh", "Xx-1-2", "Tut-1-2", "TuTh-655-575",
                      "TuTh-575-575", "TuTh-0-1441", "TuTh:575-655"]) {
    assert.equal(parseBusy(junk), null, `${junk} should not parse`);
  }
});

test("formatBusy writes days in week order", () => {
  // app.js hands formatBusy the days in whatever order they were clicked.
  assert.equal(formatBusy({ days: ["thursday", "tuesday"], start: 575, end: 655 }), "TuTh-575-655");
  assert.deepEqual(parseBusy(formatBusy(parseBusy("ThTu-575-655"))), parseBusy("TuTh-575-655"));
});

test("a busy block drops the sections that collide with it", () => {
  // Busy TuTh 6:00 pm to 7:00 pm, which is inside the evening section.
  const { entries, hiddenSections } = applyFilters(
    [course()],
    filters({ busy: [{ days: ["tuesday", "thursday"], start: 1080, end: 1140 }] })
  );
  assert.deepEqual(entries[0].sections.map((s) => s.classNumber), [1001, 5003, 5004]);
  assert.equal(hiddenSections, 1);
});

test("a busy block only judges the days it covers", () => {
  // The same hour, but on a day the evening section does not meet.
  const { entries } = applyFilters(
    [course()],
    filters({ busy: [{ days: ["monday"], start: 1080, end: 1140 }] })
  );
  assert.deepEqual(entries[0].sections.map((s) => s.classNumber), [1001, 1002, 5003, 5004]);
});

test("a busy block is half open, so touching edges are not a clash", () => {
  // The morning section runs 9:10 to 10:05 on MoWeFr.
  const before = filters({ busy: [{ days: ["monday"], start: 480, end: 550 }] });
  const after = filters({ busy: [{ days: ["monday"], start: 605, end: 700 }] });
  assert.ok(applyFilters([course()], before).entries[0].sections.some((s) => s.classNumber === 1001));
  assert.ok(applyFilters([course()], after).entries[0].sections.some((s) => s.classNumber === 1001));

  const across = filters({ busy: [{ days: ["monday"], start: 549, end: 551 }] });
  assert.ok(!applyFilters([course()], across).entries[0].sections.some((s) => s.classNumber === 1001));
});

test("a busy block checks every meeting of a section", () => {
  // Busy Friday evening, which only the second meeting runs into.
  const { entries } = applyFilters(
    [splitCourse()],
    filters({ busy: [{ days: ["friday"], start: 1140, end: 1200 }] })
  );
  assert.equal(entries.length, 0);
});

test("unknown meeting patterns never fail a busy block", () => {
  const { entries } = applyFilters(
    [course()],
    filters({ busy: [{ days: ["monday", "tuesday", "wednesday", "thursday", "friday"], start: 0, end: 1440 }] })
  );
  assert.deepEqual(
    entries[0].sections.map((s) => s.classNumber),
    [5003, 5004],
    "an online and an arranged section have no time to judge"
  );
});

test("a section with no end time still clashes with a block it starts inside", () => {
  const open = entry("CSE", "1", "T", [taught(7002, ["monday"], "9:00 AM", null, ["Someone"])]);
  const inside = filters({ busy: [{ days: ["monday"], start: 540, end: 600 }] });
  const outside = filters({ busy: [{ days: ["monday"], start: 600, end: 660 }] });
  assert.equal(applyFilters([open], inside).entries.length, 0);
  assert.equal(applyFilters([open], outside).entries.length, 1);
});

test("a meeting with no time never fails a time filter or a busy block", () => {
  // A lecture at a known hour plus a "Time to be announced" second meeting.
  const partial = entry("CSE", "3901", "Lab", [section(6003, {
    meetings: [
      meeting(["monday"], "9:00 AM", "10:00 AM", []),
      meeting(["friday"], null, null, []),
    ],
  })]);
  assert.equal(applyFilters([partial], filters({ from: "540", to: "660" })).entries.length, 1);
  assert.equal(
    applyFilters([partial], filters({ busy: [{ days: ["friday"], start: 0, end: 1440 }] })).entries.length,
    1
  );
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
