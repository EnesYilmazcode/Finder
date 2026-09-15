import test from "node:test";
import assert from "node:assert/strict";

import {
  WATCH_STORAGE_KEY, isWatched, loadWatches, reconcileWatches, saveWatches, toggleWatch,
} from "../js/watch.js";

test("seat watches toggle and persist by term, campus and class", () => {
  let watches = toggleWatch([], {
    term: "1268", campus: "nwk", classNumber: 1234, courseCode: "CSE 2221",
    seats: { enrolled: 20, limit: 20, full: true },
  });
  assert.equal(isWatched(watches, "1268", "nwk", 1234), true);
  assert.equal(isWatched(watches, "1268", "col", 1234), false);
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  assert.equal(saveWatches(watches, storage), true);
  assert.ok(memory.has(WATCH_STORAGE_KEY));
  assert.deepEqual(loadWatches(storage), watches);
  watches = toggleWatch(watches, { term: "1268", campus: "nwk", classNumber: 1234 });
  assert.deepEqual(watches, []);
});

test("a watched full section is reported when it opens on a later visit", () => {
  const watches = [{
    term: "1268", campus: "col", classNumber: "1234", courseCode: "CSE 2221",
    enrolled: 20, limit: 20, full: true,
  }];
  const result = reconcileWatches(watches, "1268", "col", () => ({ enrolled: 19, limit: 20, full: false }));
  assert.equal(result.opened.length, 1);
  assert.equal(result.changed.length, 0);
  assert.equal(result.watches[0].full, false);
});
