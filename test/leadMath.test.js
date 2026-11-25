import test from "node:test";
import assert from "node:assert/strict";
import {
  rankHeld,
  rankTrend,
  classify,
  layerStats,
  layerConfirm,
  layerFlags,
  ema,
  sma,
  expectedVolAt,
  zvrFor,
  pinReason,
  rsLeads,
  isEliteRs,
  computeTiers,
  epsGrowth,
  withEpsRating,
  rsScore,
  layerRanksFrom,
  closingRange,
  classifyWeinsteinStage,
  computeStageDistribution,
  estimateStageHistory,
  computeLayerDayFlow,
  fmtDollarVol,
  isHealthcareItem,
  stockThrust,
} from "../src/lead/math.js";

test("rankHeld counts sessions at or above threshold in trailing window", () => {
  const hist = [70, 82, 85, null, 79, 90];
  assert.deepEqual(rankHeld(hist, 20, 80), { held: 3, of: 5 });
  assert.deepEqual(rankHeld(hist, 2, 80), { held: 1, of: 2 });
});

test("rankTrend computes least-squares slope and up-session counts", () => {
  const rising = [50, 52, 54, 56, 58, 60];
  const tr = rankTrend(rising);
  assert.equal(tr.slope, 2);
  assert.equal(tr.ups, 5);
  assert.equal(tr.of, 5);

  const short = [50, 55];
  assert.equal(rankTrend(short).slope, null);
});

test("classify distinguishes lead, brk, weak, emerg, and lag states", () => {
  // Leading: now >= 88 and w1 >= 80
  assert.equal(classify({ now: 92, w1: 85, m1: 75 }, [75, 85, 92]).st, "lead");
  // Breaking down: peak >= 88 within lookback, now < 60
  assert.equal(classify({ now: 52, w1: 70, m1: 90 }, [91, 80, 70, 52]).st, "brk");
  // Weakening: peak >= 88, now < 88 and <= peak - 10
  assert.equal(classify({ now: 75, w1: 85, m1: 90 }, [92, 88, 85, 75]).st, "weak");
  // Emerging: now >= 70, +20 vs m1, climbing steadily (6+ ups of 10, slope > 0)
  const climb = [45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75];
  assert.equal(classify({ now: 75, w1: 63, m1: 45 }, climb).st, "emerg");
  // Lagging
  assert.equal(classify({ now: 40, w1: 42, m1: 45 }, [45, 42, 40]).st, "lag");
});

test("layerStats computes breadth percentages and medians", () => {
  const map = {
    A: { sma50_pct: 5, rs_rank: 95, nh20: 1, udv20: 1.5, dvol_ratio_5_20: 1.2 },
    B: { sma50_pct: -2, rs_rank: 70, nh20: 0, udv20: 0.9, dvol_ratio_5_20: 0.8 },
    C: { sma50_pct: 10, rs_rank: 85, nh20: 1, udv20: 1.2, dvol_ratio_5_20: 1.1 },
  };
  assert.deepEqual(layerStats(["A", "B", "C", "MISSING"], map), {
    n: 3,
    a50: 67,
    rs80: 67,
    nh: 67,
    udv: 1.2,
    dv: 1.1,
    rsMed: 85,
  });
  assert.equal(layerStats(["MISSING"], map), null);
});

test("layerConfirm and layerFlags detect confirmation and distribution", () => {
  const confirmed = layerConfirm({
    acc: [1, 4],
    dist: [1, 1],
    dvs: [1.0, 1.3],
    l90: [1, 1, 1, 2, 2, 4],
    lx: [0, 0],
    lx_t: [],
  });
  assert.deepEqual(confirmed.passed, ["acc", "money", "leaders"]);
  assert.equal(confirmed.distHeavy, false);

  const flags = layerFlags({
    st: "emerg",
    now: 78,
    m1: 50,
    stats: { n: 5, udv: 1.2 },
    held: { held: 2, of: 20 },
    conf: confirmed,
  });
  assert.ok(flags.some(([k]) => k === "confirmed"));

  const dist = layerConfirm({ acc: [1], dist: [4], dvs: [0.9], l90: [2], lx: [2], lx_t: ["NVDA", "AVGO"] });
  assert.equal(dist.distHeavy, true);
  const dFlags = layerFlags({ st: "lead", now: 90, m1: 88, stats: { n: 5 }, held: { held: 15, of: 20 }, conf: dist });
  assert.ok(dFlags.some(([k]) => k === "distrib"));
  assert.ok(dFlags.some(([k]) => k === "exiting"));
});

