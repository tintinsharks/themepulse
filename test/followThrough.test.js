import test from "node:test";
import assert from "node:assert/strict";
import {
  selectDailySnapshots,
  evaluateBreakoutFollowThrough,
  classifyFollowThrough,
  computeSizingVerdict,
} from "../src/lead/followThrough.js";

test("selectDailySnapshots deduplicates multi-day scans, caps at maxDays, and skips premarket when later scans exist", () => {
  const indexList = [
    // Day 6 (newest) — only premarket so far -> should keep premarket
    { id: "zanger-2026-11-26-0830", file: "zanger-2026-11-26-0830.json", date: "2026-11-26", et: "2026-11-26 08:30 ET", phase: "premarket", breakoutCount: 2 },
    // Day 5 — premarket + 0-BO open + 2 intraday scans + close
    { id: "zanger-2026-11-25-1605", file: "zanger-2026-11-25-1605.json", date: "2026-11-25", et: "2026-11-25 16:05 ET", phase: "close", breakoutCount: 3 },
    { id: "zanger-2026-11-25-1300", file: "zanger-2026-11-25-1300.json", date: "2026-11-25", et: "2026-11-25 13:00 ET", phase: "midday", breakoutCount: 4 },
    { id: "zanger-2026-11-25-1100", file: "zanger-2026-11-25-1100.json", date: "2026-11-25", et: "2026-11-25 11:00 ET", phase: "midday", breakoutCount: 2 },
    { id: "zanger-2026-11-25-1000", file: "zanger-2026-11-25-1000.json", date: "2026-11-25", et: "2026-11-25 10:00 ET", phase: "open", breakoutCount: 0 },
    { id: "zanger-2026-11-25-0830", file: "zanger-2026-11-25-0830.json", date: "2026-11-25", et: "2026-11-25 08:30 ET", phase: "premarket", breakoutCount: 5 },
    // Day 4 — single scan only -> deduplicated to 1 file
    { id: "zanger-2026-11-24-1035", file: "zanger-2026-11-24-1035.json", date: "2026-11-24", et: "2026-11-24 10:35 ET", phase: "open", breakoutCount: 4 },
    // Day 3 — all 0 breakouts -> falls back to earliest non-premarket + latest
    { id: "zanger-2026-11-23-1600", file: "zanger-2026-11-23-1600.json", date: "2026-11-23", et: "2026-11-23 16:00 ET", phase: "close", breakoutCount: 0 },
    { id: "zanger-2026-11-23-1000", file: "zanger-2026-11-23-1000.json", date: "2026-11-23", et: "2026-11-23 10:00 ET", phase: "open", breakoutCount: 0 },
    { id: "zanger-2026-11-23-0830", file: "zanger-2026-11-23-0830.json", date: "2026-11-23", et: "2026-11-23 08:30 ET", phase: "premarket", breakoutCount: 1 },
    // Day 2 — 2 scans with breakouts
    { id: "zanger-2026-11-20-1600", file: "zanger-2026-11-20-1600.json", date: "2026-11-20", et: "2026-11-20 16:00 ET", phase: "close", breakoutCount: 3 },
    { id: "zanger-2026-11-20-1000", file: "zanger-2026-11-20-1000.json", date: "2026-11-20", et: "2026-11-20 10:00 ET", phase: "open", breakoutCount: 3 },
    // Day 1 (oldest, 6th distinct day) — should be dropped when maxDays = 5
    { id: "zanger-2026-11-19-1600", file: "zanger-2026-11-19-1600.json", date: "2026-11-19", et: "2026-11-19 16:00 ET", phase: "close", breakoutCount: 5 },
    { id: "zanger-2026-11-19-1000", file: "zanger-2026-11-19-1000.json", date: "2026-11-19", et: "2026-11-19 10:00 ET", phase: "open", breakoutCount: 5 },
  ];

  const files = selectDailySnapshots(indexList, 5);
  assert.deepEqual(files, [
    "zanger-2026-11-20-1000.json",
    "zanger-2026-11-20-1600.json",
    "zanger-2026-11-23-1000.json",
    "zanger-2026-11-23-1600.json",
    "zanger-2026-11-24-1035.json",
    "zanger-2026-11-25-1100.json",
    "zanger-2026-11-25-1605.json",
    "zanger-2026-11-26-0830.json",
  ]);
  assert.equal(new Set(files).size, files.length);
  assert.ok(files.length <= 10);
  assert.equal(selectDailySnapshots([], 5).length, 0);
  assert.equal(selectDailySnapshots(null, 5).length, 0);
});

