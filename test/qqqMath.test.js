import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NDX_CONSTITUENTS,
  buildQqqBreadthSeries,
  buildSimpleQqqSignal,
  computeAtr14,
  computeNdxInternals,
  computeNdxWeights,
  computeQqqBreadthTrend,
  computeQqqIntradayPredictor,
  computeQqqPriceLadder,
  computeQqqShortTermBias,
  computeQqqTechnicals,
} from "../src/lead/qqqMath.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("computeNdxWeights normalizes weights to ~100%, caps single names, and splits GOOGL/GOOG", () => {
  const sample = [
    { t: "NVDA", g: "mag7" },
    { t: "AAPL", g: "mag7" },
    { t: "GOOGL", g: "mag7", capShare: 0.5 },
    { t: "GOOG", g: "mag7", capShare: 0.5 },
    ...Array.from({ length: 16 }, (_, i) => ({ t: `S${i}`, g: "soft" })),
  ];
  const stockMap = {
    NVDA: { market_cap_raw: 4e12 },
    AAPL: { market_cap_raw: 3.5e12 },
    GOOGL: { market_cap_raw: 2.4e12 },
    GOOG: { market_cap_raw: 2.4e12 },
  };
  for (let i = 0; i < 16; i++) stockMap[`S${i}`] = { market_cap_raw: 200e9 };

  const w = computeNdxWeights(sample, stockMap);
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.5, `sum should be ~100, got ${sum}`);
  assert.ok(w.NVDA <= 11.5 && w.AAPL <= 11.5, "single-stock weights should be capped at 11.5%");
  assert.equal(w.GOOGL, w.GOOG, "dual-class Alphabet shares should receive equal split");
  assert.ok(NDX_CONSTITUENTS.length >= 98, "NDX_CONSTITUENTS should cover ~100 Nasdaq-100 holdings");
});

test("computeQqqTechnicals computes EMAs, SMAs, ATR14, expected moves, EMA stack, and stops", () => {
  // 220 steadily rising daily bars: close 400 -> 509.5, daily range 4
  const bars = Array.from({ length: 220 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 400 + i * 0.5,
    high: 402 + i * 0.5,
    low: 398 + i * 0.5,
    close: 400 + i * 0.5,
  }));
  const atr = computeAtr14(bars);
  assert.ok(Math.abs(atr - 4.0) < 0.05);

  const tech = computeQqqTechnicals(bars, { price: 512, previousClose: 509.5, open: 510, dayHigh: 513, dayLow: 509 });
  assert.equal(tech.price, 512);
  assert.equal(tech.emaStack, "BULLISH");
  assert.equal(tech.stage, 2);
  assert.equal(tech.mas.length, 5);
  assert.ok(tech.mas.every((m) => m.above === true));
  assert.equal(tech.expectedDayMove, 4);
  assert.ok(tech.expectedWeekMove > 8.5 && tech.expectedWeekMove < 9.5);
  assert.equal(tech.stops.length, 6);
  assert.equal(tech.stops[1].price, 508); // 1x ATR below 512
});

test("computeNdxInternals computes live breadth, thrust, bps contribution, and mega-cap spread", () => {
  const mini = [
    { t: "NVDA", g: "mag7", also: ["semi"] },
    { t: "AAPL", g: "mag7" },
    { t: "CRWD", g: "soft" },
    { t: "AMGN", g: "health" },
  ];
  const stockMap = {
    NVDA: { ticker: "NVDA", close: 140, market_cap_raw: 3.5e12, avg_vol_10d: 10e6, rel_volume: 2.2, sma20_pct: 5, sma50_pct: 12, sma200_pct: 30, off_52w_high: -1, tt_mask: 12, rs_rank: 96, adr20: 4.2 },
    AAPL: { ticker: "AAPL", close: 220, market_cap_raw: 3.3e12, avg_vol_10d: 10e6, rel_volume: 1.0, sma20_pct: 2, sma50_pct: 4, sma200_pct: 10, off_52w_high: -3, tt_mask: 12, rs_rank: 78, adr20: 1.8 },
    CRWD: { ticker: "CRWD", close: 350, market_cap_raw: 90e9, avg_vol_10d: 3e6, rel_volume: 1.8, sma20_pct: -3, sma50_pct: -8, sma200_pct: -12, off_52w_high: -22, tt_mask: 0, rs_rank: 35, adr20: 3.9 },
    AMGN: { ticker: "AMGN", close: 300, market_cap_raw: 160e9, avg_vol_10d: 2e6, rel_volume: 1.1, sma20_pct: 1, sma50_pct: 2, sma200_pct: 6, off_52w_high: -4, tt_mask: 12, rs_rank: 72, adr20: 2.1, sector: "Healthcare" },
  };
  const quotes = new Map([
    ["NVDA", { price: 147, previousClose: 140, change: 5.0, open: 141, dayHigh: 148, dayLow: 140.5 }],
    ["AAPL", { price: 222.2, previousClose: 220, change: 1.0, open: 221 }],
    ["CRWD", { price: 332.5, previousClose: 350, change: -5.0, open: 348 }],
    ["AMGN", { price: 303, previousClose: 300, change: 1.0, open: 301 }],
  ]);

  const res = computeNdxInternals({ constituents: mini, stockMap, quotes });
  assert.equal(res.count, 4);
  assert.equal(res.adv, 3);
  assert.equal(res.dec, 1);
  assert.equal(res.up4, 1);
  assert.equal(res.dn4, 1);
  assert.equal(res.ma50.above, 3);
  assert.equal(res.nearHighs, 3);
  assert.equal(res.topPositive[0].ticker, "NVDA");
  assert.equal(res.topNegative[0].ticker, "CRWD");

  const nvdaRow = res.rows.find((r) => r.ticker === "NVDA");
  assert.equal(nvdaRow.thrust, 11.0); // 5.0% * 2.2x
  assert.equal(nvdaRow.isBreakout, true);
  const amgnRow = res.rows.find((r) => r.ticker === "AMGN");
  assert.equal(amgnRow.isHealth, true);
});

