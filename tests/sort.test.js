import test from "node:test";
import assert from "node:assert/strict";

import { isSortKey, orderBy, sortEntries, sortValue, unknownSections } from "../js/sort.js";
import { entry, meeting, section, taught } from "./fixtures.js";
import { withRatings, withSeats } from "./helpers.js";

// sort.js reads seats and ratings through the shared module state, the same way
// filters.js does, so the real snapshots have to be in place first.
await withSeats();
await withRatings();

const TERM = "1268";
const MWF = ["monday", "wednesday", "friday"];

// From the seat snapshot: 1001 has 10 left, 1007 has 25, 1002 is exactly full,
// 1003 is over cap, and 1004 publishes no capacity at all.
const open = taught(1001, MWF, "9:00 AM", "9:55 AM", ["Timothy Long"]);
const roomy = taught(1007, MWF, "10:00 AM", "10:55 AM", ["Diana Ikenberry Kline"]);
const full = taught(1002, MWF, "11:00 AM", "11:55 AM", ["Ivan C. Smith III"]);
const overCap = taught(1003, MWF, "1:00 PM", "1:55 PM", ["Stephen Gomori"]);
const noCapacity = taught(1004, MWF, "2:00 PM", "2:55 PM", ["Timothy Long"]);
const unlisted = taught(5003, MWF, "3:00 PM", "3:55 PM", ["Diana Ikenberry Kline"]);
const thin = taught(5001, MWF, "9:00 AM", "9:55 AM", ["Wes Fenwick"]);
const noDifficulty = taught(5002, MWF, "9:00 AM", "9:55 AM", ["Ada Nkemelu"]);

test("the rating of a set of sections is its best rated instructor", () => {
  assert.equal(sortValue([open, roomy], "rating", TERM), 4.2);
  assert.equal(sortValue([open], "rating", TERM), 3.4);
});

test("an unrated instructor is unknown, not a zero", () => {
  assert.equal(sortValue([taught(1001, MWF, "9:00 AM", "9:55 AM", ["Nobody Here"])], "rating", TERM), null);
  // Two Alan Reeds, so ratingFor refuses to guess. That is unknown as well.
  assert.equal(sortValue([taught(1001, MWF, "9:00 AM", "9:55 AM", ["Alan Reed"])], "rating", TERM), null);
  assert.equal(sortValue([section(1001)], "rating", TERM), null);
});

test("difficulty is the lowest reported, and it is not the rating upside down", () => {
  const both = [roomy, full];
  assert.equal(sortValue(both, "rating", TERM), 4.2);      // Kline
  assert.equal(sortValue(both, "difficulty", TERM), 1.4);  // Smith
});

// Fenwick is a 5.0 and a 1.0 from one student. render.js already draws that as
// thin evidence, so the sort must not seat it above a reviewed 4.2.
test("a score from too few students is unknown, not a five", () => {
  assert.equal(sortValue([thin], "rating", TERM), null);
  assert.equal(sortValue([thin], "difficulty", TERM), null);
  const sorted = orderBy([thin, roomy], (s) => [s], "rating", TERM);
  assert.deepEqual(sorted.map((s) => s.classNumber), [1007, 5001]);
});

test("a difficulty the snapshot never got is unknown, not a zero", () => {
  assert.equal(sortValue([noDifficulty], "difficulty", TERM), null);
  assert.equal(sortValue([noDifficulty], "rating", TERM), 4.1, "the rating still counts");
});

test("seats are the most left across the sections", () => {
  assert.equal(sortValue([open, roomy], "seats", TERM), 25);
  assert.equal(sortValue([open], "seats", TERM), 10);
});

test("a full or over-enrolled section has no seats left rather than negative ones", () => {
  assert.equal(sortValue([full], "seats", TERM), 0);
  assert.equal(sortValue([overCap], "seats", TERM), 0);
});

