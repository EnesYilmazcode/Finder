// The weekly headshot sweep. fetch is replaced, so nothing here touches the
// network: what is worth pinning is the request the sweep sends, how it reads the
// answer, and when it refuses to write.

import test from "node:test";
import assert from "node:assert/strict";

import { hasPhoto, idsIn, osuId, previousCount, snapshot, sweepPlan, writeRefusals } from "../scripts/fetch-headshots.mjs";
import { refusalMessage } from "../scripts/guards.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A search response in the shape content.osu.edu really sends. */
function response(...emails) {
  return {
    totalPages: 1,
    courses: [{
      course: { subject: "CSE", catalogNumber: "2221" },
      sections: [{
        classNumber: 1001,
        meetings: [{ instructors: emails.map((email) => ({ displayName: "X", role: "PI", email })) }],
      }],
    }],
  };
}

test("osuId reads the name.N and refuses anything else", () => {
  assert.equal(osuId("bucci.2@osu.edu"), "bucci.2");
  assert.equal(osuId("calinger-yoak.1@osu.edu"), "calinger-yoak.1");
  assert.equal(osuId("Bucci.2@OSU.edu"), "bucci.2");
  assert.equal(osuId("bucci.2@buckeyemail.osu.edu"), null);
  assert.equal(osuId(null), null);
});

// The instructors hang off courses[].sections[], a sibling of `course`. Reading
// them off course.section instead finds nothing and the sweep silently returns an
// empty roster, which is what happened while this was being written.
test("idsIn reads instructors from courses[].sections[].meetings[]", () => {
  const ids = idsIn(response("bucci.2@osu.edu", "kerler.2@osu.edu"));
  assert.deepEqual([...ids].sort(), ["bucci.2", "kerler.2"]);
});

test("idsIn dedupes, since one instructor teaches many sections", () => {
  const body = response("bucci.2@osu.edu");
  body.courses[0].sections.push(body.courses[0].sections[0]);
  assert.equal(idsIn(body).size, 1);
});

test("idsIn skips an instructor with no usable address", () => {
  assert.deepEqual([...idsIn(response(null, "", "someone@gmail.com", "bucci.2@osu.edu"))], ["bucci.2"]);
});

test("idsIn survives a response missing every level it walks", () => {
  assert.equal(idsIn(null).size, 0);
  assert.equal(idsIn({}).size, 0);
  assert.equal(idsIn({ courses: [{}] }).size, 0);
  assert.equal(idsIn({ courses: [{ sections: [{}] }] }).size, 0);
  assert.equal(idsIn({ courses: [{ sections: [{ meetings: [{}] }] }] }).size, 0);
});

/** Record every request and answer each with the given status. */
function serve(status) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), ...options });
    return { status, ok: status < 400 };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// The whole feature rests on this: opic answers an id it has no photo for with a
// 302 to a generic leaf, not a 404. Following that redirect, or treating it as an
// error, both end with the page drawing a leaf on everyone.
test("a 200 is a photo and a 302 is the leaf placeholder", async () => {
  for (const [status, expected] of [[200, true], [302, false]]) {
    const net = serve(status);
    try {
      assert.equal(await hasPhoto("bucci.2"), expected);
      assert.equal(net.calls[0].redirect, "manual", "following the 302 would land on the leaf and read as a photo");
    } finally {
      net.restore();
    }
  }
});

// A GET here downloads every photo to learn one bit. The roster is over 8000
// people and one sampled image is 1.5 MB.
test("the sweep asks with HEAD, so no image bytes cross the wire", async () => {
  const net = serve(200);
  try {
    await hasPhoto("bucci.2");
    assert.equal(net.calls[0].method, "HEAD");
    assert.equal(net.calls[0].url, "https://opic.osu.edu/bucci.2?width=100");
  } finally {
    net.restore();
  }
});

test("an apostrophe survives the URL untouched, which is what opic answers to", async () => {
  const net = serve(200);
  try {
    await hasPhoto("o'brien.4");
    // encodeURIComponent leaves an apostrophe alone, and opic wants it that way.
    assert.equal(net.calls[0].url, "https://opic.osu.edu/o'brien.4?width=100");
  } finally {
    net.restore();
  }
});

// Term codes are integer-like keys, so they come out in numeric order whatever
// order the catalog wrote them. Harmless here, since the sweep unions its results,
// but the order is pinned so it does not read as a bug later.
test("sweepPlan pairs every subject with its own term", () => {
  const plan = sweepPlan({
    terms: {
      1268: { term: "1268", subjects: [{ code: "CSE" }, { code: "MATH" }] },
      1262: { term: "1262", subjects: [{ code: "CSE" }] },
    },
  });
  assert.deepEqual(plan, [
    { term: "1262", code: "CSE" },
    { term: "1268", code: "CSE" },
    { term: "1268", code: "MATH" },
  ]);
});

