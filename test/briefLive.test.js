import test from "node:test";
import assert from "node:assert/strict";
import {
  evalPivotStatus,
  matchMacroLive,
  collectBriefTickers,
  normalizeWrittenBrief,
  filterRecentHeadlines,
  computeLivePortfolioPulse,
} from "../src/lead/briefLive.js";

test("evalPivotStatus classifies buy zone, extended, near pivot, below pivot, and stopped", () => {
  const setup = { pivot: 100, buyZoneMax: 105, stop: 92 };
  assert.equal(evalPivotStatus(102, setup).state, "buy_zone");
  assert.equal(evalPivotStatus(100, setup).state, "buy_zone");
  assert.equal(evalPivotStatus(106, setup).state, "extended");
  assert.equal(evalPivotStatus(98.5, setup).state, "near_pivot");
  assert.equal(evalPivotStatus(95, setup).state, "below_pivot");
  assert.equal(evalPivotStatus(91.5, setup).state, "stopped");
  assert.equal(evalPivotStatus(null, setup), null);
});

test("matchMacroLive overlays VIX, 10Y yield, WTI crude, and DXY from market-quality", () => {
  const mq = {
    tape: [
      { ticker: "VIX", price: "18.42", change: "-8.10" },
      { ticker: "TNX", price: "4.88", change: "-1.25" },
      { ticker: "DXY", price: "103.50", change: "-0.30" },
    ],
    futures: [
      { name: "Crude Oil", price: 80.5, changePct: -2.1 },
      { name: "Gold", price: 2650.25, changePct: 0.75 },
    ],
  };
  assert.deepEqual(matchMacroLive({ name: "VIX" }, mq), { value: "18.42", change: "-8.10%" });
  assert.deepEqual(matchMacroLive({ name: "10Y Yield" }, mq), { value: "4.88%", change: "-1.25%" });
  assert.deepEqual(matchMacroLive({ name: "WTI Crude" }, mq), { value: "$80.50", change: "-2.10%" });
  assert.deepEqual(matchMacroLive({ name: "DXY" }, mq), { value: "103.50", change: "-0.30%" });
  assert.equal(matchMacroLive({ name: "Unknown" }, mq), null);
});

test("collectBriefTickers deduplicates symbols across indexes, focusSetups, extendedMovers, and breakdowns", () => {
  const tickers = collectBriefTickers({
    regime: { indexes: [{ symbol: "SPY" }, { symbol: "QQQ" }] },
    focusSetups: [{ ticker: "AMRX" }, { ticker: "COLM" }],
    extendedMovers: [{ ticker: "COLM" }, { ticker: "CRWD" }],
    breakdowns: [{ ticker: "CAPR" }],
  });
  assert.deepEqual(tickers, ["SPY", "QQQ", "AMRX", "COLM", "CRWD", "CAPR"]);

  // Regression: object-keyed regime.indexes & macroTape + intradayMovers (brief-2026-11-24-intraday-0905 schema) must never throw
  const objBrief = {
    regime: {
      stance: "Selective Rotation",
      grossExposure: "25%-40%",
      indexes: {
        SPY: { price: 714.66, changePct: -1.06 },
        QQQ: { price: 633.95, changePct: -2.62 },
        IWM: { price: 266.04, changePct: 0.11 },
      },
    },
    macroTape: {
      VIX: { value: 27.72, changePct: 4.13, note: "Cooling" },
      US10Y: { value: "4.92%", changeBps: -4, note: "Easing" },
    },
    intradayMovers: [{ ticker: "TGTX", price: 67.2, pivot: 65.5, stop: 60.5 }],
  };
  const nb = normalizeWrittenBrief(objBrief);
  assert.equal(nb.regime.indexes.length, 3);
  assert.equal(nb.regime.posture, "Selective Rotation");
  assert.equal(nb.macroTape.length, 2);
  assert.equal(nb.focusSetups.length, 1);
  assert.deepEqual(collectBriefTickers(objBrief), ["SPY", "QQQ", "IWM", "TGTX"]);

  // Also handles direct regime.spy / regime.qqq / regime.iwm keys (0715 / 0822 schema)
  const flatBrief = {
    regime: { status: "Test", spy: { price: 713 }, qqq: { price: 631 } },
    macroTape: { vix: 29.02, vixChangePct: 9.02, us10yYieldPct: 4.92 },
  };
  const nbf = normalizeWrittenBrief(flatBrief);
  assert.deepEqual(nbf.regime.indexes.map((x) => x.symbol), ["SPY", "QQQ"]);
  assert.equal(nbf.macroTape[0].name, "VIX");
  assert.equal(nbf.macroTape[0].change, "+9.02%");
});

