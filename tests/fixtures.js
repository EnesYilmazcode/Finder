// Hand-written fixtures. Shapes are copied from the live API and the two data
// snapshots, trimmed to the fields the code actually reads.

export function person(displayName, extra = {}) {
  return { displayName, email: extra.email ?? null, role: extra.role ?? "PI" };
}

/** One meeting pattern. `days` are full lowercase day keys. */
export function meeting(days, startTime = null, endTime = null, instructors = [], extra = {}) {
  const m = { startTime, endTime, instructors, ...extra };
  for (const day of days) m[day] = true;
  return m;
}

export function section(classNumber, opts = {}) {
  return {
    classNumber,
    component: opts.component ?? "Lecture",
    instructionMode: opts.instructionMode ?? "In Person",
    meetings: opts.meetings ?? [],
  };
}

export function entry(subject, catalogNumber, title, sections = [], opts = {}) {
  return {
    course: {
      subject,
      catalogNumber,
      title,
      minUnits: opts.minUnits ?? 3,
      maxUnits: opts.maxUnits ?? 3,
    },
    sections,
  };
}

/** A lecture on the given days at the given time, taught by the given names. */
export function taught(classNumber, days, start, end, names, opts = {}) {
  return section(classNumber, {
    ...opts,
    meetings: [meeting(days, start, end, names.map((n) => person(n)))],
  });
}

// Seat snapshot. Term 1268 only, which is what makes the term guard testable.
// Seats, in the same shape as the real snapshot since #48: a small index plus
// one file per term, so the loader under test does the real two-step fetch.
export const SEATS_INDEX = {
  source: "https://www.asc.ohio-state.edu/barrett.3/schedule/",
  fields: ["enrolled", "limit", "waitlist"],
  note: "A missing class number means unknown, not zero.",
  terms: [
    { term: "1262", termName: "Spring 2026", sourceUpdated: "2026-04-27", sections: 2, file: "seats-1262.json" },
    { term: "1268", termName: "Autumn 2026", sourceUpdated: "2026-08-18", sections: 7, file: "seats-1268.json" },
  ],
};

export const SEATS_TERMS = {
  "1268": {
    term: "1268",
    sections: {
      "1001": [30, 40, 0],    // open
      "1002": [40, 40, 3],    // exactly full, three waiting
      "1003": [41, 40, 1],    // over cap, which OSU's own API calls open
      "1004": [0, 0, 1],      // no published capacity, someone already waiting
      "1005": [12],           // malformed, too short
      "1006": ["12", 40, 0],  // malformed, enrolled is not a number
      "1007": [5, 30],        // no waitlist column
    },
  },
  // A second term proves the guard: 1001 exists in both with different numbers,
  // so serving one term's row for another would be visible rather than subtle.
  "1262": {
    term: "1262",
    sections: {
      "1001": [10, 55, 0],
      "2001": [55, 55, 2],
    },
  },
};

// Ratings snapshot. Every professor here exists to exercise one join case.
// Difficulty is not the inverse of rating upstream, so it is not here either:
// Smith is the easiest and Kline outrates him, which is what makes a difficulty
// sort distinguishable from a rating sort.
export const RATINGS = {
  school: { id: "U2Nob29sLTcyNA==", legacyId: 724, name: "Ohio State University" },
  count: 9,
  professors: [
    // Plain unique match, and the middle-name case: OSU says "Diana Ikenberry
    // Kline", RMP says "Diana Kline".
    prof(1, "Diana", "Kline", 4.2, 31, 2.1),
    // Nickname the query is a prefix of: OSU "Timothy Long", RMP "Tim Long".
    prof(2, "Tim", "Long", 3.4, 12, 4.5),
    // Shared initial only, and the sole Gomori, so the weak rule is allowed.
    prof(3, "Stephen", "Gomori", 4.8, 60, 4.0),
    // Two real people with the same name. Never guess between them.
    prof(4, "Alan", "Reed", 2.1, 40),
    prof(5, "Alan", "Reed", 4.6, 9),
    // Two Vances with the same initial. A shared initial must not be enough.
    prof(6, "Maria", "Vance", 3.9, 22),
    prof(7, "Marcus", "Vance", 4.4, 18),
    // Two plausible expansions of "Jon". Both viable means neither wins.
    prof(8, "Jonathan", "Park", 3.1, 15),
    prof(9, "Jonas", "Park", 4.0, 11),
    // Suffix case: the OSU name is "Ivan C. Smith III".
    prof(10, "Ivan", "Smith", 3.7, 8, 1.4),
    // Thin evidence: a perfect score and the lowest difficulty here, both from
    // a single rating. Neither may be ranked on.
    prof(11, "Wes", "Fenwick", 5.0, 1, 1.0),
    // RateMyProfessors reports a missing difficulty as -1 and the snapshot
    // stores it as null, which Number() turns into a 0 nobody reported.
    prof(12, "Ada", "Nkemelu", 4.1, 20, null),
  ],
};

