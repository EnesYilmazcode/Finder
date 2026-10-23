import { formatWhen, instructorsOf } from "./format.js";

const WEIGHTS = [
  ["seats", "Open seats"],
  ["rating", "RateMyProfessors rating"],
  ["lateStart", "Later starts"],
  ["earlyEnd", "Earlier finishes"],
  ["compactGaps", "Shorter gaps"],
];

const MODE_CHOICES = [
  ["inPerson", "In person"],
  ["hybrid", "Hybrid"],
  ["distance", "Online / distance"],
  ["arranged", "Arranged / other"],
];

const PRIORITY_LABELS = ["Ignore", "Tie-breaker", "Important", "Very important"];
const FACTOR_LABELS = new Map(WEIGHTS);

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

function factorBreakdown(result, weights) {
  const available = Object.entries(result.factors ?? {})
    .filter(([key, value]) => Number.isFinite(value) && Number(weights?.[key]) > 0)
    .sort((a, b) => (Number(weights[b[0]]) * b[1]) - (Number(weights[a[0]]) * a[1]))
    .slice(0, 3)
    .map(([key, value]) => `${FACTOR_LABELS.get(key) ?? key}: ${value >= 67 ? "strong" : value >= 34 ? "mixed" : "weak"}`);
  return available.length ? available.join(" · ") : "No ranking priorities selected";
}

function resultCard(result, index, preferences, pins, onUse, onPin) {
  const card = el("article", "gen-result");
  const head = el("header", "gen-result-head");
  const title = el("div");
  title.append(el("p", "eyebrow", index === 0 ? "Top result" : `Option ${index + 1}`));
  title.append(el("h3", "gen-result-title", index === 0 ? "Best fit" : `Alternative ${index + 1}`));
  title.append(el("p", "gen-factors", factorBreakdown(result, preferences.weights)));
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
    const identity = el("div", "gen-section-name");
    identity.append(el("strong", null, code));
    const pinKey = pkg.desiredKey ?? code;
    const pinned = pins?.[pinKey] === pkg.packageKey;
    const pin = el("button", `gen-pin${pinned ? " is-pinned" : ""}`, pinned ? "Pinned" : "Pin");
    pin.type = "button";
    pin.setAttribute("aria-pressed", String(pinned));
    pin.setAttribute("aria-label", `${pinned ? "Unpin" : "Pin"} ${code} sections ${numbers}`);
    pin.addEventListener("click", () => onPin(pkg));
    identity.append(pin);
    item.append(identity);
    item.append(el("span", null, `Sections ${numbers}${first ? ` · ${formatWhen(first)}` : " · No set meeting time"}`));
    if (people.length) item.append(el("span", null, people.join(" & ")));
    list.append(item);
  }
  card.append(list);
  return card;
}

