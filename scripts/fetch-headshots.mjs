#!/usr/bin/env node
// Records which instructors have a photo at opic.osu.edu, into data/headshots.json.
//
// It sweeps the class API for instructor addresses, then asks opic about each one.
// A 200 is a photo and a 302 is the placeholder that stands in for not having one.
// js/headshots.js explains why that distinction has to be settled here rather than
// in the browser.
//
// Usage: node scripts/fetch-headshots.mjs

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { countRefusal, refusalMessage, residueRefusal } from './guards.mjs';

const API = 'https://content.osu.edu/v2/classes';
const PHOTOS = 'https://opic.osu.edu';
const CAMPUS = 'col';
const SORT = 'catalogNumber';

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))));
const COURSES_PATH = join(ROOT, 'data', 'courses.json');
const OUT_PATH = join(ROOT, 'data', 'headshots.json');

const CONCURRENCY = 5;
const DELAY_MS = 120;
const RETRIES = 3;
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const TIMEOUT_MS = 30000;
const MAX_RETRY_AFTER_MS = 30000;
const MAX_PAGES = 50;

const USER_AGENT =
  'Finder-headshots/1.0 (+https://github.com/EnesYilmazcode/Finder) weekly headshot sweep';

// The sweep reads the subject list out of the committed catalog rather than
// rediscovering it, so it never repeats the facet walk fetch-courses.mjs does. The
// first run covered 682 subject-terms and found 8089 people.
const MIN_INSTRUCTORS = 2000;

// Well under the 2527 the first run committed, because the floor only has to catch
// a total collapse. The real gate is the drop check against what is already there.
const MIN_PHOTOS = 500;

