#!/usr/bin/env node
// ThemePulse — Leading Stocks in Leading Themes + Dan Zanger Intraday Volume Movers
//
// Uses ThemePulse's own pure scoring engine (src/lead/math.js) over public/ data
// plus live intraday quotes/news/market-quality from https://themepulse.vercel.app.
//
// Usage:
//   node scripts/zanger-scan.mjs                       # live if TP_PIN set, else pipeline EOD fallback
//   node scripts/zanger-scan.mjs --offline             # skip network calls, use local pipeline JSON
//   node scripts/zanger-scan.mjs --no-write            # print report to stdout without writing reports/
//   node scripts/zanger-scan.mjs --json                # print structured JSON summary to stdout
//   node scripts/zanger-scan.mjs --market-hours-only   # exit 0 quietly outside Mon-Fri pre-market (08:20-09:10 ET) & RTH (09:55-16:25 ET) / NYSE holidays
//   node scripts/zanger-scan.mjs --email-out <dir>     # write email.html, email.txt, meta.json to <dir>
//   node scripts/zanger-scan.mjs --brief-out <dir>     # publish zanger-latest.json + zanger-index.json to <dir> (for Brief page)
//   node scripts/zanger-scan.mjs --state-file <path>   # track prior hourly breakouts for NEW / faded deltas
//   node scripts/zanger-scan.mjs --force-send          # set shouldSend=true even when 0 movers
//
// Env (optional, for live intraday quotes & headlines):
//   TP_PIN            ThemePulse PIN (read from env or .env.local)
//   TP_BASE_URL       Defaults to https://themepulse.vercel.app

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PEAK_LOOKBACK,
  classify,
  rankHeld,
  rankTrend,
  layerStats,
  layerConfirm,
  layerFlags,
  withEpsRating,
  computeTiers,
  pinReason,
  etClock,
  scoreZangerCandidate,
} from "../src/lead/math.js";
import { buildGoToBriefingAnalysis, DEFAULT_GOTO_PRESET } from "../src/lead/gotoAnalysis.js";
import { evalScanHits } from "../src/lead/scannerMath.js";
import {
  INDEX_META,
  getBriefingPhase,
  computeHourlyDelta,
  buildPortfolioAlerts,
  buildPortfolioEarnings,
  buildEpList,
  buildThemeFlow,
  buildLeaderDamage,
  buildOnDeckRsl,
  buildMarketSummary,
  buildEmailSubject,
  buildEmailHtml,
  buildMarkdown,
} from "./zanger-briefing.mjs";
import { filterRecentHeadlines } from "../src/lead/briefLive.js";

export {
  scoreZangerCandidate,
  getBriefingPhase,
  computeHourlyDelta,
  buildPortfolioAlerts,
  buildPortfolioEarnings,
  buildEpList,
  buildThemeFlow,
  buildLeaderDamage,
  buildOnDeckRsl,
  buildMarketSummary,
  buildEmailSubject,
  buildEmailHtml,
  buildMarkdown,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.TP_BASE_URL || "https://themepulse.vercel.app").replace(/\/$/, "");

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function readJson(rel) {
  const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

async function getToken() {
  if (process.env.TP_AUTH_TOKEN) return process.env.TP_AUTH_TOKEN;
  const pin = process.env.TP_PIN;
  if (!pin) return null;
  try {
    const r = await fetch(`${BASE_URL}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.ok && d.token ? d.token : null;
  } catch {
    return null;
  }
}

async function fetchLiveQuotes(tickers, token) {
  const map = new Map();
  if (!token || !tickers.length) return map;
  const unique = [...new Set(tickers)];
  for (let i = 0; i < unique.length; i += 450) {
    const chunk = unique.slice(i, i + 450);
    try {
      const r = await fetch(`${BASE_URL}/api/live?universe=${encodeURIComponent(chunk.join(","))}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      for (const q of d?.theme_universe || d?.universe || []) {
        if (q?.ticker) map.set(q.ticker, q);
      }
    } catch { /* partial failure ok */ }
  }
  return map;
}

async function fetchMarketQuality(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${BASE_URL}/api/market-quality`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.ok ? d : null;
  } catch {
    return null;
  }
}

async function fetchTickerHeadlines(tickers, token, now = new Date()) {
  const out = new Map();
  if (!token || !tickers.length) return out;
  await Promise.all(
    tickers.map(async (t) => {
      try {
        const r = await fetch(`${BASE_URL}/api/live?news=${encodeURIComponent(t)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) return;
        const d = await r.json();
        const raw = (d?.news || []).map((n) => ({
          title: n.title || n.headline || "",
          source: n.source || "",
          date: n.date || n.time || "",
          url: n.url || "",
        })).filter((n) => n.title);
        const items = filterRecentHeadlines(raw, now, 14).slice(0, 3);
        if (items.length) out.set(t, items);
      } catch { /* ignore */ }
    })
  );
  return out;
}

