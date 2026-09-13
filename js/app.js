import { fetchTerms, defaultTerm, searchAllPages, GEN_CATEGORIES, ApiError } from "./api.js";
import { filterCourses, parseQuery } from "./rank.js";
import { renderResults } from "./render.js";
import { loadRatings, loadRatingCourses, topRated, ratedCount, profileUrl, ratingsFailed } from "./ratings.js";
import { linkedTo, loadSeats, seatsTerm, seatsUpdated, seatsSectionCount, seatsFailed } from "./seats.js";
import { loadTrend } from "./trend.js";
import { renderDetail } from "./detail.js";
import { loadHeadshots } from "./headshots.js";
import { applyFilters, hiddenFor, isActive, parseBusy, formatBusy, DEFAULTS } from "./filters.js";
import { busyLabel } from "./format.js";
import { renderCalendar } from "./calendar.js";
import { formatCoverage } from "./format.js";
import { loadCourses, subjectsFor, subjectLabel, coursesFor, codeFromInput, isLoaded } from "./courses.js";
import { classFromParams, setClassParam, sameSearch, hasSection, missOutcome } from "./deeplink.js";
import { isSortKey, sortEntries, unknownSections } from "./sort.js";
import {
  addScheduleItem, formatPlan, isScheduled, loadSchedule, parsePlan, removeScheduleItem,
  renderSchedule, saveSchedule, scheduleEntries, scheduleIds, scheduleKey,
} from "./schedule.js";

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
  busyDays: document.querySelector("#f-busy-days"),
  busyStart: document.querySelector("#f-busy-start"),
  busyEnd: document.querySelector("#f-busy-end"),
  busyAdd: document.querySelector("#f-busy-add"),
  busyList: document.querySelector("#f-busy-list"),
  busyHint: document.querySelector("#f-busy-hint"),
  sort: document.querySelector("#f-sort"),
  sortNote: document.querySelector("#f-sort-note"),
  subject: document.querySelector("#p-subject"),
  number: document.querySelector("#p-number"),
  gen: document.querySelector("#p-gen"),
  subjectList: document.querySelector("#subject-list"),
  numberList: document.querySelector("#number-list"),
  hint: document.querySelector("#p-hint"),
  welcome: document.querySelector("#welcome"),
  wStats: document.querySelector("#w-stats"),
  wSub: document.querySelector("#w-sub"),
  wList: document.querySelector("#w-list"),
  viewList: document.querySelector("#view-list"),
  viewCal: document.querySelector("#view-cal"),
  viewSchedule: document.querySelector("#view-schedule"),
  scheduleCount: document.querySelector("#schedule-count"),
  clear: document.querySelector("#f-clear"),
  query: document.querySelector("#q"),
  term: document.querySelector("#term"),
  submit: document.querySelector("#go"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
};

let terms = [];
let termsError = "";
// A search refused while the term list was still in flight, held whole. The
// pickers are live in that window, so a bare query would replay unscoped.
let queued = null;
let latestRequest = 0;
// Whether a search is on the wire. Between asking and answering the status line
// is that search's, so a repaint underneath it must not write over the line.
let searching = false;

// Class number to its section and course, rebuilt on every render. The detail
// pane needs the real objects, not text scraped back out of the DOM.
let sectionIndex = new Map();
let currentEntries = [];
// The unfiltered result of the last search, tagged with the term it was fetched
// for, so changing a filter re-renders rather than refetching, plus the query it
// ran with, since a repaint has to quote that and not whatever is sitting in the
// box by then.
let lastResult = null;
let lastQuery = "";
// The last search the subject dropdown produced, so switching term re-runs it
// scoped rather than dropping back to the keyword search. Not read back off
// the picker, because reflectQuery fills that same box from a typed query and
// a typed subject is still a guess. The query rides along so an edited box
// stops matching it.
let pickedSearch = null;
let view = "list";
let schedule = loadSchedule();
let scheduleNote = "";
// A section named by the URL. Applied on the next paint and then forgotten, so
// changing a filter later does not drag the pane back to it.
let pendingClass = "";
// The two files only the detail pane reads, and whether they have landed.
let detailFiles = null;
let detailFilesLanded = false;
// A `gen` link built before Ohio State reworded the category it names.
let staleGen = null;

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

// Busy blocks are chips in the rail, never clicks on the calendar. A clickable
// grid reads as an invitation to mark the overlaps too, and marking overlaps is
// a schedule builder. Finder searches, it does not plan.

const BUSY_HINT = els.busyHint.textContent;

function setBusyDay(button, busy) {
  button.dataset.state = busy ? "busy" : "any";
  button.setAttribute("aria-pressed", String(busy));
}

/** Blocks are read back off their chips, the way day states are read off theirs. */
function busyBlocks() {
  return [...els.busyList.querySelectorAll(".f-chip")].map((chip) => parseBusy(chip.dataset.busy)).filter(Boolean);
}

/** Two ways of writing the same block, "TuTh" and "ThTu", are one chip. */
function uniqueBlocks(blocks) {
  return [...new Map(blocks.map((b) => [formatBusy(b), b])).values()];
}

