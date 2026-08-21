// Loading real snapshots into the real modules.
//
// ratings.js and seats.js hold their data in module-level state that only
// loadRatings/loadSeats can fill, and both fill it from fetch. Rather than
// hand-building the index and skipping the code that builds it, these helpers
// serve a fixture over a stubbed fetch and let the real loaders run.

import { RATINGS, SEATS_INDEX, SEATS_TERMS } from "./fixtures.js";

/** Swap in a fetch that serves fixtures by URL. Returns a restore function. */
export function stubFetch(routes) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const key = String(url);
    if (!(key in routes)) throw new Error(`unexpected fetch: ${key}`);
    return { ok: true, status: 200, json: async () => routes[key] };
  };
  return () => { globalThis.fetch = original; };
}

/**
 * Like stubFetch, but the first call rejects the way a dropped connection
 * does. For checking that a loader retries instead of caching the failure.
 */
export function stubFetchFailingOnce(routes) {
  const restore = stubFetch(routes);
  const serving = globalThis.fetch;
  let failed = false;
  globalThis.fetch = async (url) => {
    if (failed) return serving(url);
    failed = true;
    throw new TypeError("Failed to fetch");
  };
  return restore;
}

/**
 * Load a snapshot into a module instance.
 *
 * `suffix` picks the instance. Both modules cache after the first load, so a
 * test that needs a different snapshot, or none at all, asks for a fresh
 * instance by passing a suffix the import cache has not seen.
 */
export async function withSeats(terms = ["1268"], suffix = "", index = SEATS_INDEX) {
  const mod = await import(`../js/seats.js${suffix}`);
  const routes = { "seats.json": index };
  for (const entry of index.terms ?? []) {
    if (SEATS_TERMS[entry.term]) routes[entry.file] = SEATS_TERMS[entry.term];
  }
  const restore = stubFetch(routes);
  try {
    // One call per term, the same way app.js loads the term on screen.
    for (const term of terms) await mod.loadSeats(term, "seats.json");
  } finally {
    restore();
  }
  return mod;
}

export async function withRatings(data = RATINGS, suffix = "") {
  const mod = await import(`../js/ratings.js${suffix}`);
  const restore = stubFetch({ "ratings.json": data });
  try {
    await mod.loadRatings("ratings.json");
  } finally {
    restore();
  }
  return mod;
}
