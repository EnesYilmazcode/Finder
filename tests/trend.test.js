import test from "node:test";
import assert from "node:assert/strict";

import { appendTrend } from "../scripts/fetch-seats.mjs";
import { stubFetch, withTrend } from "./helpers.js";
import { TREND } from "./fixtures.js";

// The writer. Snapshots are the shape data/seats-{term}.json holds.

function snap(sourceUpdated, sections) {
  return { term: "1268", termName: "Autumn 2026", sourceUpdated, sections };
}

test("the first run has nothing to diff against and seeds the baseline date", () => {
  const trend = appendTrend(null, null, snap("2026-08-18", { "1001": [30, 40, 0] }));
  assert.deepEqual(trend.days, []);
  assert.equal(trend.from, "2026-08-18", "the next run measures its first delta from here");
  assert.deepEqual(trend.enrolled, {});
  assert.deepEqual(trend.opened, []);
});

test("a second run records one day of movement", () => {
  const seeded = appendTrend(null, null, snap("2026-08-18", { "1001": [30, 40, 0], "1002": [10, 40, 0] }));
  const trend = appendTrend(
    seeded,
    snap("2026-08-18", { "1001": [30, 40, 0], "1002": [10, 40, 0] }),
    snap("2026-08-19", { "1001": [34, 40, 0], "1002": [10, 40, 0] })
  );
  assert.deepEqual(trend.days, ["2026-08-19"]);
  assert.equal(trend.from, "2026-08-18");
  assert.deepEqual(trend.enrolled, { "1001": [4] });
});

// Regression, #60. This is the whole point of the file: the nightly job fetched
// both sides of the diff and wrote only one of them.
test("regression #60: overnight movement survives the write instead of being discarded", () => {
  const before = snap("2026-08-18", { "1001": [40, 40, 0], "1002": [12, 30, 0] });
  const after = snap("2026-08-19", { "1001": [38, 40, 0], "1002": [19, 30, 2] });
  const trend = appendTrend(appendTrend(null, null, before), before, after);
  assert.deepEqual(trend.enrolled, { "1001": [-2], "1002": [7] });
  assert.deepEqual(trend.waitlist, { "1002": [2] });
  assert.deepEqual(trend.opened, ["1001"]);
});

test("a section that did not move is pruned rather than stored flat", () => {
  const before = snap("2026-08-18", { "1001": [30, 40, 0], "1002": [10, 40, 0] });
  const trend = appendTrend(
    appendTrend(null, null, before),
    before,
    snap("2026-08-19", { "1001": [31, 40, 0], "1002": [10, 40, 0] })
  );
  assert.deepEqual(Object.keys(trend.enrolled), ["1001"]);
  assert.equal("1002" in trend.enrolled, false, "a flat section costs nothing");
});

test("a series that goes flat for the whole window is dropped again", () => {
  const day = (n, enrolled) => snap(`2026-08-${n}`, { "1001": [enrolled, 40, 0] });
  let trend = appendTrend(null, null, day(18, 30));
  trend = appendTrend(trend, day(18, 30), day(19, 31), 2);
  assert.deepEqual(trend.enrolled, { "1001": [1] });
  trend = appendTrend(trend, day(19, 31), day(20, 31), 2);
  assert.deepEqual(trend.enrolled, { "1001": [1, 0] }, "still inside the window");
  trend = appendTrend(trend, day(20, 31), day(21, 31), 2);
  assert.deepEqual(trend.enrolled, {}, "the only movement slid out of the window");
});

test("the window is capped and from moves with it", () => {
  const enrolled = { 18: 30, 19: 31, 20: 33, 21: 36 };
  const day = (n) => snap(`2026-08-${n}`, { "1001": [enrolled[n], 40, 0] });
  let trend = appendTrend(null, null, day(18));
  for (const n of [19, 20, 21]) trend = appendTrend(trend, day(n - 1), day(n), 2);
  assert.deepEqual(trend.days, ["2026-08-20", "2026-08-21"]);
  assert.equal(trend.from, "2026-08-19", "the day that slid off is what the window now starts from");
  assert.deepEqual(trend.enrolled, { "1001": [2, 3] });
});

