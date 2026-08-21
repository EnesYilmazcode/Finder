#!/usr/bin/env node
// Snapshot per-section seat counts from Barrett's schedule into data/seats.json.
//
// The OSU class API repeats one enrollment figure onto every section of a
// course, so it cannot tell a full section from an empty one. Barrett's plain
// text schedule carries real per-section enrolled/limit/waitlist numbers, but
// asc.ohio-state.edu sends no CORS headers, so this has to run in CI.
//
// Usage:  node scripts/fetch-seats.mjs [term ...]
//         node scripts/fetch-seats.mjs 1268
// With no argument every term the API reports as searchable is snapshotted,
// which is what the workflow does. Naming terms refreshes only those: the other
// searchable terms keep the files and index entries they already have.
//
// Output is one file per term, data/seats-1268.json, plus data/seats.json
// listing them. Seats load before anything renders, so a browser fetches the
// index and the one term on screen rather than every term at once.
//
// Format notes and the verified column map live in docs/barrett-schedule.md.

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = 'https://www.asc.ohio-state.edu/barrett.3/schedule';
// Only for the term list. Every seat number here comes from Barrett.
const API = 'https://content.osu.edu/v2/classes';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'data');
const INDEX_NAME = 'seats.json';
const TERM_PREFIX = 'seats-';
const TERM_FILE_RE = /^seats-\d{4}\.json$/;

const CONCURRENCY = 5;
const DELAY_MS = 120;
const RETRIES = 3;
const USER_AGENT =
  'Finder-seats/1.0 (+https://github.com/EnesYilmazcode/Finder) daily snapshot';

// A subject file that fails the layout check this badly is a format change,
// not a stray line, so the job should fail loudly instead of shipping junk.
const MAX_RESIDUE_RATE = 0.005;
const MIN_SUBJECTS = 50;

// Fixed-width field slices, measured against every subject file for term 1268
// on 2026-08-18 (17680 section lines, zero residue). Half-open [start, end).
const FIELDS = {
  subject: [0, 8], // right aligned
  catalog: [9, 18],
  campus: [19, 24], // NWK, WST and friends
  classNumber: [24, 31], // right aligned
  component: [31, 32], // L lecture, B lab, R recitation, ...
  autoEnroll: [33, 48], // ( 4818) or (30558,30559)
  days: [48, 57], // one column per weekday, see DAY_COLUMNS
  time: [57, 69], // 0350P or 1245P-0205
  tail: [69, 94], // room + enrolled/limit + waitlist, see TAIL_RE
};
const INSTRUCTOR_START = 94;

// Weekend uses S for Saturday and a lowercase s for Sunday.
const DAY_COLUMNS = { 49: 'M', 50: 'T', 51: 'W', 52: 'R', 53: 'F', 54: 'Sa', 55: 'Su' };

// Room is left aligned and enrollment right aligned, and a long room name can
// shove them together, so this region is matched rather than sliced.
const TAIL_RE = /^\s*(?:(\S+)\s+)?(\d+)\/(\d+)(?:\s*\+(\d+))?\s*$/;

const HEADER_RE = /^(\S+)\s+(\d{4}) \((.+?)\)\s+updated: (\S+)\s*$/;
// A pre-publication term carries a DRAFT banner above the column header, so its
// header is five lines instead of three. Only the top of the file is searched,
// so a trailer row cannot stand in for the header.
const COLUMNS_RE = /class#.*enrld\/limit\/\+wait/;
const COLUMNS_SEARCH_LINES = 10;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, { allow404 = false, accept = 'text/plain,text/html' } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404 && allow404) return null;
      // A 4xx will not fix itself, so stop. A 5xx or a timeout might.
      if (res.status >= 400 && res.status < 500) {
        const err = new Error(`${res.status} ${res.statusText}`);
        err.fatal = true;
        throw err;
      }
      if (!res.ok) {
        lastError = new Error(`${res.status} ${res.statusText}`);
        continue;
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      if (err.fatal) break;
    }
  }
  throw new Error(`GET ${url} failed: ${lastError?.message ?? 'unknown'}`);
}

async function fetchSubjects() {
  const html = await fetchText(`${BASE}/`);
  const subjects = new Set();
  for (const m of html.matchAll(/<a href="([A-Z][A-Z0-9]*)">/g)) subjects.add(m[1]);
  return [...subjects].sort();
}

// The terms the site can actually search, oldest first. A 4-digit code is the
// year minus 1900 then the season, 2 spring 4 summer 8 autumn, but a
// well-formed code is not a searchable one, so it is read rather than derived.
async function searchableTerms() {
  const body = JSON.parse(await fetchText(`${API}/searchableTermsV2`, { accept: 'application/json' }));
  const terms = body?.data?.data;
  if (!Array.isArray(terms) || !terms.length) throw new Error('searchableTermsV2 returned nothing');
  return terms
    .filter((t) => t.classSearch === 'Y' && /^\d{4}$/.test(t.strm ?? ''))
    .map((t) => t.strm)
    .sort((a, b) => a.localeCompare(b));
}