function renderBusy(blocks) {
  els.busyList.replaceChildren(...uniqueBlocks(blocks).map((block) => {
    const label = busyLabel(block);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "f-chip";
    chip.dataset.busy = formatBusy(block);
    chip.textContent = label;
    chip.setAttribute("aria-label", `Remove busy time ${label}`);
    const item = document.createElement("li");
    item.append(chip);
    return item;
  }));
}

/** "09:35" from a time field to minutes past midnight. */
function fieldMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function resetBusyFields() {
  for (const button of els.busyDays.querySelectorAll(".f-day")) setBusyDay(button, false);
  els.busyStart.value = "";
  els.busyEnd.value = "";
  els.busyHint.textContent = BUSY_HINT;
}

function addBusy() {
  const days = [...els.busyDays.querySelectorAll('.f-day[data-state="busy"]')].map((b) => b.dataset.day);
  const start = fieldMinutes(els.busyStart.value);
  const end = fieldMinutes(els.busyEnd.value);
  if (!days.length || start == null || end == null || start >= end) {
    els.busyHint.textContent = "Pick at least one day, and a start before the end.";
    return;
  }

  renderBusy([...busyBlocks(), { days, start, end }]);
  resetBusyFields();
  syncUrl(els.query.value, els.term.value);
  paint();
}

function readFilters() {
  const data = new FormData(els.filters);
  const { required, avoided } = dayStates();
  return {
    ...DEFAULTS,
    days: required,
    avoid: avoided,
    busy: busyBlocks(),
    from: data.get("from") ?? "",
    to: data.get("to") ?? "",
    rating: els.filters.rating.value,
    hideFull: els.filters.hideFull.checked,
    hideOnline: els.filters.hideOnline.checked,
    ratedOnly: els.filters.ratedOnly.checked,
    hideConsent: els.filters.hideConsent.checked,
    undergradOnly: els.filters.undergradOnly.checked,
    term: els.term.value,
  };
}

function sortKey() {
  return isSortKey(els.sort.value) ? els.sort.value : "";
}

function writeFilters(params) {
  const required = params.getAll("day");
  const avoided = params.getAll("noday");
  for (const button of els.days.querySelectorAll(".f-day")) {
    const day = button.dataset.day;
    setDayState(button, required.includes(day) ? "require" : avoided.includes(day) ? "avoid" : "any");
  }
  renderBusy(params.getAll("busy").map(parseBusy).filter(Boolean));
  els.filters.from.value = params.get("from") ?? "";
  els.filters.to.value = params.get("to") ?? "";
  els.filters.rating.value = params.get("rating") ?? "";
  els.filters.hideFull.checked = params.get("hideFull") === "1";
  els.filters.hideOnline.checked = params.get("hideOnline") === "1";
  els.filters.ratedOnly.checked = params.get("ratedOnly") === "1";
  els.filters.hideConsent.checked = params.get("hideConsent") === "1";
  els.filters.undergradOnly.checked = params.get("undergradOnly") === "1";
  // A select set to a value it has no option for shows nothing at all, so an
  // unknown sort has to be written back as relevance.
  const sort = params.get("sort") ?? "";
  els.sort.value = isSortKey(sort) ? sort : "";
}

/**
 * The one way filters come off, so the rail, the status line and the URL can
 * never describe a set that is no longer on screen.
 *
 * The contract for anything added after this: whatever readFilters() reads has
 * to be resettable here. els.filters.reset() reaches only what lives in the
 * form, and filter state has already started escaping it.
 */
