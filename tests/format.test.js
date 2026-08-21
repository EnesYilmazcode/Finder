import test from "node:test";
import assert from "node:assert/strict";

import { formatDays, formatTime, formatWhen, formatPlace, formatUnits, instructorsOf, trendLabel } from "../js/format.js";
import { meeting, person, section } from "./fixtures.js";

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

test("formatPlace prefers the instruction mode when online", () => {
  const m = meeting(["monday"], "1:00 PM", "2:00 PM", [], { buildingDescriptionShort: "Dreese Labs" });
  assert.equal(formatPlace(m, { instructionMode: "Distance Learning - Online" }), "Distance Learning - Online");
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
