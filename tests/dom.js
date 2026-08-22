// A document small enough to run js/app.js under node:test.
//
// app.js is wiring: state, event handlers and repaints. None of that is
// reachable from the pure-module tests, so this builds the page out of the real
// index.html and implements the DOM pieces js/ actually touches.
//
// Parsing the shipped markup rather than listing its ids is the point. Every
// shim that named its own elements died the first time index.html grew a
// control: the lookup returned null and init() threw during import, before a
// single assertion ran.

import { readFileSync } from "node:fs";

const INDEX = new URL("../index.html", import.meta.url);
const PAGE = "https://enesyilmazcode.github.io/Finder/";

const VOID = new Set(["input", "meta", "link", "br", "img", "hr", "source", "col"]);

const attrName = (key) => `data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// Focus is a document-wide singleton, so it lives here rather than on a node.
let focused = null;

class TextNode {
  constructor(data) {
    this.nodeType = 3;
    this.data = String(data);
    this.parentNode = null;
  }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

class ClassList {
  constructor(node) { this.node = node; }
  get names() { return (this.node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean); }
  contains(name) { return this.names.includes(name); }
  add(name) { if (!this.contains(name)) this.node.setAttribute("class", [...this.names, name].join(" ")); }
  remove(name) { this.node.setAttribute("class", this.names.filter((n) => n !== name).join(" ")); }
  toggle(name, force) { if (force ?? !this.contains(name)) this.add(name); else this.remove(name); }
}

// js/ assigns style properties directly and only reaches for a method to set
// custom properties, which cannot be written as an identifier.
class Style {
  setProperty(name, value) { this[name] = String(value); }
}

/** The listener half of an EventTarget. The window needs one as much as an element does. */
class Listeners {
  constructor() { this.handlers = new Map(); }

  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((h) => h !== handler));
  }

  // Bubbles, since app.js delegates every click on the results pane. The window
  // has no parentNode, so the same walk stops after one step there.
  dispatchEvent(event) {
    event.target ??= this;
    for (let at = this; at; at = at.parentNode) {
      event.currentTarget = at;
      for (const handler of at.handlers?.get(event.type) ?? []) handler.call(at, event);
    }
    return !event.defaultPrevented;
  }
}

class Element extends Listeners {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attrs = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.style = new Style();
    this.classList = new ClassList(this);
    this.dataset = new Proxy({}, {
      get: (_target, key) => this.attrs.get(attrName(key)),
      set: (_target, key, value) => { this.attrs.set(attrName(key), String(value)); return true; },
      has: (_target, key) => this.attrs.has(attrName(key)),
    });
  }

  get id() { return this.attrs.get("id") ?? ""; }
  get className() { return this.attrs.get("class") ?? ""; }
  set className(value) { this.attrs.set("class", String(value)); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get options() { return this.children.filter((n) => n.tagName === "OPTION"); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value != null && value !== "") this.append(new TextNode(value));
  }

  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }

  append(...nodes) {
    for (const node of nodes) {
      if (node == null) continue;
      const child = node.nodeType ? node : new TextNode(node);
      // A fragment hands its children over and stays empty, like the real one.
      if (child.nodeType === 11) { this.append(...child.childNodes.splice(0)); continue; }
      // A node can only be in one place. Without this a moved node stays in its
      // old parent's childNodes too, and a row that moved reads as two rows.
      child.parentNode?.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }

  removeChild(node) {
    const at = this.childNodes.indexOf(node);
    if (at >= 0) this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }

  remove() { this.parentNode?.removeChild(this); }

  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  matches(selector) { return compile(selector)(this); }

  closest(selector) {
    const test = compile(selector);
    for (let node = this; node; node = node.parentNode) if (node.nodeType === 1 && test(node)) return node;
    return null;
  }

  // An array rather than a NodeList. Nothing in js/ relies on either shape, and
  // tests get map, find and includes for free.
  querySelectorAll(selector) {
    const test = compile(selector);
    const found = [];
    walk(this, (node) => { if (test(node)) found.push(node); });
    return found;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  click() { fire(this, "click"); }

  focus() { focused = this; }

  reset() {
    for (const control of this.querySelectorAll("input, select, textarea")) {
      control.value = control.defaultValue ?? "";
      control.checked = control.defaultChecked ?? false;
    }
  }
}

function walk(node, visit) {
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    visit(child);
    walk(child, visit);
  }
}

const COMPOUND = /[a-zA-Z][-\w]*|[#.][-\w]+|\[[^\]]+\]/g;
const compiled = new Map();

/**
 * Enough selector syntax for what js/ and the app suites ask for: a comma list
 * of compounds built from tag, #id, .class and [attr] or [attr=value], joined
 * by the descendant and child combinators.
 *
 * Descendants are matched rather than refused because the page repeats classes:
 * with two .f-day groups in the rail, an unscoped ".f-day" quietly answers a
 * different question than the one the test asked. Sibling combinators still
 * throw, since a right-to-left walk cannot answer them and matching nothing is
 * indistinguishable from "no such element".
 */
function compile(selector) {
  const key = String(selector);
  if (!compiled.has(key)) {
    const tests = key.split(",").map((s) => s.trim()).filter(Boolean).map((part) => {
      const steps = parseComplex(part);
      return (node) => matchSteps(node, steps, steps.length - 1);
    });
    compiled.set(key, (node) => tests.some((test) => test(node)));
  }
  return compiled.get(key);
}

function parseComplex(part) {
  const steps = [];
  let combinator = null;
  let token = "";
  let depth = 0;
  const flush = () => {
    if (!token) return;
    steps.push({ combinator, tokens: token.match(COMPOUND) ?? [] });
    token = "";
    combinator = " ";
  };
  for (const ch of part) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    // Inside brackets a space belongs to the attribute value, not the selector.
    if (depth === 0 && /\s/.test(ch)) { flush(); continue; }
    if (depth === 0 && ch === ">") { flush(); combinator = ">"; continue; }
    if (depth === 0 && (ch === "+" || ch === "~")) throw new Error(`unsupported selector: ${part}`);
    token += ch;
  }
  flush();
  return steps;
}

function matchSteps(node, steps, i) {
  if (!steps[i].tokens.every((token) => matchToken(node, token))) return false;
  if (i === 0) return true;
  if (steps[i].combinator === ">") {
    const up = node.parentNode;
    return up?.nodeType === 1 ? matchSteps(up, steps, i - 1) : false;
  }
  for (let up = node.parentNode; up?.nodeType === 1; up = up.parentNode) {
    if (matchSteps(up, steps, i - 1)) return true;
  }
  return false;
}

function matchToken(node, token) {
  if (token[0] === "#") return node.id === token.slice(1);
  if (token[0] === ".") return node.classList.contains(token.slice(1));
  if (token[0] === "[") {
    const parsed = /^\[([-\w]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(token);
    if (!parsed) return false;
    const value = node.getAttribute(parsed[1]);
    if (value == null) return false;
    return parsed[2] === undefined || value === parsed[2];
  }
  return node.tagName === token.toUpperCase();
}

class FakeEvent {
  constructor(type) {
    this.type = type;
    this.target = null;
    this.currentTarget = null;
    this.defaultPrevented = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() {}
}

const NEVER_SUBMITS = new Set(["button", "reset"]);

// The form this event submits, if any. A button with no type is a submit
// button; nothing else here defaults.
function submitTarget(node, event) {
  const type = node.type ?? (node.tagName === "BUTTON" ? "submit" : "text");
  const submits = event.type === "click"
    ? type === "submit" && (node.tagName === "BUTTON" || node.tagName === "INPUT")
    : event.type === "keydown" && event.key === "Enter"
      && node.tagName === "INPUT" && !NEVER_SUBMITS.has(type);
  return submits ? node.closest("form") : null;
}

/**
 * Fire an event on a node and let it bubble. `props` carries the fields a
 * handler reads off the event, such as the `key` on a keydown.
 *
 * The default action runs afterwards, so a click on a submit button and Enter
 * in a text field both reach the form's handler, and preventDefault stops them
 * the way it would on the page. The event handed back is the one fired: a
 * cancelled submit does not mark the click that led to it, so assert on what
 * the handler did rather than on the flag.
 */
export function fire(node, type, props = {}) {
  const event = Object.assign(new FakeEvent(type), props);
  node.dispatchEvent(event);
  const form = event.defaultPrevented ? null : submitTarget(node, event);
  if (form) fire(form, "submit");
  return event;
}

const TAG = /<(\/?)([a-zA-Z][-\w]*)((?:\s+[^>]*?)?)\/?>/g;
const ATTR = /([-\w]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseBody(html) {
  const inner = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");

  const body = new Element("body");
  const stack = [body];
  let last = 0;
  for (const match of inner.matchAll(TAG)) {
    const text = inner.slice(last, match.index);
    if (text.trim()) stack.at(-1).append(new TextNode(text));
    last = match.index + match[0].length;

    const [, closing, tag, attrs] = match;
    const name = tag.toLowerCase();
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = new Element(name);
    for (const attr of attrs.matchAll(ATTR)) {
      node.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    // The properties the code reads, which a real parser reflects from markup.
    if (node.hasAttribute("name")) node.name = node.getAttribute("name");
    if (node.hasAttribute("value")) node.value = node.getAttribute("value");
    if (node.hasAttribute("type")) node.type = node.getAttribute("type");
    node.checked = node.hasAttribute("checked");
    node.disabled = node.hasAttribute("disabled");
    node.hidden = node.hasAttribute("hidden");
    stack.at(-1).append(node);
    if (!VOID.has(name)) stack.push(node);
  }
  return body;
}

/** Named controls hang off the form, the way readFilters and writeFilters use them. */
function wireForms(body) {
  for (const control of body.querySelectorAll("input, select, textarea")) {
    // A select with nothing selected shows its first option, and that is what
    // reset() puts back. A control whose default is not "" needs this.
    if (control.tagName === "SELECT") control.value = control.querySelector("option")?.getAttribute("value") ?? "";
    control.defaultValue = control.value;
    control.defaultChecked = control.checked;
  }
  for (const form of body.querySelectorAll("form")) {
    for (const control of form.querySelectorAll("input, select, textarea")) {
      if (control.name) form[control.name] = control;
    }
  }
}

class FormDataStub {
  constructor(form) { this.controls = form.querySelectorAll("input, select, textarea"); }
  get(name) {
    const control = this.controls.find((c) => c.name === name);
    if (!control) return null;
    if (control.type === "checkbox") return control.checked ? control.value || "on" : null;
    return control.value ?? null;
  }
  getAll(name) {
    return this.controls
      .filter((c) => c.name === name && (c.type !== "checkbox" || c.checked))
      .map((c) => c.value ?? "");
  }
}

/** A real URL, so syncUrl and the shared ?class= and ?gen= links are readable. */
class FakeLocation {
  constructor(href) { this.href = String(href); }
  get search() { return new URL(this.href).search; }
  get pathname() { return new URL(this.href).pathname; }
  get hostname() { return new URL(this.href).hostname; }
  get origin() { return new URL(this.href).origin; }
  get hash() { return new URL(this.href).hash; }
  assign(next) { this.href = new URL(String(next), this.href).href; }
  toString() { return this.href; }
}

class FakeWindow extends Listeners {
  constructor() {
    super();
    this.media = new Map();
  }
  // One object per query, so a test can reach the same media query app.js holds
  // and fire a change on it.
  matchMedia(query) {
    if (!this.media.has(query)) {
      this.media.set(query, Object.assign(new Listeners(), { matches: false, media: query }));
    }
    return this.media.get(query);
  }
}

function makeHistory(location, window) {
  const previous = [];
  return {
    get length() { return previous.length + 1; },
    pushState(_state, _title, next) { previous.push(location.href); location.assign(next); },
    replaceState(_state, _title, next) { location.assign(next); },
    back() {
      if (!previous.length) return;
      location.href = previous.pop();
      window.dispatchEvent(new FakeEvent("popstate"));
    },
  };
}

// A URL to read, or the markup itself. Only markup can contain a tag.
function readIndex(html) {
  return typeof html === "string" && html.includes("<") ? html : readFileSync(html, "utf8");
}

function pageUrl(url, params) {
  const next = new URL(url);
  for (const [key, value] of Object.entries(params)) if (value) next.searchParams.set(key, value);
  return next.href;
}

/**
 * Install the page and the globals app.js expects, and hand back an accessor.
 *
 * Call before importing app.js, which queries the document as it loads. Most
 * suites want mountApp() instead; this is the seam for a test that needs a
 * document without running the app against it.
 */
export function setupDom(html = INDEX, { query = "", term = "", url = PAGE } = {}) {
  const body = parseBody(readIndex(html));
  wireForms(body);
  focused = null;

  const document = {
    body,
    get activeElement() { return focused ?? body; },
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => new TextNode(text),
    createDocumentFragment: () => Object.assign(new Element("fragment"), { nodeType: 11 }),
    getElementById: (id) => body.querySelector(`#${id}`),
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  };

  const location = new FakeLocation(pageUrl(url, { q: query, term }));
  const window = new FakeWindow();
  const history = makeHistory(location, window);
  Object.assign(window, { document, location, history });

  // Not globalThis. window.addEventListener has to exist in its own right, or
  // a popstate listener registered in init() takes the suite down at import.
  globalThis.window = window;
  globalThis.document = document;
  globalThis.location = location;
  globalThis.history = history;
  globalThis.matchMedia = (media) => window.matchMedia(media);
  globalThis.FormData = FormDataStub;

  return {
    document, window, location, history, body,
    el: (selector) => body.querySelector(selector),
    all: (selector) => body.querySelectorAll(selector),
  };
}

