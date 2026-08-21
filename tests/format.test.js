import test from "node:test";
import assert from "node:assert/strict";

import { formatDays, formatTime, formatWhen, formatPlace, formatUnits, instructorsOf, distinctMeetings } from "../js/format.js";
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

// Regression, #82. CSE 2112 class 8823 comes back with ten meetings for one
// Tuesday class, alternating the room label between BE 120 and Baker Syst.
// Printing a line per meeting turned that row into nine repeats.
test("regression #82: a pattern repeated per room label counts once", () => {
  const room = (short, full) => ({ buildingDescriptionShort: short, buildingDescription: full });
  const s = section(8823, {
    meetings: [
      meeting(["tuesday"], "2:20 PM", "3:40 PM", [], room("BE 120", "Baker Systems 120")),
      meeting(["tuesday"], "2:20 PM", "3:40 PM", [], room("Baker Syst", "Baker Systems 470")),
      meeting(["tuesday"], "2:20 PM", "3:40 PM", [], room("BE 120", "Baker Systems 120")),
      meeting(["tuesday"], "2:20 PM", "3:20 PM", [], room("Baker Syst", "Baker Systems 470")),
    ],
  });
  assert.deepEqual(
    distinctMeetings(s).map((m) => `${formatWhen(m)} ${m.buildingDescriptionShort}`),
    [`Tu 2:20p${DASH}3:40p BE 120`, `Tu 2:20p${DASH}3:40p Baker Syst`, `Tu 2:20p${DASH}3:20p Baker Syst`]
  );
});

// Regression, #82. Class 15671 really does meet twice, and MUSIC 2203.04
// section 19215 really is booked into two Weigel rooms for the same hour.
// Neither may be collapsed.
test("regression #82: meetings that differ in time or room are all kept", () => {
  const split = section(15671, {
    meetings: [
      meeting(["tuesday"], "8:00 AM", "10:55 AM", [], { buildingDescriptionShort: "CE 310" }),
      meeting(["thursday"], "4:10 PM", "5:05 PM", [], { buildingDescriptionShort: "MP 1040" }),
    ],
  });
  assert.equal(distinctMeetings(split).length, 2);

  const twoRooms = section(19215, {
    meetings: [
      meeting(["monday", "wednesday", "friday"], "4:10 PM", "5:05 PM", [], { buildingDescriptionShort: "WG 174" }),
      meeting(["monday", "wednesday", "friday"], "4:10 PM", "5:05 PM", [], { buildingDescriptionShort: "WG 100A" }),
    ],
  });
  assert.equal(distinctMeetings(twoRooms).length, 2);
});

test("distinctMeetings survives missing meetings", () => {
  assert.deepEqual(distinctMeetings(section(1001)), []);
  assert.deepEqual(distinctMeetings({ classNumber: 1002 }), []);
  assert.deepEqual(distinctMeetings(null), []);
});
