// The client is only tested for the request it builds and the errors it turns
// responses into. fetch is replaced, so nothing here touches the network.

import test from "node:test";
import assert from "node:assert/strict";

import { ApiError, fetchTerms, searchClasses, searchAllPages, termCodeFor, defaultTerm } from "../js/api.js";

/** Record every request and answer each with the given body. */
function capture(body, init = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(String(url)));
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => {
        if (init.badJson) throw new SyntaxError("Unexpected token");
        return typeof body === "function" ? body(calls.length) : body;
      },
    };
  };
  return calls;
}

const original = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = original; });

const searchBody = { data: { totalItems: 2, totalPages: 1, courses: [{ course: { subject: "CSE" }, sections: [] }] } };

// Regression, #12. Upstream dereferences q without checking it exists, so
// leaving it off returns a 500 rather than an unfiltered search.
test("regression #12: an empty query still sends q=", () => {
  const cases = ["", null, undefined];
  return Promise.all(
    cases.map(async (q) => {
      const calls = capture(searchBody);
      await searchClasses({ q, term: "1268" });
      const url = calls[0];
      assert.ok(url.searchParams.has("q"), `q is missing for ${JSON.stringify(q)}`);
      assert.equal(url.searchParams.get("q"), "");
      assert.ok(url.search.includes("q="), url.search);
    })
  );
});

test("searchClasses sends the campus, term and page alongside the query", async () => {
  const calls = capture(searchBody);
  await searchClasses({ q: "CSE 2221", term: "1268", page: 3 });
  const url = calls[0];
  assert.equal(url.origin + url.pathname, "https://content.osu.edu/v2/classes/search");
  assert.equal(url.searchParams.get("q"), "CSE 2221");
  assert.equal(url.searchParams.get("campus"), "col");
  assert.equal(url.searchParams.get("term"), "1268");
  assert.equal(url.searchParams.get("p"), "3");
});

test("searchClasses defaults to page one and reports the totals", async () => {
  capture(searchBody);
  const result = await searchClasses({ q: "CSE", term: "1268" });
  assert.equal(result.page, 1);
  assert.equal(result.totalItems, 2);
  assert.equal(result.courses.length, 1);
});

test("searchClasses refuses to search without a term", async () => {
  capture(searchBody);
  await assert.rejects(() => searchClasses({ q: "CSE" }), ApiError);
});

test("an error status becomes a readable ApiError carrying the status", async () => {
  capture(searchBody, { ok: false, status: 503 });
  await assert.rejects(
    () => searchClasses({ q: "", term: "1268" }),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 503);
      assert.match(err.message, /503/);
      return true;
    }
  );
});

test("a body that is not JSON becomes an ApiError", async () => {
  capture(searchBody, { badJson: true });
  await assert.rejects(() => searchClasses({ q: "", term: "1268" }), ApiError);
});

test("a body with no data envelope becomes an ApiError", async () => {
  capture({ error: "nope" });
  await assert.rejects(() => searchClasses({ q: "", term: "1268" }), ApiError);
});

test("a failed connection becomes an ApiError rather than a TypeError", async () => {
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(
    () => searchClasses({ q: "", term: "1268" }),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.match(err.message, /Could not reach/);
      return true;
    }
  );
});

test("an abort becomes the timeout message", async () => {
  globalThis.fetch = async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };
  await assert.rejects(
    () => searchClasses({ q: "", term: "1268" }),
    (err) => {
      assert.match(err.message, /taking too long/);
      return true;
    }
  );
});

test("fetchTerms keeps only real terms and sorts them newest first", async () => {
  capture({
    data: {
      data: [
        { strm: 1262, descr: "Spring 2026", startDate: "2026-01-05", endDate: "2026-04-24" },
        { descr: "Broken row with no strm" },
        { strm: 1268, descr: "Autumn 2026" },
        { strm: 1264 },
      ],
    },
  });
  const terms = await fetchTerms();
  assert.deepEqual(terms.map((t) => t.code), ["1268", "1264", "1262"]);
  assert.equal(terms[2].name, "Spring 2026");
  assert.equal(terms[1].name, "1264", "a term with no description falls back to its code");
  assert.equal(terms[0].startDate, null);
});

test("termCodeFor derives the strm code from the month", () => {
  assert.equal(termCodeFor(new Date("2026-03-01T12:00:00Z")), "1262");
  assert.equal(termCodeFor(new Date("2026-06-01T12:00:00Z")), "1264");
  assert.equal(termCodeFor(new Date("2026-08-18T12:00:00Z")), "1268");
  assert.equal(termCodeFor(new Date("2026-04-30T12:00:00Z")), "1262", "April is still spring");
  assert.equal(termCodeFor(new Date("2026-07-31T12:00:00Z")), "1264", "July is still summer");
  assert.equal(termCodeFor(new Date("2027-01-05T12:00:00Z")), "1272");
});

