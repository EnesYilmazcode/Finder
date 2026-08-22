import test from "node:test";
import assert from "node:assert/strict";

import { nameKey, surnameKey, searchUrl, profileUrl, courseCode } from "../js/ratings.js";
import { withRatings, withRatingCourses } from "./helpers.js";
import { RATINGS } from "./fixtures.js";

const ratings = await withRatings();
const { ratingFor } = ratings;

// A second instance carrying the course codes, since the site fetches them separately.
const withCodes = await withRatingCourses(await withRatings(RATINGS, "?codes"));
const share = (name, subject, catalogNumber) =>
  withCodes.courseShare(withCodes.ratingFor(name), { subject, catalogNumber });

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

test("ratingSpread totals the counts instead of trusting the ratings count", () => {
  const spread = ratings.ratingSpread(ratingFor("Paolo Bucci"));
  assert.deepEqual(spread.counts, [32, 29, 19, 30, 38]);
  assert.equal(spread.total, 148);
});

test("ratingSpread returns null when there is no bar to draw", () => {
  assert.equal(ratings.ratingSpread(ratingFor("Alan Reed")), null); // no distribution
  assert.equal(ratings.ratingSpread({ distribution: [0, 0, 0, 0, 0] }), null);
  assert.equal(ratings.ratingSpread({ distribution: [1, 2, 3] }), null);
  assert.equal(ratings.ratingSpread({ distribution: [1, 2, 3, 4, -1] }), null);
  assert.equal(ratings.ratingSpread(null), null);
});

test("courseCode folds the ways a rater writes one course", () => {
  assert.deepEqual(courseCode("CSE 2221"), { subject: "CSE", number: "2221" });
  assert.deepEqual(courseCode("cse2221"), { subject: "CSE", number: "2221" });
  assert.deepEqual(courseCode("CS2221"), { subject: "CS", number: "2221" });
  assert.deepEqual(courseCode("2221"), { subject: "", number: "2221" });
  assert.deepEqual(courseCode("CSE2221H"), { subject: "CSE", number: "2221H" });
});

test("courseCode returns null for text that names no course", () => {
  assert.equal(courseCode("PHYSICS"), null);
  assert.equal(courseCode("N/A"), null);
  assert.equal(courseCode(""), null);
  assert.equal(courseCode(null), null);
});

test("courseShare counts every spelling of the course on screen", () => {
  assert.deepEqual(share("Diana Ikenberry Kline", "CSE", "2221"), { matched: 22, total: 31, code: "CSE 2221" });
  assert.deepEqual(share("Diana Ikenberry Kline", "CSE", "2231"), { matched: 8, total: 31, code: "CSE 2231" });
});

test("courseShare counts a subject a rater spelled out", () => {
  // Losing it would also make the bare "1210" contested, so this is 11 ratings, not 8.
  assert.deepEqual(share("Rosemary Bartoszek-Loza", "CHEM", "1210"), { matched: 128, total: 128, code: "CHEM 1210" });
});

test("courseShare folds a dotted catalog number onto the number raters type", () => {
  // The line says 1110, not 1110.01, because 1110 is what the raters named.
  assert.deepEqual(share("Nora Whitfield", "ENGLISH", "1110.01"), { matched: 48, total: 60, code: "ENGLISH 1110" });
  assert.deepEqual(share("Nora Whitfield", "ENGLISH", "1110.02"), { matched: 53, total: 60, code: "ENGLISH 1110" });
});

test("courseShare divides by the ratings count the pane already shows", () => {
  assert.deepEqual(share("Paolo Bucci", "CSE", "2221"), { matched: 52, total: 147, code: "CSE 2221" });
  assert.deepEqual(share("Paolo Bucci", "CSE", "2231"), { matched: 74, total: 147, code: "CSE 2231" });
});

test("courseShare says none rather than staying quiet when nothing matches", () => {
  assert.deepEqual(share("Timothy Long", "CSE", "2221"), { matched: 0, total: 12, code: "CSE 2221" });
});

test("courseShare does not fold an honours or pre-semester number onto the course", () => {
  // Has to hold from the catalog side too: 187 of the 259 letter-suffixed numbers
  // have a plain sibling whose ratings a fold would steal.
  assert.deepEqual(share("Stephen Gomori", "CSE", "2221"), { matched: 0, total: 60, code: "CSE 2221" });
  assert.deepEqual(share("Stephen Gomori", "CSE", "2221H"), { matched: 30, total: 60, code: "CSE 2221H" });
});

test("courseShare gives a bare number to the subject on screen, unless it is contested", () => {
  assert.deepEqual(share("Diana Ikenberry Kline", "MATH", "2221"), { matched: 0, total: 31, code: "MATH 2221" });
});

test("courseShare refuses to answer for a professor the file does not list", () => {
  // Ivan Smith is rated, so this is the file having nothing on him rather than
  // the name lookup failing.
  assert.equal(share("Ivan C. Smith III", "CSE", "2221"), null);
  assert.equal(withCodes.courseShare(null, { subject: "CSE", catalogNumber: "2221" }), null);
});

test("courseShare returns null until the course codes are loaded", () => {
  assert.equal(ratings.courseShare(ratingFor("Diana Kline"), { subject: "CSE", catalogNumber: "2221" }), null);
});

test("loadRatingCourses caches, so a second detail open does not fetch again", async () => {
  const again = await withCodes.loadRatingCourses("never-fetched.json");
  assert.equal(again["2"]["MATH 1151"], 13);
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
