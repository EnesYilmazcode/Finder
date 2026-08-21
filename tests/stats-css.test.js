// The stats chart is CSS only, so this reads the stylesheet rather than a
// layout. The 1y range draws 365 bars whose 2px floor plus 2px gaps is 1458px,
// wider than .page will ever be.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../css/stats.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the rule whose selector list has `selector`, keyed by property. */
function rule(selector) {
  const block = css.split("}").find((b) => b.slice(0, b.indexOf("{"))
    .split(",").map((s) => s.trim()).includes(selector));
  assert.ok(block, `no ${selector} rule in css/stats.css`);
  return Object.fromEntries(block.slice(block.indexOf("{") + 1)
    .split(";")
    .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()])
    .filter(([prop, value]) => prop && value));
}

test("the chart scrolls its own bars instead of widening the card", () => {
  const chart = rule(".chart");
  assert.ok(["auto", "scroll"].includes(chart["overflow-x"] || chart.overflow),
    ".chart must scroll horizontally or 365 bars push the page sideways");
  assert.equal(parseFloat(rule(".card")["min-width"]), 0,
    ".card is a grid item, so it only shrinks around the chart with min-width: 0");
});
