// Fold the public records grade spreadsheet into data/grades.json.
//
// Unlike the other three snapshotters this one fetches nothing. The records
// office sends a file once, under R.C. 149.43, and this reads it off disk:
//
//   node scripts/fetch-grades.mjs records.csv
//
// The columns are whatever the registrar's export tool named them, which is not
// known until the file arrives. So every field is resolved through a table of
// spellings and an unresolved one aborts the run printing the headers it did
// see, rather than guessing which column holds the B minuses. Add the spelling
// to HEADERS when you meet it; that is the whole adaptation step.
//
// XLSX is not read here. Save it as CSV first, which loses nothing: this reads
// one sheet of flat rows.

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { countRefusal, residueRefusal, refusalMessage, fatal } from "./guards.mjs";

const OUT_PATH = "data/grades.json";

// Columbus only, matching the campus the site searches. Regional campuses are
// separate schools on RateMyProfessors and a separate catalog here, so folding
// them together would put a Newark section under a Columbus professor's curve.
const CAMPUS = process.env.GRADES_CAMPUS ?? "columbus";

// The eleven graded marks, in the order js/grades.js reads them.
export const SCALE = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "E"];

// Marks that finish a course without carrying grade points, kept apart from the
// curve but not thrown away: a course that is 80% withdrawals is telling you
// something the mean of the survivors is not.
export const OTHER = ["W", "S", "U", "PA", "NP", "I"];

// At least this many instructors, or the parse found a file it did not
// understand. Five years of Columbus sections is tens of thousands of rows
// across a few thousand people; 200 is a floor, not an expectation.
const MIN_INSTRUCTORS = 200;

// A tenth of rows failing is a column that moved, not a few odd lines.
const MAX_RESIDUE = 0.1;

/**
 * Header spellings, canonical field first. Matching is case-insensitive and
 * ignores everything that is not a letter or a digit, so "Catalog Nbr",
 * "catalog_nbr" and "CATALOGNBR" are one spelling and only genuinely different
 * words need a new entry.
 */
export const HEADERS = {
  term: ["term", "termcode", "strm", "semester", "termdescr", "academicterm"],
  subject: ["subject", "subjectcode", "subj", "coursesubject"],
  catalog: ["catalog", "catalognumber", "catalognbr", "coursenumber", "catalogno"],
  classNumber: ["classnumber", "classnbr", "classno", "classid"],
  section: ["section", "sectionnumber", "classsection", "sectionno"],
  campus: ["campus", "campuscode", "campusdescr", "location"],
  // "name.#" slugs to "name", which is also what an instructor-name column
  // slugs to, so it is deliberately not an alias here: resolving a column of
  // people's names as addresses would key every curve on a display name.
  instructorEmail: ["instructoremail", "email", "emailaddress", "instructoremailaddress", "primaryinstructoremail", "instructorusername", "osuusername", "username"],
  instructorName: ["instructorname", "instructor", "primaryinstructor", "primaryinstructorname", "teacher"],
  title: ["coursetitle", "title", "classtitle", "coursedescr"],
  enrolled: ["enrolled", "totalenrolled", "enrollmenttotal", "totalstudents", "n"],
};

// Grade columns, which the export may name bare ("A-") or prefixed ("Grade A-",
// "CNT_A_MINUS"). The bare form is tried first so a file that uses it is never
// reinterpreted.
const GRADE_ALIASES = {
  "A": ["a", "gradea", "cnta", "counta", "numa"],
  "A-": ["a-", "aminus", "gradeaminus", "gradea-", "cntaminus"],
  "B+": ["b+", "bplus", "gradebplus", "gradeb+", "cntbplus"],
  "B": ["b", "gradeb", "cntb", "countb", "numb"],
  "B-": ["b-", "bminus", "gradebminus", "gradeb-", "cntbminus"],
  "C+": ["c+", "cplus", "gradecplus", "gradec+", "cntcplus"],
  "C": ["c", "gradec", "cntc", "countc", "numc"],
  "C-": ["c-", "cminus", "gradecminus", "gradec-", "cntcminus"],
  "D+": ["d+", "dplus", "gradedplus", "graded+", "cntdplus"],
  "D": ["d", "graded", "cntd", "countd", "numd"],
  // OSU's failing mark is E. Some exports still label the column F, and a file
  // carrying both is a file with two failing columns, which is summed, not picked.
  "E": ["e", "f", "ef", "e f", "gradee", "gradef", "cnte", "cntf"],
};

