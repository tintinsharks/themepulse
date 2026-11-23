import test from "node:test";
import assert from "node:assert/strict";
import { createQuoteStore, marketPhase } from "../src/liveQuotes.js";

test("fetchQuotes serves fresh cache hits and only fetches missing/stale overlap", async () => {
  let t = 1_000_000;
  const calls = [];
  const store = createQuoteStore({
    now: () => t,
    fetcher: async (batch) => {
      calls.push([...batch]);
      return batch.map((ticker) => ({ ticker, price: 100 + calls.length }));
    },
  });

  const m1 = await store.fetchQuotes(["NVDA", "PLTR"], { maxAgeMs: 30_000 });
  assert.deepEqual(calls, [["NVDA", "PLTR"]]);
  assert.equal(m1.get("NVDA").price, 101);

  // Within TTL: overlapping NVDA is served from cache; only AVGO is fetched
  t += 10_000;
  const m2 = await store.fetchQuotes(["NVDA", "AVGO"], { maxAgeMs: 30_000 });
  assert.deepEqual(calls, [["NVDA", "PLTR"], ["AVGO"]]);
  assert.equal(m2.get("NVDA").price, 101);
  assert.equal(m2.get("AVGO").price, 102);

  // Past TTL: NVDA refreshes, AVGO is still fresh
  t += 25_000;
  const m3 = await store.fetchQuotes(["NVDA", "AVGO"], { maxAgeMs: 30_000 });
  assert.deepEqual(calls, [["NVDA", "PLTR"], ["AVGO"], ["NVDA"]]);
  assert.equal(m3.get("NVDA").price, 103);
  assert.equal(m3.get("AVGO").price, 102);
});

test("fetchQuotes coalesces concurrent in-flight requests for overlapping tickers", async () => {
  const calls = [];
  let release;
  const gate = new Promise((res) => { release = res; });

  const store = createQuoteStore({
    now: () => 2_000_000,
    fetcher: async (batch) => {
      calls.push([...batch]);
      if (calls.length === 1) await gate;
      return batch.map((ticker) => ({ ticker, price: 200 }));
    },
  });

  const p1 = store.fetchQuotes(["NVDA", "QQQ"]);
  const p2 = store.fetchQuotes(["NVDA", "SPY"]);
  release();
  const [m1, m2] = await Promise.all([p1, p2]);

  assert.deepEqual(calls, [["NVDA", "QQQ"], ["SPY"]]);
  assert.equal(m1.get("NVDA").price, 200);
  assert.equal(m2.get("NVDA").price, 200);
  assert.equal(m2.get("SPY").price, 200);
});

test("fetchQuotes chunks large ticker lists by maxBatch and notifies listeners", async () => {
  const calls = [];
  let notified = 0;
  const store = createQuoteStore({
    now: () => 3_000_000,
    maxBatch: 2,
    fetcher: async (batch) => {
      calls.push([...batch]);
      return batch.map((ticker) => ({ ticker, price: 50 }));
    },
  });

  const unsub = store.subscribe(() => { notified++; });
  const m = await store.fetchQuotes(["A", "B", "C", "D", "E", "A"]);
  unsub();

  assert.deepEqual(calls, [["A", "B"], ["C", "D"], ["E"]]);
  assert.equal(m.size, 5);
  assert.equal(notified, 1);
});

test("marketPhase classifies RTH, extended hours, and weekend off-hours in ET", () => {
  // Monday 2026-11-23 11:00 AM EST = 16:00 UTC -> rth
  assert.equal(marketPhase(new Date("2026-11-23T16:00:00Z")), "rth");
  // Monday 2026-11-23 7:00 AM EST = 12:00 UTC -> ext
  assert.equal(marketPhase(new Date("2026-11-23T12:00:00Z")), "ext");
  // Monday 2026-11-23 11:00 PM EST = Tue 04:00 UTC -> off
  assert.equal(marketPhase(new Date("2026-11-24T04:00:00Z")), "off");
  // Saturday 2026-11-21 12:00 PM EST = 17:00 UTC -> off
  assert.equal(marketPhase(new Date("2026-11-21T17:00:00Z")), "off");
});
