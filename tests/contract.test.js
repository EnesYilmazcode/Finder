// What the nightly pipelines are allowed to write, and what the committed files
// have to look like.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BARRETT_SUBJECT } from "./fixtures.js";
import {
  countRefusal,
  refusalMessage,
  residueRefusal,
  subjectResidueRefusal,
  termListRefusal,
} from "../scripts/guards.mjs";
import { courseCodes, courseIndex, previousCount, writeRefusals as ratingsRefusals } from "../scripts/fetch-ratings.mjs";
import { osuId, snapshot as headshotSnapshot } from "../scripts/fetch-headshots.mjs";
import { previousIndex, subjectsByTerm, writeRefusals as coursesRefusals } from "../scripts/fetch-courses.mjs";
import { appendTrend, parseSubjectFile, previousSections, subjectRefusals, termProblem } from "../scripts/fetch-seats.mjs";

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
  sourceUpdated: "2026-08-21",
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
  const previous = subjectsByTerm(await previousIndex());
  for (const [strm, term] of Object.entries(committed.terms)) {
    const before = previous.get(strm);
    assert.deepEqual([...before.codes].sort(), term.subjects.map((s) => s.code).sort());
    assert.equal(before.subjects, term.subjects.length);
    assert.equal(before.courses, term.subjects.reduce((n, s) => n + s.courses.length, 0));
  }
  assert.equal(subjectsByTerm(await previousIndex(MISSING)).size, 0);

  // Handed the term's own subjects back, so only the counts are on trial and the
  // lost-subject rule folded in beside them has nothing to report.
  const [strm, before] = [...previous][0];
  const still = committed.terms[strm].subjects;
  const refusal = say(coursesRefusals(strm, before.subjects, Math.floor(before.courses * 0.5), before, still));
  assert.match(refusal, new RegExp(String(before.courses)));
  assert.equal(say(coursesRefusals(strm, before.subjects, before.courses, before, still)), null);
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

// The two newest nightly outputs. Neither is committed yet, so each is held to
// the shape its writer produces as well as to the file, or the coverage would
// be a test that runs on nothing until the night it matters.
test("trend-{term}.json keeps its shape", async () => {
  const index = await read("seats.json");
  // 10003 does not move, so it is what the prune has to drop: a term is 17692
  // sections and only a fifth of them move on a night.
  const sections = (a, b, c) => ({ 10001: a, 10002: b, 10003: c });
  const before = { term: "1268", sourceUpdated: "2026-08-20", sections: sections([30, 40, 2], [40, 40, 1], [12, 25, 0]) };
  const after = { term: "1268", sourceUpdated: "2026-08-21", sections: sections([31, 40, 0], [39, 40, 0], [12, 25, 0]) };
  const yesterday = { term: "1268", from: "2026-08-19", days: ["2026-08-20"], enrolled: {}, waitlist: {}, opened: [] };
  const written = appendTrend(yesterday, before, after);

  const files = (await readdir(DATA)).filter((name) => /^trend-\d{4}\.json$/.test(name));
  const committed = await Promise.all(files.map(async (name) => [name, await read(name)]));

  for (const [what, trend] of [["appendTrend", written], ...committed]) {
    const keys = ["term", "from", "days", "enrolled", "waitlist", "opened"];
    assert.deepEqual(Object.keys(trend), keys, `${what} is missing a key or reordered one`);
    if (what !== "appendTrend") {
      assert.equal(`trend-${trend.term}.json`, what);
      assert.ok(index.terms.some((t) => t.term === trend.term), `${what} has no term file to sit beside`);
    }
    assert.match(trend.from, /^\d{4}-\d{2}-\d{2}$/);
    for (const day of trend.days) assert.match(day, /^\d{4}-\d{2}-\d{2}$/);

    // js/trend.js drops a series whose length does not match, so a file that
    // gets this wrong renders as a term where nothing moved.
    for (const field of ["enrolled", "waitlist"]) {
      for (const [classNumber, series] of Object.entries(trend[field])) {
        assert.match(classNumber, /^\d+$/);
        assert.equal(series.length, trend.days.length, `${what} ${field} ${classNumber} is not one point per day`);
        for (const value of series) assert.equal(typeof value, "number");
        assert.ok(series.some(Boolean), `${what} ${field} ${classNumber} never moved and should have been pruned`);
      }
    }
    for (const classNumber of trend.opened) assert.match(classNumber, /^\d+$/);
  }

  assert.deepEqual(written.days, ["2026-08-20", "2026-08-21"]);
  assert.deepEqual(written.enrolled, { 10001: [0, 1], 10002: [0, -1] });
  assert.deepEqual(written.opened, ["10002"]);
});

