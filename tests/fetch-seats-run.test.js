import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "fetch-seats.mjs");
const MOCK = pathToFileURL(join(ROOT, "tests", "barrett-mock.mjs")).href;

// MIN_SUBJECTS is 50 and MIN_SECTIONS is 500, so a term needs at least that
// many subjects, and enough sections between them, to clear its checks.
const SUBJECTS = Array.from({ length: 50 }, (_, i) => `SUBJ${String(i).padStart(2, "0")}`);
const SECTIONS_PER_SUBJECT = 12;

function run(outDir, scenario) {
  return spawnSync(process.execPath, ["--import", MOCK, SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, SEATS_OUT_DIR: outDir, BARRETT_MOCK: JSON.stringify(scenario) },
  });
}

const write = (dir, name, value) => writeFileSync(join(dir, name), `${JSON.stringify(value)}\n`);
const read = (dir, name) => readFileSync(join(dir, name), "utf8");

// Regression, #93. This is the half the issue is titled after: one term Barrett
// has not rebuilt yet used to throw before anything was written, so every other
// term lost its refresh too.
test("regression #93: a skipped term keeps its file while the rest are written", () => {
  const dir = mkdtempSync(join(tmpdir(), "finder-seats-"));
  try {
    // Yesterday: 1272 snapshotted, and 1260 from back when it was searchable.
    write(dir, "seats-1272.json", { term: "1272", termName: "Spring 2027", sourceUpdated: "2026-07-29", sections: { 20001: [5, 30, 0] } });
    write(dir, "seats-1260.json", { term: "1260", termName: "Autumn 2025", sourceUpdated: "2025-12-01", sections: { 30001: [9, 25, 0] } });
    write(dir, "seats.json", {
      terms: [
        { term: "1260", termName: "Autumn 2025", sourceUpdated: "2025-12-01", sections: 1, file: "seats-1260.json" },
        { term: "1272", termName: "Spring 2027", sourceUpdated: "2026-07-29", sections: 1, file: "seats-1272.json" },
      ],
    });
    const before = read(dir, "seats-1272.json");

    const r = run(dir, {
      subjects: SUBJECTS,
      searchable: ["1268", "1272"],
      published: ["1268"],
      sections: SECTIONS_PER_SUBJECT,
    });

    assert.equal(r.status, 1, `the run still goes red\n${r.stderr}`);
    // A term can be held back for several reasons at once, so the reasons and
    // the note about its old file are separate lines.
    assert.match(r.stderr, /term 1272: no sections parsed/);
    assert.match(r.stderr, /term 1272: keeping the file it already has/);
    assert.equal(read(dir, "seats-1272.json"), before, "the skipped term's file is untouched");
    assert.equal(
      Object.keys(JSON.parse(read(dir, "seats-1268.json")).sections).length,
      SUBJECTS.length * SECTIONS_PER_SUBJECT
    );

    const index = JSON.parse(read(dir, "seats.json"));
    assert.deepEqual(index.terms.map((t) => t.term), ["1268", "1272"]);
    assert.equal(index.terms[1].sourceUpdated, "2026-07-29", "1272 keeps its own older date");
    assert.equal(existsSync(join(dir, "seats-1260.json")), false, "a term that really left is still dropped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression, #59. FORCE_WRITE=1 is one flag over every drop in the run, and
// searchableTermsV2 pages non-deterministically, so a night an operator set it
// to ship one term's real shrink used to delete the committed files of the
// terms a short answer left out, and exit 0.
test("regression #59: FORCE_WRITE=1 does not delete the terms a short answer left out", () => {
  const dir = mkdtempSync(join(tmpdir(), "finder-seats-"));
  try {
    for (const term of ["1262", "1268", "1272"]) {
      write(dir, `seats-${term}.json`, { term, termName: "T", sourceUpdated: "2026-08-21", sections: { [`9${term}`]: [5, 30, 0] } });
      write(dir, `trend-${term}.json`, { term, from: "2026-08-20", days: ["2026-08-21"], enrolled: {}, waitlist: {}, opened: [] });
    }
    write(dir, "seats.json", {
      terms: ["1262", "1268", "1272"].map((term) => ({ term, termName: "T", sourceUpdated: "2026-08-21", sections: 1, file: `seats-${term}.json` })),
    });
    const before = readdirSync(dir).sort();

    // The answer comes back with one term of the three.
    const scenario = { subjects: SUBJECTS, searchable: ["1268"], published: ["1268"], sections: SECTIONS_PER_SUBJECT };
    const forced = spawnSync(process.execPath, ["--import", MOCK, SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, SEATS_OUT_DIR: dir, BARRETT_MOCK: JSON.stringify(scenario), FORCE_WRITE: "1" },
    });

    assert.equal(forced.status, 1, forced.stdout);
    assert.match(forced.stderr, /searchable terms: got 1, down 66\.7%/);
    assert.match(forced.stderr, /ALLOW_TERM_DROP=1/);
    assert.doesNotMatch(forced.stderr, /FORCE_WRITE=1 to write this anyway/, "the advice would not have worked");
    assert.deepEqual(readdirSync(dir).sort(), before, "nothing was written and nothing was deleted");

    // The flag that names the act does accept it, which is how a real rollover
    // still ships.
    const dropped = spawnSync(process.execPath, ["--import", MOCK, SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, SEATS_OUT_DIR: dir, BARRETT_MOCK: JSON.stringify(scenario), ALLOW_TERM_DROP: "1" },
    });
    assert.equal(dropped.status, 0, dropped.stderr);
    assert.deepEqual(readdirSync(dir).sort(), ["seats-1268.json", "seats.json", "trend-1268.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression, #59. toIsoDate hands back whatever Barrett stamped when it is not
// d-MMM-yyyy, so a case change upstream used to be committed as sourceUpdated
// and fail tests/contract.test.js the next morning on a commit nobody made.
test("regression #59: a date this cannot read holds the term back rather than shipping", () => {
  const dir = mkdtempSync(join(tmpdir(), "finder-seats-"));
  try {
    write(dir, "seats-1268.json", { term: "1268", termName: "Autumn 2026", sourceUpdated: "2026-08-21", sections: { 10001: [5, 30, 0] } });
    write(dir, "seats.json", { terms: [{ term: "1268", termName: "Autumn 2026", sourceUpdated: "2026-08-21", sections: 1, file: "seats-1268.json" }] });
    const before = read(dir, "seats-1268.json");

    const r = run(dir, {
      subjects: SUBJECTS,
      searchable: ["1268"],
      published: ["1268"],
      sections: SECTIONS_PER_SUBJECT,
      updated: "22-AUG-2026",
    });

    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /term 1268: Barrett stamped "22-AUG-2026", which is not a yyyy-mm-dd date/);
    assert.match(r.stderr, /term 1268: keeping the file it already has/);
    assert.equal(read(dir, "seats-1268.json"), before);
    assert.equal(existsSync(join(dir, "trend-1268.json")), false, "and no trend file was seeded off it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
