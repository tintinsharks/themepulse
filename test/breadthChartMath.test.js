import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCumulativeAdSeries,
  buildMcClellanSeries,
  buildMaBreadthSeries,
  detectBreadthSignals,
  filterStageStocks,
} from "../src/components/breadthChartMath.js";
import {
  computeEmaAtrExtensions,
  classifyWeinsteinStageFromBars,
} from "../src/lead/math.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("buildCumulativeAdSeries computes running cumulative sum and appends live point", () => {
  const adHistory = [
    { date: "2026-11-18", adv: 1500, dec: 1000 },
    { date: "2026-11-19", adv: 800, dec: 1200 },
    { date: "2026-11-20", adv: 1100, dec: 1000 },
  ];

  const base = buildCumulativeAdSeries(adHistory);
  assert.deepEqual(base, [
    { date: "2026-11-18", net: 500, cumAd: 500, adv: 1500, dec: 1000, isLive: false },
    { date: "2026-11-19", net: -400, cumAd: 100, adv: 800, dec: 1200, isLive: false },
    { date: "2026-11-20", net: 100, cumAd: 200, adv: 1100, dec: 1000, isLive: false },
  ]);

  // Appends Today (Live) when liveAdvDec.isLive and lastDate !== todayStr
  const withLive = buildCumulativeAdSeries(
    adHistory,
    { adv: 1800, dec: 900, isLive: true },
    "2026-11-23"
  );
  assert.equal(withLive.length, 4);
  assert.deepEqual(withLive[3], {
    date: "Today (Live)",
    net: 900,
    cumAd: 1100,
    adv: 1800,
    dec: 900,
    isLive: true,
  });

  // Does NOT duplicate today if lastDate === todayStr
  const sameDay = buildCumulativeAdSeries(
    adHistory,
    { adv: 1800, dec: 900, isLive: true },
    "2026-11-20"
  );
  assert.equal(sameDay.length, 3);
  assert.equal(sameDay[2].isLive, false);

  // Does NOT append when isLive is false
  const notLive = buildCumulativeAdSeries(
    adHistory,
    { adv: 1800, dec: 900, isLive: false },
    "2026-11-23"
  );
  assert.equal(notLive.length, 3);
});

test("buildCumulativeAdSeries skips malformed rows and handles empty input", () => {
  assert.deepEqual(buildCumulativeAdSeries(null), []);
  assert.deepEqual(buildCumulativeAdSeries([]), []);

  const dirty = [
    null,
    { date: "2026-11-18", adv: null, dec: 500 },
    { date: "", adv: 100, dec: 50 },
    { date: "2026-11-19", adv: 300, dec: 100 },
  ];
  const res = buildCumulativeAdSeries(dirty);
  assert.equal(res.length, 1);
  assert.equal(res[0].cumAd, 200);

  // Empty history with live data still produces live row
  const liveOnly = buildCumulativeAdSeries([], { adv: 600, dec: 400, isLive: true }, "2026-11-23");
  assert.deepEqual(liveOnly, [
    { date: "Today (Live)", net: 200, cumAd: 200, adv: 600, dec: 400, isLive: true },
  ]);
});

