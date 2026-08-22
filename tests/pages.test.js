import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression, #72. The first-party counter landed on top of the beacon without
// removing it, so both fired while two pages promised no third-party analytics.
// Any vendor's script breaks that promise, not just this one.
const PAGES = ["index.html", "stats/index.html"];

function scriptSources(html) {
  const tags = html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi);
  return [...tags].map((m) => m[1] ?? m[2] ?? m[3]);
}

test("regression #72: no page loads a third-party script", () => {
  for (const page of PAGES) {
    const sources = scriptSources(readFileSync(new URL(`../${page}`, import.meta.url), "utf8"));
    assert.ok(sources.length > 0, `no script tags found in ${page}`);
    assert.deepEqual(sources.filter((src) => /^(https?:)?\/\//i.test(src)), [], `${page} loads an external script`);
  }
});
