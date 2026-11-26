import test from "node:test";
import assert from "node:assert/strict";
import { evalScanHits } from "../src/lead/scannerMath.js";

test("evalScanHits classifies all 5 Elite RS scans accurately", () => {
  // 1. Elite Blue Dot + Resilient + Inst Vol + Green on Red Tape + RS 95+
  const superLeader = {
    ticker: "CROX",
    close: 120,
    avg_dollar_vol_raw: 150e6,
    rs_rank: 97,
    sma20_pct: 3.0,
    ema20_pct: 2.8,
    sma50_pct: 8.5,
    pct_from_8w: 6.2,
    ma8w_rising: 1,
    off_52w_high: -4.2,
    rs_line_new_high: true,
    rsl_hi_ago: 0,
    pp_count_30d: 3,
    udv20: 1.6,
    rel_volume: 1.7,
    change_pct: 1.8,
    adr20: 4.1,
  };
  const h1 = evalScanHits(superLeader, null, 1.7);
  assert.equal(h1.rs95, true);
  assert.equal(h1.bluedot, true);
  assert.equal(h1.resil, true);
  assert.equal(h1.rsvol, true);
  assert.equal(h1.grnred, true);

  // 2. Stock right at 52w high (0% off) passes rs95 & resil, NOT bluedot (requires 2-15% base)
  const atHigh = { ...superLeader, off_52w_high: 0, change_pct: -0.5, pp_count_30d: 0, rel_volume: 0.9 };
  const h2 = evalScanHits(atHigh, null, 0.9);
  assert.equal(h2.rs95, true);
  assert.equal(h2.resil, true);
  assert.equal(h2.bluedot, undefined);
  assert.equal(h2.rsvol, undefined);
  assert.equal(h2.grnred, undefined);

  // 3. Illiquid or below-50d stock fails all Elite RS scans
  const illiquid = { ...superLeader, avg_dollar_vol_raw: 5e6 };
  const h3 = evalScanHits(illiquid, null, 2.0);
  assert.equal(h3.rs95, undefined);
  assert.equal(h3.bluedot, undefined);
  assert.equal(h3.resil, undefined);
  assert.equal(h3.rsvol, undefined);
  assert.equal(h3.grnred, undefined);

  // 4. Buyout-pinned stock (tiny ADR5 <= 0.35% near highs) is excluded from Elite RS scans
  const buyout = { ...superLeader, adr5: 0.2, adr20: 2.5, off_52w_high: -3.0 };
  const h4 = evalScanHits(buyout, null, 2.0);
  assert.equal(h4.rs95, undefined);
  assert.equal(h4.bluedot, undefined);

  // 5. Live intraday quote lifting a stock back above 8w/20EMA/50d and within -10% of 52wH enters resil & rs95 live
  const intradayReclaim = {
    ticker: "RECL",
    close: 88,
    hi52_lvl: 100,
    sma50_lvl: 89.5,
    sma50_pct: -1.68,
    ema20_pct: -1.5,
    pct_from_8w: -1.2,
    ma8w_rising: 1,
    off_52w_high: -12.0,
    avg_dollar_vol_raw: 80e6,
    rs_rank: 96,
    adr20: 4.0,
  };
  assert.equal(evalScanHits(intradayReclaim, null, null).resil, undefined);
  assert.equal(evalScanHits(intradayReclaim, null, null).rs95, undefined);
  const liveHits = evalScanHits(intradayReclaim, { price: 92, change: 4.55 }, 1.8);
  assert.equal(liveHits.resil, true);
  assert.equal(liveHits.rs95, true);
});

test("evalScanHits classifies ADR 5%+ Liquid (adr5liq) screen accurately", () => {
  const base = {
    ticker: "ANF",
    close: 175,
    market_cap_raw: 8e9,
    adr20: 5.54,
    avg_vol_10d: 1.6e6,
    avg_volume_raw: 1.24e6,
    avg_dollar_vol_raw: 220e6,
    dvol_ratio_5_20: 1.2, // 1W $vol = 220M * 1.2 * 5 = $1.32B > $300M
    sma200_lvl: 140,
    sma200_pct: 25,
  };
  assert.equal(evalScanHits(base).adr5liq, true);

  // Fails Mkt Cap <= $100M
  assert.equal(evalScanHits({ ...base, market_cap_raw: 95e6 }).adr5liq, undefined);
  // Fails ADR <= 5%
  assert.equal(evalScanHits({ ...base, adr20: 4.95 }).adr5liq, undefined);
  // Fails 10D Avg Vol <= 500K
  assert.equal(evalScanHits({ ...base, avg_vol_10d: 480e3 }).adr5liq, undefined);
  // Fails Price <= SMA 200
  assert.equal(evalScanHits({ ...base, close: 138, sma200_lvl: 140, sma200_pct: -1.4 }).adr5liq, undefined);
  // Live intraday reclaim above SMA 200 enters live
  assert.equal(
    evalScanHits({ ...base, close: 138, sma200_lvl: 140, sma200_pct: -1.4 }, { price: 142 }).adr5liq,
    true
  );
  // Fails 1W $vol <= $300M (uses dvol_ratio_5_20 when present: 80M * 0.6 * 5 = $240M)
  assert.equal(evalScanHits({ ...base, avg_dollar_vol_raw: 80e6, dvol_ratio_5_20: 0.6 }).adr5liq, undefined);
  // Passes 1W $vol fallback when dvol_ratio_5_20 is absent: 70M * 5 = $350M > $300M
  assert.equal(evalScanHits({ ...base, avg_dollar_vol_raw: 70e6, dvol_ratio_5_20: null }).adr5liq, true);
});
