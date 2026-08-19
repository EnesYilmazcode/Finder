// Per-section seat counts from Barrett's schedule, snapshotted daily by
// scripts/fetch-seats.mjs.
//
// OSU's own API cannot supply these: it reports one enrollment figure per
// course and repeats it onto every section, so it calls a 41/40 section "Open".
// See docs/osu-api.md.

let snapshot = null;
let loading = null;

export async function loadSeats(url = "data/seats.json") {
  if (snapshot) return snapshot;
  if (loading) return loading;

  loading = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`seats ${response.status}`);
    snapshot = await response.json();
    return snapshot;
  })();

  return loading;
}

/** The term this snapshot covers, or null if nothing is loaded. */
export function seatsTerm() {
  return snapshot?.term ?? null;
}

/** The date Barrett last refreshed, for labelling the numbers as day-old. */
export function seatsUpdated() {
  return snapshot?.sourceUpdated ?? null;
}

/**
 * Seats for one section, or null when unknown.
 *
 * The term guard is the important part. The snapshot holds a single term while
 * the UI offers three, and showing Autumn seats against a Spring section would
 * be confidently wrong, which is worse than showing nothing. A class number
 * that is simply absent is also unknown, never zero.
 */
export function seatsFor(classNumber, term) {
  if (!snapshot || !term || String(snapshot.term) !== String(term)) return null;
  const row = snapshot.sections?.[String(classNumber)];
  if (!Array.isArray(row) || row.length < 2) return null;

  const [enrolled, limit, waitlist = 0] = row;
  if (typeof enrolled !== "number" || typeof limit !== "number") return null;

  return {
    enrolled,
    limit,
    waitlist,
    full: limit > 0 && enrolled >= limit,
  };
}