function prof(legacyId, firstName, lastName, avgRating, numRatings, avgDifficulty = 3) {
  return {
    legacyId,
    firstName,
    lastName,
    department: "Computer Science",
    avgRating,
    numRatings,
    avgDifficulty,
    wouldTakeAgainPercent: null,
  };
}

// Barrett's plain text schedule, for the tests that exercise
// scripts/fetch-seats.mjs. The parser reads fixed columns, so a section line is
// built at the positions docs/barrett-schedule.md records rather than retyped,
// and tests/fetch-seats.test.js pins the builder against lines from a live file.

export const BARRETT_COLUMNS =
  "                       class#    (autoenrolls)                                enrld/limit/+wait";

// A term Barrett has not published yet carries this between the title and the
// column header, which is two more header lines than a published term has.
export const BARRETT_BANNER =
  "#####  DRAFT: pre-publication information; classes shown here are subject to change #####";

// One Barrett subject file, three real AVIATN section lines from term 1268 as
// published on 2026-08-20. The columns are load bearing, so this is verbatim.
export const BARRETT_SUBJECT = [
  "AVIATN         1268 (Autumn 2026)         updated: 20-Aug-2026",
  "",
  "                       class#    (autoenrolls)                                enrld/limit/+wait",
  "",
  "  AVIATN 1000.01         10132 B                                      ONLINE      36/99       {7W2} C.Roby, S.Pritchard",
  "",
  "  AVIATN 1000.02         10133 B                                      ONLINE      20/99       {7W2} C.Roby, S.Pritchard (SI)",
  "",
  "  AVIATN 1000.03         10134 B                                      ONLINE      11/99       {7W2} C.Roby, S.Pritchard (SI)",
  "",
].join("\n");

const BARRETT_DAY_COLUMNS = { M: 49, T: 50, W: 51, R: 52, F: 53, S: 54, s: 55 };

/** One section line. Anything left out stays blank, as it does in a real file. */
export function barrettLine({
  subject = "CSE",
  catalog = "1110",
  campus = "",
  classNumber = "4817",
  component = "L",
  autoEnroll = "",
  days = "",
  time = "",
  room = "",
  enrolled = 25,
  limit = 40,
  waitlist = 0,
  instructor = "",
} = {}) {
  const columns = new Array(94).fill(" ");
  const put = (start, text) => { for (let i = 0; i < text.length; i++) columns[start + i] = text[i]; };
  put(8 - subject.length, subject); // right aligned
  put(9, catalog);
  put(19, campus);
  put(30 - String(classNumber).length, String(classNumber)); // right aligned
  put(31, component);
  put(34, autoEnroll);
  for (const day of days) put(BARRETT_DAY_COLUMNS[day], day);
  put(58, time);
  put(70, room);
  // Enrollment is right aligned on the slash, and the waitlist hangs off the end.
  put(84 - String(enrolled).length, `${enrolled}/${limit}${waitlist ? `+${waitlist}` : ""}`);
  return (columns.join("") + instructor).trimEnd();
}

/**
 * One subject file. A row is either fields for barrettLine or a literal line,
 * which is how a continuation or a trailer heading goes in.
 *
 * `columns` set to null drops the column header and a string replaces it, since
 * both are layout changes the parser has to refuse rather than guess through.
 * `gap` is the blank line every real file has under the column header.
 */
export function barrettFile(subject, term, rows = [], {
  draft = false,
  gap = true,
  columns = BARRETT_COLUMNS,
  termName = "Autumn 2026",
  updated = "18-Aug-2026",
} = {}) {
  const lines = [`${subject.padEnd(12)}${term} (${termName})         updated: ${updated}`, ""];
  if (draft) lines.push(BARRETT_BANNER, "");
  if (columns) lines.push(columns);
  if (gap) lines.push("");
  for (const row of rows) lines.push(typeof row === "string" ? row : barrettLine({ subject, ...row }));
  return lines.join("\n");
}