function clearFilters() {
  els.filters.reset();
  for (const button of els.days.querySelectorAll(".f-day")) setDayState(button, "any");
  // Filter state that lives outside the form is reset here. reset() clears the
  // two busy time fields, but the blocks themselves live on their chips.
  els.sort.value = "";
  renderBusy([]);
  resetBusyFields();
  syncUrl(els.query.value, els.term.value);
  paint();
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

function genCategory() {
  return els.gen.value || null;
}

/** A picked subject searches that subject, not the word. */
function searchFromPickers() {
  const code = codeFromInput(els.subject.value);
  if (!code) return;
  const number = els.number.value.trim();
  const q = number ? `${code} ${number}` : code;
  els.query.value = q;
  pickedSearch = { q, subject: code };
  syncUrl(q, els.term.value);
  runSearch(q, els.term.value, code);
}

function setView(next) {
  view = next;
  for (const [button, name] of [[els.viewList, "list"], [els.viewCal, "calendar"], [els.viewSchedule, "schedule"]]) {
    button.classList.toggle("is-on", name === next);
    button.setAttribute("aria-pressed", String(name === next));
  }
  if (next !== "schedule" && !lastResult) {
    els.results.replaceChildren();
    resetDetail();
    if (els.term.value) showWelcome(els.term.value);
  }
  paint();
}

function linkedParts(numbers, entries) {
  const parts = [];
  for (const number of numbers) {
    for (const entry of entries) {
      const section = entry.sections.find((candidate) => String(candidate.classNumber) === String(number));
      if (section) { parts.push({ course: entry.course, section }); break; }
    }
  }
  return parts;
}

function scheduleItem(found, term, entries = currentEntries, old = null) {
  const linked = linkedTo(found.section.classNumber, term);
  const included = linkedParts(linked?.enrolls ?? [], entries);
  const alternatives = linkedParts(linked?.enrolledBy ?? [], entries);
  // One valid partner is a fact, not a choice. With several, preserve a choice
  // already made but never infer one from a matching clock time.
  const oldChoice = String(old?.choice?.section?.classNumber ?? "");
  const choice = alternatives.length === 1
    ? alternatives[0]
    : alternatives.find((part) => String(part.section.classNumber) === oldChoice) ?? null;
  return {
    ...found, term, included, choice,
    choices: alternatives.length > 1 ? alternatives : [],
  };
}

function planUrl() {
  const url = new URL(location.href);
  const plan = formatPlan(scheduleIds(schedule, els.term.value));
  if (plan) url.searchParams.set("plan", plan); else url.searchParams.delete("plan");
  url.searchParams.delete("class");
  return url;
}

function storeSchedule() {
  saveSchedule(schedule);
  els.scheduleCount.textContent = String(scheduleIds(schedule, els.term.value).length);
  history.replaceState(null, "", planUrl());
}

function toggleSchedule(found, term) {
  const number = found.section.classNumber;
  if (isScheduled(schedule, term, number)) schedule = removeScheduleItem(schedule, term, number);
  else schedule = addScheduleItem(schedule, scheduleItem(found, term));
  storeSchedule();
  if (view === "schedule") paintSchedule(term);
  else {
    const row = els.results.querySelector(`[data-class-number="${number}"]`);
    if (row) applySelection(row);
  }
}

function shareSchedule() {
  const url = planUrl().href;
  if (navigator.share) {
    navigator.share({ title: `Finder schedule for ${termName(els.term.value)}`, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(
      () => { scheduleNote = "Schedule link copied."; paintSchedule(); },
      () => { scheduleNote = "Could not copy the schedule link."; paintSchedule(); }
    );
  } else {
    scheduleNote = "The schedule is encoded in this page's address. Copy it from the address bar.";
    paintSchedule();
  }
}

/** Resolve the small class-number-only form a shared link carries against OSU's live API. */
async function refreshSchedule(ids, term) {
  const wanted = [...new Set(ids.map(String))];
  if (!wanted.length || !term) return;

  // A class-number search is allowed to return only that section. Keep the
  // whole response long enough to use a sibling when it is present, but ask
  // for each exact Barrett partner when it is not. Guessing from equal times
  // is unsafe: some courses have several labs at one hour, and some linked
  // components meet at different hours entirely.
  const resolved = new Map();
  async function resolve(number) {
    number = String(number);
    if (resolved.has(number)) return resolved.get(number);
    const result = await searchAllPages({ q: number, term });
    let exact = null;
    for (const course of result.courses ?? []) {
      for (const section of course.sections ?? []) {
        const found = { course: course.course, section };
        resolved.set(String(section.classNumber), found);
        if (String(section.classNumber) === number) exact = found;
      }
    }
    resolved.set(number, exact);
    return exact;
  }

  const bases = await Promise.allSettled(wanted.map(resolve));
  const baseByNumber = new Map();
  bases.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) baseByNumber.set(wanted[index], result.value);
  });

  const partnerIds = [...new Set([...baseByNumber.keys()].flatMap((number) => {
    const linked = linkedTo(number, term);
    return [...(linked?.enrolls ?? []), ...(linked?.enrolledBy ?? [])];
  }))];
  const missingPartners = partnerIds.filter((number) => !resolved.get(String(number)));
  await Promise.allSettled(missingPartners.map(resolve));

  const missingLinked = new Set();
  const resolvedEntries = [...resolved.values()].filter(Boolean).map((part) => ({
    course: part.course, sections: [part.section],
  }));
  for (const [number, found] of baseByNumber) {
    const old = schedule.find((item) => scheduleKey(item) === `${term}:${number}`);
    const linked = linkedTo(number, term);
    for (const partner of [...(linked?.enrolls ?? []), ...(linked?.enrolledBy ?? [])]) {
      if (!resolved.get(String(partner))) missingLinked.add(String(partner));
    }
    const fallbacks = [
      ...(old?.included ?? []),
      ...(old?.choices ?? []),
      ...(old?.choice ? [old.choice] : []),
    ].map((part) => ({ course: part.course, sections: [part.section] }));
    schedule = addScheduleItem(schedule, scheduleItem(found, term, [...resolvedEntries, ...fallbacks], old));
  }
  saveSchedule(schedule);
  const missed = wanted.filter((number) => !baseByNumber.has(number));
  const notes = [];
  if (missed.length) notes.push(`Could not refresh section${missed.length === 1 ? "" : "s"} ${missed.join(", ")}; ${missed.length === 1 ? "it" : "they"} may no longer be offered this term.`);
  if (missingLinked.size) notes.push(`Could not load linked section${missingLinked.size === 1 ? "" : "s"} ${[...missingLinked].join(", ")}.`);
  scheduleNote = notes.join(" ") || "Schedule and linked sections refreshed from Ohio State.";
}

