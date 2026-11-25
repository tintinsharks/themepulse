import test from "node:test";
import assert from "node:assert/strict";
import {
  NDX_CONSTITUENTS,
  computeAtr14,
  computeNdxInternals,
  computeNdxWeights,
  computeQqqTechnicals,
} from "../src/lead/qqqMath.js";

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