test("filterRecentHeadlines drops stale pipeline/Finviz headlines and inherits bare Finviz times", () => {
  const now = new Date("2026-11-23T16:00:00Z");
  const pipe = [
    "Old Q1 earnings beat [5/4/2026 4:35 PM]",
    "Fresh upgrade to Buy [11/20/2026 8:15 AM]",
  ];
  assert.deepEqual(filterRecentHeadlines(pipe, now, 14), ["Fresh upgrade to Buy [11/20/2026 8:15 AM]"]);

  const finviz = [
    { date: "Today 09:45AM", title: "Raises FY guidance" },
    { date: "08:30AM", title: "Beats Q3 revenue" },
    { date: "Oct-01-26 04:05PM", title: "Stale October press release" },
    { date: "02:10PM", title: "Also from Oct 1 (inherited bare time)" },
  ];
  const kept = filterRecentHeadlines(finviz, now, 14);
  assert.deepEqual(kept.map((x) => x.title), ["Raises FY guidance", "Beats Q3 revenue"]);
});

test("computeLivePortfolioPulse detects breakout, vol surge, squat, heavy sell, pullback, and earnings with severity sort", () => {
  // Post-close ET timestamp so zvrFor uses full-day avg_vol_10d deterministically
  const afterClose = new Date("2026-11-23T22:00:00Z"); // 5:00 PM ET

  const stockMap = {
    // 1. Breakout (ZANGER + SB4% + SB$)
    NVDA: {
      ticker: "NVDA",
      close: 140,
      avg_dollar_vol_raw: 5e9,
      avg_vol_10d: 10e6,
      above_50ma: true,
      rs_rank: 95,
      off_52w_high: -2,
      adr20: 4.0,
    },
    // 2. Volume surge (non-breakout: chg +2.5% < 4%, zvr 1.8x < 2.0, dollarMove $0.50 < $0.90)
    VRT: {
      ticker: "VRT",
      close: 20,
      avg_dollar_vol_raw: 200e6,
      avg_vol_10d: 5e6,
      above_50ma: true,
      rs_rank: 78,
      off_52w_high: -8,
      adr20: 4.5,
    },
    // 3. Squatting (green, heavy volume, closing near lows CR <= 30)
    CLS: {
      ticker: "CLS",
      close: 80,
      avg_dollar_vol_raw: 150e6,
      avg_vol_10d: 2e6,
      above_50ma: true,
      rs_rank: 88,
      off_52w_high: -5,
      adr20: 3.5,
    },
    // 4. Heavy selling on a stock BELOW 50MA (scoreZangerCandidate returns null, must still alert!)
    SMCI: {
      ticker: "SMCI",
      close: 40,
      avg_dollar_vol_raw: 500e6,
      avg_vol_10d: 10e6,
      above_50ma: false,
      rs_rank: 30,
      earnings_days: 0,
    },
    // 5. Sharp pullback (-3.5%, moderate vol 1.1x, CR 50% -> DOWN >=3% warn, not HEAVY SELL)
    META: {
      ticker: "META",
      close: 500,
      avg_dollar_vol_raw: 4e9,
      avg_vol_10d: 10e6,
      above_50ma: true,
      rs_rank: 82,
      earnings_days: 2,
    },
    // 6. Quiet holding (no alert, earnings 5d > 3d threshold)
    MSFT: {
      ticker: "MSFT",
      close: 420,
      avg_dollar_vol_raw: 8e9,
      avg_vol_10d: 15e6,
      above_50ma: true,
      rs_rank: 75,
      earnings_days: 5,
    },
  };

  const quotes = new Map([
    ["NVDA", { price: 147, previousClose: 140, change: 5.0, dayHigh: 148, dayLow: 141, volume: 25e6 }],
    ["VRT", { price: 20.5, previousClose: 20, change: 2.5, dayHigh: 20.6, dayLow: 20.0, volume: 9e6 }],
    ["CLS", { price: 81.2, previousClose: 80, change: 1.5, dayHigh: 85.0, dayLow: 80.5, volume: 3.6e6 }],
    ["SMCI", { price: 38.4, previousClose: 40, change: -4.0, dayHigh: 40.2, dayLow: 38.0, volume: 18e6 }],
    ["META", { price: 482.5, previousClose: 500, change: -3.5, dayHigh: 492.5, dayLow: 472.5, volume: 11e6 }],
    ["MSFT", { price: 422.1, previousClose: 420, change: 0.5, dayHigh: 423, dayLow: 419, volume: 14e6 }],
    // Quote-only ticker not in stockMap (down -5.2% -> HEAVY SELL)
    ["QONLY", { price: 47.4, previousClose: 50, dayHigh: 50.0, dayLow: 47.0, volume: 1e6 }],
  ]);

  const tickerLayer = {
    NVDA: { theme: "AI Infra", name: "GPUs", st: "lead", now: 95 },
    VRT: { theme: "AI Power", name: "Cooling", st: "lead", now: 91 },
    CLS: { theme: "AI Infra", name: "EMS", st: "lead", now: 90 },
  };

  const res = computeLivePortfolioPulse({
    portfolio: ["NVDA", "SMCI", "MSFT", "VRT"],
    watchlist: ["CLS", "META", "QONLY"],
    stockMap,
    quotes,
    tickerLayer,
    now: afterClose,
  });

  assert.equal(res.isLive, true);
  assert.equal(res.portfolioCount, 4);
  assert.equal(res.watchlistCount, 3);

  // MSFT should be quiet (omitted from alerts)
  const byTk = new Map(res.alerts.map((a) => [a.ticker, a]));
  assert.equal(byTk.has("MSFT"), false);

  // Breakout (NVDA)
  const nvda = byTk.get("NVDA");
  assert.equal(nvda.list, "PORT");
  assert.equal(nvda.tags.length, 1);
  assert.equal(nvda.tags[0].tone, "good");
  assert.match(nvda.tags[0].label, /^BO \(.*ZANGER.*SB4%.*\)$/);

  // Volume surge (VRT)
  const vrt = byTk.get("VRT");
  assert.equal(vrt.list, "PORT");
  assert.deepEqual(vrt.tags, [{ label: "VOL SURGE", tone: "good" }]);

  // Squatting (CLS)
  const cls = byTk.get("CLS");
  assert.equal(cls.list, "WATCH");
  assert.deepEqual(cls.tags, [{ label: "SQUATTING", tone: "warn" }]);

  // Heavy sell + ER TODAY (SMCI below 50MA)
  const smci = byTk.get("SMCI");
  assert.equal(smci.list, "PORT");
  assert.deepEqual(smci.tags, [
    { label: "HEAVY SELL", tone: "bad" },
    { label: "ER TODAY", tone: "warn" },
  ]);

  // Sharp pullback + ER 2d (META)
  const meta = byTk.get("META");
  assert.equal(meta.list, "WATCH");
  assert.deepEqual(meta.tags, [
    { label: "DOWN ≥3%", tone: "warn" },
    { label: "ER 2d", tone: "warn" },
  ]);

  // Quote-only heavy sell (QONLY)
  const qonly = byTk.get("QONLY");
  assert.equal(qonly.list, "WATCH");
  assert.equal(qonly.chg, -5.2);
  assert.deepEqual(qonly.tags, [{ label: "HEAVY SELL", tone: "bad" }]);

  // Severity order: bad (QONLY -5.2%, SMCI -4.0%) > good BO (NVDA) > warn (META -3.5%, CLS +1.5%) > rest (VRT +2.5%)
  assert.deepEqual(
    res.alerts.map((a) => a.ticker),
    ["QONLY", "SMCI", "NVDA", "META", "CLS", "VRT"]
  );
});

