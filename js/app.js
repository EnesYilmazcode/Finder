import { fetchTerms, defaultTerm, searchAllPages, ApiError } from "./api.js";
import { rankCourses } from "./rank.js";
import { renderResults } from "./render.js";

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

function setStatus(message, kind = "info") {
  els.status.textContent = message ?? "";
  els.status.dataset.kind = kind;
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
  els.submit.disabled = true;
  setStatus("Searching...");
  try {
    const { courses, totalPages, pagesFetched } = await searchAllPages({ q, term });
    if (requestId !== latestRequest) return; // a newer search already answered
    const ranked = rankCourses(courses, q);
    renderResults(els.results, ranked);
    if (!ranked.length) {
      setStatus(`Nothing matched "${q}" in ${termName(term)}. Try a subject and number, like CSE 2221.`);
    } else {
      const sections = ranked.reduce((n, e) => n + e.sections.length, 0);
      const truncated = totalPages > pagesFetched;
      setStatus(
        `Showing ${ranked.length} course${ranked.length === 1 ? "" : "s"}, ${sections} sections in ${termName(term)}` +
          (truncated ? ". Narrow the search to see more." : ".")
      );
    }
  } catch (error) {
    if (requestId !== latestRequest) return;
    els.results.replaceChildren();
    setStatus(error instanceof ApiError ? error.message : "Something went wrong. Try again.", "error");
    if (!(error instanceof ApiError)) console.error(error);
  } finally {
    if (requestId === latestRequest) els.submit.disabled = false;
  }
}

function termName(code) {
  return terms.find((t) => t.code === code)?.name ?? code;
}

async function init() {
  const params = new URLSearchParams(location.search);
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
