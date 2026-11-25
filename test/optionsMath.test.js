import test from "node:test";
import assert from "node:assert/strict";
import {
  RISK_FREE_RATE,
  normCdf,
  bsPrice,
  bsGreeks,
  hvFromAdr,
  analyzeOptionChain,
  findSwingCallSetups,
  findDirectionalPlays,
  pickExpirationForHorizon,
  detectUnusualFlow,
  aggregateMultiTickerScan,
} from "../src/lead/optionsMath.js";

test("bsPrice satisfies put-call parity and bsGreeks have expected signs and bounds", () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normCdf(1.96) - 0.975002) < 1e-4);

  const S = 100, K = 100, T = 45 / 365, r = RISK_FREE_RATE, iv = 0.35;
  const c = bsPrice(S, K, T, r, iv, "call");
  const p = bsPrice(S, K, T, r, iv, "put");
  // Put-call parity: C - P = S - K * exp(-rT)
  assert.ok(Math.abs((c - p) - (S - K * Math.exp(-r * T))) < 1e-4);

  const cg = bsGreeks(S, K, T, r, iv, "call");
  const pg = bsGreeks(S, K, T, r, iv, "put");
  assert.ok(cg.delta > 0.5 && cg.delta < 0.6);
  assert.ok(pg.delta < -0.4 && pg.delta > -0.5);
  assert.ok(Math.abs((cg.delta - pg.delta) - 1) < 1e-2);
  assert.ok(cg.gamma > 0 && Math.abs(cg.gamma - pg.gamma) < 1e-5);
  assert.ok(cg.theta < 0 && pg.theta < 0);
  assert.ok(cg.vega > 0 && Math.abs(cg.vega - pg.vega) < 1e-3);
});

function buildSampleChain(spot = 100, dte = 38) {
  const strikes = [85, 90, 95, 100, 105, 110, 115];
  const T = dte / 365;
  const calls = strikes.map((k) => {
    const iv = k < spot ? 0.36 : k === spot ? 0.34 : 0.32;
    const theo = bsPrice(spot, k, T, RISK_FREE_RATE, iv, "call");
    const bid = Math.max(0.05, +(theo * 0.98).toFixed(2));
    const ask = +(theo * 1.02 + 0.02).toFixed(2);
    return {
      sym: `TEST261231C${String(k * 1000).padStart(8, "0")}`,
      strike: k,
      bid,
      ask,
      last: theo,
      vol: k === 105 ? 4200 : k === 100 ? 1500 : 300,
      oi: k === 110 ? 9000 : k === 105 ? 1000 : 1200,
      iv,
      itm: k < spot,
    };
  });
  const puts = strikes.map((k) => {
    const iv = k < spot ? 0.39 : k === spot ? 0.35 : 0.33;
    const theo = bsPrice(spot, k, T, RISK_FREE_RATE, iv, "put");
    const bid = Math.max(0.05, +(theo * 0.98).toFixed(2));
    const ask = +(theo * 1.02 + 0.02).toFixed(2);
    return {
      sym: `TEST261231P${String(k * 1000).padStart(8, "0")}`,
      strike: k,
      bid,
      ask,
      last: theo,
      vol: k === 95 ? 800 : 250,
      oi: k === 90 ? 8500 : 1100,
      iv,
      itm: k > spot,
    };
  });
  return { unix: 1798675200, date: "2026-12-31", dte, calls, puts };
}

test("analyzeOptionChain computes ATM IV, Expected Move, Max Pain, OI Walls, GEX, and 25D Skew", () => {
  const chain = buildSampleChain(100, 38);
  const res = analyzeOptionChain(chain, 100, { ticker: "TEST", adr20: 3.0, earningsDays: 14 });
  assert.ok(res);
  assert.equal(res.atmStrike, 100);
  assert.ok(res.atmIv > 0.33 && res.atmIv < 0.36);
  assert.ok(res.hv20 === hvFromAdr(3.0));
  assert.ok(res.ivHvRatio > 0);
  assert.ok(res.expectedMove && res.expectedMove.dollars > 5 && res.expectedMove.dollars < 12);
  assert.equal(res.callWall.strike, 110);
  assert.equal(res.putWall.strike, 90);
  assert.ok(res.maxPain && res.maxPain.strike >= 90 && res.maxPain.strike <= 110);
  assert.ok(res.ivSkew != null && res.ivSkew > 0, `expected positive put skew, got ${res.ivSkew}`);
  assert.equal(res.earningsBeforeExpiry, true);
  assert.equal(res.strikeProfile.length, 7);
});