// Regression, #60. data/seats-1262.json has read 2026-04-27 since April.
test("regression #60: a frozen term records no day, so it cannot stack fake flat days", () => {
  const frozen = snap("2026-04-27", { "1001": [30, 40, 0] });
  const seeded = appendTrend(null, null, frozen);
  const trend = appendTrend(seeded, frozen, frozen);
  assert.deepEqual(trend.days, []);
  assert.deepEqual(trend.enrolled, {});
  assert.deepEqual(trend, seeded, "the file on disk is left byte for byte alone");
});

test("a snapshot older than the last recorded day is refused", () => {
  const before = snap("2026-08-18", { "1001": [30, 40, 0] });
  const recorded = appendTrend(appendTrend(null, null, before), before, snap("2026-08-19", { "1001": [31, 40, 0] }));
  const rerun = appendTrend(recorded, snap("2026-08-17", { "1001": [29, 40, 0] }), snap("2026-08-18", { "1001": [30, 40, 0] }));
  assert.deepEqual(rerun, recorded);
});

test("a section Barrett only just listed contributes a zero, not its whole enrolment", () => {
  const before = snap("2026-08-18", { "1001": [30, 40, 0] });
  const trend = appendTrend(
    appendTrend(null, null, before),
    before,
    snap("2026-08-19", { "1001": [30, 40, 0], "1099": [25, 40, 0] })
  );
  assert.deepEqual(trend.enrolled, {}, "a brand new section has not moved, it has appeared");
});

test("opened is full to open only, and never a section whose capacity vanished", () => {
  const before = snap("2026-08-18", {
    "1001": [40, 40, 0], // full, will open
    "1002": [40, 40, 0], // full, loses its published capacity
    "1003": [30, 40, 0], // open, fills
    "1004": [0, 0, 1],   // no published capacity either side
  });
  const trend = appendTrend(
    appendTrend(null, null, before),
    before,
    snap("2026-08-19", {
      "1001": [39, 40, 0],
      "1002": [0, 0, 0],
      "1003": [40, 40, 0],
      "1004": [0, 0, 2],
    })
  );
  assert.deepEqual(trend.opened, ["1001"]);
});

test("opened is rebuilt each night, so a section is never marked twice for one opening", () => {
  const n1 = snap("2026-08-18", { "1001": [40, 40, 0] });
  const n2 = snap("2026-08-19", { "1001": [39, 40, 0] });
  const n3 = snap("2026-08-20", { "1001": [38, 40, 0] });
  const opened = appendTrend(appendTrend(null, null, n1), n1, n2);
  assert.deepEqual(opened.opened, ["1001"]);
  assert.deepEqual(appendTrend(opened, n2, n3).opened, [], "it opened the night before, which is not news");
});

test("a stored series that does not line up with the recorded days is rebuilt", () => {
  // Written under a different cap, so js/trend.js would refuse it forever.
  const stale = {
    term: "1268",
    from: "2026-08-16",
    days: ["2026-08-17", "2026-08-18"],
    enrolled: { "1001": [1, 1, 1] },
    waitlist: {},
    opened: [],
  };
  const before = snap("2026-08-18", { "1001": [30, 40, 0] });
  const trend = appendTrend(stale, before, snap("2026-08-19", { "1001": [32, 40, 0] }));
  assert.deepEqual(trend.days, ["2026-08-17", "2026-08-18", "2026-08-19"]);
  assert.deepEqual(trend.enrolled, { "1001": [0, 0, 2] }, "the mismatched series is dropped, not extended");
});

// The reader.

const trend = await withTrend(["1268", "1262"]);

