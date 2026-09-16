// The right pane, plus the one rule it shares with the row and the list: a
// section whose registration package puts its free seats out of reach.
//
// Nothing in js/detail.js fetches, so every test here is a single render
// against snapshots the real loaders have already put into the real modules.

import test from "node:test";
import assert from "node:assert/strict";

import { renderDetail } from "../js/detail.js";
import { renderSection } from "../js/render.js";
import { applyFilters, DEFAULTS } from "../js/filters.js";
import { seatsFor } from "../js/seats.js";
import { attr, entry, meeting, section, taught, RATINGS, SEATS_TERMS, TREND } from "./fixtures.js";
import { setupDom } from "./dom.js";
import { withRatingCourses, withRatings, withSeats, withTrend } from "./helpers.js";

setupDom();
await withSeats(["1268"]);
// Every section is marked as having opened overnight, so the tests that render
// a row can ask each one whether it earns the badge. The pane never reads
// `opened`, only js/render.js does, and the movement series the pane does read
// are the fixture's own.
const trend = await withTrend(["1268"], "", {
  "1268": { ...TREND["1268"], opened: Object.keys(SEATS_TERMS["1268"].sections) },
});
await withRatingCourses(await withRatings());

const MWF = ["monday", "wednesday", "friday"];
const CSE2221 = { subject: "CSE", catalogNumber: "2221", title: "Software I", minUnits: 4, maxUnits: 4 };
const BLOCKED = "This section cannot be registered: another section in its package is full.";

/** What app.js does with the fragment renderDetail hands back. */
function pane(target, { course = CSE2221, term = "1268", entries = [], formatDate } = {}) {
  const host = document.createElement("div");
  host.append(renderDetail({ section: target, course, term, entries, formatDate }));
  return host;
}

/** One block of the pane by its heading, since the pane is a flat list of them. */
function blockNamed(host, title) {
  const found = host.querySelectorAll(".d-block")
    .find((b) => b.querySelector(".eyebrow")?.textContent === title);
  if (!found) throw new Error(`no "${title}" block in the pane`);
  return found;
}

/** A block's rows as [label, value, tone]. */
function rows(block) {
  return block.querySelectorAll(".d-row").map((line) => {
    const [label, value] = line.children;
    return [label.textContent, value.textContent, value.className.replace("d-val", "").trim()];
  });
}

function rowNamed(block, label) {
  return block.querySelectorAll(".d-row").find((line) => line.children[0].textContent === label) ?? null;
}

function notes(host) {
  return host.querySelectorAll(".d-note").map((n) => n.textContent);
}

// #67. The pane carries the child side of a package, which the row deliberately
// does not.

test("#67: a lab lists what registering for it also registers you for", () => {
  const block = blockNamed(pane(section(1013, { component: "Laboratory" })), "Also enrolls you in");
  assert.deepEqual(rows(block), [
    ["1001", "30/40", "is-open"],
    ["1002", "40/40", "is-full"],
  ], "1013 sits under two parents, which is Barrett's two-parent row");
});

test("#67: a lecture lists every way in, and unpublished capacity is not zero", () => {
  const block = blockNamed(pane(section(1002)), "Register through one of these");
  assert.deepEqual(rows(block), [
    ["1010", "5/24", "is-open"],
    ["1013", "3/20", "is-open"],
    ["1014", "—", "is-none"],
  ]);
});

test("#67: the ways in are listed open first, not in the order Barrett wrote them", () => {
  const block = blockNamed(pane(section(1001)), "Register through one of these");
  assert.deepEqual(rows(block).map(([label]) => label), ["1012", "1013", "1011"],
    "1011 is 22/22 and Barrett lists it first");
});

test("#67: a partner is named with its component when the results on screen carry it", () => {
  const onScreen = [entry("CSE", "2221", "Software I", [
    section(1011, { component: "Recitation" }),
    section(1012, { component: "Recitation" }),
  ])];
  const block = blockNamed(pane(section(1001), { entries: onScreen }), "Register through one of these");
  assert.deepEqual(rows(block).map(([label]) => label), ["1012 · Recitation", "1013", "1011 · Recitation"],
    "1013 is not in these results, so there is nothing to call it");
});

// #60. The pane gets the movement as a sentence, where the row gets a badge.

test("#60: an open section's movement is one line, with the nights behind it", () => {
  const line = rowNamed(blockNamed(pane(section(1001)), "Seats"), "Trend");
  assert.ok(line, "1001 moved on three of the four recorded nights");
  assert.equal(line.children[1].textContent, "-6 seats in 3 days");
  assert.equal(line.title, "3 snapshots moved between 2026-08-14 and 2026-08-17.");
});

test("#60: a full section's line counts the waitlist, never seats it does not have", () => {
  const seats = blockNamed(pane(section(1002)), "Seats");
  const line = rowNamed(seats, "Trend");
  assert.ok(line, "1002 has no enrolled series, so reading that one leaves the line off entirely");
  assert.equal(line.children[1].textContent, "+3 waiting in 3 days");
  assert.equal(rowNamed(seats, "Enrolled").children[1].textContent, "40 / 40",
    "and the row above still reads full");
});

