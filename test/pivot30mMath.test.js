import test from "node:test";
import assert from "node:assert/strict";
import {
  formatEtTime,
  computeEmaSeries,
  computeFloorPivots,
  computeOpeningRange,
  analyze30mPivot,
  score30mSetup,
} from "../src/lead/pivot30mMath.js";
import ohlcHandler from "../api/ohlc.js";
import { createToken } from "../api/auth.js";

// Helper: convert "YYYY-MM-DD HH:MM" in EST (-05:00) or EDT (-04:00) to unix seconds.
function etSec(dateStr, hhmm, isEdt = false) {
  const offset = isEdt ? "-04:00" : "-05:00";
  return Math.floor(new Date(`${dateStr}T${hhmm}:00${offset}`).getTime() / 1000);
}

// Helper: generate consecutive 30m RTH bars starting at 09:30 ET on a given EST date.
function makeSessionBars(dateStr, specs, startSlot = 0) {
  const baseSec = etSec(dateStr, "09:30", false);
  return specs.map((s, idx) => ({
    time: baseSec + (startSlot + idx) * 1800,
    open: s.o,
    high: s.h,
    low: s.l,
    close: s.c,
    volume: s.v ?? 100000,
  }));
}

test("formatEtTime converts EST and EDT unix timestamps accurately", () => {
  // EST: 2026-01-15 09:30:00 EST = 14:30:00Z
  const estOpen = Math.floor(new Date("2026-01-15T14:30:00Z").getTime() / 1000);
  assert.deepEqual(formatEtTime(estOpen), {
    date: "2026-01-15",
    hhmm: "09:30",
    hour: 9,
    minute: 30,
    label: "9:30",
  });

  // EDT: 2026-07-15 09:30:00 EDT = 13:30:00Z
  const edtOpen = Math.floor(new Date("2026-07-15T13:30:00Z").getTime() / 1000);
  assert.deepEqual(formatEtTime(edtOpen), {
    date: "2026-07-15",
    hhmm: "09:30",
    hour: 9,
    minute: 30,
    label: "9:30",
  });

  // Afternoon EDT: 2026-07-15 15:30:00 EDT = 19:30:00Z
  const edtClose = Math.floor(new Date("2026-07-15T19:30:00Z").getTime() / 1000);
  assert.deepEqual(formatEtTime(edtClose), {
    date: "2026-07-15",
    hhmm: "15:30",
    hour: 15,
    minute: 30,
    label: "15:30",
  });

  // Invalid inputs return null
  assert.equal(formatEtTime(null), null);
  assert.equal(formatEtTime(undefined), null);
  assert.equal(formatEtTime(NaN), null);
  assert.equal(formatEtTime("2026-01-15"), null);
});

test("computeEmaSeries seeds with SMA and tracks standard EMA", () => {
  assert.deepEqual(computeEmaSeries([], 10), []);
  const shortBars = [{ close: 10 }, { close: 11 }];
  assert.deepEqual(computeEmaSeries(shortBars, 5), [null, null]);

  // Period 3 on closes [10, 11, 12, 15, 18]:
  // seed at idx 2 = (10+11+12)/3 = 11.00
  // k = 2 / (3 + 1) = 0.5
  // idx 3 = 15 * 0.5 + 11 * 0.5 = 13.00
  // idx 4 = 18 * 0.5 + 13 * 0.5 = 15.50
  const bars = [10, 11, 12, 15, 18].map((close) => ({ close }));
  assert.deepEqual(computeEmaSeries(bars, 3), [null, null, 11, 13, 15.5]);
});