test("buildMcClellanSeries computes 19-EMA minus 39-EMA of RANA and summation index", () => {
  const synth = [
    { date: "2026-11-01", adv: 1000, dec: 1000 }, // RANA = 0 -> osc = 0
    { date: "2026-11-02", adv: 1500, dec: 500 },  // RANA = +500 -> e19 = 50, e39 = 25 -> osc = +25
    { date: "2026-11-03", adv: 500, dec: 1500 },  // RANA = -500 -> e19 = -5, e39 = -1.25 -> rawOsc = -3.75 -> -3.7
  ];
  const res = buildMcClellanSeries(synth);
  assert.equal(res.length, 3);
  assert.deepEqual(res[0], { date: "2026-11-01", osc: 0, summation: 0, isLive: false });
  assert.deepEqual(res[1], { date: "2026-11-02", osc: 25, summation: 25, isLive: false });
  assert.equal(res[2].osc, -3.7);
  assert.equal(res[2].summation, 21);

  // Appends Today (Live) when isLive and lastDate !== todayStr
  const withLive = buildMcClellanSeries(synth, { adv: 2000, dec: 0, isLive: true }, "2026-11-04");
  assert.equal(withLive.length, 4);
  assert.equal(withLive[3].date, "Today (Live)");
  assert.equal(withLive[3].isLive, true);
  assert.ok(withLive[3].osc > 0);

  // Skips live append when lastDate === todayStr
  const noDup = buildMcClellanSeries(synth, { adv: 2000, dec: 0, isLive: true }, "2026-11-03");
  assert.equal(noDup.length, 3);

  // Zero adv+dec does not produce NaN
  const zeroRes = buildMcClellanSeries([{ date: "2026-11-01", adv: 0, dec: 0 }]);
  assert.deepEqual(zeroRes, [{ date: "2026-11-01", osc: 0, summation: 0, isLive: false }]);
  assert.deepEqual(buildMcClellanSeries([]), []);
});

test("buildMcClellanSeries aligns with public/data/breadth.json qulla.mcclellan", () => {
  const breadthPath = path.resolve(__dirname, "../public/data/breadth.json");
  const breadth = JSON.parse(fs.readFileSync(breadthPath, "utf8"));
  const expected = breadth?.conditions?.qulla?.mcclellan;
  assert.ok(expected, "breadth.json should contain conditions.qulla.mcclellan");

  const series = buildMcClellanSeries(breadth.ad_history);
  assert.equal(series.length, breadth.ad_history.length);

  const last = series[series.length - 1];
  assert.equal(last.date, breadth.date);
  assert.equal(last.osc, expected.osc);
  assert.equal(last.summation, expected.summation);

  if (Array.isArray(expected.series)) {
    const tail = series.slice(-expected.series.length).map((d) => d.summation);
    assert.deepEqual(tail, expected.series);
  }
});

test("buildMaBreadthSeries extracts p20/p50/p200, clamps bounds, and appends live value", () => {
  const history = [
    { date: "2026-11-18", p20: 34.8, p50: 43.8, p200: 49.2 },
    { date: "2026-11-19", p20: 21.3, p50: null, p200: 105 },
    { date: "2026-11-20", p20: -5, p50: 28.7, p200: 37.5 },
  ];

  const s20 = buildMaBreadthSeries(history, "p20");
  assert.deepEqual(s20, [
    { date: "2026-11-18", pct: 34.8, isLive: false },
    { date: "2026-11-19", pct: 21.3, isLive: false },
    { date: "2026-11-20", pct: 0, isLive: false },
  ]);

  const s50Live = buildMaBreadthSeries(history, "p50", 31.4, "2026-11-23");
  assert.deepEqual(s50Live, [
    { date: "2026-11-18", pct: 43.8, isLive: false },
    { date: "2026-11-20", pct: 28.7, isLive: false },
    { date: "Today (Live)", pct: 31.4, isLive: true },
  ]);

  // Does not append live if lastDate === todayStr
  const s50SameDay = buildMaBreadthSeries(history, "p50", 31.4, "2026-11-20");
  assert.equal(s50SameDay.length, 2);

  // Clamps >100 to 100
  const s200 = buildMaBreadthSeries(history, "p200");
  assert.equal(s200[1].pct, 100);

  // Null/invalid inputs
  assert.deepEqual(buildMaBreadthSeries(null, "p50"), []);
  assert.deepEqual(buildMaBreadthSeries(history, ""), []);
});