function formatEtStamp(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const p2 = (n) => String(n).padStart(2, "0");
  const date = `${et.getFullYear()}-${p2(et.getMonth() + 1)}-${p2(et.getDate())}`;
  const hhmm = `${p2(et.getHours())}${p2(et.getMinutes())}`;
  const pretty = `${date} ${p2(et.getHours())}:${p2(et.getMinutes())} ET`;
  return { date, hhmm, pretty, hours: et.getHours(), minutes: et.getMinutes(), day: et.getDay() };
}

function utcYmd(dt) {
  const p2 = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
}

function observedFixedHoliday(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dow = dt.getUTCDay();
  if (dow === 6) dt.setUTCDate(dt.getUTCDate() - 1);
  else if (dow === 0) dt.setUTCDate(dt.getUTCDate() + 1);
  return utcYmd(dt);
}

function nthWeekdayHoliday(year, month, weekday, n) {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return utcYmd(new Date(Date.UTC(year, month - 1, day)));
}

function lastWeekdayHoliday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - offset);
  return utcYmd(last);
}

function goodFridayHoliday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() - 2);
  return utcYmd(dt);
}

export function isUsMarketHoliday(etYmd) {
  if (!etYmd || typeof etYmd !== "string") return false;
  const year = Number(etYmd.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  const holidays = new Set([
    observedFixedHoliday(year, 1, 1),
    observedFixedHoliday(year + 1, 1, 1),
    nthWeekdayHoliday(year, 1, 1, 3),
    nthWeekdayHoliday(year, 2, 1, 3),
    goodFridayHoliday(year),
    lastWeekdayHoliday(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayHoliday(year, 9, 1, 1),
    nthWeekdayHoliday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ]);
  return holidays.has(etYmd);
}

// Trading-day email windows: Mon-Fri, non-holiday,
// pre-market brief (08:20-09:10 ET) and hourly RTH scans (09:55-16:25 ET).
export function isMarketScanWindow(now = new Date()) {
  const s = formatEtStamp(now);
  const mins = s.hours * 60 + s.minutes;
  if (s.day === 0 || s.day === 6) return { open: false, reason: "weekend", et: s.pretty, date: s.date };
  if (isUsMarketHoliday(s.date)) return { open: false, reason: "us_market_holiday", et: s.pretty, date: s.date };
  if (mins >= 500 && mins <= 550) return { open: true, reason: "premarket_window", et: s.pretty, date: s.date };
  if (mins >= 595 && mins <= 985) return { open: true, reason: "rth_window", et: s.pretty, date: s.date };
  return { open: false, reason: "outside_market_hours", et: s.pretty, date: s.date };
}

export async function runZangerScan({ offline = false, write = true, now = new Date(), stateFile = null } = {}) {
  loadEnvLocal();
  const dash = readJson("public/dashboard_data.json");
  const rot = readJson("public/data/rs_rotation.json");
  const hist = readJson("public/data/rank_history.json") || {};
  const chain = readJson("public/data/chain_layers.json") || [];
  const lb = readJson("public/data/layer_breadth.json") || {};
  const profiles = readJson("public/data/rvol_profiles.json") || null;
  const monitor = readJson("public/market_monitor.json") || null;
  const prevState = stateFile ? readJson(stateFile) : null;

  if (!dash?.stocks || !rot?.layers) {
    throw new Error("Missing public/dashboard_data.json or public/data/rs_rotation.json");
  }

  const rawMap = {};
  for (const s of dash.stocks) {
    if (s?.ticker) rawMap[s.ticker] = s;
  }
  const hlMap = dash.headlines || {};
  for (const [t, v] of Object.entries(hlMap)) {
    if (rawMap[t] && Array.isArray(v?.headlines)) {
      rawMap[t]._newsPipe = filterRecentHeadlines(v.headlines, now, 14).slice(0, 3);
    }
  }
  const stockMap = withEpsRating(rawMap);

  const members = {};
  for (const c of Array.isArray(chain) ? chain : []) {
    members[`${c.themeId}|${c.layer}`] = c.tickers || [];
  }

  const dates = Object.keys(hist).sort();
  const peakDates = dates.slice(-PEAK_LOOKBACK);
  const layers = rot.layers.map((l) => {
    const key = `${l.themeId}|${l.name}`;
    const tks = members[key] || (l.holds || []).map((x) => x.t);
    const ph = peakDates.map((d) => hist?.[d]?.layers?.[key] ?? null);
    const { st, peak } = classify(l, ph.length ? ph : [l.now, l.w1, l.m1]);
    const stats = layerStats(tks, stockMap);
    const conf = layerConfirm(lb?.layers?.[key]);
    const held = rankHeld(ph);
    const trend = rankTrend(ph);
    const row = { ...l, key, tks, st, peak, stats, conf, held, trend };
    row.flags = layerFlags(row);
    return row;
  });

  const tickerLayer = {};
  const stPri = { lead: 3, emerg: 2, weak: 1, lag: 0, brk: -1 };
  for (const l of layers) {
    for (const t of l.tks) {
      const prev = tickerLayer[t];
      if (!prev || stPri[l.st] > stPri[prev.st] || (stPri[l.st] === stPri[prev.st] && l.now > prev.now)) {
        tickerLayer[t] = l;
      }
    }
  }

  const tiers = computeTiers(stockMap, tickerLayer);
  const leadingLayers = layers.filter((l) => l.st === "lead").sort((a, b) => b.now - a.now);
  const emergingLayers = layers
    .filter((l) => l.st === "emerg" && (l.conf?.passed?.length ?? 0) >= 2)
    .sort((a, b) => b.now - a.now);

  // Build candidate pool: liquid above-50d names in leading/emerging layers + RS>=70 + Go-To candidates + prior-hour breakouts
  const poolSet = new Set();
  for (const [t, s] of Object.entries(stockMap)) {
    if (!(s.close > 0) || pinReason(s)) continue;
    const l = tickerLayer[t];
    if ((s.avg_dollar_vol_raw ?? 0) >= 20e6 && s.above_50ma) {
      if (tiers.leaders.has(t) || tiers.emerging.has(t) || (s.rs_rank ?? 0) >= 70 || l?.st === "lead" || l?.st === "emerg") {
        poolSet.add(t);
      }
    }
    if (
      (s.avg_dollar_vol_raw ?? 0) >= DEFAULT_GOTO_PRESET.minDollarVol &&
      (s.off_52w_high ?? -99) >= -15 &&
      (s.adr20 ?? s.adr_pct ?? 0) >= DEFAULT_GOTO_PRESET.minAdr
    ) {
      poolSet.add(t);
    }
  }
  for (const t of prevState?.seenBreakouts || []) {
    if (stockMap[t]) poolSet.add(t);
  }

  let liveQuotes = new Map();
  let mq = null;
  let token = null;
  let mode = "Pipeline EOD (offline)";
  if (!offline) {
    token = await getToken();
    if (token) {
      const quoteList = [...poolSet, ...INDEX_META.map(([t]) => t)];
      [liveQuotes, mq] = await Promise.all([
        fetchLiveQuotes(quoteList, token),
        fetchMarketQuality(token),
      ]);
      mode = liveQuotes.size > 0
        ? `Live Intraday (${liveQuotes.size} quotes from ${BASE_URL})`
        : "Pipeline EOD (live endpoint returned 0 quotes)";
    } else {
      mode = "Pipeline EOD (set TP_PIN in env/.env.local for live intraday quotes)";
    }
  }

  const scored = [];
  const allUnfilteredScored = [];
  const scoredMap = new Map();
  for (const t of poolSet) {
    const s = stockMap[t];
    const q = liveQuotes.get(t) || null;
    const layer = tickerLayer[t] || null;
    const tier = tiers.leaders.has(t) ? "lead" : tiers.emerging.has(t) ? "emerg" : null;
    const full = scoreZangerCandidate({ s, q, layer, tier, profiles, now, unfiltered: true });
    if (full) {
      full.inAdr5Liq = Boolean(evalScanHits(s, q, full.zvr)?.adr5liq);
      allUnfilteredScored.push(full);
      if (full.inCoreBase) {
        scored.push(full);
        scoredMap.set(t, full);
      }
    }
  }

  const rawMovers = scored
    .filter((r) => r.qualifiesZanger)
    .sort((a, b) => (b.breakoutTypes?.length || 0) - (a.breakoutTypes?.length || 0) || b.score - a.score);

  const stamp = formatEtStamp(now);
  const clock = etClock(now);
  const phase = getBriefingPhase(stamp);

  // Compute hourly delta (NEW breakouts, faded/squatted breakouts, hold rate)
  const delta = computeHourlyDelta({
    prevState,
    today: stamp.date,
    zangerMovers: rawMovers,
    scoredMap,
    liveQuotes,
  });

  // Sort NEW breakouts near the top while preserving confluence & score ranking
  const zangerMovers = [...delta.enrichedMovers].sort(
    (a, b) =>
      Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)) ||
      (b.breakoutTypes?.length || 0) - (a.breakoutTypes?.length || 0) ||
      b.score - a.score
  );

  const themeLeaders = scored
    .filter((r) => r.tier === "lead" && r.layerStatus === "lead")
    .sort((a, b) => b.rs - a.rs || (b.eps ?? 0) - (a.eps ?? 0) || (b.zvr ?? 0) - (a.zvr ?? 0));

  const portfolioAlerts = buildPortfolioAlerts({ mq, stockMap, liveQuotes, scoredMap });
  const portfolioEarnings = buildPortfolioEarnings({ mq, stockMap });
  const epMovers = buildEpList({ mq, dash });
  const themeFlow = buildThemeFlow({ stockMap, tickerLayer, liveQuotes, zangerMovers });
  const leaderDamage = buildLeaderDamage({ scored, layers });
  const onDeckRsl = buildOnDeckRsl({ scored });
  const market = buildMarketSummary({
    mq,
    monitor,
    liveQuotes,
    dashStocks: dash.stocks,
    zangerMovers,
    delta,
    leaderDamage,
  });

  // Preliminary Go-To analysis (intraday & closing-bell post-market phases) to identify cluster leaders for news enrichment
  const goToPrelim = phase.id !== "premarket"
    ? buildGoToBriefingAnalysis({
        allScored: allUnfilteredScored,
        preset: DEFAULT_GOTO_PRESET,
        stockMap,
        tickerLayer,
        layers,
        now,
      })
    : null;

  const newsTickers = [
    ...new Set([
      ...zangerMovers.slice(0, 8).map((m) => m.ticker),
      ...(goToPrelim?.newsTargets || []),
    ]),
  ].slice(0, 18);

  const headlines = token && newsTickers.length
    ? await fetchTickerHeadlines(newsTickers, token, now)
    : new Map();

  const goToAnalysis = phase.id !== "premarket"
    ? buildGoToBriefingAnalysis({
        allScored: allUnfilteredScored,
        preset: DEFAULT_GOTO_PRESET,
        stockMap,
        tickerLayer,
        layers,
        headlines,
        now,
      })
    : null;

  const scanCtx = {
    stamp,
    mode,
    clock,
    pipelineDate: dash.date,
    leadingLayers,
    emergingLayers,
    zangerMovers,
    themeLeaders,
    headlines,
    market,
    phase,
    delta,
    portfolioAlerts,
    portfolioEarnings,
    epMovers,
    themeFlow,
    leaderDamage,
    onDeckRsl,
    goToAnalysis,
  };
  const markdown = buildMarkdown(scanCtx);
  const emailSubject = buildEmailSubject(scanCtx);
  const emailHtml = buildEmailHtml(scanCtx, { baseUrl: BASE_URL });

  if (stateFile) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(delta.nextState, null, 2), "utf8");
  }

  let reportPath = null;
  if (write) {
    const reportsDir = path.join(ROOT, "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    reportPath = path.join(reportsDir, `zanger-${stamp.date}-${stamp.hhmm}-ET.md`);
    fs.writeFileSync(reportPath, markdown, "utf8");
    fs.writeFileSync(path.join(reportsDir, "latest.md"), markdown, "utf8");
  }

  return {
    stamp,
    clock,
    mode,
    phase,
    pipelineDate: dash.date,
    reportPath,
    market,
    delta: {
      hasPriorState: delta.hasPriorState,
      newBreakoutCount: delta.newBreakouts.length,
      fadedCount: delta.fadedBreakouts.length,
      fadedBreakouts: delta.fadedBreakouts,
      holdRate: delta.holdRate,
    },
    portfolioAlerts,
    portfolioEarnings,
    epMovers,
    themeFlow,
    leaderDamage,
    onDeckRsl,
    goToAnalysis,
    headlines: Object.fromEntries(headlines),
    leadingLayers: leadingLayers.map((l) => ({ theme: l.theme, layer: l.name, st: l.st, rank: l.now, w1: l.w1, m1: l.m1, flags: l.flags.map(([k]) => k) })),
    emergingLayers: emergingLayers.map((l) => ({ theme: l.theme, layer: l.name, st: l.st, rank: l.now, w1: l.w1, m1: l.m1, flags: l.flags.map(([k]) => k) })),
    zangerMovers: zangerMovers.slice(0, 25),
    themeLeaders: themeLeaders.slice(0, 25),
    breakoutCount: zangerMovers.filter((m) => m.isBreakout).length,
    moverCount: zangerMovers.length,
    emailSubject,
    emailHtml,
    markdown,
  };
}

