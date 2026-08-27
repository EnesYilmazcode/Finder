// The two lines of the nightly workflows that decide whether a run's work is
// kept: the `if:` on the commit step, and the pathspecs it stages.
//
// Both go wrong at 07:20 or 12:30 UTC with nobody watching, and neither is
// reachable from the scripts, so the git commands are pulled out of the YAML and
// run against a real repository rather than read.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS = join(dirname(dirname(fileURLToPath(import.meta.url))), ".github", "workflows");
const read = (name) => readFileSync(join(WORKFLOWS, name), "utf8");
const FILES = ["seats.json", "seats-1268.json", "ratings.json", "courses.json", "headshots.json"];

// One step out of a job, as its `if:` and the body of its `run:` block.
function step(yaml, name) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.ok(start >= 0, `no step named ${name}`);
  const indent = lines[start].indexOf("-");

  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && line.search(/\S/) <= indent) break;
    body.push(line);
  }
  const gate = body.find((line) => /^\s*if:/.test(line));
  const script = body.findIndex((line) => /^\s*run:\s*\|/.test(line));
  return { gate: gate?.replace(/^\s*if:\s*/, "").trim(), run: script < 0 ? [] : body.slice(script + 1) };
}

// Yesterday's commit, holding what the nightlies rewrite every run and neither
// of the two files they only write once they have got that far.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "finder-wf-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  mkdirSync(join(dir, "data"));
  for (const name of FILES) writeFileSync(join(dir, "data", name), "{}\n");
  git("init", "-q", ".");
  git("config", "user.email", "nightly@example.com");
  git("config", "user.name", "nightly");
  git("add", "-A");
  git("commit", "-qm", "yesterday");
  // Tonight's run refreshed what it could and wrote no trend or course file.
  for (const name of FILES) writeFileSync(join(dir, "data", name), '{"tonight":1}\n');
  return dir;
}

// fetch-ratings.mjs writes ratings.json and only then checks MIN_TAUGHT, so that
// a change to courseCodes costs the new file and not the nightly refresh the
// whole site runs on. A commit step on the default if: success() threw that
// refresh away again, which is what the script went out of its way to protect.
test("the ratings commit step is not gated on the fetch succeeding", () => {
  const { gate } = step(read("ratings.yml"), "Commit if changed");
  assert.ok(gate, "no if:, so it defaults to success() and is skipped when the fetch exits 1");
  assert.match(gate, /!cancelled\(\)/);
  assert.equal(step(read("seats.yml"), "Commit if changed").gate, gate, "seats.yml already had the right form");
  assert.equal(step(read("headshots.yml"), "Commit if changed").gate, gate, "headshots.yml has to keep it too");
});

// git add is fatal on a pathspec that matches nothing, so one absent file takes
// down the staging of every file beside it and the commit never happens.
test("a commit step stages what it can when a run wrote nothing new", () => {
  for (const [file, staged] of [
    ["seats.yml", ["data/seats-1268.json", "data/seats.json"]],
    ["ratings.yml", ["data/ratings.json"]],
    ["courses.yml", ["data/courses.json"]],
    ["headshots.yml", ["data/headshots.json"]],
  ]) {
    const dir = repo();
    try {
      const adds = step(read(file), "Commit if changed").run.filter((line) => /^\s*git add\b/.test(line));
      assert.ok(adds.length, `${file} stages nothing`);
      const staging = spawnSync("bash", ["-e", "-c", adds.join("\n")], { cwd: dir, encoding: "utf8" });
      assert.equal(staging.status, 0, `${file}: ${staging.stderr}`);

      const names = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dir, encoding: "utf8" });
      assert.deepEqual(names.trim().split("\n").sort(), staged, `${file} staged the wrong files`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
