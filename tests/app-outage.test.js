// What the status line and the rail say when a snapshot did not arrive.
//
// tests/outage.test.js pins the two flags underneath. This is what #85 actually
// showed anybody: the sentence a student reads and the three controls that go
// dark. js/ratings.js stays warm across mounts, so the order here is the only
// one reachable: ratings die on the first mount and stay dead, and the second
// mount names a term whose seats the first never asked for.

import test from "node:test";
import assert from "node:assert/strict";

import { mountApp, until } from "./dom.js";
import { stubFetch } from "./helpers.js";
import { SEATS_INDEX, SEATS_TERMS } from "./fixtures.js";

const DEAD = "1268";
const LIVE = "1262";
const GONE = { ok: false, status: 503, json: async () => null };

const TERMS = { data: { data: [
  { strm: DEAD, descr: "Autumn 2026" },
  { strm: LIVE, descr: "Spring 2026" },
] } };

const routes = () => new Map([
  ["data/ratings.json", GONE],
  ["data/seats.json", SEATS_INDEX],
  [`data/seats-${DEAD}.json`, GONE],
  [`data/seats-${LIVE}.json`, SEATS_TERMS[LIVE]],
  [/searchableTermsV2/, { data: TERMS.data }],
]);

async function land(term) {
  const restore = stubFetch(routes());
  const page = await mountApp({ term });
  // showWelcome runs last in the landing branch, after markSources and the note.
  await until(() => page.el("#w-stats").textContent !== "", `the landing screen for ${term}`);
  restore();
  return page;
}

const both = await land(DEAD);
const ratingsOnly = await land(LIVE);

test("the status line names both snapshots that died", () => {
  assert.equal(
    both.el("#status").textContent,
    "Could not load instructor ratings and seat counts, so the filters that need them are off."
  );
});

test("every control whose snapshot died is switched off", () => {
  assert.equal(both.el("#f-rating").disabled, true);
  assert.equal(both.el("#f-rated").disabled, true);
  assert.equal(both.el("#f-full").disabled, true);
});

test("a term whose seats arrived drops the seats half of the note", () => {
  assert.equal(
    ratingsOnly.el("#status").textContent,
    "Could not load instructor ratings, so the filters that need them are off."
  );
});

test("a control keeps working when its own snapshot arrived", () => {
  assert.equal(ratingsOnly.el("#f-full").disabled, false);
  assert.equal(ratingsOnly.el("#f-rating").disabled, true);
  assert.equal(ratingsOnly.el("#f-rated").disabled, true);
});
