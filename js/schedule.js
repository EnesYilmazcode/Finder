import { distinctMeetings, formatWhen, formatPlace, instructorsOf } from "./format.js";
import { toMinutes } from "./filters.js";
import { seatsFor, unreachable } from "./seats.js";

export const SCHEDULE_STORAGE_KEY = "finder.schedule.v2";
export const LEGACY_SCHEDULE_STORAGE_KEY = "finder.schedule.v1";
const DEFAULT_CAMPUS = "col";
const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MAX_SHARED_SECTIONS = 24;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function campusOf(item) {
  return String(item?.campus || DEFAULT_CAMPUS);
}

export function scheduleKey(item) {
  return `${item?.term ?? ""}:${campusOf(item)}:${item?.section?.classNumber ?? ""}`;
}

function validItem(item) {
  return item && typeof item === "object"
    && String(item.term ?? "").length > 0
    && String(item.section?.classNumber ?? "").length > 0
    && String(item.course?.subject ?? "").length > 0
    && String(item.course?.catalogNumber ?? "").length > 0;
}

function inScope(item, term, campus = DEFAULT_CAMPUS) {
  return String(item.term) === String(term) && campusOf(item) === String(campus);
}

export function addScheduleItem(items, item) {
  if (!validItem(item)) return [...items];
  const key = scheduleKey(item);
  return [...items.filter((old) => scheduleKey(old) !== key), item];
}

export function removeScheduleItem(items, term, classNumber, campus = DEFAULT_CAMPUS) {
  const key = `${term}:${campus}:${classNumber}`;
  return items.filter((item) => scheduleKey(item) !== key);
}

export function isScheduled(items, term, classNumber, campus = DEFAULT_CAMPUS) {
  const key = `${term}:${campus}:${classNumber}`;
  return items.some((item) => scheduleKey(item) === key);
}

export function scheduleIds(items, term, campus = DEFAULT_CAMPUS) {
  return items
    .filter((item) => inScope(item, term, campus))
    .map((item) => String(item.section.classNumber));
}

export function formatPlan(ids) {
  return [...new Set((ids ?? []).map(String).filter((id) => /^\d{1,8}$/.test(id)))]
    .slice(0, MAX_SHARED_SECTIONS)
    .join(",");
}

export function parsePlan(raw) {
  return formatPlan(String(raw ?? "").split(",")).split(",").filter(Boolean);
}

function cleanName(value, fallback = "Plan") {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 48) || fallback;
}

function validPlan(plan) {
  return plan && typeof plan === "object" && String(plan.id ?? "") && Array.isArray(plan.items);
}

function normalizedBook(book) {
  const plans = (book?.plans ?? []).filter(validPlan).slice(0, 20).map((plan, index) => ({
    id: String(plan.id),
    name: cleanName(plan.name, `Plan ${index + 1}`),
    items: plan.items.filter(validItem).slice(0, 100),
  }));
  if (!plans.length) plans.push({ id: "plan-1", name: "Plan A", items: [] });
  const active = plans.some((plan) => plan.id === String(book?.active)) ? String(book.active) : plans[0].id;
  return { version: 2, active, plans };
}

export function loadScheduleBook(storage = globalThis.localStorage) {
  try {
    const current = JSON.parse(storage?.getItem(SCHEDULE_STORAGE_KEY) ?? "null");
    if (current?.version === 2) return normalizedBook(current);
    const legacy = JSON.parse(storage?.getItem(LEGACY_SCHEDULE_STORAGE_KEY) ?? "null");
    if (legacy?.version === 1 && Array.isArray(legacy.items)) {
      return normalizedBook({ active: "plan-1", plans: [{ id: "plan-1", name: "Plan A", items: legacy.items }] });
    }
  } catch {
    // Corrupt or unavailable storage is the same as a first visit.
  }
  return normalizedBook(null);
}

export function saveScheduleBook(book, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(normalizedBook(book)));
    return true;
  } catch {
    return false;
  }
}

export function activeSchedule(book) {
  const normalized = normalizedBook(book);
  return normalized.plans.find((plan) => plan.id === normalized.active).items;
}

export function replaceActiveSchedule(book, items) {
  const normalized = normalizedBook(book);
  return {
    ...normalized,
    plans: normalized.plans.map((plan) => plan.id === normalized.active
      ? { ...plan, items: (items ?? []).filter(validItem).slice(0, 100) }
      : plan),
  };
}

