// The state the grade feature ships in: data/grades.json does not exist yet, so
// the pane must draw exactly what it drew before the feature landed.
//
// Its own file because module state is what is under test. A query string on
// js/detail.js does not reach js/grades.js underneath it, so the only way to
// render a pane against an unloaded grade module is a process that never loads
// one.

import test from "node:test";
import assert from "node:assert/strict";

import { renderDetail } from "../js/detail.js";
import { gradesAbsent, gradesStatus } from "../js/grades.js";
import { meeting, section } from "./fixtures.js";
import { setupDom } from "./dom.js";
import { withGrades, withRatings, withSeats } from "./helpers.js";

setupDom();
await withSeats(["1268"]);
await withRatings();
// The 404 the site really gets today.
await withGrades(null);

const CSE2221 = { subject: "CSE", catalogNumber: "2221", title: "Software I", minUnits: 4, maxUnits: 4 };
const BUCCI = section("1001", {
  meetings: [meeting(["monday", "wednesday", "friday"], "09:10", "10:05",
    [{ displayName: "Paolo Bucci", email: "bucci.2@osu.edu", role: "PI" }])],
});

const host = document.createElement("div");
host.append(renderDetail({ section: BUCCI, course: CSE2221, term: "1268", entries: [] }));

test("the file reads as unpublished rather than as a failure", () => {
  assert.equal(gradesAbsent(), true);
  assert.equal(gradesStatus({ name: "Paolo Bucci", email: "bucci.2@osu.edu" }, CSE2221), "unpublished");
});

test("no grades block is drawn", () => {
  const found = host.querySelectorAll(".d-block")
    .find((b) => b.querySelector(".eyebrow")?.textContent?.startsWith("Grades"));
  assert.equal(found, undefined);
});

test("the rest of the pane is exactly as it was", () => {
  assert.equal(host.querySelector(".d-name").textContent, "Paolo Bucci");
  const blocks = host.querySelectorAll(".d-block")
    .map((b) => b.querySelector(".eyebrow")?.textContent);
  assert.ok(blocks.includes("Seats"));
  assert.ok(blocks.includes("Meets"));
  // The rating figures still lead the pane, since only the grade block moved.
  assert.ok(host.querySelector(".d-figs"));
  assert.ok(host.querySelector(".spread"), "the rating spread is untouched");
  assert.equal(host.querySelector(".gspread"), null);
});
