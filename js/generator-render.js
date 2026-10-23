import { formatWhen, instructorsOf } from "./format.js";

const WEIGHTS = [
  ["seats", "Open seats"],
  ["rating", "Instructor ratings"],
  ["grades", "Grade history"],
  ["lateStart", "Later starts"],
  ["earlyEnd", "Earlier finishes"],
  ["compactDays", "Fewer campus days"],
  ["compactGaps", "Shorter gaps"],
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clock(minutes) {
  if (!Number.isFinite(minutes)) return "—";
  const hour = Math.floor(minutes / 60);
  const shown = hour % 12 || 12;
  return `${shown}:${String(Math.round(minutes) % 60).padStart(2, "0")}${hour < 12 ? "a" : "p"}`;
}

function metric(value, label) {
  const item = el("div", "gen-metric");
  item.append(el("strong", null, value), el("span", null, label));
  return item;
}

function resultCard(result, index, onUse) {
  const card = el("article", "gen-result");
  const head = el("header", "gen-result-head");
  const title = el("div");
  title.append(el("p", "eyebrow", `Option ${index + 1}`));
  title.append(el("h3", "gen-result-title", `${Math.round(result.score)} match`));
  const use = el("button", "gen-use", "Use this schedule");
  use.type = "button";
  use.addEventListener("click", () => onUse(result));
  head.append(title, use);
  card.append(head);

  const metrics = el("div", "gen-metrics");
  const m = result.metrics;
  metrics.append(
    metric(m.minSeats == null ? "—" : String(m.minSeats), "minimum seats"),
    metric(m.rating == null ? "—" : m.rating.toFixed(1), "average rating"),
    metric(m.gpa == null ? "—" : m.gpa.toFixed(2), "historical GPA"),
    metric(String(m.days), "campus days"),
    metric(`${m.gaps} min`, "weekly gaps"),
    metric(`${clock(m.averageStart)}–${clock(m.averageEnd)}`, "average day"),
  );
  card.append(metrics);

  const list = el("ul", "gen-sections");
  for (const pkg of result.packages) {
    const item = el("li");
    const code = `${pkg.course.subject} ${pkg.course.catalogNumber}`;
    const numbers = pkg.sections.map((section) => section.classNumber).join(", ");
    const people = [...new Set(pkg.sections.flatMap((section) => instructorsOf(section).map((person) => person.name)))];
    const first = pkg.sections.flatMap((section) => section.meetings ?? [])[0];
    item.append(el("strong", null, code));
    item.append(el("span", null, `Sections ${numbers}${first ? ` · ${formatWhen(first)}` : ""}`));
    if (people.length) item.append(el("span", null, people.join(" & ")));
    list.append(item);
  }
  card.append(list);
  return card;
}

export function renderGenerator({
  desired, preferences, results = [], phase = "idle", note = "",
  onBack, onAdd, onRemove, onGenerate, onUse,
}) {
  const wrap = el("section", "generator");
  const head = el("header", "gen-head");
  const heading = el("div");
  heading.append(el("p", "eyebrow", "Automatic schedule generator"));
  heading.append(el("h2", "gen-title", "Build a conflict-free schedule"));
  const back = el("button", "plan-action", "Back to my schedule");
  back.type = "button";
  back.addEventListener("click", onBack);
  head.append(heading, back);
  wrap.append(head);
  wrap.append(el("p", "gen-intro", "Add each course you want. Finder will keep linked lectures, labs and recitations together, then rank complete schedules using the priorities below."));

  const addForm = el("form", "gen-add");
  const label = el("label", "f-label", "Desired course");
  label.setAttribute("for", "gen-course");
  const input = el("input", "f-ctl");
  input.setAttribute("id", "gen-course");
  input.type = "text";
  input.placeholder = "CSE 2221";
  input.autocomplete = "off";
  const add = el("button", "gen-add-button", "Add course");
  add.type = "submit";
  addForm.append(label, input, add);
  addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (onAdd(input.value)) input.value = "";
  });
  wrap.append(addForm);

  const chips = el("ul", "gen-courses");
  for (const code of desired) {
    const item = el("li");
    const remove = el("button", "gen-course-chip", `${code} ×`);
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${code}`);
    remove.addEventListener("click", () => onRemove(code));
    item.append(remove);
    chips.append(item);
  }
  wrap.append(chips);

  const form = el("form", "gen-preferences");
  const legend = el("h3", "gen-subtitle", "Constraints and priorities");
  form.append(legend);

  const bounds = el("div", "gen-bounds");
  const earliestLabel = el("label", "f-label", "No class before");
  const earliest = el("input", "f-ctl");
  earliest.type = "time";
  earliest.value = preferences.earliest ?? "";
  earliestLabel.append(earliest);
  const latestLabel = el("label", "f-label", "No class after");
  const latest = el("input", "f-ctl");
  latest.type = "time";
  latest.value = preferences.latest ?? "";
  latestLabel.append(latest);
  const fullLabel = el("label", "gen-check");
  const excludeFull = el("input");
  excludeFull.type = "checkbox";
  excludeFull.checked = preferences.excludeFull !== false;
  fullLabel.append(excludeFull, document.createTextNode("Exclude full registration packages"));
  bounds.append(earliestLabel, latestLabel, fullLabel);
  form.append(bounds);

  const weights = el("div", "gen-weights");
  const controls = new Map();
  for (const [key, text] of WEIGHTS) {
    const control = el("label", "gen-weight");
    control.append(el("span", null, text));
    const range = el("input");
    range.type = "range";
    range.min = "0";
    range.max = "3";
    range.step = "1";
    range.value = String(preferences.weights?.[key] ?? 1);
    range.setAttribute("aria-label", `${text} priority, zero to three`);
    controls.set(key, range);
    control.append(range);
    weights.append(control);
  }
  form.append(weights);

  const generate = el("button", "gen-generate", phase === "loading" ? "Generating…" : "Generate schedules");
  generate.type = "submit";
  generate.disabled = phase === "loading" || desired.length < 2;
  form.append(generate);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onGenerate({
      earliest: earliest.value,
      latest: latest.value,
      excludeFull: excludeFull.checked,
      weights: Object.fromEntries([...controls].map(([key, input]) => [key, Number(input.value)])),
    });
  });
  wrap.append(form);

  if (note) {
    const status = el("p", phase === "error" ? "gen-note is-error" : "gen-note", note);
    status.setAttribute("role", phase === "error" ? "alert" : "status");
    wrap.append(status);
  }

  if (results.length) {
    const list = el("div", "gen-results");
    list.append(el("h3", "gen-subtitle", `${results.length} best schedule${results.length === 1 ? "" : "s"}`));
    results.forEach((result, index) => list.append(resultCard(result, index, onUse)));
    wrap.append(list);
  }

  return wrap;
}