test("ema and sma compute expected values with warmup nulls", () => {
  assert.deepEqual(sma([10, 20, 30, 40], 3), [null, null, 20, 30]);
  const e = ema([10, 10, 10, 10], 3);
  assert.deepEqual(e, [null, null, 10, 10]);
});

test("expectedVolAt interpolates 5-minute profile and zvrFor scales by session", () => {
  const profile = Array.from({ length: 78 }, (_, i) => (i + 1) * 10000);
  assert.equal(expectedVolAt(profile, 5), 10000);
  assert.equal(expectedVolAt(profile, 7.5), 15000);
  assert.equal(expectedVolAt(profile, null), null);

  // Off-hours Saturday ET: full-day volume / avg_vol_10d
  const sat = new Date("2026-11-21T18:00:00Z");
  const z = zvrFor({ ticker: "NVDA", avg_vol_10d: 1000000 }, { volume: 2500000 }, null, sat);
  assert.equal(z, 2.5);
});

test("pinReason, rsLeads, and computeTiers classify leaders and emerging stocks", () => {
  assert.ok(pinReason({ adr20: 0.5 }));
  assert.ok(pinReason({ adr20: 3.0, adr5: 1.0, adr_pct: 4.0, off_52w_high: -1.0 }));
  assert.equal(pinReason({ adr20: 4.5, adr5: 4.2, adr_pct: 4.5, off_52w_high: -3.0 }), null);

  assert.ok(rsLeads({ rsl_hi_ago: 0, off_52w_high: -8, change_pct: 1.5 }));
  assert.equal(rsLeads({ rsl_hi_ago: 0, off_52w_high: -8, change_pct: -0.5 }), null);

  const stockMap = {
    LEAD1: { ticker: "LEAD1", close: 85, avg_dollar_vol_raw: 50e6, above_50ma: true, rs_rank: 95, off_52w_high: -5, adr20: 4 },
    LEAD92: { ticker: "LEAD92", close: 60, avg_dollar_vol_raw: 50e6, above_50ma: true, rs_rank: 92, off_52w_high: -5, adr20: 4 },
    ELITE_PB: { ticker: "ELITE_PB", close: 40, avg_dollar_vol_raw: 50e6, above_50ma: true, rs_rank: 97, off_52w_high: -28, adr20: 5 },
    PENNY: { ticker: "PENNY", close: 3.5, avg_dollar_vol_raw: 50e6, above_50ma: true, rs_rank: 98, off_52w_high: -2, adr20: 6 },
    PIN1: { ticker: "PIN1", close: 50, avg_dollar_vol_raw: 50e6, above_50ma: true, rs_rank: 95, off_52w_high: -1, adr20: 0.4 },
    EMRG1: { ticker: "EMRG1", close: 45, avg_dollar_vol_raw: 50e6, above_50ma: true, rs_rank: 82, off_52w_high: -4, adr20: 4 },
    ILLIQ: { ticker: "ILLIQ", close: 20, avg_dollar_vol_raw: 5e6, above_50ma: true, rs_rank: 99, off_52w_high: -2, adr20: 4 },
  };
  assert.equal(isEliteRs(stockMap.LEAD1), true);
  assert.equal(isEliteRs(stockMap.ELITE_PB), true);
  assert.equal(isEliteRs(stockMap.LEAD92), false);
  assert.equal(isEliteRs(stockMap.PENNY), false);
  assert.equal(isEliteRs(stockMap.PIN1), false);
  assert.equal(isEliteRs(stockMap.ILLIQ), false);

  const tiers = computeTiers(stockMap, { EMRG1: { st: "lead" } });
  assert.equal(tiers.leaders.has("LEAD1"), true);
  assert.equal(tiers.leaders.has("PIN1"), false);
  assert.equal(tiers.leaders.has("ILLIQ"), false);
  assert.equal(tiers.emerging.has("EMRG1"), true);
  assert.equal(tiers.eliteRs.has("LEAD1"), true);
  assert.equal(tiers.eliteRs.has("ELITE_PB"), true);
  assert.equal(tiers.eliteRs.has("LEAD92"), false);
  assert.equal(tiers.eliteRs.has("PENNY"), false);
  assert.equal(tiers.eliteRs.has("PIN1"), false);
  assert.equal(tiers.eliteRs.has("ILLIQ"), false);
});

