// Where the seat count sits on a section row is CSS alone: js/render.js appends
// the cell and the stylesheet decides which line it lands on. Five later
// branches append their own extras into the same grid, and a displaced seat
// count still renders, so nothing that builds a row can catch this either.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cssRules } from "./helpers.js";

const css = readFileSync(new URL("../css/finder.css", import.meta.url), "utf8");

const AT_RULE = /@(?:media|container|supports)[^{]*\{/g;

// cssRules splits on braces, so a nested rule reads as if it applied at every
// width, but only when a sibling ahead of it has already absorbed the prelude.
// Measured on this sheet: .seat-cell survives a whole-sheet read and .section
// comes back with the 34rem track list. So split the widths apart first.
const wide = [];
const narrow = [];
let after = 0;
for (const found of css.matchAll(AT_RULE)) {
  if (found.index < after) continue;
  let depth = 1;
  let end = found.index + found[0].length;
  while (depth > 0) {
    if (css[end] === "{") depth += 1;
    else if (css[end] === "}") depth -= 1;
    end += 1;
  }
  wide.push(css.slice(after, found.index));
  if (/max-width:\s*34rem/.test(found[0])) narrow.push(css.slice(found.index + found[0].length, end - 1));
  after = end;
}
wide.push(css.slice(after));

const rule = cssRules(wide.join(""), "css/finder.css");
const atNarrow = cssRules(narrow.join(""), "css/finder.css below 34rem");

/** How many columns a track list declares. The space inside minmax() is not a boundary. */
function columns(list) {
  return list.replace(/\([^)]*\)/g, (fn) => fn.replace(/\s+/g, "")).split(/\s+/).length;
}

test("the seat count holds the section's own line", () => {
  const wideColumns = columns(rule(".section")["grid-template-columns"]);
  assert.equal(wideColumns, 3, `the row is ${wideColumns} columns wide, so 3 is not the last one`);

  const seat = rule(".seat-cell");
  assert.equal(seat["grid-column"], "3", "the seat cell owns the last column outright");
  // Without a row of its own the cell auto-places after the last extra placed
  // ahead of it, which drops the seat count next to an unrelated meeting.
  assert.equal(seat["grid-row"], "1", "the seat cell has to name the row its section's time is on");
  // The other half: an extra goes under the time it belongs to, never beside it.
  assert.equal(rule(".section-where")["grid-column"], "2", "row extras land in column 2");
});

test("a row too narrow for three columns gives the seat count its own line", () => {
  assert.ok(columns(atNarrow(".section")["grid-template-columns"]) < 3,
    "column 3 stops existing here, which is why the cell has to be told to move");
  const seat = atNarrow(".seat-cell");
  assert.equal(seat["grid-column"], "1 / -1", "the cell takes the whole row once it cannot have a column of its own");
  // Column alone is not enough: the pinned row 1 would keep the full-width cell
  // on the class number's line and squeeze everything else off it.
  assert.equal(seat["grid-row"], "auto");
});
