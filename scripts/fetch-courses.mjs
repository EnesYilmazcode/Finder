#!/usr/bin/env node
// Build the subject and course index in data/courses.json.
//
// The site's subject and number pickers need the full list of what is offered,
// and that cannot come from live search. Paged search is non-deterministic, so
// a course can appear in one pull and vanish from the next (see docs/osu-api.md),
// and a broad query stops at 10000 results. So the index is built here, in CI,
// by walking one subject at a time and reconciling several passes per subject.
//
// Usage:  node scripts/fetch-courses.mjs [term ...]
//         node scripts/fetch-courses.mjs 1268
// With no argument every term the API reports as searchable is indexed, which is
// what the workflow does. Naming terms is for local debugging: the file is
// rewritten, so terms left out are dropped from it.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { countRefusal, refusalMessage } from './guards.mjs';

const API = 'https://content.osu.edu/v2/classes';
const BARRETT = 'https://www.asc.ohio-state.edu/barrett.3/schedule';
const CAMPUS = 'col';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'data', 'courses.json');

const CONCURRENCY = 5;
const DELAY_MS = 120;
const RETRIES = 3;
// 408 and 425 ask for the request again and a 429 clears on its own. The rest
// of 4xx will not fix itself. A 5xx or a timeout might.
const RETRY_STATUS = new Set([408, 425, 429]);
// Retry-After can name an hour, longer than the run will spend on one request.
const MAX_RETRY_AFTER_MS = 30000;
const USER_AGENT =
  'Finder-courses/1.0 (+https://github.com/EnesYilmazcode/Finder) weekly course index';

// Search pages 200 sections at a time and refuses to go past 10000, so 50 is
// the real ceiling. Nothing observed comes close: the widest subject in Autumn
// 2026 was 7 pages.
const MAX_PAGES = 50;

// Ordering is what actually fixes the paging. The default is relevance, which
// shuffles ties between pulls, so a course drifts across a page boundary and the
// walk misses it: unsorted, identical pulls of HISTORY returned 107 to 111
// courses. Sorting by catalog number pins the pages, and all 36 multi-page
// subjects in Autumn 2026 then returned the identical set four times running.
const SORT = 'catalogNumber';

// A pass is a complete walk of one subject. Passes repeat until enough of them in
// a row add nothing new. A stable order is an observation, not a promise, so this
// stays as the safety net. Unsorted it was load bearing: one clean pass was not
// even enough, since CHEM could plateau for a pass and then find more.
const MAX_PASSES = 8;
const STABLE_PASSES = 2;

// Only 36 of the 243 subjects offered in Autumn 2026 need a second page, and
// single-page results never varied, sorted or not. Those get one confirming pass
// rather than the full stable-pass treatment.
const SINGLE_PAGE_STABLE_PASSES = 1;

// Autumn 2026 measured 243 subjects and 6072 courses, Summer 2026 the smallest
// at 197 and 1984. The floors sit well under the smallest term because they only
// have to cover a first run: after that a term is held to its own last count.
const MIN_SUBJECTS = 100;
const MIN_COURSES = 1200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry-After is either a count of seconds or an HTTP date. Anything else, or a
// date already past, leaves the ordinary backoff in charge.
function retryAfterMs(header) {
  if (!header) return 0;
  const seconds = /^\s*\d+\s*$/.test(header) ? Number(header) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  if (!(ms > 0)) return 0;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

async function fetchWith(url, parse, { allow404 = false } = {}) {
  let lastError;
  let wait = 0;
  let retriedForbidden = false;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(wait || 500 * 2 ** (attempt - 1));
    wait = 0;
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json,text/html' },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404 && allow404) return null;
      if (res.status >= 400 && res.status < 500) {
        let retryable = RETRY_STATUS.has(res.status);
        // A 403 is often a WAF being twitchy, so give it one more go.
        if (res.status === 403 && !retriedForbidden) {
          retriedForbidden = true;
          retryable = true;
        }
        if (!retryable) {
          const err = new Error(`${res.status} ${res.statusText}`);
          err.fatal = true;
          throw err;
        }
      }
      if (!res.ok) {
        // A response with no headers still has to be reported by status rather
        // than throw over the Retry-After that is not there.
        wait = retryAfterMs(res.headers?.get?.('retry-after'));
        lastError = new Error(`${res.status} ${res.statusText}`);
        continue;
      }
      return await parse(res);
    } catch (err) {
      lastError = err;
      if (err.fatal) break;
    }
  }
  throw new Error(`GET ${url} failed: ${lastError?.message ?? 'unknown'}`);
}