// #69. Ratings, once the separate course-code snapshot has landed.

test("#69: the rating spread is five segments, described for a screen reader", () => {
  const bar = pane(taught(1001, MWF, "9:00 AM", "9:55 AM", ["Diana Ikenberry Kline"])).querySelector(".spread");
  assert.ok(bar, "Diana Kline's 31 ratings carry a distribution");
  assert.equal(bar.getAttribute("role"), "img");
  assert.equal(bar.getAttribute("aria-label"), "1 rated 1, 1 rated 2, 4 rated 3, 10 rated 4, 15 rated 5");
  assert.deepEqual(bar.children.map((segment) => segment.className), ["s1", "s2", "s3", "s4", "s5"]);
  assert.equal(bar.children[4].style.width, "48.38709677419355%", "15 of the 31");
});

test("#69: the spread says which end is which", () => {
  const host = pane(taught(1001, MWF, "9:00 AM", "9:55 AM", ["Diana Ikenberry Kline"]));
  assert.equal(host.querySelector(".spread-cap")?.textContent, "1 to 5, left to right");
});

test("#69: the pane says how many of the ratings are for the course on screen", () => {
  const host = pane(taught(1001, MWF, "9:00 AM", "9:55 AM", ["Diana Ikenberry Kline"]));
  assert.ok(notes(host).includes("22 of 31 ratings are for CSE 2221."),
    `the four ways a rater writes one code all count: ${JSON.stringify(notes(host))}`);
});

test("#69: an instructor rated only for other courses is said to have none here", () => {
  const host = pane(taught(1001, MWF, "9:00 AM", "9:55 AM", ["Tim Long"]));
  assert.ok(notes(host).includes("None of the 12 ratings name CSE 2221."),
    `12 ratings, every one of them MATH 1151: ${JSON.stringify(notes(host))}`);
});

test("#69: the figures lead with the rating and its count", () => {
  // Read off the fixture rather than pinned to it: #63 gives Kline a difficulty
  // of her own, and a literal here reads as the pane regressing.
  const kline = RATINGS.professors.find((p) => p.lastName === "Kline");
  const figs = pane(taught(1001, MWF, "9:00 AM", "9:55 AM", ["Diana Ikenberry Kline"])).querySelector(".d-figs");
  assert.deepEqual(
    figs.querySelectorAll(".d-num").map((n) => n.textContent),
    [kline.avgRating.toFixed(1), kline.avgDifficulty.toFixed(1)]
  );
  assert.deepEqual(
    figs.querySelectorAll(".d-cap").map((n) => n.textContent),
    [`${kline.numRatings} ratings`, "difficulty"]
  );
});

// #65. The pane is where the codes get spelled out, and the badge is the same
// chip the row uses. A second chip class here is what the merge was built to
// avoid.
test("#65: the pane spells out the attributes the row only badges", () => {
  const target = section(1001, {
    attributes: [attr("ALX", "72", "Digital Txtbook Fee(s): $72"), attr("GE", "QL2", "GEL Quantitative Reasoning")],
  });
  const block = blockNamed(pane(target), "Attributes");
  assert.deepEqual(
    block.querySelectorAll(".flag").map((chip) => [chip.dataset.flag, chip.textContent]),
    // Curriculum credit leads, so the pane and the course header never disagree
    // about which GE to read first.
    [["GE", "Legacy GE QL2"], ["ALX", "$72"]]
  );
  assert.deepEqual(block.querySelectorAll(".d-attr-desc").map((n) => n.textContent),
    ["GEL Quantitative Reasoning", "Digital Txtbook Fee(s): $72"]);
  assert.ok(block.querySelectorAll(".d-note").map((n) => n.textContent)
    .some((line) => line.startsWith("Legacy GE codes are the old curriculum")));
});

// The rest of the pane, which nothing pinned either.

test("the Meets block reads the meeting, the room, the mode and the dates", () => {
  const target = {
    ...section(1001, {
      meetings: [meeting(MWF, "9:00 AM", "9:55 AM", [], { buildingDescription: "Dreese Laboratories 264" })],
    }),
    startDate: "2026-08-25",
    endDate: "2026-12-11",
  };
  assert.deepEqual(rows(blockNamed(pane(target), "Meets")), [
    ["When", "MoWeFr 9:00a–9:55a", ""],
    ["Room", "Dreese Laboratories 264", ""],
    ["Mode", "In Person", ""],
    ["Runs", "2026-08-25 to 2026-12-11", ""],
  ]);
});