test("evaluateBreakoutFollowThrough flips a morning breakout from held to squatted when live quote CR drops to 22%", () => {
  const snapshots = [
    {
      date: "2026-11-23",
      et: "2026-11-23 10:05 ET",
      phase: { id: "open", label: "OPENING RANGE SCAN" },
      zangerMovers: [
        { ticker: "NVDA", theme: "AI Infra", isBreakout: true, breakoutTypes: ["ZANGER", "SB4%"], chg: 4.8, cr: 88 },
        { ticker: "CLS", theme: "AI Infra", isBreakout: true, breakoutTypes: ["SB4%"], chg: 5.2, cr: 82 },
        { ticker: "VRT", theme: "Power", isBreakout: true, breakoutTypes: ["QMAG"], chg: 3.1, cr: 76 },
        { ticker: "NOTBO", theme: "Other", isBreakout: false, breakoutTypes: [], chg: 2.0, cr: 70 },
      ],
    },
  ];

  const quotes = new Map([
    // Morning breakout NVDA squats intraday: price 102.2 in [100, 110] -> CR = 22%
    ["NVDA", { price: 102.2, rthPrice: 102.2, change: 1.5, dayHigh: 110, dayLow: 100, open: 101, prevClose: 100.69 }],
    // CLS fades moderately into mixed zone: price 55 in [50, 60] -> CR = 50%
    ["CLS", { price: 55, rthPrice: 55, change: 2.4, dayHigh: 60, dayLow: 50, open: 53, prevClose: 53.71 }],
    // VRT holds strong near highs: price 89 in [80, 90] -> CR = 90%
    ["VRT", { price: 89, rthPrice: 89, change: 4.1, dayHigh: 90, dayLow: 80, open: 85.5, prevClose: 85.49 }],
  ]);

  // With liveOn = true, live quotes override morning snapshot
  const liveRes = evaluateBreakoutFollowThrough({
    snapshots,
    quotes,
    stockMap: {},
    todayStr: "2026-11-23",
    liveOn: true,
  });

  assert.equal(liveRes.days.length, 1);
  const day = liveRes.days[0];
  assert.equal(day.total, 3);
  assert.equal(day.held, 1);
  assert.equal(day.mixed, 1);
  assert.equal(day.squatted, 1);
  assert.equal(day.holdRate, 33);
  assert.equal(day.squatRate, 33);

  const byTk = Object.fromEntries(day.tickers.map((t) => [t.ticker, t]));
  assert.equal(byTk.NVDA.cr, 22);
  assert.equal(byTk.NVDA.status, "squatted");
  assert.equal(byTk.CLS.cr, 50);
  assert.equal(byTk.CLS.status, "mixed");
  assert.equal(byTk.VRT.cr, 90);
  assert.equal(byTk.VRT.status, "held");
  assert.equal(byTk.NOTBO, undefined);

  // With liveOn = false (frozen snapshot), all 3 remain held from the morning scan
  const frozenRes = evaluateBreakoutFollowThrough({
    snapshots,
    quotes,
    stockMap: {},
    todayStr: "2026-11-23",
    liveOn: false,
  });
  assert.equal(frozenRes.days[0].held, 3);
  assert.equal(frozenRes.days[0].squatted, 0);
  assert.equal(frozenRes.days[0].holdRate, 100);
});

