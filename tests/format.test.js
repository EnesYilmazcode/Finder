import test from "node:test";
import assert from "node:assert/strict";

import { buildingOf, formatDays, formatTime, formatWhen, formatPlace, formatUnits, formatCoverage, instructorsOf, isOnlineMeeting, trendLabel } from "../js/format.js";
import { entry, meeting, onlineMeeting, person, section } from "./fixtures.js";

const DASH = "\u2013";

test("formatDays abbreviates in week order", () => {
  assert.equal(formatDays(meeting(["monday", "wednesday", "friday"])), "MoWeFr");
  assert.equal(formatDays(meeting(["friday", "monday"])), "MoFr");
  assert.equal(formatDays(meeting(["tuesday", "thursday"])), "TuTh");
  assert.equal(
    formatDays(meeting(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])),
    "MoTuWeThFrSaSu"
  );
});

test("formatDays is empty for no days and for no meeting", () => {
  assert.equal(formatDays(meeting([])), "");
  assert.equal(formatDays(null), "");
  assert.equal(formatDays(undefined), "");
});

test("formatTime drops the space and the m", () => {
  assert.equal(formatTime(meeting([], "8:00 AM", "9:20 AM")), `8:00a${DASH}9:20a`);
  assert.equal(formatTime(meeting([], "12:45 PM", "2:05 PM")), `12:45p${DASH}2:05p`);
});

test("formatTime handles a start with no end", () => {
  assert.equal(formatTime(meeting([], "8:00 AM")), "8:00a");
});

test("formatTime is empty without a start time", () => {
  assert.equal(formatTime(meeting([])), "");
  assert.equal(formatTime(null), "");
});

test("formatWhen joins days and time", () => {
  assert.equal(formatWhen(meeting(["monday", "wednesday"], "3:00 PM", "3:55 PM")), `MoWe 3:00p${DASH}3:55p`);
});

test("formatWhen says so when there is nothing to say", () => {
  assert.equal(formatWhen(meeting([])), "Time to be announced");
  assert.equal(formatWhen(null), "Time to be announced");
});

test("formatWhen keeps whichever half it has", () => {
  assert.equal(formatWhen(meeting(["tuesday"])), "Tu");
  assert.equal(formatWhen(meeting([], "9:00 AM")), "9:00a");
});

test("buildingOf prefers the short name OSU puts on the row", () => {
  assert.equal(buildingOf(meeting([], null, null, [], { buildingDescriptionShort: "DL 266", facilityDescription: "Dreese Laboratories 266" })), "DL 266");
  assert.equal(buildingOf(meeting([], null, null, [], { facilityDescription: "Dreese Laboratories 266" })), "Dreese Laboratories 266");
  assert.equal(buildingOf(meeting([])), "");
  assert.equal(buildingOf(null), "");
});

test("isOnlineMeeting reads the building fields, not the mode", () => {
  assert.equal(isOnlineMeeting(onlineMeeting()), true);
  assert.equal(isOnlineMeeting(meeting([], null, null, [], { facilityDescriptionShort: "ONLINE" })), true);
  assert.equal(isOnlineMeeting(meeting([], null, null, [], { buildingDescriptionShort: "DL 266" })), false);
  assert.equal(isOnlineMeeting(meeting([])), false);
  assert.equal(isOnlineMeeting(null), false);
});

test("regression #84: formatPlace reads an online meeting as its mode", () => {
  // The row used to print the raw ONLINE that OSU puts in the building field.
  assert.equal(formatPlace(onlineMeeting(), { instructionMode: "Distance Learning" }), "Distance Learning");
  assert.equal(formatPlace(onlineMeeting(), { instructionMode: "Distance Enhanced" }), "Distance Enhanced");
  assert.equal(formatPlace(onlineMeeting(), null), "Online");
});

test("formatPlace shows the building for a section that meets in one", () => {
  const m = meeting(["monday"], "1:00 PM", "2:00 PM", [], { buildingDescriptionShort: "Dreese Labs" });
  assert.equal(formatPlace(m, { instructionMode: "In Person" }), "Dreese Labs");
});

test("formatPlace falls back through the building fields", () => {
  assert.equal(formatPlace({ facilityDescriptionShort: "DL 266" }, null), "DL 266");
  assert.equal(formatPlace({ facilityDescription: "Dreese Laboratories 266" }, null), "Dreese Laboratories 266");
  assert.equal(formatPlace({}, null), "Location to be announced");
  assert.equal(formatPlace(null, null), "Location to be announced");
});

test("formatUnits pluralises and collapses a fixed range", () => {
  assert.equal(formatUnits({ minUnits: 4, maxUnits: 4 }), "4 credits");
  assert.equal(formatUnits({ minUnits: 1, maxUnits: 1 }), "1 credit");
  assert.equal(formatUnits({ minUnits: 1, maxUnits: 5 }), `1${DASH}5 credits`);
});

test("formatUnits is empty when the course carries no units", () => {
  assert.equal(formatUnits({}), "");
  assert.equal(formatUnits(null), "");
  assert.equal(formatUnits({ minUnits: 3, maxUnits: null }), "3 credits");
});

