import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GOTO_PRESET,
  buildGoToBriefingAnalysis,
  detectCatalystDrivers,
  filterGoToCandidates,
} from "../src/lead/gotoAnalysis.js";
import { buildEmailHtml, buildMarkdown } from "../scripts/zanger-briefing.mjs";

test("filterGoToCandidates enforces Go-To default quality gates and theme exclusions", () => {
  const sample = [
    // Valid Cyber leader
    { ticker: "RPD", theme: "Cyber", layer: "Threat Operations", off52: -11, isFresh: true, avgDollarVol: 35e6, adr: 8.5, chg: 7.2, zvr: 3.2, cr: 97, rs: 93 },
    // Excluded theme (Utilities)
    { ticker: "NEE", theme: "Utilities", layer: "Power", off52: -4, isFresh: true, avgDollarVol: 250e6, adr: 4.0, chg: 3.0, zvr: 2.0, cr: 90, rs: 85 },
    // Healthcare excluded
    { ticker: "VRTX", theme: "Healthcare", layer: "Biotech", off52: -2, isFresh: true, avgDollarVol: 400e6, adr: 4.2, chg: 4.0, zvr: 2.0, cr: 88, rs: 88 },
    // Too thin (<$20M)
    { ticker: "THIN", theme: "Software", layer: "SaaS", off52: -5, isFresh: true, avgDollarVol: 8e6, adr: 6.0, chg: 6.0, zvr: 2.5, cr: 95, rs: 90 },
    // Slow ADR (<3.5%)
    { ticker: "SLOW", theme: "Software", layer: "Enterprise", off52: -3, isFresh: true, avgDollarVol: 500e6, adr: 1.8, chg: 1.5, zvr: 2.0, cr: 85, rs: 82 },
    // Extended (not fresh)
    { ticker: "EXT", theme: "Software", layer: "Cloud", off52: -1, isFresh: false, avgDollarVol: 100e6, adr: 6.0, chg: 5.0, zvr: 2.2, cr: 92, rs: 95 },
  ];

  const out = filterGoToCandidates(sample, { preset: DEFAULT_GOTO_PRESET });
  assert.deepEqual(out.map((r) => r.ticker), ["RPD"]);
});