function paintSchedule(term = els.term.value) {
  view = "schedule";
  const entries = scheduleEntries(schedule, term);
  currentEntries = entries;
  sectionIndex = new Map(entries.flatMap((entry) => entry.sections.map((section) => [
    String(section.classNumber), { section, course: entry.course },
  ])));
  els.results.replaceChildren(renderSchedule(schedule, term, {
    calendar: renderCalendar,
    onRemove: (item) => {
      schedule = removeScheduleItem(schedule, item.term, item.section.classNumber);
      storeSchedule();
      resetDetail();
      paintSchedule(term);
      els.results.focus();
    },
    onClear: () => {
      schedule = schedule.filter((item) => String(item.term) !== String(term));
      storeSchedule();
      resetDetail();
      paintSchedule(term);
      els.results.focus();
    },
    onChoose: (item, choice) => {
      schedule = addScheduleItem(schedule, { ...item, choice });
      storeSchedule();
      paintSchedule(term);
      els.results.focus();
    },
    onShare: shareSchedule,
  }));
  resetDetail();
  els.app.dataset.view = "results";
  setStatus(scheduleNote);
  scheduleNote = "";
}

function sectionLink(classNumber) {
  return setClassParam(new URL(location.href), classNumber).href;
}

function deselectRows() {
  for (const row of els.results.querySelectorAll(".is-selected")) {
    row.classList.remove("is-selected");
    row.removeAttribute("aria-current");
  }
}

/** Show a row's section and name it in the URL. */
function applySelection(row) {
  const found = sectionIndex.get(row.dataset.classNumber);
  if (!found) return false;

  deselectRows();
  // Any note about a link that missed was about some other section.
  els.results.querySelector(".link-note")?.remove();
  row.classList.add("is-selected");
  // Selection is state, not just colour, so it is exposed rather than implied.
  row.setAttribute("aria-current", "true");

  const link = sectionLink(row.dataset.classNumber);
  // The term these rows were fetched for, not the one in the selector, which can
  // already have moved on while the next search is still running. Read once, so
  // the redraw below cannot land on a different term than the first paint.
  const term = lastResult?.term ?? els.term.value;
  const draw = () => renderDetail({
    ...found, term, entries: currentEntries, formatDate, shareUrl: link,
    scheduled: isScheduled(schedule, term, found.section.classNumber),
    onSchedule: () => toggleSchedule(found, term),
  });
  showDetail(draw());
  history.replaceState(null, "", link);

  // Two files only the detail pane reads, fetched on the first section opened
  // instead of at startup: the course codes behind "52 of 147 ratings are for CSE
  // 2221", and which instructors have a photo.
  if (!detailFilesLanded) {
    // Memoised, so one attempt per page load: a missing snapshot will not appear
    // on the next click, and a loader that fails drops its own in-flight memo, so
    // without this every later click would start the dead fetch again.
    detailFiles ??= Promise.all([
      loadRatingCourses().catch((error) => console.warn("rating course codes unavailable", error)),
      loadHeadshots().catch((error) => console.warn("headshots unavailable", error)),
    ]);
    // Bound to this row rather than the first one opened, or a section selected
    // while the files were still in flight would never get its pane back.
    // Redrawing the body rather than calling showDetail again leaves focus alone.
    const opened = row.dataset.classNumber;
    detailFiles.then(() => {
      detailFilesLanded = true;
      if (opened === els.results.querySelector(".is-selected")?.dataset.classNumber) {
        els.detailBody.replaceChildren(draw());
      }
    });
  }
  return true;
}

function clearSelection() {
  deselectRows();
  resetDetail();
  if (collapsed.matches) els.app.dataset.view = "results";
}

function selectSection(row) {
  if (!sectionIndex.has(row.dataset.classNumber)) return;
  // One history entry for the pane rather than one per section looked at: push
  // as it opens, replace while it is open, so Back closes it instead of walking
  // back through the whole visit. Either way applySelection writes the URL.
  if (!els.results.querySelector(".is-selected")) history.pushState(null, "", location.href);
  applySelection(row);
}

function closeDetail() {
  els.app.dataset.view = "results";
  // The pane is shut, so the link stops naming a section. The row keeps its
  // selection because focus is about to go back to it.
  history.replaceState(null, "", setClassParam(new URL(location.href), ""));
  // Back to the row that opened the pane where possible, so a keyboard user
  // resumes where they left off instead of at the top of the results.
  const selected = els.results.querySelector(".is-selected");
  (selected ?? els.results).focus();
}

// Focus collapses to the body when a control removes itself, which drops a
// keyboard user past the whole rail to the end of the document. Collapsed, an
// open detail pane is covering the results, so the pane on screen takes it
// instead. Never called from paint(): an ordinary filter change should leave
// focus where it is.
function focusResults() {
  (collapsed.matches && els.app.dataset.view === "detail" ? els.detail : els.results).focus();
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
  searching = busy;
  els.submit.setAttribute("aria-disabled", String(busy));
  els.results.setAttribute("aria-busy", String(busy));
}

/**
 * Rewrite one parameter and leave the rest of the URL alone.
 *
 * Not syncUrl, which also rewrites the filters and drops the section a link
 * arrived with, both of which its own callers have just changed anyway.
 */
function replaceParam(key, value) {
  const url = new URL(location.href);
  if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  history.replaceState(null, "", url);
}

