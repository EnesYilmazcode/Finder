// The collapsed layout is CSS, so this reads the stylesheet rather than
// rendering it: it guards what #87 got wrong, the row list, not the heights
// that follow from it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../css/finder.css", import.meta.url), "utf8");
const collapsed = css.slice(css.search(/@media \(\s*max-width:\s*64rem\s*\)/));
const rowList = collapsed.match(/grid-template-rows:([^;]+);/)[1].trim();
// The space inside minmax() is not a track boundary.
const rows = rowList.replace(/\([^)]*\)/g, (fn) => fn.replace(/\s+/g, "")).split(/\s+/);

/** The row a pane is placed in. */
function rowOf(selector) {
  const at = collapsed.indexOf(selector + " {");
  assert.notEqual(at, -1, `no ${selector} rule in the collapsed layout`);
  const row = collapsed.slice(at, collapsed.indexOf("}", at)).match(/grid-row:\s*(\d+)/);
  assert.ok(row, `${selector} names no row in the collapsed layout`);
  return Number(row[1]);
}

test("the collapsed layout declares a row for every pane it stacks", () => {
  assert.ok(rows.length >= 3, `a header and three panes do not fit in ${rowList}`);
  for (const selector of [".rail", ".centre", ".detail"]) {
    const row = rowOf(selector);
    assert.ok(row <= rows.length, `${selector} names row ${row} of ${rows.length}`);
  }
});

test("the results keep the flexible row and the rail sits above it", () => {
  assert.match(rows[rowOf(".centre") - 1], /1fr/);
  assert.ok(rowOf(".rail") < rowOf(".centre"), "the sheet has to open above the results");
});

test("the detail pane names the same row as the results it replaces", () => {
  assert.equal(rowOf(".detail"), rowOf(".centre"));
});
