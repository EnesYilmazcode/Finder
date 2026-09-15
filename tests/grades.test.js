import test from "node:test";
import assert from "node:assert/strict";

import { withGrades } from "./helpers.js";

const grades = await withGrades();

const who = (name, email = null) => ({ name, email });
const course = (subject, catalogNumber) => ({ subject, catalogNumber });

test("gradeKey takes the local part of an OSU address", () => {
  assert.equal(grades.gradeKey("bucci.2@osu.edu"), "bucci.2");
  assert.equal(grades.gradeKey("BUCCI.2@osu.edu"), "bucci.2");
});

test("gradeKey refuses anything that is not an address", () => {
  assert.equal(grades.gradeKey(null), "");
  assert.equal(grades.gradeKey(""), "");
  assert.equal(grades.gradeKey("bucci.2"), "");
  assert.equal(grades.gradeKey("@osu.edu"), "");
});

test("an address joins straight through to the curve", () => {
  const curve = grades.gradesFor(who("Paolo Bucci", "bucci.2@osu.edu"), course("CSE", "2221"));
  assert.equal(curve.n, 860);
  assert.equal(curve.sections, 22);
  assert.equal(curve.withdrew, 61);
});

test("the mean is grade points over graded students, not over everyone", () => {
  const curve = grades.gradesFor(who("Paolo Bucci", "bucci.2@osu.edu"), course("CSE", "2221"));
  // 61 withdrawals and 4 incompletes carry no points and are outside the mean.
  const expected = (180 * 4 + 120 * 3.7 + 95 * 3.3 + 140 * 3 + 60 * 2.7 + 45 * 2.3
    + 70 * 2 + 25 * 1.7 + 15 * 1.3 + 20 * 1 + 90 * 0) / 860;
  assert.ok(Math.abs(curve.gpa - expected) < 1e-9);
});

test("one instructor's two courses are two different curves", () => {
  const person = who("Paolo Bucci", "bucci.2@osu.edu");
  const first = grades.gradesFor(person, course("CSE", "2221"));
  const second = grades.gradesFor(person, course("CSE", "2231"));
  assert.notEqual(first.n, second.n);
  assert.ok(second.gpa > first.gpa);
});

test("a name finds the curve when the section carries no address", () => {
  const curve = grades.gradesFor(who("Diana Ikenberry Kline"), course("MATH", "1151"));
  assert.equal(curve.n, 104);
});

test("two people under one name return nothing rather than one of them", () => {
  assert.equal(grades.gradesFor(who("Alan Reed"), course("PHYSICS", "1250")), null);
});

test("a catalog number is matched exactly, so 1110.02 never answers for 1110.01", () => {
  const person = who("Diana Ikenberry Kline");
  assert.ok(grades.gradesFor(person, course("ENGLISH", "1110.01")));
  assert.equal(grades.gradesFor(person, course("ENGLISH", "1110.02")), null);
  assert.equal(grades.gradesFor(person, course("ENGLISH", "1110")), null);
});

test("an instructor with a record but not in this course reads as unknown", () => {
  assert.equal(grades.gradesFor(who("Paolo Bucci", "bucci.2@osu.edu"), course("MATH", "1151")), null);
});

test("an unknown instructor reads as unknown", () => {
  assert.equal(grades.gradesFor(who("Nobody Here", "nobody.1@osu.edu"), course("CSE", "2221")), null);
  assert.equal(grades.gradesFor(who(""), course("CSE", "2221")), null);
});

test("a course with no subject or number is not a lookup", () => {
  const person = who("Paolo Bucci", "bucci.2@osu.edu");
  assert.equal(grades.gradesFor(person, course("", "2221")), null);
  assert.equal(grades.gradesFor(person, {}), null);
});

test("a pass-fail course has no mean, however many students finished it", () => {
  const curve = grades.gradesFor(who("Ada Nkemelu", "nkemelu.4@osu.edu"), course("CSE", "4998"));
  // 140 satisfactory and unsatisfactory marks carry no points between them.
  assert.equal(curve, null);
});

test("a course whose every section was withheld is not a course with no students", () => {
  const person = who("Wes Fenwick", "fenwick.9@osu.edu");
  assert.equal(grades.gradesFor(person, course("CSE", "5911")), null);
  // The row still exists, which is what separates withheld from never taught.
  assert.equal(grades.gradesOverall(person), null);
});

test("suppressed sections ride along with the curve they are missing from", () => {
  const curve = grades.gradesFor(who("Paolo Bucci", "bucci.2@osu.edu"), course("CSE", "2221"));
  assert.equal(curve.suppressed, 2);
});

test("a malformed counts row reads as unknown, never as zero", () => {
  const person = who("Stephen Gomori", "gomori.1@osu.edu");
  assert.equal(grades.gradesFor(person, course("CSE", "1223")), null, "too few columns");
  assert.equal(grades.gradesFor(person, course("CSE", "1224")), null, "a negative count");
});