test("buildGoToBriefingAnalysis ranks descending by grade, groups theme clusters, and synthesizes 'Why?'", () => {
  const now = new Date("2026-11-27T16:05:00-05:00");
  const allScored = [
    { ticker: "RPD", theme: "Cyber", layer: "Threat Operations", layerStatus: "lead", off52: -11, isFresh: true, emaStack: true, ppCount: 3, avgDollarVol: 35e6, adr: 8.5, chg: 7.2, fromOpen: 5.1, zvr: 3.2, cr: 97, rs: 93, breakoutTypes: ["ZANGER", "SB4%", "QMAG"], isBreakout: true, qualifiesZanger: true },
    { ticker: "S", theme: "Cyber", layer: "Platform + Endpoint", layerStatus: "lead", off52: -9, isFresh: true, emaStack: true, ppCount: 2, avgDollarVol: 250e6, adr: 6.2, chg: 5.0, fromOpen: 3.5, zvr: 2.1, cr: 96, rs: 92, breakoutTypes: ["ZANGER", "SB4%"], isBreakout: true, qualifiesZanger: true },
    { ticker: "QLYS", theme: "Cyber", layer: "Platform + Endpoint", layerStatus: "lead", off52: -8, isFresh: true, emaStack: true, ppCount: 2, avgDollarVol: 160e6, adr: 7.4, chg: 4.8, fromOpen: 3.0, zvr: 1.7, cr: 93, rs: 91, breakoutTypes: ["SB4%"], isBreakout: true, qualifiesZanger: true },
    { ticker: "MTCH", theme: "Internet", layer: "Streaming / Media", layerStatus: "lag", off52: -10, isFresh: true, emaStack: false, ppCount: 1, avgDollarVol: 155e6, adr: 3.6, chg: 3.5, fromOpen: 2.0, zvr: 4.5, cr: 82, rs: 74, breakoutTypes: ["SB$"], isBreakout: true, qualifiesZanger: true },
    { ticker: "PENN", theme: "Internet", layer: "Streaming / Media", layerStatus: "lag", off52: -12, isFresh: true, emaStack: true, ppCount: 0, avgDollarVol: 60e6, adr: 4.5, chg: -1.2, fromOpen: -1.5, zvr: 1.1, cr: 30, rs: 80, breakoutTypes: [], isBreakout: false, qualifiesZanger: false },
  ];

  const headlines = new Map([
    ["RPD", [{ title: "Rapid7 beats estimates and raises guidance on strong AI security demand", source: "Finviz", date: "Nov-26-26" }]],
    ["S", [{ title: "SentinelOne upgraded to Outperform after ransomware deal wins", source: "Benzinga", date: "Nov-27-26" }]],
    ["MTCH", [{ title: "Stale Q1 earnings blurb from months ago", source: "SeekingAlpha", date: "May-01-26" }]],
  ]);

  const analysis = buildGoToBriefingAnalysis({
    allScored,
    preset: DEFAULT_GOTO_PRESET,
    layers: [{ theme: "Cyber", name: "Platform + Endpoint", st: "lead", now: 92, w1: 86 }],
    themes: [{ theme: "Cyber", st: "lead", now: 92, w1: 86 }],
    headlines,
    now,
  });

  assert.equal(analysis.totalMatched, 5);
  assert.equal(analysis.leaders[0].ticker, "RPD");
  assert.equal(analysis.leaders[0].grade, "A+");
  // Descending grade/score order
  for (let i = 1; i < analysis.leaders.length; i++) {
    assert.ok(analysis.leaders[i - 1].aPlusScore >= analysis.leaders[i].aPlusScore);
  }
  // Cyber cluster leads with 3 A+/A names and detects fresh catalyst drivers
  const cyber = analysis.themeClusters[0];
  assert.equal(cyber.theme, "Cyber");
  assert.equal(cyber.count, 3);
  assert.equal(cyber.aPlusACount, 3);
  assert.match(cyber.why, /Platform \+ Endpoint \(2\)/);
  assert.match(cyber.why, /Leading rotation/i);
  assert.match(cyber.why, /earnings beats|analyst upgrades|AI \/ cloud \/ security demand/i);
  assert.equal(cyber.catalysts.length, 2);

  // Stale May headline on MTCH should be filtered out by <=14d freshness check
  const internet = analysis.themeClusters.find((c) => c.theme === "Internet");
  assert.equal(internet.catalysts.length, 0);

  // External AI narrative override works cleanly
  const withAi = buildGoToBriefingAnalysis({
    allScored,
    preset: DEFAULT_GOTO_PRESET,
    externalWhyByTheme: { Cyber: "AI custom synthesis: enterprise zero-trust budget flush." },
    now,
  });
  assert.equal(withAi.themeClusters[0].aiWhy, "AI custom synthesis: enterprise zero-trust budget flush.");

  // Appended to intraday/close Markdown & Email HTML, omitted for premarket
  const baseCtx = {
    stamp: { date: "2026-11-27", hhmm: "1605", hours: 16, minutes: 5, pretty: "Fri Nov 27 · 4:05 PM ET" },
    mode: "Test",
    clock: { session: "2026-11-27", rth: false },
    pipelineDate: "2026-11-27",
    leadingLayers: [],
    emergingLayers: [],
    zangerMovers: [],
    themeLeaders: [],
    headlines,
    market: {},
    goToAnalysis: analysis,
  };
  const closeMd = buildMarkdown({ ...baseCtx, phase: { id: "close", label: "CLOSING BELL WRAP", subtitle: "", accent: "#38bdf8" } });
  assert.match(closeMd, /Go-To Screen — Leading Tickers by Grade & Theme Clusters/);
  assert.match(closeMd, /\*\*Cyber \(3 names/);

  const closeHtml = buildEmailHtml({ ...baseCtx, phase: { id: "close", label: "CLOSING BELL WRAP", subtitle: "", accent: "#38bdf8" } });
  assert.match(closeHtml, /Go-To Screen: Theme Clusters &amp; Leading Tickers/);
  assert.match(closeHtml, /Open Go-To Screen/);

  const preMd = buildMarkdown({ ...baseCtx, phase: { id: "premarket", label: "PRE-MARKET BRIEF", subtitle: "", accent: "#fbbf24" } });
  assert.doesNotMatch(preMd, /Go-To Screen — Leading Tickers by Grade/);

  assert.ok(detectCatalystDrivers(["Company beats by $0.10 and raises guidance"]).includes("earnings beats"));
});