function slice(line, [start, end]) {
  return line.slice(start, end);
}

// Every character on a section line has to land in a known field. Blanking the
// fields out and checking that nothing is left is the residue check.
function residueOf(line, spans) {
  const chars = [...line];
  for (const [start, end] of spans) {
    for (let i = start; i < Math.min(end, chars.length); i++) chars[i] = ' ';
  }
  for (let i = INSTRUCTOR_START; i < chars.length; i++) chars[i] = ' ';
  return chars.join('').trim();
}

function parseDays(line) {
  let out = '';
  for (const [col, name] of Object.entries(DAY_COLUMNS)) {
    if (line[col] && line[col] !== ' ') out += name;
  }
  return out;
}

// A file whose shape is not the one the column map describes is a layout
// change, not a stray line, so a caller that tolerates a few bad subjects has
// to rethrow this rather than count it as one of them.
function layoutError(message) {
  const err = new Error(message);
  err.layout = true;
  return err;
}

function parseSubjectFile(subject, term, text) {
  const lines = text.split('\n');
  const header = HEADER_RE.exec(lines[0] ?? '');
  if (!header) throw layoutError(`${subject}: unrecognised header ${JSON.stringify(lines[0])}`);
  if (header[2] !== term) throw layoutError(`${subject}: header term ${header[2]} is not ${term}`);

  const columnsAt = lines.slice(0, COLUMNS_SEARCH_LINES).findIndex((line) => COLUMNS_RE.test(line));
  if (columnsAt < 0) throw layoutError(`${subject}: no column header near the top of the file`);

  const sections = [];
  const failures = [];
  let continuations = 0;

  // Two trailer tables follow the section list and use different layouts.
  for (const line of lines.slice(columnsAt + 1)) {
    if (line.startsWith('INDependent study classes') || line.startsWith('waitlist report')) break;
    if (!line.trim()) continue;

    const classNumber = slice(line, FIELDS.classNumber).trim();
    if (!/^\d+$/.test(classNumber)) {
      // "and  M  0715P-0900" rows carry an extra meeting time for the section above.
      if (/^\s+and\s/.test(line)) continuations++;
      else failures.push(line);
      continue;
    }

    const tail = TAIL_RE.exec(slice(line, FIELDS.tail));
    if (!tail) {
      failures.push(line);
      continue;
    }
    if (residueOf(line, Object.values(FIELDS))) {
      failures.push(line);
      continue;
    }

    sections.push({
      classNumber,
      subject: slice(line, FIELDS.subject).trim(),
      catalog: slice(line, FIELDS.catalog).trim(),
      campus: slice(line, FIELDS.campus).trim(),
      component: slice(line, FIELDS.component).trim(),
      autoEnroll: slice(line, FIELDS.autoEnroll).trim(),
      days: parseDays(line),
      time: slice(line, FIELDS.time).trim(),
      room: tail[1] ?? '',
      enrolled: Number(tail[2]),
      limit: Number(tail[3]),
      waitlist: tail[4] ? Number(tail[4]) : 0,
      instructor: line.slice(INSTRUCTOR_START).trim(),
    });
  }

  return { termName: header[3], updated: header[4], sections, failures, continuations };
}

function toIsoDate(barrettDate) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(barrettDate);
  if (!m) return barrettDate;
  const month = MONTHS.indexOf(m[2]);
  if (month < 0) return barrettDate;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
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

async function snapshotTerm(term, subjects) {
  const started = Date.now();
  const results = await mapLimit(subjects, CONCURRENCY, async (subject) => {
    const text = await fetchText(`${BASE}/${subject}/${term}.txt`, { allow404: true });
    if (text === null) return { subject, offered: false };
    return { subject, offered: true, ...parseSubjectFile(subject, term, text) };
  });

  const byClass = new Map();
  const collisions = [];
  const failures = [];
  let offered = 0;
  let continuations = 0;
  let updated = '';
  let termName = '';

  for (const r of results) {
    if (!r.offered) continue;
    offered++;
    continuations += r.continuations;
    for (const line of r.failures) failures.push(`${r.subject}: ${JSON.stringify(line)}`);
    if (toIsoDate(r.updated) > toIsoDate(updated)) updated = r.updated;
    if (!termName) termName = r.termName;
    for (const s of r.sections) {
      const prev = byClass.get(s.classNumber);
      if (prev && (prev.enrolled !== s.enrolled || prev.limit !== s.limit)) {
        collisions.push(s.classNumber);
      }
      byClass.set(s.classNumber, s);
    }
  }

  const parsed = byClass.size;
  const seen = parsed + failures.length;
  const residueRate = seen ? failures.length / seen : 0;

  const sections = {};
  for (const key of [...byClass.keys()].sort((a, b) => Number(a) - Number(b))) {
    const s = byClass.get(key);
    sections[key] = [s.enrolled, s.limit, s.waitlist];
  }

  const snapshot = {
    term,
    termName,
    sourceUpdated: toIsoDate(updated),
    sections,
  };

  return {
    snapshot,
    stats: {
      term,
      subjectsListed: subjects.length,
      subjectsOffered: offered,
      sectionsParsed: parsed,
      continuationRows: continuations,
      residueFailures: failures.length,
      residueRate,
      collisions: collisions.length,
      seconds: (Date.now() - started) / 1000,
    },
    failures,
  };
}

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, contents);
  await rename(tmp, path); // rename is atomic, so a crash cannot leave a partial file
}

