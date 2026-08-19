import { fetchTerms, defaultTerm, searchAllPages, ApiError } from "./api.js";
import { filterCourses } from "./rank.js";
import { renderResults } from "./render.js";
import { loadRatings } from "./ratings.js";
import { loadSeats, seatsTerm, seatsUpdated } from "./seats.js";
import { renderDetail } from "./detail.js";
import { applyFilters, isActive, DEFAULTS } from "./filters.js";

const els = {
  app: document.querySelector(".app"),
  form: document.querySelector("#search"),
  rail: document.querySelector("#rail"),
  railToggle: document.querySelector("#rail-toggle"),
  detail: document.querySelector("#detail"),
  detailBody: document.querySelector("#detail-body"),
  detailBack: document.querySelector("#detail-back"),
  filters: document.querySelector("#filters"),
  clear: document.querySelector("#f-clear"),
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
// The unfiltered result of the last search, so changing a filter re-renders
// rather than refetching.
let lastResult = null;
let showHidden = false;

function readFilters() {
  const data = new FormData(els.filters);
  return {
    ...DEFAULTS,
    days: data.getAll("day"),
    from: data.get("from") ?? "",
    to: data.get("to") ?? "",
    rating: data.get("rating") ?? "",
    hideFull: els.filters.hideFull.checked,
    hideOnline: els.filters.hideOnline.checked,
    ratedOnly: els.filters.ratedOnly.checked,
    term: els.term.value,
  };
}

function writeFilters(params) {
  for (const box of els.filters.querySelectorAll('input[name="day"]')) {
    box.checked = params.getAll("day").includes(box.value);
  }
  els.filters.from.value = params.get("from") ?? "";
  els.filters.to.value = params.get("to") ?? "";
  els.filters.rating.value = params.get("rating") ?? "";
  els.filters.hideFull.checked = params.get("hideFull") === "1";
  els.filters.hideOnline.checked = params.get("hideOnline") === "1";
  els.filters.ratedOnly.checked = params.get("ratedOnly") === "1";
}

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

  // Filters live in the URL so a filtered view can be shared or reloaded.
  const f = readFilters();
  url.searchParams.delete("day");
  for (const day of f.days) url.searchParams.append("day", day);
  for (const [key, value] of [["from", f.from], ["to", f.to], ["rating", f.rating]]) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  for (const key of ["hideFull", "hideOnline", "ratedOnly"]) {
    if (f[key]) url.searchParams.set(key, "1"); else url.searchParams.delete(key);
  }
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
    lastResult = filterCourses(courses, q);
    showHidden = false;
    paint(term);
  } catch (error) {
    if (requestId !== latestRequest) return;
    els.results.replaceChildren();
    setStatus(error instanceof ApiError ? error.message : "Something went wrong. Try again.", "error");
    if (!(error instanceof ApiError)) console.error(error);
  } finally {
    if (requestId === latestRequest) setBusy(false);
  }
}

/** Re-render from the last search. Filters never refetch. */
function paint(term = els.term.value) {
  if (!lastResult) return;
  const filters = readFilters();
  const active = isActive(filters);
  els.clear.hidden = !active;

  const blank = { entries: [], hiddenSections: 0, hiddenCourses: 0 };
  const p = showHidden ? { ...blank, entries: lastResult.primary } : applyFilters(lastResult.primary, filters);
  const r = showHidden ? { ...blank, entries: lastResult.related } : applyFilters(lastResult.related, filters);

  const primary = p.entries;
  const related = r.entries;
  // Count what the filters removed from everything on the page, not just from
  // the primary results, or the note understates its own effect.
  const hiddenSections = p.hiddenSections + r.hiddenSections;
  const hiddenCourses = p.hiddenCourses + r.hiddenCourses;

    currentEntries = [...primary, ...related];
    sectionIndex = new Map();
    for (const entry of currentEntries) {
      for (const section of entry.sections) {
        sectionIndex.set(String(section.classNumber), { section, course: entry.course });
      }
    }
  renderResults(els.results, { primary, related }, term);
  resetDetail();

  if (hiddenSections || hiddenCourses) {
    // Never hide silently. Say what was removed and offer it back.
    const note = document.createElement("p");
    note.className = "hidden-note";
    const parts = [];
    if (hiddenSections) parts.push(`${hiddenSections} section${hiddenSections === 1 ? "" : "s"}`);
    if (hiddenCourses) parts.push(`${hiddenCourses} course${hiddenCourses === 1 ? "" : "s"}`);
    note.append(document.createTextNode(`${parts.join(" and ")} hidden by your filters. `));
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Show them anyway";
    button.addEventListener("click", () => { showHidden = true; paint(term); });
    note.append(button);
    els.results.append(note);
  }

  if (!primary.length) {
    // Careful not to claim everything went when related courses may still be
    // on screen underneath this message.
    setStatus(
      isActive(filters)
        ? `No sections match your filters in ${termName(term)}. Loosen one, or clear them.`
        : `Nothing matched in ${termName(term)}. Try a subject and number, like CSE 2221.`
    );
    return;
  }

  const sections = primary.reduce((n, e) => n + e.sections.length, 0);
  const noun = primary.length === 1 ? "course" : "courses";
  // Barrett refreshes once a day, so the numbers are dated, and during a
  // registration window that distinction matters.
  const dated = seatsTerm() === term && seatsUpdated() ? ` Seats as of ${formatDate(seatsUpdated())}.` : "";
  setStatus(`${primary.length} ${noun}, ${sections} sections in ${termName(term)}.${dated}`);
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

  writeFilters(params);

  els.filters.addEventListener("change", () => {
    showHidden = false;
    syncUrl(els.query.value, els.term.value);
    paint();
  });

  els.clear.addEventListener("click", () => {
    els.filters.reset();
    showHidden = false;
    syncUrl(els.query.value, els.term.value);
    paint();
  });

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
