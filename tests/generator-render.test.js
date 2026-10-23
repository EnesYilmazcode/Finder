import test from "node:test";
import assert from "node:assert/strict";

import { setupDom, fire } from "./dom.js";
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

test("the builder exposes desired courses, constraints and all ranking priorities", () => {
  const page = setupDom();
  const view = renderGenerator(options());
  page.document.body.append(view);
  assert.equal(view.querySelectorAll(".gen-course-chip").length, 2);
  assert.equal(view.querySelectorAll(".gen-weight input").length, 7);
  assert.match(view.textContent, /Open seats/);
  assert.match(view.textContent, /Grade history/);
  assert.match(view.textContent, /Shorter gaps/);
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
  assert.equal(received.weights.seats, 1);
  assert.equal(Object.keys(received.weights).length, 7);
});

test("a ranked result explains its evidence and can be adopted", () => {
  const page = setupDom();
  const cse = entry("CSE", "2221", "Software 1", [taught(1001, ["monday"], "10:00 AM", "10:55 AM", ["Ada Teacher"])]);
  const result = {
    score: 84.4,
    packages: [{ course: cse.course, sections: cse.sections }],
    metrics: { minSeats: 8, rating: 4.2, gpa: 3.5, days: 3, gaps: 55, averageStart: 600, averageEnd: 900 },
  };
  let used = null;
  const view = renderGenerator(options({ results: [result], onUse: (value) => { used = value; } }));
  page.document.body.append(view);
  assert.match(view.querySelector(".gen-result").textContent, /84 match/);
  assert.match(view.querySelector(".gen-result").textContent, /8minimum seats/);
  assert.match(view.querySelector(".gen-result").textContent, /Sections 1001/);
  view.querySelector(".gen-use").click();
  assert.equal(used, result);
});
