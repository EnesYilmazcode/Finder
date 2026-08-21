import test from "node:test";
import assert from "node:assert/strict";

import { RATINGS, SEATS_INDEX, SEATS_TERMS } from "./fixtures.js";

// app.js runs init() the moment it is imported, so the only way to check what
// startup waits on is to give it a DOM to start against. Everything stubbed
// below exists because init touches it on a first visit with no query.

const TERMS_URL = "https://content.osu.edu/v2/classes/searchableTermsV2";

function makeEl() {
  return {
    dataset: {},
    children: [],
    value: "",
    checked: false,
    disabled: false,
    hidden: true,
    textContent: "",
    addEventListener() {},
    setAttribute() {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    querySelectorAll() { return []; },
  };
}

function makeDom() {
  const selectors = [
    ".app", "#search", "#rail", "#rail-toggle", "#detail", "#detail-body", "#detail-back",
    "#filters", "#f-days", "#p-subject", "#p-number", "#subject-list", "#number-list",
    "#p-hint", "#welcome", "#w-stats", "#w-sub", "#w-list", "#view-list", "#view-cal",
    "#f-clear", "#q", "#term", "#go", "#status", "#results",
  ];
  const nodes = new Map(selectors.map((sel) => [sel, makeEl()]));
  // writeFilters reaches the controls by name off the form.
  const filters = nodes.get("#filters");
  for (const name of ["from", "to", "rating", "hideFull", "hideOnline", "ratedOnly"]) {
    filters[name] = makeEl();
  }
  return {
    querySelector: (sel) => nodes.get(sel) ?? null,
    createElement: () => makeEl(),
    node: (sel) => nodes.get(sel),
  };
}

/** Poll rather than sleep a fixed time, so a passing run costs a tick. */
async function waitFor(check, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

// Restored so a second test added here starts from a real environment. It will
// still need a fresh js/app.js too, since init only runs on first import.
const saved = Object.fromEntries(
  ["document", "window", "location", "history", "fetch"].map((key) => [key, globalThis[key]])
);
test.after(() => { Object.assign(globalThis, saved); });

test("the welcome screen paints without waiting for the term's seats", async () => {
  const dom = makeDom();
  globalThis.document = dom;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
  globalThis.location = { search: "", href: "https://example.com/" };
  globalThis.history = { replaceState() {} };

  const requested = [];
  let releaseTermSeats;
  const termSeats = new Promise((resolve) => { releaseTermSeats = resolve; });

  globalThis.fetch = async (url) => {
    const key = String(url);
    requested.push(key);
    const body =
      key.startsWith(TERMS_URL) ? { data: { data: [{ strm: "1268", descr: "Autumn 2026" }] } } :
      key === "data/ratings.json" ? RATINGS :
      key === "data/seats.json" ? SEATS_INDEX :
      key === "data/seats-1268.json" ? await termSeats.then(() => SEATS_TERMS["1268"]) :
      null;
    if (!body) throw new Error(`unexpected fetch: ${key}`);
    return { ok: true, status: 200, json: async () => body };
  };

  await import("../js/app.js");

  const stats = dom.node("#w-stats");
  const painted = await waitFor(() => stats.textContent !== "");
  assert.ok(painted, `welcome never painted; fetched ${requested.join(", ")}`);

  // The stats line comes from the index, so the section count is still there.
  // The date after it is locale-formatted, so it is left unpinned.
  assert.ok(stats.textContent.startsWith("Autumn 2026 · 7 sections · seats as of "),
    `stats line degraded to: ${stats.textContent}`);
  assert.equal(dom.node("#welcome").hidden, false);
  assert.ok(dom.node("#w-list").children.length > 0);

  // The term's seats still get fetched, so the first search does not pay for them.
  assert.ok(await waitFor(() => requested.includes("data/seats-1268.json")),
    `term seats never fetched; fetched ${requested.join(", ")}`);
  releaseTermSeats();
});
