import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_SCHEDULE_STORAGE_KEY, SCHEDULE_STORAGE_KEY, activeSchedule, addScheduleItem,
  createSchedulePlan, deleteSchedulePlan, formatPlan, isScheduled, loadSchedule,
  loadScheduleBook, parsePlan, registrationText, removeScheduleItem, renameSchedulePlan,
  replaceActiveSchedule, saveSchedule, scheduleConflicts, scheduleEntries, scheduleTravelWarnings,
  selectSchedulePlan,
} from "../js/schedule.js";
import { entry, meeting, section, taught } from "./fixtures.js";

const TERM = "1268";
const MWF = ["monday", "wednesday", "friday"];

function item(subject, number, classNumber, days, start, end) {
  const found = entry(subject, number, `${subject} course`, [taught(classNumber, days, start, end, ["Ada Teacher"])]);
  return { term: TERM, course: found.course, section: found.sections[0] };
}

test("a schedule adds one copy of a section and removes it by term", () => {
  const first = item("CSE", "2221", 1001, MWF, "9:00 AM", "9:55 AM");
  const updated = { ...first, course: { ...first.course, title: "Fresh title" } };
  let schedule = addScheduleItem([], first);
  schedule = addScheduleItem(schedule, updated);
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].course.title, "Fresh title");
  assert.equal(isScheduled(schedule, TERM, 1001), true);
  assert.deepEqual(removeScheduleItem(schedule, TERM, 1001), []);
});

test("the same class number can be saved independently at two campuses", () => {
  const columbus = { ...item("CSE", "2221", 1001, MWF, "9:00 AM", "9:55 AM"), campus: "col" };
  const newark = { ...columbus, campus: "nwk" };
  const schedule = addScheduleItem(addScheduleItem([], columbus), newark);
  assert.equal(schedule.length, 2);
  assert.equal(isScheduled(schedule, TERM, 1001, "col"), true);
  assert.equal(isScheduled(schedule, TERM, 1001, "nwk"), true);
  assert.deepEqual(removeScheduleItem(schedule, TERM, 1001, "nwk"), [columbus]);
});

test("plan links accept unique class numbers only and stay bounded", () => {
  assert.equal(formatPlan([1001, "1001", "nope", 1002]), "1001,1002");
  assert.deepEqual(parsePlan("1001,nope,1002,1001"), ["1001", "1002"]);
  assert.equal(parsePlan(Array.from({ length: 30 }, (_, i) => 1000 + i).join(",")).length, 24);
});

test("storage round trips valid items and survives unavailable storage", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const schedule = [item("CSE", "2221", 1001, MWF, "9:00 AM", "9:55 AM")];
  assert.equal(saveSchedule(schedule, storage), true);
  assert.ok(memory.has(SCHEDULE_STORAGE_KEY));
  assert.deepEqual(loadSchedule(storage), schedule);
  assert.deepEqual(loadSchedule({ getItem: () => "broken json" }), []);
  assert.equal(saveSchedule(schedule, { setItem: () => { throw new Error("blocked"); } }), false);
});

test("legacy storage migrates into named plans and variants stay separate", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const original = item("CSE", "2221", 1001, MWF, "9:00 AM", "9:55 AM");
  memory.set(LEGACY_SCHEDULE_STORAGE_KEY, JSON.stringify({ version: 1, items: [original] }));
  let book = loadScheduleBook(storage);
  assert.equal(book.plans[0].name, "Plan A");
  assert.deepEqual(activeSchedule(book), [original]);

  book = createSchedulePlan(book, { name: "Late days", copy: true });
  assert.equal(book.plans.length, 2);
  assert.equal(activeSchedule(book).length, 1);
  book = renameSchedulePlan(book, book.active, "  Late   start  ");
  assert.equal(book.plans[1].name, "Late start");
  const first = book.plans[0].id;
  book = selectSchedulePlan(book, first);
  book = replaceActiveSchedule(book, []);
  assert.equal(activeSchedule(book).length, 0);
  book = deleteSchedulePlan(book, first);
  assert.equal(book.plans.length, 1);
  assert.equal(book.plans[0].name, "Late start");
});