const MAX_ZANGER_BRIEFS = 16;

export function buildZangerBriefSnapshot(res) {
  const id = `zanger-${res.stamp.date}-${res.stamp.hhmm}`;
  return {
    id,
    generatedAt: new Date().toISOString(),
    stamp: res.stamp,
    clock: res.clock,
    mode: res.mode,
    phase: res.phase,
    pipelineDate: res.pipelineDate,
    subject: res.emailSubject,
    breakoutCount: res.breakoutCount,
    moverCount: res.moverCount,
    market: res.market,
    delta: res.delta,
    portfolioAlerts: res.portfolioAlerts,
    portfolioEarnings: res.portfolioEarnings,
    epMovers: res.epMovers,
    themeFlow: res.themeFlow,
    leaderDamage: res.leaderDamage,
    onDeckRsl: res.onDeckRsl,
    goToAnalysis: res.goToAnalysis || null,
    headlines: res.headlines || {},
    leadingLayers: res.leadingLayers,
    emergingLayers: res.emergingLayers,
    zangerMovers: res.zangerMovers,
  };
}

function writeZangerBriefOut(dir, res) {
  fs.mkdirSync(dir, { recursive: true });
  const snap = buildZangerBriefSnapshot(res);
  const file = `${snap.id}.json`;
  const idxPath = path.join(dir, "zanger-index.json");
  const prevIdx = readJson(idxPath) || { latest: null, briefs: [] };
  const entry = {
    id: snap.id,
    file,
    date: snap.stamp.date,
    et: snap.stamp.pretty,
    phase: snap.phase?.id || "midday",
    label: `${snap.stamp.pretty} · ${snap.phase?.label || "UPDATE"}`,
    subject: snap.subject,
    breakoutCount: snap.breakoutCount,
    moverCount: snap.moverCount,
    decision: snap.market?.decision || null,
    score: snap.market?.score ?? null,
  };

  const merged = [entry, ...(prevIdx.briefs || []).filter((b) => b?.id !== snap.id)];
  const kept = merged.slice(0, MAX_ZANGER_BRIEFS);
  const dropped = merged.slice(MAX_ZANGER_BRIEFS);

  fs.writeFileSync(path.join(dir, file), JSON.stringify(snap, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "zanger-latest.json"), JSON.stringify(snap, null, 2), "utf8");
  fs.writeFileSync(idxPath, JSON.stringify({ latest: file, briefs: kept }, null, 2), "utf8");

  for (const old of dropped) {
    if (old?.file && /^zanger-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(old.file)) {
      try { fs.unlinkSync(path.join(dir, old.file)); } catch { /* ignore */ }
    }
  }
  return { file, count: kept.length };
}

