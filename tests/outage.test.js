// What the page knows when data/ratings.json or data/seats.json never arrives.
//
// Both loaders cache in module state, so this file deliberately fails them and
// keeps its own process, which node --test gives every test file.

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, applyFilters } from "../js/filters.js";
import { loadRatings, ratingsFailed } from "../js/ratings.js";
import { loadSeats, seatsFailed } from "../js/seats.js";
import { entry, onlineMeeting, person, section, taught, SEATS_INDEX, SEATS_TERMS } from "./fixtures.js";
import { stubFetch } from "./helpers.js";
import { mountApp, fire, until } from "./dom.js";

// An empty route table rejects every URL, which is what a blocked file does.
const restore = stubFetch({});
await assert.rejects(loadRatings("ratings.json"));
await assert.rejects(loadSeats("1268", "seats.json"));
restore();

const TERM = "1268";
const filters = (over = {}) => ({ ...DEFAULTS, term: TERM, ...over });

// Both of these resolve against the real snapshot, so a dead file is the only
// reason they read as unrated here.
const course = () => entry("CSE", "2221", "Software I", [
  taught(1001, ["monday"], "9:10 AM", "10:05 AM", ["Diana Ikenberry Kline"]),
  taught(1002, ["tuesday"], "6:30 PM", "7:50 PM", ["Paul Sivilotti"]),
]);

test("a failed ratings load is recorded rather than swallowed", () => {
  assert.equal(ratingsFailed(), true);
});

test("a failed seats index is recorded, for every term", () => {
  assert.equal(seatsFailed(TERM), true);
  assert.equal(seatsFailed("1262"), true, "no term is readable without the index");
});

test("regression #85: ratedOnly keeps every section when ratings never loaded", () => {
  // This used to take 22 rows to 0 and print "No sections match your filters"
  // over a hidden count that was the whole search.
  const { entries, hiddenSections, hiddenCourses } = applyFilters([course()], filters({ ratedOnly: true }));
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].sections.map((s) => s.classNumber), [1001, 1002]);
  assert.equal(hiddenSections, 0);
  assert.equal(hiddenCourses, 0);
});

test("a minimum rating hides nothing when ratings never loaded", () => {
  // Nothing removes a row here even without a guard, because #50 already made
  // an unrated instructor unknown rather than bad. Pinned so a future change
  // to that rule cannot quietly turn a dead file into an empty page.
  const { entries, hiddenSections } = applyFilters([course()], filters({ rating: "4.5" }));
  assert.deepEqual(entries[0].sections.map((s) => s.classNumber), [1001, 1002]);
  assert.equal(hiddenSections, 0);
});

test("a dead ratings file does not disarm the filters that do not use it", () => {
  // hideOnline judges the meeting's room since #84, not the mode string.
  const online = entry("CSE", "2231", "Software II", [
    section(3001, {
      instructionMode: "Distance Learning",
      meetings: [onlineMeeting(["monday"], "9:00 AM", "9:55 AM", [person("Nobody Here")])],
    }),
  ]);
  assert.equal(applyFilters([online], filters({ hideOnline: true })).entries.length, 0);
});

test("one dead term does not condemn a term that loaded", async () => {
  const seats = await import("../js/seats.js?term-failure");

  let restore = stubFetch({ "seats.json": SEATS_INDEX });
  await seats.loadSeats("", "seats.json");
  restore();
  assert.equal(seats.seatsFailed("1268"), false, "never asked for is not the same as failed");

  restore = stubFetch({ "seats.json": SEATS_INDEX });
  await assert.rejects(seats.loadSeats("1268", "seats.json"));
  restore();
  assert.equal(seats.seatsFailed("1268"), true);
  assert.equal(seats.seatsFailed("1262"), false);

  // Switching terms retries, so a term that arrives on the second try has to
  // stop reading as failed or its filter stays off for the rest of the visit.
  restore = stubFetch({ "seats.json": SEATS_INDEX, "seats-1268.json": SEATS_TERMS["1268"] });
  await seats.loadSeats("1268", "seats.json");
  restore();
  assert.equal(seats.seatsFailed("1268"), false);
  assert.equal(seats.seatsFor("1001", "1268").enrolled, 30);
});

// The page, not just the filter functions. Every loader above is already dead
// in this process, so a mount here lands on the outage screen without staging
// anything else.
test("regression #85: a rating filter that is switched off is still read", async () => {
  const restore = stubFetch(new Map([
    [/searchableTermsV2/, { data: { data: [{ strm: TERM, descr: "Autumn 2026" }] } }],
    [(url) => url.includes("/classes/search"), { data: { totalItems: 2, totalPages: 1, courses: [course()] } }],
  ]));

  // What a shared link looks like when the reader's ratings snapshot is down.
  const page = await mountApp({
    query: "CSE 2221",
    term: TERM,
    url: "https://enesyilmazcode.github.io/Finder/?rating=4.5",
  });
  await until(() => page.all(".section").length > 0, "the results");

  assert.equal(page.el("#f-rating").disabled, true, "markSources turns the control off");
  assert.equal(page.el("#f-rating").value, "4.5");

  fire(page.el("#filters"), "change");

  // Read out of a FormData instead of off the control, both of these go: the
  // rating drops out of the link the student is about to share, and the button
  // that would clear it disappears while the select still shows 4.5.
  assert.match(page.location.search, /rating=4\.5/);
  assert.equal(page.el("#f-clear").hidden, false);
  restore();
});

test("an index that arrives on the retry stops every term reading as failed", async () => {
  const seats = await import("../js/seats.js?index-retry");

  let restore = stubFetch({});
  await assert.rejects(seats.loadSeats("1268", "seats.json"));
  restore();
  assert.equal(seats.seatsFailed("1268"), true);
  assert.equal(seats.seatsFailed("1262"), true);

  // The index is the whole file's worth of terms, so a blip on it turns the
  // seats filter off for every term at once. It has to come back on when the
  // second try lands, not stay off for the rest of the visit.
  restore = stubFetch({ "seats.json": SEATS_INDEX, "seats-1268.json": SEATS_TERMS["1268"] });
  await seats.loadSeats("1268", "seats.json");
  restore();
  assert.equal(seats.seatsFailed("1268"), false);
  assert.equal(seats.seatsFailed("1262"), false);
  assert.equal(seats.seatsFor("1001", "1268").enrolled, 30);
});
