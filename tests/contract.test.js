// What the nightly pipelines are allowed to write, and what the committed files
// have to look like.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BARRETT_SUBJECT } from "./fixtures.js";
import { countRefusal, refusalMessage, residueRefusal, subjectResidueRefusal } from "../scripts/guards.mjs";
import { previousCount, writeRefusals as ratingsRefusals } from "../scripts/fetch-ratings.mjs";
import { previousCounts, previousIndex, writeRefusals as coursesRefusals } from "../scripts/fetch-courses.mjs";
import { parseSubjectFile, previousSections, subjectRefusals, termProblem } from "../scripts/fetch-seats.mjs";

const DATA = join(dirname(dirname(fileURLToPath(import.meta.url))), "data");
const read = async (name) => JSON.parse(await readFile(join(DATA, name), "utf8"));
const MISSING = join(DATA, "no-such-file.json");

// force is passed explicitly so a FORCE_WRITE=1 left in a shell cannot change
// what any of these see.
const say = (refusals) => refusalMessage(refusals, false);

// One subject file as snapshotTerm sees it once it is parsed.
const parsed = (subject, sections, failures) => ({
  subject,
  offered: true,
  sections: Array(sections).fill(null),
  failures: Array(failures).fill("unreadable row"),
});

// One term as snapshotTerm reports it, healthy unless a field here says
// otherwise.
const termStats = (term, extra) => ({
  term,
  subjectsOffered: 200,
  subjectsFailed: 0,
  subjectsUnparsed: 0,
  sectionsParsed: 17692,
  residueRate: 0,
  ...extra,
});

// Key order is part of the deal, not just the key set: the scripts rely on
// insertion order to come out byte-identical when nothing upstream changed. A
// field one of the pipelines has learned to write since the snapshots were last
// committed goes in `optional`, so teaching it one is a line here rather than a
// red main the night after.
function assertKeys(value, required, optional, what) {
  const keys = Object.keys(value);
  assert.deepEqual(keys.filter((k) => required.includes(k)), required, `${what} is missing a key or reordered one`);
  const known = new Set([...required, ...optional]);
  assert.deepEqual(keys.filter((k) => !known.has(k)), [], `${what} has a key nothing expects`);
}

const PROFESSOR_KEYS = [
  "legacyId",
  "firstName",
  "lastName",
  "department",
  "avgRating",
  "numRatings",
  "avgDifficulty",
  "wouldTakeAgainPercent",
];
// Allowed ahead of #69, which writes the rating distribution as a ninth key.
const PROFESSOR_OPTIONAL = ["distribution"];

const SNAPSHOT_KEYS = ["term", "termName", "sourceUpdated", "sections"];
// Allowed ahead of #67, which writes the auto-enroll link groups as a fifth.
const SNAPSHOT_OPTIONAL = ["groups"];

test("ratings.json keeps its shape", async () => {
  const ratings = await read("ratings.json");
  assert.deepEqual(Object.keys(ratings), ["school", "count", "professors"]);
  assert.deepEqual(Object.keys(ratings.school), ["id", "legacyId", "name"]);
  assert.ok(ratings.professors.length > 0);
  assert.equal(ratings.count, ratings.professors.length);

  for (const p of ratings.professors) {
    assertKeys(p, PROFESSOR_KEYS, PROFESSOR_OPTIONAL, `professor ${p.legacyId}`);
    assert.equal(typeof p.legacyId, "number");
    assert.ok(p.numRatings > 0, `${p.legacyId} is unrated and should have been dropped`);
    // Upstream says -1 for "no data" on these three, which would render as a score.
    for (const key of ["avgRating", "avgDifficulty", "wouldTakeAgainPercent"]) {
      const value = p[key];
      assert.ok(value === null || value >= 0, `${p.legacyId} has ${key} ${value}`);
    }
  }
});

test("courses.json keeps its shape", async () => {
  const courses = await read("courses.json");
  assert.deepEqual(Object.keys(courses), ["source", "fields", "note", "terms"]);
  assert.deepEqual(courses.fields, ["catalogNumber", "title", "minUnits", "maxUnits"]);
  assert.ok(Object.keys(courses.terms).length > 0);

  for (const [strm, term] of Object.entries(courses.terms)) {
    assert.match(strm, /^\d{4}$/);
    assert.deepEqual(Object.keys(term), ["term", "name", "subjects"]);
    assert.equal(term.term, strm);
    assert.ok(term.subjects.length > 0);

    for (const subject of term.subjects) {
      assert.deepEqual(Object.keys(subject), ["code", "name", "courses"]);
      assert.ok(subject.courses.length > 0, `${strm} ${subject.code} is in the index with no courses`);
      for (const [catalog, title, minUnits, maxUnits] of subject.courses) {
        assert.ok(catalog, `${strm} ${subject.code} has a course with no catalog number`);
        assert.equal(typeof title, "string");
        assert.equal(typeof minUnits, "number");
        assert.equal(typeof maxUnits, "number");
      }
    }
  }
});

