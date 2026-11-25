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
});
