import test from "node:test";
import assert from "node:assert/strict";
import { evalPivotStatus, matchMacroLive, collectBriefTickers, filterRecentHeadlines } from "../src/lead/briefLive.js";

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
