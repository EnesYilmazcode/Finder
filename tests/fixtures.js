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

// Ratings snapshot. Every professor here exists to exercise one join case.
export const RATINGS = {
  school: { id: "U2Nob29sLTcyNA==", legacyId: 724, name: "Ohio State University" },
  count: 9,
  professors: [
    // Plain unique match, and the middle-name case: OSU says "Diana Ikenberry
    // Kline", RMP says "Diana Kline".
    prof(1, "Diana", "Kline", 4.2, 31),
    // Nickname the query is a prefix of: OSU "Timothy Long", RMP "Tim Long".
    prof(2, "Tim", "Long", 3.4, 12),
    // Shared initial only, and the sole Gomori, so the weak rule is allowed.
    prof(3, "Stephen", "Gomori", 4.8, 60),
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
    prof(10, "Ivan", "Smith", 3.7, 8),
  ],
};

function prof(legacyId, firstName, lastName, avgRating, numRatings) {
  return {
    legacyId,
    firstName,
    lastName,
    department: "Computer Science",
    avgRating,
    numRatings,
    avgDifficulty: 3,
    wouldTakeAgainPercent: null,
  };
}
