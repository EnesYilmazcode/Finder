// The instructor face at the top of the right pane.
//
// The thing worth guarding is that a missing photo renders as initials and never
// as an image. opic.osu.edu answers an id it has no photo for with a 302 to a
// generic Buckeye leaf that loads as an ordinary 200, so an <img> drawn on a
// guess shows a leaf rather than failing, and every instructor without a photo
// would show the same one.

import test from "node:test";
import assert from "node:assert/strict";

import { renderDetail } from "../js/detail.js";
import { HEADSHOTS, meeting, person, section } from "./fixtures.js";
import { setupDom } from "./dom.js";
import { cssRules, withHeadshots, withRatings, withSeats } from "./helpers.js";
import { readFileSync } from "node:fs";

setupDom();
await withSeats(["1268"]);
await withRatings();
await withHeadshots();

const CSE2221 = { subject: "CSE", catalogNumber: "2221", title: "Software I", minUnits: 4, maxUnits: 4 };
const MWF = ["monday", "wednesday", "friday"];

/** One section taught by the given people, each an [displayName, email] pair. */
function taughtBy(...people) {
  return section(1001, {
    meetings: [meeting(MWF, "9:00 AM", "9:55 AM", people.map(([name, email]) => person(name, { email })))],
  });
}

function pane(target) {
  const host = document.createElement("div");
  host.append(renderDetail({ section: target, course: CSE2221, term: "1268", entries: [] }));
  return host;
}

const faces = (host) => host.querySelectorAll(".d-face");

test("an instructor the snapshot lists gets their photo", () => {
  const host = pane(taughtBy(["Paolo Bucci", "bucci.2@osu.edu"]));
  const [face] = faces(host);
  assert.equal(face.tagName, "IMG");
  assert.equal(face.src, "https://opic.osu.edu/bucci.2?width=100");
});

test("an instructor with no photo gets initials, never an image", () => {
  const host = pane(taughtBy(["Thomas Kerler", "kerler.2@osu.edu"]));
  const [face] = faces(host);
  assert.equal(face.tagName, "SPAN", "a leaf placeholder would have loaded fine, so nothing may guess");
  assert.equal(face.dataset.initials, "TK");
  assert.equal(host.querySelectorAll("img").length, 0);
});

test("an instructor with no address on file gets initials too", () => {
  const host = pane(taughtBy(["Stephen Gomori", null]));
  assert.equal(faces(host)[0].dataset.initials, "SG");
  assert.equal(host.querySelectorAll("img").length, 0);
});

test("the face is decorative, because the name is right next to it", () => {
  const photo = faces(pane(taughtBy(["Paolo Bucci", "bucci.2@osu.edu"])))[0];
  assert.equal(photo.alt, "", "the link beside it already says the name");

  const mono = faces(pane(taughtBy(["Thomas Kerler", "kerler.2@osu.edu"])))[0];
  assert.equal(mono.getAttribute("aria-hidden"), "true");
});

test("a photo is lazy and decodes off the main thread", () => {
  // One sampled photo is 1.5 MB even at 100px, because opic never re-encodes the
  // source down.
  const [face] = faces(pane(taughtBy(["Paolo Bucci", "bucci.2@osu.edu"])));
  assert.equal(face.loading, "lazy");
  assert.equal(face.decoding, "async");
});

test("a co-taught section gets one face each, in order", () => {
  const host = pane(taughtBy(["Paolo Bucci", "bucci.2@osu.edu"], ["Thomas Kerler", "kerler.2@osu.edu"]));
  const [first, second] = faces(host);
  assert.equal(faces(host).length, 2);
  assert.equal(first.tagName, "IMG");
  assert.equal(second.tagName, "SPAN");
  assert.equal(second.dataset.initials, "TK");
  assert.equal(host.querySelector(".d-name").textContent, "Paolo Bucci & Thomas Kerler",
    "the initials are drawn by CSS, so they are not in the heading text");
});

test("a face that will not load falls back to the initials", () => {
  const host = pane(taughtBy(["Paolo Bucci", "bucci.2@osu.edu"]));
  const [image] = faces(host);
  image.dispatchEvent({ type: "error" });

  const [replaced] = faces(host);
  assert.equal(replaced.tagName, "SPAN");
  assert.equal(replaced.dataset.initials, "PB");
  assert.equal(host.querySelectorAll("img").length, 0);
});

test("a section with no instructor has no face to draw", () => {
  const host = pane(section(1001, { meetings: [meeting(MWF, "9:00 AM", "9:55 AM", [])] }));
  assert.equal(faces(host).length, 0);
  assert.equal(host.querySelector(".d-name").textContent, "Instructor not listed");
});

test("photo and monogram are the same box, so the heading cannot move", () => {
  const rule = cssRules(readFileSync(new URL("../css/finder.css", import.meta.url), "utf8"));
  const face = rule(".d-face");
  const mono = rule(".d-mono");

  assert.equal(face.width, "2rem");
  assert.equal(face.height, "2rem");
  // The monogram sets its own font-size, so an em-sized box would not match.
  assert.match(face.width, /rem$/);
  assert.equal(mono["line-height"], face.height, "the initials centre on the same height");
  assert.equal(face["object-fit"], "cover", "a non-square source must not stretch");
  assert.equal(face.background, "var(--sunk)", "one token fills the circle in both themes");
  assert.equal(mono.color, "var(--mute)");
  // Without this the circle is empty: the initials live in the attribute.
  assert.equal(rule(".d-mono::before").content, "attr(data-initials)");
});

test("the fixture only lists ids the tests actually use", () => {
  assert.deepEqual([...HEADSHOTS.ids].sort(), ["bucci.2", "gomori.1"]);
});
