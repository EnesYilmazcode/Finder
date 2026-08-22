import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");

const sheet = "css/fonts.css";
// Only shared.css ever held a Google URL. The app stylesheets are checked too so
// a reintroduction gets caught wherever someone puts it.
const consumers = ["css/finder.css", "css/stats.css", "wireframes/shared.css"];
const pages = [["index.html", "css/fonts.css"], ["stats/index.html", "../css/fonts.css"]];

test("no page or stylesheet reaches for Google's font hosts", () => {
  for (const file of [...pages.map(([page]) => page), sheet, ...consumers]) {
    const source = read(file);
    assert.equal(source.includes("fonts.googleapis.com"), false, file);
    assert.equal(source.includes("fonts.gstatic.com"), false, file);
  }
});

// The href differs per page and a wrong one still looks like a link, so resolve
// it against the page's own directory instead of matching the tag.
test("both pages link the local faces", () => {
  for (const [page, href] of pages) {
    assert.ok(read(page).includes(`href="${href}"`), page);
    readFileSync(join(root, dirname(page), href));
  }
});

test("every @font-face points at a woff2 that ships in the repo", () => {
  const urls = [...read(sheet).matchAll(/src: url\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    const bytes = readFileSync(join(root, dirname(sheet), url));
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", url);
  }
});

// A family renamed on one side only leaves the pages in the fallback face with
// every other test in this file still green.
test("every family the stylesheets ask for is declared", () => {
  const declared = [...read(sheet).matchAll(/font-family: "([^"]+)"/g)].map((m) => m[1]);
  for (const file of consumers) {
    for (const [, family] of read(file).matchAll(/--(?:display|body|data):\s*"([^"]+)"/g)) {
      assert.ok(declared.includes(family), `${file} asks for ${family}`);
    }
  }
});

// The OFL allows redistribution only alongside the license text.
test("the fonts ship with their licenses", () => {
  const licenses = readdirSync(join(root, "assets", "fonts")).filter((f) => f.startsWith("LICENSE-"));
  assert.equal(licenses.length, 2);
  for (const file of licenses) {
    assert.match(read(join("assets", "fonts", file)), /SIL Open Font License/);
  }
});