function syncUrl(q, term) {
  const url = new URL(location.href);
  // A link's section belongs to the search it arrived with, so retrying that
  // search after a 429 keeps it and searching for anything else drops it.
  if (!sameSearch(url, q, term)) pendingClass = "";
  if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
  if (term) url.searchParams.set("term", term);
  const plan = formatPlan(scheduleIds(schedule, term));
  if (plan) url.searchParams.set("plan", plan); else url.searchParams.delete("plan");
  const gen = genCategory();
  if (gen) url.searchParams.set("gen", gen); else url.searchParams.delete("gen");

  // Filters live in the URL so a filtered view can be shared or reloaded.
  const f = readFilters();
  url.searchParams.delete("day");
  url.searchParams.delete("noday");
  for (const day of f.days) url.searchParams.append("day", day);
  for (const day of f.avoid) url.searchParams.append("noday", day);
  url.searchParams.delete("busy");
  for (const block of f.busy) url.searchParams.append("busy", formatBusy(block));
  for (const [key, value] of [["from", f.from], ["to", f.to], ["rating", f.rating], ["sort", sortKey()]]) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  for (const key of ["hideFull", "hideOnline", "ratedOnly", "hideConsent", "undergradOnly"]) {
    if (f[key]) url.searchParams.set(key, "1"); else url.searchParams.delete(key);
  }
  // Every caller of this has just changed the result set, and the repaint that
  // follows clears the pane, so whichever section was named is gone.
  setClassParam(url, "");
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
  // The date comes from the index, so it is honest before this term's own file
  // lands. Dropped only once that file is known to have failed, since then
  // there are no numbers for it to date.
  if (seatsUpdated(term) && !seatsFailed(term)) bits.push(`seats as of ${formatDate(seatsUpdated(term))}`);
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

/**
 * Drop the last search along with everything it put on screen. paint() repaints
 * from lastResult, so a result left behind comes back on the next filter click.
 */
function clearLastSearch() {
  lastResult = null;
  els.results.replaceChildren();
  resetDetail();
}

/**
 * Run the search the page already describes, again. Every trigger goes through
 * here: the query box saying "MATH" does not say whether that was typed or
 * picked, and only the memo knows.
 */
function rerunSearch() {
  const q = els.query.value;
  runSearch(q, els.term.value, pickedSearch?.q === q ? pickedSearch.subject : null);
}

async function runSearch(q, term, subject, gen = genCategory()) {
  // A new search replaces the results, and collapsed the detail pane is covering
  // them. The empty-query and error paths below never reach paint().
  els.app.dataset.view = "results";
  if (!term) {
    // Reachable since #80 moved the listeners above the term request. Hold the
    // call for init to run rather than search without a term.
    if (termsError) setStatus(termsError, "error");
    else if (q.trim() || gen) {
      queued = { q, subject, genCategory: gen };
      setStatus("Still loading terms. Your search will run when they arrive.");
    }
    return;
  }
  // A requirement on its own is a search.
  if (!q.trim() && !gen) {
    // Supersede any search still in flight: it was started for whichever term
    // was selected then. Its finally checks the id, so the busy flag comes off here.
    const requestId = ++latestRequest;
    setBusy(false);
    clearLastSearch();
    showSortNote([], sortKey(), term);
    showWelcome(term);
    markSources(term);
    setStatus(outageNote(term));
    // The section count and the date on that line come from this term's seat
    // snapshot, which the first visit to a term has not loaded yet.
    Promise.allSettled([loadRatings(), loadSeats(term)]).then(() => {
      if (requestId === latestRequest) showWelcome(term);
    });
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
      searchAllPages({ q, term, subject, genCategory: gen }),
      loadRatings().catch(() => null),
      // Seats are per term since #48, so this term's snapshot has to be in hand
      // before the paint, or the first view after a switch shows none.
      loadSeats(term).catch(() => null),
      loadTrend(term),
    ]);
    if (requestId !== latestRequest) return; // a newer search already answered
    lastResult = { ...filterCourses(courses, q), totalItems, term };
    lastQuery = q.trim();
    paint(term);
  } catch (error) {
    if (requestId !== latestRequest) return;
    clearLastSearch();
    showSortNote([], sortKey(), term);
    setStatus(error instanceof ApiError ? error.message : "Something went wrong. Try again.", "error");
    if (!(error instanceof ApiError)) console.error(error);
  } finally {
    if (requestId === latestRequest) setBusy(false);
  }
}

// Which snapshot each order needs. Earliest start time needs neither.
const SORT_SOURCE = {
  rating: "ratings",
  difficulty: "ratings",
  seats: "seats",
};

const SORT_UNKNOWN = {
  rating: "too few ratings to rank",
  difficulty: "too few ratings to rank",
  seats: "no seat count",
  start: "no meeting time",
};

