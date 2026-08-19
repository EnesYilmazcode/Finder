import test from "node:test";
import assert from "node:assert/strict";

import { parseQuery, mergeCourses, rankCourses, filterCourses, isIndividualStudy } from "../js/rank.js";
import { entry, section, taught } from "./fixtures.js";

// A small corpus with the shape that caused the noise problem: one course
// someone actually typed, some near misses, and independent study listings
// with more sections than the real course.
function corpus() {
  return [
    entry("CSE", "2321", "Foundations 1: Discrete Structures", [
      taught(2001, ["monday", "wednesday", "friday"], "3:00 PM", "3:55 PM", ["Charles Estill"]),
      taught(2002, ["monday", "wednesday", "friday"], "3:00 PM", "3:55 PM", ["Ramin Yarinezhad"]),
      taught(2003, ["tuesday", "thursday"], "9:35 AM", "10:55 AM", ["Luan Duong"]),
    ]),
    entry("CSE", "2331", "Foundations 2: Data Structures", [
      taught(2101, ["monday", "wednesday"], "11:10 AM", "12:30 PM", ["Paolo Bucci"]),
      taught(2102, ["tuesday", "thursday"], "2:20 PM", "3:40 PM", ["Steve Gomori"]),
    ]),
    entry("CSE", "4193", "Individual Studies", [
      section(4001, { component: "Independent Study" }),
      section(4002, { component: "Independent Study" }),
      section(4003, { component: "Independent Study" }),
    ]),
    entry("CSE", "6193", "Individual Studies", [
      section(6001, { component: "Research" }),
      section(6002, { component: "Research" }),
    ]),
    entry("MATH", "2321", "Mathematical Analysis", [
      taught(3001, ["monday", "wednesday", "friday"], "10:20 AM", "11:15 AM", ["Diana Kline"]),
    ]),
    entry("ENGLISH", "1110", "First Year English", [
      taught(5001, ["tuesday", "thursday"], "8:00 AM", "9:20 AM", ["Ann Taylor"]),
    ]),
  ];
}

test("parseQuery pulls a subject and a number out of a typed query", () => {
  const parsed = parseQuery("cse 2221");
  assert.deepEqual(parsed.tokens, ["CSE", "2221"]);
  assert.equal(parsed.subject, "CSE");
  assert.equal(parsed.number, "2221");
  assert.equal(parsed.raw, "cse 2221");
});

test("parseQuery keeps raw as typed but tokenises uppercase", () => {
  const parsed = parseQuery("  Math   1151H  ");
  assert.equal(parsed.raw, "Math   1151H");
  assert.deepEqual(parsed.tokens, ["MATH", "1151H"]);
  assert.equal(parsed.number, "1151H");
});

test("parseQuery handles a bare number and decimal catalog numbers", () => {
  assert.equal(parseQuery("2221").subject, null);
  assert.equal(parseQuery("2221").number, "2221");
  assert.equal(parseQuery("ANIMSCI 2221.01").number, "2221.01");
});

test("parseQuery is empty for empty input", () => {
  for (const raw of ["", "   ", null, undefined]) {
    const parsed = parseQuery(raw);
    assert.deepEqual(parsed.tokens, []);
    assert.equal(parsed.subject, null);
    assert.equal(parsed.number, null);
    assert.equal(parsed.raw, "");
  }
});

test("parseQuery reads a short word as a subject, which is how a name search still ranks", () => {
  // "Bucci" is not a subject, but it looks like one, and the scorer only pays
  // out on a subject hit when a course actually matches it.
  assert.equal(parseQuery("Bucci").subject, "BUCCI");
  assert.equal(parseQuery("Bucci").number, null);
});