test("a section the seat snapshot does not cover is unknown, not full", () => {
  assert.equal(sortValue([unlisted], "seats", TERM), null);
  // No published capacity is the same kind of unknown, and seatsFor already
  // refuses to call it 0/0.
  assert.equal(sortValue([noCapacity], "seats", TERM), null);
});

test("seats for a term that has not loaded read as unknown", () => {
  assert.equal(sortValue([open, roomy], "seats", "1262"), null);
});

test("the start time is the earliest meeting the section has", () => {
  const twice = section(1001, {
    meetings: [meeting(["tuesday"], "1:00 PM", "1:55 PM"), meeting(["thursday"], "8:30 AM", "9:25 AM")],
  });
  assert.equal(sortValue([twice], "start", TERM), 510);
  assert.equal(sortValue([open, overCap], "start", TERM), 540);
});

test("a section with no meeting pattern has no start time", () => {
  assert.equal(sortValue([section(5004, { meetings: [] })], "start", TERM), null);
  assert.equal(sortValue([section(5004, { meetings: [meeting(["monday"])] })], "start", TERM), null);
});

test("a key the app does not offer scores nothing", () => {
  for (const key of ["", "lol", "toString", null, undefined]) {
    assert.equal(sortValue([open], key, TERM), null, `${key} should not score`);
  }
});

test("isSortKey accepts what the rail offers and nothing else", () => {
  for (const key of ["rating", "difficulty", "seats", "start"]) assert.equal(isSortKey(key), true, key);
  for (const key of ["", " ", "relevance", "toString", null, undefined]) assert.equal(isSortKey(key), false, `${key}`);
});

test("sections order by start time, earliest first", () => {
  const list = [overCap, open, roomy];
  const sorted = orderBy(list, (s) => [s], "start", TERM);
  assert.deepEqual(sorted.map((s) => s.classNumber), [1001, 1007, 1003]);
  assert.deepEqual(list.map((s) => s.classNumber), [1003, 1001, 1007], "the input is left alone");
});

// The point of #63: unknown is not zero anywhere else in this codebase, so it
// must not become zero here. A section nobody has seat counts for belongs behind
// a section that is genuinely full, not tied with it.
test("unknown seats sit behind no seats, not among them", () => {
  const sorted = orderBy([unlisted, full, open], (s) => [s], "seats", TERM);
  assert.deepEqual(sorted.map((s) => s.classNumber), [1001, 1002, 5003]);
});

test("an inactive sort leaves the list in the order it arrived", () => {
  const list = [overCap, open, roomy];
  assert.deepEqual(orderBy(list, (s) => [s], "", TERM).map((s) => s.classNumber), [1003, 1001, 1007]);
});

test("a tie falls back to the order that already applied", () => {
  const byNumber = (a, b) => a.classNumber - b.classNumber;
  // Both are full, so the sort itself cannot separate them.
  const sorted = orderBy([overCap, full], (s) => [s], "seats", TERM, byNumber);
  assert.deepEqual(sorted.map((s) => s.classNumber), [1002, 1003]);
});

test("courses order by their best rated instructor, and unrated courses go last", () => {
  const entries = [
    entry("MATH", "1152", "Calculus II", [taught(2001, MWF, "9:00 AM", "9:55 AM", ["Nobody Here"])]),
    entry("MATH", "1151", "Calculus I", [open, roomy]),
    entry("MATH", "1172", "Engineering Math", [overCap]),
  ];
  const sorted = sortEntries(entries, "rating", TERM);
  assert.deepEqual(sorted.map((e) => e.course.catalogNumber), ["1172", "1151", "1152"]);
});

test("unknownSections counts sections, not courses", () => {
  const entries = [entry("MATH", "1151", "Calculus I", [open, unlisted, noCapacity])];
  assert.equal(unknownSections(entries, "seats", TERM), 2);
  assert.equal(unknownSections(entries, "rating", TERM), 0);
  assert.equal(unknownSections(entries, "", TERM), 0);
  assert.equal(unknownSections(null, "seats", TERM), 0);
});