test("computeFloorPivots computes CPR/R1/R2/S1/S2, enforces tc >= bc, and classifies bias", () => {
  // Case 1: Close near high (p > bcRaw)
  const bull = computeFloorPivots(110, 100, 108, 109);
  // p = 318/3 = 106, bcRaw = 105, tcRaw = 107 -> bc = 105, tc = 107
  // r1 = 212 - 100 = 112, s1 = 212 - 110 = 102, r2 = 116, s2 = 96
  assert.equal(bull.p, 106);
  assert.equal(bull.bc, 105);
  assert.equal(bull.tc, 107);
  assert.ok(bull.tc >= bull.bc);
  assert.equal(bull.r1, 112);
  assert.equal(bull.s1, 102);
  assert.equal(bull.r2, 116);
  assert.equal(bull.s2, 96);
  assert.equal(bull.bias, "ABOVE_CPR");
  assert.equal(bull.cprWidthPct, 1.89);

  // Inside CPR
  const inside = computeFloorPivots(110, 100, 108, 106);
  assert.equal(inside.bias, "INSIDE_CPR");

  // Below CPR
  const below = computeFloorPivots(110, 100, 108, 104);
  assert.equal(below.bias, "BELOW_CPR");

  // Case 2: Close near low (p < bcRaw -> tcRaw < bcRaw, must still keep tc >= bc)
  const bear = computeFloorPivots(110, 100, 102, 100.5);
  // p = 104, bcRaw = 105, tcRaw = 103 -> bc = 103, tc = 105
  assert.equal(bear.p, 104);
  assert.equal(bear.bc, 103);
  assert.equal(bear.tc, 105);
  assert.ok(bear.tc >= bear.bc);
  assert.equal(bear.bias, "BELOW_CPR");

  // No currentPrice -> null bias
  const noPrice = computeFloorPivots(110, 100, 108);
  assert.equal(noPrice.bias, null);

  // Invalid inputs -> null
  assert.equal(computeFloorPivots(100, 110, 105, 105), null);
  assert.equal(computeFloorPivots(0, 0, 0, 100), null);
});

test("computeOpeningRange classifies ORH_BO, ORL_BD, FAILED_HIGH, FAILED_LOW, and INSIDE", () => {
  // OR bar: high 105, low 100 (mid 102.5, rangePct 5.0)
  const orBar = { o: 101, h: 105, l: 100, c: 104 };

  // ORH_BO
  const boBars = makeSessionBars("2026-11-25", [orBar, { o: 104, h: 107, l: 103.5, c: 106.5 }]);
  const bo = computeOpeningRange(boBars);
  assert.equal(bo.sessionDate, "2026-11-25");
  assert.equal(bo.barIdx, 0);
  assert.equal(bo.orh, 105);
  assert.equal(bo.orl, 100);
  assert.equal(bo.mid, 102.5);
  assert.equal(bo.rangePct, 5);
  assert.equal(bo.status, "ORH_BO");
  assert.equal(bo.label, "ORH BO");

  // ORL_BD
  const bdBars = makeSessionBars("2026-11-25", [orBar, { o: 101, h: 102, l: 98.5, c: 99 }]);
  const bd = computeOpeningRange(bdBars);
  assert.equal(bd.status, "ORL_BD");
  assert.equal(bd.label, "ORL BD");

  // FAILED_HIGH: poked above 105 then closed back inside <= 105
  const fhBars = makeSessionBars("2026-11-25", [orBar, { o: 104, h: 106.2, l: 102, c: 103.5 }]);
  const fh = computeOpeningRange(fhBars);
  assert.equal(fh.status, "FAILED_HIGH");
  assert.equal(fh.label, "FAILED HI");

  // FAILED_LOW: poked below 100 then reclaimed inside >= 100
  const flBars = makeSessionBars("2026-11-25", [orBar, { o: 101, h: 103, l: 99.1, c: 102 }]);
  const fl = computeOpeningRange(flBars);
  assert.equal(fl.status, "FAILED_LOW");
  assert.equal(fl.label, "FAILED LO");

  // INSIDE: never exceeded ORH or ORL
  const inBars = makeSessionBars("2026-11-25", [orBar, { o: 103, h: 104.5, l: 101, c: 103.2 }]);
  const inside = computeOpeningRange(inBars);
  assert.equal(inside.status, "INSIDE");
  assert.equal(inside.label, "INSIDE OR");

  // Live price override triggers ORH_BO even if last bar close was inside
  const liveBo = computeOpeningRange(inBars, 105.5);
  assert.equal(liveBo.status, "ORH_BO");
});

