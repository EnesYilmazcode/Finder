// The grade curve in the right pane. Like the rest of js/detail.js this fetches
// nothing: the loaders have already put the fixture into the real module.
//
// What these pin is mostly what the pane refuses to draw. A curve carries the
// registrar's authority, so every way it can be absent has to read as absent
// rather than as a number.

import test from "node:test";
import assert from "node:assert/strict";

import { renderDetail } from "../js/detail.js";
import { entry, person, meeting, section, taught, SEATS_TERMS } from "./fixtures.js";
import { setupDom } from "./dom.js";
import { withGrades, withRatings, withSeats } from "./helpers.js";

setupDom();
await withSeats(["1268"]);
await withRatings();
await withGrades();

const MWF = ["monday", "wednesday", "friday"];
const CSE2221 = { subject: "CSE", catalogNumber: "2221", title: "Software I", minUnits: 4, maxUnits: 4 };

/** A section taught by one instructor with an OSU address, the ordinary case. */
function bySomeone(name, email, classNumber = "1001") {
  return section(classNumber, {
    meetings: [meeting(MWF, "09:10", "10:05", [{ displayName: name, email, role: "PI" }])],
  });
}

function pane(target, course = CSE2221) {
  const host = document.createElement("div");
  host.append(renderDetail({ section: target, course, term: "1268", entries: [] }));
  return host;
}

/** The grades block, or null when the pane drew none. */
function gradeBlock(host) {
  return host.querySelectorAll(".d-block")
    .find((b) => b.querySelector(".eyebrow")?.textContent?.startsWith("Grades")) ?? null;
}

const notes = (block) => block.querySelectorAll(".d-note").map((n) => n.textContent);
const figures = (block) => block.querySelectorAll(".d-fig").map((f) => [
  f.querySelector(".d-num").textContent,
  f.querySelector(".d-cap").textContent,
]);

test("the block is headed with the years the records cover", () => {
  const block = gradeBlock(pane(bySomeone("Paolo Bucci", "bucci.2@osu.edu")));
  assert.equal(block.querySelector(".eyebrow").textContent, "Grades, Autumn 2021 to Spring 2026");
});

test("the figures lead with the mean and the share who got an A", () => {
  const block = gradeBlock(pane(bySomeone("Paolo Bucci", "bucci.2@osu.edu")));
  assert.deepEqual(figures(block), [
    ["2.77", "average GPA"],
    ["35%", "got A or A-"],
    ["860", "graded"],
  ]);
});

test("the curve draws eleven marks, A on the left", () => {
  const block = gradeBlock(pane(bySomeone("Paolo Bucci", "bucci.2@osu.edu")));
  const bar = block.querySelector(".gspread");
  const segments = bar.querySelectorAll("i");
  assert.equal(segments.length, 11);
  assert.equal(segments[0].className, "g0");
  assert.equal(segments[0].title, "180 got A");
  assert.equal(segments[10].title, "90 got E");
  // Spoken as well as drawn, the way the rating spread is.
  assert.match(bar.getAttribute("aria-label"), /^180 got A, 120 got A-/);
});

test("withdrawals sit beside the curve, not inside it", () => {
  const block = gradeBlock(pane(bySomeone("Paolo Bucci", "bucci.2@osu.edu")));
  const row = block.querySelectorAll(".d-row")
    .find((line) => line.textContent.startsWith("Withdrew"));
  // 61 of 921, which is 7%: the 860 in the mean plus the 61 that cannot be.
  assert.match(row.textContent, /61 of 921 \(7%\)/);
});

test("the sample size rides along with the curve", () => {
  const block = gradeBlock(pane(bySomeone("Paolo Bucci", "bucci.2@osu.edu")));
  assert.ok(notes(block).some((n) => n === "Across 22 sections over 9 terms."));
});

test("sections the registrar withheld are named, not silently missing", () => {
  const block = gradeBlock(pane(bySomeone("Paolo Bucci", "bucci.2@osu.edu")));
  assert.ok(notes(block).some((n) => n.includes("2 more sections were too small to publish")));
});

test("a course whose every section was withheld says so instead of vanishing", () => {
  const block = gradeBlock(pane(bySomeone("Wes Fenwick", "fenwick.9@osu.edu"), { subject: "CSE", catalogNumber: "5911" }));
  assert.equal(block.querySelector(".gspread"), null, "there is no curve to draw");
  assert.match(notes(block)[0], /withheld this curve: all 3 of their sections were small enough/);
});

test("a pass-fail course says that rather than drawing an empty curve", () => {
  const block = gradeBlock(pane(bySomeone("Ada Nkemelu", "nkemelu.4@osu.edu"), { subject: "CSE", catalogNumber: "4998" }));
  assert.equal(block.querySelector(".gspread"), null);
  assert.match(notes(block)[0], /graded satisfactory or unsatisfactory/);
});

test("a thin curve says how thin", () => {
  const block = gradeBlock(pane(bySomeone("Nora Whitfield", "whitfield.2@osu.edu"), { subject: "CSE", catalogNumber: "3241" }));
  assert.ok(notes(block).some((n) => n === "Only 8 graded students, so treat this as thin evidence."));
});

test("an instructor with no record draws no block at all", () => {
  assert.equal(gradeBlock(pane(bySomeone("Someone Unknown", "nobody.4@osu.edu"))), null);
});

test("a record in another course is not a record in this one", () => {
  // Bucci has a curve, but not in MATH 1151.
  const block = gradeBlock(pane(bySomeone("Paolo Bucci", "bucci.2@osu.edu"), { subject: "MATH", catalogNumber: "1151" }));
  assert.equal(block, null);
});

test("a co-taught section gets no curve, the way it gets no rating", () => {
  const shared = section("1001", {
    meetings: [meeting(MWF, "09:10", "10:05", [
      { displayName: "Paolo Bucci", email: "bucci.2@osu.edu", role: "PI" },
      { displayName: "Diana Kline", email: "kline.1@osu.edu", role: "PI" },
    ])],
  });
  assert.equal(gradeBlock(pane(shared)), null, "an average across two people is not either person's");
});

test("a section with no instructor draws no curve", () => {
  assert.equal(gradeBlock(pane(section("1001", { meetings: [meeting(MWF, "09:10", "10:05", [])] }))), null);
});

test("a name finds the curve when the section carries no address", () => {
  const noEmail = taught("1001", MWF, "09:10", "10:05", ["Diana Ikenberry Kline"]);
  const block = gradeBlock(pane(noEmail, { subject: "MATH", catalogNumber: "1151" }));
  assert.equal(figures(block)[2][0], "104");
});