// Key order comes from insertion, so identical input gives an identical file and
// the workflow finds nothing to commit.
async function writeJson(path, value) {
  const json = `${JSON.stringify(value, null, 0)}\n`;
  await writeAtomic(path, json);
  return Buffer.byteLength(json);
}

async function readIndex() {
  try {
    return JSON.parse(await readFile(join(OUT_DIR, INDEX_NAME), 'utf8'));
  } catch {
    return null; // no index yet, or one this version cannot read
  }
}

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
  const searchable = await searchableTerms();
  const terms = requested.length ? searchable.filter((t) => requested.includes(t)) : searchable;
  if (!terms.length) throw new Error(`none of ${requested.join(', ')} is searchable`);

  // One subject index covers every term. It lists every code Barrett knows, and
  // a subject not offered in a term 404s, which is normal and not an error.
  const subjects = await fetchSubjects();
  console.log(`${terms.length} searchable terms (${terms.join(', ')}), ${subjects.length} subjects listed`);

  const out = {};
  let residueSeen = 0;
  let sectionsSeen = 0;

  for (const term of terms) {
    const { snapshot, stats, failures } = await snapshotTerm(term, subjects);
    out[term] = snapshot;
    residueSeen += stats.residueFailures;
    sectionsSeen += stats.sectionsParsed;

    console.log(
      `term ${term}: ${stats.subjectsOffered} subjects offered, ` +
        `${stats.sectionsParsed} sections, ${stats.residueFailures} residue failures, ` +
        `${stats.continuationRows} continuation rows, ${stats.collisions} collisions, ` +
        `${stats.seconds.toFixed(1)}s`
    );
    for (const f of failures.slice(0, 20)) console.log(`  residue ${f}`);
    if (stats.sectionsParsed === 0) throw new Error(`term ${term}: no sections parsed`);
    if (stats.subjectsOffered < MIN_SUBJECTS) {
      throw new Error(`term ${term}: only ${stats.subjectsOffered} subjects returned data`);
    }
  }

  const rate = sectionsSeen + residueSeen ? residueSeen / (sectionsSeen + residueSeen) : 0;
  if (rate > MAX_RESIDUE_RATE) {
    throw new Error(
      `residue rate ${(rate * 100).toFixed(2)}% exceeds ${(MAX_RESIDUE_RATE * 100).toFixed(2)}%, ` +
        'the fixed-width layout probably changed, refusing to write'
    );
  }

  // One file per term. Nothing is written until every term has cleared the
  // checks above, so a bad run cannot leave one term fresh and another stale.
  const entries = [];
  for (const term of terms) {
    const snapshot = out[term];
    const file = `${TERM_PREFIX}${term}.json`;
    const bytes = await writeJson(join(OUT_DIR, file), snapshot);
    entries.push({
      term,
      termName: snapshot.termName,
      sourceUpdated: snapshot.sourceUpdated,
      sections: Object.keys(snapshot.sections).length,
      file,
    });
    console.log(`wrote data/${file} (${bytes} bytes, ${(bytes / 1024).toFixed(1)} KiB)`);
  }

  // A run for named terms leaves the rest alone, so their index entries carry
  // over. A term that is no longer searchable does not, which is what drops it
  // from the index and then from disk.
  const previous = await readIndex();
  for (const entry of previous?.terms ?? []) {
    const term = String(entry?.term ?? '');
    if (!searchable.includes(term)) continue;
    if (entries.some((e) => e.term === term)) continue;
    if (entry.file !== `${TERM_PREFIX}${term}.json`) continue;
    if (!(await exists(join(OUT_DIR, entry.file)))) continue;
    entries.push(entry);
  }
  entries.sort((a, b) => a.term.localeCompare(b.term));

  // The index is what the page reads first, so it stays tiny. It says which
  // terms exist at all, which is what lets the page tell a term Barrett does
  // not publish from one it has simply not fetched yet.
  const indexBytes = await writeJson(join(OUT_DIR, INDEX_NAME), {
    source: `${BASE}/`,
    fields: ['enrolled', 'limit', 'waitlist'],
    note: 'Barrett rebuilds a live term once a day around 06:50 Eastern and freezes a term once it is over, so sourceUpdated differs per term. A missing class number means unknown, not zero.',
    terms: entries,
  });
  console.log(`wrote data/${INDEX_NAME} (${indexBytes} bytes)`);

  for (const name of await readdir(OUT_DIR)) {
    if (!TERM_FILE_RE.test(name)) continue;
    if (entries.some((e) => e.file === name)) continue;
    await rm(join(OUT_DIR, name));
    console.log(`removed data/${name}, that term is no longer searchable`);
  }
}

// Exported so a checker can reuse the parser without refetching.
export { parseSubjectFile };

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
