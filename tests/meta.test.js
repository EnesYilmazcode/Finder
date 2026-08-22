// index.html is the only page meant to be shared, so the tags a link unfurler
// reads are checked here rather than by eye. The card image is committed, so
// its size is read out of the PNG header instead of taken on trust.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SITE = "https://enesyilmazcode.github.io/Finder/";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const stats = readFileSync(new URL("stats/index.html", root), "utf8");

function tags(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => {
    const attrs = {};
    for (const attr of match[0].matchAll(/([\w:.-]+)=(?:"([^"]*)"|'([^']*)')/g)) attrs[attr[1]] = attr[2] ?? attr[3];
    return attrs;
  });
}

function metas(source) {
  return tags(source, /<meta\s[^>]*>/g);
}

// Scrapers read og: off property= and everything else off name=, and they skip
// a tag that uses the wrong one, so the attribute is part of what is asserted.
function meta(source, key, attr = "property") {
  return metas(source).find((t) => t[attr] === key)?.content;
}

function icon(source, rel) {
  return tags(source, /<link\s[^>]*>/g).find((t) => t.rel?.split(/\s+/).includes(rel))?.href;
}

/** Local file behind a URL on the live site, or behind a relative href. */
function asset(href) {
  const path = href.startsWith(SITE) ? href.slice(SITE.length) : href;
  return new URL(path, root);
}

function pngSize(url) {
  const head = readFileSync(url).subarray(0, 24);
  assert.equal(head.subarray(1, 4).toString(), "PNG", `${url} is not a PNG`);
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

test("the head carries every tag a card needs", () => {
  for (const key of ["og:site_name", "og:title", "og:description", "og:url", "og:image"]) {
    assert.ok(meta(html, key), `missing ${key}`);
  }
  assert.equal(meta(html, "og:type"), "website");
  assert.equal(meta(html, "twitter:card", "name"), "summary_large_image");
});

test("the card description is the page description, not a second copy of it", () => {
  assert.equal(meta(html, "og:description"), meta(html, "description", "name"));
});

test("og:url and og:image are absolute, since unfurlers do not resolve relative ones", () => {
  assert.equal(meta(html, "og:url"), SITE);
  assert.ok(meta(html, "og:image").startsWith(SITE), "og:image is not on the live site");
});

test("og:image is a committed 1200x630 file and says so", () => {
  assert.deepEqual(pngSize(asset(meta(html, "og:image"))), [1200, 630]);
  assert.equal(meta(html, "og:image:width"), "1200");
  assert.equal(meta(html, "og:image:height"), "630");
});

test("both icons are linked and committed", () => {
  assert.match(readFileSync(asset(icon(html, "icon")), "utf8"), /<svg[\s>]/);
  assert.deepEqual(pngSize(asset(icon(html, "apple-touch-icon"))), [180, 180]);
});

test("the stats page stays unshareable", () => {
  assert.equal(meta(stats, "robots", "name"), "noindex");
  assert.equal(metas(stats).filter((t) => /^(og|twitter):/.test(t.property ?? t.name ?? "")).length, 0);
});
