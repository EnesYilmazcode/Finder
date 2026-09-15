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

/** One course or section attribute, in the API's shape. */
export function attr(name, value, description = "") {
  return { name, value, description };
}

/** An online meeting in the shape OSU sends it, from PSYCH 1100 class 22988. */
export function onlineMeeting(days = [], startTime = null, endTime = null, instructors = []) {
  return meeting(days, startTime, endTime, instructors, {
    buildingDescription: "Online",
    buildingDescriptionShort: "ONLINE",
    facilityDescription: "ONLINE",
    facilityDescriptionShort: "ONLINE",
  });
}

export function section(classNumber, opts = {}) {
  return {
    classNumber,
    component: opts.component ?? "Lecture",
    instructionMode: opts.instructionMode ?? "In Person",
    meetings: opts.meetings ?? [],
    // Defaults are what the live API returns for an ordinary Autumn or Spring
    // section.
    career: opts.career ?? "UGRD",
    consent: opts.consent ?? false,
    waitlistCapacity: opts.waitlistCapacity ?? 999,
    sessionCode: opts.sessionCode ?? "1",
    sessionDescription: opts.sessionDescription ?? "Regular Academic Term",
    attributes: opts.attributes ?? [],
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
      courseAttributes: opts.courseAttributes ?? [],
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
    { term: "1268", termName: "Autumn 2026", sourceUpdated: "2026-08-18", sections: 20, file: "seats-1268.json" },
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
      "1010": [5, 24, 0],     // a lab with seats left, feeding the full 1002
      "1011": [22, 22, 0],    // one recitation into 1001, full
      "1012": [8, 22, 0],     // the other, open
      "1013": [3, 20, 0],     // a lab that drags in both 1001 and 1002
      "1014": [0, 0, 2],      // no published capacity of its own, under the full 1002
      "1020": [44, 46, 0],    // a lecture whose two recitations hold all 44 of its students
      "1021": [22, 22, 0],
      "1022": [22, 22, 0],
      "1030": [107, 126, 0],  // holds more than its one listed lab explains
      "1031": [21, 21, 0],
      "1040": [50, 60, 0],    // one way in full, the other with no published capacity
      "1041": [50, 50, 0],
      "1042": [0, 0, 0],
    },
    // Registration packages, parent first: picking any section after the
    // parent also enrolls you into it. 1013 sits in both groups, which is
    // Barrett's two-parent row.
    groups: [
      ["1001", "1011", "1012", "1013"],
      ["1002", "1010", "1013", "1014"],
      ["1020", "1021", "1022"],
      ["1030", "1031"],
      ["1040", "1041", "1042"],
    ],
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

// Trend snapshot, in the shape scripts/fetch-seats.mjs writes since #60. Series
// hold the per-day change in that field, aligned to `days`, and `from` is the
// date the first entry was measured against.
export const TREND = {
  "1268": {
    term: "1268",
    from: "2026-08-14",
    days: ["2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18"],
    enrolled: {
      "1001": [1, 2, 3, 0],   // three moving days, six enrolments, so six seats gone
      "1003": [0, 0, 2, 3],   // two moving days, under the floor
      "1004": [2, -1, -1, 0], // moved three times and went nowhere
      "1005": [0, 1, 1, 1],   // starts moving mid-window, so the span starts there
      "1006": [1, 1, 1],      // malformed, shorter than days
    },
    waitlist: {
      "1002": [1, 1, 1, 0],
    },
    opened: ["1002"],
  },
  // A night the job missed, so three moving points span four days rather than
  // three. The span has to come from the dates, not the point count.
  "1262": {
    term: "1262",
    from: "2026-08-14",
    days: ["2026-08-15", "2026-08-17", "2026-08-18"],
    enrolled: {
      "2001": [1, 1, 1],
    },
    waitlist: {},
    opened: [],
  },
};

// Every professor here exists to exercise one join case. Difficulty is not the
// inverse of rating upstream, so it is not here either: Smith is the easiest and
// Kline outrates him, which is what makes a difficulty sort distinguishable from
// a rating sort.
const PROFESSORS = [
  // Plain unique match, and the middle-name case: OSU says "Diana Ikenberry
  // Kline", RMP says "Diana Kline".
  prof(1, "Diana", "Kline", 4.2, 31, { avgDifficulty: 2.1, distribution: [1, 1, 4, 10, 15] }),
  // Nickname the query is a prefix of: OSU "Timothy Long", RMP "Tim Long".
  prof(2, "Tim", "Long", 3.4, 12, { avgDifficulty: 4.5, distribution: [1, 2, 3, 3, 3] }),
  // Shared initial only, and the sole Gomori. Being the only one is not
  // evidence, so "Steve Gomori" must not land here.
  prof(3, "Stephen", "Gomori", 4.8, 60, { avgDifficulty: 4.0, distribution: [0, 0, 2, 8, 50] }),
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
  prof(10, "Ivan", "Smith", 3.7, 8, { avgDifficulty: 1.4 }),
  // The real Paolo Bucci: a 3.0 that is 32 ones and 38 fives, not a pile of threes.
  prof(11, "Paolo", "Bucci", 3, 147, { distribution: [32, 29, 19, 30, 38] }),
  prof(12, "Rosemary", "Bartoszek-Loza", 3.3, 128),
  prof(13, "Nora", "Whitfield", 3.8, 60),
  // Thin evidence: a perfect score and the lowest difficulty here, both from a
  // single rating. Neither may be ranked on.
  prof(14, "Wes", "Fenwick", 5.0, 1, { avgDifficulty: 1.0 }),
  // RateMyProfessors reports a missing difficulty as -1 and the snapshot stores
  // it as null, which Number() turns into a 0 nobody reported.
  prof(15, "Ada", "Nkemelu", 4.1, 20, { avgDifficulty: null }),
  // A real two letter first name. A longer name must not claim it, and ruling
  // it out must not hand the query to the other Wang either.
  prof(16, "Ji", "Wang", 4.5, 9),
  prof(17, "Jin", "Wang", 3.7, 7),
];

// Ratings snapshot. count is derived, so adding a professor cannot leave the
// two disagreeing the way the literal did.
export const RATINGS = {
  school: { id: "U2Nob29sLTcyNA==", legacyId: 724, name: "Ohio State University" },
  count: PROFESSORS.length,
  professors: PROFESSORS,
};

/**
 * One professor record.
 *
 * The tail is an options object rather than positional slots: three branches
 * wanted the sixth argument for three different things, and a positional list
 * cannot carry two of them at once. Null distribution is the shape upstream
 * sends when it has no per-score counts.
 */
function prof(legacyId, firstName, lastName, avgRating, numRatings, { avgDifficulty = 3, distribution = null } = {}) {
  return {
    legacyId,
    firstName,
    lastName,
    department: "Computer Science",
    avgRating,
    numRatings,
    avgDifficulty,
    wouldTakeAgainPercent: null,
    distribution,
  };
}

// Course codes, keyed by legacyId the way data/ratings-courses.json is. A professor
// the file does not list is unknown, not a professor with no matching code.
const RATING_COURSE_CODES = {
  // The four ways raters write one course, plus a code with no number in it.
  "1": { "CSE 2221": 10, "cse2221": 4, "CS2221": 3, "2221": 5, "CSE2231": 8, "PHYSICS": 1 },
  // Rated, but never for the course on screen.
  "2": { "MATH 1151": 13 },
  // An honours number and a pre-semester code are their own courses.
  "3": { "CSE2221H": 30, "CSE321": 30 },
  // Codes adding to 148 against the 147 ratings upstream shows for the same man.
  "11": { "CSE 2221": 52, "CSE321": 22, "CSE 2231": 74 },
  // Losing "CHEMISTRY1210" would take the bare "1210" with it, by making the
  // number look contested.
  "12": { "CHEM1210": 117, "CHEMISTRY1210": 8, "1210": 3 },
  // ENGLISH 1110.01 and 1110.02 are both just "1110" to a rater.
  "13": { "ENGLISH 1110": 30, "ENGL1110": 8, "1110": 10, "ENGLISH 1110.02": 5, "HISTORY 1151": 7 },
};

// count derived, for the reason RATINGS derives it.
export const RATING_COURSES = {
  count: Object.keys(RATING_COURSE_CODES).length,
  professors: RATING_COURSE_CODES,
};

// Stand-ins for the ids the real snapshot lists. Everyone else draws a monogram,
// which is what two thirds of instructors get, so the list is deliberately short.
export const HEADSHOT_IDS = ["gomori.1", "bucci.2"];

export const HEADSHOTS = {
  source: "https://opic.osu.edu",
  count: HEADSHOT_IDS.length,
  ids: HEADSHOT_IDS,
};

// Barrett's plain text schedule, for the tests that exercise
// scripts/fetch-seats.mjs. The parser reads fixed columns, so a section line is
// built at the positions docs/barrett-schedule.md records rather than retyped,
// and tests/fetch-seats.test.js pins the builder against lines from a live file.

export const BARRETT_COLUMNS =
  "                       class#    (autoenrolls)                                enrld/limit/+wait";

// A term Barrett has not published yet carries this between the title and the
// column header, which is two more header lines than a published term has.
const BARRETT_BANNER =
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

// Grade distributions, in the shape scripts/fetch-grades.mjs writes. Counts are
// positional against js/grades.js's SCALE: A A- B+ B B- C+ C C- D+ D E.
//
// Keys are the local part of an OSU address, which is what both the class API
// and the records request carry. Every instructor here exercises one join or
// one arithmetic case.
const GRADE_ROWS = {
  // The ordinary case: joined by address, several terms, a few sections the
  // registrar withheld.
  "bucci.2": {
    name: "Paolo Bucci",
    terms: 9,
    courses: {
      "CSE 2221": {
        counts: [180, 120, 95, 140, 60, 45, 70, 25, 15, 20, 90],
        other: { W: 61, I: 4 },
        sections: 22,
        terms: 9,
        suppressed: 2,
      },
      // Same professor, a course whose curve is nothing like the first, so a
      // per-course lookup can be told from a per-instructor one.
      "CSE 2231": {
        counts: [40, 30, 20, 25, 10, 5, 5, 2, 1, 1, 6],
        other: { W: 9 },
        sections: 6,
        terms: 4,
        suppressed: 0,
      },
    },
  },
  // No address on the section, so this one can only be reached by name, and
  // "Diana Ikenberry Kline" has to find it.
  "kline.1": {
    name: "Diana Kline",
    terms: 5,
    courses: {
      "MATH 1151": { counts: [10, 8, 12, 20, 14, 9, 11, 6, 3, 4, 7], other: { W: 12 }, sections: 8, terms: 5, suppressed: 0 },
      // A catalog number with a suffix. 1110.02 must not answer for 1110.01.
      "ENGLISH 1110.01": { counts: [5, 4, 3, 6, 2, 1, 1, 0, 0, 0, 1], other: {}, sections: 2, terms: 2, suppressed: 0 },
    },
  },
  // Two people, one name, no addresses. A name lookup must refuse both.
  "reed.7": { name: "Alan Reed", terms: 3, courses: { "PHYSICS 1250": { counts: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], other: {}, sections: 3, terms: 3, suppressed: 0 } } },
  "reed.31": { name: "Alan Reed", terms: 2, courses: { "PHYSICS 1250": { counts: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0], other: {}, sections: 2, terms: 2, suppressed: 0 } } },
  // A pass-fail course. Nothing here carries grade points, so there is no mean
  // to print even though 140 students finished it.
  "nkemelu.4": {
    name: "Ada Nkemelu",
    terms: 4,
    courses: { "CSE 4998": { counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], other: { S: 120, U: 20, W: 3 }, sections: 4, terms: 4, suppressed: 0 } },
  },
  // Every section small enough to be withheld, so the record exists and the
  // curve does not. The difference has to survive to the screen.
  "fenwick.9": {
    name: "Wes Fenwick",
    terms: 2,
    courses: { "CSE 5911": { counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], other: {}, sections: 3, terms: 2, suppressed: 3 } },
  },
  // Thin but real: one section, eight students, a perfect curve that means
  // nothing. The pane has to say so rather than print a 4.0.
  "whitfield.2": {
    name: "Nora Whitfield",
    terms: 1,
    courses: { "CSE 3241": { counts: [6, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0], other: {}, sections: 1, terms: 1, suppressed: 0 } },
  },
  // Malformed rows a bad parse could write. Both have to read as unknown.
  "gomori.1": {
    name: "Stephen Gomori",
    terms: 1,
    courses: {
      "CSE 1223": { counts: [1, 2, 3], other: {}, sections: 1, terms: 1, suppressed: 0 },
      "CSE 1224": { counts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -1], other: {}, sections: 1, terms: 1, suppressed: 0 },
    },
  },
};

export const GRADES = {
  source: "The Ohio State University, public records request under R.C. 149.43",
  campus: "col",
  firstTerm: "Autumn 2021",
  lastTerm: "Spring 2026",
  termCount: 15,
  scale: ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "E"],
  count: Object.keys(GRADE_ROWS).length,
  instructors: GRADE_ROWS,
};