let mounts = 0;

/**
 * Start app.js against a fresh page and return an accessor for it.
 *
 * The `?mount=` suffix gives each mount its own copy of app.js, which holds the
 * search state at module level and runs init() on import, so a second bare
 * import is a cache hit that never starts.
 *
 * It does not reach app.js's own imports, which are bare specifiers, so
 * js/seats.js and js/ratings.js stay shared and stay warm. Measured: mount 1
 * fetches ratings.json, seats.json, the term list and seats-1268.json; mount 2
 * fetches the term list alone. A second test that holds a seat or ratings route
 * open therefore holds a route nothing asks for, and passes having exercised
 * nothing. Name a term or a URL the earlier mount did not load.
 */
export async function mountApp({ query = "", term = "", fetch, html = INDEX, url = PAGE } = {}) {
  const page = setupDom(html, { query, term, url });
  if (fetch) globalThis.fetch = fetch;
  await import(`../js/app.js?mount=${++mounts}`);
  return page;
}

/**
 * Wait for the app to catch up, and say what was being waited for if it never
 * does. Throws on timeout rather than returning false: a caller that treats a
 * timeout as an answer reads a page the app never painted and passes anyway.
 */
export async function until(condition, label, tries = 200) {
  if (typeof label !== "string") {
    throw new TypeError("until(condition, label) needs a label naming what is awaited");
  }
  for (let i = 0; i < tries; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * Drain the pending work without asking for a result. This is the one for
 * asserting an absence, where until() would throw on the passing case.
 *
 * A turn is a real macrotask, not a microtask checkpoint, so the default costs
 * about 750ms on Windows, where the timer floor is ~15ms. An absence that only
 * has promises to outlive is settled in two or three turns.
 */
export async function settle(turns = 50) {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