test("epsGrowth and withEpsRating rank faster growers higher and flag acceleration", () => {
  assert.equal(epsGrowth(-0.5, 1.0), -100);
  assert.equal(epsGrowth(0.5, -0.5), 100);
  assert.equal(epsGrowth(10, 1), 200); // capped at +200

  const stockMap = {
    FAST: {
      ticker: "FAST",
      quarters: [
        { report_date: "2026-09-30", eps: 2.0, eps_yoy: 90 },
        { report_date: "2026-06-30", eps: 1.5, eps_yoy: 60 },
        { report_date: "2026-03-31", eps: 1.2, eps_yoy: 30 },
      ],
      annual: [
        { year: 2025, eps: 6.0 },
        { year: 2024, eps: 4.0 },
        { year: 2023, eps: 2.5 },
        { year: 2022, eps: 1.5 },
      ],
    },
    SLOW: {
      ticker: "SLOW",
      quarters: [
        { report_date: "2026-09-30", eps: 1.0, eps_yoy: 5 },
        { report_date: "2026-06-30", eps: 1.0, eps_yoy: 4 },
      ],
      annual: [
        { year: 2025, eps: 4.0 },
        { year: 2024, eps: 4.1 },
      ],
    },
  };
  const rated = withEpsRating(stockMap);
  assert.ok(rated.FAST.eps_rating > rated.SLOW.eps_rating);
  assert.equal(rated.FAST.eps_accel, true);
  assert.equal(rated.SLOW.eps_accel, false);
});

test("rsScore and layerRanksFrom rank layers monotonically with shrinkage", () => {
  const score = rsScore({ return_1m: 10, return_3m: 20, return_6m: 30, return_1y: 40 }, 1);
  assert.ok(Math.abs(score - 22) < 1e-9);
  const stockMap = {
    A1: { rs_score_live: 50 },
    A2: { rs_score_live: 60 },
    B1: { rs_score_live: -10 },
    B2: { rs_score_live: -20 },
  };
  const ranks = layerRanksFrom(
    ["t|High", "t|Low"],
    { "t|High": ["A1", "A2"], "t|Low": ["B1", "B2"] },
    stockMap,
    "rs_score_live"
  );
  assert.equal(ranks["t|High"], 100);
  assert.equal(ranks["t|Low"], 0);
});

test("closingRange uses rthPrice during ext hours, avoids cross-day mixing, and falls back to prev_close_range", () => {
  // Normal RTH quote
  assert.equal(closingRange({ price: 108, dayHigh: 110, dayLow: 100 }, null), 80);

  // Extended-hours overlay: price is AH print (115 > dayHigh), rthPrice is RTH close (103) -> must use rthPrice (30%, NOT 100%)
  assert.equal(
    closingRange({ price: 115, rthPrice: 103, dayHigh: 110, dayLow: 100, ext_session: "afterhours", ext_change: 11.6 }, { cr_pct: 30 }),
    30
  );

  // Extended-hours quote without rthPrice -> must NOT clamp AH print against RTH range; falls back to s.cr_pct
  assert.equal(
    closingRange({ price: 115, dayHigh: 110, dayLow: 100, ext_change: 5.0 }, { cr_pct: 42 }),
    42
  );

  // Missing q.price -> must NOT mix s.close with q.dayHigh/q.dayLow; falls back to s.cr_pct
  assert.equal(
    closingRange({ dayHigh: 110, dayLow: 100 }, { close: 109, cr_pct: 25 }),
    25
  );

  // ETF without cr_pct (e.g. SPY/QQQ) -> falls back to prev_close_range
  assert.equal(closingRange(null, { close: 689.81, prev_close_range: 9.7 }), 10);
});

