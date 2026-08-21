import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "fetch-seats.mjs");
const MOCK = pathToFileURL(join(ROOT, "tests", "barrett-mock.mjs")).href;

// MIN_SUBJECTS is 50, so a term needs at least that many to clear its checks.
const SUBJECTS = Array.from({ length: 50 }, (_, i) => `SUBJ${String(i).padStart(2, "0")}`);

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

    const r = run(dir, { subjects: SUBJECTS, searchable: ["1268", "1272"], published: ["1268"] });

    assert.equal(r.status, 1, `the run still goes red\n${r.stderr}`);
    assert.match(r.stderr, /term 1272: no sections parsed, keeping the file it already has/);
    assert.equal(read(dir, "seats-1272.json"), before, "the skipped term's file is untouched");
    assert.equal(Object.keys(JSON.parse(read(dir, "seats-1268.json")).sections).length, 200);

    const index = JSON.parse(read(dir, "seats.json"));
    assert.deepEqual(index.terms.map((t) => t.term), ["1268", "1272"]);
    assert.equal(index.terms[1].sourceUpdated, "2026-07-29", "1272 keeps its own older date");
    assert.equal(existsSync(join(dir, "seats-1260.json")), false, "a term that really left is still dropped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
