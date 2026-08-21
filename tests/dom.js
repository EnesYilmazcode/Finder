// A document small enough to run js/app.js under node:test.
//
// app.js is wiring: state, event handlers and repaints. None of that is
// reachable from the pure-module tests, so this builds the page out of the real
// index.html and implements the handful of DOM pieces app.js and render.js
// actually touch. Parsing the shipped markup rather than hand-writing a fixture
// means the two cannot drift apart.

import { readFileSync } from "node:fs";

const VOID = new Set(["input", "meta", "link"]);

const attrName = (key) => `data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

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

class Element {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.handlers = new Map();
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.classList = new ClassList(this);
    this.dataset = new Proxy({}, {
      get: (_target, key) => this.attrs.get(attrName(key)),
      set: (_target, key, value) => { this.attrs.set(attrName(key), String(value)); return true; },
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
      const child = typeof node === "string" ? new TextNode(node) : node;
      // A fragment hands its children over and stays empty, like the real one.
      if (child.nodeType === 11) { this.append(...child.childNodes.splice(0)); continue; }
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  closest(selector) {
    const test = compile(selector);
    for (let node = this; node; node = node.parentNode) if (node.nodeType === 1 && test(node)) return node;
    return null;
  }
  // An array rather than a NodeList. Nothing in js/ relies on either shape.
  querySelectorAll(selector) {
    const test = compile(selector);
    const found = [];
    walk(this, (node) => { if (test(node)) found.push(node); });
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(handler);
  }
  focus() {} // app.js moves focus around; no test asserts on where it lands
}

function walk(node, visit) {
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    visit(child);
    walk(child, visit);
  }
}

// Enough selector syntax for what app.js and render.js ask for: a comma list of
// compounds built from tag, #id, .class and [attr] or [attr=value].
function compile(selector) {
  const alternatives = String(selector).split(",").map((s) => s.trim()).filter(Boolean);
  const tests = alternatives.map((part) => {
    // A combinator would read as a compound and quietly match nothing, which is
    // the same answer as "no such element". Fail loudly instead.
    if (/[\s>+~]/.test(part)) throw new Error(`unsupported selector: ${selector}`);
    const tokens = part.match(/^[a-zA-Z][-\w]*|[#.][-\w]+|\[[^\]]+\]/g) ?? [];
    return (node) => tokens.every((token) => matchToken(node, token));
  });
  return (node) => tests.some((test) => test(node));
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
    this.defaultPrevented = false;
  }
  preventDefault() { this.defaultPrevented = true; }
}

/** Fire an event on a node and let it bubble, since app.js delegates. */
export function fire(node, type) {
  const event = new FakeEvent(type);
  event.target = node;
  for (let at = node; at; at = at.parentNode) {
    for (const handler of at.handlers?.get(type) ?? []) handler.call(at, event);
  }
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
  for (const form of body.querySelectorAll("form")) {
    const controls = form.querySelectorAll("input, select, textarea").filter((c) => c.name);
    for (const control of controls) form[control.name] = control;
    form.reset = () => {
      for (const control of controls) {
        if (control.type === "checkbox") control.checked = control.hasAttribute("checked");
        else control.value = control.getAttribute("value") ?? "";
      }
    };
  }
}

class FormDataStub {
  constructor(form) { this.form = form; }
  get(name) {
    const control = this.form.querySelectorAll("input, select, textarea").find((c) => c.name === name);
    if (!control) return null;
    if (control.type === "checkbox") return control.checked ? control.value || "on" : null;
    return control.value ?? null;
  }
}

/**
 * Install the page and the globals app.js expects. Call before importing it,
 * since app.js queries the document as it loads and runs init() on import.
 * There is no undo: node:test gives every test file its own process.
 */
export function setupDom(indexUrl) {
  const body = parseBody(readFileSync(indexUrl, "utf8"));
  wireForms(body);

  const document = {
    body,
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => new TextNode(text),
    createDocumentFragment: () => Object.assign(new Element("fragment"), { nodeType: 11 }),
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  };

  const location = {
    href: "https://enesyilmazcode.github.io/Finder/",
    get search() { return new URL(this.href).search; },
  };

  globalThis.window = globalThis;
  globalThis.document = document;
  globalThis.location = location;
  globalThis.history = { replaceState: (_state, _title, url) => { location.href = String(url); } };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.FormData = FormDataStub;

  return { el: (selector) => body.querySelector(selector) };
}

/** Wait for the app to catch up with an async search. */
export async function until(condition, label, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}
