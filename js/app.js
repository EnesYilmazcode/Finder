import { fetchTerms, defaultTerm, searchAllPages, ApiError } from "./api.js";
import { filterCourses } from "./rank.js";
import { renderResults } from "./render.js";
import { loadRatings } from "./ratings.js";
import { loadSeats, seatsTerm, seatsUpdated } from "./seats.js";
import { renderDetail } from "./detail.js";

const els = {
  app: document.querySelector(".app"),
  form: document.querySelector("#search"),
  rail: document.querySelector("#rail"),
  railToggle: document.querySelector("#rail-toggle"),
  detail: document.querySelector("#detail"),
  detailBody: document.querySelector("#detail-body"),
  detailBack: document.querySelector("#detail-back"),
  query: document.querySelector("#q"),
  term: document.querySelector("#term"),
  submit: document.querySelector("#go"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
};

let terms = [];
let latestRequest = 0;

// Class number to its section and course, rebuilt on every render. The detail
// pane needs the real objects, not text scraped back out of the DOM.
let sectionIndex = new Map();
let currentEntries = [];

/**
 * True while the layout is collapsed to one column. Matches the CSS breakpoint,
 * which is the only place the number should really live, so it is read from a
 * media query rather than duplicated as a magic width.
 */
const collapsed = window.matchMedia("(max-width: 64rem)");

function openRail(open) {
  els.app.dataset.rail = open ? "open" : "closed";
  els.railToggle.setAttribute("aria-expanded", String(open));
}

/**
 * Show a section in the detail pane.
 *
 * On desktop the pane is always visible, so this only swaps content. Collapsed,
 * it takes over the screen and focus moves with it, otherwise a keyboard user
 * is left on a control that is no longer on screen.
 */
function showDetail(node) {
  els.detailBody.replaceChildren(node);
  if (collapsed.matches) {
    els.app.dataset.view = "detail";
    els.detail.focus();
  }
}

function resetDetail() {
  els.detailBody.replaceChildren(
    Object.assign(document.createElement("p"), {
      className: "detail-idle",
      textContent: "Pick a section to see the instructor, seats and room.",
    })
  );
}

function selectSection(row) {
  const found = sectionIndex.get(row.dataset.classNumber);
  if (!found) return;

  for (const other of els.results.querySelectorAll(".section.is-selected")) {
    other.classList.remove("is-selected");
    other.removeAttribute("aria-current");
  }
  row.classList.add("is-selected");
  // Selection is state, not just colour, so it is exposed rather than implied.
  row.setAttribute("aria-current", "true");

  showDetail(renderDetail({ ...found, term: els.term.value, entries: currentEntries, formatDate }));
}

function closeDetail() {
  els.app.dataset.view = "results";
  els.results.focus();
}

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
      loadSeats().catch(() => null),
    ]);
    if (requestId !== latestRequest) return; // a newer search already answered
    const { primary, related } = filterCourses(courses, q);
    currentEntries = [...primary, ...related];
    sectionIndex = new Map();
    for (const entry of currentEntries) {
      for (const section of entry.sections) {
        sectionIndex.set(String(section.classNumber), { section, course: entry.course });
      }
    }
    renderResults(els.results, { primary, related }, term);
    resetDetail();
    if (!primary.length) {
      setStatus(`Nothing matched "${q}" in ${termName(term)}. Try a subject and number, like CSE 2221.`);
    } else {
      const sections = primary.reduce((n, e) => n + e.sections.length, 0);
      const noun = primary.length === 1 ? "course" : "courses";
      // Barrett refreshes once a day, so the numbers are dated, and during a
      // registration window that distinction matters.
      const dated = seatsTerm() === term && seatsUpdated() ? ` Seats as of ${formatDate(seatsUpdated())}.` : "";
      setStatus(`${primary.length} ${noun}, ${sections} sections in ${termName(term)}.${dated}`);
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

function formatDate(iso) {
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function termName(code) {
  return terms.find((t) => t.code === code)?.name ?? code;
}

async function init() {
  // Start the ratings download early so the first search rarely waits on it.
  loadRatings().catch((error) => console.warn("ratings unavailable", error));
  loadSeats().catch((error) => console.warn("seats unavailable", error));

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

  els.railToggle.addEventListener("click", () => {
    openRail(els.app.dataset.rail !== "open");
  });

  els.detailBack.addEventListener("click", closeDetail);

  // Returning to a wide layout must not leave the results hidden behind a
  // detail view that no longer takes over the screen.
  collapsed.addEventListener("change", (event) => {
    if (!event.matches) els.app.dataset.view = "results";
  });

  // Selecting a section is delegated, so results can re-render freely.
  els.results.addEventListener("click", (event) => {
    const row = event.target.closest(".section");
    if (row && !event.target.closest("a")) selectSection(row);
  });

  els.results.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".section");
    if (!row || event.target.closest("a")) return;
    event.preventDefault(); // Space would otherwise scroll the results pane
    selectSection(row);
  });

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
