// A DOM small enough to run app.js under node --test.
//
// app.js is wiring: it reads controls, repaints, and writes the URL. None of
// that is reachable from a pure unit test, and there are no dependencies to
// pull a real DOM from. So this parses the real index.html into the handful of
// interfaces the search-and-filter path touches, which keeps the test honest
// about the real markup rather than a fixture that can drift.
//
// Only that path. The detail panel, the calendar and the view buttons all call
// methods that are not here. Adding one means checking it against a browser
// first, because a fake that guesses is worse than no fake.

import { readFileSync } from "node:fs";

const INDEX = new URL("../index.html", import.meta.url);

class Text {
  constructor(data) {
    this.data = String(data);
    this.parentNode = null;
  }
  get textContent() { return this.data; }
}

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.id = "";
    this.hidden = false;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.classes = new Set();
  }

  set className(value) { this.classes = new Set(String(value ?? "").split(/\s+/).filter(Boolean)); }

  get children() { return this.childNodes.filter((n) => n instanceof Element); }

  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value != null && value !== "") this.append(String(value));
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node == null) continue;
      if (typeof node === "string" || typeof node === "number") {
        const text = new Text(node);
        text.parentNode = this;
        this.childNodes.push(text);
        continue;
      }
      if (node.parentNode) node.parentNode.removeChild(node);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  removeChild(node) {
    const at = this.childNodes.indexOf(node);
    if (at >= 0) this.childNodes.splice(at, 1);
    node.parentNode = null;
  }

  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = value;
    else if (name === "id") this.id = String(value);
    else if (name === "hidden") this.hidden = true;
    else if (name.startsWith("data-")) this.dataset[camel(name.slice(5))] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }

  matches(selector) {
    return selector.split(",").some((one) => matchOne(this, one.trim()));
  }

  closest(selector) {
    for (let node = this; node; node = node.parentNode) {
      if (node instanceof Element && node.matches(selector)) return node;
    }
    return null;
  }

  querySelectorAll(selector) {
    const found = [];
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    event.target ??= this;
    for (let node = this; node; node = node.parentNode) {
      event.currentTarget = node;
      for (const handler of node.listeners?.get(event.type) ?? []) handler.call(node, event);
    }
  }

  click() { fire(this, "click"); }

  reset() {
    for (const control of this.querySelectorAll("input,select,textarea")) {
      control.value = control.defaultValue ?? "";
      control.checked = control.defaultChecked ?? false;
    }
  }
}

function camel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function matchOne(element, selector) {
  if (selector.startsWith("#")) return element.id === selector.slice(1);
  if (selector.startsWith(".")) return element.classes.has(selector.slice(1));
  return element.tagName === selector.toLowerCase();
}

/** Dispatch a bubbling event, the way a real click or change reaches a form. */
export function fire(element, type) {
  element.dispatchEvent({ type, target: element, currentTarget: null });
}

const VOID = new Set(["meta", "link", "input", "br", "img", "hr", "source", "col"]);
const ATTRS = /([^\s=/]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseHtml(html) {
  const root = new Element("#root");
  const stack = [root];
  let i = 0;

  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open < 0) break;
    // Trimmed, so textContent reads as the words rather than the indentation.
    const text = html.slice(i, open).trim();
    if (text) stack[stack.length - 1].append(text);

    if (html.startsWith("<!--", open)) { i = html.indexOf("-->", open) + 3; continue; }
    if (html.startsWith("<!", open)) { i = html.indexOf(">", open) + 1; continue; }

    const close = html.indexOf(">", open);
    const raw = html.slice(open + 1, close);
    i = close + 1;

    if (raw.startsWith("/")) { if (stack.length > 1) stack.pop(); continue; }

    const tag = raw.match(/^[a-zA-Z0-9-]+/)[0].toLowerCase();
    const element = new Element(tag);
    for (const [, name, dq, sq, bare] of raw.slice(tag.length).matchAll(ATTRS)) {
      element.setAttribute(name, dq ?? sq ?? bare ?? "");
    }
    stack[stack.length - 1].append(element);
    if (!VOID.has(tag) && !raw.endsWith("/")) stack.push(element);
  }
  return root;
}

/** Named properties and the defaults reset() restores, neither of which the parser sets. */
function wireForms(root) {
  for (const select of root.querySelectorAll("select")) {
    select.value = select.querySelector("option")?.getAttribute("value") ?? "";
    select.defaultValue = select.value;
  }
  for (const input of root.querySelectorAll("input")) {
    input.value = input.getAttribute("value") ?? "";
    input.defaultValue = input.value;
    input.checked = input.hasAttribute("checked");
    input.defaultChecked = input.checked;
  }
  for (const form of root.querySelectorAll("form")) {
    for (const control of form.querySelectorAll("input,select,textarea")) {
      const name = control.getAttribute("name");
      if (name && !(name in form)) form[name] = control;
    }
  }
}

class FormDataLike {
  constructor(form) {
    this.pairs = [];
    for (const control of form.querySelectorAll("input,select,textarea")) {
      const name = control.getAttribute("name");
      if (!name) continue;
      if (control.getAttribute("type") === "checkbox" && !control.checked) continue;
      this.pairs.push([name, control.value ?? ""]);
    }
  }
  get(name) { return this.pairs.find(([key]) => key === name)?.[1] ?? null; }
}

/** Install index.html as the document, plus the globals app.js reads at import. */
export function installDom(url) {
  const root = parseHtml(readFileSync(INDEX, "utf8"));
  wireForms(root);

  const document = {
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => new Text(text),
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    body: root.querySelector("body"),
  };

  globalThis.document = document;
  globalThis.window = globalThis;
  globalThis.location = new URL(url);
  globalThis.history = { replaceState: (_state, _title, next) => { globalThis.location = new URL(next, url); } };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.FormData = FormDataLike;

  return document;
}
