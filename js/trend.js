// What moved overnight, from data/trend-{term}.json.
//
// The nightly seat job already fetches both sides of the diff and used to throw
// the comparison away: 2468 of 17688 sections changed between the 2026-08-18
// and 2026-08-19 snapshots, 248 of them from full to open. This reads the diff
// that scripts/fetch-seats.mjs now keeps.
//
// Barrett is one batch built around 06:50 Eastern, so nothing here is live and
// nothing here is an alert. It is last night against the night before.

// Term code to that term's trend, or null where the term has no trend file. A
// term with no file is a settled answer and is stored, a fetch that failed is
// not, so a blip can be retried the way seats.js retries its index.
const loaded = new Map();
const loading = new Map();

// Three moving days before anything is drawn. Two points is a line through any
// two numbers, and a slope through one night of noise is a projection this data
// cannot support.
const MIN_POINTS = 3;

function normalise(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.days)) return null;
  // A Set, because this is read once per rendered section row.
  return { ...data, opened: new Set((Array.isArray(data.opened) ? data.opened : []).map(String)) };
}

/**
 * Load one term's trend. Resolves either way and never rejects, because a term
 * with no trend file is the normal state for the first week of a new term.
 */
export async function loadTrend(term, dir = "data/") {
  const key = String(term ?? "");
  if (!key || loaded.has(key)) return;

  let pending = loading.get(key);
  if (!pending) {
    pending = fetch(`${dir}trend-${key}.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => loaded.set(key, normalise(data)))
      .catch(() => {})
      .finally(() => loading.delete(key));
    loading.set(key, pending);
  }
  await pending;
}

/**
 * The date a section went from full to open, or null.
 *
 * Only the most recent recorded night is marked. "Opened three nights ago" is
 * not news, and a section that opened and refilled is not open.
 */
export function openedOn(classNumber, term) {
  const data = loaded.get(String(term ?? ""));
  if (!data?.opened.has(String(classNumber))) return null;
  return data.days[data.days.length - 1] ?? null;
}

function daysBetween(from, to) {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 86400000);
}

/**
 * How one section's `enrolled` or `waitlist` figure has moved, or null.
 *
 * Null covers every reason there is nothing to say, and "it moved twice" is one
 * of them. The span comes from the dates either side of the movement rather
 * than from the number of points, so a night the job missed reads as two days
 * rather than one.
 */
export function trendFor(classNumber, term, field = "enrolled") {
  const data = loaded.get(String(term ?? ""));
  const series = data?.[field]?.[String(classNumber)];
  if (!data || !Array.isArray(series) || series.length !== data.days.length) return null;

  let first = -1;
  let last = -1;
  let points = 0;
  let change = 0;
  for (let i = 0; i < series.length; i++) {
    if (typeof series[i] !== "number" || !series[i]) continue;
    if (first < 0) first = i;
    last = i;
    points++;
    change += series[i];
  }
  // A section that gained two and gave two back has moved, but it has not gone
  // anywhere, and a badge has no way to say that without inventing a direction.
  if (points < MIN_POINTS || !change) return null;

  const from = first === 0 ? data.from : data.days[first - 1];
  const to = data.days[last];
  const days = daysBetween(from, to);
  if (!days) return null;

  return { field, change, points, from, to, days };
}
