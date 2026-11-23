import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreZangerCandidate,
  isUsMarketHoliday,
  isMarketScanWindow,
  buildEmailSubject,
  buildEmailHtml,
} from "../scripts/zanger-scan.mjs";

const sat = new Date("2026-11-21T18:00:00Z");

test("scoreZangerCandidate flags Dan Zanger breakout (ZVR>=2x, chg>=3%, CR>=70%, near 52wH)", () => {
  const s = {
    ticker: "NVDA",
    company: "NVIDIA Corp",
    avg_dollar_vol_raw: 500e6,
    avg_vol_10d: 1_000_000,
    above_50ma: true,
    rs_rank: 96,
    eps_rating: 92,
    eps_accel: true,
    adr20: 4.2,
    off_52w_high: -2.5,
  };
  const q = { price: 145, dayHigh: 146, dayLow: 138, change: 4.5, volume: 2_600_000 };
  const layer = { theme: "AI Infra", name: "Compute Silicon", st: "lead", now: 95 };

  const res = scoreZangerCandidate({ s, q, layer, tier: "lead", profiles: null, now: sat });
  assert.equal(res.qualifiesZanger, true);
  assert.equal(res.isBreakout, true);
  assert.ok(res.breakoutTypes.includes("ZANGER"));
  assert.ok(res.breakoutTypes.includes("SB4%"));
  assert.ok(res.breakoutTypes.includes("SB$"));
  assert.equal(res.zvr, 2.6);
  assert.equal(res.cr, 88);
  assert.ok(res.score > 75);
});

test("scoreZangerCandidate detects Stockbee 4%, Stockbee $, and Qullamaggie breakouts independently", () => {
  const layer = { theme: "Software", name: "Vertical SaaS", st: "lead", now: 92 };

  // Stockbee 4% breakout (1.1x vol, +4.6%, $15 stock -> dollarMove ~$0.66, not Zanger or SB$)
  const sb4 = scoreZangerCandidate({
    s: { ticker: "SB4", avg_dollar_vol_raw: 30e6, avg_vol_10d: 1_000_000, above_50ma: true, rs_rank: 78, adr20: 3.0, off_52w_high: -14 },
    q: { price: 15.0, previousClose: 14.34, dayHigh: 15.1, dayLow: 14.3, change: 4.6, volume: 1_100_000 },
    layer, tier: null, profiles: null, now: sat,
  });
  assert.equal(sb4.isBreakout, true);
  assert.deepEqual(sb4.breakoutTypes, ["SB4%"]);

  // Stockbee $ breakout ($120 stock up +$2.40 = +2.0%, 1.3x vol -> SB$ only)
  const sbDollar = scoreZangerCandidate({
    s: { ticker: "SBD", avg_dollar_vol_raw: 80e6, avg_vol_10d: 1_000_000, above_50ma: true, rs_rank: 82, adr20: 2.5, off_52w_high: -12 },
    q: { price: 122.4, previousClose: 120.0, dayHigh: 122.8, dayLow: 119.8, change: 2.0, volume: 1_300_000 },
    layer, tier: null, profiles: null, now: sat,
  });
  assert.equal(sbDollar.isBreakout, true);
  assert.deepEqual(sbDollar.breakoutTypes, ["SB$"]);
  assert.equal(sbDollar.dollarMove, 2.4);

  // Qullamaggie breakout (RS 88, return_3m 45%, ADR 4.5%, ema_stack, +3.4% on 1.4x vol, $12 stock)
  const qmag = scoreZangerCandidate({
    s: { ticker: "QMG", avg_dollar_vol_raw: 40e6, avg_vol_10d: 1_000_000, above_50ma: true, rs_rank: 88, adr20: 4.5, return_3m: 45, ema_stack: true, off_52w_high: -6, dist_20dma_atrx: 1.4 },
    q: { price: 12.0, previousClose: 11.6, dayHigh: 12.1, dayLow: 11.55, change: 3.45, volume: 1_400_000 },
    layer, tier: null, profiles: null, now: sat,
  });
  assert.equal(qmag.isBreakout, true);
  assert.deepEqual(qmag.breakoutTypes, ["QMAG"]);
});

test("scoreZangerCandidate rejects low-volume, weak-close, or buyout-pinned names", () => {
  const base = {
    ticker: "TEST",
    avg_dollar_vol_raw: 50e6,
    avg_vol_10d: 1_000_000,
    above_50ma: true,
    rs_rank: 92,
    adr20: 3.5,
    off_52w_high: -3.0,
  };
  const layer = { theme: "Cyber", name: "Platform", st: "lead", now: 94 };

  // Low ZVR (0.8x) -> does not qualify as Zanger volume mover
  const lowVol = scoreZangerCandidate({
    s: base,
    q: { price: 100, dayHigh: 101, dayLow: 96, change: 3.5, volume: 800_000 },
    layer,
    tier: "lead",
    profiles: null,
    now: sat,
  });
  assert.equal(lowVol.qualifiesZanger, false);

  // Weak close (CR 20%) -> rejected
  const weakClose = scoreZangerCandidate({
    s: base,
    q: { price: 97, dayHigh: 105, dayLow: 95, change: 2.0, volume: 2_500_000 },
    layer,
    tier: "lead",
    profiles: null,
    now: sat,
  });
  assert.equal(weakClose.qualifiesZanger, false);

  // Buyout-pinned (ADR 0.4%) -> filtered out completely
  const pinned = scoreZangerCandidate({
    s: { ...base, adr20: 0.4 },
    q: { price: 100, dayHigh: 100.2, dayLow: 99.8, change: 2.0, volume: 3_000_000 },
    layer,
    tier: null,
    profiles: null,
    now: sat,
  });
  assert.equal(pinned, null);
});

