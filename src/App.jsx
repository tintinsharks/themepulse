// ════════════════════════════════════════════════════════════════════════════
// ThemePulse — Aria Trading Dashboard (Vercel-hosted)
// ════════════════════════════════════════════════════════════════════════════
// Migration plan: ~/.claude/plans/lively-zooming-meteor.md
// Legacy file: src/App.jsx.legacy.bak (12,597 lines)
//
// Phase 1 ✓ — Scaffolding + data hooks
// Phase 2.1 (current) — Market Breadth Bar + Scan Watch (Scan view)
// Phase 2.2 — PM/AH/EP/ETF/QQQ subviews
// Phase 2.3 — Agent Picks panel
// Phase 2.4 — Lightweight Charts panel + Watchlist + Ticker Info
// Phase 3   — Vercel KV picks endpoints
// Phase 4   — Repoint local cron to Vercel
// Phase 5   — Cutover
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { ARIA_DARK, ARIA_LIGHT, ARIA } from "./styles.js";
import { scrollRowIntoScroller } from "./utils.js";
import { parseSchwabRealized, summarizeTrades, mergeTrades, applyClearTombstone, newestStamp } from "./wheelTrades.js";
import {
  LWChart as LegacyLWChart,
  IntradayChart as LegacyIntradayChart,
} from "./LWChartLegacy.jsx";
import SubthemeRotation, { SubthemeRotationAutoRefresh } from "./SubthemeRotation";

// ──────────────────────────────────────────────────────────────────────────
// Theme system: Aria light/dark palettes via React context
// ──────────────────────────────────────────────────────────────────────────
//
// The App root reads themepulse-theme from localStorage and provides the
// active palette + toggle via AriaThemeContext. Each component starts with
//   const ARIA = useAriaTheme();
// then references ARIA.bg, ARIA.text, etc. as before — the values flip when
// the user toggles theme.
//
// NOTE: the legacy chart components (LWChartLegacy.jsx) use hardcoded dark
// hex colors and don't yet respect this theme. Phase 2.8b will thread the
// palette into them.

const AriaThemeContext = React.createContext({
  ARIA: ARIA_DARK,
  themeMode: "dark",
  toggleTheme: () => {},
  zoom: 1,
  changeZoom: () => {},
});

function useAriaTheme() {
  return React.useContext(AriaThemeContext).ARIA;
}
function useAriaThemeControls() {
  return React.useContext(AriaThemeContext);
}

// ──────────────────────────────────────────────────────────────────────────
// Constants — ported from Aria's scan-watch defaults
// ──────────────────────────────────────────────────────────────────────────

// Industries Aria's NoBio toggle excludes (matches BIO_REIT_IND in dashboard.py)
const BIO_REIT_INDUSTRIES = new Set([
  "Biotechnology",
  "Drug Manufacturers - Specialty & Generic",
  "Drug Manufacturers - General",
  "Diagnostics & Research",
  "Pharmaceuticals",
  "Medical - Pharmaceuticals",
  "REIT - Diversified",
  "REIT - Healthcare Facilities",
  "REIT - Hotel & Motel",
  "REIT - Industrial",
  "REIT - Mortgage",
  "REIT - Office",
  "REIT - Residential",
  "REIT - Retail",
  "REIT - Specialty",
]);

// Phantom-volume tickers from M&A cleanup — Aria excludes these
const DELISTED = new Set(["EXAS", "TGNA", "EB", "ALEX", "HOLX"]);

// Aria scan-watch defaults
// Subtheme/theme → correlated ETFs. Used by the Watchlist Themes view to
// surface tradable ETF proxies for each cluster of tickers. Keys are matched
// case-insensitively as substrings of the subtheme name first, then the
// parent theme name. Order = priority (most specific first).
const SUBTHEME_ETFS = [
  // ── AI / compute / semis ─────────────────────────────────────────────
  { match: /quantum/i, etfs: ["QTUM", "DEFN"] },
  { match: /semiconduct|chip/i, etfs: ["SMH", "SOXX", "SOXL"] },
  { match: /ai infra|data center|hyperscale/i, etfs: ["DTCR", "SMH", "AIQ"] },
  { match: /artificial intelligence|\bai\b|machine learning/i, etfs: ["AIQ", "BOTZ", "ROBO"] },
  { match: /robotic|automation/i, etfs: ["ROBO", "BOTZ", "ARKQ"] },
  // ── Software / cyber / cloud ─────────────────────────────────────────
  { match: /cyber/i, etfs: ["HACK", "CIBR", "BUG"] },
  { match: /cloud|saas|software/i, etfs: ["WCLD", "CLOU", "IGV", "SKYY"] },
  { match: /fintech|payment/i, etfs: ["FINX", "ARKF", "IPAY"] },
  { match: /blockchain|crypto|bitcoin/i, etfs: ["BITQ", "BLOK", "IBIT"] },
  // ── Defense / space / aerospace ──────────────────────────────────────
  { match: /space|satellite|launch/i, etfs: ["UFO", "ROKT", "ARKX"] },
  { match: /defense|aerospace|military/i, etfs: ["ITA", "XAR", "PPA"] },
  { match: /drone|uav/i, etfs: ["UAV", "ARKX"] },
  // ── Energy / nuclear / uranium ───────────────────────────────────────
  { match: /uranium|nuclear/i, etfs: ["URA", "URNM", "NLR"] },
  { match: /solar/i, etfs: ["TAN", "RAYS"] },
  { match: /clean.*energy|renewable/i, etfs: ["ICLN", "QCLN", "PBW"] },
  { match: /oil|gas|energy.*equip|exploration/i, etfs: ["XLE", "XOP", "OIH"] },
  { match: /lng|natural gas/i, etfs: ["UNG", "FCG"] },
  // ── Metals / mining / materials ──────────────────────────────────────
  { match: /lithium|battery/i, etfs: ["LIT", "BATT"] },
  { match: /copper/i, etfs: ["COPX", "CPER"] },
  { match: /gold|silver|precious/i, etfs: ["GDX", "GDXJ", "SIL"] },
  { match: /rare earth|critical mineral/i, etfs: ["REMX", "MP"] },
  { match: /steel|industrial metal/i, etfs: ["SLX", "PICK"] },
  // ── Bio / health ─────────────────────────────────────────────────────
  { match: /glp.?1|obesity|weight loss/i, etfs: ["OBES", "IBB"] },
  { match: /gene|crispr|cell therapy/i, etfs: ["ARKG", "GNOM", "XBI"] },
  { match: /biotech/i, etfs: ["XBI", "IBB", "LABU"] },
  { match: /medical device|medtech/i, etfs: ["IHI", "XHE"] },
  // ── Consumer / EV / mobility ─────────────────────────────────────────
  { match: /\bev\b|electric vehicle|autonomous/i, etfs: ["DRIV", "IDRV", "KARS"] },
  { match: /retail|consumer disc/i, etfs: ["XLY", "XRT"] },
  { match: /travel|airline|leisure/i, etfs: ["JETS", "AWAY"] },
  { match: /home build|construction/i, etfs: ["XHB", "ITB"] },
  // ── Finance ──────────────────────────────────────────────────────────
  { match: /bank|financial/i, etfs: ["XLF", "KRE", "KBE"] },
  { match: /insurance/i, etfs: ["KIE", "IAK"] },
  // ── Macro / sector fallbacks ─────────────────────────────────────────
  { match: /utilit/i, etfs: ["XLU"] },
  { match: /reit|real estate/i, etfs: ["XLRE", "VNQ"] },
  { match: /industrial/i, etfs: ["XLI"] },
  { match: /materials/i, etfs: ["XLB"] },
  { match: /staples/i, etfs: ["XLP"] },
  { match: /communic|media|entertain/i, etfs: ["XLC"] },
  { match: /tech/i, etfs: ["XLK", "QQQ"] },
  { match: /healthcare|health care/i, etfs: ["XLV", "IHI"] },
  { match: /energy/i, etfs: ["XLE"] },
];

function etfsForTheme(subtheme, theme) {
  const sub = (subtheme || "").trim();
  const par = (theme || "").trim();
  for (const { match, etfs } of SUBTHEME_ETFS) {
    if (sub && match.test(sub)) return etfs;
  }
  for (const { match, etfs } of SUBTHEME_ETFS) {
    if (par && match.test(par)) return etfs;
  }
  return [];
}

const DEFAULT_FILTERS = {
  noBio: true,
  greenOnly: false,   // Chg>0% on chgOpen
  ownedView: "all",   // "all" | "owned" | "hide" — filter by portfolio/watchlist membership. Default 'all' (no filtering).
  adrMin: 1,
  adrMax: 15,
  minDvolM: 20,        // dollar volume floor in millions
  minChg: 0,           // Chg≥ slider (%)
  minRvol: 0,          // RV≥ slider (×)
  minEif: 0,           // EIF≥ slider (percentile)
  chgMode: "chg",      // "open" or "chg" — which column the gain filter & sort apply to (default chg per user request)
};

const DEFAULT_SORT = { primary: "rvol", secondary: "change" }; // Aria default

// Momentum + gap presets — consolidated 2026-07: the 1M/3M/6M lookbacks and
// Stealth/ACCUM-Stack pairs overlapped heavily (nested momentum lookbacks; same
// volume-before-price thesis). Seven pills now cover seven distinct regimes:
//   1W 20%  — fresh explosive momentum (early catches)
//   Combo   — sustained conviction: 2+ of the five momentum legs (legs live on
//             below as MOM_LEGS so Combo's cross-check is unchanged)
//   Strong  — fundamentals (EPS/Sales ≥25%) + buyable position near MAs
//   Gap4%+  — today's episodic-pivot candidates (only intraday preset)
//   Accum   — volume-before-price: Stealth ∪ ACCUM-Stack merged
//   Dry-Up  — volume-contraction consolidation (pre-breakout)
//   Reset   — 🪃 leader pulled back to the 20dma on dry volume (Signal-alert twin)
// Each preset returns true if a stock matches. Filters are applied AFTER the
// global default filters (NoBio, ADR, dvol) so a preset can be combined with them.
const MOM_LEGS = {
  "1w20": (s) =>
    (s.return_1w || 0) >= 20 &&
    (s.price || s.close || 0) >= 5 &&
    (s.avg_volume_raw || 0) >= 100_000,
  "1m20": (s) =>
    (s.return_1m || 0) >= 20 &&
    (s.price || s.close || 0) >= 5 &&
    (s.avg_volume_raw || 0) >= 100_000,
  strongest: (s) => {
    const aboveLow = s.above_52w_low || 0;
    const eps = s.eps_yoy || 0;
    const sales = s.sales_yoy || 0;
    const sma20 = s.sma20_pct || 0;
    const sma50 = s.sma50_pct || 0;
    return aboveLow >= 70 && (eps >= 25 || sales >= 25) && sma20 >= -2 && sma20 <= 18 && sma50 >= -3;
  },
  mom3m: (s) => {
    const r = s.return_3m || 0;
    const mc = s.market_cap_raw || 0;
    const aboveLow = s.above_52w_low || 0;
    const sma20 = s.sma20_pct || 0;
    const adr = s.adr_pct || 0;
    return r >= 70 && mc >= 300e6 && aboveLow >= 50 && sma20 >= 0 && sma20 <= 20 && adr >= 3;
  },
  mom6m: (s) => {
    const r = s.return_6m || 0;
    const mc = s.market_cap_raw || 0;
    const aboveLow = s.above_52w_low || 0;
    const sma20 = s.sma20_pct || 0;
    const adr = s.adr_pct || 0;
    return r >= 100 && mc >= 300e6 && aboveLow >= 50 && sma20 >= 0 && sma20 <= 20 && adr >= 3;
  },
};

const PRESETS = {
  reset: {
    label: "Reset",
    desc:
      "🪃 Leader reset: RS ≥ 90 name pulled back to the 20dma (within ±1 ATR) on dry volume (RVol ≤ 0.9), still above the 50sma, not breaking down (day > -2.5%). $Vol ≥ $10M. The scan-pill twin of the 🪃 Signal alert — buy leaders at logical support, not extended.",
    color: "#22d3ee",
    test: (s) => {
      const rs = s.rs_rank || 0;
      const d20 = s.dist_20dma_atrx;
      const d50 = s.dist_50sma_atrx;
      if (rs < 90 || d20 == null || d50 == null) return false;
      const rv = s.rel_volume ?? 1;
      const chg = s.change_pct || 0;
      const dv = s.avg_dollar_vol_raw || 0;
      return Math.abs(d20) <= 1 && d50 > 0 && rv <= 0.9 && chg > -2.5 && dv >= 10e6;
    },
  },
  tight: {
    label: "T2 Tight",
    desc:
      "2-Days-Tight + momentum leg (Wiedmaier): last two closes within 1% AND narrowing range, above the 50sma — AND a prior momentum leg (≥20%/1m, ≥10%/1w, or RS ≥ 85), per the book's 'minimum 20% leg before consolidation qualifies as a momentum setup'. The bull-flag coil: tonight's list of tomorrow's breakout candidates. \$Vol ≥ 10M.",
    color: "#f472b6",
    test: (s) => !!s.two_day_tight && (s.avg_dollar_vol_raw || 0) >= 10e6 && (s.price || s.close || 0) >= 5 &&
      ((s.return_1m || 0) >= 20 || (s.return_1w || 0) >= 10 || (s.rs_rank || 0) >= 85),
  },
  combo: {
    label: "Combo",
    desc:
      "Sustained momentum conviction: matches 2+ of the five legs (1W 20%, 1M 20%, Strong, 3M ≥70%, 6M ≥100%). The overlap = highest conviction — replaces the old separate 1M/3M/6M pills.",
    color: "#0ea5e9",
    test: (s) => {
      let hits = 0;
      for (const k in MOM_LEGS) if (MOM_LEGS[k](s)) hits++;
      return hits >= 2;
    },
  },
  "1w20": {
    label: "1W 20%",
    desc:
      "Stocks up 20%+ in the last week. Price ≥ $5, avg volume ≥ 100K. Catches explosive breakouts early — the freshest momentum.",
    color: "#0ea5e9",
    test: MOM_LEGS["1w20"],
  },
  strongest: {
    label: "Strong",
    desc:
      "70%+ above 52W low, EPS or Sales growth ≥ 25%, near moving averages (SMA20 -2% to 18%, SMA50 ≥ -3%). The fundamentals + buyable-position preset.",
    color: "#0ea5e9",
    test: MOM_LEGS.strongest,
  },
  accum: {
    label: "Accum",
    desc:
      "Volume-before-price accumulation (Stealth ∪ ACCUM Stack merged): stealth_score ≥ 50 (20d $vol climbing much faster than price over 90d), OR 20d ADV up ≥ 100% crossed with insider cluster buying / 3+ EPS beats / RS ≥ 95. $Vol ≥ $20M, MCap ≥ $300M.",
    color: "#a78bfa",
    test: (s) => {
      const dv = s.avg_dollar_vol_raw || 0;
      const mc = s.market_cap_raw || 0;
      if (dv < 20e6 || mc < 300e6) return false;
      if ((s.stealth_score ?? -999) >= 50) return true;
      const advUp = (s.adv_pct_90d || 0) >= 100;
      const confirmed = !!s.insider_cluster_buy || (s.positive_surprise_streak || 0) >= 3 || (s.rs_rank || 0) >= 95;
      return advUp && confirmed;
    },
  },
  de: {
    label: "DE Ready",
    desc:
      "Delayed Entry ready (Wiedmaier): gapped up 2-7 days ago, still holding the gap, last two closes tight (≤1%) with narrowing range, above the 4-EMA. The stalk-the-gapper queue — entry is the break of the DE trigger price (hover the orange DE marker or open the drawer to see it). Note: these are flat/tight days by definition — turn OFF the Chg>0% toggle or most will be hidden.",
    color: "#fb923c",
    test: (s) => !!s.de_ready,
  },
  gap4: {
    label: "Gap4%+",
    desc:
      "Gapping up ≥ 4% today with volume > 1.1x average. MCap ≥ $300M, $Vol ≥ $50M. Episodic pivot candidates — the only intraday preset.",
    color: "#22c55e",
    test: (s) => {
      const chg = s.change_pct || 0;
      const rv = s.rel_volume || 0;
      const mc = s.market_cap_raw || 0;
      const dv = s.avg_dollar_vol_raw || 0;
      return chg >= 4 && rv > 1.1 && mc >= 300e6 && dv >= 50e6;
    },
  },
  tt8: {
    label: "TT 8/8",
    desc:
      "Minervini Trend Template — passes ALL 8 stage-2 criteria: price > 150d & 200d MAs · 150d > 200d · 200d rising ≥1 month · 50d > 150d > 200d · price > 50d · ≥30% above the 52w low · within 25% of the 52w high · RS rank ≥ 70. A qualifier, not an entry signal — 99% of superperformance stocks were above their 200d BEFORE the big move. $Vol ≥ $10M.",
    color: "#34d399",
    test: (s) => ttCount(s) === 8 && (s.avg_dollar_vol_raw || 0) >= 10e6,
  },
};

// ── Minervini Trend Template helpers — 7 price criteria arrive from the
// pipeline as a bitmask (tt_mask); the 8th (RS rank ≥ 70) is applied here
// where the cross-sectional rank lives. ttCount → 0-8 or null (no data yet).
const TT_LABELS = [
  "price > 150d & 200d MAs", "150d MA > 200d MA", "200d MA rising ≥1 month",
  "50d > 150d > 200d", "price > 50d MA", "≥30% above 52w low",
  "within 25% of 52w high", "RS rank ≥ 70",
];
function ttCount(s) {
  if (s?.tt_mask == null) return null;
  let n = 0;
  for (let i = 0; i < 7; i++) if (s.tt_mask & (1 << i)) n++;
  return n + ((s.rs_rank || 0) >= 70 ? 1 : 0);
}
function ttFails(s) {
  const out = [];
  for (let i = 0; i < 7; i++) if (!(s?.tt_mask & (1 << i))) out.push(TT_LABELS[i]);
  if ((s?.rs_rank || 0) < 70) out.push(TT_LABELS[7]);
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Style helpers (used by Scan Watch + future panels)
// ──────────────────────────────────────────────────────────────────────────

// Aria's standard pill button — toggleable, green when on
const pillStyle = (on, color = ARIA.green) => ({
  fontSize: 7,
  padding: "1px 5px",
  borderRadius: 3,
  cursor: "pointer",
  fontFamily: "monospace",
  border: `1px solid ${on ? color : ARIA.border}`,
  color: on ? color : ARIA.textMuted,
  background: on ? `${color}26` : "transparent",
  whiteSpace: "nowrap",
});

const numInputStyle = {
  width: 32,
  fontSize: 9,
  padding: "2px 4px",
  background: "rgba(128,128,128,0.14)",
  border: "1px solid rgba(128,128,128,0.25)",
  borderRadius: 3,
  color: "inherit",
  fontFamily: "monospace",
  textAlign: "center",
  outline: "none",
};

// ──────────────────────────────────────────────────────────────────────────
// ErrorBoundary
// ──────────────────────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: null, info: null };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, err };
  }
  componentDidCatch(err, info) {
    console.error("ErrorBoundary caught:", err, info);
    // Capture the component stack so we can display it
    this.setState({ info });
  }
  render() {
    if (this.state.hasError) {
      const stack = this.state.info?.componentStack || "";
      // Find the most-derived (first) custom component name in the stack
      // Lines look like: "    at ChartPanelInline (https://...)"
      const lines = stack.split("\n").filter((l) => l.trim().startsWith("at "));
      const firstLine = lines[0] || "";
      const m = firstLine.match(/at\s+(\w+)/);
      const culprit = m ? m[1] : "unknown";
      return (
        <div style={{ padding: 16, color: ARIA.red, fontFamily: "monospace" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            Render error in <span style={{ color: ARIA.yellow }}>{culprit}</span>
          </div>
          <div style={{ fontSize: 10, color: ARIA.textDim, marginBottom: 8 }}>
            {String(this.state.err)}
          </div>
          {stack && (
            <details style={{ marginBottom: 8 }}>
              <summary
                style={{
                  fontSize: 9,
                  color: ARIA.textMuted,
                  cursor: "pointer",
                }}
              >
                Component stack (top 8)
              </summary>
              <pre
                style={{
                  fontSize: 9,
                  color: ARIA.textDim,
                  background: ARIA.bg,
                  padding: 8,
                  borderRadius: 4,
                  overflow: "auto",
                  maxHeight: 200,
                  marginTop: 4,
                  whiteSpace: "pre-wrap",
                }}
              >
                {lines.slice(0, 8).join("\n")}
              </pre>
            </details>
          )}
          <button
            onClick={() =>
              this.setState({ hasError: false, err: null, info: null })
            }
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: `1px solid ${ARIA.green}`,
              color: ARIA.green,
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Data fetching hooks
// ──────────────────────────────────────────────────────────────────────────

function useDashboardData() {
  const [data, setData] = useState({
    loading: true,
    error: null,
    pipeline: null,
  });

  useEffect(() => {
    let cancelled = false;
    let lastFetchMs = 0;
    // The pipeline refreshes dashboard_data.json every ~30 min, 6:00 AM–5:30 PM
    // ET Mon–Fri. Poll on that cadence so an open tab picks up new movers/EP/
    // scan data without a manual reload; skip polls outside the pipeline window.
    const inPipelineWindow = () => {
      const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
      return day >= 1 && day <= 5 && mins >= 360 && mins <= 1050; // 6:00–17:30 ET
    };
    const load = (isRefresh = false) => {
      lastFetchMs = Date.now();
      fetch("/dashboard_data.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((pipeline) => {
          if (cancelled) return;
          setData((prev) => {
            // On background refreshes, only re-render when the pipeline
            // actually produced a new run (avoids churn on no-op polls).
            if (isRefresh && pipeline && prev.pipeline &&
                pipeline.pipeline_meta?.last_run === prev.pipeline.pipeline_meta?.last_run) return prev;
            if (isRefresh && !pipeline) return prev; // keep stale data over an error blip
            return { loading: false, error: pipeline ? null : "Failed to load dashboard_data.json", pipeline };
          });
        })
        .catch(() => {
          if (cancelled) return;
          setData((prev) => (isRefresh && prev.pipeline) ? prev
            : { loading: false, error: "Failed to load dashboard_data.json", pipeline: null });
        });
    };
    load();
    const iv = setInterval(() => { if (inPipelineWindow()) load(true); }, 30 * 60 * 1000);
    // Coming back to the tab after a while → catch up immediately.
    const onVis = () => {
      if (document.visibilityState === "visible" && inPipelineWindow() && Date.now() - lastFetchMs > 10 * 60 * 1000) load(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return data;
}

// Lazy-loads /dollar_vol_history.json (built by pipeline 09e_dvol_history.py).
// Shape: { as_of, window_days, tickers: { TICKER: { start, adv_m: [...] } } }.
// Fetched once per session; cached at the module level so re-mounts don't refetch.
let _dvolHistoryCache = null;
let _dvolHistoryPromise = null;
function useDvolHistory() {
  const [history, setHistory] = useState(_dvolHistoryCache);
  useEffect(() => {
    if (_dvolHistoryCache) return;
    if (!_dvolHistoryPromise) {
      _dvolHistoryPromise = fetch("/dollar_vol_history.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((d) => {
          _dvolHistoryCache = d || { tickers: {} };
          return _dvolHistoryCache;
        });
    }
    _dvolHistoryPromise.then((d) => setHistory(d));
  }, []);
  return history;
}

// Polls the three picks endpoints (Phase 4). Falls back to static JSON files
// in /public/ if the live endpoints return empty/error — useful for local dev
// before the Vercel KV env vars are set up.

// Closing range %: where the last *completed* daily bar's CLOSE sits within
// that bar's high-low range. 100 = closed at high (strong buyer demand),
// 0 = closed at low (sellers in control), 50 = mid-range.
//
// During RTH the live quote's "price" is the current intraday quote, NOT a
// close — using it would give "current range location," a different concept.
// So we PREFER the pipeline's cr_pct (computed on the most recent completed
// daily bar). Live calc is a fallback only for tickers the pipeline doesn't
// cover, and is most meaningful after market close.
// Always clamped to [0, 100], rounded to integer. Null when no usable data.
function computeCR(q, s) {
  if (s?.cr_pct != null && !isNaN(s.cr_pct)) {
    return Math.max(0, Math.min(100, Math.round(s.cr_pct)));
  }
  const price = q?.price ?? s?.price ?? s?.close ?? null;
  const high = q?.dayHigh ?? q?.high ?? null;
  const low = q?.dayLow ?? q?.low ?? null;
  if (price != null && high != null && low != null && high > low && !isNaN(price)) {
    const raw = ((price - low) / (high - low)) * 100;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }
  return null;
}

// ── Centralized live-quote manager ──
// All useLiveQuotes() calls register their tickers here. One batched fetch
// runs every 30s during market hours (9:30-4 ET weekdays), 120s in extended
// hours (4AM-9:30 + 4-8PM ET), and pauses entirely on weekends and overnight.
// This replaces 13 independent polling loops with a single API call.
const _quoteManager = {
  subscribers: new Map(),   // id → Set<ticker>
  cache: new Map(),         // ticker → quoteObj
  updated: null,
  listeners: new Set(),     // () => void callbacks
  timer: null,
  nextId: 0,
  fetching: false,

  register(tickers) {
    const id = ++this.nextId;
    this.subscribers.set(id, new Set(tickers));
    this._ensurePolling();
    // If any newly registered tickers aren't cached yet, schedule a
    // one-time fetch so weekend/overnight pages still get data.
    if (tickers.some((t) => !this.cache.has(t))) {
      setTimeout(() => this._fetch(), 300);
    }
    return id;
  },

  update(id, tickers) {
    this.subscribers.set(id, new Set(tickers));
    if (tickers.some((t) => !this.cache.has(t))) {
      setTimeout(() => this._fetch(), 300);
    }
  },

  unregister(id) {
    this.subscribers.delete(id);
    if (this.subscribers.size === 0) this._stopPolling();
  },

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  _notify() {
    this.listeners.forEach((fn) => fn());
  },

  _getAllTickers() {
    const all = new Set();
    this.subscribers.forEach((set) => set.forEach((t) => all.add(t)));
    return [...all];
  },

  _getInterval() {
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = et.getDay();
    if (day === 0 || day === 6) return 0; // weekend — don't poll
    const mins = et.getHours() * 60 + et.getMinutes();
    if (mins >= 570 && mins <= 960) return 30000;  // 9:30 AM - 4:00 PM ET → 30s
    if (mins >= 240 && mins < 570) return 120000;   // 4:00 AM - 9:30 AM ET (pre-market) → 2min
    if (mins > 960 && mins <= 1200) return 120000;   // 4:00 PM - 8:00 PM ET (after-hours) → 2min
    return 0; // overnight — don't poll
  },

  async _fetch() {
    if (this.fetching) return;
    if (typeof document !== "undefined" && document.hidden) return; // hidden tab — save FMP data
    const tickers = this._getAllTickers();
    if (tickers.length === 0) return;
    this.fetching = true;
    try {
      // FMP batch-quote caps at 500; split if needed
      const batches = [];
      for (let i = 0; i < tickers.length; i += 500) {
        batches.push(tickers.slice(i, i + 500).join(","));
      }
      for (const batch of batches) {
        const r = await fetch(`/api/live?universe=${encodeURIComponent(batch)}`);
        if (!r.ok) continue;
        const d = await r.json();
        const arr = d.theme_universe || d.universe || [];
        arr.forEach((q) => { if (q?.ticker) this.cache.set(q.ticker, q); });
      }
      this.updated = new Date();
      this._notify();
    } catch { /* ignore */ }
    this.fetching = false;
  },

  _ensurePolling() {
    if (this.timer) return;
    const tick = () => {
      const interval = this._getInterval();
      if (interval === 0) {
        this.timer = setTimeout(tick, 60000); // re-check in 1 min
        return;
      }
      this._fetch();
      this.timer = setTimeout(tick, interval);
    };
    this._fetch(); // immediate first fetch
    const interval = this._getInterval();
    this.timer = setTimeout(tick, interval || 60000);
  },

  _stopPolling() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  },
};

function useLiveQuotes(tickers, _intervalMs) {
  // _intervalMs is ignored — the central manager controls timing
  const [, forceUpdate] = useState(0);
  const idRef = useRef(null);

  const tickerList = useMemo(
    () => (tickers || []).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(tickers || []).slice().sort().join(",")]
  );

  useEffect(() => {
    if (tickerList.length === 0) return;
    if (idRef.current == null) {
      idRef.current = _quoteManager.register(tickerList);
    } else {
      _quoteManager.update(idRef.current, tickerList);
    }
    const unsub = _quoteManager.subscribe(() => forceUpdate((n) => n + 1));
    return () => {
      unsub();
      if (idRef.current != null) {
        _quoteManager.unregister(idRef.current);
        idRef.current = null;
      }
    };
  }, [tickerList]);

  const quotes = useMemo(() => {
    const m = new Map();
    tickerList.forEach((t) => {
      const q = _quoteManager.cache.get(t);
      if (q) m.set(t, q);
    });
    return m;
  }, [tickerList, _quoteManager.updated]);

  return { quotes, updated: _quoteManager.updated };
}

// generic benchmark period returns (1w/1m) from OHLC — cached per symbol.
// Used by the Tech tab to convert vs-SPY columns to vs-QQQ.
const _benchRetCache = {};
function useBenchReturns(sym) {
  const [ret, setRet] = useState(_benchRetCache[sym]?.data || null);
  useEffect(() => {
    const c = _benchRetCache[sym] || (_benchRetCache[sym] = { data: null, promise: null });
    if (c.data) { setRet(c.data); return; }
    if (!c.promise) {
      c.promise = fetch(`/api/ohlc?ticker=${encodeURIComponent(sym)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const bars = d?.ohlc;
          if (!bars?.length) return null;
          const last = bars[bars.length - 1];
          const pct = (idx) => { const b = bars[idx]; return b ? Math.round((last.close - b.close) / b.close * 10000) / 100 : null; };
          c.data = { "1w": pct(Math.max(0, bars.length - 6)), "1m": pct(Math.max(0, bars.length - 22)) };
          return c.data;
        }).catch(() => null);
    }
    let alive = true;
    c.promise.then((v) => { if (alive && v) setRet(v); });
    return () => { alive = false; };
  }, [sym]);
  return ret;
}

// ── SPY period returns (1W / 1M / 3M) from OHLC — cached, one fetch ────
const _spyReturnsCache = { data: null, promise: null };
function useSpyReturns() {
  const [returns, setReturns] = useState(_spyReturnsCache.data);
  useEffect(() => {
    if (_spyReturnsCache.data) { setReturns(_spyReturnsCache.data); return; }
    if (!_spyReturnsCache.promise) {
      _spyReturnsCache.promise = fetch("/api/ohlc?ticker=SPY")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          const bars = d?.ohlc;
          if (!bars?.length) return null;
          const last = bars[bars.length - 1];
          const pct = (idx) => {
            const bar = bars[idx];
            return bar ? Math.round((last.close - bar.close) / bar.close * 10000) / 100 : null;
          };
          const ret = {
            "1w": pct(Math.max(0, bars.length - 6)),
            "1m": pct(Math.max(0, bars.length - 22)),
            "3m": pct(Math.max(0, bars.length - 64)),
          };
          _spyReturnsCache.data = ret;
          return ret;
        })
        .catch(() => null);
    }
    _spyReturnsCache.promise.then((r) => { if (r) setReturns(r); });
  }, []);
  return returns;
}

// ──────────────────────────────────────────────────────────────────────────
// Market Breadth Bar
// ──────────────────────────────────────────────────────────────────────────

const INDEX_LIST = [
  { ticker: "DIA", name: "DOW" },
  { ticker: "QQQ", name: "QQQ" },
  { ticker: "SPY", name: "S&P 500" },
  { ticker: "IWM", name: "RUSSELL" },
  { ticker: "IBIT", name: "BTC" },
  { ticker: "^VIX", name: "VIX", kind: "vix" },
];

function MarketBreadthBar({ stocks, onTickerClick }) {
  const ARIA = useAriaTheme();
  // Live index quotes via existing /api/live (poll every 30s during market hours)
  const indexTickers = useMemo(() => INDEX_LIST.map((i) => i.ticker), []);
  const { quotes } = useLiveQuotes(indexTickers, 30000);

  // Live breadth universe — top 500 stocks from the pipeline by dollar
  // volume. FMP batch-quote caps at 500 tickers per call; the browser
  // coalesces the request with ScanWatch's poll since the URL matches.
  const breadthTickers = useMemo(() => {
    if (!stocks || !stocks.length) return [];
    return stocks
      .slice()
      .sort((a, b) => (b.avg_dollar_vol_raw || 0) - (a.avg_dollar_vol_raw || 0))
      .slice(0, 500)
      .map((s) => s.ticker);
  }, [stocks]);
  const { quotes: breadthQuotes } = useLiveQuotes(breadthTickers, 30000);

  // Breadth computed from LIVE quotes for the top-500 universe. Falls back
  // to the pipeline snapshot's `change_pct` when a live quote isn't in yet.
  // H/L is 52-week — still derived from the static snapshot since off_52w_high
  // isn't computable from a live quote alone.
  const breadth = useMemo(() => {
    if (!stocks || !stocks.length) return null;
    // Only count stocks that are in the live universe so A/D is a fair
    // comparison against the same set for which we have fresh data.
    const liveSet = new Set(breadthTickers);
    const scope = liveSet.size > 0 ? stocks.filter((s) => liveSet.has(s.ticker)) : stocks;
    let adv = 0,
      dec = 0,
      nh = 0,
      nl = 0;
    scope.forEach((s) => {
      const q = breadthQuotes.get(s.ticker);
      const c = q?.change != null ? q.change : s.change_pct || 0;
      if (c > 0) adv++;
      else if (c < 0) dec++;
      // Live H/L — uses FMP yearHigh/yearLow + current price. Falls back to
      // the pipeline snapshot's off_52w_high / above_52w_low when a live
      // quote hasn't arrived yet. Thresholds match the old logic (within 2%
      // of 52W high / 52W low).
      const price = q?.price ?? null;
      const yHi = q?.yearHigh ?? null;
      const yLo = q?.yearLow ?? null;
      let nearHi = null, nearLo = null;
      if (price && yHi && yHi > 0) nearHi = ((price - yHi) / yHi) * 100;
      if (price && yLo && yLo > 0) nearLo = ((price - yLo) / yLo) * 100;
      if (nearHi == null) nearHi = s.off_52w_high;
      if (nearLo == null) nearLo = s.above_52w_low;
      if (nearHi != null && nearHi >= -2) nh++;
      if (nearLo != null && nearLo <= 2) nl++;
    });
    // Percentages are relative to advancers+decliners (ignore unchanged)
    // so A/D and H/L read naturally as "of those moving, X% were up".
    const adPool = adv + dec || 1;
    const hlPool = nh + nl || 1;
    return {
      n: scope.length,
      advCount: adv,
      decCount: dec,
      advPct: Math.round((adv / adPool) * 100),
      decPct: Math.round((dec / adPool) * 100),
      nhCount: nh,
      nlCount: nl,
      nhPct: Math.round((nh / hlPool) * 100),
      nlPct: Math.round((nl / hlPool) * 100),
    };
  }, [stocks, breadthTickers, breadthQuotes]);

  const renderIndex = (idx) => {
    const q = quotes.get(idx.ticker);
    const chg = q?.change ?? null;
    const price = q?.price ?? null;
    const arrow = chg == null ? "" : chg > 0 ? "▲" : chg < 0 ? "▼" : "";
    // VIX: rising volatility = risk-off, so up is red / down is green. Show the
    // level (a % move on VIX is meaningless) plus the day's change.
    if (idx.kind === "vix") {
      const vc = chg == null ? ARIA.textMuted : chg > 0 ? ARIA.red : chg < 0 ? ARIA.green : ARIA.textMuted;
      return (
        <div key={idx.ticker} title="CBOE Volatility Index — up = risk-off"
          style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
          <span style={{ fontWeight: 700, fontSize: 9, color: ARIA.text }}>VIX</span>
          <span style={{ fontWeight: 700, fontSize: 9, color: vc }}>{price != null ? price.toFixed(1) : "—"}</span>
          {chg != null && <span style={{ fontSize: 8, color: vc }}>{arrow}{Math.abs(chg).toFixed(1)}%</span>}
        </div>
      );
    }
    const c = chg == null ? ARIA.textMuted : chg > 0 ? ARIA.green : chg < 0 ? ARIA.red : ARIA.textMuted;
    return (
      <div key={idx.ticker} onClick={(e) => { e.stopPropagation(); onTickerClick && onTickerClick(idx.ticker); }}
        style={{ display: "flex", alignItems: "baseline", gap: 4, cursor: "pointer" }}>
        <span style={{ fontWeight: 700, fontSize: 9, color: ARIA.text }}>{idx.name}</span>
        <span style={{ fontWeight: 700, fontSize: 9, color: c }}>
          {chg == null ? "—" : `${arrow} ${Math.abs(chg).toFixed(2)}%`}
        </span>
      </div>
    );
  };

  const miniBar = (label, leftPct, leftCount, rightPct, rightCount, tip) => (
    <div
      title={tip}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        fontSize: 8,
        cursor: "help",
      }}
    >
      <span style={{ color: ARIA.textMuted }}>{label}</span>
      <span style={{ color: ARIA.green, fontWeight: 700 }}>{leftPct}%</span>
      <span style={{ color: ARIA.textMuted }}>({leftCount})</span>
      <div
        style={{
          width: 40,
          height: 3,
          borderRadius: 2,
          background: ARIA.red,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${leftPct}%`,
            height: "100%",
            background: ARIA.green,
            borderRadius: 2,
          }}
        />
      </div>
      <span style={{ color: ARIA.textMuted }}>({rightCount})</span>
      <span style={{ color: ARIA.red, fontWeight: 700 }}>{rightPct}%</span>
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        fontFamily: "monospace",
        fontSize: 9,
      }}
    >
      <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
        {INDEX_LIST.map(renderIndex)}
      </div>
      {breadth && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
          title="Breadth of the top-500 (by $vol) universe, live — since previous close. A/D % is relative to advancers+decliners; H/L % to 52W highs+lows."
        >
          {miniBar(
            "A/D",
            breadth.advPct,
            breadth.advCount,
            breadth.decPct,
            breadth.decCount,
            `Advance / Decline — of the top-500 liquid stocks moving today, ${breadth.advCount} are up (${breadth.advPct}%) vs ${breadth.decCount} down (${breadth.decPct}%). >50% green = broad participation to the upside.`
          )}
          {miniBar(
            "H/L",
            breadth.nhPct,
            breadth.nhCount,
            breadth.nlPct,
            breadth.nlCount,
            `New Highs / Lows — ${breadth.nhCount} stocks are within 2% of their 52-week high (${breadth.nhPct}%) vs ${breadth.nlCount} near their 52-week low (${breadth.nlPct}%). High % = leaders pushing to new highs, not breaking down.`
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Market Breadth Monitor — compact regime strip + slide-out SPY regime chart
// ──────────────────────────────────────────────────────────────────────────
//
// Mirrors the nvst.ing/breadth monitor: PRIMARY/SECONDARY regime badges, the
// %-above-MA breadth thermometers (computed live from the snapshot's
// dist_NNdma_atrx sign), and a slide-out SPY line colored by trend regime
// (green = price ≥ weekly-20 & daily-10 ≥ daily-20; yellow = daily-10 < daily-20;
// red = price < weekly-20). Lazy-fetches SPY OHLC only when expanded.
// Short blurb per regime-chart symbol — what it tracks + how to read it.
const INDEX_INFO = {
  SPY: { name: "S&P 500", role: "Risk-on", roleColor: "#16a34a", blurb: "500 large-cap US stocks — the broad-market benchmark, mega-cap weighted. The baseline tape; green here = broad risk appetite." },
  QQQ: { name: "Nasdaq-100", role: "Risk-on", roleColor: "#16a34a", blurb: "100 largest non-financial Nasdaq names — tech/growth heavy, higher beta. Leads both ways; rolls before SPY at tops." },
  IWM: { name: "Russell 2000", role: "Risk-on", roleColor: "#16a34a", blurb: "Small-cap US stocks — the risk-appetite canary. Breadth here cracks first; green while SPY rolls = risk still on under the surface." },
  XLV: { name: "Health Care SPDR", role: "Defensive", roleColor: "#60a5fa", blurb: "Pharma, biotech, devices, insurers. Classic defensive bid — green while tech rolls = money rotating to safety." },
  XLU: { name: "Utilities SPDR", role: "Defensive", roleColor: "#60a5fa", blurb: "Regulated utilities — lowest-beta, rate-sensitive. The textbook risk-off hide; leads when growth gets sold." },
  XLP: { name: "Consumer Staples SPDR", role: "Defensive", roleColor: "#60a5fa", blurb: "Food, beverage, household staples — steady demand. Defensive ballast; relative strength here signals caution." },
  GLD: { name: "Gold bullion", role: "Hard asset", roleColor: "#fbbf24", blurb: "Physical gold — crisis/inflation hedge, low correlation to stocks. When red during a selloff, the move is tech-specific, not broad risk-off." },
  GDX: { name: "Gold Miners", role: "Hard asset", roleColor: "#fbbf24", blurb: "Gold-mining equities — a leveraged play on GLD. Amplifies gold's move both ways; confirms or denies a gold trend." },
  SH: { name: "Inverse S&P 500 (−1x)", role: "Hedge", roleColor: "#f472b6", blurb: "Rises when SPY falls. Green = SH trending up = market falling = the hedge is working. Red = market still up, no hedge needed." },
  PSQ: { name: "Inverse Nasdaq-100 (−1x)", role: "Hedge", roleColor: "#f472b6", blurb: "Rises when QQQ falls. Green = the short hedge is working; red = tech still bid. Tactical, not buy-and-hold (decays sideways)." },
};

// Cached daily OHLC fetch (shared across chart selections).
const _ohlcCache = new Map();
async function fetchOhlcBars(ticker) {
  if (_ohlcCache.has(ticker)) return _ohlcCache.get(ticker);
  try {
    const r = await fetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}`);
    const d = r.ok ? await r.json() : null;
    const bars = (d?.ohlc || []).filter((x) => x.close != null);
    _ohlcCache.set(ticker, bars);
    return bars;
  } catch {
    _ohlcCache.set(ticker, []);
    return [];
  }
}

// ── MagnaDetail — MAGNA53 + CAP10*10 breakdown for one ER Cal reporter ──
// Rendered in the regime box's left column when a calendar chip is clicked.
// Reported names show the pipeline's actual flags; upcoming names show the
// knowable-in-advance half (A + N) with M/G pending the report.
function MagnaDetail({ ticker, mv, stockMap, ARIA, onClose, onChart }) {
  const s = stockMap?.[ticker] || {};
  const er = mv?.er || {};
  const fmt = (v, d = 1) => v == null ? "—" : `${v > 0 ? "+" : ""}${(+v).toFixed(d)}`;
  const sales = er.rev_growth_yoy ?? s.sales_yoy, salesPrev = s.sales_yoy_prev;
  const epsG = er.eps_growth_yoy ?? s.eps_yoy;
  const eps = er.eps, epsEst = er.eps_estimated ?? s.eps_estimated;
  const revM = er.revenue != null ? er.revenue / 1e6 : null;
  const surPct = (eps != null && epsEst != null && epsEst !== 0) ? (eps - epsEst) / Math.abs(epsEst) * 100 : null;
  const surAbs = (eps != null && epsEst != null) ? eps - epsEst : null;
  const reported = !!mv;
  const flags = new Set(mv?.magna_flags || []);
  const genuine = mv?.genuine_ep || mv?.magna_score === 4;
  const chg = mv ? (mv.change_pct ?? mv.ext_hours_change_pct) : null;
  // pre-ER checks mirror the pipeline thresholds
  const aOk = reported ? flags.has("A") : (sales != null && (sales >= 25 || (sales >= 29 && salesPrev != null && salesPrev >= 29)));
  const nOk = reported ? flags.has("N") : ((s.return_1m == null || s.return_1m < 20) && (s.inst_own_pct == null || s.inst_own_pct < 40 || (s.inst_holder_count != null && s.inst_holder_count < 300)));
  const cap10 = s.market_cap_raw > 0 && s.market_cap_raw < 10e9;
  const ipo10 = s.ipo_date ? (Date.now() - new Date(s.ipo_date).getTime()) < 3652 * 864e5 : false;
  const bonus = [...new Set([cap10 && "CAP10", ipo10 && "IPO<10y", ...(mv?.magna_bonus || []).map((b) => b === "AN3" ? "3+ UPGRADES" : b === "IPO10" ? "IPO<10y" : b)].filter(Boolean))];
  const erDays = s.earnings_days;
  const Row = ({ ok, letter, label, detail }) => (
    <div style={{ padding: "4px 0", borderBottom: `1px solid ${ARIA.border}40` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 800, width: 12, color: ok === true ? ARIA.green : ok === false ? ARIA.red : ARIA.textMuted }}>{letter}</span>
        <span style={{ fontSize: 8, fontWeight: 700, color: ARIA.textDim, flex: 1 }}>{label}</span>
        <span style={{ fontSize: 9, fontWeight: 800, color: ok === true ? ARIA.green : ok === false ? ARIA.red : ARIA.textMuted }}>{ok === true ? "✓" : ok === false ? "✗" : "?"}</span>
      </div>
      <div style={{ fontSize: 7.5, color: ARIA.textMuted, lineHeight: 1.45, paddingLeft: 17 }}>{detail}</div>
    </div>
  );
  return (
    <div style={{ fontFamily: "monospace", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span onClick={() => onChart?.(ticker)} style={{ fontSize: 11, fontWeight: 800, color: ARIA.blue, cursor: "pointer" }} title="Chart it">{ticker}</span>
        {reported
          ? <span style={{ fontSize: 8, fontWeight: 800, color: genuine ? ARIA.yellow : (mv.magna_score ?? 0) >= 3 ? ARIA.green : ARIA.textDim }}>{genuine ? "GENUINE EP" : `MAGNA ${mv.magna_score ?? 0}/4`}</span>
          : <span style={{ fontSize: 8, fontWeight: 700, color: ARIA.cyan }}>{aOk && nOk ? "🎯 EP SETUP" : "PRE-ER"}</span>}
        <span onClick={onClose} title="Back to holdings" style={{ marginLeft: "auto", fontSize: 9, color: ARIA.textMuted, cursor: "pointer", padding: "0 3px" }}>✕</span>
      </div>
      <div style={{ fontSize: 7.5, color: ARIA.textMuted, marginBottom: 4 }}>
        {reported
          ? <>reported {chg != null ? <span style={{ color: chg > 0 ? ARIA.green : ARIA.red, fontWeight: 700 }}>{fmt(chg, 1)}%</span> : ""}{mv.ep_quality_label ? ` · ${mv.ep_quality_label}` : ""}{mv.sizing_guide ? ` · size ${mv.sizing_guide}` : ""}</>
          : <>reports {erDays == null ? "—" : erDays === 0 ? "today" : erDays > 0 ? `in ${erDays}d` : `${-erDays}d ago`}{s.avg_er_move ? ` · avg move ±${s.avg_er_move.toFixed(1)}%` : ""}</>}
      </div>
      <Row ok={reported ? flags.has("M") : null} letter="M" label="Massive acceleration"
        detail={<>
          EPS gr {fmt(epsG, 0)}% · sales {fmt(sales, 0)}%{revM != null ? ` on $${revM.toFixed(0)}M qtr` : ""}
          {surPct != null ? <> · surprise {fmt(surPct, 0)}% ({fmt(surAbs, 2)}/sh)</> : null}
          {reported ? null : <> — needs 100%+ on meaningful terms (or 29%+ ×2Q on $25M+ annual)</>}
        </>} />
      <Row ok={aOk} letter="A" label="Sales acceleration"
        detail={<>sales {fmt(sales, 0)}% YoY, prev {fmt(salesPrev, 0)}% — need ≥25% (or 29%×2Q); turnaround waives</>} />
      <Row ok={reported ? flags.has("G") : null} letter="G" label="Gap up"
        detail={reported
          ? <>moved {fmt(chg, 1)}%{mv.volume ? ` on ${(mv.volume / 1e6).toFixed(1)}M shares` : ""} — needs ≥4% on ≥100K</>
          : <>unknown until report — needs ≥4% AH/PM gap on ≥100K volume</>} />
      <Row ok={nOk} letter="N" label="Neglect"
        detail={<>1m {fmt(s.return_1m, 0)}% (20%+ rally-in kills) · inst {s.inst_own_pct != null ? `${s.inst_own_pct.toFixed(0)}%` : "?"}{s.inst_holder_count != null ? ` · ${s.inst_holder_count} holders` : ""}</>} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 5 }}>
        {bonus.map((b) => <span key={b} style={{ fontSize: 6.5, fontWeight: 800, color: ARIA.yellow, border: `1px solid ${ARIA.yellow}55`, background: `${ARIA.yellow}14`, borderRadius: 3, padding: "1px 4px" }}>{b}</span>)}
        <span title="Short-interest days-to-cover >5 — in the framework but unscored (no SI data on the current FMP plan)" style={{ fontSize: 6.5, color: ARIA.textMuted, border: `1px solid ${ARIA.border}`, borderRadius: 3, padding: "1px 4px" }}>SI5 n/a</span>
      </div>
      <div style={{ fontSize: 6.5, color: ARIA.textMuted, marginTop: 5, lineHeight: 1.5 }}>
        MAGNA 4/4 = genuine EP (2-5/yr) · bonus nice-to-have · sales &gt; profitability
      </div>
    </div>
  );
}

// IndexRegimeChart — layer/index constituents panel + the rotation board's
// right panel. (The regime price graph itself was removed 2026-07 — the ticker
// chart covers charting; this box is now the list + tables container.)
function IndexRegimeChart({ sym, setSym, rightPanel, rightRail, holdingsOverride, basket, basketLabel, onChartTicker, liveQuotes, zvrMap, stockMap, heldTint, erDetail, onErClose }) {
  const deckSet = useOnDeckSet();
  const ARIA = useAriaTheme();
  const [holdings, setHoldings] = useState(null); // { sym, list: [{ticker, weight, name}] }
  const [hSort, setHSort] = useState({ key: "rs", dir: "desc" }); // layer-constituents panel sort (default RS desc)
  // Keyboard nav for the left constituents list: ↑/↓ move a selection and chart it.
  const [selCon, setSelCon] = useState(null);
  const conListRef = useRef(null);
  const conOrderRef = useRef([]); // current sorted ticker order (written in render)
  const onConKey = useCallback((e) => {
    const order = conOrderRef.current;
    if (!order.length || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const cur = selCon ? order.indexOf(selCon) : -1;
    let next = cur < 0 ? 0 : cur + (e.key === "ArrowDown" ? 1 : -1);
    next = Math.max(0, Math.min(order.length - 1, next));
    const t = order[next];
    setSelCon(t);
    onChartTicker?.(t);
    const el = conListRef.current?.querySelector(`[data-ct="${t}"]`);
    if (el) scrollRowIntoScroller(el);
  }, [selCon, onChartTicker]);
  // Vertical size of the regime chart (drag handle at the box's bottom edge);
  // persisted so the box reopens at the same height. Tall by default so the
  // regime box fills the Sector Rotation container; drag up to 900px.
  const H_DEFAULT = 440, H_MIN = 160, H_MAX = 900;
  const [chartH, setChartH] = useState(() => {
    try { const v = parseInt(localStorage.getItem("tp-regime-h2") || String(H_DEFAULT), 10); return Math.max(H_MIN, Math.min(H_MAX, isNaN(v) ? H_DEFAULT : v)); } catch { return H_DEFAULT; }
  });
  const startResize = (e) => {
    e.preventDefault();
    const startY = e.clientY, startH = chartH;
    const clampH = (h) => Math.max(H_MIN, Math.min(H_MAX, h));
    const onMove = (ev) => setChartH(clampH(startH + (ev.clientY - startY)));
    const onUp = (ev) => {
      try { localStorage.setItem("tp-regime-h2", String(clampH(startH + (ev.clientY - startY)))); } catch {}
      window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  // Width of the holdings/constituents column (drag handle on its right edge).
  const [holdW, setHoldW] = useState(() => {
    try { const v = parseInt(localStorage.getItem("tp-holdings-w") || "132", 10); return Math.max(100, Math.min(420, isNaN(v) ? 132 : v)); } catch { return 132; }
  });
  const startHoldResize = (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = holdW;
    const clampW = (w) => Math.max(100, Math.min(420, w));
    const onMove = (ev) => setHoldW(clampW(startW + (ev.clientX - startX)));
    const onUp = (ev) => {
      try { localStorage.setItem("tp-holdings-w", String(clampW(startW + (ev.clientX - startX)))); } catch {}
      window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  // Labeling: an equal-weight basket of the layer's constituents, or a
  // single ticker/ETF.
  const isBasket = Array.isArray(basket) && basket.length > 0;
  const label = isBasket ? (basketLabel || "Layer") : sym;

  // Top holdings by weight for the selected index (skipped when a layer's
  // constituents are supplied via holdingsOverride).
  useEffect(() => {
    if (holdingsOverride) return;
    if (holdings && holdings.sym === sym) return;
    fetch(`/api/live?etf=${encodeURIComponent(sym)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHoldings({ sym, list: (d?.holdings || []).slice(0, 10) }))
      .catch(() => setHoldings({ sym, list: [] }));
  }, [sym, holdings, holdingsOverride]);

  return (
    <div style={{ border: `1px solid ${ARIA.border}`, borderRadius: 5, fontFamily: "monospace" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", borderBottom: `1px solid ${ARIA.border}` }}>
        <span style={{ width: 3, height: 11, background: ARIA.blue, borderRadius: 2 }} />
        <span style={{ fontSize: 8, fontWeight: 700, color: ARIA.text, textTransform: "uppercase", letterSpacing: 0.4 }}>{isBasket ? "Layer Regime" : "Index Regime"}</span>
        {isBasket ? (
          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: ARIA.blue }} title={`Equal-weight basket of ${basket.length} constituents (top 15 by RS)`}>{label} · EW basket ({Math.min(15, basket.length)})</span>
        ) : (
          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: ARIA.blue }}>{sym}</span>
        )}
        <span style={{ fontSize: 7.5, color: ARIA.textDim, marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 460 }}>
          {isBasket ? (LAYER_DESC[label] || "click a constituent (left) to chart it below") : ""}
        </span>
      </div>
      <div style={{ padding: "6px 8px", display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
        {/* Left: ETF top-10 by weight, OR layer constituents (RS + live Chg/ZVR/CR).
            Same width in both modes (no jump when switching layer basket ↔
            ticker/ETF); drag the right edge to resize, persisted. */}
        <div style={{ width: erDetail ? Math.max(holdW, 240) : holdW, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          {erDetail ? (
            <MagnaDetail ticker={erDetail.ticker} mv={erDetail.mv} stockMap={stockMap} ARIA={ARIA} onClose={onErClose} onChart={onChartTicker} />
          ) : holdingsOverride ? (
            (() => {
              // Enrich each constituent with live metrics, then sort by the
              // clicked header. Default RS desc.
              // ZVR fallback chain — identical to Scan Watch's calcZVR so the
              // same ticker reads the same value in both tables: true API ZVR →
              // session-elapsed linear estimate → pipeline rel_volume.
              const _et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
              const _etMins = _et.getHours() * 60 + _et.getMinutes();
              const _isRTH = _etMins >= 570 && _etMins < 960;
              const _elapsedFrac = _isRTH ? Math.max(0.02, sessionVolFraction(_etMins - 570)) : 1.0;
              const rows = holdingsOverride.slice(0, 100).map((h) => {
                const q = liveQuotes?.get(h.t); const s = stockMap?.[h.t];
                const chg = q?.change ?? s?.change_pct ?? null;
                const cr = computeCR(q, s);
                let zvr = zvrMap?.get(h.t) ?? null;
                const liveVol = q?.volume; const avgVol = s?.avg_volume_raw || 0;
                if (zvr == null && liveVol && avgVol > 0) zvr = Math.round((liveVol / (avgVol * _elapsedFrac)) * 100);
                if (zvr == null && s?.rel_volume > 0) zvr = Math.round(s.rel_volume * 100);
                if (zvr != null && chg != null && chg < 0) zvr = -zvr;
                const eif = s?.framework_score ?? null;
                const adr = s?.adr_pct ?? null;
                return { ...h, chg, cr, zvr, eif, adr };
              });
              const val = (r) => ({ t: r.t, adr: r.adr, rs: r.s, eif: r.eif, chg: r.chg, zvr: r.zvr, cr: r.cr }[hSort.key]);
              rows.sort((a, b) => {
                const av = val(a), bv = val(b);
                if (hSort.key === "t") return hSort.dir === "asc" ? String(av).localeCompare(bv) : String(bv).localeCompare(av);
                const an = av == null ? -Infinity : av, bn = bv == null ? -Infinity : bv;
                return hSort.dir === "asc" ? an - bn : bn - an;
              });
              conOrderRef.current = rows.map((r) => r.t); // for ↑/↓ keyboard nav
              const onSort = (key) => setHSort((p) => p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "t" ? "asc" : "desc" });
              const arrow = (key) => hSort.key === key ? (hSort.dir === "asc" ? "▲" : "▼") : "";
              const hCell = (key, label, w, flex) => (
                <span onClick={() => onSort(key)} title={`Sort by ${label}`} style={{ ...(flex ? { flex: 1, minWidth: 0 } : { width: w, flexShrink: 0 }), textAlign: flex || key !== "t" ? "right" : "left", cursor: "pointer", color: hSort.key === key ? ARIA.text : ARIA.textMuted, userSelect: "none" }}>{label}{arrow(key) && <span style={{ fontSize: 6 }}> {arrow(key)}</span>}</span>
              );
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", fontSize: 7, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 700, marginBottom: 3, gap: 4 }}>
                    {hCell("t", "Tkr", 36, false)}
                    {hCell("rs", "RS", 0, true)}
                    {hCell("chg", "Chg", 34, false)}
                    {hCell("zvr", "ZVR", 36, false)}
                  </div>
                  <div ref={conListRef} tabIndex={0} onKeyDown={onConKey} title="Click then use ↑/↓ to step through constituents (charts each below)"
                    style={{ maxHeight: chartH - 26, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 2, overflowY: "auto", overscrollBehavior: "contain", outline: "none" }}>
                    {rows.map((h) => {
                      const rc = h.s == null ? ARIA.textMuted : h.s >= 67 ? ARIA.green : h.s >= 33 ? ARIA.blue : ARIA.textDim;
                      const { chg, cr, zvr, eif } = h;
                      const chgC = chg == null ? ARIA.textMuted : chg > 0 ? ARIA.green : chg < 0 ? ARIA.red : ARIA.textMuted;
                      const zvrC = zvr == null ? ARIA.textMuted : Math.abs(zvr) >= 200 ? (zvr < 0 ? "#ef4444" : "#fbbf24") : Math.abs(zvr) >= 130 ? (zvr < 0 ? ARIA.red : ARIA.green) : ARIA.textMuted;
                      return (
                        <div key={h.t} data-ct={h.t} onClick={() => { setSelCon(h.t); onChartTicker?.(h.t); conListRef.current?.focus({ preventScroll: true }); }} title={`${h.t} — RS ${h.s ?? "—"}${h.adr != null ? ` · ADR ${h.adr.toFixed(1)}%` : ""}${eif != null ? ` · EIF ${eif}` : ""}${chg != null ? ` · ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : ""}${zvr != null ? ` · ZVR ${zvr}%` : ""}${cr != null ? ` · CR ${cr}` : ""} (click, then ↑/↓ to step through)`} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, cursor: "pointer", padding: "1px 2px", flexShrink: 0, borderRadius: 2, background: h.t === selCon ? ARIA.blue + "26" : deckSet.has(h.t) ? ARIA.gold + "2e" : heldTint?.has(h.t) ? ARIA.yellow + "14" : "transparent", boxShadow: h.t === selCon ? `inset 2px 0 0 ${ARIA.blue}` : "none" }}
                          onMouseEnter={(e) => { if (h.t !== selCon) e.currentTarget.style.background = ARIA.bgHover || "rgba(255,255,255,0.05)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = h.t === selCon ? ARIA.blue + "26" : deckSet.has(h.t) ? ARIA.gold + "2e" : heldTint?.has(h.t) ? ARIA.yellow + "14" : "transparent"; }}>
                          <span style={{ fontWeight: 700, color: ARIA.blue, width: 36, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{h.t}</span>
                          <span style={{ color: rc, flex: 1, textAlign: "right", fontWeight: h.s != null && h.s >= 88 ? 700 : 400 }}>{h.s ?? "—"}</span>
                          <span style={{ color: chgC, width: 34, textAlign: "right", flexShrink: 0 }}>{chg == null ? "—" : (chg > 0 ? "+" : "") + chg.toFixed(1)}</span>
                          <span style={{ color: zvrC, width: 36, textAlign: "right", flexShrink: 0, fontWeight: zvr != null && Math.abs(zvr) >= 130 ? 700 : 400 }}>{zvr == null ? "—" : zvr + "%"}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()
          ) : (
            <>
              <div style={{ fontSize: 7.5, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>{sym} Top 10 · wt</div>
              {!holdings || holdings.sym !== sym ? (
                <div style={{ fontSize: 8, color: ARIA.textMuted }}>Loading…</div>
              ) : holdings.list.length === 0 ? (
                <div style={{ fontSize: 8, color: ARIA.textMuted }}>No holdings data</div>
              ) : (
                <div style={{ maxHeight: chartH - 8, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 2, overflowY: "auto" }}>
                  {holdings.list.map((h) => (
                    <div key={h.ticker} onClick={() => onChartTicker?.(h.ticker)} title={`${h.name} — ${h.weight}% (click to chart below)`} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, cursor: "pointer", flexShrink: 0 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = ARIA.bgHover || "rgba(255,255,255,0.05)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <span style={{ fontWeight: 700, color: ARIA.blue, width: 38, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{h.ticker}</span>
                      <div style={{ flex: 1, height: 4, background: ARIA.border, borderRadius: 2, overflow: "hidden", minWidth: 0 }}>
                        <div style={{ width: `${Math.min(100, (h.weight / (holdings.list[0].weight || 1)) * 100)}%`, height: "100%", background: ARIA.blue }} />
                      </div>
                      <span style={{ color: ARIA.textDim, width: 26, textAlign: "right", flexShrink: 0 }}>{h.weight}%</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {/* Drag handle — resize the holdings column horizontally (persisted) */}
        <div onMouseDown={startHoldResize} title="Drag to resize"
          style={{ width: 6, cursor: "col-resize", flexShrink: 0, alignSelf: "stretch", margin: "0 -2px 0 -6px", borderRight: `1px solid ${ARIA.border}`, background: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#22d3ee44")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")} />
        {/* Right: caller-provided panel (Sectors/Industries tabs) — pinned to the
            chart height so its table flex-fills when the box is resized taller */}
        {rightPanel && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 600, height: chartH, overflow: "hidden" }}>
            {rightPanel}
          </div>
        )}
        {rightRail && (
          <div style={{ width: 96, flexShrink: 0, borderLeft: `1px solid ${ARIA.border}`, paddingLeft: 8, height: chartH, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {rightRail}
          </div>
        )}
      </div>
      {/* Drag handle — resize the chart vertically; height persists across sessions */}
      <div onMouseDown={startResize} title="Drag to resize panel height"
        style={{ height: 8, cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none" }}
        onMouseEnter={(e) => (e.currentTarget.firstChild.style.background = ARIA.textMuted)}
        onMouseLeave={(e) => (e.currentTarget.firstChild.style.background = ARIA.border)}>
        <div style={{ width: 44, height: 3, borderRadius: 2, background: ARIA.border }} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Market Conditions — distribution days, SMA-trend grid, performance, verdict
// ──────────────────────────────────────────────────────────────────────────
let _breadthCache = null;
function useBreadthData() {
  const [d, setD] = useState(_breadthCache);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/data/breadth.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) { _breadthCache = j; setD(j); } })
      .catch(() => {});
    load();
    // Re-pull the snapshot so an intraday pipeline push shows up without reload.
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return d;
}

// Live SPY/QQQ/IWM/DIA + VIX from one cheap FMP batch-quote call. Polls during
// the trading day so Market Conditions can move intraday.
function useBriefing(intervalMs = 60000) {
  const [b, setB] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/live?briefing=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setB(j); })
      .catch(() => {});
    load();
    const id = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);
  return b;
}

function MarketConditionsPanel({ stocks, onTickerClick }) {
  const ARIA = useAriaTheme();
  const bd = useBreadthData();
  const briefing = useBriefing(60000);
  const spyRet = useSpyReturns();
  const rot = useRsRotation(); // sector leadership glance
  const secTickers = useMemo(() => (rot?.sectors || []).map((s) => s.ticker), [rot]);
  const { quotes: secQuotes } = useLiveQuotes(secTickers, 60000); // live sector ETF moves
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem("tp-conditions-open") === "1"; } catch { return false; }
  });
  if (!bd?.conditions) return null;
  const cRaw = bd.conditions;

  // ── Live overlay ─────────────────────────────────────────────
  // Breadth (% > MA) is a daily universe measure and stays from the snapshot,
  // but SPY/QQQ moves, VIX, the 1-month return and the verdict are recomputed
  // live during the trading day from one cheap briefing quote.
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const etMin = et.getHours() * 60 + et.getMinutes(), dow = et.getDay();
  const liveSpyChg = briefing?.indices?.SPY?.change_pct ?? null;
  const liveQqqChg = briefing?.indices?.QQQ?.change_pct ?? null;
  const liveVix = briefing?.vix?.level ?? null;
  // Active 4:00a–8:00p ET on weekdays (pre/RTH/after), and only once we have a live tick.
  const liveActive = dow >= 1 && dow <= 5 && etMin >= 240 && etMin < 1200 && liveSpyChg != null;
  // Live 1M: compound today's SPY move onto the snapshot's last-close 1M return.
  const baseM1 = cRaw.perf?.m1 ?? spyRet?.["1m"] ?? null;
  const liveM1 = (liveActive && baseM1 != null) ? +(((1 + baseM1 / 100) * (1 + liveSpyChg / 100) - 1) * 100).toFixed(2) : baseM1;
  const perf = { ...(cRaw.perf || {}), m1: liveM1 ?? cRaw.perf?.m1, vix: (liveActive && liveVix != null) ? liveVix : cRaw.perf?.vix };
  // Recompute the verdict with the live-adjusted signals (same rule as 10b_breadth.py).
  const liveVerdict = (() => {
    const sg = cRaw.sma_grid || {}; let sig = 0;
    if (sg.sma200 != null) sig += sg.sma200 >= 60 ? 1 : sg.sma200 < 40 ? -1 : 0;
    if (sg.sma50 != null) sig += sg.sma50 >= 55 ? 1 : sg.sma50 < 40 ? -1 : 0;
    const dt = cRaw.dist_days?.SPY?.today;
    if (dt != null) sig += dt >= 5 ? -1 : dt <= 2 ? 1 : 0;
    if (perf.m1 != null) sig += perf.m1 > 0 ? 1 : -1;
    if (perf.y1 != null) sig += perf.y1 > 0 ? 1 : -1;
    return sig >= 3 ? "Positive" : sig <= -3 ? "Negative" : "Neutral";
  })();
  const c = { ...cRaw, perf, verdict: liveActive ? liveVerdict : cRaw.verdict };

  const STAT = { pos: ARIA.green, neg: ARIA.red, neu: ARIA.textMuted };
  const SLABEL = { pos: "Positive", neg: "Negative", neu: "Neutral" };
  const verdictC = c.verdict === "Positive" ? ARIA.green : c.verdict === "Negative" ? ARIA.red : ARIA.yellow;
  const toggle = () => setOpen((v) => { const n = !v; try { localStorage.setItem("tp-conditions-open", n ? "1" : "0"); } catch {} return n; });

  const bStat = (v) => v == null ? "neu" : v >= 67 ? "pos" : v < 40 ? "neg" : "neu";
  const rStat = (v) => v == null ? "neu" : v > 2 ? "pos" : v < -2 ? "neg" : "neu";

  const gridCell = (label, v) => {
    const st = bStat(v), c2 = STAT[st];
    return (
      <div key={label} style={{ flex: "1 1 90px", minWidth: 82, border: `1px solid ${ARIA.border}`, borderRadius: 5, padding: "4px 7px" }}>
        <div style={{ fontSize: 7.5, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: ARIA.text, fontFamily: "monospace" }}>{v == null ? "—" : v.toFixed(2) + "%"}</div>
        <div style={{ height: 3, background: ARIA.border, borderRadius: 2, margin: "3px 0", overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, v || 0)}%`, height: "100%", background: c2 }} />
        </div>
        <div style={{ fontSize: 7.5, fontWeight: 700, color: c2 }}>{SLABEL[st]}</div>
      </div>
    );
  };
  const perfCell = (label, v, st, fmt) => {
    const c2 = STAT[st];
    return (
      <div key={label} style={{ flex: "1 1 70px", minWidth: 64, border: `1px solid ${ARIA.border}`, borderRadius: 5, padding: "4px 7px", textAlign: "center" }}>
        <div style={{ fontSize: 7.5, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 800, color: ARIA.text, fontFamily: "monospace" }}>{fmt}</div>
        <div style={{ fontSize: 7.5, fontWeight: 700, color: c2 }}>{SLABEL[st]}</div>
      </div>
    );
  };
  const p = c.perf || {};
  // Per-index perf table (SPY/QQQ/IWM) from the pipeline; SPY falls back to the
  // live-adjusted `p` so the row keeps its intraday m1/vix. QQQ/IWM show "—"
  // until the pipeline has emitted perf_indices.
  const pIdx = c.perf_indices || { SPY: p };
  const distCard = (tk) => {
    const dd = c.dist_days?.[tk]; if (!dd) return null;
    const lc = dd.label === "Correction" ? ARIA.red : dd.label === "Under Pressure" ? ARIA.yellow : ARIA.green;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", border: `1px solid ${ARIA.border}`, borderRadius: 5 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: ARIA.text, width: 30 }}>{tk}</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 7, color: ARIA.textMuted }}>Today</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: lc, fontFamily: "monospace" }}>{dd.today}</span>
          <span style={{ fontSize: 7, color: ARIA.textMuted, marginLeft: 5 }}>1D ago</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: ARIA.textDim, fontFamily: "monospace" }}>{dd.prior}</span>
        </div>
        <span style={{ fontSize: 8, fontWeight: 700, color: lc, marginLeft: "auto" }}>{dd.label}</span>
      </div>
    );
  };

  const posture = c.verdict === "Positive" ? "risk-on" : c.verdict === "Negative" ? "risk-off" : "caution";
  // ⚖️ exposure dial (matches the Signal scanner's exposure_state, minus the
  // ledger term which lives on the local machine): dist days + verdict +
  // Qullamaggie light (index 10/21-EMA check, net H/L trend, McClellan).
  const expo = (() => {
    const dd = Math.max(c.dist_days?.SPY?.today ?? 0, c.dist_days?.QQQ?.today ?? 0);
    let score = dd <= 2 ? 2 : dd <= 4 ? 1 : dd <= 6 ? -1 : -2;
    score += c.verdict === "Positive" ? 1 : c.verdict === "Negative" ? -2 : 0;
    const ql = c.qulla?.light;
    score += ql === "GREEN" ? 1 : ql === "RED" ? -2 : 0;
    const level = score >= 3 ? "FULL" : score >= 1 ? "75% SIZE" : score >= -1 ? "HALF SIZE" : "NO NEW BUYS";
    const color = score >= 3 ? ARIA.green : score >= 1 ? ARIA.blue : score >= -1 ? ARIA.yellow : ARIA.red;
    return { level, color, dd, score, ql };
  })();
  return (
    <div style={{ background: ARIA.bgRow, borderRadius: 6, border: `1px solid ${ARIA.border}`, borderLeft: `3px solid ${verdictC}`, marginBottom: 8, fontFamily: "monospace", boxShadow: ARIA.shadow }}>
      <div onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", cursor: "pointer", userSelect: "none", flexWrap: "wrap", background: verdictC + "14" }}>
        <span style={{ fontSize: 9, color: ARIA.textMuted }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: 9, color: ARIA.text, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 800 }}>Market Conditions</span>
        <span style={{ fontSize: 9, fontWeight: 800, color: verdictC, background: verdictC + "1c", border: `1px solid ${verdictC}55`, borderRadius: 3, padding: "1px 7px", letterSpacing: 0.4 }}>{c.verdict}</span>
        <span style={{ fontSize: 8, fontWeight: 700, color: verdictC, textTransform: "uppercase", letterSpacing: 0.5 }}>{posture}</span>
        <span title={`Progressive-exposure dial — ${expo.dd} distribution days + verdict ${c.verdict}${expo.ql ? ` + Q-light ${expo.ql} (index 10/21 EMAs · net H/L · McClellan)` : ""}. Position sizing throttle for new buys (the Signal scans add a recent-win-rate term on top).`}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 8, fontWeight: 800, color: expo.color, background: expo.color + "1c", border: `1px solid ${expo.color}55`, borderRadius: 3, padding: "1px 7px", letterSpacing: 0.4 }}>
          {(() => {
            // arc gauge: score −4..+4 → needle sweep 180°..0° across red/yellow/blue/green
            const clamped = Math.max(-4, Math.min(4, expo.score));
            const ang = Math.PI * (1 - (clamped + 4) / 8); // rad: −4 → π (left), +4 → 0 (right)
            const cxg = 11, cyg = 10, rr = 8;
            const nx = cxg + rr * 0.82 * Math.cos(ang), ny = cyg - rr * 0.82 * Math.sin(ang);
            const seg = (a0, a1, col) => {
              const x0 = cxg + rr * Math.cos(a0), y0 = cyg - rr * Math.sin(a0);
              const x1 = cxg + rr * Math.cos(a1), y1 = cyg - rr * Math.sin(a1);
              return <path d={`M${x0.toFixed(1)},${y0.toFixed(1)} A${rr},${rr} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`} fill="none" stroke={col} strokeWidth={2.6} strokeLinecap="butt" />;
            };
            const P = Math.PI;
            return (
              <svg width={22} height={12} viewBox="0 0 22 12" style={{ flexShrink: 0 }}>
                {seg(P, P * 0.75, ARIA.red)}
                {seg(P * 0.75, P * 0.5, ARIA.yellow)}
                {seg(P * 0.5, P * 0.25, ARIA.blue)}
                {seg(P * 0.25, 0, ARIA.green)}
                <line x1={cxg} y1={cyg} x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke={ARIA.text} strokeWidth={1.2} strokeLinecap="round" />
                <circle cx={cxg} cy={cyg} r={1.3} fill={ARIA.text} />
              </svg>
            );
          })()}
          ⚖ {expo.level}</span>
        <span style={{ color: ARIA.border }}>|</span>
        <MarketBreadthBar stocks={stocks} onTickerClick={onTickerClick} />
        {/* broad-glance chips */}
        {(() => {
          const chip = (label, val, color) => (
            <span style={{ fontSize: 8, color: ARIA.textMuted }}>{label} <b style={{ color: color || ARIA.textDim, fontFamily: "monospace" }}>{val}</b></span>
          );
          const dd = c.dist_days || {};
          const distC = (dd.SPY?.today ?? 0) >= 5 || (dd.QQQ?.today ?? 0) >= 5 ? ARIA.red : (dd.SPY?.today ?? 0) >= 3 ? ARIA.yellow : ARIA.green;
          const g = c.sma_grid || {}, pf = c.perf || {};
          const trendC = (v) => v == null ? ARIA.textDim : v >= 60 ? ARIA.green : v < 40 ? ARIA.red : ARIA.yellow;
          const m1c = pf.m1 == null ? ARIA.textDim : pf.m1 > 0 ? ARIA.green : pf.m1 < 0 ? ARIA.red : ARIA.textDim;
          const idxC = (v) => v == null ? ARIA.textDim : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textDim;
          const fmtChg = (v) => v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";
          return (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {dd.SPY && chip("Dist", `SPY ${dd.SPY.today} · QQQ ${dd.QQQ.today}`, distC)}
              {dd.SPY?.label && <span style={{ fontSize: 8, fontWeight: 700, color: distC }}>{dd.SPY.label}</span>}
              <span style={{ color: ARIA.border }}>|</span>
              {chip(">50", g.sma50 == null ? "—" : g.sma50.toFixed(0) + "%", trendC(g.sma50))}
              {chip(">200", g.sma200 == null ? "—" : g.sma200.toFixed(0) + "%", trendC(g.sma200))}
              <span style={{ color: ARIA.border }}>|</span>
              {chip("1M", pf.m1 == null ? "—" : (pf.m1 > 0 ? "+" : "") + pf.m1.toFixed(1) + "%", m1c)}
            </div>
          );
        })()}
        {/* Sector leadership glance — live during RTH (today's move vs SPY), else EOD RS rank */}
        {rot?.sectors?.length > 0 && (() => {
          const nm = (x) => x.name || x.ticker;
          let s = rot.sectors; // pipeline-sorted by RS desc (EOD)
          let live = false;
          if (liveActive && liveSpyChg != null) {
            const ranked = rot.sectors.map((x) => {
              const q = secQuotes.get(x.ticker);
              return { ...x, _a: q?.change != null ? q.change - liveSpyChg : null };
            }).filter((x) => x._a != null);
            if (ranked.length >= rot.sectors.length - 1) { s = ranked.sort((a, b) => b._a - a._a); live = true; }
          }
          const tag = (x) => live ? `${nm(x)} (${x._a > 0 ? "+" : ""}${x._a.toFixed(2)}% vs SPY)` : nm(x);
          return (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 8 }}>
              <span style={{ color: ARIA.border }}>|</span>
              <span style={{ color: ARIA.textMuted }} title={live ? "Sectors ranked by today's move vs SPY (live)" : "Sectors by RS rank (EOD)"}>SECT{live ? "•" : ""}</span>
              <span style={{ color: ARIA.green, fontWeight: 700 }} title={live ? "Leading today (vs SPY)\n" + s.slice(0, 3).map(tag).join("\n") : "Strongest sectors by RS rank"}>↑ {s.slice(0, 3).map(nm).join(" · ")}</span>
              <span style={{ color: ARIA.red, fontWeight: 700 }} title={live ? "Lagging today (vs SPY)\n" + s.slice(-2).map(tag).join("\n") : "Weakest sectors by RS rank"}>↓ {s.slice(-2).map(nm).join(" · ")}</span>
            </div>
          );
        })()}
        <span style={{ fontSize: 7.5, color: ARIA.textMuted, marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
          {liveActive
            ? <><span style={{ width: 6, height: 6, borderRadius: "50%", background: ARIA.green, boxShadow: `0 0 5px ${ARIA.green}` }} /><b style={{ color: ARIA.green }}>LIVE</b>{briefing?.timestamp ? ` · ${new Date(briefing.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""} · breadth as of {bd.date}</>
            : <>{open ? "" : "click to expand · "}as of {bd.date}</>}
        </span>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${ARIA.border}`, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 460px", minWidth: 320 }}>
              <div style={{ fontSize: 7.5, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>Breadth & Trend</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {gridCell("SMA 10", c.sma_grid?.sma10)}
                {gridCell("SMA 20", c.sma_grid?.sma20)}
                {gridCell("SMA 50", c.sma_grid?.sma50)}
                {gridCell("SMA 200", c.sma_grid?.sma200)}
                {gridCell("20 > 50", c.sma_grid?.x20_50)}
                {gridCell("50 > 200", c.sma_grid?.x50_200)}
              </div>
            </div>
            <div style={{ flex: "1 1 240px", minWidth: 220 }}>
              <div style={{ fontSize: 7.5, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>Distribution Days</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{distCard("SPY")}{distCard("QQQ")}</div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 7.5, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>Market Performance</div>
            {[["SPY", p, true], ["QQQ", pIdx.QQQ || {}, false], ["IWM", pIdx.IWM || {}, false]].map(([sym, pp, isSpy]) => (
              <div key={sym} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "stretch", marginBottom: 5 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 42, fontSize: 10, fontWeight: 800, color: ARIA.textDim, fontFamily: "monospace", letterSpacing: 0.5 }}>{sym}</div>
                {perfCell("YTD", pp.ytd, rStat(pp.ytd), pp.ytd == null ? "—" : (pp.ytd > 0 ? "+" : "") + pp.ytd.toFixed(2) + "%")}
                {perfCell("1W", pp.w1, rStat(pp.w1), pp.w1 == null ? "—" : (pp.w1 > 0 ? "+" : "") + pp.w1.toFixed(2) + "%")}
                {perfCell("1M", pp.m1, rStat(pp.m1), pp.m1 == null ? "—" : (pp.m1 > 0 ? "+" : "") + pp.m1.toFixed(2) + "%")}
                {perfCell("1Y", pp.y1, rStat(pp.y1), pp.y1 == null ? "—" : (pp.y1 > 0 ? "+" : "") + pp.y1.toFixed(2) + "%")}
                {perfCell("52W High", pp.off52, pp.off52 == null ? "neu" : pp.off52 > -3 ? "pos" : pp.off52 < -8 ? "neg" : "neu", pp.off52 == null ? "—" : pp.off52.toFixed(2) + "%")}
                {isSpy && perfCell("VIX", pp.vix, pp.vix == null ? "neu" : pp.vix < 16 ? "pos" : pp.vix > 25 ? "neg" : "neu", pp.vix == null ? "—" : pp.vix.toFixed(2))}
              </div>
            ))}
          </div>
          {/* Qullamaggie market-environment check: light + index EMA check + net H/L + NASI proxy */}
          {(c.qulla || c.index_trends) && (() => {
            const q = c.qulla || {};
            const it = c.index_trends || {};
            const LC = { GREEN: ARIA.green, YELLOW: ARIA.yellow, RED: ARIA.red };
            const DOTC = { green: ARIA.green, yellow: ARIA.yellow, red: ARIA.red };
            const spark = (series, color, zero = false) => {
              if (!series || series.length < 2) return null;
              const W = 84, H = 22;
              const mn = Math.min(...series, zero ? 0 : Infinity), mx = Math.max(...series, zero ? 0 : -Infinity);
              const rng = (mx - mn) || 1;
              const x = (i) => (i / (series.length - 1)) * (W - 2) + 1;
              const y = (v) => H - 2 - ((v - mn) / rng) * (H - 4);
              return (
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H, display: "block" }}>
                  {zero && mn < 0 && mx > 0 && <line x1={1} y1={y(0)} x2={W - 1} y2={y(0)} stroke={ARIA.textMuted} strokeWidth={0.5} strokeDasharray="2 2" opacity={0.6} />}
                  <polyline points={series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
                  <circle cx={x(series.length - 1)} cy={y(series[series.length - 1])} r={1.8} fill={color} />
                </svg>
              );
            };
            const box = { border: `1px solid ${ARIA.border}`, borderRadius: 5, padding: "4px 8px" };
            const hl = q.net_hl, mc = q.mcclellan;
            return (
              <div>
                <div style={{ fontSize: 7.5, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>Market Indicators</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "stretch" }}>
                  {q.light && (
                    <div title={`Aggregate market-environment signal (QQQ weighted most, + IWM/SPY EMA checks, net H/L trend, McClellan). GREEN = aggressive, YELLOW = caution, RED = high cash.`}
                      style={{ ...box, display: "flex", alignItems: "center", gap: 8, borderLeft: `3px solid ${LC[q.light]}` }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: LC[q.light], fontFamily: "monospace" }}>{q.light}</span>
                      <span style={{ fontSize: 8.5, color: ARIA.textDim, maxWidth: 210, lineHeight: 1.35 }}>{q.action}</span>
                      {(() => {
                        // Index-vs-internals verdict: when the light (index EMAs) and
                        // the internals (McClellan / net H/L) disagree, the tape is
                        // SPLIT — historically where leaders-at-support (Reset)
                        // entries appear, while breakouts underperform.
                        if (!mc && !hl) return null;
                        const internalsUp = mc?.signal === "BUY" || hl?.trend === "green";
                        const internalsDn = mc?.signal === "SELL" || (hl?.trend === "red" && mc?.signal !== "BUY");
                        const split = (q.light === "RED" && internalsUp) || (q.light === "GREEN" && internalsDn);
                        const col = split ? ARIA.yellow : ARIA.textMuted;
                        return (
                          <span title={split
                            ? `SPLIT TAPE — indexes say ${q.light} but internals disagree (${mc ? `McClellan ${mc.signal}` : ""}${hl ? ` · net H/L ${hl.trend}` : ""}). Leaders holding while indexes bleed = Reset conditions; don't read the light as a blanket no.`
                            : `Indexes and internals agree${mc ? ` (McClellan ${mc.signal}` : ""}${hl ? ` · net H/L ${hl.trend})` : ")"}.`}
                            style={{ fontSize: 7, fontWeight: 800, letterSpacing: 0.4, color: col, border: `1px solid ${col}55`, background: `${col}12`, borderRadius: 3, padding: "1px 5px", cursor: "help" }}>
                            {split ? "SPLIT TAPE" : "CONFIRMED"}
                          </span>
                        );
                      })()}
                    </div>
                  )}
                  <div style={{ ...box, display: "flex", alignItems: "center", gap: 10 }}
                    title="Qullamaggie index check: price above the 10 & 21 EMA with both EMAs rising = green; above 21 but mixed = yellow; below 21 EMA = red. QQQ matters most.">
                    <span style={{ fontSize: 7, color: ARIA.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.4 }}>10/21 EMA</span>
                    {["QQQ", "IWM", "SPY"].map((sym) => {
                      const t = it[sym];
                      return (
                        <span key={sym} title={t ? `${sym}: close ${t.close} vs EMA10 ${t.e10} / EMA21 ${t.e21} · EMA10 ${t.e10_rising ? "rising" : "falling"}, EMA21 ${t.e21_rising ? "rising" : "falling"}` : `${sym}: no data yet`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: t ? DOTC[t.status] : ARIA.textMuted }} />
                          <span style={{ fontSize: 9.5, fontWeight: sym === "QQQ" ? 800 : 700, color: ARIA.textDim, fontFamily: "monospace" }}>{sym}</span>
                        </span>
                      );
                    })}
                  </div>
                  <div style={{ ...box, display: "flex", alignItems: "center", gap: 8 }}
                    title="Net new highs vs lows across the universe (within 2% of 52w extremes). Neutral-to-green trend = more stocks making highs than lows — a key ingredient of a durable uptrend. 10-day average drives the color.">
                    <div>
                      <div style={{ fontSize: 7, color: ARIA.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.4 }}>Net H/L</div>
                      {hl ? (
                        <div style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: DOTC[hl.trend === "neutral" ? "yellow" : hl.trend] }}>
                          {hl.net > 0 ? "+" : ""}{hl.net} <span style={{ fontSize: 7.5, color: ARIA.textMuted, fontWeight: 400 }}>10d {hl.avg10 > 0 ? "+" : ""}{hl.avg10}</span>
                        </div>
                      ) : <div style={{ fontSize: 8.5, color: ARIA.textMuted }}>accumulating…</div>}
                    </div>
                    {hl && spark(hl.series, DOTC[hl.trend === "neutral" ? "yellow" : hl.trend], true)}
                  </div>
                  <div style={{ ...box, display: "flex", alignItems: "center", gap: 8 }}
                    title="McClellan Summation computed over our ~3k universe (ratio-adjusted 19/39 EMA of net advances, cumulative) — a NASI proxy. Rising = buy (black) signal; falling = sell.">
                    <div>
                      <div style={{ fontSize: 7, color: ARIA.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.4 }}>McClellan Σ</div>
                      {mc ? (
                        <div style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: mc.rising ? ARIA.green : ARIA.red }}>
                          {mc.signal} {mc.rising ? "▲" : "▼"} <span style={{ fontSize: 7.5, color: ARIA.textMuted, fontWeight: 400 }}>{mc.summation > 0 ? "+" : ""}{mc.summation}</span>
                        </div>
                      ) : <div style={{ fontSize: 8.5, color: ARIA.textMuted }}>accumulating…</div>}
                    </div>
                    {mc && spark(mc.series, mc.rising ? ARIA.green : ARIA.red)}
                  </div>
                </div>
              </div>
            );
          })()}
          {/* Risk-on vs Defensive rotation — click a ticker to chart it in Sector Rotation */}
          {bd.rotation && (() => {
            const DOT = { green: "#16a34a", yellow: "#d9a441", red: "#b1374a" };
            const cell = (r) => (
              <button key={r.sym} onClick={() => { try { window.dispatchEvent(new CustomEvent("tp-breadth-sym", { detail: r.sym })); } catch {} }}
                title={`${r.sym} — ${r.regime.toUpperCase()} · 1mo ${r.ret1m >= 0 ? "+" : ""}${r.ret1m}%  (click to chart in Sector Rotation)`}
                style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: DOT[r.regime] || ARIA.textMuted, flexShrink: 0 }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: ARIA.textDim }}>{r.sym}</span>
              </button>
            );
            return (
              <div>
                <div style={{ fontSize: 7.5, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>Rotation — Risk-on vs Defensive</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 7.5, color: ARIA.textMuted }}>RISK-ON</span>
                  <div style={{ display: "flex", gap: 9, alignItems: "center" }}>{bd.rotation.risk_on.map(cell)}</div>
                  <span style={{ color: ARIA.border }}>·</span>
                  <span style={{ fontSize: 7.5, color: ARIA.textMuted }}>DEFENSIVE</span>
                  <div style={{ display: "flex", gap: 9, alignItems: "center" }}>{bd.rotation.defensive.map(cell)}</div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// RS Rotation Board — sector/industry relative-strength rank rotation
// ──────────────────────────────────────────────────────────────────────────
// Reads /data/rs_rotation.json (pipeline 10c_rs_rotation.py). Collapsible.
// SPY daily closes (date -> close), cached once — RS-line denominator (stock / SPY)
// for the IBD-style RS line on the ticker chart.
let _spyClosesCache = null, _spyClosesFetching = false; const _spyClosesListeners = [];
function useSpyCloses() {
  const [m, setM] = useState(_spyClosesCache);
  useEffect(() => {
    if (_spyClosesCache) { setM(_spyClosesCache); return; }
    if (_spyClosesFetching) { _spyClosesListeners.push(setM); return; }
    _spyClosesFetching = true;
    fetchOhlcBars("SPY").then((bars) => {
      const map = new Map((bars || []).map((b) => [b.date, b.close]));
      _spyClosesCache = map; setM(map);
      _spyClosesListeners.forEach((fn) => fn(map)); _spyClosesListeners.length = 0;
    }).catch(() => { _spyClosesFetching = false; });
  }, []);
  return m;
}

let _rsRotCache = null, _rsRotFetching = false; const _rsRotListeners = [];
function useRsRotation() {
  const [d, setD] = useState(_rsRotCache);
  useEffect(() => {
    if (_rsRotCache) { setD(_rsRotCache); return; }
    if (_rsRotFetching) { _rsRotListeners.push(setD); return; }
    _rsRotFetching = true;
    fetch("/data/rs_rotation.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { _rsRotCache = j; setD(j); _rsRotListeners.forEach((fn) => fn(j)); _rsRotListeners.length = 0; })
      .catch(() => { _rsRotFetching = false; });
  }, []);
  return d;
}

// themes considered "tech" — shared by the Tech / Ex-Tech tabs and the Playbook
const TECH_THEMES = new Set(["ai", "software", "cyber", "semis", "quantum", "internet", "robotics", "fintech"]);

function RsRankBox({ v, ARIA }) {
  if (v == null) return <span style={{ color: ARIA.textMuted }}>—</span>;
  const c = v >= 88 ? "#16a34a" : v <= 12 ? "#b1374a" : ARIA.textMuted;
  const bg = v >= 88 ? "rgba(22,163,74,0.16)" : v <= 12 ? "rgba(177,55,74,0.14)" : "transparent";
  return (
    <span style={{ display: "inline-block", minWidth: 22, textAlign: "center", fontWeight: 700, fontSize: 9, color: c, background: bg, border: `1px solid ${c}40`, borderRadius: 3, padding: "0 3px" }}>{v}</span>
  );
}

function RsTable({ rows, sortable, onTicker, ARIA, tickerLabel = "Ticker", getTag, onLayerSelect, activeKey, rankCol = false, initialSort, onNameLayer, heldSet, heldByLayer }) {
  const deckSet = useOnDeckSet();
  const [sort, setSort] = useState(initialSort || { key: "rsDay", dir: "desc" });
  const rowKeyOf = (r) => (getTag ? `${r.themeId}|${r.name}` : r.ticker);
  const activeRowRef = useRef(null);
  // RS acceleration (2nd derivative), weekly→monthly: project last week's
  // relative pace to a month (×21/5) and subtract the actual monthly relative
  // return. +ve = relative strength accelerating. Derived from rsWk / rsMth.
  const augmented = useMemo(() => rows.map((r) => ({
    ...r,
    rsRoc2: (r.rsWk != null && r.rsMth != null) ? +(r.rsWk * 4.2 - r.rsMth).toFixed(2) : null,
    // day→week acceleration: today's relative pace projected to a week minus the
    // actual weekly relative return. Live intraday (rsDay is live). Positive =
    // fresh inflection today; negative = today lags its own week (extended).
    rsAcc1: (r.rsDay != null && r.rsWk != null) ? +(r.rsDay * 5 - r.rsWk).toFixed(2) : null,
  })), [rows]);
  // Percentile rank of RS Acc² among the current rows — drives a heatmap tint
  // behind each Acc² cell so a value's standing vs peers reads at a glance
  // (green = top of the field, red = bottom) without losing the raw number.
  const pctRankMap = (key) => {
    const vals = augmented.map((r) => r[key]).filter((v) => v != null).sort((a, b) => a - b);
    const denom = (vals.length - 1) || 1;
    const m = new Map();
    augmented.forEach((r) => {
      if (r[key] == null) return;
      let lo = 0; while (lo < vals.length && vals[lo] < r[key]) lo++;
      m.set(r, Math.round((lo / denom) * 100));
    });
    return m;
  };
  const roc2Pct = useMemo(() => pctRankMap("rsRoc2"), [augmented]);
  const rsDayPct = useMemo(() => pctRankMap("rsDay"), [augmented]);
  const acc1Pct = useMemo(() => pctRankMap("rsAcc1"), [augmented]);
  // Only flag the extremes: top 5% green, bottom 5% red, everything else clear.
  const heatBg = (pct) => {
    if (pct == null) return "transparent";
    if (pct >= 95) return "rgba(13,145,99,0.32)";
    if (pct <= 5) return "rgba(239,68,68,0.32)";
    return "transparent";
  };
  const sorted = useMemo(() => {
    if (!sortable) return augmented;
    const arr = augmented.slice();
    arr.sort((a, b) => {
      if (sort.key === "ticker" || sort.key === "name") {
        const av = (a[sort.key] || ""), bv = (b[sort.key] || "");
        return sort.dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      const av = a[sort.key] ?? -9999, bv = b[sort.key] ?? -9999;
      if (av !== bv) return sort.dir === "desc" ? bv - av : av - bv;
      return (b.zvr ?? -9999) - (a.zvr ?? -9999); // secondary: ZVR desc
    });
    return arr;
  }, [augmented, sort, sortable]);
  // Autoscroll the active row into view when it changes (reverse sync / select).
  useEffect(() => {
    if (activeKey && activeRowRef.current) scrollRowIntoScroller(activeRowRef.current);
  }, [activeKey, sorted]);
  // Layers (getTag) drop the Theme/identity column; the layer name itself is the
  // clickable, fixed-width title so the numeric columns get more room.
  // Shared "strength core" (RS Day% · ZVR · CR% · EIF) sits right after the
  // identity columns, matching Scan Watch. RS Wk%/Mth% + acceleration follow as
  // the rotation-specific extras; stock tabs append a live Setup badge.
  const coreCols = [["now", "Now"], ["d1", "1D"], ["w1", "1W"], ["m1", "1M"], ["ticker", tickerLabel], ["name", getTag ? "Layer" : "Name"], ["rsDay", "RS Day%"], ["zvr", "ZVR"], ["cr", "CR%"], ["eif", "EIF"], ["rsWk", "RS Wk%"], ["rsMth", "RS Mth%"], ["rsAcc1", "RS Acc¹"], ["rsRoc2", "RS Acc²"]];
  const withRank = rankCol ? [["lead", rows.some((r) => r._tier) ? "◆" : "#"], ...coreCols, ["setup", "Setup"]] : coreCols;
  const cols = getTag
    ? withRank.filter(([k]) => k !== "ticker").flatMap((c) => (c[0] === "eif" ? [c, ["b20", "B%"]] : [c]))
    : withRank;
  const TITLES = {
    b20: "Layer internals breadth: % of constituents above their own 20-day MA. Rank (NOW) is a trailing-return percentile and lags; internals firm up first — a layer at rank 55 with B% jumping is rising strength before the rank knows it. Hover a cell for near-high % and $vol share shift.",
    rsAcc1: "RS acceleration (day→week), LIVE: today's relative pace projected to a week (RS Day% × 5) minus the actual weekly relative return. High positive = fresh inflection TODAY (strong day after a quiet/weak week); negative = today lags its own week (extended or cooling).",
    rsRoc2: "RS acceleration (weekly→monthly): projects the last week's relative pace to a month (RS Wk% × 4.2) and subtracts the actual monthly relative return. Positive = relative strength accelerating; negative = rolling over.",
    zvr: "Normalized ZVR: signed relative volume (rel-vol × 100, negative on down days) averaged across the layer's constituents — count-independent, so layers of different sizes are comparable. Live during market hours.",
    cr: "Closing range: where price sits in the day's range (100 = closing at the high). Per stock on Leaders/Emerging; layer-average of constituents on layer tabs. Same metric as Scan Watch's CR%.",
    eif: "EIF (Execution & Integrity framework score). Per stock on Leaders/Emerging; layer-average of constituents on layer tabs. Same metric as Scan Watch's EIF column.",
  };
  const pctCell = (v) => v == null ? <span style={{ color: ARIA.textMuted }}>—</span>
    : <span style={{ color: Math.abs(v) > 2 ? (v > 0 ? ARIA.green : ARIA.red) : ARIA.textDim, fontWeight: Math.abs(v) > 2 ? 600 : 400 }}>{v > 0 ? "+" : ""}{v.toFixed(2)}%</span>;
  // RRG quadrant color from RS level (now) × 1wk momentum (now−w1): Leading=green,
  // Weakening=yellow, Improving=blue, Lagging=red. Colors the layer name to match.
  const quadColor = (r) => {
    if (r.now == null || r.w1 == null) return ARIA.blue;
    const y = r.now - r.w1;
    return r.now >= 50 ? (y >= 0 ? ARIA.green : ARIA.yellow) : (y >= 0 ? ARIA.blue : ARIA.red);
  };
  const hdr = (key, label) => (
    <th key={key} title={TITLES[key]} onClick={sortable ? () => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" })) : undefined}
      style={{ position: "sticky", top: 0, zIndex: 1, background: ARIA.bgRow || ARIA.bg || "#15151c", textAlign: key === "ticker" || key === "name" ? "left" : "right", padding: "2px 6px", color: sortable && sort.key === key ? ARIA.text : ARIA.textMuted, fontWeight: 700, fontSize: 8, textTransform: "uppercase", letterSpacing: 0.3, cursor: sortable ? "pointer" : "default", whiteSpace: "nowrap", boxShadow: `inset 0 -1px 0 ${ARIA.border}` }}>
      {label}{sortable && sort.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );
  // ── Keyboard nav: click anywhere in the table, then ↑/↓ steps through the
  // sorted rows firing the row's primary action (select layer / chart ticker).
  const tableRef = useRef(null);
  const navIdxRef = useRef(-1);
  const rowPrimary = (r) => (onLayerSelect || ((rr) => onTicker?.(rr.ticker)))(r);
  const onTableKey = (e) => {
    if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || !sorted.length) return;
    e.preventDefault();
    const fromActive = activeKey != null ? sorted.findIndex((r) => rowKeyOf(r) === activeKey) : -1;
    const cur = fromActive >= 0 ? fromActive : navIdxRef.current;
    let next = cur < 0 ? 0 : cur + (e.key === "ArrowDown" ? 1 : -1);
    next = Math.max(0, Math.min(sorted.length - 1, next));
    navIdxRef.current = next;
    rowPrimary(sorted[next]);
    const el = tableRef.current?.querySelector(`tr[data-rk="${window.CSS.escape(rowKeyOf(sorted[next]))}"]`);
    if (el) scrollRowIntoScroller(el);
  };
  return (
    <table ref={tableRef} tabIndex={0} onKeyDown={onTableKey}
      onClick={() => setTimeout(() => tableRef.current?.focus({ preventScroll: true }), 0)}
      style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 9, outline: "none" }}>
      <thead><tr style={{ borderBottom: `1px solid ${ARIA.border}` }}>{cols.map(([k, l]) => hdr(k, l))}</tr></thead>
      <tbody>
        {sorted.map((r, ri) => {
          const isActive = activeKey && rowKeyOf(r) === activeKey;
          const quadName = (r.now != null && r.w1 != null) ? (r.now >= 50 ? (r.now - r.w1 >= 0 ? "Leading" : "Weakening") : (r.now - r.w1 >= 0 ? "Improving" : "Lagging")) : null;
          const nameTitle = quadName ? `${r.theme ? r.theme + " · " : ""}${r.name} — RRG: ${quadName}${onNameLayer ? " (click to load layer)" : ""}` : undefined;
          return (
          <tr key={`${r.ticker}|${r.name || ""}|${r.theme || ""}`} ref={isActive ? activeRowRef : null}
            data-rk={rowKeyOf(r)} onClickCapture={() => { navIdxRef.current = ri; }}
            style={{ borderBottom: `1px solid ${ARIA.border}40`, background: isActive ? ARIA.blue + "26" : (!getTag && deckSet.has(r.ticker)) ? ARIA.gold + "2e" : ((getTag ? heldByLayer?.[`${r.themeId}|${r.name}`]?.length : heldSet?.has(r.ticker)) ? ARIA.yellow + "14" : "transparent"), boxShadow: isActive ? `inset 2px 0 0 ${ARIA.blue}` : "none" }}>
            {rankCol && <td style={{ textAlign: r._tier ? "center" : "right", padding: "2px 6px", color: ARIA.textMuted, fontWeight: 700 }}>{r._tier ? <span title={r._tier === "L" ? "True leader — established name in a top layer" : "Emerging — quality name breaking into leadership"} style={{ fontSize: 10 }}>{r._tier === "L" ? "⭐" : "🌱"}</span> : r.lead}</td>}
            <td style={{ textAlign: "right", padding: "2px 6px", whiteSpace: "nowrap" }}>
              {/* Leader trend tell (4.5yr backtest): rank ≥88 + rank holding/rising
                  vs 1w = +0.41%/5d (55% win); fading = +0.24%/5d but +1.18%/21d —
                  weaker near-term, NOT a short. Level is the edge; trend is the timing. */}
              {r.now != null && r.now >= 88 && r.w1 != null && (
                r.now >= r.w1
                  ? <span title="Rising/holding leader — rank ≥88 and not below its 1-week-ago rank. Backtest: +0.41%/5d alpha, 55% win — the strongest layer cohort." style={{ fontSize: 7, color: ARIA.green, marginRight: 2 }}>▲</span>
                  : <span title="Fading leader — rank ≥88 but below its 1-week-ago rank (e.g. a 99 that's breaking down). Backtest: half the near-term alpha of rising leaders (+0.24%/5d) but still positive and +1.18%/21d — digestion more often than a top. Weaker near-term hold, not an exit signal by itself." style={{ fontSize: 7, color: ARIA.yellow, marginRight: 2 }}>▼</span>
              )}
              <RsRankBox v={r.now} ARIA={ARIA} />
            </td>
            <td style={{ textAlign: "right", padding: "2px 6px" }}><RsRankBox v={r.d1} ARIA={ARIA} /></td>
            <td style={{ textAlign: "right", padding: "2px 6px" }}><RsRankBox v={r.w1} ARIA={ARIA} /></td>
            <td style={{ textAlign: "right", padding: "2px 6px" }}><RsRankBox v={r.m1} ARIA={ARIA} /></td>
            {!getTag && (
              <td style={{ padding: "2px 6px", whiteSpace: "nowrap" }}>
                <button onClick={() => onTicker?.(r.ticker)} style={{ background: "none", border: "none", color: ARIA.blue, fontWeight: 700, fontFamily: "monospace", fontSize: 9, cursor: "pointer", padding: 0 }}>{r.ticker}</button>
                {r.rsRank != null && r.rsRank >= 85 && r.rsWk != null && r.rsWk <= -2 && <span title={`Leader diverging — RS rank ${r.rsRank} but ${r.rsWk > 0 ? "+" : ""}${r.rsWk.toFixed(1)}% vs SPY THIS week. Trailing rank, disagreeing tape.`} style={{ marginLeft: 2, fontSize: 7, color: ARIA.yellow }}>⚠</span>}
                {rankCol && r.rsAcc1 != null && r.rsDay > 0 && r.rsAcc1 >= 5 && (
                  <span title={`Fresh inflection — today's pace (${r.rsDay > 0 ? "+" : ""}${r.rsDay.toFixed(1)}%/d) is running well ahead of its own week (${r.rsWk > 0 ? "+" : ""}${(r.rsWk ?? 0).toFixed(1)}%): day-one turn, not an extended continuation`} style={{ marginLeft: 3, fontSize: 8.5, fontWeight: 800, color: ARIA.green }}>↗</span>
                )}
                {rankCol && r.tt && (
                  <span title="2-Days-Tight — closes within 1% + narrowing range. Breakout candidate" style={{ marginLeft: 3, fontSize: 6, fontWeight: 800, color: "#f472b6", border: "1px solid #f472b680", background: "rgba(244,114,182,0.12)", padding: "0 2px", borderRadius: 2 }}>T2</span>
                )}
                {rankCol && r.de && (
                  <span title={`Delayed Entry ready — entry = break of ${r.deTrig ?? "recent highs"}${r.deHold ? ` · gap ${r.deHold}` : ""}${r.news ? `\nCatalyst: ${r.news[0]}` : ""}`} style={{ marginLeft: 3, fontSize: 6, fontWeight: 800, color: "#fb923c", border: "1px solid #fb923c80", background: "rgba(251,146,60,0.12)", padding: "0 2px", borderRadius: 2 }}>DE</span>
                )}
                {rankCol && r.news && (
                  <span onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("tp-news-pop", { detail: { x: e.clientX, y: e.clientY, ticker: r.ticker, items: r.news } })); }} title={r.inPlay ? "In play today — click for catalyst headlines" : "Click for catalyst headlines"} style={{ marginLeft: 3, fontSize: r.inPlay ? 9 : 7, opacity: r.inPlay ? 1 : 0.7, cursor: "pointer", filter: r.inPlay ? "drop-shadow(0 0 3px #fbbf24) saturate(1.5)" : "none" }}>📰</span>
                )}
                {r.erDays != null && r.erDays >= 0 && r.erDays <= 7 && (
                  <span title={`Reports earnings in ${r.erDays} day${r.erDays === 1 ? "" : "s"} — avoid initiating into the print`} style={{ marginLeft: 3, fontSize: 7.5, fontWeight: 700, color: "#fbbf24" }}>⚠{r.erDays}d</span>
                )}
              </td>
            )}
            {getTag ? (
              <td style={{ padding: "2px 6px" }}>
                <button onClick={() => (onLayerSelect || ((rr) => onTicker?.(rr.ticker)))(r)}
                  title={`${r.theme || ""} · ${r.name} — ${r.n || ""} tickers, lead ${r.ticker}${r.regime ? ` · structure: ${r.regime === "green" ? "INTACT (above trend)" : r.regime === "yellow" ? "DETERIORATING (10d EMA < 20d EMA)" : "BROKEN (basket below its ~20-week line)"}` : ""} · RRG: ${r.now != null && r.w1 != null ? (r.now >= 50 ? (r.now - r.w1 >= 0 ? "Leading" : "Weakening") : (r.now - r.w1 >= 0 ? "Improving" : "Lagging")) : "—"} (click to load)`}
                  style={{ display: "flex", alignItems: "center", gap: 3, width: 132, maxWidth: 132, overflow: "hidden", textAlign: "left", background: "none", border: "none", color: quadColor(r), fontWeight: 700, fontFamily: "monospace", fontSize: 9, cursor: "pointer", padding: 0 }}>
                  {/* Structural regime dot — catches a high-NOW theme that's breaking:
                      rank is a trailing 1/3/6-mo percentile; structure is current. */}
                  {r.regime && <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: r.regime === "green" ? "#16a34a" : r.regime === "yellow" ? "#d9a441" : "#b1374a" }} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}{r.n ? <span style={{ color: ARIA.textMuted, fontWeight: 400 }}> ·{r.n}</span> : ""}</span>
                </button>
              </td>
            ) : (
              <td style={{ padding: "2px 6px", whiteSpace: "nowrap" }} title={nameTitle}>
                {onNameLayer
                  ? <button onClick={() => onNameLayer(r)} style={{ background: "none", border: "none", color: quadColor(r), fontWeight: 700, fontFamily: "monospace", fontSize: 9, cursor: "pointer", padding: 0 }}>{r.name}</button>
                  : <span style={{ color: quadColor(r) }}>{r.name}</span>}
              </td>
            )}
            <td title={r.rsDay == null ? undefined : `RS Day% ${r.rsDay > 0 ? "+" : ""}${r.rsDay.toFixed(2)}% · ${rsDayPct.get(r)}th pct among ${getTag ? "layers" : "names"}`}
              style={{ textAlign: "right", padding: "2px 6px", background: heatBg(rsDayPct.get(r)) }}>{pctCell(r.rsDay)}</td>
            <td style={{ textAlign: "right", padding: "2px 6px" }}>{r.zvr == null ? <span style={{ color: ARIA.textMuted }}>—</span> : <span style={{ color: Math.abs(r.zvr) >= 200 ? (r.zvr < 0 ? "#ef4444" : "#fbbf24") : Math.abs(r.zvr) >= 130 ? (r.zvr < 0 ? ARIA.red : ARIA.green) : ARIA.textDim, fontWeight: Math.abs(r.zvr) >= 130 ? 700 : 400 }}>{r.zvr}%</span>}</td>
            <td style={{ textAlign: "right", padding: "2px 6px" }}>{r.cr == null ? <span style={{ color: ARIA.textMuted }}>—</span> : <span style={{ color: r.cr >= 70 ? ARIA.green : r.cr >= 40 ? ARIA.textDim : ARIA.red, fontWeight: 600 }}>{Math.round(r.cr)}%</span>}</td>
            <td style={{ textAlign: "right", padding: "2px 6px" }}>{r.eif == null ? <span style={{ color: ARIA.textMuted }}>—</span> : <span style={{ color: r.eif >= 55 ? ARIA.green : ARIA.textDim, fontWeight: r.eif >= 55 ? 700 : 400 }}>{Math.round(r.eif)}</span>}</td>
            {getTag && <td title={`Layer internals: % of constituents above their own 20dma${r.nh15 != null ? ` · ${r.nh15}% within 15% of 52w highs` : ""}${r.dshift != null ? ` · $vol share 5d vs 20d ${r.dshift > 0 ? "+" : ""}${r.dshift}%` : ""} — breadth firms up BEFORE the return-based rank moves`} style={{ textAlign: "right", padding: "2px 6px" }}>{r.b20 == null ? <span style={{ color: ARIA.textMuted }}>—</span> : <span style={{ color: r.b20 >= 70 ? ARIA.green : r.b20 <= 30 ? ARIA.red : ARIA.textDim, fontWeight: r.b20 >= 70 || r.b20 <= 30 ? 700 : 400 }}>{r.b20}%</span>}</td>}
            <td style={{ textAlign: "right", padding: "2px 6px" }}>{pctCell(r.rsWk)}</td>
            <td style={{ textAlign: "right", padding: "2px 6px" }}>{pctCell(r.rsMth)}</td>
            <td title={r.rsAcc1 == null ? undefined : `RS Acc¹ ${r.rsAcc1 > 0 ? "+" : ""}${r.rsAcc1.toFixed(1)} · ${acc1Pct.get(r)}th pct among ${getTag ? "layers" : "names"} — day pace vs its own week`}
              style={{ textAlign: "right", padding: "2px 6px", background: heatBg(acc1Pct.get(r)) }}>{r.rsAcc1 == null ? <span style={{ color: ARIA.textMuted }}>—</span> : <span style={{ color: ARIA.textDim, fontWeight: 400 }}>{r.rsAcc1 > 0 ? "+" : ""}{r.rsAcc1.toFixed(1)}</span>}</td>
            <td title={r.rsRoc2 == null ? undefined : `RS Acc² ${r.rsRoc2 > 0 ? "+" : ""}${r.rsRoc2.toFixed(1)} · ${roc2Pct.get(r)}th pct among ${getTag ? "layers" : "names"}`}
              style={{ textAlign: "right", padding: "2px 6px", background: heatBg(roc2Pct.get(r)) }}>{r.rsRoc2 == null ? <span style={{ color: ARIA.textMuted }}>—</span> : <span style={{ color: ARIA.textDim, fontWeight: 400 }}>{r.rsRoc2 > 0 ? "+" : ""}{r.rsRoc2.toFixed(1)}</span>}</td>
            {rankCol && (
              <td style={{ textAlign: "center", padding: "2px 4px" }}>{(() => {
                const su = chainSetup({ ...r, rs: r.eif, alpha: r.rsDay });
                if (!su) return <span style={{ color: ARIA.textMuted, fontSize: 8 }}>—</span>;
                return <span title={su.desc} style={{ fontSize: 7, fontWeight: 800, color: su.color, background: `${su.color}1f`, border: `1px solid ${su.color}55`, borderRadius: 2, padding: "0 3px", letterSpacing: 0.3 }}>{su.key}</span>;
              })()}</td>
            )}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Extended-hours box: premarket (left) · post-market (right) movers ──
// Sits above Sector Rotation. Rows come from the TheStockCatalyst scrape
// (earnings + stocks-in-play per session), biggest |move| first.
function ExtendedHoursBox({ pipeline, onTickerClick, stockMap }) {
  const ARIA = useAriaTheme();
  const ownedTint = useOwnedTint();
  // Rotation layers (module-cached fetch) — gives graded movers their BASE
  // context: RS rank + layer + structural regime. The routine's web research
  // grades the catalyst; this is the other half of the EP framework.
  const rot = useRsRotation();
  const layerCtx = (t) => {
    const st = stockMap?.[t];
    if (!st) return null;
    const chains = chainsForStock(t, st) || [];
    let lay = null;
    if (chains.length && rot?.layers) {
      const keys = new Set(chains.map((c) => `${c.themeId}|${c.layer}`));
      const matches = rot.layers.filter((l) => keys.has(`${l.themeId}|${l.name}`));
      if (matches.length) lay = matches.sort((a, b) => (b.now ?? -1) - (a.now ?? -1))[0];
    }
    return { rs: st.rs_rank ?? null, lay };
  };
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("tp-exthours-collapsed") !== "1"; } catch { return true; } });
  const toggle = () => setOpen((o) => { const n = !o; try { localStorage.setItem("tp-exthours-collapsed", n ? "0" : "1"); } catch {} return n; });
  // Graded premarket feed from the 6AM movers routine (EP grades + catalysts
  // + top setups), POSTed to /api/userdata?scope=pm-movers. Replaces the raw
  // scrape in the PM column whenever a blob for the current session exists.
  const [pmRoutine, setPmRoutine] = useState(null);
  const [ahRoutine, setAhRoutine] = useState(null);
  useEffect(() => {
    let dead = false;
    fetch("/api/userdata?scope=pm-movers").then((r) => r.json())
      .then((d) => { if (!dead && d?.ok && d.data) setPmRoutine(d.data); })
      .catch(() => {});
    fetch("/api/userdata?scope=ah-movers").then((r) => r.json())
      .then((d) => { if (!dead && d?.ok && d.data) setAhRoutine(d.data); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);
  const mk = (ers, sips) => {
    const seen = new Set(); const out = [];
    [...(ers || []).map((m) => ({ ...m, _t: "ER" })), ...(sips || []).map((m) => ({ ...m, _t: "SIP" }))].forEach((m) => {
      if (!m.ticker || seen.has(m.ticker)) return;
      seen.add(m.ticker); out.push(m);
    });
    return out.sort((a, b) => Math.abs(b.ext_hours_change_pct ?? b.change_pct ?? 0) - Math.abs(a.ext_hours_change_pct ?? a.change_pct ?? 0)).slice(0, 12);
  };
  const pm = mk(pipeline?.pm_earnings_movers, pipeline?.pm_sip_movers);
  const ah = mk(pipeline?.ah_earnings_movers, pipeline?.ah_sip_movers);
  if (!pm.length && !ah.length) return null;
  // Which SESSION each column belongs to, derived from the scrape time
  // (pipeline_meta.last_run, ET-naive). Premarket = the trading day of the
  // scrape morning (today, once the 6AM ET run lands); post-market = the most
  // recent session CLOSE before the scrape — e.g. Monday morning shows
  // Monday's premarket next to Friday's post-market.
  const [pmDate, ahDate, pmSessionISO, ahSessionISO] = (() => {
    const lr = pipeline?.pipeline_meta?.last_run;
    const t = lr ? new Date(lr) : new Date();
    if (isNaN(t.getTime())) return [null, null, null, null];
    const prevTrading = (d) => { const x = new Date(d); do { x.setDate(x.getDate() - 1); } while (x.getDay() === 0 || x.getDay() === 6); return x; };
    const dow = t.getDay(), hr = t.getHours();
    let pmD, ahD;
    if (dow === 0 || dow === 6) { pmD = ahD = prevTrading(t); }
    else {
      pmD = hr >= 4 ? t : prevTrading(t);
      ahD = hr >= 16 ? t : prevTrading(t);
    }
    const fmt = (d) => `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return [fmt(pmD), fmt(ahD), iso(pmD), iso(ahD)];
  })();

  const fmtVol = (v) => !v ? "" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : (v / 1e3).toFixed(0) + "K";
  const col = (title, color, rows) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color, marginBottom: 2 }}>{title} ({rows.length})</div>
      {rows.length === 0 && <div style={{ fontSize: 8, color: ARIA.textMuted, padding: "2px 0" }}>no movers scraped this session</div>}
      {rows.map((m) => {
        const chg = m.ext_hours_change_pct ?? m.change_pct;
        const items = (m.recent_headlines?.length ? m.recent_headlines : m.headlines) || [];
        const inU = !!stockMap?.[m.ticker];
        return (
          <div key={m.ticker} onClick={() => onTickerClick?.(m.ticker)}
            title={`${m.name || m.ticker} — ${chg != null ? (chg > 0 ? "+" : "") + chg.toFixed(1) + "%" : "—"}${m.volume ? ` · vol ${fmtVol(m.volume)}` : ""}${m._t === "ER" ? " · earnings mover" : ""}${inU ? "" : " · NOT in universe"}${items[0] ? `
${items[0]}` : ""} (click to chart)`}
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 8.5, fontFamily: "monospace", cursor: "pointer", padding: "1px 2px", borderRadius: 2, background: ownedTint(m.ticker, ARIA) }}
            onMouseEnter={(e) => { e.currentTarget.style.background = ARIA.bgHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = ownedTint(m.ticker, ARIA); }}>
            <span style={{ width: 44, flexShrink: 0, fontWeight: 700, color: inU ? ARIA.text : ARIA.textMuted }}>{m.ticker}</span>
            <span style={{ width: 48, flexShrink: 0, textAlign: "right", fontWeight: 700, color: chg == null ? ARIA.textMuted : chg > 0 ? ARIA.green : ARIA.red }}>{chg != null ? `${chg > 0 ? "+" : ""}${chg.toFixed(1)}%` : "—"}</span>
            <span style={{ width: 38, flexShrink: 0, textAlign: "right", color: ARIA.textMuted }}>{fmtVol(m.volume)}</span>
            {m._t === "ER" && <span style={{ fontSize: 6.5, fontWeight: 800, color: ARIA.cyan, border: `1px solid ${ARIA.cyan}55`, borderRadius: 2, padding: "0 2px", flexShrink: 0 }}>ER</span>}
            {items.length > 0 && <span onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("tp-news-pop", { detail: { x: e.clientX, y: e.clientY, ticker: m.ticker, items } })); }}
              title="Click for catalyst headlines" style={{ fontSize: 8, opacity: 0.8, cursor: "pointer", flexShrink: 0 }}>📰</span>}
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ARIA.textDim, fontSize: 7.5 }}>{items[0] || ""}</span>
          </div>
        );
      })}
    </div>
  );
  // Routine blob only replaces the raw scrape when it's for the CURRENT
  // session — yesterday's graded scan must not masquerade as today.
  const GRADE_ORD = { A: 0, B: 1, C: 2, D: 3, F: 4 };
  const gradeC = (g) => g === "A" ? ARIA.green : g === "B" ? ARIA.blue : g === "C" ? ARIA.textDim : g === "F" ? ARIA.red : ARIA.textMuted;
  const gradedCol = (blob, sessionISO, label, color) => {
    const fresh = blob && sessionISO && blob.date === sessionISO && blob.rows?.length;
    if (!fresh) return null;
    return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color, marginBottom: 2 }}>
        {label} — graded scan ({blob.rows.length})
      </div>
      {[...blob.rows].sort((a, b) => (GRADE_ORD[a.grade] ?? 9) - (GRADE_ORD[b.grade] ?? 9) || Math.abs(b.chg_pct ?? 0) - Math.abs(a.chg_pct ?? 0)).map((m) => (
        <div key={m.ticker} onClick={() => onTickerClick?.(m.ticker)}
          title={`${m.ticker} — EP grade ${m.grade ?? "—"}${m.chg_pct != null ? ` · ${m.chg_pct > 0 ? "+" : ""}${m.chg_pct.toFixed(1)}%` : ""}${m.catalyst ? `
${m.catalyst}` : ""} (click to chart)`}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 8.5, fontFamily: "monospace", cursor: "pointer", padding: "1px 2px", borderRadius: 2, background: ownedTint(m.ticker, ARIA) }}
          onMouseEnter={(e) => { e.currentTarget.style.background = ARIA.bgHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ownedTint(m.ticker, ARIA); }}>
          <span style={{ width: 13, flexShrink: 0, fontWeight: 800, color: gradeC(m.grade) }}>{m.grade || "—"}</span>
          <span style={{ width: 44, flexShrink: 0, fontWeight: 700, color: stockMap?.[m.ticker] ? ARIA.text : ARIA.textMuted }}>{m.ticker}</span>
          <span style={{ width: 48, flexShrink: 0, textAlign: "right", fontWeight: 700, color: m.chg_pct == null ? ARIA.textMuted : m.chg_pct > 0 ? ARIA.green : ARIA.red }}>{m.chg_pct != null ? `${m.chg_pct > 0 ? "+" : ""}${m.chg_pct.toFixed(1)}%` : "—"}</span>
          {(() => {
            const ctx = layerCtx(m.ticker);
            if (!ctx) return null;
            const RC2 = { green: "#16a34a", yellow: "#d9a441", red: "#b1374a" };
            return (
              <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 7 }}
                title={`${m.ticker} base context: RS rank ${ctx.rs ?? "—"}${ctx.lay ? ` · ${ctx.lay.theme} / ${ctx.lay.name} — layer rank ${ctx.lay.now}, structure ${ctx.lay.regime || "—"}` : " · no layer"}. Catalyst grade × base quality = the full EP read.`}>
                {ctx.rs != null && <span style={{ fontWeight: 700, color: ctx.rs >= 90 ? ARIA.green : ctx.rs <= 30 ? ARIA.red : ARIA.textMuted }}>RS{ctx.rs}</span>}
                {ctx.lay && <span style={{ display: "inline-flex", alignItems: "center", gap: 2, color: ARIA.textMuted }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: RC2[ctx.lay.regime] || ARIA.textMuted, flexShrink: 0 }} />
                  <span style={{ maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ctx.lay.name}</span>
                  <span style={{ fontWeight: 700, color: (ctx.lay.now ?? 0) >= 88 ? ARIA.green : ARIA.textDim }}>{ctx.lay.now}</span>
                </span>}
              </span>
            );
          })()}
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ARIA.textDim, fontSize: 7.5 }}>{m.catalyst || ""}</span>
        </div>
      ))}
      {blob.top_setups?.length > 0 && (
        <div style={{ marginTop: 5 }}>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: ARIA.green, marginBottom: 2 }}>Top Setups</div>
          {blob.top_setups.map((t2) => (
            <div key={t2.ticker} onClick={() => onTickerClick?.(t2.ticker)} title={`${t2.ticker}${t2.note ? ` — ${t2.note}` : ""} (click to chart)`}
              style={{ display: "flex", alignItems: "baseline", gap: 5, fontSize: 8.5, fontFamily: "monospace", cursor: "pointer", padding: "1px 2px", borderRadius: 2, background: ownedTint(t2.ticker, ARIA) }}>
              <span style={{ fontWeight: 700, color: ARIA.text, flexShrink: 0 }}>{t2.ticker}</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ARIA.textDim, fontSize: 7.5 }}>{t2.note || ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
    );
  };
  const pmGraded = gradedCol(pmRoutine, pmSessionISO, pmDate ? `Premarket · ${pmDate}` : "Premarket", ARIA.yellow);
  const ahGraded = gradedCol(ahRoutine, ahSessionISO, ahDate ? `Post-market · ${ahDate}` : "Post-market", ARIA.purple);
  // "Reporting tonight" — today's AMC reporters from the FMP earnings
  // calendar (confirmed dates; the pipeline's earnings_days is an estimate
  // that reads 0 for TOMORROW's reporters when computed intraday). Shown
  // atop the post-market column until the 8PM graded scan covers them.
  const [tonightEvents, setTonightEvents] = useState(null);
  useEffect(() => {
    let dead = false;
    const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const iso = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
    fetch(`/api/earnings?from=${iso}&to=${iso}`).then((r) => r.json())
      .then((d2) => { if (!dead && Array.isArray(d2?.events)) setTonightEvents(d2.events); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);
  const tonight = (() => {
    if (!tonightEvents || !stockMap) return [];
    // Calendar dates are confirmed but its timing field comes back empty on
    // this FMP tier — use the pipeline's er_timing for the AMC/BMO split
    // (timing estimates hold up even when its date estimates drift).
    // Names already in today's PM earnings movers reported BMO — the print
    // is out, they're not "tonight" (er_timing is often null for them).
    const reported = new Set((pipeline?.pm_earnings_movers || []).map((m) => m.ticker));
    return tonightEvents
      .filter((e) => {
        const st = stockMap[e.ticker];
        return st && !reported.has(e.ticker) && (st.er_timing == null || /amc|after/i.test(st.er_timing));
      })
      .map((e) => stockMap[e.ticker])
      .sort((a, b) => (b.avg_dollar_vol_raw || 0) - (a.avg_dollar_vol_raw || 0))
      .slice(0, 12);
  })();
  const tonightRow = tonight.length > 0 ? (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
      <span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: ARIA.red }}>Reporting tonight</span>
      {tonight.map((st) => (
        <button key={st.ticker} onClick={() => onTickerClick?.(st.ticker)}
          title={`${st.ticker} reports after the close today${st.rs_rank != null ? ` · RS ${st.rs_rank}` : ""} — the 8PM scan will grade the print. Zanger: sell a full day before; Ryan: never hold size through earnings. (click to chart)`}
          style={{ fontSize: 7.5, fontWeight: 700, fontFamily: "monospace", cursor: "pointer", padding: "1px 5px", borderRadius: 3,
            color: ARIA.text, border: `1px solid ${ARIA.border}`, background: ownedTint(st.ticker, ARIA) }}>
          {st.ticker}
        </button>
      ))}
    </div>
  ) : null;
  return (
    <div style={{ background: ARIA.bgRow, borderRadius: 6, border: `1px solid ${ARIA.border}`, marginBottom: 8, fontFamily: "monospace" }}>
      <div onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: "pointer", userSelect: "none", flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, color: ARIA.textMuted }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: 9, color: ARIA.text, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 800 }}>Extended Hours</span>
        <span style={{ fontSize: 8, color: ARIA.textDim }}>premarket · post-market movers</span>
        {!open && (
          <span style={{ fontSize: 8, color: ARIA.textMuted, marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            <span style={{ color: ARIA.yellow }}>PM {pm.slice(0, 3).map((m) => m.ticker).join(" ")}</span>
            {"  "}<span style={{ color: ARIA.purple }}>AH {ah.slice(0, 3).map((m) => m.ticker).join(" ")}</span>
          </span>
        )}
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${ARIA.border}`, padding: "6px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {pmGraded || col(pmDate ? `Premarket · ${pmDate}` : "Premarket", ARIA.yellow, pm)}
          <div style={{ minWidth: 0 }}>
            {tonightRow}
            {ahGraded || col(ahDate ? `Post-market · ${ahDate}` : "Post-market", ARIA.purple, ah)}
          </div>
        </div>
      )}
    </div>
  );
}

function RsRotationBoard({ onTickerClick, chartTicker, stockMap, pipelineMeta, movers = [] }) {
  const ARIA = useAriaTheme();
  const d = useRsRotation();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem("tp-rs-board-open") === "1"; } catch { return false; }
  });
  // Symbol for the embedded Index Regime chart (was the standalone Breadth Monitor).
  const [sym, setSym] = useState(() => {
    try { return localStorage.getItem("tp-breadth-sym") || "SPY"; } catch { return "SPY"; }
  });
  const [rsTab, setRsTab] = useState("layers"); // right-panel tab: sectors | industries | layers | leaders
  const [layerHolds, setLayerHolds] = useState(null); // selected layer's constituents, or null (ETF mode)
  const [topLayers, setTopLayers] = useState(() => { const n = parseInt(localStorage.getItem("tp-funnel-layers") || "8", 10); return [5, 8, 12].includes(n) ? n : 8; });
  const [basketMode, setBasketMode] = useState(false); // chart = EW basket of layer vs single ticker
  const [basketLabel, setBasketLabel] = useState("");
  const [selectedLayerKey, setSelectedLayerKey] = useState(null); // "themeId|layer" of current layer
  const setSymPersist = useCallback((s) => {
    setSym(s); try { localStorage.setItem("tp-breadth-sym", s); } catch {}
  }, []);
  // stocks array for the embedded Earnings Calendar subtab (it expects the pipeline array shape)
  const stocksArr = useMemo(() => Object.values(stockMap || {}), [stockMap]);
  // 👑 Apex evidence — walk-forward on-deck-vs-cold outcomes, written nightly by
  // apex_tracker.py to /data/apex_evidence.json (the live test of the 63d backtest).
  const [apexEv, setApexEv] = useState(null);
  useEffect(() => {
    fetch("/data/apex_evidence.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then(setApexEv).catch(() => {});
  }, []);
  // Let Market Conditions' rotation dots (or anything) drive the chart symbol.
  useEffect(() => {
    const onSym = (e) => {
      const t = (e?.detail || "").toUpperCase();
      if (!t) return;
      setLayerHolds(null); setBasketMode(false); setSelectedLayerKey(null);
      setSymPersist(t);
      setOpen(true); try { localStorage.setItem("tp-rs-board-open", "1"); } catch {}
    };
    window.addEventListener("tp-breadth-sym", onSym);
    return () => window.removeEventListener("tp-breadth-sym", onSym);
  }, [setSymPersist]);
  const toggle = () => setOpen((v) => { const n = !v; try { localStorage.setItem("tp-rs-board-open", n ? "1" : "0"); } catch {} return n; });
  // ER Cal focus — when a calendar chip is clicked, the regime box's left
  // column shows that reporter's MAGNA breakdown until dismissed or until
  // any other navigation replaces it.
  const [erFocus, setErFocus] = useState(null);
  // Click an ETF ticker (table / mover / dropdown) → chart it + ETF holdings.
  const openTicker = (t) => {
    if (!t) return;
    setErFocus(null);
    setLayerHolds(null); setBasketMode(false); setSelectedLayerKey(null);
    setSymPersist(t);
    setOpen(true); try { localStorage.setItem("tp-rs-board-open", "1"); } catch {}
    onTickerClick?.(t);
  };
  // ER Cal chip click: chart it AND show the MAGNA breakdown in the left box.
  const openErTicker = (t) => { openTicker(t); setErFocus(t); };
  // Load a layer (EW basket + constituents). `doChart` charts its lead below;
  // `keepTab` loads the basket but stays on the current subtab (Leaders/Emerging).
  const applyLayer = (r, doChart, keepTab) => {
    if (!r?.ticker) return;
    setErFocus(null);
    setLayerHolds(r.holds || []);
    setBasketLabel(r.name || ""); setBasketMode(true);
    setSelectedLayerKey(`${r.themeId}|${r.name}`);
    if (!keepTab) setRsTab("layers");
    setSymPersist(r.ticker);
    setOpen(true); try { localStorage.setItem("tp-rs-board-open", "1"); } catch {}
    if (doChart) onTickerClick?.(r.ticker);
  };
  // Best mover match for the focused ER ticker (prefer entries carrying er data)
  const erFocusMover = useMemo(() => {
    if (!erFocus) return null;
    let best = null;
    (movers || []).forEach((mv) => { if (mv?.ticker === erFocus && (!best || (mv.er && !best.er))) best = mv; });
    return best;
  }, [erFocus, movers]);
  const openLayer = (r) => applyLayer(r, true);
  // From Leaders/Emerging: load the layer basket but don't switch to Layers and
  // don't chart a ticker (which would trip reverse-sync) — stay put.
  const openLayerStay = (r) => applyLayer(r, false, true);
  // (Reverse sync removed 2026-07: charting a ticker no longer auto-loads its
  // layer or switches the subtab — clicks stay wherever you are. The "{t} is
  // in:" chips remain the explicit way to jump to a containing layer.)
  // Auto-select the top layer (by RS Acc², the default sort) once on load, so the
  // regime chart shows a layer basket instead of SPY. Doesn't open the board or
  // change the main chart; user clicks still take over.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current || basketMode || layerHolds) return;
    if (!d?.layers?.length) return;
    autoSelectedRef.current = true;
    const acc = (l) => (l.rsWk != null && l.rsMth != null ? l.rsWk * 4.2 - l.rsMth : -Infinity);
    const top = d.layers.reduce((a, b) => (acc(b) > acc(a) ? b : a));
    setLayerHolds(top.holds || []);
    setBasketLabel(top.name || ""); setBasketMode(true);
    setSelectedLayerKey(`${top.themeId}|${top.name}`);
    setSymPersist(top.ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  // Live intraday overlay: poll quotes for the active tab's tickers so RS Day%
  // reflects today's move vs SPY (like the Chain α column), not the last close.
  // Ranks / Wk / Mth / Acc² stay EOD (multi-day, barely move intraday).
  const liveUniverse = useMemo(() => {
    if (!open || !d) return [];
    const s = new Set(["SPY", "QQQ"]); // QQQ = benchmark for the Tech tab's RS Day%
    if (rsTab === "sectors") (d.sectors || []).forEach((r) => r.ticker && s.add(r.ticker));
    else if (rsTab === "industries") (d.industries || []).forEach((r) => r.ticker && s.add(r.ticker));
    else (d.layers || []).forEach((l) => (l.holds || []).forEach((h) => h.t && s.add(h.t)));
    return [...s];
  }, [open, rsTab, d]);
  const { quotes: liveQuotes } = useLiveQuotes(liveUniverse, 30000);
  // ZVR only feeds the selected layer's constituents panel — poll just those.
  const zvrUniverse = useMemo(() => (open && layerHolds ? layerHolds.map((h) => h.t) : []), [open, layerHolds]);
  const { cur: zvrMap } = useZVR(zvrUniverse);
  const spyRet = useSpyReturns(); // SPY 1w/1m for per-stock relative returns (Leaders tab)
  const qqqRet = useBenchReturns("QQQ"); // Tech tab: convert Wk/Mth columns to vs-QQQ
  const [pfList] = useLocalStorageList("themepulse-portfolio"); // held names → 💼 markers
  if (!d) return null; // all hooks run above this guard
  const spyChg = liveQuotes.get("SPY")?.change;
  const qqqChg = liveQuotes.get("QQQ")?.change;
  // holdings → which layers contain them (full membership via chainsForStock)
  const heldSet = new Set(pfList || []);
  const heldByLayer = {};
  (pfList || []).forEach((t) => {
    (chainsForStock(t, stockMap?.[t]) || []).forEach((c) => {
      const k = `${c.themeId}|${c.layer}`;
      (heldByLayer[k] = heldByLayer[k] || []).push(t);
    });
  });
  const isTechTab = rsTab === "tech";
  const isLayerLike = rsTab === "layers" || isTechTab || rsTab === "extech";
  const liveDay = (r) => {
    // Tech tab benchmarks vs QQQ — "strength WITHIN tech", so a cyber layer
    // holding flat while QQQ bleeds reads as strongly positive.
    const bench = isTechTab ? qqqChg : spyChg;
    if (bench == null) return r.rsDay;
    if (isLayerLike) {
      const vals = (r.holds || []).map((h) => { const q = liveQuotes.get(h.t); return q?.change != null ? q.change - bench : null; }).filter((v) => v != null);
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : r.rsDay;
    }
    const q = liveQuotes.get(r.ticker);
    return q?.change != null ? Math.round((q.change - bench) * 100) / 100 : r.rsDay;
  };
  // Normalized layer ZVR: signed relative-volume per ticker, averaged across the
  // layer's constituents — count-independent so layers of different sizes are
  // comparable. ETF rows use their own. The /api/live?universe= feed doesn't
  // carry rel_volume, so compute it the same way Scan Watch does: session-
  // elapsed estimate volume/(avg×elapsedFrac), falling back to pipeline rel_vol.
  const _et2 = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const _et2Min = _et2.getHours() * 60 + _et2.getMinutes();
  const _rthNow = _et2Min >= 570 && _et2Min < 960;
  const _elapsed = _rthNow ? Math.max(0.02, sessionVolFraction(_et2Min - 570)) : 1.0;
  const tickerZvr = (t) => {
    const q = liveQuotes.get(t); const s = stockMap?.[t];
    if (!q) return null;
    const liveVol = q.volume; const avgVol = s?.avg_volume_raw || q.avgVolume || 0;
    let v = null;
    if (liveVol && avgVol > 0) v = (liveVol / (avgVol * _elapsed)) * 100;
    else if (s?.rel_volume > 0) v = s.rel_volume * 100;
    if (v == null) return null;
    if (q.change != null && q.change < 0) v = -v;
    return v;
  };
  const liveZvr = (r) => {
    if (isLayerLike) {
      const vals = (r.holds || []).map((h) => tickerZvr(h.t)).filter((v) => v != null);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    }
    // Sectors/industries are single ETFs with no stockMap entry; FMP batch-quote
    // doesn't return avgVolume and the live backfill is capped, so use the
    // pipeline's per-ETF avgVol baseline (falls back to live avgVolume).
    const q = liveQuotes.get(r.ticker);
    const av = r.avgVol || q?.avgVolume || 0;
    const lv = q?.volume;
    if (!lv || av <= 0) return null;
    let v = Math.round((lv / (av * _elapsed)) * 100);
    if (q.change != null && q.change < 0) v = -v;
    return v;
  };
  // Tech tab: tech-theme layers only, RE-RANKED among themselves (0-100
  // percentile within tech) so leadership INSIDE the sector is visible even
  // when tech broadly sells off. Day% benchmarks vs QQQ (see liveDay).
  const subsetRanked = (pred) => {
    const subset = (d.layers || []).filter(pred).map((l) => ({ ...l }));
    ["now", "d1", "w1", "m1"].forEach((k) => {
      const order = [...subset].filter((l) => l[k] != null).sort((a, b) => a[k] - b[k]);
      const n = (order.length - 1) || 1;
      const rank = new Map(order.map((l, i) => [l, Math.round((i / n) * 100)]));
      subset.forEach((l) => { l[k] = rank.has(l) ? rank.get(l) : null; });
    });
    return subset;
  };
  const techRows = isTechTab ? subsetRanked((l) => TECH_THEMES.has(l.themeId)) : [];
  // Ex-Tech: everything OUTSIDE the tech themes, re-ranked among themselves —
  // where money rotates TO when it leaves tech. Benchmarked vs SPY.
  const isExTab = rsTab === "extech";
  const exRows = isExTab ? subsetRanked((l) => !TECH_THEMES.has(l.themeId)) : [];
  const baseRows = rsTab === "sectors" ? d.sectors : rsTab === "industries" ? d.industries : isTechTab ? techRows : isExTab ? exRows : (d.layers || []);
  // Tech tab: shift the pipeline's vs-SPY Wk/Mth columns to vs-QQQ so they
  // match the tab's benchmark — and so RS Acc¹/Acc² (derived from Day/Wk/Mth)
  // stay internally consistent instead of mixing benchmarks.
  const wAdj = (isTechTab && spyRet?.["1w"] != null && qqqRet?.["1w"] != null) ? spyRet["1w"] - qqqRet["1w"] : null;
  const mAdj = (isTechTab && spyRet?.["1m"] != null && qqqRet?.["1m"] != null) ? spyRet["1m"] - qqqRet["1m"] : null;
  const activeRows = baseRows.map((r) => {
    const row = { ...r, rsDay: liveDay(r), zvr: liveZvr(r) };
    // Layer-average CR% and EIF from constituents — the shared-core columns that
    // match Scan Watch (ETF sector/industry rows have no holds → left null).
    if (r.holds && r.holds.length) {
      const eifs = r.holds.map((h) => stockMap?.[h.t]?.framework_score).filter((v) => v != null);
      row.eif = eifs.length ? Math.round(eifs.reduce((a, b) => a + b, 0) / eifs.length) : null;
      const crs = r.holds.map((h) => computeCR(liveQuotes.get(h.t), stockMap?.[h.t])).filter((v) => v != null);
      row.cr = crs.length ? Math.round(crs.reduce((a, b) => a + b, 0) / crs.length) : null;
    }
    if (isTechTab && wAdj != null && row.rsWk != null) row.rsWk = +(row.rsWk + wAdj).toFixed(2);
    if (isTechTab && mAdj != null && row.rsMth != null) row.rsMth = +(row.rsMth + mAdj).toFixed(2);
    return row;
  });

  // Enrich a set of layers' constituents into stock rows. Rank boxes (Now/1D/
  // 1W/1M) = the parent layer's trajectory; the RS%/ZVR/52W columns are the
  // stock's own. Shared by Leaders + Emerging.
  const clampPct = (v) => Math.max(0, Math.min(100, v));
  const sortedLayers = (n) => [...(d.layers || [])].sort((a, b) => (b.now ?? -1) - (a.now ?? -1)).slice(0, n);
  const buildStocks = (lyrs) => {
    const byT = new Map();
    lyrs.forEach((l) => (l.holds || []).forEach((h) => {
      const prev = byT.get(h.t);
      if (!prev || (l.now ?? -1) > prev._lnow) byT.set(h.t, { t: h.t, layer: l, _lnow: l.now ?? -1 });
    }));
    const sp1w = spyRet?.["1w"] ?? 0, sp1m = spyRet?.["1m"] ?? 0;
    return [...byT.values()].map(({ t, layer }) => {
      const s = stockMap?.[t] || {}; const q = liveQuotes.get(t);
      const chg = q?.change ?? s.change_pct ?? null;
      const rsDay = chg != null ? +(chg - (spyChg ?? 0)).toFixed(2) : null;
      const rsWk = s.return_1w != null ? +(s.return_1w - sp1w).toFixed(2) : null;
      const rsMth = s.return_1m != null ? +(s.return_1m - sp1m).toFixed(2) : null;
      let zvr = null; const lv = q?.volume, av = s.avg_volume_raw || q?.avgVolume || 0;
      if (lv && av > 0) zvr = Math.round((lv / (av * _elapsed)) * 100);
      else if (s.rel_volume > 0) zvr = Math.round(s.rel_volume * 100);
      if (zvr != null && chg != null && chg < 0) zvr = -zvr;
      return { ticker: t, name: layer.name, theme: layer.theme, themeId: layer.themeId,
        now: layer.now, d1: layer.d1, w1: layer.w1, m1: layer.m1, rsDay, rsWk, rsMth,
        off52: s.off_52w_high ?? null, cr: computeCR(q, s), zvr, eif: s.framework_score ?? null, rsRank: s.rs_rank ?? null,
        chg, adr: s.adr_pct ?? null, d20: s.dist_20dma_atrx ?? null, d50: s.dist_50sma_atrx ?? null, // for the Setup badge
        erDays: s.earnings_days ?? null, rsLineNewHigh: !!s.rs_line_new_high, tt: !!s.two_day_tight, de: !!s.de_ready, deTrig: s.de_trigger ?? null, deHold: s.de_hold ?? null, news: s._newsPipe ?? null, inPlay: !!s._inPlay };
    });
  };

  // Leaders: strongest established names in the top-N layers (RS + EIF + near-
  // high + volume). The top-40 also form an exclusion set for Emerging.
  const isLeadersFamily = rsTab === "leaders" || rsTab === "emerging" || rsTab === "leadersall";
  const leaderPool = isLeadersFamily ? buildStocks(sortedLayers(topLayers)) : [];
  const leaderTop = leaderPool.map((r) => ({ ...r, _score:
    0.40 * (r.rsRank ?? 0) + 0.30 * (r.eif != null ? clampPct(r.eif / 86 * 100) : 0)
    + 0.20 * (r.off52 != null ? clampPct(100 * (1 - Math.min(40, Math.max(0, -r.off52)) / 40)) : 50)
    + 0.10 * (r.zvr != null ? clampPct(50 + r.zvr / 3) : 50) })).sort((a, b) => b._score - a._score).slice(0, 40);
  const leaderSet = new Set(leaderTop.map((r) => r.ticker));
  const leaderRows = isLeadersFamily ? leaderTop.map((r, i) => ({ ...r, lead: i + 1, _tier: "L" })) : [];

  // Emerging: quality names near a 52w high (or RS-line new high) that AREN'T
  // already established leaders. Scans a BROADER pool (top ~36 layers) than
  // Leaders so it surfaces the mid-tier names rotating up — never the same
  // tickers as Leaders. Volume is a score bonus, not a hard gate.
  const emergingRows = (() => {
    if (!isLeadersFamily) return [];
    const pool = buildStocks(sortedLayers(Math.max(36, topLayers)));
    const cand = pool.filter((r) =>
      !leaderSet.has(r.ticker) &&                                  // not already in Leaders
      ((r.off52 != null && r.off52 >= -8) || r.rsLineNewHigh) &&    // at/near 52w high or RS-line new high
      (r.eif != null && r.eif >= 45));                             // quality (relaxed floor)
    const rows = cand.map((r) => ({ ...r, _score:
      0.34 * (r.off52 != null ? clampPct(100 * (1 - Math.min(20, Math.max(0, -r.off52)) / 20)) : 50) // proximity to high
      + 0.28 * (r.eif != null ? clampPct(r.eif / 86 * 100) : 0)                                       // quality
      + 0.18 * (r.zvr != null ? clampPct(50 + r.zvr / 3) : 50)                                         // volume conviction (bonus)
      + 0.10 * (r.rsLineNewHigh ? 100 : 0)                                                             // RS-line new high = early
      + 0.10 * (r.rsDay != null ? clampPct(50 + r.rsDay * 8) : 50) }));                                // today's relative strength
    rows.sort((a, b) => b._score - a._score);
    rows.forEach((r, i) => { r.lead = i + 1; r._tier = "E"; });
    return rows.slice(0, 40);
  })();
  // Combined "All" — leaders + emerging as one unified leaderboard (non-overlapping
  // by construction), re-ranked by RS so the strongest float to the top.
  const combinedRows = rsTab === "leadersall"
    ? [...leaderRows, ...emergingRows].sort((a, b) => (b.rsRank ?? 0) - (a.rsRank ?? 0)).map((r, i) => ({ ...r, lead: i + 1 }))
    : [];
  const liveOn = spyChg != null;
  return (
    <div style={{ background: ARIA.bgRow, borderRadius: 6, border: `1px solid ${ARIA.border}`, marginBottom: 8, fontFamily: "monospace" }}>
      <div onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: "pointer", userSelect: "none", flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, color: ARIA.textMuted }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: 9, color: ARIA.text, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 800 }}>Sector Rotation</span>
        <span style={{ fontSize: 8, color: ARIA.textDim }}>what's rotating in / out · {d.universe} ETFs</span>
        {(() => {
          // Structural breadth: regime distribution across all layers — the
          // layer-level Net H/L. Mostly green = broad uptrend; red past ~1/3 =
          // the rotation is really distribution.
          const lys = d.layers || [];
          const c = { green: 0, yellow: 0, red: 0 };
          lys.forEach((l) => { if (c[l.regime] != null) c[l.regime]++; });
          const tot = c.green + c.yellow + c.red;
          if (!tot) return null;
          return (
            <span onClick={(e) => e.stopPropagation()} title={`Structural breadth across ${tot} layers: ${c.green} green (trend intact) · ${c.yellow} yellow (10d EMA < 20d — deteriorating) · ${c.red} red (below the ~20-week line). Layer-level Net H/L: mostly green = broad uptrend; red past a third = rotation is distribution.`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "help" }}>
              <span style={{ display: "inline-flex", width: 64, height: 5, borderRadius: 2, overflow: "hidden" }}>
                <span style={{ width: `${c.green / tot * 100}%`, background: "#16a34a" }} />
                <span style={{ width: `${c.yellow / tot * 100}%`, background: "#d9a441" }} />
                <span style={{ width: `${c.red / tot * 100}%`, background: "#b1374a" }} />
              </span>
              <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace" }}>{c.green}·{c.yellow}·{c.red}</span>
            </span>
          );
        })()}
        {!open && (() => {
          const ar = rsTab === "sectors" ? d.sectors : rsTab === "industries" ? d.industries : (d.layers || []);
          const sc = ar.filter((r) => r.d1 != null).map((r) => ({ ...r, pts: r.now - r.d1 }));
          const up = [...sc].sort((a, b) => b.pts - a.pts).slice(0, 3);
          const dn = [...sc].sort((a, b) => a.pts - b.pts).slice(0, 3);
          if (!up.length) return null;
          return (
            <span style={{ fontSize: 8, color: ARIA.textMuted, marginLeft: "auto" }}>
              <span style={{ color: ARIA.green }}>in ↑ {up.map((m) => m.ticker).join(" ")}</span>
              {"  "}<span style={{ color: ARIA.red }}>out ↓ {dn.map((m) => m.ticker).join(" ")}</span>
            </span>
          );
        })()}
        <span style={{ fontSize: 7.5, color: ARIA.textMuted, marginLeft: open ? "auto" : 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
          {(() => {
            // Pipeline freshness + live SPY — the old PipelineLiveBar, relocated here
            const lr = pipelineMeta?.last_run;
            let pipelineText = "";
            if (lr) {
              const pd = new Date(lr);
              if (!isNaN(pd)) {
                const diffM = Math.round((Date.now() - pd.getTime()) / 60000);
                const ago = diffM < 1 ? "just now" : diffM < 60 ? `${diffM}m ago` : diffM < 1440 ? `${Math.floor(diffM / 60)}h ago` : `${Math.floor(diffM / 1440)}d ago`;
                pipelineText = `Pipeline: ${pd.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" })} (${ago})`;
              }
            }
            return (
              <>
                {pipelineText && <span style={{ color: ARIA.green, fontWeight: 600 }}>{pipelineText}</span>}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: liveOn ? ARIA.green : "#555", display: "inline-block" }} />
                  <span style={{ color: spyChg == null ? ARIA.textMuted : spyChg >= 0 ? ARIA.green : ARIA.red }}>
                    <span className="tp-livedot" style={{ display: "inline-block" }}>●</span> Live: SPY {spyChg != null ? (spyChg >= 0 ? "+" : "") + Number(spyChg).toFixed(2) + "%" : "—"}
                  </span>
                </span>
              </>
            );
          })()}
          {open && liveOn && <span title="RS Day% is live (today's move vs SPY); ranks are EOD" style={{ display: "inline-flex", alignItems: "center", gap: 3, color: ARIA.green }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: ARIA.green, boxShadow: `0 0 4px ${ARIA.green}` }} />LIVE Day%</span>}
          <span>{open ? "" : "click to expand"} · {d.date}</span>
        </span>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${ARIA.border}`, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* ── Rotation: OUT → IN strip + rank-trajectory lanes ──
              OUT = high-rank layers whose structure has gone yellow/red (money
              leaving); IN = sub-88 structurally-green layers climbing rank
              fastest (destinations). Watch/prep context — per the layer
              backtest, entries only pay AFTER leadership (rank ≥88). */}
          {(() => {
            const lys = d.layers || [];
            if (!lys.length) return null;
            const outL = lys.filter((l) => (l.now ?? 0) >= 88 && (l.regime === "yellow" || l.regime === "red"))
              .sort((a, b) => (b.now ?? 0) - (a.now ?? 0)).slice(0, 4);
            const wkOk = (l) => l.rsWk == null || l.rsWk > 0; // current week must agree
            let inL = lys.filter((l) => (l.now ?? 0) < 88 && l.regime === "green" && l.w1 != null && l.now - l.w1 >= 8 && wkOk(l))
              .sort((a, b) => (b.now - b.w1) - (a.now - a.w1)).slice(0, 4);
            if (!inL.length) inL = lys.filter((l) => (l.now ?? 0) < 88 && l.regime === "green" && l.w1 != null && l.now - l.w1 >= 5 && wkOk(l))
              .sort((a, b) => (b.now - b.w1) - (a.now - a.w1)).slice(0, 3);
            const chip = (l, col) => (
              <button key={`${l.themeId}|${l.name}`} onClick={() => openLayerStay(l)}
                title={`${l.theme} · ${l.name} — rank ${l.now}${l.w1 != null ? ` (1w ago ${l.w1})` : ""} · structure ${l.regime || "—"}${l.b20 != null ? ` · ${l.b20}% above 20dma` : ""}${l.dshift != null ? ` · $vol share ${l.dshift > 0 ? "+" : ""}${l.dshift}%` : ""} (click to load)`}
                style={{ fontSize: 7.5, fontWeight: 700, fontFamily: "monospace", cursor: "pointer", padding: "1px 6px", borderRadius: 3, color: col, background: `${col}14`, border: `1px solid ${col}44` }}>
                {l.name} {l.now}
              </button>
            );
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {(outL.length > 0 || inL.length > 0) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", fontSize: 8, fontFamily: "monospace" }}>
                    <span title="Rotation read: OUT = rank ≥88 with deteriorating/broken structure · IN = sub-88, structure intact, climbing rank fastest (≥8 pts/wk). Prep context — entries pay after leadership, not before."
                      style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: ARIA.textMuted, cursor: "help" }}>Rotation</span>
                    <span style={{ color: ARIA.red, fontWeight: 700 }}>OUT</span>
                    {outL.length ? outL.map((l) => chip(l, ARIA.red)) : <span style={{ color: ARIA.textMuted }}>—</span>}
                    <span style={{ color: ARIA.textMuted, margin: "0 3px" }}>→</span>
                    <span style={{ color: ARIA.green, fontWeight: 700 }}>IN</span>
                    {inL.length ? inL.map((l) => chip(l, ARIA.green)) : <span style={{ color: ARIA.textMuted }}>—</span>}
                  </div>
                )}
                {/* Holdings health — the divergence check on YOUR names: rank vs
                    this-week RS vs 20dma structure. Sell-side application. */}
                {(pfList || []).length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", fontSize: 8, fontFamily: "monospace" }}>
                    <span title="Each held name: RS rank vs THIS week's RS vs 20dma structure. Green = confirmed (tape agrees) · amber = diverging (high rank but this week bleeding, or slipping under the 20dma) · red = breaking (>2 ATR below the 20dma or ≤−4% weekly RS). Deterioration shows here before the rank confirms."
                      style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: ARIA.textMuted, cursor: "help" }}>Holdings</span>
                    {(pfList || []).map((t) => {
                      const st = stockMap?.[t];
                      if (!st) return null;
                      const wk = st.return_1w != null ? +(st.return_1w - (spyRet?.["1w"] ?? 0)).toFixed(1) : null;
                      const d20 = st.dist_20dma_atrx;
                      const rk = st.rs_rank;
                      const state = (d20 != null && d20 <= -2) || (wk != null && wk <= -4) ? "red"
                        : (wk != null && wk <= -1.5) || (d20 != null && d20 < 0 && d20 > -2) ? "yellow" : "green";
                      const col = state === "red" ? ARIA.red : state === "yellow" ? ARIA.yellow : ARIA.green;
                      return (
                        <button key={t} onClick={() => openTicker(t)}
                          title={`${t} — RS rank ${rk ?? "—"} · this week ${wk != null ? (wk > 0 ? "+" : "") + wk + "%" : "—"} vs SPY · ${d20 != null ? d20.toFixed(1) + " ATR from 20dma" : "20dma —"} · ${state === "green" ? "confirmed" : state === "yellow" ? "DIVERGING — tape disagrees with the rank" : (d20 != null && d20 <= -2 ? "BREAKING — structure gone" : "BREAKING — bleeding hard this week")} (click to chart)`}
                          style={{ fontSize: 7.5, fontWeight: 700, fontFamily: "monospace", cursor: "pointer", padding: "1px 6px", borderRadius: 3, color: col, background: `${col}14`, border: `1px solid ${col}44` }}>
                          {t}{rk != null ? ` ${rk}` : ""}{state !== "green" ? (state === "red" ? " 🔻" : " ⚠") : ""}
                        </button>
                      );
                    })}
                  </div>
                )}
                {(() => {
                  // Rank Δ over ~2 weeks (now vs w2, swing-trade horizon), diverging
                  // bars — rotation as magnitude, readable in one glance. Falls back
                  // to m1 until the pipeline emits w2.
                  const scored = lys.filter((l) => (l.w2 ?? l.m1) != null && l.now != null).map((l) => ({ ...l, _base: l.w2 ?? l.m1, dlt: l.now - (l.w2 ?? l.m1) }));
                  // Promotions/demotions across the 88 leadership line are THE
                  // tradeable rotation events (layer backtest: entries pay after
                  // leadership) — pin them first. Percentile compression otherwise
                  // buries them: 79→98 (+19) is a bigger deal than 14→65 (+51).
                  // Left = the strength stack: current leaders (≥88, structure not
                  // deteriorating) + risers (Δ2wk ≥ +6), strongest first. Right =
                  // the weakness stack: decliners (Δ2wk ≤ −6) + leaders whose
                  // structure has gone yellow/red even while still ranked (the
                  // Memory+Storage case), from the top down. ↗/↘ = 88 crossings.
                  // Same intraday heat as the layers table: RS Day% in the top 5%
                  // of layers → green name tint (bottom 5% → red), so today's
                  // leaders read across both surfaces identically.
                  const _dayVals = lys.filter((l) => l.rsDay != null).map((l) => l.rsDay).sort((a, b) => a - b);
                  const dayPct = (v) => (v == null || !_dayVals.length) ? null : Math.round(_dayVals.filter((x) => x <= v).length / _dayVals.length * 100);
                  const dayHeat = (l) => { const p = dayPct(l.rsDay); return p == null ? "transparent" : p >= 95 ? "rgba(13,145,99,0.32)" : p <= 5 ? "rgba(239,68,68,0.32)" : "transparent"; };
                  const weak = (l) => l.dlt <= -6 || ((l.now ?? 0) >= 88 && (l.regime === "yellow" || l.regime === "red"));
                  const risers = scored.filter((l) => !weak(l) && ((l.now ?? 0) >= 88 || l.dlt >= 6))
                    .map((l) => ({ ...l, _promo: l._base < 88 && l.now >= 88 }))
                    .sort((a, b) => b.now - a.now).slice(0, 14);
                  const fallers = scored.filter(weak)
                    .map((l) => ({ ...l, _promo: l._base >= 88 && l.now < 88 }))
                    .sort((a, b) => Math.max(b._base, b.now) - Math.max(a._base, a.now)).slice(0, 14);
                  if (!risers.length && !fallers.length) return null;
                  // "New today" dot: diff board membership against the previous
                  // session's snapshot (localStorage, frontend-only) — answers
                  // "what changed overnight?" without re-reading all 28 rows.
                  // Same-day membership accumulates as a union so a row that
                  // flickers intraday still counts as "seen today" tomorrow.
                  let prevSet = null;
                  try {
                    const NEWKEY = "tp-stack-snapshot";
                    const today = new Date().toISOString().slice(0, 10);
                    const members = [...risers, ...fallers].map((l) => `${l.themeId}|${l.name}`).sort();
                    const snap = JSON.parse(localStorage.getItem(NEWKEY) || "null");
                    if (!snap || snap.date !== today) {
                      localStorage.setItem(NEWKEY, JSON.stringify({ date: today, members, prev: snap ? snap.members : null }));
                      if (snap && snap.members) prevSet = new Set(snap.members);
                    } else {
                      const union = Array.from(new Set([...(snap.members || []), ...members])).sort();
                      if (union.length !== (snap.members || []).length) localStorage.setItem(NEWKEY, JSON.stringify({ ...snap, members: union }));
                      if (snap.prev) prevSet = new Set(snap.prev);
                    }
                  } catch { /* private mode etc. — just skip the dot */ }
                  const isNew = (l) => !!prevSet && !prevSet.has(`${l.themeId}|${l.name}`);
                  const maxD = Math.max(...risers.map((l) => l.dlt), ...fallers.map((l) => -l.dlt), 10);
                  const RC = { green: "#16a34a", yellow: "#d9a441", red: "#b1374a" };
                  const rowEl = (l, dir) => {
                    // Leader red day = dip-buy, not a crack: the layer backtest
                    // found green-structure leaders' weak days paid (+1.18%/21d
                    // even on fading leaders). The red heat tint alone reads as
                    // a warning — flip it when structure is intact.
                    const _dp = dayPct(l.rsDay);
                    const dip = dir > 0 && l.regime === "green" && (l.now ?? 0) >= 88 && _dp != null && _dp <= 5;
                    return (
                    <div key={`${l.themeId}|${l.name}`} onClick={() => openLayerStay(l)}
                      title={`${l.theme} · ${l.name} — rank ${l._base} → ${l.now} over ~2 weeks${l.rsDay != null ? ` · RS Day ${l.rsDay > 0 ? "+" : ""}${l.rsDay.toFixed(2)}%${dayPct(l.rsDay) >= 95 ? " (top 5% today)" : dayPct(l.rsDay) <= 5 ? " (bottom 5% today)" : ""}` : ""} · structure ${l.regime || "—"}${l.b20 != null ? ` · ${l.b20}% above 20dma` : ""}${l.dshift != null ? ` · $vol share ${l.dshift > 0 ? "+" : ""}${l.dshift}%` : ""} (click to load)`}
                      style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 8, fontFamily: "monospace", padding: "1px 0" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: RC[l.regime] || ARIA.textMuted }} />
                      <span style={{ width: 118, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ARIA.textDim, fontWeight: 700, background: dayHeat(l), borderRadius: 2, padding: "0 2px" }}>{l._promo ? (dir > 0 ? "↗ " : "↘ ") : ""}{l.name}{isNew(l) && <span title="new on the board today (was not here last session)" style={{ color: ARIA.cyan, fontWeight: 800 }}> •</span>}{dip && <span title="DIP-BUY tell: red day on a structurally intact leader (green regime, rank ≥88, bottom 5% RS today). Layer backtest: leaders’ red days are dip-buys, not cracks." style={{ color: ARIA.green, fontWeight: 800 }}> ◦</span>}</span>
                      <span style={{ width: 44, flexShrink: 0, color: ARIA.textMuted }}>{l._base}→<span style={{ color: ARIA.text, fontWeight: 700 }}>{l.now}</span></span>
                      <div style={{ flex: 1, height: 6, position: "relative" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, height: 6, borderRadius: 2, width: `${Math.abs(l.dlt) / maxD * 100}%`, background: dir > 0 ? ARIA.green + "cc" : ARIA.red + "cc" }} />
                      </div>
                      <span style={{ width: 28, flexShrink: 0, textAlign: "right", fontWeight: 800, color: l.dlt > 0 ? ARIA.green : l.dlt < 0 ? ARIA.red : ARIA.textMuted }}>{l.dlt > 0 ? "+" : ""}{l.dlt}</span>
                      {(() => {
                        // Current-week RS (continuous, no percentile compression) as
                        // confirmation. Tidy fixed columns: wk% + ONE flag slot
                        // (⚠ divergence beats $ money-flow; accel lives in the tooltip).
                        const wk = l.rsWk;
                        const acc2 = (wk != null && l.rsMth != null) ? wk * 4.2 - l.rsMth : null;
                        const wkC = wk == null ? ARIA.textMuted : wk >= 1.5 ? ARIA.green : wk <= -1.5 ? ARIA.red : ARIA.textDim;
                        const diverges = wk != null && ((dir > 0 && wk <= -1.5) || (dir < 0 && wk >= 1.5));
                        const money = l.dshift != null && l.dshift >= 15;
                        const tip = `RS Wk ${wk != null ? (wk > 0 ? "+" : "") + wk.toFixed(1) + "%" : "—"} vs SPY (this week)${l.rsMth != null ? ` · Mth ${l.rsMth > 0 ? "+" : ""}${l.rsMth.toFixed(1)}%` : ""}${acc2 != null ? ` · ${acc2 >= 5 ? "accelerating" : acc2 <= -5 ? "decelerating" : "steady pace"}` : ""}${l.dshift != null ? ` · $vol share ${l.dshift > 0 ? "+" : ""}${l.dshift}% (5d vs 20d)` : ""}${diverges ? " · ⚠ this week DISAGREES with the rank move" : ""}`;
                        return (
                          <>
                            <span title={tip} style={{ width: 40, flexShrink: 0, textAlign: "right", fontFamily: "monospace", fontSize: 7.5, color: wkC, fontWeight: wk != null && Math.abs(wk) >= 1.5 ? 700 : 400 }}>
                              {wk != null ? `${wk > 0 ? "+" : ""}${wk.toFixed(1)}%` : "—"}
                            </span>
                            <span title={tip} style={{ width: 11, flexShrink: 0, textAlign: "center", fontSize: 7.5, fontWeight: 800, color: diverges ? ARIA.yellow : ARIA.green }}>
                              {diverges ? "⚠" : money ? "$" : ""}
                            </span>
                          </>
                        );
                      })()}
                    </div>
                    );
                  };
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <div>
                        <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: ARIA.green, marginBottom: 2 }}>Leaders + Rising — strongest first · ↗ = crossed 88 · cols: Δrank 2wk | RS this wk (⚠ = they disagree)</div>
                        {risers.map((l) => rowEl(l, 1))}
                      </div>
                      <div>
                        <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: ARIA.red, marginBottom: 2 }}>Weakening + Falling — from the top · ↘ = lost 88 · cols: Δrank 2wk | RS this wk</div>
                        {fallers.map((l) => rowEl(l, -1))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
          {/* All layers containing the charted ticker — reverse-sync auto-picks the
              strongest, but multi-layer names (e.g. ISRG in Devices AND Medical
              Robotics) get chips here so every containing layer is one click away */}
          {(() => {
            const t = (chartTicker || "").toUpperCase();
            if (!t || !d.layers) return null;
            const chains = chainsForStock(t, stockMap?.[t]) || [];
            if (chains.length < 2) return null;
            const keys = new Set(chains.map((c) => `${c.themeId}|${c.layer}`));
            const containing = d.layers.filter((l) => keys.has(`${l.themeId}|${l.name}`))
              .sort((a, b) => (b.now ?? -1) - (a.now ?? -1));
            if (containing.length < 2) return null;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", fontSize: 8 }}>
                <span style={{ color: ARIA.textMuted }}>{t} is in:</span>
                {containing.map((l) => {
                  const key = `${l.themeId}|${l.name}`;
                  const active = selectedLayerKey === key;
                  return (
                    <button key={key} onClick={() => applyLayer(l, false, true)}
                      title={`${l.theme} · ${l.name} — rank ${l.now} (click to load this layer)`}
                      style={{ fontSize: 7.5, fontWeight: 700, fontFamily: "monospace", cursor: "pointer", padding: "1px 6px", borderRadius: 3,
                        color: active ? ARIA.text : ARIA.textDim, background: active ? ARIA.blue + "26" : "transparent",
                        border: `1px solid ${active ? ARIA.blue : ARIA.border}` }}>
                      {l.name} <span style={{ color: (l.now ?? 0) >= 67 ? ARIA.green : (l.now ?? 0) >= 33 ? ARIA.blue : ARIA.red }}>{l.now}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {/* Regime chart (left) + tabbed Sectors/Industries table (right of the graph) */}
          {(() => {
            const tabBtn = (key, label, alsoActive = []) => {
              const active = rsTab === key || alsoActive.includes(rsTab);
              return (
                <button onClick={() => setRsTab(key)}
                  style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, padding: "2px 7px", cursor: "pointer",
                    color: active ? ARIA.text : ARIA.textMuted, background: "transparent", border: "none",
                    borderBottom: `2px solid ${active ? ARIA.blue : "transparent"}` }}>{label}</button>
              );
            };
            const layerBtns = (
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 7, color: ARIA.textMuted }}>top layers</span>
                {[5, 8, 12].map((n) => (
                  <button key={n} onClick={() => { setTopLayers(n); try { localStorage.setItem("tp-funnel-layers", String(n)); } catch {} }}
                    style={{ fontSize: 7, fontWeight: 700, cursor: "pointer", padding: "0 4px", borderRadius: 3, fontFamily: "monospace",
                      color: topLayers === n ? ARIA.text : ARIA.textMuted, background: topLayers === n ? ARIA.blue + "22" : "transparent", border: `1px solid ${topLayers === n ? ARIA.blue + "66" : ARIA.border}` }}>{n}</button>
                ))}
              </span>
            );
            const isLeaders = rsTab === "leaders";
            const isEmerging = rsTab === "emerging";
            const isCombined = rsTab === "leadersall";
            const isStockTab = isLeaders || isEmerging || isCombined;
            // Sub-view pills render INLINE on the tab row (saves a header row).
            const pill = (k, lbl, n) => (
              <button key={k} onClick={() => setRsTab(k)}
                style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: 0.3, padding: "1px 6px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace",
                  color: rsTab === k ? ARIA.text : ARIA.textMuted,
                  background: rsTab === k ? ARIA.blue + "22" : "transparent",
                  border: `1px solid ${rsTab === k ? ARIA.blue + "66" : ARIA.border}` }}>
                {lbl}{n ? <span style={{ opacity: 0.55, fontWeight: 400 }}> {n}</span> : null}
              </button>
            );
            const subPills = isStockTab
              ? [["leadersall", "◆ All", leaderRows.length + emergingRows.length], ["leaders", "⭐ Leaders", leaderRows.length], ["emerging", "🌱 Emerging", emergingRows.length]]
              : isLayerLike
              ? [["layers", "All Layers"], ["tech", "Tech"], ["extech", "Ex-Tech"]]
              : null;
            const tabRow = (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, marginBottom: 2, borderBottom: `1px solid ${ARIA.border}` }}>
                {tabBtn("layers", "Layers", ["tech", "extech"])}
                {tabBtn("leadersall", "Leaders", ["leaders", "emerging"])}
                {tabBtn("inplay", "⚡ In Play")}
                {tabBtn("sectors", "Sector Leaders")}
                {tabBtn("industries", "Industries")}
                {tabBtn("apex", "👑 Apex")}
                {tabBtn("ercal", "ER Cal")}
                {subPills && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 6, paddingLeft: 8, borderLeft: `1px solid ${ARIA.border}` }}>
                    {subPills.map(([k, lbl, n]) => pill(k, lbl, n))}
                  </span>
                )}
                {isStockTab ? layerBtns : (rsTab !== "sectors" && rsTab !== "ercal" && <span style={{ fontSize: 7, color: ARIA.textMuted, marginLeft: "auto" }}>sort ↕ · scroll</span>)}
              </div>
            );
            const stockRows = isCombined ? combinedRows : isLeaders ? leaderRows : isEmerging ? emergingRows : activeRows;
            return (
              <IndexRegimeChart sym={sym} setSym={openTicker} onChartTicker={onTickerClick}
                erDetail={erFocus ? { ticker: erFocus, mv: erFocusMover } : null} onErClose={() => setErFocus(null)}
                holdingsOverride={layerHolds} liveQuotes={liveQuotes} zvrMap={zvrMap} stockMap={stockMap} heldTint={heldSet}
                basket={basketMode ? (layerHolds || []).map((h) => h.t) : null} basketLabel={basketLabel}
                rightPanel={
                <>
                  {tabRow}
                  {isEmerging && <div style={{ fontSize: 7, color: ARIA.textDim, padding: "0 2px 2px" }}>breaking into leadership — near 52w high / RS-line high + quality (EIF); ranked by proximity + volume</div>}
                  {isTechTab && <div style={{ fontSize: 7, color: ARIA.textDim, padding: "0 2px 2px" }}>tech layers re-ranked among themselves · all RS columns vs QQQ — who's strong WITHIN tech</div>}
                  {isExTab && <div style={{ fontSize: 7, color: ARIA.textDim, padding: "0 2px 2px" }}>non-tech layers re-ranked among themselves (vs SPY) — where money rotates when it leaves tech</div>}
                  <div style={{ flex: 1, minHeight: 0, overflowX: "auto", overflowY: "auto" }}>
                    {rsTab === "ercal" ? (
                      <EarningsCalendar embedded stocks={stocksArr} stockMap={stockMap} onTickerClick={openErTicker} chartTicker={chartTicker} movers={movers} />
                    ) : rsTab === "inplay" ? (
                      (() => {
                        const qOrd = { GENUINE: 5, ELITE: 4, EXPLOSIVE: 4, STRONG: 3, DECENT: 2, WEAK: 1 };
                        const rows2 = movers
                          .filter((m) => m.in_universe && m.ticker)
                          .sort((a, b) => (qOrd[b.ep_quality_label] || 0) - (qOrd[a.ep_quality_label] || 0) || Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0))
                          .slice(0, 15);
                        const qColor = (l) => l === "GENUINE" ? ARIA.yellow : l === "ELITE" || l === "EXPLOSIVE" || l === "STRONG" ? ARIA.green : l === "DECENT" ? ARIA.textDim : ARIA.textMuted;
                        const srcC = { ER: ARIA.cyan, PM: ARIA.yellow, AH: ARIA.purple };
                        return (
                          <div style={{ fontFamily: "monospace" }}>
                            <div style={{ fontSize: 8, color: ARIA.textMuted, marginBottom: 6, lineHeight: 1.5 }}>
                              Today's in-universe movers (earnings + stocks-in-play), quality-scored by the EP pipeline. This is a PREP list — the evidence says stalk (DE), don't chase: gap-day entries backtest at 46% win. {rows2.length} of {movers.length} movers pass the universe gate.
                            </div>
                            {rows2.length === 0 && <div style={{ fontSize: 9, color: ARIA.textMuted, padding: 12, textAlign: "center" }}>No in-universe movers this session.</div>}
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9 }}>
                              <thead><tr style={{ borderBottom: `1px solid ${ARIA.border}` }}>
                                {["Ticker", "Src", "Chg%", "RS Day%", "ZVR", "CR%", "EPQ", "Size", "RS", "Catalyst"].map((h, i) => <th key={h} style={{ textAlign: i === 0 || i === 9 ? "left" : "right", padding: "2px 5px", fontSize: 7, textTransform: "uppercase", color: ARIA.textMuted, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>)}
                              </tr></thead>
                              <tbody>
                                {rows2.map((m) => {
                                  const items = (m.recent_headlines?.length ? m.recent_headlines : m.headlines?.length ? m.headlines : stockMap?.[m.ticker]?._newsPipe) || [];
                                  const hl = items[0] || "";
                                  // Live metrics — same construction as the layer/leaders tables
                                  const s = stockMap?.[m.ticker] || {}; const q = liveQuotes.get(m.ticker);
                                  const lchg = q?.change ?? s.change_pct ?? m.change_pct ?? null;
                                  const rsDay = lchg != null ? +(lchg - (spyChg ?? 0)).toFixed(2) : null;
                                  let zvr = null; const lv = q?.volume, av = s.avg_volume_raw || q?.avgVolume || 0;
                                  if (lv && av > 0) zvr = Math.round((lv / (av * _elapsed)) * 100);
                                  else if (s.rel_volume > 0) zvr = Math.round(s.rel_volume * 100);
                                  if (zvr != null && lchg != null && lchg < 0) zvr = -zvr;
                                  const cr = computeCR(q, s);
                                  const rsDayC = rsDay == null ? ARIA.textMuted : Math.abs(rsDay) > 2 ? (rsDay > 0 ? ARIA.green : ARIA.red) : ARIA.textDim;
                                  const zvrC = zvr == null ? ARIA.textMuted : Math.abs(zvr) >= 200 ? (zvr < 0 ? "#ef4444" : "#fbbf24") : Math.abs(zvr) >= 130 ? (zvr < 0 ? ARIA.red : ARIA.green) : ARIA.textDim;
                                  const crC = cr == null ? ARIA.textMuted : cr >= 70 ? ARIA.green : cr <= 30 ? ARIA.red : ARIA.textDim;
                                  return (
                                    <tr key={m.ticker + m._src} onClick={() => openTicker(m.ticker)} style={{ cursor: "pointer", borderBottom: `1px solid ${ARIA.border}` }}
                                      onMouseEnter={(e) => e.currentTarget.style.background = ARIA.bgHover} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                                      <td style={{ padding: "2px 5px", fontWeight: 700, color: ARIA.text }}>{m.ticker}{items.length > 0 && <span onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("tp-news-pop", { detail: { x: e.clientX, y: e.clientY, ticker: m.ticker, items } })); }} title="Click for catalyst headlines" style={{ marginLeft: 4, fontSize: 9, opacity: 0.85, cursor: "pointer" }}>📰</span>}</td>
                                      <td style={{ padding: "2px 5px", textAlign: "right", fontSize: 7, fontWeight: 800, color: srcC[m._src] || ARIA.textDim }}>{m._src}</td>
                                      <td style={{ padding: "2px 5px", textAlign: "right", fontWeight: Math.abs(m.change_pct || 0) > 2 ? 700 : 400, color: Math.abs(m.change_pct || 0) > 2 ? ((m.change_pct || 0) > 0 ? ARIA.green : ARIA.red) : ARIA.textDim }}>{m.change_pct != null ? `${m.change_pct > 0 ? "+" : ""}${m.change_pct.toFixed(1)}%` : "—"}</td>
                                      <td title="Today's move vs SPY (live)" style={{ padding: "2px 5px", textAlign: "right", fontWeight: rsDay != null && Math.abs(rsDay) > 2 ? 700 : 400, color: rsDayC }}>{rsDay != null ? `${rsDay > 0 ? "+" : ""}${rsDay.toFixed(2)}%` : "—"}</td>
                                      <td title="Pace-adjusted relative volume, signed negative on down days" style={{ padding: "2px 5px", textAlign: "right", fontWeight: zvr != null && Math.abs(zvr) >= 130 ? 700 : 400, color: zvrC }}>{zvr != null ? `${zvr}%` : "—"}</td>
                                      <td title="Closing range: where price sits in the day's range (100 = at the high)" style={{ padding: "2px 5px", textAlign: "right", fontWeight: cr != null && (cr >= 70 || cr <= 30) ? 700 : 400, color: crC }}>{cr ?? "—"}</td>
                                      <td title="EP quality (pipeline): gap size, volume, base, neglect — which gappers are worth stalking" style={{ padding: "2px 5px", textAlign: "right", fontWeight: 700, color: qColor(m.ep_quality_label) }}>{m.ep_quality_label || "—"}</td>
                                      <td title="Pipeline sizing guide for this EP" style={{ padding: "2px 5px", textAlign: "right", color: m.sizing_guide === "FULL" ? ARIA.green : ARIA.textDim }}>{m.sizing_guide || "—"}</td>
                                      <td style={{ padding: "2px 5px", textAlign: "right", color: (m.rs_rank || 0) >= 88 ? ARIA.green : ARIA.textDim, fontWeight: (m.rs_rank || 0) >= 88 ? 700 : 400 }}>{m.rs_rank ?? "—"}</td>
                                      <td title={hl} style={{ padding: "2px 5px", textAlign: "left", color: ARIA.textDim, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hl || "—"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()
                    ) : rsTab === "apex" ? (
                      (() => {
                        const ev = apexEv;
                        const liveRet = (t, entryPx) => { const q = liveQuotes?.[t]?.price ?? stockMap?.[t]?.price ?? stockMap?.[t]?.close; return (q && entryPx) ? (q / entryPx - 1) * 100 : null; };
                        const fmt = (v, d = 1) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
                        const col = (v) => v == null ? ARIA.textMuted : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textMuted;
                        const box = { border: `1px solid ${ARIA.border}`, borderRadius: 4, padding: "6px 8px", background: ARIA.bgCard };
                        const stat = (lbl, o, accent) => (
                          <div style={{ ...box, flex: 1, minWidth: 120 }}>
                            <div style={{ fontSize: 7, textTransform: "uppercase", letterSpacing: 0.4, color: accent || ARIA.textMuted, fontWeight: 800 }}>{lbl}</div>
                            {o && o.n > 0
                              ? <div style={{ fontSize: 11, fontWeight: 700, color: ARIA.text, marginTop: 2 }}>{o.winRate}% win · <span style={{ color: col(o.avgRet) }}>{fmt(o.avgRet)}</span> <span style={{ fontSize: 8, color: ARIA.textMuted, fontWeight: 400 }}>n={o.n}</span></div>
                              : <div style={{ fontSize: 9, color: ARIA.textMuted, marginTop: 3 }}>no closed campaigns yet</div>}
                          </div>
                        );
                        return (
                          <div style={{ fontFamily: "monospace" }}>
                            <div style={{ fontSize: 8, color: ARIA.textMuted, marginBottom: 6, lineHeight: 1.5 }}>
                              Walk-forward test of the Apex cohort (top-2 RS in top-5 layers). Each night <b style={{ color: ARIA.text }}>apex_tracker</b> tracks every promotion from entry to exit and splits closed returns by whether the name was seen <b style={{ color: ARIA.yellow }}>on-deck</b> before promotion vs a <b style={{ color: ARIA.textDim }}>cold</b> jump. Watchlist evidence — not signals. {ev?.updated ? `Updated ${ev.updated}.` : ""}
                            </div>
                            {!ev && <div style={{ fontSize: 9, color: ARIA.textMuted, padding: 12, textAlign: "center" }}>Loading evidence…</div>}
                            {ev && (<>
                              <div style={{ fontSize: 7, textTransform: "uppercase", letterSpacing: 0.5, color: ARIA.textDim, fontWeight: 800, margin: "2px 0 4px" }}>Closed campaigns — on-deck vs cold</div>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                                {stat("All closed", ev.closed?.all)}
                                {stat("↳ From on-deck", ev.closed?.fromOnDeck, ARIA.yellow)}
                                {stat("↳ Cold jump", ev.closed?.cold, ARIA.textDim)}
                              </div>
                              <div style={{ fontSize: 7, textTransform: "uppercase", letterSpacing: 0.5, color: ARIA.textDim, fontWeight: 800, margin: "2px 0 4px" }}>Open campaigns ({(ev.open || []).length})</div>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9 }}>
                                <thead><tr style={{ borderBottom: `1px solid ${ARIA.border}` }}>
                                  {["Ticker", "Src", "Entered", "Ret", "Off-pk"].map((h, i) => <th key={h} style={{ textAlign: i === 0 || i === 2 ? "left" : "right", padding: "2px 5px", fontSize: 7, textTransform: "uppercase", color: ARIA.textMuted, fontWeight: 700 }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                  {(ev.open || []).map((c) => { const lr = liveRet(c.t, stockMap?.[c.t]?.__entryPx) ?? c.ret; return (
                                    <tr key={c.t} onClick={() => openTicker(c.t)} style={{ cursor: "pointer", borderBottom: `1px solid ${ARIA.border}` }}
                                      onMouseEnter={(e) => e.currentTarget.style.background = ARIA.bgHover} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                                      <td style={{ padding: "2px 5px", fontWeight: 700, color: ARIA.text }}>{c.t}</td>
                                      <td style={{ padding: "2px 5px", textAlign: "right" }}>{c.ondeck ? <span title="Promoted from the on-deck queue" style={{ color: ARIA.yellow, fontWeight: 800, fontSize: 8 }}>⏳</span> : <span title="Cold promotion — not seen on-deck first" style={{ color: ARIA.textDim, fontSize: 8 }}>cold</span>}</td>
                                      <td style={{ padding: "2px 5px", textAlign: "left", color: ARIA.textMuted, fontSize: 8 }}>{c.entered || "—"}</td>
                                      <td style={{ padding: "2px 5px", textAlign: "right", fontWeight: 700, color: col(c.ret) }}>{fmt(lr)}</td>
                                      <td style={{ padding: "2px 5px", textAlign: "right", color: col(c.offPeak) }}>{fmt(c.offPeak)}</td>
                                    </tr>
                                  ); })}
                                  {!(ev.open || []).length && <tr><td colSpan={5} style={{ padding: 8, textAlign: "center", color: ARIA.textMuted, fontSize: 9 }}>no open campaigns</td></tr>}
                                </tbody>
                              </table>
                              {(ev.todayOnDeck || []).length > 0 && (<>
                                <div style={{ fontSize: 7, textTransform: "uppercase", letterSpacing: 0.5, color: ARIA.textDim, fontWeight: 800, margin: "10px 0 4px" }}>⏳ On-deck now — promotion queue</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                  {ev.todayOnDeck.map((t) => <span key={t} onClick={() => openTicker(t)} title="On-deck: #3 RS in a top-5 layer, or top RS in layers 6-10. Watchlist, not an entry — you're ready the day it promotes." style={{ cursor: "pointer", fontSize: 8, fontWeight: 700, color: ARIA.yellow, border: `1px solid ${ARIA.yellow}55`, background: `${ARIA.yellow}14`, borderRadius: 3, padding: "1px 5px" }}>{t}</span>)}
                                </div>
                              </>)}
                            </>)}
                          </div>
                        );
                      })()
                    ) : (
                    <RsTable
                      key={isCombined ? "rs-combined" : isLeaders ? "rs-leaders" : isEmerging ? "rs-emerging" : "rs-rotation"}
                      initialSort={isLayerLike ? { key: "now", dir: "desc" } : undefined}
                      rows={stockRows}
                      sortable onTicker={isStockTab ? openTicker : openTicker} ARIA={ARIA}
                      rankCol={isStockTab}
                      heldSet={heldSet} heldByLayer={heldByLayer}
                      onNameLayer={isStockTab ? ((r) => { const lyr = (d.layers || []).find((l) => l.themeId === r.themeId && l.name === r.name); if (lyr) openLayerStay(lyr); }) : undefined}
                      tickerLabel={isLayerLike ? "Theme" : "Ticker"}
                      getTag={isLayerLike ? ((r) => r.theme || "—") : undefined}
                      onLayerSelect={rsTab === "layers" ? openLayer : (isTechTab || isExTab) ? ((r) => applyLayer(r, true, true)) : undefined}
                      activeKey={isLayerLike ? selectedLayerKey : (isStockTab ? null : sym)} />
                    )}
                  </div>
                </>
              } />
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Scan Watch (Scan view — Phase 2.2)
// ──────────────────────────────────────────────────────────────────────────
//
// Phase 2.2 adds:
//  - Interactive filter controls (NoBio toggle, Chg>0% toggle, Chg-mode toggle,
//    ADR min/max inputs, $Vol input, Chg≥/RV≥ sliders)
//  - Sort buttons with primary¹/secondary² (left-click = primary, right-click
//    = secondary). Sort keys: RS, Chg%, RVol, Acc, MAG, BO, Open%
//  - presets ordered by the 2026-07-15 tag audit (+10d alpha vs SPY, 375
//    sessions incl. the 2025 correction): non-overlapping core = Reset
//    (+1.59) · Combo (+1.24) · 1W20 (+0.84) · Gap4 (+0.69, DE-stalk feeder,
//    don't chase) — then T2 (+0.49; edge lives in its momentum leg) · Strong ·
//    Accum · DE · TT 8/8 (qualifier/gate, not a selector). Retired: Dry-Up +
//    RS↑ (2026-07-07), T2+ prime tier (2026-07-15, underperformed plain T2).
//  - Filter description box (shows preset's explanation when active)
//
// Phase 2.3 will add: short presets (BD/DT/WK/FL/DC), tag filters
// (W/L/E/CS/ZM/QM/9M), and the PM/AH/EP/ETF/QQQ subviews.
// ──────────────────────────────────────────────────────────────────────────

const SORT_BUTTONS = [
  { key: "rs", label: "EIF" },
  { key: "change", label: "Chg%" },
  { key: "rvol", label: "RVol" },
  { key: "accel", label: "Acc" },
  { key: "magna", label: "MAG" },
  { key: "qm_bo", label: "BO" },
  { key: "alpha", label: "α" },
];

// ── Chain Setup badge: synthesizes ZVR/EIF/CR%/α/Str/ER/RS/MA-distance into a
// named pattern. Returns { key, color, rank, desc } or null; checked in priority
// order (first match wins). `rank` orders the "Setup" column sort — higher =
// more actionable long (BO > ACC > EP > RST > VCP; DIST is a warning, lowest).
//
// EIF here is r.rs (framework_score, the Execution & Integrity score), which is
// distinct from RS rank. RST additionally uses r.rsRank (momentum RS 0-100).
//
// ctx.zFactor (optional) scales the volume thresholds by how hot/quiet today's
// tape is (universe median |ZVR| vs a ~60 baseline, clamped 0.8–1.4) so the same
// pill fires a similar number of names in a strong tape and a dead one. Absent
// ctx → factor 1 → the fixed absolute thresholds.
// Per-column metric explanations — shown on header hover across the ticker
// tables (prepended to the sort-interaction hint). Keyed by sort key.
const COL_HELP = {
  ticker: "Ticker symbol. Click a row to load its chart + drawer.",
  theme: "Chain → Layer: the theme group (chain) and the specific momentum layer this name belongs to. '+N more' = also a member of N other layers.",
  chain: "Chain: the theme group this name belongs to (e.g. AI Infrastructure, Cybersecurity).",
  subtheme: "Sub: the finest-grained sub-layer within the chain.",
  chg: "Chg% — today's price change vs the prior close. LIVE during market hours.",
  alpha: "RS (relative strength) = the stock's return minus SPY's over the selected window (DAY / WK / MTH — right-click to cycle). Positive = outperforming the market. This is α, not the 0-99 RS rank.",
  zvr: "ZVR — pace-adjusted relative volume: today's volume ÷ (its 50d average × the fraction of the session elapsed), signed negative on down days. +100 = trading at exactly average pace; +200 = double pace. LIVE. Regime-scaled thresholds drive the setup badges.",
  cr: "CR% — closing range: where price sits in the day's high-low range (100 = closing on the high, 0 = on the low). Strong closes (≥60) confirm buyers held into the close.",
  rs: "EIF — Execution & Integrity Framework score (0-86): the slow, fundamental-ish quality score from the pipeline (theme membership + growth/acceleration + quality + earnings-call read). NOT price momentum — that's RS. Click a dotted EIF value for its drivers.",
  rsWk: "RS Wk% — 1-week return minus SPY over the same week. Positive = outperformed the market over the past week.",
  rsMth: "RS Mth% — 1-month return minus SPY over the same month. Positive = outperformed the market over the past month.",
  adr: "ADR% — average daily range: the stock's typical high-to-low swing (14d), a volatility gauge. Higher = bigger daily moves = more room, but wider stops.",
  str: "Str — subtheme setup score (0-100): how cleanly this name is set up within its sub-layer, blending trend, tightness and position. Higher = better-formed setup.",
  strScore: "Str — subtheme setup score (0-100): how cleanly this name is set up within its sub-layer. Higher = better-formed setup.",
  setup: "Setup — the live pattern badge (first match wins, priority order): DIST (distribution/exit), EP (post-earnings), BO (breakout entry, extension-guarded), ACC (accumulation), RST (leader reset at support), VCP (volume dry-up coil). Hover a badge for its exact trigger.",
  erDays: "ER — trading days to (positive) or since (negative) the next/last earnings report. Yellow = within 7 days: event risk.",
  rvol: "RV — relative volume: today's volume vs its average. >1 = heavier than usual participation. LIVE.",
  liveVol: "Vol — today's share volume so far. LIVE during market hours.",
};

// (T2+ "prime" tier retired 2026-07-15: the tag-audit backtest showed the
// prime subset UNDERPERFORMED plain T2 (+0.10 vs +0.49 +10d alpha) — the
// base-maturity upgrade wasn't earning its badge. Plain T2 chips remain.)

function chainSetup(r, ctx) {
  const { zvr, rs: eif, cr, str, alpha, erDays, chg, rsRank, off52, d20, d50, adr } = r;
  const f = ctx?.zFactor ?? 1;
  const zHi = 150 * f, zEP = 200 * f, zLo = -150 * f, zBO = 130 * f, zDry = 80 * f;
  // DIST: heavy volume selling in a quality name — exit/avoid warning
  if (zvr != null && zvr <= zLo && eif != null && eif >= 52)
    return { key: "DIST", color: "#ef4444", rank: 1, desc: `Distribution: ZVR ≤ ${Math.round(zLo)}% in a leader (EIF ≥ 52). Institutions selling — exit/avoid.` };
  // EP: post-earnings accumulation (Qullamaggie episodic pivot follow-through)
  if (erDays != null && erDays >= -3 && erDays <= 0 && zvr != null && zvr >= zEP && chg != null && chg > 0)
    return { key: "EP", color: "#22d3ee", rank: 5, desc: `Episodic Pivot: earnings ≤ 3d ago + ZVR ≥ ${Math.round(zEP)}% + green. Post-ER accumulation.` };
  // BO: breakout to new highs on a range-expansion up day with volume — the entry.
  // Jack-in-the-Box extension guard (Wiedmaier): expansion must still be anchored
  // to the structural averages — within 3 ATR of the 20dma and 5 ATR of the 50sma.
  // Beyond that the stock is "expanding and trending" — chasing, not entering.
  const notExtended = (d20 == null || d20 <= 3) && (d50 == null || d50 <= 5);
  if (off52 != null && off52 >= -6 && chg != null && chg > 0 && chg >= (adr || 4) &&
      zvr != null && zvr >= zBO && cr != null && cr >= 60 && eif != null && eif >= 50 && notExtended)
    return { key: "BO", color: "#a855f7", rank: 7, desc: `Breakout: within 6% of the 52w high, up ≥ its ADR on ZVR ≥ ${Math.round(zBO)}% with a strong close (CR ≥ 60), NOT extended (≤3/5 ATR from 20/50 MAs). CONFIRMATION ONLY — backtests negative (−0.6% +10d) as a standalone buy; valid as the trigger on a name already on your Reset/T2 list.` };
  // ACC: institutional accumulation in a leader — strong close on volume
  if (alpha != null && alpha > 0 && zvr != null && zvr >= zHi && cr != null && cr >= 70 && eif != null && eif >= 52)
    return { key: "ACC", color: "#34d399", rank: 6, desc: `Accumulation: α > 0, ZVR ≥ ${Math.round(zHi)}%, CR% ≥ 70, EIF ≥ 52. Buyers in control of a leader.` };
  // RST: RS≥90 leader pulled back to the 20dma on dry volume — add-on-support entry
  // (the 🪃 leader-reset / Reset preset, as a live badge)
  if (rsRank != null && rsRank >= 90 && d20 != null && Math.abs(d20) <= 1 && d50 != null && d50 > 0 &&
      zvr != null && Math.abs(zvr) <= 100 && chg != null && chg > -2.5)
    return { key: "RST", color: "#0ea5e9", rank: 4, desc: "Reset: RS ≥ 90 leader within ±1 ATR of the 20dma on dry volume (|ZVR| ≤ 100%), above the 50sma, not breaking down. Buy support, not extension." };
  // VCP: volume dry-up in a strong name — quiet before the breakout
  // |chg| < 2 keeps VCP honest: a big price day on light volume is a conviction
  // warning, not a tight-base consolidation
  if (zvr != null && Math.abs(zvr) < zDry && eif != null && eif >= 60 && str != null && str >= 70 && chg != null && Math.abs(chg) < 2)
    return { key: "VCP", color: "#fbbf24", rank: 3, desc: `Volume dry-up: |ZVR| < ${Math.round(zDry)}%, |Chg| < 2%, EIF ≥ 60, Str ≥ 70. Quiet tight day in a leader — watch for breakout on volume return.` };
  return null;
}

// Get the comparable value for a row given a sort key
function rowSortValue(r, key) {
  switch (key) {
    case "ticker":
      return r.ticker || "";
    case "rs":
      return r.rs || 0;
    case "change":
      return r.chg || 0;
    case "rvol":
      return r.rvol || 0;
    case "zvr":
      return r.zvr ?? -1;
    case "setup":
      return chainSetup(r)?.rank ?? 0;
    case "is33":
      return r.is33 ? 1 : 0;
    case "star":
      return (r.rs != null && r.rs >= 55) ? r.rs : -1;
    case "accel":
      return r.accel || 0;
    case "magna":
      return r.magna || 0;
    case "qm_bo":
      return r.qmagScore || 0;
    case "alpha":
      return r.alpha || 0;
    case "strScore":
      return r.strScore ?? 0;
    case "chgOpen":
      return r.chgOpen || 0;
    case "liveVol":
      return r.liveVol || 0;
    case "cr":
      return r.cr || 0;
    case "adr":
      return r.adr || 0;
    case "subtheme":
      return r.subtheme || "";
    case "chain": {
      const entries = TICKER_CHAIN_MAP.get(r.ticker) || [];
      return entries.length ? entries[0].themeId : "";
    }
    default:
      return 0;
  }
}

// ── Tag filter predicates (ported from Aria dashboard.py _compute_scan_tags) ─
// Each tag is a function (stock) → boolean. Reference: Aria filterDescs in
// dashboard.html ~line 4604.
const TAG_PREDICATES = {
  W: {
    label: "W",
    desc:
      "Winners — above 50MA, within 15% of 52W high, RS ≥ 85, ADR > 2%. Uptrending leaders near new highs.",
    test: (s) =>
      s.above_50ma === 1 &&
      (s.off_52w_high || -100) >= -15 &&
      (s.rs_rank || 0) >= 85 &&
      (s.adr_pct || 0) > 2,
  },
  L: {
    label: "L",
    desc:
      "Liquid — Price > $10, MCap ≥ $300M, Vol ≥ 1M, $Vol ≥ $100M, ADR > 3%. Institutional-grade liquid names only.",
    test: (s) =>
      (s.price || s.close || 0) > 10 &&
      (s.market_cap_raw || 0) >= 300e6 &&
      (s.avg_volume_raw || 0) >= 1e6 &&
      (s.avg_dollar_vol_raw || 0) >= 100e6 &&
      (s.adr_pct || 0) > 3,
  },
  E: {
    label: "E",
    desc:
      "Early — RS 50-85, 10%+ off highs, above 50MA. Stocks building RS before breaking out — early stage leaders.",
    test: (s) => {
      const rs = s.rs_rank || 0;
      return (
        rs >= 50 &&
        rs < 85 &&
        (s.off_52w_high || 0) <= -10 &&
        s.above_50ma === 1
      );
    },
  },
  CS: {
    label: "CS",
    desc:
      "CAN SLIM — EPS growth ≥ 40%, within 10% of high, RS ≥ 80, sales ≥ 25%. IBD-style screen.",
    test: (s) =>
      (s.eps_yoy || 0) >= 40 &&
      (s.off_52w_high || -100) >= -10 &&
      (s.rs_rank || 0) >= 80 &&
      (s.sales_yoy || 0) >= 25,
  },
  ZM: {
    label: "ZM",
    desc:
      "Zanger — Above 50/20 MA, within 15% of high, grade A/B, $Vol ≥ $20M. Dan Zanger continuation setup.",
    test: (s) => {
      const g = (s.grade || "")[0];
      return (
        (g === "A" || g === "B") &&
        (s.sma20_pct || -1) >= 0 &&
        (s.sma50_pct || -1) >= 0 &&
        (s.off_52w_high || -100) >= -15 &&
        (s.avg_dollar_vol_raw || 0) >= 20e6
      );
    },
  },
  QM: {
    label: "QM",
    desc:
      "Qullamaggie — QM score ≥ 5. VCP/tight base near highs with volatility contraction.",
    test: (s) => (s.qmag_score || 0) >= 5,
  },
  "9M": {
    label: "9M",
    desc:
      "9M — Today's volume ≥ 8.9M shares but avg daily volume < 8.9M. Unusual institutional activity.",
    // 9M is computed at row time using LIVE volume — handled in the row build loop, not here
    test: () => true,
  },
  MAG: {
    label: "MAG",
    desc:
      "MAGNA — Nitin's Episodic Pivot qualifier. MAGNA score ≥ 60 + EPS YoY ≥ 25% + Sales YoY ≥ 25% + gap ≥ 2%. Composite of Massive accel (M), Gap up (G), Acceleration in sales (A).",
    test: (s) => {
      const epsY = s.eps_yoy || 0;
      const salY = s.sales_yoy || 0;
      const gap = s.change_pct || 0;
      const m = Math.min(33, Math.max(0, epsY > 0 ? (epsY / 100) * 33 : 0));
      const a = Math.min(33, Math.max(0, salY > 0 ? (salY / 100) * 33 : 0));
      const g = Math.min(34, Math.max(0, gap > 0 ? (gap / 15) * 34 : 0));
      return (m + a + g) >= 60 && epsY >= 25 && salY >= 25 && gap >= 2;
    },
  },
  "33": {
    label: "33",
    desc:
      "Code 33 (2-quarter approx) — EPS YoY and Sales YoY both accelerated vs the prior quarter, with positive net margin. Minervini's strict 3-quarter Code 33 needs 3 quarters of history the pipeline doesn't ship yet.",
    test: (s) => {
      const eYoy = s.eps_yoy;
      const eYoyPrev = s.eps_yoy_prev;
      const sYoy = s.sales_yoy;
      const sYoyPrev = s.sales_yoy_prev;
      const margin = s.profit_margin;
      return (
        eYoy != null &&
        eYoyPrev != null &&
        sYoy != null &&
        sYoyPrev != null &&
        margin != null &&
        eYoy > eYoyPrev &&
        sYoy > sYoyPrev &&
        margin > 0
      );
    },
  },
};

// ── ETF Scan Table — fetches etf_universe.json + live quotes ─────────────
function ETFScanTable({ onTickerClick }) {
  const ARIA = useAriaTheme();
  const ownedTint = useOwnedTint();
  const [portfolio] = useLocalStorageList("themepulse-portfolio");
  const [watchlist] = useLocalStorageList("themepulse-watchlist");
  const [focus] = useLocalStorageList("themepulse-focus");
  // Owned = portfolio ∪ focus ∪ watchlist; None = the complement.
  const ownedSet = useMemo(
    () => new Set([...portfolio, ...focus, ...watchlist]),
    [portfolio, focus, watchlist]
  );
  const [etfMeta, setEtfMeta] = useState([]);
  const [filter, setFilter] = useState("all"); // all | index | sector | lev
  const [noLev, setNoLev] = useState(true);
  const [gainOnly, setGainOnly] = useState(false);
  const [ownedView, setOwnedView] = useState("all"); // "all" | "owned" | "hide"
  const [sortKey, setSortKey] = useState("change");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedTicker, setSelectedTicker] = useState(null);
  const wrapRef = React.useRef(null);

  // Fetch static ETF universe once
  useEffect(() => {
    fetch("/etf_universe.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => Array.isArray(d) && setEtfMeta(d))
      .catch(() => {});
  }, []);

  // Live quotes for all ETF tickers
  const tickers = useMemo(() => etfMeta.map((e) => e.ticker), [etfMeta]);
  const { quotes } = useLiveQuotes(tickers, 30000);

  // Merge static meta + live quotes → rows
  const rows = useMemo(() => {
    return etfMeta
      .map((e) => {
        const q = quotes.get(e.ticker);
        const price = q?.price ?? null;
        if (!price) return null;
        const chg = q?.change ?? q?.changePercentage ?? 0;
        const vol = q?.volume ?? 0;
        const avgVol = q?.avgVolume ?? e.avgVolume ?? 0;
        const rvol = vol && avgVol > 0 ? Math.round((vol / avgVol) * 10) / 10 : null;
        const cr = computeCR(q, e);
        const dh = q?.dayHigh ?? q?.high ?? null;
        const dl = q?.dayLow ?? q?.low ?? null;
        const prev = q?.previousClose;
        const adr =
          dh && dl && prev && prev > 0
            ? Math.round((Math.abs(dh - dl) / prev) * 1000) / 10
            : null;
        return {
          ticker: e.ticker,
          name: e.name,
          category: e.category,
          leverage: e.leverage,
          subtheme: e.subtheme,
          price,
          change: Math.round(chg * 100) / 100,
          volume: vol,
          rvol,
          cr,
          adr,
        };
      })
      .filter(Boolean);
  }, [etfMeta, quotes]);

  // Filter
  const filtered = useMemo(() => {
    let arr = rows;
    if (filter === "index") arr = arr.filter((e) => e.category === "Index");
    else if (filter === "sector")
      arr = arr.filter((e) => e.category === "Sector" && e.leverage === "1x");
    else if (filter === "lev") arr = arr.filter((e) => e.leverage !== "1x");
    if (noLev) arr = arr.filter((e) => e.leverage === "1x");
    if (gainOnly) arr = arr.filter((e) => (e.change || 0) > 0);
    if (ownedView === "hide") arr = arr.filter((e) => !ownedSet.has(e.ticker));
    else if (ownedView === "owned") arr = arr.filter((e) => ownedSet.has(e.ticker));
    // Sort
    arr = arr.slice().sort((a, b) => {
      let av = a[sortKey],
        bv = b[sortKey];
      if (sortKey === "ticker" || sortKey === "subtheme" || sortKey === "leverage") {
        av = (av || "").toString();
        bv = (bv || "").toString();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      av = Number(av) || 0;
      bv = Number(bv) || 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [rows, filter, gainOnly, ownedView, ownedSet, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "ticker" || key === "subtheme" ? "asc" : "desc");
    }
  };

  // Keyboard nav
  const visibleTickers = filtered.map((r) => r.ticker);
  useEffect(() => {
    if (!visibleTickers.length) return;
    if (!selectedTicker || !visibleTickers.includes(selectedTicker))
      setSelectedTicker(visibleTickers[0]);
  }, [visibleTickers.join(",")]);
  const onKeyDown = useCallback(
    (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const cur = selectedTicker ? visibleTickers.indexOf(selectedTicker) : -1;
      let next = cur < 0 ? 0 : cur + (e.key === "ArrowDown" ? 1 : -1);
      next = Math.max(0, Math.min(visibleTickers.length - 1, next));
      const t = visibleTickers[next];
      setSelectedTicker(t);
      onTickerClick && onTickerClick(t);
      scrollRowIntoScroller(wrapRef.current?.querySelector(`tr[data-ticker="${t}"]`));
    },
    [visibleTickers, selectedTicker, onTickerClick]
  );

  const fBtn = (k, label) => {
    const on = filter === k;
    return (
      <button
        key={k}
        onClick={() => setFilter(k)}
        style={pillStyle(on, ARIA.green)}
      >
        {label}
      </button>
    );
  };

  const headers = [
    { k: "ticker", label: "ETF", align: "left" },
    { k: "change", label: "Chg%" },
    { k: "rvol", label: "RV" },
    { k: "volume", label: "Vol" },
    { k: "cr", label: "CR%" },
    { k: "adr", label: "ADR" },
    { k: "leverage", label: "Lev", align: "left" },
    { k: "subtheme", label: "Theme", align: "left" },
  ];

  const colorChg = (v) =>
    v == null || Math.abs(v) <= 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;
  const fmtVol = (v) => {
    if (!v) return "—";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return String(v);
  };
  const colorRvol = (v) =>
    v == null ? ARIA.textMuted : v >= 1.5 ? ARIA.purple : ARIA.textMuted;
  const colorCr = (v) =>
    v == null ? ARIA.textMuted : v >= 85 ? ARIA.green : ARIA.textMuted;
  const colorLev = (l) =>
    l === "3x" || l === "-3x"
      ? "#f59e0b"
      : l === "2x" || l === "-2x"
      ? ARIA.cyan
      : ARIA.textMuted;

  const cell = {
    padding: "2px 5px",
    fontSize: 9,
    textAlign: "right",
    borderBottom: `1px solid ${ARIA.border}`,
    whiteSpace: "nowrap",
  };

  return (
    <>
      {/* Filter bar */}
      <div
        style={{
          padding: "4px 12px",
          display: "flex",
          flexWrap: "wrap",
          gap: 3,
          alignItems: "center",
          borderBottom: `1px solid ${ARIA.border}`,
          fontFamily: "monospace",
        }}
      >
        {fBtn("all", "All")}
        {fBtn("index", "Index")}
        {fBtn("sector", "Sector")}
        {fBtn("lev", "2x/3x")}
        <span style={{ color: ARIA.border, margin: "0 2px" }}>|</span>
        <button onClick={() => setNoLev((v) => !v)} style={pillStyle(noLev, ARIA.yellow)} title="Hide all leveraged and inverse ETFs">
          No Lev
        </button>
        <span style={{ color: ARIA.border, margin: "0 2px" }}>|</span>
        <button onClick={() => setGainOnly((g) => !g)} style={pillStyle(gainOnly, ARIA.green)}>
          Chg&gt;0%
        </button>
        <span style={{ fontSize: 7, color: ARIA.textMuted, marginLeft: 4 }}>Owned:</span>
        <button
          onClick={() => setOwnedView("all")}
          style={pillStyle(ownedView === "all", ARIA.textDim)}
          title="Show every ticker"
        >
          All
        </button>
        <button
          onClick={() => setOwnedView("owned")}
          style={pillStyle(ownedView === "owned", ARIA.yellow)}
          title="Show only tickers in portfolio, focus, or watchlist"
        >
          Only
        </button>
        <button
          onClick={() => setOwnedView("hide")}
          style={pillStyle(ownedView === "hide", ARIA.yellow)}
          title="Show only tickers NOT in portfolio, focus, or watchlist"
        >
          Hide
        </button>
        <span style={{ fontSize: 7, color: ARIA.textMuted, marginLeft: "auto" }}>
          ({filtered.length})
        </span>
      </div>
      {/* Table */}
      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ outline: "none", flex: 1, overflowY: "auto", overflowX: "auto", fontFamily: "monospace" }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 2, background: ARIA.bgCard }}>
            <tr>
              {headers.map((h) => {
                const isSorted = sortKey === h.k;
                const arrow = isSorted ? (sortDir === "asc" ? " ▲" : " ▼") : "";
                return (
                  <th
                    key={h.k}
                    onClick={() => toggleSort(h.k)}
                    style={{
                      padding: "3px 5px",
                      fontSize: 7,
                      fontWeight: 700,
                      color: isSorted ? ARIA.green : ARIA.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: 0.3,
                      textAlign: h.align || "right",
                      borderBottom: `1px solid ${ARIA.border}`,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      userSelect: "none",
                      background: ARIA.bgCard,
                    }}
                  >
                    {h.label}
                    {arrow}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 12, textAlign: "center", color: ARIA.textMuted, fontSize: 9 }}>
                  No ETFs match filters
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const isSel = selectedTicker === r.ticker;
              const ownedBg = ownedTint(r.ticker, ARIA);
              const baseBg = isSel ? `${ARIA.cyan}26` : ownedBg;
              return (
                <tr
                  key={r.ticker}
                  data-ticker={r.ticker}
                  onClick={() => {
                    setSelectedTicker(r.ticker);
                    onTickerClick && onTickerClick(r.ticker);
                  }}
                  style={{ cursor: "pointer", background: baseBg }}
                  onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = ARIA.bgHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = baseBg; }}
                >
                  <td style={{ ...cell, textAlign: "left", fontWeight: 700, color: ARIA.text, position: "sticky", left: 0, background: ARIA.bgCard, zIndex: 1 }}>
                    {r.ticker}
                  </td>
                  <td style={{ ...cell, color: colorChg(r.change), fontWeight: 700 }}>
                    {r.change != null ? (r.change > 0 ? "+" : "") + r.change.toFixed(2) + "%" : "—"}
                  </td>
                  <td style={{ ...cell, color: colorRvol(r.rvol) }}>
                    {r.rvol != null ? r.rvol.toFixed(1) + "x" : "—"}
                  </td>
                  <td style={{ ...cell, color: ARIA.textDim, fontSize: 8 }}>{fmtVol(r.volume)}</td>
                  <td style={{ ...cell, color: colorCr(r.cr) }}>
                    {r.cr != null ? r.cr + "%" : "—"}
                  </td>
                  <td style={{ ...cell, color: ARIA.textMuted }}>
                    {r.adr != null ? r.adr.toFixed(1) + "%" : "—"}
                  </td>
                  <td style={{ ...cell, textAlign: "left", color: colorLev(r.leverage), fontWeight: 700, fontSize: 8 }}>
                    {r.leverage}
                  </td>
                  <td style={{ ...cell, textAlign: "left", color: ARIA.textMuted, fontSize: 7, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }} title={r.subtheme}>
                    {r.subtheme || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Module-level flag: when set, DrawerThemes (value-chain panel below) skips
// its auto-expand-and-scroll-to-ticker behavior on the next chartTicker change.
// SupercycleMap and similar passive viewers set this so clicking a ticker only
// loads the chart without yanking the right pane around.
const _suppressChainScroll = { skip: false };
function suppressChainScrollOnce() { _suppressChainScroll.skip = true; }

// ── Supercycle Map — collapsible visual map of value-chain layers ─────────
// Reads value_chain_framework notes from /data/theme_notes.json and renders
// each layer as a tier-colored panel with clickable ticker pills.
const _supercycleNotesCache = { notes: null, loading: false };

// Inject keyframes once for the SupercycleMap animations
const _supercycleStylesInjected = { done: false };
function injectSupercycleStyles() {
  if (_supercycleStylesInjected.done || typeof document === "undefined") return;
  const css = `
    @keyframes tp-sc-pulse {
      0%, 100% { box-shadow: 0 0 0 0 var(--tp-glow), 0 0 8px 0 var(--tp-glow); }
      50% { box-shadow: 0 0 0 2px var(--tp-glow-fade), 0 0 18px 4px var(--tp-glow); }
    }
    @keyframes tp-sc-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes tp-sc-fadein {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .tp-sc-card { transition: transform .15s ease, box-shadow .2s ease, border-color .2s ease; }
    .tp-sc-card:hover { transform: translateY(-1px); }
    .tp-sc-pill { transition: transform .12s ease, box-shadow .12s ease, background .15s ease; }
    .tp-sc-pill:hover { transform: translateY(-1px) scale(1.04); }
    .tp-sc-pulse { animation: tp-sc-pulse 2.4s ease-in-out infinite; }
    .tp-sc-shimmer {
      background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.08) 50%, transparent 70%);
      background-size: 200% 100%;
      animation: tp-sc-shimmer 4s linear infinite;
    }
    .tp-sc-fadein { animation: tp-sc-fadein .35s ease both; }
  `;
  const style = document.createElement("style");
  style.setAttribute("data-tp-supercycle", "1");
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
  _supercycleStylesInjected.done = true;
}

// Recent earnings results — May 5-7, 2026 — embedded for live status badges
const SC_RECENT_ER = {
  // May 26
  "ZS":   { status: "beat", date: "May 26", note: "Rev $850M +25% YoY · ARR $3.5B · zero-trust demand resilient" },
  // May 27
  "MRVL": { status: "beat", date: "May 27", note: "Record $2.42B +28% YoY · DC 76% of rev · NVDA $2B investment · Celestial AI $3.5B acq" },
  "CRM":  { status: "beat", date: "May 27", note: "EPS $3.88 +50% YoY · Rev $11.1B +13% · raised FY30 to $63B" },
  "PSTG": { status: "beat", date: "May 27", note: "Flash-native AI storage · SK hynix partnership · hyperscaler demand" },
  "DKS":  { status: "mixed", date: "May 27", note: "Rev $5.17B +63% w/ FL acq · EPS slight miss · comps +6%" },
  // May 28
  "DELL": { status: "beat", date: "May 28", note: "Record $43.8B +88% YoY · AI servers $16.1B +757% · $51.3B backlog" },
  "MDB":  { status: "beat", date: "May 28", note: "Rev $688M +25% YoY · Atlas +29% · AI workloads driving reacceleration" },
  "OKTA": { status: "beat", date: "May 28", note: "Rev $765M +11% · RPO +16% · FCF $271M · identity security steady" },
  "NTAP": { status: "beat", date: "May 28", note: "Record Q4 $1.95B +12% · all-flash $1.2B +18% · AI data pipelines" },
  "BURL": { status: "beat", date: "May 28", note: "EPS $2.10 +26% · comps +6% · 14th straight DDE growth · raised guide" },
  "LULU": { status: "beat", date: "May 28", note: "Double beat · China +25-30% · tariff mitigation $160M target" },
  "BBY":  { status: "beat", date: "May 28", note: "EPS $1.31 +38% · comps +2% · AI PC refresh cycle" },
  "ADSK": { status: "beat", date: "May 28", note: "EPS $2.99 vs $2.70 est · Rev $1.93B +18% · AI design tools" },
  // May 29
  "COST": { status: "beat", date: "May 29", note: "EPS $4.93 · Rev $70.5B +12% · comps +6.6% · e-comm +21%" },
};

// ── ThemeIntelPanel: displays the EOD theme analysis produced by the remote
// Cowork agent and stored in Upstash via /api/theme-analysis.
function ThemeIntelPanel({ onTickerClick }) {
  const ARIA = useAriaTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(() => localStorage.getItem("tp-theme-intel-open") !== "0");
  useEffect(() => { localStorage.setItem("tp-theme-intel-open", open ? "1" : "0"); }, [open]);

  useEffect(() => {
    fetch("/api/theme-analysis")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const cyan = "#22d3ee";
  const purple = "#a855f7";
  const headerStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "7px 12px", cursor: "pointer", userSelect: "none",
    borderBottom: open ? `1px solid ${ARIA.border}` : "none",
  };
  const signalColor = (s) => s === "BROAD" ? ARIA.green : s === "LEADER CONFIRMING" ? cyan : ARIA.textMuted;

  return (
    <div style={{ background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 6, marginBottom: 8, maxHeight: open ? 2400 : "auto", overflowY: open ? "auto" : "hidden", flexShrink: 0 }}>
      <div style={headerStyle} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 10, fontWeight: 800, color: cyan, letterSpacing: 0.8, fontFamily: "monospace" }}>
          ⚡ THEME INTEL
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {data?.saved_at && (
            <span style={{ fontSize: 9, color: ARIA.textMuted, fontFamily: "monospace" }}>
              {new Date(data.saved_at).toLocaleDateString()} {new Date(data.saved_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <span style={{ fontSize: 10, color: ARIA.textMuted }}>{open ? "▲" : "▼"}</span>
        </span>
      </div>

      {open && (
        <div>
          {loading && <div style={{ padding: "12px", fontSize: 9, color: ARIA.textMuted, fontFamily: "monospace" }}>Loading…</div>}
          {!loading && !data?.analysis && (
            <div style={{ padding: "12px", fontSize: 9, color: ARIA.textMuted, fontFamily: "monospace" }}>
              No analysis yet — runs weekdays at 4:30 PM PT.
            </div>
          )}
          {!loading && data?.analysis && (() => {
            const a = data.analysis;
            return (
              <div style={{ fontFamily: "monospace" }}>
                {/* Market context */}
                <div style={{ padding: "8px 12px", borderBottom: `1px solid ${ARIA.border}`, background: `${cyan}08` }}>
                  <div style={{ fontSize: 9, color: cyan, fontWeight: 700, marginBottom: 3 }}>
                    {a.date} · {a.time_pt}
                  </div>
                  {a.market && (() => {
                    const items = [
                      { label: "SPY", val: a.market.spy_chg },
                      { label: "QQQ", val: a.market.qqq_chg },
                      { label: "IWM", val: a.market.iwm_chg },
                    ].filter(i => i.val && !i.val.includes("N/A"));
                    const vix = a.market.vix && !String(a.market.vix).includes("N/A") ? a.market.vix : null;
                    if (!items.length && !vix) return null;
                    return (
                      <div style={{ fontSize: 9, color: ARIA.textDim, marginBottom: 3 }}>
                        {items.map((i, idx) => (<span key={i.label}>{idx > 0 && " · "}<span style={{ color: i.val.startsWith("+") ? ARIA.green : ARIA.red }}>{i.label} {i.val}</span></span>))}
                        {vix && <>{items.length > 0 && " · "}VIX <span style={{ color: ARIA.yellow }}>{vix}</span></>}
                      </div>
                    );
                  })()}
                  <div style={{ fontSize: 8, color: ARIA.textMuted, lineHeight: 1.4 }}>{a.regime}</div>
                </div>

                {/* Active chains */}
                {a.active_chains?.length > 0 && (
                  <div style={{ padding: "8px 12px 6px", borderBottom: `1px solid ${ARIA.border}` }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: ARIA.textMuted, letterSpacing: 0.5, marginBottom: 5, textTransform: "uppercase" }}>
                      Active Thesis Chains ({a.active_chains.length})
                    </div>
                    {a.active_chains.map((chain, ci) => (
                      <div key={ci} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: ci < a.active_chains.length - 1 ? `1px dashed ${ARIA.border}` : "none" }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: cyan, lineHeight: 1.35, marginBottom: 2 }}>🔥 {chain.headline}</div>
                        <div style={{ fontSize: 7, color: ARIA.textMuted, marginBottom: 4 }}>{chain.id}</div>
                        {chain.tickers?.map((t, ti) => (
                          <div key={ti} style={{ marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginBottom: 2 }}>
                              <button
                                onClick={() => onTickerClick?.(t.ticker)}
                                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: ARIA.green, fontWeight: 800, fontSize: 9, fontFamily: "monospace" }}
                              >{t.ticker}</button>
                              <span style={{ fontSize: 8, color: t.score >= 5 ? ARIA.green : ARIA.textDim }}>{t.score}/6</span>
                              <span style={{ fontSize: 8, color: (t.chg >= 0 ? ARIA.green : ARIA.red), fontWeight: 700 }}>{t.chg > 0 ? "+" : ""}{t.chg?.toFixed?.(1) ?? t.chg}%</span>
                              <span style={{ fontSize: 8, color: t.rvol >= 1.5 ? purple : ARIA.textMuted }}>{t.rvol?.toFixed?.(1) ?? t.rvol}x RVol</span>
                              <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 2, background: t.role === "primary" ? `${cyan}20` : `${purple}15`, border: `1px solid ${t.role === "primary" ? cyan + "50" : purple + "40"}`, color: t.role === "primary" ? cyan : purple, textTransform: "uppercase" }}>{t.role}</span>
                              {t.lead_lag && <span style={{ fontSize: 7, color: t.lead_lag === "leading" ? ARIA.green : ARIA.textMuted, textTransform: "uppercase" }}>{t.lead_lag}</span>}
                            </div>
                            {t.layer && <div style={{ fontSize: 8, color: ARIA.textMuted, marginBottom: 2 }}>Layer: {t.layer}</div>}
                            {t.analysis && <div style={{ fontSize: 8, color: ARIA.textDim, lineHeight: 1.4 }}>{t.analysis}</div>}
                          </div>
                        ))}
                        {chain.chain_signal && (
                          <div style={{ fontSize: 8, fontWeight: 700, color: signalColor(chain.chain_signal), marginTop: 2 }}>
                            Signal: {chain.chain_signal}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Non-thesis leaders */}
                {a.non_thesis_leaders?.length > 0 && (
                  <div style={{ padding: "8px 12px 6px", borderBottom: `1px solid ${ARIA.border}` }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: ARIA.textMuted, letterSpacing: 0.5, marginBottom: 5, textTransform: "uppercase" }}>Non-Thesis Leaders</div>
                    {a.non_thesis_leaders.map((t, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, flexWrap: "wrap" }}>
                        <button onClick={() => onTickerClick?.(t.ticker)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: ARIA.text, fontWeight: 700, fontSize: 9, fontFamily: "monospace" }}>{t.ticker}</button>
                        <span style={{ fontSize: 8, color: ARIA.green }}>{t.chg > 0 ? "+" : ""}{t.chg?.toFixed?.(1) ?? t.chg}%</span>
                        <span style={{ fontSize: 8, color: ARIA.textMuted }}>{t.rvol?.toFixed?.(1) ?? t.rvol}x RVol</span>
                        <span style={{ fontSize: 8, color: ARIA.textMuted }}>{t.theme}</span>
                        {t.note && <span style={{ fontSize: 8, color: ARIA.textDim, flexBasis: "100%" }}>{t.note}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Dormant chains */}
                {a.dormant_chains?.length > 0 && (
                  <div style={{ padding: "8px 12px 6px", borderBottom: `1px solid ${ARIA.border}` }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: ARIA.textMuted, letterSpacing: 0.5, marginBottom: 5, textTransform: "uppercase" }}>Dormant Chains ({a.dormant_chains.length})</div>
                    {a.dormant_chains.map((c, i) => (
                      <div key={i} style={{ fontSize: 8, color: ARIA.textMuted, marginBottom: 2 }}>— {c.headline}</div>
                    ))}
                  </div>
                )}

                {/* Synthesis */}
                {a.synthesis && (
                  <div style={{ padding: "8px 12px" }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: ARIA.textMuted, letterSpacing: 0.5, marginBottom: 5, textTransform: "uppercase" }}>EOD Synthesis</div>
                    <div style={{ fontSize: 9, color: ARIA.textDim, lineHeight: 1.45 }}>{a.synthesis}</div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function SupercycleMap({ chartTicker, onTickerClick: onTickerClickRaw }) {
  const ARIA = useAriaTheme();
  // Wrap the click handler so we suppress the value-chain auto-expand + scroll
  // every time. The user explicitly wants ticker clicks here to be passive —
  // load chart only, don't move the right pane around.
  const onTickerClick = useCallback((t) => {
    if (!t) return;
    suppressChainScrollOnce();
    onTickerClickRaw?.(t);
  }, [onTickerClickRaw]);
  const [expanded, setExpanded] = useState(() => localStorage.getItem("tp-supercycle-open") === "1");
  const [notes, setNotes] = useState(() => _supercycleNotesCache.notes);
  // Per-framework collapsed state — set of framework ids that are collapsed.
  // Persisted to localStorage. Default: everything expanded (empty set).
  const [collapsedFw, setCollapsedFw] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("tp-supercycle-collapsed") || "[]")); }
    catch { return new Set(); }
  });
  const toggleFw = useCallback((id) => {
    setCollapsedFw(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("tp-supercycle-collapsed", JSON.stringify([...next]));
      return next;
    });
  }, []);
  const collapseAll = useCallback(() => {
    if (!notes) return;
    const ids = notes.filter(n => n.type === "value_chain_framework" && n.layers).map(n => n.id);
    const next = new Set(ids);
    setCollapsedFw(next);
    localStorage.setItem("tp-supercycle-collapsed", JSON.stringify([...next]));
  }, [notes]);
  const expandAll = useCallback(() => {
    setCollapsedFw(new Set());
    localStorage.setItem("tp-supercycle-collapsed", "[]");
  }, []);

  useEffect(() => { injectSupercycleStyles(); }, []);
  useEffect(() => { localStorage.setItem("tp-supercycle-open", expanded ? "1" : "0"); }, [expanded]);

  useEffect(() => {
    if (_supercycleNotesCache.notes) { setNotes(_supercycleNotesCache.notes); return; }
    if (_supercycleNotesCache.loading) return;
    _supercycleNotesCache.loading = true;
    fetch("/data/theme_notes.json")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const arr = d?.notes || [];
        _supercycleNotesCache.notes = arr;
        _supercycleNotesCache.loading = false;
        setNotes(arr);
      })
      .catch(() => { _supercycleNotesCache.loading = false; });
  }, []);

  const frameworks = useMemo(() => {
    if (!notes) return [];
    return notes.filter(n =>
      n.type === "value_chain_framework" && n.layers && typeof n.layers === "object"
    );
  }, [notes]);

  // Tier color system — gradient + glow
  const TIER = {
    1: { color: "#10b981", glow: "rgba(16,185,129,0.55)", glowFade: "rgba(16,185,129,0)", label: "T1", desc: "Core · highest conviction", grad: "linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0.02) 100%)" },
    2: { color: "#22d3ee", glow: "rgba(34,211,238,0.45)", glowFade: "rgba(34,211,238,0)", label: "T2", desc: "Strong derivative", grad: "linear-gradient(135deg, rgba(34,211,238,0.16) 0%, rgba(34,211,238,0.02) 100%)" },
    3: { color: "#f59e0b", glow: "rgba(245,158,11,0.45)", glowFade: "rgba(245,158,11,0)", label: "T3", desc: "Speculative · narrative", grad: "linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.02) 100%)" },
  };

  // Earnings status visual config
  const ER_STATUS = {
    beat:    { icon: "▲", color: "#10b981", bg: "rgba(16,185,129,0.18)", border: "rgba(16,185,129,0.55)", label: "BEAT" },
    mixed:   { icon: "◐", color: "#fbbf24", bg: "rgba(251,191,36,0.16)", border: "rgba(251,191,36,0.5)",  label: "MIXED" },
    miss:    { icon: "▼", color: "#ef4444", bg: "rgba(239,68,68,0.16)",  border: "rgba(239,68,68,0.5)",   label: "MISS" },
  };

  const layerCount = frameworks.reduce((n, f) => n + Object.keys(f.layers).length, 0);
  const allTickers = useMemo(() => {
    const set = new Set();
    frameworks.forEach(f => Object.values(f.layers).forEach(l => (l.tickers || []).forEach(t => set.add(t))));
    return set;
  }, [frameworks]);
  const erHits = useMemo(() => {
    const arr = [];
    Object.entries(SC_RECENT_ER).forEach(([t, e]) => {
      if (allTickers.has(t)) arr.push({ ticker: t, ...e });
    });
    // Sort by date then ticker
    return arr.sort((a, b) => (a.date + a.ticker).localeCompare(b.date + b.ticker));
  }, [allTickers]);
  const beatCount = erHits.filter(e => e.status === "beat").length;
  const mixedCount = erHits.filter(e => e.status === "mixed").length;
  const missCount = erHits.filter(e => e.status === "miss").length;

  if (!notes) return null;

  return (
    <div style={{ borderBottom: `1px solid ${ARIA.border}` }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          userSelect: "none",
          background: expanded
            ? "linear-gradient(90deg, rgba(16,185,129,0.08) 0%, rgba(34,211,238,0.04) 50%, rgba(245,158,11,0.06) 100%)"
            : "transparent",
          borderBottom: expanded ? `1px solid ${ARIA.border}` : "none",
        }}
      >
        <span style={{ fontSize: 11, color: ARIA.textMuted, transition: "transform 0.2s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>⚡</span>
          <span style={{
            fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.2,
            background: "linear-gradient(90deg, #10b981 0%, #22d3ee 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>
            Supercycle Intel
          </span>
        </div>
        <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace" }}>
          {frameworks.length} frameworks · {layerCount} layers · {erHits.length} prints this wk
        </span>
        {expanded && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <span title={`${beatCount} beats`} style={{ fontSize: 9, color: ER_STATUS.beat.color, fontFamily: "monospace", fontWeight: 700 }}>▲ {beatCount}</span>
            <span title={`${mixedCount} mixed`} style={{ fontSize: 9, color: ER_STATUS.mixed.color, fontFamily: "monospace", fontWeight: 700 }}>◐ {mixedCount}</span>
            <span title={`${missCount} misses`} style={{ fontSize: 9, color: ER_STATUS.miss.color, fontFamily: "monospace", fontWeight: 700 }}>▼ {missCount}</span>
            <span style={{ color: ARIA.border, margin: "0 2px" }}>|</span>
            {Object.entries(TIER).map(([t, info]) => (
              <span key={t} title={info.desc} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: info.color, boxShadow: `0 0 6px ${info.glow}`, display: "inline-block" }} />
                <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", fontWeight: 700 }}>{info.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      {expanded && (
        <div className="tp-sc-fadein" style={{ padding: "10px 12px 14px", background: "linear-gradient(180deg, rgba(13,17,23,0.4) 0%, transparent 60%)" }}>


          {/* This Week's Earnings strip */}
          {erHits.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                <span style={{ fontSize: 8, color: ARIA.text, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}>
                  This Week's Prints
                </span>
                <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace" }}>May 26-29 · Q1 2026</span>
                <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${ARIA.border}, transparent)`, marginLeft: 4 }} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {erHits.map(e => {
                  const cfg = ER_STATUS[e.status];
                  const sel = chartTicker === e.ticker;
                  return (
                    <button
                      key={e.ticker}
                      onClick={() => onTickerClick?.(e.ticker)}
                      title={`${e.ticker} · ${cfg.label} (${e.date})\n${e.note}`}
                      className="tp-sc-pill"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: 11, padding: "4px 9px", borderRadius: 5, cursor: "pointer",
                        fontFamily: "monospace", fontWeight: 700,
                        whiteSpace: "nowrap", lineHeight: 1.2,
                        background: sel ? cfg.color : cfg.bg,
                        border: `1px solid ${cfg.border}`,
                        color: sel ? "#0a0a0e" : cfg.color,
                      }}
                    >
                      <span style={{ fontSize: 10, lineHeight: 1 }}>{cfg.icon}</span>
                      {e.ticker}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Frameworks */}
          {/* Frameworks header — collapse all / expand all */}
          {frameworks.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 8, color: ARIA.text, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}>
                Value Chain Frameworks
              </span>
              <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace" }}>
                {frameworks.length - collapsedFw.size}/{frameworks.length} expanded
              </span>
              <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${ARIA.border}, transparent)`, marginLeft: 4 }} />
              <button onClick={expandAll} style={{
                fontSize: 7, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
                fontFamily: "monospace", fontWeight: 700,
                background: "transparent", border: `1px solid ${ARIA.border}`, color: ARIA.textMuted,
              }}>+ ALL</button>
              <button onClick={collapseAll} style={{
                fontSize: 7, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
                fontFamily: "monospace", fontWeight: 700,
                background: "transparent", border: `1px solid ${ARIA.border}`, color: ARIA.textMuted,
              }}>− ALL</button>
            </div>
          )}

          {frameworks.map((fw, fwIdx) => {
            const headlineShort = (fw.headline || "").split("—")[0]?.trim() || fw.id;
            const layerEntries = Object.entries(fw.layers);
            // Cycle stage heuristic: any beat in the framework = Phase 2+ confirmed
            const fwTickers = layerEntries.flatMap(([_, l]) => l.tickers || []);
            const fwBeats = fwTickers.filter(t => SC_RECENT_ER[t]?.status === "beat").length;
            const fwHasER = fwTickers.some(t => SC_RECENT_ER[t]);
            const phaseLabel = fwBeats >= 2 ? "PHASE 2 · Confirmed" : fwHasER ? "PHASE 1-2 · Building" : "PHASE 1 · Setup";
            const phaseColor = fwBeats >= 2 ? "#10b981" : fwHasER ? "#22d3ee" : "#f59e0b";
            const isCollapsed = collapsedFw.has(fw.id);

            return (
              <div key={fw.id} style={{ marginBottom: isCollapsed ? 6 : 14 }}>
                {/* Framework header — clickable to toggle collapse */}
                <div
                  onClick={() => toggleFw(fw.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
                    paddingBottom: 4,
                    borderBottom: `1px dashed ${ARIA.border}`,
                    cursor: "pointer", userSelect: "none",
                  }}
                >
                  <span style={{
                    fontSize: 10, color: ARIA.textMuted,
                    transition: "transform 0.15s",
                    transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                    display: "inline-block",
                    width: 10,
                  }}>▶</span>
                  <span style={{ fontSize: 9, color: ARIA.textMuted, fontFamily: "monospace", fontWeight: 800 }}>
                    {String(fwIdx + 1).padStart(2, "0")}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: ARIA.text, textTransform: "uppercase", letterSpacing: 0.6 }}>
                    {headlineShort}
                  </span>
                  <span title={phaseLabel} style={{
                    fontSize: 7, fontFamily: "monospace", fontWeight: 800,
                    color: phaseColor, background: `${phaseColor}1f`,
                    border: `1px solid ${phaseColor}55`,
                    padding: "1px 6px", borderRadius: 3,
                    letterSpacing: 0.5,
                  }}>
                    {phaseLabel}
                  </span>
                  {fwBeats > 0 && (
                    <span style={{ fontSize: 7, color: "#10b981", fontFamily: "monospace", fontWeight: 700 }}>
                      ▲ {fwBeats} confirming
                    </span>
                  )}
                  <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace", fontWeight: 600 }}>
                    {layerEntries.length}L · {fwTickers.length}T
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace" }}>
                    {fw.date}
                  </span>
                </div>

                {!isCollapsed && (
                <>
                {/* Layer grid */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 7,
                }}>
                  {layerEntries.map(([key, layer], idx) => {
                    const tier = TIER[layer.tier] || { color: "#5a5a7a", glow: "rgba(90,90,122,0.3)", glowFade: "rgba(90,90,122,0)", label: "—", grad: "linear-gradient(135deg, rgba(90,90,122,0.10), transparent)" };
                    const tickers = layer.tickers || [];
                    const avoid = layer.avoid || [];
                    const speculative = layer.speculative || [];
                    const unlisted = layer.unlisted || [];
                    const label = layer.label || key.replace(/_/g, " ");
                    const layerBeats = tickers.filter(t => SC_RECENT_ER[t]?.status === "beat").length;

                    return (
                      <div
                        key={key}
                        className="tp-sc-card"
                        style={{
                          background: tier.grad + ", linear-gradient(180deg, rgba(20,24,32,0.6) 0%, rgba(13,17,23,0.7) 100%)",
                          border: `1px solid ${tier.color}38`,
                          borderRadius: 6,
                          padding: "8px 10px",
                          position: "relative",
                          boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.02), 0 1px 0 0 rgba(0,0,0,0.3)`,
                          animationDelay: `${idx * 30}ms`,
                        }}
                      >
                        {/* Tier indicator strip */}
                        <div style={{
                          position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                          background: `linear-gradient(180deg, ${tier.color} 0%, ${tier.color}66 100%)`,
                          borderRadius: "6px 0 0 6px",
                          boxShadow: `0 0 8px ${tier.glow}`,
                        }} />

                        {/* Header row */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                          {layer.tier && (
                            <span style={{
                              fontSize: 8, fontWeight: 900, color: tier.color, fontFamily: "monospace",
                              background: `${tier.color}1f`, padding: "1px 5px", borderRadius: 3,
                              border: `1px solid ${tier.color}66`,
                              letterSpacing: 0.5,
                              boxShadow: `0 0 6px ${tier.glow}`,
                            }}>
                              {tier.label}
                            </span>
                          )}
                          <span style={{ fontSize: 10, fontWeight: 800, color: ARIA.text, letterSpacing: 0.2 }}>
                            {label}
                          </span>
                          {layerBeats > 0 && (
                            <span title={`${layerBeats} beat this week`} style={{
                              marginLeft: "auto", fontSize: 7, color: "#10b981", fontFamily: "monospace",
                              fontWeight: 800, background: "rgba(16,185,129,0.12)",
                              padding: "1px 5px", borderRadius: 2, border: "1px solid rgba(16,185,129,0.4)",
                            }}>
                              ▲{layerBeats}
                            </span>
                          )}
                        </div>

                        {/* Thesis preview */}
                        {layer.thesis && (
                          <div style={{
                            fontSize: 9, color: ARIA.textDim, lineHeight: 1.5, marginBottom: 7,
                          }}>
                            {layer.thesis}
                          </div>
                        )}

                        {/* Tickers */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {tickers.map((t) => {
                            const sel = chartTicker === t;
                            const er = SC_RECENT_ER[t];
                            const erCfg = er ? ER_STATUS[er.status] : null;
                            const tooltip = er ? `${t} · ${erCfg.label} (${er.date})\n${er.note}` : t;
                            return (
                              <button
                                key={t}
                                onClick={() => onTickerClick?.(t)}
                                title={tooltip}
                                className="tp-sc-pill"
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  fontSize: 11,
                                  padding: "3px 8px",
                                  borderRadius: 4,
                                  cursor: "pointer",
                                  fontFamily: "monospace",
                                  fontWeight: sel ? 800 : 700,
                                  whiteSpace: "nowrap",
                                  lineHeight: 1.2,
                                  background: sel ? tier.color : (erCfg ? erCfg.bg : "rgba(255,255,255,0.04)"),
                                  border: `1px solid ${sel ? tier.color : (erCfg ? erCfg.border : tier.color + "55")}`,
                                  color: sel ? "#0a0a0e" : (erCfg ? erCfg.color : "#e8e8f4"),
                                  boxShadow: sel ? `0 0 10px ${tier.glow}` : "none",
                                }}
                              >
                                {erCfg && <span style={{ fontSize: 9, lineHeight: 1 }}>{erCfg.icon}</span>}
                                {t}
                              </button>
                            );
                          })}
                          {speculative.map((t) => (
                            <button
                              key={t}
                              onClick={() => onTickerClick?.(t)}
                              title={`${t} · speculative`}
                              className="tp-sc-pill"
                              style={{
                                fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                                fontFamily: "monospace", fontWeight: 600,
                                whiteSpace: "nowrap", lineHeight: 1.2,
                                background: "rgba(245,158,11,0.10)",
                                border: "1px dashed rgba(245,158,11,0.55)",
                                color: "#f59e0b",
                                fontStyle: "italic",
                              }}
                            >
                              {t}
                            </button>
                          ))}
                          {avoid.map((t) => (
                            <button
                              key={t}
                              onClick={() => onTickerClick?.(t)}
                              title={`${t} · AVOID — click for chart`}
                              className="tp-sc-pill"
                              style={{
                                fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                                fontFamily: "monospace", fontWeight: 500,
                                whiteSpace: "nowrap", lineHeight: 1.2,
                                background: "transparent",
                                border: "1px dashed rgba(239,68,68,0.5)",
                                color: "#ef4444",
                                textDecoration: "line-through",
                                textDecorationColor: "rgba(239,68,68,0.6)",
                                opacity: 0.85,
                              }}
                            >
                              {t}
                            </button>
                          ))}
                          {unlisted.map((name) => (
                            <span key={name} title={`${name} · not US-listed`} style={{
                              fontSize: 10, padding: "2px 6px", borderRadius: 3,
                              fontFamily: "monospace", fontStyle: "italic",
                              whiteSpace: "nowrap", lineHeight: 1.2,
                              color: ARIA.textMuted,
                              border: `1px dotted ${ARIA.border}`,
                              opacity: 0.7,
                            }}>
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Lead-lag flow */}
                {fw.lead_lag?.chain_flow && (
                  <div style={{
                    fontSize: 8, color: ARIA.textDim, fontFamily: "monospace",
                    marginTop: 6, padding: "5px 8px", lineHeight: 1.5,
                    background: "rgba(255,255,255,0.02)",
                    border: `1px solid ${ARIA.border}`, borderRadius: 4,
                    borderLeft: `2px solid ${phaseColor}`,
                  }}>
                    <span style={{ color: phaseColor, fontWeight: 800, letterSpacing: 0.5 }}>FLOW →</span>{" "}
                    {fw.lead_lag.chain_flow}
                  </div>
                )}
                </>
                )}
              </div>
            );
          })}

          {/* Footer */}
          <div style={{
            fontSize: 7, color: ARIA.textMuted, paddingTop: 6,
            borderTop: `1px dashed ${ARIA.border}`, fontStyle: "italic",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>Source: theme_notes.json · ER status: Q1 2026 prints (May 5-7)</span>
            <span style={{ fontFamily: "monospace" }}>click any ticker → chart</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Earnings Calendar — collapsible weekly ER schedule above Scan Watch ──
// Replicates the leaderboard's renderEarningsCalendar logic:
//   1. FMP /api/earnings as authoritative source, falls back to pipeline
//   2. Drawer (theme-universe + WL/PF) vs All Universe ($100M dvol min) scope
//   3. Prev/Next week navigation
//   4. Logo tiles with BMO/AMC badges, drawer tickers sorted first
const ER_LOGO = (tk) => `https://images.financialmodelingprep.com/symbol/${tk}.png`;
const erCalCache = {};

function EarningsCalendar({ stocks, stockMap, onTickerClick, chartTicker, embedded = false, movers = [] }) {
  const ARIA = useAriaTheme();
  // Post-report mover lookup — prefer entries carrying er/MAGNA data.
  const moverMap = useMemo(() => {
    const m = {};
    (movers || []).forEach((mv) => {
      if (!mv?.ticker) return;
      if (!m[mv.ticker] || (mv.er && !m[mv.ticker].er)) m[mv.ticker] = mv;
    });
    return m;
  }, [movers]);
  // EP assessment per reporter (MAGNA framework):
  //   pre-ER  → the knowable-in-advance half: A-potential (sales accel) +
  //             N (no 20% rally in + neglect evidence) + CAP10/IPO10 bonus
  //   post-ER → the mover's MAGNA result; 4/4 = genuine EP (2-5/yr)
  const epInfo = (tk) => {
    const s = stockMap?.[tk] || {};
    const aPot = s.sales_yoy != null && (s.sales_yoy >= 25 || (s.sales_yoy >= 29 && s.sales_yoy_prev != null && s.sales_yoy_prev >= 29));
    const noRally = s.return_1m == null || s.return_1m < 20;
    const negOwn = s.inst_own_pct == null || s.inst_own_pct < 40 || (s.inst_holder_count != null && s.inst_holder_count < 300);
    const cap10 = s.market_cap_raw > 0 && s.market_cap_raw < 10e9;
    const ipo10 = s.ipo_date ? (Date.now() - new Date(s.ipo_date).getTime()) < 3652 * 864e5 : false;
    const setup = aPot && noRally && negOwn;
    const mv = moverMap[tk];
    const magna = mv?.magna_score ?? null;
    const genuine = mv?.genuine_ep || magna === 4;
    return { s, aPot, noRally, negOwn, cap10, ipo10, setup, mv, magna, genuine };
  };
  // embedded (subtab) mode: always expanded, no collapse toggle
  const [expandedRaw, setExpanded] = useState(() => localStorage.getItem("tp-er-cal-open") === "1");
  const expanded = embedded || expandedRaw;
  const [mode, setMode] = useState(() => localStorage.getItem("tp-er-cal-mode") || "drawer");
  const [weekOffset, setWeekOffset] = useState(0);
  const [fmpEvents, setFmpEvents] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!embedded) localStorage.setItem("tp-er-cal-open", expandedRaw ? "1" : "0"); }, [expandedRaw, embedded]);
  useEffect(() => { localStorage.setItem("tp-er-cal-mode", mode); }, [mode]);

  const isoDate = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  const { monday, friday, weekLabel } = useMemo(() => {
    const now = new Date();
    const dow = now.getUTCDay() || 7;
    const mon = new Date(now);
    mon.setUTCDate(now.getUTCDate() - (dow - 1) + weekOffset * 7);
    mon.setUTCHours(0, 0, 0, 0);
    const fri = new Date(mon.getTime() + 4 * 86400000);
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const label = `${dayNames[mon.getUTCDay()]} ${mon.getUTCDate()} → ${dayNames[fri.getUTCDay()]} ${fri.getUTCDate()}`;
    return { monday: mon, friday: fri, weekLabel: label };
  }, [weekOffset]);

  // Fetch FMP earnings calendar for the week
  useEffect(() => {
    if (!expanded) return;
    const from = isoDate(monday);
    const to = isoDate(new Date(monday.getTime() + 6 * 86400000));
    const key = `${from}_${to}`;
    if (erCalCache[key]) { setFmpEvents(erCalCache[key]); return; }
    setLoading(true);
    fetch(`/api/earnings-week?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const ev = d?.events || [];
        erCalCache[key] = ev;
        setFmpEvents(ev);
      })
      .catch(() => setFmpEvents(null))
      .finally(() => setLoading(false));
  }, [expanded, monday]);

  // Build pipeline lookup maps
  // drawerSet = DRAWER_TICKERS — the curated value-chain ticker list, same as
  // the leaderboard's SUBTHEMES → TICKER_THEMES.
  const { pipelineER, pipelineDvol, pipelineMcap } = useMemo(() => {
    const er = {}, dvol = {}, mcap = {};
    if (stocks) {
      stocks.forEach((s) => {
        const tk = s.ticker;
        if (s.avg_dollar_vol_raw > 0) dvol[tk] = s.avg_dollar_vol_raw;
        if (s.market_cap_raw > 0) mcap[tk] = s.market_cap_raw;
        if (s.earnings_days != null) {
          er[tk] = { earnings_days: s.earnings_days, er_timing: s.er_timing || "", avg_er_move: s.avg_er_move, grade: s.grade || "" };
        }
      });
    }
    return { pipelineER: er, pipelineDvol: dvol, pipelineMcap: mcap };
  }, [stocks]);
  const drawerSet = DRAWER_TICKERS;

  const weekData = useMemo(() => {
    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);

    // Build events: prefer FMP, fallback to pipeline
    let events;
    let usingFallback = false;
    if (fmpEvents && fmpEvents.length > 0) {
      events = fmpEvents;
    } else {
      usingFallback = true;
      events = Object.entries(pipelineER)
        .filter(([, v]) => v.earnings_days != null)
        .map(([tk, v]) => {
          const erDate = new Date(todayMidnight);
          erDate.setUTCDate(erDate.getUTCDate() + v.earnings_days);
          return { ticker: tk, date: isoDate(erDate), timing: (v.er_timing || "").toLowerCase() };
        });
    }

    // Scope filter
    const MIN_DVOL = 100_000_000;
    const scoped = mode === "drawer"
      ? events.filter(e => drawerSet.has(e.ticker))
      : events.filter(e => drawerSet.has(e.ticker) || (pipelineDvol[e.ticker] || 0) >= MIN_DVOL);

    // Bucket into Mon-Fri
    const days = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday.getTime() + i * 86400000);
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      days.push({
        label: `${dayNames[d.getUTCDay()]} ${d.getUTCDate()}`,
        date: d,
        dateStr: isoDate(d),
        isToday: d.getTime() === todayMidnight.getTime(),
        tickers: [],
      });
    }

    scoped.forEach((e) => {
      const erDate = new Date(`${e.date}T00:00:00Z`);
      const dayIdx = Math.floor((erDate - monday) / 86400000);
      if (dayIdx < 0 || dayIdx > 4) return;
      const pipe = pipelineER[e.ticker] || {};
      days[dayIdx].tickers.push({
        ticker: e.ticker,
        timing: e.timing || (pipe.er_timing || "").toLowerCase(),
        inDrawer: drawerSet.has(e.ticker),
        grade: pipe.grade || "",
        avgMove: pipe.avg_er_move,
      });
    });

    // Sort: market cap descending
    days.forEach((d) => {
      d.tickers.sort((a, b) => (pipelineMcap[b.ticker] || 0) - (pipelineMcap[a.ticker] || 0));
    });

    return { days, usingFallback };
  }, [fmpEvents, pipelineER, pipelineDvol, pipelineMcap, drawerSet, mode, monday]);

  const totalCount = weekData.days.reduce((n, d) => n + d.tickers.length, 0);

  const timingBadge = () => null;

  return (
    <div style={embedded ? undefined : { borderBottom: `1px solid ${ARIA.border}` }}>
      {/* Header */}
      <div
        onClick={embedded ? undefined : () => setExpanded(!expandedRaw)}
        style={{ padding: embedded ? "2px 2px 4px" : "5px 12px", display: "flex", alignItems: "center", gap: 6, cursor: embedded ? "default" : "pointer", userSelect: "none" }}
      >
        {!embedded && <span style={{ fontSize: 9, color: ARIA.textMuted, transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>}
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: ARIA.textDim }}>
          Earnings Calendar
        </span>
        <span style={{ fontSize: 8, color: ARIA.textMuted }}>({totalCount})</span>
        {expanded && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 3, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setWeekOffset(w => w - 1)} style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", border: `1px solid ${ARIA.border}`, color: ARIA.textMuted, background: "transparent" }}>←</button>
            <button onClick={() => setWeekOffset(0)} style={{ fontSize: 7, padding: "1px 5px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", border: `1px solid ${ARIA.border}`, color: weekOffset === 0 ? ARIA.cyan : ARIA.textMuted, background: "transparent" }}>Today</button>
            <button onClick={() => setWeekOffset(w => w + 1)} style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", border: `1px solid ${ARIA.border}`, color: ARIA.textMuted, background: "transparent" }}>→</button>
            <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace", marginLeft: 4 }}>{weekLabel}</span>
            <span style={{ color: ARIA.border, margin: "0 2px" }}>|</span>
            <button onClick={() => setMode("drawer")} style={{ fontSize: 7, padding: "1px 5px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontWeight: mode === "drawer" ? 700 : 400, border: `1px solid ${ARIA.cyan}`, color: ARIA.cyan, background: mode === "drawer" ? `${ARIA.cyan}26` : "transparent" }}>Drawer</button>
            <button onClick={() => setMode("all")} style={{ fontSize: 7, padding: "1px 5px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontWeight: mode === "all" ? 700 : 400, border: `1px solid ${ARIA.cyan}`, color: ARIA.cyan, background: mode === "all" ? `${ARIA.cyan}26` : "transparent" }}>All Universe</button>
          </div>
        )}
      </div>
      {/* Body */}
      {expanded && (
        <div style={{ padding: embedded ? "0 2px 8px" : "0 12px 8px" }}>
          {loading && <div style={{ fontSize: 8, color: ARIA.textMuted, padding: "4px 0" }}>Loading FMP calendar…</div>}
          {weekData.usingFallback && !loading && <div style={{ fontSize: 7, color: ARIA.yellow, padding: "2px 0 4px" }}>Using pipeline data (FMP unavailable). Timing may be stale.</div>}
          <div style={{ fontSize: 7, color: ARIA.textDim, padding: "0 0 5px", lineHeight: 1.5 }}
            title={"MAGNA53 + CAP10*10 — MAGNA is necessary, the rest nice-to-have.\nMA = massive acceleration: 100%+ EPS growth on meaningful terms ($0.05→$0.20, not $0.01→$0.04), 100%+ sales on a ≥$10M base, a massive (100%+, ≥$0.10) earnings surprise, or 29%+ sales two quarters running on $25M+ annual sales.\nG = gap up ≥4% AH/PM on ≥100K volume.\nN = neglect: base of months-years (no 20%+ rally into ER) + low fund ownership.\nA = sales accel ≥25% (or 29%+ 2Q running); earnings growth without sales is questionable — waived only in a turnaround (loss→profit).\n5 = short-interest days-to-cover >5 (no SI data on current FMP plan — unscored).\n3 = 3+ analyst upgrades/PT raises in 30d (AN3, checked on near-genuine movers).\nCAP10 = mcap <$10B · *10 = IPO <10 years."}>
            MAGNA53 + CAP10*10 · 🎯 = pre-ER EP setup (sales accel + neglect, the knowable half) · <span style={{ color: ARIA.yellow, fontWeight: 700 }}>gold = genuine EP (MAGNA 4/4)</span> — life-changing catalyst, expect 2-5/yr · n/4 = reported, partial · hover for full breakdown
          </div>
          {weekData.days.map((day, di) => (
            <div key={di} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: day.isToday ? ARIA.cyan : ARIA.textMuted, fontFamily: "monospace" }}>{day.label}</span>
                <span style={{ fontSize: 7, color: ARIA.textMuted }}>({day.tickers.length})</span>
              </div>
              {day.tickers.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, paddingLeft: 4 }}>
                  {[...day.tickers].sort((a, b) => {
                    const rk = (tk) => { const e = epInfo(tk); return e.genuine ? 3 : e.mv ? 2 : e.setup ? 1 : 0; };
                    return rk(b.ticker) - rk(a.ticker); // stable: mcap order kept within tiers
                  }).map((t) => {
                    const sel = chartTicker === t.ticker;
                    const badge = timingBadge(t.timing);
                    const ep = epInfo(t.ticker);
                    const s = ep.s;
                    const chg = ep.mv ? (ep.mv.change_pct ?? ep.mv.ext_hours_change_pct) : null;
                    const borderC = sel ? ARIA.cyan
                      : ep.genuine ? ARIA.yellow
                      : ep.mv ? (chg > 0 ? ARIA.green + "88" : chg < 0 ? ARIA.red + "88" : ARIA.border)
                      : t.inDrawer ? ARIA.border : ARIA.border;
                    const tip = (() => {
                      const bits = [];
                      if (ep.mv) {
                        bits.push(`REPORTED${chg != null ? ` ${chg > 0 ? "+" : ""}${(+chg).toFixed(1)}%` : ""} · MAGNA ${ep.magna ?? "—"}/4${(ep.mv.magna_flags || []).length ? ` [${ep.mv.magna_flags.join("·")}]` : ""}${ep.genuine ? " — GENUINE EP" : ""}`);
                        if (ep.mv.ep_quality_label) bits.push(`quality: ${ep.mv.ep_quality_label}${ep.mv.sizing_guide ? ` · size ${ep.mv.sizing_guide}` : ""}`);
                      } else {
                        bits.push(`EP setup — sales accel ${ep.aPot ? "✓" : "✗"}${s.sales_yoy != null ? ` (${s.sales_yoy > 0 ? "+" : ""}${s.sales_yoy.toFixed(0)}% YoY${s.sales_yoy_prev != null ? `, prev ${s.sales_yoy_prev > 0 ? "+" : ""}${s.sales_yoy_prev.toFixed(0)}%` : ""})` : ""} · no rally-in ${ep.noRally ? "✓" : "✗"}${s.return_1m != null ? ` (1m ${s.return_1m > 0 ? "+" : ""}${s.return_1m.toFixed(0)}%)` : ""} · neglect ${ep.negOwn ? "✓" : "✗"}${s.inst_own_pct != null ? ` (inst ${s.inst_own_pct.toFixed(0)}%)` : ""}`);
                        bits.push("still needs post-report: life-changing beat (M) + 4%/100K gap (G). Genuine EPs: 2-5/yr.");
                      }
                      const bon = [...new Set([ep.cap10 && "CAP10", ep.ipo10 && "IPO<10y", ...((ep.mv?.magna_bonus || []).map((b) => b === "AN3" ? "3+ upgrades/PT raises" : b === "IPO10" ? "IPO<10y" : b))].filter(Boolean))].join(" · ");
                      if (bon) bits.push(`bonus: ${bon}`);
                      if (t.avgMove) bits.push(`avg ER move ±${t.avgMove.toFixed(1)}%`);
                      if (t.grade) bits.push(t.grade);
                      return `${t.ticker}${badge ? ` ${badge.label}` : ""}\n${bits.join("\n")}`;
                    })();
                    return (
                      <button
                        key={t.ticker}
                        onClick={() => onTickerClick(t.ticker)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 3,
                          fontSize: 8, padding: "2px 5px", borderRadius: 3, cursor: "pointer",
                          fontFamily: "monospace", fontWeight: sel ? 800 : (ep.genuine || ep.setup || t.inDrawer) ? 700 : 500,
                          background: sel ? ARIA.cyan : ep.genuine ? `${ARIA.yellow}18` : t.inDrawer ? ARIA.glass : "transparent",
                          border: `1px solid ${borderC}`,
                          color: sel ? ARIA.bg : ep.genuine ? ARIA.yellow : t.inDrawer ? ARIA.text : ARIA.textMuted,
                        }}
                        title={tip}
                      >
                        <img src={ER_LOGO(t.ticker)} alt="" style={{ width: 12, height: 12, borderRadius: 2 }} onError={(e) => { e.target.style.display = "none"; }} />
                        {t.ticker}
                        {ep.setup && !ep.mv && <span style={{ fontSize: 8 }}>🎯</span>}
                        {ep.genuine && <span style={{ fontSize: 6, padding: "0 3px", borderRadius: 2, background: `${ARIA.yellow}26`, color: ARIA.yellow, border: `1px solid ${ARIA.yellow}66`, fontWeight: 800, lineHeight: "12px" }}>EP 4/4</span>}
                        {!ep.genuine && ep.mv && ep.magna != null && <span style={{ fontSize: 6, padding: "0 3px", borderRadius: 2, color: chg > 0 ? ARIA.green : ARIA.red, border: `1px solid ${ARIA.border}`, fontWeight: 700, lineHeight: "12px" }}>{ep.magna}/4</span>}
                        {badge && <span style={{ fontSize: 6, padding: "0 3px", borderRadius: 2, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, fontWeight: 700, lineHeight: "12px" }}>{badge.label}</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 7, color: "#4a4a5a", paddingLeft: 4, fontStyle: "italic" }}>— no earnings —</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drawer Themes — collapsible inline view of value-chain themes/subthemes ──
function DrawerThemes({ onTickerClick, chartTicker, stockMap, tickerStrengthMap, onLayerClick, activeFilterNames }) {
  const ARIA = useAriaTheme();
  const [expanded, setExpanded] = useState(() => localStorage.getItem("tp-drawer-themes-open") !== "0");
  const [openTheme, setOpenTheme] = useState(null);
  const scrollContainerRef = useRef(null);
  const pendingScrollTicker = useRef(null);
  // Track self-clicks so we don't auto-open the subtheme when a ticker is
  // clicked from within the drawer itself — only external clicks (Scan Watch)
  // should trigger auto-expand + scroll.
  const selfClickedTicker = useRef(null);

  useEffect(() => { localStorage.setItem("tp-drawer-themes-open", expanded ? "1" : "0"); }, [expanded]);

  // Clear suppress flag on ticker change (no longer auto-expands).
  useEffect(() => {
    if (_suppressChainScroll.skip) _suppressChainScroll.skip = false;
    if (selfClickedTicker.current === chartTicker) selfClickedTicker.current = null;
  }, [chartTicker]);

  // After the theme layers render, scroll to the layer containing the ticker
  useEffect(() => {
    if (!pendingScrollTicker.current || !scrollContainerRef.current) return;
    const ticker = pendingScrollTicker.current;
    const id = setTimeout(() => {
      const el = scrollContainerRef.current?.querySelector(`[data-layer-has~="${ticker}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      pendingScrollTicker.current = null;
    }, 50);
    return () => clearTimeout(id);
  }, [openTheme]);

  const avgRS = (tickers) => {
    const vals = tickers.map(tk => stockMap?.[tk]?.framework_score ?? stockMap?.[tk]?.rs_rank ?? null).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };

  // Live aggregation — pull live quotes only when drawer is open, prefer live
  // change/volume over stale pipeline snapshot
  const allDrawerTickers = useMemo(() => {
    const s = new Set();
    DRAWER_SUBTHEMES.forEach((sub) => sub.tickers.forEach((tk) => s.add(tk)));
    return [...s];
  }, []);
  const { quotes: liveQuotes } = useLiveQuotes(expanded ? allDrawerTickers : [], 30000);

  const layerAggs = (tickers) => {
    const chgs = [];
    const rvols = [];
    const strs = [];
    const crs = [];
    tickers.forEach((tk) => {
      const q = liveQuotes.get(tk);
      const s = stockMap?.[tk];
      const chg = q?.change != null ? q.change : (s?.change_pct ?? null);
      if (chg != null && !isNaN(chg)) chgs.push(chg);
      const liveVol = q?.volume;
      const avgVol = s?.avg_volume_raw || q?.avgVolume || 0;
      let rvol = null;
      if (liveVol && avgVol > 0) rvol = liveVol / avgVol;
      else if (s?.rvol != null && !isNaN(s.rvol) && s.rvol > 0) rvol = s.rvol;
      if (rvol != null) rvols.push(rvol);
      const str = tickerStrengthMap?.[tk];
      if (str != null && !isNaN(str)) strs.push(str);
      // CR% — uses unified helper with live quote + pipeline fallback + clamp
      const cr = computeCR(q, s);
      if (cr != null) crs.push(cr);
    });
    return {
      avgChg: chgs.length ? chgs.reduce((a, b) => a + b, 0) / chgs.length : null,
      avgRvol: rvols.length ? rvols.reduce((a, b) => a + b, 0) / rvols.length : null,
      avgStr: strs.length ? strs.reduce((a, b) => a + b, 0) / strs.length : null,
      avgCr: crs.length ? crs.reduce((a, b) => a + b, 0) / crs.length : null,
    };
  };
  const crColor = (v) =>
    v == null ? ARIA.textMuted : v >= 70 ? ARIA.green : v >= 40 ? ARIA.textDim : ARIA.red;
  const strColor = (v) =>
    v == null ? ARIA.textMuted : v >= 65 ? ARIA.green : v >= 50 ? ARIA.blue : v >= 35 ? ARIA.yellow : ARIA.textDim;

  const grouped = useMemo(() => {
    const themes = [];
    const seen = new Set();
    DRAWER_SUBTHEMES.forEach((s) => {
      if (!seen.has(s.themeId)) {
        seen.add(s.themeId);
        themes.push({ id: s.themeId, name: s.theme, layers: [] });
      }
      const t = themes.find((th) => th.id === s.themeId);
      t.layers.push({ layer: s.layer, tickers: s.tickers });
    });
    themes.forEach(t => {
      t.layers.sort((a, b) => avgRS(b.tickers) - avgRS(a.tickers));
    });
    themes.sort((a, b) => avgRS(b.layers.flatMap(l => l.tickers)) - avgRS(a.layers.flatMap(l => l.tickers)));
    return themes;
  }, [stockMap]);

  const totalTickers = DRAWER_TICKERS.size;

  return (
    <div style={{ borderBottom: `1px solid ${ARIA.border}`, display: "flex", flexDirection: "column", maxHeight: expanded ? 380 : "none", minHeight: 0 }}>
      {/* Header — matches SupercycleMap aesthetic */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "8px 12px",
          display: "flex", alignItems: "center", gap: 8,
          cursor: "pointer", userSelect: "none", flexShrink: 0,
          background: expanded
            ? "linear-gradient(90deg, rgba(34,211,238,0.06) 0%, rgba(108,213,232,0.04) 50%, rgba(168,85,247,0.05) 100%)"
            : "transparent",
          borderBottom: expanded ? `1px solid ${ARIA.border}` : "none",
        }}
      >
        <span style={{ fontSize: 11, color: ARIA.textMuted, transition: "transform 0.2s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>⛓</span>
          <span style={{
            fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.2,
            background: "linear-gradient(90deg, #22d3ee 0%, #a855f7 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>
            Value Chains
          </span>
        </div>
        <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace" }}>
          {grouped.length} themes · {totalTickers} tickers · live RS/RVol
        </span>
      </div>
      {expanded && (
        <div ref={scrollContainerRef} style={{ padding: "10px 12px 14px", overflowY: "auto", flex: 1, background: "linear-gradient(180deg, rgba(13,17,23,0.4) 0%, transparent 60%)" }}>
          {grouped.map((theme) => {
            const c = DRAWER_COLORS[theme.id] || { bg: "rgba(255,255,255,0.06)", border: ARIA.border, color: ARIA.textDim };
            const isOpen = openTheme === theme.id;
            const allTk = theme.layers.flatMap(l => l.tickers);
            const { avgChg: tAvgChg, avgRvol: tAvgRvol, avgStr: tAvgStr, avgCr: tAvgCr } = layerAggs(allTk);
            const tChgColor = tAvgChg == null ? ARIA.textMuted : tAvgChg > 0 ? "#10b981" : tAvgChg < 0 ? "#ef4444" : ARIA.textMuted;
            const isFiltered = activeFilterNames?.includes(theme.name);

            return (
              <div key={theme.id} className="tp-sc-card" style={{
                marginBottom: 7,
                background: isOpen
                  ? `linear-gradient(135deg, ${c.color}1a 0%, ${c.color}05 100%), linear-gradient(180deg, rgba(20,24,32,0.6) 0%, rgba(13,17,23,0.7) 100%)`
                  : "linear-gradient(180deg, rgba(20,24,32,0.4) 0%, rgba(13,17,23,0.5) 100%)",
                border: `1px solid ${isFiltered ? c.color : isOpen ? c.color + "55" : c.color + "22"}`,
                borderRadius: 6,
                position: "relative",
                boxShadow: isFiltered ? `0 0 12px ${c.color}55` : "none",
                overflow: "hidden",
              }}>
                {/* Tier-style left strip */}
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                  background: `linear-gradient(180deg, ${c.color} 0%, ${c.color}66 100%)`,
                  boxShadow: `0 0 6px ${c.color}66`,
                }} />

                {/* Theme header button */}
                <button
                  onClick={() => {
                    setOpenTheme(isOpen ? null : theme.id);
                    if (onLayerClick) onLayerClick(theme.name, allTk);
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, width: "100%",
                    padding: "7px 10px 7px 13px",
                    cursor: "pointer", fontFamily: "monospace", textAlign: "left",
                    background: "transparent", border: "none",
                    color: c.color,
                  }}
                >
                  <span style={{
                    fontSize: 10, color: ARIA.textMuted,
                    transition: "transform 0.15s",
                    transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                    display: "inline-block", width: 10,
                  }}>▶</span>
                  <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: c.color }}>
                    {theme.name}
                  </span>
                  <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace", fontWeight: 600 }}>
                    {theme.layers.length}L · {allTk.length}T
                  </span>

                  {/* Inline metric chips */}
                  <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4, alignItems: "center", fontWeight: 400 }}>
                    {tAvgStr != null && (
                      <span title="Avg strength score" style={{
                        fontSize: 9, fontFamily: "monospace", fontWeight: 800,
                        color: strColor(tAvgStr), padding: "1px 5px", borderRadius: 3,
                        background: `${strColor(tAvgStr)}1a`, border: `1px solid ${strColor(tAvgStr)}55`,
                      }}>
                        STR {Math.round(tAvgStr)}
                      </span>
                    )}
                    {tAvgChg != null && (
                      <span title="Avg % change" style={{
                        fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                        color: tChgColor, padding: "1px 5px", borderRadius: 3,
                        background: `${tChgColor}14`, border: `1px solid ${tChgColor}55`,
                      }}>
                        {(tAvgChg > 0 ? "+" : "") + tAvgChg.toFixed(1) + "%"}
                      </span>
                    )}
                    {tAvgRvol != null && (
                      <span title="Avg RVol" style={{
                        fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                        color: tAvgRvol >= 1.5 ? "#a855f7" : ARIA.textMuted,
                        padding: "1px 5px", borderRadius: 3,
                        background: tAvgRvol >= 1.5 ? "rgba(168,85,247,0.14)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${tAvgRvol >= 1.5 ? "rgba(168,85,247,0.5)" : ARIA.border}`,
                      }}>
                        {tAvgRvol.toFixed(1) + "x"}
                      </span>
                    )}
                    {tAvgCr != null && (
                      <span title="Avg closing range %" style={{
                        fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                        color: crColor(tAvgCr), padding: "1px 5px", borderRadius: 3,
                        background: `${crColor(tAvgCr)}14`, border: `1px solid ${crColor(tAvgCr)}55`,
                      }}>
                        CR {Math.round(tAvgCr)}%
                      </span>
                    )}
                  </span>
                </button>

                {/* Expanded layer body */}
                {isOpen && (
                  <div style={{ padding: "0 10px 9px 13px" }}>
                    {theme.layers.map((layer, li) => {
                      const { avgChg, avgRvol, avgStr, avgCr } = layerAggs(layer.tickers);
                      const chgColor = avgChg == null ? ARIA.textMuted : avgChg > 0 ? "#10b981" : avgChg < 0 ? "#ef4444" : ARIA.textMuted;
                      const isLayerFiltered = activeFilterNames?.includes(layer.layer);
                      return (
                      <div key={li} data-layer-has={layer.tickers.join(" ")} style={{
                        marginBottom: 6, paddingTop: li === 0 ? 0 : 6,
                        borderTop: li === 0 ? "none" : `1px dashed ${ARIA.border}`,
                      }}>
                        {/* Layer header */}
                        <div
                          onClick={() => onLayerClick && onLayerClick(layer.layer, layer.tickers)}
                          title={`Filter Scan to ${layer.layer}`}
                          style={{
                            fontSize: 9, color: ARIA.text, fontFamily: "monospace",
                            marginBottom: 4, fontWeight: 700,
                            display: "flex", alignItems: "center", gap: 5,
                            cursor: onLayerClick ? "pointer" : "default",
                            padding: "3px 6px", borderRadius: 3,
                            background: isLayerFiltered ? `${c.color}26` : "transparent",
                            border: `1px solid ${isLayerFiltered ? c.color : "transparent"}`,
                            textTransform: "uppercase", letterSpacing: 0.4,
                          }}
                        >
                          <span style={{ color: c.color, fontWeight: 800 }}>▸</span>
                          <span>{layer.layer}</span>
                          <span style={{ fontSize: 7, color: ARIA.textMuted, fontWeight: 600 }}>
                            ({layer.tickers.length})
                          </span>
                          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4, alignItems: "center" }}>
                            {avgStr != null && (
                              <span title="Avg strength score" style={{
                                fontSize: 9, fontFamily: "monospace", fontWeight: 800,
                                color: strColor(avgStr), padding: "1px 5px", borderRadius: 3,
                                background: `${strColor(avgStr)}1a`, border: `1px solid ${strColor(avgStr)}55`,
                              }}>
                                STR {Math.round(avgStr)}
                              </span>
                            )}
                            {avgChg != null && (
                              <span title="Avg % change" style={{
                                fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                                color: chgColor, padding: "1px 5px", borderRadius: 3,
                                background: `${chgColor}14`, border: `1px solid ${chgColor}55`,
                              }}>
                                {(avgChg > 0 ? "+" : "") + avgChg.toFixed(1) + "%"}
                              </span>
                            )}
                            {avgRvol != null && (
                              <span title="Avg RVol" style={{
                                fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                                color: avgRvol >= 1.5 ? "#a855f7" : ARIA.textMuted,
                                padding: "1px 5px", borderRadius: 3,
                                background: avgRvol >= 1.5 ? "rgba(168,85,247,0.14)" : "rgba(255,255,255,0.04)",
                                border: `1px solid ${avgRvol >= 1.5 ? "rgba(168,85,247,0.5)" : ARIA.border}`,
                              }}>
                                {avgRvol.toFixed(1) + "x"}
                              </span>
                            )}
                            {avgCr != null && (
                              <span title="Avg closing range %" style={{
                                fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                                color: crColor(avgCr), padding: "1px 5px", borderRadius: 3,
                                background: `${crColor(avgCr)}14`, border: `1px solid ${crColor(avgCr)}55`,
                              }}>
                                CR {Math.round(avgCr)}%
                              </span>
                            )}
                          </span>
                        </div>

                        {/* Ticker pills — match SupercycleMap styling */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingLeft: 4 }}>
                          {[...layer.tickers].sort((a, b) => (stockMap?.[b]?.framework_score ?? stockMap?.[b]?.rs_rank ?? 0) - (stockMap?.[a]?.framework_score ?? stockMap?.[a]?.rs_rank ?? 0)).map((tk) => {
                            const sel = chartTicker === tk;
                            const tkRs = stockMap?.[tk]?.framework_score ?? stockMap?.[tk]?.rs_rank;
                            return (
                              <button
                                key={tk}
                                onClick={() => { selfClickedTicker.current = tk; onTickerClick(tk); }}
                                title={`${tk}${tkRs != null ? ` · EIF ${Math.round(tkRs)}` : ""}`}
                                className="tp-sc-pill"
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  fontSize: 11, padding: "3px 8px",
                                  borderRadius: 4, cursor: "pointer",
                                  fontFamily: "monospace", fontWeight: sel ? 800 : 700,
                                  whiteSpace: "nowrap", lineHeight: 1.2,
                                  background: sel ? c.color : c.bg,
                                  border: `1px solid ${sel ? c.color : c.border}`,
                                  color: sel ? "#0a0a0e" : "#e8e8f4",
                                  boxShadow: sel ? `0 0 10px ${c.color}66` : "none",
                                }}
                              >
                                <img src={ER_LOGO(tk)} alt="" style={{ width: 11, height: 11, borderRadius: 2, opacity: 0.85 }} onError={(e) => { e.target.style.display = "none"; }} />
                                {tk}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScanWatch({ stocks, onTickerClick, chartTicker, stockMap, themeHealth, tickerStrengthMap, chainFilters, clearChainFilters, removeChainFilter, onLayerClick }) {
  const _spyRetSW = useSpyReturns(); // for the leader-divergence ⚠ (rank vs this-week RS)
  const spyWk = _spyRetSW?.["1w"] ?? null;
  const ARIA = useAriaTheme();
  const [swView, setSwView] = useState("watchlist"); // "scan" | "etf" | "watchlist" | "themes" | "subflow" | "leaderboard" | "chain"
  const [panelH, setPanelH] = useState(() => parseInt(localStorage.getItem("tp-scan-panel-h") || "600"));
  const panelHRef = useRef(600);
  useEffect(() => { panelHRef.current = panelH; }, [panelH]);
  const [chainId, setChainId] = useState("leaderboard");
  const [chainPrev, setChainPrev] = useState(null);
  // Force scan view when an external chain/layer filter is applied
  useEffect(() => { if (chainFilters?.length) setSwView("chain"); }, [chainFilters?.length]);
  const navigateChain = useCallback((id, fromSwitch = false) => {
    setChainPrev((prev) => fromSwitch ? null : (id !== chainId ? chainId : prev));
    setChainId(id);
  }, [chainId]);
  // Listen for tp-open-drawer events (e.g. from leaderboard iframe clicks) — pull into chain tab
  useEffect(() => {
    const onDrawer = (e) => { if (e?.detail) { setChainPrev(chainId); setChainId(e.detail); setSwView("chain"); } };
    const onMsg    = (e) => { if (e?.data?.type === "tp-open-drawer" && e.data.id) { setChainPrev(chainId); setChainId(e.data.id); setSwView("chain"); } };
    window.addEventListener("tp-open-drawer", onDrawer);
    window.addEventListener("message", onMsg);
    return () => { window.removeEventListener("tp-open-drawer", onDrawer); window.removeEventListener("message", onMsg); };
  }, [chainId]);
  // ── State: filters + sort + tags + preset ──────────────────────────────
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  // Owned-ticker set for the Hide Owned filter (reads the same cross-component
  // store as useOwnedTint / the Watchlist panel). Setters are used by the
  // +WL / +PF toolbar buttons.
  const [scanTableH, setScanTableH] = useState(() => parseInt(localStorage.getItem("tp-scan-height") || "480"));
  const scanTableHRef = useRef(480);
  useEffect(() => { scanTableHRef.current = scanTableH; }, [scanTableH]);
  const [portfolio, setPortfolio] = useLocalStorageList("themepulse-portfolio");
  const [watchlist, setWatchlist] = useLocalStorageList("themepulse-watchlist");
  const [focus] = useLocalStorageList("themepulse-focus");
  // Owned = portfolio ∪ focus ∪ watchlist; None = the complement.
  const ownedSet = useMemo(
    () => new Set([...portfolio, ...focus, ...watchlist]),
    [portfolio, focus, watchlist]
  );
  const inPF = chartTicker && portfolio.includes(chartTicker);
  const inWL = chartTicker && watchlist.includes(chartTicker);
  const togglePF = () => {
    if (!chartTicker) return;
    setPortfolio((cur) => inPF ? cur.filter((t) => t !== chartTicker) : [...cur, chartTicker]);
  };
  const toggleWL = () => {
    if (!chartTicker) return;
    setWatchlist((cur) => inWL ? cur.filter((t) => t !== chartTicker) : [...cur, chartTicker]);
  };
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [activePresets, setActivePresets] = useState(() => new Set());
  const [activeTags, setActiveTags] = useState(() => new Set());
  const [tagsOpen, setTagsOpen] = useState(() => { try { return localStorage.getItem("tp-tags-open") === "1"; } catch { return false; } });
  const [legendOpen, setLegendOpen] = useState(false);
  useEffect(() => {
    if (!legendOpen) return;
    const onDown = (e) => { if (!e.target.closest?.("[data-legend-pop]")) setLegendOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [legendOpen]);
  const [activeSubtheme, setActiveSubtheme] = useState(null);

  const updateFilter = useCallback((patch) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);

  // Toggle preset on/off — multi-select. Each active preset's `test` must
  // pass (AND semantics), so adding more narrows results.
  const togglePreset = useCallback((key) => {
    setActivePresets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Toggle a tag on/off. Also clears the active preset (mutex).
  const toggleTag = useCallback((tag) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  // Sort: left-click = primary, right-click (context menu) = secondary
  const setPrimarySort = useCallback((key) => {
    setSort((s) => {
      // If already primary, do nothing. If was secondary, swap.
      if (s.primary === key) return s;
      const newSecondary = s.secondary === key ? s.primary : s.secondary;
      return { primary: key, secondary: newSecondary };
    });
  }, []);
  const setSecondarySort = useCallback((key) => {
    setSort((s) => {
      if (s.primary === key) return s; // can't be same as primary
      return { ...s, secondary: key };
    });
  }, []);

  // ── Step 1: pre-filter universe with current toggles ────────────────────
  const candidates = useMemo(() => {
    if (!stocks || !stocks.length) return [];
    return stocks.filter((s) => {
      const ind = s.industry || "";
      if (filters.noBio && BIO_REIT_INDUSTRIES.has(ind)) return false;
      if (DELISTED.has(s.ticker)) return false;
      const adr = s.adr_pct || 0;
      if (filters.adrMin > 0 && adr < filters.adrMin) return false;
      if (filters.adrMax > 0 && filters.adrMax < 99 && adr > filters.adrMax)
        return false;
      const dvol = s.avg_dollar_vol_raw || 0;
      if (filters.minDvolM > 0 && dvol < filters.minDvolM * 1e6) return false;
      const price = s.price || s.close || 0;
      if (price < 1) return false;
      // Apply all active preset filters (AND — every active preset must pass)
      for (const pkey of activePresets) {
        const p = PRESETS[pkey];
        if (p && !p.test(s)) return false;
      }
      // Apply tag filters (all selected tags must match)
      // 9M is computed at row time using live volume — skip here.
      for (const tag of activeTags) {
        if (tag === "9M") continue;
        const pred = TAG_PREDICATES[tag];
        if (pred && !pred.test(s)) return false;
      }
      return true;
    });
  }, [stocks, filters, activePresets, activeTags]);

  // ── Step 2: rank candidates by stale chg_pct, take top 150 ──────────────
  // Live-enrichment universe — capped at 500 (FMP batch-quote single-call
  // limit). 'Infinity' on the final result slice means we show every row
  // that passes the filters, drawn from this 500-stock pre-filtered pool.
  const topCandidates = useMemo(() => {
    const sorted = candidates.slice().sort(
      (a, b) => Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0)
    );
    // Chain filter active: include every chain ticker found in candidates
    // (still capped at 500 — but chain layers are ~10–30 tickers so this is
    // fine in practice).
    const chainUnion = chainFilters?.length ? new Set(chainFilters.flatMap((f) => [...f.tickers])) : null;
    if (chainUnion?.size) {
      const chainHits = sorted.filter((s) => chainUnion.has(s.ticker));
      const others = sorted.filter((s) => !chainUnion.has(s.ticker));
      return [...chainHits, ...others].slice(0, 500);
    }
    return sorted.slice(0, 500);
  }, [candidates, chainFilters]);

  // ── Step 3: live enrichment ─────────────────────────────────────────────
  const candidateTickers = useMemo(
    () => [...topCandidates.map((s) => s.ticker), "SPY"],
    [topCandidates]
  );
  const { quotes: liveQuotes, updated: liveUpdated } = useLiveQuotes(
    candidateTickers,
    60000
  );

  // ── Step 4: merge static + live, apply post-enrichment filters, sort ────
  const rows = useMemo(() => {
    const out = [];
    const want9m = activeTags.has("9M");
    const spyQ = liveQuotes.get("SPY");
    const spyChg = spyQ?.change ?? 0;
    for (const s of topCandidates) {
      const q = liveQuotes.get(s.ticker);
      const price = q?.price ?? s.price ?? s.close ?? 0;
      const open = q?.open ?? null;
      const high = q?.high ?? null;
      const low = q?.low ?? null;
      const chg = q?.change ?? s.change_pct ?? 0;
      const liveVol = q?.volume ?? null;
      const avgVol = s.avg_volume_raw || q?.avgVolume || 0;
      const rvol =
        liveVol && avgVol > 0
          ? Math.round((liveVol / avgVol) * 100) / 100
          : s.rel_volume || 0;
      const chgOpen =
        open != null && open > 0
          ? Math.round(((price - open) / open) * 10000) / 100
          : null;
      // CR% (closing range): how close to high of day. (close-low)/(high-low)*100
      // Helper falls back to pipeline cr_pct + clamps to 0-100.
      const cr = computeCR(q, s);

      // Chg>0% filter — applies to either Open or Chg mode.
      // Auto-suspended while a quiet-day preset (T2 Tight / DE Ready) is
      // active: those setups are flat/tight closes BY DEFINITION, so the
      // green filter would hide half the very names the preset selects.
      const quietPreset = activePresets.has("tight") || activePresets.has("de");
      if (filters.greenOnly && !quietPreset) {
        const gainKey =
          filters.chgMode === "open" && chgOpen != null ? chgOpen : chg;
        if (gainKey <= 0) continue;
      }
      // Owned-view gate: "all" shows everything, "owned" keeps only
      // portfolio/watchlist tickers, "hide" drops them.
      if (filters.ownedView === "hide" && ownedSet.has(s.ticker)) continue;
      if (filters.ownedView === "owned" && !ownedSet.has(s.ticker)) continue;
      // Chg≥ slider
      if (filters.minChg > 0 && chg < filters.minChg) continue;
      // RV≥ slider
      if (filters.minRvol > 0 && rvol < filters.minRvol) continue;
      // EIF≥ slider
      const eifVal = s.framework_score ?? s.rs_rank ?? 0;
      if (filters.minEif > 0 && eifVal < filters.minEif) continue;
      // 9M flag: today's vol >= 8.9M shares but avg < 8.9M (unusual institutional).
      // Computed for EVERY row so the badge can render even when the 9M
      // tag filter isn't active. The filter still drops non-matching rows
      // when toggled on.
      const is9m =
        !!(liveVol && liveVol >= 8_900_000 && avgVol < 8_900_000);
      if (want9m && !is9m) continue;

      // MAGNA score: 0-100 composite of M(assive EPS accel), G(ap up), A(ccel in sales).
      // Each component is 0-33, capped and scaled so the filter gate (≥60) requires
      // strength in at least two of three dimensions.
      const epsY = s.eps_yoy || 0;
      const salY = s.sales_yoy || 0;
      const gapPct = chg;
      const mScore = Math.min(33, Math.max(0, epsY > 0 ? (epsY / 100) * 33 : 0));
      const aScore = Math.min(33, Math.max(0, salY > 0 ? (salY / 100) * 33 : 0));
      const gScore = Math.min(34, Math.max(0, gapPct > 0 ? (gapPct / 15) * 34 : 0));
      const magna = Math.round(mScore + aScore + gScore);

      out.push({
        ticker: s.ticker,
        company: s.company || "",
        price,
        chg,
        chgOpen,
        rvol,
        cr,
        accel: s.accel || 0,
        magna,
        qmagScore: s.qmag_score || 0,
        adr: s.adr_pct || 0,
        rs: s.framework_score ?? s.rs_rank ?? 0,
        rsRank: s.rs_rank ?? null,
        wkRs: s.return_1w != null ? +(s.return_1w - (spyWk ?? 0)).toFixed(2) : null,
        grade: s.grade || "",
        industry: s.industry || "",
        subtheme:
          (s.themes && s.themes[0] && s.themes[0].subtheme) ||
          s.industry ||
          "",
        liveVol: liveVol || 0,
        is9m,
        strScore: tickerStrengthMap?.[s.ticker] ?? null,
        alpha: Math.round((chg - spyChg) * 100) / 100,
      });
    }
    // Sort: primary DESC, secondary DESC tiebreaker. String values use locale.
    const cmp = (a, b, key) => {
      const va = rowSortValue(a, key);
      const vb = rowSortValue(b, key);
      if (typeof va === "string" || typeof vb === "string") {
        return String(vb).localeCompare(String(va));
      }
      return (vb || 0) - (va || 0);
    };
    out.sort((a, b) => {
      const c = cmp(a, b, sort.primary);
      if (c !== 0) return c;
      if (sort.secondary && sort.secondary !== sort.primary) {
        return cmp(a, b, sort.secondary);
      }
      return 0;
    });
    // Subtheme drill-down filter
    let filtered = activeSubtheme
      ? out.filter((r) => r.subtheme === activeSubtheme)
      : out;
    // Chain/layer filter from DrawerThemes click
    if (chainFilters?.length) {
      const union = new Set(chainFilters.flatMap((f) => [...f.tickers]));
      filtered = filtered.filter((r) => union.has(r.ticker));
    }
    return filtered;
  }, [topCandidates, liveQuotes, filters, sort, activeTags, activeSubtheme, ownedSet, chainFilters, activePresets, spyWk]);

  // ── Render ──────────────────────────────────────────────────────────────
  const colorChg = (v) =>
    v == null || Math.abs(v) <= 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;

  const fmtPct = (v) =>
    v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";

  const fmtVol = (v) => {
    if (!v) return "—";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return String(v);
  };

  const headerCell = {
    padding: "4px 6px",
    fontSize: 8,
    fontWeight: 700,
    color: ARIA.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    textAlign: "right",
    borderBottom: `1px solid ${ARIA.border}`,
    whiteSpace: "nowrap",
  };
  const bodyCell = {
    padding: "3px 6px",
    fontSize: 10,
    color: ARIA.text,
    textAlign: "right",
    borderBottom: `1px solid ${ARIA.border}`,
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        background: ARIA.bgCard,
        border: `1px solid ${ARIA.border}`,
        borderRadius: 14,
        marginBottom: 8,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: panelH,
        position: "relative", // anchor for the legend popover
      }}
    >
      {/* Drag handle — resize panel height */}
      <div
        title="Drag to resize"
        onMouseDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startH = panelHRef.current;
          const onMove = (ev) => setPanelH(Math.max(200, startH + ev.clientY - startY));
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            localStorage.setItem("tp-scan-panel-h", String(panelHRef.current));
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
        style={{ height: 6, cursor: "ns-resize", background: ARIA.border, flexShrink: 0, opacity: 0.5, borderRadius: "3px 3px 0 0" }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "#22d3ee88"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.background = ARIA.border; }}
      />
      {/* Panel header */}
      <div
        style={{
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderBottom: `1px solid ${ARIA.border}`,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: ARIA.text,
          }}
        >
          Scan Watch
        </span>
        <span style={{ fontSize: 8, color: ARIA.textMuted }}>
          ({rows.length})
        </span>
        <div style={{ display: "flex", gap: 2, marginLeft: 6 }}>
          <button onClick={() => setSwView(swView === "watchlist" ? "scan" : "watchlist")} style={pillStyle(swView === "watchlist", ARIA.green)}>WL</button>
          <button onClick={() => setSwView(swView === "chain" ? "scan" : "chain")} style={pillStyle(swView === "chain", "#6cd5e8")}>Chain</button>
        </div>
        <div
          style={{
            marginLeft: "auto",
            fontSize: 8,
            color: ARIA.textMuted,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {liveUpdated
            ? `Live · ${liveUpdated.toLocaleTimeString()}`
            : <span className="tp-shimmer" style={{ display: "inline-block", width: 96, height: 8, borderRadius: 4, verticalAlign: "middle" }} title="Loading live quotes…" />}
          <button data-legend-pop onClick={() => setLegendOpen((v) => !v)} title="Color & glyph legend"
            style={{ fontSize: 8, fontWeight: 800, width: 14, height: 14, lineHeight: "12px", padding: 0, borderRadius: "50%", cursor: "pointer", fontFamily: "monospace",
              border: `1px solid ${legendOpen ? ARIA.cyan : ARIA.border}`, color: legendOpen ? ARIA.cyan : ARIA.textMuted, background: "transparent" }}>?</button>
        </div>
      </div>

      {/* Color & glyph legend — the dashboard's visual language in one place */}
      {legendOpen && (
        <div data-legend-pop style={{ position: "absolute", top: 26, right: 8, zIndex: 40, width: 300, background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 6, boxShadow: "0 6px 24px rgba(0,0,0,0.5)", padding: "8px 10px", fontFamily: "monospace", fontSize: 8.5, lineHeight: 1.7 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: ARIA.text, textTransform: "uppercase", letterSpacing: 0.5 }}>Legend</span>
            <button onClick={() => setLegendOpen(false)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: ARIA.textMuted, cursor: "pointer", fontSize: 11, padding: 0 }}>×</button>
          </div>
          <div style={{ fontSize: 7.5, fontWeight: 800, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.4, margin: "3px 0 1px" }}>Row tints (your lists)</div>
          <div><span style={{ color: ARIA.yellow }}>■</span> Portfolio · <span style={{ color: ARIA.cyan }}>■</span> ⚡ Focus · <span style={{ color: ARIA.green }}>■</span> Watchlist</div>
          <div style={{ fontSize: 7.5, fontWeight: 800, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 1px" }}>Ticker glyphs</div>
          <div><span style={{ color: ARIA.green, fontWeight: 800 }}>↗</span> fresh inflection (day pace ≫ its week)</div>
          <div><span style={{ color: "#fbbf24", fontWeight: 800 }}>⚠Nd</span> earnings in N days · <span style={{ color: "#fbbf24", fontWeight: 800 }}>α</span> chain-only (high-alpha, below scan filters)</div>
          <div><span style={{ color: "#f472b6", fontWeight: 800 }}>T2</span> 2-days-tight (closes ≤1% apart + narrowing range) · <span style={{ color: "#fb923c", fontWeight: 800 }}>DE</span> delayed-entry-ready gapper (entry = trigger break)</div>
          <div style={{ fontSize: 7.5, fontWeight: 800, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 1px" }}>Setup badges (live)</div>
          <div><span style={{ color: "#a855f7", fontWeight: 800 }}>BO</span> breakout entry · <span style={{ color: "#34d399", fontWeight: 800 }}>ACC</span> accumulation · <span style={{ color: "#22d3ee", fontWeight: 800 }}>EP</span> post-ER pivot</div>
          <div><span style={{ color: "#0ea5e9", fontWeight: 800 }}>RST</span> 🪃 leader reset at 20dma · <span style={{ color: "#fbbf24", fontWeight: 800 }}>VCP</span> volume dry-up · <span style={{ color: "#ef4444", fontWeight: 800 }}>DIST</span> distribution (exit)</div>
          <div style={{ fontSize: 7.5, fontWeight: 800, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 1px" }}>Layer name colors (RRG quadrant)</div>
          <div><span style={{ color: ARIA.green }}>■</span> Leading · <span style={{ color: ARIA.blue }}>■</span> Improving · <span style={{ color: ARIA.yellow }}>■</span> Weakening · <span style={{ color: ARIA.red }}>■</span> Lagging</div>
          <div style={{ fontSize: 7.5, fontWeight: 800, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 1px" }}>EIF cell</div>
          <div>dotted underline = EIF leader — click for the score's reasoning</div>
        </div>
      )}

      {/* ETF Scan view */}
      {swView === "etf" && <ETFScanTable onTickerClick={onTickerClick} />}

      {swView === "leaders" && <LeadersPanel stockMap={stockMap} onTickerClick={onTickerClick} />}

      {/* Filter rows — visible in Scan and Chain views */}
      {(swView === "scan" || swView === "chain") && <>

      {/* Preset row */}
      <div
        style={{
          padding: "4px 12px",
          display: "flex",
          flexWrap: "wrap",
          gap: 3,
          alignItems: "center",
          borderBottom: `1px solid ${ARIA.border}`,
          fontFamily: "monospace",
        }}
      >
        {["reset", "combo", "1w20", "gap4", "tight", "strongest", "accum", "de", "tt8"].map((key) => [key, PRESETS[key]]).map(([key, p]) => {
          const on = activePresets.has(key);
          return (
            <button
              key={key}
              onClick={() => togglePreset(key)}
              title={p.desc}
              style={{
                fontSize: 7,
                padding: "1px 5px",
                borderRadius: 3,
                cursor: "pointer",
                fontFamily: "monospace",
                fontWeight: on ? 700 : 400,
                border: `1px solid ${on ? p.color : ARIA.border}`,
                color: on ? p.color : ARIA.textMuted,
                background: on ? `${p.color}26` : "transparent",
              }}
            >
              {p.label}
            </button>
          );
        })}
        {/* 9M promoted to the preset row (2026-07-15 tag audit: +0.77% +10d
            alpha, ~3× baseline, only 27% Combo overlap — the one row tag with
            unique yield). Toggles the existing live-volume tag mechanism. */}
        {(() => {
          const on = activeTags.has("9M");
          return (
            <button
              onClick={() => toggleTag("9M")}
              title="9M — today's volume ≥ 8.9M shares on a stock that averages under 8.9M: an institutional-footprint day. Backtest (2026-07-15): +0.77% +10d alpha vs +0.26% baseline, mostly unique vs the other presets. Live-volume based — populates during RTH."
              style={{
                fontSize: 7, padding: "1px 5px", borderRadius: 3, cursor: "pointer",
                fontFamily: "monospace", fontWeight: on ? 700 : 400,
                border: `1px solid ${on ? ARIA.yellow : ARIA.border}`,
                color: on ? ARIA.yellow : ARIA.textMuted,
                background: on ? `${ARIA.yellow}26` : "transparent",
              }}
            >
              9M
            </button>
          );
        })()}
        {/* divider between momentum/gap presets and tag filters (one row now) */}
        <span style={{ width: 1, alignSelf: "stretch", background: ARIA.border, margin: "0 4px" }} />
        {/* Tag filters live behind an expander — occasional-use vs the everyday
            presets. Auto-expanded while any tag is active so state stays visible. */}
        <button onClick={() => setTagsOpen((v) => { const n = !v; try { localStorage.setItem("tp-tags-open", n ? "1" : "0"); } catch {} return n; })}
          title={tagsOpen ? "Hide tag filters" : "Show tag filters (33 / W / L / E / CS / ZM / QM / 9M / MAG)"}
          style={{ fontSize: 7, padding: "1px 5px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontWeight: 700,
            border: `1px solid ${(tagsOpen || activeTags.size > 0) ? ARIA.green : ARIA.border}`,
            color: (tagsOpen || activeTags.size > 0) ? ARIA.green : ARIA.textMuted, background: "transparent" }}>
          {tagsOpen || activeTags.size > 0 ? "⋯ tags ▾" : `⋯ tags${activeTags.size ? ` (${activeTags.size})` : ""}`}
        </button>
        {(tagsOpen || activeTags.size > 0) && Object.entries(TAG_PREDICATES).map(([key, t]) => {
          const on = activeTags.has(key);
          const accent = key === "9M" || key === "33" ? ARIA.yellow : ARIA.green;
          return (
            <button key={key} onClick={() => toggleTag(key)} title={t.desc} style={pillStyle(on, accent)}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Active preset description box(es) */}
      {activePresets.size > 0 && (
        <div
          style={{
            padding: "5px 12px",
            borderBottom: `1px solid ${ARIA.border}`,
            background: ARIA.bgRow,
            fontSize: 9,
            color: ARIA.textDim,
            lineHeight: 1.5,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {[...activePresets].map((pkey) => {
            const p = PRESETS[pkey];
            if (!p) return null;
            return (
              <div key={pkey}>
                <b style={{ color: p.color }}>{p.label}</b> — {p.desc}
              </div>
            );
          })}
        </div>
      )}

      {/* Active tag description box */}
      {activeTags.size > 0 && (
        <div style={{
          padding: "5px 12px",
          borderBottom: `1px solid ${ARIA.border}`,
          background: ARIA.bgRow,
          fontSize: 9,
          color: ARIA.textDim,
          lineHeight: 1.6,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}>
          {[...activeTags].map((key) => {
            const t = TAG_PREDICATES[key];
            if (!t) return null;
            return (
              <div key={key}>
                <b style={{ color: ARIA.green }}>{t.label}</b> — {t.desc}
              </div>
            );
          })}
        </div>
      )}

      {/* Toggle/input filter row — single row; scrolls horizontally if too narrow */}
      <div
        style={{
          padding: "4px 12px",
          display: "flex",
          flexWrap: "nowrap",
          gap: 4,
          alignItems: "center",
          borderBottom: `1px solid ${ARIA.border}`,
          fontFamily: "monospace",
          overflowX: "auto",
        }}
      >
        <button
          onClick={() => updateFilter({ noBio: !filters.noBio })}
          style={pillStyle(filters.noBio, ARIA.green)}
        >
          NoBio
        </button>
        <span style={{ color: ARIA.border, margin: "0 2px" }}>|</span>
        <span style={{ fontSize: 7, color: ARIA.textMuted }}>ADR</span>
        <input
          type="number"
          value={filters.adrMin}
          onChange={(e) =>
            updateFilter({ adrMin: parseFloat(e.target.value) || 0 })
          }
          style={numInputStyle}
        />
        <span style={{ fontSize: 7, color: ARIA.textMuted }}>–</span>
        <input
          type="number"
          value={filters.adrMax}
          onChange={(e) =>
            updateFilter({ adrMax: parseFloat(e.target.value) || 99 })
          }
          style={numInputStyle}
        />
        <span style={{ color: ARIA.border, margin: "0 2px" }}>|</span>
        <button
          onClick={() => updateFilter({ greenOnly: !filters.greenOnly })}
          style={pillStyle(filters.greenOnly, ARIA.green)}
        >
          Chg&gt;0%
        </button>
        <button
          onClick={() => updateFilter({ ownedView: "all" })}
          style={pillStyle(filters.ownedView === "all", ARIA.textDim)}
          title="Show every ticker"
        >
          All
        </button>
        <button
          onClick={() => updateFilter({ ownedView: "owned" })}
          style={pillStyle(filters.ownedView === "owned", ARIA.yellow)}
          title="Show only tickers in portfolio, focus, or watchlist"
        >
          Owned
        </button>
        <button
          onClick={() => updateFilter({ ownedView: "hide" })}
          style={pillStyle(filters.ownedView === "hide", ARIA.yellow)}
          title="Show only tickers NOT in portfolio, focus, or watchlist"
        >
          None
        </button>
        <span style={{ fontSize: 7, color: ARIA.textMuted }}>Chg≥</span>
        <input
          type="range"
          min={0}
          max={20}
          step={1}
          value={filters.minChg}
          onChange={(e) =>
            updateFilter({ minChg: parseFloat(e.target.value) })
          }
          style={{ width: 50, accentColor: ARIA.green, cursor: "pointer" }}
        />
        <span
          style={{
            fontSize: 8,
            color: ARIA.green,
            minWidth: 22,
          }}
        >
          {filters.minChg}%
        </span>
        <span style={{ color: ARIA.border, margin: "0 1px" }}>|</span>
        <span style={{ fontSize: 7, color: ARIA.textMuted }}>$Vol≥</span>
        <input
          type="number"
          value={filters.minDvolM}
          onChange={(e) =>
            updateFilter({ minDvolM: parseFloat(e.target.value) || 0 })
          }
          style={{ ...numInputStyle, width: 36 }}
        />
        <span style={{ fontSize: 7, color: ARIA.textMuted }}>M</span>
      </div>

      </>}

      {/* Scan-only: sort, +WL/+PF, active chips, results table */}
      {swView === "scan" && <>

      {/* +WL / +PF row — acts on the currently-charted ticker */}
      {chartTicker && (
        <div style={{
          padding: "3px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderBottom: `1px solid ${ARIA.border}`,
          fontFamily: "monospace",
        }}>
          <span style={{ fontSize: 7, color: ARIA.textMuted, textTransform: "uppercase" }}>
            {chartTicker}
          </span>
          <button
            onClick={toggleWL}
            title={inWL ? `Remove ${chartTicker} from watchlist` : `Add ${chartTicker} to watchlist`}
            style={{
              padding: "2px 8px", fontSize: 9, fontWeight: 700, fontFamily: "monospace",
              cursor: "pointer", borderRadius: 3,
              background: inWL ? "#0d2218" : "transparent",
              border: `1px solid ${inWL ? "#2c5e3e" : ARIA.border}`,
              color: inWL ? "#7cb342" : ARIA.textMuted,
            }}
          >
            {inWL ? `✓ WL` : `+ WL`}
          </button>
          <button
            onClick={togglePF}
            title={inPF ? `Remove ${chartTicker} from portfolio` : `Add ${chartTicker} to portfolio`}
            style={{
              padding: "2px 8px", fontSize: 9, fontWeight: 700, fontFamily: "monospace",
              cursor: "pointer", borderRadius: 3,
              background: inPF ? "#3a2a08" : "transparent",
              border: `1px solid ${inPF ? "#a07a1f" : ARIA.border}`,
              color: inPF ? "#ffd700" : ARIA.textMuted,
              boxShadow: inPF ? "0 0 4px rgba(255, 215, 0, 0.3)" : undefined,
            }}
          >
            {inPF ? `✓ PF` : `+ PF`}
          </button>
        </div>
      )}

      {/* Sort row */}
      <div
        style={{
          padding: "3px 12px",
          display: "flex",
          alignItems: "center",
          gap: 3,
          borderBottom: `1px solid ${ARIA.border}`,
          fontFamily: "monospace",
        }}
      >
        <span
          style={{
            fontSize: 7,
            color: ARIA.textMuted,
            textTransform: "uppercase",
          }}
        >
          Sort
        </span>
        {SORT_BUTTONS.map((b) => {
          const isPrimary = sort.primary === b.key;
          const isSecondary = sort.secondary === b.key;
          const color = isPrimary
            ? ARIA.green
            : isSecondary
            ? ARIA.cyan
            : ARIA.textMuted;
          const bg = isPrimary
            ? ARIA.glowGreen
            : isSecondary
            ? "rgba(34,211,238,0.1)"
            : "transparent";
          return (
            <button
              key={b.key}
              onClick={() => setPrimarySort(b.key)}
              onContextMenu={(e) => {
                e.preventDefault();
                setSecondarySort(b.key);
              }}
              title="Click = primary sort, right-click = secondary"
              style={{
                fontSize: 7,
                padding: "1px 4px",
                borderRadius: 3,
                cursor: "pointer",
                fontFamily: "monospace",
                border: `1px solid ${color}`,
                color,
                background: bg,
              }}
            >
              {b.label}
              {isPrimary && (
                <sup style={{ fontSize: 5, color: ARIA.green }}>1</sup>
              )}
              {isSecondary && (
                <sup style={{ fontSize: 5, color: ARIA.cyan }}>2</sup>
              )}
            </button>
          );
        })}
      </div>

      {/* Active chain/layer filter chips */}
      {chainFilters?.length > 0 && (
        <div style={{ padding: "3px 12px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", borderBottom: `1px solid ${ARIA.border}`, fontFamily: "monospace" }}>
          <span style={{ fontSize: 7, color: ARIA.textMuted }}>CHAIN</span>
          {chainFilters.map((f) => (
            <span key={f.name} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
              <span style={{ fontSize: 8, fontWeight: 700, color: ARIA.purple, border: `1px solid ${ARIA.purple}`, background: `${ARIA.purple}20`, padding: "1px 6px", borderRadius: 3 }}>
                {f.name} ({f.tickers.size})
              </span>
              <button onClick={() => removeChainFilter(f.name)} title="Remove filter" style={{ fontSize: 10, background: "transparent", border: "none", color: ARIA.textMuted, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>
            </span>
          ))}
          {chainFilters.length > 1 && (
            <button onClick={clearChainFilters} title="Clear all chain filters" style={{ fontSize: 7, background: "transparent", border: `1px solid ${ARIA.border}`, color: ARIA.textMuted, cursor: "pointer", padding: "1px 5px", borderRadius: 3, fontFamily: "monospace" }}>clear all</button>
          )}
        </div>
      )}

      {/* Active subtheme drill-down chip */}
      {activeSubtheme && (
        <div
          style={{
            padding: "3px 12px",
            display: "flex",
            alignItems: "center",
            gap: 4,
            borderBottom: `1px solid ${ARIA.border}`,
            fontFamily: "monospace",
          }}
        >
          <span style={{ fontSize: 7, color: ARIA.textMuted }}>SUBTHEME</span>
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: ARIA.cyan,
              border: `1px solid ${ARIA.cyan}`,
              background: `${ARIA.cyan}20`,
              padding: "1px 6px",
              borderRadius: 3,
            }}
          >
            {activeSubtheme}
          </span>
          <button
            onClick={() => setActiveSubtheme(null)}
            style={{
              fontSize: 10,
              background: "transparent",
              border: "none",
              color: ARIA.textMuted,
              cursor: "pointer",
              padding: "0 2px",
              lineHeight: 1,
            }}
            title="Clear subtheme filter"
          >
            ×
          </button>
          <span style={{ fontSize: 7, color: ARIA.textMuted, marginLeft: "auto" }}>
            ({rows.length})
          </span>
        </div>
      )}

      {/* Results table */}
      <div
        style={{
          height: scanTableH,
          overflowY: "auto",
          overflowX: "auto",
          fontFamily: "monospace",
        }}
      >
        <ScanWatchTable
          rows={rows}
          sort={sort}
          onSort={setPrimarySort}
          onSort2={setSecondarySort}
          chgMode={filters.chgMode}
          onTickerClick={onTickerClick}
          onSubthemeClick={setActiveSubtheme}
          onChainClick={(id) => { setSwView("chain"); navigateChain(id); }}
        />
      </div>
      {/* Drag handle */}
      <div
        title="Drag to resize"
        onMouseDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startH = scanTableHRef.current;
          const onMove = (ev) => setScanTableH(Math.max(120, startH + ev.clientY - startY));
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            localStorage.setItem("tp-scan-height", String(scanTableHRef.current));
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
        style={{ height: 6, cursor: "ns-resize", background: ARIA.border, margin: "2px 0", borderRadius: 3, opacity: 0.6 }}
      />
      </>}

      {swView === "watchlist" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <ErrorBoundary>
            <Watchlist stockMap={stockMap} onTickerClick={onTickerClick} tickerStrengthMap={tickerStrengthMap} onChainClick={(id) => { setSwView("chain"); navigateChain(id); }} />
          </ErrorBoundary>
        </div>
      )}

      {swView === "themes" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <ErrorBoundary>
            <SubthemePerformance stockMap={stockMap} themeHealth={themeHealth} onTickerClick={onTickerClick} />
          </ErrorBoundary>
        </div>
      )}

      {swView === "subflow" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", zoom: 0.7, overflowX: "auto" }}>
          <ErrorBoundary>
            <SubthemeRotationAutoRefresh
              dataUrl="/dashboard_data.json"
              historyUrl="/subtheme_history.json"
              portfolio={portfolio}
              watchlist={watchlist}
              onTickerClick={onTickerClick}
            />
          </ErrorBoundary>
        </div>
      )}

      {swView === "leaderboard" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <iframe
            src="/theme-leaderboard.html"
            title="Subtheme Leaderboard"
            style={{ flex: 1, width: "100%", border: "none", background: "#0a0a14" }}
          />
        </div>
      )}

      {swView === "chain" && (
        <ChainView
          stockMap={stockMap}
          tickerStrengthMap={tickerStrengthMap}
          onLayerClick={onLayerClick}
          onTickerClick={onTickerClick}
          chartTicker={chartTicker}
          activeFilterNames={chainFilters?.map((f) => f.name) ?? []}
          scanRows={rows}
          filters={filters}
          activePresets={activePresets}
          activeTags={activeTags}
        />
      )}

    </div>
  );
}

// ── ChainView: switchable Layers / Tickers view of value-chain data.
function ChainView({ stockMap, tickerStrengthMap, onLayerClick, onTickerClick, chartTicker, activeFilterNames, scanRows, filters, activePresets, activeTags }) {
  const ARIA = useAriaTheme();
  const containerRef = useRef(null);
  // Auto-focus the table so up/down arrows work without a click first
  useEffect(() => {
    const id = setTimeout(() => {
      const focusable = containerRef.current?.querySelector('[tabindex="0"]');
      if (focusable && document.activeElement !== focusable) focusable.focus({ preventScroll: true });
    }, 50);
    return () => clearTimeout(id);
  }, []);
  // Filter: Chg% > 0 — defaults ON. Stored as "1"/"0" in localStorage.
  const [posOnly, setPosOnly] = useState(() => localStorage.getItem("tp-chain-pos-only") !== "0");
  useEffect(() => { localStorage.setItem("tp-chain-pos-only", posOnly ? "1" : "0"); }, [posOnly]);
  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ChainTickerTable
        stockMap={stockMap}
        tickerStrengthMap={tickerStrengthMap}
        onTickerClick={onTickerClick}
        onLayerClick={onLayerClick}
        chartTicker={chartTicker}
        posOnly={posOnly}
        setPosOnly={setPosOnly}
        scanRows={scanRows}
        scanFilters={filters}
        activeFilterNames={activeFilterNames}
        activePresets={activePresets}
        activeTags={activeTags}
      />
    </div>
  );
}

// ── useZVR: polls /api/zvr for Zanger Volume Ratio (true intraday comparison) ──
// Returns Map<ticker, zvrPct> where zvrPct is an integer % (e.g. 245 = 2.45x avg).
// Polls every 60s during RTH, 5min outside. Only fetches when tickers array is non-empty.
// ── Intraday cumulative volume profile (U-shaped) ──
// Expected fraction of a typical day's volume traded N minutes after the
// open. Linear elapsed time badly overstates early-session ZVR (the first
// hour carries ~21% of daily volume in 15% of session time). Used by the
// linear ZVR fallback; the API ZVR is inherently profile-aware.
const VOL_PROFILE = [[0, 0], [5, 0.04], [15, 0.08], [30, 0.13], [60, 0.21], [90, 0.27], [120, 0.33], [150, 0.38], [180, 0.43], [210, 0.48], [240, 0.53], [270, 0.59], [300, 0.66], [330, 0.74], [360, 0.84], [375, 0.91], [390, 1]];
function sessionVolFraction(minsSinceOpen) {
  const m = Math.max(0, Math.min(390, minsSinceOpen));
  for (let i = 1; i < VOL_PROFILE.length; i++) {
    const [m1, f1] = VOL_PROFILE[i - 1], [m2, f2] = VOL_PROFILE[i];
    if (m <= m2) return f1 + (f2 - f1) * (m - m1) / (m2 - m1);
  }
  return 1;
}

// Rolling intraday ZVR history per ticker (session-scoped, last ~40 polls)
const _zvrHistory = new Map();
// Rolling intraday CR% history per ticker (session-scoped, ~last 40 samples)
const _crHistory = new Map();
// Intraday CR-persistence accumulator: per ticker, how many session samples
// closed in the top 1/3 of range (cr ≥ 67) vs total. Whole-session, reset daily.
const _crPersist = new Map(); // ticker -> { n, strong }
let _crPersistDay = null;

function useZVR(tickers) {
  // DEPRECATED as a network hook (FMP data budget): /api/zvr's per-ticker
  // 5-min-bar fetching was the main driver of the 150GB/mo overage, and FMP's
  // batch-quote lacks avgVolume so a cheap server-side version isn't possible.
  // Every consumer already computes profile-aware ZVR locally via calcZVR
  // (live volume ÷ avg_volume_raw × session U-profile) — this hook now just
  // returns empty maps so those fallbacks take over, keeping call sites and
  // the rolling _zvrHistory sampling untouched.
  void tickers;
  return { cur: _EMPTY_ZVR_MAP, prev: _EMPTY_ZVR_MAP, history: _zvrHistory };
}
const _EMPTY_ZVR_MAP = new Map();

// ── ChainTickerTable: every ticker that lives in any value chain, with live
// per-ticker metrics (Chg%, RV, RS, Str, CR%, ROC², $Vol, Mcap, ER days).
// Sortable. Click ticker → load chart (no auto value-chain expand/scroll).
function ChainTickerTable({ stockMap, tickerStrengthMap, onTickerClick, onLayerClick, chartTicker, posOnly, setPosOnly, scanRows, scanFilters, activeFilterNames, activePresets, activeTags }) {
  const ARIA = useAriaTheme();
  const ownedTint = useOwnedTint();
  const eifReasons = useEifReasons();
  const [starPopover, setStarPopover] = useState(null); // { ticker, x, y, row }
  useEffect(() => {
    if (!starPopover) return;
    const onDown = (e) => { if (!e.target.closest?.("[data-star-pop]")) setStarPopover(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [starPopover]);
  // Per-curated-theme stats (avg EIF, avg 3M return) for Jensen mode classification.
  const groupStats = useMemo(() => {
    const by = new Map();
    DRAWER_SUBTHEMES.forEach((sub) => {
      const e = by.get(sub.themeId) || { eifs: [], rets: [] };
      sub.tickers.forEach((t) => {
        const s = stockMap?.[t];
        if (s?.framework_score != null) e.eifs.push(s.framework_score);
        if (s?.return_3m != null) e.rets.push(s.return_3m);
      });
      by.set(sub.themeId, e);
    });
    const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const out = {};
    for (const [tid, e] of by) out[tid] = { avgEif: avg(e.eifs), avgRet: avg(e.rets) };
    return out;
  }, [stockMap]);
  // Classify a row into Jensen modes (Leader / Catch-Up / Dip).
  const classifyModes = (row) => {
    if (!row) return [];
    const s = stockMap?.[row.ticker];
    const out = [];
    const su = chainSetup(row);
    if (su?.key === "ACC" || su?.key === "EP" || (row.zvr != null && row.zvr >= 130) || (row.cr != null && row.cr >= 70 && row.chg > 0)) out.push("LEADER");
    const g = groupStats[row.themeId];
    const thrust = (row.zvr != null && row.zvr >= 130) || (row.cr != null && row.cr >= 60 && row.chg > 0);
    if (g && g.avgEif >= 55 && g.avgRet != null && s?.return_3m != null && s.return_3m < g.avgRet - 10 && thrust) out.push("CATCH-UP");
    const band = dipBand(s?.price ?? s?.close);
    const off = s?.off_52w_high != null ? Math.abs(s.off_52w_high) : null;
    if (band && off != null && off >= band[0] && off <= band[1] * 1.15 && (row.chg == null || row.chg > -4)) out.push("DIP");
    return out;
  };
  const [portfolio] = useLocalStorageList("themepulse-portfolio");
  const [watchlist] = useLocalStorageList("themepulse-watchlist");
  const ownedSet = useMemo(() => new Set([...portfolio, ...watchlist]), [portfolio, watchlist]);
  const [pfOnly, setPfOnly] = useState(() => { try { return localStorage.getItem("tp-chain-pf-only") === "1"; } catch { return false; } });
  const portfolioSet = useMemo(() => new Set(portfolio), [portfolio]);
  const [focus] = useLocalStorageList("themepulse-focus");
  const [fcOnly, setFcOnly] = useState(() => { try { return localStorage.getItem("tp-chain-fc-only") === "1"; } catch { return false; } });
  const focusSet = useMemo(() => new Set(focus), [focus]);
  const [layerFilter, setLayerFilter] = useState(null); // local layer filter — click layer to toggle
  const wrapRef = useRef(null);
  const [selectedTicker, setSelectedTicker] = useState(null);

  // When scanRows provided, only poll those tickers; else poll all chain tickers.
  // Always include all chain tickers so we can inject high-alpha ones missing from scan.
  const allChainTickers = useMemo(() => {
    const s = new Set();
    DRAWER_SUBTHEMES.forEach((sub) => sub.tickers.forEach((tk) => s.add(tk)));
    s.add("SPY");
    return [...s];
  }, []);
  // Poll /api/zvr for true Zanger Volume Ratio (intraday comparison across 20-day lookback)
  const { cur: apiZvrMap, prev: prevZvrMap, history: zvrHistory } = useZVR(allChainTickers);
  const scanTickers = useMemo(() => {
    if (!scanRows) return null;
    const s = new Set(scanRows.map((r) => r.ticker));
    // Also poll ALL chain tickers — needed to calc alpha for chain-only injections
    DRAWER_SUBTHEMES.forEach((sub) => sub.tickers.forEach((tk) => s.add(tk)));
    s.add("SPY");
    return [...s];
  }, [scanRows]);
  const pollTickers = scanTickers ?? allChainTickers;
  const { quotes: liveQuotes } = useLiveQuotes(pollTickers, 30000);
  const spyReturns = useSpyReturns();
  const [alphaMode, setAlphaMode] = useState(() => {
    try { return localStorage.getItem("tp-chain-heat-alpha") || "1d"; } catch { return "1d"; }
  });
  // Sync alphaMode when Heat view changes it (same localStorage key)
  useEffect(() => {
    const onStorage = (e) => { if (e.key === "tp-chain-heat-alpha") setAlphaMode(e.newValue || "1d"); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const rows = useMemo(() => {
    const spyQ = liveQuotes.get("SPY");
    const spyChg = spyQ?.change ?? 0;
    const spyPeriod = alphaMode === "1w" ? spyReturns?.["1w"] : alphaMode === "1m" ? spyReturns?.["1m"] : null;
    const calcAlpha = (chg, s) => {
      if (alphaMode === "1d") return chg != null ? Math.round((chg - spyChg) * 100) / 100 : null;
      const stockRet = alphaMode === "1w" ? s?.return_1w : s?.return_1m;
      return (stockRet != null && spyPeriod != null) ? Math.round((stockRet - spyPeriod) * 100) / 100 : null;
    };
    // Zanger Volume Ratio: prefer API-sourced ZVR (true 20-day intraday comparison).
    // Fallback chain: apiZvrMap → linear estimate → pipeline rel_volume.
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const etMins = et.getHours() * 60 + et.getMinutes();
    const isRTH = etMins >= 570 && etMins < 960;
    const elapsedFrac = isRTH ? Math.max(0.02, sessionVolFraction(etMins - 570)) : 1.0;
    const calcZVR = (ticker, liveVol, avgVol, pipelineRelVol, chg) => {
      // 1. True Zanger: API-sourced (20-day intraday cumulative comparison)
      let raw = apiZvrMap.get(ticker) ?? null;
      // 2. Linear estimate: live_vol / (avg_vol × elapsed_fraction)
      if (raw == null && liveVol && avgVol > 0) {
        raw = Math.round((liveVol / (avgVol * elapsedFrac)) * 100);
      }
      // 3. Pipeline fallback: last session's final volume / avg
      if (raw == null && pipelineRelVol != null && !isNaN(pipelineRelVol) && pipelineRelVol > 0) {
        raw = Math.round(pipelineRelVol * 100);
      }
      if (raw == null) return null;
      // Sign by price direction: negative chg → negative ZVR (distribution)
      return chg != null && chg < 0 ? -raw : raw;
    };
    // ZVR delta vs previous poll (~60s ago) — is volume pace accelerating or fading?
    const calcZvrTrend = (ticker) => {
      const cur = apiZvrMap.get(ticker), prev = prevZvrMap.get(ticker);
      return (cur != null && prev != null) ? cur - prev : null;
    };
    if (scanRows) {
      // Source from scan results — annotate with chain/layer from TICKER_CHAIN_MAP
      const scanSet = new Set(scanRows.map((sr) => sr.ticker));
      const base = scanRows.map((sr) => {
        const q = liveQuotes.get(sr.ticker);
        const s = stockMap?.[sr.ticker];
        const chains = chainsForStock(sr.ticker, s);
        const firstChain = chains?.[0];
        const themeId = firstChain?.themeId ?? null;
        const theme = themeId
          ? (DRAWER_SUBTHEMES.find((d) => d.themeId === themeId)?.theme ?? (themeId === "realestate" ? "Real Estate" : themeId === "utilities" ? "Utilities" : themeId))
          : null;
        const layers = chains ? [...new Set(chains.map((c) => c.layer))] : [];
        const chg = q?.change != null ? q.change : sr.chg;
        const liveVol = q?.volume;
        const avgVol = s?.avg_volume_raw || q?.avgVolume || 0;
        let rvol = sr.rvol ?? null;
        if (liveVol && avgVol > 0) rvol = liveVol / avgVol;
        return {
          ticker: sr.ticker,
          themeId,
          theme,
          layer: layers[0] ?? null,
          layerCount: layers.length,
          chg,
          alpha: calcAlpha(chg, s),
          rvol,
          rs: s?.framework_score ?? sr.rs ?? s?.rs_rank ?? null, // EIF (framework score) — consistent with the column label
          rsRank: s?.rs_rank ?? null,                            // momentum RS rank (RST leader gate)
          off52: s?.off_52w_high ?? null,
          rsNH: !!s?.rs_line_new_high, tt: !!s?.two_day_tight, de: !!s?.de_ready, deTrig: s?.de_trigger ?? null, deHold: s?.de_hold ?? null, news: s?._newsPipe ?? null, inPlay: !!s?._inPlay,
          d20: s?.dist_20dma_atrx ?? null,
          d50: s?.dist_50sma_atrx ?? null,
          str: tickerStrengthMap?.[sr.ticker] ?? null,
          cr: sr.cr ?? computeCR(q, s),
          zvr: calcZVR(sr.ticker, liveVol, avgVol, s?.rel_volume, chg),
          zvrTrend: calcZvrTrend(sr.ticker),
          adr: s?.adr_pct ?? null,
          is33: s ? TAG_PREDICATES["33"].test(s) : false,
          mcap: s?.market_cap_raw ?? null,
          erDays: s?.earnings_days ?? null,
        };
      });
      // Inject high-alpha chain tickers that didn't pass scan filters
      // (α ≥ 2 = meaningfully outperforming SPY — worth surfacing)
      const injected = [];
      for (const tk of allChainTickers) {
        if (tk === "SPY" || scanSet.has(tk)) continue;
        const chains = TICKER_CHAIN_MAP.get(tk);
        if (!chains?.length) continue;
        const firstChain = chains[0];
        const themeId = firstChain?.themeId ?? null;
        const theme = themeId
          ? (DRAWER_SUBTHEMES.find((s) => s.themeId === themeId)?.theme ?? themeId)
          : null;
        const layers = [...new Set(chains.map((c) => c.layer))];
        const q = liveQuotes.get(tk);
        const s = stockMap?.[tk];
        const chg = q?.change != null ? q.change : (s?.change_pct ?? null);
        const alpha = calcAlpha(chg, s);
        if (alpha == null || alpha < 2) continue; // only inject if α ≥ 2
        // Respect scan-level filters so chain-only tickers don't bypass EIF/RV/Chg/Owned/Green
        if (scanFilters) {
          if (scanFilters.ownedView === "hide" && ownedSet.has(tk)) continue;
          if (scanFilters.ownedView === "owned" && !ownedSet.has(tk)) continue;
          if (scanFilters.greenOnly && (chg == null || chg <= 0)) continue;
          const eifVal = s?.framework_score ?? s?.rs_rank ?? 0;
          if (scanFilters.minEif > 0 && eifVal < scanFilters.minEif) continue;
          if (scanFilters.minChg > 0 && (chg == null || chg < scanFilters.minChg)) continue;
        }
        // ...and active presets/tags too — with T2/DE/etc. selected, injected
        // α names that don't match the preset are exactly what the user
        // filtered OUT (the "α names that aren't part of T2" bug).
        if (activePresets && activePresets.size > 0) {
          let pass = true;
          for (const k of activePresets) { const pr = PRESETS[k]; if (pr && s && !pr.test(s)) { pass = false; break; } if (pr && !s) { pass = false; break; } }
          if (!pass) continue;
        }
        if (activeTags && activeTags.size > 0) {
          let pass = true;
          for (const k of activeTags) { if (k === "9M") continue; const tg = TAG_PREDICATES[k]; if (tg && (!s || !tg.test(s))) { pass = false; break; } }
          if (!pass) continue;
        }
        const liveVol = q?.volume;
        const avgVol = s?.avg_volume_raw || q?.avgVolume || 0;
        let rvol = null;
        if (liveVol && avgVol > 0) rvol = liveVol / avgVol;
        else if (s?.rel_volume != null && !isNaN(s.rel_volume) && s.rel_volume > 0) rvol = s.rel_volume;
        if (scanFilters?.minRvol > 0 && (rvol == null || rvol < scanFilters.minRvol)) continue;
        injected.push({
          ticker: tk,
          themeId,
          theme,
          layer: layers[0] ?? null,
          layerCount: layers.length,
          chg,
          alpha,
          rvol,
          rs: s?.framework_score ?? s?.rs_rank ?? null,
          rsRank: s?.rs_rank ?? null,
          off52: s?.off_52w_high ?? null,
          rsNH: !!s?.rs_line_new_high, tt: !!s?.two_day_tight, de: !!s?.de_ready, deTrig: s?.de_trigger ?? null, deHold: s?.de_hold ?? null, news: s?._newsPipe ?? null, inPlay: !!s?._inPlay,
          d20: s?.dist_20dma_atrx ?? null,
          d50: s?.dist_50sma_atrx ?? null,
          str: tickerStrengthMap?.[tk] ?? null,
          cr: computeCR(q, s),
          zvr: calcZVR(tk, liveVol, avgVol, s?.rel_volume, chg),
          zvrTrend: calcZvrTrend(tk),
          adr: s?.adr_pct ?? null,
          is33: s ? TAG_PREDICATES["33"].test(s) : false,
          mcap: s?.market_cap_raw ?? null,
          erDays: s?.earnings_days ?? null,
          chainOnly: true, // visual marker — didn't pass scan filters
        });
      }
      // PF/FC filter on: ensure every portfolio/focus ticker is present, even
      // ones outside the scan/chain universe (else the filter shows nothing).
      const pfInjected = [];
      if (pfOnly || fcOnly) {
        const present = new Set([...base, ...injected].map((r) => r.ticker));
        const mustInclude = new Set([...(pfOnly ? portfolio : []), ...(fcOnly ? focus : [])]);
        for (const tk of mustInclude) {
          if (!tk || present.has(tk)) continue;
          const s = stockMap?.[tk]; const q = liveQuotes.get(tk);
          const chains = TICKER_CHAIN_MAP.get(tk) || [];
          const themeId = chains[0]?.themeId ?? null;
          const theme = themeId ? (DRAWER_SUBTHEMES.find((d) => d.themeId === themeId)?.theme ?? themeId) : null;
          const layers = [...new Set(chains.map((c) => c.layer))];
          const chg = q?.change != null ? q.change : (s?.change_pct ?? null);
          const liveVol = q?.volume; const avgVol = s?.avg_volume_raw || q?.avgVolume || 0;
          let rvol = null;
          if (liveVol && avgVol > 0) rvol = liveVol / avgVol;
          else if (s?.rel_volume > 0) rvol = s.rel_volume;
          pfInjected.push({
            ticker: tk, themeId, theme, layer: layers[0] ?? null, layerCount: layers.length,
            chg, alpha: calcAlpha(chg, s), rvol,
            rs: s?.framework_score ?? s?.rs_rank ?? null, rsRank: s?.rs_rank ?? null,
            off52: s?.off_52w_high ?? null, d20: s?.dist_20dma_atrx ?? null, d50: s?.dist_50sma_atrx ?? null, rsNH: !!s?.rs_line_new_high, tt: !!s?.two_day_tight, de: !!s?.de_ready, deTrig: s?.de_trigger ?? null, deHold: s?.de_hold ?? null, news: s?._newsPipe ?? null, inPlay: !!s?._inPlay,
            str: tickerStrengthMap?.[tk] ?? null, cr: computeCR(q, s),
            zvr: calcZVR(tk, liveVol, avgVol, s?.rel_volume, chg), zvrTrend: calcZvrTrend(tk),
            adr: s?.adr_pct ?? null, is33: s ? TAG_PREDICATES["33"].test(s) : false,
            mcap: s?.market_cap_raw ?? null, erDays: s?.earnings_days ?? null,
          });
        }
      }
      return [...base, ...injected, ...pfInjected];
    }
    // Default: all chain tickers
    return allChainTickers.map((tk) => {
      const chains = TICKER_CHAIN_MAP.get(tk) || [];
      const firstChain = chains[0];
      const themeId = firstChain?.themeId ?? null;
      const theme = themeId
        ? (DRAWER_SUBTHEMES.find((s) => s.themeId === themeId)?.theme ?? themeId)
        : null;
      const layers = [...new Set(chains.map((c) => c.layer))];
      const q = liveQuotes.get(tk);
      const s = stockMap?.[tk];
      const chg = q?.change != null ? q.change : (s?.change_pct ?? null);
      const liveVol = q?.volume;
      const avgVol = s?.avg_volume_raw || q?.avgVolume || 0;
      let rvol = null;
      if (liveVol && avgVol > 0) rvol = liveVol / avgVol;
      else if (s?.rel_volume != null && !isNaN(s.rel_volume) && s.rel_volume > 0) rvol = s.rel_volume;
      const cr = computeCR(q, s);
      return {
        ticker: tk,
        themeId,
        theme,
        layer: layers[0] ?? null,
        layerCount: layers.length,
        chg,
        alpha: calcAlpha(chg, s),
        rvol,
        rs: s?.framework_score ?? s?.rs_rank ?? null,
        rsRank: s?.rs_rank ?? null,
        off52: s?.off_52w_high ?? null,
        d20: s?.dist_20dma_atrx ?? null,
        d50: s?.dist_50sma_atrx ?? null,
        rsNH: !!s?.rs_line_new_high, tt: !!s?.two_day_tight, de: !!s?.de_ready, deTrig: s?.de_trigger ?? null, deHold: s?.de_hold ?? null, news: s?._newsPipe ?? null, inPlay: !!s?._inPlay,
        str: tickerStrengthMap?.[tk] ?? null,
        cr,
        zvr: calcZVR(tk, liveVol, avgVol, s?.rel_volume, chg),
        zvrTrend: calcZvrTrend(tk),
        adr: s?.adr_pct ?? null,
        is33: s ? TAG_PREDICATES["33"].test(s) : false,
        epsYoy: s?.eps_yoy ?? null,
        salesYoy: s?.sales_yoy ?? null,
        erDays: s?.earnings_days ?? null,
      };
    });
  }, [scanRows, allChainTickers, liveQuotes, stockMap, tickerStrengthMap, alphaMode, spyReturns, scanFilters, ownedSet, apiZvrMap, prevZvrMap, pfOnly, portfolio, fcOnly, focus, activePresets, activeTags]);

  // Regime context for setup thresholds: scale ZVR bars by today's tape.
  // zFactor = universe median |ZVR| / 60 (baseline), clamped 0.8–1.4 so a hot
  // tape raises the bar (stays selective) and a dead tape lowers it (still
  // surfaces the relative movers). Needs ≥8 samples or it stays neutral (1.0).
  const setupCtx = useMemo(() => {
    const mags = rows.map((r) => r.zvr).filter((v) => v != null).map(Math.abs).filter((v) => v > 0).sort((a, b) => a - b);
    if (mags.length < 8) return { zFactor: 1 };
    const median = mags[Math.floor(mags.length / 2)];
    return { zFactor: Math.max(0.8, Math.min(1.4, median / 60)) };
  }, [rows]);

  // Multi-column sort: ordered array of {key, dir}. Click = set primary,
  // Shift+click = add/toggle as secondary/tertiary. Persisted.
  // Default chain: ZVR → CR% → EIF, all descending.
  const STRING_SORT_KEYS = ["ticker", "theme", "layer"];
  const DEFAULT_CHAIN_SORT = [{ key: "zvr", dir: "desc" }, { key: "cr", dir: "desc" }, { key: "rs", dir: "desc" }];
  const [sortSpec, setSortSpec] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("tp-chain-sort"));
      if (Array.isArray(s) && s.every((x) => x && x.key && (x.dir === "asc" || x.dir === "desc"))) return s;
    } catch {}
    return DEFAULT_CHAIN_SORT;
  });
  // ── CR% + ZVR history: sample each row's displayed values every ~50s during
  // RTH for the inline sparklines. Sampling the displayed value (rather than
  // only API ZVR) means linear/rel_volume-fallback tickers get sparklines too.
  useEffect(() => {
    const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const mins = et.getHours() * 60 + et.getMinutes();
    if (mins < 570 || mins >= 960) return;
    const now = Date.now();
    const day = et.toISOString().slice(0, 10);
    if (_crPersistDay !== day) { _crPersist.clear(); _crPersistDay = day; }
    const sample = (map, ticker, v) => {
      if (v == null) return;
      const arr = map.get(ticker) || [];
      if (arr.length && now - arr[arr.length - 1].t < 50000) return;
      arr.push({ t: now, v });
      if (arr.length > 40) arr.shift();
      map.set(ticker, arr);
    };
    for (const r of rows) {
      // Whole-session CR persistence (only count one sample per ~50s per ticker)
      if (r.cr != null) {
        const p = _crPersist.get(r.ticker) || { n: 0, strong: 0, last: 0 };
        if (now - p.last >= 50000) {
          p.n += 1;
          if (r.cr >= 67) p.strong += 1;
          p.last = now;
          _crPersist.set(r.ticker, p);
        }
      }
      sample(_crHistory, r.ticker, r.cr);
      sample(_zvrHistory, r.ticker, r.zvr);
    }
  }, [rows]);

  // ── Setup journal: POST new badge firings to /api/setup-log during RTH.
  // Session-level dedupe here; the server dedupes per ticker+badge per day.
  const loggedSetups = useRef(new Set());
  useEffect(() => {
    const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const mins = et.getHours() * 60 + et.getMinutes();
    if (mins < 600 || mins >= 960) return; // 10:00 ET+ only — first 30 min is ZVR/CR noise
    const fresh = [];
    for (const r of rows) {
      const su = chainSetup(r, setupCtx);
      if (!su) continue;
      // Only journal badges backed by a live quote with real volume —
      // rel_volume-fallback values (yesterday's data) produce bogus entries
      // when a tab's quote loop stalls.
      if (!(liveQuotes.get(r.ticker)?.volume > 0)) continue;
      const k = `${r.ticker}:${su.key}`;
      if (loggedSetups.current.has(k)) continue;
      loggedSetups.current.add(k);
      fresh.push({ ticker: r.ticker, badge: su.key, zvr: r.zvr, eif: r.rs, cr: r.cr, chg: r.chg, price: liveQuotes.get(r.ticker)?.price ?? null, ts: new Date().toISOString() });
    }
    if (fresh.length) {
      fetch("/api/zvr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: fresh.slice(0, 100) }),
      }).catch(() => {});
    }
  }, [rows, liveQuotes]);

  const [setupsOnly, setSetupsOnly] = useState(() => { try { return localStorage.getItem("tp-chain-setups-only") === "1"; } catch { return false; } });
  const [leadersOnly, setLeadersOnly] = useState(() => { try { return localStorage.getItem("tp-chain-leaders-only") === "1"; } catch { return false; } });
  const [crpOnly, setCrpOnly] = useState(() => { try { return localStorage.getItem("tp-chain-crp-only") === "1"; } catch { return false; } });
  const sorted = useMemo(() => {
    let arr = rows.slice();
    if (pfOnly) arr = arr.filter(r => portfolioSet.has(r.ticker));
    if (fcOnly) arr = arr.filter(r => focusSet.has(r.ticker));
    if (posOnly) arr = arr.filter(r => r.chg != null && r.chg > 0);
    if (layerFilter) arr = arr.filter(r => r.layer === layerFilter);
    if (setupsOnly) arr = arr.filter(r => chainSetup(r, setupCtx));
    if (leadersOnly) arr = arr.filter(r => r.rs != null && r.rs >= 55 && eifReasons[r.ticker]?.drivers?.length);
    if (crpOnly) arr = arr.filter(r => {
      // Must still be in/near the top third RIGHT NOW (not just historically).
      if (r.cr == null || r.cr < 60) return false;
      const p = _crPersist.get(r.ticker);
      // With enough intraday samples, also require it held the top 1/3 on ≥60%
      // of the session. Before samples accumulate, current top-third is enough.
      return !p || p.n < 5 || (p.strong / p.n) >= 0.6;
    });
    const sortVal = (r, key) => {
      if (key === "setup") return chainSetup(r, setupCtx)?.rank ?? 0;
      if (key === "is33") return r.is33 ? 1 : 0;
      if (key === "star") return (r.rs != null && r.rs >= 55) ? r.rs : -1;
      return r[key];
    };
    arr.sort((a, b) => {
      for (const { key, dir } of sortSpec) {
        let av = sortVal(a, key), bv = sortVal(b, key);
        let cmp;
        if (STRING_SORT_KEYS.includes(key)) {
          cmp = (av || "").toString().localeCompare((bv || "").toString());
        } else {
          av = av == null ? -Infinity : av;
          bv = bv == null ? -Infinity : bv;
          cmp = av - bv;
        }
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortSpec, posOnly, layerFilter, setupsOnly, leadersOnly, eifReasons, crpOnly, pfOnly, portfolioSet, fcOnly, focusSet]);
  const saveSortSpec = (next) => {
    setSortSpec(next);
    try { localStorage.setItem("tp-chain-sort", JSON.stringify(next)); } catch {}
  };
  const toggleSort = (k, additive) => {
    setSortSpec((prev) => {
      const idx = prev.findIndex((s) => s.key === k);
      const defaultDir = STRING_SORT_KEYS.includes(k) ? "asc" : "desc";
      let next;
      if (additive) {
        // Shift+click cycles: not present → add (default dir) → flipped → removed
        if (idx < 0) next = [...prev, { key: k, dir: defaultDir }];
        else if (prev[idx].dir === defaultDir) next = prev.map((s, i) => (i === idx ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : s));
        else next = prev.filter((_, i) => i !== idx);
      } else if (idx === 0 && prev.length === 1) {
        // Plain click on the sole sort: flip direction
        next = [{ key: k, dir: prev[0].dir === "asc" ? "desc" : "asc" }];
      } else if (idx === 0) {
        // Plain click on current primary (with secondaries): flip direction, keep secondaries
        next = [{ key: k, dir: prev[0].dir === "asc" ? "desc" : "asc" }, ...prev.slice(1)];
      } else {
        // Plain click on a new column: reset to single sort
        next = [{ key: k, dir: defaultDir }];
      }
      try { localStorage.setItem("tp-chain-sort", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const SORT_LABELS = { zvr: "ZVR", setup: "SETUP", rs: "EIF", chg: "CHG%", alpha: "α", adr: "ADR", str: "STR", mcap: "MCAP", cr: "CR%", erDays: "ER", is33: "33", ticker: "TICKER", theme: "CHAIN", layer: "LAYER", rvol: "RV" };
  const isDefaultSort = sortSpec.length === DEFAULT_CHAIN_SORT.length && sortSpec.every((s, i) => s.key === DEFAULT_CHAIN_SORT[i].key && s.dir === DEFAULT_CHAIN_SORT[i].dir);

  const strColor = (v) => v == null ? ARIA.textMuted : v >= 65 ? ARIA.green : ARIA.textDim;
  const crColor = (v) => v == null ? ARIA.textMuted : v >= 70 ? ARIA.green : v <= 30 ? ARIA.red : ARIA.textDim;
  const chgColor = (v) => v == null || Math.abs(v) <= 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;

  const Th = ({ k, label, align = "right" }) => {
    const idx = sortSpec.findIndex((s) => s.key === k);
    const on = idx >= 0;
    const arrow = on ? (sortSpec[idx].dir === "asc" ? " ▲" : " ▼") : "";
    return (
      <th onClick={(e) => toggleSort(k, e.shiftKey)}
        title={`${COL_HELP[k] ? COL_HELP[k] + "\n\n" : ""}Click to sort · Shift+click to add as secondary sort`}
        style={{
          padding: "3px 5px", fontSize: 7, fontWeight: 700,
          color: on ? ARIA.green : ARIA.textMuted,
          textTransform: "uppercase", letterSpacing: 0.3, textAlign: align,
          borderBottom: `1px solid ${ARIA.border}`, whiteSpace: "nowrap",
          cursor: "pointer", background: ARIA.bgCard, userSelect: "none",
        }}>{label}{arrow}{on && sortSpec.length > 1 && <sup style={{ fontSize: 5, color: "#fbbf24", fontWeight: 800 }}>{idx + 1}</sup>}</th>
    );
  };
  const cell = { padding: "2px 5px", fontSize: 9, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, whiteSpace: "nowrap" };

  // Keyboard nav: ↑/↓ moves selection, loads chart, scrolls into table viewport
  const visibleTickers = sorted.map(r => r.ticker);
  useEffect(() => {
    if (!visibleTickers.length) return;
    if (!selectedTicker || !visibleTickers.includes(selectedTicker)) {
      setSelectedTicker(visibleTickers[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTickers.join(",")]);
  const onKeyDown = useCallback((e) => {
    if (!visibleTickers.length) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const cur = selectedTicker ? visibleTickers.indexOf(selectedTicker) : -1;
    let next = cur < 0 ? 0 : cur + (e.key === "ArrowDown" ? 1 : -1);
    if (next < 0) next = 0;
    if (next >= visibleTickers.length) next = visibleTickers.length - 1;
    const t = visibleTickers[next];
    setSelectedTicker(t);
    suppressChainScrollOnce();
    onTickerClick && onTickerClick(t);
    scrollRowIntoScroller(wrapRef.current?.querySelector(`tr[data-ticker="${t}"]`));
  }, [visibleTickers, selectedTicker, onTickerClick]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", borderBottom: `1px solid ${ARIA.border}`, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.5 }}>FILTER</span>
        <button
          onClick={() => setPosOnly && setPosOnly((p) => !p)}
          title="Show only Chg% > 0"
          style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.4, padding: "1px 6px", borderRadius: 3, cursor: "pointer", color: posOnly ? "#10b981" : ARIA.textMuted, background: posOnly ? "rgba(16,185,129,0.12)" : "transparent", border: `1px solid ${posOnly ? "rgba(16,185,129,0.45)" : ARIA.border}` }}>
          ▲ Chg{'>'}0%
        </button>
        {activeFilterNames?.map((name) => (
          <span key={name} style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.4)", color: "#a855f7" }}>{name}</span>
        ))}
        {scanFilters && (() => {
          const chips = [];
          const chip = (label, key) => (
            <span key={key} style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.4)", color: "#10b981" }}>{label}</span>
          );
          if (scanFilters.noBio) chips.push(chip("NoBio", "nobio"));
          if (scanFilters.greenOnly) chips.push(chip("Chg>0%", "green"));
          if (scanFilters.minChg > 0) chips.push(chip(`Chg≥${scanFilters.minChg}%`, "minchg"));
          if (scanFilters.minRvol > 0) chips.push(chip(`RV≥${scanFilters.minRvol}x`, "minrv"));
          if (scanFilters.minEif > 0) chips.push(chip(`EIF≥${scanFilters.minEif}`, "mineif"));
          if (scanFilters.adrMin !== 1 || scanFilters.adrMax !== 15) chips.push(chip(`ADR ${scanFilters.adrMin}–${scanFilters.adrMax}`, "adr"));
          if (scanFilters.minDvolM > 0) chips.push(chip(`$Vol≥${scanFilters.minDvolM}M`, "dvol"));
          if (scanFilters.ownedView !== "all") chips.push(chip(scanFilters.ownedView === "owned" ? "Owned" : "None", "owned"));
          if (activePresets) [...activePresets].forEach((k) => { const p = PRESETS[k]; if (p) chips.push(chip(p.label, `preset-${k}`)); });
          if (activeTags) [...activeTags].forEach((k) => { const t = TAG_PREDICATES[k]; if (t) chips.push(chip(t.label, `tag-${k}`)); });
          return chips.length > 0 ? <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap" }}>{chips}</span> : null;
        })()}
        <span style={{ color: ARIA.border, margin: "0 2px" }}>|</span>
        <button
          onClick={() => setPfOnly((v) => { const n = !v; try { localStorage.setItem("tp-chain-pf-only", n ? "1" : "0"); } catch {} return n; })}
          title="Show only tickers in your portfolio"
          style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.4, padding: "1px 6px", borderRadius: 3, cursor: "pointer", color: pfOnly ? "#f472b6" : ARIA.textMuted, background: pfOnly ? "rgba(244,114,182,0.12)" : "transparent", border: `1px solid ${pfOnly ? "rgba(244,114,182,0.45)" : ARIA.border}` }}>
          ◆ PF
        </button>
        <button
          onClick={() => setFcOnly((v) => { const n = !v; try { localStorage.setItem("tp-chain-fc-only", n ? "1" : "0"); } catch {} return n; })}
          title="Show only tickers in your Focus list (high-priority recent setups)"
          style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.4, padding: "1px 6px", borderRadius: 3, cursor: "pointer", color: fcOnly ? "#22d3ee" : ARIA.textMuted, background: fcOnly ? "rgba(34,211,238,0.12)" : "transparent", border: `1px solid ${fcOnly ? "rgba(34,211,238,0.45)" : ARIA.border}` }}>
          ⚡ FC
        </button>
        <button
          onClick={() => setSetupsOnly((v) => { const n = !v; try { localStorage.setItem("tp-chain-setups-only", n ? "1" : "0"); } catch {} return n; })}
          title="Show only rows with an active Setup badge — DIST · EP · BO · ACC · RST · VCP (hover a badge for its trigger). ⚡ = something actionable is happening right now."
          style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.4, padding: "1px 6px", borderRadius: 3, cursor: "pointer", color: setupsOnly ? "#34d399" : ARIA.textMuted, background: setupsOnly ? "rgba(52,211,153,0.12)" : "transparent", border: `1px solid ${setupsOnly ? "rgba(52,211,153,0.45)" : ARIA.border}` }}>
          ⚡ SETUPS
        </button>
        <button
          onClick={() => setLeadersOnly((v) => { const n = !v; try { localStorage.setItem("tp-chain-leaders-only", n ? "1" : "0"); } catch {} return n; })}
          title="Show only quality leaders — EIF ≥ 55 with articulated drivers (the same names cross-referenced in the Leaders panel). ★ = is this name worth acting on."
          style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.4, padding: "1px 6px", borderRadius: 3, cursor: "pointer", color: leadersOnly ? "#fbbf24" : ARIA.textMuted, background: leadersOnly ? "rgba(251,191,36,0.12)" : "transparent", border: `1px solid ${leadersOnly ? "rgba(251,191,36,0.45)" : ARIA.border}` }}>
          ★ LEADERS
        </button>
        <button
          onClick={() => setCrpOnly((v) => { const n = !v; try { localStorage.setItem("tp-chain-crp-only", n ? "1" : "0"); } catch {} return n; })}
          title="Intraday CR persistence — held the top 1/3 of its range on 60%+ of the session (sustained buying through the day). Falls back to multi-day daily CRP after hours."
          style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.4, padding: "1px 6px", borderRadius: 3, cursor: "pointer", color: crpOnly ? "#0ea5e9" : ARIA.textMuted, background: crpOnly ? "rgba(14,165,233,0.12)" : "transparent", border: `1px solid ${crpOnly ? "rgba(14,165,233,0.45)" : ARIA.border}` }}>
          ↑ CR PERSIST
        </button>
        {!isDefaultSort && (
          <button
            onClick={() => saveSortSpec(DEFAULT_CHAIN_SORT)}
            title="Active sort chain — click to reset to default (ZVR → CR% → EIF)"
            style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.3, padding: "1px 6px", borderRadius: 3, cursor: "pointer", color: "#fbbf24", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)" }}>
            {sortSpec.length
              ? sortSpec.map((s) => `${SORT_LABELS[s.key] || s.key.toUpperCase()}${s.dir === "asc" ? "↑" : "↓"}`).join(" · ")
              : "NO SORT"} ✕
          </button>
        )}
        <span style={{ fontSize: 7, fontFamily: "monospace", color: ARIA.textMuted, marginLeft: "auto" }}>{sorted.length} tickers</span>
      </div>
      <div ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown}
           style={{ flex: 1, minHeight: 0, overflow: "auto", outline: "none" }}>
      {layerFilter && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", background: "rgba(168,85,247,0.08)", borderBottom: `1px solid rgba(168,85,247,0.25)`, flexShrink: 0 }}>
          <span style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, color: "#a855f7", letterSpacing: 0.4 }}>LAYER</span>
          <span style={{ fontSize: 8, fontFamily: "monospace", fontWeight: 700, color: "#a855f7", padding: "1px 6px", borderRadius: 3, background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.4)" }}>
            {layerFilter}
          </span>
          <button onClick={() => setLayerFilter(null)} style={{ fontSize: 8, fontFamily: "monospace", color: ARIA.textMuted, background: "transparent", border: `1px solid ${ARIA.border}`, borderRadius: 3, padding: "1px 5px", cursor: "pointer" }}>✕ clear</button>
          <span style={{ fontSize: 7, fontFamily: "monospace", color: ARIA.textMuted, marginLeft: "auto" }}>{sorted.length} tickers</span>
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto", fontFamily: "monospace" }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 2, background: ARIA.bgCard }}>
          <tr>
            <Th k="ticker" label="Ticker" align="left" />
            <Th k="theme" label="Chain · Layer" align="left" />
            <Th k="chg" label="Chg%" />
            {(() => {
              const aIdx = sortSpec.findIndex((s) => s.key === "alpha");
              return (
                <th onClick={(e) => toggleSort("alpha", e.shiftKey)} onContextMenu={(e) => { e.preventDefault(); const next = alphaMode === "1d" ? "1w" : alphaMode === "1w" ? "1m" : "1d"; setAlphaMode(next); try { localStorage.setItem("tp-chain-heat-alpha", next); } catch {} }}
                    title={`${COL_HELP.alpha}\n\nClick to sort · Shift+click to add as secondary sort · Right-click to cycle α window (1d/1w/1m)`}
                    style={{ padding: "3px 5px", fontSize: 7, fontWeight: 700, color: aIdx >= 0 ? ARIA.green : ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.3, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, background: ARIA.bgCard, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                  RS <span style={{ fontSize: 6, color: "#fbbf24", fontWeight: 800 }}>{alphaMode === "1d" ? "DAY" : alphaMode === "1w" ? "WK" : "MTH"}%</span>{aIdx >= 0 ? (sortSpec[aIdx].dir === "asc" ? " ▲" : " ▼") : ""}{aIdx >= 0 && sortSpec.length > 1 && <sup style={{ fontSize: 5, color: "#fbbf24", fontWeight: 800 }}>{aIdx + 1}</sup>}
                </th>
              );
            })()}
            <Th k="zvr" label="ZVR" />
            <Th k="cr" label="CR%" />
            <Th k="rs" label="EIF" />
            <Th k="adr" label="ADR" />
            <Th k="str" label="Str" />
            <Th k="setup" label="Setup" />
            <Th k="erDays" label="ER" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const c = DRAWER_COLORS[r.themeId] || { color: ARIA.textDim, bg: "transparent", border: ARIA.border };
            const sel = chartTicker === r.ticker;
            const kbSel = selectedTicker === r.ticker;
            const tint = ownedTint(r.ticker, ARIA);
            const baseBg = tint;
            return (
              <tr
                key={r.ticker}
                data-ticker={r.ticker}
                onClick={() => { setSelectedTicker(r.ticker); suppressChainScrollOnce(); onTickerClick && onTickerClick(r.ticker); wrapRef.current?.focus({ preventScroll: true }); }}
                style={{ cursor: "pointer", background: sel ? `${c.color}26` : kbSel ? "rgba(255,255,255,0.06)" : baseBg, outline: kbSel && !sel ? `1px solid ${ARIA.border}` : "none", outlineOffset: -1 }}
                onMouseEnter={(e) => { if (!sel && !kbSel) e.currentTarget.style.background = ARIA.bgHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = sel ? `${c.color}26` : kbSel ? "rgba(255,255,255,0.06)" : baseBg; }}
                title={`${r.ticker} — ${r.theme} → ${r.layer}${r.layerCount > 1 ? ` (+${r.layerCount-1} more)` : ""}${r.chainOnly ? " · chain-only (α≥2, below scan filters)" : ""}`}
              >
                <td style={{ ...cell, textAlign: "left", color: sel ? c.color : r.chainOnly ? "rgba(251,191,36,0.85)" : ARIA.text, fontWeight: sel ? 800 : 700, borderLeft: r.chainOnly ? "2px solid rgba(251,191,36,0.4)" : "2px solid transparent" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <img src={ER_LOGO(r.ticker)} alt="" style={{ width: 11, height: 11, borderRadius: 2 }} onError={(e) => { e.target.style.display = "none"; }} />
                    {r.ticker}
                    {r.chainOnly && <span title="High-alpha chain ticker (didn't pass scan filters)" style={{ fontSize: 6, fontWeight: 800, color: "#fbbf24", background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 2, padding: "0 2px", lineHeight: "10px" }}>α</span>}
                    {r.tt && <span title="2-Days-Tight — last two closes within 1% + narrowing range, above the 50sma. Compression: breakout candidate for tomorrow" style={{ fontSize: 6, fontWeight: 800, color: "#f472b6", border: "1px solid #f472b680", background: "rgba(244,114,182,0.12)", padding: "0 2px", borderRadius: 2, lineHeight: "10px" }}>T2</span>}
                    {r.de && <span title={`Delayed Entry ready (2-7d post-gap, tight + narrowing, holding 4-EMA) — entry = break of ${r.deTrig ?? "recent highs"}${r.deHold ? ` · gap ${r.deHold}` : ""}${r.news ? `\nCatalyst: ${r.news[0]}` : ""}`} style={{ fontSize: 6, fontWeight: 800, color: "#fb923c", border: "1px solid #fb923c80", background: "rgba(251,146,60,0.12)", padding: "0 2px", borderRadius: 2, lineHeight: "10px" }}>DE</span>}
                    {r.news && <span onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("tp-news-pop", { detail: { x: e.clientX, y: e.clientY, ticker: r.ticker, items: r.news } })); }} title={r.inPlay ? "In play today — click for catalyst headlines" : "Click for catalyst headlines"} style={{ fontSize: r.inPlay ? 9 : 7, opacity: r.inPlay ? 1 : 0.7, lineHeight: "10px", cursor: "pointer", filter: r.inPlay ? "drop-shadow(0 0 3px #fbbf24) saturate(1.5)" : "none" }}>📰</span>}
                    {r.rsRank != null && r.rsRank >= 85 && r.wkRs != null && r.wkRs <= -2 && <span title={`Leader diverging — RS rank ${r.rsRank} but ${r.wkRs > 0 ? "+" : ""}${r.wkRs}% vs SPY THIS week. The rank is trailing; the current tape disagrees.`} style={{ fontSize: 7, lineHeight: "10px", color: "#d9a441" }}>⚠</span>}
                  </span>
                </td>
                <td style={{ ...cell, textAlign: "left", fontSize: 8, whiteSpace: "nowrap" }}>
                  {r.themeId ? (
                    <span style={{
                      fontSize: 7, fontWeight: 400, color: ARIA.textDim,
                      background: "transparent", border: `1px solid ${ARIA.borderLight}`,
                      padding: "0 4px", borderRadius: 2, marginRight: 5,
                    }}>{(CHAIN_ABBR[r.themeId] || r.themeId).toUpperCase()}</span>
                  ) : null}
                  {r.layer ? (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setLayerFilter((prev) => prev === r.layer ? null : r.layer);
                      }}
                      title={layerFilter === r.layer ? "Click to clear filter" : `Click to filter → ${r.layer}`}
                      style={{ color: layerFilter === r.layer ? "#a855f7" : ARIA.textDim, cursor: "pointer", fontWeight: layerFilter === r.layer ? 700 : 400, borderBottom: "1px dashed rgba(255,255,255,0.15)" }}>
                      {r.layer}
                    </span>
                  ) : (!r.themeId ? <span style={{ color: ARIA.textMuted }}>—</span> : null)}
                  {r.layer && r.layerCount > 1 ? <span style={{ color: ARIA.textMuted }}> +{r.layerCount-1}</span> : null}
                </td>
                <td style={{ ...cell, color: chgColor(r.chg), fontWeight: r.chg != null && Math.abs(r.chg) > 2 ? 700 : 400 }}>
                  {r.chg != null ? (r.chg > 0 ? "+" : "") + r.chg.toFixed(1) + "%" : "—"}
                </td>
                <td style={{ ...cell, color: r.alpha != null && r.alpha >= 2 ? "#fbbf24" : r.alpha != null && r.alpha <= -2 ? ARIA.red : ARIA.textDim, fontWeight: r.alpha != null && Math.abs(r.alpha) >= 2 ? 700 : 400 }}
                    title={`Alpha vs SPY: stock ${r.chg?.toFixed(1)}% − SPY ${(r.chg - r.alpha).toFixed(1)}%`}>
                  {r.alpha != null ? (r.alpha > 0 ? "+" : "") + r.alpha.toFixed(1) : "—"}
                </td>
                <td style={{ ...cell, color: r.zvr != null ? (r.zvr < 0 ? (Math.abs(r.zvr) >= 200 ? "#ef4444" : Math.abs(r.zvr) >= 150 ? ARIA.red : ARIA.textMuted) : (r.zvr >= 200 ? "#fbbf24" : r.zvr >= 150 ? ARIA.green : ARIA.textMuted)) : ARIA.textMuted, fontWeight: r.zvr != null && Math.abs(r.zvr) >= 150 ? 700 : 400, whiteSpace: "nowrap" }}
                    title={`Zanger Volume Ratio: projected EOD volume as % of avg daily volume. Positive = accumulation, negative = distribution. ≥200% = breakout confirmation${r.zvrTrend != null ? ` · ${r.zvrTrend > 0 ? "+" : ""}${r.zvrTrend} pts vs last poll` : ""}`}>
                  {r.zvr != null ? (r.zvr < 0 ? "-" : "") + Math.abs(r.zvr) + "%" : "—"}
                  {r.zvrTrend != null && Math.abs(r.zvrTrend) >= 5 && (
                    <span style={{ fontSize: 6, marginLeft: 1, color: r.zvrTrend > 0 ? "#34d399" : "#ef4444" }}>
                      {r.zvrTrend > 0 ? "▲" : "▼"}
                    </span>
                  )}
                  {(() => {
                    const h = zvrHistory.get(r.ticker);
                    if (!h || h.length < 3) return null;
                    const vals = h.map((p) => p.v);
                    const min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1;
                    const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 23 + 1).toFixed(1)},${(9 - ((v - min) / rng) * 7).toFixed(1)}`).join(" ");
                    const up = vals[vals.length - 1] >= vals[0];
                    return (
                      <svg width="25" height="10" style={{ marginLeft: 3, verticalAlign: "middle", opacity: 0.85 }}
                           aria-hidden="true">
                        <polyline points={pts} fill="none" stroke={up ? "#34d399" : "#ef4444"} strokeWidth="1" />
                      </svg>
                    );
                  })()}
                </td>
                <td style={{ ...cell, color: crColor(r.cr) }}>
                  {r.cr != null ? Math.round(r.cr) + "%" : "—"}
                  {(() => {
                    const h = _crHistory.get(r.ticker);
                    if (!h || h.length < 3) return null;
                    const vals = h.map((p) => p.v);
                    const min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1;
                    const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 23 + 1).toFixed(1)},${(9 - ((v - min) / rng) * 7).toFixed(1)}`).join(" ");
                    const up = vals[vals.length - 1] >= vals[0];
                    return (
                      <svg width="25" height="10" style={{ marginLeft: 3, verticalAlign: "middle", opacity: 0.85 }} aria-hidden="true">
                        <polyline points={pts} fill="none" stroke={up ? "#34d399" : "#ef4444"} strokeWidth="1" />
                      </svg>
                    );
                  })()}
                </td>
                {(() => {
                  const isEifLeader = r.rs != null && r.rs >= 55 && eifReasons[r.ticker]?.drivers?.length;
                  return (
                    <td
                      {...(isEifLeader ? { "data-star-pop": "" } : {})}
                      onClick={isEifLeader ? (e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setStarPopover((p) => p?.ticker === r.ticker ? null : { ticker: r.ticker, x: rect.left, y: rect.bottom + 4, row: r });
                      } : undefined}
                      title={isEifLeader ? "EIF leader — click for the reasoning" : undefined}
                      style={{ ...cell, color: r.rs != null && r.rs >= 55 ? ARIA.green : ARIA.textDim, fontWeight: r.rs != null && r.rs >= 55 ? 700 : 400, cursor: isEifLeader ? "pointer" : "default", textDecoration: isEifLeader ? "underline dotted" : "none", textUnderlineOffset: 2 }}>
                      {r.rs != null ? Math.round(r.rs) : "—"}
                    </td>
                  );
                })()}
                <td style={{ ...cell, color: r.adr != null && r.adr >= 4 ? ARIA.cyan : ARIA.textDim, fontWeight: r.adr != null && r.adr >= 4 ? 700 : 400 }}
                    title="Average Daily Range %. ≥3% = tradeable swing range, ≥5% = high volatility">
                  {r.adr != null ? r.adr.toFixed(1) + "%" : "—"}
                </td>
                <td style={{ ...cell, color: strColor(r.str), fontWeight: r.str != null && r.str >= 65 ? 700 : 400 }}>
                  {r.str != null ? Math.round(r.str) : "—"}
                </td>
                <td style={{ ...cell, textAlign: "center", padding: "2px 3px" }}>
                  {(() => {
                    const su = chainSetup(r, setupCtx);
                    if (!su) return <span style={{ color: ARIA.textMuted, fontSize: 8 }}>—</span>;
                    return (
                      <span title={su.desc} style={{ fontSize: 7, fontWeight: 800, color: su.color, background: `${su.color}1f`, border: `1px solid ${su.color}55`, borderRadius: 2, padding: "0 3px", letterSpacing: 0.3 }}>
                        {su.key}
                      </span>
                    );
                  })()}
                </td>
                <td style={{ ...cell, color: r.erDays != null && r.erDays >= 0 && r.erDays <= 7 ? ARIA.yellow : ARIA.textMuted, fontWeight: r.erDays != null && r.erDays >= 0 && r.erDays <= 7 ? 700 : 400 }}>
                  {r.erDays != null ? (r.erDays >= 0 ? `${r.erDays}d` : `${-r.erDays}d ago`) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      </div>
      {/* Star → EIF reasoning popover */}
      {starPopover && (() => {
        const r = eifReasons[starPopover.ticker];
        if (!r) return null;
        const BUCKET_C = { theme: "#a855f7", accel: "#0d9163", quality: "#5a7a9a" };
        const x = Math.min(starPopover.x, window.innerWidth - 280);
        const y = Math.min(starPopover.y, window.innerHeight - 200);
        return (
          <div data-star-pop style={{ position: "fixed", left: x, top: y, width: 260, zIndex: 9999, background: "#1a1a28", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.7)", padding: "7px 9px", fontFamily: "monospace" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
              <span style={{ fontSize: 8, color: "#5a5a6a", fontWeight: 700, letterSpacing: 0.4 }}>★ {starPopover.ticker}</span>
              <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 800, color: "#fbbf24" }}>{r.eif}</span>
              <span style={{ fontSize: 6.5, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 2, padding: "0 3px" }}>{r.verdict}</span>
              <button onClick={() => setStarPopover(null)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#666", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            {/* Jensen mode classification */}
            <div style={{ display: "flex", gap: 4, marginBottom: 5, flexWrap: "wrap" }}>
              {(() => {
                const modes = classifyModes(starPopover.row);
                const MC = { "LEADER": "#0d9163", "CATCH-UP": "#22d3ee", "DIP": "#60a5fa" };
                if (!modes.length) return <span style={{ fontSize: 7, color: "#5a5a6a", fontStyle: "italic" }}>EIF leader — no live trigger now</span>;
                return modes.map((m) => (
                  <span key={m} style={{ fontSize: 7, fontWeight: 800, color: MC[m], background: MC[m] + "1f", border: `1px solid ${MC[m]}55`, borderRadius: 2, padding: "0 4px", letterSpacing: 0.3 }}>{m}</span>
                ));
              })()}
            </div>
            {(r.drivers || []).map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 4, marginBottom: 3 }}>
                <span style={{ fontSize: 6, fontWeight: 800, color: BUCKET_C[d.bucket] || "#888", background: (BUCKET_C[d.bucket] || "#888") + "18", border: `1px solid ${(BUCKET_C[d.bucket] || "#888")}44`, borderRadius: 2, padding: "0 2px", flexShrink: 0, marginTop: 1, minWidth: 28, textAlign: "center" }}>{({ theme: "THEME", accel: "ACCEL", quality: "QUAL" })[d.bucket] || "—"}</span>
                <span style={{ fontSize: 8, color: "#b8b8c8", lineHeight: 1.35, flex: 1 }}>{d.text}</span>
                <span style={{ fontSize: 7, color: "#5a5a6a", flexShrink: 0, marginTop: 1 }}>+{d.pts}</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ── useChainLayers: loads chain_layers.json (full layer membership — curated +
// industry fallback, the same file the RS Rotation Layers tab uses). Module-level
// cache so the ticker drawer's layer chips and any future consumer share one fetch.
let _chainLayersCache = null, _chainLayersFetching = false; const _chainLayersListeners = [];
function useChainLayers() {
  const [d, setD] = useState(_chainLayersCache);
  useEffect(() => {
    if (_chainLayersCache) { setD(_chainLayersCache); return; }
    if (_chainLayersFetching) { _chainLayersListeners.push(setD); return; }
    _chainLayersFetching = true;
    fetch("/data/chain_layers.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { _chainLayersCache = j || []; setD(_chainLayersCache); _chainLayersListeners.forEach((fn) => fn(_chainLayersCache)); _chainLayersListeners.length = 0; })
      .catch(() => { _chainLayersFetching = false; });
  }, []);
  return d;
}

// ── ScanWatchTable: Aria-faithful results table with click-to-sort headers ──
function ScanWatchTable({ rows, sort, onSort, onSort2, chgMode, onTickerClick, onSubthemeClick, onChainClick }) {
  const ARIA = useAriaTheme();
  const ownedTint = useOwnedTint();
  // Keyboard nav: track selected ticker, allow ↑/↓ to move and load chart.
  // Persist selected by ticker (not index) so reorders/filter changes don't
  // jump to a random row.
  const [selectedTicker, setSelectedTicker] = useState(null);
  const wrapRef = React.useRef(null);
  // Whenever rows change, validate selection still exists; otherwise pick row 0.
  const visibleTickers = rows.map((r) => r.ticker);
  useEffect(() => {
    if (!visibleTickers.length) return;
    if (!selectedTicker || !visibleTickers.includes(selectedTicker)) {
      setSelectedTicker(visibleTickers[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, visibleTickers.join(",")]);
  const onKeyDown = useCallback(
    (e) => {
      if (!visibleTickers.length) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const cur = selectedTicker
        ? visibleTickers.indexOf(selectedTicker)
        : -1;
      let next = cur < 0 ? 0 : cur + (e.key === "ArrowDown" ? 1 : -1);
      if (next < 0) next = 0;
      if (next >= visibleTickers.length) next = visibleTickers.length - 1;
      const t = visibleTickers[next];
      setSelectedTicker(t);
      onTickerClick && onTickerClick(t);
      // Scroll selected row into the table's own scroller only — never the page
      scrollRowIntoScroller(wrapRef.current?.querySelector(`tr[data-ticker="${t}"]`));
    },
    [visibleTickers, selectedTicker, onTickerClick]
  );

  // Click = primary sort, right-click = secondary sort
  const handleHeaderClick = (key) => onSort(key);
  const handleHeaderContext = (e, key) => {
    e.preventDefault();
    onSort2(key);
  };

  const Th = ({ k, label, align = "right", sticky }) => {
    const isPrimary = sort.primary === k;
    const isSecondary = sort.secondary === k;
    const arrow = isPrimary ? " ▼" : "";
    const color = isPrimary
      ? ARIA.green
      : isSecondary
      ? ARIA.cyan
      : ARIA.textMuted;
    return (
      <th
        onClick={() => handleHeaderClick(k)}
        onContextMenu={(e) => handleHeaderContext(e, k)}
        title={`${COL_HELP[k] ? COL_HELP[k] + "\n\n" : ""}Click = primary sort, right-click = secondary`}
        style={{
          padding: "4px 6px",
          fontSize: 8,
          fontWeight: 700,
          color,
          textTransform: "uppercase",
          letterSpacing: 0.3,
          textAlign: align,
          borderBottom: `1px solid ${ARIA.border}`,
          whiteSpace: "nowrap",
          cursor: "pointer",
          background: ARIA.bgCard,
          userSelect: "none",
          ...(sticky && { position: "sticky", left: 0, zIndex: 1 }),
        }}
      >
        {label}
        {arrow}
        {isSecondary && !isPrimary && (
          <sup style={{ fontSize: 5, color: ARIA.cyan }}>2</sup>
        )}
      </th>
    );
  };

  const colorChg = (v) =>
    v == null || Math.abs(v) <= 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;
  const fmtPct = (v) =>
    v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  const fmtVol = (v) => {
    if (!v) return "—";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return String(v);
  };
  const colorRvol = (v) =>
    v == null ? ARIA.textMuted : v >= 1.5 ? ARIA.purple : ARIA.textMuted;
  const colorCr = (v) =>
    v == null ? ARIA.textMuted : v >= 70 ? ARIA.green : v >= 40 ? ARIA.textDim : ARIA.red;
  const colorBo = (v) =>
    v == null || v === 0 ? ARIA.textMuted : v >= 7 ? ARIA.green : v >= 5 ? ARIA.blue : ARIA.textDim;
  const colorStr = (v) =>
    v == null ? ARIA.textMuted : v >= 65 ? ARIA.green : v >= 50 ? ARIA.blue : v >= 35 ? ARIA.yellow : ARIA.textDim;

  const chgKey = chgMode === "open" ? "chgOpen" : "change";
  const chgLabel = chgMode === "open" ? "Open%" : "Chg%";

  const bodyCell = {
    padding: "3px 6px",
    fontSize: 10,
    textAlign: "right",
    borderBottom: `1px solid ${ARIA.border}`,
    whiteSpace: "nowrap",
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ outline: "none" }}
    >
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "auto",
      }}
    >
      <thead
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          background: ARIA.bgCard,
        }}
      >
        <tr>
          <Th k="ticker" label="Ticker" align="left" sticky />
          <Th k="strScore" label="Str" />
          <Th k={chgKey} label={chgLabel} />
          <Th k="rvol" label="RV" />
          <Th k="liveVol" label="Vol" />
          <Th k="cr" label="CR%" />
          <Th k="adr" label="ADR" />
          <Th k="rs" label="EIF" />
          <Th k="chain" label="Chain" align="left" />
          <Th k="subtheme" label="Sub" align="left" />
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td
              colSpan={10}
              style={{
                padding: 12,
                textAlign: "center",
                color: ARIA.textMuted,
                fontSize: 10,
              }}
            >
              No results — adjust filters or wait for live data…
            </td>
          </tr>
        )}
        {rows.map((r) => {
          const chgVal = chgMode === "open" && r.chgOpen != null ? r.chgOpen : r.chg;
          const isSel = selectedTicker === r.ticker;
          const ownedBg = ownedTint(r.ticker, ARIA);
          const baseBg = isSel ? `${ARIA.cyan}26` : ownedBg;
          return (
            <tr
              key={r.ticker}
              data-ticker={r.ticker}
              onClick={() => {
                setSelectedTicker(r.ticker);
                onTickerClick && onTickerClick(r.ticker);
              }}
              style={{
                cursor: "pointer",
                background: baseBg,
              }}
              onMouseEnter={(e) => {
                if (!isSel) e.currentTarget.style.background = ARIA.bgHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = baseBg;
              }}
            >
              <td
                style={{
                  ...bodyCell,
                  textAlign: "left",
                  fontWeight: 700,
                  color: ARIA.text,
                  position: "sticky",
                  left: 0,
                  background: ARIA.bgCard,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  {r.ticker}
                  {r.is9m && (
                    <span
                      title="9M — today's volume ≥ 8.9M shares but avg < 8.9M (unusual institutional activity)"
                      style={{
                        fontSize: 7,
                        fontWeight: 800,
                        color: ARIA.yellow,
                        border: `1px solid ${ARIA.yellow}`,
                        background: `${ARIA.yellow}26`,
                        padding: "0 3px",
                        borderRadius: 2,
                      }}
                    >
                      9M
                    </span>
                  )}
                </span>
              </td>
              <td style={{ ...bodyCell, color: colorStr(r.strScore), fontWeight: 700 }}>
                {r.strScore != null ? r.strScore : "—"}
              </td>
              <td style={{ ...bodyCell, color: colorChg(chgVal) }}>
                {fmtPct(chgVal)}
              </td>
              <td style={{ ...bodyCell, color: colorRvol(r.rvol) }}>
                {r.rvol > 0 ? r.rvol.toFixed(1) + "x" : "—"}
              </td>
              <td style={{ ...bodyCell, color: ARIA.textDim, fontSize: 9 }}>
                {fmtVol(r.liveVol)}
              </td>
              <td style={{ ...bodyCell, color: colorCr(r.cr) }}>
                {r.cr != null ? r.cr + "%" : "—"}
              </td>
              <td style={{ ...bodyCell, color: ARIA.cyan }}>
                {r.adr ? r.adr.toFixed(1) + "%" : "—"}
              </td>
              <td
                style={{
                  ...bodyCell,
                  color:
                    r.rs >= 60 ? ARIA.green : r.rs >= 46 ? ARIA.blue : ARIA.textMuted,
                }}
              >
                {r.rs || "—"}
              </td>
              <td style={{ ...bodyCell, textAlign: "left", padding: "3px 4px", maxWidth: 100 }}>
                {(() => {
                  const entries = TICKER_CHAIN_MAP.get(r.ticker) || [];
                  if (!entries.length) return <span style={{ color: ARIA.textMuted, fontSize: 8 }}>—</span>;
                  return (
                    <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      {entries.map(({ themeId, layer }, i) => {
                        const c = DRAWER_COLORS[themeId] || { color: "#c0c0d8" };
                        return (
                          <span
                            key={i}
                            title={`${layer} — click to view ${themeId} chain`}
                            onClick={(e) => { e.stopPropagation(); onChainClick && onChainClick(themeId); }}
                            style={{
                              fontSize: 7,
                              color: c.color,
                              cursor: onChainClick ? "pointer" : "default",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: 100,
                            }}
                          >
                            {layer}
                          </span>
                        );
                      })}
                    </span>
                  );
                })()}
              </td>
              <td
                style={{
                  ...bodyCell,
                  textAlign: "left",
                  color: ARIA.cyan,
                  fontSize: 8,
                  maxWidth: 90,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  cursor: r.subtheme && onSubthemeClick ? "pointer" : "default",
                  textDecoration: r.subtheme && onSubthemeClick ? "underline" : "none",
                  textDecorationColor: `${ARIA.cyan}60`,
                }}
                title={r.subtheme ? `Drill down: ${r.subtheme}` : ""}
                onClick={(e) => {
                  if (r.subtheme && onSubthemeClick) {
                    e.stopPropagation();
                    onSubthemeClick(r.subtheme);
                  }
                }}
              >
                {r.subtheme || "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}



// (LWChart loader removed in Phase 2.7 — the legacy LWChart in
//  src/LWChartLegacy.jsx has its own loadLW() helper that we delegate to.)

// ──────────────────────────────────────────────────────────────────────────
// Server-side persistent state: analyzedPicks + watchlist + portfolio
// ──────────────────────────────────────────────────────────────────────────
//
// All three lists live in Vercel KV under one key, fetched/written via
// /api/userdata. localStorage is used as an offline cache so the UI loads
// instantly and survives offline reads, but the server is the source of
// truth across browser tabs/devices.
//
// Write strategy: optimistic local update → localStorage → debounced 1.5s
// server POST. Multiple updates within the debounce window collapse to a
// single round trip.

const SERVER_STATE_KEY = "themepulse-server-state";
const SERVER_DEBOUNCE_MS = 1500;
const ANALYZED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // mirrors server-side filter
const ANALYZED_MAX = 50;

function emptyServerState() {
  return { analyzedPicks: [], watchlist: [], portfolio: [], focus: [], ondeck: [], listOps: {}, wheelTrades: [], wheelClearedAt: null, updated_at: null };
}

function loadCachedState() {
  try {
    const raw = JSON.parse(localStorage.getItem(SERVER_STATE_KEY) || "null");
    if (raw && typeof raw === "object") {
      // Mirror server TTL on the cached read so stale picks vanish even
      // before the next server GET fires.
      const cutoff = Date.now() - ANALYZED_TTL_MS;
      raw.analyzedPicks = (raw.analyzedPicks || []).filter((p) => {
        if (!p || !p.analyzed_at) return false;
        const t = Date.parse(p.analyzed_at);
        return Number.isFinite(t) && t >= cutoff;
      });
      return { ...emptyServerState(), ...raw };
    }
  } catch {}
  return emptyServerState();
}

function saveCachedState(state) {
  try {
    localStorage.setItem(SERVER_STATE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("tp-server-state-changed"));
  } catch {}
}

// ── List sync: LWW-element-set ────────────────────────────────────────────
// Lists used to merge by UNION, which meant a delete could never propagate:
// any device/tab holding a stale cached list would re-add every ticker you
// had deleted and push it back to the server ("names I deleted keep coming
// back"). Now every add/remove writes a timestamped op to `listOps` keyed
// "field:TICKER"; merges take the NEWEST op per key and drop anything whose
// latest op is a delete. Adds still never get lost — a re-add is simply a
// newer op than the delete it supersedes.
const OPS_TTL_MS = 120 * 24 * 60 * 60 * 1000; // forget ops after ~4 months
const OPS_MAX = 800;

function mergeListOps(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (!out[k] || (v?.at || "") > (out[k]?.at || "")) out[k] = v;
  }
  const cutoff = new Date(Date.now() - OPS_TTL_MS).toISOString();
  const kept = Object.entries(out)
    .filter(([, v]) => v && v.at && v.at >= cutoff)
    .sort((x, y) => (y[1].at > x[1].at ? 1 : -1))
    .slice(0, OPS_MAX);
  return Object.fromEntries(kept);
}

// Drop items whose most recent op for this field is a delete.
function applyListOps(field, list, ops) {
  if (!ops) return list || [];
  return (list || []).filter((t) => ops[`${field}:${t}`]?.op !== "del");
}

// Record adds/removes by diffing a list mutation.
function opsForChange(field, prev, next, ops) {
  const before = new Set(prev || []);
  const after = new Set(next || []);
  const at = new Date().toISOString();
  const out = { ...(ops || {}) };
  before.forEach((t) => { if (!after.has(t)) out[`${field}:${t}`] = { op: "del", at }; });
  after.forEach((t) => { if (!before.has(t)) out[`${field}:${t}`] = { op: "add", at }; });
  return mergeListOps(out, {});
}

// Module-level singleton so all components share the same in-memory state.
//
// Race fix: a local mutation tick (`_localTick`) is bumped on every _setState.
// Any in-flight server response (pull OR push) that started before the tick
// was bumped is discarded — local edits win. This prevents the common race
// where the user clicks +WL right after page load and the initial /api/userdata
// GET returns a moment later with a stale state and clobbers the click.
let _moduleState = null;
let _moduleSubs = new Set();
let _debounceTimer = null;
let _localTick = 0;
let _pullPromise = null;

function _getState() {
  if (_moduleState === null) _moduleState = loadCachedState();
  return _moduleState;
}

function _notify() {
  for (const fn of _moduleSubs) fn(_moduleState);
}

function _setState(updater) {
  const cur = _getState();
  const next = typeof updater === "function" ? updater(cur) : updater;
  // Apply TTL on every write
  next.analyzedPicks = (next.analyzedPicks || [])
    .filter((p) => {
      if (!p || !p.analyzed_at) return false;
      const t = Date.parse(p.analyzed_at);
      return Number.isFinite(t) && t >= Date.now() - ANALYZED_TTL_MS;
    })
    .slice(0, ANALYZED_MAX);
  _moduleState = { ...cur, ...next, updated_at: new Date().toISOString() };
  _localTick++;
  saveCachedState(_moduleState);
  _notify();
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(_pushToServer, SERVER_DEBOUNCE_MS);
}

async function _pushToServer() {
  _debounceTimer = null;
  const s = _getState();
  const tickAtStart = _localTick;
  try {
    const r = await fetch("/api/userdata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analyzedPicks: s.analyzedPicks,
        watchlist: s.watchlist,
        portfolio: s.portfolio,
        focus: s.focus,
        ondeck: s.ondeck,
        listOps: s.listOps,
        wheelTrades: s.wheelTrades,
        wheelClearedAt: s.wheelClearedAt,
      }),
    });
    if (!r.ok) return;
    const d = await r.json();
    if (!d.ok) return;
    // Discard server echo if local state has been mutated again since we
    // started this push (avoids losing rapid sequential clicks).
    if (_localTick !== tickAtStart) return;
    _moduleState = {
      ...emptyServerState(),
      analyzedPicks: d.analyzedPicks || [],
      watchlist: d.watchlist || [],
      portfolio: d.portfolio || [],
      focus: d.focus || [],
      ondeck: d.ondeck || [],
      listOps: d.listOps || {},
      wheelTrades: d.wheelTrades || [],
      wheelClearedAt: d.wheelClearedAt || null,
      updated_at: d.updated_at || null,
    };
    saveCachedState(_moduleState);
    _notify();
  } catch {
    /* offline — keep optimistic local state */
  }
}

function _pullFromServer() {
  if (_pullPromise) return _pullPromise; // dedupe across mounts
  const tickAtStart = _localTick;
  _pullPromise = (async () => {
    try {
      const r = await fetch("/api/userdata", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (!d.ok) return;
      // If user mutated state while we were fetching, discard server snapshot.
      if (_localTick !== tickAtStart) return;
      const local = _getState();
      // Union the lists so an add is never lost, then let the merged op log
      // decide membership: anything whose newest op is a delete is dropped,
      // so a stale device can no longer resurrect deleted tickers (and a
      // re-add, being newer than its delete, still wins).
      const ops = mergeListOps(d.listOps, local.listOps);
      const union = (a, b) => { const s = new Set(a || []); (b || []).forEach((t) => s.add(t)); return [...s]; };
      const resolve = (field) => applyListOps(field, union(d[field], local[field]), ops);
      const mergedWl = resolve("watchlist");
      const mergedPf = resolve("portfolio");
      const mergedOd = resolve("ondeck");
      const mergedFocus = resolve("focus").filter((t) => !mergedOd.includes(t));
      // Push back if our view differs from the server's in either direction
      // (extra items to add, or deletes the server hasn't applied yet).
      const differs = (mine, theirs) => mine.length !== (theirs || []).length || mine.some((t) => !(theirs || []).includes(t));
      // Wheel trades are records, not tickers, so the op log doesn't apply:
      // union them with the same claim-once merge the import path uses, then
      // honour whichever device cleared most recently.
      const wheelClearedAt = newestStamp(d.wheelClearedAt, local.wheelClearedAt);
      const mergedWheel = applyClearTombstone(
        mergeTrades(d.wheelTrades || [], local.wheelTrades || []).trades,
        wheelClearedAt
      );
      const serverStale =
        differs(mergedWl, d.watchlist) || differs(mergedPf, d.portfolio) ||
        differs(mergedFocus, d.focus) || differs(mergedOd, d.ondeck) ||
        mergedWheel.length !== (d.wheelTrades || []).length ||
        wheelClearedAt !== (d.wheelClearedAt || null);
      _moduleState = {
        ...emptyServerState(),
        analyzedPicks: d.analyzedPicks || [],
        watchlist: mergedWl,
        portfolio: mergedPf,
        focus: mergedFocus,
        ondeck: mergedOd,
        listOps: ops,
        wheelTrades: mergedWheel,
        wheelClearedAt,
        updated_at: d.updated_at || null,
      };
      saveCachedState(_moduleState);
      _notify();
      if (serverStale) {
        if (_debounceTimer) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(_pushToServer, 800);
      }
    } catch {
      /* offline — keep cached state */
    }
  })();
  return _pullPromise;
}

function useServerState() {
  const [state, setStateLocal] = useState(_getState);
  useEffect(() => {
    _moduleSubs.add(setStateLocal);
    // Pull once per page-load (module-scoped promise dedupes).
    _pullFromServer();
    const onStorage = () => {
      _moduleState = loadCachedState();
      setStateLocal(_moduleState);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("tp-server-state-changed", onStorage);
    return () => {
      _moduleSubs.delete(setStateLocal);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("tp-server-state-changed", onStorage);
    };
  }, []);
  return state;
}

// ──────────────────────────────────────────────────────────────────────────
// Analyzed picks: on-demand 4-agent analysis stored in localStorage
// ──────────────────────────────────────────────────────────────────────────
//
// User clicks "Analyze" on a ticker → POST to /api/analyze-ticker → result
// is prepended to the local list (cap 50, dedupe by ticker, newest first).
// The Agent Picks subtab renders this list under a new "Analyzed" tab.

function useAnalyzedPicks() {
  const state = useServerState();
  const list = state.analyzedPicks || [];
  const addPick = useCallback((pick) => {
    if (!pick || !pick.ticker) return;
    _setState((s) => {
      const filtered = (s.analyzedPicks || []).filter((p) => p.ticker !== pick.ticker);
      return { ...s, analyzedPicks: [pick, ...filtered] };
    });
  }, []);
  const removePick = useCallback((ticker) => {
    _setState((s) => ({
      ...s,
      analyzedPicks: (s.analyzedPicks || []).filter((p) => p.ticker !== ticker),
    }));
  }, []);
  return { list, addPick, removePick };
}

// Triggers a /api/analyze-ticker call and on success appends to the list.
// Returns { isAnalyzing, error, analyze(ticker) }.
function useAnalyzer() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [activeTicker, setActiveTicker] = useState(null);
  const { addPick } = useAnalyzedPicks();
  const analyze = useCallback(
    async (ticker) => {
      if (!ticker || isAnalyzing) return null;
      setIsAnalyzing(true);
      setActiveTicker(ticker.toUpperCase());
      setError(null);
      try {
        const r = await fetch("/api/analyze-ticker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: ticker.toUpperCase() }),
        });
        const d = await r.json();
        if (!r.ok || !d.ok) {
          setError(d.error || `HTTP ${r.status}`);
          return null;
        }
        addPick(d.pick);
        return d.pick;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        setIsAnalyzing(false);
        setActiveTicker(null);
      }
    },
    [isAnalyzing, addPick]
  );
  return { isAnalyzing, activeTicker, error, analyze };
}

// Cross-component pub/sub for portfolio + watchlist sync. Whenever any
// component mutates `themepulse-portfolio` or `themepulse-watchlist` in
// localStorage, it dispatches `tp-pw-changed` so all subscribers re-read.
function useLocalStorageList(key) {
  const state = useServerState();
  const field =
    key === "themepulse-watchlist"
      ? "watchlist"
      : key === "themepulse-portfolio"
      ? "portfolio"
      : key === "themepulse-focus"
      ? "focus"
      : key === "themepulse-ondeck"
      ? "ondeck"
      : null;
  const list = field ? state[field] || [] : [];
  const update = useCallback(
    (next) => {
      if (!field) return;
      _setState((s) => {
        const cur = s[field] || [];
        const value = typeof next === "function" ? next(cur) : next;
        return { ...s, [field]: value, listOps: opsForChange(field, cur, value, s.listOps) };
      });
    },
    [field]
  );
  return [list, update];
}

// Subtle row tint for tickers already in portfolio (yellow) or watchlist
// (green). Used across every ticker-listing table so owned positions are
// visible at a glance without adding duplicates. ~12% alpha (`1f`) — PF wins
// when a ticker is in both lists. Returns fn(ticker, ARIA) -> css background.
function useOwnedTint() {
  const [portfolio] = useLocalStorageList("themepulse-portfolio");
  const [watchlist] = useLocalStorageList("themepulse-watchlist");
  const [focus] = useLocalStorageList("themepulse-focus");
  const [ondeck] = useLocalStorageList("themepulse-ondeck");
  return useMemo(() => {
    const pf = new Set(portfolio);
    const wl = new Set(watchlist);
    const fc = new Set(focus);
    const od = new Set(ondeck);
    return (ticker, ARIA) => {
      if (!ticker) return "transparent";
      if (od.has(ticker)) return `${ARIA.gold}2e`;
      if (pf.has(ticker)) return `${ARIA.yellow}1f`;
      if (fc.has(ticker)) return `${ARIA.cyan}1f`;
      if (wl.has(ticker)) return `${ARIA.green}1f`;
      return "transparent";
    };
  }, [portfolio, watchlist, focus, ondeck]);
}

// On Deck membership as a Set — for tables that tint rows without the full
// owned-tint hook (RsTable, constituents strip, watch panel). Gold beats all.
function useOnDeckSet() {
  const [ondeck] = useLocalStorageList("themepulse-ondeck");
  return useMemo(() => new Set(ondeck), [ondeck]);
}

// Aria-style colored mini-badge (used in chart header for 9M / VOL / HI / Grade)
const badgeStyle = (color) => ({
  fontSize: 9,
  padding: "0 3px",
  borderRadius: 2,
  fontWeight: 700,
  color,
  border: `1px solid ${color}`,
  background: `${color}26`,
  marginLeft: 3,
});

// CANSLIM stat: "<label> <value>%" with muted label and colored value
function CSStat({ label, v, clr, ARIA }) {
  const val = v != null ? (v > 0 ? "+" : "") + v.toFixed(0) + "%" : "—";
  return (
    <span>
      <span style={{ color: ARIA.textMuted, fontSize: 8 }}>{label}</span>{" "}
      <span style={{ color: clr, fontWeight: 600 }}>{val}</span>
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SubthemePerformance — THEMES tab inside ChartPanelInline right pane
// ──────────────────────────────────────────────────────────────────────────
function SubthemePerformance({ stockMap, themeHealth, onTickerClick }) {
  const ARIA = useAriaTheme();
  const [sortKey, setSortKey] = useState("avg_rs");
  const [sortDir, setSortDir] = useState("desc");
  const [search, setSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState(null);

  // Live quotes for all themed tickers — feeds both aggregate rows and expanded rows
  const allThemedTickers = useMemo(
    () => Object.values(stockMap || {}).filter((s) => s.themes?.length).map((s) => s.ticker),
    [stockMap]
  );
  const { quotes: liveQuotes } = useLiveQuotes(allThemedTickers, 30000);

  const handleSort = useCallback((key) => {
    setSortKey((prev) => {
      if (prev === key) { setSortDir((d) => d === "desc" ? "asc" : "desc"); return key; }
      setSortDir("desc");
      return key;
    });
  }, []);

  // Theme abbreviations for compact badge display
  const ABBREV = {
    "AI INFRASTRUCTURE": "AI",
    "SEMICONDUCTORS": "SEMI",
    "PHOTONICS": "PHO",
    "AUTONOMOUS SYSTEMS": "AUTO",
    "ROBOTICS": "ROBO",
    "CYBERSECURITY": "CYBER",
    "CLOUD": "CLD",
    "FINTECH": "FIN",
    "BIOTECH": "BIO",
    "HEALTHCARE": "HLTH",
    "DEFENSE": "DEF",
    "SPACE": "SPC",
    "ENERGY": "NRG",
    "POWER GRID": "PWR",
    "CONSUMER": "CON",
    "INDUSTRIALS": "IND",
    "TELECOM": "TEL",
    "MEDIA": "MED",
    "SOCIAL MEDIA": "SOC",
    "REAL ESTATE": "RE",
    "MATERIALS": "MAT",
    "TRANSPORTATION": "TRN",
    "GAMING": "GAME",
    "RETAIL": "RTL",
    "COMMODITIES": "CMDTY",
    "FINANCIAL": "FIN",
    "SOFTWARE": "SWF",
  };

  // Theme colors for badges
  const TCOLORS = {
    "AI INFRASTRUCTURE": "#a78bfa",
    "SEMICONDUCTORS": "#60a5fa",
    "PHOTONICS": "#34d399",
    "AUTONOMOUS SYSTEMS": "#f59e0b",
    "ROBOTICS": "#f59e0b",
    "CYBERSECURITY": "#f87171",
    "CLOUD": "#38bdf8",
    "FINTECH": "#4ade80",
    "BIOTECH": "#e879f9",
    "HEALTHCARE": "#e879f9",
    "DEFENSE": "#94a3b8",
    "SPACE": "#818cf8",
    "ENERGY": "#fb923c",
    "POWER GRID": "#fbbf24",
    "CONSUMER": "#a3e635",
    "INDUSTRIALS": "#6b7280",
    "TELECOM": "#22d3ee",
    "MEDIA": "#f472b6",
    "SOCIAL MEDIA": "#f472b6",
    "REAL ESTATE": "#a16207",
    "MATERIALS": "#84cc16",
    "TRANSPORTATION": "#6b7280",
    "GAMING": "#c084fc",
    "RETAIL": "#86efac",
    "COMMODITIES": "#d97706",
    "FINANCIAL": "#4ade80",
    "SOFTWARE": "#60a5fa",
  };

  // Build subtheme stats from stockMap
  const subthemeData = useMemo(() => {
    const map = {};
    const stocks = Object.values(stockMap || {});
    stocks.forEach((s) => {
      if (!s.themes) return;
      s.themes.forEach(({ theme, subtheme }) => {
        if (!theme || !subtheme) return;
        const key = `${theme}|||${subtheme}`;
        if (!map[key]) {
          map[key] = {
            theme,
            subtheme,
            tickers: [],
            rs_sum: 0,
            chg_sum: 0,
            rvol_max: null,
            m1_sum: 0,
            m3_sum: 0,
            above50_count: 0,
            count: 0,
          };
        }
        const d = map[key];
        const q = liveQuotes.get(s.ticker);
        const liveVol = q?.volume ?? null;
        const avgVol = s.avg_volume_raw || q?.avgVolume || 0;
        const rvol = liveVol && avgVol > 0 ? liveVol / avgVol : null;
        d.tickers.push({ ticker: s.ticker, rs: s.framework_score ?? s.rs_rank ?? 0 });
        d.rs_sum += s.framework_score ?? s.rs_rank ?? 0;
        d.chg_sum += q?.change ?? s.change_pct ?? 0;
        if (rvol !== null && (d.rvol_max === null || rvol > d.rvol_max)) d.rvol_max = rvol;
        d.m1_sum += s.return_1m || 0;
        d.m3_sum += s.return_3m || 0;
        if (s.above_50ma) d.above50_count++;
        d.count++;
      });
    });

    return Object.values(map).map((d) => {
      const n = d.count;
      const stocksSorted = [...d.tickers].sort((a, b) => b.rs - a.rs);
      return {
        theme: d.theme,
        subtheme: d.subtheme,
        count: n,
        avg_rs: n ? Math.round(d.rs_sum / n) : 0,
        avg_chg: n ? +(d.chg_sum / n).toFixed(2) : 0,
        avg_rvol: d.rvol_max !== null ? +d.rvol_max.toFixed(2) : null,
        avg_1m: n ? +(d.m1_sum / n).toFixed(2) : 0,
        avg_3m: n ? +(d.m3_sum / n).toFixed(2) : 0,
        pct_above50: n ? Math.round((d.above50_count / n) * 100) : 0,
        stocks: stocksSorted,
      };
    });
  }, [stockMap, liveQuotes]);

  // Build theme-level health map from themeHealth array
  const themeHealthMap = useMemo(() => {
    const m = {};
    (themeHealth || []).forEach((th) => {
      m[th.theme] = th;
    });
    return m;
  }, [themeHealth]);

  // Column definitions — keep narrow so subtheme name has room
  const COLS = [
    { key: "avg_rs",      label: "EIF",   w: 26, align: "right" },
    { key: "avg_chg",     label: "DAY",   w: 40, align: "right", live: true },
    { key: "avg_rvol",    label: "MaxRV", w: 38, align: "right", live: true },
    { key: "avg_1m",      label: "1M",   w: 40, align: "right" },
    { key: "avg_3m",      label: "3M",   w: 40, align: "right" },
    { key: "count",       label: "#",    w: 16, align: "right" },
  ];

  const sorted = useMemo(() => {
    const filtered = search
      ? subthemeData.filter(
          (d) =>
            d.subtheme.toLowerCase().includes(search.toLowerCase()) ||
            d.theme.toLowerCase().includes(search.toLowerCase())
        )
      : subthemeData;
    return [...filtered].sort((a, b) => {
      if (sortKey === "subtheme_name") {
        const cmp = a.subtheme.localeCompare(b.subtheme);
        return sortDir === "desc" ? -cmp : cmp;
      }
      const va = a[sortKey] ?? 0;
      const vb = b[sortKey] ?? 0;
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [subthemeData, sortKey, sortDir, search]);

  const fmt = (v) => (v === undefined || v === null) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
  const fmtColor = (v) => v > 0 ? "#4ade80" : v < 0 ? "#f87171" : ARIA.textMuted;

  const cellVal = (d, key) => {
    if (key === "avg_rs") return d.avg_rs;
    if (key === "count") return d.count;
    if (key === "avg_rvol") return d.avg_rvol != null ? d.avg_rvol.toFixed(1) + "x" : "—";
    if (key === "pct_above50") return d.pct_above50 + "%";
    return fmt(d[key]);
  };
  const cellColor = (d, key) => {
    if (key === "avg_rs") return d.avg_rs >= 90 ? "#4ade80" : d.avg_rs >= 70 ? "#a3e635" : d.avg_rs >= 50 ? ARIA.text : ARIA.textMuted;
    if (key === "count") return ARIA.textMuted;
    if (key === "avg_rvol") return d.avg_rvol >= 2 ? "#4ade80" : d.avg_rvol >= 1 ? ARIA.text : ARIA.textMuted;
    if (key === "pct_above50") return d.pct_above50 >= 70 ? "#4ade80" : d.pct_above50 >= 40 ? ARIA.textMuted : "#f87171";
    return fmtColor(d[key]);
  };

  const SortHdr = ({ col }) => {
    const active = sortKey === col.key;
    const arrow = active ? (sortDir === "desc" ? " ▼" : " ▲") : "";
    return (
      <span
        onClick={() => handleSort(col.key)}
        style={{
          width: col.w,
          flexShrink: 0,
          fontSize: 8,
          fontFamily: "monospace",
          fontWeight: 700,
          color: active ? ARIA.green : ARIA.textMuted,
          textAlign: col.align,
          cursor: "pointer",
          userSelect: "none",
          paddingRight: col.align === "right" ? 0 : undefined,
        }}
      >
        {col.label}{col.live && liveQuotes.size > 0 ? "·" : ""}{arrow}
      </span>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Search bar */}
      <div
        style={{
          padding: "5px 8px",
          flexShrink: 0,
          borderBottom: `1px solid ${ARIA.border}`,
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter theme / subtheme..."
          style={{
            fontSize: 9, padding: "2px 6px", background: ARIA.bgCard,
            border: `1px solid ${ARIA.border}`, borderRadius: 3,
            color: ARIA.text, fontFamily: "monospace", flex: 1, outline: "none",
          }}
        />
        <span style={{ fontSize: 9, color: ARIA.textMuted, flexShrink: 0 }}>
          {sorted.length}
        </span>
      </div>

      {/* Sticky column header */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 3,
          padding: "3px 8px",
          borderBottom: `1px solid ${ARIA.border}`,
          background: ARIA.bgCard,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <span
          onClick={() => handleSort("subtheme_name")}
          style={{ flex: 1, minWidth: 0, fontSize: 8, color: sortKey === "subtheme_name" ? ARIA.green : ARIA.textMuted, fontFamily: "monospace", cursor: "pointer", userSelect: "none", overflow: "hidden", whiteSpace: "nowrap" }}
        >
          SUBTHEME{sortKey === "subtheme_name" ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
        </span>
        {COLS.map((col) => <SortHdr key={col.key} col={col} />)}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {sorted.map((d) => {
          const key = `${d.theme}|||${d.subtheme}`;
          const isOpen = expandedKey === key;
          return (
            <div key={key} style={{ borderBottom: `1px solid ${ARIA.border}18` }}>
              {/* Subtheme row */}
              <div
                onClick={() => setExpandedKey(isOpen ? null : key)}
                style={{
                  display: "flex", alignItems: "center", gap: 3,
                  padding: "2px 8px",
                  minHeight: 22,
                  overflow: "hidden",
                  cursor: "pointer",
                  background: isOpen ? ARIA.green + "08" : "transparent",
                }}
              >
                <span style={{ width: 10, flexShrink: 0, fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace" }}>
                  {isOpen ? "▼" : "▶"}
                </span>
                <span
                  style={{
                    flex: 1, minWidth: 0, fontSize: 9,
                    color: isOpen ? ARIA.green : ARIA.text,
                    fontFamily: "monospace", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontWeight: isOpen ? 700 : 400,
                  }}
                >
                  {d.subtheme}
                </span>
                {COLS.map((col) => (
                  <span
                    key={col.key}
                    onClick={(e) => { e.stopPropagation(); handleSort(col.key); }}
                    style={{
                      width: col.w, flexShrink: 0,
                      fontSize: 9, fontFamily: "monospace",
                      fontWeight: sortKey === col.key ? 700 : 400,
                      color: cellColor(d, col.key),
                      textAlign: col.align,
                      background: sortKey === col.key ? ARIA.green + "10" : "transparent",
                    }}
                  >
                    {cellVal(d, col.key)}
                  </span>
                ))}
              </div>

              {/* Expanded stock list — columns mirror the subtheme header */}
              {isOpen && (
                <div style={{ background: ARIA.bgCard, borderTop: `1px solid ${ARIA.border}30` }}>
                  {d.stocks.map(({ ticker }) => {
                    const s = stockMap[ticker];
                    if (!s) return null;
                    const q = liveQuotes.get(ticker);
                    const liveVol = q?.volume ?? null;
                    const avgVol = s.avg_volume_raw || q?.avgVolume || 0;
                    const rvol = liveVol && avgVol > 0 ? liveVol / avgVol : null;
                    const stockVals = {
                      avg_rs:   s.framework_score ?? s.rs_rank ?? 0,
                      avg_chg:  q?.change ?? s.change_pct ?? 0,
                      avg_rvol: rvol,
                      avg_1m:   s.return_1m ?? 0,
                      avg_3m:   s.return_3m ?? 0,
                      count:    null,
                    };
                    return (
                      <div
                        key={ticker}
                        onClick={() => onTickerClick && onTickerClick(ticker)}
                        style={{
                          display: "flex", alignItems: "center", gap: 3,
                          padding: "2px 8px",
                          cursor: "pointer",
                          borderBottom: `1px solid ${ARIA.border}10`,
                          overflow: "hidden",
                        }}
                      >
                        {/* Arrow indent + ticker + company — same flex space as subtheme name */}
                        <span style={{ width: 10, flexShrink: 0 }} />
                        <span style={{ width: 38, flexShrink: 0, fontSize: 9, fontFamily: "monospace", fontWeight: 700, color: ARIA.cyan || "#22d3ee" }}>
                          {ticker}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.company || ""}
                        </span>
                        {/* Numeric columns matching COLS widths exactly */}
                        {COLS.map((col) => {
                          if (col.key === "count") {
                            return <span key={col.key} style={{ width: col.w, flexShrink: 0 }} />;
                          }
                          const v = stockVals[col.key];
                          const isRs = col.key === "avg_rs";
                          const isRvol = col.key === "avg_rvol";
                          const color = isRs
                            ? v >= 90 ? "#4ade80" : v >= 70 ? "#a3e635" : v >= 50 ? ARIA.text : ARIA.textMuted
                            : isRvol
                            ? v >= 2 ? "#4ade80" : v >= 1 ? ARIA.text : ARIA.textMuted
                            : v > 0 ? "#4ade80" : v < 0 ? "#f87171" : ARIA.textMuted;
                          const label = isRs ? (v || "—") : isRvol ? (v != null ? v.toFixed(1) + "x" : "—") : ((v >= 0 ? "+" : "") + (v ?? 0).toFixed(1) + "%");
                          return (
                            <span key={col.key} style={{ width: col.w, flexShrink: 0, fontSize: 9, fontFamily: "monospace", textAlign: "right", color, fontWeight: sortKey === col.key ? 700 : 400 }}>
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: ARIA.textMuted, fontSize: 11, fontFamily: "monospace" }}>
            no subthemes
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ChartPanelInline — Aria-faithful inline chart panel
// ──────────────────────────────────────────────────────────────────────────
//
// Replaces the slide-in TradingView iframe with Aria's actual layout:
//   - Header: ticker, OHLC display, +WL/+PF buttons, D/W toggles, 5m/30m
//     toggles, ticker input
//   - Body: dual pane — Daily/Weekly chart (flex 7) | 5m/30m intraday (flex 3)
//   - Always visible at the top of the dashboard, next to Scan Watch
//
// Aria reference: dashboard.html lines 3725-3791

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
function gradeColor(letter, ARIA) {
  if (letter === "A+" || letter === "A") return ARIA.green;
  if (letter === "B") return ARIA.blue;
  if (letter === "C") return ARIA.yellow;
  if (letter === "D") return "#f59e0b";
  if (letter === "F") return ARIA.red;
  return ARIA.textMuted;
}
// Compact CANSLIM composite (letter A+..F) from synchronously-available
// fields — same gradeBand thresholds as the full IBD scorecard, dropping
// the async 12mo-RS and CF-vs-EPS criteria. Used in the chart panel's perf bar.
function canslimComposite(stockInfo, annuals, stockMap) {
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
const fmtPct = (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";

// EPS & Revenue estimate percentile ranks — same logic as leaderboard drawer
function PctileRanks({ ticker, stockMap, ARIA }) {
  const { epsPct, revPct } = useMemo(() => {
    if (!stockMap || !ticker) return {};
    const s = stockMap[ticker];
    if (!s) return {};
    const epsVals = [], revVals = [];
    Object.values(stockMap).forEach((st) => {
      if (st.eps_estimated != null && Number.isFinite(st.eps_estimated)) epsVals.push(st.eps_estimated);
      if (st.revenue_estimated > 0) revVals.push(st.revenue_estimated);
    });
    epsVals.sort((a, b) => a - b);
    revVals.sort((a, b) => a - b);
    const rank = (sorted, val) => {
      if (!sorted.length || val == null) return null;
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < val) lo = mid + 1; else hi = mid; }
      return Math.round((lo / sorted.length) * 100);
    };
    return { epsPct: rank(epsVals, s.eps_estimated), revPct: rank(revVals, s.revenue_estimated) };
  }, [ticker, stockMap]);

  if (epsPct == null && revPct == null) return null;

  const ordinal = (n) => { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const pColor = (p) => p >= 90 ? "#4ae8a0" : p >= 70 ? "#22d3ee" : p >= 40 ? "#b0b0c0" : "#e06060";
  const pBg = (p) => p >= 90 ? "rgba(13,145,99,0.25)" : p >= 70 ? "rgba(34,211,238,0.2)" : p >= 40 ? "rgba(144,144,160,0.2)" : "rgba(200,80,80,0.2)";
  const badge = (label, pct) => pct == null ? null : (
    <span style={{ fontSize: 7, padding: "1px 5px", borderRadius: 3, fontFamily: "monospace", fontWeight: 700, background: pBg(pct), color: pColor(pct) }}>
      {label} {ordinal(pct)} %ile
    </span>
  );

  return (
    <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "center", gap: 4, marginTop: 3 }}>
      {badge("EPS", epsPct)}
      {badge("Rev", revPct)}
    </div>
  );
}

// Mini bar chart — one series (EPS or Revenue) across N quarters. Pure CSS:
// each quarter is a flex column with value on top, bar, YoY%, and quarter
// label beneath. Scales proportionally; baseline drops below zero when any
// value is negative (handles EPS loss quarters).
function MiniQBars({ quarters, accessor, yoyAccessor, color, labelFmt, title, ARIA, passYoy, hotYoy }) {
  const values = quarters.map(accessor).filter((v) => v != null && Number.isFinite(v));
  if (values.length === 0) return null;
  // Bars scale by the %-CHANGE (YoY / delta), not the metric's level — the
  // acceleration is the signal; the level lives in the label above each bar.
  // Falls back to level-scaling when no change series exists (first quarters).
  const pcts = yoyAccessor ? quarters.map(yoyAccessor).filter((v) => v != null && Number.isFinite(v)) : [];
  const scaleByPct = pcts.length > 0;
  const scaleVals = scaleByPct ? pcts : values;
  const max = Math.max(...scaleVals, 0);
  const min = Math.min(...scaleVals, 0);
  const range = max - min || 1;
  const barAreaH = 52;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          fontSize: 7,
          color: ARIA.textMuted,
          marginBottom: 4,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontWeight: 700,
          fontFamily: "monospace",
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "flex",
          gap: 3,
          alignItems: "stretch",
          fontFamily: "monospace",
        }}
      >
        {quarters.map((q, i) => {
          const v = accessor(q);
          const yoy = yoyAccessor ? yoyAccessor(q) : null;
          const yoyColor =
            yoy == null ? ARIA.textMuted : yoy >= 0 ? ARIA.green : ARIA.red;
          const sv = scaleByPct ? yoy : v;
          const hPos = sv == null || sv <= 0 ? 0 : (sv / range) * barAreaH;
          const hNeg = sv == null || sv >= 0 ? 0 : (Math.abs(sv) / range) * barAreaH;
          const zeroLine = (max / range) * barAreaH; // space above zero
          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                minWidth: 0,
              }}
            >
              <div
                title={q._code33 ? "Minervini Code 33 — 3 consecutive periods of accelerating EPS, Sales, and Margin" : undefined}
                style={{
                  fontSize: 8,
                  // Match EPS badge color tiers so each bar's value flags at a
                  // glance whether that period clears the growth threshold.
                  color:
                    yoy == null
                      ? ARIA.text
                      : hotYoy != null && yoy >= hotYoy
                      ? "#f59e0b"
                      : passYoy != null && yoy >= passYoy
                      ? ARIA.blue
                      : ARIA.text,
                  fontWeight: 700,
                  lineHeight: 1,
                  // Code 33 border — gold outline on qualifying periods
                  ...(q._code33
                    ? {
                        border: `1px solid ${ARIA.yellow}`,
                        borderRadius: 3,
                        padding: "1px 3px",
                        boxShadow: `0 0 4px ${ARIA.yellow}60`,
                      }
                    : {}),
                }}
              >
                {v == null ? "—" : labelFmt(v)}
              </div>
              {/* Bar area: zero line at (max/range) of height; positive bars
                  grow up from zero line, negative bars drop below it. */}
              <div
                style={{
                  width: "70%",
                  height: barAreaH,
                  marginTop: 2,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: zeroLine,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: "#ffffff30",
                  }}
                />
                {hPos > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: barAreaH - zeroLine,
                      left: 0,
                      right: 0,
                      height: hPos,
                      background: color,
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                )}
                {hNeg > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: zeroLine,
                      left: 0,
                      right: 0,
                      height: hNeg,
                      background: ARIA.red,
                      borderRadius: "0 0 2px 2px",
                      opacity: 0.8,
                    }}
                  />
                )}
              </div>
              <div
                style={{
                  fontSize: 7,
                  color: yoyColor,
                  lineHeight: 1,
                  marginTop: 2,
                  fontWeight: 600,
                }}
              >
                {yoy == null ? "" : (yoy >= 0 ? "+" : "") + yoy.toFixed(0) + "%"}
              </div>
              <div
                style={{
                  fontSize: 7,
                  color: ARIA.textMuted,
                  marginTop: 1,
                  whiteSpace: "nowrap",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  fontWeight: 700,
                  fontFamily: "monospace",
                }}
              >
                {q.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact inline line chart showing the trailing 20d-rolling dollar-volume
// average for a ticker. Data comes from /dollar_vol_history.json (pipeline
// step 09e_dvol_history.py). Renders as pure SVG — no chart library.
// Top row surfaces a classification tag (ACCUM / BUILDING / STEADY / SOFT /
// DRYING) derived from the 90d ADV slope against the empirical universe
// distribution (ACCUM = top ~5%, DRYING = bottom ~5%).
function DvolSparkline({ ticker, history, ARIA, width = 320, height = 52 }) {
  if (!history || !ticker) return null;
  const entry = history.tickers && history.tickers[ticker];
  if (!entry || !Array.isArray(entry.adv_m) || entry.adv_m.length < 5) return null;

  const series = entry.adv_m;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;

  // Padding for y-axis label
  const padLeft = 4;
  const padRight = 4;
  const padTop = 6;
  const padBottom = 10;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const x = (i) => padLeft + (i / (series.length - 1)) * innerW;
  const y = (v) => padTop + innerH - ((v - min) / range) * innerH;

  const pathD = series
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");

  const first = series[0];
  const last = series[series.length - 1];
  const pctChg = first > 0 ? ((last - first) / first) * 100 : 0;
  const color = pctChg >= 0 ? ARIA.green : ARIA.red;
  const fmtM = (v) =>
    v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`;

  // Accumulation classification — translate the 90d slope into a one-word
  // verdict a momentum trader can act on. Thresholds calibrated against the
  // empirical cross-sectional distribution so ACCUM only fires on the top
  // ~5% (20d ADV roughly tripled) and DRYING on the bottom ~5%.
  const { tag, tagColor } = (() => {
    if (pctChg >= 200) return { tag: "ACCUM", tagColor: ARIA.green };
    if (pctChg >= 50) return { tag: "BUILDING", tagColor: ARIA.blue };
    if (pctChg >= -25) return { tag: "STEADY", tagColor: ARIA.textMuted };
    if (pctChg >= -50) return { tag: "SOFT", tagColor: ARIA.textDim };
    return { tag: "DRYING", tagColor: ARIA.red };
  })();


  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        padding: "2px 0 0",
        fontFamily: "monospace",
        lineHeight: 1,
      }}
      title={`20-day rolling avg dollar volume over the trailing ${series.length} days (from ${entry.start}). Range ${fmtM(min)} → ${fmtM(max)}. 90d slope ${pctChg >= 0 ? "+" : ""}${pctChg.toFixed(1)}% = ${tag}. Calibrated to universe: ACCUM ≥+200% (top 5%, ADV tripled), BUILDING +50 to +200%, STEADY -25 to +50% (normal), SOFT -50 to -25%, DRYING ≤-50% (bottom 5%).`}
    >
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "baseline",
          fontSize: 10,
        }}
      >
        <span style={{ color: ARIA.text, fontWeight: 700 }}>{fmtM(last)}</span>
        <span style={{ color, fontWeight: 700 }}>
          {pctChg >= 0 ? "+" : ""}
          {pctChg.toFixed(1)}%
        </span>
        <span
          style={{
            padding: "0 4px",
            borderRadius: 2,
            fontSize: 8,
            fontWeight: 700,
            background: tagColor + "22",
            color: tagColor,
            border: `1px solid ${tagColor}55`,
            letterSpacing: 0.5,
          }}
        >
          {tag}
        </span>
      </div>
      <svg width={width} height={height} style={{ display: "block" }}>
        {/* baseline */}
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={padTop + innerH}
          y2={padTop + innerH}
          stroke={ARIA.border}
          strokeWidth={0.5}
        />
        {/* area fill */}
        <path
          d={`${pathD} L${x(series.length - 1).toFixed(1)},${(padTop + innerH).toFixed(1)} L${padLeft},${(padTop + innerH).toFixed(1)} Z`}
          fill={color}
          fillOpacity={0.12}
        />
        {/* line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth={1.25} />
        {/* last-point dot */}
        <circle cx={x(series.length - 1)} cy={y(last)} r={1.8} fill={color} />
      </svg>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DailyChartSVG — inline SVG candlestick chart with MAs, volume overlays,
// Wilder's smoothed ATR — identical to ThinkScript ta.atr / Pine ta.atr.
function calcWilderATR(bars, period = 14) {
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
function calcRiskSize(stopPrice, entryPrice, accountSize, riskPct, maxAllocPct) {
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

// ──────────────────────────────────────────────────────────────────────────
// pocket pivots, VCP tightness, +4% breakout hatching, dry-up dots, and
// earnings markers. Ported from theme-leaderboard.html renderDailyChart.
// ──────────────────────────────────────────────────────────────────────────
function DailyChartSVG({ ohlc, quarters, height = 400, stopLines = [], owned = false, rsRating = null, rsRatingColor = null }) {
  const MAX_BARS = 375;
  const DEFAULT_BARS = 113;
  const MIN_VISIBLE = 30;

  // Visible window: endIdx is always the right edge (exclusive), visibleCount is how many bars to show
  const [visibleCount, setVisibleCount] = useState(DEFAULT_BARS);
  const [endIdx, setEndIdx] = useState(null);
  const svgRef = React.useRef(null);
  const containerRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [containerW, setContainerW] = useState(900);
  const [containerH, setContainerH] = useState(380);
  const [volSubTab, setVolSubTab] = useState("vol");
  const [hoverI, setHoverI] = useState(null); // crosshair bar index (visible window)
  const CH_ARIA = useAriaTheme();
  const [showRS, setShowRS] = useState(() => { try { return localStorage.getItem("tp-chart-rs") !== "0"; } catch { return true; } });
  const benchMap = useSpyCloses();

  // Measure container width + height (chart price panel grows to fill height)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      const h = entries[0]?.contentRect?.height;
      if (w && w > 0) setContainerW(Math.round(w));
      if (h && h > 0) setContainerH(Math.round(h));
    });
    ro.observe(el);
    setContainerW(Math.round(el.offsetWidth) || 900);
    if (el.offsetHeight > 0) setContainerH(Math.round(el.offsetHeight));
    return () => ro.disconnect();
  }, []);

  // Reset view when ticker changes (ohlc reference changes)
  useEffect(() => {
    setVisibleCount(DEFAULT_BARS);
    setEndIdx(null);
  }, [ohlc]);

  // Pre-compute MAs and VCP scores on the full dataset (expensive, only when ohlc changes)
  const precomputed = useMemo(() => {
    if (!ohlc || !ohlc.length) return null;
    const calcEMA = (arr, n) => {
      const k = 2 / (n + 1), out = [];
      let prev = null;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] == null) { out.push(null); continue; }
        if (prev == null) {
          if (i < n - 1) { out.push(null); continue; }
          let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j];
          prev = s / n; out.push(prev);
        } else { prev = arr[i] * k + prev * (1 - k); out.push(prev); }
      }
      return out;
    };
    const calcSMA = (arr, n) => {
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        if (i < n - 1) { out.push(null); continue; }
        let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j];
        out.push(s / n);
      }
      return out;
    };
    const fullC = ohlc.map(b => b.close), fullH = ohlc.map(b => b.high), fullL = ohlc.map(b => b.low);
    const fullV = ohlc.map(b => b.volume || 0);

    // VCP scores for the full dataset
    const vcpScores = new Array(ohlc.length).fill(null);
    const TIGHT_LB = 5, ADR_LB = 20, HIST_LB = 50;
    for (let i = 0; i < ohlc.length; i++) {
      if (i < Math.max(TIGHT_LB, ADR_LB) - 1) continue;
      let adrSum = 0, adrCount = 0;
      for (let j = i - ADR_LB + 1; j <= i; j++) {
        if (j < 0) continue;
        const mid = (ohlc[j].high + ohlc[j].low) / 2;
        if (mid > 0) { adrSum += (ohlc[j].high - ohlc[j].low) / mid * 100; adrCount++; }
      }
      if (adrCount === 0) continue;
      const adr = adrSum / adrCount;
      if (adr <= 0) continue;
      let hiC = -Infinity, loC = Infinity, hiH = -Infinity, loL = Infinity;
      for (let j = i - TIGHT_LB + 1; j <= i; j++) {
        if (j < 0) continue;
        hiC = Math.max(hiC, ohlc[j].close); loC = Math.min(loC, ohlc[j].close);
        hiH = Math.max(hiH, ohlc[j].high); loL = Math.min(loL, ohlc[j].low);
      }
      const midC = (hiC + loC) / 2, midHL = (hiH + loL) / 2;
      if (midC <= 0 || midHL <= 0) continue;
      const closeSpread = (hiC - loC) / midC * 100 / adr;
      const swingSpread = (hiH - loL) / midHL * 100 / adr;
      const rawScore = (closeSpread + swingSpread) / 2;
      let histMin = rawScore, histMax = rawScore;
      for (let h = i - HIST_LB + 1; h <= i; h++) {
        if (h < Math.max(TIGHT_LB, ADR_LB) - 1 || h < 0) continue;
        let hAdrSum = 0, hAdrN = 0;
        for (let j2 = h - ADR_LB + 1; j2 <= h; j2++) {
          if (j2 < 0) continue;
          const mid = (ohlc[j2].high + ohlc[j2].low) / 2;
          if (mid > 0) { hAdrSum += (ohlc[j2].high - ohlc[j2].low) / mid * 100; hAdrN++; }
        }
        if (hAdrN === 0) continue;
        const hAdr = hAdrSum / hAdrN;
        if (hAdr <= 0) continue;
        let hHiC = -Infinity, hLoC = Infinity, hHiH = -Infinity, hLoL = Infinity;
        for (let j2 = h - TIGHT_LB + 1; j2 <= h; j2++) {
          if (j2 < 0) continue;
          hHiC = Math.max(hHiC, ohlc[j2].close); hLoC = Math.min(hLoC, ohlc[j2].close);
          hHiH = Math.max(hHiH, ohlc[j2].high); hLoL = Math.min(hLoL, ohlc[j2].low);
        }
        const hMidC = (hHiC + hLoC) / 2, hMidHL = (hHiH + hLoL) / 2;
        if (hMidC <= 0 || hMidHL <= 0) continue;
        const hRaw = ((hHiC - hLoC) / hMidC * 100 / hAdr + (hHiH - hLoL) / hMidHL * 100 / hAdr) / 2;
        histMin = Math.min(histMin, hRaw);
        histMax = Math.max(histMax, hRaw);
      }
      const range = histMax - histMin;
      vcpScores[i] = range > 0 ? Math.max(0, Math.min(100, (rawScore - histMin) / range * 100)) : 50;
    }

    // 14-period Wilder RSI
    const rsiVals = new Array(ohlc.length).fill(null);
    if (ohlc.length > 14) {
      const rp = 14;
      let avgG = 0, avgL = 0;
      for (let i = 1; i <= rp; i++) {
        const d = fullC[i] - fullC[i - 1];
        if (d >= 0) avgG += d; else avgL -= d;
      }
      avgG /= rp; avgL /= rp;
      rsiVals[rp] = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - 100 / (1 + avgG / avgL);
      for (let i = rp + 1; i < ohlc.length; i++) {
        const d = fullC[i] - fullC[i - 1];
        avgG = (avgG * (rp - 1) + Math.max(d, 0)) / rp;
        avgL = (avgL * (rp - 1) + Math.max(-d, 0)) / rp;
        rsiVals[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
      }
    }

    return {
      ema10: calcEMA(fullC, 10),
      ema21hi: calcEMA(fullH, 21),
      ema21close: calcEMA(fullC, 21),
      ema21lo: calcEMA(fullL, 21),
      sma20: calcSMA(fullC, 20),
      sma50: calcSMA(fullC, 50),
      ema200: calcEMA(fullC, 200),
      volMA: calcSMA(fullV, 50),
      volMA20: calcSMA(fullV, 20),
      vcpScores,
      rsiVals,
      totalBars: ohlc.length,
    };
  }, [ohlc]);

  // Render the visible window
  const chartData = useMemo(() => {
    if (!precomputed || !ohlc || !ohlc.length) return null;
    const total = ohlc.length;
    const count = Math.min(visibleCount, total);
    const end = endIdx != null ? Math.min(endIdx, total) : total;
    const start = Math.max(0, end - count);
    const bars = ohlc.slice(start, end);
    if (bars.length === 0) return null;

    const W = containerW, volH = 80, yAxisW = 48, pad = { l: 0, r: yAxisW, t: 16, b: 0 };
    const volGap = 6;
    // Price panel fills the available container height so the chart grows into
    // the panel (the ~24px reserve is the legend row + x-axis below the SVG).
    const priceH = Math.max(220, Math.min(900, (containerH || 380) - volH - volGap - pad.t - pad.b - 24));
    const totalH = priceH + volGap + volH + pad.t + pad.b;
    const chartRight = W - pad.r;
    const bw = Math.max(2, (chartRight - pad.l) / bars.length - 1);
    const gap = 1;
    const pMax = Math.max(...bars.map(b => b.high));
    const pMin = Math.min(...bars.map(b => b.low));
    const pRange = pMax - pMin || 1;
    const vMax = Math.max(...bars.map(b => b.volume)) || 1;
    const py = (v) => pad.t + (1 - (v - pMin) / pRange) * priceH;
    const volTop = pad.t + priceH + volGap;

    // Sell-discipline violation marker (held names only): the most recent bar
    // where price closed below a key MA while still above the 200-day — a leader
    // cracking support. Drawn as a 🔻 above that candle if it's in view.
    let violMarker = null;
    if (owned && total > 50) {
      const s50 = precomputed.sma50, s20 = precomputed.sma20, e200 = precomputed.ema200;
      const N = total - 1, lastC = ohlc[N].close;
      const above200 = e200[N] != null && lastC > e200[N];
      if (above200) {
        let maArr = null, label = null;
        if (s50[N] != null && lastC < s50[N]) { maArr = s50; label = "50-day"; }
        else if (s20[N] != null && lastC < s20[N]) { maArr = s20; label = "20-day"; }
        if (maArr) {
          let crossFull = -1;
          for (let i = N; i > 0; i--) {
            if (maArr[i] != null && maArr[i - 1] != null && ohlc[i].close < maArr[i] && ohlc[i - 1].close >= maArr[i - 1]) { crossFull = i; break; }
          }
          if (crossFull < 0) crossFull = N;
          const visIdx = crossFull - start;
          if (visIdx >= 0 && visIdx < bars.length) {
            violMarker = { x: pad.l + visIdx * (bw + gap) + bw / 2, y: py(ohlc[crossFull].high) - 6, label };
          }
        }
      }
    }

    // Slice MAs to visible window
    const sliceMA = (ma) => ma.slice(start, end);
    const ema10 = sliceMA(precomputed.ema10);
    const ema21hi = sliceMA(precomputed.ema21hi);
    const ema21close = sliceMA(precomputed.ema21close);
    const ema21lo = sliceMA(precomputed.ema21lo);
    const sma50 = sliceMA(precomputed.sma50);
    const ema200 = sliceMA(precomputed.ema200);
    const volMA = sliceMA(precomputed.volMA);
    const volMA20 = sliceMA(precomputed.volMA20);
    const vcpScores = precomputed.vcpScores.slice(start, end);

    const maPoints = (vals) => {
      const pts = [];
      vals.forEach((v, i) => { if (v != null) pts.push(`${pad.l + i * (bw + gap) + bw / 2},${py(v)}`); });
      return pts.length >= 2 ? pts.join(" ") : null;
    };
    const volMaPoints = () => {
      const pts = [];
      volMA.forEach((v, i) => { if (v != null) pts.push(`${pad.l + i * (bw + gap) + bw / 2},${volTop + (1 - v / vMax) * volH}`); });
      return pts.length >= 2 ? pts.join(" ") : null;
    };

    const candleElements = [];
    const volElements = [];
    bars.forEach((b, i) => {
      const gi = start + i;
      const x = pad.l + i * (bw + gap);
      const isUp = b.close >= b.open;
      const candleColor = isUp ? "#2bb886" : "#f87171";
      const bodyTop = py(Math.max(b.open, b.close));
      const bodyBot = py(Math.min(b.open, b.close));
      const bodyH = Math.max(1, bodyBot - bodyTop);
      const wickX = x + bw / 2;
      candleElements.push(
        <line key={`w${i}`} x1={wickX} y1={py(b.high)} x2={wickX} y2={py(b.low)} stroke={candleColor} strokeWidth={0.9} opacity={0.9} />,
        <rect key={`b${i}`} x={x} y={bodyTop} width={bw} height={bodyH} fill={candleColor} rx={Math.min(1, bw / 4)} stroke="rgba(0,0,0,0.35)" strokeWidth={0.4} />
      );
      const vol = b.volume || 0;
      const chLight = CH_ARIA.bg === "#f8f9fc";
      let vColor;
      if (!isUp) {
        vColor = chLight ? "#94a3b8cc" : "#6b7280cc";
      } else {
        const downVols = [];
        for (let j = gi - 1; j >= 0 && downVols.length < 10; j--) {
          if (ohlc[j].close < ohlc[j].open) downVols.push(ohlc[j].volume || 0);
        }
        if (downVols.length >= 10 && vol > Math.max(...downVols.slice(0, 10))) {
          vColor = "#2563eb";
        } else if (downVols.length >= 5 && vol > Math.max(...downVols.slice(0, 5))) {
          vColor = "#0d9488";
        } else {
          vColor = chLight ? "#64748bcc" : "#ffffffcc";
        }
      }
      const vh = Math.max(0.5, (vol / vMax) * volH);
      const vy = volTop + volH - vh;
      volElements.push(
        <rect key={`v${i}`} x={x} y={vy} width={bw} height={vh} fill={vColor} opacity={0.7} rx={0.3} />
      );
      const prevClose = gi > 0 ? ohlc[gi - 1].close : b.open;
      const prevVol = gi > 0 ? (ohlc[gi - 1].volume || 0) : 0;
      const chg = prevClose > 0 ? (b.close - prevClose) / prevClose * 100 : 0;
      if (chg >= 4 && vol > prevVol && vol > 100000) {
        const slope = bw * 0.4;
        for (let dy = 3; dy < vh - 1; dy += 5) {
          const y1 = vy + dy, y2 = y1 - slope;
          if (y2 >= vy) volElements.push(<line key={`bo${i}_${dy}`} x1={x} y1={y1} x2={x + bw} y2={y2} stroke={chLight ? "#a16207" : "#fbbf24"} strokeWidth={0.8} opacity={0.85} />);
        }
      } else if (chg <= -4 && vol > prevVol && vol > 100000) {
        const slope = bw * 0.4;
        for (let dy = 3; dy < vh - 1; dy += 5) {
          const y1 = vy + dy, y2 = y1 + slope;
          if (y2 <= vy + vh) volElements.push(<line key={`bd${i}_${dy}`} x1={x} y1={y1} x2={x + bw} y2={y2} stroke={chLight ? "#b91c1ccc" : "#f8717180"} strokeWidth={0.8} />);
        }
      }
      const vAvg20 = volMA20[i] || 0;
      if (vAvg20 > 0 && vol < vAvg20 * 0.5 && vol > 0) {
        volElements.push(<circle key={`du${i}`} cx={x + bw / 2} cy={vy - 3} r={1.5} fill={chLight ? "#0f766e" : "#2dd4bf"} opacity={0.9} />);
      }
      const vScore = vcpScores[i];
      if (vScore != null && vScore <= 10) {
        volElements.push(<text key={`t${i}`} x={x + bw / 2} y={vy + vh - 1} textAnchor="middle" fontSize={Math.min(bw + 1, 7)} fontWeight={900} fontFamily="monospace" fill={chLight ? "#92400e" : "#fbbf24"} opacity={0.95}>T</text>);
      }
    });

    const erMarkers = [];
    if (quarters && quarters.length) {
      const chLight = CH_ARIA.bg === "#f8f9fc";
      const barDateIdx = {};
      bars.forEach((b, i) => { barDateIdx[b.date] = i; });
      for (const q of quarters) {
        if (!q.report_date) continue;
        let bestIdx = barDateIdx[q.report_date] ?? -1;
        if (bestIdx < 0) {
          const d = new Date(q.report_date + "T00:00:00");
          for (let j = 1; j <= 5; j++) {
            d.setDate(d.getDate() + 1);
            const ds = d.toISOString().slice(0, 10);
            if (barDateIdx[ds] != null) { bestIdx = barDateIdx[ds]; break; }
          }
        }
        if (bestIdx < 0) continue;
        const x = pad.l + bestIdx * (bw + gap) + bw / 2;
        const ePct = q.eps_yoy != null ? `${q.eps_yoy > 0 ? "+" : ""}${q.eps_yoy.toFixed(0)}%` : "—";
        const sPct = q.sales_yoy != null ? `${q.sales_yoy > 0 ? "+" : ""}${q.sales_yoy.toFixed(0)}%` : "—";
        const dotColor = bars[bestIdx].close >= bars[bestIdx].open ? "#4ade80" : "#f87171";
        erMarkers.push(
          <line key={`erl${q.report_date}`} x1={x} y1={pad.t} x2={x} y2={pad.t + priceH} stroke={dotColor} strokeWidth={0.5} strokeDasharray="2,3" opacity={0.5} />,
          <text key={`ert${q.report_date}`} x={x} y={pad.t + priceH - 10} textAnchor="middle" fontSize={7} fontWeight={700} fill={dotColor} opacity={0.9} fontFamily="ui-monospace,monospace">{q.label || ""}</text>,
          <text key={`ers${q.report_date}`} x={x} y={pad.t + priceH - 2} textAnchor="middle" fontSize={6.5} fontWeight={600} opacity={0.9} fontFamily="ui-monospace,monospace">
            <tspan fill={q.eps_yoy == null ? "#c0c0d8" : q.eps_yoy >= 0 ? (chLight ? "#059669" : "#34d399") : (chLight ? "#dc2626" : "#f87171")}>{ePct}</tspan>
            <tspan fill="#8a8a9a"> | </tspan>
            <tspan fill={q.sales_yoy == null ? "#c0c0d8" : q.sales_yoy >= 0 ? (chLight ? "#059669" : "#34d399") : (chLight ? "#dc2626" : "#f87171")}>{sPct}</tspan>
          </text>
        );
      }
    }

    // Y-axis price ticks — pick ~5-7 nice round values
    const niceStep = (range) => {
      const rough = range / 6;
      const mag = Math.pow(10, Math.floor(Math.log10(rough)));
      const residual = rough / mag;
      const nice = residual <= 1.5 ? 1 : residual <= 3 ? 2 : residual <= 7 ? 5 : 10;
      return nice * mag;
    };
    const step = niceStep(pRange);
    const tickStart = Math.ceil(pMin / step) * step;
    const yAxisElements = [];
    const fmtPrice = (v) => v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
    for (let v = tickStart; v <= pMax; v += step) {
      const y = py(v);
      if (y < pad.t + 8 || y > pad.t + priceH - 4) continue;
      yAxisElements.push(
        <line key={`yg${v}`} x1={pad.l} y1={y} x2={chartRight} y2={y} stroke={CH_ARIA.border} strokeWidth={0.5} />,
        <text key={`yl${v}`} x={chartRight + 4} y={y + 3} fontSize={8} fill={CH_ARIA.textMuted} fontFamily="ui-monospace,monospace">${fmtPrice(v)}</text>
      );
    }

    // X-axis month labels at the top
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const xAxisElements = [];
    let prevMonth = null;
    bars.forEach((b, i) => {
      if (!b.date) return;
      const d = new Date(b.date + "T00:00:00");
      const m = d.getMonth();
      const y = d.getFullYear();
      const key = `${y}-${m}`;
      if (key !== prevMonth) {
        prevMonth = key;
        const x = pad.l + i * (bw + gap) + bw / 2;
        if (x > pad.l + 10 && x < chartRight - 20) {
          const label = m === 0 ? `${MONTHS[m]} '${String(y).slice(2)}` : MONTHS[m];
          xAxisElements.push(
            <line key={`xg${key}`} x1={x} y1={pad.t} x2={x} y2={pad.t + priceH} stroke={CH_ARIA.border} strokeWidth={0.5} strokeDasharray="2,4" />,
            <text key={`xl${key}`} x={x} y={pad.t - 4} fontSize={8} fill="#6a6a7a" fontFamily="ui-monospace,monospace" textAnchor="start">{label}</text>
          );
        }
      }
    });

    const sepY = pad.t + priceH + volGap / 2;

    // RSI path for the indicator pane
    const rsiSlice = precomputed.rsiVals.slice(start, end);
    let rsiPathD = "", prevNull = true, lastRsiX = null, lastRsiY = null, lastRsi = null;
    for (let i = 0; i < rsiSlice.length; i++) {
      const v = rsiSlice[i];
      if (v == null) { prevNull = true; continue; }
      const rx = pad.l + i * (bw + gap) + bw / 2;
      const ry = volTop + (1 - v / 100) * volH;
      rsiPathD += `${prevNull ? "M" : "L"}${rx.toFixed(1)},${ry.toFixed(1)} `;
      prevNull = false;
      lastRsiX = rx; lastRsiY = ry; lastRsi = v;
    }

    // Gradient fill paths — overbought (above 60) and oversold (below 40)
    const y60 = volTop + (1 - 60 / 100) * volH;
    const y40 = volTop + (1 - 40 / 100) * volH;
    const rsiXOf = (i) => pad.l + i * (bw + gap) + bw / 2;
    // Overbought: trace RSI clamped to [60,100] along top, return along y60
    const obTopPts = rsiSlice.map((v, i) => `${rsiXOf(i).toFixed(1)},${(volTop + (1 - Math.max(v ?? 60, 60) / 100) * volH).toFixed(1)}`);
    const rsiOverboughtPathD = rsiSlice.some(v => v != null && v > 60)
      ? `M${rsiXOf(0).toFixed(1)},${y60.toFixed(1)} ${obTopPts.join(" ")} L${rsiXOf(rsiSlice.length - 1).toFixed(1)},${y60.toFixed(1)} Z`
      : null;
    // Oversold: trace RSI clamped to [0,40] along bottom, return along y40
    const osBottomPts = rsiSlice.map((v, i) => `${rsiXOf(i).toFixed(1)},${(volTop + (1 - Math.min(v ?? 40, 40) / 100) * volH).toFixed(1)}`);
    const rsiOversoldPathD = rsiSlice.some(v => v != null && v < 40)
      ? `M${rsiXOf(0).toFixed(1)},${y40.toFixed(1)} ${osBottomPts.join(" ")} L${rsiXOf(rsiSlice.length - 1).toFixed(1)},${y40.toFixed(1)} Z`
      : null;

    // ── Mansfield RS oscillator: (stock/SPY) ÷ its own 21-day MA − 1, drawn
    // zero-centered in a bottom band of the price panel. Above zero (green
    // fill) = in an outperformance trend; below (red fill) = underperforming.
    // The zero-cross IS the turn: ▲ = fresh cross into leadership, ▼ = lost it.
    // Pink dots = RS New High Before Price (raw RS leading price — bullish).
    let rsLinePts = "", rsDots = [], rsCross = [], rsLabelY = null, rsEnd = null, rsBandTop = null, rsBandBot = null, divTint = [], rsPosD = null, rsNegD = null, rsZeroY = null;
    if (benchMap && benchMap.size) {
      let lastSpy = null;
      const rsRaw = bars.map((b) => {
        const sp = benchMap.get(b.date);
        if (sp != null) lastSpy = sp;
        const use = sp != null ? sp : lastSpy;
        return (use != null && use > 0 && b.close != null) ? b.close / use : null;
      });
      // Mansfield transform: % distance of the RS ratio from its 21d SMA.
      const MW = 21;
      let mSum = 0, mN = 0;
      const osc = rsRaw.map((v, i) => {
        if (v == null) return null;
        mSum += v; mN++;
        if (mN > MW) { const old = rsRaw[i - MW]; if (old != null) { mSum -= old; mN--; } }
        if (mN < MW) return null;
        const ma = mSum / mN;
        return ma > 0 ? (v / ma - 1) * 100 : null;
      });
      const validO = osc.filter((v) => v != null);
      if (validO.length > 2) {
        const amp = Math.max(1, ...validO.map((v) => Math.abs(v))); // symmetric scale keeps zero centered
        const bandBot = pad.t + priceH - 3, bandTop = pad.t + priceH * 0.70;
        const mid = (bandTop + bandBot) / 2, half = (bandBot - bandTop) / 2;
        const rsY = (v) => mid - (v / amp) * half;
        const xC = (i) => pad.l + i * (bw + gap) + bw / 2;
        rsLabelY = bandTop; rsBandTop = bandTop; rsBandBot = bandBot; rsZeroY = mid;
        rsLinePts = osc.map((v, i) => (v == null ? null : `${xC(i).toFixed(1)},${rsY(v).toFixed(1)}`)).filter(Boolean).join(" ");
        for (let i = osc.length - 1; i >= 0; i--) { if (osc[i] != null) { rsEnd = { x: xC(i), y: rsY(osc[i]) }; break; } }
        // Sign fills: area between the osc curve (clamped to one side) and zero.
        let firstO = -1;
        for (let i = 0; i < osc.length; i++) { if (osc[i] != null) { firstO = i; break; } }
        if (firstO >= 0 && rsEnd) {
          const side = (clampFn) => osc.map((v, i) => (v == null ? null : `${xC(i).toFixed(1)},${rsY(clampFn(v)).toFixed(1)}`)).filter(Boolean).join(" L");
          rsPosD = `M${xC(firstO).toFixed(1)},${mid.toFixed(1)} L${side((v) => Math.max(0, v))} L${rsEnd.x.toFixed(1)},${mid.toFixed(1)} Z`;
          rsNegD = `M${xC(firstO).toFixed(1)},${mid.toFixed(1)} L${side((v) => Math.min(0, v))} L${rsEnd.x.toFixed(1)},${mid.toFixed(1)} Z`;
        }
        // Zero-cross turn markers — require ≥3 bars on the prior side so
        // whipsaw flicker around zero doesn't spray arrows.
        let above = 0, below = 0;
        osc.forEach((v, i) => {
          if (v == null) return;
          if (v > 0) {
            if (below >= 3) rsCross.push({ x: xC(i), y: rsY(v), up: true });
            above++; below = 0;
          } else {
            if (above >= 3) rsCross.push({ x: xC(i), y: rsY(v), up: false });
            below++; above = 0;
          }
        });
        // RSNHBP dots (kept from the old line): raw RS at a new visible-window
        // high while price is NOT — relative strength leading price.
        let rsRunMax = -Infinity, pxRunMax = -Infinity;
        rsRaw.forEach((v, i) => {
          const px = bars[i].close;
          const rsNewHigh = v != null && v > rsRunMax + 1e-9 && i >= 10;
          const priceNewHigh = px != null && px > pxRunMax - 1e-9;
          if (rsNewHigh && !priceNewHigh && osc[i] != null) rsDots.push({ x: xC(i), y: rsY(osc[i]), rsnhbp: true });
          if (v != null && v > rsRunMax) rsRunMax = v;
          if (px != null && px > pxRunMax) pxRunMax = px;
        });
        // Slope divergence: over a ~21-bar window compare price % change vs RS
        // % change. Opposite signs (each ≥ 3%) = divergence. Tint the RS band —
        // green = bullish (price down / RS up), amber = bearish (price up / RS down).
        const DW = 21, MINP = 0.03, MINR = 0.03;
        const raw = [];
        let runType = null, runStart = -1;
        for (let i = 0; i < rsRaw.length; i++) {
          let type = null;
          if (i >= DW && rsRaw[i] != null && rsRaw[i - DW] != null && rsRaw[i - DW] > 0) {
            const pSlope = (bars[i].close - bars[i - DW].close) / bars[i - DW].close;
            const rSlope = (rsRaw[i] - rsRaw[i - DW]) / rsRaw[i - DW];
            if (pSlope > MINP && rSlope < -MINR) type = "bear";
            else if (pSlope < -MINP && rSlope > MINR) type = "bull";
          }
          if (type !== runType) {
            if (runType && runStart >= 0) raw.push({ type: runType, from: runStart, to: i - 1 });
            runType = type; runStart = type ? i : -1;
          }
        }
        if (runType && runStart >= 0) raw.push({ type: runType, from: runStart, to: rsRaw.length - 1 });
        // Bridge same-type segments split by brief threshold flicker into one zone.
        const merged = [];
        for (const seg of raw) {
          const last = merged[merged.length - 1];
          if (last && last.type === seg.type && seg.from - last.to <= 5) last.to = seg.to;
          else merged.push({ ...seg });
        }
        divTint = merged.map((m) => ({ x0: xC(m.from) - bw / 2, x1: xC(m.to) + bw / 2, type: m.type }));
      }
    }

    return {
      W, totalH, sepY, barCount: bars.length, totalBars: total, chartRight,
      rsLinePts, rsDots, rsCross, rsLabelY, rsEnd, rsBandTop, rsBandBot, divTint, rsPosD, rsNegD, rsZeroY,
      barsVis: bars, bwPx: bw, gapPx: gap,
      lastDot: bars.length ? { x: pad.l + (bars.length - 1) * (bw + gap) + bw / 2, y: py(bars[bars.length - 1].close), color: bars[bars.length - 1].close >= bars[bars.length - 1].open ? "#2bb886" : "#f87171" } : null,
      candleElements, volElements, erMarkers, yAxisElements, xAxisElements,
      maEma21hi: maPoints(ema21hi), maEma21lo: maPoints(ema21lo),
      maEma21close: maPoints(ema21close), maEma10: maPoints(ema10),
      maSma50: maPoints(sma50), maEma200: maPoints(ema200),
      volMaPts: volMaPoints(),
      startDate: bars[0]?.date, endDate: bars[bars.length - 1]?.date,
      pMin, pMax, pRange, padT: pad.t, padL: pad.l, priceH, violMarker,
      volTop, volH, y60, y40, rsiPathD, lastRsiX, lastRsiY, lastRsi,
      rsiOverboughtPathD, rsiOversoldPathD,
    };
  }, [ohlc, precomputed, quarters, visibleCount, endIdx, containerW, containerH, benchMap, owned, CH_ARIA]);

  // Wheel zoom — LightweightCharts style: right edge stays pinned,
  // ~3 bars per wheel tick (deltaY normalized to ±1 for trackpad smoothness)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    if (!ohlc || !ohlc.length) return;
    // Normalize: mouse wheel gives ±100–120, trackpad gives small floats
    const ticks = Math.sign(e.deltaY) * Math.max(1, Math.min(5, Math.abs(e.deltaY) / 30));
    const delta = Math.round(ticks * 3);
    setVisibleCount((prev) => Math.max(MIN_VISIBLE, Math.min(MAX_BARS, prev + delta)));
  }, [ohlc]);

  // Drag to pan — LightweightCharts style: drag right = see older data
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const total = ohlc?.length || 0;
    dragRef.current = { startX: e.clientX, startEndIdx: endIdx != null ? endIdx : total, accumulated: 0 };
    const onMove = (ev) => {
      if (!dragRef.current || !svgRef.current || !ohlc) return;
      const rect = svgRef.current.getBoundingClientRect();
      const pxPerBar = rect.width / visibleCount;
      const dx = ev.clientX - dragRef.current.startX;
      const barShift = Math.round(dx / pxPerBar);
      const t = ohlc.length;
      const newEnd = Math.max(visibleCount, Math.min(t, dragRef.current.startEndIdx - barShift));
      setEndIdx(newEnd);
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [endIdx, visibleCount, ohlc]);

  // Double-click to reset view
  const handleDblClick = useCallback(() => {
    setVisibleCount(DEFAULT_BARS);
    setEndIdx(null);
  }, []);

  if (!chartData) {
    return (
      <div ref={containerRef} style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", justifyContent: "center", height: height || 400, color: CH_ARIA.textMuted, fontSize: 11, fontFamily: "monospace", width: "100%" }}>
        <svg width="120" height="36" viewBox="0 0 120 36" style={{ opacity: 0.35 }}>
          <polyline points="2,28 18,22 32,26 46,14 60,18 74,8 90,13 104,5 118,9" fill="none" stroke={CH_ARIA.textMuted} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3,3" />
        </svg>
        No chart data
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", padding: "0 4px" }}>
      <svg ref={svgRef} width={chartData.W} height={chartData.totalH}
        style={{ display: "block", cursor: dragRef.current ? "grabbing" : "grab" }}
        onWheel={handleWheel} onMouseDown={handleMouseDown} onDoubleClick={handleDblClick}
        onMouseMove={(e) => {
          if (dragRef.current) return;
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const mx = e.clientX - rect.left;
          const i = Math.floor((mx - chartData.padL) / (chartData.bwPx + chartData.gapPx));
          setHoverI(i >= 0 && i < chartData.barCount ? i : null);
        }}
        onMouseLeave={() => setHoverI(null)}>
        <defs>
          <filter id="tpGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="rsiObGrad" x1="0" y1={chartData.volTop} x2="0" y2={chartData.y60} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="rsiOsGrad" x1="0" y1={chartData.y40} x2="0" y2={chartData.volTop + chartData.volH} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f87171" stopOpacity="0" />
            <stop offset="100%" stopColor="#f87171" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        {chartData.xAxisElements}
        {chartData.yAxisElements}
        <line x1={0} y1={chartData.sepY} x2={chartData.chartRight} y2={chartData.sepY} stroke={CH_ARIA.borderLight} strokeWidth={0.5} />
        <line x1={chartData.chartRight} y1={0} x2={chartData.chartRight} y2={chartData.totalH} stroke={CH_ARIA.borderLight} strokeWidth={0.5} />
        {chartData.maEma21hi && <polyline points={chartData.maEma21hi} fill="none" stroke="#80808060" strokeWidth={1} />}
        {chartData.maEma21lo && <polyline points={chartData.maEma21lo} fill="none" stroke="#80808060" strokeWidth={1} />}
        {chartData.maEma21close && <polyline points={chartData.maEma21close} fill="none" stroke="#808080" strokeWidth={1.5} />}
        {chartData.maEma10 && <polyline points={chartData.maEma10} fill="none" stroke="#ff828c" strokeWidth={1} />}
        {chartData.maSma50 && <polyline points={chartData.maSma50} fill="none" stroke="#2dd4bf" strokeWidth={1} strokeDasharray="4,2" />}
        {chartData.maEma200 && <polyline points={chartData.maEma200} fill="none" stroke="#8232c8" strokeWidth={1} />}
        {chartData.candleElements}
        {chartData.lastDot && (
          <circle cx={chartData.lastDot.x} cy={chartData.lastDot.y} r={2.6} fill={chartData.lastDot.color} filter="url(#tpGlow)">
            <animate attributeName="opacity" values="1;0.35;1" dur="2.2s" repeatCount="indefinite" />
          </circle>
        )}
        {hoverI != null && chartData.barsVis[hoverI] && (() => {
          const b = chartData.barsVis[hoverI];
          const cx = chartData.padL + hoverI * (chartData.bwPx + chartData.gapPx) + chartData.bwPx / 2;
          const pyv = (v) => chartData.padT + (1 - (v - chartData.pMin) / chartData.pRange) * chartData.priceH;
          const cy = pyv(b.close);
          const prev = hoverI > 0 ? chartData.barsVis[hoverI - 1] : null;
          const chg = prev && prev.close ? ((b.close / prev.close - 1) * 100) : null;
          const up = chg == null ? b.close >= b.open : chg >= 0;
          const fmtP = (v) => v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
          const fmtV = (v) => v >= 1e9 ? (v / 1e9).toFixed(1) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : String(v || 0);
          const txt = `${b.date}   O ${fmtP(b.open)}  H ${fmtP(b.high)}  L ${fmtP(b.low)}  C ${fmtP(b.close)}${chg != null ? `  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : ""}  V ${fmtV(b.volume)}`;
          const tw = txt.length * 5.1 + 12;
          const left = cx <= chartData.chartRight / 2;
          const bx = left ? Math.min(cx + 10, chartData.chartRight - tw - 4) : Math.max(4, cx - 10 - tw);
          return (
            <g pointerEvents="none">
              <line x1={cx} y1={chartData.padT} x2={cx} y2={chartData.volTop + chartData.volH} stroke={CH_ARIA.textDim} strokeWidth={0.7} strokeDasharray="3,3" opacity={0.55} />
              <line x1={chartData.padL} y1={cy} x2={chartData.chartRight} y2={cy} stroke={CH_ARIA.textDim} strokeWidth={0.6} strokeDasharray="3,3" opacity={0.4} />
              <circle cx={cx} cy={cy} r={2.6} fill={up ? "#2bb886" : "#f87171"} stroke={CH_ARIA.bg} strokeWidth={0.8} />
              <rect x={bx} y={chartData.padT + 2} width={tw} height={15} rx={3} fill={CH_ARIA.bg} opacity={0.94} stroke={CH_ARIA.borderLight} strokeWidth={0.6} />
              <text x={bx + 6} y={chartData.padT + 12.5} fontSize={8} fill={CH_ARIA.text} fontFamily="ui-monospace,monospace">
                {b.date}   O {fmtP(b.open)}  H {fmtP(b.high)}  L {fmtP(b.low)}  C <tspan fill={up ? "#2bb886" : "#f87171"} fontWeight="700">{fmtP(b.close)}</tspan>{chg != null ? <tspan fill={up ? "#2bb886" : "#f87171"}>{`  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`}</tspan> : null}  V {fmtV(b.volume)}
              </text>
            </g>
          );
        })()}
        {chartData.violMarker && (
          <text x={chartData.violMarker.x} y={chartData.violMarker.y} textAnchor="middle" fontSize={11} style={{ cursor: "default" }}>
            <title>{`Sell-discipline violation — closed below the ${chartData.violMarker.label} (leader cracking support). Ryan's trailing-stop trigger.`}</title>🔻
          </text>
        )}
        {showRS && chartData.rsLinePts && (
          <>
            {(chartData.divTint || []).map((d, i) => (
              <rect key={`div${i}`} x={d.x0} y={chartData.rsBandTop} width={Math.max(1, d.x1 - d.x0)} height={(chartData.rsBandBot || 0) - (chartData.rsBandTop || 0)} fill={d.type === "bull" ? "#22c55e" : "#f59e0b"} opacity={0.28}>
                <title>{d.type === "bull" ? "Bullish RS divergence — price down/flat while RS rising (relative strength accumulating)" : "Bearish RS divergence — price rising while RS falling (relative strength deteriorating)"}</title>
              </rect>
            ))}
            {chartData.rsPosD && <path d={chartData.rsPosD} fill="#22c55e" opacity={0.22} />}
            {chartData.rsNegD && <path d={chartData.rsNegD} fill="#ef4444" opacity={0.22} />}
            {chartData.rsZeroY != null && <line x1={chartData.padL} y1={chartData.rsZeroY} x2={chartData.chartRight} y2={chartData.rsZeroY} stroke="#3b82f6" strokeWidth={0.6} strokeDasharray="3 3" opacity={0.5} />}
            <polyline points={chartData.rsLinePts} fill="none" stroke="#3b82f6" strokeWidth={1.2} opacity={0.9} filter="url(#tpGlow)" />
            {(chartData.rsCross || []).map((d, i) => (
              <polygon key={`rsx${i}`}
                points={d.up ? `${d.x - 4},${d.y + 9} ${d.x + 4},${d.y + 9} ${d.x},${d.y + 2}` : `${d.x - 4},${d.y - 9} ${d.x + 4},${d.y - 9} ${d.x},${d.y - 2}`}
                fill={d.up ? "#22c55e" : "#f59e0b"} stroke="#0a0a14" strokeWidth={0.8}>
                <title>{d.up ? "RS turn UP — crossed above its 21d trend: entering outperformance" : "RS turn DOWN — crossed below its 21d trend: losing leadership"}</title>
              </polygon>
            ))}
            {chartData.rsDots.map((d, i) => (
              <circle key={`rsd${i}`} cx={d.x} cy={d.y} r={3.4} fill="#ec4899" stroke="#0a0a14" strokeWidth={0.7}>
                <title>RS New High Before Price (RSNHBP) — relative strength leading price, bullish</title>
              </circle>
            ))}
            {chartData.rsLabelY != null && <text x={chartData.padL + 3} y={chartData.rsLabelY - 2} fontSize={7.5} fill="#3b82f6" fontFamily="ui-monospace,monospace" fontWeight={700} opacity={0.85}>RS TREND (÷21d)<title>Mansfield RS: (stock÷SPY) relative to its own 21-day average. Green fill = in an outperformance trend, red = underperforming. ▲/▼ mark the zero-cross turns; pink dots = RS new high before price.</title></text>}
            {rsRating != null && chartData.rsEnd && (() => {
              const w = rsRating >= 100 ? 21 : 16, bx = chartData.rsEnd.x + 3, by = chartData.rsEnd.y - 6;
              return (
                <g>
                  <rect x={bx} y={by} width={w} height={12} rx={2} fill="#0a0a14" stroke={rsRatingColor || "#3b82f6"} strokeWidth={0.8} opacity={0.96}>
                    <title>RS rating (0-100) — relative strength vs the market, same value as the perf bar</title>
                  </rect>
                  <text x={bx + w / 2} y={by + 9} textAnchor="middle" fontSize={8} fontWeight={800} fill={rsRatingColor || "#3b82f6"} fontFamily="ui-monospace,monospace">{rsRating}</text>
                </g>
              );
            })()}
          </>
        )}
        <text x={chartData.padL + 3} y={10} fontSize={8} fontFamily="ui-monospace,monospace" fontWeight={700}
          fill={showRS ? "#3b82f6" : "#4a4a5a"} style={{ cursor: "pointer" }}
          onClick={() => setShowRS((v) => { const n = !v; try { localStorage.setItem("tp-chart-rs", n ? "1" : "0"); } catch {} return n; })}>
          <title>Toggle the IBD-style RS line (stock ÷ SPY)</title>RS
        </text>
        {volSubTab === "vol" && chartData.volElements}
        {volSubTab === "vol" && chartData.volMaPts && <polyline points={chartData.volMaPts} fill="none" stroke="#fbbf24" strokeWidth={1} opacity={0.5} />}
        {volSubTab === "rsi" && (() => {
          const { volTop, volH, chartRight, padL, rsiPathD, lastRsiX, lastRsiY, lastRsi } = chartData;
          const yRef = (v) => volTop + (1 - v / 100) * volH;
          const rsiColor = lastRsi >= 60 ? "#f87171" : lastRsi <= 40 ? "#4ade80" : "#60a5fa";
          return (
            <>
              {chartData.rsiOverboughtPathD && <path d={chartData.rsiOverboughtPathD} fill="url(#rsiObGrad)" />}
              {chartData.rsiOversoldPathD && <path d={chartData.rsiOversoldPathD} fill="url(#rsiOsGrad)" />}
              <line x1={padL} y1={yRef(60)} x2={chartRight} y2={yRef(60)} stroke="#f87171" strokeWidth={0.5} strokeDasharray="3,2" opacity={0.35} />
              <line x1={padL} y1={yRef(50)} x2={chartRight} y2={yRef(50)} stroke="#3a3a4a" strokeWidth={0.5} strokeDasharray="2,3" />
              <line x1={padL} y1={yRef(40)} x2={chartRight} y2={yRef(40)} stroke="#4ade80" strokeWidth={0.5} strokeDasharray="3,2" opacity={0.35} />
              {rsiPathD && <path d={rsiPathD} fill="none" stroke={rsiColor} strokeWidth={1.5} />}
              {lastRsiX != null && <circle cx={lastRsiX} cy={lastRsiY} r={2} fill={rsiColor} />}
              <text x={chartRight + 4} y={yRef(60) + 3} fontSize={7} fill="#f87171" fontFamily="ui-monospace,monospace" opacity={0.7}>60</text>
              <text x={chartRight + 4} y={yRef(50) + 3} fontSize={7} fill="#6a6a7a" fontFamily="ui-monospace,monospace">50</text>
              <text x={chartRight + 4} y={yRef(40) + 3} fontSize={7} fill="#4ade80" fontFamily="ui-monospace,monospace" opacity={0.7}>40</text>
              {lastRsi != null && <text x={chartRight + 4} y={lastRsiY + 3} fontSize={7} fontWeight={700} fill={rsiColor} fontFamily="ui-monospace,monospace">{lastRsi.toFixed(0)}</text>}
            </>
          );
        })()}
        {/* Vol / RSI tab toggles at top of indicator pane */}
        <text x={4} y={chartData.sepY + 11} fontSize={8} fontFamily="ui-monospace,monospace" fontWeight={700}
          fill={volSubTab === "vol" ? "#0d9163" : "#4a4a5a"}
          style={{ cursor: "pointer", userSelect: "none" }}
          onMouseDown={(e) => { e.stopPropagation(); setVolSubTab("vol"); }}>Vol</text>
        <text x={26} y={chartData.sepY + 11} fontSize={8} fontFamily="ui-monospace,monospace" fontWeight={700}
          fill={volSubTab === "rsi" ? "#60a5fa" : "#4a4a5a"}
          style={{ cursor: "pointer", userSelect: "none" }}
          onMouseDown={(e) => { e.stopPropagation(); setVolSubTab("rsi"); }}>RSI</text>
        {chartData.erMarkers}
        {stopLines.map((sl, i) => {
          if (!sl?.price || sl.price <= 0) return null;
          const pMin = chartData.pMin, pMax = chartData.pMax, pRange = chartData.pRange;
          const padT = chartData.padT, priceH = chartData.priceH;
          if (sl.price < pMin || sl.price > pMax) return null;
          const y = padT + (1 - (sl.price - pMin) / pRange) * priceH;
          return (
            <g key={i}>
              <line x1={chartData.padL} y1={y} x2={chartData.chartRight} y2={y}
                stroke={sl.color} strokeWidth={1.5}
                strokeDasharray={sl.dashed ? "5,3" : undefined} opacity={0.85} />
              <text x={chartData.chartRight + 4} y={y + 3} fontSize={7.5} fill={sl.color}
                fontFamily="ui-monospace,monospace" fontWeight={700}>
                {sl.label} {sl.price.toFixed(2)}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Legend + zoom info */}
      <div style={{ display: "flex", gap: 10, padding: "4px 8px", fontSize: 8, fontFamily: "monospace", color: "#7a7a8a", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span style={{ color: "#ff828c" }}>EMA10</span>
          <span style={{ color: "#808080" }}>EMA21</span>
          <span style={{ color: "#2dd4bf" }}>SMA50</span>
          <span style={{ color: "#8232c8" }}>EMA200</span>
          <span style={{ color: "#fbbf24" }}>Vol MA</span>
        </span>
        {chartData.barCount < chartData.totalBars && (
          <span style={{ color: "#5a5a6a" }} title="Double-click to reset view">
            {chartData.startDate} → {chartData.endDate} · {chartData.barCount}d
          </span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#2563eb", borderRadius: 1, display: "inline-block" }} />PP 10d</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#0d9488", borderRadius: 1, display: "inline-block" }} />PP 5d</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: `repeating-linear-gradient(135deg,transparent,transparent 2px,${CH_ARIA.yellow} 2px,${CH_ARIA.yellow} 3px)`, border: `1px solid ${CH_ARIA.yellow}80`, borderRadius: 1, display: "inline-block" }} />+4% BO</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "repeating-linear-gradient(45deg,transparent,transparent 2px,#f87171 2px,#f87171 3px)", border: "1px solid #f8717180", borderRadius: 1, display: "inline-block" }} />-4% BD</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: CH_ARIA.glass, color: CH_ARIA.yellow, fontSize: 7, fontWeight: 900, textAlign: "center", lineHeight: "8px", fontFamily: "monospace", border: `1px solid ${CH_ARIA.borderLight}`, borderRadius: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>T</span>Tight</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: `radial-gradient(circle,${CH_ARIA.bg === "#f8f9fc" ? "#0f766e" : "#2dd4bf"} 3px,transparent 3px)`, borderRadius: 1, display: "inline-block" }} />Dry-Up</span>
        </span>
      </div>
      {showRS && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, padding: "0 8px 5px", fontSize: 8, fontFamily: "monospace", color: "#7a7a8a", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#3b82f6", fontWeight: 700 }}>RS:</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 12, height: 2, background: "#3b82f6", display: "inline-block" }} />vs SPY</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 7, height: 7, background: "#3b82f6", borderRadius: "50%", display: "inline-block" }} />new hi</span>
          <span title="RS new high before price" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 7, height: 7, background: "#ec4899", borderRadius: "50%", display: "inline-block" }} />RSNHBP</span>
          <span title="RS lower high — rolling over" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ color: "#f97316", fontSize: 10, lineHeight: "8px" }}>▾</span>roll-over</span>
          <span title="Bullish divergence — price down/flat, RS up" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 9, height: 8, background: "#22c55e", opacity: 0.55, borderRadius: 1, display: "inline-block" }} />bull div</span>
          <span title="Bearish divergence — price up, RS down" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 9, height: 8, background: "#f59e0b", opacity: 0.55, borderRadius: 1, display: "inline-block" }} />bear div</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ padding: "0 3px", border: "1px solid #3b82f6", borderRadius: 2, color: "#3b82f6", fontSize: 7, fontWeight: 800, lineHeight: "9px" }}>90</span>rating</span>
        </div>
      )}
    </div>
  );
}

const SHEET_NOTES_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRDC0MYBXHn-4hW-mVHZp0lusDe6zsQENz7zVAFanckp12axZ45XRkodzlJADoSciEmJEfvhkPuGZmk/pub?output=csv";
const _sheetNotesCache = { map: null, loading: false };

function parseSheetCSVRow(line) {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur); cur = ""; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

// ── useEifReasons: fetch the compact per-ticker EIF driver breakdown once ──
let _eifReasonsCache = null;
let _eifReasonsFetching = false;
const _eifReasonsListeners = [];
function useEifReasons() {
  const [map, setMap] = useState(_eifReasonsCache);
  useEffect(() => {
    if (_eifReasonsCache) { setMap(_eifReasonsCache); return; }
    if (_eifReasonsFetching) { _eifReasonsListeners.push(setMap); return; }
    _eifReasonsFetching = true;
    fetch("/data/framework_reasons.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => { _eifReasonsCache = d || {}; setMap(_eifReasonsCache); _eifReasonsListeners.forEach((fn) => fn(_eifReasonsCache)); _eifReasonsListeners.length = 0; })
      .catch(() => { _eifReasonsFetching = false; });
  }, []);
  return map || {};
}

// ── useCrpScores: per-ticker Closing Range Persistence (multi-day finishes-strong)
let _crpCache = null, _crpFetching = false; const _crpListeners = [];
function useCrpScores() {
  const [map, setMap] = useState(_crpCache);
  useEffect(() => {
    if (_crpCache) { setMap(_crpCache); return; }
    if (_crpFetching) { _crpListeners.push(setMap); return; }
    _crpFetching = true;
    fetch("/data/crp_scores.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => { _crpCache = d?.scores || {}; setMap(_crpCache); _crpListeners.forEach((fn) => fn(_crpCache)); _crpListeners.length = 0; })
      .catch(() => { _crpFetching = false; });
  }, []);
  return map || {};
}

function ChartPanelInline({
  ticker,
  onTickerChange,
  height = 580,
  stockMap,
  themeHealth,
  tickerStrengthMap,
}) {
  const ARIA = useAriaTheme();
  // layer membership chips (chain_layers.json — same file the RS Rotation Layers tab uses)
  const chainLayers = useChainLayers();
  const tickerLayers = useMemo(
    () => (chainLayers || []).filter((e) => Array.isArray(e.tickers) && e.tickers.includes(ticker)),
    [chainLayers, ticker]
  );
  const [tf, setTf] = useState(() => localStorage.getItem("themepulse-chart-tf") || "D");
  const [tickerInput, setTickerInput] = useState("");
  // EPS + Revenue bars below the CANSLIM stats row. Fetches the same
  // /api/live?news=X payload TickerInfoBox uses — browser coalesces the
  // duplicate in-flight request when both components mount together.
  //   quarters: quarterly bars (Finviz FactSet → FMP fallback)
  //   annuals:  annual bars (FMP only)
  //   qbarsMode: which series to display ("quarter" or "annual")
  const [quarters, setQuarters] = useState([]);
  const [annuals, setAnnuals] = useState([]);
  const [news, setNews] = useState([]);
  const [newsOpen, setNewsOpen] = useState(true);
  const [description, setDescription] = useState("");
  const [peers, setPeers] = useState([]);
  const [liveEarningsDate, setLiveEarningsDate] = useState(null);
  const [ohlcBars, setOhlcBars] = useState([]);
  const [showTrade, setShowTrade] = useState(false);
  const [tradeSettings, setTradeSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("themepulse-risk-settings") || "null") ||
      { accountSize: 300000, riskPct: 1.0, maxAllocPct: 25.0, atrLen: 14 }; }
    catch { return { accountSize: 300000, riskPct: 1.0, maxAllocPct: 25.0, atrLen: 14 }; }
  });
  useEffect(() => {
    localStorage.setItem("themepulse-risk-settings", JSON.stringify(tradeSettings));
  }, [tradeSettings]);
  const [qbarsMode, setQbarsMode] = useState(
    () => localStorage.getItem("themepulse-qbars-mode") || "quarter"
  );
  const setQbarsModePersist = useCallback((mode) => {
    setQbarsMode(mode);
    localStorage.setItem("themepulse-qbars-mode", mode);
  }, []);
  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setPeers([]);
    setLiveEarningsDate(null);
    fetch(`/api/live?news=${encodeURIComponent(ticker)}`).then(r => r.ok ? r.json() : null).then((d) => {
      if (cancelled) return;
      const orient = (arr) => {
        if (!Array.isArray(arr) || arr.length <= 1) return arr || [];
        return arr[0].year > arr[arr.length - 1].year ? arr.slice().reverse() : arr;
      };
      setQuarters(orient(d?.finvizQuarters));
      setAnnuals(orient(d?.finvizAnnual));
      setNews(d?.news || []);
      setDescription(d?.description || "");
      setPeers(d?.fmpPeers || d?.peers || []);
      if (d?.earningsDate) setLiveEarningsDate(d.earningsDate);
    }).catch(() => {
      if (!cancelled) {
        setQuarters([]);
        setAnnuals([]);
        setNews([]);
        setDescription("");
        setPeers([]);
      }
    });
    return () => { cancelled = true; };
  }, [ticker]);

  // Fetch OHLC bars for inline SVG daily chart
  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    const interval = tf === "W" ? "1wk" : "1d";
    fetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}&interval=${interval}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.ohlc) setOhlcBars(d.ohlc); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ticker, tf]);
  // Right pane subtab: 'chart' (intraday OHLC) or 'picks' (agent picks list)

  // Draggable split between daily (left) and intraday (right) panes.
  // Stored as a 0..1 fraction of the chart body width assigned to the LEFT.
  // Default 0.55 ≈ Aria's flex 6/(6+5).


  // Live quote for the active ticker — drives the OHLC + RVol header line
  const tickerList = useMemo(() => (ticker ? [ticker] : []), [ticker]);
  const { quotes } = useLiveQuotes(tickerList, 30000);
  const liveQuote = quotes.get(ticker);
  const stockInfo = stockMap?.[ticker] || {};
  const avgVol = stockInfo.avg_volume_raw || 0;

  // Aria-faithful OHLC line: O H L C +chg ($abs+%) Vol RV + badges
  const o = liveQuote?.open ?? 0;
  const h = liveQuote?.high ?? 0;
  const l = liveQuote?.low ?? 0;
  const c = liveQuote?.price ?? 0;
  const chgPct = liveQuote?.change ?? null;
  const chgAbs = liveQuote && c && chgPct != null ? c - c / (1 + chgPct / 100) : null;
  const liveVol = liveQuote?.volume || 0;
  const rvol = liveVol && avgVol > 0 ? Math.round((liveVol / avgVol) * 100) / 100 : null;

  const fmtVol = (v) => {
    if (!v) return "—";
    if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return String(v);
  };

  const chgColor =
    chgPct == null
      ? ARIA.textMuted
      : chgPct >= 0
      ? ARIA.green
      : ARIA.red;
  const rvColor = rvol == null
    ? ARIA.textMuted
    : rvol >= 1.5
    ? ARIA.purple
    : rvol >= 1
    ? ARIA.textDim
    : ARIA.textMuted;

  // 9M badge: today's volume >= 8.9M but avg < 8.9M (unusual institutional)
  const todayVol = avgVol * (rvol || 0);
  const has9M = todayVol >= 8_900_000 && avgVol < 8_900_000;
  const fromHi = stockInfo.off_52w_high;
  const grade = stockInfo.grade || "";
  const gradeColor =
    grade && grade[0] === "A" ? ARIA.green : grade && grade[0] === "B" ? ARIA.blue : ARIA.textMuted;

  // CANSLIM stats from stockMap
  const csClr = (v) =>
    v == null ? ARIA.textMuted : v > 25 ? ARIA.green : v > 0 ? ARIA.textDim : ARIA.red;
  const epsYoy = stockInfo.eps_yoy ?? null;
  const epsYoyPrev = stockInfo.eps_yoy_prev ?? null;
  const epsSurprise = stockInfo.last_eps_surprise_pct ?? null;
  const salesYoy = stockInfo.sales_yoy ?? null;
  const salesYoyPrev = stockInfo.sales_yoy_prev ?? null;
  const salesSurprise = stockInfo.last_revenue_surprise_pct ?? null;
  const epsThisY = stockInfo.eps_this_y ?? null;
  const eps5y = stockInfo.eps_past_5y ?? null;
  const sales5y = stockInfo.sales_past_5y ?? null;
  const margin = (() => {
    const m = stockInfo.profit_margin ?? null;
    return m != null ? (m < 1 ? m * 100 : m) : null;
  })();
  const roe = (() => {
    const r = stockInfo.roe ?? null;
    return r != null ? (Math.abs(r) < 5 ? r * 100 : r) : null;
  })();
  const roic = (() => {
    const r = stockInfo.roic ?? null;
    return r != null ? (Math.abs(r) < 5 ? r * 100 : r) : null;
  })();
  const instOwn = stockInfo.inst_own_pct ?? null;
  const instTrans = stockInfo.inst_trans_pct ?? null;
  const magna = stockInfo.magna ?? null;
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

  // Risk Management — ATR + 5 stop scenarios (mirrors ThinkScript indicator)
  const dailyATR = useMemo(() => calcWilderATR(ohlcBars, tradeSettings.atrLen), [ohlcBars, tradeSettings.atrLen]);
  const riskEntry = c > 0 ? c : (ohlcBars[ohlcBars.length - 1]?.close ?? null);
  const riskDayLow = l > 0 ? l : (ohlcBars[ohlcBars.length - 1]?.low ?? null);
  const riskPDL = ohlcBars[ohlcBars.length - 1]?.low ?? null;
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

  // Minervini / O'Neill fundamentals gate — simple floor criteria. Green
  // light only when EPS + Sales growth and net margin all clear the bar
  // (standard SEPA / CANSLIM thresholds). `hot` flags the super-growth
  // tier (EPS & Sales both ≥ 40%) and upgrades the badge to orange.
  // Hides entirely for tickers missing data (ETFs, recent IPOs).
  const mo =
    epsYoy != null && salesYoy != null && margin != null &&
    epsYoy >= 25 && salesYoy >= 20 && margin >= 5
      ? { epsYoy, salesYoy, margin, hot: epsYoy >= 40 && salesYoy >= 40 }
      : null;

  // Prior earnings responses — lazy-loaded from /api/earnings when opened
  const [erHistOpen, setErHistOpen] = useState(() => { try { return localStorage.getItem("tp-erhist-open") === "1"; } catch { return false; } });
  const [erHist, setErHist] = useState(null);
  useEffect(() => {
    if (!ticker) return;
    if (erHist && erHist.ticker === ticker) return;
    let dead = false;
    fetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((d) => { if (!dead && d && Array.isArray(d.history)) setErHist({ ticker, history: d.history, next: d.next }); })
      .catch(() => {});
    return () => { dead = true; };
  }, [ticker, erHist]);

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
      {/* Thin header bar — ticker · layer · Chg · Intraday · ADR · Next ER (left), ticker input (right) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 12px", borderBottom: `1px solid ${ARIA.border}`, flexShrink: 0, fontFamily: "monospace", overflowX: "auto", whiteSpace: "nowrap" }}>
        <img key={ticker} src={`https://images.financialmodelingprep.com/symbol/${ticker}.png`} alt="" onError={(e) => { e.target.style.display = "none"; }}
          style={{ width: 20, height: 20, borderRadius: 4, background: "#ffffff", objectFit: "contain", padding: 1.5, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: ARIA.text, flexShrink: 0 }}>{ticker}</span>
        {tickerLayers.length > 0 ? (
          <span onClick={() => { try { window.dispatchEvent(new CustomEvent("tp-open-drawer", { detail: tickerLayers[0].themeId })); } catch {} }}
            title={`${tickerLayers[0].theme} — click to open value-chain drawer${tickerLayers.length > 1 ? ` (+${tickerLayers.length - 1} more layer${tickerLayers.length - 1 > 1 ? "s" : ""})` : ""}`}
            style={{ fontSize: 8, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: "rgba(251,191,36,0.12)", border: "1px solid #a07a1f", color: "#fbbf24", textTransform: "uppercase", letterSpacing: 0.4, cursor: "pointer", flexShrink: 0 }}>
            {tickerLayers[0].theme} • {tickerLayers[0].layer}{tickerLayers.length > 1 ? ` +${tickerLayers.length - 1}` : ""}
          </span>
        ) : stockInfo.sector ? (
          <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: "rgba(108,213,232,0.12)", border: "1px solid #3a8a9e", color: "#6cd5e8", textTransform: "uppercase", letterSpacing: 0.4, flexShrink: 0 }}>{stockInfo.sector}</span>
        ) : null}
        <span style={{ fontSize: 9, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
          <span style={{ color: ARIA.textMuted }}>Chg</span>
          <span style={{ color: chgPct != null && Math.abs(chgPct) > 2 ? (chgPct > 0 ? ARIA.green : ARIA.red) : ARIA.textDim, fontWeight: chgPct != null && Math.abs(chgPct) > 2 ? 700 : 400 }}>{chgPct != null ? `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%` : "\u2014"}</span>
        </span>
        <span style={{ fontSize: 9, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
          <span style={{ color: ARIA.textMuted }}>Intra</span>
          <span style={{ color: (o > 0 && c > 0 && Math.abs((c - o) / o * 100) > 2) ? (c >= o ? ARIA.green : ARIA.red) : ARIA.textDim, fontWeight: (o > 0 && c > 0 && Math.abs((c - o) / o * 100) > 2) ? 700 : 400 }}>{o > 0 && c > 0 ? `${c >= o ? "+" : ""}${((c - o) / o * 100).toFixed(2)}%` : "\u2014"}</span>
        </span>
        <span style={{ fontSize: 9, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
          <span style={{ color: ARIA.textMuted }}>ADR</span>
          <span style={{ color: adr != null && adr >= 4 ? ARIA.cyan : ARIA.textDim, fontWeight: adr != null && adr >= 4 ? 700 : 400 }}>{adr != null ? `${adr.toFixed(1)}%` : "\u2014"}</span>
        </span>
        {(nextErDisp) && (
          <span style={{ fontSize: 9, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }} title="Next earnings date">
            <span style={{ color: ARIA.textMuted }}>ER</span>
            <span style={{ color: (erDaysRaw != null && erDaysRaw >= 0 && erDaysRaw <= 21) ? ARIA.red : ARIA.textDim, fontWeight: (erDaysRaw != null && erDaysRaw >= 0 && erDaysRaw <= 21) ? 700 : 400 }}>{nextErDisp}{erTimingRaw ? ` ${erTimingRaw}` : ""}</span>
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {["D", "W"].map(tfOpt => (
            <button key={tfOpt} onClick={() => { setTf(tfOpt); localStorage.setItem("themepulse-chart-tf", tfOpt); }}
              style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, cursor: "pointer", background: tf === tfOpt ? "#0d9163" : "transparent", border: "1px solid #0d9163", color: tf === tfOpt ? "#fff" : "#0d9163", fontFamily: "monospace", fontWeight: 700, minWidth: 18 }}>
              {tfOpt}
            </button>
          ))}
          <button onClick={() => setShowTrade(prev => !prev)}
            style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, cursor: "pointer", background: showTrade ? "#0d9163" : "transparent", border: "1px solid #0d9163", color: showTrade ? "#fff" : "#0d9163", fontFamily: "monospace", fontWeight: 700 }}>
            TRADE
          </button>
          <button onClick={togglePF} title={inPF ? "Remove from Portfolio" : "Add to Portfolio"} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, border: `1px solid ${ARIA.yellow}80`, color: inPF ? ARIA.bg : ARIA.yellow, background: inPF ? ARIA.yellow : "transparent", cursor: "pointer", fontFamily: "monospace", fontWeight: 700 }}>{inPF ? "✓PF" : "+PF"}</button>
          <button onClick={toggleFC} title={inFC ? "Remove from Focus" : "Add to Focus (high-priority recent setups)"} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, border: `1px solid ${ARIA.cyan}80`, color: inFC ? ARIA.bg : ARIA.cyan, background: inFC ? ARIA.cyan : "transparent", cursor: "pointer", fontFamily: "monospace", fontWeight: 700 }}>{inFC ? "✓FC" : "⚡FC"}</button>
          <button onClick={toggleWL} title={inWL ? "Remove from Watchlist" : "Add to Watchlist"} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, border: `1px solid ${ARIA.green}80`, color: inWL ? ARIA.bg : ARIA.green, background: inWL ? ARIA.green : "transparent", cursor: "pointer", fontFamily: "monospace", fontWeight: 700 }}>{inWL ? "✓WL" : "+WL"}</button>
          <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && submitTicker()} placeholder="Ticker" style={{ width: 64, fontSize: 9, padding: "2px 6px", background: ARIA.bg, border: `1px solid ${ARIA.border}`, borderRadius: 3, color: ARIA.textDim, fontFamily: "monospace", textTransform: "uppercase", outline: "none" }} />
        </div>
      </div>

      {/* Second thin row — grade · perf · 52W · Str (left), IPO (right) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "3px 12px", borderBottom: `1px solid ${ARIA.border}`, flexShrink: 0, fontFamily: "monospace", overflowX: "auto", whiteSpace: "nowrap" }}>
      {(() => {
        const csColor = (l) => (l === "A+" || l === "A") ? ARIA.green : l === "B" ? ARIA.blue : l === "C" ? ARIA.yellow : l === "D" ? "#f59e0b" : l === "F" ? ARIA.red : ARIA.textMuted;
        const pctColor = (v) => v == null ? ARIA.textMuted : v >= 80 ? ARIA.green : v >= 50 ? ARIA.blue : v >= 30 ? ARIA.yellow : ARIA.textDim;
        const rsRank = rsScoreMap.get(ticker) ?? stockInfo?.rs_rank ?? null;
        const rsColor = rsRank == null ? ARIA.textMuted : rsRank >= 90 ? ARIA.green : rsRank >= 70 ? ARIA.blue : rsRank >= 50 ? ARIA.yellow : ARIA.textDim;
        // Extension from the 20-day MA in ATR multiples (swing anchor, days-weeks).
        // Coiled = tight to the 20-day MA on EITHER side (|ext| ≤ 2 ATRs) = green;
        // loose/extended above OR well below the MA = gray. Proximity is symmetric —
        // a name hugging the MA from just below is as tight as one just above it.
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
          <span title={title} style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
            <span style={{ color: ARIA.textMuted }}>{label}</span>{node}
          </span>
        );
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "nowrap", flexShrink: 0 }}>
            {grade && (
              <span title="Overall grade" style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: gradeColor + "22", border: `1px solid ${gradeColor}55`, color: gradeColor }}>
                {grade}
              </span>
            )}
            {stat("CANSLIM", <span style={{ color: csColor(canslimGrade), fontWeight: 700 }}>{canslimGrade}</span>, "CANSLIM composite — unweighted average of O'Neil/IBD's gradeable criteria (EPS growth, accel, 5Y EPS, sales, margin, ROE, inst flow, dist-from-high, industry rank)")}
            {stat("EPS", <span style={{ color: pctColor(epsPct), fontWeight: 700 }}>{epsPct != null ? `${epsPct}` : "—"}</span>, "EPS growth (YoY) percentile vs the full universe")}
            {stat("Rev", <span style={{ color: pctColor(revPct), fontWeight: 700 }}>{revPct != null ? `${revPct}` : "—"}</span>, "Revenue growth (YoY) percentile vs the full universe")}
            {perfs.map(({ label, val }) => (
              <span key={label} style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
                <span style={{ color: ARIA.textMuted }}>{label}</span>
                <span style={{ color: ARIA.textDim, fontWeight: val != null && Math.abs(val) >= 20 ? 700 : 400 }}>
                  {val != null ? `${val >= 0 ? "+" : ""}${val.toFixed(1)}%` : "—"}
                </span>
              </span>
            ))}
            {fromHi != null && (
              <span style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
                <span style={{ color: ARIA.textMuted }}>52W</span>
                <span style={{ color: fromHi >= -20 ? ARIA.green : ARIA.textDim, fontWeight: fromHi >= -20 ? 700 : 400 }}>
                  {fromHi > 0 ? "+" : ""}{fromHi.toFixed(1)}%
                </span>
              </span>
            )}
            {stat("RS", <span style={{ color: rsColor, fontWeight: 700 }}>{rsRank != null ? rsRank : "—"}</span>, "RS score (0-100) — the same relative-strength value shown in the LAYER REGIME box (rs_rotation holds)")}
            {stat("Ext", <span style={{ color: extColor, fontWeight: 700 }}>{ext != null ? `${ext.toFixed(1)}×` : "—"}</span>, "Extension from the 20-day MA in ATR multiples (swing anchor, days-to-weeks). Green = coiled: within ~2 ATRs of the MA on either side (tight to it, above or below). Gray = not coiled: extended above (loose, don\'t chase) or well below the MA.")}
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
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: 3, fontFamily: "monospace", fontSize: 9, flexShrink: 0 }}>
            <span style={{ color: ARIA.textMuted, fontSize: 8 }}>IPO</span>
            <span title="Recent IPO (< 5 years)" style={{ fontWeight: 700, color: (Date.now() - new Date(stockInfo.ipo_date).getTime()) < 157788000000 ? ARIA.green : ARIA.textDim }}>{stockInfo.ipo_date}</span>
          </span>
        )}
      </div>

      {/* SVG D/W Chart */}
      <div style={{ height: 600, overflow: "hidden", flexShrink: 0 }}>
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
            stopLines={[
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

      {/* Ticker details — compact strip below the chart */}
      <div style={{ padding: "6px 14px", borderTop: `1px solid ${ARIA.border}`, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        {/* Left column — badges + company + description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {(has9M || stockInfo.two_day_tight || stockInfo.de_ready) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
              {has9M && <span style={badgeStyle("#f59e0b")} title="Unusual institutional volume">9M</span>}
              {!!stockInfo.two_day_tight && <span style={badgeStyle("#f472b6")} title="2-Days-Tight — last two closes within 1% + narrowing range, above the 50sma. Breakout candidate.">T2</span>}
              {!!stockInfo.de_ready && <span style={badgeStyle("#fb923c")} title={`Delayed Entry ready (2-7d post-gap, tight + narrowing, holding 4-EMA). Entry = break of ${stockInfo.de_trigger ?? "recent highs"}${stockInfo.de_hold ? ` · gap ${stockInfo.de_hold} (${stockInfo.de_hold_score}/5)` : ""}${stockInfo._epq ? ` · EP quality ${stockInfo._epq}` : ""}${stockInfo._newsPipe ? `\nCatalyst: ${stockInfo._newsPipe[0]}` : ""}`}>DE{stockInfo.de_trigger ? ` ${stockInfo.de_trigger}` : ""}{stockInfo.de_hold === "HELD" ? " ✓" : ""}</span>}
            </div>
          )}
          <div style={{ fontSize: 9, color: "#9090a0", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 1 }}>
            {stockInfo.company || ticker}
          </div>
          {description
            ? <div style={{ fontSize: 8.5, color: "#6a6a7a", lineHeight: 1.4 }}>{description}</div>
            : <div style={{ fontSize: 8.5, color: "#4a4a5a", fontStyle: "italic" }}>No description available.</div>}
        </div>
        {/* Right column — news */}
        <div style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${ARIA.border}`, paddingLeft: 14 }}>
          <div onClick={() => news.length > 0 && setNewsOpen(o => !o)}
            style={{ display: "flex", alignItems: "center", gap: 5, cursor: news.length > 0 ? "pointer" : "default", userSelect: "none", fontSize: 8, fontWeight: 700, color: "#6a6a7a", textTransform: "uppercase", letterSpacing: 0.5, padding: "1px 0" }}
            onMouseEnter={e => { if (news.length > 0) e.currentTarget.style.color = "#9090a0"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#6a6a7a"; }}>
            {news.length > 0 && <span style={{ fontSize: 7 }}>{newsOpen ? "▼" : "▶"}</span>}
            News <span style={{ color: "#4a4a5a", fontWeight: 400 }}>({news.length || stockInfo._newsPipe?.length || 0})</span>
          </div>
          {news.length === 0 && !(stockInfo._newsPipe?.length) && <div style={{ fontSize: 8.5, color: "#4a4a5a", fontStyle: "italic", marginTop: 2 }}>No recent headlines.</div>}
          {news.length === 0 && stockInfo._newsPipe?.length > 0 && (
            <div style={{ maxHeight: 150, overflowY: "auto" }}>
              {stockInfo._newsPipe.map((h, i) => (
                <div key={i} title={h} style={{ fontSize: 8.5, color: "#9090a0", padding: "2px 0", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <span style={{ color: "#5a5a6a", marginRight: 4 }}>⛭</span>{h}
                </div>
              ))}
            </div>
          )}
          {newsOpen && news.length > 0 && (
            <div style={{ maxHeight: 150, overflowY: "auto" }}>
              {news.slice(0, 8).map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", fontSize: 8.5, color: "#9090a0", textDecoration: "none", padding: "2px 0", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#c0c0d8"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#9090a0"; e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ color: "#5a5a6a", marginRight: 4 }}>{agoLabel(a.date)}</span>
                  {a.headline}
                  <span style={{ color: "#6a6a7a", marginLeft: 4 }}>{a.source}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Prior earnings responses — EPS/Sales surprise + 1d/10d reaction */}
      <div style={{ borderBottom: `1px solid ${ARIA.border}`, padding: "3px 14px 4px" }}>
        <div onClick={() => setErHistOpen((o) => { const n = !o; try { localStorage.setItem("tp-erhist-open", n ? "1" : "0"); } catch {} return n; })}
          style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", userSelect: "none", fontSize: 8, fontWeight: 700, color: "#6a6a7a", textTransform: "uppercase", letterSpacing: 0.5, padding: "1px 0" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#9090a0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#6a6a7a"; }}
          title="Prior earnings responses: EPS/Sales surprise vs estimates + the price reaction (announcement day and 10 sessions incl. drift). How does this name treat its reports?">
          <span style={{ fontSize: 7 }}>{erHistOpen ? "▼" : "▶"}</span>
          Earnings History{erHist?.ticker === ticker && erHist.history.length ? ` (${erHist.history.length}q)` : ""}
        </div>
        {erHistOpen && (() => {
          if (erHist?.ticker !== ticker) return <div style={{ fontSize: 8.5, color: "#4a4a5a", fontStyle: "italic", padding: "2px 0" }}>loading…</div>;
          if (!erHist.history.length) return <div style={{ fontSize: 8.5, color: "#4a4a5a", fontStyle: "italic", padding: "2px 0" }}>No reported quarters.</div>;
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
          const th = { padding: "2px 6px", fontSize: 7, fontWeight: 700, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.3, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, whiteSpace: "nowrap" };
          const td = { padding: "1px 6px", fontSize: 8.5, fontFamily: "monospace", textAlign: "right", whiteSpace: "nowrap", borderBottom: `1px solid ${ARIA.border}40` };
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
                    <tr><td colSpan={10} style={{ padding: "2px 6px", fontSize: 7.5, fontWeight: 800, color: ARIA.blue, background: `${ARIA.blue}14`, letterSpacing: 0.4 }} title="EPS YoY, Sales YoY and net margin have ALL accelerated for 3 straight quarters — Minervini's 'hitting on all cylinders' condition">CODE 33 — sales, earnings & margins accelerating 3 straight quarters</td></tr>
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
          width: 80, fontSize: 9, padding: "2px 5px", background: "#0a0a14",
          border: "1px solid #2a2a3a", borderRadius: 3, color: "#c0c0d8",
          fontFamily: "monospace", outline: "none",
        };
        const labelStyle = { fontSize: 8, color: "#6a6a7a", marginRight: 3 };
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
              <span style={{ fontSize: 9, fontFamily: "monospace", color: "#0d9163", fontWeight: 700 }}>
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
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 9 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "3px 8px", background: headBg, color: "#5a5a7a", textAlign: "left", fontWeight: 600, fontSize: 8, borderBottom: "1px solid #1a1a2e" }}></th>
                    {cols.map((col, ci) => (
                      <th key={col.key} style={{ padding: "3px 8px", background: headBg, color: colColors[ci], textAlign: "right", fontWeight: 700, fontSize: 8, borderBottom: "1px solid #1a1a2e", whiteSpace: "nowrap" }}>
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
                      <td style={{ padding: "3px 8px", background: headBg, color: "#6a6a7a", fontSize: 8, fontWeight: 600, borderBottom: "1px solid #111120" }}>{row}</td>
                      {cols.map((col, ci) => {
                        const s = riskScenarios[col.key];
                        const isCapped = cappedFn ? cappedFn(s) : false;
                        return (
                          <td key={col.key} style={{
                            padding: "3px 8px", textAlign: "right", borderBottom: "1px solid #111120",
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

      {/* Quarterly fundamentals — always visible below chart */}
      {(() => {
        // Normalize pipeline quarters/annual into the same shape as FMP data.
        // Pipeline revenue is raw dollars; MiniQBars expects millions.
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
        const baseSeries = qbarsMode === "annual" ? effectiveAnnuals : effectiveQuarters;
        const modeLabel = qbarsMode === "annual" ? "annual" : "quarterly";
        const series = baseSeries.map((p, i, arr) => {
          const prevMargin = i > 0 ? arr[i - 1].net_margin : null;
          const marginDelta =
            p.net_margin != null && prevMargin != null
              ? p.net_margin - prevMargin
              : null;
          const prevGross = i > 0 ? arr[i - 1].gross_margin : null;
          const grossDelta =
            p.gross_margin != null && prevGross != null
              ? +(p.gross_margin - prevGross).toFixed(2)
              : null;
          if (i < 2) return { ...p, _code33: false, _marginDelta: marginDelta, _grossDelta: grossDelta };
          const a = arr[i - 2], b = arr[i - 1], c = p;
          const accel = (x, y, z) =>
            x != null && y != null && z != null && z > y && y > x;
          const c33 =
            accel(a.eps_yoy, b.eps_yoy, c.eps_yoy) &&
            accel(a.revenue_yoy, b.revenue_yoy, c.revenue_yoy) &&
            accel(a.net_margin, b.net_margin, c.net_margin);
          return { ...p, _code33: c33, _marginDelta: marginDelta, _grossDelta: grossDelta };
        });
        if (series.length === 0) return null;
        return (
          <div style={{ padding: "6px 14px 10px", borderTop: `1px solid ${ARIA.border}`, background: ARIA.glass || "transparent" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontFamily: "monospace" }}>
              <span style={{ fontSize: 8, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
                Last {series.length} Quarter{series.length === 1 ? "" : "s"} · {qbarsMode !== "annual" && erQ ? "Street Actuals (adjusted)" : quarters.length > 0 ? "Finviz Actuals" : "Pipeline Data"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                <button onClick={() => setQbarsModePersist("quarter")} style={pillStyle(qbarsMode === "quarter", ARIA.blue)}>Quarterly</button>
                <button onClick={() => setQbarsModePersist("annual")} style={pillStyle(qbarsMode === "annual", ARIA.blue)}>Annual</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <MiniQBars quarters={series} accessor={(q) => q.eps} yoyAccessor={(q) => q.eps_yoy} color={ARIA.blue} labelFmt={(v) => v.toFixed(2)} title="EPS (Diluted)" ARIA={ARIA} passYoy={25} hotYoy={40} />
                <MiniQBars quarters={series} accessor={(q) => q.net_margin} yoyAccessor={(q) => q._marginDelta} color={ARIA.cyan} labelFmt={(v) => v.toFixed(1) + "%"} title="Net Margin" ARIA={ARIA} passYoy={2} hotYoy={5} />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <MiniQBars quarters={series} accessor={(q) => q.revenue} yoyAccessor={(q) => q.revenue_yoy} color={ARIA.purple} labelFmt={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}B` : `${Math.round(v)}M`} title="Revenue" ARIA={ARIA} passYoy={20} hotYoy={40} />
                <MiniQBars quarters={series} accessor={(q) => q.gross_margin} yoyAccessor={(q) => q._grossDelta} color={ARIA.green} labelFmt={(v) => v.toFixed(1) + "%"} title="Gross Margin" ARIA={ARIA} passYoy={2} hotYoy={5} />

              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Watchlist (Phase 2.4)
// ──────────────────────────────────────────────────────────────────────────
//
// Persistent ticker list with live quote updates. localStorage-backed for
// Phase 2.4; Vercel KV sync via /api/userdata lands in Phase 4.
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// Watchlist (Phase 2.7 — Aria-faithful with Portfolio + Themes view)
// ──────────────────────────────────────────────────────────────────────────
//
// Aria reference: dashboard.html lines 3801-3843 + JS 4360-4530
// Two sections: Portfolio (yellow) + Watchlist (green)
// Two views: List (default tables) + Themes (grouped by subtheme with rank)
// Rank metrics: Chg% / RVol / RS / CR% / Open%
// Theme groups computed client-side from dashboard_data.json themes field.
// ──────────────────────────────────────────────────────────────────────────

const RANK_METRICS = [
  { key: "change", label: "Chg%" },
  { key: "rvol", label: "RVol" },
  { key: "rs", label: "EIF" },
  { key: "cr", label: "CR%" },
  { key: "chgOpen", label: "Open%" },
];

// Sortable + keyboard-navigable table for one watchlist/portfolio section.
// Extracted from Watchlist so it can use hooks (sort + selection state).
function WatchlistSectionTable({
  rows,
  accent,
  list,
  onAddMany,
  universe,
  count,
  onTickerClick,
  removeTicker,
  tickerStrengthMap,
  onChainClick,
  promoteTicker,
}) {
  const ARIA = useAriaTheme();
  const deckSet = useOnDeckSet();
  // Portfolio membership — held tickers appearing in the other sections
  // (On Deck / Focus / Watchlist) get a light-green row tint.
  const [_pfList] = useLocalStorageList("themepulse-portfolio");
  const pfSet = useMemo(() => new Set(_pfList), [_pfList]);
  const [sortKey, setSortKey] = useState("change");
  const [sortDir, setSortDir] = useState("desc"); // "asc" | "desc"
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(`themepulse-${list}-collapsed`) === "1"; } catch { return false; }
  });
  // add box: local input + validation feedback ("added 2 · unknown: XYZQ")
  const [addVal, setAddVal] = useState("");
  const [addMsg, setAddMsg] = useState(null);
  const addMsgTimer = React.useRef(null);
  const submitAdd = () => {
    const toks = [...new Set(addVal.toUpperCase().split(/[,\s]+/).map((t) => t.trim()).filter(Boolean))];
    if (!toks.length) return;
    const known = universe && universe.size ? toks.filter((t) => universe.has(t)) : toks;
    const unknown = toks.filter((t) => !known.includes(t));
    if (known.length) onAddMany?.(known);
    setAddVal("");
    setAddMsg({ ok: known.length, bad: unknown });
    if (addMsgTimer.current) clearTimeout(addMsgTimer.current);
    addMsgTimer.current = setTimeout(() => setAddMsg(null), 5000);
  };
  const sugg = useMemo(() => {
    const q = addVal.toUpperCase().split(/[,\s]+/).pop() || "";
    if (!q || q.length < 1 || !universe) return [];
    const out = [];
    for (const t of universe) { if (t.startsWith(q)) { out.push(t); if (out.length >= 8) break; } }
    return out;
  }, [addVal, universe]);
  const toggleCollapsed = useCallback(() => {
    setCollapsed(v => {
      const next = !v;
      try { localStorage.setItem(`themepulse-${list}-collapsed`, next ? "1" : "0"); } catch {}
      return next;
    });
  }, [list]);
  const wrapRef = React.useRef(null);

  const colorChg = (v) =>
    v == null || Math.abs(v) <= 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;
  const fmtChg = (v) =>
    v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";

  // Sort rows. "ticker" + "subtheme" sort as strings, everything else numeric.
  const sortedRows = useMemo(() => {
    const arr = rows.slice();
    arr.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === "ticker" || sortKey === "subtheme" || sortKey === "chain" || sortKey === "layer") {
        if (sortKey === "chain") {
          const ae = TICKER_CHAIN_MAP.get(a.ticker) || [];
          const be = TICKER_CHAIN_MAP.get(b.ticker) || [];
          av = ae.length ? ae[0].themeId : "";
          bv = be.length ? be[0].themeId : "";
        }
        av = (av || "").toString();
        bv = (bv || "").toString();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      av = Number(av) || 0;
      bv = Number(bv) || 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const visibleTickers = sortedRows.map((r) => r.ticker);
  useEffect(() => {
    if (!visibleTickers.length) return;
    if (!selectedTicker || !visibleTickers.includes(selectedTicker)) {
      setSelectedTicker(visibleTickers[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTickers.join(",")]);

  const onKeyDown = useCallback(
    (e) => {
      if (!visibleTickers.length) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const cur = selectedTicker ? visibleTickers.indexOf(selectedTicker) : -1;
      let next = cur < 0 ? 0 : cur + (e.key === "ArrowDown" ? 1 : -1);
      if (next < 0) next = 0;
      if (next >= visibleTickers.length) next = visibleTickers.length - 1;
      const t = visibleTickers[next];
      setSelectedTicker(t);
      onTickerClick && onTickerClick(t);
      scrollRowIntoScroller(wrapRef.current?.querySelector(`tr[data-ticker="${t}"]`));
    },
    [visibleTickers, selectedTicker, onTickerClick]
  );

  const toggleSort = (key) => {
    setSortKey((k) => {
      if (k === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return k;
      }
      // New column → default desc for numeric, asc for ticker/subtheme
      setSortDir(key === "ticker" || key === "subtheme" ? "asc" : "desc");
      return key;
    });
  };

  // Core columns match the Sector Rotation / Scan Watch tables: RS Day% · ZVR · CR% · EIF.
  const headers = [
    { k: "ticker", label: "Ticker", align: "left" },
    { k: "layer", label: "Chain · Layer", align: "left" },
    { k: "change", label: "Chg%" },
    { k: "rsDay", label: "RS Day%" },
    { k: "zvr", label: "ZVR" },
    { k: "cr", label: "CR%" },
    { k: "rs", label: "EIF" },
    { k: "rsWk", label: "RS Wk%" },
    { k: "rsMth", label: "RS Mth%" },
    { k: "adr", label: "ADR" },
    { k: "strScore", label: "Str" },
    { k: "setupRank", label: "Setup" },
    { k: null, label: "" },
  ];

  return (
    <div style={{ padding: "6px 8px", borderBottom: `1px solid ${ARIA.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span
          onClick={toggleCollapsed}
          style={{
            color: accent,
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          {collapsed ? "▶" : "▼"} {list === "portfolio" ? "Portfolio" : list === "ondeck" ? "◆ On Deck" : list === "focus" ? "⚡ Focus" : "Watchlist"}
        </span>
        <span style={{ color: ARIA.textMuted, fontSize: 9 }}>({count})</span>
        {rows.length < count && (
          <span title="Rows hidden by the Chg>0% filter (or awaiting a first quote) — toggle the Filter pill above to show all"
            style={{ color: ARIA.yellow, fontSize: 8, fontWeight: 700 }}>· {count - rows.length} hidden by filter</span>
        )}
        {addMsg && (
          <span style={{ marginLeft: "auto", fontSize: 8, fontFamily: "monospace" }}>
            {addMsg.ok > 0 && <span style={{ color: ARIA.green }}>✓ added {addMsg.ok}</span>}
            {addMsg.ok > 0 && addMsg.bad.length > 0 && <span style={{ color: ARIA.textMuted }}> · </span>}
            {addMsg.bad.length > 0 && <span style={{ color: ARIA.red }}>unknown: {addMsg.bad.join(", ")}</span>}
          </span>
        )}
        <input
          value={addVal}
          onChange={(e) => setAddVal(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          placeholder="add ticker(s)…"
          list={`tp-sugg-${list}`}
          title="Type one or paste several (comma/space separated) — validated against the universe"
          style={{
            marginLeft: addMsg ? 4 : "auto",
            width: 96,
            fontSize: 9,
            padding: "2px 5px",
            background: ARIA.bg,
            border: `1px solid ${ARIA.border}`,
            borderRadius: 3,
            color: ARIA.text,
            fontFamily: "monospace",
            textTransform: "uppercase",
            outline: "none",
          }}
        />
        <datalist id={`tp-sugg-${list}`}>
          {sugg.map((t) => <option key={t} value={t} />)}
        </datalist>
        <button
          onClick={submitAdd}
          title="Add to list (Enter also works)"
          style={{
            fontSize: 9,
            padding: "1px 6px",
            borderRadius: 3,
            cursor: "pointer",
            background: `${accent}26`,
            border: `1px solid ${accent}`,
            color: accent,
          }}
        >
          +
        </button>
      </div>
      {collapsed ? null : sortedRows.length === 0 ? (
        <div style={{ color: ARIA.textMuted, fontSize: 8, padding: "2px 0" }}>Empty</div>
      ) : (
        <div
          ref={wrapRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          style={{ outline: "none", overflowX: "auto" }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
            <thead>
              <tr>
                {headers.map((h, i) => {
                  const isSorted = h.k && sortKey === h.k;
                  const arrow = isSorted ? (sortDir === "asc" ? " ▲" : " ▼") : "";
                  return (
                    <th
                      key={i}
                      onClick={() => h.k && toggleSort(h.k)}
                      title={COL_HELP[h.k === "change" ? "chg" : h.k === "setupRank" ? "setup" : h.k === "layer" ? "theme" : h.k] || undefined}
                      style={{
                        padding: "3px 5px",
                        fontSize: 7,
                        fontWeight: 700,
                        color: isSorted ? ARIA.green : ARIA.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: 0.3,
                        textAlign: h.align || "right",
                        borderBottom: `1px solid ${ARIA.border}`,
                        whiteSpace: "nowrap",
                        cursor: h.k ? "pointer" : "default",
                        userSelect: "none",
                      }}
                    >
                      {h.label}
                      {arrow}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const cell = {
                  padding: "2px 5px",
                  fontSize: 9,
                  textAlign: "right",
                  borderBottom: `1px solid ${ARIA.border}`,
                  whiteSpace: "nowrap",
                };
                const fmtVol = (v) => {
                  if (!v) return "—";
                  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
                  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
                  return String(v);
                };
                const colorBo = (v) =>
                  v == null || v === 0
                    ? ARIA.textMuted
                    : v >= 7
                    ? ARIA.green
                    : v >= 5
                    ? ARIA.blue
                    : ARIA.textDim;
                const colorRvol = (v) =>
                  v == null ? ARIA.textMuted : v >= 1.5 ? ARIA.purple : ARIA.textMuted;
                const colorCr = (v) =>
                  v == null ? ARIA.textMuted : v >= 70 ? ARIA.green : v <= 30 ? ARIA.red : ARIA.textDim;
                const isSel = selectedTicker === r.ticker;
                return (
                  <tr
                    key={r.ticker}
                    data-ticker={r.ticker}
                    onClick={() => {
                      setSelectedTicker(r.ticker);
                      onTickerClick && onTickerClick(r.ticker);
                    }}
                    style={{
                      cursor: "pointer",
                      background: isSel ? `${ARIA.cyan}26` : deckSet.has(r.ticker) ? `${ARIA.gold}1f` : (list !== "portfolio" && pfSet.has(r.ticker)) ? `${ARIA.green}1f` : "transparent",
                      borderLeft: "2px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSel) e.currentTarget.style.background = ARIA.bgHover;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isSel ? `${ARIA.cyan}26` : deckSet.has(r.ticker) ? `${ARIA.gold}1f` : (list !== "portfolio" && pfSet.has(r.ticker)) ? `${ARIA.green}1f` : "transparent";
                    }}
                  >
                    <td style={{ ...cell, textAlign: "left", fontWeight: 700, color: ARIA.text }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        {r.ticker}
                        {r.is9m && (
                          <span
                            title="9M — today's volume ≥ 8.9M but avg < 8.9M"
                            style={{
                              fontSize: 6,
                              fontWeight: 800,
                              color: ARIA.yellow,
                              border: `1px solid ${ARIA.yellow}`,
                              background: `${ARIA.yellow}26`,
                              padding: "0 2px",
                              borderRadius: 2,
                            }}
                          >
                            9M
                          </span>
                        )}
                        {r.tt && <span title="2-Days-Tight — closes within 1% + narrowing range. Breakout candidate" style={{ fontSize: 6, fontWeight: 800, color: "#f472b6", border: "1px solid #f472b680", background: "rgba(244,114,182,0.12)", padding: "0 2px", borderRadius: 2, lineHeight: "10px" }}>T2</span>}
                        {r.de && <span title={`Delayed Entry ready — entry = break of ${r.deTrig ?? "recent highs"}${r.deHold ? ` · gap ${r.deHold}` : ""}${r.news ? `\nCatalyst: ${r.news[0]}` : ""}`} style={{ fontSize: 6, fontWeight: 800, color: "#fb923c", border: "1px solid #fb923c80", background: "rgba(251,146,60,0.12)", padding: "0 2px", borderRadius: 2, lineHeight: "10px" }}>DE</span>}
                        {r.news && <span onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("tp-news-pop", { detail: { x: e.clientX, y: e.clientY, ticker: r.ticker, items: r.news } })); }} title={r.inPlay ? "In play today — click for catalyst headlines" : "Click for catalyst headlines"} style={{ fontSize: r.inPlay ? 9 : 7, opacity: r.inPlay ? 1 : 0.7, lineHeight: "10px", cursor: "pointer", filter: r.inPlay ? "drop-shadow(0 0 3px #fbbf24) saturate(1.5)" : "none" }}>📰</span>}
                    {r.rsRank != null && r.rsRank >= 85 && r.wkRs != null && r.wkRs <= -2 && <span title={`Leader diverging — RS rank ${r.rsRank} but ${r.wkRs > 0 ? "+" : ""}${r.wkRs}% vs SPY THIS week. The rank is trailing; the current tape disagrees.`} style={{ fontSize: 7, lineHeight: "10px", color: "#d9a441" }}>⚠</span>}
                      </span>
                    </td>
                    <td style={{ ...cell, textAlign: "left", color: ARIA.textDim, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }} title={r.layer}>
                      {r.layer || "\u2014"}
                    </td>
                    <td style={{ ...cell, color: colorChg(r.change) }}>{fmtChg(r.change)}</td>
                    <td style={{ ...cell, color: r.rsDay == null || Math.abs(r.rsDay) <= 2 ? ARIA.textDim : r.rsDay > 0 ? ARIA.green : ARIA.red, fontWeight: r.rsDay != null && Math.abs(r.rsDay) > 2 ? 600 : 400 }}>
                      {r.rsDay == null ? "\u2014" : (r.rsDay > 0 ? "+" : "") + r.rsDay.toFixed(2) + "%"}
                    </td>
                    <td style={{ ...cell, color: r.zvr == null ? ARIA.textMuted : Math.abs(r.zvr) >= 200 ? (r.zvr < 0 ? "#ef4444" : "#fbbf24") : Math.abs(r.zvr) >= 130 ? (r.zvr < 0 ? ARIA.red : ARIA.green) : ARIA.textMuted, fontWeight: r.zvr != null && Math.abs(r.zvr) >= 130 ? 700 : 400 }}>
                      {r.zvr == null ? "\u2014" : r.zvr + "%"}
                    </td>
                    <td style={{ ...cell, color: colorCr(r.cr) }}>
                      {r.cr != null ? Math.round(r.cr) + "%" : "\u2014"}
                    </td>
                    <td style={{ ...cell, color: r.rs >= 55 ? ARIA.green : ARIA.textDim, fontWeight: r.rs >= 55 ? 700 : 400 }}>
                      {r.rs || "\u2014"}
                    </td>
                    <td style={{ ...cell, color: r.rsWk == null || Math.abs(r.rsWk) < 10 ? ARIA.textDim : r.rsWk > 0 ? ARIA.green : ARIA.red, fontWeight: r.rsWk != null && Math.abs(r.rsWk) >= 10 ? 600 : 400 }}>
                      {r.rsWk == null ? "\u2014" : (r.rsWk > 0 ? "+" : "") + r.rsWk.toFixed(1) + "%"}
                    </td>
                    <td style={{ ...cell, color: r.rsMth == null || Math.abs(r.rsMth) < 20 ? ARIA.textDim : r.rsMth > 0 ? ARIA.green : ARIA.red, fontWeight: r.rsMth != null && Math.abs(r.rsMth) >= 20 ? 600 : 400 }}>
                      {r.rsMth == null ? "\u2014" : (r.rsMth > 0 ? "+" : "") + r.rsMth.toFixed(1) + "%"}
                    </td>
                    <td style={{ ...cell, color: r.adr >= 4 ? ARIA.cyan : ARIA.textDim, fontWeight: r.adr >= 4 ? 700 : 400 }}>
                      {r.adr ? r.adr.toFixed(1) + "%" : "\u2014"}
                    </td>
                    <td style={{ ...cell, color: r.strScore >= 65 ? ARIA.green : ARIA.textDim, fontWeight: r.strScore >= 65 ? 700 : 400 }}>
                      {r.strScore != null ? r.strScore : "\u2014"}
                    </td>
                    <td style={{ ...cell, textAlign: "center", padding: "2px 4px" }}>
                      {r.setup
                        ? <span title={r.setup.desc} style={{ fontSize: 7, fontWeight: 800, color: r.setup.color, background: `${r.setup.color}1f`, border: `1px solid ${r.setup.color}55`, borderRadius: 2, padding: "0 3px", letterSpacing: 0.3 }}>{r.setup.key}</span>
                        : <span style={{ color: ARIA.textMuted, fontSize: 8 }}>{"\u2014"}</span>}
                    </td>
                    <td style={{ ...cell, padding: "2px 4px", whiteSpace: "nowrap" }}>
                      {promoteTicker && (
                        <button
                          onClick={(e) => { e.stopPropagation(); promoteTicker(r.ticker); }}
                          title="Promote to On Deck — next in line to buy (moves out of Focus, gold-highlighted everywhere)"
                          style={{ background: "transparent", border: "none", color: ARIA.gold, cursor: "pointer", fontSize: 10, padding: 0, marginRight: 4, lineHeight: 1 }}
                        >
                          ◆
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTicker(list, r.ticker);
                        }}
                        title={list === "ondeck" ? "Send back to Focus" : "Remove"}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: ARIA.textMuted,
                          cursor: "pointer",
                          fontSize: 12,
                          padding: 0,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Watchlist({ stockMap, onTickerClick, tickerStrengthMap, onChainClick }) {
  const ARIA = useAriaTheme();
  const [view, setView] = useState(
    () => localStorage.getItem("themepulse-pw-view") || "themes"
  );
  const [rankBy, setRankBy] = useState(
    () => localStorage.getItem("themepulse-pw-rankby") || "change"
  );
  // Shared hook so chart header +WL/+PF buttons stay in sync with this panel
  const [portfolio, setPortfolio] = useLocalStorageList("themepulse-portfolio");
  const [watchlist, setWatchlist] = useLocalStorageList("themepulse-watchlist");
  const [focus, setFocus] = useLocalStorageList("themepulse-focus");
  const [ondeck, setOndeck] = useLocalStorageList("themepulse-ondeck");
  const [expandedThemes, setExpandedThemes] = useState(() => new Set());
  const [chgPosFilter, setChgPosFilter] = useState(
    () => localStorage.getItem("themepulse-pw-chgpos") === "true"
  );
  const toggleChgPos = useCallback(() => {
    setChgPosFilter((prev) => {
      const next = !prev;
      localStorage.setItem("themepulse-pw-chgpos", String(next));
      return next;
    });
  }, []);

  const setViewPersist = useCallback((v) => {
    setView(v);
    localStorage.setItem("themepulse-pw-view", v);
  }, []);
  const setRankByPersist = useCallback((k) => {
    setRankBy(k);
    localStorage.setItem("themepulse-pw-rankby", k);
  }, []);

  // Validated multi-add: accepts "NVDA, MU AMD" style input, validates each
  // symbol against the universe, adds the valid ones, and reports the rest —
  // no more silent junk adds that look like the add "didn't work".
  const universeSet = useMemo(() => new Set(Object.keys(stockMap || {})), [stockMap]);
  const [quickAdd, setQuickAdd] = useState("");  // quick-add box (side panel)
  const addManyPortfolio = useCallback((tks) => {
    setPortfolio((prev) => { const s = new Set(prev); tks.forEach((t) => s.add(t)); return [...s]; });
  }, [setPortfolio]);
  const addManyWatchlist = useCallback((tks) => {
    setWatchlist((prev) => { const s = new Set(prev); tks.forEach((t) => s.add(t)); return [...s]; });
  }, [setWatchlist]);
  const addManyFocus = useCallback((tks) => {
    setFocus((prev) => { const s = new Set(prev); tks.forEach((t) => s.add(t)); return [...s]; });
  }, [setFocus]);
  // On Deck is a tier ABOVE Focus, picked from it: promoting moves the ticker
  // up (out of Focus), removing from On Deck sends it back down to Focus.
  const addManyOndeck = useCallback((tks) => {
    setOndeck((prev) => { const s = new Set(prev); tks.forEach((t) => s.add(t)); return [...s]; });
    setFocus((prev) => prev.filter((x) => !tks.includes(x)));
  }, [setOndeck, setFocus]);
  const promoteToDeck = useCallback((t) => addManyOndeck([t]), [addManyOndeck]);
  const removeTicker = useCallback((list, t) => {
    if (list === "portfolio") {
      setPortfolio((prev) => prev.filter((x) => x !== t));
    } else if (list === "focus") {
      setFocus((prev) => prev.filter((x) => x !== t));
    } else if (list === "ondeck") {
      setOndeck((prev) => prev.filter((x) => x !== t));
      setFocus((prev) => (prev.includes(t) ? prev : [...prev, t]));
    } else {
      setWatchlist((prev) => prev.filter((x) => x !== t));
    }
  }, []);

  // Live quotes for all unique tickers
  const allTickers = useMemo(() => {
    const set = new Set([...portfolio, ...ondeck, ...focus, ...watchlist, "SPY"]); // SPY for RS Day% vs-market
    return Array.from(set);
  }, [portfolio, ondeck, focus, watchlist]);
  const { quotes } = useLiveQuotes(allTickers, 60000);

  // Per-row data merging static + live
  const buildRow = useCallback(
    (ticker) => {
      const s = stockMap?.[ticker] || {};
      const q = quotes.get(ticker);
      const price = q?.price ?? s.price ?? s.close ?? null;
      const open = q?.open ?? null;
      const high = q?.high ?? null;
      const low = q?.low ?? null;
      const liveVol = q?.volume ?? null;
      const avgVol = s.avg_volume_raw || q?.avgVolume || 0;
      const change = q?.change ?? s.change_pct ?? 0;
      const chgOpen =
        open != null && open > 0
          ? Math.round(((price - open) / open) * 10000) / 100
          : null;
      const cr = computeCR(q, s);
      const rvol =
        liveVol && avgVol > 0
          ? Math.round((liveVol / avgVol) * 100) / 100
          : s.rel_volume || 0;
      // Match the rotation/Scan-Watch core: RS Day% (vs SPY), ZVR, Setup badge.
      const spyChg = quotes.get("SPY")?.change ?? 0;
      const rsDay = change != null ? Math.round((change - spyChg) * 100) / 100 : null;
      const _et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const _mins = _et.getHours() * 60 + _et.getMinutes();
      const _frac = _mins >= 570 && _mins < 960 ? Math.max(0.02, sessionVolFraction(_mins - 570)) : 1.0;
      let zvr = null;
      if (liveVol && avgVol > 0) zvr = Math.round((liveVol / (avgVol * _frac)) * 100);
      else if (s.rel_volume > 0) zvr = Math.round(s.rel_volume * 100);
      if (zvr != null && change != null && change < 0) zvr = -zvr;
      const eif = s.framework_score ?? s.rs_rank ?? 0;
      const strScore = tickerStrengthMap?.[ticker] ?? null;
      // RS week/month vs SPY + the rotation layer — to mirror the Sector
      // Rotation regime table per-stock columns (Layer, RS Day/Wk/Mth%).
      const spyWk = stockMap?.SPY?.return_1w ?? 0;
      const spyMth = stockMap?.SPY?.return_1m ?? 0;
      const rsWk = s.return_1w != null ? Math.round((s.return_1w - spyWk) * 100) / 100 : null;
      const rsMth = s.return_1m != null ? Math.round((s.return_1m - spyMth) * 100) / 100 : null;
      const _tc = TICKER_CHAIN_MAP.get(ticker);
      const _chainDisp = _tc && _tc.length
        ? (DRAWER_SUBTHEMES.find((d) => d.themeId === _tc[0].themeId)?.theme ?? _tc[0].themeId)
        : ((s.themes && s.themes[0] && s.themes[0].theme) || s.sector || "");
      const _layerDisp = _tc && _tc.length ? _tc[0].layer : ((s.themes && s.themes[0] && s.themes[0].subtheme) || s.industry || "");
      const layer = _chainDisp && _layerDisp ? `${_chainDisp} · ${_layerDisp}` : (_layerDisp || _chainDisp || "");
      const setup = chainSetup({
        rs: eif, rsRank: s.rs_rank, cr, zvr, alpha: rsDay, chg: change, str: strScore,
        erDays: s.earnings_days, off52: s.off_52w_high, d20: s.dist_20dma_atrx, d50: s.dist_50sma_atrx, adr: s.adr_pct,
      });
      return {
        ticker,
        price,
        change,
        chg: change, // alias for ScanWatchTable
        chgOpen,
        rsDay,
        rsWk,
        rsMth,
        layer,
        zvr,
        cr,
        rvol,
        liveVol,
        adr: s.adr_pct || 0,
        qmagScore: s.qmag_score || 0,
        strScore,
        is9m: !!(liveVol && liveVol >= 8.9e6 && (avgVol || 0) < 8.9e6),
        rsNH: !!s.rs_line_new_high, tt: !!s.two_day_tight, de: !!s.de_ready, deTrig: s.de_trigger ?? null, deHold: s.de_hold ?? null, news: s._newsPipe ?? null, inPlay: !!s._inPlay,
        rs: eif,
        setup,
        setupRank: setup?.rank ?? 0,
        erDays: s.earnings_days ?? null,
        accel: s.accel || 0,
        grade: s.grade || "",
        theme: (s.themes && s.themes[0] && s.themes[0].theme) || s.sector || "",
        subtheme:
          (s.themes && s.themes[0] && s.themes[0].subtheme) || s.industry || "",
      };
    },
    [stockMap, quotes, tickerStrengthMap]
  );

  const portRows = useMemo(
    () => portfolio.map(buildRow),
    [portfolio, buildRow]
  );
  const focusRows = useMemo(
    () => focus.map(buildRow),
    [focus, buildRow]
  );
  const ondeckRows = useMemo(
    () => ondeck.map(buildRow),
    [ondeck, buildRow]
  );
  const watchRows = useMemo(
    () => watchlist.map(buildRow),
    [watchlist, buildRow]
  );

  // Build a subtheme index from the full universe — used by the Discover
  // section to surface owned-theme tickers the user doesn't yet have.
  const subthemeIndex = useMemo(() => {
    const idx = new Map();
    if (!stockMap) return idx;
    Object.values(stockMap).forEach((s) => {
      const sub =
        (s.themes && s.themes[0] && s.themes[0].subtheme) ||
        s.industry ||
        "";
      if (!sub) return;
      if (!idx.has(sub)) idx.set(sub, []);
      idx.get(sub).push(s);
    });
    return idx;
  }, [stockMap]);

  // Theme groups for Themes view: group all rows by subtheme + compute
  // discoveries (high-RS, high-RVol tickers in same subtheme not owned).
  const themeGroups = useMemo(() => {
    const all = [...portRows, ...watchRows];
    const dedup = new Map();
    all.forEach((r) => {
      if (!dedup.has(r.ticker)) dedup.set(r.ticker, r);
    });
    const ownedSet = new Set([...portfolio, ...watchlist]);
    const byTheme = new Map();
    dedup.forEach((r) => {
      const key = r.subtheme || "Other";
      if (!byTheme.has(key)) {
        byTheme.set(key, {
          name: key,
          theme: r.theme,
          rows: [],
        });
      }
      byTheme.get(key).rows.push(r);
    });
    const groups = Array.from(byTheme.values());
    groups.forEach((g) => {
      const n = g.rows.length;
      if (n) {
        const sum = (k) => g.rows.reduce((acc, r) => acc + (r[k] || 0), 0);
        g.avgChg = sum("change") / n;
        g.avgChgOpen = sum("chgOpen") / n;
        g.avgRvol = sum("rvol") / n;
        g.avgRs = Math.round(sum("rs") / n);
        g.avgCr = Math.round(sum("cr") / n);
        g.count = n;
      }
      // Discover: stocks in the same subtheme that the user doesn't own,
      // filtered by RS ≥ 80 AND stale rel_volume ≥ 1.5x. Top 8.
      const peers = subthemeIndex.get(g.name) || [];
      g.discoveries = peers
        .filter((s) => {
          if (!s.ticker || ownedSet.has(s.ticker)) return false;
          if ((s.rs_rank || 0) < 80) return false;
          if ((s.rel_volume || 0) < 1.5) return false;
          if ((s.price || s.close || 0) < 5) return false;
          return true;
        })
        .sort((a, b) => (b.rs_rank || 0) - (a.rs_rank || 0))
        .slice(0, 8)
        .map((s) => ({
          ticker: s.ticker,
          rs: s.rs_rank || 0,
          change: s.change_pct || 0,
          rvol: s.rel_volume || 0,
        }));
    });
    return groups;
  }, [portRows, watchRows, portfolio, watchlist, subthemeIndex]);

  const rankVal = useCallback(
    (r) => {
      switch (rankBy) {
        case "rvol":
          return r.rvol || 0;
        case "rs":
          return r.rs || 0;
        case "cr":
          return r.cr || 0;
        case "chgOpen":
          return r.chgOpen || 0;
        default:
          return r.change || 0;
      }
    },
    [rankBy]
  );

  const fmtRank = useCallback(
    (r) => {
      const v = rankVal(r);
      switch (rankBy) {
        case "rvol":
          return v.toFixed(1) + "x";
        case "rs":
          return "RS" + Math.round(v);
        case "cr":
          return Math.round(v) + "%";
        case "chgOpen":
        default:
          return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
      }
    },
    [rankBy, rankVal]
  );

  const themeAvg = useCallback(
    (g) => {
      switch (rankBy) {
        case "rvol":
          return g.avgRvol || 0;
        case "rs":
          return g.avgRs || 0;
        case "cr":
          return g.avgCr || 0;
        case "chgOpen":
          return g.avgChgOpen || 0;
        default:
          return g.avgChg || 0;
      }
    },
    [rankBy]
  );

  const sortedGroups = useMemo(() => {
    const groups = themeGroups.slice().sort((a, b) => themeAvg(b) - themeAvg(a));
    if (!chgPosFilter) return groups;
    // Filter each group's rows to only Chg>0%, drop empty groups
    return groups
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => (r.change || 0) > 0),
      }))
      .filter((g) => g.rows.length > 0);
  }, [themeGroups, themeAvg, chgPosFilter]);

  const colorChg = (v) =>
    v == null || Math.abs(v) <= 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;
  const fmtChg = (v) =>
    v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";

  // ── Themes view ──
  const renderThemes = () => {
    if (sortedGroups.length === 0) {
      return (
        <div
          style={{
            color: ARIA.textMuted,
            fontSize: 9,
            padding: 8,
          }}
        >
          Add watchlist tickers first.
        </div>
      );
    }

    // Global rank across all rows for per-ticker rank pills
    const allRows = [];
    sortedGroups.forEach((g) => g.rows.forEach((r) => allRows.push(r)));
    const globalRanked = allRows.slice().sort((a, b) => rankVal(b) - rankVal(a));
    const globalRankMap = {};
    globalRanked.forEach((r, i) => (globalRankMap[r.ticker] = i + 1));

    return sortedGroups.map((g) => {
      const isPos = (g.avgChg || 0) >= 0;
      const barW = Math.min(100, (Math.abs(g.avgChg || 0) / 3) * 100);
      const isExp = expandedThemes.has(g.name);
      const sortedTk = g.rows.slice().sort((a, b) => rankVal(b) - rankVal(a));
      const maxShow = isExp ? 999 : 10;
      const shown = sortedTk.slice(0, maxShow);
      const hidden = sortedTk.length - shown.length;

      return (
        <div
          key={g.name}
          style={{
            borderBottom: `1px solid ${ARIA.border}`,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${barW}%`,
              background: isPos
                ? "rgba(43,184,134,0.08)"
                : "rgba(248,113,113,0.08)",
              pointerEvents: "none",
            }}
          />
          <div style={{ padding: "6px 8px", position: "relative" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 4,
                marginBottom: 3,
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 10,
                  color: ARIA.text,
                }}
              >
                {g.name}
              </span>
              {g.theme && g.theme !== g.name && (
                <span
                  style={{
                    fontSize: 8,
                    color: ARIA.textMuted,
                    textTransform: "uppercase",
                  }}
                >
                  {g.theme}
                </span>
              )}
              <span style={{ fontSize: 8, color: ARIA.textMuted }}>
                ({g.count})
              </span>
            </div>
            {/* ETF proxies — clickable, opens chart panel */}
            {(() => {
              const etfs = etfsForTheme(g.name, g.theme);
              if (!etfs.length) return null;
              return (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 3,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 7,
                      color: ARIA.textMuted,
                      letterSpacing: 0.4,
                      alignSelf: "center",
                      marginRight: 2,
                    }}
                  >
                    ETF
                  </span>
                  {etfs.map((t) => (
                    <span
                      key={t}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (typeof window !== "undefined") {
                          window.dispatchEvent(
                            new CustomEvent("tp-open-chart", { detail: t })
                          );
                        }
                      }}
                      title={`Open ${t} chart`}
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: ARIA.cyan,
                        border: `1px solid ${ARIA.cyan}80`,
                        background: `${ARIA.cyan}14`,
                        padding: "0 4px",
                        borderRadius: 2,
                        cursor: "pointer",
                        fontFamily: "monospace",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              );
            })()}
            {/* Aggregate stats row */}
            <div
              style={{
                display: "flex",
                gap: 8,
                fontSize: 8,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  color: colorChg(g.avgChg),
                  fontWeight: 700,
                }}
              >
                {(g.avgChg > 0 ? "+" : "") + (g.avgChg || 0).toFixed(2) + "%"}
                <span
                  style={{
                    fontSize: 7,
                    color: ARIA.textMuted,
                    display: "block",
                  }}
                >
                  AVG CHG
                </span>
              </span>
              <span
                style={{
                  color: g.avgRvol >= 1.5 ? ARIA.purple : ARIA.textMuted,
                }}
              >
                {(g.avgRvol || 0).toFixed(1) + "x"}
                <span
                  style={{
                    fontSize: 7,
                    color: ARIA.textMuted,
                    display: "block",
                  }}
                >
                  RVOL
                </span>
              </span>
              {g.avgCr != null && (
                <span
                  style={{
                    color:
                      g.avgCr >= 70
                        ? ARIA.green
                        : g.avgCr >= 40
                        ? ARIA.textDim
                        : ARIA.red,
                  }}
                >
                  {g.avgCr + "%"}
                  <span
                    style={{
                      fontSize: 7,
                      color: ARIA.textMuted,
                      display: "block",
                    }}
                  >
                    CR%
                  </span>
                </span>
              )}
              <span
                style={{
                  color:
                    g.avgRs >= 80
                      ? ARIA.green
                      : g.avgRs >= 50
                      ? ARIA.text
                      : ARIA.red,
                }}
              >
                {g.avgRs}
                <span
                  style={{
                    fontSize: 7,
                    color: ARIA.textMuted,
                    display: "block",
                  }}
                >
                  AVG RS
                </span>
              </span>
            </div>
            {/* Ranked ticker pills */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 3,
                alignItems: "center",
              }}
            >
              {shown.map((r, i) => {
                const rank = i + 1;
                const gRank = globalRankMap[r.ticker] || "—";
                const rankC =
                  rank <= 3
                    ? ARIA.yellow
                    : rank <= 5
                    ? ARIA.textDim
                    : ARIA.textMuted;
                const gRankC =
                  gRank <= 10
                    ? ARIA.cyan
                    : gRank <= 25
                    ? ARIA.textDim
                    : ARIA.textMuted;
                const chgC = colorChg(r.change);
                const bg =
                  r.change >= 0
                    ? "rgba(43,184,134,0.12)"
                    : "rgba(248,113,113,0.12)";
                const bd =
                  r.change >= 0
                    ? "rgba(43,184,134,0.25)"
                    : "rgba(248,113,113,0.25)";
                return (
                  <span
                    key={r.ticker}
                    onClick={() => onTickerClick && onTickerClick(r.ticker)}
                    style={{
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "baseline",
                      gap: 2,
                      padding: "1px 4px",
                      borderRadius: 3,
                      fontSize: 9,
                      background: bg,
                      border: `1px solid ${bd}`,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 7,
                        color: rankC,
                        fontWeight: 700,
                      }}
                    >
                      {rank}
                    </span>
                    <span
                      style={{ fontSize: 6, color: gRankC }}
                      title={`Global rank #${gRank}`}
                    >
                      #{gRank}
                    </span>
                    <span style={{ fontWeight: 600, color: chgC }}>
                      {r.ticker}
                    </span>
                    <span style={{ fontSize: 8, color: chgC }}>
                      {fmtRank(r)}
                    </span>
                  </span>
                );
              })}
              {hidden > 0 && (
                <span
                  onClick={() =>
                    setExpandedThemes((prev) => {
                      const next = new Set(prev);
                      next.add(g.name);
                      return next;
                    })
                  }
                  style={{
                    cursor: "pointer",
                    fontSize: 8,
                    padding: "1px 5px",
                    borderRadius: 3,
                    border: `1px solid ${ARIA.border}`,
                    color: ARIA.textMuted,
                  }}
                >
                  +{hidden} more
                </span>
              )}
              {isExp && sortedTk.length > 10 && (
                <span
                  onClick={() =>
                    setExpandedThemes((prev) => {
                      const next = new Set(prev);
                      next.delete(g.name);
                      return next;
                    })
                  }
                  style={{
                    cursor: "pointer",
                    fontSize: 8,
                    padding: "1px 5px",
                    borderRadius: 3,
                    border: `1px solid ${ARIA.border}`,
                    color: ARIA.textMuted,
                  }}
                >
                  collapse
                </span>
              )}
            </div>
            {/* Discover section: high-RS tickers in this subtheme not owned */}
            {g.discoveries && g.discoveries.length > 0 && (
              <div
                style={{
                  marginTop: 4,
                  paddingTop: 3,
                  borderTop: `1px solid ${ARIA.border}`,
                }}
              >
                <span
                  style={{
                    fontSize: 7,
                    fontWeight: 700,
                    color: ARIA.cyan,
                    textTransform: "uppercase",
                  }}
                >
                  Discover
                </span>{" "}
                <span
                  style={{
                    fontSize: 7,
                    color: ARIA.textMuted,
                  }}
                >
                  RS≥80 + RVol≥1.5x
                </span>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 3,
                    marginTop: 2,
                  }}
                >
                  {g.discoveries.map((d) => (
                    <span
                      key={d.ticker}
                      onClick={() =>
                        onTickerClick && onTickerClick(d.ticker)
                      }
                      title={`Add ${d.ticker} to watchlist (click chart) — RS ${d.rs}, RVol ${d.rvol}x`}
                      style={{
                        cursor: "pointer",
                        fontSize: 8,
                        padding: "1px 4px",
                        borderRadius: 3,
                        border: "1px solid rgba(34,211,238,0.2)",
                        background: "rgba(34,211,238,0.05)",
                        color: ARIA.cyan,
                      }}
                    >
                      {d.ticker} RS{d.rs}{" "}
                      {d.change != null
                        ? (d.change > 0 ? "+" : "") +
                          d.change.toFixed(1) +
                          "%"
                        : ""}
                      {d.rvol ? " " + d.rvol.toFixed(1) + "x" : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    });
  };

  return (
    <div
      style={{
        background: ARIA.bgCard,
        border: `1px solid ${ARIA.border}`,
        borderRadius: 14,
        marginBottom: 8,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* Header with view toggle */}
      <div
        style={{
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderBottom: `1px solid ${ARIA.border}`,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: ARIA.textDim,
          }}
        >
          Watchlist
        </span>
        <div style={{ display: "flex", gap: 0, marginLeft: "auto" }}>
          <button
            onClick={() => setViewPersist("list")}
            style={{
              fontSize: 8,
              padding: "2px 6px",
              borderRadius: "3px 0 0 3px",
              cursor: "pointer",
              fontFamily: "monospace",
              border: `1px solid ${view === "list" ? ARIA.green : ARIA.border}`,
              color: view === "list" ? ARIA.green : ARIA.textMuted,
              background: view === "list" ? ARIA.glowGreen : "transparent",
            }}
          >
            List
          </button>
          <button
            onClick={() => setViewPersist("themes")}
            style={{
              fontSize: 8,
              padding: "2px 6px",
              borderRadius: "0 3px 3px 0",
              cursor: "pointer",
              fontFamily: "monospace",
              border: `1px solid ${view === "themes" ? ARIA.green : ARIA.border}`,
              color: view === "themes" ? ARIA.green : ARIA.textMuted,
              background: view === "themes" ? ARIA.glowGreen : "transparent",
            }}
          >
            Themes
          </button>
        </div>
      </div>

      {/* ⚠ Earnings-risk sweep — held names reporting within 5 trading days.
          Zanger: sell a full day before ER; Ryan: never hold size through it. */}
      {(() => {
        const held = [...new Set([...portfolio, ...ondeck, ...focus])];
        const atRisk = held
          .map((t) => ({ t, d: stockMap?.[t]?.earnings_days, timing: stockMap?.[t]?.er_timing || "" }))
          .filter((x) => x.d != null && x.d >= 0 && x.d <= 5)
          .sort((a, b) => a.d - b.d);
        if (!atRisk.length) return null;
        return (
          <div style={{ padding: "4px 8px", borderBottom: `1px solid ${ARIA.border}`, background: "rgba(239,68,68,0.07)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontFamily: "monospace" }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: ARIA.red, textTransform: "uppercase", letterSpacing: 0.4 }}>⚠ Earnings risk</span>
            {atRisk.map((x) => (
              <span key={x.t} onClick={() => onTickerClick && onTickerClick(x.t)}
                title={`${x.t} reports in ${x.d === 0 ? "0 days (TODAY)" : `${x.d} day${x.d > 1 ? "s" : ""}`}${x.timing ? ` ${x.timing}` : ""} — you hold it (${portfolio.includes(x.t) ? "portfolio" : ondeck.includes(x.t) ? "on deck" : "focus"}). Zanger: sell a full day before; Ryan: never hold size through earnings.`}
                style={{ cursor: "pointer", fontSize: 8, fontWeight: 700, color: ARIA.red, border: `1px solid ${ARIA.red}66`, background: "rgba(239,68,68,0.12)", borderRadius: 3, padding: "1px 6px" }}>
                {x.t} {x.d === 0 ? "TODAY" : `${x.d}d`}{x.timing ? ` ${x.timing}` : ""}
              </span>
            ))}
            <span style={{ fontSize: 7.5, color: ARIA.textMuted }}>reduce / exit before the report</span>
          </div>
        );
      })()}

      {/* List view */}
      {view === "list" && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            fontFamily: "monospace",
          }}
        >
          <div style={{ padding: "3px 8px", borderBottom: `1px solid ${ARIA.border}`, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 8, color: ARIA.textMuted, textTransform: "uppercase" }}>Filter</span>
            <button onClick={toggleChgPos} style={pillStyle(chgPosFilter, ARIA.cyan || "#22d3ee")} title="Show only tickers with Chg% > 0">Chg&gt;0%</button>
          </div>
          <WatchlistSectionTable
            rows={chgPosFilter ? portRows.filter((r) => (r.change || 0) > 0) : portRows}
            accent={ARIA.yellow}
            list="portfolio"
            count={portfolio.length}
            onAddMany={addManyPortfolio}
            universe={universeSet}
            onTickerClick={onTickerClick}
            removeTicker={removeTicker}
            tickerStrengthMap={tickerStrengthMap}
            onChainClick={onChainClick}
          />
          <WatchlistSectionTable
            rows={chgPosFilter ? ondeckRows.filter((r) => (r.change || 0) > 0) : ondeckRows}
            accent={ARIA.gold}
            list="ondeck"
            count={ondeck.length}
            onAddMany={addManyOndeck}
            universe={universeSet}
            onTickerClick={onTickerClick}
            removeTicker={removeTicker}
            tickerStrengthMap={tickerStrengthMap}
            onChainClick={onChainClick}
          />
          <WatchlistSectionTable
            rows={chgPosFilter ? focusRows.filter((r) => (r.change || 0) > 0) : focusRows}
            accent={ARIA.cyan}
            list="focus"
            count={focus.length}
            onAddMany={addManyFocus}
            universe={universeSet}
            onTickerClick={onTickerClick}
            removeTicker={removeTicker}
            tickerStrengthMap={tickerStrengthMap}
            onChainClick={onChainClick}
            promoteTicker={promoteToDeck}
          />
          <WatchlistSectionTable
            rows={chgPosFilter ? watchRows.filter((r) => (r.change || 0) > 0) : watchRows}
            accent={ARIA.green}
            list="watchlist"
            count={watchlist.length}
            onAddMany={addManyWatchlist}
            universe={universeSet}
            onTickerClick={onTickerClick}
            removeTicker={removeTicker}
            tickerStrengthMap={tickerStrengthMap}
            onChainClick={onChainClick}
          />
        </div>
      )}

      {/* Themes view */}
      {view === "themes" && (
        <div>
          {/* Rank toggle row */}
          <div
            style={{
              padding: "4px 8px",
              borderBottom: `1px solid ${ARIA.border}`,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 8,
                color: ARIA.textMuted,
                textTransform: "uppercase",
              }}
            >
              Rank by
            </span>
            {RANK_METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setRankByPersist(m.key)}
                style={pillStyle(rankBy === m.key, ARIA.green)}
              >
                {m.label}
              </button>
            ))}
            <span style={{ width: 1, height: 12, background: ARIA.border, margin: "0 2px" }} />
            <button
              onClick={toggleChgPos}
              style={pillStyle(chgPosFilter, ARIA.cyan || "#22d3ee")}
              title="Show only tickers with Chg% > 0"
            >
              Chg&gt;0%
            </button>
          </div>
          {/* Quick add bar (themes view doesn't show List sections) */}
          <div
            style={{
              padding: "4px 8px",
              borderBottom: `1px solid ${ARIA.border}`,
              display: "flex",
              gap: 6,
              alignItems: "center",
              fontSize: 9,
              fontFamily: "monospace",
            }}
          >
            <input
              value={quickAdd}
              onChange={(e) => setQuickAdd(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const toks = [...new Set(quickAdd.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
                const known = universeSet.size ? toks.filter((t) => universeSet.has(t)) : toks;
                if (known.length) addManyWatchlist(known);
                setQuickAdd(toks.filter((t) => !known.includes(t)).join(", "));
              }}
              placeholder="+ ticker(s)"
              title="One or several (comma/space separated) — validated against the universe"
              style={{
                flex: 1,
                fontSize: 9,
                padding: "2px 6px",
                background: ARIA.bg,
                border: `1px solid ${ARIA.border}`,
                borderRadius: 3,
                color: ARIA.text,
                fontFamily: "monospace",
                outline: "none",
              }}
            />
            <button
              onClick={() => {
                const toks = [...new Set(quickAdd.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
                const known = universeSet.size ? toks.filter((t) => universeSet.has(t)) : toks;
                if (known.length) addManyWatchlist(known);
                setQuickAdd(toks.filter((t) => !known.includes(t)).join(", "));
              }}
              style={pillStyle(true, ARIA.green)}
            >
              +WL
            </button>
            <button
              onClick={() => {
                const toks = [...new Set(quickAdd.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
                const known = universeSet.size ? toks.filter((t) => universeSet.has(t)) : toks;
                if (known.length) addManyPortfolio(known);
                setQuickAdd(toks.filter((t) => !known.includes(t)).join(", "));
              }}
              style={pillStyle(true, ARIA.yellow)}
            >
              +PF
            </button>
          </div>
          <div
            style={{
              maxHeight: 320,
              overflowY: "auto",
              fontFamily: "monospace",
            }}
          >
            {renderThemes()}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// AppMain
// ──────────────────────────────────────────────────────────────────────────

// Resizable split between ChartPanelInline (left) and ScanWatch (right).
// Width of the right column is persisted and dragged via a 4px col-resize handle.
// ── Peers row inside TickerInfoBox: peer chips (col 1) + selected
//    ticker's live stats chg | openChg | RVol | ADR% | ER countdown (col 2) ────
function PeersRow({ ticker, peers, onTickerClick, ARIA, stockMap, liveEarningsDate }) {
  const tickerList = useMemo(() => ticker ? [ticker] : [], [ticker]);
  const { quotes } = useLiveQuotes(tickerList, 30000);
  const q = quotes.get(ticker) || {};
  const chg = q.change ?? null;
  const openChg = (q.open != null && q.previousClose != null && q.previousClose > 0)
    ? ((q.open - q.previousClose) / q.previousClose) * 100
    : null;
  const rvol = (q.volume && q.avgVolume && q.avgVolume > 0)
    ? Math.round((q.volume / q.avgVolume) * 10) / 10
    : null;
  const s = stockMap?.[ticker] || {};
  const adr = s.adr_pct ?? null;

  // Prefer FMP earnings date { date: "2026-05-06", time: "bmo" } over stale pipeline days
  const { erDays, erTiming } = useMemo(() => {
    if (liveEarningsDate?.date) {
      const todayUTC = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
      const erDate = new Date(`${liveEarningsDate.date}T00:00:00Z`);
      const diffDays = Math.round((erDate - todayUTC) / 86400000);
      const timing = (liveEarningsDate.time || s.er_timing || "").toUpperCase();
      return { erDays: diffDays, erTiming: timing };
    }
    return { erDays: s.earnings_days ?? null, erTiming: s.er_timing || "" };
  }, [liveEarningsDate, s.earnings_days, s.er_timing]);
  const fmtPct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const fmtRvol = (v) => v == null ? "—" : `${v.toFixed(1)}x`;
  const fmtAdr = (v) => v == null ? "—" : `${v.toFixed(1)}%`;
  const fmtEr = (d) => {
    if (d == null) return "—";
    if (d === 0) return "TODAY";
    if (d > 0) return `${d}d`;
    return `${-d}d ago`;
  };
  const colorPct = (v) => v == null ? ARIA.textMuted
                       : v >= 2 ? ARIA.green
                       : v >= 0.5 ? "#7cb342"
                       : v <= -2 ? ARIA.red
                       : v <= -0.5 ? "#c47000"
                       : ARIA.textMuted;
  const colorRvol = (v) => v == null ? ARIA.textMuted
                         : v >= 2 ? ARIA.green
                         : v >= 1.5 ? "#fbbf24"
                         : ARIA.textMuted;
  const colorAdr = (v) => v == null ? ARIA.textMuted
                        : v >= 5 ? ARIA.green
                        : v >= 3 ? "#7cb342"
                        : ARIA.textMuted;
  const colorEr = (d) => d == null ? ARIA.textMuted
                       : d === 0 ? ARIA.red
                       : d > 0 && d <= 7 ? "#fbbf24"
                       : d > 0 ? ARIA.textDim
                       : ARIA.textMuted;
  return (
    <div style={{
      borderTop: `1px solid ${ARIA.border}`,
      padding: "3px 10px",
      display: "grid",
      gridTemplateColumns: "1fr auto",
      columnGap: 12,
      alignItems: "center",
      fontSize: 7,
      fontFamily: "monospace",
    }}>
      {/* Col 1: peers */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <span style={{
          color: ARIA.textMuted, textTransform: "uppercase",
          letterSpacing: 0.5, fontWeight: 700,
        }}>
          Peers:
        </span>
        {peers.map((p) => (
          <span
            key={p}
            onClick={() => onTickerClick && onTickerClick(p)}
            title={`Load ${p}`}
            style={{
              color: ARIA.cyan,
              cursor: onTickerClick ? "pointer" : "default",
              fontWeight: 600,
            }}
          >
            {p}
          </span>
        ))}
      </div>
      {/* Col 2: selected ticker stats */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
        <span style={{ color: colorPct(chg) }} title="Today's % change">{fmtPct(chg)}</span>
        <span style={{ color: ARIA.border }}>|</span>
        <span style={{ color: colorPct(openChg) }} title="Gap: open vs prior close">{fmtPct(openChg)}</span>
        <span style={{ color: ARIA.border }}>|</span>
        <span style={{ color: colorRvol(rvol) }} title="Relative volume">{fmtRvol(rvol)}</span>
        <span style={{ color: ARIA.border }}>|</span>
        <span style={{ color: colorAdr(adr) }} title="Average Daily Range %">ADR {fmtAdr(adr)}</span>
        <span style={{ color: ARIA.border }}>|</span>
        <span style={{ color: colorEr(erDays) }} title={erDays != null ? `Next earnings ${erDays >= 0 ? "in " : ""}${fmtEr(erDays)}${erTiming ? ` (${erTiming})` : ""}` : "No earnings date"}>
          ER {fmtEr(erDays)}{erTiming ? ` ${erTiming}` : ""}
        </span>
      </div>
    </div>
  );
}

// ── Ticker Info: News + Description (Aria-faithful port) ────────────────
function TickerInfoBox({ ticker, stockMap, onTickerClick }) {
  const ARIA = useAriaTheme();
  const [open, setOpen] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fmpPeers, setFmpPeers] = useState([]);
  const [fmpLoading, setFmpLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    fetch(`/api/live?news=${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ticker]);

  useEffect(() => {
    if (!ticker) return;
    setFmpPeers([]);
    setFmpLoading(true);
    fetch(`/api/peers?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.peers) setFmpPeers(d.peers);
        setFmpLoading(false);
      })
      .catch(() => setFmpLoading(false));
  }, [ticker]);

  const s = stockMap?.[ticker] || {};
  const parts = [s.company || data?.description?.split(".")[0] || "", s.industry || "", s.sector || ""].filter(Boolean);
  const news = data?.news || [];
  // Peers: prefer FMP peer comparison API, then Finviz scrape, then industry siblings from stockMap.
  const peers = useMemo(() => {
    if (fmpPeers.length > 0) return fmpPeers;
    const fromApi = data?.peers || [];
    if (fromApi.length > 0) return fromApi;
    if (!s?.industry || !stockMap) return [];
    return Object.values(stockMap)
      .filter((x) => x?.industry === s.industry && x.ticker && x.ticker !== ticker)
      .sort((a, b) => (b.rs ?? 0) - (a.rs ?? 0))
      .slice(0, 8)
      .map((x) => x.ticker);
  }, [fmpPeers, data, s, stockMap, ticker]);

  return (
    <div
      style={{
        background: ARIA.bgCard,
        border: `1px solid ${ARIA.border}`,
        borderRadius: 6,
        overflow: "hidden",
        marginBottom: 2,
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "3px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          cursor: "pointer",
          borderBottom: open ? `1px solid ${ARIA.border}` : "none",
        }}
      >
        {/* Row 1: ticker · industry · sector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: ARIA.text }}>
            {ticker || "—"}
          </span>
          <span
            style={{
              fontSize: 7,
              color: ARIA.textMuted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              fontFamily: "monospace",
            }}
          >
            {parts.join(" · ")}
          </span>
          <span style={{ fontSize: 8, color: ARIA.textMuted }}>
            {open ? "▼" : "▶"}
          </span>
        </div>
        {/* Row 2: theme · subtheme — clickable pills that open the matching drawer */}
        {Array.isArray(s.themes) && s.themes.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, fontFamily: "monospace" }}>
            {s.themes.slice(0, 3).map((t, i) => {
              const drawerId = THEME_TO_DRAWER[t.theme];
              const c = drawerId ? DRAWER_COLORS[drawerId] : { bg: "transparent", border: ARIA.border, color: ARIA.textMuted };
              return (
                <span
                  key={`${t.theme}-${t.subtheme}-${i}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (drawerId) window.dispatchEvent(new CustomEvent("tp-open-drawer", { detail: drawerId }));
                  }}
                  title={drawerId ? `Click to open ${drawerId.toUpperCase()} value-chain drawer` : `${t.theme} — no drawer mapped`}
                  style={{
                    fontSize: 7,
                    fontWeight: 700,
                    padding: "1px 5px",
                    borderRadius: 2,
                    background: c.bg,
                    border: `1px solid ${c.border}`,
                    color: c.color,
                    cursor: drawerId ? "pointer" : "default",
                    whiteSpace: "nowrap",
                    letterSpacing: 0.3,
                  }}
                >
                  {t.theme} · {t.subtheme || "—"}
                </span>
              );
            })}
          </div>
        )}
      </div>
      {open && (
        <div style={{ display: "flex", height: 80 }}>
          {/* Left: News */}
          <div
            style={{
              flex: 1,
              padding: "4px 8px",
              overflowY: "auto",
              fontSize: 7,
              fontFamily: "monospace",
              borderRight: `1px solid ${ARIA.border}`,
            }}
          >
            {loading && (
              <span style={{ color: ARIA.textMuted, fontSize: 7 }}>Loading...</span>
            )}
            {!loading && news.length === 0 && (
              <span style={{ color: ARIA.textMuted, fontSize: 7 }}>No news</span>
            )}
            {!loading &&
              news.slice(0, 8).map((n, i) => (
                <div key={i} style={{ marginBottom: 5, lineHeight: 1.4 }}>
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: ARIA.blue || ARIA.cyan,
                      textDecoration: "none",
                      fontSize: 7,
                    }}
                  >
                    {n.headline || n.title || "—"}
                  </a>
                  <div style={{ fontSize: 6, color: ARIA.textMuted }}>
                    {n.date || n.publishedDate || ""}
                    {n.source ? ` — ${n.source}` : ""}
                  </div>
                </div>
              ))}
          </div>
          {/* Right: Peer Comparison (FMP) */}
          <div
            style={{
              flex: 1,
              padding: "4px 8px",
              overflowY: "auto",
              fontSize: 7,
              fontFamily: "monospace",
            }}
          >
            <div style={{ color: ARIA.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3, fontSize: 6 }}>
              Peer Comparison {fmpLoading ? "…" : peers.length > 0 ? `(${peers.length})` : ""}
            </div>
            {fmpLoading && peers.length === 0 && (
              <span style={{ color: ARIA.textMuted }}>Loading…</span>
            )}
            {!fmpLoading && peers.length === 0 && (
              <span style={{ color: ARIA.textMuted }}>No peers found</span>
            )}
            {peers.slice(0, 10).map((p) => {
              const ps = stockMap?.[p] || {};
              const chg = ps.chg ?? ps.chgOpen ?? null;
              const rvol = ps.rvol ?? null;
              const rs = ps.rs ?? null;
              const adr = ps.adr_pct ?? null;
              const colorChg = chg == null ? ARIA.textMuted
                : chg >= 2 ? ARIA.green
                : chg >= 0 ? "#7cb342"
                : chg >= -2 ? "#c47000"
                : ARIA.red;
              return (
                <div key={p} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, lineHeight: 1 }}>
                  <span
                    onClick={() => onTickerClick && onTickerClick(p)}
                    title={`Load ${p}`}
                    style={{ color: ARIA.cyan, cursor: "pointer", fontWeight: 700, minWidth: 36, fontSize: 7 }}
                  >
                    {p}
                  </span>
                  <span style={{ color: colorChg, minWidth: 34 }}>
                    {chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%` : "—"}
                  </span>
                  {rvol != null && (
                    <span style={{ color: rvol >= 2 ? ARIA.green : rvol >= 1.5 ? "#fbbf24" : ARIA.textMuted, minWidth: 26 }}>
                      {rvol.toFixed(1)}x
                    </span>
                  )}
                  {rs != null && (
                    <span style={{ color: ARIA.textMuted, minWidth: 22 }}>RS{rs}</span>
                  )}
                  {adr != null && (
                    <span style={{ color: ARIA.textMuted }}>ADR{adr.toFixed(1)}%</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {open && peers.length > 0 && (
        <PeersRow ticker={ticker} peers={peers} onTickerClick={onTickerClick} ARIA={ARIA} stockMap={stockMap} />
      )}
    </div>
  );
}

function ChartScanRow({
  chartTicker,
  handleTickerClick,
  stockMap,
  themeHealth,
  stocks,
  tickerStrengthMap,
  rotationBoard,
}) {
  // Right column hosts the rotation board + Scan Watch — default ~half the
  // screen. (New storage key: the old scan-width default of 400px is far too
  // narrow now that the rotation tables live here.)
  const [scanW, setScanW] = useState(() => {
    const saved = parseFloat(localStorage.getItem("themepulse-scan-width2") || "");
    return Number.isFinite(saved) && saved >= 320 && saved <= 1300 ? saved : 950;
  });
  const rowRef = React.useRef(null);
  useEffect(() => {
    localStorage.setItem("themepulse-scan-width2", String(scanW));
  }, [scanW]);
  const startDrag = useCallback((e) => {
    e.preventDefault();
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    function onMove(ev) {
      // Right column width = distance from right edge of row to mouse
      const w = rect.right - (ev.clientX || 0);
      setScanW(Math.max(320, Math.min(1300, w)));
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // Chain filter — set when a layer/theme is clicked in DrawerThemes; restricts
  // the Scan tab to only those tickers. Click again on same to toggle off.
  const [chainFilters, setChainFilters] = useState([]);
  const handleLayerClick = useCallback((name, tickers) => {
    setChainFilters((prev) => {
      const exists = prev.some((f) => f.name === name);
      return exists ? prev.filter((f) => f.name !== name) : [...prev, { name, tickers: new Set(tickers) }];
    });
  }, []);
  return (
    <div
      ref={rowRef}
      style={{
        display: "flex",
        gap: 0,
        alignItems: "stretch",
        marginBottom: 8,
      }}
    >
      {/* Left column (chart) pinned: sticks to the viewport and scrolls its own
          content internally, so the graph stays put while the right column
          (rotation + scan) scrolls independently. */}
      <div style={{ flex: 1, minWidth: 0, position: "sticky", top: 0, alignSelf: "flex-start", maxHeight: "100vh", overflowY: "auto", overscrollBehavior: "contain" }}>
        <ChartPanelInline
          ticker={chartTicker}
          onTickerChange={handleTickerClick}
          stockMap={stockMap}
          themeHealth={themeHealth}
          tickerStrengthMap={tickerStrengthMap}
        />
      </div>
      <div
        onMouseDown={startDrag}
        title="Drag to resize"
        style={{
          width: 6,
          cursor: "col-resize",
          background: "transparent",
          flexShrink: 0,
          margin: "0 1px",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#22d3ee44")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      />
      <div style={{
        width: scanW, flexShrink: 0, minWidth: 320,
        display: "flex", flexDirection: "column",
        // Pin to viewport so the rotation board + watchlist/scan stay visible
        // when the left chart panel scrolls past the fold
        position: "sticky", top: 0, alignSelf: "flex-start",
        maxHeight: "100vh", overflowY: "auto",
      }}>
        {rotationBoard}
        <ScanWatch stocks={stocks} onTickerClick={handleTickerClick} chartTicker={chartTicker} stockMap={stockMap} themeHealth={themeHealth} tickerStrengthMap={tickerStrengthMap} chainFilters={chainFilters} clearChainFilters={() => setChainFilters([])} removeChainFilter={(name) => setChainFilters((p) => p.filter((f) => f.name !== name))} onLayerClick={handleLayerClick} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SetupJournal — full-page view of logged setup-badge firings (ACC/EP/VCP/DIST)
// Data: GET /api/zvr?journal=N (Upstash-backed, deduped per ticker+badge+day).
// Shows entry conditions at fire time + live "since fire" return.
// ──────────────────────────────────────────────────────────────────────────
const JOURNAL_BADGE_COLORS = { BO: "#a855f7", ACC: "#34d399", EP: "#22d3ee", RST: "#0ea5e9", VCP: "#fbbf24", DIST: "#ef4444" };
const JOURNAL_BADGE_DESC = {
  BO: "Breakout: within 6% of 52w high, up ≥ ADR, ZVR≥130%, CR≥60, EIF≥50 — the entry",
  ACC: "Accumulation: α>0, ZVR≥150%, CR%≥70, EIF≥52",
  EP: "Episodic Pivot: ER ≤3d ago, ZVR≥200%, green",
  RST: "Reset: RS≥90 leader at the 20dma, |ZVR|≤100%, above 50sma, not breaking down",
  VCP: "Volume dry-up: |ZVR|<80%, |Chg|<2%, EIF≥60, Str≥70",
  DIST: "Distribution: ZVR≤−150%, EIF≥52",
};

// ──────────────────────────────────────────────────────────────────────────
// LeadersView — the EIF × Setup synthesis: top themes by fundamental
// leadership (avg EIF), and the tradeable shortlist of high-EIF leaders that
// are ALSO flashing a technical trigger (setup badge / ZVR building / strong
// close). This is "leading stocks in leading themes, with timing."
// ──────────────────────────────────────────────────────────────────────────
// Jensen's normal-dip band by price bracket — [minDip%, maxDip%] off recent high.
function dipBand(price) {
  if (price == null) return null;
  if (price < 10) return [25, 55];
  if (price < 20) return [18, 32];
  if (price < 40) return [13, 22];
  if (price < 80) return [9, 17];
  return [6, 14];
}

// Shared data engine for the LEADERS views. mode: "leaders" | "catchup" | "dips".
function useLeadersData(stockMap, themeFilter, mode = "leaders") {
  // Theme aggregation: avg EIF + avg 3M return + Jensen archetypes per group.
  const themes = useMemo(() => {
    const byTheme = new Map();
    DRAWER_SUBTHEMES.forEach((sub) => {
      const e = byTheme.get(sub.themeId) || { themeId: sub.themeId, theme: sub.theme, mem: [] };
      sub.tickers.forEach((t) => {
        const s = stockMap?.[t];
        if (s?.framework_score != null) e.mem.push({ t, eif: s.framework_score, ret3m: s.return_3m ?? null });
      });
      byTheme.set(sub.themeId, e);
    });
    const rows = [];
    for (const e of byTheme.values()) {
      if (!e.mem.length) continue;
      const avg = e.mem.reduce((a, b) => a + b.eif, 0) / e.mem.length;
      const rets = e.mem.filter((x) => x.ret3m != null);
      const avgRet = rets.length ? rets.reduce((a, b) => a + b.ret3m, 0) / rets.length : null;
      const leaders = e.mem.filter((x) => x.eif >= 60).length;
      const byEif = [...e.mem].sort((a, b) => b.eif - a.eif);
      const byRet = rets.length ? [...rets].sort((a, b) => b.ret3m - a.ret3m) : [];
      rows.push({
        themeId: e.themeId, theme: e.theme, avgEif: avg, avgRet3m: avgRet, n: e.mem.length, leaders,
        top: byEif.slice(0, 3),
        qualityLeader: byEif[0]?.t,          // highest EIF
        rsLeader: byRet[0]?.t,               // best 3M return
      });
    }
    return rows.sort((a, b) => b.avgEif - a.avgEif);
  }, [stockMap]);
  const groupAvgRet = useMemo(() => Object.fromEntries(themes.map((t) => [t.themeId, t.avgRet3m])), [themes]);
  const groupAvgEif = useMemo(() => Object.fromEntries(themes.map((t) => [t.themeId, t.avgEif])), [themes]);

  // Candidate leaders: EIF ≥ 55, in a theme. Poll live ZVR + quotes on these.
  const candidates = useMemo(() => {
    const out = [];
    for (const [t, s] of Object.entries(stockMap || {})) {
      const eif = s?.framework_score;
      if (eif == null || eif < 55) continue;
      const chains = chainsForStock(t, s);
      if (!chains?.length) continue;
      const themeId = chains[0].themeId;
      const theme = DRAWER_SUBTHEMES.find((d) => d.themeId === themeId)?.theme ?? themeId;
      out.push({ ticker: t, eif, themeId, theme, layer: chains[0].layer,
                 ret3m: s.return_3m ?? null, offHigh: s.off_52w_high ?? null, price: s.price ?? s.close ?? null });
    }
    return out;
  }, [stockMap]);
  const candTickers = useMemo(() => candidates.map((c) => c.ticker).concat("SPY"), [candidates]);
  const { cur: zvrMap } = useZVR(candTickers);
  const { quotes: liveQuotes } = useLiveQuotes(candTickers, 30000);

  // Tradeable rows — content depends on mode (leaders / catch-up / dips).
  const rows = useMemo(() => {
    const spyChg = liveQuotes.get("SPY")?.change ?? 0;
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const mins = now.getHours() * 60 + now.getMinutes();
    const isRTH = mins >= 570 && mins < 960;
    const elapsed = isRTH ? Math.max(0.02, (mins - 570) / 390) : 1.0;
    const out = [];
    for (const c of candidates) {
      if (themeFilter && c.themeId !== themeFilter) continue;
      const q = liveQuotes.get(c.ticker);
      const s = stockMap[c.ticker];
      const chg = q?.change ?? s?.change_pct ?? null;
      const hi = q?.dayHigh, lo = q?.dayLow, px = q?.price ?? c.price;
      const cr = (px && hi && lo && hi > lo) ? Math.round((px - lo) / (hi - lo) * 100) : null;
      let zvr = zvrMap.get(c.ticker) ?? null;
      if (zvr == null) {
        const lv = q?.volume, av = s?.avg_volume_raw || q?.avgVolume || 0;
        if (lv && av > 0) zvr = Math.round((lv / (av * elapsed)) * 100);
        else if (s?.rel_volume > 0) zvr = Math.round(s.rel_volume * 100);
      }
      if (zvr != null && chg != null && chg < 0) zvr = -zvr;
      const row = { ...c, rs: c.eif, chg, cr, zvr, alpha: chg != null ? Math.round((chg - spyChg) * 10) / 10 : null,
                    str: null, erDays: s?.earnings_days ?? null };
      const setup = chainSetup(row);
      const thrust = (zvr != null && zvr >= 130) || (cr != null && cr >= 60 && chg != null && chg > 0);

      if (mode === "catchup") {
        // Laggard in a leading group, now showing first thrust (Jensen catch-up).
        const inLeadingGroup = (groupAvgEif[c.themeId] ?? 0) >= 55;
        const gRet = groupAvgRet[c.themeId];
        const lagged = c.ret3m != null && gRet != null && c.ret3m < gRet - 10;
        if (!inLeadingGroup || !lagged || !thrust) continue;
        const lagGap = (gRet ?? 0) - (c.ret3m ?? 0);
        const score = lagGap * 0.4 + Math.min(Math.max(zvr ?? 0, 0), 300) / 3 * 0.4 + c.eif * 0.2;
        out.push({ ...row, setup, score, lagGap: Math.round(lagGap), groupRet: Math.round(gRet) });
      } else if (mode === "dips") {
        // Leader pulled back into its normal dip band, holding (buyable pullback).
        const band = dipBand(c.price);
        const off = c.offHigh != null ? Math.abs(c.offHigh) : null;
        if (!band || off == null) continue;
        const inBand = off >= band[0] && off <= band[1] * 1.15;
        const holding = chg == null || chg > -4;
        if (!inBand || !holding) continue;
        const caution = off > band[1]; // exceeded normal band
        const score = c.eif * 0.6 + (caution ? 0 : 15) + Math.min(Math.max(zvr ?? 0, 0), 200) / 200 * 10;
        out.push({ ...row, setup, score, offHighPct: Math.round(c.offHigh), caution, band });
      } else {
        // Default leaders: high-EIF with a breakout/volume trigger.
        const triggered = setup?.key === "ACC" || setup?.key === "EP" ||
                          (zvr != null && zvr >= 130) || (cr != null && cr >= 70 && chg != null && chg > 0);
        if (!triggered) continue;
        const score = c.eif * 0.5 + Math.min(Math.max(zvr ?? 0, 0), 300) / 3 * 0.3 + (cr ?? 0) * 0.2
                      + (setup?.key === "EP" ? 12 : setup?.key === "ACC" ? 10 : 0);
        out.push({ ...row, setup, score });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 40);
  }, [candidates, zvrMap, liveQuotes, stockMap, themeFilter, mode, groupAvgRet, groupAvgEif]);

  return { themes, rows };
}

const eifTierColor = (ARIA, v) => v == null ? ARIA.textMuted : v >= 65 ? "#fbbf24" : v >= 55 ? ARIA.green : v >= 45 ? ARIA.blue : ARIA.textDim;

function LeadersView({ stockMap, onTickerClick }) {
  const ARIA = useAriaTheme();
  const eifReasons = useEifReasons();
  const [themeFilter, setThemeFilter] = useState(null);
  const { themes, rows } = useLeadersData(stockMap, themeFilter);

  const eifColor = (v) => eifTierColor(ARIA, v);
  const chgColor = (v) => v == null || Math.abs(v) <= 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;
  const cell = { padding: "3px 8px", fontSize: 10, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, fontFamily: "monospace", whiteSpace: "nowrap" };
  const th = { padding: "4px 8px", fontSize: 8, fontWeight: 700, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, fontFamily: "monospace" };

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {/* Left: Top Themes by EIF (#3) */}
      <div style={{ width: 320, flexShrink: 0, background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "8px 12px", borderBottom: `1px solid ${ARIA.border}`, fontSize: 12, fontWeight: 800, fontFamily: "monospace", letterSpacing: 0.5, color: ARIA.text }}>
          🎯 TOP THEMES BY EIF
          {themeFilter && <button onClick={() => setThemeFilter(null)} style={{ marginLeft: 8, fontSize: 8, color: ARIA.textMuted, background: "transparent", border: `1px solid ${ARIA.border}`, borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>✕ clear</button>}
        </div>
        <div style={{ maxHeight: "calc(100vh - 180px)", overflow: "auto" }}>
          {themes.map((tm) => {
            const c = DRAWER_COLORS[tm.themeId] || { color: ARIA.textDim };
            const active = themeFilter === tm.themeId;
            return (
              <div key={tm.themeId} onClick={() => setThemeFilter(active ? null : tm.themeId)}
                style={{ padding: "5px 10px", borderBottom: `1px solid ${ARIA.border}`, cursor: "pointer", background: active ? `${c.color}1f` : "transparent" }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = ARIA.bgHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = active ? `${c.color}1f` : "transparent"; }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: eifColor(tm.avgEif), width: 26, textAlign: "right" }}>{Math.round(tm.avgEif)}</span>
                  <span style={{ fontSize: 7, fontWeight: 700, color: c.color, flexShrink: 0 }}>{(CHAIN_ABBR[tm.themeId] || tm.themeId).toUpperCase()}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: ARIA.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tm.theme}</span>
                  <span style={{ fontSize: 7, color: ARIA.textMuted }}>{tm.leaders}/{tm.n} lead</span>
                </div>
                <div style={{ fontSize: 7.5, color: ARIA.textDim, marginLeft: 32, marginTop: 1 }}>
                  {tm.top.map((x) => `${x.t} ${x.eif}`).join(" · ")}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Tradeable Leaders (#1) */}
      <div style={{ flex: 1, background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "8px 12px", borderBottom: `1px solid ${ARIA.border}`, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", letterSpacing: 0.5, color: ARIA.text }}>⚡ TRADEABLE LEADERS</span>
          <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace" }}>EIF ≥ 55 · in a theme · with a live trigger (setup / ZVR≥130 / strong close)</span>
          <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", marginLeft: "auto" }}>{rows.length} candidates</span>
        </div>
        <div style={{ maxHeight: "calc(100vh - 180px)", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>Ticker</th>
              <th style={{ ...th, textAlign: "left" }}>Theme · Layer</th>
              <th style={th}>EIF</th>
              <th style={{ ...th, textAlign: "center" }}>Setup</th>
              <th style={th}>ZVR</th>
              <th style={th}>CR%</th>
              <th style={th}>Chg%</th>
              <th style={{ ...th, textAlign: "left" }}>Why (top driver)</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", fontSize: 11, fontFamily: "monospace", color: ARIA.textMuted }}>
                  No leaders with a live trigger right now{themeFilter ? " in this theme" : ""}. Triggers populate during market hours.
                </td></tr>
              )}
              {rows.map((r) => {
                const c = DRAWER_COLORS[r.themeId] || { color: ARIA.textDim };
                const su = r.setup;
                const driver = eifReasons[r.ticker]?.drivers?.[0]?.text;
                return (
                  <tr key={r.ticker} onClick={() => onTickerClick && onTickerClick(r.ticker)} style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = ARIA.bgHover; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <td style={{ ...cell, textAlign: "left", fontWeight: 800, color: ARIA.text }}>
                      <img src={ER_LOGO(r.ticker)} alt="" style={{ width: 12, height: 12, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} onError={(e) => { e.target.style.display = "none"; }} />
                      {r.ticker}
                    </td>
                    <td style={{ ...cell, textAlign: "left", fontSize: 8 }}>
                      <span style={{ color: c.color, fontWeight: 700 }}>{(CHAIN_ABBR[r.themeId] || r.themeId).toUpperCase()}</span>
                      <span style={{ color: ARIA.textDim, marginLeft: 4 }}>{r.layer}</span>
                    </td>
                    <td style={{ ...cell, color: eifColor(r.eif), fontWeight: 800 }}>{r.eif}</td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      {su ? <span style={{ fontSize: 8, fontWeight: 800, color: su.color, background: `${su.color}1f`, border: `1px solid ${su.color}55`, borderRadius: 2, padding: "0 4px" }}>{su.key}</span> : <span style={{ color: ARIA.textMuted, fontSize: 8 }}>—</span>}
                    </td>
                    <td style={{ ...cell, color: r.zvr == null ? ARIA.textMuted : r.zvr >= 200 ? "#fbbf24" : r.zvr >= 130 ? ARIA.green : ARIA.textDim, fontWeight: 700 }}>{r.zvr != null ? r.zvr + "%" : "—"}</td>
                    <td style={{ ...cell, color: r.cr != null && r.cr >= 70 ? ARIA.green : ARIA.textDim }}>{r.cr != null ? r.cr + "%" : "—"}</td>
                    <td style={{ ...cell, color: chgColor(r.chg), fontWeight: r.chg != null && Math.abs(r.chg) > 2 ? 700 : 400 }}>{r.chg != null ? (r.chg > 0 ? "+" : "") + r.chg.toFixed(1) + "%" : "—"}</td>
                    <td style={{ ...cell, textAlign: "left", fontSize: 8, color: ARIA.textDim, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>{driver || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Compact LEADERS panel for the Scan Watch box — theme chips + tradeable
// shortlist, single column, clicking loads the chart on the left.
const LEADER_MODES = [
  ["leaders", "Leaders", "Strong stocks breaking out — momentum continuation"],
  ["catchup", "Catch-Up", "Laggards in a leading group starting to thrust (Jensen rotation)"],
  ["dips", "Dips", "Leaders pulled back into a normal dip band — buyable pullback"],
];

function LeadersPanel({ stockMap, onTickerClick }) {
  const ARIA = useAriaTheme();
  const eifReasons = useEifReasons();
  const [themeFilter, setThemeFilter] = useState(null);
  const [mode, setMode] = useState(() => { try { return localStorage.getItem("tp-leaders-mode") || "leaders"; } catch { return "leaders"; } });
  const { themes, rows } = useLeadersData(stockMap, themeFilter, mode);
  const activeTheme = themeFilter ? themes.find((t) => t.themeId === themeFilter) : null;
  // null sortKey = default actionability ranking (score, already applied by the hook)
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const clickSort = (k) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "ticker" ? "asc" : "desc"); }
  };
  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const sv = (r) => sortKey === "setup" ? (chainSetup(r)?.rank ?? 0) : sortKey === "ticker" ? r.ticker : r[sortKey];
    return [...rows].sort((a, b) => {
      let av = sv(a), bv = sv(b);
      if (sortKey === "ticker") return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      av = av == null ? -Infinity : av; bv = bv == null ? -Infinity : bv;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [rows, sortKey, sortDir]);
  const eifColor = (v) => eifTierColor(ARIA, v);
  const chgColor = (v) => v == null || Math.abs(v) <= 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;
  const cell = { padding: "2px 5px", fontSize: 9, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, fontFamily: "monospace", whiteSpace: "nowrap" };
  // 3rd column changes by mode: Leaders→Setup badge, Catch-Up→Lag vs group, Dips→% off high
  const col3 = mode === "catchup" ? ["Lag", "lagGap"] : mode === "dips" ? ["OffHi", "offHighPct"] : ["Setup", "setup"];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Mode toggle — three Jensen entry styles */}
      <div style={{ display: "flex", gap: 3, padding: "3px 4px", borderBottom: `1px solid ${ARIA.border}`, flexShrink: 0 }}>
        {LEADER_MODES.map(([m, label, desc]) => (
          <button key={m} onClick={() => { setMode(m); try { localStorage.setItem("tp-leaders-mode", m); } catch {} }}
            title={desc}
            style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.3, padding: "1px 7px", borderRadius: 3, cursor: "pointer",
              color: mode === m ? "#fbbf24" : ARIA.textDim, background: mode === m ? "rgba(251,191,36,0.12)" : "transparent",
              border: `1px solid ${mode === m ? "rgba(251,191,36,0.45)" : ARIA.border}` }}>{label}</button>
        ))}
      </div>
      {/* Archetype picks for the selected theme (Jensen's per-group decision) */}
      {activeTheme && (
        <div style={{ display: "flex", gap: 8, padding: "3px 6px", borderBottom: `1px solid ${ARIA.border}`, fontSize: 7, fontFamily: "monospace", flexWrap: "wrap" }}>
          {activeTheme.qualityLeader && <span style={{ color: ARIA.textDim }}>Quality: <button onClick={() => onTickerClick?.(activeTheme.qualityLeader)} style={{ color: "#fbbf24", fontWeight: 800, background: "none", border: "none", cursor: "pointer", padding: 0 }}>{activeTheme.qualityLeader}</button></span>}
          {activeTheme.rsLeader && <span style={{ color: ARIA.textDim }}>RS Leader: <button onClick={() => onTickerClick?.(activeTheme.rsLeader)} style={{ color: ARIA.green, fontWeight: 800, background: "none", border: "none", cursor: "pointer", padding: 0 }}>{activeTheme.rsLeader}</button></span>}
          <span style={{ color: ARIA.textMuted, marginLeft: "auto" }}>grp ret {activeTheme.avgRet3m != null ? Math.round(activeTheme.avgRet3m) + "%" : "—"}</span>
        </div>
      )}
      {/* Theme chips — top themes by EIF, click to filter */}
      <div style={{ display: "flex", gap: 3, padding: "3px 4px", overflowX: "auto", borderBottom: `1px solid ${ARIA.border}`, flexShrink: 0 }}>
        {themes.slice(0, 10).map((tm) => {
          const c = DRAWER_COLORS[tm.themeId] || { color: ARIA.textDim };
          const active = themeFilter === tm.themeId;
          return (
            <button key={tm.themeId} onClick={() => setThemeFilter(active ? null : tm.themeId)}
              title={`${tm.theme} — avg EIF ${Math.round(tm.avgEif)}, ${tm.leaders}/${tm.n} leaders`}
              style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 3, padding: "1px 5px", borderRadius: 3, cursor: "pointer",
                background: active ? `${c.color}26` : "rgba(255,255,255,0.04)", border: `1px solid ${active ? c.color : ARIA.border}` }}>
              <span style={{ fontSize: 7, fontWeight: 800, color: c.color }}>{(CHAIN_ABBR[tm.themeId] || tm.themeId).toUpperCase()}</span>
              <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", color: eifColor(tm.avgEif) }}>{Math.round(tm.avgEif)}</span>
            </button>
          );
        })}
      </div>
      {/* Tradeable leaders list */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
          <thead style={{ position: "sticky", top: 0, background: ARIA.bgCard, zIndex: 1 }}><tr>
            {[["Ticker", "ticker"], ["EIF", "eif"], col3, ["ZVR", "zvr"], ["CR", "cr"], ["Chg", "chg"], ["Why", null]].map(([h, k], i) => (
              <th key={h} onClick={() => k && clickSort(k)} title={k ? "Click to sort" : "Top EIF driver"}
                style={{ padding: "3px 5px", fontSize: 7, fontWeight: 700, color: sortKey === k ? ARIA.green : ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.3, textAlign: i === 0 || i === 6 ? "left" : i === 2 ? "center" : "right", borderBottom: `1px solid ${ARIA.border}`, cursor: k ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>
                {h}{sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", fontSize: 9, fontFamily: "monospace", color: ARIA.textMuted }}>
                {mode === "catchup" ? "No catch-up candidates (laggard in a leading group, now thrusting)" : mode === "dips" ? "No leaders in a buyable dip right now" : "No leaders with a live trigger"}{themeFilter ? " in this theme" : ""}. {mode === "dips" ? "Dips use off-52w-high — visible anytime." : "Populates during market hours."}
              </td></tr>
            )}
            {sortedRows.map((r) => {
              const c = DRAWER_COLORS[r.themeId] || { color: ARIA.textDim };
              const su = r.setup;
              return (
                <tr key={r.ticker} onClick={() => onTickerClick && onTickerClick(r.ticker)} style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = ARIA.bgHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  title={`${r.ticker} · ${r.theme} → ${r.layer}`}>
                  <td style={{ ...cell, textAlign: "left", fontWeight: 800, color: ARIA.text }}>
                    <span style={{ fontSize: 6, fontWeight: 800, color: c.color, marginRight: 3 }}>{(CHAIN_ABBR[r.themeId] || r.themeId).toUpperCase()}</span>
                    {r.ticker}
                  </td>
                  <td style={{ ...cell, color: eifColor(r.eif), fontWeight: 800 }}>{r.eif}</td>
                  {mode === "catchup" ? (
                    <td style={{ ...cell, color: ARIA.red, fontWeight: 700 }} title={`Lagging group by ${r.lagGap}pts (group 3M ${r.groupRet}%)`}>−{r.lagGap}</td>
                  ) : mode === "dips" ? (
                    <td style={{ ...cell, color: r.caution ? "#fbbf24" : ARIA.blue, fontWeight: 700 }} title={r.caution ? `Off high ${r.offHighPct}% — exceeds normal band ${r.band[0]}-${r.band[1]}%, caution` : `Off high ${r.offHighPct}% — within normal dip band ${r.band[0]}-${r.band[1]}%`}>{r.offHighPct}%</td>
                  ) : (
                    <td style={{ ...cell, textAlign: "center" }}>
                      {su ? <span style={{ fontSize: 7, fontWeight: 800, color: su.color, background: `${su.color}1f`, border: `1px solid ${su.color}55`, borderRadius: 2, padding: "0 3px" }}>{su.key}</span> : <span style={{ color: ARIA.textMuted, fontSize: 8 }}>—</span>}
                    </td>
                  )}
                  <td style={{ ...cell, color: r.zvr == null ? ARIA.textMuted : r.zvr >= 200 ? "#fbbf24" : r.zvr >= 130 ? ARIA.green : ARIA.textDim, fontWeight: 700 }}>{r.zvr != null ? r.zvr + "%" : "—"}</td>
                  <td style={{ ...cell, color: r.cr != null && r.cr >= 70 ? ARIA.green : ARIA.textDim }}>{r.cr != null ? r.cr : "—"}</td>
                  <td style={{ ...cell, color: chgColor(r.chg), fontWeight: r.chg != null && Math.abs(r.chg) > 2 ? 700 : 400 }}>{r.chg != null ? (r.chg > 0 ? "+" : "") + r.chg.toFixed(1) : "—"}</td>
                  <td style={{ ...cell, textAlign: "left", fontSize: 7.5, color: ARIA.textDim, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}
                      title={eifReasons[r.ticker]?.drivers?.[0]?.text || ""}>
                    {eifReasons[r.ticker]?.drivers?.[0]?.text || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SetupJournal({ stockMap, onTickerClick }) {
  const ARIA = useAriaTheme();
  const [days, setDays] = useState(() => { try { return parseInt(localStorage.getItem("tp-journal-days")) || 7; } catch { return 7; } });
  const [badgeFilter, setBadgeFilter] = useState("ALL");
  const [journal, setJournal] = useState(null); // { "YYYY-MM-DD": [events] }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/zvr?journal=${days}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setJournal(d.days || {}); else setError(d.error || "load failed"); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);
  useEffect(load, [load]);

  const eventTickers = useMemo(
    () => [...new Set(Object.values(journal || {}).flat().map((e) => e.ticker))],
    [journal]
  );
  const { quotes: liveQuotes } = useLiveQuotes(eventTickers, 30000);

  const nowPrice = (tk) => liveQuotes.get(tk)?.price ?? stockMap?.[tk]?.price ?? stockMap?.[tk]?.close ?? null;
  const sincePct = (ev) => {
    const now = nowPrice(ev.ticker);
    return (now != null && ev.price > 0) ? ((now - ev.price) / ev.price) * 100 : null;
  };

  const dayEntries = useMemo(() => {
    const entries = Object.entries(journal || {}).sort((a, b) => b[0].localeCompare(a[0]));
    if (badgeFilter === "ALL") return entries;
    return entries
      .map(([d, evs]) => [d, evs.filter((e) => e.badge === badgeFilter)])
      .filter(([, evs]) => evs.length > 0);
  }, [journal, badgeFilter]);

  // Per-badge summary: count + avg since-fire return
  const summary = useMemo(() => {
    const acc = {};
    for (const evs of Object.values(journal || {})) {
      for (const ev of evs) {
        const s = sincePct(ev);
        const b = acc[ev.badge] || { n: 0, sum: 0, withRet: 0 };
        b.n++;
        if (s != null) { b.sum += s; b.withRet++; }
        acc[ev.badge] = b;
      }
    }
    return acc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journal, liveQuotes]);

  const etTime = (ts) => {
    try { return new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }); }
    catch { return "—"; }
  };
  const fmtDay = (d) => {
    try { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
    catch { return d; }
  };
  const chgColor = (v) => v == null || Math.abs(v) <= 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;
  const cell = { padding: "3px 8px", fontSize: 10, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, fontFamily: "monospace", whiteSpace: "nowrap" };
  const th = { padding: "4px 8px", fontSize: 8, fontWeight: 700, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, fontFamily: "monospace", whiteSpace: "nowrap" };

  const totalEvents = Object.values(journal || {}).flat().length;

  return (
    <div style={{ background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 8, overflow: "hidden" }}>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${ARIA.border}`, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: ARIA.text, fontFamily: "monospace", letterSpacing: 0.5 }}>⚡ SETUP JOURNAL</span>
        <span style={{ fontSize: 9, color: ARIA.textMuted, fontFamily: "monospace" }}>
          {totalEvents} firings · {dayEntries.length} day{dayEntries.length === 1 ? "" : "s"}
        </span>
        <span style={{ flex: 1 }} />
        {["ALL", "ACC", "EP", "VCP", "DIST"].map((b) => (
          <button key={b} onClick={() => setBadgeFilter(b)}
            title={JOURNAL_BADGE_DESC[b] || "Show all badge types"}
            style={{
              fontSize: 9, fontFamily: "monospace", fontWeight: 700, padding: "2px 8px", borderRadius: 3, cursor: "pointer", letterSpacing: 0.3,
              color: badgeFilter === b ? (JOURNAL_BADGE_COLORS[b] || ARIA.text) : ARIA.textDim,
              background: badgeFilter === b ? `${JOURNAL_BADGE_COLORS[b] || "#888888"}1f` : "transparent",
              border: `1px solid ${badgeFilter === b ? (JOURNAL_BADGE_COLORS[b] || ARIA.border) : ARIA.border}`,
            }}>{b}</button>
        ))}
        <span style={{ color: ARIA.border }}>|</span>
        {[7, 30, 90].map((d) => (
          <button key={d} onClick={() => { setDays(d); try { localStorage.setItem("tp-journal-days", String(d)); } catch {} }}
            style={{
              fontSize: 9, fontFamily: "monospace", fontWeight: 700, padding: "2px 8px", borderRadius: 3, cursor: "pointer",
              color: days === d ? ARIA.green : ARIA.textDim, background: days === d ? "rgba(13,145,99,0.12)" : "transparent",
              border: `1px solid ${days === d ? ARIA.green : ARIA.border}`,
            }}>{d}d</button>
        ))}
        <button onClick={load} title="Refresh"
          style={{ fontSize: 9, fontFamily: "monospace", padding: "2px 8px", borderRadius: 3, cursor: "pointer", color: ARIA.textDim, background: "transparent", border: `1px solid ${ARIA.border}` }}>
          {loading ? "…" : "↻"}
        </button>
      </div>

      {/* Per-badge summary strip */}
      {Object.keys(summary).length > 0 && (
        <div style={{ display: "flex", gap: 16, padding: "6px 12px", borderBottom: `1px solid ${ARIA.border}`, flexWrap: "wrap" }}>
          {["ACC", "EP", "VCP", "DIST"].filter((b) => summary[b]).map((b) => {
            const s = summary[b];
            const avg = s.withRet > 0 ? s.sum / s.withRet : null;
            return (
              <span key={b} style={{ fontSize: 9, fontFamily: "monospace", color: ARIA.textDim }}>
                <span style={{ color: JOURNAL_BADGE_COLORS[b], fontWeight: 800 }}>{b}</span>
                {" "}{s.n} fired
                {avg != null && (
                  <span> · avg since <span style={{ color: chgColor(avg), fontWeight: 700 }}>{avg > 0 ? "+" : ""}{avg.toFixed(1)}%</span></span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Body */}
      <div style={{ maxHeight: "calc(100vh - 220px)", overflow: "auto" }}>
        {error && <div style={{ padding: 16, fontSize: 10, fontFamily: "monospace", color: ARIA.red }}>Error: {error}</div>}
        {!error && !loading && dayEntries.length === 0 && (
          <div style={{ padding: 24, fontSize: 11, fontFamily: "monospace", color: ARIA.textMuted, textAlign: "center" }}>
            No setup firings logged yet. Badges are journaled automatically while the
            Scan Watch → Chain → Tickers view is open during market hours.
          </div>
        )}
        {dayEntries.map(([day, events]) => (
          <div key={day}>
            <div style={{ padding: "5px 12px", fontSize: 9, fontWeight: 800, fontFamily: "monospace", color: ARIA.textDim, letterSpacing: 0.6, background: "rgba(255,255,255,0.03)", borderBottom: `1px solid ${ARIA.border}` }}>
              {fmtDay(day)} <span style={{ color: ARIA.textMuted, fontWeight: 400 }}>· {events.length} firing{events.length === 1 ? "" : "s"}</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Time ET</th>
                  <th style={{ ...th, textAlign: "left" }}>Ticker</th>
                  <th style={{ ...th, textAlign: "left" }}>Setup</th>
                  <th style={th}>ZVR</th>
                  <th style={th}>EIF</th>
                  <th style={th}>CR%</th>
                  <th style={th}>Chg% @fire</th>
                  <th style={th}>Price @fire</th>
                  <th style={th}>Now</th>
                  <th style={th}>Since</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => {
                  const since = sincePct(ev);
                  const now = nowPrice(ev.ticker);
                  const bc = JOURNAL_BADGE_COLORS[ev.badge] || ARIA.textDim;
                  return (
                    <tr key={`${ev.ticker}-${ev.badge}-${i}`}
                        onClick={() => onTickerClick && onTickerClick(ev.ticker)}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = ARIA.bgHover; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                      <td style={{ ...cell, textAlign: "left", color: ARIA.textMuted }}>{etTime(ev.ts)}</td>
                      <td style={{ ...cell, textAlign: "left", fontWeight: 800, color: ARIA.text }}>
                        <img src={ER_LOGO(ev.ticker)} alt="" style={{ width: 12, height: 12, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} onError={(e) => { e.target.style.display = "none"; }} />
                        {ev.ticker}
                      </td>
                      <td style={{ ...cell, textAlign: "left" }}>
                        <span title={JOURNAL_BADGE_DESC[ev.badge]} style={{ fontSize: 8, fontWeight: 800, color: bc, background: `${bc}1f`, border: `1px solid ${bc}55`, borderRadius: 2, padding: "1px 5px", letterSpacing: 0.3 }}>{ev.badge}</span>
                      </td>
                      <td style={{ ...cell, color: ev.zvr != null && ev.zvr < 0 ? ARIA.red : ev.zvr >= 200 ? "#fbbf24" : ev.zvr >= 150 ? ARIA.green : ARIA.textDim, fontWeight: 700 }}>
                        {ev.zvr != null ? `${ev.zvr}%` : "—"}
                      </td>
                      <td style={{ ...cell, color: ev.eif != null && ev.eif >= 60 ? ARIA.green : ev.eif != null && ev.eif >= 46 ? ARIA.blue : ARIA.textDim }}>
                        {ev.eif != null ? Math.round(ev.eif) : "—"}
                      </td>
                      <td style={{ ...cell, color: ev.cr != null && ev.cr >= 70 ? ARIA.green : ARIA.textDim }}>
                        {ev.cr != null ? `${Math.round(ev.cr)}%` : "—"}
                      </td>
                      <td style={{ ...cell, color: chgColor(ev.chg), fontWeight: 700 }}>
                        {ev.chg != null ? `${ev.chg > 0 ? "+" : ""}${ev.chg.toFixed(1)}%` : "—"}
                      </td>
                      <td style={{ ...cell, color: ARIA.textDim }}>{ev.price != null ? `$${Number(ev.price).toFixed(2)}` : "—"}</td>
                      <td style={{ ...cell, color: ARIA.textDim }}>{now != null ? `$${Number(now).toFixed(2)}` : "—"}</td>
                      <td style={{ ...cell, color: chgColor(since), fontWeight: 700 }}>
                        {since != null ? `${since > 0 ? "+" : ""}${since.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Trade alerts: polls live quotes for portfolio ∪ focus during RTH and fires
// when (a) a name crosses its DE trigger, (b) a focus/held name fires BO
// conditions, (c) a PORTFOLIO name shows heavy distribution. Deduped per
// ticker+type per day; optional desktop notifications. Signal-free.
function useTradeAlerts(stockMap) {
  const [portfolio] = useLocalStorageList("themepulse-portfolio");
  const [focus] = useLocalStorageList("themepulse-focus");
  const [alerts, setAlerts] = useState([]);
  const seenKey = () => `tp-alerts-seen-${new Date().toISOString().slice(0, 10)}`;
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const mins = et.getHours() * 60 + et.getMinutes();
      if (mins < 570 || mins >= 960) return; // RTH only
      const names = [...new Set([...portfolio, ...focus])].filter((t) => stockMap?.[t]);
      if (!names.length) return;
      try {
        const r = await fetch(`/api/live?universe=${encodeURIComponent(names.join(","))}`);
        if (!r.ok) return;
        const d = await r.json();
        const qs = d.theme_universe || d.universe || [];
        const frac = Math.max(0.02, sessionVolFraction(mins - 570));
        let seen; try { seen = new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]")); } catch { seen = new Set(); }
        const fresh = [];
        const push = (t, type, msg) => {
          const k = `${t}|${type}`;
          if (seen.has(k)) return;
          seen.add(k); fresh.push({ t, type, msg, time: et.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) });
        };
        qs.forEach((q) => {
          const t = q?.ticker; if (!t) return;
          const st = stockMap[t] || {};
          const price = q.price, chg = q.change, vol = q.volume, avg = st.avg_volume_raw || q.avgVolume || 0;
          let zvr = null;
          if (vol && avg > 0) { zvr = Math.round((vol / (avg * frac)) * 100); if (chg != null && chg < 0) zvr = -zvr; }
          const cr = computeCR(q, st);
          // (a) DE trigger break
          if (st.de_ready && st.de_trigger && price != null && price >= st.de_trigger)
            push(t, "DE", `crossed its DE trigger ${st.de_trigger} — delayed-entry breakout`);
          // (b) BO firing (focus or portfolio)
          if ((st.off_52w_high ?? -100) >= -6 && chg != null && chg > 0 && chg >= (st.adr_pct || 4) &&
              zvr != null && zvr >= 130 && cr != null && cr >= 60)
            push(t, "BO", `breakout conditions firing (+${chg.toFixed(1)}%, ZVR ${zvr}%)`);
          // (c) DIST on a portfolio holding
          if (portfolio.includes(t) && zvr != null && zvr <= -180)
            push(t, "DIST", `heavy distribution (ZVR ${zvr}%) — holdings guard`);
        });
        if (fresh.length && !stop) {
          try { localStorage.setItem(seenKey(), JSON.stringify([...seen])); } catch { /* noop */ }
          setAlerts((prev) => [...fresh, ...prev].slice(0, 30));
          if (typeof window.Notification !== "undefined" && window.Notification.permission === "granted" &&
              localStorage.getItem("tp-alerts-desktop") === "1") {
            fresh.forEach((a) => { try { new window.Notification(`${a.t} — ${a.type}`, { body: a.msg }); } catch { /* noop */ } });
          }
        }
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio.join(","), focus.join(","), stockMap]);
  return alerts;
}

function AlertsBell({ alerts, onTicker, ARIA }) {
  const [open, setOpen] = useState(false);
  const [desk, setDesk] = useState(() => localStorage.getItem("tp-alerts-desktop") === "1");
  const toggleDesk = async () => {
    if (!desk && typeof window.Notification !== "undefined" && window.Notification.permission !== "granted") {
      const perm = await window.Notification.requestPermission();
      if (perm !== "granted") return;
    }
    const n = !desk; setDesk(n);
    try { localStorage.setItem("tp-alerts-desktop", n ? "1" : "0"); } catch { /* noop */ }
  };
  const C = { DE: "#fb923c", BO: "#a855f7", DIST: "#ef4444" };
  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 60, fontFamily: "monospace" }}>
      {open && (
        <div style={{ position: "absolute", bottom: 40, right: 0, width: 280, maxHeight: 320, overflowY: "auto", background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", padding: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: ARIA.text, textTransform: "uppercase", letterSpacing: 0.5 }}>Trade alerts</span>
            <button onClick={toggleDesk} title="Fire desktop notifications when new alerts arrive" style={{ fontSize: 7, padding: "1px 6px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", border: `1px solid ${desk ? ARIA.green : ARIA.border}`, color: desk ? ARIA.green : ARIA.textMuted, background: "transparent" }}>
              {desk ? "✓ desktop" : "desktop off"}
            </button>
          </div>
          {alerts.length === 0 && <div style={{ fontSize: 8.5, color: ARIA.textMuted, padding: "6px 0" }}>No alerts today. Watches portfolio + focus during market hours: DE trigger breaks, BO firing, distribution on holdings.</div>}
          {alerts.map((a, i) => (
            <div key={i} onClick={() => { onTicker && onTicker(a.t); setOpen(false); }}
              style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "3px 4px", borderRadius: 4, cursor: "pointer", fontSize: 9 }}
              onMouseEnter={(e) => e.currentTarget.style.background = ARIA.bgHover} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              <span style={{ fontSize: 7, fontWeight: 800, color: C[a.type] || ARIA.text, border: `1px solid ${(C[a.type] || ARIA.border)}66`, borderRadius: 2, padding: "0 3px", flexShrink: 0 }}>{a.type}</span>
              <span style={{ fontWeight: 700, color: ARIA.text, flexShrink: 0 }}>{a.t}</span>
              <span style={{ color: ARIA.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.msg}</span>
              <span style={{ color: ARIA.textMuted, fontSize: 7.5, marginLeft: "auto", flexShrink: 0 }}>{a.time}</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)} title="Trade alerts — DE trigger breaks, BO firing, distribution on holdings (portfolio + focus, market hours)"
        style={{ width: 34, height: 34, borderRadius: 17, cursor: "pointer", background: ARIA.bgCard, border: `1px solid ${alerts.length ? "#fb923c" : ARIA.border}`, color: alerts.length ? "#fb923c" : ARIA.textMuted, fontSize: 14, position: "relative", boxShadow: "0 2px 10px rgba(0,0,0,0.4)" }}>
        🔔
        {alerts.length > 0 && <span style={{ position: "absolute", top: -4, right: -4, minWidth: 14, height: 14, borderRadius: 7, background: "#fb923c", color: "#0a0a14", fontSize: 8, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{alerts.length}</span>}
      </button>
    </div>
  );
}

// One-time global CSS: tabular numerals (stable number columns), the loading
// shimmer, and the live-dot pulse. Injected once at module load.
if (typeof document !== "undefined" && !document.getElementById("tp-visual-css")) {
  const st = document.createElement("style");
  st.id = "tp-visual-css";
  st.textContent = `
    body { font-variant-numeric: tabular-nums; }
    @keyframes tpShimmer { 0% { background-position: -140px 0; } 100% { background-position: 140px 0; } }
    .tp-shimmer { background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.14) 50%, rgba(255,255,255,0.05) 75%); background-size: 280px 100%; animation: tpShimmer 1.3s linear infinite; }
    @keyframes tpPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
    .tp-livedot { animation: tpPulse 2s ease-in-out infinite; }
    .tp-wordmark { -webkit-background-clip: text !important; background-clip: text !important; -webkit-text-fill-color: transparent; -webkit-font-smoothing: antialiased; }
  `;
  document.head.appendChild(st);
}

// Click-popover for the 📰 catalyst glyphs — native title tooltips on a 7px
// glyph are unusable. Glyphs dispatch "tp-news-pop"; any outside click/scroll
// dismisses (glyph clicks stopPropagation, so they don't self-dismiss).
function NewsPopover({ ARIA }) {
  const [pop, setPop] = useState(null);
  useEffect(() => {
    const on = (e) => setPop(e.detail);
    const off = () => setPop(null);
    window.addEventListener("tp-news-pop", on);
    window.addEventListener("click", off);
    window.addEventListener("scroll", off, true);
    return () => { window.removeEventListener("tp-news-pop", on); window.removeEventListener("click", off); window.removeEventListener("scroll", off, true); };
  }, []);
  if (!pop) return null;
  const W = 340;
  const left = Math.min(pop.x + 8, (window.innerWidth || 1200) - W - 12);
  const top = Math.min(pop.y + 8, (window.innerHeight || 800) - 160);
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", left, top, width: W, zIndex: 80, background: ARIA.bgCard, border: `1px solid ${ARIA.borderLight}`, borderRadius: 8, boxShadow: ARIA.shadow, padding: "8px 10px", fontFamily: "monospace", backdropFilter: "blur(14px)" }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: ARIA.text, marginBottom: 4 }}>📰 {pop.ticker}</div>
      {(pop.items || []).map((h, i) => (
        <div key={i} style={{ fontSize: 9, color: ARIA.textDim, lineHeight: 1.45, padding: "3px 0", borderBottom: i < pop.items.length - 1 ? `1px solid ${ARIA.border}` : "none" }}>{h}</div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// WheelView — cash-secured put / covered call screener for the wheel.
//
// A screener, not a recommender: it ranks contracts by annualized yield on
// EXTRINSIC value and surfaces the risk flags (earnings inside the cycle,
// thin liquidity, wide spread, strike under cost basis). Selection is the
// user's call. Data comes from /api/wheel (Schwab chain).
// ──────────────────────────────────────────────────────────────────────────

// Closed trades ride the same server-state channel as the watchlist and
// portfolio, so a history imported on one machine shows up on the others.
// Schwab can't supply them (the app is Market Data scope only) — this syncs
// what you've imported, it doesn't fetch anything from the broker.
const LEGACY_WHEEL_KEY = "themepulse-wheel-trades";

function useWheelTrades() {
  const state = useServerState();

  // One-time migration of anything imported before trades were synced.
  useEffect(() => {
    let legacy = null;
    try {
      const raw = localStorage.getItem(LEGACY_WHEEL_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) legacy = parsed;
    } catch { /* unreadable — nothing to migrate */ }
    if (!legacy) { try { localStorage.removeItem(LEGACY_WHEEL_KEY); } catch {} return; }
    _setState((s) => ({ ...s, wheelTrades: mergeTrades(s.wheelTrades || [], legacy).trades }));
    try { localStorage.removeItem(LEGACY_WHEEL_KEY); } catch {}
  }, []);

  const save = useCallback((next) => {
    _setState((s) => ({ ...s, wheelTrades: next }));
  }, []);

  // Clearing stamps a tombstone so other devices don't sync the history back.
  const clearAll = useCallback(() => {
    _setState((s) => ({ ...s, wheelTrades: [], wheelClearedAt: new Date().toISOString() }));
  }, []);

  return [state.wheelTrades || [], save, clearAll];
}

function ClosedTrades({ symbol, ARIA }) {
  const [trades, save, clearAll] = useWheelTrades();
  const [paste, setPaste] = useState("");
  const [status, setStatus] = useState(null);
  const [scopeAll, setScopeAll] = useState(false);
  const [assumeQty, setAssumeQty] = useState("");
  // The paste box only earns its space when there's nothing to look at yet.
  const [showImport, setShowImport] = useState(false);
  // Premium mechanics are diagnostic, not the headline — off by default.
  const [detail, setDetail] = useState(false);

  const summary = useMemo(
    () => summarizeTrades(trades, scopeAll ? {} : { underlying: symbol }),
    [trades, scopeAll, symbol]
  );

  const doImport = () => {
    const { trades: parsed, errors, skippedNonOption } = parseSchwabRealized(paste);
    if (!parsed.length) {
      setStatus({ bad: true, msg: errors[0] || "No option trades found in that paste." });
      return;
    }
    // De-dupe so re-pasting an overlapping export doesn't double-count premium.
    //
    // Keyed on contract + amounts, deliberately NOT on dates: the same trades
    // pasted from the on-screen table (no dates) and then from a full export
    // (with dates) must collapse, or premium gets counted twice — which
    // understates basis, the more dangerous direction to be wrong in. Two
    // genuinely distinct trades matching to the penny on both legs is far
    // rarer than a re-import.
    const { trades: merged, added, enriched, duplicates: dupes } = mergeTrades(trades, parsed);
    save(merged);
    setPaste("");
    setStatus({
      bad: false,
      msg: [
        `Imported ${added} trade${added === 1 ? "" : "s"}`,
        enriched ? `${enriched} updated with new detail` : null,
        dupes ? `${dupes} already present` : null,
        skippedNonOption ? `${skippedNonOption} non-option row${skippedNonOption === 1 ? "" : "s"} skipped` : null,
        errors.length ? `${errors.length} row error${errors.length === 1 ? "" : "s"}` : null,
      ].filter(Boolean).join(" · "),
    });
  };

  const money = (v, dp = 2) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
  const money0 = (v) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString()}`);

  const qty = Number(assumeQty) > 0 ? Number(assumeQty) : null;
  const rows = summary.perTrade;
  // Bars are scaled to the largest winner so relative size reads instantly —
  // the whole point of ranking by dollars is seeing which trades carried it.
  const maxRealized = rows.reduce((m, t) => Math.max(m, Math.abs(t.realized || 0)), 0) || 1;

  const th = { padding: "5px 10px", fontSize: 8, fontWeight: 700, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap" };
  const cell = { padding: "6px 10px", fontSize: 11, textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  // A hairline before a column marks the start of a new group, so 14 columns
  // read as four clusters instead of one undifferentiated wall.
  const groupEdge = { borderLeft: `1px solid ${ARIA.border}` };
  const dim = { color: ARIA.textMuted };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── Import: collapses out of the way once there is data ── */}
      {(showImport || summary.count === 0) ? (
        <div style={{ background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: ARIA.text, letterSpacing: 0.4 }}>IMPORT CLOSED TRADES</span>
            <span style={{ fontSize: 9, color: ARIA.textMuted, fontFamily: "monospace" }}>
              Schwab → Accounts → Realized Gain/Loss → Export, then paste the CSV including its header row.
            </span>
            {summary.count > 0 && (
              <button onClick={() => setShowImport(false)}
                style={{ marginLeft: "auto", background: "transparent", border: "none", color: ARIA.textMuted, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>
                ✕ close
              </button>
            )}
          </div>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={`"Symbol","Name","Closed Date","Opened Date","Quantity","Proceeds","Cost Basis",...`}
            spellCheck={false}
            style={{ width: "100%", minHeight: 64, background: ARIA.bgRow, border: `1px solid ${ARIA.border}`, borderRadius: 6, color: ARIA.text, fontFamily: "monospace", fontSize: 9, padding: 9, resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={doImport} disabled={!paste.trim()}
              style={{ background: paste.trim() ? "rgba(13,145,99,0.14)" : "transparent", border: `1px solid ${paste.trim() ? ARIA.green : ARIA.border}`, color: paste.trim() ? ARIA.green : ARIA.textMuted, padding: "5px 14px", borderRadius: 5, cursor: paste.trim() ? "pointer" : "default", fontFamily: "monospace", fontSize: 9, fontWeight: 700, letterSpacing: 0.6 }}>
              IMPORT
            </button>
            {status && (
              <span style={{ fontSize: 9, fontFamily: "monospace", color: status.bad ? ARIA.red : ARIA.green }}>{status.msg}</span>
            )}
          </div>
        </div>
      ) : null}

      {summary.count === 0 ? (
        <div style={{ background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 10, padding: 32, textAlign: "center", fontFamily: "monospace", fontSize: 10, color: ARIA.textMuted, lineHeight: 1.8 }}>
          No closed {scopeAll ? "option" : symbol} trades imported yet.<br />
          Paste a Schwab Realized Gain/Loss export above to see premium collected and effective basis.
        </div>
      ) : (
        <>
          {/* ── Hero: the number that matters, then supporting metrics ── */}
          <div style={{ background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 2 }}>Realized P/L</div>
              <div style={{ fontSize: 30, fontWeight: 800, fontFamily: "monospace", color: summary.realized >= 0 ? ARIA.green : ARIA.red, lineHeight: 1, letterSpacing: -0.5 }}>
                {money(summary.realized)}
              </div>
              <div style={{ fontSize: 9, color: ARIA.textMuted, fontFamily: "monospace", marginTop: 5 }}>
                {summary.count} trades · {summary.wins}W/{summary.losses}L
                {summary.years.length > 0 && " · "}
                {summary.years.map((y, i) => (
                  <span key={y.year}>
                    {i > 0 && " · "}
                    <span style={{ color: ARIA.textDim }}>{y.year}</span>{" "}
                    <span style={{ color: y.realized >= 0 ? ARIA.green : ARIA.red }}>{money0(y.realized)}</span>
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 22, marginLeft: "auto", flexWrap: "wrap", alignItems: "flex-end" }}>
              {summary.avgPerContract != null && <WheelStat label="$ / contract" value={money(summary.avgPerContract)} hint="Realized P/L divided by total contracts traded" />}
              {summary.rocPct != null && <WheelStat label="On collateral" value={`${summary.rocPct}%`} hint={`Against ${money0(summary.totalCollateral)} of cash collateral committed`} />}
              {summary.annRocPct != null && <WheelStat label="Annualized" value={`${summary.annRocPct}%`} color={ARIA.textDim} hint="On collateral-days — weights capital by how long it was tied up. Assumes the rate repeats all year; it will not." />}
              <div style={{ width: 1, alignSelf: "stretch", background: ARIA.border }} />
              <WheelStat label="Collected" value={money0(summary.collected)} color={ARIA.textDim} hint="Total premium received selling to open" />
              <WheelStat label="Capture" value={`${summary.capturePct}%`} color={ARIA.textMuted} hint="Share of collected premium kept. Process quality, not the scoreboard — a low-capture trade can still be the biggest dollar winner." />
            </div>
          </div>

          {/* ── Toolbar ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontFamily: "monospace", fontSize: 9 }}>
            {summary.top3SharePct != null && summary.best && (
              <span style={{ color: ARIA.textDim }}>
                Top 3 made <b style={{ color: ARIA.text }}>{summary.top3SharePct}%</b> of P/L · biggest{" "}
                <b style={{ color: ARIA.green }}>{summary.best.strike}{summary.best.type === "PUT" ? "P" : "C"} {money0(summary.best.realized)}</b>
                {summary.best.contracts ? ` on ${summary.best.contracts}` : ""}
              </span>
            )}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, color: ARIA.textDim, cursor: "pointer" }}>
                <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
                premium detail
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, color: ARIA.textDim, cursor: "pointer" }}>
                <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} />
                all symbols
              </label>
              {!showImport && (
                <button onClick={() => setShowImport(true)}
                  style={{ background: "transparent", border: `1px solid ${ARIA.border}`, color: ARIA.textDim, padding: "3px 10px", borderRadius: 5, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>
                  + import
                </button>
              )}
              <button onClick={() => { if (confirm(`Delete all ${trades.length} imported trades? This clears them on every device.`)) { clearAll(); setStatus(null); } }}
                style={{ background: "transparent", border: `1px solid ${ARIA.border}`, color: ARIA.textMuted, padding: "3px 10px", borderRadius: 5, cursor: "pointer", fontFamily: "monospace", fontSize: 9 }}>
                clear all
              </button>
            </div>
          </div>

          {summary.missingQty > 0 && (
            <div style={{ fontSize: 9, fontFamily: "monospace", color: ARIA.yellow, background: `${ARIA.yellow}12`, border: `1px solid ${ARIA.yellow}44`, borderRadius: 6, padding: "6px 11px" }}>
              ⚠ {summary.missingQty} trade{summary.missingQty === 1 ? " has" : "s have"} no contract quantity — per-share and basis figures are omitted for {summary.missingQty === 1 ? "it" : "them"}. Re-export including the Quantity column.
            </div>
          )}

          {/* ── Trades ── */}
          <div style={{ background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ maxHeight: "calc(100vh - 430px)", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: ARIA.bgCard, zIndex: 1 }}>
                  <tr style={{ borderBottom: `1px solid ${ARIA.borderLight}` }}>
                    <th style={{ ...th, textAlign: "left" }}>Contract</th>
                    <th style={{ ...th, textAlign: "left" }}>Held</th>
                    <th style={th}>Qty</th>
                    <th style={{ ...th, ...groupEdge, textAlign: "left", paddingLeft: 14 }}>Realized</th>
                    <th style={th} title="Realized P/L per contract">$/ctr</th>
                    <th style={{ ...th, ...groupEdge }} title="Cash collateral tied up (strike × 100 × contracts)">Collateral</th>
                    <th style={th} title="Realized P/L as a percentage of collateral committed">ROC</th>
                    {detail && <th style={{ ...th, ...groupEdge }}>Collected</th>}
                    {detail && <th style={th}>Paid</th>}
                    {detail && <th style={th} title="Share of collected premium kept">Capture</th>}
                    {detail && <th style={th} title="Premium received per share">Prem/sh</th>}
                    <th style={{ ...th, ...groupEdge }} title="Tax basis had THIS put been assigned instead of closed: strike minus its own premium">Basis if assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t, i) => {
                    const pct = Math.abs(t.realized || 0) / maxRealized;
                    const pos = (t.realized || 0) >= 0;
                    return (
                      <tr key={`${t.symbol}-${t.closed}-${i}`}
                        style={{ borderBottom: `1px solid ${ARIA.border}` }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = ARIA.bgHover; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <td style={{ ...cell, textAlign: "left" }}>
                          <span style={{ fontWeight: 800, color: ARIA.text, fontSize: 12 }}>
                            {t.strike}{t.type === "PUT" ? "P" : "C"}
                          </span>
                          <span style={{ color: ARIA.textMuted, fontSize: 9, marginLeft: 7 }}>
                            {scopeAll ? `${t.underlying} ` : ""}{t.expiry || "—"}
                          </span>
                        </td>
                        <td style={{ ...cell, textAlign: "left", color: ARIA.textDim, fontSize: 9 }}>
                          {t.opened && t.closed ? (
                            <>
                              {t.opened.slice(5)} → {t.closed.slice(5)}
                              <span style={{ color: ARIA.textMuted, marginLeft: 6 }}>{t.daysHeld}d</span>
                            </>
                          ) : "—"}
                        </td>
                        <td style={{ ...cell, color: t.contracts ? ARIA.textDim : ARIA.yellow }}>{t.contracts ?? "?"}</td>

                        {/* Realized, with a magnitude bar behind it */}
                        <td style={{ ...cell, ...groupEdge, textAlign: "left", paddingLeft: 14, position: "relative", minWidth: 150 }}>
                          <div style={{ position: "absolute", left: 0, top: 3, bottom: 3, width: `${Math.max(pct * 100, 1.5)}%`, background: pos ? "rgba(52,211,153,0.13)" : "rgba(248,113,113,0.13)", borderLeft: `2px solid ${pos ? ARIA.green : ARIA.red}`, pointerEvents: "none" }} />
                          <span style={{ position: "relative", fontWeight: 800, fontSize: 12, color: pos ? ARIA.green : ARIA.red }}>{money(t.realized)}</span>
                        </td>
                        <td style={{ ...cell, color: ARIA.text }}>{t.perContract != null ? money(t.perContract) : "—"}</td>

                        <td style={{ ...cell, ...groupEdge, ...dim }}>{t.collateral != null ? money0(t.collateral) : "—"}</td>
                        <td style={{ ...cell, ...dim }}>{t.rocPct != null ? `${t.rocPct}%` : "—"}</td>

                        {detail && <td style={{ ...cell, ...groupEdge, ...dim }}>{money(t.collected)}</td>}
                        {detail && <td style={{ ...cell, ...dim }}>{money(t.paid)}</td>}
                        {detail && <td style={{ ...cell, ...dim }}>{t.capturePct != null ? `${t.capturePct}%` : "—"}</td>}
                        {detail && <td style={{ ...cell, ...dim }}>{t.premiumPerShare != null ? money(t.premiumPerShare) : "—"}</td>}

                        <td style={{ ...cell, ...groupEdge, color: t.taxBasisOnAssignment != null ? ARIA.text : ARIA.textMuted }}>
                          {t.taxBasisOnAssignment != null ? money(t.taxBasisOnAssignment) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Basis calculator ── */}
          <div style={{ background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
              Effective basis if assigned
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <WheelNum label="Contracts" value={assumeQty} onChange={setAssumeQty} width={80} hint="Contracts you'd be assigned on" />
              <div style={{ fontSize: 10, fontFamily: "monospace", color: ARIA.textDim, lineHeight: 1.8 }}>
                {qty ? (
                  <>
                    {money(summary.realized)} over {(qty * 100).toLocaleString()} shares ={" "}
                    <b style={{ color: ARIA.green }}>{money(summary.realized / (qty * 100))}/share</b> of offset
                    <br />
                    <span style={{ color: ARIA.textMuted }}>
                      assigned at $200 → economic basis{" "}
                      <b style={{ color: ARIA.text }}>{money(200 - summary.realized / (qty * 100))}</b>
                    </span>
                  </>
                ) : (
                  <span style={{ color: ARIA.textMuted }}>Enter a contract count to apply cumulative premium against a strike.</span>
                )}
              </div>
            </div>
            <div style={{ fontSize: 8.5, color: ARIA.textMuted, fontFamily: "monospace", lineHeight: 1.75, marginTop: 10, borderTop: `1px solid ${ARIA.border}`, paddingTop: 9 }}>
              <b style={{ color: ARIA.yellow }}>Two different numbers, deliberately.</b> The per-trade{" "}
              <b>basis if assigned</b> is the <i>tax</i> basis for a single put — strike minus that put&apos;s own
              premium. Premium from puts already closed doesn&apos;t touch it; those are realized gains, already taxed.
              The calculator is the <i>economic</i> view: strike minus all net premium ever collected on the name.
              Useful for judging a wheel, but not a tax basis and not for a Schedule D. Not tax advice.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const WHEEL_DEFAULTS = {
  symbol: "NVDA",
  capital: 100000,
  minDte: 7,
  maxDte: 60,
  minDelta: 0.1,
  maxDelta: 0.4,
  minOi: 50,
  basis: "",
  shares: "",
};

function useWheelSettings() {
  const [cfg, setCfg] = useState(() => {
    try {
      const raw = localStorage.getItem("themepulse-wheel-cfg");
      return raw ? { ...WHEEL_DEFAULTS, ...JSON.parse(raw) } : WHEEL_DEFAULTS;
    } catch {
      return WHEEL_DEFAULTS;
    }
  });
  const update = useCallback((patch) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem("themepulse-wheel-cfg", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  return [cfg, update];
}

function useWheel(cfg, nonce) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const qs = new URLSearchParams({
      symbol: cfg.symbol,
      capital: cfg.capital,
      minDte: cfg.minDte,
      maxDte: cfg.maxDte,
      minDelta: cfg.minDelta,
      maxDelta: cfg.maxDelta,
      minOi: cfg.minOi,
    });
    // Only send the covered-call inputs when both are present — the endpoint
    // skips the call leg otherwise.
    if (cfg.basis && cfg.shares) {
      qs.set("basis", cfg.basis);
      qs.set("shares", cfg.shares);
    }

    fetch(`/api/wheel?${qs}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) {
          const e = new Error(j?.detail || j?.error || `HTTP ${r.status}`);
          // Schwab refresh tokens last 7 days, so a 401 here is the routine
          // weekly lapse rather than a bug — the UI offers a reconnect link.
          if (r.status === 401) e.needsAuth = true;
          throw e;
        }
        // A 200 that isn't a wheel payload means we didn't reach the function
        // at all — in `vite dev` the SPA rewrite serves index.html for /api/*.
        // Surfacing that as "no contracts matched" would be a lie.
        if (!j || !Array.isArray(j.puts)) {
          throw new Error("No wheel data returned — /api/wheel is only live on the deployed site.");
        }
        return j;
      })
      .then((d) => { if (!cancelled) setState({ loading: false, data: d, error: null }); })
      .catch((e) => {
        if (!cancelled) setState({ loading: false, data: null, error: String(e.message || e), needsAuth: Boolean(e.needsAuth) });
      });

    return () => { cancelled = true; };
  }, [cfg, nonce]);

  return state;
}

function WheelNum({ label, value, onChange, width = 78, step, hint }) {
  const ARIA = useAriaTheme();
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2 }} title={hint || label}>
      <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width, background: ARIA.bgRow, border: `1px solid ${ARIA.border}`, borderRadius: 4,
          color: ARIA.text, fontFamily: "monospace", fontSize: 10, padding: "3px 6px",
        }}
      />
    </label>
  );
}

function WheelStat({ label, value, color, hint }) {
  const ARIA = useAriaTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }} title={hint || ""}>
      <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: color || ARIA.text }}>{value}</span>
    </div>
  );
}

// Resolve the next earnings date for a symbol, preferring FMP's confirmed
// date from /api/wheel and falling back to the pipeline's estimate.
//
// This fallback exists because FMP's forward calendar is frequently empty —
// NVDA had no `next` date at all while sitting ~2 weeks from a report. An
// absent ER badge would then look identical to "checked, and it's clear",
// which is the wrong way for a wheel screener to fail. The pipeline carries
// `earnings_display` (e.g. "~8/18/2026", the ~ marking it approximate), so
// we use it and label the result as an estimate rather than showing nothing.
function resolveEarnings(apiEarnings, stockMap, symbol) {
  if (apiEarnings?.date) {
    return { date: apiEarnings.date, estimated: false, timing: apiEarnings.timing || null };
  }
  const row = stockMap?.[symbol] || stockMap?.[String(symbol || "").toUpperCase()];
  const disp = row?.earnings_display;
  if (disp) {
    const m = String(disp).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      const [, mo, d, y] = m;
      return {
        date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        estimated: String(disp).includes("~"),
        timing: row?.er_timing || null,
      };
    }
  }
  return null;
}

function WheelView({ onTickerClick, stockMap }) {
  const ARIA = useAriaTheme();
  const [cfg, update] = useWheelSettings();
  const [nonce, setNonce] = useState(0);
  const [leg, setLeg] = useState("puts");
  const { loading, data, error, needsAuth } = useWheel(cfg, nonce);

  const er = useMemo(
    () => resolveEarnings(data?.earnings, stockMap, data?.symbol || cfg.symbol),
    [data, stockMap, cfg.symbol]
  );
  // Recompute per row rather than trusting the server flag, so the fallback
  // date is applied consistently across both legs.
  const erInCycle = useCallback((row) => Boolean(er?.date && er.date <= row.expiration), [er]);

  const th = { padding: "4px 8px", fontSize: 8, fontWeight: 700, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, fontFamily: "monospace", whiteSpace: "nowrap" };
  const cell = { padding: "3px 8px", fontSize: 10, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, fontFamily: "monospace", whiteSpace: "nowrap" };

  const rows = data && leg !== "closed" ? (leg === "puts" ? data.puts : data.calls) : [];
  const hasShares = Boolean(cfg.basis && cfg.shares);

  // Yield colouring is relative, not a verdict — high annualized yield on an
  // option is compensation for risk, not free money.
  const yieldColor = (v) => (v >= 40 ? ARIA.green : v >= 20 ? ARIA.text : ARIA.textDim);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header + controls */}
      <div style={{ background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 8, padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", letterSpacing: 0.5, color: ARIA.text }}>🎡 WHEEL</span>
          <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace" }}>
            sell cash-secured puts · take assignment · sell covered calls · repeat
          </span>

          {data && (
            <div style={{ display: "flex", gap: 18, marginLeft: "auto", alignItems: "flex-end" }}>
              <WheelStat
                label={data.symbol}
                value={`$${data.underlyingPrice?.toFixed(2)}`}
                hint="Underlying last price from the Schwab chain"
              />
              <WheelStat
                label="ATM IV"
                value={data.atmIV != null ? `${data.atmIV}%` : "—"}
                hint="At-the-money implied volatility"
              />
              <WheelStat
                label="Chain IV rank"
                value={data.ivRank != null ? data.ivRank : "—"}
                color={ARIA.textDim}
                hint="Where ATM IV sits within THIS chain's strikes — not a 52-week IV rank. Schwab's chain endpoint carries no vol history."
              />
              <WheelStat
                label={er ? (er.estimated ? "Earnings (est)" : "Earnings") : "Earnings"}
                value={er ? `${er.estimated ? "~" : ""}${er.date}${er.timing ? ` ${String(er.timing).toUpperCase()}` : ""}` : "UNKNOWN"}
                color={er ? ARIA.yellow : ARIA.red}
                hint={
                  er
                    ? `Cycles spanning this date are flagged ER below.${er.estimated ? " This date is the pipeline's estimate, not a confirmed report date — verify before selling into it." : ""}`
                    : "No earnings date from either source — absence of ER flags below does NOT mean the cycle is clear. Verify manually."
                }
              />
            </div>
          )}
        </div>

        {/* Inputs */}
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", letterSpacing: 0.4, textTransform: "uppercase" }}>Symbol</span>
            <input
              value={cfg.symbol}
              onChange={(e) => update({ symbol: e.target.value.toUpperCase().trim() })}
              style={{ width: 70, background: ARIA.bgRow, border: `1px solid ${ARIA.border}`, borderRadius: 4, color: ARIA.text, fontFamily: "monospace", fontSize: 10, fontWeight: 700, padding: "3px 6px" }}
            />
          </label>
          <WheelNum label="Capital" value={cfg.capital} onChange={(v) => update({ capital: v })} width={92} hint="Cash available to secure puts — drives the contract count" />
          <WheelNum label="Min DTE" value={cfg.minDte} onChange={(v) => update({ minDte: v })} width={62} />
          <WheelNum label="Max DTE" value={cfg.maxDte} onChange={(v) => update({ maxDte: v })} width={62} />
          <WheelNum label="Min Δ" value={cfg.minDelta} onChange={(v) => update({ minDelta: v })} width={62} step="0.05" hint="Delta ≈ probability of finishing ITM (assignment odds)" />
          <WheelNum label="Max Δ" value={cfg.maxDelta} onChange={(v) => update({ maxDelta: v })} width={62} step="0.05" />
          <WheelNum label="Min OI" value={cfg.minOi} onChange={(v) => update({ minOi: v })} width={62} hint="Open interest floor — filters untradeable strikes" />

          <div style={{ width: 1, alignSelf: "stretch", background: ARIA.border, margin: "0 2px" }} />
          <WheelNum label="Cost basis" value={cfg.basis} onChange={(v) => update({ basis: v })} width={82} step="0.01" hint="Your NVDA cost basis — enables the covered-call leg" />
          <WheelNum label="Shares" value={cfg.shares} onChange={(v) => update({ shares: v })} width={70} hint="Shares held — covered calls need 100+" />

          <button
            onClick={() => setNonce((n) => n + 1)}
            style={{ background: "rgba(13,145,99,0.14)", border: `1px solid ${ARIA.green}`, color: ARIA.green, padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 9, fontWeight: 700, letterSpacing: 0.6 }}
          >
            {loading ? "…" : "REFRESH"}
          </button>
        </div>
      </div>

      {/* Leg tabs */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {[["puts", `① CASH-SECURED PUTS${data ? ` (${data.puts.length})` : ""}`], ["calls", `② COVERED CALLS${data ? ` (${data.calls.length})` : ""}`], ["closed", "③ CLOSED TRADES"]].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setLeg(k)}
            style={{
              background: leg === k ? "rgba(13,145,99,0.14)" : "transparent",
              border: `1px solid ${leg === k ? ARIA.green : ARIA.border}`,
              color: leg === k ? ARIA.green : ARIA.textDim,
              padding: "3px 10px", borderRadius: 4, cursor: "pointer",
              fontFamily: "monospace", fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", marginLeft: 8 }}>
          yield is annualized on <b>extrinsic</b> value · premium assumes a fill at the bid
        </span>
        {data && !er && (
          <span title="Neither FMP nor the pipeline returned an earnings date for this symbol" style={{ fontSize: 8, fontWeight: 700, color: ARIA.red, background: `${ARIA.red}1f`, border: `1px solid ${ARIA.red}55`, borderRadius: 3, padding: "1px 6px", marginLeft: 8, fontFamily: "monospace" }}>
            ⚠ NO EARNINGS DATE — ER FLAGS UNAVAILABLE
          </span>
        )}
        {data && er?.estimated && (
          <span title={`Pipeline estimate (${er.date}), not a confirmed report date — verify before selling into a flagged cycle`} style={{ fontSize: 8, fontWeight: 700, color: ARIA.yellow, background: `${ARIA.yellow}1f`, border: `1px solid ${ARIA.yellow}55`, borderRadius: 3, padding: "1px 6px", marginLeft: 8, fontFamily: "monospace" }}>
            ER? = estimated date
          </span>
        )}
        {data?.meta?.cached && (
          <span style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", marginLeft: "auto" }}>cached</span>
        )}
      </div>

      {/* Table */}
      {leg === "closed" ? (
        <ClosedTrades symbol={cfg.symbol} ARIA={ARIA} />
      ) : (
      <div style={{ background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 8, overflow: "hidden" }}>
        {error && (
          <div style={{ padding: 20, fontFamily: "monospace", fontSize: 10, lineHeight: 1.6 }}>
            <div style={{ color: needsAuth ? ARIA.yellow : ARIA.red }}>{error}</div>
            {needsAuth ? (
              <>
                <div style={{ color: ARIA.textMuted, marginTop: 6 }}>
                  Schwab refresh tokens expire every 7 days — this is the routine weekly lapse, not a failure.
                </div>
                <a
                  href="/api/schwab-callback"
                  style={{ display: "inline-block", marginTop: 10, background: "rgba(13,145,99,0.14)", border: `1px solid ${ARIA.green}`, color: ARIA.green, padding: "4px 12px", borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textDecoration: "none" }}
                >
                  RECONNECT SCHWAB →
                </a>
              </>
            ) : (
              <div style={{ color: ARIA.textMuted, marginTop: 6 }}>
                The wheel screen needs a linked Schwab account for the options chain, and only runs against the deployed API.
              </div>
            )}
          </div>
        )}
        {!error && loading && (
          <div style={{ padding: 24, textAlign: "center", fontFamily: "monospace", fontSize: 10, color: ARIA.textMuted }}>loading chain…</div>
        )}
        {!error && !loading && leg === "calls" && !hasShares && (
          <div style={{ padding: 24, textAlign: "center", fontFamily: "monospace", fontSize: 10, color: ARIA.textMuted, lineHeight: 1.6 }}>
            Covered calls are the post-assignment leg.<br />
            Enter a <b>cost basis</b> and <b>share count</b> above once you're assigned.
          </div>
        )}
        {!error && !loading && rows.length === 0 && !(leg === "calls" && !hasShares) && (
          <div style={{ padding: 24, textAlign: "center", fontFamily: "monospace", fontSize: 10, color: ARIA.textMuted }}>
            No contracts matched. Try widening the delta band or DTE range, or lowering min OI.
          </div>
        )}
        {!error && !loading && rows.length > 0 && (
          <div style={{ maxHeight: "calc(100vh - 300px)", overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: ARIA.bgCard, zIndex: 1 }}>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Expiry</th>
                  <th style={th}>DTE</th>
                  <th style={th}>Strike</th>
                  <th style={th} title="Delta ≈ probability of assignment">Δ</th>
                  <th style={th}>Bid</th>
                  <th style={th} title="Time value — the actual income; total premium minus intrinsic">Extrin</th>
                  <th style={th} title="Annualized return on extrinsic value">Ann %</th>
                  {leg === "puts" ? (
                    <>
                      <th style={th} title="Strike minus premium — the price you effectively own shares at">B/E</th>
                      <th style={th} title="How far the stock can fall before you lose money">Cushion</th>
                      <th style={th} title="Cash required to secure one contract">Collat</th>
                      <th style={th} title="Contracts affordable with the capital entered">Qty</th>
                    </>
                  ) : (
                    <>
                      <th style={th} title="P/L if the shares are called away at this strike">If called</th>
                      <th style={th}>OTM %</th>
                      <th style={th}>Qty</th>
                    </>
                  )}
                  <th style={th}>IV</th>
                  <th style={th}>OI</th>
                  <th style={{ ...th, textAlign: "left" }}>Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.expiration}-${r.strike}`}
                    style={{ background: r.sweetSpot ? "rgba(52,211,153,0.05)" : "transparent" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = ARIA.bgHover; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = r.sweetSpot ? "rgba(52,211,153,0.05)" : "transparent"; }}
                  >
                    <td style={{ ...cell, textAlign: "left", color: ARIA.textDim }}>{r.expiration}</td>
                    <td style={{ ...cell, color: ARIA.textDim }}>{r.dte}</td>
                    <td style={{ ...cell, fontWeight: 800, color: ARIA.text }}>{r.strike}</td>
                    <td style={{ ...cell, color: r.sweetSpot ? ARIA.green : ARIA.textDim, fontWeight: r.sweetSpot ? 700 : 400 }}>{r.delta.toFixed(2)}</td>
                    <td style={{ ...cell, color: ARIA.text }}>{r.bid.toFixed(2)}</td>
                    <td style={{ ...cell, color: r.itm ? ARIA.yellow : ARIA.textDim }}>{r.extrinsic.toFixed(2)}</td>
                    <td style={{ ...cell, fontWeight: 800, color: yieldColor(r.annualizedPct) }}>{r.annualizedPct.toFixed(1)}%</td>
                    {leg === "puts" ? (
                      <>
                        <td style={{ ...cell, color: ARIA.text }}>{r.breakeven.toFixed(2)}</td>
                        <td style={{ ...cell, color: r.cushionPct >= 8 ? ARIA.green : r.cushionPct >= 4 ? ARIA.textDim : ARIA.red }}>{r.cushionPct.toFixed(1)}%</td>
                        <td style={{ ...cell, color: ARIA.textDim }}>${(r.collateral / 1000).toFixed(1)}k</td>
                        <td style={{ ...cell, color: r.maxContracts > 0 ? ARIA.text : ARIA.red }}>{r.maxContracts}</td>
                      </>
                    ) : (
                      <>
                        <td style={{ ...cell, fontWeight: 700, color: r.calledAwayPL >= 0 ? ARIA.green : ARIA.red }}>
                          {r.calledAwayPL >= 0 ? "+" : "−"}${Math.abs(r.calledAwayPL).toLocaleString()}
                        </td>
                        <td style={{ ...cell, color: ARIA.textDim }}>{r.otmPct.toFixed(1)}%</td>
                        <td style={{ ...cell, color: ARIA.textDim }}>{r.contracts}</td>
                      </>
                    )}
                    <td style={{ ...cell, color: ARIA.textDim }}>{r.iv.toFixed(1)}</td>
                    <td style={{ ...cell, color: ARIA.textDim }}>{r.oi >= 1000 ? `${(r.oi / 1000).toFixed(1)}k` : r.oi}</td>
                    <td style={{ ...cell, textAlign: "left" }}>
                      {erInCycle(r) && (
                        <span title={`Earnings${er?.estimated ? " (estimated " + er.date + ")" : ""} falls inside this expiration cycle — assignment risk here is not normal-distribution risk`} style={{ fontSize: 7.5, fontWeight: 800, color: ARIA.yellow, background: `${ARIA.yellow}1f`, border: `1px solid ${ARIA.yellow}55`, borderRadius: 2, padding: "0 4px", marginRight: 4 }}>{er?.estimated ? "ER?" : "ER"}</span>
                      )}
                      {r.itm && (
                        <span title="In the money" style={{ fontSize: 7.5, fontWeight: 800, color: ARIA.purple, background: `${ARIA.purple}1f`, border: `1px solid ${ARIA.purple}55`, borderRadius: 2, padding: "0 4px", marginRight: 4 }}>ITM</span>
                      )}
                      {(r.warnings || []).map((w, i) => (
                        <span key={i} title={w} style={{ fontSize: 7.5, color: ARIA.red, marginRight: 5 }}>{w}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      <div style={{ fontSize: 8, color: ARIA.textMuted, fontFamily: "monospace", lineHeight: 1.7, padding: "0 2px" }}>
        Screener output, not a recommendation. Annualized yield assumes the position is repeated all year at the same
        rate — it will not be. A cash-secured put carries the full downside of owning {cfg.symbol || "the stock"} from
        the breakeven down; a covered call caps your upside at the strike.
        {onTickerClick && data?.symbol && (
          <>
            {" "}
            <button
              onClick={() => onTickerClick(data.symbol)}
              style={{ background: "transparent", border: "none", color: ARIA.green, cursor: "pointer", fontFamily: "monospace", fontSize: 8, textDecoration: "underline", padding: 0 }}
            >
              chart {data.symbol} →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AppMain() {
  // ── ALL hooks must be at the top, before any conditional return ────────
  // Phase 2.7 had useMemo(stockMap) AFTER the data.loading early return,
  // which caused React error #310 ("Rendered more hooks than during the
  // previous render") on the loading→loaded transition.
  const ARIA = useAriaTheme();
  const { themeMode, toggleTheme, zoom, changeZoom } = useAriaThemeControls();
  const data = useDashboardData();
  // Active ticker for the inline chart panel.
  // Default chart ticker. Persists in localStorage.
  const [chartTicker, setChartTicker] = useState(() => {
    return localStorage.getItem("themepulse-chart-ticker") || "QQQ";
  });
  // Top-level view: dashboard or setup journal
  const [mainView, setMainView] = useState(() => { const v = localStorage.getItem("themepulse-view"); return v === "leaders" || v === "journal" ? "dash" : (v || "dash"); });
  const switchView = useCallback((v) => {
    setMainView(v);
    try { localStorage.setItem("themepulse-view", v); } catch {}
  }, []);
  const handleTickerClick = useCallback((ticker) => {
    if (!ticker) return;
    setChartTicker(ticker);
    localStorage.setItem("themepulse-chart-ticker", ticker);
  }, []);

  // Listen for ETF pill clicks from the Themes view (or anywhere else
  // that wants to load a chart without prop-drilling).
  // Also catches postMessage from chain/leaderboard iframes.
  useEffect(() => {
    const onOpen = (e) => {
      const t = (e && e.detail && String(e.detail).toUpperCase()) || "";
      if (t) handleTickerClick(t);
    };
    const onMsg = (e) => {
      if (e?.data?.type === "tp-open-chart" && e.data.ticker) {
        handleTickerClick(String(e.data.ticker).toUpperCase());
      }
    };
    window.addEventListener("tp-open-chart", onOpen);
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("tp-open-chart", onOpen);
      window.removeEventListener("message", onMsg);
    };
  }, [handleTickerClick]);

  // Framework scores (Execution & Integrity Framework) — loaded from static JSON.
  const [frameworkScoresRaw, setFrameworkScoresRaw] = useState({});
  useEffect(() => {
    fetch("/data/framework_scores.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.scores) setFrameworkScoresRaw(d.scores); })
      .catch(() => {});
  }, []);

  // stockMap depends on data.pipeline.stocks. Compute it BEFORE the early
  // returns so the hook count is stable across loading→loaded transitions.
  const stocks = data.pipeline?.stocks || [];
  const stockMap = useMemo(() => {
    const m = {};
    stocks.forEach((s) => {
      if (s.ticker) m[s.ticker] = s;
    });
    Object.entries(frameworkScoresRaw).forEach(([ticker, score]) => {
      if (m[ticker]) m[ticker].framework_score = score;
    });
    // Delayed-Entry readiness (Wiedmaier): stamp de_ready/de_trigger from the
    // EP scanner's consolidation analysis so every table can flag stalkable
    // gappers (2-7d post-gap, tight closes, narrowing range, holding 4-EMA).
    (data.pipeline?.ep_signals || []).forEach((sig) => {
      const c = sig?.consol;
      if (c?.de_ready && m[sig.ticker]) {
        m[sig.ticker].de_ready = true;
        m[sig.ticker].de_trigger = c.de_trigger ?? null;
        m[sig.ticker].de_days = c.days_since ?? null;
        m[sig.ticker].de_hold = c.gap_hold_label || null;      // HELD / BASING / FADING
        m[sig.ticker].de_hold_score = c.gap_hold_score ?? null; // 0-5
      }
    });
    // Catalyst headlines (09h scrape) — stamp the top few per ticker so every
    // table row / the drawer can answer "why did this move?" without a fetch.
    const hl = data.pipeline?.headlines || {};
    Object.entries(hl).forEach(([t, v]) => {
      const arr = v?.headlines;
      if (m[t] && Array.isArray(arr) && arr.length) m[t]._newsPipe = arr.slice(0, 4);
    });
    // Mover EP-quality (earnings/SIP movers) — which gappers are worth stalking.
    const _allMovers = [...(data.pipeline?.earnings_movers || []), ...(data.pipeline?.pm_sip_movers || []), ...(data.pipeline?.ah_sip_movers || [])];
    _allMovers.forEach((mv) => {
      if (mv?.ticker && m[mv.ticker] && mv.ep_quality_label) {
        m[mv.ticker]._epq = mv.ep_quality_label;
        m[mv.ticker]._epSizing = mv.sizing_guide || null;
      }
    });
    // "In play" set — mirrors the ⚡ In Play subtab (top-15 in-universe movers by
    // EP quality) so tables can gold-flag the catalyst glyph for stalkable names.
    const _qOrd = { GENUINE: 5, ELITE: 4, EXPLOSIVE: 4, STRONG: 3, DECENT: 2, WEAK: 1 };
    _allMovers
      .filter((mv) => mv.in_universe && mv.ticker)
      .sort((a, b) => (_qOrd[b.ep_quality_label] || 0) - (_qOrd[a.ep_quality_label] || 0) || Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0))
      .slice(0, 15)
      .forEach((mv) => { if (m[mv.ticker]) m[mv.ticker]._inPlay = true; });
    return m;
  }, [stocks, frameworkScoresRaw, data.pipeline?.ep_signals, data.pipeline?.headlines, data.pipeline?.earnings_movers, data.pipeline?.pm_sip_movers, data.pipeline?.ah_sip_movers]);
  // 🔔 Trade alerts (portfolio + focus, RTH): DE trigger breaks, BO firing, DIST on holdings
  const tradeAlerts = useTradeAlerts(stockMap);

  // Subtheme setup score per ticker — used in Scan Watch "Str" column.
  // Formula mirrors computeDailySetupScore in SubthemeRotation.jsx.
  const tickerStrengthMap = useMemo(() => {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const map = {};
    (data.pipeline?.themes || []).forEach(theme => {
      (theme.subthemes || []).forEach(sub => {
        if (sub.rs == null) return;
        const rs = sub.rs;
        const breadth = sub.breadth ?? 50;
        const weeklyRs = sub.weekly_rs ?? null;
        const monthlyRs = sub.monthly_rs ?? null;
        const strength = rs * 0.6 + breadth * 0.4;
        const d1 = weeklyRs != null && monthlyRs != null ? weeklyRs - monthlyRs : 0;
        const d4 = monthlyRs != null ? monthlyRs - 50 : 0;
        const d1Score = clamp(50 + d1 * 5, 0, 100);
        const d4Score = clamp(50 + d4 * 2.5, 0, 100);
        const direction = clamp(d1Score * 0.5 + d4Score * 0.3 + 50, 0, 100);
        // Dispersion from constituent RS std dev
        const rsVals = (sub.tickers || []).map(t => t.rs).filter(v => v != null);
        let disp = 30;
        if (rsVals.length >= 2) {
          const mean = rsVals.reduce((a, b) => a + b, 0) / rsVals.length;
          disp = Math.sqrt(rsVals.reduce((s, v) => s + (v - mean) ** 2, 0) / rsVals.length);
        }
        const conviction = clamp(100 - disp * 2.5, 0, 100);
        const score = Math.round(Math.pow(strength * direction * conviction, 1 / 3));
        (sub.tickers || []).forEach(t => {
          const ticker = typeof t === "string" ? t : t.ticker;
          if (ticker && map[ticker] == null) map[ticker] = score;
        });
      });
    });
    return map;
  }, [data.pipeline]);

  // ── Now safe to do conditional early returns ───────────────────────────
  if (data.loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: ARIA.bg,
          color: ARIA.textDim,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        Loading pipeline…
      </div>
    );
  }

  if (data.error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: ARIA.bg,
          color: ARIA.red,
          padding: 24,
          fontFamily: "monospace",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700 }}>{data.error}</div>
        <div style={{ fontSize: 11, color: ARIA.textDim, marginTop: 6 }}>
          Pipeline data is required. Check that /dashboard_data.json exists.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: ARIA.vignette || ARIA.bg,
        backgroundAttachment: "fixed",
        color: ARIA.text,
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      <AlertsBell alerts={tradeAlerts} onTicker={handleTickerClick} ARIA={ARIA} />
      <NewsPopover ARIA={ARIA} />
      {/* Topbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 24px",
          background: ARIA.bgCard,
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderBottom: `1px solid ${ARIA.border}`,
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          className="tp-wordmark"
          style={{
            fontSize: 16,
            fontWeight: 800,
            backgroundImage: `linear-gradient(135deg, ${ARIA.brand1 || ARIA.green}, ${ARIA.brand2 || ARIA.cyan})`,
            letterSpacing: 0.2,
          }}
        >
          THEMEPULSE{" "}
          <span
            style={{
              WebkitTextFillColor: ARIA.textMuted,
              fontWeight: 400,
              fontSize: 11,
            }}
          >
            Trading Dashboard
          </span>
        </div>
        {/* View switcher */}
        <div style={{ display: "flex", gap: 2, marginLeft: 18 }}>
          {[["dash", "DASH"], ["wheel", "WHEEL"]].map(([v, label]) => (
            <button key={v} onClick={() => switchView(v)}
              style={{
                background: mainView === v ? "rgba(13,145,99,0.14)" : "transparent",
                border: `1px solid ${mainView === v ? ARIA.green : ARIA.border}`,
                color: mainView === v ? ARIA.green : ARIA.textDim,
                padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                fontFamily: "monospace", fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
              }}>{label}</button>
          ))}
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ color: ARIA.textMuted, fontSize: 10 }}>
            {stocks.length.toLocaleString()} stocks · {data.pipeline?.date || ""}
          </span>
          <button
            onClick={toggleTheme}
            title={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
            style={{
              background: "transparent",
              border: `1px solid ${ARIA.border}`,
              color: ARIA.textDim,
              padding: "4px 10px",
              borderRadius: 4,
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {themeMode === "dark" ? "Light" : "Dark"}
          </button>
          {/* A-/A+ text size buttons (Aria-faithful, persisted) */}
          <div style={{ display: "flex" }}>
            <button
              onClick={() => changeZoom(-1)}
              title="Decrease text size"
              style={{
                background: "transparent",
                border: `1px solid ${ARIA.border}`,
                borderRight: "none",
                color: ARIA.textDim,
                padding: "4px 6px",
                borderRadius: "4px 0 0 4px",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 10,
                letterSpacing: 1,
              }}
            >
              A-
            </button>
            <button
              onClick={() => changeZoom(1)}
              title="Increase text size"
              style={{
                background: "transparent",
                border: `1px solid ${ARIA.border}`,
                color: ARIA.textDim,
                padding: "4px 6px",
                borderRadius: "0 4px 4px 0",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 10,
                letterSpacing: 1,
              }}
            >
              A+
            </button>
          </div>
          <span
            style={{
              fontSize: 9,
              color: ARIA.textMuted,
              fontFamily: "monospace",
              minWidth: 28,
              textAlign: "right",
            }}
            title="Current zoom level"
          >
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </div>

      {/* Main content — Aria-faithful layout */}
      <div
        style={{
          padding: "12px 16px",
          maxWidth: 1600,
          margin: "0 auto",
          zoom: zoom,
        }}
      >
        {mainView === "journal" ? (
          <SetupJournal
            stockMap={stockMap}
            onTickerClick={(t) => { handleTickerClick(t); switchView("dash"); }}
          />
        ) : mainView === "leaders" ? (
          <LeadersView
            stockMap={stockMap}
            onTickerClick={(t) => { handleTickerClick(t); switchView("dash"); }}
          />
        ) : mainView === "wheel" ? (
          <ErrorBoundary>
            <WheelView stockMap={stockMap} onTickerClick={(t) => { handleTickerClick(t); switchView("dash"); }} />
          </ErrorBoundary>
        ) : (
          <>
            {/* Market Conditions — verdict + exposure + live indexes/breadth in one bar */}
            <ErrorBoundary>
              <MarketConditionsPanel stocks={stocks} onTickerClick={handleTickerClick} />
            </ErrorBoundary>

            {/* Two-box layout: ticker chart (left) · rotation board + Scan Watch stacked (right) */}
            <ChartScanRow
              chartTicker={chartTicker}
              handleTickerClick={handleTickerClick}
              stockMap={stockMap}
              themeHealth={data.pipeline?.theme_health || []}
              stocks={stocks}
              tickerStrengthMap={tickerStrengthMap}
              rotationBoard={
                <ErrorBoundary>
                  <ExtendedHoursBox pipeline={data.pipeline} onTickerClick={handleTickerClick} stockMap={stockMap} />
                  <RsRotationBoard onTickerClick={handleTickerClick} chartTicker={chartTicker} stockMap={stockMap} pipelineMeta={data.pipeline?.pipeline_meta} movers={[...(data.pipeline?.earnings_movers || []).map((m) => ({ ...m, _src: "ER" })), ...(data.pipeline?.pm_sip_movers || []).map((m) => ({ ...m, _src: "PM" })), ...(data.pipeline?.ah_sip_movers || []).map((m) => ({ ...m, _src: "AH" }))]} />
                </ErrorBoundary>
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Theme → Drawer routing (used by TickerInfoBox to show "would-be drawer"
// for tickers not explicitly placed in any drawer's curated list)
// ──────────────────────────────────────────────────────────────────────────
const THEME_TO_DRAWER = {
  "AI INFRASTRUCTURE": "ai",
  "PHOTONICS":         "ai",
  "SEMICONDUCTORS":    "ai",
  "POWER GRID":        "ai",
  "ENERGY":            "ai",
  "DEFENSE":           "defense",
  "SPACE":             "space",
  "AUTONOMOUS SYSTEMS":"robotics",
  "ROBOTICS":          "robotics",
  "EV":                "ev",
  "QUANTUM":           "quantum",
  "SOFTWARE":          "software",
  "CLOUD":             "software",
  "SOCIAL MEDIA":      "software",
  "CYBER":             "cyber",
  "FINTECH":           "fintech",
};
// Curated drawer-universe tickers — must match SUBTHEMES in theme-leaderboard.html.
// Only these tickers appear in the Earnings Calendar "Drawer" scope.
const DRAWER_TICKERS = new Set(["AAOI","ABAT","ABT","ACHR","ADBE","AEHR","AEVA","AFRM","AI","AKAM","ALAB","ALB","ALLY","ALV","AMAT","AMD","AMKR","AMPG","AMPX","AMZN","ANET","APH","APLD","APTV","ARM","ARQQ","ASAN","ASML","ASTS","AUR","AVAV","AVGO","AXON","AXTI","AZPN","BA","BAH","BBAI","BE","BITB","BITF","BITO","BITW","BKSY","BLK","BOX","BRRR","BTDR","BWA","BWXT","BX","CACI","CAMT","CARR","CCC","CEG","CFLT","CGNX","CHKP","CIEN","CIFR","CLS","CLSK","COHR","COIN","CORZ","CRDO","CRM","CRWD","CRWV","CSCO","CYBR","DAVE","DBX","DDOG","DELL","DLO","DLR","DOCS","DOCU","EH","EME","EMR","ENTG","ENVX","EOSE","EQIX","EQT","ESTC","ETN","EVGO","EVTL","F","FBTC","FIX","FN","FORM","FOUR","FREY","FROG","FSLY","FTNT","FUTU","GBTC","GD","GE","GEN","GEV","GHM","GLW","GLXY","GM","GNRC","GOOGL","GS","GSAT","GTLB","GWRE","GXO","HEI","HII","HON","HOOD","HPE","HSAI","HUBS","HUT","IBIT","IBKR","IBM","INTC","INTU","INVZ","IONQ","IOT","IRDM","IREN","ISRG","JBL","JCI","JOBY","KEYS","KKR","KLAC","KSCP","KSPI","KTOS","KULR","LAC","LAES","LAZR","LC","LCID","LDOS","LEA","LHX","LI","LIDR","LITE","LITM","LLNW","LMT","LRCX","LUNR","LWLG","MA","MANH","MARA","MASI","MBLY","MDB","MDT","META","MGA","MKSI","MNDY","MNTS","MOD","MP","MRVL","MS","MSFT","MSTR","MTSI","MU","MVIS","MVST","MXL","MYRG","NBIS","NDSN","NEE","NET","NIO","NNDM","NNE","NOC","NOVT","NOW","NRG","NU","NVDA","NVEI","NVT","NVTS","OKLO","OKTA","OLO","ONDS","ONTO","ORCL","OSPN","OUST","PAGS","PANW","PATH","PCOR","PD","PDYN","PL","PLTR","POET","PRIM","PWR","PYPL","QBTS","QLYS","QS","QUBT","RBRK","RCAT","RDW","RDWR","RGR","RGTI","RIOT","RIVN","RJF","RKLB","RNG","ROK","RPD","RR","RTX","S","SAIC","SAIL","SAP","SCHW","SERV","SHLS","SIMO","SLDP","SMAR","SMCI","SMR","SNDK","SNOW","SOFI","SOUN","SPCE","SPIR","SQ","SQM","STLA","STX","STXS","SUMO","SWBI","SWI","SYK","SYM","TDC","TDG","TDY","TEAM","TEL","TENB","TIGR","TLN","TOST","TSEM","TSLA","TSM","TXT","TYL","UMAC","V","VEEV","VERX","VIAV","VRNS","VRT","VSAT","VST","WDAY","WDC","WOLF","WULF","XPEV","YOU","ZM","ZS"]);

// Curated subthemes — mirrors SUBTHEMES in theme-leaderboard.html
const DRAWER_SUBTHEMES = [
  { theme: "AI Infra", themeId: "ai", layer: "Compute Silicon", desc: "GPUs, accelerators & CPUs powering AI training and inference", tickers: ["NVDA","AMD","AVGO","INTC","MRVL","ARM","ALAB","TSM"] },
  { theme: "AI Infra", themeId: "ai", layer: "AI Connectivity", desc: "High-speed interconnects, retimers & optics linking AI clusters", tickers: ["ALAB","CRDO","MRVL","AAOI","MXL","AVGO"] },
  { theme: "AI Infra", themeId: "ai", layer: "Networking + Components", desc: "Switches & components for AI datacenter networks", tickers: ["ANET","CSCO","CIEN","APH","TEL","CLS","JBL"] },
  { theme: "AI Infra", themeId: "ai", layer: "Memory + Storage", desc: "DRAM, HBM, NAND & storage feeding AI workloads", tickers: ["MU","SNDK","WDC","STX","RMBS","SIMO"] },
  { theme: "AI Infra", themeId: "ai", layer: "DC + Cooling", desc: "Datacenter build-out — power, cooling & servers", tickers: ["DLR","EQIX","VRT","EME","SMCI","DELL","HPE","ETN","MOD","NVT","CARR","JCI","FIX","IRM"] },
  { theme: "AI Infra", themeId: "ai", layer: "Photonics", desc: "Optical transceivers & silicon photonics for bandwidth", tickers: ["AAOI","CIEN","COHR","FN","CRDO","LITE","VIAV","AXTI","MTSI","POET","LWLG","LPTH"] },
  { theme: "AI Infra", themeId: "ai", layer: "Neoclouds + Hyperscalers", desc: "Cloud platforms & GPU neoclouds renting AI compute", tickers: ["MSFT","GOOGL","AMZN","META","ORCL","NBIS","IREN","CRWV","APLD","WULF","HUT","CORZ"] },
  { theme: "AI Infra", themeId: "ai", layer: "Power Generation (IPPs)", desc: "Independent power producers feeding datacenter demand", tickers: ["VST","CEG","TLN","NRG","NEE"] },
  { theme: "AI Infra", themeId: "ai", layer: "Grid Equipment + EPC", desc: "Grid build-out & engineering for AI power loads", tickers: ["AGX","DY","EME","GEV","ETN","PWR","MYRG","PRIM"] },
  { theme: "AI Infra", themeId: "ai", layer: "Nuclear / SMR", desc: "Nuclear & small modular reactors for clean baseload", tickers: ["OKLO","SMR","NNE","BWXT","LEU","CEG","UEC"] },
  { theme: "AI Infra", themeId: "ai", layer: "Energy Storage + Fuel Cell", desc: "Grid batteries & fuel cells for backup/peak power", tickers: ["BE","EOSE","PLUG","BLDP","FCEL","FLNC"] },
  { theme: "Software", themeId: "software", layer: "AI Agents + Apps", desc: "Applied-AI software & agentic platforms", tickers: ["PLTR","NOW","CRM","AI","BBAI","SOUN","PATH","IOT"] },
  { theme: "Software", themeId: "software", layer: "Data Platforms", desc: "Cloud data warehouses & analytics infrastructure", tickers: ["SNOW","MDB","DDOG","ESTC","CFLT","TDC"] },
  { theme: "Software", themeId: "software", layer: "Enterprise SaaS", desc: "Large-cap enterprise application software", tickers: ["INTU","ADBE","WDAY","VEEV","HUBS","SAP","IBM"] },
  { theme: "Software", themeId: "software", layer: "DevOps + Observability", desc: "Developer tooling & app/infra monitoring", tickers: ["DDOG","GTLB","TEAM","FROG","PD","ESTC"] },
  { theme: "Software", themeId: "software", layer: "Collab + Productivity", desc: "Workplace collaboration & productivity apps", tickers: ["ASAN","MNDY","ZM","DOCU","BOX","RNG"] },
  { theme: "Software", themeId: "software", layer: "Vertical SaaS", desc: "Industry-specific vertical software", tickers: ["TYL","GWRE","MANH","PCOR","CCC","VERX","TTAN","ALKT"] },
  { theme: "Software", themeId: "software", layer: "CDN + Edge Cloud", desc: "Content delivery & edge compute networks", tickers: ["NET","FSLY","AKAM","DOCN"] },
  { theme: "Cyber", themeId: "cyber", layer: "Platform + Endpoint", desc: "Endpoint, platform & identity security leaders", tickers: ["PANW","CRWD","FTNT","ZS","S","GEN","OKTA","SAIL","OSPN","LAES"] },
  { theme: "Cyber", themeId: "cyber", layer: "Cloud + Network Sec", desc: "Cloud, network & web-application security", tickers: ["ZS","NET","AKAM","CHKP","RDWR","RBRK"] },
  { theme: "Cyber", themeId: "cyber", layer: "Threat Operations", desc: "Vulnerability mgmt, SIEM & threat detection", tickers: ["TENB","QLYS","RPD","VRNS","OSPN","SPSC"] },
  { theme: "Cyber", themeId: "cyber", layer: "Defense Cyber", desc: "Government IT & defense-focused cyber services", tickers: ["BAH","CACI","SAIC","LDOS","KBR","PSN","ICFI"] },
  { theme: "Fintech", themeId: "fintech", layer: "Crypto Infra + Exchanges", desc: "Crypto exchanges, treasuries & infrastructure", tickers: ["COIN","MSTR","HOOD","GLXY","CRCL","BMNR","BLSH"] },
  { theme: "Fintech", themeId: "fintech", layer: "Crypto Miners", desc: "Bitcoin miners & HPC-pivot datacenter plays", tickers: ["MARA","RIOT","CLSK","CIFR","IREN","WULF","HUT","CORZ","BTDR","BITF","HIVE"] },
  { theme: "Fintech", themeId: "fintech", layer: "Bitcoin ETFs", desc: "Spot Bitcoin ETFs", tickers: ["IBIT","FBTC","BITB","BITO","BITW","GBTC","BRRR"] },
  { theme: "Fintech", themeId: "fintech", layer: "Neobanks + Digital", desc: "Digital banks & consumer fintech apps", tickers: ["SOFI","NU","ALLY","HOOD","LC","DAVE","KSPI"] },
  { theme: "Fintech", themeId: "fintech", layer: "Payments", desc: "Card networks & payment processors", tickers: ["V","MA","PYPL","AFRM","FOUR","TOST","PAGS","DLO","XYZ","FLYW"] },
  { theme: "Fintech", themeId: "fintech", layer: "Asset Mgmt + Trading", desc: "Brokers, asset managers & trading platforms", tickers: ["SCHW","BLK","KKR","BX","IBKR","FUTU","TIGR","RJF","MS","GS","EVR","PIPR","LAZ","JEF","MC"] },
  { theme: "Defense", themeId: "defense", layer: "Prime Contractors", desc: "Major defense primes & aerospace OEMs", tickers: ["LMT","RTX","NOC","GD","BA","LHX","HII","TDG","GE","HEI","TXT","TDY","VSEC","MRCY","MOG-A"] },
  { theme: "Defense", themeId: "defense", layer: "Aerospace Aftermarket", desc: "Aircraft parts, MRO & aftermarket", tickers: ["FTAI","HWM","WWD","LOAR","HXL","TDG","HEI"] },
  { theme: "Defense", themeId: "defense", layer: "Drones + EVTOL", desc: "Drones, loitering munitions & eVTOL aircraft", tickers: ["AVAV","KTOS","ONDS","RCAT","UMAC","ACHR","JOBY","EH","EVTL"] },
  { theme: "Defense", themeId: "defense", layer: "Space Defense", desc: "Defense-oriented space & satellite plays", tickers: ["RKLB","ASTS","LUNR","GSAT","IRDM","BKSY","PL","BWXT"] },
  { theme: "Defense", themeId: "defense", layer: "Autonomous + AI Defense", desc: "AI software & autonomy for defense", tickers: ["PLTR","LDOS","BBAI","BAH","CACI","SAIC"] },
  { theme: "Defense", themeId: "defense", layer: "Weapons + Munitions", desc: "Munitions, small arms & tactical weapons", tickers: ["AXON","GD","LHX","RTX","RGR","SWBI"] },
  { theme: "Robotics", themeId: "robotics", layer: "Industrial Automation", desc: "Factory automation & industrial robotics", tickers: ["EMR","ETN","ROK","NDSN","NNDM","SYM"] },
  { theme: "Robotics", themeId: "robotics", layer: "Service + Delivery", desc: "Service, delivery & security robots", tickers: ["SERV","RR","DASH","AUR"] },
  { theme: "Robotics", themeId: "robotics", layer: "Machine Vision + LiDAR", desc: "Machine vision & LiDAR sensing", tickers: ["CGNX","AEVA","OUST","HSAI","LPTH","KOPN","CEVA","AMBA"] },
  { theme: "Robotics", themeId: "robotics", layer: "AV + Self-Driving", desc: "Autonomous-vehicle & robotaxi stack", tickers: ["TSLA","MBLY","AUR","GOOGL","PONY","WRD","NVDA"] },
  { theme: "Robotics", themeId: "robotics", layer: "Medical Robotics", desc: "Surgical & medical robotics", tickers: ["ISRG","SYK","MDT","PRCT","GMED"] },
  { theme: "Robotics", themeId: "robotics", layer: "Warehouse + Logistics", desc: "Warehouse automation & fulfillment robotics", tickers: ["AMZN","SYM","GXO","SERV","ZBRA","HON"] },
  { theme: "EV", themeId: "ev", layer: "Makers", desc: "EV & auto manufacturers", tickers: ["TSLA","RIVN","F","GM","NIO","LI","XPEV","EVGO"] },
  { theme: "EV", themeId: "ev", layer: "Batteries + Cells", desc: "EV battery makers & next-gen cells", tickers: ["ABAT","AMPX","ENVX","QS","SLDP","MVST"] },
  { theme: "EV", themeId: "ev", layer: "Battery Materials", desc: "Lithium & cathode/anode raw materials", tickers: ["ALB","SQM","LAC","MP","NMG"] },
  { theme: "EV", themeId: "ev", layer: "Auto Parts + Suppliers", desc: "EV/auto components & suppliers", tickers: ["APTV","MGA","LEA","WOLF","NVTS","BWA","ALV"] },
  { theme: "Quantum", themeId: "quantum", layer: "Pure-Play Hardware", desc: "Pure-play quantum computing hardware", tickers: ["IONQ","RGTI","QUBT","QBTS","LAES"] },
  { theme: "Quantum", themeId: "quantum", layer: "Mega-Cap Quantum", desc: "Mega-caps with quantum-computing programs", tickers: ["GOOGL","MSFT","AMZN","IBM","NVDA"] },
  { theme: "Quantum", themeId: "quantum", layer: "Enabling Tech", desc: "Photonics & components enabling quantum", tickers: ["COHR","FORM","HON","NOVT","POET"] },
  { theme: "Space", themeId: "space", layer: "Defense Space", desc: "Defense primes' space & satellite work", tickers: ["LMT","NOC","RTX","BA","LHX","BWXT"] },
  { theme: "Space", themeId: "space", layer: "Satellites + Connect", desc: "Satellite comms & direct-to-device connectivity", tickers: ["SPCX","ASTS","GSAT","IRDM","VSAT","BKSY","SATS","GILT","RKLB"] },
  { theme: "Space", themeId: "space", layer: "Lunar + Deep Space", desc: "Lunar landers & deep-space exploration", tickers: ["LUNR","LDOS","LMT","RKLB","RDW","BWXT"] },
  { theme: "Space", themeId: "space", layer: "Space Infrastructure", desc: "Launch, in-space services & space hardware", tickers: ["SPCX","BWXT","RDW","GHM","VVX","KTOS","LUNR"] },
  { theme: "Materials", themeId: "materials", layer: "Rare Earths", desc: "Rare-earth mining & magnet supply chain", tickers: ["MP","USAR","IDR","CRML","NB","UAMY"] },
  { theme: "Materials", themeId: "materials", layer: "Uranium", desc: "Uranium miners & nuclear fuel cycle", tickers: ["CCJ","NXE","UEC","DNN","UUUU","LEU"] },
  { theme: "Materials", themeId: "materials", layer: "Lithium", desc: "Lithium producers", tickers: ["ALB","SQM","LAC","SGML","RIO"] },
  { theme: "Materials", themeId: "materials", layer: "Copper", desc: "Copper miners — electrification demand", tickers: ["FCX","SCCO","TGB","HBM","ERO","BHP"] },
  { theme: "Materials", themeId: "materials", layer: "Steel & Iron", desc: "Steel & iron-ore producers", tickers: ["NUE","STLD","CLF","CMC","RS","TS","VALE","MT"] },
  { theme: "Materials", themeId: "materials", layer: "Specialty Chemicals", desc: "Specialty & diversified chemicals + industrial gases", tickers: ["EMN","CE","AVNT","OLN","LYB","TROX","HUN","MTRN","LIN","APD"] },
  { theme: "Materials", themeId: "materials", layer: "Precious Metals", desc: "Gold, silver & precious-metal miners", tickers: ["NEM","AEM","GOLD","WPM","FNV","AG","HL","EGO","KGC"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Analog", desc: "Analog, power & mixed-signal chips", tickers: ["MPWR","ON","ADI","TXN","NXPI","MCHP","STM","ALGM","AOSL","CRUS","POWI","VSH","SMTC","SITM","SYNA","DIOD"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Compute", desc: "Compute, GPU & processor leaders", tickers: ["NVDA","AMD","ARM","ALAB","MRVL","AVGO","INTC","QCOM","AMBA","LSCC","AIP"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Packaging", desc: "Advanced packaging & test (OSAT)", tickers: ["AMKR","FORM","ONTO","KLIC","COHU","ASX","IMOS"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Glass Substrate", desc: "Glass substrates & advanced-packaging materials", tickers: ["GLW","INTC","AMAT","LRCX","KLAC","CAMT","ONTO","IPGP","COHR"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Foundries", desc: "Chip foundries & contract manufacturing", tickers: ["TSM","GFS","UMC","SKYT","INTC","TSEM","HIMX"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Equipment", desc: "Wafer-fab equipment & semicap", tickers: ["AMAT","LRCX","ASML","KLAC","ACLS","TER","NVMI","MKSI","ENTG","VECO","CAMT","AEHR"] },
  { theme: "Healthcare", themeId: "health", layer: "GLP-1 / Metabolic", desc: "GLP-1 & obesity/metabolic drugmakers", tickers: ["LLY","NVO","AMGN","VKTX","ALT","RVMD","TERN"] },
  { theme: "Healthcare", themeId: "health", layer: "Oncology", desc: "Oncology & cancer therapeutics", tickers: ["TGTX","IBRX","RYTM","REGN","EXEL","LEGN","FTRE","MRNA"] },
  { theme: "Healthcare", themeId: "health", layer: "Genomics / Gene Editing", desc: "Gene editing & genomics", tickers: ["CRSP","NTLA","BEAM","VRTX","RXRX","SDGR","RGEN"] },
  { theme: "Healthcare", themeId: "health", layer: "Diagnostics", desc: "Diagnostics & lab testing", tickers: ["DGX","LH","EXAS","NTRA","GH","ICLR","PSNL"] },
  { theme: "Healthcare", themeId: "health", layer: "Devices", desc: "Medical devices", tickers: ["ISRG","BSX","EW","ABT","MDT","SYK","DXCM","PODD"] },
  { theme: "Healthcare", themeId: "health", layer: "Telemedicine / Health IT", desc: "Telehealth & healthcare IT", tickers: ["TDOC","HIMS","DOCS","OSCR","CLOV"] },
  { theme: "Energy", themeId: "energy", layer: "Oil Majors", desc: "Integrated & large-cap oil producers", tickers: ["XOM","CVX","COP","EOG","OXY","FANG"] },
  { theme: "Energy", themeId: "energy", layer: "Oil Services", desc: "Oilfield services", tickers: ["SLB","HAL","BKR","FTI","NOV","PTEN","LBRT","WTTR"] },
  { theme: "Energy", themeId: "energy", layer: "Natural Gas / LNG", desc: "Natural gas producers & LNG", tickers: ["EQT","AR","RRC","LNG","CQP","AROC","EXE"] },
  { theme: "Energy", themeId: "energy", layer: "Refining", desc: "Refiners", tickers: ["VLO","MPC","PSX","PARR","DK","CVI","DINO"] },
  { theme: "Energy", themeId: "energy", layer: "Solar", desc: "Solar manufacturers & installers", tickers: ["FSLR","ENPH","SEDG","ARRY","NXT","RUN","SHLS"] },
  { theme: "Energy", themeId: "energy", layer: "Wind / Hydrogen", desc: "Wind, hydrogen & fuel cells", tickers: ["BEPC","NEE","PLUG","BE","BLDP","FCEL"] },
  { theme: "Internet", themeId: "internet", layer: "Social Media", desc: "Social media & online platforms", tickers: ["META","SNAP","PINS","RDDT","MTCH"] },
  { theme: "Internet", themeId: "internet", layer: "E-Commerce", desc: "E-commerce marketplaces & online retail", tickers: ["AMZN","SHOP","MELI","SE","ETSY","BABA","JD","PDD","CHWY"] },
  { theme: "Internet", themeId: "internet", layer: "Streaming / Media", desc: "Streaming & digital media", tickers: ["NFLX","DIS","WBD","SPOT","ROKU","FUBO","PSKY"] },
  { theme: "Internet", themeId: "internet", layer: "Gaming", desc: "Video game publishers & platforms", tickers: ["TTWO","EA","RBLX","NTES","U"] },
  { theme: "Internet", themeId: "internet", layer: "Adtech", desc: "Advertising technology", tickers: ["TTD","APP","MGNI","CRTO","PUBM","DV","APPS","ZD"] },
  { theme: "Internet", themeId: "internet", layer: "Sports Betting", desc: "Online sports betting & casinos", tickers: ["DKNG","FLUT","MGM","CZR","PENN","RSI"] },
  // ── Shipping & Maritime ──
  { theme: "Shipping", themeId: "shipping", layer: "Tankers", desc: "Crude & product tanker operators", tickers: ["INSW","FRO","STNG","TNK","TRMD","DHT","NAT","HAFN","ASC","TEN","NGL"] },
  { theme: "Shipping", themeId: "shipping", layer: "Dry Bulk", desc: "Dry-bulk shippers", tickers: ["SBLK","GNK","NMM","BWLP","HSHP","SB"] },
  { theme: "Shipping", themeId: "shipping", layer: "Containers + Mixed", desc: "Container & mixed-fleet shipping", tickers: ["ZIM","MATX","DAC","GSL","CMRE"] },
  // ── Transport & Logistics ──
  { theme: "Transport", themeId: "transport", layer: "Trucking", desc: "Trucking & LTL carriers", tickers: ["XPO","ODFL","SAIA","KNX","TFII","ARCB","CVLG","ULH","HTLD","SNDR"] },
  { theme: "Transport", themeId: "transport", layer: "Rail", desc: "Railroads & rail equipment", tickers: ["WAB","CSX","UNP","NSC","CP","TRN","GBX"] },
  { theme: "Transport", themeId: "transport", layer: "Freight + Logistics", desc: "Parcel, freight & logistics", tickers: ["FDX","UPS","JBHT","LSTR","CHRW","RLGT","ZTO","EXPD"] },
  { theme: "Transport", themeId: "transport", layer: "Airlines", desc: "Passenger airlines", tickers: ["DAL","UAL","LUV","AAL","ALK","ALGT","JBLU","SNCY","LTM","ULCC"] },
  // ── Infrastructure & Construction ──
  { theme: "Infra Build", themeId: "infrabuild", layer: "E&C / Heavy Civil", desc: "Engineering & heavy-civil construction", tickers: ["MTZ","STRL","IESC","ECG","TPC","PRIM","ORN","GLDD","APG","GVA","FLR"] },
  { theme: "Infra Build", themeId: "infrabuild", layer: "Electrical + Fire/Safety", desc: "Electrical, fire & safety products", tickers: ["HUBB","AEIS","ENS","PLPC","ATKR","NVT"] },
  { theme: "Infra Build", themeId: "infrabuild", layer: "Specialty Metals", desc: "Specialty metals & alloys", tickers: ["ATI","CRS","HWM","MLI","AZZ","NWPX","MEC"] },
  { theme: "Infra Build", themeId: "infrabuild", layer: "Waste + Environment", desc: "Waste management & environmental services", tickers: ["WM","RSG","WCN","NVRI","CLH","CECO","ATMU","GFL"] },
  { theme: "Infra Build", themeId: "infrabuild", layer: "Heavy Equipment", desc: "Heavy machinery & equipment", tickers: ["CAT","DE","CMI","TEX","ASTE","PCAR","URI"] },
  // ── Telecom & Connectivity ──
  { theme: "Telecom", themeId: "telecom", layer: "Carriers", desc: "Wireless & wireline carriers", tickers: ["T","VZ","TMUS","AMX","SKM","LUMN","TIGO","VIV","ATEX"] },
  { theme: "Telecom", themeId: "telecom", layer: "Comm Equipment", desc: "Telecom & networking equipment", tickers: ["NOK","ERIC","UI","SATS","VIAV","CALX","ADTN"] },
  { theme: "Telecom", themeId: "telecom", layer: "Towers + Infra", desc: "Cell towers & wireless-infrastructure REITs", tickers: ["AMT","CCI","SBAC","UNIT"] },
  // ── Financials ──
  { theme: "Financials", themeId: "financials", layer: "Mega Banks", desc: "Money-center & mega-cap banks", tickers: ["JPM","BAC","WFC","C","GS","MS","USB","PNC"] },
  { theme: "Financials", themeId: "financials", layer: "Regional Banks", desc: "Regional & mid-cap banks", tickers: ["CFG","KEY","MTB","FITB","RF","HBAN","TFC","ZION","FHN","WAL","EWBC","FNB"] },
  { theme: "Financials", themeId: "financials", layer: "Insurance", desc: "P&C, life & multiline insurers", tickers: ["PGR","ALL","TRV","MET","AIG","CB","AFL","PRU","ACGL","RNR","AJG","SKWD"] },
  { theme: "Financials", themeId: "financials", layer: "Capital Markets + Exchanges", desc: "Exchanges & capital-market infrastructure", tickers: ["ICE","CME","NDAQ","CBOE","MKTX","VIRT","OPY","BGC","PIPR","EVR"] },
  { theme: "Financials", themeId: "financials", layer: "Alt Asset Mgrs + PE", desc: "Alternative asset managers & private equity", tickers: ["BX","KKR","APO","ARES","CG","OWL","BAM","BN"] },
  // ── Consumer ──
  { theme: "Consumer", themeId: "consumer", layer: "Retail", desc: "Big-box, discount & specialty retail", tickers: ["WMT","COST","TGT","FIVE","DG","DLTR","HD","LOW","ULTA","TJX","ROST","BURL","AAPL","SONO"] },
  { theme: "Consumer", themeId: "consumer", layer: "Restaurants + QSR", desc: "Restaurants & quick-service chains", tickers: ["MCD","SBUX","CMG","WING","CAVA","SHAK","DPZ","YUM","QSR","TXRH","EAT","LOCO"] },
  { theme: "Consumer", themeId: "consumer", layer: "Travel + Leisure", desc: "Travel, hotels & cruise lines", tickers: ["BKNG","EXPE","ABNB","MAR","HLT","RCL","CCL","NCLH","VIK","TNL","LIND"] },
  { theme: "Consumer", themeId: "consumer", layer: "Luxury + Apparel", desc: "Apparel, footwear & luxury brands", tickers: ["RL","TPR","PVH","LEVI","VFC","ELA","FIGS","NKE","DECK","ON","CROX"] },
  // ── Biotech (expanded) ──
  { theme: "Healthcare", themeId: "health", layer: "Biotech Leaders", desc: "Large-cap profitable biotech", tickers: ["VRTX","REGN","GILD","BIIB","IONS","ALNY","BMRN","NBIX","UTHR","SRPT"] },
  { theme: "Healthcare", themeId: "health", layer: "Biotech Momentum", desc: "High-momentum clinical-stage biotech", tickers: ["KOD","VTYX","RLMD","CELC","ANRO","TNGX","PRAX","ABVX","MRNA","IONS","SLS","RAPT","QURE","ABSI","CMPS","ATAI"] },
  { theme: "Healthcare", themeId: "health", layer: "Pharma Majors", desc: "Big pharma", tickers: ["LLY","JNJ","MRK","PFE","AZN","GSK","TEVA","ELAN","VTRS"] },
  { theme: "Healthcare", themeId: "health", layer: "Managed Care + Payers", desc: "Health insurers & managed care", tickers: ["UNH","CI","ELV","HUM","CNC","MOH","OSCR"] },
  { theme: "Healthcare", themeId: "health", layer: "CRO + Services", desc: "Clinical research orgs & pharma services", tickers: ["ICLR","CRL","MEDP","IQV","DOCS","VEEV"] },
  // ── Oil & Gas (expanded) ──
  { theme: "Energy", themeId: "energy", layer: "E&P International", desc: "International oil & gas producers", tickers: ["PBR","E","CVE","EQNR","TTE","SU","IMO","YPF","VIST","EC"] },
  { theme: "Energy", themeId: "energy", layer: "Oil Field Equipment", desc: "Drilling rigs & oilfield equipment", tickers: ["FET","VAL","OIS","SEI","PUMP","NESR","TTI","EFXT","RIG","NE","NBR"] },
  { theme: "Energy", themeId: "energy", layer: "Midstream + Pipelines", desc: "Pipelines & midstream energy", tickers: ["ET","EPD","WMB","KMI","OKE","TRGP","MPLX","PAA","AM"] },
  // ── Agriculture + Food ──
  { theme: "Agriculture", themeId: "agriculture", layer: "Ag Commodities + Trade", desc: "Ag commodity processing & trading", tickers: ["ADM","BG","ANDE","AGRO","INGR","DAR"] },
  { theme: "Agriculture", themeId: "agriculture", layer: "Farm Equipment", desc: "Farm machinery & equipment", tickers: ["DE","CAT","AGCO","ASTE","TITN","CNH"] },
  { theme: "Agriculture", themeId: "agriculture", layer: "Fertilizers + Crop", desc: "Fertilizers & crop inputs", tickers: ["MOS","NTR","CF","FMC","CTVA","IPI","UAN"] },
  { theme: "Healthcare", themeId: "health", layer: "Providers + Facilities", desc: "Hospitals, clinics & care facilities", tickers: ["HCA","THC","UHS","ENSG","PACS"] },
  { theme: "Utilities", themeId: "utilities", layer: "Renewables", desc: "Renewable power & clean-energy yield", tickers: ["BEP","CWEN","ORA","HASI"] },
  { theme: "Fintech", themeId: "fintech", layer: "Credit + Lending", desc: "Consumer & mortgage credit platforms", tickers: ["UPST","AFRM","LC","TREE"] },
  { theme: "Agriculture", themeId: "agriculture", layer: "Animal Health + Food Tech", desc: "Animal health & food technology", tickers: ["IDXX","ZTS","BYND"] },
  // ── Industrials ──
  { theme: "Industrials", themeId: "industrials", layer: "Conglomerates", desc: "Diversified industrial conglomerates", tickers: ["HON","MMM","GE","ITW","EMR","DHR","PH","ETN","ROK","IR"] },
  { theme: "Industrials", themeId: "industrials", layer: "Machinery", desc: "Industrial machinery makers", tickers: ["CMI","GNRC","SWK","MIDD","TTC","NDSN","RRX","GRC","THR"] },
  { theme: "Industrials", themeId: "industrials", layer: "Tools + Testing", desc: "Test, measurement & precision tools", tickers: ["KEYS","TDY","GRMN","FTV","A","BR","TER","ONTO"] },
  { theme: "Industrials", themeId: "industrials", layer: "Rental + Leasing", desc: "Equipment rental & leasing", tickers: ["URI","CAR","HTZ","R","WLFC","CTOS","VSTS"] },
  { theme: "Industrials", themeId: "industrials", layer: "Security + Services", desc: "Security products & industrial services", tickers: ["AXON","REZI","MG","NSSC","BCO","ALLE","JCI"] },
];
// layer name → one-line description (curated). Used in the Layer Regime header.
const LAYER_DESC = Object.fromEntries(DRAWER_SUBTHEMES.map((d) => [d.layer, d.desc]).filter(([, v]) => v));

const DRAWER_COLORS = {
  ai:          { bg: "rgba(108,213,232,0.12)", border: "#3a8a9e", color: "#6cd5e8" },
  defense:     { bg: "rgba(251,191,36,0.12)",  border: "#a07a1f", color: "#fbbf24" },
  robotics:    { bg: "rgba(34,211,238,0.12)",  border: "#1a8aa4", color: "#22d3ee" },
  ev:          { bg: "rgba(109,222,142,0.12)", border: "#2c5e3e", color: "#6dde8e" },
  quantum:     { bg: "rgba(184,106,252,0.12)", border: "#5a3e8e", color: "#b86afc" },
  space:       { bg: "rgba(106,158,255,0.12)", border: "#3a5a8a", color: "#6a9eff" },
  software:    { bg: "rgba(167,139,250,0.12)", border: "#5a3e8e", color: "#a78bfa" },
  cyber:       { bg: "rgba(239,68,68,0.12)",   border: "#7e2828", color: "#ef4444" },
  fintech:     { bg: "rgba(251,191,36,0.12)",  border: "#a07a1f", color: "#fbbf24" },
  materials:   { bg: "rgba(163,230,53,0.12)",  border: "#4a6e1a", color: "#a3e635" },
  semis:       { bg: "rgba(251,146,60,0.12)",  border: "#9a4e1a", color: "#fb923c" },
  health:      { bg: "rgba(236,72,153,0.12)",  border: "#7e2860", color: "#ec4899" },
  energy:      { bg: "rgba(250,204,21,0.12)",  border: "#7e6a14", color: "#facc15" },
  internet:    { bg: "rgba(20,184,166,0.12)",  border: "#0d6e62", color: "#14b8a6" },
  shipping:    { bg: "rgba(56,189,248,0.12)",  border: "#1e6a8e", color: "#38bdf8" },
  transport:   { bg: "rgba(148,163,184,0.12)", border: "#4a5568", color: "#94a3b8" },
  infrabuild:  { bg: "rgba(245,158,11,0.12)",  border: "#7e5a0a", color: "#f59e0b" },
  telecom:     { bg: "rgba(129,140,248,0.12)", border: "#4338ca", color: "#818cf8" },
  financials:  { bg: "rgba(52,211,153,0.12)",  border: "#1a6e4e", color: "#34d399" },
  consumer:    { bg: "rgba(244,114,182,0.12)", border: "#8e2860", color: "#f472b6" },
  agriculture: { bg: "rgba(132,204,22,0.12)",  border: "#4a6e14", color: "#84cc16" },
  industrials: { bg: "rgba(209,213,219,0.12)", border: "#4a5568", color: "#d1d5db" },
  realestate:  { bg: "rgba(217,119,87,0.12)",  border: "#8e4a2e", color: "#d97757" },
  utilities:   { bg: "rgba(94,234,212,0.12)",  border: "#2e7e6e", color: "#5eead4" },
};

const CHAIN_ABBR = {
  ai: "AI", software: "SW", cyber: "CY", fintech: "FT",
  defense: "DEF", robotics: "ROB", ev: "EV", quantum: "QTM",
  space: "SPC", materials: "MAT", semis: "SEM",
  health: "HLT", energy: "ENG", internet: "WEB",
  shipping: "SHIP", transport: "TRN", infrabuild: "BLD",
  telecom: "TEL", financials: "FIN", consumer: "CON",
  agriculture: "AGR", industrials: "IND",
  realestate: "RE", utilities: "UTL",
};

// Ticker → array of { themeId, layer } entries (unique layers across all DRAWER_SUBTHEMES)
const TICKER_CHAIN_MAP = (() => {
  const m = new Map();
  DRAWER_SUBTHEMES.forEach(({ themeId, layer, tickers }) => {
    tickers.forEach((t) => {
      if (!m.has(t)) m.set(t, []);
      const arr = m.get(t);
      if (!arr.some((e) => e.themeId === themeId && e.layer === layer)) {
        arr.push({ themeId, layer });
      }
    });
  });
  return m;
})();

// ── Industry → chain/layer fallback for tickers not in any curated chain ──
// Covers every FMP industry in the pipeline universe. Keys must match
// dashboard_data.json `industry` strings exactly.
const INDUSTRY_CHAIN_MAP = {
  "Advertising Agencies": ["internet", "Adtech"],
  "Aerospace & Defense": ["defense", "Aerospace & Defense"],
  "Agricultural - Machinery": ["agriculture", "Farm Equipment"],
  "Agricultural Farm Products": ["agriculture", "Ag Commodities + Trade"],
  "Agricultural Inputs": ["agriculture", "Fertilizers + Crop"],
  "Airlines, Airports & Air Services": ["transport", "Airlines"],
  "Aluminum": ["materials", "Aluminum"],
  "Apparel - Footwear & Accessories": ["consumer", "Luxury + Apparel"],
  "Apparel - Manufacturers": ["consumer", "Luxury + Apparel"],
  "Apparel - Retail": ["consumer", "Luxury + Apparel"],
  "Asset Management": ["financials", "Asset Management"],
  "Asset Management - Global": ["financials", "Asset Management"],
  "Auto - Dealerships": ["consumer", "Autos + Dealers"],
  "Auto - Manufacturers": ["ev", "Makers"],
  "Auto - Parts": ["ev", "Auto Parts + Suppliers"],
  "Auto - Recreational Vehicles": ["consumer", "Autos + Dealers"],
  "Banks": ["financials", "Regional Banks"],
  "Banks - Diversified": ["financials", "Mega Banks"],
  "Banks - Regional": ["financials", "Regional Banks"],
  "Beverages - Alcoholic": ["consumer", "Food + Beverages"],
  "Beverages - Non-Alcoholic": ["consumer", "Food + Beverages"],
  "Beverages - Wineries & Distilleries": ["consumer", "Food + Beverages"],
  "Biotechnology": ["health", "Biotech"],
  "Broadcasting": ["internet", "Streaming / Media"],
  "Business Equipment & Supplies": ["industrials", "Business Products + Services"],
  "Chemicals": ["materials", "Specialty Chemicals"],
  "Chemicals - Specialty": ["materials", "Specialty Chemicals"],
  "Coal": ["energy", "Coal"],
  "Communication Equipment": ["telecom", "Comm Equipment"],
  "Computer Hardware": ["ai", "Compute Hardware"],
  "Conglomerates": ["industrials", "Conglomerates"],
  "Construction": ["infrabuild", "Construction"],
  "Construction Materials": ["infrabuild", "Construction Materials"],
  "Consulting Services": ["industrials", "Business Products + Services"],
  "Consumer Electronics": ["consumer", "Consumer Electronics"],
  "Copper": ["materials", "Copper"],
  "Department Stores": ["consumer", "Retail"],
  "Discount Stores": ["consumer", "Retail"],
  "Diversified Utilities": ["utilities", "Diversified Utilities"],
  "Drug Manufacturers - General": ["health", "Pharma Majors"],
  "Drug Manufacturers - Specialty & Generic": ["health", "Specialty Pharma"],
  "Education & Training Services": ["consumer", "Education"],
  "Electrical Equipment & Parts": ["infrabuild", "Electrical + Fire/Safety"],
  "Electronic Gaming & Multimedia": ["internet", "Gaming"],
  "Engineering & Construction": ["infrabuild", "E&C / Heavy Civil"],
  "Entertainment": ["internet", "Streaming / Media"],
  "Financial - Capital Markets": ["financials", "Capital Markets + Exchanges"],
  "Financial - Conglomerates": ["financials", "Asset Management"],
  "Financial - Credit Services": ["fintech", "Credit + Lending"],
  "Financial - Data & Stock Exchanges": ["financials", "Capital Markets + Exchanges"],
  "Financial - Diversified": ["financials", "Asset Management"],
  "Financial - Mortgages": ["fintech", "Credit + Lending"],
  "Food Confectioners": ["consumer", "Food + Beverages"],
  "Food Distribution": ["consumer", "Food + Beverages"],
  "Furnishings, Fixtures & Appliances": ["consumer", "Home + Furnishings"],
  "Gambling, Resorts & Casinos": ["internet", "Sports Betting"],
  "General Transportation": ["transport", "Freight + Logistics"],
  "Gold": ["materials", "Precious Metals"],
  "Grocery Stores": ["consumer", "Retail"],
  "Hardware, Equipment & Parts": ["ai", "Networking + Components"],
  "Home Improvement": ["consumer", "Retail"],
  "Household & Personal Products": ["consumer", "Staples + Personal Care"],
  "Independent Power Producers": ["ai", "Power Generation (IPPs)"],
  "Industrial - Distribution": ["industrials", "Distribution"],
  "Industrial - Infrastructure Operations": ["infrabuild", "Infrastructure Ops"],
  "Industrial - Machinery": ["industrials", "Machinery"],
  "Industrial - Pollution & Treatment Controls": ["infrabuild", "Waste + Environment"],
  "Industrial Materials": ["materials", "Industrial Materials"],
  "Information Technology Services": ["software", "IT Services"],
  "Insurance - Brokers": ["financials", "Insurance"],
  "Insurance - Diversified": ["financials", "Insurance"],
  "Insurance - Life": ["financials", "Insurance"],
  "Insurance - Property & Casualty": ["financials", "Insurance"],
  "Insurance - Reinsurance": ["financials", "Insurance"],
  "Insurance - Specialty": ["financials", "Insurance"],
  "Integrated Freight & Logistics": ["transport", "Freight + Logistics"],
  "Internet Content & Information": ["internet", "Internet Content"],
  "Investment - Banking & Investment Services": ["fintech", "Asset Mgmt + Trading"],
  "Leisure": ["consumer", "Travel + Leisure"],
  "Luxury Goods": ["consumer", "Luxury + Apparel"],
  "Manufacturing - Metal Fabrication": ["infrabuild", "Specialty Metals"],
  "Manufacturing - Textiles": ["consumer", "Luxury + Apparel"],
  "Manufacturing - Tools & Accessories": ["industrials", "Tools + Testing"],
  "Marine Shipping": ["shipping", "Containers + Mixed"],
  "Medical - Care Facilities": ["health", "Providers + Facilities"],
  "Medical - Devices": ["health", "Devices"],
  "Medical - Diagnostics & Research": ["health", "Diagnostics"],
  "Medical - Distribution": ["health", "Distribution + Supplies"],
  "Medical - Equipment & Services": ["health", "Devices"],
  "Medical - Healthcare Information Services": ["health", "Telemedicine / Health IT"],
  "Medical - Healthcare Plans": ["health", "Managed Care + Payers"],
  "Medical - Instruments & Supplies": ["health", "Devices"],
  "Medical - Pharmaceuticals": ["health", "Pharma Majors"],
  "Oil & Gas Drilling": ["energy", "Oil Field Equipment"],
  "Oil & Gas Energy": ["energy", "Oil Majors"],
  "Oil & Gas Equipment & Services": ["energy", "Oil Services"],
  "Oil & Gas Exploration & Production": ["energy", "E&P"],
  "Oil & Gas Integrated": ["energy", "Oil Majors"],
  "Oil & Gas Midstream": ["energy", "Midstream + Pipelines"],
  "Oil & Gas Refining & Marketing": ["energy", "Refining"],
  "Other Precious Metals": ["materials", "Precious Metals"],
  "Silver": ["materials", "Precious Metals"],
  "Packaged Foods": ["consumer", "Food + Beverages"],
  "Packaging & Containers": ["materials", "Packaging"],
  "Paper, Lumber & Forest Products": ["materials", "Paper + Forest"],
  "Personal Products & Services": ["consumer", "Staples + Personal Care"],
  "Publishing": ["internet", "Streaming / Media"],
  "REIT - Diversified": ["realestate", "Equity REITs"],
  "REIT - Healthcare Facilities": ["realestate", "Equity REITs"],
  "REIT - Hotel & Motel": ["realestate", "Equity REITs"],
  "REIT - Industrial": ["realestate", "Industrial REITs"],
  "REIT - Mortgage": ["realestate", "Mortgage REITs"],
  "REIT - Office": ["realestate", "Equity REITs"],
  "REIT - Residential": ["realestate", "Equity REITs"],
  "REIT - Retail": ["realestate", "Equity REITs"],
  "REIT - Specialty": ["realestate", "Specialty REITs"],
  "Railroads": ["transport", "Rail"],
  "Real Estate - Services": ["realestate", "RE Services"],
  "Regulated Electric": ["utilities", "Electric"],
  "Regulated Gas": ["utilities", "Gas"],
  "Regulated Water": ["utilities", "Water"],
  "Renewable Utilities": ["utilities", "Renewables"],
  "Rental & Leasing Services": ["industrials", "Rental + Leasing"],
  "Residential Construction": ["infrabuild", "Homebuilders"],
  "Restaurants": ["consumer", "Restaurants + QSR"],
  "Security & Protection Services": ["industrials", "Security + Services"],
  "Semiconductors": ["semis", "Semiconductors"],
  "Software - Application": ["software", "Application Software"],
  "Software - Infrastructure": ["software", "Infrastructure Software"],
  "Software - Services": ["software", "IT Services"],
  "Solar": ["energy", "Solar"],
  "Specialty Business Services": ["industrials", "Business Products + Services"],
  "Specialty Retail": ["consumer", "Retail"],
  "Staffing & Employment Services": ["industrials", "Staffing + HR"],
  "Steel": ["materials", "Steel & Iron"],
  "Technology Distributors": ["industrials", "Distribution"],
  "Telecommunications Services": ["telecom", "Carriers"],
  "Tobacco": ["consumer", "Staples + Personal Care"],
  "Travel Lodging": ["consumer", "Travel + Leisure"],
  "Travel Services": ["consumer", "Travel + Leisure"],
  "Trucking": ["transport", "Trucking"],
  "Uranium": ["materials", "Uranium"],
  "Waste Management": ["infrabuild", "Waste + Environment"],
};

// Resolve chains for a ticker: curated map first, industry fallback second.
function chainsForStock(ticker, s) {
  const curated = TICKER_CHAIN_MAP.get(ticker);
  if (curated?.length) return curated;
  const e = s?.industry && INDUSTRY_CHAIN_MAP[s.industry];
  return e ? [{ themeId: e[0], layer: e[1] }] : null;
}

// ──────────────────────────────────────────────────────────────────────────
// Root export
// ──────────────────────────────────────────────────────────────────────────

export default function App() {
  const [themeMode, setThemeMode] = useState(
    () => localStorage.getItem("themepulse-theme") || "dark"
  );
  const toggleTheme = useCallback(() => {
    setThemeMode((m) => {
      const next = m === "dark" ? "light" : "dark";
      localStorage.setItem("themepulse-theme", next);
      return next;
    });
  }, []);
  // Aria-style A-/A+ text size zoom (CSS zoom property, persisted in localStorage)
  const [zoom, setZoom] = useState(() => {
    const z = parseFloat(localStorage.getItem("themepulse-zoom") || "1");
    return Number.isFinite(z) && z >= 0.5 && z <= 2 ? z : 1;
  });
  const changeZoom = useCallback((dir) => {
    setZoom((cur) => {
      let next = Math.round((cur + dir * 0.05) * 100) / 100;
      if (next < 0.5) next = 0.5;
      if (next > 2) next = 2;
      localStorage.setItem("themepulse-zoom", String(next));
      return next;
    });
  }, []);

  const ARIA = themeMode === "light" ? ARIA_LIGHT : ARIA_DARK;
  // Set body bg so the area outside the maxWidth container also flips
  useEffect(() => {
    document.body.style.background = ARIA.bg;
  }, [ARIA.bg]);
  const ctxValue = useMemo(
    () => ({ ARIA, themeMode, toggleTheme, zoom, changeZoom }),
    [ARIA, themeMode, toggleTheme, zoom, changeZoom]
  );
  return (
    <AriaThemeContext.Provider value={ctxValue}>
      <ErrorBoundary>
        <AppMain />
      </ErrorBoundary>
    </AriaThemeContext.Provider>
  );
}
