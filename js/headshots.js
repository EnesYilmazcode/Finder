// Instructor photos from opic.osu.edu, keyed on the name.N in their OSU address.
//
// Only ids the snapshot lists get an <img>. An id with no photo 302s to a generic
// Buckeye leaf that loads as an ordinary 200 at whatever size was asked for, so
// onerror never fires, naturalWidth cannot tell it apart, and no CORS header lets
// fetch() read the status. Only a server sees the difference, which is what
// scripts/fetch-headshots.mjs is for.
//
// The first full sweep found 2527 of 8089 instructors with a photo, so the
// monogram is the common case rather than the fallback.

import { nameKey } from "./ratings.js";

const PHOTOS = "https://opic.osu.edu";

// The smallest bucket opic serves: width=300 would return 400px wide. Bytes do
// not follow it, though. One sampled photo is 1.5 MB even at 100px.
const WIDTH = 100;

let ids = null;
let loading = null;

/**
 * Load the snapshot of ids that have a photo.
 *
 * Nothing waits on this. faceFor answers null until it lands, which draws the
 * monogram, and app.js redraws the open pane once it does.
 */
export async function loadHeadshots(baseUrl = "data/headshots.json") {
  if (ids) return ids;

  loading ??= (async () => {
    const response = await fetch(baseUrl);
    if (!response.ok) throw new Error(`headshots ${response.status}`);
    return new Set((await response.json()).ids ?? []);
  })().catch((error) => {
    // A cached rejection would pin the failure for the life of the tab, matching
    // js/seats.js. Whether anything asks again is the caller's business.
    loading = null;
    throw error;
  });

  ids = await loading;
  return ids;
}

/** The name.N in an OSU address, lowercased the way the snapshot is, or null. */
export function osuId(email) {
  const match = /^([a-z0-9][a-z0-9.'-]*)@osu\.edu$/i.exec(String(email ?? "").trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * This instructor's photo URL, or null to draw the monogram instead.
 *
 * Null covers no snapshot yet, one that failed, an instructor with no address,
 * and an id the sweep found no photo for. All four render alike.
 */
export function faceFor(email, set = ids) {
  const id = osuId(email);
  if (!id || !set?.has(id)) return null;
  return `${PHOTOS}/${encodeURIComponent(id)}?width=${WIDTH}`;
}

/**
 * First and last initial, for the monogram.
 *
 * nameKey already drops middle names, dots and generational suffixes, which is
 * the whole problem: it turns "A. j. James Gianopoulos" into AG.
 */
export function initials(name) {
  return nameKey(name)
    .split(" ")
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}