/** The tail the sort cannot place in the list on screen, counted rather than left unexplained. */
function showSortNote(entries, sort, term) {
  const n = view === "list" ? unknownSections(entries, sort, term) : 0;
  // Not "at the end": an unplaceable section sits at the end of its own block,
  // and that block is placed by whatever its other sections score.
  els.sortNote.textContent = n
    ? `${n} section${n === 1 ? "" : "s"} the sort could not place: ${SORT_UNKNOWN[sort]}.`
    : "";
  els.sortNote.hidden = !n;
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
  // hideConsent and undergradOnly are absent on purpose: both read fields the
  // search response itself carries, so there is no snapshot to lose. #68.

  // The orders read the same two snapshots the filters do. Left on, a sort with
  // nothing to read leaves the page in relevance order and blames every section
  // on screen for being unplaceable. #63.
  const dead = { ratings, seats };
  for (const option of els.sort.options) option.disabled = Boolean(dead[SORT_SOURCE[option.value]]);
  if (dead[SORT_SOURCE[els.sort.value]]) {
    els.sort.value = "";
    // A link is the shared copy of what the page is applying, so an order that
    // was just switched off cannot stay in one.
    replaceParam("sort", "");
  }
}

/**
 * A note under the results naming what it is not showing, with the button that
 * puts it back. Three callers, one shape.
 */
function hiddenNote(text, offer, extra = "") {
  const note = document.createElement("p");
  note.className = extra ? `hidden-note ${extra}` : "hidden-note";
  note.append(document.createTextNode(`${text} `));
  if (offer) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = offer.label;
    button.addEventListener("click", offer.act);
    note.append(button);
  }
  els.results.append(note);
}

/** Re-render from the last search. Filters never refetch. */
function paint(term = els.term.value) {
  markSources(term);
  els.scheduleCount.textContent = String(scheduleIds(schedule, term).length);
  if (view === "schedule") { paintSchedule(term); return; }
  const filters = readFilters();
  // The clear button tracks the filters, not the result, so it is set before
  // the bail below.
  els.clear.hidden = !isActive(filters);
  if (!lastResult) {
    showSortNote([], sortKey(), term);
    // Nothing to describe yet, but a dead snapshot still has to be named and a
    // term that loaded has to clear the note. Only on the landing screen: a
    // search that failed owns the status line and keeps it.
    if (!els.welcome.hidden) setStatus(outageNote(term));
    return;
  }

  // Class numbers are reused across terms, so repainting these against the new
  // term's snapshot finds a real seat row and draws a full section as open. The
  // `??` keeps a result written without the key from blanking every search.
  if ((lastResult.term ?? term) !== term) {
    clearLastSearch();
    showSortNote([], sortKey(), term);
    // The term change started a search, and that search owns the status line
    // until it answers. Blanking it left an empty page saying nothing at all,
    // with the query still in the box and aria-busy still on. #89 #71.
    if (!searching) setStatus("");
    return;
  }

  const p = applyFilters(lastResult.primary, filters);
  const r = applyFilters(lastResult.related, filters);

  const sort = sortKey();
  const primary = sortEntries(p.entries, sort, term);
  const related = sortEntries(r.entries, sort, term);
  // Primary only: the related pile is a collapsed <details> whose sections are
  // not built until it is opened, so counting it put a number beside the status
  // line bigger than the page's own total. #63.
  showSortNote(primary, sort, term);
  const { hiddenSections, hiddenCourses } = hiddenFor(view, p, r);
  const wanted = pendingClass;
  pendingClass = "";

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
      hiddenNote(
        `${related.length} related course${related.length === 1 ? "" : "s"} are not on the grid.`,
        { label: "See them in list view", act: () => { setView("list"); focusResults(); } }
      );
    }
  } else {
    // A related course stays folded away until it is asked for, so a link into
    // one has to ask for it here rather than after the render.
    const openRelated = Boolean(wanted) && hasSection(related, wanted);
    renderResults(els.results, { primary, related, openRelated }, term, sort);
  }
  resetDetail();
  els.app.dataset.view = "results";

  const missed = wanted ? openLinked(wanted, term) : "";

  if (hiddenSections || hiddenCourses) {
    const parts = [];
    if (hiddenSections) parts.push(`${hiddenSections} section${hiddenSections === 1 ? "" : "s"}`);
    if (hiddenCourses) parts.push(`${hiddenCourses} course${hiddenCourses === 1 ? "" : "s"}`);
    // Never hide silently. Say what was removed and offer it back. Clearing
    // rather than overriding is what keeps the rail, the status line and the
    // URL from describing a set that is no longer on screen.
    hiddenNote(
      `${parts.join(" and ")} hidden by your filters.`,
      { label: "Show them anyway", act: () => { clearFilters(); focusResults(); } }
    );
  }

  // A dead snapshot and a link that missed both describe the page rather than
  // what the search found, so they trail the counts.
  const notes = [outageNote(term), missed].filter(Boolean).join(" ");
  const withNotes = (line) => (notes ? `${line} ${notes}` : line);

  if (!primary.length) {
    const gen = genCategory();
    // Name the requirement, or an empty GE browse reads as a broken page.
    const empty = gen
      ? `Nothing in ${termName(term)} is listed under ${gen}${lastQuery ? ` for "${lastQuery}"` : ""}.`
      : `Nothing matched in ${termName(term)}. Try a subject and number, like CSE 2221.`;
    // Careful not to claim everything went when related courses may still be
    // on screen underneath this message.
    setStatus(withNotes(
      isActive(filters)
        ? `No sections match your filters in ${termName(term)}. Loosen one, or clear them.`
        : empty
    ));
    return;
  }

  const sections = primary.reduce((n, e) => n + e.sections.length, 0);
  const noun = primary.length === 1 ? "course" : "courses";
  const unit = sections === 1 ? "section" : "sections";
  // Barrett refreshes once a day, so the numbers are dated, and during a
  // registration window that distinction matters.
  const dated = seatsTerm(term) && seatsUpdated(term) ? ` Seats as of ${formatDate(seatsUpdated(term))}.` : "";
  const counts = `${primary.length} ${noun}, ${sections} ${unit} in ${termName(term)}.${dated}`;
  // The counts describe the fetch, not the filters, so this stays put when
  // filters hide rows: the search really did read only part of the answer.
  const coverage = formatCoverage(lastResult);
  setStatus(withNotes(coverage ? `${counts} ${coverage}` : counts));
}

