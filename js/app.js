import { fetchTerms, defaultTerm, searchAllPages, ApiError } from "./api.js";
import { filterCourses } from "./rank.js";
import { renderResults } from "./render.js";
import { loadRatings } from "./ratings.js";

const els = {
  form: document.querySelector("#search"),
  query: document.querySelector("#q"),
  term: document.querySelector("#term"),
  submit: document.querySelector("#go"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
};

let terms = [];
let latestRequest = 0;

// The status element is never removed or hidden, only its text changes. A live
// region that was hidden when content arrived usually goes unannounced.
function setStatus(message, kind = "info") {
  els.status.textContent = message ?? "";
  els.status.dataset.kind = kind;
}

// aria-disabled, not the disabled property: searching by pressing Enter leaves
// focus on the button, and disabling it would throw that focus back to the body.
function setBusy(busy) {
  els.submit.setAttribute("aria-disabled", String(busy));
  els.results.setAttribute("aria-busy", String(busy));
}

function syncUrl(q, term) {
  const url = new URL(location.href);
  if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
  if (term) url.searchParams.set("term", term);
  history.replaceState(null, "", url);
}

async function runSearch(q, term) {
  if (!q.trim()) {
    els.results.replaceChildren();
    setStatus("Type a course like CSE 2221, or a professor's name.");
    return;
  }

  const requestId = ++latestRequest;
  setBusy(true);
  setStatus("Searching...");
  try {
    // Ratings must be in hand before rendering, or instructors draw unrated and
    // never redraw. Awaited alongside the search rather than before it, so the
    // cost is the slower of the two and only on the first search.
    const [{ courses }] = await Promise.all([
      searchAllPages({ q, term }),
      loadRatings().catch(() => null),
    ]);
    if (requestId !== latestRequest) return; // a newer search already answered
    const { primary, related } = filterCourses(courses, q);
    renderResults(els.results, { primary, related });
    if (!primary.length) {
      setStatus(`Nothing matched "${q}" in ${termName(term)}. Try a subject and number, like CSE 2221.`);
    } else {
      const sections = primary.reduce((n, e) => n + e.sections.length, 0);
      const noun = primary.length === 1 ? "course" : "courses";
      setStatus(`${primary.length} ${noun}, ${sections} sections in ${termName(term)}.`);
    }
  } catch (error) {
    if (requestId !== latestRequest) return;
    els.results.replaceChildren();
    setStatus(error instanceof ApiError ? error.message : "Something went wrong. Try again.", "error");
    if (!(error instanceof ApiError)) console.error(error);
  } finally {
    if (requestId === latestRequest) setBusy(false);
  }
}

function termName(code) {
  return terms.find((t) => t.code === code)?.name ?? code;
}

async function init() {
  // Start the ratings download early so the first search rarely waits on it.
  loadRatings().catch((error) => console.warn("ratings unavailable", error));

  const params = new URLSearchParams(location.search);
  setBusy(false);
  setStatus("Loading terms...");
  els.term.disabled = true;

  try {
    terms = await fetchTerms();
  } catch (error) {
    setStatus(error instanceof ApiError ? error.message : "Could not load terms.", "error");
    return;
  }

  if (!terms.length) {
    setStatus("Ohio State is not listing any searchable terms right now.", "error");
    return;
  }

  els.term.replaceChildren(
    ...terms.map((t) => {
      const option = document.createElement("option");
      option.value = t.code;
      option.textContent = t.name;
      return option;
    })
  );
  const wanted = params.get("term");
  els.term.value = terms.some((t) => t.code === wanted) ? wanted : defaultTerm(terms).code;
  els.term.disabled = false;

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (els.submit.getAttribute("aria-disabled") === "true") return;
    const q = els.query.value;
    syncUrl(q, els.term.value);
    runSearch(q, els.term.value);
  });

  els.term.addEventListener("change", () => {
    syncUrl(els.query.value, els.term.value);
    if (els.query.value.trim()) runSearch(els.query.value, els.term.value);
  });

  const initialQuery = params.get("q") ?? "";
  els.query.value = initialQuery;
  if (initialQuery.trim()) runSearch(initialQuery, els.term.value);
  else setStatus("Type a course like CSE 2221, or a professor's name.");
}

init();
