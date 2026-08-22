// The one section a link can point at.
//
// Lives outside app.js so the rules a shared link depends on can be tested
// without a document.

// A class number and nothing else. Anything else came from a mangled link and
// must not be quoted back into the page.
const CLASS_NUMBER = /^\d{1,6}$/;

/** The section a link asks for, or "" when it does not ask for one. */
export function classFromParams(params) {
  const raw = (params.get("class") ?? "").trim();
  return CLASS_NUMBER.test(raw) ? raw : "";
}

/** Point a URL at one section, or at none. Mutates and returns the URL. */
export function setClassParam(url, classNumber) {
  const wanted = String(classNumber ?? "").trim();
  if (CLASS_NUMBER.test(wanted)) url.searchParams.set("class", wanted);
  else url.searchParams.delete("class");
  return url;
}

/**
 * Does this URL still describe the search being run? The section a link names
 * belongs to the search it arrived with, so a retry after an error keeps it and
 * a search for anything else drops it. A link that names no term rides on
 * whichever term the page picked.
 */
export function sameSearch(url, q, term) {
  const was = url.searchParams.get("term");
  return (url.searchParams.get("q") ?? "") === q && (was === null || was === term);
}

/** Is this class number anywhere in these entries? */
export function hasSection(entries, classNumber) {
  return (entries ?? []).some((entry) =>
    (entry.sections ?? []).some((section) => String(section.classNumber) === String(classNumber)));
}

/**
 * Why a link did not land, and what would fix it. Three different answers: the
 * section is in the results but the calendar does not plot it, the filters
 * removed it, or it is not in the search at all. Only the first two are one
 * click from being fixed, and only the third is worth a guess at why.
 */
export function missOutcome(classNumber, { inResults, inSearch }) {
  if (inResults) return { message: `Section ${classNumber} is not on the grid.`, offer: "list" };
  if (inSearch) return { message: `Section ${classNumber} is hidden by your filters.`, offer: "filters" };
  return {
    message: `Section ${classNumber} is not in these results. It may belong to another term, or the search may not have returned it.`,
    offer: "",
  };
}