test("gpaOf refuses a row that is not the eleven marks", () => {
  assert.equal(grades.gpaOf(null), null);
  assert.equal(grades.gpaOf([1, 2, 3]), null);
  assert.equal(grades.gpaOf(new Array(11).fill(0)), null, "nobody graded is no mean");
  assert.equal(grades.gpaOf(["4", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), null);
});

test("gpaOf puts an all-A course at 4.0 and an all-E course at 0", () => {
  const only = (i) => { const row = new Array(11).fill(0); row[i] = 10; return row; };
  assert.equal(grades.gpaOf(only(0)).gpa, 4);
  assert.equal(grades.gpaOf(only(10)).gpa, 0);
  assert.equal(grades.gpaOf(only(10)).n, 10);
});

test("aShare counts A and A- and nothing else", () => {
  const curve = grades.gradesFor(who("Paolo Bucci", "bucci.2@osu.edu"), course("CSE", "2221"));
  assert.ok(Math.abs(grades.aShare(curve) - 300 / 860) < 1e-9);
  assert.equal(grades.aShare(null), null);
});

test("aShare separates two curves the mean cannot tell apart", () => {
  // Half A and half E against a course that is entirely B-: both average 2.0,
  // and only one of them is a coin flip.
  const split = [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10];
  const middle = [0, 0, 0, 0, 0, 0, 20, 0, 0, 0, 0];
  assert.equal(grades.gpaOf(split).gpa, grades.gpaOf(middle).gpa);
  assert.equal(grades.aShare({ counts: split, n: 20 }), 0.5);
  assert.equal(grades.aShare({ counts: middle, n: 20 }), 0);
});

test("gradesOverall adds an instructor's courses together", () => {
  const curve = grades.gradesOverall(who("Paolo Bucci", "bucci.2@osu.edu"));
  assert.equal(curve.n, 860 + 145);
  assert.equal(curve.sections, 28);
  assert.equal(curve.suppressed, 2);
});

test("gradeSpread draws only when somebody was graded", () => {
  const curve = grades.gradesFor(who("Paolo Bucci", "bucci.2@osu.edu"), course("CSE", "2221"));
  assert.equal(grades.gradeSpread(curve).total, 860);
  assert.equal(grades.gradeSpread(null), null);
  assert.equal(grades.gradeSpread({ n: 0, counts: new Array(11).fill(0) }), null);
});

test("the range says what the request covered", () => {
  assert.deepEqual(grades.gradesRange(), { first: "Autumn 2021", last: "Spring 2026", terms: 15 });
});

test("a thin curve is still returned, and says how thin", () => {
  const curve = grades.gradesFor(who("Nora Whitfield", "whitfield.2@osu.edu"), course("CSE", "3241"));
  assert.equal(curve.n, 8);
  assert.equal(curve.sections, 1);
});

test("the snapshot loaded, so nothing reads as failed or absent", () => {
  assert.equal(grades.gradesFailed(), false);
  assert.equal(grades.gradesAbsent(), false);
});

test("gradesStatus separates the three ways a curve can be absent", () => {
  assert.equal(grades.gradesStatus(who("Paolo Bucci", "bucci.2@osu.edu"), course("CSE", "2221")), "ready");
  // Every section too small to publish.
  assert.equal(grades.gradesStatus(who("Wes Fenwick", "fenwick.9@osu.edu"), course("CSE", "5911")), "withheld");
  // 140 students, all of them on satisfactory or unsatisfactory.
  assert.equal(grades.gradesStatus(who("Ada Nkemelu", "nkemelu.4@osu.edu"), course("CSE", "4998")), "ungraded");
  // No record of this person teaching this course.
  assert.equal(grades.gradesStatus(who("Paolo Bucci", "bucci.2@osu.edu"), course("MATH", "1151")), "unknown");
  assert.equal(grades.gradesStatus(who("Nobody Here", "nobody.1@osu.edu"), course("CSE", "2221")), "unknown");
});

test("a malformed row is unknown rather than withheld or ungraded", () => {
  const person = who("Stephen Gomori", "gomori.1@osu.edu");
  assert.equal(grades.gradesStatus(person, course("CSE", "1223")), "unknown");
  assert.equal(grades.gradesStatus(person, course("CSE", "1224")), "unknown");
});

test("withheldFor counts the withheld sections either way", () => {
  assert.equal(grades.withheldFor(who("Paolo Bucci", "bucci.2@osu.edu"), course("CSE", "2221")), 2, "a curve survived");
  assert.equal(grades.withheldFor(who("Wes Fenwick", "fenwick.9@osu.edu"), course("CSE", "5911")), 3, "none did");
  assert.equal(grades.withheldFor(who("Nobody Here"), course("CSE", "2221")), 0);
});

test("an unpublished file is an answer, not a failure, and is never asked for twice", async () => {
  let calls = 0;
  const { stubFetch } = await import("./helpers.js");
  const missing = await import("../js/grades.js?unpublished");
  const restore = stubFetch(() => { calls++; return { ok: false, status: 404, json: async () => ({}) }; });
  try {
    assert.equal(await missing.loadGrades("grades.json"), null);
    assert.equal(await missing.loadGrades("grades.json"), null);
  } finally {
    restore();
  }
  assert.equal(calls, 1, "a 404 settles it");
  assert.equal(missing.gradesAbsent(), true);
  assert.equal(missing.gradesFailed(), false);
  assert.equal(missing.gradesStatus(who("Paolo Bucci", "bucci.2@osu.edu"), course("CSE", "2221")), "unpublished");
});

test("a server error stays retryable, unlike a 404", async () => {
  const { stubFetch } = await import("./helpers.js");
  const broken = await import("../js/grades.js?broken");
  let restore = stubFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
  try {
    await assert.rejects(() => broken.loadGrades("grades.json"), /grades 500/);
  } finally {
    restore();
  }
  assert.equal(broken.gradesFailed(), true);
  assert.equal(broken.gradesAbsent(), false);

  // The retry lands, and the failure flag has to clear the way ratings.js does.
  const { GRADES } = await import("./fixtures.js");
  restore = stubFetch({ "grades.json": GRADES });
  try {
    await broken.loadGrades("grades.json");
  } finally {
    restore();
  }
  assert.equal(broken.gradesFailed(), false);
  assert.equal(broken.gradesFor(who("Paolo Bucci", "bucci.2@osu.edu"), course("CSE", "2221")).n, 860);
});
