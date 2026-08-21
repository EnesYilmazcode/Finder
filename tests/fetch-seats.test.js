// The snapshotter's pure half. Nothing here fetches: the files are built to
// Barrett's real column map, so the parser has to accept them.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { parseSubjectFile } from "../scripts/fetch-seats.mjs";
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
