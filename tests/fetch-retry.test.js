// The retry policy the two nightly snapshot scripts share. fetch and setTimeout
// are both replaced, so nothing here touches the network or actually waits.

import test from "node:test";
import assert from "node:assert/strict";

import { fetchText } from "../scripts/fetch-seats.mjs";
import { fetchJson } from "../scripts/fetch-courses.mjs";

const URL_UNDER_TEST = "https://example.invalid/thing.txt";

// The two scripts hold a hand-copied loop each, so every case runs against both
// and the copies cannot drift apart quietly.
const CLIENTS = [
  ["seats", fetchText, "ok"],
  ["courses", fetchJson, { body: "ok" }],
];

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;

/** Answer in order, repeating the last. A reply is a status or [status, retryAfter]. */
function replyWith(replies) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const reply = replies[Math.min(calls.length, replies.length - 1)];
    const [status, retryAfter = null] = Array.isArray(reply) ? reply : [reply];
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      headers: { get: (name) => (name.toLowerCase() === "retry-after" ? retryAfter : null) },
      text: async () => "ok",
      json: async () => ({ body: "ok" }),
    };
  };
  return calls;
}

/** Fire every backoff immediately and record the wait it asked for. */
function recordDelays() {
  const delays = [];
  globalThis.setTimeout = (fn, ms) => {
    delays.push(ms);
    return realSetTimeout(fn, 0);
  };
  return delays;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
});

for (const [client, get, ok] of CLIENTS) {
  // Regression, #90. The whole 4xx range was fatal, so the one status that means
  // wait and try again skipped the backoff written for it and ended the run.
  test(`regression #90: ${client} retries a 429 instead of ending the run`, async () => {
    const delays = recordDelays();
    const calls = replyWith([429, 200]);
    assert.deepEqual(await get(URL_UNDER_TEST), ok);
    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [500]);
  });

  test(`${client}: 408 and 425 are retried too`, async () => {
    for (const status of [408, 425]) {
      recordDelays();
      const calls = replyWith([status, 200]);
      assert.deepEqual(await get(URL_UNDER_TEST), ok, `${status} should be retried`);
      assert.equal(calls.length, 2, `${status} should be retried`);
    }
  });

  test(`${client}: a rate limit that never clears still gives up`, async () => {
    const delays = recordDelays();
    const calls = replyWith([429]);
    await assert.rejects(() => get(URL_UNDER_TEST), /429/);
    assert.equal(calls.length, 4, "the first try plus RETRIES");
    assert.deepEqual(delays, [500, 1000, 2000]);
  });

  test(`${client}: Retry-After sets the wait when the header is there`, async () => {
    const delays = recordDelays();
    replyWith([[429, "2"], 200]);
    await get(URL_UNDER_TEST);
    assert.deepEqual(delays, [2000]);
  });

  test(`${client}: Retry-After is read as a date as well as a count of seconds`, async () => {
    const delays = recordDelays();
    replyWith([[429, new Date(Date.now() + 5000).toUTCString()], 200]);
    await get(URL_UNDER_TEST);
    assert.ok(delays[0] > 3000 && delays[0] <= 5000, `waited ${delays[0]}ms`);
  });

  test(`${client}: a Retry-After longer than the cap does not stall one request`, async () => {
    const delays = recordDelays();
    replyWith([[429, "3600"], 200]);
    await get(URL_UNDER_TEST);
    assert.deepEqual(delays, [30000]);
  });

  // A wait is digits or a date. Number() would take the rest of these as well,
  // which is how a Retry-After of 0x10 turns into sixteen seconds.
  test(`${client}: a Retry-After that is not a wait falls back to the backoff`, async () => {
    const notWaits = ["soon", "-5", "0", "", "Thu, 01 Jan 1970 00:00:00 GMT"];
    const numberWouldTake = ["0x10", "1e3", "1.5", "+2"];
    for (const header of [...notWaits, ...numberWouldTake]) {
      const delays = recordDelays();
      replyWith([[429, header], 200]);
      await get(URL_UNDER_TEST);
      assert.deepEqual(delays, [500], `Retry-After: ${header}`);
    }
  });

  // A rate limiter in front of the origin answers 503 as readily as 429.
  test(`${client}: a 503 carrying Retry-After is waited out too`, async () => {
    const delays = recordDelays();
    replyWith([[503, "7"], 200]);
    await get(URL_UNDER_TEST);
    assert.deepEqual(delays, [7000]);
  });

  // A dropped connection never reaches a header, so without the per-attempt
  // reset a capped Retry-After would be spent again on every attempt left.
  test(`${client}: a Retry-After does not carry into the next attempt`, async () => {
    const delays = recordDelays();
    let sent = 0;
    globalThis.fetch = async () => {
      if (sent++ > 0) throw new Error("socket hang up");
      return { ok: false, status: 429, statusText: "", headers: { get: () => "3600" } };
    };
    await assert.rejects(() => get(URL_UNDER_TEST), /socket hang up/);
    assert.deepEqual(delays, [30000, 1000, 2000]);
  });

  test(`${client}: a 403 is retried once and then gives up`, async () => {
    const delays = recordDelays();
    const calls = replyWith([403]);
    await assert.rejects(() => get(URL_UNDER_TEST), /403/);
    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [500]);
  });

  test(`${client}: the rest of 4xx is still fatal on the first response`, async () => {
    for (const status of [400, 401, 404, 410, 451]) {
      const delays = recordDelays();
      const calls = replyWith([status]);
      await assert.rejects(() => get(URL_UNDER_TEST), new RegExp(String(status)));
      assert.equal(calls.length, 1, `${status} should not be retried`);
      assert.deepEqual(delays, [], `${status} should not be retried`);
    }
  });

  // Not every fetch stand-in is a full Response, and a missing header must not
  // turn a status that says what went wrong into one that does not.
  test(`${client}: a response with no headers still reports its status`, async () => {
    recordDelays();
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "",
      json: async () => ({}),
    });
    await assert.rejects(() => get(URL_UNDER_TEST), /failed: 500 Internal Server Error/);
  });

  test(`${client}: a 5xx still retries`, async () => {
    const delays = recordDelays();
    const calls = replyWith([503, 200]);
    assert.deepEqual(await get(URL_UNDER_TEST), ok);
    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [500]);
  });
}

// fetchJson takes no options, so only the seats client can be asked this one.
test("an expected 404 is still not an error", async () => {
  const calls = replyWith([404]);
  assert.equal(await fetchText(URL_UNDER_TEST, { allow404: true }), null);
  assert.equal(calls.length, 1);
});