test("computeLivePortfolioPulse deduplicates PORT over WATCH and handles empty or quiet lists", () => {
  const afterClose = new Date("2026-11-23T22:00:00Z");
  const quotes = new Map([
    ["PLTR", { price: 47, previousClose: 50, change: -6.0, dayHigh: 50, dayLow: 46.8, volume: 20e6 }],
    ["AAPL", { price: 221, previousClose: 220, change: 0.45, dayHigh: 222, dayLow: 219.5, volume: 10e6 }],
  ]);

  const dedup = computeLivePortfolioPulse({
    portfolio: ["pltr", "PLTR"],
    watchlist: ["PLTR", "AAPL"],
    flagged: ["PLTR", "NVDA"],
    quotes,
    now: afterClose,
  });
  assert.equal(dedup.portfolioCount, 1);
  assert.equal(dedup.watchlistCount, 2);
  assert.equal(dedup.flaggedCount, 2);
  assert.equal(dedup.alerts.length, 1);
  assert.equal(dedup.alerts[0].ticker, "PLTR");
  assert.equal(dedup.alerts[0].list, "PORT");
  const pltrItem = dedup.items.find((x) => x.ticker === "PLTR");
  assert.equal(pltrItem.inPf, true);
  assert.equal(pltrItem.inWl, true);
  assert.equal(pltrItem.inFlag, true);
  const nvdaItem = dedup.items.find((x) => x.ticker === "NVDA");
  assert.equal(nvdaItem.list, "FLAG");
  assert.equal(nvdaItem.inFlag, true);

  // Quiet non-empty lists still return all portfolio, watchlist & flagged items
  const quiet = computeLivePortfolioPulse({
    portfolio: ["AAPL"],
    watchlist: ["MSFT"],
    flagged: ["NVDA"],
    quotes,
    now: afterClose,
  });
  assert.equal(quiet.alerts.length, 0);
  assert.equal(quiet.portfolioCount, 1);
  assert.equal(quiet.watchlistCount, 1);
  assert.equal(quiet.flaggedCount, 1);
  assert.equal(quiet.isLive, true);
  assert.deepEqual(quiet.items.map((x) => `${x.list}:${x.ticker}`), ["PORT:AAPL", "WATCH:MSFT", "FLAG:NVDA"]);
  assert.deepEqual(quiet.upcomingEarnings, []);

  // Completely empty lists
  const empty = computeLivePortfolioPulse();
  assert.deepEqual(empty, {
    items: [],
    alerts: [],
    upcomingEarnings: [],
    portfolioCount: 0,
    watchlistCount: 0,
    flaggedCount: 0,
    isLive: true,
  });
});
