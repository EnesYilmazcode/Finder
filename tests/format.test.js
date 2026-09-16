import test from "node:test";
import assert from "node:assert/strict";

import { attributesOf, attributeLabel, buildingOf, busyLabel, courseBadges, dayCodes, distinctMeetings, formatDays, formatTime, formatWhen, formatPlace, formatUnits, formatCoverage, instructorsOf, isOnlineMeeting, sectionBadges, sectionFlags, trendLabel } from "../js/format.js";
import { attr, entry, meeting, onlineMeeting, person, section, taught } from "./fixtures.js";

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

test("dayCodes abbreviates a plain list of days in week order", () => {
  assert.equal(dayCodes(["thursday", "tuesday"]), "TuTh");
  assert.equal(dayCodes([]), "");
});

test("busyLabel reads like the section rows", () => {
  assert.equal(busyLabel({ days: ["tuesday", "thursday"], start: 575, end: 655 }), `TuTh 9:35a${DASH}10:55a`);
  // 1440 is the midnight that ends the day, not the one that starts it.
  assert.equal(busyLabel({ days: ["monday"], start: 720, end: 1440 }), `Mo 12:00p${DASH}12:00a`);
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

test("instructorsOf uses an early Barrett listing kept off the meeting", () => {
  const people = instructorsOf({
    meetings: [],
    fallbackInstructors: [{ displayName: "P. Bucci", role: "PI", source: "barrett" }],
  });
  assert.deepEqual(people, [{ name: "P. Bucci", email: null, role: "PI", source: "barrett" }]);
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
      // Same label, different long name. buildingOf never reads the long one, so
      // this is the same line on screen and has to collapse.
      meeting(["tuesday"], "2:20 PM", "3:40 PM", [], room("BE 120", "Baker Systems 340")),
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

// Attributes, #65. Every case below is a shape pulled from the live API on
// 2026-08-20, term 1268.

// MATH 1116, which carries both GE generations at once. Its section 24462 adds
// an Ohio Transfer 36 mapping the course object never lists.
const M1116 = {
  courseAttributes: [
    attr("CCP", "LEVEL 1", "Level 1 CCP course"),
    attr("GE", "QL2", "GEL Quantitative Reasoning: Math and Logical Anly"),
    attr("GE2", "F2", "GEN Foundation: Math & Quant Reason (or Data Anyl)"),
  ],
};

const M1116_SECTION = section(24462, {
  attributes: [
    attr("CCP", "LEVEL 1", "Level 1 CCP course"),
    attr("GE", "QL2", "GEL Quantitative Reasoning: Math and Logical Anly"),
    attr("GE2", "F2", "GEN Foundation: Math & Quant Reason (or Data Anyl)"),
    attr("OTM", "TMMSL", "Ohio Transfer 36 - Math, Statistics, and Logic"),
  ],
});

// ART 3009, which declares nothing at the course level and puts the same GE on
// all three of its sections.
const A3009 = entry("ART", "3009", "Film/Video I", [
  section(23898, { attributes: [attr("GE2", "F3", "GEN Foundation: Literary, Visual & Performing Arts")] }),
  section(27699, { attributes: [attr("GE2", "F3", "GEN Foundation: Literary, Visual & Performing Arts")] }),
  section(38529, { attributes: [attr("GE2", "F3", "GEN Foundation: Literary, Visual & Performing Arts")] }),
], { courseAttributes: [attr("", "", "")] });

test("attributesOf keeps what only the section knows", () => {
  const merged = attributesOf(M1116, M1116_SECTION);
  assert.deepEqual(merged.map((a) => `${a.name} ${a.value}`),
    ["GE2 F2", "GE QL2", "CCP LEVEL 1", "OTM TMMSL"]);
  assert.equal(merged.find((a) => a.name === "OTM").description, "Ohio Transfer 36 - Math, Statistics, and Logic");
});

test("attributesOf puts the current GE ahead of the legacy one", () => {
  // The API sends GE before GE2 and the rest in its own order, which is kept.
  assert.deepEqual(attributesOf(M1116).map((a) => a.name), ["GE2", "GE", "CCP"]);
});

test("attributesOf dedupes what both copies carry", () => {
  // The section repeats all three of the course's attributes verbatim.
  assert.equal(attributesOf(M1116, M1116_SECTION).length, 4);
  assert.equal(attributesOf(M1116).length, 3);
  assert.equal(attributesOf(null, M1116_SECTION).length, 4);
});

test("attributesOf keeps two values of the same name", () => {
  // ENGLISH 3264 counts for two themes at once. Deduping on the name alone
  // would silently drop one of them.
  const course = {
    courseAttributes: [
      attr("GE2", "T1", "GEN Theme: Citizenship for a Diverse & Just World"),
      attr("GE2", "T3", "GEN Theme: Health and Well-being"),
    ],
  };
  assert.deepEqual(attributesOf(course).map((a) => a.value), ["T1", "T3"]);
});

test("attributesOf drops the blank placeholder", () => {
  // A course with nothing to declare sends one all-empty entry rather than an
  // empty array. CSE 5911 is one, and 212 of 316 courses sampled did the same.
  const course = { courseAttributes: [attr("", "", "")] };
  assert.deepEqual(attributesOf(course), []);
  assert.deepEqual(attributesOf(course, section(5622)), []);
});

test("attributesOf survives missing courses, sections and arrays", () => {
  assert.deepEqual(attributesOf(null, null), []);
  assert.deepEqual(attributesOf(undefined), []);
  assert.deepEqual(attributesOf({}, {}), []);
  assert.deepEqual(attributesOf({ courseAttributes: null }, { attributes: null }), []);
});

test("courseBadges reads the course record when it has one", () => {
  assert.deepEqual(courseBadges(M1116, [M1116_SECTION]).map((a) => `${a.name} ${a.value}`),
    ["GE2 F2", "GE QL2"]);
});

test("courseBadges falls back to what every section agrees on", () => {
  // Without this ART 3009 shows no GE at all, which is the bug #65 reports.
  assert.deepEqual(courseBadges(A3009.course, A3009.sections).map((a) => `${a.name} ${a.value}`), ["GE2 F3"]);
});

test("courseBadges will not claim a GE only one section carries", () => {
  const sections = [...A3009.sections, section(40000, { attributes: [] })];
  assert.deepEqual(courseBadges(A3009.course, sections), []);
  assert.deepEqual(courseBadges(A3009.course), []);
});

test("sectionBadges keeps the fee and the honors marking and nothing else", () => {
  // CSE 5351 section 37829 next to the codes that belong to the course.
  const s = section(37829, {
    attributes: [
      attr("CRSF", "CF225", "COL Course Fee $225"),
      attr("ALX", "72", "Digital Txtbook Fee(s): $72"),
      attr("HON", "CHON", "Honors Course"),
      attr("EXAM", "MID", "Midterm"),
    ],
  });
  assert.deepEqual(sectionBadges(s).map((a) => `${a.name} ${a.value}`), ["ALX 72", "HON CHON"]);
  assert.deepEqual(sectionBadges(null), []);
});

test("attributeLabel tells the current GE from the legacy one", () => {
  assert.equal(attributeLabel(attr("GE2", "F2", "GEN Foundation: Math & Quant Reason (or Data Anyl)")), "GE F2");
  assert.equal(attributeLabel(attr("GE", "QL2", "GEL Quantitative Reasoning: Math and Logical Anly")), "Legacy GE QL2");
});

test("attributeLabel prices a textbook fee", () => {
  // CSE 5351 section 37829.
  assert.equal(attributeLabel(attr("ALX", "72", "Digital Txtbook Fee(s): $72")), "$72");
  assert.equal(attributeLabel(attr("ALX", "90.91", "Digital Txtbook Fee(s): $90.91")), "$90.91");
});

test("attributeLabel separates the two kinds of honors", () => {
  assert.equal(attributeLabel(attr("HON", "CHON", "Honors Course")), "Honors");
  assert.equal(attributeLabel(attr("HON", "EHON", "Embedded Honors")), "Embedded honors");
});

test("attributeLabel falls back to the raw code", () => {
  assert.equal(attributeLabel(attr("OTM", "TMMSL", "Ohio Transfer 36 - Math, Statistics, and Logic")), "OTM TMMSL");
  assert.equal(attributeLabel(attr("CIV", "CIV", "Civic Literacy")), "CIV CIV");
  assert.equal(attributeLabel(null), "");
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
