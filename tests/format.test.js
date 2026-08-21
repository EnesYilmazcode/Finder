import test from "node:test";
import assert from "node:assert/strict";

import { formatDays, formatTime, formatWhen, formatPlace, formatUnits, instructorsOf, attributesOf, courseBadges, sectionBadges, attributeLabel } from "../js/format.js";
import { attr, entry, meeting, person, section } from "./fixtures.js";

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