test("seats.json and the term files it lists agree", async () => {
  const index = await read("seats.json");
  assert.deepEqual(Object.keys(index), ["source", "fields", "note", "terms"]);
  assert.deepEqual(index.fields, ["enrolled", "limit", "waitlist"]);
  assert.ok(index.terms.length > 0);

  for (const entry of index.terms) {
    assert.deepEqual(Object.keys(entry), ["term", "termName", "sourceUpdated", "sections", "file"]);
    assert.equal(entry.file, `seats-${entry.term}.json`);
    assert.match(entry.sourceUpdated, /^\d{4}-\d{2}-\d{2}$/);

    const snapshot = await read(entry.file);
    assertKeys(snapshot, SNAPSHOT_KEYS, SNAPSHOT_OPTIONAL, entry.file);
    assert.equal(snapshot.term, entry.term);

    const rows = Object.entries(snapshot.sections);
    assert.equal(rows.length, entry.sections, `${entry.file} does not hold what the index says`);
    for (const [classNumber, row] of rows) {
      assert.match(classNumber, /^\d+$/);
      assert.equal(row.length, 3, `${entry.file} ${classNumber} is not enrolled/limit/waitlist`);
      for (const value of row) assert.equal(typeof value, "number");
    }
  }
});

test("a first run has only the floor to clear", () => {
  assert.equal(countRefusal("rated professors", 5001, 5000, 0), null);
  assert.ok(countRefusal("rated professors", 4999, 5000, 0));
});

// Regression, #59. The floors were the whole check, so a run that lost a third
// of the roster or four fifths of a term wrote itself over the good file.
test("regression #59: a collapse against the committed file is refused", () => {
  const roster = countRefusal("rated professors", 5001, 5000, 7367);
  assert.match(roster.reason, /5001/);
  assert.match(roster.reason, /7367/);
  assert.ok(countRefusal("term 1268 courses", 1201, 1200, 6072));
  assert.ok(countRefusal("term 1268 subjects", 100, 100, 243));
});

test("ordinary drift and growth still write", () => {
  assert.equal(countRefusal("term 1268 courses", 6000, 1200, 6072), null);
  assert.equal(countRefusal("term 1268 courses", 6500, 1200, 6072), null);
  // The line itself: a tenth under the last run writes, a hair further does not.
  assert.equal(countRefusal("sections", 900, 500, 1000), null);
  assert.ok(countRefusal("sections", 899, 500, 1000));
});

// Regression, #59. The rate used to be measured once over every subject of every
// term, so a small file could fail wholesale and vanish under the total. Those
// sections then render as "No seat data for this section.", the sentence Finder
// uses for a section Barrett genuinely does not carry.
test("regression #59: a subject file that fails wholesale is refused", () => {
  const published = parseSubjectFile("AVIATN", "1268", BARRETT_SUBJECT);
  assert.equal(published.sections.length, 3);
  assert.equal(published.failures.length, 0);
  assert.equal(subjectResidueRefusal("term 1268 AVIATN", 3, 0, 0.005), null);

  // What a fixed-width layout change looks like: every field one column over.
  const shifted = BARRETT_SUBJECT.split("\n")
    .map((line, i) => (i > 3 && line.trim() ? ` ${line}` : line))
    .join("\n");
  const broken = parseSubjectFile("AVIATN", "1268", shifted);
  assert.equal(broken.sections.length, 0);
  assert.equal(broken.failures.length, 3);

  assert.ok(subjectResidueRefusal("term 1268 AVIATN", 0, 3, 0.005));
  // The same three failures against the term they sit in, which is all the old
  // rule ever measured.
  assert.equal(residueRefusal("term 1268", 17692, 3, 0.005), null);
});

// 633 of the 680 subject files Barrett offered on 2026-08-21 hold under 200
// rows, so a plain rate per file would fail the whole night on one odd line.
test("one unreadable line in a short subject file is not a layout change", () => {
  assert.equal(subjectResidueRefusal("term 1268 AEROENG", 73, 1, 0.005), null);
  assert.ok(subjectResidueRefusal("term 1268 AEROENG", 72, 2, 0.005));
  assert.ok(subjectResidueRefusal("term 1268 ENVSCI", 0, 1, 0.005));
});