export function renderGenerator({
  desired, preferences, results = [], phase = "idle", note = "", pins = {},
  onBack, onAdd, onRemove, onSuggest = async () => [], onGenerate, onUse, onPin = () => {},
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
  wrap.append(el("p", "gen-intro", "Add each course you want. Finder keeps linked lectures, labs and recitations together, applies busy times from Filters, then ranks complete schedules using your priorities."));

  const addForm = el("form", "gen-add");
  const label = el("label", "f-label", "Desired course");
  label.setAttribute("for", "gen-course");
  const input = el("input", "f-ctl");
  input.setAttribute("id", "gen-course");
  input.type = "text";
  input.placeholder = "Course number or name";
  input.autocomplete = "off";
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "gen-suggestions");
  const suggestions = el("ul", "gen-suggestions");
  suggestions.setAttribute("id", "gen-suggestions");
  suggestions.setAttribute("role", "listbox");
  suggestions.hidden = true;
  let suggestionRequest = 0;
  const showSuggestions = async () => {
    const request = ++suggestionRequest;
    const choices = await onSuggest(input.value);
    if (request !== suggestionRequest) return;
    suggestions.replaceChildren();
    for (const choice of choices) {
      const item = el("li");
      item.setAttribute("role", "option");
      const button = el("button", "gen-suggestion");
      button.type = "button";
      button.append(el("strong", null, choice.code), el("span", null, choice.title));
      button.addEventListener("click", async () => {
        if (await onAdd(choice)) input.value = "";
        suggestions.hidden = true;
      });
      item.append(button);
      suggestions.append(item);
    }
    suggestions.hidden = choices.length === 0;
  };
  input.addEventListener("input", showSuggestions);
  input.addEventListener("focus", showSuggestions);
  const inputWrap = el("div", "gen-input-wrap");
  inputWrap.append(input, suggestions);
  const add = el("button", "gen-add-button", "Add course");
  add.type = "submit";
  addForm.append(label, inputWrap, add);
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (await onAdd(input.value)) {
      input.value = "";
      suggestions.hidden = true;
    }
  });
  wrap.append(addForm);

  const chips = el("ul", "gen-courses");
  for (const choice of desired) {
    const code = choice.code ?? choice;
    const key = choice.key ?? code;
    const item = el("li");
    const remove = el("button", "gen-course-chip", `${code}${choice.family ? " (any version)" : ""} ×`);
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${code}`);
    remove.addEventListener("click", () => onRemove(key));
    item.append(remove);
    chips.append(item);
  }
  wrap.append(chips);

  const form = el("form", "gen-preferences");
  form.append(el("h3", "gen-subtitle", "Constraints and priorities"));

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
  fullLabel.append(excludeFull, document.createTextNode("Only open classes"));
  const fullHelp = el("span", "gen-help", "ⓘ");
  fullHelp.title = "Hide any choice where a required lecture, lab, or recitation is full.";
  fullHelp.tabIndex = 0;
  fullHelp.setAttribute("aria-label", fullHelp.title);
  fullLabel.append(fullHelp);
  bounds.append(earliestLabel, latestLabel, fullLabel);
  form.append(bounds);

  const modes = el("fieldset", "gen-modes");
  modes.append(el("legend", "f-label", "Instruction modes"));
  const modeControls = new Map();
  for (const [key, text] of MODE_CHOICES) {
    const modeLabel = el("label", "gen-check");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = preferences.allowedModes?.includes(key) ?? true;
    modeControls.set(key, checkbox);
    modeLabel.append(checkbox, document.createTextNode(text));
    modes.append(modeLabel);
  }
  modes.append(el("span", "gen-mode-note", "Online / distance includes classes with no set meeting time."));
  form.append(modes);

  const weights = el("div", "gen-weights");
  const controls = new Map();
  for (const [key, text] of WEIGHTS) {
    const control = el("label", "gen-weight");
    const name = el("span", "gen-weight-name", text);
    if (key === "rating") {
      const help = el("span", "gen-help", "ⓘ");
      help.title = "Uses the instructor's overall RateMyProfessors rating when at least 5 ratings are available. Unrated instructors are neutral.";
      help.tabIndex = 0;
      help.setAttribute("aria-label", help.title);
      name.append(document.createTextNode(" "), help);
    }
    control.append(name);
    const range = el("input");
    range.type = "range";
    range.min = "0";
    range.max = "3";
    range.step = "1";
    range.value = String(preferences.weights?.[key] ?? 1);
    range.setAttribute("aria-label", `${text} priority, zero to three`);
    const output = el("output", "gen-weight-value", PRIORITY_LABELS[Number(range.value)]);
    range.addEventListener("input", () => { output.textContent = PRIORITY_LABELS[Number(range.value)]; });
    controls.set(key, range);
    control.append(range, output);
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
      allowedModes: [...modeControls].filter(([, checkbox]) => checkbox.checked).map(([key]) => key),
      weights: Object.fromEntries([...controls].map(([key, range]) => [key, Number(range.value)])),
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
    list.append(el("h3", "gen-subtitle", `${results.length} schedule${results.length === 1 ? "" : "s"}`));
    results.forEach((result, index) => list.append(resultCard(result, index, preferences, pins, onUse, onPin)));
    wrap.append(list);
  }

  return wrap;
}