test("buildQqqBreadthSeries and computeQqqBreadthTrend classify uptrend, downtrend, bounce hook, and validate 3Y archive", () => {
  // Rising breadth -> UPTREND
  const rising = Array.from({ length: 25 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    qqq: 500 + i * 2,
    p20: 45 + i * 1.5,
    p50: 42 + i * 1.2,
    p200: 55 + i * 0.5,
    adv: 65,
    dec: 35,
  }));
  const upTrend = computeQqqBreadthTrend(buildQqqBreadthSeries(rising));
  assert.equal(upTrend.state, "UPTREND");
  assert.ok(upTrend.slope20 > 0);

  // Falling breadth -> DOWNTREND
  const falling = Array.from({ length: 25 }, (_, i) => ({
    date: `2026-02-${String((i % 28) + 1).padStart(2, "0")}`,
    qqq: 550 - i * 2,
    p20: 60 - i * 2,
    p50: 62 - i * 1.5,
    p200: 60 - i * 0.8,
    adv: 30,
    dec: 70,
  }));
  const dnTrend = computeQqqBreadthTrend(buildQqqBreadthSeries(falling));
  assert.equal(dnTrend.state, "DOWNTREND");
  assert.ok(dnTrend.slope20 < 0);

  // Validate real 3-year backfilled archive (750+ sessions)
  const histPath = path.resolve(__dirname, "../public/data/qqq_breadth_history.json");
  const disk = JSON.parse(fs.readFileSync(histPath, "utf8"));
  assert.ok(Array.isArray(disk.history) && disk.history.length >= 700, "3Y QQQ breadth archive should have 700+ sessions");
  const series = buildQqqBreadthSeries(disk.history);
  assert.equal(series.length, disk.history.length);
  const trend = computeQqqBreadthTrend(series);
  assert.ok(["UPTREND", "ROLLING_OVER", "BOUNCE_HOOK", "DOWNTREND"].includes(trend.state));
  assert.ok(trend.pctile >= 0 && trend.pctile <= 100);
});