/** A result carrying `p` primary and `r` related sections against `totalItems`. */
function result(p, r, totalItems) {
  const bag = (n, number, from) =>
    n ? [entry("CSE", number, `Course ${number}`, Array.from({ length: n }, (_, i) => section(from + i)))] : [];
  return { primary: bag(p, "2221", 0), related: bag(r, "5032", 10000), totalItems };
}

// #71. A whole-subject browse runs past the five page budget, so the answer on
// screen is a fraction of what matched and looks no different from a complete
// one. Two CSE pulls read 1023 and 1040 of the 1236 sections upstream.
test("formatCoverage counts related sections alongside primary ones", () => {
  assert.equal(
    formatCoverage(result(25, 998, 1236)),
    `This search read ${(1023).toLocaleString()} of about ${(1236).toLocaleString()} matching sections. Narrow the search to see the rest.`
  );
  assert.equal(
    formatCoverage(result(900, 0, 980)),
    "This search read 900 of about 980 matching sections. Narrow the search to see the rest."
  );
});

// The gate is the counts, not searchAllPages's `sorted`. A page that 429s is
// swallowed by api.js and leaves `sorted` true on a result missing 200 sections.
test("formatCoverage speaks up for a lost page, not just a truncated search", () => {
  assert.equal(
    formatCoverage(result(600, 0, 800)),
    "This search read 600 of about 800 matching sections. Narrow the search to see the rest."
  );
});

// docs/osu-api.md: totalItems stops at 10000 on a broad query, so it is a floor
// there rather than a count, and stating it as one would be its own small lie.
test("formatCoverage treats the 10,000 ceiling as a floor", () => {
  assert.equal(
    formatCoverage(result(969, 0, 10000)),
    `This search read 969 of more than ${(10000).toLocaleString()} matching sections. Narrow the search to see the rest.`
  );
});

test("formatCoverage says nothing when the whole result came back", () => {
  assert.equal(formatCoverage(result(1236, 0, 1236)), "");
  assert.equal(formatCoverage(result(30, 20, 50)), "");
  assert.equal(formatCoverage(result(40, 0, 30)), "", "a count above the total is not a shortfall");
  assert.equal(formatCoverage(result(0, 0, 0)), "");
});

// #89 later writes lastResult from a second place, and a missing count used to
// reach toLocaleString and throw out of paint().
test("formatCoverage says nothing when nobody counted the answer", () => {
  assert.equal(formatCoverage(result(30, 0, undefined)), "");
  assert.equal(formatCoverage(result(30, 0, null)), "");
});

// Shapes are what js/trend.js returns.
test("trendLabel flips the enrolled series, because a student is counting seats", () => {
  assert.equal(trendLabel({ field: "enrolled", change: 6, days: 3 }), "-6 seats in 3 days");
  assert.equal(trendLabel({ field: "enrolled", change: -4, days: 5 }), "+4 seats in 5 days");
});

test("trendLabel leaves a waitlist series the way it reads", () => {
  assert.equal(trendLabel({ field: "waitlist", change: 3, days: 4 }), "+3 waiting in 4 days");
  assert.equal(trendLabel({ field: "waitlist", change: -2, days: 4 }), "-2 waiting in 4 days");
});

test("trendLabel counts one seat and one day in the singular", () => {
  assert.equal(trendLabel({ field: "enrolled", change: -1, days: 1 }), "+1 seat in 1 day");
  assert.equal(trendLabel({ field: "enrolled", change: 1, days: 2 }), "-1 seat in 2 days");
});

test("instructorsOf dedupes a name repeated across meetings", () => {
  const s = section(1001, {
    meetings: [
      meeting(["monday"], "9:00 AM", "9:55 AM", [person("Paolo Bucci", { email: "bucci@osu.edu" })]),
      meeting(["wednesday"], "9:00 AM", "9:55 AM", [person("Paolo Bucci")]),
      meeting(["friday"], "9:00 AM", "9:55 AM", [person("Paolo Bucci")]),
    ],
  });
  const people = instructorsOf(s);
  assert.equal(people.length, 1);
  assert.equal(people[0].name, "Paolo Bucci");
  assert.equal(people[0].email, "bucci@osu.edu");
  assert.equal(people[0].role, "PI");
});

test("instructorsOf keeps every distinct instructor in order", () => {
  const s = section(1002, {
    meetings: [meeting(["tuesday"], "1:00 PM", "2:20 PM", [person("KT Vandergriff"), person("Steve Gomori")])],
  });
  assert.deepEqual(instructorsOf(s).map((p) => p.name), ["KT Vandergriff", "Steve Gomori"]);
});

test("instructorsOf trims names and skips blank ones", () => {
  const s = section(1003, {
    meetings: [meeting(["monday"], "9:00 AM", "9:55 AM", [person("  Paolo Bucci  "), person("   "), person(null)])],
  });
  assert.deepEqual(instructorsOf(s).map((p) => p.name), ["Paolo Bucci"]);
});

test("instructorsOf survives missing meetings and missing instructors", () => {
  assert.deepEqual(instructorsOf(section(1004)), []);
  assert.deepEqual(instructorsOf({ classNumber: 1005 }), []);
  assert.deepEqual(instructorsOf(null), []);
  assert.deepEqual(instructorsOf({ meetings: [{ startTime: "9:00 AM" }] }), []);
});