test("classifyWeinsteinStage and computeStageDistribution classify Stages 1-4 accurately", () => {
  const s1 = { sma200_pct: -2.0, sma50_pct: 3.0, sma50_lvl: 95, sma200_lvl: 100, ma8w_rising: 1, tt_mask: 16 };
  const s2 = { sma200_pct: 18.0, sma50_pct: 6.0, sma50_lvl: 112, sma200_lvl: 100, tt_mask: 127 };
  const s3 = { sma200_pct: 4.0, sma50_pct: -3.5, sma50_lvl: 105, sma200_lvl: 100, tt_mask: 3 };
  const s4 = { sma200_pct: -18.0, sma50_pct: -9.0, sma50_lvl: 88, sma200_lvl: 100, tt_mask: 0 };

  assert.equal(classifyWeinsteinStage(s1), 1);
  assert.equal(classifyWeinsteinStage(s2), 2);
  assert.equal(classifyWeinsteinStage(s3), 3);
  assert.equal(classifyWeinsteinStage(s4), 4);
  assert.equal(classifyWeinsteinStage({}), null);

  const dist = computeStageDistribution({ A: s1, B: s2, C: s3, D: s4, E: {} });
  assert.equal(dist.total, 4);
  assert.deepEqual(dist.stages.map((x) => [x.stage, x.count, x.pct]), [
    [1, 1, 25],
    [2, 1, 25],
    [3, 1, 25],
    [4, 1, 25],
  ]);

  const hist = estimateStageHistory(
    [
      { date: "2026-11-18", p20: 72, p50: 71, p200: 70 },
      { date: "2026-11-20", p20: 17, p50: 28.7, p200: 37.5 },
    ],
    dist,
    "2026-11-20"
  );
  assert.equal(hist.length, 2);
  assert.equal(hist[0].s1 + hist[0].s2 + hist[0].s3 + hist[0].s4, 100);
  assert.ok(hist[0].s2 > 55); // strong bull day
  assert.equal(hist[1].exact, true);
  assert.equal(hist[1].s2, 25); // anchored to exact currentDist
});