test("computeQqqIntradayPredictor detects gap-down recovery trigger vs active selloff", () => {
  const mini = [
    { t: "NVDA", g: "mag7" },
    { t: "AAPL", g: "mag7" },
    { t: "MSFT", g: "mag7" },
    { t: "AVGO", g: "semi" },
    { t: "CRWD", g: "soft" },
    { t: "COST", g: "cons" },
  ];
  const stockMap = Object.fromEntries(mini.map((c) => [c.t, { ticker: c.t, close: 100, market_cap_raw: c.g === "mag7" ? 3e12 : 300e9, sma20_pct: 2, return_1w: 3 }]));

  // Scenario A: Narrow gap down (-3% QQQ vs -1.2% QQQE) that recovers strongly off lows & reclaims open across all names
  const recQuotes = new Map([
    ["NVDA", { price: 98.5, previousClose: 100, open: 94, dayLow: 93, dayHigh: 99, change: -1.5 }],
    ["AAPL", { price: 100.5, previousClose: 100, open: 99, dayLow: 98, dayHigh: 101, change: 0.5 }],
    ["MSFT", { price: 99.5, previousClose: 100, open: 97.5, dayLow: 96, dayHigh: 100, change: -0.5 }],
    ["AVGO", { price: 99.0, previousClose: 100, open: 95, dayLow: 93.5, dayHigh: 99.5, change: -1.0 }],
    ["CRWD", { price: 101.0, previousClose: 100, open: 98.5, dayLow: 97, dayHigh: 101.5, change: 1.0 }],
    ["COST", { price: 101.5, previousClose: 100, open: 99.5, dayLow: 99, dayHigh: 102, change: 1.5 }],
  ]);
  const recInternals = computeNdxInternals({ constituents: mini, stockMap, quotes: recQuotes });
  const recPred = computeQqqIntradayPredictor({
    qqqQ: { price: 632, previousClose: 638, open: 618, dayLow: 608, dayHigh: 634, change: -0.94 },
    qqqeQ: { price: 100, previousClose: 101, open: 99.8, change: -1.0 },
    internals: recInternals,
    quotes: recQuotes,
    stockMap,
  });
  assert.equal(recPred.gapRegime, "NARROW_SHOCK_GAP");
  assert.equal(recPred.state, "RECOVERY_TRIGGERED");
  assert.ok(recPred.score >= 70);
  assert.equal(recPred.pctNearLow, 0);
  assert.equal(recPred.pctGreenFromOpen, 100);

  // Scenario B: Broad panic gap down (-2.5% QQQ & -2.4% QQQE) still cascading at lows
  const sellQuotes = new Map(mini.map((c) => [c.t, { price: 95.1, previousClose: 100, open: 97.6, dayLow: 95.0, dayHigh: 98.0, change: -4.9 }]));
  const sellInternals = computeNdxInternals({ constituents: mini, stockMap, quotes: sellQuotes });
  const sellPred = computeQqqIntradayPredictor({
    qqqQ: { price: 609, previousClose: 638, open: 622, dayLow: 608.5, dayHigh: 624, change: -4.55 },
    qqqeQ: { price: 96, previousClose: 100, open: 97.6, change: -4.0 },
    internals: sellInternals,
    quotes: sellQuotes,
    stockMap,
  });
  assert.equal(sellPred.gapRegime, "BROAD_PANIC_GAP");
  assert.equal(sellPred.state, "SELLOFF_ACTIVE");
  assert.ok(sellPred.score < 30);
});

test("computeQqqShortTermBias scores bullish vs bearish options bias accurately", () => {
  const upBars = Array.from({ length: 60 }, (_, i) => ({ open: 500 + i, high: 502 + i, low: 498 + i, close: 500 + i }));
  const upTech = computeQqqTechnicals(upBars, { price: 562, previousClose: 559, open: 560, dayHigh: 563, dayLow: 559 });
  const upBreadth = { p20: 78, p50: 72, d5: { p20: 14, p50: 8 } };
  const upInternals = {
    pctAdv: 82,
    eqWeightChg: 1.8,
    capWeightEstChg: 1.5,
    rows: [
      { ticker: "NVDA", group: "mag7", weightPct: 11, sma20: 5, chg: 2.5 },
      { ticker: "AVGO", group: "semi", weightPct: 5, sma20: 4, chg: 2.0 },
    ],
  };
  const bull = computeQqqShortTermBias({
    qqqBars: upBars,
    qqqQ: { price: 562, dayHigh: 563, dayLow: 559 },
    tech: upTech,
    internals: upInternals,
    breadthTrend: upBreadth,
    intradayPredictor: { score: 82, verdict: "Recovery Triggered" },
    stockMap: { NVDA: { return_1w: 5 }, AVGO: { return_1w: 4 } },
  });
  assert.equal(bull.bias, "STRONG_BULLISH");
  assert.equal(bull.outlook, "bullish");
  assert.ok(bull.score >= 50);

  const dnBars = Array.from({ length: 60 }, (_, i) => ({ open: 600 - i, high: 602 - i, low: 598 - i, close: 600 - i }));
  const dnTech = computeQqqTechnicals(dnBars, { price: 538, previousClose: 541, open: 540, dayHigh: 541, dayLow: 537 });
  const bear = computeQqqShortTermBias({
    qqqBars: dnBars,
    qqqQ: { price: 538, dayHigh: 541, dayLow: 537 },
    tech: dnTech,
    internals: {
      pctAdv: 18,
      eqWeightChg: -2.2,
      capWeightEstChg: -1.8,
      rows: [
        { ticker: "NVDA", group: "mag7", weightPct: 11, sma20: -6, chg: -3.0 },
        { ticker: "AVGO", group: "semi", weightPct: 5, sma20: -5, chg: -2.5 },
      ],
    },
    breadthTrend: { p20: 20, p50: 25, d5: { p20: -15, p50: -10 } },
    intradayPredictor: { score: 15, verdict: "Wait — Selloff Active" },
    stockMap: { NVDA: { return_1w: -6 }, AVGO: { return_1w: -5 } },
  });
  assert.equal(bear.bias, "STRONG_BEARISH");
  assert.equal(bear.outlook, "bearish");
  assert.ok(bear.score <= -50);
});