// Share of requests that never got an answer, applied to both halves of the run.
// One dead request must not throw away the whole sweep, but a run where upstream is
// refusing wholesale would otherwise read as everyone losing their photo at once.
const MAX_UNCHECKED_RATE = 0.02;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function retryAfterMs(header) {
  if (!header) return 0;
  const seconds = /^\s*\d+\s*$/.test(header) ? Number(header) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  if (!(ms > 0)) return 0;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

async function request(url, { method = 'GET', accept = 'application/json' } = {}) {
  let lastError;
  let wait = 0;
  let retriedForbidden = false;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(wait || 500 * 2 ** (attempt - 1));
    wait = 0;
    try {
      const res = await fetch(url, {
        method,
        headers: { 'user-agent': USER_AGENT, accept },
        redirect: 'manual', // a 302 is the answer here, not something to follow
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status >= 400) {
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
        // A response with no headers still has to be reported by status rather
        // than throw over the Retry-After that is not there.
        wait = retryAfterMs(res.headers?.get?.('retry-after'));
        lastError = new Error(`${res.status} ${res.statusText}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (err.fatal) break;
    }
  }
  throw new Error(`${method} ${url} failed: ${lastError?.message ?? 'unknown'}`);
}

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

function searchUrl(term, subject, page) {
  const qs = new URLSearchParams({ q: '', campus: CAMPUS, term, sort: SORT, subject, p: String(page) });
  return `${API}/search?${qs}`;
}

// Exported so tests/fetch-retry.test.js can hold this hand-copied loop to the
// same policy as the other two.
export const fetchJson = async (url) => (await request(url)).json();

async function searchPage(term, subject, page) {
  const data = (await fetchJson(searchUrl(term, subject, page)))?.data;
  if (!data) throw new Error(`search returned no data for ${subject} p${page}`);
  return data;
}

/**
 * The name.N in an OSU address, or null for anything else.
 *
 * The first full sweep found an @osu.edu address on every instructor it saw, but
 * the field is optional upstream and js/format.js already tolerates it missing,
 * so this does too.
 */
export function osuId(email) {
  const match = /^([a-z0-9][a-z0-9.'-]*)@osu\.edu$/i.exec(String(email ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}

/** Every instructor id anywhere in one search response. */
export function idsIn(data) {
  const found = new Set();
  for (const entry of data?.courses ?? []) {
    for (const section of entry?.sections ?? []) {
      for (const meeting of section?.meetings ?? []) {
        for (const person of meeting?.instructors ?? []) {
          const id = osuId(person?.email);
          if (id) found.add(id);
        }
      }
    }
  }
  return found;
}

/** Walk one subject in one term and return the ids it names. */
async function subjectIds(term, code) {
  const subject = code.toLowerCase();
  const first = await searchPage(term, subject, 1);
  const found = idsIn(first);

  const pages = Math.min(first.totalPages || 1, MAX_PAGES);
  for (let p = 2; p <= pages; p++) {
    await sleep(DELAY_MS);
    for (const id of idsIn(await searchPage(term, subject, p))) found.add(id);
  }
  return found;
}

/**
 * Term and subject codes out of the committed catalog.
 *
 * A subject the catalog has not caught up with yet costs its instructors a photo
 * for one run, which is the same thing two thirds of them get anyway. That asymmetry is
 * why this sweep does not need the repeated reconciliation passes fetch-courses.mjs
 * runs to defend against non-deterministic paging: a missed id degrades to the
 * monogram, it never renders a wrong face.
 */
export function sweepPlan(catalog) {
  const jobs = [];
  for (const term of Object.values(catalog?.terms ?? {})) {
    for (const subject of term?.subjects ?? []) {
      if (subject?.code) jobs.push({ term: String(term.term), code: subject.code });
    }
  }
  return jobs;
}

/** Does this id have a real photo? A 302 to the leaf placeholder means no. */
export async function hasPhoto(id) {
  const res = await request(`${PHOTOS}/${encodeURIComponent(id)}?width=100`, {
    method: 'HEAD', // the status is the whole answer, and HEAD sends no image bytes
    accept: 'image/*',
  });
  return res.status === 200;
}

/** What the last run wrote. Missing or unreadable means a first run, not an error. */
export async function previousCount(path = OUT_PATH) {
  try {
    return JSON.parse(await readFile(path, 'utf8')).ids?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Every reason not to write this run. Apart from main so a test can drive it. */
export async function writeRefusals(run, path = OUT_PATH) {
  const { instructors, photos, unchecked = 0, missed = 0, jobs = 0 } = run;
  return [
    countRefusal('instructors swept', instructors, MIN_INSTRUCTORS, null),
    countRefusal('instructors with a photo', photos, MIN_PHOTOS, await previousCount(path)),
    residueRefusal('photo checks', instructors - unchecked, unchecked, MAX_UNCHECKED_RATE),
    residueRefusal('subject sweeps', jobs - missed, missed, MAX_UNCHECKED_RATE),
  ];
}

export function snapshot(ids) {
  return {
    source: PHOTOS,
    note: 'name.N of every instructor opic.osu.edu answers with a photo. Absent means the generic leaf, which is not worth rendering.',
    count: ids.length,
    ids,
  };
}

async function main() {
  const catalog = JSON.parse(await readFile(COURSES_PATH, 'utf8'));
  const jobs = sweepPlan(catalog);
  if (!jobs.length) throw new Error(`${COURSES_PATH} names no subjects to sweep`);

  console.log(`sweeping ${jobs.length} subject-terms for instructors`);
  const instructors = new Set();
  let swept = 0;
  let missed = 0;
  // Tolerated for the same reason the photo checks below are: one flaky subject
  // must not cost the week. A subject that goes missing costs its instructors a
  // photo until the next run, so the rate is gated rather than the failure.
  await mapLimit(jobs, CONCURRENCY, async ({ term, code }) => {
    try {
      for (const id of await subjectIds(term, code)) instructors.add(id);
    } catch (err) {
      missed++;
      console.warn(`  ${code} ${term}: ${err.message}`);
    }
    if (++swept % 50 === 0) console.log(`  ${swept}/${jobs.length} subject-terms, ${instructors.size} instructors`);
  });
  if (missed) console.warn(`${missed} of ${jobs.length} subject-terms did not answer`);

  const ids = [...instructors].sort();
  console.log(`checking ${ids.length} instructors for a photo`);

  // mapLimit runs on Promise.all, so a worker that throws rejects the whole sweep,
  // which is how one bad subject once cost a night's seats (#93). An id whose check
  // fails is recorded as unknown rather than as an answer: it costs that person a
  // photo for a week, and the rate is gated below.
  const verdicts = await mapLimit(ids, CONCURRENCY, (id) => hasPhoto(id).catch(() => null));

  const withPhoto = [];
  let unchecked = 0;
  ids.forEach((id, i) => {
    if (verdicts[i] === null) unchecked++;
    else if (verdicts[i]) withPhoto.push(id);
  });

  const share = ids.length ? ((withPhoto.length / ids.length) * 100).toFixed(1) : '0.0';
  console.log(`${withPhoto.length} of ${ids.length} have a photo (${share}%)`);
  if (unchecked) console.warn(`${unchecked} could not be checked and are treated as having none`);

  const refusal = refusalMessage(await writeRefusals({
    instructors: ids.length, photos: withPhoto.length, unchecked, missed, jobs: jobs.length,
  }));
  if (refusal) {
    console.error(`Refusing to write ${OUT_PATH}.\n${refusal}`);
    process.exit(1);
  }

  // No fetch timestamp, matching the other snapshots: it would change every run
  // and defeat the commit-only-when-changed check.
  const written = snapshot(withPhoto);
  const json = JSON.stringify(written, null, 0) + '\n';
  await mkdir(dirname(OUT_PATH), { recursive: true });
  const tmp = `${OUT_PATH}.tmp`;
  await writeFile(tmp, json, 'utf8');
  await rename(tmp, OUT_PATH); // rename is atomic, so a crash cannot leave a partial file

  console.log(`Wrote ${withPhoto.length} ids to ${OUT_PATH} (${json.length} bytes)`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(`fetch-headshots failed: ${err.message}`);
    process.exit(1);
  });
}