test("evaluateBreakoutFollowThrough falls back to stockMap when a morning breakout fades off today's latest snapshot", () => {
  const snapshots = [
    {
      stamp: { date: "2026-11-23", pretty: "2026-11-23 10:05 ET", hours: 10, minutes: 5 },
      phase: { id: "open", label: "OPEN" },
      zangerMovers: [
        { ticker: "FADE", theme: "Tech", isBreakout: true, breakoutTypes: ["ZANGER"], chg: 4.0, cr: 85 },
        { ticker: "STAY", theme: "Tech", isBreakout: true, breakoutTypes: ["SB4%"], chg: 4.5, cr: 80 },
      ],
    },
    {
      stamp: { date: "2026-11-23", pretty: "2026-11-23 15:30 ET", hours: 15, minutes: 30 },
      phase: { id: "power", label: "POWER HOUR" },
      zangerMovers: [
        // FADE is no longer listed because it dropped off the breakout scan
        { ticker: "STAY", theme: "Tech", isBreakout: true, breakoutTypes: ["SB4%"], chg: 5.1, cr: 84 },
      ],
    },
  ];

  const stockMap = {
    FADE: { ticker: "FADE", change_pct: -0.8, cr_pct: 18 },
  };

  const res = evaluateBreakoutFollowThrough({
    snapshots,
    quotes: new Map(),
    stockMap,
    todayStr: "2026-11-23",
    liveOn: false,
  });

  const byTk = Object.fromEntries(res.days[0].tickers.map((t) => [t.ticker, t]));
  assert.equal(byTk.FADE.status, "squatted");
  assert.equal(byTk.FADE.chg, -0.8);
  assert.equal(byTk.FADE.cr, 18);
  assert.equal(byTk.STAY.status, "held");
  assert.equal(byTk.STAY.chg, 5.1);
});

test("evaluateBreakoutFollowThrough aggregates multi-day rolling 5d metrics chronologically and does not apply today's live quotes to past days", () => {
  const makeDay = (date, movers) => ({
    date,
    et: `${date} 16:00 ET`,
    phase: { id: "close", label: "CLOSE" },
    zangerMovers: movers,
  });

  const snapshots = [
    // Intentionally out of order + 6 days (oldest should be dropped to keep 5d)
    makeDay("2026-11-23", [
      { ticker: "A1", theme: "AI", isBreakout: true, breakoutTypes: ["ZANGER"], chg: 4.0, cr: 80 },
      { ticker: "A2", theme: "AI", isBreakout: true, breakoutTypes: ["SB4%"], chg: -1.0, cr: 20 },
    ]),
    makeDay("2026-11-17", [
      { ticker: "OLD", theme: "Old", isBreakout: true, breakoutTypes: ["ZANGER"], chg: 6.0, cr: 95 },
    ]),
    makeDay("2026-11-19", [
      { ticker: "B1", theme: "Bio", isBreakout: true, breakoutTypes: ["SB$"], chg: 3.0, cr: 75 },
    ]),
    makeDay("2026-11-20", [
      { ticker: "C1", theme: "Cloud", isBreakout: true, breakoutTypes: ["QMAG"], chg: 5.0, cr: 90 },
      { ticker: "C2", theme: "Cloud", isBreakout: true, breakoutTypes: ["SB4%"], chg: 2.0, cr: 50 },
    ]),
    makeDay("2026-11-18", [
      { ticker: "D1", theme: "Def", isBreakout: true, breakoutTypes: ["ZANGER"], chg: 3.5, cr: 72 },
    ]),
    makeDay("2026-11-22", [
      { ticker: "E1", theme: "Energy", isBreakout: true, breakoutTypes: ["ZANGER"], chg: 4.2, cr: 85 },
    ]),
  ];

  // Live quote for past-day ticker B1 should NOT alter 2026-11-19
  const quotes = new Map([
    ["B1", { price: 10, change: -5.0, dayHigh: 15, dayLow: 9 }],
  ]);

  const res = evaluateBreakoutFollowThrough({
    snapshots,
    quotes,
    todayStr: "2026-11-23",
    liveOn: true,
  });

  assert.deepEqual(res.days.map((d) => d.date), [
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-22",
    "2026-11-23",
  ]);
  // 5-day totals: D1(held), B1(held), C1(held), C2(mixed), E1(held), A1(held), A2(squatted)
  assert.equal(res.rollingTotal, 7);
  assert.equal(res.rollingHeld, 5);
  assert.equal(res.rollingMixed, 1);
  assert.equal(res.rollingSquatted, 1);
  assert.equal(res.rollingHoldRate, 71);
  assert.equal(res.verdict.label, "PRESS SIZE");
  assert.equal(res.verdict.tone, "good");
});