test("computeQqqPriceLadder computes VWAPs, unfilled gaps, options magnets, and feeds gamma/macro bias", () => {
  // 35 bars with a peak at bar 5 (650), an unfilled gap down at bar 20, and a swing low at bar 28 (600)
  const bars = Array.from({ length: 35 }, (_, i) => {
    let base = 625;
    if (i <= 5) base = 635 + i * 3; // peaks at 650
    else if (i < 20) base = 645 - (i - 5) * 0.4; // ~639
    else if (i < 28) base = 620 - (i - 20) * 2.5; // gap down from ~638 to ~620, trough 602.5
    else base = 602 + (i - 28) * 3.5; // recovers to 623
    return {
      date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
      open: base - 1,
      high: base + 2,
      low: base - 2,
      close: base,
      volume: 40_000_000,
    };
  });
  const spot = 624;
  const tech = computeQqqTechnicals(bars, { price: spot, previousClose: 620, open: 621, dayHigh: 626, dayLow: 619 });
  const optionsAnalysis = {
    callWall: { strike: 650, oi: 50000 },
    putWall: { strike: 600, oi: 45000 },
    gammaFlip: 615,
    netGex: -80_000_000,
    totalCallPrem: 70_000_000,
    totalPutPrem: 30_000_000,
    pcVolRatio: 0.65,
    expectedMove: { dollars: 12, pct: 1.9, upper: 636, lower: 612 },
  };
  const ladder = computeQqqPriceLadder({ qqqBars: bars, qqqQ: { price: spot }, tech, optionsAnalysis });
  assert.equal(ladder.spot, spot);
  assert.ok(ladder.vwap5d > 600 && ladder.vwap5d < 630);
  assert.ok(ladder.avwap52wHigh > spot);
  assert.ok(ladder.avwapSwingLow < spot);
  assert.ok(ladder.resistance.some((r) => r.label === "Call Wall" || r.label === "Gap Fill" || r.label === "+1σ Exp Move"));
  assert.ok(ladder.support.some((s) => s.label === "Put Wall" || s.label === "Gamma Flip" || s.label === "5d VWAP"));

  const bias = computeQqqShortTermBias({
    qqqBars: bars,
    qqqQ: { price: spot, change: 1.2 },
    tech,
    internals: { pctAdv: 75, eqWeightChg: 1.5, capWeightEstChg: 1.2, rows: [{ ticker: "NVDA", group: "mag7", weightPct: 11, sma20: 4, chg: 2.2 }] },
    breadthTrend: { p20: 65, p50: 58, d5: { p20: 12, p50: 5 } },
    intradayPredictor: { score: 78, verdict: "Recovery Triggered" },
    optionsAnalysis,
    vix: { price: 18.5, changePct: -6.2 },
    us10y: { price: 4.35, changePct: -1.5 },
    smhChg: 2.5,
    priceLadder: ladder,
    stockMap: { NVDA: { return_1w: 4 } },
  });
  assert.equal(bias.factors.length, 6);
  assert.equal(bias.gammaRegime.state, "NEGATIVE_GEX");
  assert.equal(bias.outlook, "bullish");
  assert.ok(bias.score >= 40);

  // Dead-simple 1-glance signal: BUY_CALLS when bullish & not selling off; WAIT if active selloff; BUY_PUTS when bearish
  const sigBull = buildSimpleQqqSignal({ shortTermBias: bias, intradayPred: { state: "RECOVERY_TRIGGERED", score: 78 }, priceLadder: ladder });
  assert.equal(sigBull.action, "BUY_CALLS");
  assert.ok(sigBull.target && sigBull.stop);

  const sigWait = buildSimpleQqqSignal({ shortTermBias: bias, intradayPred: { state: "SELLOFF_ACTIVE", score: 25 }, priceLadder: ladder });
  assert.equal(sigWait.action, "WAIT");

  const sigBear = buildSimpleQqqSignal({ shortTermBias: { ...bias, score: -45, outlook: "bearish" }, intradayPred: { state: "SELLOFF_ACTIVE", score: 20 }, priceLadder: ladder });
  assert.equal(sigBear.action, "BUY_PUTS");
});