test("three moving days badge a net change over the days they span", () => {
  // "1001" moved on 08-15, 08-16 and 08-17, from a 08-14 baseline.
  assert.deepEqual(trend.trendFor("1001", "1268"), {
    field: "enrolled",
    change: 6,
    points: 3,
    from: "2026-08-14",
    to: "2026-08-17",
    days: 3,
  });
});

// The 3-point floor. Two points is a line through any two numbers.
test("two moving days are not enough to draw anything", () => {
  assert.equal(trend.trendFor("1003", "1268"), null);
});

test("three moving days that cancel out have no direction to report", () => {
  assert.equal(trend.trendFor("1004", "1268"), null);
});

test("a series that starts moving mid-window spans from the day before it moved", () => {
  const moved = trend.trendFor("1005", "1268");
  assert.equal(moved.from, "2026-08-15", "not the 08-14 baseline, which it sat through");
  assert.equal(moved.to, "2026-08-18");
  assert.equal(moved.days, 3);
  assert.equal(moved.change, 3);
});

test("the span is measured in dates, so a night the job missed still counts", () => {
  // Term 1262 has no 2026-08-16 entry: three moving points across four days.
  const moved = trend.trendFor("2001", "1262");
  assert.equal(moved.points, 3);
  assert.equal(moved.days, 4);
});

test("the waitlist is its own series, for sections already pinned at the limit", () => {
  assert.equal(trend.trendFor("1002", "1268"), null, "nothing in the enrolled series");
  const waiting = trend.trendFor("1002", "1268", "waitlist");
  assert.equal(waiting.field, "waitlist");
  assert.equal(waiting.change, 3);
});

test("a series that does not line up with the days is refused", () => {
  assert.equal(trend.trendFor("1006", "1268"), null);
});

test("an unknown section and an unknown term both read as nothing", () => {
  assert.equal(trend.trendFor("9999", "1268"), null);
  assert.equal(trend.trendFor("1001", "9999"), null);
  assert.equal(trend.trendFor("1001", null), null);
});

test("openedOn names the night, and only for the sections that opened", () => {
  assert.equal(trend.openedOn("1002", "1268"), "2026-08-18", "the last recorded night");
  assert.equal(trend.openedOn("1001", "1268"), null);
  assert.equal(trend.openedOn("1002", "1262"), null, "opened does not cross terms");
});

test("a term with no trend file reads as nothing, not as an error", async () => {
  const missing = await import("../js/trend.js?missing");
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => null });
  try {
    await missing.loadTrend("1268", "");
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(missing.trendFor("1001", "1268"), null);
  assert.equal(missing.openedOn("1001", "1268"), null);
});

test("a malformed opened list costs the marker, not the whole file", async () => {
  const bad = await import("../js/trend.js?malformed");
  const restore = stubFetch({ "trend-1268.json": { ...TREND["1268"], opened: "1002" } });
  try {
    await bad.loadTrend("1268", "");
  } finally {
    restore();
  }
  assert.equal(bad.openedOn("1002", "1268"), null, "nothing opened, and nothing thrown");
  assert.equal(bad.trendFor("1001", "1268").change, 6, "the series still read");
});

// A blip is not an answer. seats.js retries its index the same way.
test("a fetch that failed is retried rather than remembered", async () => {
  const flaky = await import("../js/trend.js?flaky");
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network"); };
  try {
    await flaky.loadTrend("1268", "");
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(flaky.trendFor("1001", "1268"), null);

  const restore = stubFetch({ "trend-1268.json": TREND["1268"] });
  try {
    await flaky.loadTrend("1268", "");
  } finally {
    restore();
  }
  assert.equal(flaky.trendFor("1001", "1268").change, 6, "the blip did not disable the term for good");
});

test("loadTrend caches, so a second call does not fetch again", async () => {
  const restore = stubFetch({ "second/trend-1268.json": { ...TREND["1268"], enrolled: { "1001": [9, 9, 9, 0] } } });
  try {
    await trend.loadTrend("1268", "second/");
  } finally {
    restore();
  }
  assert.equal(trend.trendFor("1001", "1268").change, 6, "still the first load, not the second");
});