function nextPlanId(book) {
  const used = new Set(book.plans.map((plan) => plan.id));
  for (let number = 1; number <= 100; number++) if (!used.has(`plan-${number}`)) return `plan-${number}`;
  return `plan-${Date.now().toString(36)}`;
}

export function createSchedulePlan(book, { name = "New plan", copy = false } = {}) {
  const normalized = normalizedBook(book);
  const id = nextPlanId(normalized);
  const items = copy ? activeSchedule(normalized).map((item) => ({ ...item })) : [];
  return { ...normalized, active: id, plans: [...normalized.plans, { id, name: cleanName(name), items }] };
}

export function selectSchedulePlan(book, id) {
  const normalized = normalizedBook(book);
  return normalized.plans.some((plan) => plan.id === String(id))
    ? { ...normalized, active: String(id) }
    : normalized;
}

export function renameSchedulePlan(book, id, name) {
  const normalized = normalizedBook(book);
  return {
    ...normalized,
    plans: normalized.plans.map((plan) => plan.id === String(id) ? { ...plan, name: cleanName(name, plan.name) } : plan),
  };
}

export function deleteSchedulePlan(book, id) {
  const normalized = normalizedBook(book);
  if (normalized.plans.length === 1) return normalized;
  const plans = normalized.plans.filter((plan) => plan.id !== String(id));
  return { ...normalized, plans, active: normalized.active === String(id) ? plans[0].id : normalized.active };
}

// Compatibility helpers keep the small public schedule API useful to callers
// that only need one plan, while persisting in the new named-plan format.
export function loadSchedule(storage = globalThis.localStorage) {
  return activeSchedule(loadScheduleBook(storage));
}

export function saveSchedule(items, storage = globalThis.localStorage) {
  return saveScheduleBook(replaceActiveSchedule(loadScheduleBook(storage), items), storage);
}

function ranges(item) {
  const found = [];
  const sections = [
    item.section,
    ...(item.included ?? []).map((part) => part.section),
    ...(item.choice ? [item.choice.section] : []),
  ];
  for (const section of sections) for (const meeting of distinctMeetings(section)) {
    const start = toMinutes(meeting.startTime);
    if (start == null) continue;
    const end = toMinutes(meeting.endTime) ?? start + 55;
    for (const day of DAY_KEYS) {
      if (meeting[day]) found.push({ day, start, end, meeting, section, item });
    }
  }
  return found;
}

/** Every pair that overlaps on at least one day. Adjacent classes do not conflict. */
export function scheduleConflicts(items) {
  const conflicts = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (String(items[i].term) !== String(items[j].term) || campusOf(items[i]) !== campusOf(items[j])) continue;
      const overlaps = [];
      for (const a of ranges(items[i])) {
        for (const b of ranges(items[j])) {
          if (a.day === b.day && a.start < b.end && b.start < a.end) overlaps.push(a.day);
        }
      }
      const days = [...new Set(overlaps)];
      if (days.length) conflicts.push({ a: items[i], b: items[j], days });
    }
  }
  return conflicts;
}

export function scheduleEntries(items, term, campus = DEFAULT_CAMPUS) {
  const entries = new Map();
  for (const item of items.filter((candidate) => inScope(candidate, term, campus))) {
    const parts = [
      { course: item.course, section: item.section },
      ...(item.included ?? []),
      ...(item.choice ? [item.choice] : []),
    ];
    for (const part of parts) {
      const key = `${part.course.subject}:${part.course.catalogNumber}`;
      if (!entries.has(key)) entries.set(key, { course: part.course, sections: [] });
      if (!entries.get(key).sections.some((section) => String(section.classNumber) === String(part.section.classNumber))) {
        entries.get(key).sections.push(part.section);
      }
    }
  }
  return [...entries.values()];
}

function courseCode(item) {
  return `${item.course.subject} ${item.course.catalogNumber}`;
}

export function registrationRows(items, term, campus = DEFAULT_CAMPUS) {
  const rows = [];
  const seen = new Set();
  for (const item of items.filter((candidate) => inScope(candidate, term, campus))) {
    const parts = [
      { course: item.course, section: item.section, role: "Primary" },
      ...(item.included ?? []).map((part) => ({ ...part, role: "Included" })),
      ...(item.choice ? [{ ...item.choice, role: "Linked choice" }] : []),
    ];
    for (const part of parts) {
      const number = String(part.section.classNumber);
      if (seen.has(number)) continue;
      seen.add(number);
      rows.push({
        classNumber: number,
        code: `${part.course.subject} ${part.course.catalogNumber}`,
        component: part.section.component ?? "Section",
        role: part.role,
        seats: seatsFor(number, term),
      });
    }
  }
  return rows;
}