test("findSwingCallSetups returns curated single calls and bull call spread with earnings flag", () => {
  const chain = buildSampleChain(100, 38);
  const res = analyzeOptionChain(chain, 100, { ticker: "TEST", adr20: 3.0, earningsDays: 14 });
  const setups = findSwingCallSetups(res, { earningsDays: 14 });
  assert.ok(setups.length >= 3);
  const styles = new Set(setups.map((s) => s.style));
  assert.ok(styles.has("Momentum Swing"));
  assert.ok(styles.has("Breakout Call"));
  assert.ok(styles.has("Bull Call Spread"));

  const spread = setups.find((s) => s.kind === "spread");
  assert.ok(spread.shortStrike > spread.strike);
  assert.ok(spread.rr > 0);
  assert.equal(spread.earningsBeforeExpiry, true);
});

test("detectUnusualFlow and aggregateMultiTickerScan surface high Vol/OI sweeps and swing rows", () => {
  const chain = buildSampleChain(100, 38);
  const res = analyzeOptionChain(chain, 100, { ticker: "TEST", adr20: 3.0 });
  const flow = detectUnusualFlow(res);
  assert.ok(flow.length >= 1);
  // 105C had vol=4200 vs oi=1000 => volOi=4.2 => CALL SWEEP
  assert.equal(flow[0].strike, 105);
  assert.equal(flow[0].type, "call");
  assert.equal(flow[0].tag, "CALL SWEEP");

  const agg = aggregateMultiTickerScan(
    [{ ticker: "TEST", spot: 100, changePct: 2.5, selected: chain, swingChain: null }],
    { TEST: { ticker: "TEST", rs_rank: 96, adr20: 3.0, earnings_days: 50 } }
  );
  assert.equal(agg.swingRows.length, 1);
  assert.equal(agg.swingRows[0].rs, 96);
  assert.ok(agg.flowRows.length >= 1);
  assert.equal(agg.tickerSummaries[0].sentiment, "BULLISH");
});

test("findDirectionalPlays recommends outright vs spread cleanly for both bullish and bearish outlooks", () => {
  const chain = buildSampleChain(100, 38);

  // Clean (no ER, cheap IV: adr20=3.5 -> hv20 ~ 0.41 vs atmIv ~ 0.34 -> ivHvRatio < 0.95)
  const cheapBull = analyzeOptionChain(chain, 100, { ticker: "TEST", adr20: 3.5, earningsDays: 60 });
  const bull = findDirectionalPlays(cheapBull, "bullish", { earningsDays: 60 });
  assert.equal(bull.outlook, "bullish");
  assert.equal(bull.bestId, "primary");
  assert.equal(bull.plays.length, 3);
  assert.equal(bull.plays[0].title, "Swing Call");
  assert.equal(bull.plays[0].recommended, true);

  // Bearish with earnings before expiry -> recommends Bear Put Spread
  const bearEr = analyzeOptionChain(chain, 100, { ticker: "TEST", adr20: 3.5, earningsDays: 10 });
  const bear = findDirectionalPlays(bearEr, "bearish", { earningsDays: 10 });
  assert.equal(bear.outlook, "bearish");
  assert.equal(bear.bestId, "spread");
  const spread = bear.plays.find((p) => p.id === "spread");
  assert.equal(spread.title, "Bear Put Spread");
  assert.equal(spread.recommended, true);
  assert.ok(spread.shortStrike < spread.strike);

  // Horizon picker selects short / monthly swing / leaps properly
  const exps = [
    { unix: 1, date: "2026-12-04", dte: 9 },
    { unix: 2, date: "2027-01-08", dte: 44 },
    { unix: 3, date: "2027-01-15", dte: 51 }, // 3rd Friday monthly OPEX
    { unix: 4, date: "2027-06-18", dte: 205 },
  ];
  assert.equal(pickExpirationForHorizon(exps, "short").unix, 1);
  assert.equal(pickExpirationForHorizon(exps, "swing").unix, 3);
  assert.equal(pickExpirationForHorizon(exps, "leaps").unix, 4);
});
