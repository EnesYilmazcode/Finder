import test from "node:test";
import assert from "node:assert/strict";

import { stubFetch } from "./helpers.js";

const INDEX = {
  built: "2026-08-18",
  terms: {
    1268: {
      subjects: [
        { code: "MATH", name: "Mathematics", courses: [["1151", "Calculus I", 5, 5], ["1172", "Engineering Calculus", 5, 5]] },
        { code: "CSE", name: "Computer Science and Engineering", courses: [["2221", "Software I", 4, 4]] },
        // 15 subjects upstream have no name of their own.
        { code: "CYBRSEC", name: "CYBRSEC", courses: [] },
        { code: "NONAME", courses: [] },
      ],
    },
    1262: { subjects: [{ code: "CSE", name: "Computer Science and Engineering", courses: [] }] },
  },
};

const courses = await (async () => {
  const mod = await import("../js/courses.js");
  const restore = stubFetch({ "courses.json": INDEX });
  try {
    await mod.loadCourses("courses.json");
  } finally {
    restore();
  }
  return mod;
})();

test("isLoaded flips once the index is in", async () => {
  const fresh = await import("../js/courses.js?unloaded");
  assert.equal(fresh.isLoaded(), false);
  assert.equal(courses.isLoaded(), true);
});

test("subjectsFor sorts by code and is scoped to one term", () => {
  assert.deepEqual(courses.subjectsFor("1268").map((s) => s.code), ["CSE", "CYBRSEC", "MATH", "NONAME"]);
  assert.deepEqual(courses.subjectsFor(1262).map((s) => s.code), ["CSE"]);
  assert.deepEqual(courses.subjectsFor("9999"), []);
});

test("subjectsFor does not reorder the stored index", () => {
  courses.subjectsFor("1268");
  assert.equal(INDEX.terms[1268].subjects[0].code, "MATH");
});

test("subjectLabel does not repeat a code that stands in for a name", () => {
  assert.equal(subjectLabelOf("CSE"), "CSE — Computer Science and Engineering");
  assert.equal(subjectLabelOf("CYBRSEC"), "CYBRSEC");
  assert.equal(subjectLabelOf("NONAME"), "NONAME");
  assert.equal(courses.subjectLabel(null), "");
});

function subjectLabelOf(code) {
  return courses.subjectLabel(courses.subjectsFor("1268").find((s) => s.code === code));
}

test("coursesFor unpacks the compact course tuples", () => {
  assert.deepEqual(courses.coursesFor("1268", "MATH"), [
    { number: "1151", title: "Calculus I", min: 5, max: 5 },
    { number: "1172", title: "Engineering Calculus", min: 5, max: 5 },
  ]);
});

test("coursesFor accepts a lowercase code and is empty for an unknown one", () => {
  assert.equal(courses.coursesFor("1268", "cse").length, 1);
  assert.deepEqual(courses.coursesFor("1268", "NOPE"), []);
  assert.deepEqual(courses.coursesFor("1268", null), []);
  assert.deepEqual(courses.coursesFor("1268", "CYBRSEC"), []);
});

test("codeFromInput pulls the bare code out of a picker label", () => {
  assert.equal(courses.codeFromInput("CSE — Computer Science and Engineering"), "CSE");
  assert.equal(courses.codeFromInput("cse"), "CSE");
  assert.equal(courses.codeFromInput("  math  "), "MATH");
  assert.equal(courses.codeFromInput("CYBRSEC"), "CYBRSEC");
  assert.equal(courses.codeFromInput(""), "");
  assert.equal(courses.codeFromInput(null), "");
});
