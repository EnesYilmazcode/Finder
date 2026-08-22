import test from "node:test";
import assert from "node:assert/strict";

import { nameKey, surnameKey, searchUrl, profileUrl } from "../js/ratings.js";
import { withRatings } from "./helpers.js";

const ratings = await withRatings();
const { ratingFor } = ratings;

test("nameKey keeps first and last name only", () => {
  assert.equal(nameKey("Diana Ikenberry Kline"), "diana kline");
  assert.equal(nameKey("Paolo Bucci"), "paolo bucci");
  assert.equal(nameKey("PAOLO BUCCI"), "paolo bucci");
});

test("nameKey strips punctuation and collapses whitespace", () => {
  assert.equal(nameKey("Ivan C. Smith"), "ivan smith");
  assert.equal(nameKey("Sean O'Brien"), "sean obrien");
  assert.equal(nameKey("Anne-Marie Dubois"), "annemarie dubois");
  assert.equal(nameKey("  Paolo   Bucci  "), "paolo bucci");
});

test("nameKey skips generational suffixes", () => {
  assert.equal(nameKey("Ivan C. Smith III"), "ivan smith");
  assert.equal(nameKey("John Doe Jr."), "john doe");
  assert.equal(nameKey("Henry Ford Sr"), "henry ford");
  assert.equal(nameKey("Robert King IV"), "robert king");
});

test("nameKey handles a single name and no name at all", () => {
  assert.equal(nameKey("Cher"), "cher");
  assert.equal(nameKey(""), "");
  assert.equal(nameKey(null), "");
  assert.equal(nameKey("   "), "");
});

test("surnameKey is the last name after suffixes are dropped", () => {
  assert.equal(surnameKey("Ivan C. Smith III"), "smith");
  assert.equal(surnameKey("Diana Ikenberry Kline"), "kline");
  assert.equal(surnameKey("Cher"), "cher");
  assert.equal(surnameKey(""), "");
});

test("ratingFor matches a professor through the middle name", () => {
  const found = ratingFor("Diana Ikenberry Kline");
  assert.equal(found.legacyId, 1);
  assert.equal(found.avgRating, 4.2);
});

test("ratingFor matches through a generational suffix", () => {
  assert.equal(ratingFor("Ivan C. Smith III").legacyId, 10);
});

test("ratingFor expands a nickname the query is a prefix of", () => {
  // OSU says Timothy Long, RateMyProfessors says Tim Long.
  assert.equal(ratingFor("Timothy Long").legacyId, 2);
});

test("ratingFor accepts a shared initial only when the surname is unique", () => {
  // Steve against Stephen, and Gomori is the only one.
  assert.equal(ratingFor("Steve Gomori").legacyId, 3);
});

test("ratingFor refuses to guess between two people with the same name", () => {
  assert.equal(ratingFor("Alan Reed"), null);
});

test("ratingFor refuses a shared initial when two people could be meant", () => {
  // Mark Vance is neither Maria nor Marcus, and a shared M is not evidence.
  assert.equal(ratingFor("Mark Vance"), null);
});

test("ratingFor refuses when two candidates are both plausible expansions", () => {
  // Jon Park could be Jonathan or Jonas.
  assert.equal(ratingFor("Jon Park"), null);
});

test("ratingFor returns null for a name that is not in the snapshot", () => {
  assert.equal(ratingFor("Nobody Here"), null);
  assert.equal(ratingFor(""), null);
  assert.equal(ratingFor(null), null);
});

test("ratingFor returns null when no index is loaded", async () => {
  const fresh = await import("../js/ratings.js?unloaded");
  assert.equal(fresh.ratingFor("Diana Kline"), null);
  assert.equal(ratingFor("Diana Kline", null), null);
});

test("loadRatings caches, so a second call does not fetch again", async () => {
  const again = await ratings.loadRatings("never-fetched.json");
  assert.equal(again.byKey.get("diana kline").length, 1);
  assert.equal(again.bySurname.get("reed").length, 2);
});

test("a snapshot that loaded does not read as failed", () => {
  assert.equal(ratings.ratingsFailed(), false);
});

test("the RateMyProfessors links point at Ohio State", () => {
  assert.equal(
    searchUrl("Paolo Bucci"),
    "https://www.ratemyprofessors.com/search/professors/724?q=Paolo%20Bucci"
  );
  assert.equal(profileUrl(3069), "https://www.ratemyprofessors.com/professor/3069");
});
