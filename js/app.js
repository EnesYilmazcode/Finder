import { fetchTerms, defaultTerm, searchAllPages, ApiError } from "./api.js";
import { filterCourses, parseQuery } from "./rank.js";
import { renderResults } from "./render.js";
import { loadRatings, loadRatingCourses, topRated, ratedCount, profileUrl, ratingsFailed } from "./ratings.js";
import { loadSeats, seatsTerm, seatsUpdated, seatsSectionCount, seatsFailed } from "./seats.js";
import { loadTrend } from "./trend.js";
import { renderDetail } from "./detail.js";
import { applyFilters, isActive, DEFAULTS } from "./filters.js";
import { renderCalendar } from "./calendar.js";
import { formatCoverage } from "./format.js";
import { loadCourses, subjectsFor, subjectLabel, coursesFor, codeFromInput, isLoaded } from "./courses.js";

const els = {
  app: document.querySelector(".app"),
  form: document.querySelector("#search"),
  rail: document.querySelector("#rail"),
  railToggle: document.querySelector("#rail-toggle"),
  detail: document.querySelector("#detail"),
  detailBody: document.querySelector("#detail-body"),
  detailBack: document.querySelector("#detail-back"),
  filters: document.querySelector("#filters"),
  days: document.querySelector("#f-days"),
  subject: document.querySelector("#p-subject"),
  number: document.querySelector("#p-number"),
  subjectList: document.querySelector("#subject-list"),
  numberList: document.querySelector("#number-list"),
  hint: document.querySelector("#p-hint"),
  welcome: document.querySelector("#welcome"),
  wStats: document.querySelector("#w-stats"),
  wSub: document.querySelector("#w-sub"),
  wList: document.querySelector("#w-list"),
  viewList: document.querySelector("#view-list"),
  viewCal: document.querySelector("#view-cal"),
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
let view = "list";
let courseCodesTried = false;

function dayStates() {
  const required = [];
  const avoided = [];
  for (const button of els.days.querySelectorAll(".f-day")) {
    if (button.dataset.state === "require") required.push(button.dataset.day);
    else if (button.dataset.state === "avoid") avoided.push(button.dataset.day);
  }
  return { required, avoided };
}

const DAY_LABELS = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday",
};

const NEXT_STATE = { any: "require", require: "avoid", avoid: "any" };

/** Tri-state, so one control expresses both "must meet" and "must not meet". */
function setDayState(button, state) {
  button.dataset.state = state;
  const day = DAY_LABELS[button.dataset.day] ?? button.dataset.day;
  const said = state === "require" ? "required" : state === "avoid" ? "avoided" : "any";
  // Deliberately no aria-pressed. It is a boolean and this control has three
  // states, so "required" and "avoided" both came out as pressed=true and the
  // one that mattered was announced as the other. The state lives in the name.
  button.setAttribute("aria-label", `${day}: ${said}`);
}

function readFilters() {
  const data = new FormData(els.filters);
  const { required, avoided } = dayStates();
  return {
    ...DEFAULTS,
    days: required,
    avoid: avoided,
    from: data.get("from") ?? "",
    to: data.get("to") ?? "",
    rating: els.filters.rating.value,
    hideFull: els.filters.hideFull.checked,
    hideOnline: els.filters.hideOnline.checked,
    ratedOnly: els.filters.ratedOnly.checked,
    term: els.term.value,
  };
}

