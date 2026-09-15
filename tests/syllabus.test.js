import test from "node:test";
import assert from "node:assert/strict";

import { publicSyllabusExpected, SYLLABUS_LIBRARY_URL, termLabel } from "../js/syllabus.js";

test("syllabus handoff labels Ohio State terms and undergraduate coverage", () => {
  assert.equal(termLabel("1268"), "Autumn 2026");
  assert.equal(termLabel("1262"), "Spring 2026");
  assert.equal(publicSyllabusExpected({ catalogNumber: "5999" }), true);
  assert.equal(publicSyllabusExpected({ catalogNumber: "5999" }, "1264"), false);
  assert.equal(publicSyllabusExpected({ catalogNumber: "6000" }), false);
  assert.match(SYLLABUS_LIBRARY_URL, /^https:\/\/osu\.simplesyllabus\.com\//);
});
