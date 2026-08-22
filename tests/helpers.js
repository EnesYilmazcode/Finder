// Shared test harness: real snapshots into the real modules, and a reader for
// the rules a stylesheet declares.
//
// ratings.js, seats.js and trend.js hold their data in module-level state that
// only loadRatings/loadSeats/loadTrend can fill, and all three fill it from
// fetch. Rather than hand-building the index and skipping the code that builds
// it, these helpers serve a fixture over a stubbed fetch and let the real
// loaders run.

import { RATINGS, RATING_COURSES, SEATS_INDEX, SEATS_TERMS, TREND } from "./fixtures.js";

/**
 * Swap in a fetch that serves fixtures by URL. Returns a restore function.
 *
 * `routes` is a URL-keyed map of JSON bodies, or a function returning a whole
 * Response-like object, which is what the seat snapshotter's tests need: text
 * bodies and the 403s and 404s Barrett really answers with.
 *
 * Pass a Map or a list of pairs to key a route on a RegExp or a predicate
 * instead. The API calls carry query strings that vary with the search, so an
 * exact URL cannot name them at all.
 */
export function stubFetch(routes) {
  const original = globalThis.fetch;
  const serve = typeof routes === "function" ? routes : byRoute(routes);
  globalThis.fetch = async (url) => serve(String(url));
  return () => { globalThis.fetch = original; };
}

/**
 * Exact keys win over patterns whatever order they were written in, so one
 * named URL can always be pinned out of a pattern that would swallow it.
 */
function byRoute(routes) {
  const entries = routes instanceof Map ? [...routes]
    : Array.isArray(routes) ? routes
    : Object.entries(routes);
  const exact = new Map(entries.filter(([key]) => typeof key === "string"));
  const patterns = entries.filter(([key]) => typeof key !== "string");

  return (url) => {
    if (exact.has(url)) return answer(exact.get(url), url);
    for (const [key, value] of patterns) {
      if (key instanceof RegExp) key.lastIndex = 0; // a /g route would match every other call
      if (key instanceof RegExp ? key.test(url) : key(url)) return answer(value, url);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

/**
 * A route answers with a JSON body. A function computes that body from the URL,
 * which is how a test serves page 2 differently from page 1, and anything
 * carrying `ok` is taken as the whole response, so a route can fail.
 */
function answer(value, url) {
  const body = typeof value === "function" ? value(url) : value;
  if (body && typeof body === "object" && "ok" in body) return body;
  return { ok: true, status: 200, json: async () => body };
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

/**
 * Load trends into a module instance. A term the fixture does not name is left
 * unloaded, which reads the same as a term that has no trend file: nothing.
 */
export async function withTrend(terms = ["1268"], suffix = "", data = TREND) {
  const mod = await import(`../js/trend.js${suffix}`);
  const routes = {};
  for (const [term, trend] of Object.entries(data)) routes[`trend-${term}.json`] = trend;
  const restore = stubFetch(routes);
  try {
    for (const term of terms) await mod.loadTrend(term, "");
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

/**
 * Add the course-code snapshot to an instance that already has ratings. Separate
 * because the site fetches it separately, and the pane renders before it lands.
 */
export async function withRatingCourses(mod, data = RATING_COURSES) {
  const restore = stubFetch({ "ratings-courses.json": data });
  try {
    await mod.loadRatingCourses("ratings-courses.json");
  } finally {
    restore();
  }
  return mod;
}

/**
 * Reader for the declarations a stylesheet makes about a selector, keyed by
 * property. Several rules can name one selector, so they are merged in source
 * order the way the cascade would at equal specificity.
 *
 * A rule inside a media or container block is not reachable from the whole
 * sheet, since the block's own prelude reads as the selector. Pass the inside
 * of that block as `source` to read those.
 */
export function cssRules(source, where = "the stylesheet") {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = css.split("}")
    .filter((block) => block.includes("{"))
    .map((block) => ({
      selectors: block.slice(0, block.indexOf("{")).split(",").map((s) => s.trim()),
      body: block.slice(block.indexOf("{") + 1),
    }));

  return function rule(selector) {
    const matching = rules.filter((r) => r.selectors.includes(selector));
    if (!matching.length) throw new Error(`no ${selector} rule in ${where}`);
    return Object.fromEntries(matching.flatMap((r) => r.body
      .split(";")
      .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()])
      .filter(([prop, value]) => prop && value)));
  };
}