export function registrationText(items, term, campus = DEFAULT_CAMPUS) {
  return registrationRows(items, term, campus)
    .map((row) => `${row.classNumber}\t${row.code}\t${row.component}${row.role === "Primary" ? "" : `\t${row.role}`}`)
    .join("\n");
}

/**
 * Flag consecutive in-person meetings whose gap is shorter than the estimated
 * walk. The estimator receives two meeting objects and returns whole minutes.
 */
export function scheduleTravelWarnings(items, term, campus = DEFAULT_CAMPUS, estimate = () => null) {
  const sessions = items.filter((item) => inScope(item, term, campus)).flatMap(ranges);
  const warnings = [];
  for (const day of DAY_KEYS) {
    const ordered = sessions.filter((session) => session.day === day).sort((a, b) => a.start - b.start);
    for (let index = 0; index < ordered.length - 1; index++) {
      const from = ordered[index];
      const to = ordered[index + 1];
      if (to.start < from.end) continue;
      const minutes = estimate(from.meeting, to.meeting);
      const gap = to.start - from.end;
      if (Number.isFinite(minutes) && minutes > gap) warnings.push({ day, gap, minutes, from, to });
    }
  }
  return warnings;
}

function conflictText(conflict) {
  const days = conflict.days.map((day) => day[0].toUpperCase() + day.slice(1, 3)).join(", ");
  return `${courseCode(conflict.a)} and ${courseCode(conflict.b)} overlap on ${days}.`;
}

function dayLabel(day) {
  return day[0].toUpperCase() + day.slice(1);
}