test("sizing verdict covers all 4 thresholds cleanly (BUILDING SAMPLE, PRESS SIZE, SELECTIVE, DEFENSIVE / SQUAT TAPE)", () => {
  // 1. BUILDING SAMPLE (< 3 breakouts)
  const building = evaluateBreakoutFollowThrough({
    snapshots: [
      {
        date: "2026-11-23",
        et: "2026-11-23 10:30 ET",
        zangerMovers: [
          { ticker: "ONE", isBreakout: true, breakoutTypes: ["ZANGER"], chg: 4.0, cr: 90 },
          { ticker: "TWO", isBreakout: true, breakoutTypes: ["SB4%"], chg: 5.0, cr: 85 },
        ],
      },
    ],
  });
  assert.equal(building.verdict.label, "BUILDING SAMPLE");
  assert.equal(building.verdict.tone, "muted");
  assert.equal(building.verdict.advice, "Tracking hourly & daily breakout follow-through as snapshots accumulate.");

  // 2. PRESS SIZE (>= 65%)
  const press = evaluateBreakoutFollowThrough({
    snapshots: [
      {
        date: "2026-11-23",
        et: "2026-11-23 16:00 ET",
        zangerMovers: [
          { ticker: "H1", isBreakout: true, chg: 4.0, cr: 80 },
          { ticker: "H2", isBreakout: true, chg: 3.5, cr: 60 },
          { ticker: "S1", isBreakout: true, chg: -0.5, cr: 30 },
        ],
      },
    ],
  });
  assert.equal(press.rollingHoldRate, 67);
  assert.equal(press.verdict.label, "PRESS SIZE");
  assert.equal(press.verdict.tone, "good");

  // 3. SELECTIVE (45% - 64%)
  const selective = evaluateBreakoutFollowThrough({
    snapshots: [
      {
        date: "2026-11-23",
        et: "2026-11-23 16:00 ET",
        zangerMovers: [
          { ticker: "H1", isBreakout: true, chg: 4.0, cr: 80 },
          { ticker: "H2", isBreakout: true, chg: 3.0, cr: 70 },
          { ticker: "M1", isBreakout: true, chg: 2.0, cr: 50 },
          { ticker: "S1", isBreakout: true, chg: 1.0, cr: 25 },
        ],
      },
    ],
  });
  assert.equal(selective.rollingHoldRate, 50);
  assert.equal(selective.verdict.label, "SELECTIVE");
  assert.equal(selective.verdict.tone, "warn");

  // 4. DEFENSIVE / SQUAT TAPE (< 45%)
  const defensive = evaluateBreakoutFollowThrough({
    snapshots: [
      {
        date: "2026-11-23",
        et: "2026-11-23 16:00 ET",
        zangerMovers: [
          { ticker: "H1", isBreakout: true, chg: 4.0, cr: 80 },
          { ticker: "S1", isBreakout: true, chg: 0.5, cr: 25 },
          { ticker: "S2", isBreakout: true, chg: -1.2, cr: 70 },
        ],
      },
    ],
  });
  assert.equal(defensive.rollingHoldRate, 33);
  assert.equal(defensive.verdict.label, "DEFENSIVE / SQUAT TAPE");
  assert.equal(defensive.verdict.tone, "bad");

  // Exact boundary checks on computeSizingVerdict & classifyFollowThrough
  assert.equal(computeSizingVerdict(3, 65).label, "PRESS SIZE");
  assert.equal(computeSizingVerdict(3, 64).label, "SELECTIVE");
  assert.equal(computeSizingVerdict(3, 45).label, "SELECTIVE");
  assert.equal(computeSizingVerdict(3, 44).label, "DEFENSIVE / SQUAT TAPE");
  assert.equal(classifyFollowThrough(1.0, 60), "held");
  assert.equal(classifyFollowThrough(1.0, null), "held");
  assert.equal(classifyFollowThrough(1.0, 59), "mixed");
  assert.equal(classifyFollowThrough(1.0, 40), "mixed");
  assert.equal(classifyFollowThrough(1.0, 39), "squatted");
  assert.equal(classifyFollowThrough(0, 90), "squatted");
});
