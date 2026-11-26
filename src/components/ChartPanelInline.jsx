// ──────────────────────────────────────────────────────────────────────────
// ChartPanelInline — ticker chart header, CANSLIM/TT stats bar, inline
// DailyChartSVG, company info & news, earnings history, risk sizing, and
// quarterly/annual fundamentals EarningsBox.
// ──────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { authFetch } from "../utils.js";
import { useAriaTheme } from "../themeContext.js";
import { useLocalStorageList } from "../hooks/useUserData.js";
import { useLiveQuotes } from "../hooks/useLiveQuotes.js";
import { zvrFor, useRvolProfiles, useJson, TierMark } from "../LeadershipView.jsx";
import { classifyWeinsteinStage, classifyWeinsteinStageFromBars, computeEmaAtrExtensions } from "../lead/math.js";
import { analyze30mPivot } from "../lead/pivot30mMath.js";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { DailyChartSVG } from "./DailyChartSVG.jsx";
import { EarningsBox } from "./EarningsBox.jsx";

const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

// ── Minervini Trend Template helpers — 7 price criteria arrive from the
// pipeline as a bitmask (tt_mask); the 8th (RS rank ≥ 70) is applied here
// where the cross-sectional rank lives. ttCount → 0-8 or null (no data yet).
const TT_LABELS = [
  "price > 150d & 200d MAs", "150d MA > 200d MA", "200d MA rising ≥1 month",
  "50d > 150d > 200d", "price > 50d MA", "≥30% above 52w low",
  "within 25% of 52w high", "RS rank ≥ 70",
];
export function ttCount(s) {
  if (s?.tt_mask == null) return null;
  let n = 0;
  for (let i = 0; i < 7; i++) if (s.tt_mask & (1 << i)) n++;
  return n + ((s.rs_rank || 0) >= 70 ? 1 : 0);
}
export function ttFails(s) {
  const out = [];
  for (let i = 0; i < 7; i++) if (!(s?.tt_mask & (1 << i))) out.push(TT_LABELS[i]);
  if ((s?.rs_rank || 0) < 70) out.push(TT_LABELS[7]);
  return out;
}

function useRsRotation() { return useJson("/data/rs_rotation.json"); }
// ── useChainLayers: shares useJson's in-memory cache with LeadershipView ──
function useChainLayers() { return useJson("/data/chain_layers.json"); }

// Aria-style colored mini-badge (used in chart header for 9M / VOL / HI / Grade)
const badgeStyle = (color) => ({
  fontSize: 10,
  fontFamily: MONO,
  padding: "0 4px",
  borderRadius: 3,
  fontWeight: 700,
  color,
  border: `1px solid ${color}`,
  background: `${color}26`,
  marginLeft: 3,
});


// ── CANSLIM scorecard helpers ──
// gradeBand maps a numeric value to a letter using descending thresholds
// [A+, A, B, C, D]. Anything below D → F; null/NaN → "—".
const CANSLIM_LETTERS = ["A+", "A", "B", "C", "D", "F"];
function gradeBand(v, t) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= t[0]) return "A+";
  if (v >= t[1]) return "A";
  if (v >= t[2]) return "B";
  if (v >= t[3]) return "C";
  if (v >= t[4]) return "D";
  return "F";
}
function avgLetter(grades) {
  const ord = { "A+": 5, A: 4, B: 3, C: 2, D: 1, F: 0 };
  const nums = grades.map((g) => ord[g]).filter((n) => n != null);
  if (nums.length === 0) return "—";
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const idx = Math.max(0, Math.min(5, 5 - Math.round(avg)));
  return CANSLIM_LETTERS[idx];
}
// Compact CANSLIM composite (letter A+..F) from synchronously-available
// fields — same gradeBand thresholds as the full IBD scorecard, dropping
// the async 12mo-RS and CF-vs-EPS criteria. Used in the chart panel's perf bar.
export function canslimComposite(stockInfo, annuals, stockMap) {
  if (!stockInfo) return "—";
  const epsYoy = stockInfo.eps_yoy ?? null;
  const epsYoyPrev = stockInfo.eps_yoy_prev ?? null;
  const accel = (epsYoy != null && epsYoyPrev != null) ? epsYoy - epsYoyPrev : null;
  let eps5y = null;
  const tryW = (n) => {
    if (!Array.isArray(annuals) || annuals.length < n) return null;
    const a = annuals.slice(-n); const f = a[0]?.eps, l = a[a.length - 1]?.eps;
    if (f == null || l == null || f <= 0 || l <= 0) return null;
    return (Math.pow(l / f, 1 / (a.length - 1)) - 1) * 100;
  };
  for (const n of [5, 4, 3]) { const v = tryW(n); if (v != null) { eps5y = v; break; } }
  if (eps5y == null) eps5y = stockInfo.eps_past_5y ?? null;
  const salesYoy = stockInfo.sales_yoy ?? null;
  const margin = (() => { const m = stockInfo.profit_margin ?? null; return m != null ? (m < 1 ? m * 100 : m) : null; })();
  const roe = (() => { const r = stockInfo.roe ?? null; return r != null ? (Math.abs(r) < 5 ? r * 100 : r) : null; })();
  const instTrans = stockInfo.inst_trans_pct ?? null;
  const pctFromHigh = stockInfo.pct_from_high ?? stockInfo.off_52w_high ?? null;
  const distFromHigh = pctFromHigh != null ? Math.abs(pctFromHigh) : null;
  let industryPct = null;
  const industry = stockInfo.industry, myRs = stockInfo.rs_rank;
  if (industry && myRs != null && stockMap) {
    const peers = Object.values(stockMap).filter((s) => s && s.industry === industry && s.rs_rank != null);
    if (peers.length >= 3) { const better = peers.filter((s) => s.rs_rank > myRs).length; industryPct = Math.round((1 - better / peers.length) * 100); }
  }
  return avgLetter([
    gradeBand(epsYoy, [100, 50, 25, 10, 0]),
    gradeBand(accel, [30, 10, 0, -10, -25]),
    gradeBand(eps5y, [40, 25, 15, 10, 0]),
    gradeBand(salesYoy, [40, 25, 15, 10, 0]),
    gradeBand(margin, [25, 18, 12, 7, 2]),
    gradeBand(roe, [30, 17, 12, 8, 0]),
    gradeBand(instTrans, [2, 1, 0.3, 0, -1]),
    gradeBand(distFromHigh != null ? -distFromHigh : null, [-3, -10, -20, -35, -50]),
    gradeBand(industryPct, [95, 85, 70, 50, 30]),
  ]);
}

// Wilder's smoothed ATR — identical to ThinkScript ta.atr / Pine ta.atr.
export function calcWilderATR(bars, period = 14) {
  if (!bars || bars.length < period) return null;
  const tr = bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))
  );
  let atr = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) atr = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
    else atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

// Risk position-sizing — port of ThinkScript calc_size().
export function calcRiskSize(stopPrice, entryPrice, accountSize, riskPct, maxAllocPct) {
  const dist = entryPrice - stopPrice;
  if (dist <= 0 || entryPrice <= 0) return null;
  const riskUsd = accountSize * (riskPct / 100);
  const maxPosUsd = accountSize * (maxAllocPct / 100);
  const distPct = (dist / entryPrice) * 100;
  const rawShares = Math.floor(riskUsd / dist);
  const rawInvested = rawShares * entryPrice;
  const capped = rawInvested > maxPosUsd;
  const finalShares = capped ? Math.floor(maxPosUsd / entryPrice) : rawShares;
  const actInvested = finalShares * entryPrice;
  const actRisk = finalShares * dist;
  const investedPct = (actInvested / accountSize) * 100;
  return { shares: finalShares, risk: actRisk, investedPct, capped, distPct, stopPrice };
}

const _tickerNewsCache = new Map();
const _tickerOhlcCache = new Map();
const _tickerEarningsCache = new Map();
const TICKER_CACHE_TTL_MS = 5 * 60 * 1000;
const INTRADAY_CACHE_TTL_MS = 45 * 1000;
const TICKER_DEBOUNCE_MS = 120;
function _ttlGet(map, key, ttlMs = TICKER_CACHE_TTL_MS) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ttlMs) { map.delete(key); return null; }
  return hit.data;
}
function _ttlSet(map, key, data) {
  if (map.size > 150) map.delete(map.keys().next().value);
  map.set(key, { ts: Date.now(), data });
}

