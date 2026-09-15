export const WATCH_STORAGE_KEY = "finder.watches.v1";
const DEFAULT_CAMPUS = "col";

export function watchKey(watch) {
  return `${watch?.term ?? ""}:${watch?.campus || DEFAULT_CAMPUS}:${watch?.classNumber ?? ""}`;
}

function valid(watch) {
  return watch && typeof watch === "object"
    && String(watch.term ?? "") && String(watch.classNumber ?? "");
}

export function loadWatches(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(WATCH_STORAGE_KEY) ?? "null");
    return parsed?.version === 1 && Array.isArray(parsed.watches)
      ? parsed.watches.filter(valid).slice(0, 100)
      : [];
  } catch {
    return [];
  }
}

export function saveWatches(watches, storage = globalThis.localStorage) {
  try {
    storage?.setItem(WATCH_STORAGE_KEY, JSON.stringify({ version: 1, watches: watches.filter(valid).slice(0, 100) }));
    return true;
  } catch {
    return false;
  }
}

export function isWatched(watches, term, campus, classNumber) {
  const key = `${term}:${campus || DEFAULT_CAMPUS}:${classNumber}`;
  return watches.some((watch) => watchKey(watch) === key);
}

export function toggleWatch(watches, { term, campus = DEFAULT_CAMPUS, classNumber, courseCode, seats }) {
  const key = `${term}:${campus}:${classNumber}`;
  if (watches.some((watch) => watchKey(watch) === key)) {
    return watches.filter((watch) => watchKey(watch) !== key);
  }
  return [...watches, {
    term: String(term), campus: String(campus), classNumber: String(classNumber),
    courseCode: String(courseCode ?? ""), full: seats?.full ?? null,
    enrolled: seats?.enrolled ?? null, limit: seats?.limit ?? null,
  }];
}

/**
 * Compare locally watched sections with a freshly loaded seat snapshot.
 * The caller supplies the seat lookup so this stays deterministic in tests.
 */
export function reconcileWatches(watches, term, campus, lookup) {
  const opened = [];
  const changed = [];
  const next = watches.map((watch) => {
    if (String(watch.term) !== String(term) || String(watch.campus || DEFAULT_CAMPUS) !== String(campus)) return watch;
    const seats = lookup(watch.classNumber, term);
    if (!seats) return watch;
    if (watch.full === true && seats.full === false) opened.push({ ...watch, seats });
    else if (watch.enrolled != null && watch.enrolled !== seats.enrolled) changed.push({ ...watch, seats });
    return { ...watch, full: seats.full, enrolled: seats.enrolled, limit: seats.limit };
  });
  return { watches: next, opened, changed };
}