test("conflicts inspect every meeting and do not flag adjacent classes", () => {
  const a = item("CSE", "2221", 1001, ["tuesday"], "9:00 AM", "10:00 AM");
  a.section.meetings.push(meeting(["thursday"], "2:00 PM", "3:00 PM"));
  const b = item("MATH", "1151", 2001, ["thursday"], "2:30 PM", "3:30 PM");
  const adjacent = item("STAT", "3201", 3001, ["tuesday"], "10:00 AM", "11:00 AM");
  assert.deepEqual(scheduleConflicts([a, b, adjacent]).map((c) => c.days), [["thursday"]]);
});

test("the same clock time in different terms is not a conflict", () => {
  const a = item("CSE", "2221", 1001, MWF, "9:00 AM", "9:55 AM");
  const b = { ...item("MATH", "1151", 2001, MWF, "9:00 AM", "9:55 AM"), term: "1272" };
  assert.deepEqual(scheduleConflicts([a, b]), []);
});

test("scheduled sections regroup into the calendar's entry shape", () => {
  const items = [
    item("CSE", "2221", 1001, MWF, "9:00 AM", "9:55 AM"),
    item("CSE", "2221", 1002, MWF, "10:20 AM", "11:15 AM"),
    item("MATH", "1151", 2001, MWF, "1:00 PM", "1:55 PM"),
  ];
  assert.deepEqual(scheduleEntries(items, TERM).map((found) => found.sections.length), [2, 1]);
});

test("a linked section rides on the calendar without becoming another selection", () => {
  const lab = item("CSE", "2221", 1011, ["tuesday"], "10:20 AM", "11:15 AM");
  const lecture = item("CSE", "2221", 1001, MWF, "9:00 AM", "9:55 AM");
  lab.included = [{ course: lecture.course, section: lecture.section }];
  const entries = scheduleEntries([lab], TERM);
  assert.equal(entries[0].sections.length, 2);
  assert.deepEqual(entries[0].sections.map((found) => found.classNumber), [1011, 1001]);
});

test("a chosen linked alternative rides on the calendar too", () => {
  const lecture = item("CSE", "2221", 1001, MWF, "9:00 AM", "9:55 AM");
  const lab = item("CSE", "2221", 1011, ["tuesday"], "10:20 AM", "11:15 AM");
  lecture.choices = [{ course: lab.course, section: lab.section }];
  lecture.choice = lecture.choices[0];
  assert.deepEqual(scheduleEntries([lecture], TERM)[0].sections.map((found) => found.classNumber), [1001, 1011]);
});

test("registration copy includes primary and chosen linked class numbers", () => {
  const lecture = item("CSE", "2221", 1001, MWF, "9:00 AM", "9:55 AM");
  const lab = item("CSE", "2221", 1011, ["tuesday"], "10:20 AM", "11:15 AM");
  lecture.choice = { course: lab.course, section: lab.section };
  assert.equal(registrationText([lecture], TERM), "1001\tCSE 2221\tLecture\n1011\tCSE 2221\tLecture\tLinked choice");
});

test("walking conflicts compare the gap between consecutive meetings", () => {
  const a = item("CSE", "2221", 1001, ["tuesday"], "9:00 AM", "10:00 AM");
  const b = item("MATH", "1151", 2001, ["tuesday"], "10:10 AM", "11:00 AM");
  a.section.meetings[0].buildingDescription = "Dreese Laboratories 264";
  b.section.meetings[0].buildingDescription = "Page Hall 10";
  const warnings = scheduleTravelWarnings([a, b], TERM, "col", () => 14);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].gap, 10);
  assert.equal(scheduleTravelWarnings([a, b], TERM, "col", () => 8).length, 0);
});