test("filterStageStocks classifies Weinstein stages, applies filters, and sorts by RS then Chg%", () => {
  const stockMap = {
    // Stage 2: above200, above50, ma200Rising (bit 4) or ma50Above200 (bit 8)
    NVDA: { ticker: "NVDA", rs_rank: 96, change_pct: 2.1, sma50_pct: 8.5, sma200_pct: 22.0, tt_mask: 12 },
    AVGO: { ticker: "AVGO", rs_rank: 92, change_pct: 4.5, sma50_pct: 6.2, sma200_pct: 18.0, tt_mask: 12 },
    META: { ticker: "META", rs_rank: 92, change_pct: 1.2, sma50_pct: 4.0, sma200_pct: 15.0, tt_mask: 12 },
    LAGG: { ticker: "LAGG", rs_rank: 75, change_pct: 3.0, sma50_pct: 3.0, sma200_pct: 10.0, tt_mask: 12 },
    // Stage 1: below200 (>=-3.5%), !ma50Above200, above50, ma8w_rising
    BASE: { ticker: "BASE", rs_rank: 82, change_pct: 1.5, sma50_pct: 2.0, sma200_pct: -2.0, tt_mask: 0, ma8w_rising: true },
    // Stage 3: above200, below50
    TOPP: { ticker: "TOPP", rs_rank: 68, change_pct: -1.1, sma50_pct: -3.0, sma200_pct: 5.0, tt_mask: 4 },
    // Stage 4: below200, below50
    DOWN: { ticker: "DOWN", rs_rank: 15, change_pct: -4.2, sma50_pct: -12.0, sma200_pct: -20.0, tt_mask: 0 },
    // Missing MAs -> null stage
    SKIP: { ticker: "SKIP", rs_rank: 99, change_pct: 5.0 },
  };

  const tickerLayer = {
    NVDA: { theme: "AI", themeId: "ai", name: "GPUs", st: "lead" },
    AVGO: { theme: "AI", themeId: "ai", name: "Networking", st: "emerg" },
    META: { theme: "Internet", themeId: "net", name: "Social", st: "weak" },
    LAGG: { theme: "OldTech", themeId: "ot", name: "Hardware", st: "lag" },
    BASE: { theme: "Energy", themeId: "en", name: "Nuclear", st: "lead" },
  };

  // All Stage 2, sorted by RS desc then change_pct desc
  const s2 = filterStageStocks(stockMap, 2, { tickerLayer });
  assert.deepEqual(
    s2.map((s) => s.ticker),
    ["NVDA", "AVGO", "META", "LAGG"]
  );
  assert.equal(s2[0].stage, 2);
  assert.equal(s2[0].layer.name, "GPUs");

  // Leading/Emerging themes filter
  const s2Lead = filterStageStocks(stockMap, 2, { tickerLayer, leadingOnly: true });
  assert.deepEqual(
    s2Lead.map((s) => s.ticker),
    ["NVDA", "AVGO"]
  );

  // RS >= 90 filter
  const s2Rs90 = filterStageStocks(stockMap, 2, { tickerLayer, minRs: 90 });
  assert.deepEqual(
    s2Rs90.map((s) => s.ticker),
    ["NVDA", "AVGO", "META"]
  );

  // Combined Leading themes + RS >= 95
  const s2Combo = filterStageStocks(stockMap, 2, { tickerLayer, leadingOnly: true, minRs: 95 });
  assert.deepEqual(
    s2Combo.map((s) => s.ticker),
    ["NVDA"]
  );

  // Stages 1, 3, 4
  assert.deepEqual(filterStageStocks(stockMap, 1, { tickerLayer }).map((s) => s.ticker), ["BASE"]);
  assert.deepEqual(filterStageStocks(stockMap, 3, { tickerLayer }).map((s) => s.ticker), ["TOPP"]);
  assert.deepEqual(filterStageStocks(stockMap, 4, { tickerLayer }).map((s) => s.ticker), ["DOWN"]);

  // Edge cases
  assert.deepEqual(filterStageStocks(stockMap, 5), []);
  assert.deepEqual(filterStageStocks(null, 2), []);
  assert.equal(stockMap.NVDA.stage, undefined, "must not mutate original stockMap entries");
});

