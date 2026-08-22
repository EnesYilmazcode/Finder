// The README's network audit is the repo's privacy statement, and it is a count
// of things, so a branch that adds one module makes it wrong without touching
// it. That has now happened twice. The two counts a static read can settle are
// pinned against the tree here, and the paragraph's own arithmetic with them.
//
// Re-measure in a headed Chrome. Headless does not fetch the favicon, so it
// reports one request fewer than a visitor makes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path/posix";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

const html = read("index.html");
const paragraph = read("README.md").match(/Opening the page is [\s\S]*?the favicon\./)?.[0];
assert.ok(paragraph, "the README no longer carries the network audit paragraph this test reads");

const WORDS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ");

/** The number the paragraph writes in front of `noun`, in digits or in words. */
function claimed(noun) {
  const found = paragraph.match(new RegExp(String.raw`(\w+) ${noun}`));
  assert.ok(found, `the paragraph no longer counts ${noun}`);
  const spelled = WORDS.indexOf(found[1]);
  return spelled >= 0 ? spelled : Number(found[1]);
}

// Keyed on `from`, so a re-export counts as an edge the way an import does.
const EDGE = /\b(?:from|import)\s*["'](\.[^"']+)["']/g;

/** Every module the page pulls, entries included, following relative imports. */
function modules() {
  const queue = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const found of read(file).matchAll(EDGE)) {
      queue.push(join(dirname(file), found[1]));
    }
  }
  return seen;
}

test("the audit counts the modules the page actually pulls", () => {
  assert.equal(claimed("modules"), modules().size, "a module was added or dropped without a re-measure");
});

test("the audit counts the stylesheets index.html links", () => {
  const linked = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"/g)].length;
  assert.equal(claimed("stylesheets"), linked, "a stylesheet was linked or dropped without a re-measure");
});

test("the audit's own numbers add up", () => {
  // The HTML, the ratings snapshot and the favicon are one each, and the term
  // list is the only file that is not this repo's.
  const repo = 1 + claimed("stylesheets") + claimed("font files") + claimed("modules")
    + 1 + claimed("seat files") + 1;
  assert.equal(claimed("files from this repo"), repo, "the parts do not add to the total");
  assert.equal(claimed("requests"), repo + 1, "the term list is the one request that is not one of those files");
});
