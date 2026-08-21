#!/usr/bin/env node
// Snapshots the full Ohio State roster from RateMyProfessors into data/ratings.json.
//
// The site is static and runs entirely in the browser, but RateMyProfessors sends no
// CORS headers, so the browser can never call it. This script runs in CI instead and
// commits the result as a plain asset that GitHub Pages serves.
//
// Usage: node scripts/fetch-ratings.mjs

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://www.ratemyprofessors.com/graphql";

// Opaque relay id for Ohio State University (Columbus), legacyId 724. The regional
// campuses (Marion, Lima, Newark, Mansfield, ATI) are separate schools upstream and
// are deliberately not included.
const SCHOOL_ID = "U2Nob29sLTcyNA==";
const SCHOOL_LEGACY_ID = 724;
const SCHOOL_NAME = "Ohio State University";

// Upstream rejects anything at or above 2000 outright. A large page is also the safer
// choice here: `after` cursors are just base64 of `arrayconnection:N`, and the index
// behind those offsets is rebuilt periodically, so a rebuild partway through a run
// shifts every later offset and the pass skips whatever moved across the boundary. At
// 500 the whole roster takes 17 requests instead of 42, which gives the index far fewer
// chances to shift under us. What it does drop is consistently the unrated tail, which
// is discarded below anyway: measured over six full runs, raw edge counts ranged 8306
// to 8337 of 8366 and every run still produced the identical 7367 rated records.
const PAGE_SIZE = 500;
const PAGE_DELAY_MS = 300;
const MAX_ATTEMPTS = 3;
const MAX_PAGES = 200; // stops a broken cursor from looping forever

// ~7.3k Ohio State professors have at least one rating. Anything far below that means
// upstream changed shape or started rate limiting, and writing it would silently gut
// the file the site reads.
const MIN_EXPECTED = 5000;

const OUT_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), "data", "ratings.json");

// This public credential is what the RateMyProfessors web client itself sends.
const HEADERS = {
  "Content-Type": "application/json",
  Authorization: "Basic dGVzdDp0ZXN0",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

const QUERY = `query Roster($school: ID!, $first: Int!, $after: String) {
  newSearch {
    teachers(query: {text: "", schoolID: $school}, first: $first, after: $after) {
      resultCount
      pageInfo { hasNextPage endCursor }
      edges { node { legacyId firstName lastName department avgRating numRatings avgDifficulty wouldTakeAgainPercent } }
    }
  }
}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(after) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ query: QUERY, variables: { school: SCHOOL_ID, first: PAGE_SIZE, after } }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

      const body = await response.json();
      if (body.errors?.length) throw new Error(`GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);

      const teachers = body.data?.newSearch?.teachers;
      if (!teachers) throw new Error("response missing newSearch.teachers");

      return teachers;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const backoff = 1000 * 2 ** (attempt - 1);
        console.warn(`  attempt ${attempt} failed (${error.message}), retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }

  throw new Error(`page failed after ${MAX_ATTEMPTS} attempts: ${lastError.message}`);
}

function normalize(node) {
  // Upstream uses -1 as "no data" for these three rather than null, which would render
  // as a real score if passed straight through to the page.
  const score = (value) => (typeof value === "number" && value >= 0 ? value : null);

  // Key order is fixed here because JSON.stringify preserves insertion order, and the
  // file has to come out byte-identical when the roster has not changed.
  return {
    legacyId: node.legacyId,
    firstName: (node.firstName ?? "").trim(),
    lastName: (node.lastName ?? "").trim(),
    department: (node.department ?? "").trim(),
    avgRating: score(node.avgRating),
    numRatings: node.numRatings ?? 0,
    avgDifficulty: score(node.avgDifficulty),
    wouldTakeAgainPercent: score(node.wouldTakeAgainPercent),
  };
}

async function main() {
  const professors = new Map(); // keyed by legacyId; paging can repeat an edge
  let after;
  let resultCount = 0;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const teachers = await fetchPage(after);
    pages++;
    resultCount = teachers.resultCount ?? resultCount;

    for (const edge of teachers.edges ?? []) {
      const node = edge?.node;
      if (node?.legacyId == null) continue;
      professors.set(node.legacyId, normalize(node));
    }

    console.log(`page ${pages}: ${professors.size}/${resultCount}`);

    if (!teachers.pageInfo?.hasNextPage) break;
    after = teachers.pageInfo.endCursor;
    if (!after) break;

    await sleep(PAGE_DELAY_MS);
  }

  // Unrated professors are dropped: they have no score, no difficulty and no
  // would-take-again, so there is nothing for the site to put next to a name.
  const fresh = [...professors.values()].filter((p) => p.numRatings > 0);

  console.log(`fetched ${professors.size} of ${resultCount}, ${fresh.length} of them rated`);

  if (fresh.length < MIN_EXPECTED) {
    console.error(
      `Refusing to write: got ${fresh.length} rated professors, expected at least ${MIN_EXPECTED}. ` +
        `Upstream reported resultCount ${resultCount}. Leaving ${OUT_PATH} untouched.`
    );
    process.exit(1);
  }

  const records = fresh.sort((a, b) => a.legacyId - b.legacyId);

  const snapshot = {
    school: { id: SCHOOL_ID, legacyId: SCHOOL_LEGACY_ID, name: SCHOOL_NAME },
    count: records.length,
    professors: records,
  };

  // No fetch timestamp on purpose: it would change every night and defeat the
  // commit-only-when-changed check. The commit date already records when it ran.
  const json = JSON.stringify(snapshot, null, 0) + "\n";

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const tmp = `${OUT_PATH}.tmp`;
  await writeFile(tmp, json, "utf8");
  await rename(tmp, OUT_PATH); // rename is atomic, so a crash cannot leave a partial file

  console.log(`Wrote ${records.length} professors to ${OUT_PATH} (${json.length} bytes)`);
}

main().catch((error) => {
  console.error(`fetch-ratings failed: ${error.message}`);
  process.exit(1);
});
