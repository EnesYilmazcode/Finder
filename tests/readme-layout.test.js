// The repo layout block in the README is a list of files kept by hand, so a
// branch that adds a module leaves it wrong without ever touching it. That has
// now happened to four modules at once. Reading js/ off disk pins the block in
// both directions without anyone re-counting anything.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const readme = readFileSync(new URL("README.md", root), "utf8").replace(/\r\n/g, "\n");

const block = readme.match(/## Repo layout\n+```\n([\s\S]*?)\n```/)?.[1];
assert.ok(block, "the README no longer carries the repo layout block this test reads");

// The js/ entries are the only ones indented under a directory line.
const listed = new Set([...block.matchAll(/^ {2}(\S+\.js)\b/gm)].map((found) => found[1]));
const present = readdirSync(new URL("js/", root)).filter((file) => file.endsWith(".js"));

test("the layout block names every module in js/", () => {
  assert.deepEqual(present.filter((file) => !listed.has(file)), [],
    "a module was added without a line in the README");
});

test("the layout block names no module js/ has lost", () => {
  assert.deepEqual([...listed].filter((file) => !present.includes(file)), [],
    "a module was renamed or deleted without a README edit");
});