test("mergeCourses folds duplicate records of the same course", () => {
  const merged = mergeCourses([
    entry("CSE", "5052", "Software Components", [section(1001)]),
    entry("CSE", "5052", "Software Components", [section(1002)]),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sections.map((s) => s.classNumber), [1001, 1002]);
});

test("mergeCourses does not add a section twice, even across number and string ids", () => {
  const merged = mergeCourses([
    entry("CSE", "5052", "Software Components", [section(1001), section(1002)]),
    entry("CSE", "5052", "Software Components", [section("1001"), section(1003)]),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sections.map((s) => String(s.classNumber)), ["1001", "1002", "1003"]);
});

test("mergeCourses keeps courses apart when subject, number or title differs", () => {
  const merged = mergeCourses([
    entry("CSE", "2221", "Software I", [section(1)]),
    entry("CSE", "2231", "Software II", [section(2)]),
    entry("MATH", "2221", "Something Else", [section(3)]),
    entry("CSE", "2221", "Software I (Honors)", [section(4)]),
  ]);
  assert.equal(merged.length, 4);
});

test("mergeCourses skips records with no course and tolerates junk", () => {
  assert.deepEqual(mergeCourses(null), []);
  assert.deepEqual(mergeCourses([]), []);
  assert.deepEqual(mergeCourses([null, {}, { sections: [section(1)] }]), []);
  const merged = mergeCourses([{ course: { subject: "CSE", catalogNumber: "2221", title: "Software I" } }]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sections, []);
});

test("mergeCourses does not mutate the records it was given", () => {
  const input = [
    entry("CSE", "5052", "Software Components", [section(1001)]),
    entry("CSE", "5052", "Software Components", [section(1002)]),
  ];
  mergeCourses(input);
  assert.equal(input[0].sections.length, 1);
});

test("rankCourses returns the merged set untouched when nothing was typed", () => {
  const ranked = rankCourses(corpus(), "");
  assert.equal(ranked.length, 6);
  assert.equal(ranked[0].course.subject, "CSE");
  assert.equal(ranked[0].course.catalogNumber, "2321");
});

test("rankCourses puts an exact subject and number first", () => {
  const ranked = rankCourses(corpus(), "CSE 2321");
  assert.equal(ranked[0].course.subject, "CSE");
  assert.equal(ranked[0].course.catalogNumber, "2321");
  // A subject hit outweighs a bare number hit, so every CSE course sits above
  // MATH 2321, and section count breaks the ties among them.
  assert.deepEqual(
    ranked.map((e) => `${e.course.subject} ${e.course.catalogNumber}`),
    ["CSE 2321", "CSE 4193", "CSE 2331", "CSE 6193", "MATH 2321", "ENGLISH 1110"]
  );
});

test("rankCourses lifts a course because of who teaches it", () => {
  const ranked = rankCourses(corpus(), "GOMORI");
  assert.equal(ranked[0].course.catalogNumber, "2331");
});

test("rankCourses breaks a tie by catalog number", () => {
  const ranked = rankCourses(
    [entry("CSE", "3901", "A", [section(1)]), entry("CSE", "1223", "B", [section(2)])],
    "CSE"
  );
  assert.deepEqual(ranked.map((e) => e.course.catalogNumber), ["1223", "3901"]);
});

test("isIndividualStudy flags unscheduled non-teaching sections", () => {
  const study = corpus()[2];
  assert.equal(isIndividualStudy(study), true);
});

test("isIndividualStudy clears anything that actually meets", () => {
  assert.equal(isIndividualStudy(corpus()[0]), false);
  // One scheduled section is enough, even among a pile of research sections.
  const mixed = entry("CSE", "4193", "Individual Studies", [
    section(1, { component: "Independent Study" }),
    taught(2, ["monday"], "9:00 AM", "9:55 AM", ["Someone"], { component: "Independent Study" }),
  ]);
  assert.equal(isIndividualStudy(mixed), false);
});

test("isIndividualStudy falls back to the title when the component is ordinary", () => {
  const byTitle = entry("CSE", "4999", "Undergraduate Thesis Research", [section(1, { component: "Lecture" })]);
  assert.equal(isIndividualStudy(byTitle), true);
  const ordinary = entry("CSE", "2501", "Social and Ethical Issues", [section(1, { component: "Lecture" })]);
  assert.equal(isIndividualStudy(ordinary), false);
});

test("isIndividualStudy is false for a course with no sections", () => {
  assert.equal(isIndividualStudy(entry("CSE", "4193", "Individual Studies", [])), false);
  assert.equal(isIndividualStudy({ course: { title: "Research" } }), false);
});

test("filterCourses answers an exact subject and number with that course alone", () => {
  const { primary, related, reason } = filterCourses(corpus(), "CSE 2321");
  assert.equal(reason, "exact");
  assert.equal(primary.length, 1);
  assert.equal(primary[0].course.subject, "CSE");
  assert.equal(primary[0].course.catalogNumber, "2321");
  assert.equal(related.length, 5);
});

test("filterCourses demotes independent study out of a subject search", () => {
  const { primary, reason } = filterCourses(corpus(), "CSE");
  assert.equal(reason, "ranked");
  const numbers = primary.map((e) => e.course.catalogNumber);
  assert.ok(!numbers.includes("4193"), "independent study is not a primary result");
  assert.ok(!numbers.includes("6193"), "research is not a primary result");
  assert.ok(numbers.includes("2321"));
});

test("filterCourses keeps independent study when it is what was asked for", () => {
  const { primary } = filterCourses(corpus(), "CSE individual studies");
  assert.ok(primary.some((e) => e.course.catalogNumber === "4193"));
});

test("filterCourses reports none for an empty result set", () => {
  assert.deepEqual(filterCourses([], "CSE 2321"), { primary: [], related: [], reason: "none" });
});

test("filterCourses still answers when every match is independent study", () => {
  const onlyStudy = corpus().slice(2, 4);
  const { primary, related } = filterCourses(onlyStudy, "CSE");
  assert.equal(primary.length, 2);
  assert.equal(related.length, 0);
});

// Regression, #17. The first version of this dropped demoted courses on the
// floor. Primary plus related must always be the whole ranked set.
test("regression #17: filterCourses never loses a course", () => {
  const queries = ["CSE 2321", "CSE", "Gomori", "2321", "individual studies", "MATH 2321", "english"];
  for (const query of queries) {
    const ranked = rankCourses(corpus(), query);
    const { primary, related } = filterCourses(corpus(), query);

    assert.equal(
      primary.length + related.length,
      ranked.length,
      `${query}: primary ${primary.length} + related ${related.length} != ranked ${ranked.length}`
    );

    const seen = new Set();
    for (const e of [...primary, ...related]) {
      const key = `${e.course.subject} ${e.course.catalogNumber} ${e.course.title}`;
      assert.ok(!seen.has(key), `${query}: ${key} appears twice`);
      seen.add(key);
    }
    for (const e of ranked) {
      const key = `${e.course.subject} ${e.course.catalogNumber} ${e.course.title}`;
      assert.ok(seen.has(key), `${query}: ${key} was lost`);
    }
  }
});

test("regression #17: no section disappears between ranking and filtering", () => {
  const ranked = rankCourses(corpus(), "CSE");
  const { primary, related } = filterCourses(corpus(), "CSE");
  const count = (list) => list.reduce((n, e) => n + e.sections.length, 0);
  assert.equal(count(primary) + count(related), count(ranked));
});