test("analyze30mPivot detects ARMED after 3 red bars + green reversal", () => {
  const day1 = makeSessionBars("2026-11-24", [
    { o: 96, h: 98, l: 95, c: 97.5 },
    { o: 97.5, h: 99.5, l: 97, c: 99 },
    { o: 99, h: 101, l: 98.5, c: 100.5 },
  ]);
  const day2 = makeSessionBars("2026-11-25", [
    { o: 101, h: 106, l: 100.5, c: 105 }, // OR bar (green)
    { o: 105, h: 105.2, l: 103.5, c: 103.8 }, // red 1
    { o: 103.8, h: 104.0, l: 102.2, c: 102.5 }, // red 2
    { o: 102.5, h: 102.8, l: 101.0, c: 101.4 }, // red 3 (pullback low = 101.0)
    { o: 101.5, h: 103.0, l: 101.2, c: 102.8 }, // green reversal pivot (entry = 103.0, stop = 101.0)
  ]);

  const res = analyze30mPivot([...day1, ...day2], { livePrice: 102.6 });
  assert.equal(res.ok, true);
  assert.equal(res.pivot.state, "ARMED");
  assert.equal(res.pivot.shortLabel, "ARMED");
  assert.equal(res.pivot.label, "BUY > $103.00");
  assert.equal(res.pivot.tone, "amber");
  assert.equal(res.pivot.redCount, 3);
  assert.equal(res.pivot.entry, 103);
  assert.equal(res.pivot.stop, 101);
  assert.equal(res.pivot.riskPct, 1.94);
  assert.equal(res.pivot.target2R, 107);
  assert.equal(res.pivot.target3R, 109);
  assert.equal(res.pivot.barsSincePivot, 0);
  assert.equal(res.pivot.triggerBarIdx, null);
  assert.equal(res.pivot.triggerTime, null);
  assert.equal(res.pivot.distToEntryPct, 0.39);
  // Floor pivots derived from day1 (H=101, L=95, C=100.5)
  assert.ok(res.floorPivots);
  assert.equal(res.floorPivots.p, 98.83);
  assert.equal(res.floorPivots.bias, "ABOVE_CPR");
});

test("analyze30mPivot detects TRIGGERED with +2R target and live R-multiple", () => {
  const bars = makeSessionBars("2026-11-25", [
    { o: 100, h: 105, l: 99.5, c: 104.5 }, // green
    { o: 104.5, h: 104.6, l: 103.0, c: 103.2 }, // red 1
    { o: 103.2, h: 103.4, l: 102.0, c: 102.2 }, // red 2 (pullback low = 102.0)
    { o: 102.3, h: 104.0, l: 102.1, c: 103.8 }, // green pivot (entry = 104.0, stop = 102.0, risk = 2.0)
    { o: 103.9, h: 106.5, l: 103.8, c: 106.0 }, // trigger bar
  ]);

  const res = analyze30mPivot(bars, { livePrice: 107.0 });
  assert.equal(res.ok, true);
  assert.equal(res.pivot.state, "TRIGGERED");
  assert.equal(res.pivot.tone, "green");
  assert.equal(res.pivot.entry, 104);
  assert.equal(res.pivot.stop, 102);
  assert.equal(res.pivot.target2R, 108);
  assert.equal(res.pivot.target3R, 110);
  assert.equal(res.pivot.rMultipleNow, 1.5);
  assert.equal(res.pivot.pivotBarIdx, 3);
  assert.equal(res.pivot.triggerBarIdx, 4);
  assert.equal(res.pivot.triggerTime, bars[4].time);
  assert.equal(res.openingRange.status, "ORH_BO");
});

test("analyze30mPivot detects active PULLBACK on trailing red streak", () => {
  const bars = makeSessionBars("2026-11-25", [
    { o: 100, h: 104, l: 99.5, c: 103.5 },
    { o: 103.5, h: 105, l: 103, c: 104.5 },
    { o: 104.5, h: 104.6, l: 103.1, c: 103.3 }, // red 1
    { o: 103.3, h: 103.5, l: 102.0, c: 102.2 }, // red 2
    { o: 102.2, h: 102.5, l: 101.2, c: 101.5 }, // red 3
  ]);

  const res = analyze30mPivot(bars);
  assert.equal(res.ok, true);
  assert.equal(res.pivot.state, "PULLBACK");
  assert.equal(res.pivot.shortLabel, "PULLBACK");
  assert.equal(res.pivot.label, "PULLBACK (3 red)");
  assert.equal(res.pivot.tone, "cyan");
  assert.equal(res.pivot.redCount, 3);
  assert.equal(res.pivot.entry, 102.5);
  assert.equal(res.pivot.stop, 101.2);
});