export function ChartPanelInline({
  ticker,
  onTickerChange,
  height = 580,
  stockMap,
}) {
  const ARIA = useAriaTheme();
  // layer membership chips (chain_layers.json — same file the RS Rotation Layers tab uses)
  const chainLayers = useChainLayers();
  const tickerLayers = useMemo(
    () => (chainLayers || []).filter((e) => Array.isArray(e.tickers) && e.tickers.includes(ticker)),
    [chainLayers, ticker]
  );
  const [tf, setTf] = useState(() => {
    try {
      const saved = localStorage.getItem("themepulse-chart-tf");
      return saved === "30m" || saved === "D" || saved === "W" ? saved : "D";
    } catch {
      return "D";
    }
  });
  const [showCpr, setShowCpr] = useState(false);
  useEffect(() => {
    const onChartTf = (e) => {
      const next = e?.detail;
      if (next === "30m" || next === "D" || next === "W") {
        setTf(next);
        try { localStorage.setItem("themepulse-chart-tf", next); } catch {}
      }
    };
    window.addEventListener("tp-chart-tf", onChartTf);
    return () => window.removeEventListener("tp-chart-tf", onChartTf);
  }, []);
  const [tickerInput, setTickerInput] = useState("");
  const tickerInputRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      if (!tickerInputRef.current) return;
      e.preventDefault();
      tickerInputRef.current.focus();
      tickerInputRef.current.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // EPS + Revenue bars below the CANSLIM stats row.
  //   quarters: quarterly bars (Finviz FactSet → FMP fallback)
  //   annuals:  annual bars (FMP only)
  const [quarters, setQuarters] = useState([]);
  const [annuals, setAnnuals] = useState([]);
  const [news, setNews] = useState([]);
  const [newsOpen, setNewsOpen] = useState(true);
  const [description, setDescription] = useState("");
  const [liveEarningsDate, setLiveEarningsDate] = useState(null);
  const [ohlcState, setOhlcState] = useState({ bars: [], interval: "1d" });
  const [showTrade, setShowTrade] = useState(false);
  const [tradeSettings, setTradeSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("themepulse-risk-settings") || "null") ||
      { accountSize: 300000, riskPct: 1.0, maxAllocPct: 25.0, atrLen: 14 }; }
    catch { return { accountSize: 300000, riskPct: 1.0, maxAllocPct: 25.0, atrLen: 14 }; }
  });
  useEffect(() => {
    try { localStorage.setItem("themepulse-risk-settings", JSON.stringify(tradeSettings)); } catch {}
  }, [tradeSettings]);
  useEffect(() => {
    if (!ticker) return;
    const orient = (arr) => {
      if (!Array.isArray(arr) || arr.length <= 1) return arr || [];
      return arr[0].year > arr[arr.length - 1].year ? arr.slice().reverse() : arr;
    };
    const apply = (d) => {
      setQuarters(orient(d?.finvizQuarters));
      setAnnuals(orient(d?.finvizAnnual));
      setNews(d?.news || []);
      setDescription(d?.description || "");
      setLiveEarningsDate(d?.earningsDate || null);
    };
    const cached = _ttlGet(_tickerNewsCache, ticker);
    if (cached) { apply(cached); return; }
    setLiveEarningsDate(null);
    const ac = new AbortController();
    const tid = setTimeout(() => {
      authFetch(`/api/live?news=${encodeURIComponent(ticker)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (ac.signal.aborted) return;
          if (d) _ttlSet(_tickerNewsCache, ticker, d);
          apply(d);
        })
        .catch(() => {
          if (!ac.signal.aborted) {
            setQuarters([]);
            setAnnuals([]);
            setNews([]);
            setDescription("");
          }
        });
    }, TICKER_DEBOUNCE_MS);
    return () => { clearTimeout(tid); ac.abort(); };
  }, [ticker]);

  // Fetch OHLC bars for inline SVG chart (30m / 1d / 1wk)
  const activeInterval = tf === "30m" ? "30m" : tf === "W" ? "1wk" : "1d";
  useEffect(() => {
    if (!ticker) return;
    const interval = activeInterval;
    const key = `${ticker}:${interval}`;
    const ttl = interval === "30m" ? INTRADAY_CACHE_TTL_MS : TICKER_CACHE_TTL_MS;
    const cached = _ttlGet(_tickerOhlcCache, key, ttl);
    if (cached) { setOhlcState({ bars: cached, interval }); return; }
    const ac = new AbortController();
    const tid = setTimeout(() => {
      authFetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}&interval=${interval}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (ac.signal.aborted || !d?.ohlc) return;
          _ttlSet(_tickerOhlcCache, key, d.ohlc);
          setOhlcState({ bars: d.ohlc, interval });
        })
        .catch(() => {});
    }, TICKER_DEBOUNCE_MS);
    return () => { clearTimeout(tid); ac.abort(); };
  }, [ticker, activeInterval]);
  const ohlcBars = useMemo(
    () => (ohlcState.interval === activeInterval ? ohlcState.bars : []),
    [ohlcState, activeInterval]
  );
  // Right pane subtab: 'chart' (intraday OHLC) or 'picks' (agent picks list)

  // Draggable split between daily (left) and intraday (right) panes.
  // Stored as a 0..1 fraction of the chart body width assigned to the LEFT.
  // Default 0.55 ≈ Aria's flex 6/(6+5).


  // Live quote for the active ticker — drives the OHLC + RVol header line
  const tickerList = useMemo(() => (ticker ? [ticker] : []), [ticker]);
  const { quotes } = useLiveQuotes(tickerList, 30000);
  const liveQuote = quotes.get(ticker);
  const stockInfo = useMemo(() => stockMap?.[ticker] || {}, [stockMap, ticker]);
  const avgVol = stockInfo.avg_volume_raw || 0;

  // Aria-faithful OHLC line: O H L C +chg ($abs+%) Vol RV + badges
  const o = liveQuote?.open ?? 0;
  const l = liveQuote?.low ?? 0;
  const c = liveQuote?.price ?? 0;
  const chgPct = liveQuote?.change ?? null;
  const liveVol = liveQuote?.volume || 0;
  const rvol = liveVol && avgVol > 0 ? Math.round((liveVol / avgVol) * 100) / 100 : null;
  const rvolProfiles = useRvolProfiles();
  const zvr = zvrFor(stockInfo.ticker ? stockInfo : { ...stockInfo, ticker }, liveQuote, rvolProfiles);
  const fromOpenPct = o > 0 && c > 0 ? (c / o - 1) * 100 : null;

  // 9M badge: today's volume >= 8.9M but avg < 8.9M (unusual institutional)
  const todayVol = avgVol * (rvol || 0);
  const has9M = todayVol >= 8_900_000 && avgVol < 8_900_000;
  const fromHi = stockInfo.off_52w_high;
  const grade = stockInfo.grade || "";
  const gradeColor =
    grade && grade[0] === "A" ? ARIA.green : grade && grade[0] === "B" ? ARIA.blue : ARIA.textMuted;

  const adr = stockInfo.adr_pct ?? null;
  // Prefer live FMP earnings date over pipeline's stale earnings_days
  const { erDaysRaw, erTimingRaw } = useMemo(() => {
    if (liveEarningsDate?.date) {
      const todayUTC = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
      const erDate = new Date(`${liveEarningsDate.date}T00:00:00Z`);
      const diffDays = Math.round((erDate - todayUTC) / 86400000);
      const timing = (liveEarningsDate.time || stockInfo.er_timing || "").toUpperCase();
      return { erDaysRaw: diffDays, erTimingRaw: timing };
    }
    return { erDaysRaw: stockInfo.earnings_days ?? null, erTimingRaw: stockInfo.er_timing || "" };
  }, [liveEarningsDate, stockInfo.earnings_days, stockInfo.er_timing]);
  const erCountdown = erDaysRaw != null
    ? (erDaysRaw === 0 ? "TODAY" : erDaysRaw > 0 ? `${erDaysRaw}d` : `${-erDaysRaw}d ago`)
    : "";
  // Next earnings DATE (formatted) + countdown for the thin header bar.
  const nextErDisp = useMemo(() => {
    const raw = liveEarningsDate?.date || stockInfo.earnings_display || null;
    if (!raw) return erCountdown || "";
    const d = new Date(`${raw}T00:00:00Z`);
    const dateStr = isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return erCountdown ? `${dateStr} (${erCountdown})` : dateStr;
  }, [liveEarningsDate, stockInfo.earnings_display, erCountdown]);

  // Layer-regime RS score (holds `s` from rs_rotation.json) — the exact value
  // the LAYER REGIME box shows, distinct from rs_rank. Map ticker -> max s.
  const rsRotation = useRsRotation();
  const rsScoreMap = useMemo(() => {
    const m = new Map();
    (rsRotation?.layers || []).forEach((l) => (l.holds || []).forEach((h) => {
      if (h?.t == null || h.s == null) return;
      if (!m.has(h.t) || h.s > m.get(h.t)) m.set(h.t, h.s);
    }));
    return m;
  }, [rsRotation]);
  // RS rating for the chart's end-of-line label — same value + coloring as the perf bar.
  const rsRating = rsScoreMap.get(ticker) ?? stockInfo?.rs_rank ?? null;
  const rsRatingColor = rsRating == null ? ARIA.textMuted : rsRating >= 90 ? ARIA.green : rsRating >= 70 ? ARIA.blue : rsRating >= 50 ? ARIA.yellow : ARIA.textDim;

  // CANSLIM composite + within-sector EPS/Rev growth percentiles for the perf bar.
  const canslimGrade = useMemo(() => canslimComposite(stockInfo, annuals, stockMap), [stockInfo, annuals, stockMap]);
  const globalPct = useCallback((field) => {
    const mine = stockInfo[field];
    if (mine == null || !stockMap) return null;
    const peers = Object.values(stockMap).filter((s) => s && s[field] != null);
    if (peers.length < 10) return null;
    const better = peers.filter((s) => s[field] > mine).length;
    return Math.round((1 - better / peers.length) * 100);
  }, [stockInfo, stockMap]);
  const epsPct = useMemo(() => globalPct("eps_yoy"), [globalPct]);
  const revPct = useMemo(() => globalPct("sales_yoy"), [globalPct]);

  // 30-Minute Pivot + Opening Range + Floor Pivot / CPR analytics (30m mode only)
  const liveOrStockPrice = liveQuote?.price ?? stockInfo?.price;
  const pivot30 = useMemo(
    () => (tf === "30m" ? analyze30mPivot(ohlcBars, { livePrice: liveOrStockPrice }) : null),
    [tf, ohlcBars, liveOrStockPrice]
  );

  // Risk Management — ATR + 5 stop scenarios (mirrors ThinkScript indicator)
  // Avoid computing daily ATR / EMA extensions on 30m intraday bars; reuse cached 1d bars if available.
  const dailyBarsForMetrics = useMemo(
    () => (tf === "30m" ? (_ttlGet(_tickerOhlcCache, `${ticker}:1d`) || []) : ohlcBars),
    [ticker, tf, ohlcBars]
  );
  const dailyATR = useMemo(() => calcWilderATR(dailyBarsForMetrics, tradeSettings.atrLen), [dailyBarsForMetrics, tradeSettings.atrLen]);
  const riskEntry = c > 0 ? c : (dailyBarsForMetrics[dailyBarsForMetrics.length - 1]?.close ?? ohlcBars[ohlcBars.length - 1]?.close ?? null);
  const riskDayLow = l > 0 ? l : (dailyBarsForMetrics[dailyBarsForMetrics.length - 1]?.low ?? null);
  const riskPDL = dailyBarsForMetrics[dailyBarsForMetrics.length - 1]?.low ?? null;
  const weinsteinStage = useMemo(
    () => classifyWeinsteinStage(stockInfo) ?? classifyWeinsteinStageFromBars(dailyBarsForMetrics, riskEntry),
    [stockInfo, dailyBarsForMetrics, riskEntry]
  );
  const emaExt = useMemo(
    () => computeEmaAtrExtensions(dailyBarsForMetrics, riskEntry, dailyATR),
    [dailyBarsForMetrics, riskEntry, dailyATR]
  );
  const riskScenarios = useMemo(() => {
    if (!riskEntry || !dailyATR) return null;
    const { accountSize, riskPct, maxAllocPct } = tradeSettings;
    return {
      tight: calcRiskSize(riskEntry - dailyATR * 0.5, riskEntry, accountSize, riskPct, maxAllocPct),
      base:  calcRiskSize(riskEntry - dailyATR * 1.0, riskEntry, accountSize, riskPct, maxAllocPct),
      wide:  calcRiskSize(riskEntry - dailyATR * 2.0, riskEntry, accountSize, riskPct, maxAllocPct),
      lod:   riskDayLow ? calcRiskSize(riskDayLow, riskEntry, accountSize, riskPct, maxAllocPct) : null,
      pdl:   riskPDL    ? calcRiskSize(riskPDL,    riskEntry, accountSize, riskPct, maxAllocPct) : null,
    };
  }, [riskEntry, dailyATR, riskDayLow, riskPDL, tradeSettings]);

  // Prior earnings responses — lazy-loaded from /api/earnings when opened
  const [erHistOpen, setErHistOpen] = useState(() => { try { return localStorage.getItem("tp-erhist-open") === "1"; } catch { return false; } });
  const [erHist, setErHist] = useState(null);
  useEffect(() => {
    if (!ticker) return;
    const cached = _ttlGet(_tickerEarningsCache, ticker);
    if (cached) { setErHist(cached); return; }
    const ac = new AbortController();
    const tid = setTimeout(() => {
      authFetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (ac.signal.aborted || !d || !Array.isArray(d.history)) return;
          const entry = { ticker, history: d.history, next: d.next };
          _ttlSet(_tickerEarningsCache, ticker, entry);
          setErHist(entry);
        })
        .catch(() => {});
    }, TICKER_DEBOUNCE_MS);
    return () => { clearTimeout(tid); ac.abort(); };
  }, [ticker]);

  // Portfolio/Watchlist via shared cross-component hook (Aria's +WL / +PF)
  const [portfolio, setPortfolio] = useLocalStorageList("themepulse-portfolio");
  const [watchlist, setWatchlist] = useLocalStorageList("themepulse-watchlist");
  const [focus, setFocus] = useLocalStorageList("themepulse-focus");
  const inPF = portfolio.includes(ticker);
  const inWL = watchlist.includes(ticker);
  const inFC = focus.includes(ticker);
  const toggleWL = useCallback(() => {
    setWatchlist((prev) =>
      prev.includes(ticker) ? prev.filter((x) => x !== ticker) : [...prev, ticker]
    );
  }, [ticker, setWatchlist]);
  const togglePF = useCallback(() => {
    setPortfolio((prev) =>
      prev.includes(ticker) ? prev.filter((x) => x !== ticker) : [...prev, ticker]
    );
  }, [ticker, setPortfolio]);
  const toggleFC = useCallback(() => {
    setFocus((prev) =>
      prev.includes(ticker) ? prev.filter((x) => x !== ticker) : [...prev, ticker]
    );
  }, [ticker, setFocus]);

  const submitTicker = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t) {
      onTickerChange(t);
      setTickerInput("");
    }
  };

  const agoLabel = (dateStr) => {
    if (!dateStr) return "";
    let d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      // Finviz formats: "May-01-26", "Apr-30-26 08:30AM", "Today", "08:30AM"
      const m = dateStr.match(/^([A-Z][a-z]{2})-(\d{2})-(\d{2})/);
      if (m) {
        const yr = parseInt(m[3]) + 2000;
        d = new Date(`${m[1]} ${m[2]}, ${yr}`);
      } else if (/today/i.test(dateStr) || /^\d{1,2}:\d{2}/.test(dateStr)) {
        return "today";
      } else {
        return "";
      }
    }
    if (isNaN(d.getTime())) return "";
    const ms = Date.now() - d.getTime();
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m`;
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  // Quarterly & annual fundamentals grid (shown alongside company description + news)
  const earningsBox = useMemo(() => {
    const normPipelineQ = (arr) =>
      Array.isArray(arr)
        ? arr.map(q => ({
            ...q,
            revenue: q.revenue != null ? q.revenue / 1_000_000 : null,
            revenue_yoy: q.revenue_yoy ?? q.sales_yoy ?? null,
            ocf_ps: null,
            ocf_yoy: null,
          }))
        : [];
    const normPipelineA = (arr) =>
      Array.isArray(arr)
        ? arr.map(q => ({
            ...q,
            label: String(q.year),
            period: "FY",
            revenue: q.revenue != null ? q.revenue / 1_000_000 : null,
            revenue_yoy: q.revenue_yoy ?? q.sales_yoy ?? null,
            net_margin: q.net_margin ?? null,
            ocf_ps: null,
            ocf_yoy: null,
          }))
        : [];
    // Same source of truth as the Earnings History table + chart markers:
    // street-basis actuals from /api/earnings, oldest→newest.
    const erQ = erHist?.ticker === ticker && erHist.history.length
      ? [...erHist.history].reverse().map((q) => ({
          label: q.fiscal_label || (q.date || "").slice(2, 7),
          period: q.fiscal_label ? q.fiscal_label.split("-")[0] : "",
          eps: q.eps_actual,
          eps_yoy: q.eps_yoy_pct,
          revenue: q.revenue_actual != null ? q.revenue_actual / 1e6 : null,
          revenue_yoy: q.revenue_yoy_pct,
          net_margin: q.net_margin_pct,
          gross_margin: q.gross_margin_pct,
        }))
      : null;
    const effectiveQuarters = erQ || (quarters.length > 0 ? quarters : normPipelineQ(stockInfo?.quarters));
    const effectiveAnnuals  = annuals.length  > 0 ? annuals  : normPipelineA(stockInfo?.annual);
    const orderQ = (arr) => {
      const a = [...arr];
      if (a.length > 1 && a.every((q) => q.report_date)) a.sort((x, y) => String(x.report_date).localeCompare(String(y.report_date)));
      return a;
    };
    const qAll = erQ || orderQ(effectiveQuarters);
    const qCols = qAll.slice(-6).map((q) => ({
      _label: q.label || q.period || "",
      eps: q.eps ?? null, eps_yoy: q.eps_yoy ?? null,
      revenue: q.revenue ?? null, revenue_yoy: q.revenue_yoy ?? q.sales_yoy ?? null,
      net_margin: q.net_margin ?? null,
    }));
    const aCols = [...effectiveAnnuals]
      .sort((x, y) => (Number(x.year ?? x.label) || 0) - (Number(y.year ?? y.label) || 0))
      .slice(-6)
      .map((a) => ({
        _label: String(a.year ?? a.label ?? ""),
        eps: a.eps ?? null, eps_yoy: a.eps_yoy ?? null,
        revenue: a.revenue ?? null, revenue_yoy: a.revenue_yoy ?? a.sales_yoy ?? null,
        net_margin: a.net_margin ?? null,
      }));
    let est = null;
    const eEps = stockInfo?.eps_estimated, eRev = stockInfo?.revenue_estimated;
    if (eEps != null || eRev != null) {
      const yAgo = qAll.length >= 4 ? qAll[qAll.length - 4] : null;
      const revM = eRev != null ? eRev / 1e6 : null;
      const yoy = (now, then) => (now != null && then != null && then !== 0 ? ((now - then) / Math.abs(then)) * 100 : null);
      est = {
        _est: true,
        _label: `Est ${String(stockInfo?.earnings_display || "").replace(/^~/, "").split("/").slice(0, 2).join("/")}`.trim(),
        eps: eEps ?? null, eps_yoy: yoy(eEps, yAgo?.eps),
        revenue: revM, revenue_yoy: yoy(revM, yAgo?.revenue),
        net_margin: null,
      };
    }
    if (!qCols.length && !aCols.length) return null;
    return {
      qCols,
      aCols,
      est,
      source: `Quarterly: ${erQ ? "street actuals (adjusted)" : quarters.length > 0 ? "Finviz actuals" : "pipeline data"} · Annual: reported · orange = consensus estimate`,
    };
  }, [erHist, ticker, quarters, annuals, stockInfo]);

  return (
    <div
      style={{
        background: ARIA.bgCard,
        border: `1px solid ${ARIA.border}`,
        borderRadius: 14,
        marginBottom: 8,
        overflow: "hidden",
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        boxShadow: ARIA.shadow,
      }}
    >
      {/* 1-line 30m Pivot Action Bar (30m mode only) */}
      {tf === "30m" && pivot30?.ok && (() => {
        const pv = pivot30.pivot;
        const orng = pivot30.openingRange;
        const fp = pivot30.floorPivots;
        const fmtPx = (v) => (v == null ? "—" : v >= 1000 ? v.toFixed(0) : v.toFixed(2));
        const toneColor = (tone) => ({
          green: ARIA.green || "#22c55e",
          amber: "#f59e0b",
          cyan: ARIA.cyan || "#22d3ee",
          red: ARIA.red || "#f87171",
          muted: ARIA.textMuted,
        }[tone] || ARIA.textMuted);
        const stColor = toneColor(pv?.tone);
        const orColor = orng?.status === "ORH_BO"
          ? (ARIA.green || "#22c55e")
          : orng?.status === "ORL_BD"
            ? (ARIA.red || "#f87171")
            : (orng?.status === "FAILED_HIGH" || orng?.status === "FAILED_LOW")
              ? "#f59e0b"
              : (ARIA.cyan || "#22d3ee");
        const orTip = orng
          ? `Opening Range (${orng.sessionDate}): ORH $${fmtPx(orng.orh)} · ORL $${fmtPx(orng.orl)}${orng.rangePct != null ? ` (${orng.rangePct.toFixed(1)}% range)` : ""}`
          : "";
        const cprTip = fp
          ? `Floor Pivots (${fp.bias ? fp.bias.replace(/_/g, " ") : "neutral"}): P $${fmtPx(fp.p)} · BC $${fmtPx(fp.bc)}–TC $${fmtPx(fp.tc)} · R1 $${fmtPx(fp.r1)} · S1 $${fmtPx(fp.s1)}${fp.cprWidthPct != null ? ` · width ${fp.cprWidthPct.toFixed(2)}%` : ""}`
          : "Floor Pivots / CPR (requires prior session)";
        return (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: "5px 12px",
            borderBottom: `1px solid ${ARIA.border}`,
            background: ARIA.bgCard,
            flexShrink: 0,
            fontSize: 11,
          }}>
            <span
              title={pivot30.summary}
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                fontWeight: 800,
                padding: "1px 7px",
                borderRadius: 4,
                color: stColor,
                background: `${stColor}1f`,
                border: `1px solid ${stColor}88`,
                letterSpacing: 0.3,
                whiteSpace: "nowrap",
              }}
            >
              {pv?.label || "NO SETUP"}
            </span>
            {pv?.entry != null && (
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                fontFamily: MONO,
                fontSize: 11,
                fontVariantNumeric: "tabular-nums",
              }}>
                <span style={{ color: ARIA.textDim }}>
                  <span style={{ color: ARIA.textMuted }}>Entry </span>
                  <strong style={{ color: ARIA.text }}>${fmtPx(pv.entry)}</strong>
                </span>
                {pv.stop != null && (
                  <span style={{ color: ARIA.textDim }}>
                    <span style={{ color: ARIA.textMuted }}>Stop </span>
                    <strong style={{ color: ARIA.red || "#f87171" }}>${fmtPx(pv.stop)}</strong>
                    {pv.riskPct != null && (
                      <span style={{ color: ARIA.textMuted }}> (-{Math.abs(pv.riskPct).toFixed(1)}%)</span>
                    )}
                  </span>
                )}
                {pv.target2R != null && (
                  <span style={{ color: ARIA.textDim }}>
                    <span style={{ color: ARIA.textMuted }}>+2R </span>
                    <strong style={{ color: ARIA.green || "#22c55e" }}>${fmtPx(pv.target2R)}</strong>
                  </span>
                )}
                {pv.state === "TRIGGERED" && pv.rMultipleNow != null && (
                  <span
                    title="Current live R-multiple from pivot entry"
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "0 5px",
                      borderRadius: 3,
                      color: pv.rMultipleNow >= 0 ? (ARIA.green || "#22c55e") : (ARIA.red || "#f87171"),
                      background: pv.rMultipleNow >= 0 ? "rgba(34,197,94,0.14)" : "rgba(248,113,113,0.14)",
                      border: `1px solid ${pv.rMultipleNow >= 0 ? "rgba(34,197,94,0.5)" : "rgba(248,113,113,0.5)"}`,
                    }}
                  >
                    {pv.rMultipleNow >= 0 ? "+" : ""}{pv.rMultipleNow.toFixed(1)}R
                  </span>
                )}
              </span>
            )}
            <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {orng && (
                <span
                  title={orTip}
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 4,
                    color: orColor,
                    background: `${orColor}1a`,
                    border: `1px solid ${orColor}70`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {orng.label}
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowCpr((v) => !v)}
                disabled={!fp}
                title={cprTip}
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: 4,
                  cursor: fp ? "pointer" : "default",
                  opacity: fp ? 1 : 0.45,
                  background: showCpr && fp ? "rgba(167,139,250,0.22)" : "transparent",
                  border: `1px solid ${showCpr && fp ? "#a78bfa" : (ARIA.borderLight || ARIA.border)}`,
                  color: showCpr && fp ? "#a78bfa" : ARIA.textDim,
                  whiteSpace: "nowrap",
                }}
              >
                {showCpr && fp ? "CPR ON" : "CPR"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* SVG 30m/D/W Chart */}
      <div style={{ height: tf === "30m" && pivot30?.ok ? 570 : 600, overflow: "hidden", flexShrink: 0 }}>
        <ErrorBoundary>
          <DailyChartSVG
            ohlc={ohlcBars}
            quarters={erHist?.ticker === ticker && erHist.history.length
              ? erHist.history.map((q) => ({ report_date: q.date, label: q.fiscal_label || "", eps_yoy: q.eps_yoy_pct, sales_yoy: q.revenue_yoy_pct }))
              : quarters}
            height={height}
            owned={inPF || inFC || inWL}
            rsRating={rsRating}
            rsRatingColor={rsRatingColor}
            isIntraday={tf === "30m"}
            pivot30={tf === "30m" ? pivot30 : null}
            showCpr={tf === "30m" && showCpr}
            stopLines={tf === "30m" ? [] : [
              ...(showTrade && riskScenarios ? [
                { price: riskScenarios.tight?.stopPrice, color: "#ef4444", label: "0.5x", dashed: true },
                { price: riskScenarios.base?.stopPrice,  color: "#f97316", label: "1x",   dashed: true },
                { price: riskScenarios.wide?.stopPrice,  color: "#f59e0b", label: "2x",   dashed: true },
                { price: riskDayLow,                     color: "#9ca3af", label: "LOD",  dashed: false },
                { price: riskPDL,                        color: "#fb923c", label: "PDL",  dashed: true },
              ] : []),
            ].filter(sl => sl.price > 0)}
          />
        </ErrorBoundary>
      </div>

      {/* Thin header bar — ticker · stage · layer · ADR · Next ER (left), controls & ticker input (right) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 12px", borderTop: `1px solid ${ARIA.border}`, borderBottom: `1px solid ${ARIA.border}`, flexShrink: 0, overflowX: "auto", whiteSpace: "nowrap" }}>
        <img key={ticker} src={`https://images.financialmodelingprep.com/symbol/${ticker}.png`} alt="" onError={(e) => { e.target.style.display = "none"; }}
          style={{ width: 20, height: 20, borderRadius: 4, background: "#ffffff", objectFit: "contain", padding: 1.5, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 800, fontFamily: MONO, color: ARIA.text, flexShrink: 0 }}>{ticker}</span>
        {weinsteinStage != null && (() => {
          const stMeta = {
            1: { tag: "S1 · Base", color: "#64748b", tip: "Weinstein Stage 1 — Basing / Accumulation near or stabilizing below the 200d MA" },
            2: { tag: "S2 · Up", color: "#3b82f6", tip: "Weinstein Stage 2 — Advancing Uptrend above rising 50d & 200d MAs" },
            3: { tag: "S3 · Top", color: "#eab308", tip: "Weinstein Stage 3 — Topping / Distribution (losing 50d momentum above 200d)" },
            4: { tag: "S4 · Down", color: "#ec4899", tip: "Weinstein Stage 4 — Declining Downtrend below 50d & 200d MAs" },
          }[weinsteinStage];
          return (
            <span
              title={stMeta.tip}
              style={{
                fontSize: 10,
                fontWeight: 800,
                fontFamily: MONO,
                padding: "1px 6px",
                borderRadius: 4,
                background: `${stMeta.color}22`,
                border: `1px solid ${stMeta.color}88`,
                color: stMeta.color,
                letterSpacing: 0.3,
                flexShrink: 0,
              }}
            >
              {stMeta.tag}
            </span>
          );
        })()}
        {tickerLayers.length > 0 ? (
          <span onClick={() => { try { window.dispatchEvent(new CustomEvent("tp-open-layer", { detail: { themeId: tickerLayers[0].themeId, layer: tickerLayers[0].layer } })); } catch {} }}
            title={`${tickerLayers[0].theme} — click to view layer members${tickerLayers.length > 1 ? ` (+${tickerLayers.length - 1} more layer${tickerLayers.length - 1 > 1 ? "s" : ""})` : ""}`}
            style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 4, background: "rgba(251,191,36,0.12)", border: "1px solid #a07a1f", color: "#fbbf24", textTransform: "uppercase", letterSpacing: 0.4, cursor: "pointer", flexShrink: 0 }}>
            {tickerLayers[0].theme} • {tickerLayers[0].layer}{tickerLayers.length > 1 ? ` +${tickerLayers.length - 1}` : ""}
          </span>
        ) : stockInfo.sector ? (
          <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 4, background: "rgba(108,213,232,0.12)", border: "1px solid #3a8a9e", color: "#6cd5e8", textTransform: "uppercase", letterSpacing: 0.4, flexShrink: 0 }}>{stockInfo.sector}</span>
        ) : null}
        <span style={{ fontSize: 10, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
          <span style={{ color: ARIA.textMuted, fontWeight: 600 }}>ADR</span>
          <span style={{ fontFamily: MONO, color: adr != null && adr >= 4 ? ARIA.cyan : ARIA.textDim, fontWeight: adr != null && adr >= 4 ? 700 : 400 }}>{adr != null ? `${adr.toFixed(1)}%` : "\u2014"}</span>
        </span>
        {(nextErDisp) && (
          <span style={{ fontSize: 10, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }} title="Next earnings date">
            <span style={{ color: ARIA.textMuted, fontWeight: 600 }}>ER</span>
            <span style={{ fontFamily: MONO, color: (erDaysRaw != null && erDaysRaw >= 0 && erDaysRaw <= 21) ? ARIA.red : ARIA.textDim, fontWeight: (erDaysRaw != null && erDaysRaw >= 0 && erDaysRaw <= 21) ? 700 : 400 }}>{nextErDisp}{erTimingRaw ? ` ${erTimingRaw}` : ""}</span>
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {["30m", "D", "W"].map(tfOpt => (
            <button key={tfOpt} onClick={() => { setTf(tfOpt); try { localStorage.setItem("themepulse-chart-tf", tfOpt); } catch {} }}
              style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 4, cursor: "pointer", background: tf === tfOpt ? "#0d9163" : "transparent", border: "1px solid #0d9163", color: tf === tfOpt ? "#fff" : "#0d9163", fontWeight: 600, minWidth: tfOpt === "30m" ? 30 : 22 }}>
              {tfOpt}
            </button>
          ))}
          <button onClick={() => setShowTrade(prev => !prev)}
            style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 4, cursor: "pointer", background: showTrade ? "#0d9163" : "transparent", border: "1px solid #0d9163", color: showTrade ? "#fff" : "#0d9163", fontWeight: 600 }}>
            TRADE
          </button>
          <button onClick={togglePF} title={inPF ? "Remove from Portfolio" : "Add to Portfolio"} style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 4, border: `1px solid ${ARIA.yellow}80`, color: inPF ? ARIA.bg : ARIA.yellow, background: inPF ? ARIA.yellow : "transparent", cursor: "pointer", fontWeight: 600 }}>{inPF ? "✓PF" : "+PF"}</button>
          <button onClick={toggleFC} title={inFC ? "Remove from Focus" : "Add to Focus (high-priority recent setups)"} style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 4, border: `1px solid ${ARIA.cyan}80`, color: inFC ? ARIA.bg : ARIA.cyan, background: inFC ? ARIA.cyan : "transparent", cursor: "pointer", fontWeight: 600 }}>{inFC ? "✓FC" : "⚡FC"}</button>
          <button onClick={toggleWL} title={inWL ? "Remove from Watchlist" : "Add to Watchlist"} style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 4, border: `1px solid ${ARIA.green}80`, color: inWL ? ARIA.bg : ARIA.green, background: inWL ? ARIA.green : "transparent", cursor: "pointer", fontWeight: 600 }}>{inWL ? "✓WL" : "+WL"}</button>
          <input ref={tickerInputRef} value={tickerInput} onChange={(e) => setTickerInput(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") { submitTicker(); e.currentTarget.blur(); } else if (e.key === "Escape") { e.currentTarget.blur(); } }} placeholder="Ticker (/)" title="Jump to ticker (press /)" style={{ width: 78, fontSize: 10.5, padding: "2px 6px", background: ARIA.bg, border: `1px solid ${ARIA.border}`, borderRadius: 4, color: ARIA.textDim, fontFamily: MONO, textTransform: "uppercase", outline: "none" }} />
        </div>
      </div>

      {/* Second thin row — grade · perf · 52W · RS · ATR× · Base · TT (left), IPO (right) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 12px", flexShrink: 0, fontFamily: MONO, overflowX: "auto", whiteSpace: "nowrap" }}>
      {(() => {
        const csColor = (l) => (l === "A+" || l === "A") ? ARIA.green : l === "B" ? ARIA.blue : l === "C" ? ARIA.yellow : l === "D" ? "#f59e0b" : l === "F" ? ARIA.red : ARIA.textMuted;
        const pctColor = (v) => v == null ? ARIA.textMuted : v >= 80 ? ARIA.green : v >= 50 ? ARIA.blue : v >= 30 ? ARIA.yellow : ARIA.textDim;
        const rsRank = rsScoreMap.get(ticker) ?? stockInfo?.rs_rank ?? null;
        const rsColor = rsRank == null ? ARIA.textMuted : rsRank >= 90 ? ARIA.green : rsRank >= 70 ? ARIA.blue : rsRank >= 50 ? ARIA.yellow : ARIA.textDim;
        const ext = stockInfo?.dist_20dma_atrx ?? null;
        const extColor = ext == null ? ARIA.textMuted : Math.abs(ext) <= 2 ? ARIA.green : ARIA.textDim;
        const baseW = stockInfo?.base_weeks ?? null;
        const basePos = stockInfo?.base_pos_pct ?? null;
        const baseColor = !baseW ? ARIA.textMuted : (baseW >= 6 && (basePos == null || basePos >= 50)) ? ARIA.green : baseW >= 3 ? ARIA.blue : ARIA.textDim;
        const perfs = [
          { label: "1M", val: stockInfo?.return_1m },
          { label: "3M", val: stockInfo?.return_3m },
          { label: "6M", val: stockInfo?.return_6m },
        ];
        const stat = (label, node, title) => (
          <span title={title} style={{ fontSize: 10, fontFamily: MONO, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
            <span style={{ color: ARIA.textMuted }}>{label}</span>{node}
          </span>
        );
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "nowrap", flexShrink: 0 }}>
            {grade && (
              <span title="Overall grade" style={{ fontSize: 10, fontFamily: MONO, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: gradeColor + "22", border: `1px solid ${gradeColor}55`, color: gradeColor }}>
                {grade}
              </span>
            )}
            {stat("CANSLIM", <span style={{ color: csColor(canslimGrade), fontWeight: 700 }}>{canslimGrade}</span>, "CANSLIM composite — unweighted average of O'Neil/IBD's gradeable criteria (EPS growth, accel, 5Y EPS, sales, margin, ROE, inst flow, dist-from-high, industry rank)")}
            {stat("EPS", <span style={{ color: pctColor(epsPct), fontWeight: 700 }}>{epsPct != null ? `${epsPct}` : "—"}</span>, "EPS growth (YoY) percentile vs the full universe")}
            {stat("Rev", <span style={{ color: pctColor(revPct), fontWeight: 700 }}>{revPct != null ? `${revPct}` : "—"}</span>, "Revenue growth (YoY) percentile vs the full universe")}
            {perfs.map(({ label, val }) => (
              <span key={label} style={{ fontSize: 10, fontFamily: MONO, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
                <span style={{ color: ARIA.textMuted }}>{label}</span>
                <span style={{ color: ARIA.textDim, fontWeight: val != null && Math.abs(val) >= 20 ? 700 : 400 }}>
                  {val != null ? `${val >= 0 ? "+" : ""}${val.toFixed(1)}%` : "—"}
                </span>
              </span>
            ))}
            {fromHi != null && (
              <span style={{ fontSize: 10, fontFamily: MONO, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
                <span style={{ color: ARIA.textMuted }}>52W</span>
                <span style={{ color: fromHi >= -20 ? ARIA.green : ARIA.textDim, fontWeight: fromHi >= -20 ? 700 : 400 }}>
                  {fromHi > 0 ? "+" : ""}{fromHi.toFixed(1)}%
                </span>
              </span>
            )}
            {stat("RS", <span style={{ color: rsColor, fontWeight: 700 }}>{rsRank != null ? rsRank : "—"}</span>, "RS score (0-100) — the same relative-strength value shown in the LAYER REGIME box (rs_rotation holds)")}
            {(() => {
              const items = [
                ["10E", emaExt?.ema10, 2.0, 3.5],
                ["21E", emaExt?.ema21, 2.0, 3.5],
                ["50E", emaExt?.ema50, 3.5, 5.0],
              ];
              const hasAny = items.some(([, v]) => v?.atrX != null);
              if (!hasAny) {
                return stat("Ext", <span style={{ color: extColor, fontWeight: 700 }}>{ext != null ? `${ext.toFixed(1)}×` : "—"}</span>, "Extension from the 20-day MA in ATR multiples.");
              }
              return (
                <span style={{ fontSize: 10, fontFamily: MONO, display: "inline-flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
                  <span style={{ color: ARIA.textMuted }}>ATR×</span>
                  {items.map(([lbl, v, goodMax, warnMax]) => {
                    if (v?.atrX == null) return null;
                    const x = v.atrX;
                    const c = x < (lbl === "50E" ? 0 : -1.0)
                      ? ARIA.red
                      : x <= goodMax
                      ? ARIA.green
                      : x <= warnMax
                      ? "#f59e0b"
                      : ARIA.red;
                    const tip = `${lbl.replace("E", " EMA")}: $${v.ema.toFixed(2)} · ${v.pct >= 0 ? "+" : ""}${v.pct.toFixed(1)}% · ${x >= 0 ? "+" : ""}${x.toFixed(1)}× ATR${emaExt?.atr ? ` (14d ATR $${emaExt.atr.toFixed(2)})` : ""} — Green = tight/buyable (≤${goodMax}×), Amber = stretched, Red = extended (>${warnMax}×) or below`;
                    return (
                      <span key={lbl} title={tip} style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
                        <span style={{ color: ARIA.textMuted }}>{lbl}</span>
                        <span style={{ color: c, fontWeight: 700 }}>{x > 0 ? `+${x.toFixed(1)}` : x.toFixed(1)}×</span>
                      </span>
                    );
                  })}
                </span>
              );
            })()}
            {stat("Base", <span style={{ color: baseColor, fontWeight: 700 }}>{baseW ? `${baseW % 1 === 0 ? baseW : baseW.toFixed(1)}w` : "—"}</span>, `Base quality — weeks consolidating near the highs (longer bases → bigger moves)${basePos != null ? `; price sits at the ${basePos}th %ile of the base range (${basePos >= 50 ? "upper" : "lower"} half)` : ""}.`)}
            {(() => {
              const tt = ttCount(stockInfo);
              const ttColor = tt == null ? ARIA.textMuted : tt === 8 ? ARIA.green : tt >= 6 ? ARIA.textDim : ARIA.red;
              const fails = tt != null && tt < 8 ? ` Failing: ${ttFails(stockInfo).join(" · ")}.` : tt === 8 ? " All eight pass — confirmed stage-2 uptrend." : "";
              return stat("TT", <span style={{ color: ttColor, fontWeight: tt === 8 ? 700 : 400 }}>{tt == null ? "—" : `${tt}/8`}</span>,
                `Minervini Trend Template (stage-2 qualifier): price > 150/200d · 150d > 200d · 200d rising 1mo+ · 50d > 150d > 200d · price > 50d · ≥30% above 52w low · within 25% of 52w high · RS ≥ 70.${fails}`);
            })()}
          </div>
        );
      })()}
        {stockInfo.ipo_date && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: 3, fontFamily: MONO, fontSize: 10, flexShrink: 0 }}>
            <span style={{ color: ARIA.textMuted, fontSize: 10 }}>IPO</span>
            <span title="Recent IPO (< 5 years)" style={{ fontWeight: 700, color: (Date.now() - new Date(stockInfo.ipo_date).getTime()) < 157788000000 ? ARIA.green : ARIA.textDim }}>{stockInfo.ipo_date}</span>
          </span>
        )}
      </div>

      {/* Ticker details — company description + news on left, quarterly/annual earnings grid on right */}
      <div style={{ padding: "8px 14px", borderTop: `1px solid ${ARIA.border}`, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        {/* Left column — badges + company + description + news */}
        <div style={{ flex: earningsBox ? "1 1 240px" : "1 1 100%", minWidth: 0 }}>
          {(has9M || stockInfo.two_day_tight || stockInfo.de_ready) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
              {has9M && <span style={badgeStyle("#f59e0b")} title="Unusual institutional volume">9M</span>}
              {!!stockInfo.two_day_tight && <span style={badgeStyle("#f472b6")} title="2-Days-Tight — last two closes within 1% + narrowing range, above the 50sma. Breakout candidate.">T2</span>}
              {!!stockInfo.de_ready && <span style={badgeStyle("#fb923c")} title={`Delayed Entry ready (2-7d post-gap, tight + narrowing, holding 4-EMA). Entry = break of ${stockInfo.de_trigger ?? "recent highs"}${stockInfo.de_hold ? ` · gap ${stockInfo.de_hold} (${stockInfo.de_hold_score}/5)` : ""}${stockInfo._epq ? ` · EP quality ${stockInfo._epq}` : ""}${stockInfo._newsPipe ? `\nCatalyst: ${stockInfo._newsPipe[0]}` : ""}`}>DE{stockInfo.de_trigger ? ` ${stockInfo.de_trigger}` : ""}{stockInfo.de_hold === "HELD" ? " ✓" : ""}</span>}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#9090a0", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 1 }}>
            {stockInfo.company || ticker}
          </div>
          {liveQuote && (
            <div style={{ display: "flex", gap: 12, fontSize: 10, fontFamily: MONO, margin: "1px 0 3px", flexWrap: "wrap" }}>
              {[
                ["Day", chgPct, "Change vs yesterday's close"],
                ["From open", fromOpenPct, "Change since today's open"],
              ].map(([lbl, v, tip]) => (
                <span key={lbl} title={tip}>
                  <span style={{ color: ARIA.textMuted }}>{lbl} </span>
                  <span style={{ color: v == null ? ARIA.textMuted : v >= 0 ? ARIA.green : ARIA.red, fontWeight: 700 }}>
                    {v == null ? "\u2014" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`}</span>
                </span>
              ))}
              <span title="ZVR — today's volume ÷ a normal day's volume by this time (the ticker's own intraday profile; 1.00× = normal pace). After the close: full-day volume ÷ 10-day average.">
                <span style={{ color: ARIA.textMuted }}>ZVR </span>
                <span style={{ color: zvr == null ? ARIA.textMuted : zvr >= 2 ? ARIA.purple : zvr >= 1.3 ? ARIA.green : zvr < 0.7 ? ARIA.textMuted : ARIA.textDim, fontWeight: 700 }}>
                  {zvr == null ? "\u2014" : `${zvr.toFixed(2)}×`}</span>
              </span>
              <TierMark t={ticker} label />
            </div>
          )}
          {description
            ? <div style={{ fontSize: 10.5, color: "#6a6a7a", lineHeight: 1.4 }}>{description}</div>
            : <div style={{ fontSize: 10, color: "#4a4a5a", fontStyle: "italic" }}>No description available.</div>}

          {/* News — below company description */}
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${ARIA.border}` }}>
            <div onClick={() => news.length > 0 && setNewsOpen(o => !o)}
              style={{ display: "flex", alignItems: "center", gap: 5, cursor: news.length > 0 ? "pointer" : "default", userSelect: "none", fontSize: 10, fontWeight: 700, color: "#6a6a7a", textTransform: "uppercase", letterSpacing: 0.5, padding: "1px 0" }}
              onMouseEnter={e => { if (news.length > 0) e.currentTarget.style.color = "#9090a0"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#6a6a7a"; }}>
              {news.length > 0 && <span style={{ fontSize: 9 }}>{newsOpen ? "▼" : "▶"}</span>}
              News <span style={{ color: "#4a4a5a", fontWeight: 400, fontFamily: MONO }}>({news.length || stockInfo._newsPipe?.length || 0})</span>
            </div>
            {news.length === 0 && !(stockInfo._newsPipe?.length) && <div style={{ fontSize: 10, color: "#4a4a5a", fontStyle: "italic", marginTop: 2 }}>No recent headlines.</div>}
            {news.length === 0 && stockInfo._newsPipe?.length > 0 && (
              <div style={{ maxHeight: 150, overflowY: "auto" }}>
                {stockInfo._newsPipe.map((h, i) => (
                  <div key={i} title={h} style={{ fontSize: 10, color: "#9090a0", padding: "2px 0", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <span style={{ color: "#5a5a6a", marginRight: 4 }}>⛭</span>{h}
                  </div>
                ))}
              </div>
            )}
            {newsOpen && news.length > 0 && (
              <div style={{ maxHeight: 150, overflowY: "auto" }}>
                {news.slice(0, 8).map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                    style={{ display: "block", fontSize: 10, color: "#9090a0", textDecoration: "none", padding: "2px 0", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                    onMouseEnter={e => { e.currentTarget.style.color = "#c0c0d8"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "#9090a0"; e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ color: "#5a5a6a", marginRight: 4, fontFamily: MONO }}>{agoLabel(a.date)}</span>
                    {a.headline}
                    <span style={{ color: "#6a6a7a", marginLeft: 4 }}>{a.source}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Right column — quarterly & annual fundamentals table */}
        {earningsBox && (
          <div style={{ flex: "1.45 1 360px", minWidth: 0 }}>
            <EarningsBox
              quarters={earningsBox.qCols}
              annuals={earningsBox.aCols}
              est={earningsBox.est}
              ARIA={ARIA}
              source={earningsBox.source}
            />
          </div>
        )}
      </div>
      </div>

      {/* Prior earnings responses — EPS/Sales surprise + 1d/10d reaction */}
      <div style={{ borderTop: `1px solid ${ARIA.border}`, borderBottom: `1px solid ${ARIA.border}`, padding: "3px 14px 4px" }}>
        <div onClick={() => setErHistOpen((o) => { const n = !o; try { localStorage.setItem("tp-erhist-open", n ? "1" : "0"); } catch {} return n; })}
          style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", userSelect: "none", fontSize: 10, fontWeight: 700, color: "#6a6a7a", textTransform: "uppercase", letterSpacing: 0.5, padding: "1px 0" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#9090a0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#6a6a7a"; }}
          title="Prior earnings responses: EPS/Sales surprise vs estimates + the price reaction (announcement day and 10 sessions incl. drift). How does this name treat its reports?">
          <span style={{ fontSize: 9 }}>{erHistOpen ? "▼" : "▶"}</span>
          Earnings History{erHist?.ticker === ticker && erHist.history.length ? <span style={{ fontFamily: MONO, fontWeight: 500 }}>({erHist.history.length}q)</span> : ""}
        </div>
        {erHistOpen && (() => {
          if (erHist?.ticker !== ticker) return <div style={{ fontSize: 10, color: "#4a4a5a", fontStyle: "italic", padding: "2px 0" }}>loading…</div>;
          if (!erHist.history.length) return <div style={{ fontSize: 10, color: "#4a4a5a", fontStyle: "italic", padding: "2px 0" }}>No reported quarters.</div>;
          const fmtRev = (v) => v == null ? "—" : v >= 1e9 ? (v / 1e9).toFixed(1) + "B" : (v / 1e6).toFixed(0) + "M";
          const surpC = (v) => v == null ? ARIA.textMuted : v >= 0 ? ARIA.green : ARIA.red;
          const rxC = (v) => v == null ? ARIA.textMuted : Math.abs(v) < 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;
          const sp = (v, dec = 1) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dec)}%`;
          const yoy = (v) => v == null ? "—" : Math.abs(v) >= 1000 ? `${v > 0 ? ">+999" : "<-999"}%` : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`;
          // Calendar-quarter shorthand: the quarter that ENDED most recently
          // before the report date (a 05/20/26 report covers Q1 26').
          const qtrTag = (d) => {
            if (!d) return null;
            const [y, m] = d.split("-").map(Number);
            const qEnd = Math.floor((m - 1) / 3); // 0 = Jan-Mar report → prior Q4
            const q = qEnd === 0 ? 4 : qEnd;
            const yr = qEnd === 0 ? y - 1 : y;
            return `Q${q} ${String(yr).slice(2)}'`;
          };
          // Minervini Code 33: a quarter "accelerates" when EPS YoY, Sales YoY
          // and net margin are ALL higher than the prior quarter's. Three
          // consecutive accelerating quarters = Code 33 → light-blue rows.
          const H = erHist.history; // newest first
          const accel = H.map((q, i) => {
            const p = H[i + 1];
            return !!(p && q.eps_yoy_pct != null && p.eps_yoy_pct != null && q.revenue_yoy_pct != null && p.revenue_yoy_pct != null && q.net_margin_pct != null && p.net_margin_pct != null
              && q.eps_yoy_pct > p.eps_yoy_pct && q.revenue_yoy_pct > p.revenue_yoy_pct && q.net_margin_pct > p.net_margin_pct);
          });
          const code33 = H.map((_, i) => {
            for (let k = Math.max(0, i - 2); k <= i; k++) {
              if (accel[k] && accel[k + 1] && accel[k + 2]) return true;
            }
            return false;
          });
          const liveCode33 = accel[0] && accel[1] && accel[2];
          const th = { padding: "3px 6px", fontSize: 10, fontWeight: 600, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.35, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, whiteSpace: "nowrap" };
          const td = { padding: "2px 6px", fontSize: 10, fontFamily: MONO, fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap", borderBottom: `1px solid ${ARIA.border}40` };
          return (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: "left" }}>Qtr</th>
                  <th style={th} title="Reported EPS (surprise vs consensus)">EPS</th>
                  <th style={th} title="EPS growth vs the same quarter a year ago (4 reports back)">YoY</th>
                  <th style={th} title="EPS beat/miss vs consensus estimate">Surp</th>
                  <th style={th} title="Reported revenue (surprise vs consensus)">Sales</th>
                  <th style={th} title="Revenue growth vs the same quarter a year ago">YoY</th>
                  <th style={th} title="Revenue beat/miss vs consensus estimate">Surp</th>
                  <th style={th} title="ADJUSTED net margin for the reported quarter (street-basis EPS × diluted shares / revenue) — one-time GAAP items can't fake acceleration. Minervini Code 33: three straight quarters where EPS YoY, Sales YoY AND net margin all accelerate — those rows glow light blue.">NM%</th>
                  <th style={th} title="Announcement-day close-to-close move (BMO/AMC inferred from which session moved more)">1D</th>
                  <th style={th} title="Close 10 sessions after the pre-ER close vs the pre-ER close — total response incl. drift">10D</th>
                </tr></thead>
                <tbody>
                  {liveCode33 ? (
                    <tr><td colSpan={10} style={{ padding: "2px 6px", fontSize: 10, fontWeight: 700, color: ARIA.blue, background: `${ARIA.blue}14`, letterSpacing: 0.3 }} title="EPS YoY, Sales YoY and net margin have ALL accelerated for 3 straight quarters — Minervini's 'hitting on all cylinders' condition">CODE 33 — sales, earnings & margins accelerating 3 straight quarters</td></tr>
                  ) : null}
                  {erHist.history.map((q, qi) => (
                    <tr key={q.date} style={{ background: code33[qi] ? `${ARIA.blue}1f` : "transparent" }} title={code33[qi] ? "Part of a Code 33 run — EPS YoY, Sales YoY and net margin all accelerating for 3+ consecutive quarters" : undefined}>
                      <td style={{ ...td, textAlign: "left", color: ARIA.textDim }}>{q.date?.slice(2)}{(q.fiscal_label || qtrTag(q.date)) ? <span style={{ color: ARIA.textMuted }} title="Company fiscal quarter (matches the chart's ER markers)"> ({q.fiscal_label || qtrTag(q.date)})</span> : null}</td>
                      <td style={{ ...td, color: ARIA.textDim }}>{q.eps_actual != null ? q.eps_actual.toFixed(2) : "—"}</td>
                      <td style={{ ...td, color: surpC(q.eps_yoy_pct), fontWeight: q.eps_yoy_pct != null && q.eps_yoy_pct >= 25 ? 700 : 400 }}>{yoy(q.eps_yoy_pct)}</td>
                      <td style={{ ...td, color: surpC(q.eps_surprise_pct), fontWeight: q.eps_surprise_pct != null && Math.abs(q.eps_surprise_pct) >= 10 ? 700 : 400 }}>{sp(q.eps_surprise_pct)}</td>
                      <td style={{ ...td, color: ARIA.textDim }}>{fmtRev(q.revenue_actual)}</td>
                      <td style={{ ...td, color: surpC(q.revenue_yoy_pct), fontWeight: q.revenue_yoy_pct != null && q.revenue_yoy_pct >= 20 ? 700 : 400 }}>{yoy(q.revenue_yoy_pct)}</td>
                      <td style={{ ...td, color: surpC(q.revenue_surprise_pct), fontWeight: q.revenue_surprise_pct != null && Math.abs(q.revenue_surprise_pct) >= 5 ? 700 : 400 }}>{sp(q.revenue_surprise_pct)}</td>
                      <td style={{ ...td, color: accel[qi] ? ARIA.blue : ARIA.textDim, fontWeight: accel[qi] ? 700 : 400 }}>{q.net_margin_pct != null ? `${q.net_margin_pct.toFixed(1)}%` : "—"}</td>
                      <td style={{ ...td, color: rxC(q.day1_pct), fontWeight: q.day1_pct != null && Math.abs(q.day1_pct) >= 5 ? 700 : 400 }}>{sp(q.day1_pct)}</td>
                      <td style={{ ...td, color: rxC(q.day10_pct), fontWeight: q.day10_pct != null && Math.abs(q.day10_pct) >= 5 ? 700 : 400 }}>{sp(q.day10_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* Risk Management Dashboard */}
      {showTrade && (() => {
        const inputStyle = {
          width: 80, fontSize: 10.5, padding: "2px 5px", background: "#0a0a14",
          border: "1px solid #2a2a3a", borderRadius: 4, color: "#c0c0d8",
          fontFamily: MONO, outline: "none",
        };
        const labelStyle = { fontSize: 10, fontWeight: 600, color: "#6a6a7a", marginRight: 3 };
        const cols = [
          { key: "tight", label: "0.5× ATR" },
          { key: "base",  label: "1× ATR" },
          { key: "wide",  label: "2× ATR" },
          { key: "lod",   label: "Day Low" },
          { key: "pdl",   label: "Prev Low" },
        ];
        const atrPct = dailyATR && riskEntry ? ((dailyATR / riskEntry) * 100).toFixed(2) : null;
        const fmtN = (v, dec = 2) => v != null ? v.toFixed(dec) : "—";
        const cellBg = "#0d0d1a";
        const headBg = "#14142a";
        const colColors = ["#ef4444","#f97316","#f59e0b","#9ca3af","#fb923c"];
        return (
          <div style={{ borderBottom: "1px solid #1a1a2e", background: "#0b0b18", padding: "8px 14px" }}>
            {/* Input row */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10.5, fontFamily: MONO, color: "#0d9163", fontWeight: 700 }}>
                ATR({tradeSettings.atrLen}): ${dailyATR ? dailyATR.toFixed(2) : "—"}{atrPct ? ` (${atrPct}%)` : ""}
              </span>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={labelStyle}>Acct $</span>
                <input style={inputStyle} type="number" value={tradeSettings.accountSize}
                  onChange={e => setTradeSettings(s => ({ ...s, accountSize: parseFloat(e.target.value) || s.accountSize }))} />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={labelStyle}>Risk %</span>
                <input style={{ ...inputStyle, width: 50 }} type="number" step="0.1" value={tradeSettings.riskPct}
                  onChange={e => setTradeSettings(s => ({ ...s, riskPct: parseFloat(e.target.value) || s.riskPct }))} />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={labelStyle}>Max %</span>
                <input style={{ ...inputStyle, width: 50 }} type="number" step="1" value={tradeSettings.maxAllocPct}
                  onChange={e => setTradeSettings(s => ({ ...s, maxAllocPct: parseFloat(e.target.value) || s.maxAllocPct }))} />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={labelStyle}>ATR Len</span>
                <input style={{ ...inputStyle, width: 45 }} type="number" step="1" value={tradeSettings.atrLen}
                  onChange={e => setTradeSettings(s => ({ ...s, atrLen: parseInt(e.target.value) || s.atrLen }))} />
              </label>
            </div>
            {/* Table */}
            {riskScenarios && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums", fontSize: 10.5 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "3px 8px", background: headBg, color: "#5a5a7a", textAlign: "left", fontWeight: 600, fontSize: 10, borderBottom: "1px solid #1a1a2e" }}></th>
                    {cols.map((col, ci) => (
                      <th key={col.key} style={{ padding: "3px 8px", background: headBg, color: colColors[ci], textAlign: "right", fontWeight: 600, fontSize: 10, borderBottom: "1px solid #1a1a2e", whiteSpace: "nowrap" }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { row: "Stop $",    fn: s => s ? `$${fmtN(s.stopPrice)}` : "—" },
                    { row: "Shares",    fn: s => s ? `${s.shares}${s.capped ? "*" : ""}` : "—", cappedFn: s => s?.capped },
                    { row: "Dist %",    fn: s => s ? `-${fmtN(s.distPct)}%` : "—" },
                    { row: "Invested",  fn: s => s ? `${fmtN(s.investedPct, 1)}%` : "—" },
                    { row: "Risk $",    fn: s => s ? `$${fmtN(s.risk)}` : "—" },
                  ].map(({ row, fn, cappedFn }) => (
                    <tr key={row}>
                      <td style={{ padding: "3px 8px", background: headBg, color: "#6a6a7a", fontSize: 10, fontWeight: 600, borderBottom: "1px solid #111120" }}>{row}</td>
                      {cols.map((col, ci) => {
                        const s = riskScenarios[col.key];
                        const isCapped = cappedFn ? cappedFn(s) : false;
                        return (
                          <td key={col.key} style={{
                            padding: "3px 8px", textAlign: "right", borderBottom: "1px solid #111120",
                            fontFamily: MONO,
                            background: isCapped ? "rgba(251,191,36,0.12)" : cellBg,
                            color: isCapped ? "#fbbf24" : colColors[ci],
                            fontWeight: row === "Stop $" || row === "Shares" ? 700 : 400,
                          }}>
                            {fn(s)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}
    </div>
  );
}
