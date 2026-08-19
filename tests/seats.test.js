import test from "node:test";
import assert from "node:assert/strict";

import { SEATS } from "./fixtures.js";
import { withSeats } from "./helpers.js";

const seats = await withSeats();

test("seatsFor reports an open section", () => {
  assert.deepEqual(seats.seatsFor("1001", "1268"), { enrolled: 30, limit: 40, waitlist: 0, full: false });
});

test("seatsFor calls a section at capacity full", () => {
  const row = seats.seatsFor("1002", "1268");
  assert.equal(row.full, true);
  assert.equal(row.waitlist, 3);
});

test("seatsFor calls a section over capacity full, which OSU's own API does not", () => {
  const row = seats.seatsFor("1003", "1268");
  assert.equal(row.enrolled, 41);
  assert.equal(row.limit, 40);
  assert.equal(row.full, true);
});

test("seatsFor accepts a numeric class number and a numeric term", () => {
  assert.equal(seats.seatsFor(1001, 1268).enrolled, 30);
});

test("seatsFor defaults a missing waitlist column to zero", () => {
  assert.equal(seats.seatsFor("1007", "1268").waitlist, 0);
});

test("an absent class number is unknown, never zero", () => {
  assert.equal(seats.seatsFor("9999", "1268"), null);
  assert.equal(seats.seatsFor(undefined, "1268"), null);
});

test("seatsFor refuses a malformed row", () => {
  assert.equal(seats.seatsFor("1005", "1268"), null, "row too short");
  assert.equal(seats.seatsFor("1006", "1268"), null, "enrolled is not a number");
});

// Regression, #31. [0, 0, 1] is a section with no published capacity, often
// with someone already waiting. Rendering it as 0/0 reads as wide open.
test("regression #31: a zero limit is unknown capacity, not an empty section", () => {
  assert.equal(seats.seatsFor("1004", "1268"), null);
});

// Regression, #23. The snapshot covers one term while the UI offers three.
test("regression #23: seatsFor returns null when the snapshot is for another term", () => {
  assert.equal(seats.seatsTerm(), "1268");
  assert.equal(seats.seatsFor("1001", "1262"), null, "Spring 2026 must not read Autumn seats");
  assert.equal(seats.seatsFor("1001", "1264"), null, "Summer 2026 must not read Autumn seats");
  assert.equal(seats.seatsFor("1001", "1268").enrolled, 30, "the matching term still resolves");
});

test("regression #23: seatsFor returns null when no term was asked for", () => {
  assert.equal(seats.seatsFor("1001", null), null);
  assert.equal(seats.seatsFor("1001", undefined), null);
  assert.equal(seats.seatsFor("1001", ""), null);
});

test("seatsTerm and seatsUpdated report the snapshot", () => {
  assert.equal(seats.seatsTerm(), SEATS.term);
  assert.equal(seats.seatsUpdated(), "2026-08-18");
});

test("nothing is known before a snapshot is loaded", async () => {
  const fresh = await import("../js/seats.js?unloaded");
  assert.equal(fresh.seatsTerm(), null);
  assert.equal(fresh.seatsUpdated(), null);
  assert.equal(fresh.seatsFor("1001", "1268"), null);
});

test("loadSeats caches, so a second call does not fetch again", async () => {
  // fetch is no longer stubbed here, so a real fetch would throw or hang.
  const again = await seats.loadSeats("never-fetched.json");
  assert.equal(again.term, "1268");
});
