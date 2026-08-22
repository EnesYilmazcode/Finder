// The smallest document js/app.js will run against.
//
// app.js is the one module that is pure wiring: it reads the page, hands the
// data to the pure modules and writes the page back. Its bugs live in that
// wiring, so reaching them means giving it a document. This is not a DOM
// implementation, only the node properties app.js and js/render.js touch.

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parent = null;
    this.dataset = {};
    this.className = "";
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.attrs = new Map();
    this.listeners = new Map();
  }

  // Text lives in childNodes so appending a span after setting text reads back
  // as one string, the way "40/40" plus a "+1" waitlist span does.
  get textContent() {
    return this.childNodes.map((n) => (typeof n === "string" ? n : n.textContent)).join("");
  }

  set textContent(text) {
    this.childNodes = text == null || text === "" ? [] : [String(text)];
  }

  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      add: (name) => { if (!names().includes(name)) this.className = [...names(), name].join(" "); },
      remove: (name) => { this.className = names().filter((n) => n !== name).join(" "); },
      toggle: (name, on) => { if (on) this.classList.add(name); else this.classList.remove(name); },
      contains: (name) => names().includes(name),
    };
  }

  append(...nodes) { this.childNodes.push(...this.own(nodes)); }
  replaceChildren(...nodes) { this.childNodes = this.own(nodes); }

  // Parents are tracked only so closest() can walk up, which is how app.js
  // finds the row behind a click on the results pane.
  own(nodes) {
    for (const node of nodes) if (typeof node !== "string") node.parent = this;
    return [...nodes];
  }

  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }

  matches(selector) {
    return selector.split(",").some((one) => {
      const want = one.trim();
      return want.startsWith(".")
        ? this.className.split(/\s+/).includes(want.slice(1))
        : this.tagName === want.toUpperCase();
    });
  }

  querySelectorAll(selector) {
    const found = [];
    for (const child of this.childNodes) {
      if (typeof child === "string") continue;
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  closest(selector) {
    for (let node = this; node; node = node.parent) if (node.matches(selector)) return node;
    return null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    for (const handler of this.listeners.get(event.type) ?? []) handler(event);
    return true;
  }

  focus() {}
  reset() {}
}

/** readFilters reads the three selects through FormData, so it needs one. */
class FakeFormData {
  constructor(form) { this.form = form; }
  get(name) { return this.form[name]?.value ?? null; }
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

/** index.html, reduced to the elements app.js looks up by selector. */
function buildPage() {
  const nodes = new Map();
  const add = (selector, tag = "div") => {
    const node = new El(tag);
    nodes.set(selector, node);
    return node;
  };

  add(".app");
  add("#search", "form");
  add("#rail");
  add("#rail-toggle", "button");
  add("#detail", "aside");
  add("#detail-body");
  add("#detail-back", "button");
  const filters = add("#filters", "form");
  const days = add("#f-days");
  add("#p-subject", "input");
  add("#p-number", "input");
  add("#subject-list", "datalist");
  add("#number-list", "datalist");
  add("#p-hint", "p");
  add("#welcome", "section").hidden = true;
  add("#w-stats", "p");
  add("#w-sub", "p");
  add("#w-list", "ul");
  add("#view-list", "button");
  add("#view-cal", "button");
  add("#f-clear", "button").hidden = true;
  add("#q", "input");
  add("#term", "select").disabled = true;
  add("#go", "button");
  add("#status", "p");
  add("#results");

  for (const day of DAYS) {
    const button = new El("button");
    button.className = "f-day";
    button.dataset.day = day;
    button.dataset.state = "any";
    days.append(button);
  }

  // The filter form's fields are reached by name, both through FormData and
  // directly as filters.hideFull.checked.
  for (const name of ["from", "to", "rating"]) filters[name] = new El("select");
  for (const name of ["hideFull", "hideOnline", "ratedOnly"]) filters[name] = new El("input");

  const document = {
    createElement: (tag) => new El(tag),
    createTextNode: (text) => String(text),
    createDocumentFragment: () => new El("#fragment"),
    querySelector: (selector) => nodes.get(selector) ?? null,
  };

  return { document, el: (selector) => nodes.get(selector) };
}

export class DomEvent {
  constructor(type, target = null) {
    this.type = type;
    this.target = target;
  }

  preventDefault() {}
}

/** Poll until a condition holds, since app.js exports no way to await its work. */
export async function until(predicate, tries = 500) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return false;
}

let mounts = 0;

/**
 * Start app.js against a fresh page.
 *
 * The `?mount=` query gives each mount its own copy of app.js, since it holds
 * the search state at module level and runs init() on import. The modules it
 * imports are shared, which is what we want: the snapshots stay loaded.
 */
export async function mountApp({ query = "", term = "", fetch }) {
  const page = buildPage();
  const search = `?q=${encodeURIComponent(query)}&term=${encodeURIComponent(term)}`;

  globalThis.document = page.document;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
  globalThis.location = { href: `https://finder.test/Finder/${search}`, search };
  globalThis.history = { replaceState() {} };
  globalThis.FormData = FakeFormData;
  globalThis.fetch = fetch;

  await import(`../js/app.js?mount=${++mounts}`);
  return page;
}