test("detectBreadthSignals identifies 90% days, Zweig Breadth Thrust, McClellan hook, and SPX divergence", () => {
  // Build a synthetic 42-session series:
  // Days 0..11: healthy uptrend warmup (pushes 39-EMA positive)
  // Days 12..21: sharp washout (triggers 90% Down day, 10d EMA < 40%, McClellan <= -60)
  // Days 22..29: broad thrust (triggers 90% Up day, McClellan OS Hook, Zweig Breadth Thrust > 61.5%)
  // Days 30..41: SPX grinds to new 20d highs while Cum A/D & >50d SMA roll over -> SPX Bear Div
  const adHistory = [];
  const history = [];
  const spxMap = new Map();
  const baseMs = Date.UTC(2026, 8, 1);
  const dateOf = (i) => new Date(baseMs + i * 86400000).toISOString().slice(0, 10);

  for (let i = 0; i < 42; i++) {
    const date = dateOf(i);
    let adv, dec, spx, p50;
    if (i < 12) {
      adv = 2100;
      dec = 900;
      spx = 5700 + i * 10;
      p50 = 60 + i;
    } else if (i < 22) {
      adv = i === 21 ? 250 : 450;
      dec = i === 21 ? 2750 : 2550;
      spx = 5820 - (i - 11) * 25;
      p50 = 68 - (i - 11) * 4;
    } else if (i < 30) {
      adv = 2750;
      dec = 250;
      spx = 5570 + (i - 21) * 42;
      p50 = 28 + (i - 21) * 5.5;
    } else {
      // SPX keeps grinding up to new highs, while breadth turns net negative (bearish divergence)
      adv = 1100;
      dec = 1900;
      spx = 5910 + (i - 29) * 12;
      p50 = 72 - (i - 29) * 3;
    }
    adHistory.push({ date, adv, dec });
    history.push({ date, p50 });
    spxMap.set(date, spx);
  }

  const res = detectBreadthSignals({ adHistory, history, spxMap });
  const types = new Set(res.all.map((s) => s.type));
  assert.ok(types.has("ninety_down"), "expected 90% Down day");
  assert.ok(types.has("ninety_up"), "expected 90% Up day");
  assert.ok(types.has("zbt"), "expected Zweig Breadth Thrust");
  assert.ok(types.has("mc_os_hook"), "expected McClellan oversold hook");
  assert.ok(types.has("div_bear"), "expected SPX bearish divergence");
  assert.ok(res.recent.some((s) => s.type === "div_bear"), "bearish divergence should appear in recent signals");
  assert.ok(res.byDate.size > 0);
});

test("computeEmaAtrExtensions and classifyWeinsteinStageFromBars compute EMA ATR multiples and stage", () => {
  // 220 steadily rising daily bars -> Stage 2 and positive EMA ATR multiples
  const upBars = Array.from({ length: 220 }, (_, i) => ({
    close: 100 + i * 0.5,
    high: 101 + i * 0.5,
    low: 99 + i * 0.5,
  }));
  assert.equal(classifyWeinsteinStageFromBars(upBars), 2);
  const ext = computeEmaAtrExtensions(upBars, 215, 2.5);
  assert.ok(ext.ema10.atrX > 0 && ext.ema21.atrX > ext.ema10.atrX && ext.ema50.atrX > ext.ema21.atrX);
  assert.ok(ext.ema10.ema > ext.ema21.ema && ext.ema21.ema > ext.ema50.ema);

  // 220 steadily falling daily bars -> Stage 4
  const downBars = Array.from({ length: 220 }, (_, i) => ({
    close: 250 - i * 0.5,
    high: 251 - i * 0.5,
    low: 249 - i * 0.5,
  }));
  assert.equal(classifyWeinsteinStageFromBars(downBars), 4);
});
