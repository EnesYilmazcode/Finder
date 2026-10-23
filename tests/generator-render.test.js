import test from "node:test";
import assert from "node:assert/strict";

import { setupDom, fire, until } from "./dom.js";
import { renderGenerator } from "../js/generator-render.js";
import { entry, taught } from "./fixtures.js";

function options(overrides = {}) {
  return {
    desired: ["CSE 2221", "MATH 1151"],
    preferences: { earliest: "09:00", latest: "17:00", excludeFull: true, weights: {} },
    results: [], phase: "idle", note: "",
    onBack() {}, onAdd() { return true; }, onRemove() {}, onGenerate() {}, onUse() {},
    ...overrides,
  };
}

test("the builder exposes clear constraints and only available ranking priorities", () => {
  const page = setupDom();
  const view = renderGenerator(options());
  page.document.body.append(view);
  assert.equal(view.querySelector("#gen-course").placeholder, "Course number or name");
  assert.equal(view.querySelectorAll(".gen-course-chip").length, 2);
  assert.equal(view.querySelectorAll(".gen-weight input").length, 5);
  assert.match(view.textContent, /Open seats/);
  assert.match(view.textContent, /RateMyProfessors rating/);
  assert.match(view.textContent, /Shorter gaps/);
  assert.match(view.textContent, /Only open classes/);
  assert.match(view.textContent, /Online \/ distance includes classes with no set meeting time/);
  assert.doesNotMatch(view.textContent, /Grade history|Fewer campus days/);
  assert.equal(view.querySelectorAll(".gen-modes input").length, 4);
  assert.equal(view.querySelector(".gen-generate").disabled, false);
});

test("submitting preferences returns the visible bounds and weights", () => {
  const page = setupDom();
  let received = null;
  const view = renderGenerator(options({ onGenerate: (value) => { received = value; } }));
  page.document.body.append(view);
  fire(view.querySelector(".gen-preferences"), "submit");
  assert.equal(received.earliest, "09:00");
  assert.equal(received.latest, "17:00");
  assert.equal(received.excludeFull, true);
  assert.deepEqual(received.allowedModes, ["inPerson", "hybrid", "distance", "arranged"]);
  assert.equal(received.weights.seats, 1);
  assert.equal(Object.keys(received.weights).length, 5);
});

test("course suggestions show course names and add the selected choice", async () => {
  const page = setupDom();
  let added = null;
  const choice = { key: "CSE 2421", code: "CSE 2421", title: "Systems I", codes: ["CSE 2421"] };
  const view = renderGenerator(options({
    onSuggest: async () => [choice],
    onAdd: (value) => { added = value; return true; },
  }));
  page.document.body.append(view);
  const input = view.querySelector("#gen-course");
  input.value = "CSE 24";
  fire(input, "input");
  await until(() => view.querySelector(".gen-suggestion"), "course suggestions");
  assert.match(view.querySelector(".gen-suggestion").textContent, /CSE 2421Systems I/);
  view.querySelector(".gen-suggestion").click();
  assert.equal(added, choice);
});

test("a ranked result explains its evidence and can be adopted", () => {
  const page = setupDom();
  const cse = entry("CSE", "2221", "Software 1", [taught(1001, ["monday"], "10:00 AM", "10:55 AM", ["Ada Teacher"])]);
  const result = {
    score: 84.4,
    packages: [{ course: cse.course, sections: cse.sections, desiredKey: "CSE 2221", packageKey: "1001" }],
    metrics: { minSeats: 8, rating: 4.2, gaps: 55, averageStart: 600, averageEnd: 900 },
    factors: { seats: 80, rating: 80, lateStart: 30, earlyEnd: 60, compactGaps: 88 },
  };
  let used = null;
  let pinned = null;
  const view = renderGenerator(options({
    results: [result],
    preferences: { earliest: "09:00", latest: "17:00", excludeFull: true, weights: { seats: 1, rating: 1, lateStart: 1, earlyEnd: 1, compactGaps: 1 } },
    onUse: (value) => { used = value; },
    onPin: (value) => { pinned = value; },
  }));
  page.document.body.append(view);
  assert.match(view.querySelector(".gen-result").textContent, /Best fit/);
  assert.doesNotMatch(view.querySelector(".gen-result").textContent, /84 match|historical GPA|campus days/);
  assert.match(view.querySelector(".gen-factors").textContent, /Shorter gaps: strong/);
  assert.match(view.querySelector(".gen-result").textContent, /8minimum seats/);
  assert.match(view.querySelector(".gen-result").textContent, /Sections 1001/);
  view.querySelector(".gen-pin").click();
  assert.equal(pinned, result.packages[0]);
  view.querySelector(".gen-use").click();
  assert.equal(used, result);
});