test("analyze30mPivot marks pivot STOPPED when subsequent bar or livePrice breaks stop", () => {
  const bars = makeSessionBars("2026-11-25", [
    { o: 100, h: 105, l: 99.5, c: 104.5 },
    { o: 104.5, h: 104.6, l: 103.0, c: 103.2 }, // red 1
    { o: 103.2, h: 103.3, l: 102.0, c: 102.2 }, // red 2 (low = 102.0)
    { o: 102.3, h: 104.0, l: 102.1, c: 103.8 }, // green pivot (entry = 104.0, stop = 102.0)
    { o: 103.8, h: 104.5, l: 101.4, c: 101.8 }, // breaks below stop 102.0
  ]);

  const res = analyze30mPivot(bars);
  assert.equal(res.ok, true);
  assert.equal(res.pivot.state, "STOPPED");
  assert.equal(res.pivot.tone, "red");
  assert.equal(res.pivot.stop, 102);
});

test("analyze30mPivot detects 1-red EMA-touch pullback pivot", () => {
  // Build 10 steady bars around 100 so EMA10 settles near 100.5, then 1 red bar dipping to EMA10, then green reversal.
  const specs = [];
  for (let i = 0; i < 10; i++) {
    const base = 100 + i * 0.1;
    specs.push({ o: base, h: base + 0.4, l: base - 0.1, c: base + 0.3 });
  }
  // At bar 9, EMA10 ~ 100.75. Bar 10 is 1 red candle dipping to 100.70 (right into EMA10).
  specs.push({ o: 101.4, h: 101.5, l: 100.7, c: 100.9 });
  // Bar 11 is green reversal closing in upper half.
  specs.push({ o: 100.95, h: 101.8, l: 100.85, c: 101.7 });

  const bars = makeSessionBars("2026-11-25", specs);
  const res = analyze30mPivot(bars, { livePrice: 101.6 });
  assert.equal(res.ok, true);
  assert.equal(res.pivot.state, "ARMED");
  assert.equal(res.pivot.redCount, 1);
  assert.equal(res.pivot.nearEma, true);
  assert.equal(res.pivot.entry, 101.8);
  assert.equal(res.pivot.stop, 100.7);
});

test("analyze30mPivot handles empty and very short inputs gracefully", () => {
  const empty = analyze30mPivot([]);
  assert.equal(empty.ok, false);
  assert.equal(empty.lastPrice, null);
  assert.equal(empty.pivot.state, "NONE");
  assert.equal(empty.openingRange, null);
  assert.equal(empty.floorPivots, null);
  assert.equal(empty.summary, "No 30m bars available.");

  const nil = analyze30mPivot(null);
  assert.equal(nil.ok, false);
  assert.equal(nil.pivot.state, "NONE");

  const oneBar = analyze30mPivot(makeSessionBars("2026-11-25", [{ o: 50, h: 52, l: 49, c: 51 }]));
  assert.equal(oneBar.ok, true);
  assert.equal(oneBar.lastPrice, 51);
  assert.equal(oneBar.pivot.state, "NONE");
  assert.equal(oneBar.openingRange.status, "INSIDE");
});

test("score30mSetup orders TRIGGERED > ARMED > ORH_BO > PULLBACK > WATCH", () => {
  const triggered = score30mSetup(
    { ok: true, pivot: { state: "TRIGGERED", rMultipleNow: 0.8 }, openingRange: { status: "ORH_BO" } },
    { rs_rank: 92 },
  );
  const armed = score30mSetup(
    { ok: true, pivot: { state: "ARMED", distToEntryPct: 0.9 }, openingRange: { status: "INSIDE" } },
    { rs_rank: 99 },
  );
  const orhBo = score30mSetup(
    { ok: true, pivot: { state: "NONE" }, openingRange: { status: "ORH_BO" } },
    { rs_rank: 98 },
  );
  const pullback = score30mSetup(
    { ok: true, pivot: { state: "PULLBACK" }, openingRange: { status: "INSIDE" } },
    { rs_rank: 97 },
  );
  const watch = score30mSetup(
    { ok: true, pivot: { state: "NONE" }, openingRange: { status: "INSIDE" } },
    { rs_rank: 99 },
  );

  assert.equal(triggered.badge, "TRIGGERED");
  assert.equal(triggered.actionable, true);
  assert.equal(armed.badge, "ARMED");
  assert.equal(armed.actionable, true);
  assert.equal(orhBo.badge, "ORH BO");
  assert.equal(orhBo.actionable, true);
  assert.equal(pullback.badge, "PULLBACK");
  assert.equal(pullback.actionable, true);
  assert.equal(watch.badge, "WATCH");
  assert.equal(watch.actionable, false);

  assert.ok(triggered.score > armed.score, `${triggered.score} > ${armed.score}`);
  assert.ok(armed.score > orhBo.score, `${armed.score} > ${orhBo.score}`);
  assert.ok(orhBo.score > pullback.score, `${orhBo.score} > ${pullback.score}`);
  assert.ok(pullback.score > watch.score, `${pullback.score} > ${watch.score}`);
});

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.end = () => res;
  return res;
}

