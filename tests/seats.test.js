import test from "node:test";
import assert from "node:assert/strict";

import { withSeats } from "./helpers.js";

// Both terms loaded, so the cross-term guard can be tested for real rather
// than by the absence of data.
const seats = await withSeats(["1268", "1262"]);

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
test("regression #23: a term that is not loaded reads as unknown, not as another term", async () => {
  // The original guard compared one snapshot's term against the requested one.
  // Since #48 seats are keyed by term, so the guard is structural: a term with
  // nothing loaded has no map to read and cannot borrow another term's rows.
  const partial = await withSeats(["1268"], "?autumn-only");
  assert.equal(partial.seatsFor("1001", "1268").enrolled, 30, "the loaded term resolves");
  assert.equal(partial.seatsFor("1001", "1262"), null, "Spring is listed but not loaded");
  // Three distinct answers, none of which collapse into each other:
  //   ready   its seats are in hand
  //   unknown Barrett has this term, we have not fetched it
  //   missing Barrett publishes nothing for this term, which is settled
  assert.equal(partial.seatsStatus("1268"), "ready");
  assert.equal(partial.seatsStatus("1262"), "unknown", "listed but never fetched");
  assert.equal(partial.seatsStatus("9999"), "missing", "not published at all");
});

test("regression #23: seatsFor returns null when no term was asked for", () => {
  assert.equal(seats.seatsFor("1001", null), null);
  assert.equal(seats.seatsFor("1001", undefined), null);
  assert.equal(seats.seatsFor("1001", ""), null);
});

test("seatsTerm and seatsUpdated answer per term", () => {
  // #48: Barrett freezes a term once it is over, so the dates genuinely differ.
  // A single snapshot-wide date would stamp Autumn's freshness onto Spring.
  assert.equal(seats.seatsTerm("1268"), "1268");
  assert.equal(seats.seatsUpdated("1268"), "2026-08-18");
  assert.equal(seats.seatsUpdated("1262"), "2026-04-27");
});

test("regression #23: the same class number resolves per term, never across", () => {
  // 1001 exists in both fixtures with different numbers, so a cross-term leak
  // would show up as the wrong figure rather than as missing data.
  assert.equal(seats.seatsFor("1001", "1268").enrolled, 30);
  assert.equal(seats.seatsFor("1001", "1262").enrolled, 10);
  assert.equal(seats.seatsFor("2001", "1268"), null, "a Spring-only section is not served for Autumn");
});

test("a term the index does not list is settled, not pending", () => {
  // "missing" and "loading" must not collapse: one is an answer, one is a wait.
  assert.equal(seats.seatsStatus("1268"), "ready");
  assert.equal(seats.seatsStatus("9999"), "missing");
  assert.equal(seats.seatsFor("1001", "9999"), null);
});

test("nothing is known before a snapshot is loaded", async () => {
  const fresh = await import("../js/seats.js?unloaded");
  assert.equal(fresh.seatsTerm("1268"), null);
  assert.equal(fresh.seatsUpdated("1268"), null);
  assert.equal(fresh.seatsFor("1001", "1268"), null);
  assert.equal(fresh.seatsStatus("1268"), "unknown", "not loaded is not the same as not published");
  assert.equal(fresh.seatsFailed("1268"), false, "never tried is not the same as failed");
});

test("a term the index does not list is not a failure", () => {
  assert.equal(seats.seatsFailed("1268"), false);
  assert.equal(seats.seatsFailed("9999"), false, "Barrett publishing nothing is an answer");
});

test("loadSeats caches, so a second call does not fetch again", async () => {
  // fetch is no longer stubbed here, so a real fetch would throw or hang.
  const again = await seats.loadSeats("1268", "never-fetched.json");
  assert.ok(again.terms.some((t) => t.term === "1268"));
});