const OTHER_ALIASES = {
  W: ["w", "withdrawn", "withdrew", "gradew", "cntw"],
  S: ["s", "satisfactory", "grades", "cnts"],
  U: ["u", "unsatisfactory", "gradeu", "cntu"],
  PA: ["pa", "p", "pass", "gradepa"],
  NP: ["np", "nopass", "notpass", "gradenp"],
  I: ["i", "inc", "incomplete", "gradei", "cnti"],
};

/** Normalise a field name the way the alias tables are written. */
export const slug = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The same, for grade columns, keeping the plus and the minus.
 *
 * slug() cannot be used on these: it turns "A-" into "a", which is also what it
 * turns "A" into, so both columns resolve to whichever came first and every
 * A-minus in five years gets read out of the A column. The sign is the whole
 * distinction here, so it is the one character that survives normalising.
 */
export const markSlug = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9+-]/g, "");

/**
 * A CSV reader that respects quotes.
 *
 * Course titles carry commas ("Software I: Components, Interfaces") and an
 * instructor column can hold "Bucci, Paolo", so splitting on commas loses a
 * column exactly where it is least visible. Handles the doubled quote escape
 * and both line endings.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const body = String(text ?? "").replace(/^﻿/, ""); // Excel writes a BOM
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch !== '"') { field += ch; continue; }
      if (body[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // A trailing newline leaves one empty row, and so does a blank line anywhere.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Map canonical field names onto column indexes.
 *
 * Returns the mapping and whatever could not be resolved. The caller decides
 * which absences are fatal, because only some are: a missing B- column breaks
 * every curve, a missing course title breaks nothing.
 */
export function resolveHeaders(header) {
  // Two indexes over the same header row: field names normalise punctuation
  // away so "catalog_nbr" and "Catalog Nbr" are one spelling, and grade columns
  // keep their sign so "B+" and "B" stay two columns.
  const seen = new Map();
  const marks = new Map();
  header.forEach((name, i) => {
    // First column wins. A duplicate header is usually a second export of the
    // same field, and picking the later one silently changes which.
    const key = slug(name);
    if (key && !seen.has(key)) seen.set(key, i);
    const mark = markSlug(name);
    if (mark && !marks.has(mark)) marks.set(mark, i);
  });

  const lookup = (index, normalise) => (aliases) => {
    for (const alias of aliases) {
      const at = index.get(normalise(alias));
      if (at != null) return at;
    }
    return null;
  };
  const find = lookup(seen, slug);
  const findMark = lookup(marks, markSlug);

  const fields = {};
  for (const [name, aliases] of Object.entries(HEADERS)) fields[name] = find(aliases);

  const grades = {};
  for (const [mark, aliases] of Object.entries(GRADE_ALIASES)) grades[mark] = findMark(aliases);

  const other = {};
  for (const [mark, aliases] of Object.entries(OTHER_ALIASES)) other[mark] = findMark(aliases);

  const missing = [
    ...["term", "subject", "catalog"].filter((f) => fields[f] == null),
    ...SCALE.filter((mark) => grades[mark] == null).map((mark) => `grade ${mark}`),
  ];
  // Either identifier will do. Only having neither leaves a row that cannot be
  // attributed to anyone.
  if (fields.instructorEmail == null && fields.instructorName == null) missing.push("instructor email or name");

  return { fields, grades, other, missing, header };
}

/**
 * A cell that is a count, or null when it is not.
 *
 * A withheld cell is the point of this: the registrar blanks it, or writes a
 * marker, and neither is a zero. Returning null keeps the difference, and the
 * caller turns it into a suppressed section rather than an empty curve.
 */