export function renderSchedule(items, term, {
  campus = DEFAULT_CAMPUS, calendar, onRemove, onClear, onShare, onChoose, onRegister,
  plans = [], activePlan = "", onPlanSelect, onPlanNew, onPlanDuplicate, onPlanRename, onPlanDelete,
  travelWarnings = [],
}) {
  const current = items.filter((item) => inScope(item, term, campus));
  const wrap = el("section", "plan");

  if (plans.length) {
    const variants = el("section", "plan-variants");
    const label = el("label", "eyebrow", "Schedule plan");
    const picker = el("select", "plan-picker");
    picker.setAttribute("aria-label", "Active schedule plan");
    for (const plan of plans) {
      const option = el("option", null, plan.name);
      option.value = plan.id;
      option.selected = plan.id === activePlan;
      picker.append(option);
    }
    picker.addEventListener("change", () => onPlanSelect?.(picker.value));
    label.append(picker);
    const name = el("input", "plan-name");
    name.type = "text";
    name.maxLength = 48;
    name.value = plans.find((plan) => plan.id === activePlan)?.name ?? "";
    name.setAttribute("aria-label", "Schedule plan name");
    name.addEventListener("change", () => onPlanRename?.(name.value));
    variants.append(label, name);
    for (const [text, callback, disabled] of [
      ["New", onPlanNew, false], ["Duplicate", onPlanDuplicate, false], ["Delete", onPlanDelete, plans.length <= 1],
    ]) {
      const button = el("button", "plan-action", text);
      button.type = "button";
      button.disabled = disabled;
      button.addEventListener("click", callback);
      variants.append(button);
    }
    wrap.append(variants);
  }

  const head = el("header", "plan-head");
  const heading = el("div");
  heading.append(el("p", "eyebrow", "My schedule"));
  heading.append(el("h2", "plan-title", `${current.length} selected section${current.length === 1 ? "" : "s"}`));
  head.append(heading);

  const actions = el("div", "plan-actions");
  const register = el("button", "plan-action", "Copy numbers");
  register.type = "button";
  register.disabled = !current.length;
  register.addEventListener("click", onRegister);
  actions.append(register);
  const share = el("button", "plan-action", "Share");
  share.type = "button";
  share.disabled = !current.length;
  share.addEventListener("click", onShare);
  actions.append(share);
  const clear = el("button", "plan-action", "Clear");
  clear.type = "button";
  clear.disabled = !current.length;
  clear.addEventListener("click", onClear);
  actions.append(clear);
  head.append(actions);
  wrap.append(head);

  if (!current.length) {
    wrap.append(el("p", "plan-empty", "Open a section from any search and choose Add to schedule."));
    return wrap;
  }

  const needsChoice = current.filter((item) => item.choices?.length && !item.choice);
  if (needsChoice.length) {
    const notice = el("section", "plan-needs");
    notice.setAttribute("role", "alert");
    notice.append(el("p", "eyebrow", "Required linked sections"));
    for (const item of needsChoice) {
      const group = el("div", "plan-choice");
      group.append(el("p", null, `${courseCode(item)} section ${item.section.classNumber} needs one of these:`));
      const options = el("div", "plan-choice-options");
      for (const part of item.choices) {
        const meeting = distinctMeetings(part.section)[0];
        const label = [
          `${part.section.component ?? "Section"} ${part.section.classNumber}`,
          meeting ? formatWhen(meeting) : "No set time",
        ].join(" · ");
        const button = el("button", "plan-choice-button", label);
        button.type = "button";
        button.addEventListener("click", () => onChoose(item, part));
        options.append(button);
      }
      group.append(options);
      notice.append(group);
    }
    wrap.append(notice);
  }

  const conflicts = scheduleConflicts(current);
  if (conflicts.length) {
    const alert = el("section", "plan-conflicts");
    alert.setAttribute("role", "alert");
    alert.append(el("p", "eyebrow", `${conflicts.length} time conflict${conflicts.length === 1 ? "" : "s"}`));
    const list = el("ul");
    for (const conflict of conflicts) list.append(el("li", null, conflictText(conflict)));
    alert.append(list);
    wrap.append(alert);
  } else {
    wrap.append(el("p", "plan-ok", "No time conflicts."));
  }

  if (travelWarnings.length) {
    const alert = el("section", "plan-travel");
    alert.setAttribute("role", "alert");
    alert.append(el("p", "eyebrow", `${travelWarnings.length} walking conflict${travelWarnings.length === 1 ? "" : "s"}`));
    const list = el("ul");
    for (const warning of travelWarnings) {
      const from = warning.from.meeting.buildingDescription || warning.from.meeting.facilityDescription;
      const to = warning.to.meeting.buildingDescription || warning.to.meeting.facilityDescription;
      list.append(el("li", null, `${dayLabel(warning.day)}: ${warning.gap} minutes between ${from} and ${to}; allow about ${warning.minutes}.`));
    }
    alert.append(list);
    wrap.append(alert);
  }

  wrap.append(calendar(scheduleEntries(current, term, campus), term));

  const checklist = el("section", "plan-registration");
  checklist.append(el("p", "eyebrow", "Registration checklist"));
  const checklistRows = el("ol");
  for (const row of registrationRows(current, term, campus)) {
    const status = row.seats ? (row.seats.full ? "full" : `${Math.max(0, row.seats.limit - row.seats.enrolled)} seats left`) : "seat status unknown";
    checklistRows.append(el("li", null, `${row.classNumber} · ${row.code} · ${row.component} · ${status}`));
  }
  checklist.append(checklistRows);
  wrap.append(checklist);

  const list = el("ul", "plan-list");
  for (const item of current) {
    const row = el("li", "plan-item");
    row.dataset.classNumber = String(item.section.classNumber);
    const summary = el("button", "plan-open");
    summary.type = "button";
    summary.dataset.classNumber = String(item.section.classNumber);
    summary.append(el("strong", null, courseCode(item)));
    summary.append(el("span", null, `Section ${item.section.classNumber}`));
    const meeting = distinctMeetings(item.section)[0];
    summary.append(el("span", null, meeting ? `${formatWhen(meeting)} · ${formatPlace(meeting, item.section)}` : "No set time"));
    const people = instructorsOf(item.section).map((person) => person.name).join(" & ");
    if (people) summary.append(el("span", null, people));
    const included = [...(item.included ?? []), ...(item.choice ? [item.choice] : [])];
    if (included.length) {
      summary.append(el("span", "plan-included", `Includes section${included.length === 1 ? "" : "s"} ${included.map((part) => part.section.classNumber).join(", ")}`));
    }
    const seats = seatsFor(item.section.classNumber, term);
    if (seats) {
      const status = unreachable(item.section.classNumber, term) || seats.full
        ? `Full · ${seats.enrolled}/${seats.limit}`
        : `${Math.max(0, seats.limit - seats.enrolled)} seats left`;
      summary.append(el("span", "plan-seats", status));
    }
    row.append(summary);
    const remove = el("button", "plan-remove", "Remove");
    remove.type = "button";
    remove.dataset.removeClass = String(item.section.classNumber);
    remove.setAttribute("aria-label", `Remove ${courseCode(item)} section ${item.section.classNumber} from schedule`);
    remove.addEventListener("click", () => onRemove(item));
    row.append(remove);
    list.append(row);
  }
  wrap.append(list);
  return wrap;
}