test("GET /api/ohlc batch mode enforces auth, dedupes/caps at 24, tolerates errors, and caches", async () => {
  const prevPin = process.env.TP_PIN;
  const prevSecret = process.env.TP_SESSION_SECRET;
  const prevFmp = process.env.FMP_API_KEY;
  const origFetch = globalThis.fetch;

  try {
    process.env.TP_PIN = "2468";
    process.env.TP_SESSION_SECRET = "test-secret";
    process.env.FMP_API_KEY = "dummy-fmp-key";
    const tok = createToken("2468");

    // Unauthenticated batch request must return 401
    const unauthRes = mockRes();
    await ohlcHandler({ method: "GET", query: { tickers: "NVDA,DKS" }, headers: {} }, unauthRes);
    assert.equal(unauthRes.statusCode, 401);
    assert.equal(unauthRes.headers["Cache-Control"], "private, no-store");

    // Mock FMP fetch: count calls, fail one ticker ("BADONE")
    const calls = [];
    globalThis.fetch = async (url) => {
      const m = /symbol=([^&]+)/.exec(url);
      const sym = m ? decodeURIComponent(m[1]) : "";
      calls.push(sym);
      if (sym === "BADONE") {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => [
          { date: "2026-11-25 10:00:00", open: 101, high: 103, low: 100.5, close: 102.5, volume: 50000 },
          { date: "2026-11-25 09:30:00", open: 100, high: 102, low: 99.5, close: 101, volume: 80000 },
        ],
      };
    };

    // 26 unique tickers + duplicate + failing ticker -> capped at 24
    const syms = ["nvda", "NVDA", "BADONE"];
    for (let i = 1; i <= 25; i++) syms.push(`SYM${i}`);
    const batchRes = mockRes();
    await ohlcHandler(
      {
        method: "GET",
        query: { tickers: syms.join(",") },
        headers: { authorization: `Bearer ${tok}` },
      },
      batchRes,
    );

    assert.equal(batchRes.statusCode, 200);
    assert.equal(batchRes.headers["Cache-Control"], "s-maxage=60, stale-while-revalidate=120");
    assert.equal(batchRes.body.ok, true);
    assert.equal(batchRes.body.interval, "30m");
    assert.equal(calls.length, 24, "should cap batch fetch at 24 unique tickers");
    assert.equal(batchRes.body.items.BADONE, undefined, "failed ticker omitted without failing batch");
    assert.equal(batchRes.body.items.NVDA.length, 2);
    assert.ok(batchRes.body.items.NVDA[0].time < batchRes.body.items.NVDA[1].time, "bars sorted oldest -> newest");

    // Second call for NVDA should hit warm 60s cache (0 new fetch calls)
    const callsBefore = calls.length;
    const cachedRes = mockRes();
    await ohlcHandler(
      {
        method: "GET",
        query: { tickers: "NVDA", interval: "30m" },
        headers: { authorization: `Bearer ${tok}` },
      },
      cachedRes,
    );
    assert.equal(cachedRes.statusCode, 200);
    assert.equal(calls.length, callsBefore, "warm cache should avoid re-fetching NVDA");
    assert.equal(cachedRes.body.items.NVDA.length, 2);
  } finally {
    globalThis.fetch = origFetch;
    if (prevPin === undefined) delete process.env.TP_PIN; else process.env.TP_PIN = prevPin;
    if (prevSecret === undefined) delete process.env.TP_SESSION_SECRET; else process.env.TP_SESSION_SECRET = prevSecret;
    if (prevFmp === undefined) delete process.env.FMP_API_KEY; else process.env.FMP_API_KEY = prevFmp;
  }
});