test("ratings-courses.json keeps its shape", async () => {
  // Through courseCodes, so the rules that keep a blank name and a zero count
  // out of the file are the ones on trial rather than a fixture.
  const upstream = [
    { legacyId: 12, courseCodes: [{ courseName: "CSE 2221", courseCount: 3 }, { courseName: " ", courseCount: 9 }] },
    {
      legacyId: 34,
      courseCodes: [
        { courseName: "MATH1151", courseCount: 1 },
        { courseName: "math 1151", courseCount: 2 },
        { courseName: "STAT 1350", courseCount: 0 },
      ],
    },
  ];
  const taught = upstream.map((node) => ({ legacyId: node.legacyId }));
  const codes = new Map(upstream.map((node) => [node.legacyId, courseCodes(node)]));
  const files = [["courseIndex", courseIndex(taught, codes)]];
  try {
    files.push(["ratings-courses.json", await read("ratings-courses.json")]);
  } catch {
    // Not committed until the first nightly that clears the courseCodes gate.
  }

  for (const [what, courses] of files) {
    const keys = ["source", "note", "count", "professors"];
    assert.deepEqual(Object.keys(courses), keys, `${what} is missing a key or reordered one`);
    const entries = Object.entries(courses.professors);
    assert.equal(courses.count, entries.length, `${what} does not hold what it says`);
    for (const [legacyId, byCourse] of entries) {
      assert.match(legacyId, /^\d+$/);
      const named = Object.entries(byCourse);
      assert.ok(named.length, `${what} ${legacyId} is in the file with no course`);
      // The count is what the detail pane weights a rating by, so zero would be
      // a course that is listed and contributes nothing.
      for (const [name, count] of named) {
        assert.ok(name.trim(), `${what} ${legacyId} names a blank course`);
        assert.equal(typeof count, "number");
        assert.ok(count > 0, `${what} ${legacyId} ${name} is ${count}`);
      }
    }
  }
});

test("headshots.json keeps its shape", async () => {
  const files = [["snapshot", headshotSnapshot(["bucci.2", "gomori.1"])]];
  try {
    files.push(["headshots.json", await read("headshots.json")]);
  } catch {
    // Not committed until the first weekly run.
  }

  for (const [what, written] of files) {
    const keys = ["source", "note", "count", "ids"];
    assert.deepEqual(Object.keys(written), keys, `${what} is missing a key or reordered one`);
    assert.equal(written.count, written.ids.length, `${what} does not hold what it says`);
    assert.equal(new Set(written.ids).size, written.ids.length, `${what} lists someone twice`);
    // Sorted so a week where nobody's photo changed produces no diff at all.
    assert.deepEqual(written.ids, [...written.ids].sort(), `${what} is not sorted`);
    // js/headshots.js looks up the lowercased name.N, so an id it could never
    // match is an id that silently costs someone their photo.
    for (const id of written.ids) {
      assert.equal(osuId(`${id}@osu.edu`), id, `${what} carries an id the page cannot look up: ${id}`);
    }
  }
});

// Regression, #59. FORCE_WRITE=1 is one flag over every drop in the run, and the
// term list is the one drop that deletes files for terms the run never fetched.
test("FORCE_WRITE=1 does not clear a short term list", () => {
  const short = termListRefusal(2, 3, false);
  assert.match(short.reason, /searchable terms: got 2/);
  assert.equal(short.forceable, false, "so refusalMessage cannot force it");
  assert.equal(refusalMessage([short], true), short.reason);
  assert.match(short.reason, /ALLOW_TERM_DROP=1/);
  assert.doesNotMatch(refusalMessage([short], false), /FORCE_WRITE/);

  // The flag that does say what it does, and the floor neither flag clears.
  assert.equal(termListRefusal(2, 3, true), null);
  assert.equal(termListRefusal(3, 3, false), null);
  const empty = refusalMessage([termListRefusal(0, 3, true)], true);
  assert.equal(empty, "searchable terms: got 0, the floor is 1, and 3 is already committed");
});

// Regression, #59. toIsoDate hands back whatever Barrett stamped when it does
// not match d-MMM-yyyy, and every reader of sourceUpdated wants yyyy-mm-dd.
test("a term Barrett stamped with a date this cannot read is held back", async () => {
  const entry = (await read("seats.json")).terms[0];
  const previous = entry.sections;
  const stamped = (sourceUpdated) =>
    termProblem(termStats(entry.term, { sectionsParsed: previous, sourceUpdated }), { previous, force: false });

  assert.equal(stamped("2026-08-21"), null);
  // A case change upstream is enough: MONTHS holds Aug, not AUG.
  assert.match(stamped("19-AUG-2026"), /"19-AUG-2026", which is not a yyyy-mm-dd date/);
  assert.match(stamped(""), /term \d{4}: Barrett stamped ""/);
  // Not forceable, because forcing it writes the unreadable date.
  assert.match(
    termProblem(termStats(entry.term, { sectionsParsed: previous, sourceUpdated: "19-AUG-2026" }), { previous, force: true }),
    /not a yyyy-mm-dd date/
  );
});

// Regression, #59. Number() on a units field the API did not send as a number
// gives NaN, and JSON.stringify writes that as null.
test("a course whose units are not numbers is refused", async () => {
  const previous = subjectsByTerm(await previousIndex());
  const [strm, before] = [...previous][0];
  const still = (await read("courses.json")).terms[strm].subjects;
  const gate = (subjects) => say(coursesRefusals(strm, before.subjects, before.courses, before, subjects));

  assert.equal(gate(still), null);

  // One course of the term, the way a variable-credit subject would arrive if
  // the API ever described its units in words.
  const [first, ...rest] = still;
  const [catalog, title] = first.courses[0];
  const broken = [{ ...first, courses: [[catalog, title, Number("VAR"), 3], ...first.courses.slice(1)] }, ...rest];
  const refusal = gate(broken);
  assert.match(refusal, /1 courses have units that are not numbers/);
  assert.match(refusal, new RegExp(`${first.code} ${catalog}`));
  assert.doesNotMatch(refusal, /FORCE_WRITE/);
  const forced = refusalMessage(coursesRefusals(strm, before.subjects, before.courses, before, broken), true);
  assert.match(forced, /not numbers/);
});