// Regression, #59. The rules only matter if the scripts hold a run to the file
// that is really committed, so these three drive each script's own gate.
test("regression #59: the ratings gate reads the committed roster", async () => {
  const committed = (await read("ratings.json")).professors.length;
  assert.equal(await previousCount(), committed);
  assert.equal(await previousCount(MISSING), 0);

  const refusal = say(await ratingsRefusals(Math.floor(committed * 0.7)));
  assert.match(refusal, new RegExp(String(committed)));
  assert.match(refusal, /FORCE_WRITE=1/);
  assert.equal(say(await ratingsRefusals(committed)), null);
});

test("regression #59: the courses gate reads the committed index", async () => {
  const committed = await read("courses.json");
  const counts = previousCounts(await previousIndex());
  for (const [strm, term] of Object.entries(committed.terms)) {
    assert.deepEqual(counts[strm], {
      subjects: term.subjects.length,
      courses: term.subjects.reduce((n, s) => n + s.courses.length, 0),
    });
  }
  assert.deepEqual(previousCounts(await previousIndex(MISSING)), {});

  const [strm, before] = Object.entries(counts)[0];
  const refusal = say(coursesRefusals(strm, before.subjects, Math.floor(before.courses * 0.5), before));
  assert.match(refusal, new RegExp(String(before.courses)));
  assert.equal(say(coursesRefusals(strm, before.subjects, before.courses, before)), null);
});

test("regression #59: the seats gate reads the committed term file", async () => {
  const entry = (await read("seats.json")).terms[0];
  assert.equal(await previousSections(entry.term), entry.sections);
  assert.equal(await previousSections("9999"), 0);

  const previous = entry.sections;
  const stats = termStats(entry.term, { sectionsParsed: previous });
  assert.equal(termProblem(stats, { previous, force: false }), null);

  const short = termStats(entry.term, { sectionsParsed: Math.floor(previous * 0.7) });
  assert.match(termProblem(short, { previous, force: false }), new RegExp(String(previous)));
  // FORCE_WRITE=1 clears this term's shrink and says nothing about any other
  // term, since each one is now held to its own committed count.
  assert.equal(termProblem(short, { previous, force: true }), null);
});

// Regression, #59. The per-subject check has to reach the term gate, or a file
// that failed wholesale is still only a rounding error against its term.
test("regression #59: one broken subject file refuses its whole term", async () => {
  const entry = (await read("seats.json")).terms[0];
  const clean = [parsed("AEROENG", 120, 0), { subject: "ZOOLOGY", offered: false }];
  assert.deepEqual(subjectRefusals(entry.term, clean).filter(Boolean), []);

  const refusals = subjectRefusals(entry.term, [...clean, parsed("AVIATN", 0, 3)]).filter(Boolean);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0].reason, /AVIATN/);

  // The same three failures against the term they sit in, which is all the term
  // gate on its own ever measured.
  const previous = entry.sections;
  const stats = termStats(entry.term, { sectionsParsed: previous, residueRate: 3 / (previous + 3) });
  assert.equal(termProblem(stats, { previous, force: false }), null);
  assert.match(termProblem(stats, { refusals, previous, force: false }), /AVIATN/);
});

test("nothing to refuse means nothing to say", () => {
  assert.equal(say([]), null);
  assert.equal(say([null, null]), null);
});

test("a refusal names every reason and the way past it", () => {
  const message = say([null, countRefusal("sections", 800, 500, 1000), countRefusal("courses", 1000, 500, 1200)]);
  assert.match(message, /sections/);
  assert.match(message, /courses/);
  assert.match(message, /FORCE_WRITE=1/);
});

test("a floor refusal says what is committed and offers no way past", () => {
  const message = say([countRefusal("term 1268 sections", 0, 500, 17692)]);
  assert.match(message, /17692/);
  assert.doesNotMatch(message, /FORCE_WRITE/);
});

test("FORCE_WRITE=1 clears a shrink but not a broken parse", () => {
  const shrink = countRefusal("rated professors", 5001, 5000, 7367);
  const layout = subjectResidueRefusal("term 1268 AVIATN", 0, 3, 0.005);
  const warnings = [];
  const original = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    assert.equal(refusalMessage([shrink], true), null);
    const left = refusalMessage([shrink, layout], true);
    assert.match(left, /AVIATN/);
    assert.doesNotMatch(left, /rated professors/);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 2);
  for (const line of warnings) assert.match(line, /FORCE_WRITE=1/);
});
