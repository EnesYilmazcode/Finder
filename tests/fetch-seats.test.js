// The snapshotter without the writing half. The subject files are built to
// Barrett's real column map, so the parser has to accept them, and the term
// runs go through a Barrett served from memory rather than the network.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SUBJECT_FAILURES,
  parseSubjectFile,
  snapshotTerm,
  termProblem,
} from "../scripts/fetch-seats.mjs";
import { install } from "./barrett-mock.mjs";
import { BARRETT_COLUMNS, barrettFile, barrettLine } from "./fixtures.js";

// Two sections and the continuation row that carries the second one's other
// meeting time, which is the shape every subject file repeats.
const BODY = [
  { catalog: "1110", classNumber: "4817", room: "ONLINE", enrolled: 25, limit: 40, instructor: "M.Mallon" },
  "",
  { catalog: "1111", classNumber: "4818", days: "TR", time: "0350P", room: "BE0120", enrolled: 44, limit: 80, instructor: "D.Kline" },
  "                                            and   T       0220P-0340  BE0470",
  "",
  "waitlist report:",
];

// Lines lifted out of a live CSE file. The builder is only worth anything if it
// puts every field on the column a real file puts it on, so it is checked
// against those lines rather than against itself.
test("the fixture is built to the columns a live file uses", () => {
  assert.equal(
    barrettLine(BODY[0]),
    "     CSE 1110             4817 L                                      ONLINE      25/40       M.Mallon"
  );
  assert.equal(
    barrettLine(BODY[2]),
    "     CSE 1111             4818 L                  T R     0350P       BE0120      44/80       D.Kline"
  );
});

describe("where the column header is", () => {
  const parsed = (out) => out.sections.map((s) => [s.classNumber, s.enrolled, s.limit]);

  test("a published term parses every section with nothing left over", () => {
    const out = parseSubjectFile("CSE", "1268", barrettFile("CSE", "1268", BODY));
    assert.deepEqual(out.failures, []);
    assert.deepEqual(parsed(out), [["4817", 25, 40], ["4818", 44, 80]]);
    assert.equal(out.continuations, 1);
  });

  // Regression, #91. The banner adds two lines, so counting three header lines
  // started the body on the column header and booked it as a residue failure.
  test("regression #91: the DRAFT banner does not become a residue failure", () => {
    const out = parseSubjectFile("CSE", "1268", barrettFile("CSE", "1268", BODY, { draft: true }));
    assert.deepEqual(out.failures, []);
    assert.deepEqual(parsed(out), [["4817", 25, 40], ["4818", 44, 80]]);
    assert.equal(out.continuations, 1);
  });

  // Without the column header the body position is a guess, and the wording can
  // turn up again in a trailer, so only the top of the file counts.
  test("an unrecognised column header stops the run", () => {
    const missing = barrettFile("CSE", "1268", BODY, { columns: null });
    assert.throws(() => parseSubjectFile("CSE", "1268", missing), /no column header/);

    const renamed = barrettFile(
      "CSE",
      "1268",
      [...BODY, "", "     CSE 1224               3", "     CSE 2111               4", BARRETT_COLUMNS],
      { columns: BARRETT_COLUMNS.replace("class#", "class no.") }
    );
    assert.throws(() => parseSubjectFile("CSE", "1268", renamed), /no column header/);
  });

  // A caller is allowed to write off a subject whose file did not load, so the
  // layout errors have to say they are something else: one renamed column is
  // every file at once, not one bad subject.
  test("a layout failure is tagged as one", () => {
    const cases = {
      "an unrecognised title": "not a Barrett file",
      "the wrong term": barrettFile("CSE", "1264", BODY),
      "no column header": barrettFile("CSE", "1268", BODY, { columns: null }),
    };
    for (const [what, text] of Object.entries(cases)) {
      assert.throws(() => parseSubjectFile("CSE", "1268", text), (err) => err.layout === true, what);
    }
  });

  // Counting two lines past the column header would silently drop this section,
  // and a dropped line leaves no residue, so nothing would report it.
  test("a section directly under the column header is still parsed", () => {
    const tight = barrettFile("CSE", "1268", BODY, { draft: true, gap: false });
    const out = parseSubjectFile("CSE", "1268", tight);
    assert.deepEqual(out.failures, []);
    assert.equal(out.sections.length, 2);
  });
});

