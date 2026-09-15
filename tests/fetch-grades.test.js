import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv, resolveHeaders, count, termRank, readRow, buildSnapshot, slug } from "../scripts/fetch-grades.mjs";

// The header the request asked for, in one plausible spelling. Every test that
// does not care about headers reuses it.
const HEADER = "Term,Subject,Catalog Nbr,Class Nbr,Section,Campus,Instructor Email,Instructor Name,A,A-,B+,B,B-,C+,C,C-,D+,D,E,W,I";

/** One CSV of the standard header plus the given body lines. */
const file = (...lines) => [HEADER, ...lines].join("\n");

const built = (...lines) => buildSnapshot(file(...lines), { minInstructors: 1 });

test("parseCsv keeps a comma inside quotes", () => {
  const rows = parseCsv('a,b,c\n1,"Components, Interfaces",3\n');
  assert.deepEqual(rows[1], ["1", "Components, Interfaces", "3"]);
});

test("parseCsv handles a doubled quote, CRLF and a BOM", () => {
  const rows = parseCsv('﻿a,b\r\n1,"she said ""hi"""\r\n');
  assert.deepEqual(rows[0], ["a", "b"]);
  assert.deepEqual(rows[1], ["1", 'she said "hi"']);
});

test("parseCsv drops blank lines rather than reading them as rows", () => {
  assert.equal(parseCsv("a,b\n\n1,2\n\n").length, 2);
});

