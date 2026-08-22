// The one test in this repo that talks to Ohio State.
//
// `gen-categories` matches a verbatim human-written string, and a reword
// upstream returns zero rather than an error, so the committed list in
// js/api.js can rot without anything failing. This walks it and fails on a
// category that comes back empty in every searchable term.
//
// Skipped unless FINDER_LIVE=1, so `node --test` stays offline. The weekly
// GE categories workflow is what runs it.

import test from "node:test";
import assert from "node:assert/strict";

import { fetchTerms, searchClasses, GEN_CATEGORIES } from "../js/api.js";

const skip = process.env.FINDER_LIVE === "1" ? false : "set FINDER_LIVE=1 to call Ohio State";

const RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The three snapshot scripts all back off the same way. A rot detector that
// goes red on one bad morning is one people stop reading.
async function withRetry(call) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt === RETRIES) throw error;
      await sleep(500 * 2 ** attempt);
    }
  }
}

const terms = skip ? [] : await withRetry(fetchTerms);

test("the term list loads", { skip }, () => {
  assert.ok(terms.length, "no searchable terms");
});

// One term is not enough to judge a category by. Measured on 2026-08-20,
// Number, Nature, Mind and Origins and Evolution both return zero for Summer
// 2026 and are offered in the other two terms, so a per-term assertion would
// fail on a term being small. A reworded string returns zero everywhere.
for (const category of GEN_CATEGORIES) {
  test(`${category} still returns courses`, { skip }, async () => {
    const counts = [];
    for (const term of terms) {
      const { totalItems } = await withRetry(() => searchClasses({ q: "", term: term.code, genCategory: category }));
      counts.push(`${term.code}=${totalItems}`);
      if (totalItems > 0) return;
    }
    assert.fail(
      `nothing in any term (${counts.join(" ")}). Ohio State either reworded this string or `
      + `stopped offering the category. The small ones go quiet first: Service Learning was 2 `
      + `sections in Autumn 2026 and zero in the other two terms.`
    );
  });
}