export function count(cell) {
  const text = String(cell ?? "").trim();
  if (text === "") return null;
  // The markers a redaction is written as. "*" and "<5" and friends all mean
  // the same thing: there was a number here and you may not have it.
  if (/^(\*+|n\/?a|null|-{1,2}|redacted|suppressed|<\s*\d+)$/i.test(text)) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Is this row's campus the one being kept? Rows with no campus column are kept. */
function onCampus(value, at) {
  if (at == null) return true;
  const text = slug(value);
  if (!text) return true;
  const want = slug(CAMPUS);
  // Exports write it as a code ("COL"), a name ("Columbus") or both.
  return text === want || text.startsWith(want.slice(0, 3)) || want.startsWith(text);
}

/** Sort key for a term, from either a code (1218) or a name (Autumn 2021). */
export function termRank(term) {
  const text = String(term ?? "").trim();
  if (/^\d{4}$/.test(text)) return Number(text);

  const year = /(\d{4})/.exec(text);
  if (!year) return 0;
  const season = /spring/i.test(text) ? 2 : /summer/i.test(text) ? 4 : /aut|fall/i.test(text) ? 8 : 0;
  // Autumn 2021 is term 1218: the century digit, the last two of the year, and
  // the season. Reproducing that keeps names and codes on one scale.
  return 1000 + (Number(year[1]) % 100) * 10 + season;
}

/**
 * Fold parsed rows into the per-instructor, per-course shape the site reads.
 *
 * A section whose grade cells are all withheld counts as suppressed rather than
 * as a section of zero students, which is the one place this file can quietly
 * lie about a professor.
 */
export function aggregate(rows) {
  const people = new Map();
  const terms = new Set();

  for (const row of rows) {
    terms.add(row.term);
    let person = people.get(row.key);
    if (!person) {
      person = { name: row.name, courses: new Map(), terms: new Set() };
      people.set(row.key, person);
    }
    // Names drift across five years of exports; the longest is the most
    // complete, and a middle name helps the fallback match.
    if (row.name && row.name.length > (person.name?.length ?? 0)) person.name = row.name;
    person.terms.add(row.term);

    const code = `${row.subject} ${row.catalog}`;
    let entry = person.courses.get(code);
    if (!entry) {
      entry = { counts: new Array(SCALE.length).fill(0), other: {}, sections: 0, terms: new Set(), suppressed: 0 };
      person.courses.set(code, entry);
    }
    entry.sections++;
    entry.terms.add(row.term);

    if (row.suppressed) {
      entry.suppressed++;
      continue;
    }
    for (let i = 0; i < SCALE.length; i++) entry.counts[i] += row.counts[i];
    for (const mark of OTHER) {
      if (row.other[mark]) entry.other[mark] = (entry.other[mark] ?? 0) + row.other[mark];
    }
  }

  const instructors = {};
  for (const [key, person] of [...people].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const courses = {};
    for (const [code, entry] of [...person.courses].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      courses[code] = {
        counts: entry.counts,
        other: entry.other,
        sections: entry.sections,
        terms: entry.terms.size,
        suppressed: entry.suppressed,
      };
    }
    instructors[key] = { name: person.name, terms: person.terms.size, courses };
  }

  const ordered = [...terms].sort((a, b) => termRank(a) - termRank(b));
  return { instructors, terms: ordered };
}

/**
 * One spreadsheet row, or null with a reason when it cannot be read.
 *
 * The instructor key is the address's local part where there is one, which is
 * what js/grades.js joins on. A row with only a name still counts: the site
 * falls back to name matching, and dropping those would lose whole departments
 * if the office redacts the email column.
 */
export function readRow(cells, map) {
  const at = (index) => (index == null ? "" : String(cells[index] ?? "").trim());
  const { fields, grades, other } = map;

  const subject = at(fields.subject).toUpperCase();
  const catalog = at(fields.catalog).toUpperCase();
  const term = at(fields.term);
  if (!subject || !catalog || !term) return { skip: "no course or term" };
  if (!onCampus(at(fields.campus), fields.campus)) return { skip: "another campus" };

  const email = at(fields.instructorEmail).toLowerCase();
  const name = at(fields.instructorName);
  const local = email.includes("@") ? email.slice(0, email.indexOf("@")) : email;
  // A bare username in the email column is the same identifier without the host.
  const key = local || slug(name);
  if (!key) return { skip: "no instructor" };
  // "Staff" is not a person, and folding five years of unstaffed sections into
  // one curve would invent the most prolific instructor at the university.
  if (/^(staff|tba|tbd|notassigned|unassigned)$/.test(slug(key))) return { skip: "unstaffed" };

  const counts = SCALE.map((mark) => count(cells[grades[mark]]));
  const others = {};
  for (const mark of OTHER) {
    if (other[mark] == null) continue;
    const n = count(cells[other[mark]]);
    if (n) others[mark] = n;
  }

  // Every graded column withheld is a suppressed section. Some withheld and
  // some not is a partial redaction, and summing the rest would publish a curve
  // whose total contradicts the enrolment beside it, so it is suppressed too.
  const suppressed = counts.some((n) => n == null);

  return {
    term,
    subject,
    catalog,
    key,
    name: name || null,
    suppressed,
    counts: suppressed ? new Array(SCALE.length).fill(0) : counts,
    other: suppressed ? {} : others,
  };
}

export function buildSnapshot(text, { minInstructors = MIN_INSTRUCTORS, previous = 0 } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { refusals: [fatal("grades: the file has no rows under its header")] };

  const map = resolveHeaders(rows[0]);
  if (map.missing.length) {
    return {
      refusals: [fatal(
        `grades: could not find ${map.missing.join(", ")}.\n` +
        `The file's headers are: ${rows[0].join(" | ")}\n` +
        "Add the spelling to HEADERS or GRADE_ALIASES in scripts/fetch-grades.mjs."
      )],
    };
  }

  const parsed = [];
  const skipped = new Map();
  let failed = 0;
  for (const cells of rows.slice(1)) {
    const row = readRow(cells, map);
    if (row.skip) {
      skipped.set(row.skip, (skipped.get(row.skip) ?? 0) + 1);
      // Another campus is a row this run is not interested in, which is not a
      // row it failed to read. Only the rest count against the residue rate.
      if (row.skip !== "another campus" && row.skip !== "unstaffed") failed++;
      continue;
    }
    parsed.push(row);
  }

  const { instructors, terms } = aggregate(parsed);
  const total = Object.keys(instructors).length;

  return {
    skipped,
    parsed: parsed.length,
    refusals: [
      residueRefusal("grades rows", parsed.length, failed, MAX_RESIDUE),
      countRefusal("grades instructors", total, minInstructors, previous),
    ],
    snapshot: {
      source: "The Ohio State University, public records request under R.C. 149.43",
      campus: CAMPUS,
      firstTerm: terms[0] ?? null,
      lastTerm: terms[terms.length - 1] ?? null,
      termCount: terms.length,
      scale: SCALE,
      count: total,
      instructors,
    },
  };
}

/** The instructor count already committed, or 0 when there is no file yet. */
export async function previousCount(path = OUT_PATH) {
  try {
    return JSON.parse(await readFile(path, "utf8")).count ?? 0;
  } catch {
    return 0; // no file yet, which is the ordinary first run
  }
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: node scripts/fetch-grades.mjs <records.csv>");
    process.exit(1);
  }

  const built = buildSnapshot(await readFile(input, "utf8"), { previous: await previousCount() });
  if (built.snapshot) {
    console.log(`read ${built.parsed} section rows into ${built.snapshot.count} instructors`);
    for (const [reason, n] of built.skipped ?? []) console.log(`  skipped ${n}: ${reason}`);
  }

  const refusal = refusalMessage(built.refusals);
  if (refusal) {
    console.error(`Refusing to write ${OUT_PATH}.\n${refusal}`);
    process.exit(1);
  }

  // Compact, like ratings-courses.json and for the same reason: only the detail
  // pane reads it, and indenting it costs every visitor who opens a section.
  const json = JSON.stringify(built.snapshot, null, 0) + "\n";
  await mkdir(dirname(OUT_PATH), { recursive: true });
  const tmp = `${OUT_PATH}.tmp`;
  await writeFile(tmp, json, "utf8");
  await rename(tmp, OUT_PATH); // atomic, so a crash cannot leave half a file

  console.log(`Wrote ${built.snapshot.count} instructors to ${OUT_PATH} (${json.length} bytes)`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`fetch-grades failed: ${error.message}`);
    process.exit(1);
  });
}