// Regression, #82. Class 15613 meets Fr 11:10a in Celeste Lab and again Mo
// 8:00a in Evans Lab, and the pane printed only the Friday half.
test("regression #82: the Meets block reads every meeting a section holds", () => {
  const target = section(1001, {
    meetings: [
      meeting(["friday"], "11:10 AM", "2:05 PM", [], { buildingDescriptionShort: "CE 310", buildingDescription: "Celeste Lab 310" }),
      meeting(["monday"], "8:00 AM", "8:55 AM", [], { buildingDescriptionShort: "EL 2002", buildingDescription: "Evans Lab 2002" }),
      // The same Friday line under the API's other label for the room.
      meeting(["friday"], "11:10 AM", "2:05 PM", [], { buildingDescriptionShort: "CE 310", buildingDescription: "Celeste Laboratory 310" }),
    ],
  });
  assert.deepEqual(rows(blockNamed(pane(target), "Meets")), [
    ["When", "Fr 11:10a–2:05p", ""],
    ["Room", "Celeste Lab 310", ""],
    ["When", "Mo 8:00a–8:55a", ""],
    ["Room", "Evans Lab 2002", ""],
    ["Mode", "In Person", ""],
  ]);
});

test("regression #82: a section with nothing scheduled still says so", () => {
  assert.deepEqual(rows(blockNamed(pane(section(1002)), "Meets")), [
    ["When", "Time to be announced", ""],
    ["Mode", "In Person", ""],
  ]);
});

test("the instructor's other sections come from the results, minus the thesis listings", () => {
  const teaching = taught(1001, MWF, "9:00 AM", "9:55 AM", ["Diana Ikenberry Kline"]);
  const other = taught(1012, MWF, "1:00 PM", "1:55 PM", ["Diana Ikenberry Kline"]);
  const thesis = section(2222, {
    component: "Research",
    meetings: [meeting([], null, null, [{ displayName: "Diana Ikenberry Kline" }])],
  });
  const entries = [
    entry("CSE", "2221", "Software I", [teaching, other]),
    entry("CSE", "8999", "Thesis Research", [thesis]),
  ];
  assert.deepEqual(rows(blockNamed(pane(teaching, { entries }), "Also teaches, in these results")), [
    ["CSE 2221 · 1012", "8/22", "is-open"],
  ], "the section on screen is not listed against itself, and CSE 8999 is not teaching");
});

// #60 with #67, the two rules that gave opposite answers about one section. The
// list drops a section nobody can register for, the row refuses to badge it as
// newly opened, and the pane is the one surface that says why. Every published
// section in the fixture, so a drift in any of the three fails here rather than
// in none of them.

test("the list, the row and the pane agree on what can be registered", () => {
  const published = Object.keys(SEATS_TERMS["1268"].sections).filter((n) => seatsFor(n, "1268"));
  assert.equal(published.length, 15, "a section with no published capacity has no row to badge");

  for (const number of published) {
    const kept = applyFilters(
      [entry("CSE", "2221", "Software I", [section(number)])],
      { ...DEFAULTS, hideFull: true, term: "1268" },
    ).entries.length === 1;
    const badged = renderSection(section(number), "1268").querySelector(".opened") !== null;
    const noted = notes(pane(section(number))).includes(BLOCKED);

    assert.equal(badged, kept, `${number}: a row "hide full" drops must not also read as newly opened`);
    assert.equal(noted, !kept && !seatsFor(number, "1268").full,
      `${number}: the pane explains exactly the rows hidden for their package, and no others`);
  }
});

test("a lecture whose every listed way in is full is unreachable in all three", () => {
  // 1020 is 44/46, and its two recitations are 22/22 holding all 44 of its
  // students, so nothing can reach those two free seats.
  assert.equal(applyFilters([entry("CSE", "2221", "Software I", [section(1020)])],
    { ...DEFAULTS, hideFull: true, term: "1268" }).hiddenSections, 1, "1020 is hidden from the list");
  assert.equal(renderSection(section(1020), "1268").querySelector(".opened"), null,
    "1020 is not badged as newly opened");
  assert.ok(notes(pane(section(1020))).includes(BLOCKED), "and the pane says why");

  // 1030 holds 107 against one 21/21 lab, so Barrett never named the way most
  // of its students got in and none of the three may guess.
  assert.equal(applyFilters([entry("CSE", "2221", "Software I", [section(1030)])],
    { ...DEFAULTS, hideFull: true, term: "1268" }).hiddenSections, 0, "1030 stays in the list");
  assert.ok(renderSection(section(1030), "1268").querySelector(".opened"), "and keeps its badge");
  assert.deepEqual(notes(pane(section(1030))), [], "and the pane has nothing to warn about");
});

test("#60: a section that opened and filled again overnight is not badged as open", () => {
  assert.equal(trend.openedOn("1002", "1268"), "2026-08-18", "the fixture really does say 1002 opened");
  const row = renderSection(section(1002), "1268");
  assert.equal(row.querySelector(".seats").textContent, "40/40+3");
  assert.equal(row.querySelector(".opened"), null,
    "99 of the 248 sections that opened on 2026-08-19 were full again the next night");
});