test("defaultTerm picks today's term when it is searchable", () => {
  const terms = [{ code: "1268" }, { code: "1264" }, { code: "1262" }];
  assert.equal(defaultTerm(terms, new Date("2026-08-18T12:00:00Z")).code, "1268");
});

test("defaultTerm falls back to the newest term rather than nothing", () => {
  const terms = [{ code: "1264" }, { code: "1262" }];
  assert.equal(defaultTerm(terms, new Date("2026-08-18T12:00:00Z")).code, "1264");
  assert.equal(defaultTerm([], new Date()), null);
  assert.equal(defaultTerm(null, new Date()), null);
});

test("searchAllPages merges the pages it fetched", async () => {
  const calls = capture((n) => ({
    data: { totalItems: 9, totalPages: 3, courses: [{ course: { subject: "CSE", catalogNumber: String(n) }, sections: [] }] },
  }));
  const result = await searchAllPages({ q: "Smith", term: "1268" });
  assert.equal(result.pagesFetched, 3);
  assert.equal(result.courses.length, 3);
  assert.deepEqual(calls.map((u) => u.searchParams.get("p")).sort(), ["1", "2", "3"]);
});

test("a result too big for the budget falls back to relevance order", async () => {
  // #53: the first request is always a sorted probe. When totalPages exceeds
  // the budget, that sorted page is the wrong 200 sections, because catalog
  // order front-loads the lowest numbers. So the pull restarts in relevance
  // order and the probe is kept as extra coverage rather than discarded.
  // The cost is one request above the budget, paid only by oversized queries.
  const calls = capture({ data: { totalItems: 100, totalPages: 7, courses: [] } });
  const result = await searchAllPages({ q: "CSE", term: "1268", maxPages: 2 });

  assert.equal(calls.length, 3, "one sorted probe plus maxPages relevance pages");
  assert.equal(result.pagesFetched, 3);
  assert.equal(result.sorted, false, "the caller is told the order is not catalog order");

  const sorted = calls.filter((u) => u.searchParams.has("sort"));
  assert.equal(sorted.length, 1, "only the probe carries sort");
  assert.equal(sorted[0].searchParams.get("p"), "1");
  assert.deepEqual(
    calls.filter((u) => !u.searchParams.has("sort")).map((u) => u.searchParams.get("p")).sort(),
    ["1", "2"],
    "the relevance pull starts again from page 1"
  );
});

test("a result inside the budget stays in catalog order", async () => {
  // The repeatable path: no fallback, every request sorted, no extra probe.
  const calls = capture({ data: { totalItems: 40, totalPages: 3, courses: [] } });
  const result = await searchAllPages({ q: "CSE 2221", term: "1268", maxPages: 5 });

  assert.equal(calls.length, 3);
  assert.equal(result.sorted, true);
  assert.ok(calls.every((u) => u.searchParams.has("sort")), "every page sorted");
});

test("searchAllPages does not fetch again for a single page", async () => {
  const calls = capture({ data: { totalItems: 1, totalPages: 1, courses: [] } });
  const result = await searchAllPages({ q: "CSE 2221", term: "1268" });
  assert.equal(result.pagesFetched, 1);
  assert.equal(calls.length, 1);
});

test("one failing page does not sink the whole search", async () => {
  let n = 0;
  globalThis.fetch = async () => {
    n += 1;
    if (n > 1) throw new TypeError("fetch failed");
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { totalItems: 4, totalPages: 2, courses: [{ course: {}, sections: [] }] } }),
    };
  };
  const result = await searchAllPages({ q: "Smith", term: "1268" });
  assert.equal(result.courses.length, 1);
  assert.equal(result.pagesFetched, 2);
});

// The signature carries three parameters added by three branches, and
// destructuring drops an unknown one without a word, so each is pinned at the
// wire rather than at the call.
test("searchAllPages sends every scope it was handed", async () => {
  const calls = capture({ data: { totalItems: 2, totalPages: 1, courses: [] } });
  await searchAllPages({ q: "MATH", term: "1268", subject: "math", genCategory: "GEN Theme: Sustainability" });

  assert.equal(calls[0].searchParams.get("subject"), "math");
  assert.equal(calls[0].searchParams.get("q"), "", "a picked code moves out of q");
  assert.equal(calls[0].searchParams.get("gen-categories"), "GEN Theme: Sustainability");
});

test("searchAllPages leaves off a scope nobody picked", async () => {
  const calls = capture({ data: { totalItems: 2, totalPages: 1, courses: [] } });
  await searchAllPages({ q: "Smith", term: "1268" });

  assert.equal(calls[0].searchParams.has("subject"), false);
  assert.equal(calls[0].searchParams.has("gen-categories"), false);
});

// A picked code is not a guess, so an empty answer is the answer. The keyword
// fallback would silently widen a browse the student chose.
test("searchAllPages does not retry unscoped after a picked subject finds nothing", async () => {
  const calls = capture({ data: { totalItems: 0, totalPages: 0, courses: [] } });
  await searchAllPages({ q: "", term: "1268", subject: "arab" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("subject"), "arab");
});