test("isUsMarketHoliday detects NYSE holidays including Good Friday and weekend observations", () => {
  // 2026 NYSE holidays
  assert.equal(isUsMarketHoliday("2026-01-01"), true);  // New Year's Day (Thu)
  assert.equal(isUsMarketHoliday("2026-01-19"), true);  // MLK Day
  assert.equal(isUsMarketHoliday("2026-02-16"), true);  // Presidents' Day
  assert.equal(isUsMarketHoliday("2026-04-03"), true);  // Good Friday (Easter is Apr 5)
  assert.equal(isUsMarketHoliday("2026-05-25"), true);  // Memorial Day
  assert.equal(isUsMarketHoliday("2026-06-19"), true);  // Juneteenth
  assert.equal(isUsMarketHoliday("2026-07-03"), true);  // Independence Day (Jul 4 is Sat -> Fri Jul 3)
  assert.equal(isUsMarketHoliday("2026-09-07"), true);  // Labor Day
  assert.equal(isUsMarketHoliday("2026-11-26"), true);  // Thanksgiving (4th Thu Nov)
  assert.equal(isUsMarketHoliday("2026-12-25"), true);  // Christmas
  // Normal trading days
  assert.equal(isUsMarketHoliday("2026-11-23"), false);
  assert.equal(isUsMarketHoliday("2026-07-06"), false);
});

test("isMarketScanWindow enforces 10am-4pm ET across EDT & EST and skips weekends/holidays", () => {
  // EST (Nov 23, 2026 is Monday, UTC-5)
  assert.equal(isMarketScanWindow(new Date("2026-11-23T14:00:00Z")).open, false); // 09:00 EST -> skip
  assert.equal(isMarketScanWindow(new Date("2026-11-23T15:00:00Z")).open, true);  // 10:00 EST -> open
  assert.equal(isMarketScanWindow(new Date("2026-11-23T21:10:00Z")).open, true);  // 16:10 EST (cron jitter) -> open
  assert.equal(isMarketScanWindow(new Date("2026-11-23T22:00:00Z")).open, false); // 17:00 EST -> skip

  // EDT (Jul 13, 2026 is Monday, UTC-4)
  assert.equal(isMarketScanWindow(new Date("2026-07-13T14:00:00Z")).open, true);  // 10:00 EDT -> open
  assert.equal(isMarketScanWindow(new Date("2026-07-13T20:05:00Z")).open, true);  // 16:05 EDT -> open
  assert.equal(isMarketScanWindow(new Date("2026-07-13T21:00:00Z")).open, false); // 17:00 EDT -> skip

  // Weekend & Thanksgiving
  assert.equal(isMarketScanWindow(new Date("2026-11-22T17:00:00Z")).reason, "weekend");
  assert.equal(isMarketScanWindow(new Date("2026-11-26T17:00:00Z")).reason, "us_market_holiday");
});

test("buildEmailSubject and buildEmailHtml format breakouts, ADR column, and deep links safely", () => {
  const ctx = {
    stamp: { pretty: "2026-11-23 11:00 ET" },
    mode: "Live Intraday",
    clock: { session: "2026-11-23", rth: true },
    pipelineDate: "2026-11-22",
    leadingLayers: [{ theme: "AI Infra", name: "Compute <Silicon>", st: "lead", now: 95, w1: 92, flags: [] }],
    emergingLayers: [],
    zangerMovers: [{
      ticker: "NVDA",
      company: "NVIDIA & Co",
      theme: "AI Infra",
      layer: "Compute <Silicon>",
      tier: "lead",
      isBreakout: true,
      breakoutTypes: ["ZANGER", "SB4%"],
      chg: 4.5,
      dollarMove: 6.2,
      zvr: 2.6,
      cr: 88,
      rs: 96,
      eps: 92,
      epsAccel: true,
      off52: -2.1,
      adr: 4.2,
      score: 84.5,
      pipelineNews: ["Earnings beat"],
    }],
    headlines: new Map(),
  };

  const subj = buildEmailSubject(ctx);
  assert.ok(subj.includes("1 Breakout (NVDA)"));
  assert.ok(subj.includes("11:00 ET"));

  const html = buildEmailHtml(ctx, { baseUrl: "https://themepulse.vercel.app" });
  assert.ok(html.includes("https://themepulse.vercel.app/?view=zanger&ticker=NVDA"));
  assert.ok(html.includes(">ADR<"));
  assert.ok(html.includes("4.2%"));
  assert.ok(html.includes("Compute &lt;Silicon&gt;"));
  assert.ok(html.includes("NVIDIA &amp; Co"));
});
