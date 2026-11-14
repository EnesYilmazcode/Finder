// What a link carries: the whole page state in the address bar, and the one
// section it can point at.
//
// Lives outside app.js so the rules a shared link depends on can be tested
// without a document.
//
// decodeUrl and encodeUrl are the only way the address bar is read and written.
// Everything a link can carry is named once below: the search, the filters, the
// saved plan and the open section. The codec moves strings and does not judge
// them: whether a sort key, a requirement or a class number is valid stays with
// the code that owns that rule. Parameters it does not know are left in place,
// so a tracking tag on a shared link survives.

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

/** The on/off filters, written as `key=1` when on and left out when off. */
export const FLAG_KEYS = ["hideFull", "hideOnline", "ratedOnly", "hideConsent", "undergradOnly"];

// Every key the codec owns, in the order encodeUrl writes them.
const SINGLE_KEYS = ["q", "person", "term", "plan", "gen"];
const LIST_KEYS = { days: "day", avoid: "noday", busy: "busy" };
const FILTER_VALUE_KEYS = ["from", "to", "rating", "sort"];
const OWNED = [...SINGLE_KEYS, ...Object.values(LIST_KEYS), ...FILTER_VALUE_KEYS, ...FLAG_KEYS, "class"];

/**
 * Plain values from a query string. Absent single values are "", absent lists
 * are [], absent flags are false, so a decoded state always has every field.
 */
export function decodeUrl(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? "");
  const one = (key) => params.get(key) ?? "";
  const filters = {};
  for (const [field, key] of Object.entries(LIST_KEYS)) filters[field] = params.getAll(key);
  for (const key of FILTER_VALUE_KEYS) filters[key] = one(key);
  for (const key of FLAG_KEYS) filters[key] = params.get(key) === "1";
  return {
    q: one("q"),
    person: one("person"),
    term: one("term"),
    plan: one("plan"),
    gen: one("gen"),
    filters,
    classNumber: one("class"),
  };
}

/**
 * Write a state onto a URL and return the new URL. Every owned key is cleared
 * first and written back only when it has a value, so a state field left empty
 * leaves no `key=` behind. `base` supplies the path and any foreign parameters.
 */
export function encodeUrl(state, base) {
  const url = new URL(base);
  for (const key of OWNED) url.searchParams.delete(key);
  const put = (key, value) => { if (value) url.searchParams.append(key, String(value)); };

  for (const key of SINGLE_KEYS) put(key, state?.[key]);
  const filters = state?.filters ?? {};
  for (const [field, key] of Object.entries(LIST_KEYS)) {
    for (const value of filters[field] ?? []) put(key, value);
  }
  for (const key of FILTER_VALUE_KEYS) put(key, filters[key]);
  for (const key of FLAG_KEYS) if (filters[key]) url.searchParams.append(key, "1");
  put("class", state?.classNumber);
  return url;
}

/**
 * What makes two states the same search: the query, the person it was narrowed
 * to, the term and the requirement. Filters, the plan and the open section are
 * views of one search, so changing them is not a new place to go Back to.
 */
export function searchKey(state) {
  return [state?.q?.trim() ?? "", state?.person ?? "", state?.term ?? "", state?.gen ?? ""].join("|");
}
