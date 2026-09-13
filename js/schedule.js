import { distinctMeetings, formatWhen, formatPlace, instructorsOf } from "./format.js";
import { toMinutes } from "./filters.js";
import { seatsFor, unreachable } from "./seats.js";

export const SCHEDULE_STORAGE_KEY = "finder.schedule.v1";
const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MAX_SHARED_SECTIONS = 24;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function scheduleKey(item) {
  return `${item?.term ?? ""}:${item?.section?.classNumber ?? ""}`;
}

function validItem(item) {
  return item && typeof item === "object"
    && String(item.term ?? "").length > 0
    && String(item.section?.classNumber ?? "").length > 0
    && String(item.course?.subject ?? "").length > 0
    && String(item.course?.catalogNumber ?? "").length > 0;
}

export function addScheduleItem(items, item) {
  if (!validItem(item)) return [...items];
  const key = scheduleKey(item);
  return [...items.filter((old) => scheduleKey(old) !== key), item];
}

export function removeScheduleItem(items, term, classNumber) {
  const key = `${term}:${classNumber}`;
  return items.filter((item) => scheduleKey(item) !== key);
}

export function isScheduled(items, term, classNumber) {
  const key = `${term}:${classNumber}`;
  return items.some((item) => scheduleKey(item) === key);
}

export function scheduleIds(items, term) {
  return items
    .filter((item) => String(item.term) === String(term))
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

export function loadSchedule(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SCHEDULE_STORAGE_KEY) ?? "null");
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter(validItem).slice(0, 100);
  } catch {
    return [];
  }
}

export function saveSchedule(items, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify({ version: 1, items: items.filter(validItem) }));
    return true;
  } catch {
    return false;
  }
}

function ranges(item) {
  const found = [];
  const sections = [item.section, ...(item.included ?? []).map((part) => part.section)];
  for (const section of sections) for (const meeting of distinctMeetings(section)) {
    const start = toMinutes(meeting.startTime);
    if (start == null) continue;
    const end = toMinutes(meeting.endTime) ?? start + 55;
    for (const day of DAY_KEYS) {
      if (meeting[day]) found.push({ day, start, end });
    }
  }
  return found;
}

/** Every pair that overlaps on at least one day. Adjacent classes do not conflict. */
export function scheduleConflicts(items) {
  const conflicts = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (String(items[i].term) !== String(items[j].term)) continue;
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

export function scheduleEntries(items, term) {
  const entries = new Map();
  for (const item of items.filter((candidate) => String(candidate.term) === String(term))) {
    for (const part of [{ course: item.course, section: item.section }, ...(item.included ?? [])]) {
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

function conflictText(conflict) {
  const days = conflict.days.map((day) => day[0].toUpperCase() + day.slice(1, 3)).join(", ");
  return `${courseCode(conflict.a)} and ${courseCode(conflict.b)} overlap on ${days}.`;
}

export function renderSchedule(items, term, { calendar, onRemove, onClear, onShare }) {
  const current = items.filter((item) => String(item.term) === String(term));
  const wrap = el("section", "plan");

  const head = el("header", "plan-head");
  const heading = el("div");
  heading.append(el("p", "eyebrow", "My schedule"));
  heading.append(el("h2", "plan-title", `${current.length} selected section${current.length === 1 ? "" : "s"}`));
  head.append(heading);

  const actions = el("div", "plan-actions");
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

  wrap.append(calendar(scheduleEntries(current, term), term));

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
    if (item.included?.length) {
      summary.append(el("span", "plan-included", `Includes section${item.included.length === 1 ? "" : "s"} ${item.included.map((part) => part.section.classNumber).join(", ")}`));
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