function writeFilters(params) {
  const required = params.getAll("day");
  const avoided = params.getAll("noday");
  for (const button of els.days.querySelectorAll(".f-day")) {
    const day = button.dataset.day;
    setDayState(button, required.includes(day) ? "require" : avoided.includes(day) ? "avoid" : "any");
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

/**
 * Fill the subject list. Called on first focus rather than at startup, since
 * the index is 177 KB gzipped and nobody needs it until they open a picker.
 */
async function ensureCourses() {
  if (isLoaded()) return true;
  els.hint.textContent = "Loading the course list...";
  try {
    await loadCourses();
  } catch {
    els.hint.textContent = "Could not load the course list. The search box still works.";
    return false;
  }
  fillSubjects();
  els.hint.textContent = "Pick a subject to browse its courses. You can still type a course or a professor in the search box.";
  return true;
}

function fillSubjects() {
  const subjects = subjectsFor(els.term.value);
  els.subjectList.replaceChildren(
    ...subjects.map((subject) => {
      const option = document.createElement("option");
      option.value = subjectLabel(subject);
      return option;
    })
  );
}

function fillNumbers() {
  const code = codeFromInput(els.subject.value);
  const courses = coursesFor(els.term.value, code);
  els.number.disabled = !courses.length;
  els.numberList.replaceChildren(
    ...courses.map((course) => {
      const option = document.createElement("option");
      // The value is what lands in the field, so it stays a bare number the
      // search can use. The title rides along as the visible hint.
      option.value = course.number;
      option.label = course.title;
      option.textContent = course.title;
      return option;
    })
  );
  if (!courses.length) els.number.value = "";
  return courses;
}

/**
 * Reflect a query back into the pickers.
 *
 * Deliberately does not touch the course index: a subject and number are
 * parseable from the query itself, so a shared link fills the rail without
 * pulling the 177 KB index that #36 made lazy. The dropdown options still
 * arrive on first focus.
 */
function reflectQuery(q) {
  const parsed = parseQuery(q);
  // A query only maps onto the pickers when it names both. "Bucci" and bare
  // "CSE" are searches, not course selections, and should leave them empty.
  if (!parsed.subject || !parsed.number) {
    els.subject.value = "";
    els.number.value = "";
    els.number.disabled = true;
    return;
  }
  els.subject.value = parsed.subject;
  els.number.value = parsed.number;
  els.number.disabled = false;
}

/** A picked subject and number becomes an ordinary search. */
function searchFromPickers() {
  const code = codeFromInput(els.subject.value);
  if (!code) return;
  const number = els.number.value.trim();
  const q = number ? `${code} ${number}` : code;
  els.query.value = q;
  syncUrl(q, els.term.value);
  runSearch(q, els.term.value);
}

function setView(next) {
  view = next;
  for (const [button, name] of [[els.viewList, "list"], [els.viewCal, "calendar"]]) {
    button.classList.toggle("is-on", name === next);
    button.setAttribute("aria-pressed", String(name === next));
  }
  paint();
}

function selectSection(row) {
  const found = sectionIndex.get(row.dataset.classNumber);
  if (!found) return;

  for (const other of els.results.querySelectorAll(".is-selected")) {
    other.classList.remove("is-selected");
    other.removeAttribute("aria-current");
  }
  row.classList.add("is-selected");
  // Selection is state, not just colour, so it is exposed rather than implied.
  row.setAttribute("aria-current", "true");

  const draw = () => renderDetail({ ...found, term: els.term.value, entries: currentEntries, formatDate });
  showDetail(draw());

  // The course codes behind "52 of 147 ratings are for CSE 2221" are their own file,
  // fetched on the first section opened instead of at startup. Redrawing the body
  // rather than calling showDetail again leaves focus where it is. One attempt per
  // page load either way, because a missing snapshot will not appear on the next click.
  if (courseCodesTried) return;
  const opened = row.dataset.classNumber;
  loadRatingCourses()
    .then(() => {
      if (opened === els.results.querySelector(".is-selected")?.dataset.classNumber) {
        els.detailBody.replaceChildren(draw());
      }
    })
    .catch((error) => console.warn("rating course codes unavailable", error))
    .finally(() => { courseCodesTried = true; });
}

function closeDetail() {
  els.app.dataset.view = "results";
  // Back to the row that opened the pane where possible, so a keyboard user
  // resumes where they left off instead of at the top of the results.
  const selected = els.results.querySelector(".is-selected");
  (selected ?? els.results).focus();
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
  url.searchParams.delete("noday");
  for (const day of f.days) url.searchParams.append("day", day);
  for (const day of f.avoid) url.searchParams.append("noday", day);
  for (const [key, value] of [["from", f.from], ["to", f.to], ["rating", f.rating]]) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  for (const key of ["hideFull", "hideOnline", "ratedOnly"]) {
    if (f[key]) url.searchParams.set(key, "1"); else url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);
}

/**
 * The landing screen. Everything here comes from snapshots already in memory,
 * so it costs no extra request and never delays first paint. It also does not
 * touch the course index, which #36 made lazy on purpose.
 */
function showWelcome(term) {
  els.welcome.hidden = false;
  const sections = seatsSectionCount(term);
  const bits = [termName(term)];
  if (sections) bits.push(`${sections.toLocaleString()} sections`);
  if (seatsTerm(term) && seatsUpdated(term)) bits.push(`seats as of ${formatDate(seatsUpdated(term))}`);
  els.wStats.textContent = bits.join(" · ");

  const best = topRated();
  const rated = ratedCount();
  // Deliberately does not claim these people teach this term. The ratings
  // snapshot covers everyone RateMyProfessors knows about, and checking who is
  // actually teaching would mean a search per name.
  els.wSub.textContent = rated
    ? `From ${rated.toLocaleString()} rated instructors, those with at least 50 ratings. Not all teach every term.`
    : "";

  els.wList.replaceChildren(
    ...best.map((person) => {
      const name = `${person.firstName} ${person.lastName}`;
      const li = document.createElement("li");

      const button = document.createElement("button");
      button.type = "button";
      button.className = "w-name";
      button.dataset.q = name;
      button.textContent = name;
      li.append(button);

      const score = document.createElement("span");
      score.className = "w-score";
      score.textContent = Number(person.avgRating).toFixed(1);
      li.append(score);

      const meta = document.createElement("span");
      meta.className = "w-meta";
      meta.textContent = `${person.numRatings} ratings · ${person.department ?? ""}`;
      li.append(meta);
      return li;
    })
  );
}

async function runSearch(q, term) {
  if (!q.trim()) {
    els.results.replaceChildren();
    showWelcome(term);
    markSources(term);
    setStatus(outageNote(term));
    return;
  }
  els.welcome.hidden = true;

  const requestId = ++latestRequest;
  setBusy(true);
  setStatus("Searching...");
  try {
    // Ratings must be in hand before rendering, or instructors draw unrated and
    // never redraw. Awaited alongside the search rather than before it, so the
    // cost is the slower of the two and only on the first search.
    const [{ courses, totalItems }] = await Promise.all([
      searchAllPages({ q, term }),
      loadRatings().catch(() => null),
      loadSeats(term).catch(() => null),
      loadTrend(term),
    ]);
    if (requestId !== latestRequest) return; // a newer search already answered
    lastResult = { ...filterCourses(courses, q), totalItems };
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

/** Names the snapshots that were asked for and did not arrive. Empty if none did. */
function outageNote(term) {
  const ratings = ratingsFailed();
  const dead = [];
  if (ratings) dead.push("instructor ratings");
  if (seatsFailed(term)) dead.push("seat counts");
  if (!dead.length) return "";
  // Ratings feed two of the three controls and seats one, so the count follows
  // the ratings file rather than how many files died.
  const off = ratings ? "filters that need them are" : "filter that needs them is";
  return `Could not load ${dead.join(" and ")}, so the ${off} off.`;
}

/**
 * Turn off the controls whose snapshot never arrived.
 *
 * Left on they filter against nothing, which either empties the page or does
 * nothing at all, and both look like the student's own choice.
 */
function markSources(term) {
  const ratings = ratingsFailed();
  const seats = seatsFailed(term);
  els.filters.rating.disabled = ratings;
  els.filters.ratedOnly.disabled = ratings;
  els.filters.hideFull.disabled = seats;
}

/** Re-render from the last search. Filters never refetch. */
function paint(term = els.term.value) {
  markSources(term);
  if (!lastResult) {
    // Nothing to describe yet, but a dead snapshot still has to be named and a
    // term that loaded has to clear the note. Only on the landing screen: a
    // search that failed owns the status line and keeps it.
    if (!els.welcome.hidden) setStatus(outageNote(term));
    return;
  }
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
  if (view === "calendar") {
    els.results.replaceChildren(renderCalendar(primary, term));
    // Related courses are deliberately not plotted, since a grid of a hundred
    // courses is unreadable. Deliberate is not the same as silent.
    if (related.length) {
      const note = document.createElement("p");
      note.className = "hidden-note";
      note.append(document.createTextNode(
        `${related.length} related course${related.length === 1 ? "" : "s"} are not on the grid. `
      ));
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "See them in list view";
      button.addEventListener("click", () => setView("list"));
      note.append(button);
      els.results.append(note);
    }
  } else {
    renderResults(els.results, { primary, related }, term);
  }
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

  const outage = outageNote(term);
  const withOutage = (line) => (outage ? `${line} ${outage}` : line);

  if (!primary.length) {
    // Careful not to claim everything went when related courses may still be
    // on screen underneath this message.
    setStatus(withOutage(
      isActive(filters)
        ? `No sections match your filters in ${termName(term)}. Loosen one, or clear them.`
        : `Nothing matched in ${termName(term)}. Try a subject and number, like CSE 2221.`
    ));
    return;
  }

  const sections = primary.reduce((n, e) => n + e.sections.length, 0);
  const noun = primary.length === 1 ? "course" : "courses";
  // Barrett refreshes once a day, so the numbers are dated, and during a
  // registration window that distinction matters.
  const dated = seatsTerm(term) && seatsUpdated(term) ? ` Seats as of ${formatDate(seatsUpdated(term))}.` : "";
  const counts = `${primary.length} ${noun}, ${sections} sections in ${termName(term)}.${dated}`;
  // The counts describe the fetch, not the filters, so this stays put when
  // filters hide rows: the search really did read only part of the answer.
  const coverage = formatCoverage(lastResult);
  setStatus(withOutage(coverage ? `${counts} ${coverage}` : counts));
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
  loadSeats(els.term.value).catch((error) => console.warn("seats unavailable", error));
  loadTrend(els.term.value);

  const params = new URLSearchParams(location.search);
  setBusy(false);
  setStatus("Loading terms...");
  els.term.disabled = true;

  // Before the network, not after: a shared link's filters and the day chips'
  // spoken state must not wait on the term service, which #38 measured
  // leaving all five chips announcing as "Mo" when it failed.
  writeFilters(params);

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

  for (const field of [els.subject, els.number]) {
    field.addEventListener("focus", ensureCourses);
  }

  els.subject.addEventListener("input", async () => {
    if (!(await ensureCourses())) return;
    const courses = fillNumbers();
    // Committing a whole subject is a useful search on its own, but only once
    // the typed text actually names one.
    if (courses.length && !els.number.value) searchFromPickers();
  });

  els.number.addEventListener("input", () => {
    const code = codeFromInput(els.subject.value);
    const wanted = els.number.value.trim();
    if (coursesFor(els.term.value, code).some((c) => c.number === wanted)) searchFromPickers();
  });

  els.viewList.addEventListener("click", () => setView("list"));
  els.viewCal.addEventListener("click", () => setView("calendar"));

  els.filters.addEventListener("change", () => {
    showHidden = false;
    syncUrl(els.query.value, els.term.value);
    paint();
  });

  els.days.addEventListener("click", (event) => {
    const button = event.target.closest(".f-day");
    if (!button) return;
    setDayState(button, NEXT_STATE[button.dataset.state] ?? "require");
    showHidden = false;
    syncUrl(els.query.value, els.term.value);
    paint();
  });

  els.clear.addEventListener("click", () => {
    els.filters.reset();
    for (const button of els.days.querySelectorAll(".f-day")) setDayState(button, "any");
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
    const row = event.target.closest(".section, .cal-item");
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
    reflectQuery(q);
    syncUrl(q, els.term.value);
    runSearch(q, els.term.value);
  });

  els.term.addEventListener("change", () => {
    if (isLoaded()) { fillSubjects(); fillNumbers(); }
    // Seats are per term since #48, so the new term has to arrive before the
    // repaint, or the first view after a switch shows none. Repaint on failure
    // too, or the controls keep describing the term we just left.
    Promise.all([loadSeats(els.term.value), loadTrend(els.term.value)])
      .catch(() => {})
      .then(() => paint());
    syncUrl(els.query.value, els.term.value);
    if (els.query.value.trim()) runSearch(els.query.value, els.term.value);
  });

  els.welcome.addEventListener("click", (event) => {
    const button = event.target.closest("[data-q]");
    if (!button) return;
    els.query.value = button.dataset.q;
    reflectQuery(button.dataset.q);
    syncUrl(button.dataset.q, els.term.value);
    runSearch(button.dataset.q, els.term.value);
  });

  const initialQuery = params.get("q") ?? "";
  els.query.value = initialQuery;
  if (initialQuery.trim()) {
    reflectQuery(initialQuery);
    runSearch(initialQuery, els.term.value);
  }
  else {
    // Ratings and seats are already in flight; fill the landing screen once
    // they land rather than showing an empty frame in the meantime.
    setStatus("");
    Promise.allSettled([loadRatings(), loadSeats(els.term.value)]).then(() => {
      markSources(els.term.value);
      setStatus(outageNote(els.term.value));
      showWelcome(els.term.value);
    });
  }
}

init();