test("sweepPlan skips a subject with no code rather than sweeping undefined", () => {
  const plan = sweepPlan({ terms: { 1268: { term: "1268", subjects: [{ name: "no code" }, { code: "CSE" }] } } });
  assert.deepEqual(plan, [{ term: "1268", code: "CSE" }]);
});

test("sweepPlan of an empty or malformed catalog is empty, not a crash", () => {
  assert.deepEqual(sweepPlan(null), []);
  assert.deepEqual(sweepPlan({}), []);
  assert.deepEqual(sweepPlan({ terms: {} }), []);
});

test("the snapshot carries the ids and their count", () => {
  const written = snapshot(["bucci.2", "gomori.1"]);
  assert.deepEqual(written.ids, ["bucci.2", "gomori.1"]);
  assert.equal(written.count, 2);
  assert.equal(written.source, "https://opic.osu.edu");
});

function fileWith(count) {
  const dir = mkdtempSync(join(tmpdir(), "finder-hs-"));
  const path = join(dir, "headshots.json");
  writeFileSync(path, JSON.stringify({ count, ids: Array.from({ length: count }, (_, i) => `p.${i}`) }));
  return path;
}

test("previousCount reads the committed list, and a missing file is a first run", async () => {
  assert.equal(await previousCount(fileWith(3000)), 3000);
  assert.equal(await previousCount(join(tmpdir(), "finder-hs-nothing.json")), 0);
});

test("a healthy run writes", async () => {
  assert.equal(refusalMessage(await writeRefusals({ instructors: 8000, photos: 3000 }, fileWith(2950)), false), null);
});

// A sweep that collapses would find few instructors, so few photos, and the photo
// count alone would read as a real shrink at the source rather than a broken run.
test("a collapsed roster is refused even when the photo count looks plausible", async () => {
  const refusal = refusalMessage(await writeRefusals({ instructors: 12, photos: 8 }, fileWith(0)), false);
  assert.match(refusal, /instructors swept: got 12/);
});

test("a photo count far under what is committed is refused", async () => {
  const refusal = refusalMessage(await writeRefusals({ instructors: 8000, photos: 1200 }, fileWith(3000)), false);
  assert.match(refusal, /instructors with a photo: got 1200, down 60\.0%/);
});

// FORCE_WRITE is there so a real upstream shrink can be shipped by hand.
test("a real shrink can be forced through, a collapsed sweep cannot", async () => {
  assert.equal(refusalMessage(await writeRefusals({ instructors: 8000, photos: 1200 }, fileWith(3000)), true), null);
  assert.match(refusalMessage(await writeRefusals({ instructors: 12, photos: 8 }, fileWith(3000)), true), /instructors swept/);
});

test("the first run has only the floor to clear", async () => {
  const missing = join(tmpdir(), "finder-hs-nothing.json");
  assert.equal(refusalMessage(await writeRefusals({ instructors: 8000, photos: 600 }, missing), false), null);
  assert.match(refusalMessage(await writeRefusals({ instructors: 8000, photos: 12 }, missing), false), /instructors with a photo: got 12/);
});

// Regression in spirit, #93. mapLimit runs on Promise.all, so before this a single
// unanswered HEAD out of 8089 rejected the whole sweep and the week wrote nothing.
test("a handful of unanswered checks is tolerated, a wholesale refusal is not", async () => {
  const held = fileWith(3000);
  assert.equal(refusalMessage(await writeRefusals({ instructors: 8000, photos: 2900, unchecked: 40 }, held), false), null,
    "40 of 8000 is under the rate, and those 40 just wait a week");
  assert.match(refusalMessage(await writeRefusals({ instructors: 8000, photos: 2900, unchecked: 900 }, held), false),
    /photo checks: 900 of 8000 rows did not parse/);
});

// The rate gate is fatal on purpose: a run where opic refused half the sweep is a
// broken run, not a week where half the university deleted their photo.
test("a wholesale refusal cannot be forced through", async () => {
  assert.match(refusalMessage(await writeRefusals({ instructors: 8000, photos: 2900, unchecked: 900 }, fileWith(3000)), true),
    /photo checks/);
});

// The roster half of the run gets the same treatment: one subject that will not
// answer costs its instructors a photo for a week, a sweep where most of them fail
// is a broken run.
test("a few missed subject sweeps are tolerated, most of them failing is not", async () => {
  const held = fileWith(3000);
  assert.equal(refusalMessage(await writeRefusals(
    { instructors: 8000, photos: 2900, missed: 8, jobs: 682 }, held), false), null);
  assert.match(refusalMessage(await writeRefusals(
    { instructors: 8000, photos: 2900, missed: 300, jobs: 682 }, held), false), /subject sweeps: 300 of 682/);
});