function parseCliArgs(argv) {
  const flags = new Set();
  let emailOut = null;
  let briefOut = null;
  let stateFile = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email-out" && argv[i + 1]) emailOut = argv[++i];
    else if (a.startsWith("--email-out=")) emailOut = a.slice("--email-out=".length);
    else if (a === "--brief-out" && argv[i + 1]) briefOut = argv[++i];
    else if (a.startsWith("--brief-out=")) briefOut = a.slice("--brief-out=".length);
    else if (a === "--state-file" && argv[i + 1]) stateFile = argv[++i];
    else if (a.startsWith("--state-file=")) stateFile = a.slice("--state-file=".length);
    else flags.add(a);
  }
  return { flags, emailOut, briefOut, stateFile };
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { flags, emailOut, briefOut, stateFile } = parseCliArgs(process.argv.slice(2));
  const forceSend = flags.has("--force-send");

  if (flags.has("--market-hours-only") && !forceSend) {
    const win = isMarketScanWindow(new Date());
    if (!win.open) {
      console.error(`Skipping scan (${win.reason} at ${win.et}).`);
      if (emailOut) {
        fs.mkdirSync(emailOut, { recursive: true });
        fs.writeFileSync(
          path.join(emailOut, "meta.json"),
          JSON.stringify({ shouldSend: false, reason: win.reason, subject: "", breakoutCount: 0, moverCount: 0, et: win.et }, null, 2),
          "utf8"
        );
      }
      process.exit(0);
    }
  }

  const res = await runZangerScan({
    offline: flags.has("--offline"),
    write: !flags.has("--no-write"),
    stateFile,
  });

  if (briefOut) {
    const info = writeZangerBriefOut(briefOut, res);
    console.error(`Published Zanger brief to ${briefOut}/${info.file} (${info.count} snapshots indexed)`);
  }

  if (emailOut) {
    fs.mkdirSync(emailOut, { recursive: true });
    const hasPortAlerts = (res.portfolioAlerts?.alerts?.length || 0) > 0;
    const hasDamage = (res.leaderDamage?.damagedLeaders?.length || 0) > 0;
    const isPremarket = res.phase?.id === "premarket";
    const isCloseWrap = res.phase?.id === "close";
    const shouldSend = forceSend || isPremarket || res.moverCount > 0 || hasPortAlerts || hasDamage || isCloseWrap;
    const reason = isPremarket
      ? "premarket_brief"
      : res.moverCount > 0
        ? "movers_found"
        : hasPortAlerts
          ? "portfolio_alerts"
          : hasDamage
            ? "leader_damage"
            : isCloseWrap
              ? "closing_bell_wrap"
              : forceSend
                ? "forced"
                : "quiet_hour";

    fs.writeFileSync(path.join(emailOut, "email.html"), res.emailHtml, "utf8");
    fs.writeFileSync(path.join(emailOut, "email.txt"), res.markdown, "utf8");
    fs.writeFileSync(
      path.join(emailOut, "meta.json"),
      JSON.stringify({
        shouldSend,
        reason,
        phase: res.phase?.id,
        subject: res.emailSubject,
        breakoutCount: res.breakoutCount,
        newBreakoutCount: res.delta?.newBreakoutCount || 0,
        moverCount: res.moverCount,
        portfolioAlerts: res.portfolioAlerts?.alerts?.length || 0,
        portfolioEarnings: res.portfolioEarnings?.length || 0,
        damagedLeaders: res.leaderDamage?.damagedLeaders?.length || 0,
        et: res.stamp.pretty,
      }, null, 2),
      "utf8"
    );
    console.error(
      `Email bundle written to ${emailOut} (shouldSend=${shouldSend}, reason=${reason}, phase=${res.phase?.id}, movers=${res.moverCount}, breakouts=${res.breakoutCount}, new=${res.delta?.newBreakoutCount || 0})`
    );
  }

  if (flags.has("--json")) {
    console.log(JSON.stringify({ ...res, markdown: undefined, emailHtml: undefined }, null, 2));
  } else {
    console.log(res.markdown);
    if (res.reportPath) console.error(`\nSaved report: ${res.reportPath}`);
  }
}