test("headers resolve however the export spelled them", () => {
  const spellings = ["Catalog Nbr", "catalog_nbr", "CATALOGNBR", "Catalog Number"];
  for (const spelling of spellings) {
    const map = resolveHeaders(["Term", "Subject", spelling, "Instructor Email", ...["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "E"]]);
    assert.equal(map.missing.length, 0, spelling);
    assert.equal(map.fields.catalog, 2, spelling);
  }
});

test("a missing grade column is named, not guessed around", () => {
  const map = resolveHeaders(["Term", "Subject", "Catalog", "Instructor Email", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D"]);
  assert.deepEqual(map.missing, ["grade E"]);
});

test("either instructor identifier will do, but not neither", () => {
  const base = ["Term", "Subject", "Catalog", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "E"];
  assert.equal(resolveHeaders([...base, "Instructor Email"]).missing.length, 0);
  assert.equal(resolveHeaders([...base, "Instructor Name"]).missing.length, 0);
  assert.deepEqual(resolveHeaders(base).missing, ["instructor email or name"]);
});

test("an unreadable header aborts and prints what the file actually had", () => {
  const result = buildSnapshot("Semester,Dept,Course,Prof\n2021,CSE,2221,Bucci\n");
  assert.ok(result.refusals[0].reason.includes("Semester,Dept,Course,Prof".replaceAll(",", " | ")));
  assert.ok(result.refusals[0].reason.includes("grade A"));
  assert.equal(result.refusals[0].forceable, false, "a file nobody can read is not forceable");
});

test("count reads a number and refuses the ways a cell can be withheld", () => {
  assert.equal(count("42"), 42);
  assert.equal(count("1,204"), 1204);
  assert.equal(count(" 7 "), 7);
  for (const marker of ["", "*", "***", "N/A", "n/a", "--", "REDACTED", "suppressed", "<5", "< 10"]) {
    assert.equal(count(marker), null, marker);
  }
});

test("count refuses a negative and a non-number", () => {
  assert.equal(count("-3"), null);
  assert.equal(count("many"), null);
});

test("termRank orders codes and names on one scale", () => {
  assert.ok(termRank("1218") < termRank("1262"));
  assert.ok(termRank("Autumn 2021") < termRank("Spring 2026"));
  assert.ok(termRank("Spring 2022") < termRank("Summer 2022"));
  assert.ok(termRank("Summer 2022") < termRank("Autumn 2022"));
  // A name and the code for the same term land on the same number.
  assert.equal(termRank("Autumn 2021"), termRank("1218"));
});

test("a row folds into a curve keyed on the address", () => {
  const out = built("1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,10,5,4,6,2,1,3,0,0,1,2,3,1");
  const person = out.snapshot.instructors["bucci.2"];
  assert.equal(person.name, "Paolo Bucci");
  assert.deepEqual(person.courses["CSE 2221"].counts, [10, 5, 4, 6, 2, 1, 3, 0, 0, 1, 2]);
  assert.deepEqual(person.courses["CSE 2221"].other, { W: 3, I: 1 });
  assert.equal(person.courses["CSE 2221"].sections, 1);
});

test("a bare username is the same key as the full address", () => {
  const out = built(
    "1218,CSE,2221,5168,0010,Columbus,bucci.2,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0",
    "1222,CSE,2221,5169,0020,Columbus,bucci.2@osu.edu,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0"
  );
  assert.deepEqual(Object.keys(out.snapshot.instructors), ["bucci.2"]);
  assert.equal(out.snapshot.instructors["bucci.2"].courses["CSE 2221"].sections, 2);
});

test("sections add up across terms, and terms are counted distinctly", () => {
  const out = built(
    "1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,10,0,0,0,0,0,0,0,0,0,0,0,0",
    "1218,CSE,2221,5169,0020,Columbus,bucci.2@osu.edu,Paolo Bucci,5,0,0,0,0,0,0,0,0,0,0,0,0",
    "1222,CSE,2221,5170,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,5,0,0,0,0,0,0,0,0,0,0,0,0"
  );
  const entry = out.snapshot.instructors["bucci.2"].courses["CSE 2221"];
  assert.equal(entry.counts[0], 20);
  assert.equal(entry.sections, 3);
  assert.equal(entry.terms, 2);
});

test("a withheld section is counted as withheld, never as a section of nobody", () => {
  const out = built(
    "1218,CSE,5911,5168,0010,Columbus,fenwick.9@osu.edu,Wes Fenwick,10,2,0,0,0,0,0,0,0,0,0,0,0",
    "1222,CSE,5911,5169,0010,Columbus,fenwick.9@osu.edu,Wes Fenwick,*,*,*,*,*,*,*,*,*,*,*,,"
  );
  const entry = out.snapshot.instructors["fenwick.9"].courses["CSE 5911"];
  assert.equal(entry.suppressed, 1);
  assert.equal(entry.sections, 2);
  assert.deepEqual(entry.counts, [10, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0], "the published section is untouched");
});

test("a partly withheld row is withheld, not summed from the half that survived", () => {
  // Publishing 10 A's out of a row whose B column was redacted would print a
  // curve whose total contradicts the section beside it.
  const out = built("1218,CSE,5911,5168,0010,Columbus,fenwick.9@osu.edu,Wes Fenwick,10,2,0,*,0,0,0,0,0,0,0,0,0");
  const entry = out.snapshot.instructors["fenwick.9"].courses["CSE 5911"];
  assert.equal(entry.suppressed, 1);
  assert.deepEqual(entry.counts, new Array(11).fill(0));
});

test("another campus is dropped rather than folded into a Columbus curve", () => {
  const out = built(
    "1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,10,0,0,0,0,0,0,0,0,0,0,0,0",
    "1218,CSE,2221,7001,0010,Newark,bucci.2@osu.edu,Paolo Bucci,99,0,0,0,0,0,0,0,0,0,0,0,0"
  );
  assert.equal(out.snapshot.instructors["bucci.2"].courses["CSE 2221"].counts[0], 10);
  assert.equal(out.skipped.get("another campus"), 1);
});

test("a campus column spelled as a code still matches", () => {
  const out = built("1218,CSE,2221,5168,0010,COL,bucci.2@osu.edu,Paolo Bucci,10,0,0,0,0,0,0,0,0,0,0,0,0");
  assert.ok(out.snapshot.instructors["bucci.2"]);
});

test("Staff is not a person", () => {
  const out = built(
    "1218,CSE,2221,5168,0010,Columbus,,Staff,10,0,0,0,0,0,0,0,0,0,0,0,0",
    "1218,CSE,2221,5169,0010,Columbus,,TBA,10,0,0,0,0,0,0,0,0,0,0,0,0",
    "1218,CSE,2221,5170,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0"
  );
  assert.deepEqual(Object.keys(out.snapshot.instructors), ["bucci.2"]);
  assert.equal(out.skipped.get("unstaffed"), 2);
});

test("a row with no address is kept under its name, for the site to match on", () => {
  const out = built("1218,MATH,1151,5168,0010,Columbus,,Diana Ikenberry Kline,10,0,0,0,0,0,0,0,0,0,0,0,0");
  const key = slug("Diana Ikenberry Kline");
  assert.equal(out.snapshot.instructors[key].name, "Diana Ikenberry Kline");
});

test("the fullest spelling of a name wins across five years of exports", () => {
  const out = built(
    "1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,P Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0",
    "1222,CSE,2221,5169,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0"
  );
  assert.equal(out.snapshot.instructors["bucci.2"].name, "Paolo Bucci");
});

test("the range comes from the terms actually present", () => {
  const out = built(
    "1262,CSE,2221,5170,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0",
    "1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0",
    "1238,CSE,2221,5169,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0"
  );
  assert.equal(out.snapshot.firstTerm, "1218");
  assert.equal(out.snapshot.lastTerm, "1262");
  assert.equal(out.snapshot.termCount, 3);
});

test("an E column labelled F is still the failing mark", () => {
  const header = HEADER.replace(",E,", ",F,");
  const out = buildSnapshot([header, "1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,0,0,0,0,0,0,0,0,0,0,7,0,0"].join("\n"), { minInstructors: 1 });
  assert.equal(out.snapshot.instructors["bucci.2"].courses["CSE 2221"].counts[10], 7);
});

test("too few instructors refuses the write", () => {
  const out = built("1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0");
  assert.equal(out.refusals.filter(Boolean).length, 0, "the floor was lowered for this test");

  const strict = buildSnapshot(file("1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0"));
  const refusal = strict.refusals.find(Boolean);
  assert.match(refusal.reason, /grades instructors: got 1, the floor is 200/);
  assert.equal(refusal.forceable, false);
});

test("a run far short of the committed one is a forceable refusal", () => {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    rows.push(`1218,CSE,2221,516${i},0010,Columbus,person.${i}@osu.edu,Person ${i},1,0,0,0,0,0,0,0,0,0,0,0,0`);
  }
  const out = buildSnapshot(file(...rows), { minInstructors: 1, previous: 100 });
  const refusal = out.refusals.find(Boolean);
  assert.match(refusal.reason, /down 95\.0% from the 100 already committed/);
  assert.equal(refusal.forceable, true, "a real shrink has to be shippable");
});

test("a file of unreadable rows refuses rather than writing what survived", () => {
  const rows = ["1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0"];
  for (let i = 0; i < 20; i++) rows.push("1218,,,,,Columbus,,,,,,,,,,,,,,,");
  const out = buildSnapshot(file(...rows), { minInstructors: 1 });
  const refusal = out.refusals.find(Boolean);
  assert.match(refusal.reason, /rows did not parse/);
});

test("a file with nothing under the header refuses", () => {
  assert.match(buildSnapshot(HEADER).refusals[0].reason, /no rows under its header/);
});

test("readRow skips a row missing its course or term", () => {
  const map = resolveHeaders(parseCsv(HEADER)[0]);
  const cells = (line) => parseCsv(line)[0];
  assert.ok(readRow(cells("1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,P,1,0,0,0,0,0,0,0,0,0,0,0,0"), map).term);
  assert.equal(readRow(cells(",CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,P,1,0,0,0,0,0,0,0,0,0,0,0,0"), map).skip, "no course or term");
  assert.equal(readRow(cells("1218,,2221,5168,0010,Columbus,bucci.2@osu.edu,P,1,0,0,0,0,0,0,0,0,0,0,0,0"), map).skip, "no course or term");
});

test("the snapshot names its own scale, so a reader never has to assume the order", () => {
  const out = built("1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,1,0,0,0,0,0,0,0,0,0,0,0,0");
  assert.deepEqual(out.snapshot.scale, ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "E"]);
});

test("the sign on a grade column survives, so A- is not read out of the A column", () => {
  const map = resolveHeaders(parseCsv(HEADER)[0]);
  const at = map.grades;
  // Eleven marks, eleven distinct columns, in the order the header lists them.
  assert.equal(new Set(Object.values(at)).size, 11);
  assert.equal(at["A"] + 1, at["A-"]);
  assert.equal(at["B"] + 1, at["B-"]);
  assert.ok(at["B+"] < at["B"]);

  // And end to end: a row that is nothing but A-minuses must not land on A.
  const out = built("1218,CSE,2221,5168,0010,Columbus,bucci.2@osu.edu,Paolo Bucci,0,9,0,0,0,0,0,0,0,0,0,0,0");
  assert.deepEqual(out.snapshot.instructors["bucci.2"].courses["CSE 2221"].counts, [0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("a spelled-out sign resolves to the same column as the symbol", () => {
  const spelled = "Term,Subject,Catalog,Instructor Email,A,A Minus,B Plus,B,B Minus,C Plus,C,C Minus,D Plus,D,E";
  const map = resolveHeaders(parseCsv(spelled)[0]);
  assert.deepEqual(map.missing, []);
  assert.equal(new Set(Object.values(map.grades)).size, 11);
  assert.equal(map.grades["A-"], 5);
  assert.equal(map.grades["B+"], 6);
});
