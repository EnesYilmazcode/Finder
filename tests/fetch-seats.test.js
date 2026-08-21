// The snapshotter's pure half. Nothing here fetches: the lines are built to
// Barrett's real column map so the parser has to accept them, which is what
// keeps this from testing a format nobody publishes.

import test from "node:test";
import assert from "node:assert/strict";

import { parseSubjectFile, linkGroups } from "../scripts/fetch-seats.mjs";

const HEADER = [
  "MATH         1268 (Autumn 2026)         updated: 20-Aug-2026",
  "",
  "                       class#    (autoenrolls)                                enrld/limit/+wait",
  "",
];

/** One section line, fields dropped at the columns docs/barrett-schedule.md records. */
function line({ catalog, classNumber, component, autoEnroll = "", enrolled = 10, limit = 30 }) {
  const columns = new Array(94).fill(" ");
  const put = (start, text) => { for (let i = 0; i < text.length; i++) columns[start + i] = text[i]; };
  put(4, "MATH");
  put(9, catalog);
  put(31 - String(classNumber).length, String(classNumber));
  put(31, component);
  put(33, autoEnroll);
  put(76, `${enrolled}/${limit}`);
  return columns.join("");
}

function parse(rows) {
  const parsed = parseSubjectFile("MATH", "1268", [...HEADER, ...rows.map(line)].join("\n"));
  assert.deepEqual(parsed.failures, [], "every built line has to survive the residue check");
  return parsed;
}

const LECTURE = { catalog: "1151", classNumber: 17826, component: "L", enrolled: 100, limit: 198 };
const RECITATION = { catalog: "1151", classNumber: 17827, component: "R", autoEnroll: "(17826)", enrolled: 33, limit: 33 };

test("the autoenroll column survives the parse", () => {
  const { sections } = parse([LECTURE, RECITATION]);
  assert.equal(sections[0].autoEnroll, "");
  assert.equal(sections[1].autoEnroll, "(17826)");
  assert.equal(sections[1].classNumber, "17827");
  assert.equal(sections[1].component, "R");
});

test("a group is the parent first, then what enrolls into it", () => {
  const { sections } = parse([LECTURE, RECITATION]);
  assert.deepEqual(linkGroups(sections), [["17826", "17827"]]);
});

// The direction is the whole point. Barrett writes the arrow on the recitation,
// pointing at the lecture, and both ends mean different things: the lecture is
// what you also get, the recitations are the ways in.
test("regression #67: one lecture with many labs is one group, not one blob", () => {
  const { sections } = parse([
    { catalog: "2540", classNumber: 28825, component: "L", enrolled: 528, limit: 528 },
    { catalog: "2540", classNumber: 28827, component: "B", autoEnroll: "(28825)", enrolled: 22, limit: 22 },
    { catalog: "2540", classNumber: 28828, component: "B", autoEnroll: "(28825)", enrolled: 4, limit: 22 },
  ]);
  const groups = linkGroups(sections);
  assert.equal(groups.length, 1, "one parent, one group");
  assert.deepEqual(groups[0], ["28825", "28827", "28828"]);
  // Neither lab is a member of the other's registration, so a full lab cannot
  // pull an open one off the screen with it.
  assert.equal(groups.filter((g) => g[0] === "28827").length, 0);
});

test("a row naming two parents joins both groups", () => {
  const { sections } = parse([
    { catalog: "1200", classNumber: 19726, component: "L" },
    { catalog: "1200", classNumber: 19727, component: "B" },
    { catalog: "1200", classNumber: 19728, component: "R", autoEnroll: "(19726,19727)" },
  ]);
  assert.deepEqual(linkGroups(sections), [["19726", "19728"], ["19727", "19728"]]);
});

test("groups sort by number, parent and children alike", () => {
  const { sections } = parse([
    { catalog: "1151", classNumber: 18202, component: "L" },
    { catalog: "1151", classNumber: 24639, component: "R", autoEnroll: "(18202)" },
    { catalog: "1151", classNumber: 18203, component: "R", autoEnroll: "(18202)" },
    { catalog: "1125", classNumber: 18027, component: "L" },
    { catalog: "1125", classNumber: 18028, component: "R", autoEnroll: "(18027)" },
  ]);
  assert.deepEqual(linkGroups(sections), [
    ["18027", "18028"],
    ["18202", "18203", "24639"],
  ]);
});

test("a section that autoenrolls into itself is not its own partner", () => {
  const { sections } = parse([
    { catalog: "1151", classNumber: 17826, component: "L", autoEnroll: "(17826)" },
  ]);
  assert.deepEqual(linkGroups(sections), []);
});

test("a parent Barrett does not publish is dropped, not written as a bare number", () => {
  // 18 of these in Summer 2026, for instance PHR 7000.11 section 10618 naming
  // 10616. There is no row to read seats from and nothing the site can look the
  // number up in.
  const { sections } = parse([
    { catalog: "7000.11", classNumber: 10618, component: "L", autoEnroll: "(10616)" },
  ]);
  assert.deepEqual(linkGroups(sections), []);
});

test("no autoenroll column anywhere is no groups, not an empty one", () => {
  const { sections } = parse([LECTURE]);
  assert.deepEqual(linkGroups(sections), []);
});
