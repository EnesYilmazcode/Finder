// The calendar's sizing is split between js/calendar.js and the stylesheet, and
// the half that lives in CSS has no other guard: #83's fix is two rules there,
// and nothing in a node test renders a block. So this reads the sheet.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cssRules } from "./helpers.js";

const css = readFileSync(new URL("../css/finder.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const rule = cssRules(css, "css/finder.css");

test("regression #83: the track floor is per column, not per week", () => {
  assert.match(rule(".cal-col")["min-width"], /var\(--cal-split/,
    "each day's track has to be floored from its own split");
  assert.ok(!Object.values(rule(".cal")).some((value) => value.includes("--cal-split")),
    "a floor on .cal is the whole week's, so one crowded Wednesday widens Monday");
});

test("regression #83: the chrome renderSlot budgets for stays on one line", () => {
  // The heights in js/calendar.js are single-line. A wrapped label costs an
  // instructor line that nothing there subtracted, and .cal-slot hides it.
  for (const selector of [".cal-time", ".cal-count", ".cal-more"]) {
    const declared = rule(selector);
    assert.equal(declared["white-space"], "nowrap", `${selector} may not wrap`);
    assert.equal(declared["text-overflow"], "ellipsis", `${selector} says nothing when cut`);
  }
});

const NARROW = /@container[^{]*\(\s*max-width:\s*([\d.]+)px\s*\)\s*{\s*([^{]+){([^}]*)}/g;

/** The block width below which `selector` is dropped, in px. */
function dropsBelow(selector) {
  const found = [...css.matchAll(NARROW)].find(([, , selectors, body]) =>
    selectors.split(",").map((s) => s.trim()).includes(selector) && /display:\s*none/.test(body));
  assert.ok(found, `nothing drops ${selector} on a narrow block`);
  return Number(found[1]);
}

test("a block too narrow for the whole line keeps the name and drops the numbers", () => {
  assert.equal(rule(".cal-slot")["container-type"], "inline-size",
    "the drop-out asks the block how wide it is, so the block has to be the container");
  // Both numbers are flex: none, so without this the name is what shrinks to
  // nothing: on a bare MATH search 12 of 235 names rendered at 0px wide.
  assert.ok(dropsBelow(".cal-seats") > dropsBelow(".cal-rate"),
    "the seat count is the wider of the two, so it is the first to go");
  assert.equal(rule(".cal-who")["min-width"], "0",
    ".cal-who has to be allowed to shrink, or a long name pushes the numbers out");
});
