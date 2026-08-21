// Barrett and the term list served from memory, for the tests that exercise
// scripts/fetch-seats.mjs. Nothing here touches the network.
//
// The subject files come from the shared barrettFile builder, so this only has
// to say which subjects misbehave and how.

import { stubFetch } from "./helpers.js";
import { barrettFile } from "./fixtures.js";

const BASE = "https://www.asc.ohio-state.edu/barrett.3/schedule";
const API = "https://content.osu.edu/v2/classes";

// Class numbers carry the subject, so a snapshot says which subject each
// section came from: SUBJ07's rows are 10700 up.
const rows = (subject, count) =>
  Array.from({ length: count }, (_, i) => ({
    catalog: `${1110 + i}`,
    classNumber: `${10000 + Number(subject.slice(4)) * 100 + i}`,
    days: "MWF",
    time: "0800A",
    room: "ONLINE",
    enrolled: 26 + i,
    limit: 40,
    instructor: "M.Mallon",
  }));

// A real Response always carries headers, and fetchText reads Retry-After off
// the not-ok path, so leaving them out would test a shape fetch never returns.
const headers = { get: () => null };
const ok = (body) => ({ ok: true, status: 200, statusText: "OK", headers, text: async () => body });
const bad = (status, statusText) => ({ ok: false, status, statusText, headers, text: async () => "" });

/**
 * Stub globalThis.fetch for one scenario and return a restore function.
 *
 * `published` names the terms Barrett actually serves; the rest 404 the way an
 * unpublished term does, and one in `draft` is served with the pre-publication
 * banner every subject file of an unpublished term carries. A subject in
 * `failing` 403s, which fetchText treats as fatal, one in `mislabelled` returns
 * a file stamped with the wrong term, and one in `layoutBroken` returns a file
 * with no column header.
 */
export function install({
  subjects = [],
  searchable = [],
  published = [],
  draft = [],
  failing = [],
  mislabelled = [],
  layoutBroken = [],
  sections = 4,
} = {}) {
  return stubFetch((href) => {
    if (href === `${API}/searchableTermsV2`) {
      return ok(JSON.stringify({ data: { data: searchable.map((strm) => ({ strm, classSearch: "Y" })) } }));
    }
    if (href === `${BASE}/`) return ok(subjects.map((s) => `<a href="${s}">${s}</a>`).join("\n"));

    const [subject, file] = href.slice(BASE.length + 1).split("/");
    const term = file.replace(".txt", "");
    if (failing.includes(subject)) return bad(403, "Forbidden");
    if (!published.includes(term)) return bad(404, "Not Found");
    return ok(barrettFile(
      subject,
      mislabelled.includes(subject) ? "1264" : term,
      rows(subject, sections),
      { draft: draft.includes(term), ...(layoutBroken.includes(subject) ? { columns: null } : {}) }
    ));
  });
}

// Loaded with --import when a test spawns the real script, where the
// environment is the only channel into the child.
if (process.env.BARRETT_MOCK) install(JSON.parse(process.env.BARRETT_MOCK));