const fetchJson = (url) => fetchWith(url, (res) => res.json());
const fetchText = (url) => fetchWith(url, (res) => res.text());

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i]);
      await sleep(DELAY_MS);
    }
  });
  await Promise.all(runners);
  return out;
}

function searchUrl(term, params) {
  const qs = new URLSearchParams({ q: '', campus: CAMPUS, term, sort: SORT, ...params });
  return `${API}/search?${qs}`;
}

async function searchPage(term, params) {
  const body = await fetchJson(searchUrl(term, params));
  const data = body?.data;
  if (!data) throw new Error(`search returned no data for ${JSON.stringify(params)}`);
  return data;
}

async function searchableTerms() {
  const body = await fetchJson(`${API}/searchableTermsV2`);
  const terms = body?.data?.data;
  if (!Array.isArray(terms) || !terms.length) throw new Error('searchableTermsV2 returned nothing');
  return terms
    .filter((t) => t.classSearch === 'Y' && /^\d{4}$/.test(t.strm ?? ''))
    .map((t) => ({ strm: t.strm, name: (t.descr ?? '').trim() }))
    .sort((a, b) => a.strm.localeCompare(b.strm));
}

// Subject list, part one: Barrett publishes a static index of every subject code
// it knows, which is a stable seed that costs one request.
async function barrettSubjects() {
  const html = await fetchText(`${BARRETT}/`);
  const subjects = new Set();
  for (const m of html.matchAll(/<a href="([A-Z][A-Z0-9]*)">/g)) subjects.add(m[1]);
  return subjects;
}

// Subject list, part two. The API has no subject endpoint, and its own subject
// facet is capped at ten entries, so it will not list them either. Barrett is
// the only ready-made list and it is incomplete: measured against this sweep for
// Autumn 2026 it was missing 18 live subjects, CYBRSEC and ETHNSTD among them.
// So also sweep the catalog-number facet, whose buckets each sit under the 10000
// cap, and keep every subject code the results carry.
async function discoverSubjects(term) {
  const first = await searchPage(term, { p: '1' });
  const buckets =
    (first.filters ?? []).find((f) => f.slug === 'catalog-number')?.items?.map((i) => i.term) ?? [];
  if (!buckets.length) throw new Error(`term ${term}: no catalog-number facet to sweep`);

  const jobs = [];
  for (const bucket of buckets) {
    const head = await searchPage(term, { p: '1', 'catalog-number': bucket });
    const pages = Math.min(head.totalPages || 1, MAX_PAGES);
    for (let p = 1; p <= pages; p++) jobs.push({ bucket, p });
  }

  const found = new Set();
  await mapLimit(jobs, CONCURRENCY, async ({ bucket, p }) => {
    const data = await searchPage(term, { p: String(p), 'catalog-number': bucket });
    for (const entry of data.courses ?? []) {
      const code = (entry?.course?.subject ?? '').trim();
      if (code) found.add(code);
    }
  });
  return found;
}

// The index the last run wrote. Missing or unreadable means a first run, which
// is not an error. Read once, since both readers below want a projection of it.
async function previousIndex(path = OUT_PATH) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

// Subject list, part three: every code the last run knew about.
function previousSubjects(previous) {
  const codes = new Set();
  for (const term of Object.values(previous?.terms ?? {})) {
    for (const subject of term.subjects ?? []) if (subject.code) codes.add(subject.code);
  }
  return codes;
}

// Per-term counts from the same index, for the collapse check below.
function previousCounts(previous) {
  const counts = {};
  for (const [strm, term] of Object.entries(previous?.terms ?? {})) {
    const subjects = term.subjects ?? [];
    counts[strm] = {
      subjects: subjects.length,
      courses: subjects.reduce((n, s) => n + (s.courses?.length ?? 0), 0),
    };
  }
  return counts;
}