describe("what holds a term back", () => {
  const SUBJECTS = Array.from({ length: 12 }, (_, i) => `SUBJ${String(i).padStart(2, "0")}`);

  const termStats = (extra) => ({
    subjectsOffered: 241,
    subjectsFailed: 0,
    subjectsUnparsed: 0,
    sectionsParsed: 17680,
    residueRate: 0,
    ...extra,
  });

  // Regression, #93. mapLimit runs on Promise.all, so a subject that threw used
  // to reject the whole term and take every other subject's sections with it.
  // A 403 is fatal on the first attempt, so it reaches that catch without
  // sitting through the retry ladder a 5xx earns.
  test("regression #93: a subject that never loads does not sink the term", async () => {
    const restore = install({ subjects: SUBJECTS, published: ["1268"], failing: ["SUBJ07"] });
    try {
      const { snapshot, stats, fetchErrors } = await snapshotTerm("1268", SUBJECTS);
      assert.equal(stats.subjectsFailed, 1);
      assert.equal(stats.subjectsOffered, 11);
      assert.equal(stats.sectionsParsed, 44, "the other 11 subjects still parsed");
      assert.match(fetchErrors[0], /SUBJ07/);
      assert.match(fetchErrors[0], /403/);
      assert.deepEqual(snapshot.sections["10000"], [26, 40, 0], "SUBJ00 is in the snapshot");
      assert.equal(snapshot.sections["10700"], undefined, "SUBJ07 is not, its sections read as unknown");
    } finally {
      restore();
    }
  });

  // A file that arrived and would not parse is Barrett changing shape, which is
  // the one thing the new tolerance must not swallow.
  test("regression #93: a subject file that will not parse holds the term back", async () => {
    const restore = install({ subjects: SUBJECTS, published: ["1268"], mislabelled: ["SUBJ03"] });
    try {
      const { stats, parseErrors } = await snapshotTerm("1268", SUBJECTS);
      assert.equal(stats.subjectsUnparsed, 1);
      assert.equal(stats.subjectsFailed, 0, "a header mismatch is not a failed request");
      assert.match(parseErrors[0], /SUBJ03: header term 1264 is not 1268/);
      assert.match(termProblem(termStats({ subjectsUnparsed: 1 })), /did not parse/);
    } finally {
      restore();
    }
  });

  // #91 made a missing column header throw so a Barrett rename is loud. That
  // throw lands in the catch this branch added, so it has to reach the counter
  // with no tolerance rather than the one that writes off five bad subjects.
  test("a layout error counts as unparsed, not as a tolerated failed request", async () => {
    const restore = install({ subjects: SUBJECTS, published: ["1268"], layoutBroken: ["SUBJ05"] });
    try {
      const { stats, parseErrors } = await snapshotTerm("1268", SUBJECTS);
      assert.equal(stats.subjectsUnparsed, 1);
      assert.equal(stats.subjectsFailed, 0);
      assert.match(parseErrors[0], /SUBJ05: no column header/);
      assert.match(
        termProblem(termStats({ subjectsUnparsed: stats.subjectsUnparsed })),
        /did not parse/,
        "one renamed column is enough to hold the term"
      );
    } finally {
      restore();
    }
  });

  test("regression #93: a term that parsed nothing is reported, not thrown", () => {
    assert.equal(termProblem(termStats({ subjectsOffered: 0, sectionsParsed: 0 })), "no sections parsed");
    assert.equal(termProblem(termStats({})), null, "a healthy term has no problem to report");
  });

  test("regression #93: a few failed subjects pass, a lot do not", () => {
    assert.equal(termProblem(termStats({ subjectsFailed: MAX_SUBJECT_FAILURES })), null);
    assert.match(
      termProblem(termStats({ subjectsFailed: MAX_SUBJECT_FAILURES + 1 })),
      /subject requests failed/
    );
  });

  test("the subject floor and the layout check still stop a term", () => {
    assert.match(termProblem(termStats({ subjectsOffered: 49 })), /only 49 subjects/);
    assert.match(termProblem(termStats({ residueRate: 0.01 })), /residue rate .* exceeds/);
  });
});