/**
 * Land a shared link on its section, or say why it is not on screen and give
 * that back to paint, since the note is not in a live region and the status is.
 * Returns "" when the link landed.
 */
function openLinked(classNumber, term) {
  const row = els.results.querySelector(`[data-class-number="${classNumber}"]`);
  if (row) { applySelection(row); return ""; }

  // The results, not the DOM. A section can be in them and still have no row:
  // the calendar plots primary courses only.
  const { message, offer } = missOutcome(classNumber, {
    inResults: sectionIndex.has(classNumber),
    inSearch: hasSection([...lastResult.primary, ...lastResult.related], classNumber),
  });

  const action = offer && {
    label: offer === "list" ? "See it in list view" : "Show it anyway",
    act: () => {
      pendingClass = classNumber;
      // Clearing rather than overriding is what keeps the rail, the status line
      // and the URL describing the set on screen. clearFilters repaints.
      if (offer === "list") setView("list");
      else clearFilters();
      focusResults();
    },
  };
  hiddenNote(message, action, "link-note");
  return message;
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

  const params = new URLSearchParams(location.search);
  const sharedPlan = parsePlan(params.get("plan"));
  setBusy(false);
  setStatus("Loading terms...");
  els.term.disabled = true;

  // Before the network, not after: a shared link's filters and the day chips'
  // spoken state must not wait on the term service, which #38 measured
  // leaving all five chips announcing as "Mo" when it failed.
  writeFilters(params);

  els.gen.append(
    ...GEN_CATEGORIES.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      return option;
    })
  );
  // An unknown value searches for nothing, so drop it and say so rather than
  // serving the front page to someone who followed a link to a requirement.
  const gen = params.get("gen");
  if (GEN_CATEGORIES.includes(gen)) els.gen.value = gen;
  else if (gen) {
    staleGen = gen;
    const url = new URL(location.href);
    url.searchParams.delete("gen");
    history.replaceState(null, "", url);
  }

  const initialQuery = params.get("q") ?? "";
  els.query.value = initialQuery;
  if (initialQuery.trim()) reflectQuery(initialQuery);
  // A shared link names a section for the first paint of the search it arrived
  // with. Not gated on the query: a Fulfills browse is a search too.
  pendingClass = classFromParams(params);

  // Also before the network: with no submit handler registered yet, Enter is a
  // plain browser navigation that eats the query, which is what #80 measured.
  for (const field of [els.subject, els.number]) {
    field.addEventListener("focus", ensureCourses);
  }

  els.subject.addEventListener("input", async () => {
    if (!(await ensureCourses())) return;
    const courses = fillNumbers();
    // Committing a whole subject is a useful search on its own, but only once
    // the typed text actually names one.
    if (!courses.length) return;
    // A number left over from the subject before this one is not a course in
    // this one. Kept, it blocked the search below and left the rail naming a
    // course nobody had searched for.
    if (!courses.some((c) => c.number === els.number.value.trim())) els.number.value = "";
    searchFromPickers();
  });

  els.number.addEventListener("input", () => {
    const code = codeFromInput(els.subject.value);
    const wanted = els.number.value.trim();
    if (coursesFor(els.term.value, code).some((c) => c.number === wanted)) searchFromPickers();
  });

  els.gen.addEventListener("change", () => {
    syncUrl(els.query.value, els.term.value);
    rerunSearch();
  });

  els.viewList.addEventListener("click", () => setView("list"));
  els.viewCal.addEventListener("click", () => setView("calendar"));
  els.viewSchedule.addEventListener("click", () => {
    setView("schedule");
    const ids = scheduleIds(schedule, els.term.value);
    if (!ids.length) return;
    setStatus("Refreshing your schedule...");
    refreshSchedule(ids, els.term.value).then(() => paintSchedule());
  });

  els.filters.addEventListener("change", (event) => {
    // The busy fields are not a filter until Add is pressed.
    if (event.target.closest("#f-busy")) return;
    syncUrl(els.query.value, els.term.value);
    paint();
  });

  els.busyAdd.addEventListener("click", addBusy);

  // Enter in a busy field adds. Making Add a submit button would do this for
  // free, but it would also make it the default button for the whole rail.
  for (const field of [els.busyStart, els.busyEnd]) {
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addBusy();
    });
  }

  els.busyDays.addEventListener("click", (event) => {
    const button = event.target.closest(".f-day");
    if (button) setBusyDay(button, button.dataset.state !== "busy");
  });

  els.busyList.addEventListener("click", (event) => {
    const chip = event.target.closest(".f-chip");
    if (!chip) return;
    const item = chip.closest("li");
    (item.nextElementSibling?.querySelector(".f-chip") ?? els.busyAdd).focus();
    item.remove();
    syncUrl(els.query.value, els.term.value);
    paint();
  });

  els.sort.addEventListener("change", () => {
    syncUrl(els.query.value, els.term.value);
    paint();
  });

  els.days.addEventListener("click", (event) => {
    const button = event.target.closest(".f-day");
    if (!button) return;
    setDayState(button, NEXT_STATE[button.dataset.state] ?? "require");
    syncUrl(els.query.value, els.term.value);
    paint();
  });

  els.clear.addEventListener("click", () => { clearFilters(); focusResults(); });

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
    const row = event.target.closest(".section, .cal-item, .plan-open");
    if (row && !event.target.closest("a")) selectSection(row);
  });

  els.results.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".section, .plan-open");
    if (!row || event.target.closest("a")) return;
    event.preventDefault(); // Space would otherwise scroll the results pane
    selectSection(row);
  });

  // An entry is the whole URL, so the filters it was written with come back
  // with the section rather than leaving the address bar describing a page that
  // is no longer on screen. The query and the term are not: nothing pushes a
  // search.
  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(location.search);
    writeFilters(params);
    clearSelection();
    pendingClass = classFromParams(params);
    paint();
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
    syncUrl(els.query.value, els.term.value);
    // Re-run either way, and let runSearch own the snapshot wait. Repainting
    // only when the box had something in it left the previous term's rows on
    // screen under the new term's heading, and an empty box goes through the
    // welcome branch, which re-marks the controls for the new term.
    rerunSearch();
  });

  els.welcome.addEventListener("click", (event) => {
    const button = event.target.closest("[data-q]");
    if (!button) return;
    els.query.value = button.dataset.q;
    reflectQuery(button.dataset.q);
    syncUrl(button.dataset.q, els.term.value);
    rerunSearch();
    focusResults();
  });

  try {
    terms = await fetchTerms();
  } catch (error) {
    termsError = error instanceof ApiError ? error.message : "Could not load terms.";
    setStatus(termsError, "error");
    return;
  }

  if (!terms.length) {
    termsError = "Ohio State is not listing any searchable terms right now.";
    setStatus(termsError, "error");
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
  // A picker opened before this point filled itself from an empty term, and
  // setting the value in code fires no change event to refill it.
  if (isLoaded()) { fillSubjects(); fillNumbers(); }

  // A shared schedule contains only opaque class numbers. Resolve those
  // against the live course service before drawing it; ratings and today's
  // seat snapshot land alongside that work and never hold it up serially.
  if (sharedPlan.length) {
    for (const [button, name] of [[els.viewList, "list"], [els.viewCal, "calendar"], [els.viewSchedule, "schedule"]]) {
      button.classList.toggle("is-on", name === "schedule");
      button.setAttribute("aria-pressed", String(name === "schedule"));
    }
    view = "schedule";
    // The link is the sender's schedule for this term, not an instruction to
    // merge it with whichever sections the recipient already saved locally.
    schedule = schedule.filter((item) => String(item.term) !== String(els.term.value)
      || sharedPlan.includes(String(item.section.classNumber)));
    setStatus("Refreshing the shared schedule...");
    await Promise.allSettled([loadRatings(), loadSeats(els.term.value)]);
    await refreshSchedule(sharedPlan, els.term.value);
    storeSchedule();
    paintSchedule();
    return;
  }

  // A search asked for while the terms were loading was refused, not dropped.
  const pending = queued ?? { q: initialQuery };
  if (pending.q.trim() || genCategory()) {
    // Its URL was written before there was a term to write, so the link it left
    // in the address bar names none and reopens on whichever term is default.
    if (queued) replaceParam("term", els.term.value);
    runSearch(pending.q, els.term.value, pending.subject, pending.genCategory);
  } else {
    // Ratings and the seats index are already in flight; fill the landing screen
    // once they land rather than showing an empty frame. The term's own seats
    // are another 69 KB and nothing on this screen shows a seat count, so they
    // are started but not waited on.
    setStatus(staleGen ? `Finder has no requirement called ${staleGen}. Pick one under Fulfills.` : "");
    const term = els.term.value;
    // A search started while these are in flight owns all three lines below and
    // may have moved the term, so a late describe puts the landing screen back
    // over finished results and marks the controls for the term it left.
    const requestId = latestRequest;
    const describe = () => {
      if (requestId !== latestRequest) return;
      markSources(term);
      if (!staleGen) setStatus(outageNote(term));
      showWelcome(term);
    };
    // Twice on purpose. The first run has the index and can already give the
    // section count and the date; the second is the only place a dead term file
    // can be announced, since the note above is written while it is still in
    // flight and reads clean.
    const seats = loadSeats(term).catch(() => {});
    Promise.allSettled([loadRatings(), loadSeats()]).then(describe);
    seats.then(describe);
  }
}

init();