// Every reason not to write a term. Apart from main so a test can hold it to the
// counts that are really committed.
function writeRefusals(strm, offered, courses, before) {
  return [
    countRefusal(`term ${strm} subjects`, offered, MIN_SUBJECTS, before?.subjects),
    countRefusal(`term ${strm} courses`, courses, MIN_COURSES, before?.courses),
  ];
}

// One complete walk of one subject. The subject filter takes the code
// lowercased, and unlike a free text query it never bleeds in courses from other
// subjects that merely mention the code in their title.
async function subjectPass(term, code) {
  const slug = code.toLowerCase();
  const first = await searchPage(term, { p: '1', subject: slug });
  const pages = Math.min(first.totalPages || 1, MAX_PAGES);

  const courses = [];
  const collect = (data) => {
    for (const entry of data.courses ?? []) if (entry?.course) courses.push(entry.course);
  };
  collect(first);

  for (let p = 2; p <= pages; p++) {
    await sleep(DELAY_MS);
    collect(await searchPage(term, { p: String(p), subject: slug }));
  }
  return { courses, pages, sections: first.totalItems ?? 0 };
}

// Repeat passes until enough of them in a row add nothing new. A single walk of a
// multi-page subject can silently drop whatever the API left out of that pull,
// and the only way to notice is to pull again and union the results.
async function reconcileSubject(term, code) {
  const byCatalog = new Map();
  let name = '';
  let sections = 0;
  let pages = 1;
  let passes = 0;
  let firstPassCount = 0;
  let addedLater = 0;
  let clean = 0;

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const { courses, pages: seen, sections: total } = await subjectPass(term, code);
    passes = pass;
    pages = Math.max(pages, seen);
    sections = Math.max(sections, total);

    let added = 0;
    for (const c of courses) {
      const catalog = (c.catalogNumber ?? '').trim();
      if (!catalog) continue;
      if (!name) name = (c.subjectDesc ?? '').trim();
      if (byCatalog.has(catalog)) continue;
      byCatalog.set(catalog, [
        catalog,
        (c.title ?? '').trim(),
        Number(c.minUnits ?? 0),
        Number(c.maxUnits ?? 0),
      ]);
      added++;
    }

    if (pass === 1) firstPassCount = added;
    else addedLater += added;
    if (!byCatalog.size) break; // not offered this term, one look is enough

    clean = added === 0 ? clean + 1 : 0;
    if (clean >= (pages > 1 ? STABLE_PASSES : SINGLE_PAGE_STABLE_PASSES)) break;
  }

  return {
    code,
    name: name || code,
    courses: byCatalog,
    sections,
    pages,
    passes,
    firstPassCount,
    addedLater,
  };
}

// Catalog numbers are not plain integers: 1151.01 and 2221H both exist. Sort on
// the leading digits first so 1151 lands before 2221, then on the suffix.
function catalogOrder(a, b) {
  const split = (n) => {
    const m = /^(\d+)(.*)$/.exec(n);
    return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, n];
  };
  const [an, as] = split(a[0]);
  const [bn, bs] = split(b[0]);
  return an - bn || as.localeCompare(bs) || a[1].localeCompare(b[1]);
}

