import test from "node:test";
import assert from "node:assert/strict";

import { formatDays, formatTime, formatWhen, formatPlace, formatUnits, instructorsOf, sectionFlags } from "../js/format.js";
import { meeting, person, section, taught } from "./fixtures.js";

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

const labels = (s) => sectionFlags(s).map((f) => f.label);

test("sectionFlags says nothing about an ordinary section", () => {
  assert.deepEqual(sectionFlags(taught(1001, ["monday"], "9:00 AM", "9:55 AM", ["Paolo Bucci"])), []);
});

test("sectionFlags reads consent as a code, not as a boolean", () => {
  assert.deepEqual(labels(section(1001, { consent: "I" })), ["Permission required"]);
  assert.match(sectionFlags(section(1001, { consent: "I" }))[0].detail, /cannot register for this one yourself/);
  assert.deepEqual(labels(section(1002, { consent: "D" })), ["Permission required"]);
  assert.deepEqual(labels(section(1003, { consent: false })), []);
});

test("sectionFlags flags every career that is not the undergraduate one", () => {
  assert.deepEqual(labels(section(1001, { career: "GRAD" })), ["Graduate"]);
  assert.deepEqual(labels(section(1002, { career: "UGRD" })), []);
  // Law, dentistry and optometry are careers too, and an undergraduate cannot
  // register for those either.
  assert.deepEqual(labels(section(1003, { career: "LAW" })), ["Law"]);
  assert.match(sectionFlags(section(1003, { career: "LAW" }))[0].detail, /law career/);
  assert.deepEqual(labels(section(1004, { career: "DENT" })), ["Dentistry"]);
  // A code nobody has seen yet is still worth saying out loud.
  assert.deepEqual(labels(section(1005, { career: "XYZ" })), ["Not undergraduate"]);
});

test("sectionFlags flags a section with no primary instructor", () => {
  const ta = section(1001, {
    meetings: [meeting(["monday"], "9:00 AM", "9:55 AM", [person("Sam Kim", { role: "TA" })])],
  });
  assert.deepEqual(labels(ta), ["TA-taught"]);
  assert.match(sectionFlags(ta)[0].detail, /teaching assistant/);

  // GY and GR are not teaching assistants, so the chip must not call them one.
  const grad = section(1002, {
    meetings: [meeting(["monday"], "9:00 AM", "9:55 AM", [person("Mehr Bindra", { role: "GY" })])],
  });
  assert.deepEqual(labels(grad), ["No primary instructor"]);
  assert.match(sectionFlags(grad)[0].detail, /primary instructor/);
  assert.doesNotMatch(sectionFlags(grad)[0].detail, /teaching assistant/);

  // One PI among the assistants is a professor's section like any other.
  const both = section(1003, {
    meetings: [meeting(["monday"], "9:00 AM", "9:55 AM",
      [person("Sam Kim", { role: "TA" }), person("Paolo Bucci")])],
  });
  assert.deepEqual(labels(both), []);
});

test("sectionFlags does not read an empty instructor list as a missing professor", () => {
  assert.deepEqual(labels(section(1001)), []);
});

test("sectionFlags treats only a hard zero waitlist as news", () => {
  assert.deepEqual(labels(section(1001, { waitlistCapacity: 0 })), ["No waitlist"]);
  assert.match(sectionFlags(section(1001, { waitlistCapacity: 0 }))[0].detail, /nothing to join/);
  // 999 is the API's stand-in for unbounded.
  assert.deepEqual(labels(section(1002, { waitlistCapacity: 999 })), []);
  assert.deepEqual(labels(section(1003, { waitlistCapacity: 40 })), []);
});

test("sectionFlags flags a session that is not the full term", () => {
  const short = section(1001, { sessionCode: "7W1", sessionDescription: "Session 1" });
  assert.deepEqual(labels(short), ["Not full term"]);
  assert.match(sectionFlags(short)[0].detail, /Session 1/);
  assert.deepEqual(labels(section(1002, { sessionCode: "1" })), []);
});

test("sectionFlags leaves a full summer term alone", () => {
  // Summer has no session "1". Its full term is "1S", and the eight-week and
  // four-week sessions run inside it.
  assert.deepEqual(labels(section(1001, { sessionCode: "1S", sessionDescription: "Summer Term" })), []);
  const half = section(1002, { sessionCode: "8W2", sessionDescription: "8-week Session 2" });
  assert.deepEqual(labels(half), ["Not full term"]);
  assert.match(sectionFlags(half)[0].detail, /8-week Session 2/);
});

test("sectionFlags ranks registration blockers first", () => {
  const s = section(1001, {
    consent: "I",
    career: "GRAD",
    waitlistCapacity: 0,
    sessionCode: "7W2",
    sessionDescription: "Session 2",
    meetings: [meeting(["monday"], "9:00 AM", "9:55 AM", [person("Sam Kim", { role: "TA" })])],
  });
  assert.deepEqual(sectionFlags(s).map((f) => f.key), ["consent", "career", "assistant", "waitlist", "session"]);
});

test("sectionFlags survives a section carrying none of the fields", () => {
  assert.deepEqual(sectionFlags({ classNumber: 1001 }), []);
  assert.deepEqual(sectionFlags(null), []);
});