test("computeLayerDayFlow and fmtDollarVol compute EOD and pace-adjusted live dollar flow", () => {
  const sm = {
    A: { close: 100, change_pct: 4.0, avg_dollar_vol_raw: 1e9, rel_volume: 2.0 }, // $2B up
    B: { close: 50, change_pct: 2.0, avg_dollar_vol_raw: 5e8, rel_volume: 1.0 },  // $0.5B up
    C: { close: 80, change_pct: -3.0, avg_dollar_vol_raw: 1e9, rel_volume: 1.5 }, // $1.5B down
  };
  const eod = computeLayerDayFlow(["A", "B", "C"], sm, { isLive: false });
  assert.equal(eod.today, 2.0);
  assert.equal(eod.green, 2);
  assert.equal(eod.n, 3);
  assert.equal(eod.dv, 4e9);
  assert.equal(eod.netDv, 1e9); // 2.5B - 1.5B
  assert.equal(eod.rvol, 1.6);  // 4B / 2.5B
  // align = (1 + 1 * (1/4)) / 2 = 0.625 => 2.0 * 1.6 * 0.625 = 2.0
  assert.equal(eod.thrust, 2.0);

  // Broad heavy selloff: negative median + negative net dollar flow MUST stay strongly negative
  const selloff = computeLayerDayFlow(["D", "E"], {
    D: { close: 100, change_pct: -6.0, avg_dollar_vol_raw: 1e9, rel_volume: 2.0 },
    E: { close: 50, change_pct: -4.0, avg_dollar_vol_raw: 1e9, rel_volume: 2.0 },
  }, { isLive: false });
  assert.equal(selloff.today, -5.0);
  assert.equal(selloff.rvol, 2.0);
  assert.equal(selloff.thrust, -10.0);

  // Divergent: slight positive median but heavy selling in large-cap member dampens thrust toward 0
  const div = computeLayerDayFlow(["S1", "S2", "BIG"], {
    S1: { close: 10, change_pct: 1.0, avg_dollar_vol_raw: 1e7, rel_volume: 1.0 },
    S2: { close: 10, change_pct: 1.0, avg_dollar_vol_raw: 1e7, rel_volume: 1.0 },
    BIG: { close: 100, change_pct: -5.0, avg_dollar_vol_raw: 1e9, rel_volume: 2.0 },
  }, { isLive: false });
  assert.ok(div.today > 0 && div.netDv < 0);
  assert.ok(div.thrust >= 0 && div.thrust < 0.2);

  const smLive = {
    A: { close: 100, px_live: 105, vol_live: 10e6, chg_live: 5.0, avg_dollar_vol_raw: 1e9 }, // $1.05B at 50% of session => 2.1x
    B: { close: 50, px_live: 49, vol_live: 5e6, chg_live: -2.0, avg_dollar_vol_raw: 5e8 },   // $0.245B at 50% of session => 0.98x
  };
  const live = computeLayerDayFlow(["A", "B"], smLive, { isLive: true, volFrac: 0.5 });
  assert.equal(live.green, 1);
  assert.equal(live.dv, 1.05e9 + 0.245e9);
  assert.equal(live.netDv, 1.05e9 - 0.245e9);
  assert.equal(live.rvol, +(1.295e9 / (1.5e9 * 0.5)).toFixed(2));

  assert.equal(fmtDollarVol(93.34e9), "$93.3B");
  assert.equal(fmtDollarVol(125e9), "$125B");
  assert.equal(fmtDollarVol(-4.2e9, true), "-$4.2B");
  assert.equal(fmtDollarVol(420e6, true), "+$420M");
  assert.equal(fmtDollarVol(null), "—");
});

test("stockThrust multiplies Chg% by positive ZVR and handles missing/invalid values", () => {
  assert.equal(stockThrust(4.5, 2.2), 9.9);
  assert.equal(stockThrust(-4.0, 2.0), -8.0);
  assert.equal(stockThrust(0, 1.8), 0);
  assert.equal(stockThrust(5.0, 0), null);
  assert.equal(stockThrust(5.0, -1), null);
  assert.equal(stockThrust(null, 2.0), null);
  assert.equal(stockThrust(3.0, null), null);
});

test("isHealthcareItem matches all Healthcare themes, sectors, layers, and industries", () => {
  assert.equal(isHealthcareItem({ theme: "Healthcare", layer: "Devices" }), true);
  assert.equal(isHealthcareItem({ themeId: "health", layer: "CRO + Services" }), true);
  assert.equal(isHealthcareItem({ sector: "Healthcare", layer: "Medical Robotics" }), true);
  assert.equal(isHealthcareItem({ industry: "Biotechnology" }), true);
  assert.equal(isHealthcareItem({ industry: "Drug Manufacturers - General" }), true);
  assert.equal(isHealthcareItem({ layer: "Pharma Majors" }), true);
  assert.equal(isHealthcareItem({ layer: "GLP-1 / Metabolic" }), true);
  assert.equal(isHealthcareItem({ theme: "Software", layer: "Enterprise SaaS", sector: "Technology" }), false);
  assert.equal(isHealthcareItem({ theme: "Agriculture", layer: "Animal Health + Food Tech", sector: "Consumer Defensive" }), false);
  assert.equal(isHealthcareItem(null), false);
});