async function indexTerm(term, codes) {
  const started = Date.now();
  const results = await mapLimit(codes, CONCURRENCY, (code) => reconcileSubject(term.strm, code));

  const subjects = [];
  const stats = {
    candidates: codes.length,
    offered: 0,
    courses: 0,
    firstPassCourses: 0,
    reconciledAdds: 0,
    multiPassSubjects: 0,
    maxPasses: 0,
    unconverged: 0,
    sections: 0,
  };

  for (const r of results.sort((a, b) => a.code.localeCompare(b.code))) {
    if (!r.courses.size) continue;
    stats.offered++;
    stats.courses += r.courses.size;
    stats.firstPassCourses += r.firstPassCount;
    stats.reconciledAdds += r.addedLater;
    stats.sections += r.sections;
    stats.maxPasses = Math.max(stats.maxPasses, r.passes);
    // Hitting the cap means the subject never went quiet, so the union may still
    // be short. Worth printing rather than swallowing.
    if (r.passes === MAX_PASSES) {
      stats.unconverged++;
      console.log(`  ${r.code}: still adding courses at pass ${MAX_PASSES}, index may be short`);
    }
    if (r.addedLater > 0) {
      stats.multiPassSubjects++;
      console.log(`  ${r.code}: pass 1 found ${r.firstPassCount}, later passes added ${r.addedLater}`);
    }
    subjects.push({
      code: r.code,
      name: r.name,
      courses: [...r.courses.values()].sort(catalogOrder),
    });
  }

  stats.seconds = (Date.now() - started) / 1000;
  return { index: { term: term.strm, name: term.name, subjects }, stats };
}

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, path); // rename is atomic, so a crash cannot leave a partial file
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
  const all = await searchableTerms();
  const terms = requested.length ? all.filter((t) => requested.includes(t.strm)) : all;
  if (!terms.length) throw new Error(`none of ${requested.join(', ')} is searchable`);

  const committed = await previousIndex();

  // searchableTermsV2 is one uncached call to the same API that pages
  // non-deterministically, and a short answer drops whole terms from a file that
  // is rewritten every run. A named run is exempt: dropping the rest is what
  // that mode is for.
  if (!requested.length) {
    const refusal = refusalMessage([
      countRefusal('searchable terms', terms.length, 1, Object.keys(committed?.terms ?? {}).length),
    ]);
    if (refusal) throw new Error(`Refusing to write ${OUT_PATH}.\n${refusal}`);
  }

  const candidates = new Set();
  const barrett = await barrettSubjects();
  for (const code of barrett) candidates.add(code);

  // Every subject the last index knew about stays a candidate. The sweep below
  // is itself paged, so it is as lossy as anything else here, and without this
  // a subject could drop out of the file for one run and come back the next.
  // A candidate that really is not offered costs one request and is dropped.
  const previous = previousSubjects(committed);
  for (const code of previous) candidates.add(code);

  let swept = 0;
  for (const term of terms) {
    const found = await discoverSubjects(term.strm);
    swept += found.size;
    for (const code of found) candidates.add(code);
  }

  const codes = [...candidates].sort();
  console.log(
    `${codes.length} candidate subjects: ${barrett.size} from Barrett, ${previous.size} from the last index, ` +
      `${swept} subject hits across ${terms.length} term sweeps`
  );

  const counts = previousCounts(committed);

  const out = {};
  for (const term of terms) {
    const { index, stats } = await indexTerm(term, codes);
    out[term.strm] = index;

    console.log(
      `term ${term.strm} ${term.name}: ${stats.offered}/${stats.candidates} subjects offered, ` +
        `${stats.courses} courses over ${stats.sections} sections, ` +
        `pass 1 found ${stats.firstPassCourses}, later passes added ${stats.reconciledAdds} ` +
        `across ${stats.multiPassSubjects} subjects, deepest ${stats.maxPasses} passes, ` +
        `${stats.unconverged} unconverged, ${stats.seconds.toFixed(1)}s`
    );

    const refusal = refusalMessage(writeRefusals(term.strm, stats.offered, stats.courses, counts[term.strm]));
    if (refusal) throw new Error(`Refusing to write ${OUT_PATH}.\n${refusal}`);
  }

  // Always keyed by term, even for a single term, so the page reads one shape
  // whatever this was run with. seats.json flattens a lone term instead, because
  // it is written one term at a time and the page only ever wants today's.
  const payload = {
    source: `${API}/search`,
    fields: ['catalogNumber', 'title', 'minUnits', 'maxUnits'],
    note: 'Built one subject at a time in catalog-number order, reconciling repeated passes. Paged search in its default relevance order is not deterministic.',
    terms: out,
  };

  // No fetch timestamp on purpose: it would change every run and defeat the
  // commit-only-when-changed check. The commit date already records when it ran.
  const json = `${JSON.stringify(payload, null, 0)}\n`;
  await writeAtomic(OUT_PATH, json);

  const bytes = Buffer.byteLength(json);
  console.log(`wrote ${OUT_PATH} (${bytes} bytes, ${(bytes / 1024).toFixed(1)} KiB)`);
}

// Exported so a checker can reuse the walk without rerunning the whole index, so
// the retry policy can be exercised without a network, and so a test can drive
// the write gate against the committed index.
export { fetchJson, previousCounts, previousIndex, reconcileSubject, searchableTerms, writeRefusals };

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
