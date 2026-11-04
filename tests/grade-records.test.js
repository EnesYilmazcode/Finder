import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { stubFetch } from "./helpers.js";
import { setupDom } from "./dom.js";
import { renderDetail } from "../js/detail.js";
import * as grades from "../js/grades.js";

const read = (path) => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url), "utf8"));
const manifest = read("grades.json");
const cse = read("grades/CSE.json");
const person = { name: "Paolo Bucci", email: "bucci.2@osu.edu" };
const course = { subject: "CSE", catalogNumber: "2221" };

test("the release reconciles every subject and term back to its aggregate", () => {
  const provenance = read("grades-provenance.json");
  assert.equal(provenance.files.length, 25);
  assert.equal(provenance.sourceRows, 121196);
  assert.equal(provenance.gradeTotalsReconciled, true);
  assert.equal(Object.keys(manifest.instructors).length, manifest.count);
  let sections = 0;
  for (const [subject, path] of Object.entries(manifest.subjects)) {
    const shard = read(path);
    assert.equal(shard.subject, subject);
    for (const [key, courses] of Object.entries(shard.instructors)) {
      assert.ok(manifest.instructors[key]);
      for (const [code, entry] of Object.entries(courses)) {
        assert.ok(code.startsWith(`${subject} `));
        assert.equal(entry.terms, Object.keys(entry.history).length);
        const sums = Array(11).fill(0);
        let enrolled = 0, classes = 0, coTaught = 0;
        const other = {};
        for (const row of Object.values(entry.history)) {
          row.counts.forEach((n, i) => { assert.ok(Number.isSafeInteger(n) && n >= 0); sums[i] += n; });
          const nonLetter = Object.entries(row.other).reduce((n, [m, v]) => n + (m === "EN" ? 0 : v), 0);
          assert.equal(row.counts.reduce((a, b) => a + b, 0) + nonLetter, row.enrolled);
          enrolled += row.enrolled; classes += row.sections; coTaught += row.coTaught;
          for (const [mark, n] of Object.entries(row.other)) other[mark] = (other[mark] ?? 0) + n;
        }
        assert.deepEqual(entry.counts, sums);
        assert.deepEqual(entry.other, other);
        assert.equal(entry.enrolled, enrolled);
        assert.equal(entry.sections, classes);
        assert.equal(entry.coTaught, coTaught);
        sections += classes;
      }
    }
  }
  assert.equal(sections, provenance.instructorClassRows);
});

test("subject history is lazy, shared, and retryable after a failed request", async (t) => {
  const requests = [];
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let fail = true;
  globalThis.fetch = async (url) => {
    requests.push(url);
    if (url === "data/grades.json") return { ok: true, json: async () => structuredClone(manifest) };
    assert.equal(url, "data/grades/CSE.json");
    if (fail) return { ok: false, status: 503 };
    return { ok: true, json: async () => cse };
  };
  await grades.loadGrades();
  assert.deepEqual(requests, ["data/grades.json"]);
  await assert.rejects(grades.loadGradeCourse(course), /503/);
  assert.equal(grades.gradeLoadState(course), "failed");
  fail = false;
  await Promise.all([grades.loadGradeCourse(course), grades.loadGradeCourse(course)]);
  assert.equal(requests.filter((u) => u.endsWith("/CSE.json")).length, 2);
  assert.equal(grades.gradeLoadState(course), "ready");
  const curve = grades.gradesFor(person, course);
  assert.equal(curve.n, 960);
  assert.equal(curve.sections, 30);
  assert.equal(curve.other.EN, 48);
  assert.equal(curve.enrolled, 1153);
  assert.equal(grades.gradeHistory(person, course)[0].term, "1262");
  const spring = grades.gradeCurveForTerm(person, course, "1262");
  assert.equal(spring.n, 31);
  assert.equal(spring.counts[10], 13); // Includes four EN marks.
  assert.equal(spring.enrolled, 35);
});

test("exact full names distinguish middle names and compound surnames", async () => {
  const mod = await import("../js/grades.js?identity-records");
  const row = (name, a) => ({ name, courses: { "CSE 2221": { counts: [a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } } });
  const restore = stubFetch({ "grades.json": { instructors: {
    "one": row("Alex Michael Reed", 10), "two": row("Alex James Reed", 20),
    "three": row("Maria Van Buskirk", 30),
  } } });
  try { await mod.loadGrades("grades.json"); } finally { restore(); }
  assert.equal(mod.gradesFor({ name: "Alex Michael Reed" }, course).n, 10);
  assert.equal(mod.gradesFor({ name: "Reed,Alex James" }, course).n, 20);
  assert.equal(mod.gradesFor({ name: "Alex Reed" }, course), null);
  assert.equal(mod.gradesFor({ name: "Maria Van Buskirk" }, course).n, 30);
});

test("the real release renders term controls, exact outcomes, and comparison rows", () => {
  setupDom();
  const host = document.createElement("div");
  host.append(renderDetail({ course, section: { classNumber: "123", meetings: [{ instructors: [{ displayName: person.name, email: person.email }] }] }, term: "1268", entries: [] }));
  const card = host.querySelector(".grade-card");
  assert.ok(card);
  assert.equal(card.querySelectorAll(".grade-column").length, 11);
  assert.match(card.textContent, /EN \(non-attendance\) grades are included in E/);
  const select = card.querySelector("select");
  select.value = "1262";
  select.dispatchEvent({ type: "change" });
  assert.match(card.querySelector(".grade-sample").textContent, /1 class · 35 recorded enrollments/);
  assert.match(card.querySelector(".grade-content").textContent, /31letter grades/);
  assert.equal(card.querySelectorAll(".grade-table")[1].querySelectorAll("tbody tr").length, 20);
});

test("the XLSX importer rejects malformed counts and conflicting duplicates", () => {
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["tests/import_grade_records_test.py"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("courses without letter grades retain all other outcomes without a zero GPA", () => {
  setupDom();
  let sample;
  for (const [key, courses] of Object.entries(cse.instructors)) {
    for (const [code, record] of Object.entries(courses)) {
      if (record.counts.every((n) => n === 0) && record.enrolled > 0) { sample = { key, code }; break; }
    }
    if (sample) break;
  }
  assert.ok(sample);
  const host = document.createElement("div");
  host.append(renderDetail({ course: { subject: "CSE", catalogNumber: sample.code.slice(4) },
    section: { classNumber: "123", meetings: [{ instructors: [{ displayName: manifest.instructors[sample.key].name }] }] }, term: "1268", entries: [] }));
  const card = host.querySelector(".grade-card");
  assert.ok(card);
  assert.equal(card.querySelector(".grade-chart"), null);
  assert.match(card.textContent, /No letter grades in this selection/);
  assert.ok(card.querySelectorAll(".grade-table")[0].querySelectorAll("tbody tr").length > 11);
  const comparison = card.querySelectorAll(".grade-table")[1];
  assert.match(comparison.textContent, /OutcomesEnrolled/);
  assert.doesNotMatch(comparison.querySelector("thead").textContent, /GPA/);
});
