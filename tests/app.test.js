// app.js drives the page and needs a document, so it is not imported here the
// way the other modules are. What is checked is the order of init(), which is
// what #80 broke.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Checked out with CRLF here, which the closing-brace scan below would miss.
const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** A top-level function body, up to the closing brace in column one. */
function bodyOf(name) {
  const start = source.indexOf(`function ${name}(`);
  return start < 0 ? "" : source.slice(start, source.indexOf("\n}\n", start));
}

const init = bodyOf("init");
const awaitTerms = init.indexOf("await fetchTerms()");
const runSearch = bodyOf("runSearch");

test("the shapes this file reads are still there", () => {
  assert.ok(init, "init() not found in js/app.js");
  assert.ok(awaitTerms > 0, "init() no longer awaits fetchTerms()");
  assert.ok(init.includes("addEventListener("), "init() registers no listeners at all");
  assert.ok(runSearch.includes("searchAllPages("), "runSearch() no longer searches");
});

test("every listener is registered before the terms request is awaited", () => {
  const at = [...init.matchAll(/addEventListener\(/g)].map((m) => m.index);
  assert.deepEqual(at.filter((i) => i > awaitTerms), [], "a listener is registered after the terms request");
  // A floor, so moving the registrations into a helper called after the await
  // fails here instead of passing on an empty list.
  assert.ok(at.length >= 10, `init() registers ${at.length} listeners, which is too few to be all of them`);
  const submit = init.indexOf('els.form.addEventListener("submit"');
  assert.ok(submit > 0 && submit < awaitTerms, "the submit handler is not registered before the terms request");
});

test("a shared link's query goes back in the box before the terms request", () => {
  const at = init.indexOf('params.get("q")');
  assert.ok(at > 0, "init() no longer reads ?q=");
  assert.ok(at < awaitTerms, "?q= only reaches the box after the terms request");
});

test("the searches init owes are run once the terms land, not before", () => {
  const after = init.slice(awaitTerms);
  assert.ok(after.includes("runSearch("), "nothing searches once the terms land");
  assert.ok(after.includes("queuedQuery"), "a search asked for while the terms loaded is never run");
});

test("runSearch holds the query rather than search without a term", () => {
  const guard = runSearch.search(/if \(!term\b/);
  assert.ok(guard > 0, "the empty-term guard is gone from runSearch()");
  assert.ok(guard < runSearch.indexOf("searchAllPages("));
  assert.ok(runSearch.includes("queuedQuery ="), "the refused query is no longer held for init to run");
});
