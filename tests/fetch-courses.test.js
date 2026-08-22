// The weekly index build, tested for the decisions that can lose a whole
// subject. fetch is replaced, so nothing here touches the network.

import test from "node:test";
import assert from "node:assert/strict";

import { lostSubjects, reconcileSubject, subjectsByTerm, writeRefusals } from "../scripts/fetch-courses.mjs";
import { refusalMessage } from "../scripts/guards.mjs";

const COURSES = Array.from({ length: 29 }, (_, i) => ({
  course: {
    subject: "CSE",
    subjectDesc: "Computer Science and Engineering",
    catalogNumber: String(2221 + i),
    title: `Course ${i}`,
    minUnits: 3,
    maxUnits: 3,
  },
}));

// A subject that is not offered and a pass the API dropped are the same response.
const EMPTY = { data: { totalPages: 0, totalItems: 0, courses: [] } };
const FULL = { data: { totalPages: 1, totalItems: 1064, courses: COURSES } };

/** Answer each request with the next body, repeating the last. Records the URLs. */
function serve(bodies) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(String(url)));
    return { ok: true, status: 200, json: async () => bodies[Math.min(calls.length - 1, bodies.length - 1)] };
  };
  return calls;
}

const original = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = original; });

// Regression, #92. One degraded response used to end the walk, which dropped the
// subject from the index for a week.
test("regression #92: an empty first pass does not delete the subject", async () => {
  const calls = serve([EMPTY, FULL]);
  const r = await reconcileSubject("1268", "CSE");
  assert.ok(calls.length > 1, `gave up after ${calls.length} request(s)`);
  assert.equal(r.courses.size, 29);
  assert.equal(r.name, "Computer Science and Engineering");
});

test("a subject that is really not offered costs one confirming pass and stops", async () => {
  const calls = serve([EMPTY]);
  const r = await reconcileSubject("1268", "ZZZZ");
  assert.equal(r.courses.size, 0);
  assert.equal(r.passes, 2);
  assert.equal(calls.length, 2);
});

// The second guard, for when two passes in a row come back empty.
test("a subject that had courses in this term last week and none now is lost", () => {
  const subjects = [{ code: "MATH", courses: [["1151", "Calculus I", 5, 5]] }];
  assert.deepEqual(lostSubjects(new Set(["CSE", "MATH"]), subjects), ["CSE"]);
});

test("a subject that is still offered is not lost", () => {
  const subjects = [{ code: "CSE", courses: [["2221", "Software I", 4, 4]] }];
  assert.deepEqual(lostSubjects(new Set(["CSE"]), subjects), []);
});

// main looks the previous term up by strm. Key that Map anything else and the
// guard quietly never fires again, which is the shape of the bug it is here for.
// The counts ride along because the collapse check reads the same index, and a
// second reader over the same 754 KB file is a second thing to keep in step.
test("the previous index is read per term, without its empty subjects", () => {
  const previous = subjectsByTerm({
    terms: {
      1268: {
        subjects: [
          { code: "CSE", courses: [["2221", "Software I", 4, 4], ["2231", "Software II", 4, 4]] },
          { code: "MATH", courses: [] },
        ],
      },
      1264: { subjects: [{ code: "PHYSICS", courses: [["1250", "Mechanics", 5, 5]] }] },
    },
  });
  assert.deepEqual([...previous.keys()].sort(), ["1264", "1268"]);
  assert.deepEqual(previous.get("1268"), { codes: new Set(["CSE"]), subjects: 1, courses: 2 });
  assert.deepEqual(lostSubjects(previous.get("1268").codes, []), ["CSE"]);
});

test("a term the last index never had loses nothing", () => {
  const previous = subjectsByTerm({});
  assert.deepEqual(lostSubjects(previous.get("1268")?.codes ?? new Set(), []), []);
  // A first run has no file at all, so previousIndex hands back null.
  assert.equal(subjectsByTerm(null).size, 0);
});

// One event, one override. The refusal message tells the operator to set
// FORCE_WRITE=1, so a lost subject has to be something FORCE_WRITE=1 clears,
// not a second switch they have to go and find.
test("a lost subject is refused, and FORCE_WRITE=1 is the way past it", () => {
  const before = { codes: new Set(["CSE", "MATH"]), subjects: 243, courses: 6072 };
  const still = [{ code: "MATH", courses: [["1151", "Calculus I", 5, 5]] }];
  const refusals = writeRefusals("1268", 243, 6072, before, still);

  const refusal = refusalMessage(refusals, false);
  assert.match(refusal, /CSE had courses in the last index and none now/);
  assert.doesNotMatch(refusal, /MATH/);
  assert.match(refusal, /FORCE_WRITE=1/);

  const warnings = [];
  const warn = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    assert.equal(refusalMessage(refusals, true), null);
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CSE/);
});

// Two requests in the same millisecond land in the same degraded window, so the
// confirming pass has to be spaced the way the rest of the walk is.
test("the confirming pass is spaced, not fired back to back", async () => {
  const stamps = [];
  globalThis.fetch = async () => {
    stamps.push(performance.now());
    return { ok: true, status: 200, json: async () => EMPTY };
  };
  await reconcileSubject("1268", "ZZZZ");
  assert.equal(stamps.length, 2);
  assert.ok(stamps[1] - stamps[0] > 50, `only ${(stamps[1] - stamps[0]).toFixed(1)} ms apart`);
});
