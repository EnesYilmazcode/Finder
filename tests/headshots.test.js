// js/headshots.js: which instructors have a photo, and the initials that stand in
// for the ones who do not.
//
// The module answers null for every state but "the snapshot lists this id", so
// most of these pin that the absent cases are all the same answer rather than
// four different ones.

import test from "node:test";
import assert from "node:assert/strict";

import { initials, osuId } from "../js/headshots.js";
import { stubFetch, stubFetchFailingOnce, withHeadshots } from "./helpers.js";
import { HEADSHOTS } from "./fixtures.js";

const loaded = await withHeadshots();
const { faceFor } = loaded;

test("osuId reads the name.N out of an OSU address", () => {
  assert.equal(osuId("bucci.2@osu.edu"), "bucci.2");
  assert.equal(osuId("vandergriff.18@osu.edu"), "vandergriff.18");
  assert.equal(osuId("wang.12754@osu.edu"), "wang.12754");
  // Real ids in the roster carry a hyphen and an apostrophe.
  assert.equal(osuId("calinger-yoak.1@osu.edu"), "calinger-yoak.1");
  assert.equal(osuId("o'brien.4@osu.edu"), "o'brien.4");
});

test("osuId lowercases, since the snapshot is lowercased", () => {
  assert.equal(osuId("Bucci.2@OSU.edu"), "bucci.2");
  assert.equal(osuId("  bucci.2@osu.edu  "), "bucci.2");
});

test("osuId refuses anything that is not an osu.edu address", () => {
  assert.equal(osuId("someone@gmail.com"), null);
  assert.equal(osuId("bucci.2@buckeyemail.osu.edu"), null);
  assert.equal(osuId("bucci.2"), null);
  assert.equal(osuId(""), null);
  assert.equal(osuId(null), null);
  assert.equal(osuId(undefined), null);
});

test("faceFor builds a photo URL for an id the snapshot lists", () => {
  assert.equal(faceFor("bucci.2@osu.edu"), "https://opic.osu.edu/bucci.2?width=100");
  assert.equal(faceFor("gomori.1@osu.edu"), "https://opic.osu.edu/gomori.1?width=100");
});

test("faceFor asks for 100px, the size that is one bucket and not four", () => {
  // width=300 serves 400px wide. Nothing on the page draws it larger than 2rem.
  assert.match(faceFor("bucci.2@osu.edu"), /\?width=100$/);
});

test("faceFor answers null for every absent case, so they all render alike", () => {
  assert.equal(faceFor("kerler.2@osu.edu"), null, "swept and has no photo");
  assert.equal(faceFor(null), null, "instructor carries no address");
  assert.equal(faceFor("someone@gmail.com"), null, "not an OSU address");
  assert.equal(faceFor("bucci.2@osu.edu", null), null, "snapshot has not loaded");
  assert.equal(faceFor("bucci.2@osu.edu", new Set()), null, "snapshot loaded empty");
});

test("initials are the first and last initial, middle names dropped", () => {
  assert.equal(initials("Paolo Bucci"), "PB");
  assert.equal(initials("Diana Ikenberry Kline"), "DK");
  assert.equal(initials("Julian Alonso Mejia Cordero"), "JC");
});

test("initials survive the shapes OSU really publishes", () => {
  assert.equal(initials("A. j. James Gianopoulos"), "AG");
  assert.equal(initials("KT Vandergriff"), "KV");
  assert.equal(initials("Sean O'Brien"), "SO");
  assert.equal(initials("Ivan C. Smith III"), "IS", "a suffix is not a surname");
});

test("initials of a single name are one letter, and of no name are none", () => {
  assert.equal(initials("Cher"), "C");
  assert.equal(initials(""), "");
  assert.equal(initials(null), "");
});

test("loadHeadshots caches, so a second call does not fetch again", async () => {
  const restore = stubFetch({ "headshots.json": () => { throw new Error("fetched twice"); } });
  try {
    assert.equal(await loaded.loadHeadshots("headshots.json"), await loaded.loadHeadshots("headshots.json"));
  } finally {
    restore();
  }
});

test("a fetch that failed is retried rather than remembered", async () => {
  const blip = await import("../js/headshots.js?blip");
  let restore = stubFetch({ "headshots.json": { ok: false, status: 503, json: async () => null } });
  try {
    await assert.rejects(blip.loadHeadshots("headshots.json"));
  } finally {
    restore();
  }

  restore = stubFetch({ "headshots.json": HEADSHOTS });
  try {
    const ids = await blip.loadHeadshots("headshots.json");
    assert.ok(ids.has("bucci.2"), "the retry landed");
  } finally {
    restore();
  }
});

test("a dropped connection is retried too, not cached as a rejection", async () => {
  const flaky = await import("../js/headshots.js?flaky");
  const restore = stubFetchFailingOnce({ "headshots.json": HEADSHOTS });
  try {
    await assert.rejects(flaky.loadHeadshots("headshots.json"));
    assert.ok((await flaky.loadHeadshots("headshots.json")).has("gomori.1"));
  } finally {
    restore();
  }
});

test("a snapshot with no ids loads rather than throwing", async () => {
  const empty = await import("../js/headshots.js?empty");
  const restore = stubFetch({ "headshots.json": { source: "x", count: 0 } });
  try {
    const ids = await empty.loadHeadshots("headshots.json");
    assert.equal(ids.size, 0);
    assert.equal(empty.faceFor("bucci.2@osu.edu"), null);
  } finally {
    restore();
  }
});
