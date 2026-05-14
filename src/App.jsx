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
  chgMode: "chg",      // "open" or "chg" — which column the gain filter & sort apply to (default chg per user request)
};

const DEFAULT_SORT = { primary: "rvol", secondary: "change" }; // Aria default

// Momentum + gap presets — ported from Aria backend `_handle_preset_scan` in dashboard.py
// Each preset returns true if a stock matches. Filters are applied AFTER the
// global default filters (NoBio, ADR, dvol) so a preset can be combined with them.
const PRESETS = {
  "1w20": {
    label: "1W 20%",
    desc:
      "Stocks up 20%+ in the last week. Price ≥ $5, avg volume ≥ 100K. Catches explosive breakouts early.",
    color: "#0ea5e9",
    test: (s) =>
      (s.return_1w || 0) >= 20 &&
      (s.price || s.close || 0) >= 5 &&
      (s.avg_volume_raw || 0) >= 100_000,
  },
  "1m20": {
    label: "1M 20%",
    desc:
      "Stocks up 20%+ in the last month. Price ≥ $5, avg volume ≥ 100K. Sustained momentum runners.",
    color: "#0ea5e9",
    test: (s) =>
      (s.return_1m || 0) >= 20 &&
      (s.price || s.close || 0) >= 5 &&
      (s.avg_volume_raw || 0) >= 100_000,
  },
  strongest: {
    label: "Strong",
    desc:
      "70%+ above 52W low, EPS or Sales growth ≥ 25%, near moving averages (SMA20 -2% to 18%, SMA50 ≥ -3%).",
    color: "#0ea5e9",
    test: (s) => {
      const aboveLow = s.above_52w_low || 0;
      const eps = s.eps_yoy || 0;
      const sales = s.sales_yoy || 0;
      const sma20 = s.sma20_pct || 0;
      const sma50 = s.sma50_pct || 0;
      return (
        aboveLow >= 70 &&
        (eps >= 25 || sales >= 25) &&
        sma20 >= -2 &&
        sma20 <= 18 &&
        sma50 >= -3
      );
    },
  },
  mom3m: {
    label: "Mom3M",
    desc:
      "Return ≥ 70% over 3 months. MCap ≥ $300M, above 50% from 52W low, SMA20 0–20%, ADR ≥ 3%.",
    color: "#0ea5e9",
    test: (s) => {
      const r = s.return_3m || 0;
      const mc = s.market_cap_raw || 0;
      const aboveLow = s.above_52w_low || 0;
      const sma20 = s.sma20_pct || 0;
      const adr = s.adr_pct || 0;
      return (
        r >= 70 &&
        mc >= 300e6 &&
        aboveLow >= 50 &&
        sma20 >= 0 &&
        sma20 <= 20 &&
        adr >= 3
      );
    },
  },
  mom6m: {
    label: "Mom6M",
    desc:
      "Return ≥ 100% over 6 months. Same base filters as 3M but even more explosive. Multi-bagger candidates.",
    color: "#0ea5e9",
    test: (s) => {
      const r = s.return_6m || 0;
      const mc = s.market_cap_raw || 0;
      const aboveLow = s.above_52w_low || 0;
      const sma20 = s.sma20_pct || 0;
      const adr = s.adr_pct || 0;
      return (
        r >= 100 &&
        mc >= 300e6 &&
        aboveLow >= 50 &&
        sma20 >= 0 &&
        sma20 <= 20 &&
        adr >= 3
      );
    },
  },
  combo: {
    label: "Combo",
    desc:
      "Stocks appearing in 2+ momentum scans (1W, 1M, Strongest, Mom3M, Mom6M). The overlap = highest conviction.",
    color: "#0ea5e9",
    test: (s) => {
      let hits = 0;
      if (PRESETS["1w20"].test(s)) hits++;
      if (PRESETS["1m20"].test(s)) hits++;
      if (PRESETS.strongest.test(s)) hits++;
      if (PRESETS.mom3m.test(s)) hits++;
      if (PRESETS.mom6m.test(s)) hits++;
      return hits >= 2;
    },
  },
  gap4: {
    label: "Gap4%+",
    desc:
      "Gapping up ≥ 4% today with volume > 1.1x average. MCap ≥ $300M, $Vol ≥ $50M. Episodic pivot candidates.",
    color: "#22c55e",
    test: (s) => {
      const chg = s.change_pct || 0;
      const rv = s.rel_volume || 0;
      const mc = s.market_cap_raw || 0;
      const dv = s.avg_dollar_vol_raw || 0;
      return chg >= 4 && rv > 1.1 && mc >= 300e6 && dv >= 50e6;
    },
  },
  stealth: {
    label: "Stealth",
    desc:
      "Stealth accumulation: 20d dollar-volume is climbing much faster than price over the last 90 days. stealth_score ≥ 50 (ADV growth − price growth). Institutions stepping in before the price move — pre-breakout watchlist.",
    color: "#a78bfa",
    test: (s) => {
      const ss = s.stealth_score;
      if (ss == null) return false;
      const dv = s.avg_dollar_vol_raw || 0;
      const mc = s.market_cap_raw || 0;
      // Enforce tradeable liquidity + avoid tiny names where ADV ratios
      // swing wildly on single catalyst days.
      return ss >= 50 && dv >= 20e6 && mc >= 300e6;
    },
  },
  accum_stack: {
    label: "ACCUM Stack",
    desc:
      "ACCUM (20d ADV up ≥ 100% over 90d) crossed with at least one of: insider cluster buying, 3+ consecutive EPS beats, or RS rank ≥ 95. Highest-conviction accumulation setups.",
    color: "#22c55e",
    test: (s) => {
      const advUp = (s.adv_pct_90d || 0) >= 100;
      if (!advUp) return false;
      const insiderCluster = !!s.insider_cluster_buy;
      const beatStreak = (s.positive_surprise_streak || 0) >= 3;
      const topRS = (s.rs_rank || 0) >= 95;
      const dv = s.avg_dollar_vol_raw || 0;
      const mc = s.market_cap_raw || 0;
      return (insiderCluster || beatStreak || topRS) && dv >= 20e6 && mc >= 300e6;
    },
  },
  tightness: {
    label: "Tightness",
    desc:
      "Daily tightness swing setups: float ≤ 50M, flat week (1W < 5%), Qullamaggie VCP score ≥ 5, price above SMA20, ADR ≥ 3.5%, above 52W low by 50%+, MCap ≥ $300M. Low-float stocks coiling for a move.",
    color: "#f59e0b",
    test: (s) => {
      const fl = s.shares_float_raw;
      if (!fl || fl > 50e6) return false;
      const aboveLow = s.above_52w_low || 0;
      const mc = s.market_cap_raw || 0;
      const avgVol = s.avg_volume_raw || 0;
      const r1w = s.return_1w || 0;
      const adr = s.adr_pct || 0;
      const qmag = s.qmag_score || 0;
      const sma20 = s.sma20_pct || 0;
      return (
        aboveLow >= 50 &&
        mc >= 300e6 &&
        avgVol >= 300_000 &&
        r1w < 5 &&
        adr >= 3.5 &&
        qmag >= 5 &&
        sma20 >= 0
      );
    },
  },
};

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
  background: ARIA.bg,
  border: `1px solid ${ARIA.border}`,
  borderRadius: 3,
  color: ARIA.cyan,
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
    fetch("/dashboard_data.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((pipeline) => {
        if (cancelled) return;
        setData({
          loading: false,
          error: pipeline ? null : "Failed to load dashboard_data.json",
          pipeline,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setData({
          loading: false,
          error: "Failed to load dashboard_data.json",
          pipeline: null,
        });
      });
    return () => {
      cancelled = true;
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
function usePicks(intervalMs = 60000) {
  const [picks, setPicks] = useState({
    rvolPicks: null,
    pmPicks: null,
    ahPicks: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchOne(apiUrl, fallbackUrl) {
      try {
        const r = await fetch(apiUrl, { cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          // If KV returned an empty payload, prefer the static fallback
          if (d && d.ok && (d.picks?.length || 0) > 0) return d;
        }
      } catch {
        /* fall through */
      }
      try {
        const r = await fetch(fallbackUrl, { cache: "no-store" });
        if (r.ok) return await r.json();
      } catch {
        /* ignore */
      }
      return null;
    }

    async function loadAll() {
      const [rvolPicks, pmPicks, ahPicks] = await Promise.all([
        fetchOne("/api/agent-picks", "/rvol_picks.json"),
        fetchOne("/api/pm-picks", "/pm_picks.json"),
        fetchOne("/api/ah-picks", "/ah_picks.json"),
      ]);
      if (cancelled) return;
      setPicks({ rvolPicks, pmPicks, ahPicks });
    }

    loadAll();
    const timer = setInterval(loadAll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return picks;
}

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

// Fetches live quotes for a list of tickers via the existing /api/live endpoint.
// Polls every `intervalMs` (default 60s). Returns a Map<ticker, quoteObj>.
function useLiveQuotes(tickers, intervalMs = 60000) {
  const [quotes, setQuotes] = useState(new Map());
  const [updated, setUpdated] = useState(null);

  // Stabilize ticker list so effect doesn't re-fire on every render
  const tickerKey = useMemo(
    () => (tickers || []).slice().sort().join(","),
    [tickers]
  );

  useEffect(() => {
    if (!tickerKey) return;
    let cancelled = false;
    let timer = null;

    async function fetchQuotes() {
      try {
        const r = await fetch(
          `/api/live?universe=${encodeURIComponent(tickerKey)}`
        );
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled) return;
        const m = new Map();
        // /api/live returns { theme_universe: [...] } or { universe: [...] }
        const arr = d.theme_universe || d.universe || [];
        arr.forEach((q) => {
          if (q && q.ticker) m.set(q.ticker, q);
        });
        setQuotes(m);
        setUpdated(new Date());
      } catch {
        /* ignore */
      }
    }

    fetchQuotes();
    timer = setInterval(fetchQuotes, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [tickerKey, intervalMs]);

  return { quotes, updated };
}

// ──────────────────────────────────────────────────────────────────────────
// Market Breadth Bar
// ──────────────────────────────────────────────────────────────────────────

const INDEX_LIST = [
  { ticker: "DIA", name: "DOW" },
  { ticker: "QQQ", name: "QQQ" },
  { ticker: "SPY", name: "S&P 500" },
  { ticker: "IWM", name: "RUSSELL" },
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
    const c =
      chg == null
        ? ARIA.textMuted
        : chg > 0
        ? ARIA.green
        : chg < 0
        ? ARIA.red
        : ARIA.textMuted;
    return (
      <div
        key={idx.ticker}
        onClick={() => onTickerClick && onTickerClick(idx.ticker)}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          cursor: "pointer",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 11, color: ARIA.text }}>
          {idx.name}
        </span>
        <span style={{ color: ARIA.textDim, fontSize: 10 }}>
          {price != null ? price.toFixed(2) : "—"}
        </span>
        <span style={{ fontWeight: 700, color: c, fontSize: 10 }}>
          {chg == null
            ? ""
            : (chg > 0 ? "+" : "") + chg.toFixed(2) + "%"}
        </span>
      </div>
    );
  };

  const miniBar = (label, leftPct, leftCount, rightPct, rightCount) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
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
        gap: 14,
        padding: "6px 14px",
        marginBottom: 8,
        background: ARIA.bgRow,
        borderRadius: 6,
        border: `1px solid ${ARIA.border}`,
        flexWrap: "wrap",
        fontFamily: "monospace",
        fontSize: 11,
      }}
    >
      <span style={{ color: ARIA.textMuted, fontSize: 10 }}>
        {new Date().toISOString().slice(0, 10)}
      </span>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        {INDEX_LIST.map(renderIndex)}
      </div>
      {breadth && (
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginLeft: "auto",
          }}
          title="Breadth of the top-500 (by $vol) universe, live — since previous close. A/D % is relative to advancers+decliners; H/L % to 52W highs+lows."
        >
          {miniBar(
            "A/D",
            breadth.advPct,
            breadth.advCount,
            breadth.decPct,
            breadth.decCount
          )}
          {miniBar(
            "H/L",
            breadth.nhPct,
            breadth.nhCount,
            breadth.nlPct,
            breadth.nlCount
          )}
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
//  - 7 momentum/gap presets: 1W20%, 1M20%, Strong, Mom3M, Mom6M, Combo, Gap4%+
//  - Filter description box (shows preset's explanation when active)
//
// Phase 2.3 will add: short presets (BD/DT/WK/FL/DC), tag filters
// (W/L/E/CS/ZM/QM/9M), and the PM/AH/EP/ETF/QQQ subviews.
// ──────────────────────────────────────────────────────────────────────────

const SORT_BUTTONS = [
  { key: "rs", label: "RS" },
  { key: "change", label: "Chg%" },
  { key: "rvol", label: "RVol" },
  { key: "accel", label: "Acc" },
  { key: "magna", label: "MAG" },
  { key: "qm_bo", label: "BO" },
];

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
    case "accel":
      return r.accel || 0;
    case "magna":
      return r.magna || 0;
    case "qm_bo":
      return r.qmagScore || 0;
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
      "MAGNA — Nitin's Episodic Pivot qualifier. MAGNA score ≥ 60 + EPS YoY ≥ 25% + Sales YoY ≥ 25% + gap ≥ 4%. Composite of Massive accel (M), Gap up (G), Acceleration in sales (A).",
    test: (s) =>
      (s.magna || 0) >= 60 &&
      (s.eps_yoy || 0) >= 25 &&
      (s.sales_yoy || 0) >= 25 &&
      (s.change_pct || 0) >= 4,
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
  const ownedSet = useMemo(
    () => new Set([...portfolio, ...watchlist]),
    [portfolio, watchlist]
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
    v == null ? ARIA.textMuted : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textMuted;
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
          title="Show only tickers already in portfolio or watchlist"
        >
          Only
        </button>
        <button
          onClick={() => setOwnedView("hide")}
          style={pillStyle(ownedView === "hide", ARIA.yellow)}
          title="Hide tickers already in portfolio or watchlist"
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
// Lets ChainHeatView open a specific chain in DrawerThemes without prop drilling.
const _drawerThemeControl = { openChain: null };
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
  // May 5
  "ANET": { status: "beat", date: "May 5", note: "Rev +35% YoY · record backlog · stock -13% on cautious guide" },
  "ALAB": { status: "beat", date: "May 5", note: "Rev +93% YoY · Q2 guide raised to $355-365M · PCIe Gen6 = 33% rev" },
  "AMD":  { status: "beat", date: "May 5", note: "DC rev +57% to $5.8B · MI300X premium ASPs · Q2 +46% YoY" },
  "ETN":  { status: "beat", date: "May 5", note: "DC orders +240% · 228GW backlog (12yr) · 70% AI-related" },
  "CCJ":  { status: "beat", date: "May 5", note: "EPS +30% surprise · U volumes +13% · realized prices rising" },
  "SMCI": { status: "mixed", date: "May 5", note: "EPS beat · Rev -19% QoQ on shortages · $13B backlog" },
  "LITE": { status: "beat", date: "May 5", note: "Record $808M · datacom +90% YoY · demand>supply 25-30%" },
  "KBR":  { status: "beat", date: "May 5", note: "EPC backlog growing — gov AI infra read" },
  "HII":  { status: "beat", date: "May 5", note: "Defense shipbuilding — separate cycle" },
  "SWKS": { status: "mixed", date: "May 5", note: "RF semis — handset cycle weak" },
  // May 6
  "ARM":  { status: "mixed", date: "May 6", note: "Royalty miss $671M vs $697M · AGI CPU launched · stock vol" },
  "COHR": { status: "beat", date: "May 6", note: "Record $1.81B · 1.6T ramp · orders to 2028 · InP-constrained" },
  "FTNT": { status: "beat", date: "May 6", note: "Billings +31% · AI security ops +23% · guide raised" },
  "UUUU": { status: "miss", date: "May 6", note: "EPS -$0.03 · early-stage US uranium production" },
  "UBER": { status: "beat", date: "May 6", note: "Rev +13B · less direct AI infra read" },
  // May 7
  "VST":  { status: "beat", date: "May 7", note: "Record EBITDA $1.49B · Meta PJM nuclear PPAs · IG upgrade" },
  "CRWV": { status: "mixed", date: "May 7", note: "Rev beat $2.08B · $99B backlog · 3.5GW contracted · Q2 light" },
  "NET":  { status: "beat", date: "May 7", note: "Rev +34% · 1100 layoffs for AI pivot · DBNRR 118%" },
  "MP":   { status: "beat", date: "May 7", note: "Triple beat · NdPr +63% YoY · magnet facility groundbreaking" },
  "MCHP": { status: "beat", date: "May 7", note: "Rev +35% YoY · broad recovery · contra-AI-pull positive" },
  "IREN": { status: "miss", date: "May 7", note: "Miss · no AI HPC % disclosed · pivot still narrative" },
  "COIN": { status: "miss", date: "May 7", note: "Rev -31% YoY · crypto pullback · derivatives +169%" },
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
    <div style={{ background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 6, marginBottom: 8, overflow: "hidden" }}>
      <div style={headerStyle} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 10, fontWeight: 800, color: cyan, letterSpacing: 0.8, fontFamily: "monospace" }}>
          ⚡ THEME INTEL
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {data?.saved_at && (
            <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace" }}>
              {new Date(data.saved_at).toLocaleDateString()} {new Date(data.saved_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <span style={{ fontSize: 9, color: ARIA.textMuted }}>{open ? "▲" : "▼"}</span>
        </span>
      </div>

      {open && (
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
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
                <div style={{ padding: "6px 12px", borderBottom: `1px solid ${ARIA.border}`, background: `${cyan}08` }}>
                  <div style={{ fontSize: 8, color: cyan, fontWeight: 700, marginBottom: 2 }}>
                    {a.date} · {a.time_pt}
                  </div>
                  {a.market && (
                    <div style={{ fontSize: 8, color: ARIA.textDim, marginBottom: 2 }}>
                      <span style={{ color: a.market.spy_chg?.startsWith("+") ? ARIA.green : ARIA.red }}>SPY {a.market.spy_chg}</span>
                      {" · "}
                      <span style={{ color: a.market.qqq_chg?.startsWith("+") ? ARIA.green : ARIA.red }}>QQQ {a.market.qqq_chg}</span>
                      {" · "}
                      <span style={{ color: a.market.iwm_chg?.startsWith("+") ? ARIA.green : ARIA.red }}>IWM {a.market.iwm_chg}</span>
                      {" · VIX "}<span style={{ color: ARIA.yellow }}>{a.market.vix}</span>
                    </div>
                  )}
                  <div style={{ fontSize: 7, color: ARIA.textMuted, lineHeight: 1.4 }}>{a.regime}</div>
                </div>

                {/* Active chains */}
                {a.active_chains?.length > 0 && (
                  <div style={{ padding: "6px 12px 4px", borderBottom: `1px solid ${ARIA.border}` }}>
                    <div style={{ fontSize: 7, fontWeight: 700, color: ARIA.textMuted, letterSpacing: 0.5, marginBottom: 5, textTransform: "uppercase" }}>
                      Active Thesis Chains ({a.active_chains.length})
                    </div>
                    {a.active_chains.map((chain, ci) => (
                      <div key={ci} style={{ marginBottom: 8, paddingBottom: 7, borderBottom: ci < a.active_chains.length - 1 ? `1px dashed ${ARIA.border}` : "none" }}>
                        <div style={{ fontSize: 8, fontWeight: 700, color: cyan, lineHeight: 1.3, marginBottom: 2 }}>🔥 {chain.headline}</div>
                        <div style={{ fontSize: 6, color: ARIA.textMuted, marginBottom: 4 }}>{chain.id}</div>
                        {chain.tickers?.map((t, ti) => (
                          <div key={ti} style={{ marginBottom: 5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginBottom: 2 }}>
                              <button
                                onClick={() => onTickerClick?.(t.ticker)}
                                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: ARIA.green, fontWeight: 800, fontSize: 9, fontFamily: "monospace" }}
                              >{t.ticker}</button>
                              <span style={{ fontSize: 7, color: t.score >= 5 ? ARIA.green : ARIA.textDim }}>{t.score}/6</span>
                              <span style={{ fontSize: 7, color: (t.chg >= 0 ? ARIA.green : ARIA.red), fontWeight: 700 }}>{t.chg > 0 ? "+" : ""}{t.chg?.toFixed?.(1) ?? t.chg}%</span>
                              <span style={{ fontSize: 7, color: t.rvol >= 1.5 ? purple : ARIA.textMuted }}>{t.rvol?.toFixed?.(1) ?? t.rvol}x RVol</span>
                              <span style={{ fontSize: 6, padding: "0 4px", borderRadius: 2, background: t.role === "primary" ? `${cyan}20` : `${purple}15`, border: `1px solid ${t.role === "primary" ? cyan + "50" : purple + "40"}`, color: t.role === "primary" ? cyan : purple, textTransform: "uppercase" }}>{t.role}</span>
                              {t.lead_lag && <span style={{ fontSize: 6, color: t.lead_lag === "leading" ? ARIA.green : ARIA.textMuted, textTransform: "uppercase" }}>{t.lead_lag}</span>}
                            </div>
                            {t.layer && <div style={{ fontSize: 7, color: ARIA.textMuted, marginBottom: 2 }}>Layer: {t.layer}</div>}
                            {t.analysis && <div style={{ fontSize: 7, color: ARIA.textDim, lineHeight: 1.45 }}>{t.analysis}</div>}
                          </div>
                        ))}
                        {chain.chain_signal && (
                          <div style={{ fontSize: 7, fontWeight: 700, color: signalColor(chain.chain_signal), marginTop: 2 }}>
                            Signal: {chain.chain_signal}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Non-thesis leaders */}
                {a.non_thesis_leaders?.length > 0 && (
                  <div style={{ padding: "6px 12px 4px", borderBottom: `1px solid ${ARIA.border}` }}>
                    <div style={{ fontSize: 7, fontWeight: 700, color: ARIA.textMuted, letterSpacing: 0.5, marginBottom: 4, textTransform: "uppercase" }}>Non-Thesis Leaders</div>
                    {a.non_thesis_leaders.map((t, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3, flexWrap: "wrap" }}>
                        <button onClick={() => onTickerClick?.(t.ticker)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: ARIA.text, fontWeight: 700, fontSize: 9, fontFamily: "monospace" }}>{t.ticker}</button>
                        <span style={{ fontSize: 7, color: ARIA.green }}>{t.chg > 0 ? "+" : ""}{t.chg?.toFixed?.(1) ?? t.chg}%</span>
                        <span style={{ fontSize: 7, color: ARIA.textMuted }}>{t.rvol?.toFixed?.(1) ?? t.rvol}x RVol</span>
                        <span style={{ fontSize: 7, color: ARIA.textMuted }}>{t.theme}</span>
                        {t.note && <span style={{ fontSize: 7, color: ARIA.textDim, flexBasis: "100%" }}>{t.note}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Dormant chains */}
                {a.dormant_chains?.length > 0 && (
                  <div style={{ padding: "6px 12px 4px", borderBottom: `1px solid ${ARIA.border}` }}>
                    <div style={{ fontSize: 7, fontWeight: 700, color: ARIA.textMuted, letterSpacing: 0.5, marginBottom: 4, textTransform: "uppercase" }}>Dormant Chains ({a.dormant_chains.length})</div>
                    {a.dormant_chains.map((c, i) => (
                      <div key={i} style={{ fontSize: 7, color: ARIA.textMuted, marginBottom: 2 }}>— {c.headline}</div>
                    ))}
                  </div>
                )}

                {/* Synthesis */}
                {a.synthesis && (
                  <div style={{ padding: "7px 12px" }}>
                    <div style={{ fontSize: 7, fontWeight: 700, color: ARIA.textMuted, letterSpacing: 0.5, marginBottom: 4, textTransform: "uppercase" }}>EOD Synthesis</div>
                    <div style={{ fontSize: 8, color: ARIA.textDim, lineHeight: 1.55 }}>{a.synthesis}</div>
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
                <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace" }}>May 5-7 · Q1 2026</span>
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

function EarningsCalendar({ stocks, stockMap, onTickerClick, chartTicker }) {
  const ARIA = useAriaTheme();
  const [expanded, setExpanded] = useState(() => localStorage.getItem("tp-er-cal-open") === "1");
  const [mode, setMode] = useState(() => localStorage.getItem("tp-er-cal-mode") || "drawer");
  const [weekOffset, setWeekOffset] = useState(0);
  const [fmpEvents, setFmpEvents] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { localStorage.setItem("tp-er-cal-open", expanded ? "1" : "0"); }, [expanded]);
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
    <div style={{ borderBottom: `1px solid ${ARIA.border}` }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ padding: "5px 12px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}
      >
        <span style={{ fontSize: 9, color: ARIA.textMuted, transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
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
        <div style={{ padding: "0 12px 8px" }}>
          {loading && <div style={{ fontSize: 8, color: ARIA.textMuted, padding: "4px 0" }}>Loading FMP calendar…</div>}
          {weekData.usingFallback && !loading && <div style={{ fontSize: 7, color: "#fbbf24", padding: "2px 0 4px" }}>Using pipeline data (FMP unavailable). Timing may be stale.</div>}
          {weekData.days.map((day, di) => (
            <div key={di} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: day.isToday ? ARIA.cyan : ARIA.textMuted, fontFamily: "monospace" }}>{day.label}</span>
                <span style={{ fontSize: 7, color: ARIA.textMuted }}>({day.tickers.length})</span>
              </div>
              {day.tickers.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, paddingLeft: 4 }}>
                  {day.tickers.map((t) => {
                    const sel = chartTicker === t.ticker;
                    const badge = timingBadge(t.timing);
                    return (
                      <button
                        key={t.ticker}
                        onClick={() => onTickerClick(t.ticker)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 3,
                          fontSize: 8, padding: "2px 5px", borderRadius: 3, cursor: "pointer",
                          fontFamily: "monospace", fontWeight: sel ? 800 : t.inDrawer ? 700 : 500,
                          background: sel ? ARIA.cyan : t.inDrawer ? "rgba(255,255,255,0.06)" : "transparent",
                          border: `1px solid ${sel ? ARIA.cyan : t.inDrawer ? ARIA.border : "#2a2a3a"}`,
                          color: sel ? ARIA.bg : t.inDrawer ? "#e0e0f0" : ARIA.textMuted,
                        }}
                        title={`${t.ticker}${badge ? ` ${badge.label}` : ""}${t.avgMove ? ` · avg ER move ±${t.avgMove.toFixed(1)}%` : ""}${t.grade ? ` · ${t.grade}` : ""}`}
                      >
                        <img src={ER_LOGO(t.ticker)} alt="" style={{ width: 12, height: 12, borderRadius: 2 }} onError={(e) => { e.target.style.display = "none"; }} />
                        {t.ticker}
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

  // Register openChain so ChainHeatView can expand this drawer without prop drilling.
  useEffect(() => {
    _drawerThemeControl.openChain = (themeId) => { setExpanded(true); setOpenTheme(themeId); };
    return () => { _drawerThemeControl.openChain = null; };
  }, []);

  // Auto-expand or collapse based on whether the ticker is in a value chain.
  // Suppressed when the click originated from within this drawer, or when
  // another component (e.g. SupercycleMap) explicitly opted out.
  useEffect(() => {
    if (!chartTicker) return;
    if (_suppressChainScroll.skip) {
      _suppressChainScroll.skip = false;
      return;
    }
    if (selfClickedTicker.current === chartTicker) {
      selfClickedTicker.current = null;
      return;
    }
    const match = DRAWER_SUBTHEMES.find(s => s.tickers.includes(chartTicker));
    if (match) {
      setExpanded(true);
      setOpenTheme(match.themeId);
      pendingScrollTicker.current = chartTicker;
    } else {
      setOpenTheme(null);
      pendingScrollTicker.current = null;
    }
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
    const vals = tickers.map(tk => stockMap?.[tk]?.rs_rank ?? null).filter(v => v != null);
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
                          {[...layer.tickers].sort((a, b) => (stockMap?.[b]?.rs_rank ?? 0) - (stockMap?.[a]?.rs_rank ?? 0)).map((tk) => {
                            const sel = chartTicker === tk;
                            const tkRs = stockMap?.[tk]?.rs_rank;
                            return (
                              <button
                                key={tk}
                                onClick={() => { selfClickedTicker.current = tk; onTickerClick(tk); }}
                                title={`${tk}${tkRs != null ? ` · RS ${Math.round(tkRs)}` : ""}`}
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
  const ARIA = useAriaTheme();
  const [swView, setSwView] = useState("chain"); // "scan" | "etf" | "watchlist" | "themes" | "subflow" | "leaderboard" | "chain"
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
  const ownedSet = useMemo(
    () => new Set([...portfolio, ...watchlist]),
    [portfolio, watchlist]
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
    () => topCandidates.map((s) => s.ticker),
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

      // Chg>0% filter — applies to either Open or Chg mode
      if (filters.greenOnly) {
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
      // 9M flag: today's vol >= 8.9M shares but avg < 8.9M (unusual institutional).
      // Computed for EVERY row so the badge can render even when the 9M
      // tag filter isn't active. The filter still drops non-matching rows
      // when toggled on.
      const is9m =
        !!(liveVol && liveVol >= 8_900_000 && avgVol < 8_900_000);
      if (want9m && !is9m) continue;

      out.push({
        ticker: s.ticker,
        company: s.company || "",
        price,
        chg,
        chgOpen,
        rvol,
        cr,
        accel: s.accel || 0,
        magna: 0,
        qmagScore: s.qmag_score || 0,
        adr: s.adr_pct || 0,
        rs: s.rs_rank || 0,
        grade: s.grade || "",
        industry: s.industry || "",
        subtheme:
          (s.themes && s.themes[0] && s.themes[0].subtheme) ||
          s.industry ||
          "",
        liveVol: liveVol || 0,
        is9m,
        strScore: tickerStrengthMap?.[s.ticker] ?? null,
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
  }, [topCandidates, liveQuotes, filters, sort, activeTags, activeSubtheme, ownedSet, chainFilters]);

  // ── Render ──────────────────────────────────────────────────────────────
  const colorChg = (v) =>
    v == null ? ARIA.textMuted : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textMuted;

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
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: ARIA.textDim,
          }}
        >
          Scan Watch
        </span>
        <span style={{ fontSize: 8, color: ARIA.textMuted }}>
          ({rows.length})
        </span>
        <div style={{ display: "flex", gap: 2, marginLeft: 6 }}>
          <button onClick={() => setSwView(swView === "etf" ? "scan" : "etf")} style={pillStyle(swView === "etf", ARIA.green)}>ETF</button>
          <button onClick={() => setSwView(swView === "watchlist" ? "scan" : "watchlist")} style={pillStyle(swView === "watchlist", ARIA.green)}>WL</button>
          <button onClick={() => setSwView(swView === "themes" ? "scan" : "themes")} style={pillStyle(swView === "themes", ARIA.green)}>Themes</button>
          <button onClick={() => setSwView(swView === "subflow" ? "scan" : "subflow")} style={pillStyle(swView === "subflow", ARIA.green)}>Subflow</button>
          <button onClick={() => setSwView(swView === "leaderboard" ? "scan" : "leaderboard")} style={pillStyle(swView === "leaderboard", "#fbbf24")}>Rank</button>
          <button onClick={() => setSwView(swView === "chain" ? "scan" : "chain")} style={pillStyle(swView === "chain", "#6cd5e8")}>Chain</button>
        </div>
        <div
          style={{
            marginLeft: "auto",
            fontSize: 8,
            color: ARIA.textMuted,
          }}
        >
          {liveUpdated
            ? `Live · ${liveUpdated.toLocaleTimeString()}`
            : "Loading live quotes…"}
        </div>
      </div>

      {/* ETF Scan view */}
      {swView === "etf" && <ETFScanTable onTickerClick={onTickerClick} />}

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
        {Object.entries(PRESETS).map(([key, p]) => {
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
                border: `1px solid ${p.color}`,
                color: p.color,
                background: on ? `${p.color}26` : "transparent",
              }}
            >
              {p.label}
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

      {/* Tag filter row */}
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
        {Object.entries(TAG_PREDICATES).map(([key, t]) => {
          const on = activeTags.has(key);
          const accent = key === "9M" || key === "33" ? ARIA.yellow : ARIA.green;
          return (
            <button
              key={key}
              onClick={() => toggleTag(key)}
              title={t.desc}
              style={pillStyle(on, accent)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

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

      {/* Toggle/input filter row */}
      <div
        style={{
          padding: "4px 12px",
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          alignItems: "center",
          borderBottom: `1px solid ${ARIA.border}`,
          fontFamily: "monospace",
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
        <span style={{ fontSize: 7, color: ARIA.textMuted, marginLeft: 4 }}>Owned:</span>
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
          title="Show only tickers already in portfolio or watchlist"
        >
          Only
        </button>
        <button
          onClick={() => updateFilter({ ownedView: "hide" })}
          style={pillStyle(filters.ownedView === "hide", ARIA.yellow)}
          title="Hide tickers already in portfolio or watchlist"
        >
          Hide
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
        <span style={{ fontSize: 7, color: ARIA.textMuted }}>RV≥</span>
        <input
          type="range"
          min={0}
          max={30}
          step={1}
          value={filters.minRvol}
          onChange={(e) =>
            updateFilter({ minRvol: parseFloat(e.target.value) })
          }
          style={{ width: 50, accentColor: ARIA.purple, cursor: "pointer" }}
        />
        <span
          style={{
            fontSize: 8,
            color: ARIA.purple,
            minWidth: 22,
          }}
        >
          {filters.minRvol}x
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
  const [mode, setMode] = useState(() => localStorage.getItem("tp-chain-view-mode") || "tickers");
  const containerRef = useRef(null);
  useEffect(() => { localStorage.setItem("tp-chain-view-mode", mode); }, [mode]);
  // Auto-focus the active table so up/down arrows work without a click first
  useEffect(() => {
    const id = setTimeout(() => {
      const focusable = containerRef.current?.querySelector('[tabindex="0"]');
      if (focusable && document.activeElement !== focusable) focusable.focus();
    }, 50);
    return () => clearTimeout(id);
  }, [mode]);
  // Filter: Chg% > 0 — defaults ON. Stored as "1"/"0" in localStorage.
  const [posOnly, setPosOnly] = useState(() => localStorage.getItem("tp-chain-pos-only") !== "0");
  useEffect(() => { localStorage.setItem("tp-chain-pos-only", posOnly ? "1" : "0"); }, [posOnly]);
  const pillStyle = (active) => ({
    fontSize: 8, padding: "2px 7px", borderRadius: 3, cursor: "pointer",
    fontFamily: "monospace", fontWeight: active ? 800 : 600,
    border: `1px solid ${active ? "#6cd5e8" : ARIA.border}`,
    color: active ? "#6cd5e8" : ARIA.textMuted,
    background: active ? "rgba(108,213,232,0.14)" : "transparent",
  });
  const tagStyle = (active) => ({
    fontSize: 8, padding: "2px 7px", borderRadius: 3, cursor: "pointer",
    fontFamily: "monospace", fontWeight: active ? 800 : 600,
    border: `1px solid ${active ? "#10b981" : ARIA.border}`,
    color: active ? "#10b981" : ARIA.textMuted,
    background: active ? "rgba(16,185,129,0.14)" : "transparent",
  });
  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 4, padding: "4px 6px", flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.5, marginRight: 4 }}>VIEW</span>
        <button onClick={() => setMode("layers")} style={pillStyle(mode === "layers")}>Layers</button>
        <button onClick={() => setMode("tickers")} style={pillStyle(mode === "tickers")}>Tickers</button>
        <button onClick={() => setMode("flow")} style={pillStyle(mode === "flow")}>Heat</button>
        <span style={{ color: ARIA.border, margin: "0 4px" }}>|</span>
        <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.5, marginRight: 4 }}>FILTER</span>
        <button onClick={() => setPosOnly(p => !p)} title="Show only Chg% > 0" style={tagStyle(posOnly)}>
          ▲ Chg{'>'}0%
        </button>
        {/* Active chain/layer filter chips */}
        {activeFilterNames?.map((name) => (
          <span key={name} style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.4)", color: "#a855f7" }}>
            {name}
          </span>
        ))}
        {/* Active scan filter chips — read-only indicators */}
        {filters && (() => {
          const chips = [];
          const chip = (label, key) => (
            <span key={key} style={{ fontSize: 7, fontFamily: "monospace", fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.4)", color: "#10b981" }}>{label}</span>
          );
          if (filters.noBio) chips.push(chip("NoBio", "nobio"));
          if (filters.greenOnly) chips.push(chip("Chg>0%", "green"));
          if (filters.minChg > 0) chips.push(chip(`Chg≥${filters.minChg}%`, "minchg"));
          if (filters.minRvol > 0) chips.push(chip(`RV≥${filters.minRvol}x`, "minrv"));
          if (filters.adrMin !== 1 || filters.adrMax !== 15) chips.push(chip(`ADR ${filters.adrMin}–${filters.adrMax}`, "adr"));
          if (filters.minDvolM > 0) chips.push(chip(`$Vol≥${filters.minDvolM}M`, "dvol"));
          if (filters.ownedView !== "all") chips.push(chip(filters.ownedView === "owned" ? "Owned Only" : "Hide Owned", "owned"));
          if (activePresets) [...activePresets].forEach(k => { const p = PRESETS[k]; if (p) chips.push(chip(p.label, `preset-${k}`)); });
          if (activeTags) [...activeTags].forEach(k => { const t = TAG_PREDICATES[k]; if (t) chips.push(chip(t.label, `tag-${k}`)); });
          return chips.length > 0 ? <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap" }}>{chips}</span> : null;
        })()}
        <span style={{ marginLeft: "auto", fontSize: 6, color: ARIA.textMuted, fontFamily: "monospace", letterSpacing: 0.4 }}>↑↓ nav · Enter</span>
      </div>
      {mode === "flow" ? (
        <ChainHeatView
          stockMap={stockMap}
          onLayerClick={onLayerClick}
          onTickerClick={onTickerClick}
          activeFilterNames={activeFilterNames}
        />
      ) : mode === "layers" ? (
        <ChainLayerTable
          stockMap={stockMap}
          tickerStrengthMap={tickerStrengthMap}
          onLayerClick={onLayerClick}
          activeFilterNames={activeFilterNames}
          posOnly={posOnly}
        />
      ) : (
        <ChainTickerTable
          stockMap={stockMap}
          tickerStrengthMap={tickerStrengthMap}
          onTickerClick={onTickerClick}
          chartTicker={chartTicker}
          posOnly={posOnly}
          scanRows={scanRows}
        />
      )}
    </div>
  );
}

// ── useThesisMap: fetches theme_notes.json once (module-level cache) and
// returns a Map<ticker, [{id, headline, type, role, thesis, layers, caveats}]>
let _thesisMapCache = null;
let _thesisMapFetching = false;
const _thesisMapListeners = [];
function useThesisMap() {
  const [map, setMap] = useState(_thesisMapCache);
  useEffect(() => {
    if (_thesisMapCache) { setMap(_thesisMapCache); return; }
    if (_thesisMapFetching) { _thesisMapListeners.push(setMap); return; }
    _thesisMapFetching = true;
    fetch("/data/theme_notes.json")
      .then((r) => r.json())
      .then((d) => {
        const m = new Map();
        for (const note of (d.notes || [])) {
          const add = (tk, role) => {
            const key = tk.toUpperCase();
            const entry = { id: note.id, headline: note.headline, type: note.type || "", role, thesis: note.thesis || "", layers: note.layers || null, caveats: note.caveats || [], primary_tickers: note.primary_tickers || [], derivative_tickers: note.derivative_tickers || [] };
            const arr = m.get(key) || [];
            arr.push(entry);
            m.set(key, arr);
          };
          (note.primary_tickers || []).forEach((tk) => add(tk, "primary"));
          (note.derivative_tickers || []).forEach((tk) => add(tk, "derivative"));
        }
        _thesisMapCache = m;
        _thesisMapFetching = false;
        setMap(m);
        _thesisMapListeners.forEach((fn) => fn(m));
        _thesisMapListeners.length = 0;
      })
      .catch(() => { _thesisMapFetching = false; });
  }, []);
  return map;
}

// ── ChainTickerTable: every ticker that lives in any value chain, with live
// per-ticker metrics (Chg%, RV, RS, Str, CR%, ROC², $Vol, Mcap, ER days).
// Sortable. Click ticker → load chart (no auto value-chain expand/scroll).
function ChainTickerTable({ stockMap, tickerStrengthMap, onTickerClick, chartTicker, posOnly, scanRows }) {
  const ARIA = useAriaTheme();
  const ownedTint = useOwnedTint();
  const thesisMap = useThesisMap();
  const [focusRaw, setFocusRaw] = useState(() => localStorage.getItem("themepulse-focus") || "[]");
  useEffect(() => {
    const onStorage = (e) => { if (e.key === "themepulse-focus") setFocusRaw(e.newValue || "[]"); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const focusTickers = useMemo(() => { try { return new Set(JSON.parse(focusRaw)); } catch { return new Set(); } }, [focusRaw]);
  const wrapRef = useRef(null);
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [thesisPopover, setThesisPopover] = useState(null); // {theses, x, y}
  const popoverRef = useRef(null);
  useEffect(() => {
    if (!thesisPopover) return;
    const onDown = (e) => { if (popoverRef.current && !popoverRef.current.contains(e.target)) setThesisPopover(null); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [thesisPopover]);

  // When scanRows provided, only poll those tickers; else poll all chain tickers.
  const allChainTickers = useMemo(() => {
    const s = new Set();
    DRAWER_SUBTHEMES.forEach((sub) => sub.tickers.forEach((tk) => s.add(tk)));
    return [...s];
  }, []);
  const scanTickers = useMemo(() => scanRows ? scanRows.map((r) => r.ticker) : null, [scanRows]);
  const pollTickers = scanTickers ?? allChainTickers;
  const { quotes: liveQuotes } = useLiveQuotes(pollTickers, 30000);

  const rows = useMemo(() => {
    if (scanRows) {
      // Source from scan results — annotate with chain/layer from TICKER_CHAIN_MAP
      return scanRows.map((sr) => {
        const chains = TICKER_CHAIN_MAP.get(sr.ticker);
        const firstChain = chains?.[0];
        const themeId = firstChain?.themeId ?? null;
        const theme = themeId
          ? (DRAWER_SUBTHEMES.find((s) => s.themeId === themeId)?.theme ?? themeId)
          : null;
        const layers = chains ? [...new Set(chains.map((c) => c.layer))] : [];
        const q = liveQuotes.get(sr.ticker);
        const s = stockMap?.[sr.ticker];
        const chg = q?.change != null ? q.change : sr.chg;
        const liveVol = q?.volume;
        const avgVol = s?.avg_volume_raw || q?.avgVolume || 0;
        let rvol = sr.rvol ?? null;
        if (liveVol && avgVol > 0) rvol = liveVol / avgVol;
        const price = q?.price ?? s?.price ?? s?.close ?? null;
        const r1m = s?.return_1m, r3m = s?.return_3m;
        const roc2 = (r1m != null && r3m != null && !isNaN(r1m) && !isNaN(r3m)) ? r1m - r3m / 3 : null;
        const dvolToday = (price && liveVol) ? price * liveVol : (s?.dollar_vol_raw ?? null);
        const avgDvol = s?.avg_dollar_vol_raw ?? null;
        const dvolRatio = (dvolToday && avgDvol > 0) ? dvolToday / avgDvol : null;
        return {
          ticker: sr.ticker,
          themeId,
          theme,
          layer: layers[0] ?? null,
          layerCount: layers.length,
          chg,
          rvol,
          rs: sr.rs || s?.rs_rank || null,
          str: tickerStrengthMap?.[sr.ticker] ?? null,
          cr: sr.cr ?? computeCR(q, s),
          roc2,
          mcap: s?.market_cap_raw ?? null,
          dvolRatio,
          erDays: s?.earnings_days ?? null,
        };
      });
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
      const price = q?.price ?? s?.price ?? s?.close ?? null;
      const r1m = s?.return_1m, r3m = s?.return_3m;
      const roc2 = (r1m != null && r3m != null && !isNaN(r1m) && !isNaN(r3m)) ? r1m - r3m / 3 : null;
      const dvolToday = (price && liveVol) ? price * liveVol : (s?.dollar_vol_raw ?? null);
      const avgDvol = s?.avg_dollar_vol_raw ?? null;
      const dvolRatio = (dvolToday && avgDvol > 0) ? dvolToday / avgDvol : null;
      return {
        ticker: tk,
        themeId,
        theme,
        layer: layers[0] ?? null,
        layerCount: layers.length,
        chg,
        rvol,
        rs: s?.rs_rank ?? null,
        str: tickerStrengthMap?.[tk] ?? null,
        cr,
        roc2,
        epsYoy: s?.eps_yoy ?? null,
        salesYoy: s?.sales_yoy ?? null,
        dvolRatio,
        erDays: s?.earnings_days ?? null,
      };
    });
  }, [scanRows, allChainTickers, liveQuotes, stockMap, tickerStrengthMap]);

  const [sortKey, setSortKey] = useState("dvolRatio");
  const [sortDir, setSortDir] = useState("desc");
  const sorted = useMemo(() => {
    let arr = rows.slice();
    if (posOnly) arr = arr.filter(r => r.chg != null && r.chg > 0);
    arr.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === "ticker" || sortKey === "theme" || sortKey === "layer") {
        av = (av || "").toString();
        bv = (bv || "").toString();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      av = av == null ? -Infinity : av;
      bv = bv == null ? -Infinity : bv;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortDir, posOnly]);
  const toggleSort = (k) => {
    setSortKey((cur) => {
      if (cur === k) { setSortDir((d) => d === "asc" ? "desc" : "asc"); return cur; }
      setSortDir(k === "ticker" || k === "theme" || k === "layer" ? "asc" : "desc");
      return k;
    });
  };

  const strColor = (v) => v == null ? ARIA.textMuted : v >= 65 ? ARIA.green : v >= 50 ? ARIA.blue : v >= 35 ? ARIA.yellow : ARIA.textDim;
  const crColor = (v) => v == null ? ARIA.textMuted : v >= 70 ? ARIA.green : v >= 40 ? ARIA.textDim : ARIA.red;
  const chgColor = (v) => v == null ? ARIA.textMuted : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textMuted;
  const rvColor = (v) => v == null ? ARIA.textMuted : v >= 1.5 ? ARIA.purple : ARIA.textMuted;
  const fmtMcap = (v) => v == null ? "—" : v >= 1e12 ? (v/1e12).toFixed(1)+"T" : v >= 1e9 ? (v/1e9).toFixed(1)+"B" : v >= 1e6 ? (v/1e6).toFixed(0)+"M" : v.toFixed(0);
  const fmtDvol = (v) => v == null ? "—" : v >= 1e9 ? (v/1e9).toFixed(1)+"B" : v >= 1e6 ? (v/1e6).toFixed(0)+"M" : v.toFixed(0);

  const Th = ({ k, label, align = "right" }) => {
    const on = sortKey === k;
    const arrow = on ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return (
      <th onClick={() => toggleSort(k)}
        style={{
          padding: "3px 5px", fontSize: 7, fontWeight: 700,
          color: on ? ARIA.green : ARIA.textMuted,
          textTransform: "uppercase", letterSpacing: 0.3, textAlign: align,
          borderBottom: `1px solid ${ARIA.border}`, whiteSpace: "nowrap",
          cursor: "pointer", background: ARIA.bgCard, userSelect: "none",
        }}>{label}{arrow}</th>
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
    <div ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown}
         style={{ flex: 1, minHeight: 0, overflow: "auto", outline: "none" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto", fontFamily: "monospace" }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 2, background: ARIA.bgCard }}>
          <tr>
            <Th k="ticker" label="Ticker" align="left" />
            <th style={{ padding: "3px 5px", fontSize: 7, fontWeight: 700, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.3, textAlign: "center", borderBottom: `1px solid ${ARIA.border}`, background: ARIA.bgCard }}>💡</th>
            <Th k="theme" label="Chain" align="left" />
            <Th k="layer" label="Layer" align="left" />
            <Th k="chg" label="Chg%" />
            <Th k="rvol" label="RV" />
            <Th k="rs" label="RS" />
            <Th k="str" label="Str" />
            <Th k="roc2" label="ROC²" />
            <Th k="mcap" label="Mcap" />
            <Th k="cr" label="CR%" />
            <Th k="dvolRatio" label="$Inflow" />
            <Th k="erDays" label="ER" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const c = DRAWER_COLORS[r.themeId] || { color: ARIA.textDim, bg: "transparent", border: ARIA.border };
            const sel = chartTicker === r.ticker;
            const kbSel = selectedTicker === r.ticker;
            const tint = ownedTint(r.ticker, ARIA);
            const isFocus = focusTickers.has(r.ticker);
            const baseBg = isFocus ? "rgba(251,191,36,0.07)" : tint;
            return (
              <tr
                key={r.ticker}
                data-ticker={r.ticker}
                onClick={() => { setSelectedTicker(r.ticker); suppressChainScrollOnce(); onTickerClick && onTickerClick(r.ticker); wrapRef.current?.focus(); }}
                style={{ cursor: "pointer", background: sel ? `${c.color}26` : kbSel ? "rgba(255,255,255,0.06)" : baseBg, outline: kbSel && !sel ? `1px solid ${ARIA.border}` : "none", outlineOffset: -1 }}
                onMouseEnter={(e) => { if (!sel && !kbSel) e.currentTarget.style.background = isFocus ? "rgba(251,191,36,0.12)" : ARIA.bgHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = sel ? `${c.color}26` : kbSel ? "rgba(255,255,255,0.06)" : baseBg; }}
                title={`${r.ticker} — ${r.theme} → ${r.layer}${r.layerCount > 1 ? ` (+${r.layerCount-1} more)` : ""}`}
              >
                <td style={{ ...cell, textAlign: "left", color: sel ? c.color : isFocus ? "#fbbf24" : ARIA.text, fontWeight: sel || isFocus ? 800 : 700, borderLeft: isFocus ? "2px solid #fbbf24" : "2px solid transparent" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <img src={ER_LOGO(r.ticker)} alt="" style={{ width: 11, height: 11, borderRadius: 2 }} onError={(e) => { e.target.style.display = "none"; }} />
                    {r.ticker}
                  </span>
                </td>
                <td style={{ ...cell, textAlign: "center", padding: "2px 4px" }}
                    onClick={(e) => e.stopPropagation()}>
                  {(() => {
                    const theses = thesisMap?.get(r.ticker);
                    if (!theses?.length) return <span style={{ color: ARIA.textMuted, fontSize: 8 }}>—</span>;
                    const hasPrimary = theses.some((t) => t.role === "primary");
                    return (
                      <button
                        title={`${theses.length} thesis note${theses.length > 1 ? "s" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setThesisPopover((prev) => prev?.ticker === r.ticker ? null : { ticker: r.ticker, theses, x: rect.left, y: rect.bottom + 6 });
                        }}
                        style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: hasPrimary ? 12 : 10, padding: 0, lineHeight: 1, opacity: hasPrimary ? 1 : 0.55, filter: hasPrimary ? "none" : "grayscale(0.4)" }}
                      >💡</button>
                    );
                  })()}
                </td>
                <td style={{ ...cell, textAlign: "left" }}>
                  {r.themeId ? (
                    <span style={{
                      fontSize: 7, fontWeight: 700, color: c.color,
                      background: c.bg, border: `1px solid ${c.border}`,
                      padding: "0 4px", borderRadius: 2,
                    }}>{(CHAIN_ABBR[r.themeId] || r.themeId).toUpperCase()}</span>
                  ) : <span style={{ color: ARIA.textMuted, fontSize: 7 }}>—</span>}
                </td>
                <td style={{ ...cell, textAlign: "left", color: ARIA.textDim, fontSize: 8 }}>
                  {r.layer ?? <span style={{ color: ARIA.textMuted }}>—</span>}
                  {r.layer && r.layerCount > 1 ? <span style={{ color: ARIA.textMuted }}> +{r.layerCount-1}</span> : null}
                </td>
                <td style={{ ...cell, color: chgColor(r.chg), fontWeight: 700 }}>
                  {r.chg != null ? (r.chg > 0 ? "+" : "") + r.chg.toFixed(1) + "%" : "—"}
                </td>
                <td style={{ ...cell, color: rvColor(r.rvol), fontWeight: 700 }}>
                  {r.rvol != null ? r.rvol.toFixed(1) + "x" : "—"}
                </td>
                <td style={{ ...cell, color: r.rs != null && r.rs >= 80 ? ARIA.green : r.rs != null && r.rs >= 60 ? ARIA.blue : ARIA.textMuted, fontWeight: 700 }}>
                  {r.rs != null ? Math.round(r.rs) : "—"}
                </td>
                <td style={{ ...cell, color: strColor(r.str), fontWeight: 700 }}>
                  {r.str != null ? Math.round(r.str) : "—"}
                </td>
                <td style={{ ...cell, color: chgColor(r.roc2), fontWeight: 700 }}
                    title="ROC² (Druckenmiller acceleration): 1M return − (3M return ÷ 3)">
                  {r.roc2 != null ? (r.roc2 > 0 ? "+" : "") + r.roc2.toFixed(1) : "—"}
                </td>
                <td style={{ ...cell, color: ARIA.textDim }}>{fmtMcap(r.mcap)}</td>
                <td style={{ ...cell, color: crColor(r.cr) }}>
                  {r.cr != null ? Math.round(r.cr) + "%" : "—"}
                </td>
                <td style={{ ...cell, color: r.dvolRatio != null && r.dvolRatio >= 2 ? ARIA.green : r.dvolRatio != null && r.dvolRatio >= 1 ? ARIA.textDim : ARIA.textMuted, fontWeight: r.dvolRatio != null && r.dvolRatio >= 2 ? 700 : 400 }}
                    title="$Vol Inflow: today's dollar volume ÷ 30-day avg dollar volume">
                  {r.dvolRatio != null ? r.dvolRatio.toFixed(1) + "x" : "—"}
                </td>
                <td style={{ ...cell, color: r.erDays != null && r.erDays >= 0 && r.erDays <= 7 ? ARIA.yellow : ARIA.textMuted, fontWeight: r.erDays != null && r.erDays >= 0 && r.erDays <= 7 ? 700 : 400 }}>
                  {r.erDays != null ? (r.erDays >= 0 ? `${r.erDays}d` : `${-r.erDays}d ago`) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Thesis popover */}
      {thesisPopover && (() => {
        const vpW = window.innerWidth, vpH = window.innerHeight;
        const popW = 340, popMaxH = 420;
        const rawX = thesisPopover.x, rawY = thesisPopover.y;
        const x = Math.min(rawX, vpW - popW - 12);
        const y = rawY + popMaxH > vpH ? Math.max(8, rawY - popMaxH - 10) : rawY;
        return (
          <div ref={popoverRef} style={{
            position: "fixed", left: x, top: y, width: popW, maxHeight: popMaxH,
            background: "#1a1a28", border: "1px solid rgba(168,85,247,0.4)",
            borderRadius: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
            zIndex: 9999, overflow: "auto", fontFamily: "monospace",
          }}>
            <div style={{ padding: "7px 10px 5px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: "#a855f7", letterSpacing: 0.4 }}>{thesisPopover.ticker} · THESIS INTEL</span>
              <button onClick={() => setThesisPopover(null)} style={{ background: "transparent", border: "none", color: "#666", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            {thesisPopover.theses.map((t, i) => (
              <div key={t.id} style={{ padding: "8px 10px", borderBottom: i < thesisPopover.theses.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 7, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: t.role === "primary" ? "rgba(168,85,247,0.2)" : "rgba(100,100,140,0.2)", border: `1px solid ${t.role === "primary" ? "rgba(168,85,247,0.5)" : "rgba(100,100,140,0.4)"}`, color: t.role === "primary" ? "#a855f7" : "#8888aa", textTransform: "uppercase" }}>{t.role}</span>
                  {t.type && <span style={{ fontSize: 7, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", color: "#22d3ee", textTransform: "uppercase" }}>{t.type.replace(/_/g, " ")}</span>}
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4, marginBottom: 6 }}>{t.headline}</div>
                {t.thesis && <div style={{ fontSize: 8, color: "#94a3b8", lineHeight: 1.5, marginBottom: 5 }}>{t.thesis.length > 420 ? t.thesis.slice(0, 417) + "…" : t.thesis}</div>}
                {t.layers && (
                  <div style={{ marginBottom: 4 }}>
                    {Object.values(t.layers).map((layer) => (
                      <div key={layer.label} style={{ marginBottom: 3 }}>
                        <span style={{ fontSize: 7, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{layer.label} </span>
                        <span style={{ fontSize: 7, color: "#475569" }}>— {(layer.tickers || []).join(", ")}</span>
                      </div>
                    ))}
                  </div>
                )}
                {t.primary_tickers?.length > 0 && <div style={{ fontSize: 7, color: "#64748b" }}>Primary: {t.primary_tickers.join(", ")}</div>}
                {t.derivative_tickers?.length > 0 && <div style={{ fontSize: 7, color: "#475569" }}>Derivatives: {t.derivative_tickers.join(", ")}</div>}
                <div style={{ fontSize: 6, color: "#334155", marginTop: 4, letterSpacing: 0.3 }}>{t.id}</div>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ── ChainLayerTable: every value-chain sub-layer with live aggregates,
// sortable. Replaces the iframe view in ScanWatch's "Chain" sub-tab.
// ── Shared hook: computes per-layer aggregates used by ChainLayerTable and
// ChainFlowMap. Centralises useLiveQuotes so both views share one poll cycle.
function useChainLayerRows(stockMap, tickerStrengthMap) {
  const allTickers = useMemo(() => {
    const s = new Set();
    DRAWER_SUBTHEMES.forEach((sub) => sub.tickers.forEach((tk) => s.add(tk)));
    return [...s];
  }, []);
  const { quotes: liveQuotes } = useLiveQuotes(allTickers, 30000);
  return useMemo(() => {
    return DRAWER_SUBTHEMES.map((sub) => {
      const chgs = [], rvols = [], strs = [], crs = [], rocs = [];
      sub.tickers.forEach((tk) => {
        const q = liveQuotes.get(tk);
        const s = stockMap?.[tk];
        const chg = q?.change != null ? q.change : (s?.change_pct ?? null);
        if (chg != null && !isNaN(chg)) chgs.push(chg);
        const liveVol = q?.volume;
        const avgVol = s?.avg_volume_raw || q?.avgVolume || 0;
        let rvol = null;
        if (liveVol && avgVol > 0) rvol = liveVol / avgVol;
        else if (s?.rel_volume != null && s.rel_volume > 0) rvol = s.rel_volume;
        if (rvol != null) rvols.push(rvol);
        const str = tickerStrengthMap?.[tk];
        if (str != null && !isNaN(str)) strs.push(str);
        const cr = computeCR(q, s);
        if (cr != null) crs.push(cr);
        const r1m = s?.return_1m, r3m = s?.return_3m;
        if (r1m != null && r3m != null && !isNaN(r1m) && !isNaN(r3m)) rocs.push(r1m - r3m / 3);
      });
      const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
      return {
        themeId: sub.themeId, theme: sub.theme, layer: sub.layer,
        tickers: sub.tickers, nTickers: sub.tickers.length,
        avgChg: avg(chgs), avgRvol: avg(rvols), avgStr: avg(strs),
        avgCr: avg(crs), avgRoc2: avg(rocs),
      };
    });
  }, [liveQuotes, stockMap, tickerStrengthMap]);
}

// ── ChainFlowMap: horizontal lanes showing which layer within each value
// chain is absorbing money. Each chip = one layer, colored by the chosen
// signal (Str / Chg% / RV / ROC²). Click a chip → filter ScanWatch.
// ── ChainHeatView: hot layers ranked by RVol×Chg% with driving tickers inline.
// Replaces the need to cross-reference Flow + Tickers views separately.
function ChainHeatView({ stockMap, onLayerClick, onTickerClick, activeFilterNames }) {
  const ARIA = useAriaTheme();
  const [expandedSet, setExpandedSet] = useState(() => {
    try {
      const raw = localStorage.getItem("tp-chain-heat-expanded");
      if (raw === null) return "all";
      if (raw === "__all__") return "all";
      if (raw === "__none__") return new Set();
      return new Set(JSON.parse(raw));
    } catch { return "all"; }
  });
  const persistExpanded = (v) => {
    try {
      if (v === "all") localStorage.setItem("tp-chain-heat-expanded", "__all__");
      else if (v.size === 0) localStorage.setItem("tp-chain-heat-expanded", "__none__");
      else localStorage.setItem("tp-chain-heat-expanded", JSON.stringify([...v]));
    } catch {}
  };
  const isExpanded = (key) => expandedSet === "all" || expandedSet.has(key);
  const allCollapsed = expandedSet !== "all" && expandedSet.size === 0;
  const toggleOne = (key) => setExpandedSet((prev) => {
    let next;
    if (prev === "all") { next = new Set(layers.map((r) => `${r.themeId}-${r.layer}`)); next.delete(key); }
    else if (prev.has(key)) { next = new Set(prev); next.delete(key); }
    else { next = new Set(prev); next.add(key); }
    persistExpanded(next);
    return next;
  });
  const toggleAll = () => setExpandedSet((prev) => {
    const next = (prev === "all" || (prev instanceof Set && prev.size > 0)) ? new Set() : "all";
    persistExpanded(next);
    return next;
  });
  const [sortBy, setSortBy] = useState(() => {
    try { return localStorage.getItem("tp-chain-heat-sort") || "heat"; } catch { return "heat"; }
  });
  const cycleSortBy = (key) => setSortBy((prev) => { const v = prev === key ? "heat" : key; try { localStorage.setItem("tp-chain-heat-sort", v); } catch {} return v; });

  const allTickers = useMemo(() => {
    const s = new Set();
    DRAWER_SUBTHEMES.forEach((sub) => sub.tickers.forEach((tk) => s.add(tk)));
    return [...s];
  }, []);
  const { quotes: liveQuotes } = useLiveQuotes(allTickers, 30000);

  // Per-ticker metrics
  const tkMx = useMemo(() => {
    const m = {};
    allTickers.forEach((tk) => {
      const q = liveQuotes.get(tk);
      const s = stockMap?.[tk];
      const chg = q?.change != null ? q.change : (s?.change_pct ?? null);
      const liveVol = q?.volume;
      const avgVol = s?.avg_volume_raw || q?.avgVolume || 0;
      let rvol = null;
      if (liveVol && avgVol > 0) rvol = liveVol / avgVol;
      else if (s?.rel_volume != null && s.rel_volume > 0) rvol = s.rel_volume;
      const cr = computeCR(q, s);
      const price = q?.price ?? s?.price ?? s?.close ?? null;
      const dvolToday = (price && liveVol) ? price * liveVol : (s?.dollar_vol_raw ?? null);
      const avgDvol = s?.avg_dollar_vol_raw ?? null;
      const dvolRatio = (dvolToday && avgDvol > 0) ? dvolToday / avgDvol : null;
      m[tk] = { chg, rvol, cr, dvolRatio };
    });
    return m;
  }, [allTickers, liveQuotes, stockMap]);

  // Layer rows: aggregate heat + top tickers sorted by RVol.
  // Heat = RVol × Chg% (positive only). Falls back to RVol-only sort when
  // everything is negative (down day) so the view is always useful.
  const builtLayers = useMemo(() => {
    return DRAWER_SUBTHEMES.map((sub) => {
      const chgs = [], rvols = [], crs = [], dvols = [];
      const tickerRows = sub.tickers.map((tk) => {
        const { chg, rvol, cr, dvolRatio } = tkMx[tk] || {};
        if (chg != null && !isNaN(chg)) chgs.push(chg);
        if (rvol != null) rvols.push(rvol);
        if (cr != null) crs.push(cr);
        if (dvolRatio != null) dvols.push(dvolRatio);
        return { ticker: tk, chg, rvol };
      })
        .filter((t) => t.rvol != null || t.chg != null)
        .sort((a, b) => (b.rvol ?? 0) - (a.rvol ?? 0));
      const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
      const avgChg = avg(chgs);
      const avgRvol = avg(rvols);
      const avgCr = avg(crs);
      const avgDvol = avg(dvols);
      const heat = (avgRvol ?? 0) * Math.max(avgChg ?? 0, 0);
      return { themeId: sub.themeId, theme: sub.theme, layer: sub.layer, tickers: sub.tickers, avgChg, avgRvol, avgCr, avgDvol, heat, tickerRows };
    }).filter((r) => r.avgRvol != null);
  }, [tkMx]);

  const layers = useMemo(() => {
    const rows = [...builtLayers];
    if (sortBy === "chg") return rows.sort((a, b) => (b.avgChg ?? -999) - (a.avgChg ?? -999));
    if (sortBy === "rvol") return rows.sort((a, b) => (b.avgRvol ?? 0) - (a.avgRvol ?? 0));
    if (sortBy === "cr") return rows.sort((a, b) => (b.avgCr ?? -1) - (a.avgCr ?? -1));
    if (sortBy === "dvol") return rows.sort((a, b) => (b.avgDvol ?? 0) - (a.avgDvol ?? 0));
    const anyHot = rows.some((r) => r.heat > 0);
    return anyHot
      ? rows.filter((r) => r.heat > 0).sort((a, b) => b.heat - a.heat)
      : rows.sort((a, b) => (b.avgRvol ?? 0) - (a.avgRvol ?? 0));
  }, [builtLayers, sortBy]);

  const allDown = layers.length > 0 && layers.every((r) => r.heat === 0);

  const chgColor = (v) => v == null ? ARIA.textMuted : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textMuted;
  const rvColor  = (v) => v == null ? ARIA.textMuted : v >= 2 ? ARIA.purple : v >= 1.5 ? ARIA.purple : ARIA.textDim;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 6px" }}>
      {layers.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "0 2px 4px" }}>
          <span style={{ fontSize: 7, color: ARIA.textMuted, fontFamily: "monospace", fontWeight: 700, letterSpacing: 0.4 }}>SORT</span>
          {[["heat", "Heat"], ["chg", "Chg%"], ["rvol", "RVol"], ["cr", "CR%"], ["dvol", "$Inflow"]].map(([key, label]) => (
            <button key={key} onClick={() => cycleSortBy(key)} style={{
              background: sortBy === key ? "rgba(108,213,232,0.14)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${sortBy === key ? "#6cd5e8" : ARIA.border}`,
              borderRadius: 3, padding: "1px 6px", cursor: "pointer",
              fontSize: 7, fontFamily: "monospace", fontWeight: sortBy === key ? 800 : 600,
              color: sortBy === key ? "#6cd5e8" : ARIA.textDim, letterSpacing: 0.3,
            }}>{label}</button>
          ))}
          <span style={{ flex: 1 }} />
          <button
            onClick={toggleAll}
            style={{
              background: "rgba(255,255,255,0.06)", border: `1px solid ${ARIA.border}`,
              borderRadius: 3, padding: "1px 7px", cursor: "pointer",
              fontSize: 7, fontFamily: "monospace", fontWeight: 700,
              color: ARIA.textDim, letterSpacing: 0.3,
            }}
          >{allCollapsed ? "▸ Expand All" : "▾ Collapse All"}</button>
        </div>
      )}
      {layers.length === 0 && (
        <div style={{ color: ARIA.textMuted, fontSize: 9, fontFamily: "monospace", padding: "8px 4px" }}>
          Waiting for live quotes…
        </div>
      )}
      {allDown && (
        <div style={{ color: ARIA.yellow, fontSize: 8, fontFamily: "monospace", padding: "2px 4px 6px", letterSpacing: 0.3 }}>
          ↓ all chains negative — sorted by RVol
        </div>
      )}
      {layers.map((r) => {
        const c = DRAWER_COLORS[r.themeId] || { color: ARIA.textDim, bg: "transparent", border: ARIA.border };
        const isActive = activeFilterNames?.includes(r.layer);
        const rowKey = `${r.themeId}-${r.layer}`;
        const open = isExpanded(rowKey);
        return (
          <div key={rowKey} style={{ marginBottom: open ? 7 : 2 }}>
            {/* Layer header — click to expand/collapse, shift+click to filter scan */}
            <div
              onClick={(e) => { if (e.shiftKey) { onLayerClick && onLayerClick(r.layer, r.tickers); } else { toggleOne(rowKey); } }}
              title={`click to expand/collapse · shift+click to filter scan`}
              style={{
                display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
                padding: "3px 5px", borderRadius: 3, marginBottom: open ? 3 : 0,
                background: isActive ? `${c.color}26` : "rgba(255,255,255,0.03)",
                border: `1px solid ${isActive ? c.color : ARIA.border}`,
              }}
            >
              <span style={{ fontSize: 7, color: ARIA.textMuted, flexShrink: 0, width: 6, textAlign: "center" }}>{open ? "▾" : "▸"}</span>
              <span style={{
                fontSize: 7, fontWeight: 800, fontFamily: "monospace", flexShrink: 0,
                color: c.color, background: c.bg, border: `1px solid ${c.border}`,
                borderRadius: 2, padding: "0 4px",
              }}>{(CHAIN_ABBR[r.themeId] || r.themeId).toUpperCase()}</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: isActive ? c.color : ARIA.text, fontFamily: "monospace", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.layer}
              </span>
              {(() => {
                const mChg = <span key="chg" style={{ fontSize: 8, color: chgColor(r.avgChg), fontFamily: "monospace", fontWeight: 700, flexShrink: 0 }}>{r.avgChg != null ? (r.avgChg > 0 ? "+" : "") + r.avgChg.toFixed(1) + "%" : "—"}</span>;
                const mRv = <span key="rv" style={{ fontSize: 8, color: rvColor(r.avgRvol), fontFamily: "monospace", fontWeight: 700, flexShrink: 0 }}>{r.avgRvol != null ? r.avgRvol.toFixed(1) + "x" : "—"}</span>;
                const crCol = r.avgCr != null && r.avgCr >= 70 ? ARIA.green : r.avgCr != null && r.avgCr <= 30 ? ARIA.red : ARIA.textDim;
                const mCr = <span key="cr" style={{ fontSize: 8, color: crCol, fontFamily: "monospace", fontWeight: 700, flexShrink: 0 }}>{r.avgCr != null ? Math.round(r.avgCr) + "%" : "—"}</span>;
                const dvCol = r.avgDvol != null && r.avgDvol >= 2 ? ARIA.purple : ARIA.textDim;
                const mDv = <span key="dv" style={{ fontSize: 8, color: dvCol, fontFamily: "monospace", fontWeight: 700, flexShrink: 0 }}>{r.avgDvol != null ? r.avgDvol.toFixed(1) + "x" : "—"}</span>;
                const metrics = sortBy === "cr" ? [mChg, mRv, mCr]
                  : sortBy === "dvol" ? [mChg, mRv, mDv]
                  : [mChg, mRv];
                return <span style={{ display: "inline-flex", gap: 5, flexShrink: 0 }}>{metrics}</span>;
              })()}
            </div>
            {/* Top tickers sorted by RVol — click to load chart */}
            {open && <div style={{ display: "flex", flexWrap: "wrap", gap: 3, paddingLeft: 6 }}>
              {r.tickerRows.slice(0, 7).map(({ ticker, chg, rvol }) => (
                <button
                  key={ticker}
                  onClick={() => { suppressChainScrollOnce(); onTickerClick && onTickerClick(ticker); }}
                  style={{
                    background: "rgba(255,255,255,0.05)", border: `1px solid ${ARIA.border}`,
                    borderRadius: 3, padding: "2px 6px", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 4,
                  }}
                >
                  <img src={`https://financialmodelingprep.com/image-stock/${ticker}.png`} alt=""
                    style={{ width: 11, height: 11, borderRadius: 2 }}
                    onError={(e) => { e.target.style.display = "none"; }} />
                  <span style={{ fontSize: 8, fontWeight: 800, fontFamily: "monospace", color: ARIA.text }}>{ticker}</span>
                  <span style={{ fontSize: 8, fontFamily: "monospace", color: chgColor(chg), fontWeight: 700 }}>
                    {chg != null ? (chg > 0 ? "+" : "") + chg.toFixed(1) + "%" : "—"}
                  </span>
                  {rvol != null && rvol >= 1.5 && (
                    <span style={{ fontSize: 7, fontFamily: "monospace", color: rvColor(rvol) }}>
                      {rvol.toFixed(1)}x
                    </span>
                  )}
                </button>
              ))}
            </div>}
          </div>
        );
      })}
    </div>
  );
}

function ChainLayerTable({ stockMap, tickerStrengthMap, onLayerClick, onTickerClick, activeFilterNames, posOnly }) {
  const ARIA = useAriaTheme();
  const rows = useChainLayerRows(stockMap, tickerStrengthMap);

  const [sortKey, setSortKey] = useState("avgStr");
  const [sortDir, setSortDir] = useState("desc");
  const sorted = useMemo(() => {
    let arr = rows.slice();
    if (posOnly) arr = arr.filter(r => r.avgChg != null && r.avgChg > 0);
    arr.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === "layer" || sortKey === "theme") {
        av = (av || "").toString();
        bv = (bv || "").toString();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      av = av == null ? -Infinity : av;
      bv = bv == null ? -Infinity : bv;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortDir, posOnly]);
  const toggleSort = (k) => {
    setSortKey((cur) => {
      if (cur === k) {
        setSortDir((d) => d === "asc" ? "desc" : "asc");
        return cur;
      }
      setSortDir(k === "layer" || k === "theme" ? "asc" : "desc");
      return k;
    });
  };

  const strColor = (v) => v == null ? ARIA.textMuted : v >= 65 ? ARIA.green : v >= 50 ? ARIA.blue : v >= 35 ? ARIA.yellow : ARIA.textDim;
  const crColor = (v) => v == null ? ARIA.textMuted : v >= 70 ? ARIA.green : v >= 40 ? ARIA.textDim : ARIA.red;
  const chgColor = (v) => v == null ? ARIA.textMuted : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textMuted;
  const rvColor = (v) => v == null ? ARIA.textMuted : v >= 1.5 ? ARIA.purple : ARIA.textMuted;

  // Keyboard nav: ↑/↓ moves selection through layer rows; Enter applies the
  // layer filter. Each row is keyed by themeId|layer.
  const wrapRef = useRef(null);
  const [selIdx, setSelIdx] = useState(0);
  const rowKeys = sorted.map(r => `${r.themeId}|${r.layer}`);
  useEffect(() => {
    if (selIdx >= rowKeys.length) setSelIdx(Math.max(0, rowKeys.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKeys.join(",")]);
  const onKeyDown = useCallback((e) => {
    if (!sorted.length) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter") return;
    e.preventDefault();
    if (e.key === "Enter") {
      const r = sorted[selIdx];
      if (r) onLayerClick && onLayerClick(r.layer, r.tickers);
      return;
    }
    let next = selIdx + (e.key === "ArrowDown" ? 1 : -1);
    if (next < 0) next = 0;
    if (next >= sorted.length) next = sorted.length - 1;
    setSelIdx(next);
    const k = `${sorted[next].themeId}|${sorted[next].layer}`;
    scrollRowIntoScroller(wrapRef.current?.querySelector(`tr[data-rowkey="${k}"]`));
  }, [sorted, selIdx, onLayerClick]);

  const Th = ({ k, label, align = "right" }) => {
    const on = sortKey === k;
    const arrow = on ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return (
      <th onClick={() => toggleSort(k)}
        style={{
          padding: "3px 5px", fontSize: 7, fontWeight: 700,
          color: on ? ARIA.green : ARIA.textMuted,
          textTransform: "uppercase", letterSpacing: 0.3, textAlign: align,
          borderBottom: `1px solid ${ARIA.border}`, whiteSpace: "nowrap",
          cursor: "pointer", background: ARIA.bgCard, userSelect: "none",
        }}>{label}{arrow}</th>
    );
  };

  const cell = { padding: "2px 5px", fontSize: 9, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, whiteSpace: "nowrap" };

  return (
    <div ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown}
         style={{ flex: 1, minHeight: 0, overflow: "auto", outline: "none" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto", fontFamily: "monospace" }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 2, background: ARIA.bgCard }}>
          <tr>
            <Th k="theme" label="Chain" align="left" />
            <Th k="layer" label="Layer" align="left" />
            <Th k="avgStr" label="Str" />
            <Th k="avgChg" label="Chg%" />
            <Th k="avgRvol" label="RV" />
            <Th k="avgCr" label="CR%" />
            <Th k="avgRoc2" label="ROC²" />
            <Th k="nTickers" label="N" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const c = DRAWER_COLORS[r.themeId] || { color: ARIA.textDim, bg: "transparent", border: ARIA.border };
            const isActive = activeFilterNames?.includes(r.layer);
            const kbSel = selIdx === i;
            return (
              <tr
                key={`${r.themeId}-${r.layer}-${i}`}
                data-rowkey={`${r.themeId}|${r.layer}`}
                onClick={() => { setSelIdx(i); onLayerClick && onLayerClick(r.layer, r.tickers); wrapRef.current?.focus(); }}
                style={{ cursor: "pointer", background: isActive ? `${c.color}26` : kbSel ? "rgba(255,255,255,0.06)" : "transparent", outline: kbSel && !isActive ? `1px solid ${ARIA.border}` : "none", outlineOffset: -1 }}
                onMouseEnter={(e) => { if (!isActive && !kbSel) e.currentTarget.style.background = ARIA.bgHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? `${c.color}26` : kbSel ? "rgba(255,255,255,0.06)" : "transparent"; }}
                title={`${r.theme} → ${r.layer} — click or press Enter to filter Scan to these ${r.nTickers} tickers`}
              >
                <td style={{ ...cell, textAlign: "left" }}>
                  <span style={{
                    fontSize: 7, fontWeight: 700, color: c.color,
                    background: c.bg, border: `1px solid ${c.border}`,
                    padding: "0 4px", borderRadius: 2,
                  }}>{(CHAIN_ABBR[r.themeId] || r.themeId).toUpperCase()}</span>
                </td>
                <td style={{ ...cell, textAlign: "left", color: ARIA.text, fontWeight: 600 }}>{r.layer}</td>
                <td style={{ ...cell, color: strColor(r.avgStr), fontWeight: 700 }}>
                  {r.avgStr != null ? Math.round(r.avgStr) : "—"}
                </td>
                <td style={{ ...cell, color: chgColor(r.avgChg) }}>
                  {r.avgChg != null ? (r.avgChg > 0 ? "+" : "") + r.avgChg.toFixed(1) + "%" : "—"}
                </td>
                <td style={{ ...cell, color: rvColor(r.avgRvol) }}>
                  {r.avgRvol != null ? r.avgRvol.toFixed(1) + "x" : "—"}
                </td>
                <td style={{ ...cell, color: crColor(r.avgCr) }}>
                  {r.avgCr != null ? Math.round(r.avgCr) + "%" : "—"}
                </td>
                <td
                  style={{ ...cell, color: chgColor(r.avgRoc2), fontWeight: 700 }}
                  title="ROC² (Druckenmiller acceleration): 1M return − (3M return ÷ 3). Positive = momentum accelerating, negative = decelerating."
                >
                  {r.avgRoc2 != null ? (r.avgRoc2 > 0 ? "+" : "") + r.avgRoc2.toFixed(1) : "—"}
                </td>
                <td style={{ ...cell, color: ARIA.textMuted, fontSize: 8 }}>{r.nTickers}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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
        title="Click = primary sort, right-click = secondary"
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
    v == null ? ARIA.textMuted : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textMuted;
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
          <Th k="rs" label="RS" />
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
                    r.rs >= 80 ? ARIA.green : r.rs >= 60 ? ARIA.blue : ARIA.textMuted,
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

// ──────────────────────────────────────────────────────────────────────────
// Agent Picks (Phase 2.3 — pixel-faithful port from Aria dashboard.html ~7530)
// ──────────────────────────────────────────────────────────────────────────
//
// Tabs: All / PM / AH / RVol
// Collapsible Commentary section: Market / Emerging Subthemes / Patterns
// Per-pick row: rank, ticker, source badge, score, entry, OVERALL signal
// Click row to expand: Catalyst box + 3-column agent breakdown
//
// Data sources: /rvol_picks.json, /pm_picks.json, /ah_picks.json (static
// files served by Vercel CDN). All three are merged into one list with the
// `source` field; commentary comes from /rvol_picks.json only.
// ──────────────────────────────────────────────────────────────────────────

const sigColor = (s) =>
  s === "bullish" ? ARIA.green : s === "bearish" ? ARIA.red : ARIA.textMuted;
const sigIcon = (s) =>
  s === "bullish" ? "▲" : s === "bearish" ? "▼" : "◆";

function AgentPicks({
  rvolPicks,
  pmPicks,
  ahPicks,
  analyzedPicks,
  onAnalyzedRemove,
  onTickerClick,
}) {
  const ARIA = useAriaTheme();
  const ownedTint = useOwnedTint();
  // ── State: tab, commentary collapse, expanded row ──────────────────────
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "analyzed";
    // Force-default to 'analyzed' since auto sources are disabled.
    return "analyzed";
  });
  const [commOpen, setCommOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("aria-comm-open") === "1";
  });
  const [expanded, setExpanded] = useState(() => new Set());

  const setTabPersist = useCallback((t) => {
    setTab(t);
    localStorage.setItem("aria-ap-tab", t);
  }, []);
  const toggleComm = useCallback(() => {
    setCommOpen((prev) => {
      const next = !prev;
      localStorage.setItem("aria-comm-open", next ? "1" : "0");
      return next;
    });
  }, []);
  const toggleExpanded = useCallback((ticker) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }, []);

  // Extract Chg% from a pick. Scanner picks have it embedded in reasoning
  // ("[RVOL] Chg +12.3% | ..."); PM/AH picks have it as "+12.3%" or
  // "-4.5%" inside their reasoning string. Returns 0 if not found.
  const extractChg = (p) => {
    if (!p) return 0;
    if (typeof p.chg === "number") return p.chg;
    const r = p.reasoning || "";
    // Match "Chg +12.3%" or "+12.3%" or "-4.5%"
    let m = r.match(/Chg\s*([+-]?\d+(?:\.\d+)?)%/i);
    if (m) return parseFloat(m[1]);
    m = r.match(/([+-]\d+(?:\.\d+)?)%/);
    if (m) return parseFloat(m[1]);
    return 0;
  };

  // ── Merge picks from the three sources ─────────────────────────────────
  // Dedupe by ticker (PM > AH > RVol priority for the source label, but the
  // ALL view sorts by Chg% descending — PM/AH are NOT auto-pinned to top).
  // The PM/AH/RVol tabs preserve their original posted order.
  const merged = useMemo(() => {
    const seen = new Set();
    const out = [];

    function add(picks, source) {
      if (!Array.isArray(picks)) return;
      for (const p of picks) {
        if (!p || !p.ticker || seen.has(p.ticker)) continue;
        seen.add(p.ticker);
        out.push({
          ...p,
          source: p.source || source,
          _chg: extractChg(p),
        });
      }
    }

    add(pmPicks?.picks, "PM");
    add(ahPicks?.picks, "AH");
    add(rvolPicks?.picks, "RVOL");
    // Analyzed picks (on-demand from /api/analyze-ticker)
    if (Array.isArray(analyzedPicks)) {
      for (const p of analyzedPicks) {
        if (!p || !p.ticker || seen.has(p.ticker)) continue;
        seen.add(p.ticker);
        out.push({
          ...p,
          source: "ANALYZED",
          _chg: extractChg(p),
        });
      }
    }
    return out;
  }, [rvolPicks, pmPicks, ahPicks, analyzedPicks]);

  // Filter and sort by tab
  const visible = useMemo(() => {
    let arr;
    if (tab === "all") {
      // Sort the entire combined list by Chg% descending — no source pinning
      arr = merged.slice().sort((a, b) => (b._chg || 0) - (a._chg || 0));
    } else if (tab === "pm") {
      arr = merged.filter((p) => p.source === "PM");
    } else if (tab === "ah") {
      arr = merged.filter((p) => p.source === "AH");
    } else if (tab === "rvol") {
      arr = merged.filter((p) => p.source === "RVOL");
    } else if (tab === "analyzed") {
      // Rank by total directional score (highest first); fall back to Chg%
      arr = (analyzedPicks || [])
        .map((p) => ({
          ...p,
          source: "ANALYZED",
          _chg: extractChg(p),
        }))
        .sort((a, b) => {
          const sa = Number(a.score);
          const sb = Number(b.score);
          if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb)
            return sb - sa;
          return (b._chg || 0) - (a._chg || 0);
        });
    } else {
      arr = merged;
    }
    // Renumber rank in the visible order so the displayed #1 matches the
    // top of the current tab/sort
    return arr.map((p, i) => ({ ...p, rank: i + 1 }));
  }, [merged, tab, analyzedPicks]);

  const commentary = rvolPicks?.commentary || {};

  // Live "X seconds ago" refresh ticker — updates every 10s so the relative
  // time stays accurate without spamming re-renders.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // Refresh info: most-recent analyzed_at across the local Analyzed list.
  // (Auto sources PM/AH/RVol are disabled so we don't include them here.)
  const refreshInfo = useMemo(() => {
    if (!Array.isArray(analyzedPicks) || analyzedPicks.length === 0) {
      return { latest: null, sources: [] };
    }
    const parse = (s) => {
      if (!s) return null;
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : null;
    };
    const items = analyzedPicks
      .map((p) => ({ label: p.ticker, ts: parse(p.analyzed_at) }))
      .filter((x) => x.ts != null)
      .sort((a, b) => b.ts - a.ts);
    if (!items.length) return { latest: null, sources: [] };
    return { latest: items[0], sources: items };
  }, [analyzedPicks]);

  const fmtRelative = (ts) => {
    if (!ts) return "—";
    const diffSec = Math.max(0, Math.round((now - ts) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d ago`;
  };
  const fmtClock = (ts) => {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const refreshTooltip = refreshInfo.sources
    .map((s) => `${s.label}: ${fmtClock(s.ts)} (${fmtRelative(s.ts)})`)
    .join("\n");

  // ── Render ──────────────────────────────────────────────────────────────
  const tabBtn = (t, label) => {
    const on = tab === t;
    return (
      <button
        key={t}
        onClick={() => setTabPersist(t)}
        style={pillStyle(on, ARIA.green)}
      >
        {label}
      </button>
    );
  };

  // Directional score: 0-100 where 50 = neutral, >50 bullish, <50 bearish.
  // Color tiers: 70+ strong bull (green), 55-70 mild bull (blue),
  //              45-55 neutral (dim), 30-45 mild bear (yellow),
  //              <30 strong bear (red).
  const scoreColor = (score) =>
    score >= 70
      ? ARIA.green
      : score >= 55
      ? ARIA.blue
      : score >= 45
      ? ARIA.textDim
      : score >= 30
      ? ARIA.yellow
      : ARIA.red;

  return (
    <div
      style={{
        background: ARIA.bgCard,
        border: `1px solid ${ARIA.border}`,
        borderRadius: 14,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: "5px 12px",
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
          Agent Picks
        </span>
        <div style={{ display: "flex", gap: 2, marginLeft: 6 }}>
          {/* Auto sources (PM/AH/RVol) disabled — manual Analyze only */}
          {tabBtn("analyzed", "Analyzed")}
        </div>
        {/* Last refresh — clock + relative time, hover for per-source breakdown */}
        <div
          title={refreshTooltip || "No refresh data yet"}
          style={{
            marginLeft: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 1,
            lineHeight: 1.15,
            cursor: "default",
          }}
        >
          {refreshInfo.latest ? (
            <>
              <span
                style={{
                  fontSize: 9,
                  fontFamily: "monospace",
                  fontWeight: 700,
                  color: ARIA.green,
                }}
              >
                {fmtClock(refreshInfo.latest.ts)}
              </span>
              <span
                style={{
                  fontSize: 7,
                  color: ARIA.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                refreshed {fmtRelative(refreshInfo.latest.ts)} ·{" "}
                {refreshInfo.latest.label}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 7, color: ARIA.textMuted }}>
              Waiting for picks…
            </span>
          )}
        </div>
      </div>

      {/* Commentary (collapsible) */}
      {(commentary.market || commentary.subthemes || commentary.patterns) && (
        <div style={{ borderBottom: `1px solid ${ARIA.border}` }}>
          <div
            onClick={toggleComm}
            style={{
              cursor: "pointer",
              padding: "5px 10px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 8,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: ARIA.textDim,
              userSelect: "none",
            }}
          >
            <span>{commOpen ? "▼" : "▶"}</span>
            <span>Commentary</span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 7,
                color: ARIA.textMuted,
                fontWeight: 400,
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              market · subthemes · patterns
            </span>
          </div>
          {commOpen && (
            <div
              style={{
                padding: "6px 12px 10px",
                fontSize: 9,
                lineHeight: 1.5,
                color: ARIA.textDim,
              }}
            >
              {commentary.market && (
                <div style={{ marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 7,
                      fontWeight: 700,
                      color: ARIA.cyan,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Market
                  </span>
                  <br />
                  {commentary.market}
                </div>
              )}
              {commentary.subthemes && (
                <div style={{ marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 7,
                      fontWeight: 700,
                      color: ARIA.green,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Emerging Subthemes
                  </span>
                  <br />
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    {commentary.subthemes}
                  </div>
                </div>
              )}
              {commentary.patterns && (
                <div>
                  <span
                    style={{
                      fontSize: 7,
                      fontWeight: 700,
                      color: ARIA.purple,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Patterns
                  </span>
                  <br />
                  {commentary.patterns}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Picks list */}
      <div
        style={{
          fontSize: 9,
          fontFamily: "monospace",
          maxHeight: 480,
          overflowY: "auto",
        }}
      >
        {visible.length === 0 && (
          <div
            style={{
              padding: 12,
              color: ARIA.textMuted,
              fontSize: 9,
              textAlign: "center",
            }}
          >
            No picks yet. Hermes Agent will populate this when running.
          </div>
        )}
        {visible.map((p) => {
          const isOpen = expanded.has(p.ticker);
          const sc = scoreColor(p.score || 0);
          const hasAgents = p.agents && p.agents.overall;
          const srcColor =
            p.source === "PM"
              ? ARIA.yellow
              : p.source === "AH"
              ? ARIA.purple
              : null;
          const ownedBg = ownedTint(p.ticker, ARIA);
          // Owned tint wins over the #1-rank highlight so already-tracked
          // picks stay visible at the top of the list.
          const rowBg =
            ownedBg !== "transparent"
              ? ownedBg
              : p.rank === 1
              ? ARIA.bgHover
              : "transparent";
          return (
            <div
              key={p.ticker}
              style={{
                padding: "6px 10px",
                borderBottom: `1px solid ${ARIA.border}`,
                background: rowBg,
              }}
            >
              <div
                onClick={() => {
                  toggleExpanded(p.ticker);
                  onTickerClick && onTickerClick(p.ticker);
                }}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: sc,
                    minWidth: 18,
                  }}
                >
                  #{p.rank}
                </span>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                      marginBottom: 2,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 10,
                        color: ARIA.text,
                      }}
                    >
                      {p.ticker}
                    </span>
                    {srcColor && (
                      <span
                        style={{
                          fontSize: 7,
                          fontWeight: 800,
                          color: srcColor,
                          border: `1px solid ${srcColor}`,
                          padding: "0 3px",
                          borderRadius: 2,
                        }}
                      >
                        {p.source}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 8,
                        color: sc,
                        fontWeight: 700,
                      }}
                    >
                      Score {p.score}
                    </span>
                    {p.entry_price != null && (
                      <span
                        style={{ fontSize: 8, color: ARIA.green }}
                      >
                        Entry ${p.entry_price}
                      </span>
                    )}
                    {p.stop_price != null && (
                      <span style={{ fontSize: 8, color: ARIA.red }}>
                        Stop ${p.stop_price}
                      </span>
                    )}
                    {p.shares != null && (
                      <span
                        style={{ fontSize: 8, color: ARIA.textMuted }}
                      >
                        {p.shares} shares
                      </span>
                    )}
                    {hasAgents &&
                      p.agents.attention &&
                      ["HIGH", "EXTREME"].includes(
                        p.agents.attention.tier ||
                          (p.agents.attention.reasoning &&
                            p.agents.attention.reasoning.tier) ||
                          ""
                      ) && (
                        <span
                          title={`Attention: ${
                            p.agents.attention.tier ||
                            p.agents.attention.reasoning?.tier
                          } (${p.agents.attention.confidence}%)`}
                          style={{
                            fontSize: 8,
                            fontWeight: 800,
                            color: ARIA.yellow,
                            border: `1px solid ${ARIA.yellow}`,
                            background: `${ARIA.yellow}26`,
                            padding: "0 4px",
                            borderRadius: 2,
                            marginLeft: "auto",
                          }}
                        >
                          🔥{p.agents.attention.confidence}
                        </span>
                      )}
                    {hasAgents && (
                      <span
                        style={{
                          fontSize: 7,
                          color: sigColor(p.agents.overall),
                          fontWeight: 700,
                          marginLeft:
                            p.agents.attention &&
                            ["HIGH", "EXTREME"].includes(
                              p.agents.attention.tier ||
                                p.agents.attention.reasoning?.tier ||
                                ""
                            )
                              ? 4
                              : "auto",
                        }}
                      >
                        {sigIcon(p.agents.overall)}{" "}
                        {p.agents.overall.toUpperCase()}
                      </span>
                    )}
                    {/* Analyzed-at timestamp on the right edge */}
                    {p.analyzed_at && (
                      <span
                        title={`Analyzed at ${new Date(
                          p.analyzed_at
                        ).toLocaleString()}`}
                        style={{
                          fontSize: 7,
                          color: ARIA.textMuted,
                          fontFamily: "monospace",
                          marginLeft: hasAgents ? 6 : "auto",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {fmtClock(Date.parse(p.analyzed_at))} ·{" "}
                        {fmtRelative(Date.parse(p.analyzed_at))}
                      </span>
                    )}
                  </div>
                  {p.reasoning && (
                    <div
                      style={{
                        fontSize: 8,
                        color: ARIA.textDim,
                        lineHeight: 1.4,
                      }}
                    >
                      {p.reasoning}
                    </div>
                  )}
                </div>
                {/* Delete button — only for ANALYZED picks */}
                {p.source === "ANALYZED" && onAnalyzedRemove && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAnalyzedRemove(p.ticker);
                    }}
                    title={`Remove ${p.ticker} from analyzed`}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: ARIA.textMuted,
                      cursor: "pointer",
                      fontSize: 14,
                      lineHeight: 1,
                      padding: "0 4px",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = ARIA.red)}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.color = ARIA.textMuted)
                    }
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Expanded panel: catalyst (always) + agent breakdown (RVol only) */}
              {isOpen && (
                <div
                  style={{
                    marginTop: 6,
                    padding: 8,
                    background: ARIA.bgRow,
                    borderRadius: 4,
                    borderLeft: `2px solid ${
                      hasAgents ? sigColor(p.agents.overall) : ARIA.cyan
                    }`,
                    maxHeight: 360,
                    overflowY: "auto",
                  }}
                >
                  {hasAgents && (
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: sigColor(p.agents.overall),
                        marginBottom: 6,
                      }}
                    >
                      OVERALL: {(p.agents.overall || "").toUpperCase()} (
                      {p.agents.confidence || 0}%)
                    </div>
                  )}
                  {p.catalyst && p.catalyst.length > 5 && (
                    <div
                      style={{
                        fontSize: 9,
                        color: ARIA.text,
                        lineHeight: 1.5,
                        marginBottom: 8,
                        padding: "6px 8px",
                        background: ARIA.bg,
                        borderRadius: 3,
                        borderLeft: `2px solid ${ARIA.cyan}`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 7,
                          fontWeight: 700,
                          color: ARIA.cyan,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        Catalyst
                      </span>
                      <br />
                      {p.catalyst}
                    </div>
                  )}
                  {hasAgents && (
                    <>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr 1fr",
                          gap: 8,
                        }}
                      >
                        {["fundamentals", "technicals", "sentiment", "attention"].map((k) => {
                          const sub = p.agents[k];
                          if (!sub)
                            return <div key={k} style={{ minWidth: 0 }} />;
                          return (
                            <div key={k} style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 8,
                                  fontWeight: 700,
                                  color: sigColor(sub.signal),
                                  marginBottom: 3,
                                }}
                              >
                                {sigIcon(sub.signal)} {k.toUpperCase()} —{" "}
                                {sub.signal} ({sub.confidence}%)
                              </div>
                              {sub.reasoning &&
                                Object.entries(sub.reasoning).map(([rk, rv]) => (
                                  <div
                                    key={rk}
                                    style={{
                                      fontSize: 8,
                                      color: ARIA.textDim,
                                      lineHeight: 1.4,
                                      wordBreak: "break-word",
                                    }}
                                  >
                                    • {rk}: {rv}
                                  </div>
                                ))}
                            </div>
                          );
                        })}
                      </div>
                      {p.agents.subtheme && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: 6,
                            background: "#0d0d12",
                            borderRadius: 3,
                            borderLeft: `2px solid ${sigColor(p.agents.subtheme.signal)}`,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 8,
                              fontWeight: 700,
                              color: sigColor(p.agents.subtheme.signal),
                              marginBottom: 3,
                            }}
                          >
                            {sigIcon(p.agents.subtheme.signal)} SUBTHEME —{" "}
                            {p.agents.subtheme.signal} ({p.agents.subtheme.confidence}%)
                          </div>
                          {p.agents.subtheme.reasoning &&
                            Object.entries(p.agents.subtheme.reasoning).map(([rk, rv]) => {
                              const isNarr = rk === "narrative" && typeof rv === "string" && rv.length > 20;
                              if (isNarr) {
                                const paras = rv.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
                                return (
                                  <div key={rk} style={{ marginTop: 4 }}>
                                    <div
                                      style={{
                                        fontSize: 8,
                                        color: ARIA.textMuted,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                        marginBottom: 3,
                                      }}
                                    >
                                      • narrative
                                    </div>
                                    {paras.map((para, i) => (
                                      <p
                                        key={i}
                                        style={{
                                          fontSize: 9,
                                          color: ARIA.text,
                                          lineHeight: 1.5,
                                          margin: "0 0 6px 8px",
                                          wordBreak: "break-word",
                                        }}
                                      >
                                        {para}
                                      </p>
                                    ))}
                                  </div>
                                );
                              }
                              return (
                                <div
                                  key={rk}
                                  style={{
                                    fontSize: 8,
                                    color: ARIA.textDim,
                                    lineHeight: 1.4,
                                    wordBreak: "break-word",
                                  }}
                                >
                                  • {rk}: {rv}
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </>
                  )}
                  {!hasAgents &&
                    !(p.catalyst && p.catalyst.length > 5) && (
                      <div
                        style={{
                          fontSize: 9,
                          color: ARIA.textMuted,
                          fontStyle: "italic",
                        }}
                      >
                        No catalyst research available for this pick.
                      </div>
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>
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
  return { analyzedPicks: [], watchlist: [], portfolio: [], updated_at: null };
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
      _moduleState = {
        ...emptyServerState(),
        analyzedPicks: d.analyzedPicks || [],
        watchlist: d.watchlist || [],
        portfolio: d.portfolio || [],
        updated_at: d.updated_at || null,
      };
      saveCachedState(_moduleState);
      _notify();
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
      : null;
  const list = field ? state[field] || [] : [];
  const update = useCallback(
    (next) => {
      if (!field) return;
      _setState((s) => {
        const cur = s[field] || [];
        const value = typeof next === "function" ? next(cur) : next;
        return { ...s, [field]: value };
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
  return useMemo(() => {
    const pf = new Set(portfolio);
    const wl = new Set(watchlist);
    return (ticker, ARIA) => {
      if (!ticker) return "transparent";
      if (pf.has(ticker)) return `${ARIA.yellow}1f`;
      if (wl.has(ticker)) return `${ARIA.green}1f`;
      return "transparent";
    };
  }, [portfolio, watchlist]);
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
        d.tickers.push({ ticker: s.ticker, rs: s.rs_rank || 0 });
        d.rs_sum += s.rs_rank || 0;
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
    { key: "avg_rs",      label: "RS",    w: 26, align: "right" },
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
                      avg_rs:   s.rs_rank ?? 0,
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
// 12mo return proxy for IBD RS rating. Returns 0–99 or null.
// Proprietary IBD formula is unavailable — directional proxy Nitin can
// sanity-check against IBD's published RS later.
function computeRSRank(tResp, sResp) {
  const tBars = tResp?.ohlc, sBars = sResp?.ohlc;
  if (!Array.isArray(tBars) || !Array.isArray(sBars)) return null;
  if (tBars.length < 200 || sBars.length < 200) return null;
  const tRet = tBars[tBars.length - 1].close / tBars[0].close - 1;
  const sRet = sBars[sBars.length - 1].close / sBars[0].close - 1;
  const diffPct = (tRet - sRet) * 100;
  return Math.max(0, Math.min(99, Math.round(50 + 0.5 * diffPct)));
}
const fmtPct = (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
const fmtPp = (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "pp";
const fmtRank = (v) => v.toFixed(0);

// CANSLIM scorecard — replaces the old Institutional QoQ third column.
// Same flex:1.4 slot, same monospace style, driven entirely by the active
// ticker's stockInfo (already loaded by ChartPanelInline) + one /api/ohlc
// pair fetch for the 12mo RS proxy.
function CanslimScorecard({ ticker, stockInfo, cfVsEpsPct, annuals, stockMap, ARIA }) {
  const dvolHistory = useDvolHistory();
  const [rsRank, setRsRank] = React.useState(null);
  React.useEffect(() => {
    if (!ticker) {
      setRsRank(null);
      return;
    }
    let cancelled = false;
    setRsRank(null);
    Promise.all([
      fetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}`).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/ohlc?ticker=SPY`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([t, s]) => {
        if (cancelled) return;
        setRsRank(computeRSRank(t, s));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  // Derive inputs from stockInfo (same normalization ChartPanelInline uses
  // above in its CANSLIM stats row for roe/margin fraction → percent).
  const epsYoy = stockInfo?.eps_yoy ?? null;
  const epsYoyPrev = stockInfo?.eps_yoy_prev ?? null;
  const accel =
    epsYoy != null && epsYoyPrev != null ? epsYoy - epsYoyPrev : null;
  // EPS CAGR from FMP annual series. Try 5 years first; if we don't have
  // 5 years or the window has a sign flip, fall back to 3 years (O'Neil's
  // actual CANSLIM minimum). Label adapts to the window actually used.
  // Finviz eps_past_5y is the last-resort fallback.
  const { epsCagr: eps5y, epsCagrYears } = React.useMemo(() => {
    const tryWindow = (n) => {
      if (!Array.isArray(annuals) || annuals.length < n) return null;
      const a = annuals.slice(-n);
      const first = a[0]?.eps, last = a[a.length - 1]?.eps;
      if (first == null || last == null || first <= 0 || last <= 0) return null;
      return (Math.pow(last / first, 1 / (a.length - 1)) - 1) * 100;
    };
    for (const n of [5, 4, 3]) {
      const v = tryWindow(n);
      if (v != null) return { epsCagr: v, epsCagrYears: n };
    }
    const fallback = stockInfo?.eps_past_5y ?? null;
    return { epsCagr: fallback, epsCagrYears: fallback != null ? 5 : null };
  }, [annuals, stockInfo?.eps_past_5y]);
  const salesYoy = stockInfo?.sales_yoy ?? null;
  const margin = (() => {
    const m = stockInfo?.profit_margin ?? null;
    return m != null ? (m < 1 ? m * 100 : m) : null;
  })();
  const roe = (() => {
    const r = stockInfo?.roe ?? null;
    return r != null ? (Math.abs(r) < 5 ? r * 100 : r) : null;
  })();
  const instTrans = stockInfo?.inst_trans_pct ?? null;
  const instFunds = stockInfo?.inst_holder_count ?? null;
  const instNetFlow = stockInfo?.inst_net_change_pct ?? null;

  // N (new high / product) — distance from 52w high. pct_from_high is
  // negative (0 = at high, -50 = half off). Flip sign so the scorecard
  // displays a familiar positive magnitude for "how far from breakout".
  const pctFromHigh = stockInfo?.pct_from_high ?? null;
  const distFromHigh = pctFromHigh != null ? Math.abs(pctFromHigh) : null;

  // Industry rank — percentile of the ticker's rs_rank within its industry
  // group. O'Neil wants top 10 of 27 industries; we approximate by mapping
  // within-industry percentile to a letter grade. Memoized so large stockMaps
  // don't recompute on every rerender.
  const industryPct = React.useMemo(() => {
    const industry = stockInfo?.industry;
    const myRs = stockInfo?.rs_rank;
    if (!industry || myRs == null || !stockMap) return null;
    const peers = Object.values(stockMap).filter(
      (s) => s && s.industry === industry && s.rs_rank != null
    );
    if (peers.length < 3) return null; // too few peers to rank meaningfully
    const better = peers.filter((s) => s.rs_rank > myRs).length;
    return Math.round((1 - better / peers.length) * 100);
  }, [stockInfo?.industry, stockInfo?.rs_rank, stockMap]);

  const criteria = [
    { key: "C", label: "Qtr EPS", raw: epsYoy, fmt: fmtPct, grade: gradeBand(epsYoy, [100, 50, 25, 10, 0]) },
    { key: "Δ", label: "Accel", raw: accel, fmt: fmtPp, grade: gradeBand(accel, [30, 10, 0, -10, -25]) },
    { key: "A", label: epsCagrYears ? `${epsCagrYears}Y EPS` : "5Y EPS", raw: eps5y, fmt: fmtPct, grade: gradeBand(eps5y, [40, 25, 15, 10, 0]) },
    { key: "S", label: "Sales", raw: salesYoy, fmt: fmtPct, grade: gradeBand(salesYoy, [40, 25, 15, 10, 0]) },
    { key: "M", label: "Margin", raw: margin, fmt: fmtPct, grade: gradeBand(margin, [25, 18, 12, 7, 2]) },
    { key: "R", label: "ROE", raw: roe, fmt: fmtPct, grade: gradeBand(roe, [30, 17, 12, 8, 0]) },
    { key: "I", label: "Inst ΔQ", raw: instTrans, fmt: fmtPp, grade: gradeBand(instTrans, [2, 1, 0.3, 0, -1]) },
    { key: "L", label: "RS 12mo", raw: rsRank, fmt: fmtRank, grade: gradeBand(rsRank, [95, 90, 80, 60, 40]) },
    { key: "$", label: "CF vs EPS", raw: cfVsEpsPct, fmt: fmtPp, grade: gradeBand(cfVsEpsPct, [50, 30, 20, 0, -20]) },
    // N grades the price portion of O'Neil's "new high / new product". Lower
    // distance from 52w high = better. We negate distFromHigh for gradeBand
    // (which grades descending) so "closer to high" → higher grade.
    { key: "N", label: "From 52w hi", raw: distFromHigh != null ? -distFromHigh : null, fmt: (v) => (v).toFixed(1) + "%", grade: gradeBand(distFromHigh != null ? -distFromHigh : null, [-3, -10, -20, -35, -50]) },
    { key: "#", label: "Ind rank", raw: industryPct, fmt: (v) => "P" + v.toFixed(0), grade: gradeBand(industryPct, [95, 85, 70, 50, 30]) },
  ];
  const composite = avgLetter(criteria.map((c) => c.grade));
  const compColor = gradeColor(composite, ARIA);

  const naCriteria = [];

  return (
    <div
      style={{
        flex: 0.45,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        fontFamily: "monospace",
      }}
      title="CANSLIM scorecard — O'Neil/IBD's 7 gradeable criteria for growth stock winners. Each row is a letter grade from A+ (exceptional) to F (fails). Composite is unweighted average."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "12px 1fr auto 22px",
          columnGap: 6,
          rowGap: 2,
          fontSize: 9,
          alignItems: "center",
        }}
      >
        {criteria.map((c) => {
          const clr = gradeColor(c.grade, ARIA);
          return (
            <React.Fragment key={c.key}>
              <span style={{ color: ARIA.textMuted, fontWeight: 700 }}>{c.key}</span>
              <span style={{ color: ARIA.textDim }}>{c.label}</span>
              <span style={{ color: ARIA.text, textAlign: "right" }}>
                {c.raw == null || !Number.isFinite(c.raw) ? "—" : c.fmt(c.raw)}
              </span>
              <span
                style={{
                  padding: "0 4px",
                  borderRadius: 2,
                  fontSize: 8,
                  fontWeight: 700,
                  background: c.grade === "—" ? "transparent" : clr + "22",
                  color: clr,
                  border: c.grade === "—" ? `1px solid ${ARIA.border}` : `1px solid ${clr}55`,
                  textAlign: "center",
                }}
              >
                {c.grade}
              </span>
            </React.Fragment>
          );
        })}
        {(instFunds != null || instNetFlow != null) && (
          <React.Fragment>
            <span style={{ color: ARIA.textMuted }}>·</span>
            <span
              style={{
                gridColumn: "2 / span 3",
                fontSize: 8,
                display: "flex",
                gap: 8,
                alignItems: "baseline",
                borderTop: `1px solid ${ARIA.border}`,
                paddingTop: 3,
                marginTop: 2,
              }}
              title="Institutional fund count (13F filings) and net flow % vs prior quarter"
            >
              <span>
                <span style={{ color: ARIA.textMuted }}>Funds </span>
                <span style={{ color: ARIA.text, fontWeight: 700 }}>
                  {instFunds != null ? instFunds.toLocaleString() : "—"}
                </span>
              </span>
              <span>
                <span style={{ color: ARIA.textMuted }}>Net flow </span>
                <span
                  style={{
                    fontWeight: 700,
                    color:
                      instNetFlow == null
                        ? ARIA.textMuted
                        : instNetFlow >= 1
                        ? ARIA.green
                        : instNetFlow > 0
                        ? ARIA.blue
                        : instNetFlow > -1
                        ? ARIA.textDim
                        : ARIA.red,
                  }}
                >
                  {instNetFlow == null
                    ? "—"
                    : (instNetFlow >= 0 ? "+" : "") + instNetFlow.toFixed(2) + "%"}
                </span>
              </span>
            </span>
          </React.Fragment>
        )}
        {naCriteria.map((l) => (
          <React.Fragment key={l}>
            <span style={{ color: ARIA.textMuted }}>·</span>
            <span
              style={{
                color: ARIA.textMuted,
                gridColumn: "2 / span 3",
                fontStyle: "italic",
                fontSize: 8,
              }}
            >
              {l}
            </span>
          </React.Fragment>
        ))}
        {/* Composite header at the bottom — caption-style read of the
            scorecard's overall grade after the sparkline. */}
        <div
          style={{
            gridColumn: "1 / -1",
            fontSize: 7,
            color: ARIA.textMuted,
            marginTop: 4,
            paddingTop: 3,
            borderTop: `1px solid ${ARIA.border}`,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            fontWeight: 700,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            gap: 6,
            lineHeight: 1,
          }}
        >
          <span>CANSLIM</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: compColor, letterSpacing: 0, lineHeight: 1 }}>
            {composite}
          </span>
          <span style={{ color: ARIA.textMuted }}>composite</span>
        </div>
        {/* EPS + Revenue percentile ranks vs universe */}
        <PctileRanks ticker={ticker} stockMap={stockMap} ARIA={ARIA} />
      </div>
    </div>
  );
}

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
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
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
          const hPos = v == null || v <= 0 ? 0 : (v / range) * barAreaH;
          const hNeg = v == null || v >= 0 ? 0 : (Math.abs(v) / range) * barAreaH;
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
function DailyChartSVG({ ohlc, quarters, height = 400, stopLines = [] }) {
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
  const [volSubTab, setVolSubTab] = useState("vol");

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && w > 0) setContainerW(Math.round(w));
    });
    ro.observe(el);
    setContainerW(Math.round(el.offsetWidth) || 900);
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

    const W = containerW, priceH = 260, volH = 80, yAxisW = 48, pad = { l: 0, r: yAxisW, t: 16, b: 0 };
    const volGap = 6;
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
        <line key={`w${i}`} x1={wickX} y1={py(b.high)} x2={wickX} y2={py(b.low)} stroke={candleColor} strokeWidth={0.8} />,
        <rect key={`b${i}`} x={x} y={bodyTop} width={bw} height={bodyH} fill={candleColor} rx={0.5} />
      );
      const vol = b.volume || 0;
      let vColor;
      if (!isUp) {
        vColor = "#6b7280cc";
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
          vColor = "#ffffffcc";
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
          if (y2 >= vy) volElements.push(<line key={`bo${i}_${dy}`} x1={x} y1={y1} x2={x + bw} y2={y2} stroke="#fbbf24" strokeWidth={0.8} opacity={0.8} />);
        }
      } else if (chg <= -4 && vol > prevVol && vol > 100000) {
        const slope = bw * 0.4;
        for (let dy = 3; dy < vh - 1; dy += 5) {
          const y1 = vy + dy, y2 = y1 + slope;
          if (y2 <= vy + vh) volElements.push(<line key={`bd${i}_${dy}`} x1={x} y1={y1} x2={x + bw} y2={y2} stroke="#f8717180" strokeWidth={0.8} />);
        }
      }
      const vAvg20 = volMA20[i] || 0;
      if (vAvg20 > 0 && vol < vAvg20 * 0.5 && vol > 0) {
        volElements.push(<circle key={`du${i}`} cx={x + bw / 2} cy={vy - 3} r={1.5} fill="#2dd4bf" opacity={0.9} />);
      }
      const vScore = vcpScores[i];
      if (vScore != null && vScore <= 10) {
        volElements.push(<text key={`t${i}`} x={x + bw / 2} y={vy + vh - 1} textAnchor="middle" fontSize={Math.min(bw + 1, 7)} fontWeight={900} fontFamily="monospace" fill="#fbbf24" opacity={0.9}>T</text>);
      }
    });

    const erMarkers = [];
    if (quarters && quarters.length) {
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
          <text key={`ers${q.report_date}`} x={x} y={pad.t + priceH - 2} textAnchor="middle" fontSize={6.5} fontWeight={600} fill="#c0c0d8" opacity={0.8} fontFamily="ui-monospace,monospace">{ePct} | {sPct}</text>
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
        <line key={`yg${v}`} x1={pad.l} y1={y} x2={chartRight} y2={y} stroke="#2a2a3a" strokeWidth={0.5} />,
        <text key={`yl${v}`} x={chartRight + 4} y={y + 3} fontSize={8} fill="#6a6a7a" fontFamily="ui-monospace,monospace">${fmtPrice(v)}</text>
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
            <line key={`xg${key}`} x1={x} y1={pad.t} x2={x} y2={pad.t + priceH} stroke="#2a2a3a" strokeWidth={0.5} strokeDasharray="2,4" />,
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

    return {
      W, totalH, sepY, barCount: bars.length, totalBars: total, chartRight,
      candleElements, volElements, erMarkers, yAxisElements, xAxisElements,
      maEma21hi: maPoints(ema21hi), maEma21lo: maPoints(ema21lo),
      maEma21close: maPoints(ema21close), maEma10: maPoints(ema10),
      maSma50: maPoints(sma50), maEma200: maPoints(ema200),
      volMaPts: volMaPoints(),
      startDate: bars[0]?.date, endDate: bars[bars.length - 1]?.date,
      pMin, pMax, pRange, padT: pad.t, padL: pad.l, priceH,
      volTop, volH, y60, y40, rsiPathD, lastRsiX, lastRsiY, lastRsi,
      rsiOverboughtPathD, rsiOversoldPathD,
    };
  }, [ohlc, precomputed, quarters, visibleCount, endIdx, containerW]);

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
      <div ref={containerRef} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: height || 400, color: "#6a6a7a", fontSize: 11, fontFamily: "monospace", width: "100%" }}>
        No chart data
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", padding: "0 4px" }}>
      <svg ref={svgRef} width={chartData.W} height={chartData.totalH}
        style={{ display: "block", cursor: dragRef.current ? "grabbing" : "grab" }}
        onWheel={handleWheel} onMouseDown={handleMouseDown} onDoubleClick={handleDblClick}>
        <defs>
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
        <line x1={0} y1={chartData.sepY} x2={chartData.chartRight} y2={chartData.sepY} stroke="#2a2a3a" strokeWidth={0.5} />
        <line x1={chartData.chartRight} y1={0} x2={chartData.chartRight} y2={chartData.totalH} stroke="#2a2a3a" strokeWidth={0.5} />
        {chartData.maEma21hi && <polyline points={chartData.maEma21hi} fill="none" stroke="#80808060" strokeWidth={1} />}
        {chartData.maEma21lo && <polyline points={chartData.maEma21lo} fill="none" stroke="#80808060" strokeWidth={1} />}
        {chartData.maEma21close && <polyline points={chartData.maEma21close} fill="none" stroke="#808080" strokeWidth={1.5} />}
        {chartData.maEma10 && <polyline points={chartData.maEma10} fill="none" stroke="#ff828c" strokeWidth={1} />}
        {chartData.maSma50 && <polyline points={chartData.maSma50} fill="none" stroke="#2dd4bf" strokeWidth={1} strokeDasharray="4,2" />}
        {chartData.maEma200 && <polyline points={chartData.maEma200} fill="none" stroke="#8232c8" strokeWidth={1} />}
        {chartData.candleElements}
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
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "repeating-linear-gradient(135deg,transparent,transparent 2px,#fbbf24 2px,#fbbf24 3px)", border: "1px solid #fbbf2480", borderRadius: 1, display: "inline-block" }} />+4% BO</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "repeating-linear-gradient(45deg,transparent,transparent 2px,#f87171 2px,#f87171 3px)", border: "1px solid #f8717180", borderRadius: 1, display: "inline-block" }} />-4% BD</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#1a1a24", color: "#fbbf24", fontSize: 7, fontWeight: 900, textAlign: "center", lineHeight: "8px", fontFamily: "monospace", borderRadius: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>T</span>Tight</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "radial-gradient(circle,#2dd4bf 3px,transparent 3px)", borderRadius: 1, display: "inline-block" }} />Dry-Up</span>
        </span>
      </div>
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

function ChartPanelInline({
  ticker,
  onTickerChange,
  height = 580,
  stockMap,
  themeHealth,
  tickerStrengthMap,
}) {
  const ARIA = useAriaTheme();
  const tf = "D";
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
  const [description, setDescription] = useState("");
  const [peers, setPeers] = useState([]);
  const [etfHoldings, setEtfHoldings] = useState([]);
  const [liveEarningsDate, setLiveEarningsDate] = useState(null);
  const [sheetNotes, setSheetNotes] = useState(() => _sheetNotesCache.map);
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
    setEtfHoldings([]);
    setLiveEarningsDate(null);
    Promise.all([
      fetch(`/api/live?news=${encodeURIComponent(ticker)}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/live?etf=${encodeURIComponent(ticker)}`).then(r => r.ok ? r.json() : null),
    ]).then(([d, etfData]) => {
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
      setEtfHoldings(etfData?.holdings || []);
      if (d?.earningsDate) setLiveEarningsDate(d.earningsDate);
    }).catch(() => {
      if (!cancelled) {
        setQuarters([]);
        setAnnuals([]);
        setNews([]);
        setDescription("");
        setPeers([]);
        setEtfHoldings([]);
      }
    });
    return () => { cancelled = true; };
  }, [ticker]);

  // Fetch Google Sheet notes once (cached across mounts)
  useEffect(() => {
    if (_sheetNotesCache.map) { setSheetNotes(_sheetNotesCache.map); return; }
    if (_sheetNotesCache.loading) return;
    _sheetNotesCache.loading = true;
    fetch(SHEET_NOTES_URL)
      .then(r => r.text())
      .then(text => {
        const map = {};
        text.split('\n').slice(1).forEach(line => {
          if (!line.trim()) return;
          const cols = parseSheetCSVRow(line);
          const tk = cols[0]?.trim();
          const note = cols[5]?.trim();
          if (tk && note) map[tk] = note;
        });
        _sheetNotesCache.map = map;
        _sheetNotesCache.loading = false;
        setSheetNotes(map);
      })
      .catch(() => { _sheetNotesCache.loading = false; });
  }, []);

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

  // Risk Management — ATR + 5 stop scenarios (mirrors ThinkScript indicator)
  const dailyATR = useMemo(() => calcWilderATR(ohlcBars, tradeSettings.atrLen), [ohlcBars, tradeSettings.atrLen]);
  const riskEntry = c > 0 ? c : null;
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

  // Portfolio/Watchlist via shared cross-component hook (Aria's +WL / +PF)
  const [portfolio, setPortfolio] = useLocalStorageList("themepulse-portfolio");
  const [watchlist, setWatchlist] = useLocalStorageList("themepulse-watchlist");
  const [focusList, setFocusList] = useLocalStorageList("themepulse-focus");
  const inPF = portfolio.includes(ticker);
  const inWL = watchlist.includes(ticker);
  const inFocus = focusList.includes(ticker);
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
  const toggleFocus = useCallback(() => {
    setFocusList((prev) =>
      prev.includes(ticker) ? prev.filter((x) => x !== ticker) : [...prev, ticker]
    );
  }, [ticker, setFocusList]);

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
      }}
    >
      {/* Header: Logo + Meta + Buttons */}
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${ARIA.border}` }}>
        {/* Logo */}
        <div style={{ width: 36, height: 36, borderRadius: 6, background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
          <img src={`https://images.financialmodelingprep.com/symbol/${ticker}.png`} alt={ticker} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 4 }} onError={e => { e.target.style.display = "none"; e.target.parentElement.style.background = "#2a2a40"; e.target.parentElement.style.color = "#c0c0d8"; e.target.parentElement.style.fontSize = "11px"; e.target.parentElement.style.fontWeight = "800"; e.target.parentElement.textContent = ticker; }} />
        </div>
        {/* Meta block */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "ui-monospace, monospace", color: "#fff" }}>{ticker}</span>
            {rvol != null && rvol >= 1.5 && <span style={badgeStyle(ARIA.purple)}>RV {rvol.toFixed(1)}x</span>}
            {has9M && <span style={badgeStyle("#f59e0b")} title="Unusual institutional volume">9M</span>}
          </div>
          {/* Company + IPO */}
          <div style={{ fontSize: 9, color: "#9090a0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {stockInfo.company || ""}
          </div>
          {/* Description */}
          {description && (
            <div style={{ fontSize: 8.5, color: "#6a6a7a", lineHeight: 1.35, marginTop: 2, maxHeight: 41, overflowY: "auto" }}>
              {description}
            </div>
          )}
        </div>
        {/* Right side: buttons */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
          <button onClick={toggleWL} title={inWL ? "Remove from Watchlist" : "Add to Watchlist"} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, border: `1px solid ${ARIA.cyan}80`, color: inWL ? ARIA.bg : ARIA.cyan, background: inWL ? ARIA.cyan : "transparent", cursor: "pointer", fontFamily: "monospace", fontWeight: 700, flexShrink: 0 }}>
            {inWL ? "✓WL" : "+WL"}
          </button>
          <button onClick={togglePF} title={inPF ? "Remove from Portfolio" : "Add to Portfolio"} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, border: `1px solid ${ARIA.yellow}80`, color: inPF ? ARIA.bg : ARIA.yellow, background: inPF ? ARIA.yellow : "transparent", cursor: "pointer", fontFamily: "monospace", fontWeight: 700, flexShrink: 0 }}>
            {inPF ? "✓PF" : "+PF"}
          </button>
          <button onClick={toggleFocus} title={inFocus ? "Unstar" : "Star (highlight in chain table)"} style={{ fontSize: 12, padding: "0px 4px", borderRadius: 3, border: `1px solid ${inFocus ? "#fbbf24" : ARIA.border}`, background: inFocus ? "rgba(251,191,36,0.15)" : "transparent", cursor: "pointer", lineHeight: 1.4, flexShrink: 0 }}>
            {inFocus ? "⭐" : "☆"}
          </button>
          <span style={{ color: ARIA.borderLight, margin: "0 2px" }}>|</span>
          <span style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3 }}>
            <span style={{ color: ARIA.textMuted }}>Chg</span>
            <span style={{ color: chgColor, fontWeight: 700 }}>{chgPct != null ? `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%` : "—"}</span>
          </span>
          <span style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3 }}>
            <span style={{ color: ARIA.textMuted }}>Intra</span>
            <span style={{ color: o > 0 && c > 0 ? (c >= o ? ARIA.green : ARIA.red) : ARIA.textMuted, fontWeight: 700 }}>{o > 0 && c > 0 ? `${c >= o ? "+" : ""}${((c - o) / o * 100).toFixed(2)}%` : "—"}</span>
          </span>
          <span style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3 }}>
            <span style={{ color: ARIA.textMuted }}>RVol</span>
            <span style={{ color: rvColor, fontWeight: rvol >= 1.5 ? 700 : 400 }}>{rvol != null ? `${rvol.toFixed(1)}x` : "—"}</span>
          </span>
          <span style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3 }}>
            <span style={{ color: ARIA.textMuted }}>ADR</span>
            <span style={{ color: ARIA.cyan }}>{adr != null ? `${adr.toFixed(1)}%` : "—"}</span>
          </span>
          {erCountdown && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(34,211,238,0.1)", border: "1px solid #3a8a9e", color: ARIA.cyan, fontFamily: "monospace", fontWeight: 700 }}>ER {erCountdown}{erTimingRaw ? ` ${erTimingRaw}` : ""}</span>}
          <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && submitTicker()} placeholder="Ticker" style={{ width: 60, fontSize: 9, padding: "2px 6px", background: ARIA.bg, border: `1px solid ${ARIA.border}`, borderRadius: 3, color: ARIA.textDim, fontFamily: "monospace", textTransform: "uppercase", outline: "none" }} />
        </div>
      </div>

      {/* Performance row */}
      {(() => {
        const firstClose = ohlcBars.length > 1 ? ohlcBars[0]?.close : null;
        const lastClose  = ohlcBars.length > 1 ? ohlcBars[ohlcBars.length - 1]?.close : null;
        const ipoDate    = stockInfo?.ipo_date;
        const ipoDaysAgo = ipoDate ? Math.floor((Date.now() - new Date(ipoDate).getTime()) / 86400000) : null;
        const ipoLabel   = ipoDaysAgo != null && ipoDaysAgo <= 910 ? "IPO" : "2.5Y";
        const ipoPerf    = firstClose && lastClose && firstClose > 0
          ? ((lastClose - firstClose) / firstClose) * 100
          : null;
        const perfs = [
          { label: "1M",     val: stockInfo?.return_1m },
          { label: "3M",     val: stockInfo?.return_3m },
          { label: "6M",     val: stockInfo?.return_6m },
          { label: "1Y",     val: stockInfo?.return_1y },
          { label: ipoLabel, val: ipoPerf },
        ];
        const perfColor = (v) =>
          v == null ? ARIA.textMuted
          : v >= 50  ? "#0d9163"
          : v >= 20  ? "#22a37a"
          : v >= 0   ? "#5a9a6a"
          : v >= -20 ? "#a06030"
          : "#c04040";
        return (
          <div style={{ padding: "3px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${ARIA.border}`, flexWrap: "wrap" }}>
            {/* Left: theme tags */}
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              {stockInfo.themes?.length > 0 && stockInfo.themes.slice(0, 5).map((t, i) => (
                <span key={`th${i}`} style={{ fontSize: 8, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "rgba(251,191,36,0.12)", border: "1px solid #a07a1f", color: "#fbbf24", textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>
                  {t.subtheme || t.theme}
                </span>
              ))}
              {stockInfo.sector && !stockInfo.themes?.some(t => t.theme === stockInfo.sector) && (
                <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "rgba(108,213,232,0.12)", border: "1px solid #3a8a9e", color: "#6cd5e8", textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>
                  {stockInfo.sector}
                </span>
              )}
            </div>
            {/* Right: grade + perf metrics */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0, flexWrap: "wrap" }}>
            {grade && (
              <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: gradeColor + "22", border: `1px solid ${gradeColor}55`, color: gradeColor }}>
                {grade}
              </span>
            )}
            {perfs.map(({ label, val }) => (
              <span key={label} style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3 }}>
                <span style={{ color: ARIA.textMuted }}>{label}</span>
                <span style={{ color: perfColor(val), fontWeight: val != null && Math.abs(val) >= 20 ? 700 : 400 }}>
                  {val != null ? `${val >= 0 ? "+" : ""}${val.toFixed(1)}%` : "—"}
                </span>
              </span>
            ))}
            {fromHi != null && (
              <span style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3 }}>
                <span style={{ color: ARIA.textMuted }}>52W</span>
                <span style={{ color: fromHi >= -5 ? ARIA.green : fromHi >= -15 ? ARIA.yellow : ARIA.red, fontWeight: 700 }}>
                  {fromHi > 0 ? "+" : ""}{fromHi.toFixed(1)}%
                </span>
              </span>
            )}
            {(() => { const str = ticker && tickerStrengthMap?.[ticker]; return str != null ? (
              <span style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3 }}>
                <span style={{ color: ARIA.textMuted }}>Str</span>
                <span style={{ color: str >= 65 ? ARIA.green : str >= 50 ? ARIA.blue : str >= 35 ? ARIA.yellow : ARIA.textDim, fontWeight: 700 }}>
                  {str}
                </span>
              </span>
            ) : null; })()}
            </div>
          </div>
        );
      })()}

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

      {/* News + Notes — two-column row */}
      {(() => {
        const tickerNote = sheetNotes?.[ticker] || "";
        const sheetLoaded = sheetNotes !== null;
        const hasNews = news.length > 0;
        if (!hasNews && !sheetLoaded) return null;
        return (
          <div style={{ display: "flex", maxHeight: 90, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {/* Left: News */}
            <div style={{ flex: 1, padding: "4px 14px 2px", overflowY: "auto", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
              {hasNews ? news.slice(0, 4).map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", fontSize: 8.5, color: "#9090a0", textDecoration: "none", padding: "3px 0", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#c0c0d8"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#9090a0"; e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ color: "#5a5a6a", marginRight: 4 }}>{agoLabel(a.date)}</span>
                  {a.headline}
                  <span style={{ color: "#6a6a7a", marginLeft: 4 }}>{a.source}</span>
                </a>
              )) : <span style={{ fontSize: 8, color: "#5a5a6a" }}>No news</span>}
            </div>
            {/* Right: ETF holdings (if ETF) or peers (if equity) */}
            <div style={{ width: 220, flexShrink: 0, padding: "4px 10px 2px", overflowY: "auto" }}>
              {etfHoldings.length > 0 ? (
                <>
                  <div style={{ fontSize: 7, color: "#5a5a6a", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Top Holdings</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {etfHoldings.map(h => (
                      <button key={h.ticker} onClick={() => onTickerChange?.(h.ticker)}
                        title={`${h.name} — ${h.weight}%`}
                        style={{ background: "#141420", border: "1px solid #222230", borderRadius: 3, padding: "1px 5px", cursor: "pointer", display: "flex", gap: 4, alignItems: "center" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 700, color: "#c8c8d8" }}>{h.ticker}</span>
                        <span style={{ fontFamily: "monospace", fontSize: 8, color: "#5a5a7a" }}>{h.weight}%</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : peers.length > 0 ? (
                <>
                  <div style={{ fontSize: 7, color: "#5a5a6a", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Peers</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {peers.map(p => (
                      <button key={p} onClick={() => onTickerChange?.(p)}
                        style={{ background: "#141420", border: "1px solid #222230", borderRadius: 3, padding: "1px 5px", cursor: "pointer" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 700, color: "#c8c8d8" }}>{p}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 8, color: "#3a3a4a", fontStyle: "italic", marginTop: 4 }}>—</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Header row 2: CANSLIM stats line (Aria-faithful) */}
      <div
        style={{
          padding: "0 14px 4px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          fontSize: 9,
          fontFamily: "monospace",
          borderBottom: `1px solid ${ARIA.border}`,
        }}
      >
        {mo && (
          <span
            style={badgeStyle(mo.hot ? "#f59e0b" : ARIA.blue)}
            title={`${mo.hot ? "Super-growth " : ""}Minervini / O'Neill ✓ — EPS YoY ${mo.epsYoy.toFixed(0)}%, Sales YoY ${mo.salesYoy.toFixed(0)}%, Margin ${mo.margin.toFixed(1)}%`}
          >
            EPS
          </span>
        )}
        {erCountdown && (
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
            <span style={{ color: ARIA.textMuted }}>ER</span>
            <span style={{ color: ARIA.textDim }}>{erCountdown}{erTimingRaw ? ` ${erTimingRaw}` : ""}</span>
          </span>
        )}
        <CSStat label="EPS" v={epsYoy} clr={csClr(epsYoy)} ARIA={ARIA} />
        <CSStat label="Prev" v={epsYoyPrev} clr={csClr(epsYoyPrev)} ARIA={ARIA} />
        <CSStat label="Surp" v={epsSurprise} clr={csClr(epsSurprise)} ARIA={ARIA} />
        <span style={{ color: ARIA.border }}>|</span>
        <CSStat label="Sales" v={salesYoy} clr={csClr(salesYoy)} ARIA={ARIA} />
        <CSStat label="Prev" v={salesYoyPrev} clr={csClr(salesYoyPrev)} ARIA={ARIA} />
        <CSStat label="Surp" v={salesSurprise} clr={csClr(salesSurprise)} ARIA={ARIA} />
        <span style={{ color: ARIA.border }}>|</span>
        <CSStat label="EPS Y" v={epsThisY} clr={csClr(epsThisY)} ARIA={ARIA} />
        <CSStat label="5Y" v={eps5y} clr={csClr(eps5y)} ARIA={ARIA} />
        <CSStat label="Sales 5Y" v={sales5y} clr={csClr(sales5y)} ARIA={ARIA} />
        <span style={{ color: ARIA.border }}>|</span>
        <CSStat
          label="Margin"
          v={margin}
          clr={
            margin == null
              ? ARIA.textMuted
              : margin >= 20
              ? ARIA.green
              : margin > 0
              ? ARIA.textDim
              : ARIA.red
          }
          ARIA={ARIA}
        />
        <CSStat
          label="ROE"
          v={roe}
          clr={
            roe == null
              ? ARIA.textMuted
              : roe >= 25
              ? ARIA.green
              : roe >= 17
              ? ARIA.blue
              : roe > 0
              ? ARIA.textDim
              : ARIA.red
          }
          ARIA={ARIA}
        />
        <CSStat
          label="ROIC"
          v={roic}
          clr={
            roic == null
              ? ARIA.textMuted
              : roic >= 20
              ? ARIA.green
              : roic >= 12
              ? ARIA.blue
              : roic > 0
              ? ARIA.textDim
              : ARIA.red
          }
          ARIA={ARIA}
        />
        <span
          title={
            instTrans != null
              ? `Institutional sponsorship — QoQ change in holdings (Minervini's "increasing sponsorship" signal).${instOwn != null ? ` Current Inst Own: ${instOwn.toFixed(1)}%` : ""}`
              : "Institutional sponsorship data not available for this ticker (scraper covers top 500 by RS rank)"
          }
          style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}
        >
          <span style={{ color: ARIA.textMuted, fontSize: 8 }}>Inst</span>{" "}
          <span
            style={{
              fontWeight: 700,
              color:
                instTrans == null
                  ? ARIA.textMuted
                  : instTrans >= 1
                  ? ARIA.green
                  : instTrans > 0
                  ? ARIA.blue
                  : instTrans > -1
                  ? ARIA.textDim
                  : ARIA.red,
            }}
          >
            {instTrans == null
              ? "—"
              : `${instTrans >= 0 ? "+" : ""}${instTrans.toFixed(2)}%`}
          </span>
        </span>
        {stockInfo.ipo_date && (
          <>
            <span style={{ color: ARIA.border }}>|</span>
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
              <span style={{ color: ARIA.textMuted, fontSize: 8 }}>IPO</span>{" "}
              <span style={{ fontWeight: 700, color: ARIA.textDim }}>{stockInfo.ipo_date}</span>
            </span>
          </>
        )}
        <span style={{ color: ARIA.border }}>|</span>
        <button
          onClick={() => setShowTrade(t => !t)}
          style={{
            fontSize: 8, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
            background: showTrade ? "#0d9163" : "transparent",
            border: "1px solid #0d9163",
            color: showTrade ? "#fff" : "#0d9163",
            fontFamily: "monospace", fontWeight: 700,
          }}
        >
          TRADE
        </button>
        {magna != null && (
          <>
            <span style={{ color: ARIA.border }}>|</span>
            <span>
              <span style={{ color: ARIA.textMuted, fontSize: 8 }}>MAGNA</span>{" "}
              <span
                style={{
                  fontWeight: 700,
                  color:
                    magna >= 80
                      ? ARIA.green
                      : magna >= 60
                      ? ARIA.blue
                      : magna >= 40
                      ? ARIA.textDim
                      : ARIA.textMuted,
                }}
              >
                {magna}
              </span>
            </span>
          </>
        )}
      </div>


      {/* SVG Daily Chart */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <ErrorBoundary>
          <DailyChartSVG
            ohlc={ohlcBars}
            quarters={quarters}
            height={height}
            stopLines={showTrade && riskScenarios ? [
              { price: riskScenarios.tight?.stopPrice, color: "#ef4444", label: "0.5x", dashed: true },
              { price: riskScenarios.base?.stopPrice,  color: "#f97316", label: "1x",   dashed: true },
              { price: riskScenarios.wide?.stopPrice,  color: "#f59e0b", label: "2x",   dashed: true },
              { price: riskDayLow,                     color: "#9ca3af", label: "LOD",  dashed: false },
              { price: riskPDL,                        color: "#fb923c", label: "PDL",  dashed: true },
            ].filter(sl => sl.price > 0) : []}
          />
        </ErrorBoundary>
      </div>

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
        const effectiveQuarters = quarters.length > 0 ? quarters : normPipelineQ(stockInfo?.quarters);
        const effectiveAnnuals  = annuals.length  > 0 ? annuals  : normPipelineA(stockInfo?.annual);
        const baseSeries = qbarsMode === "annual" ? effectiveAnnuals : effectiveQuarters;
        const modeLabel = qbarsMode === "annual" ? "annual" : "quarterly";
        const series = baseSeries.map((p, i, arr) => {
          const prevMargin = i > 0 ? arr[i - 1].net_margin : null;
          const marginDelta =
            p.net_margin != null && prevMargin != null
              ? p.net_margin - prevMargin
              : null;
          if (i < 2) return { ...p, _code33: false, _marginDelta: marginDelta };
          const a = arr[i - 2], b = arr[i - 1], c = p;
          const accel = (x, y, z) =>
            x != null && y != null && z != null && z > y && y > x;
          const c33 =
            accel(a.eps_yoy, b.eps_yoy, c.eps_yoy) &&
            accel(a.revenue_yoy, b.revenue_yoy, c.revenue_yoy) &&
            accel(a.net_margin, b.net_margin, c.net_margin);
          return { ...p, _code33: c33, _marginDelta: marginDelta };
        });
        if (series.length === 0) return null;
        return (
          <div style={{ padding: "6px 14px 10px", borderTop: `1px solid ${ARIA.border}`, background: ARIA.glass || "transparent" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontFamily: "monospace" }}>
              <span style={{ fontSize: 8, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
                Last {series.length} Quarter{series.length === 1 ? "" : "s"} · {quarters.length > 0 ? "Finviz Actuals" : "Pipeline Data"}
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
                <MiniQBars quarters={series} accessor={(q) => q.ocf_ps} yoyAccessor={(q) => q.ocf_yoy} color={ARIA.yellow} labelFmt={(v) => v.toFixed(2)} title="Op Cash Flow/sh" ARIA={ARIA} passYoy={25} hotYoy={40} />
              </div>
              <CanslimScorecard ticker={ticker} stockInfo={stockInfo} cfVsEpsPct={series[series.length - 1]?.cf_vs_eps_pct ?? null} annuals={effectiveAnnuals} stockMap={stockMap} ARIA={ARIA} />
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
  { key: "rs", label: "RS" },
  { key: "cr", label: "CR%" },
  { key: "chgOpen", label: "Open%" },
];

// Sortable + keyboard-navigable table for one watchlist/portfolio section.
// Extracted from Watchlist so it can use hooks (sort + selection state).
function WatchlistSectionTable({
  rows,
  accent,
  list,
  onAddInput,
  onAddSubmit,
  addInput,
  count,
  onTickerClick,
  removeTicker,
  focusTickers,
  toggleFocus,
  tickerStrengthMap,
  onChainClick,
}) {
  const ARIA = useAriaTheme();
  const [sortKey, setSortKey] = useState("change");
  const [sortDir, setSortDir] = useState("desc"); // "asc" | "desc"
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [pinStars, setPinStars] = useState(false);
  const wrapRef = React.useRef(null);

  const colorChg = (v) =>
    v == null ? ARIA.textMuted : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textMuted;
  const fmtChg = (v) =>
    v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";

  // Sort rows. "ticker" + "subtheme" sort as strings, everything else numeric.
  const sortedRows = useMemo(() => {
    const arr = rows.slice();
    arr.sort((a, b) => {
      // Focus tickers float to top only when pinStars is on
      if (pinStars) {
        const af = focusTickers?.has(a.ticker) ? 0 : 1;
        const bf = focusTickers?.has(b.ticker) ? 0 : 1;
        if (af !== bf) return af - bf;
      }
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === "ticker" || sortKey === "subtheme" || sortKey === "chain") {
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
  }, [rows, sortKey, sortDir, focusTickers]);

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

  const headers = [
    { k: "ticker", label: "Ticker", align: "left" },
    { k: "strScore", label: "Str" },
    { k: "change", label: "Chg%" },
    { k: "rvol", label: "RV" },
    { k: "liveVol", label: "Vol" },
    { k: "cr", label: "CR%" },
    { k: "adr", label: "ADR" },
    { k: "rs", label: "RS" },
    { k: "chain", label: "Chain", align: "left" },
    { k: "subtheme", label: "Sub", align: "left" },
    { k: null, label: "" },
  ];

  return (
    <div style={{ padding: "6px 8px", borderBottom: `1px solid ${ARIA.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span
          style={{
            color: accent,
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {list === "portfolio" ? "Portfolio" : "Watchlist"}
        </span>
        <span style={{ color: ARIA.textMuted, fontSize: 9 }}>({count})</span>
        {focusTickers?.size > 0 && (
          <button
            onClick={() => setPinStars((v) => !v)}
            title={pinStars ? "Unpin starred — show in sort order" : "Pin starred to top"}
            style={{
              fontSize: 8,
              padding: "1px 5px",
              borderRadius: 3,
              cursor: "pointer",
              background: pinStars ? "rgba(251,191,36,0.15)" : "transparent",
              border: `1px solid ${pinStars ? "#fbbf24" : ARIA.border}`,
              color: pinStars ? "#fbbf24" : ARIA.textMuted,
              lineHeight: 1.4,
            }}
          >
            ★ {pinStars ? "pinned" : "unpinned"}
          </button>
        )}
        <input
          value={addInput}
          onChange={(e) => onAddInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && onAddSubmit()}
          placeholder="Add..."
          style={{
            marginLeft: "auto",
            width: 50,
            fontSize: 9,
            padding: "1px 4px",
            background: ARIA.bg,
            border: `1px solid ${ARIA.border}`,
            borderRadius: 3,
            color: ARIA.textDim,
            fontFamily: "monospace",
            textTransform: "uppercase",
            outline: "none",
          }}
        />
        <button
          onClick={onAddSubmit}
          style={{
            fontSize: 9,
            padding: "1px 5px",
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
      {sortedRows.length === 0 ? (
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
                  v == null
                    ? ARIA.textMuted
                    : v >= 70
                    ? ARIA.green
                    : v >= 40
                    ? ARIA.textDim
                    : ARIA.red;
                const isSel = selectedTicker === r.ticker;
                const isFocus = focusTickers?.has(r.ticker);
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
                      background: isSel ? `${ARIA.cyan}26` : isFocus ? "rgba(251,191,36,0.07)" : "transparent",
                      borderLeft: isFocus ? "2px solid #fbbf24" : "2px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSel) e.currentTarget.style.background = isFocus ? "rgba(251,191,36,0.12)" : ARIA.bgHover;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isSel
                        ? `${ARIA.cyan}26`
                        : isFocus ? "rgba(251,191,36,0.07)" : "transparent";
                    }}
                  >
                    <td style={{ ...cell, textAlign: "left", fontWeight: 700, color: isFocus ? "#fbbf24" : ARIA.text }}>
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
                      </span>
                    </td>
                    <td style={{ ...cell, color: r.strScore >= 65 ? ARIA.green : r.strScore >= 50 ? ARIA.blue : r.strScore >= 35 ? ARIA.yellow : ARIA.textDim, fontWeight: 700 }}>
                      {r.strScore != null ? r.strScore : "—"}
                    </td>
                    <td style={{ ...cell, color: colorChg(r.change) }}>{fmtChg(r.change)}</td>
                    <td style={{ ...cell, color: colorRvol(r.rvol) }}>
                      {r.rvol > 0 ? r.rvol.toFixed(1) + "x" : "—"}
                    </td>
                    <td style={{ ...cell, color: ARIA.textDim, fontSize: 8 }}>
                      {fmtVol(r.liveVol)}
                    </td>
                    <td style={{ ...cell, color: colorCr(r.cr) }}>
                      {r.cr != null ? r.cr + "%" : "—"}
                    </td>
                    <td style={{ ...cell, color: ARIA.cyan }}>
                      {r.adr ? r.adr.toFixed(1) + "%" : "—"}
                    </td>
                    <td
                      style={{
                        ...cell,
                        color:
                          r.rs >= 80 ? ARIA.green : r.rs >= 60 ? ARIA.blue : ARIA.textMuted,
                      }}
                    >
                      {r.rs || "—"}
                    </td>
                    <td style={{ ...cell, textAlign: "left", padding: "2px 3px", maxWidth: 90 }}>
                      {(() => {
                        const entries = TICKER_CHAIN_MAP.get(r.ticker) || [];
                        if (!entries.length) return <span style={{ color: ARIA.textMuted, fontSize: 7 }}>—</span>;
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
                                    fontSize: 6,
                                    color: c.color,
                                    cursor: onChainClick ? "pointer" : "default",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    maxWidth: 90,
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
                        ...cell,
                        textAlign: "left",
                        color: ARIA.cyan,
                        fontSize: 7,
                        maxWidth: 80,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={r.subtheme}
                    >
                      {r.subtheme || "—"}
                    </td>
                    <td style={{ ...cell, padding: "2px 4px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFocus && toggleFocus(r.ticker);
                          }}
                          title={isFocus ? "Remove focus" : "Mark as focus"}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: isFocus ? "#fbbf24" : ARIA.textMuted,
                            cursor: "pointer",
                            fontSize: 10,
                            padding: 0,
                            lineHeight: 1,
                            opacity: isFocus ? 1 : 0.4,
                          }}
                        >
                          ★
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeTicker(list, r.ticker);
                          }}
                          title="Remove"
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
                      </span>
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
  const [focusTickers, setFocusTickers] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("themepulse-focus") || "[]")); }
    catch { return new Set(); }
  });
  const toggleFocus = useCallback((ticker) => {
    setFocusTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
      localStorage.setItem("themepulse-focus", JSON.stringify([...next]));
      return next;
    });
  }, []);
  const [pInput, setPInput] = useState("");
  const [wInput, setWInput] = useState("");
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

  const addPortfolio = useCallback(() => {
    const t = pInput.trim().toUpperCase();
    if (!t) return;
    setPortfolio((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setPInput("");
  }, [pInput]);
  const addWatchlist = useCallback(() => {
    const t = wInput.trim().toUpperCase();
    if (!t) return;
    setWatchlist((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setWInput("");
  }, [wInput]);
  const removeTicker = useCallback((list, t) => {
    if (list === "portfolio") {
      setPortfolio((prev) => prev.filter((x) => x !== t));
    } else {
      setWatchlist((prev) => prev.filter((x) => x !== t));
    }
  }, []);

  // Live quotes for all unique tickers
  const allTickers = useMemo(() => {
    const set = new Set([...portfolio, ...watchlist]);
    return Array.from(set);
  }, [portfolio, watchlist]);
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
      return {
        ticker,
        price,
        change,
        chg: change, // alias for ScanWatchTable
        chgOpen,
        cr,
        rvol,
        liveVol,
        adr: s.adr_pct || 0,
        qmagScore: s.qmag_score || 0,
        strScore: tickerStrengthMap?.[ticker] ?? null,
        is9m: !!(liveVol && liveVol >= 8.9e6 && (avgVol || 0) < 8.9e6),
        rs: s.rs_rank || 0,
        accel: s.accel || 0,
        grade: s.grade || "",
        theme: (s.themes && s.themes[0] && s.themes[0].theme) || s.sector || "",
        subtheme:
          (s.themes && s.themes[0] && s.themes[0].subtheme) || s.industry || "",
      };
    },
    [stockMap, quotes]
  );

  const portRows = useMemo(
    () => portfolio.map(buildRow),
    [portfolio, buildRow]
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
    v == null ? ARIA.textMuted : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textMuted;
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
            addInput={pInput}
            onAddInput={setPInput}
            onAddSubmit={addPortfolio}
            onTickerClick={onTickerClick}
            removeTicker={removeTicker}
            focusTickers={focusTickers}
            toggleFocus={toggleFocus}
            tickerStrengthMap={tickerStrengthMap}
            onChainClick={onChainClick}
          />
          <WatchlistSectionTable
            rows={chgPosFilter ? watchRows.filter((r) => (r.change || 0) > 0) : watchRows}
            accent={ARIA.green}
            list="watchlist"
            count={watchlist.length}
            addInput={wInput}
            onAddInput={setWInput}
            onAddSubmit={addWatchlist}
            onTickerClick={onTickerClick}
            removeTicker={removeTicker}
            focusTickers={focusTickers}
            toggleFocus={toggleFocus}
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
              value={wInput}
              onChange={(e) => setWInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && addWatchlist()}
              placeholder="+ ticker"
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
              onClick={addWatchlist}
              style={pillStyle(true, ARIA.green)}
            >
              +WL
            </button>
            <button
              onClick={() => {
                const t = wInput.trim().toUpperCase();
                if (!t) return;
                setPortfolio((prev) =>
                  prev.includes(t) ? prev : [...prev, t]
                );
                setWInput("");
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
        <PeersRow ticker={ticker} peers={peers} onTickerClick={onTickerClick} ARIA={ARIA} stockMap={stockMap} liveEarningsDate={liveEarningsDate} />
      )}
    </div>
  );
}

function PipelineLiveBar({ pipelineMeta }) {
  const ARIA = useAriaTheme();
  const spyTickers = useMemo(() => ["SPY"], []);
  const { quotes } = useLiveQuotes(spyTickers, 30000);
  const spy = quotes.get("SPY");

  // Pipeline relative time
  let pipelineText = "";
  const lr = pipelineMeta?.last_run;
  if (lr) {
    const d = new Date(lr);
    if (!isNaN(d)) {
      const diffM = Math.round((Date.now() - d.getTime()) / 60000);
      const ago =
        diffM < 1
          ? "just now"
          : diffM < 60
          ? `${diffM}m ago`
          : diffM < 1440
          ? `${Math.floor(diffM / 60)}h ago`
          : `${Math.floor(diffM / 1440)}d ago`;
      const dateStr = d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      pipelineText = `Pipeline: ${dateStr} (${ago})`;
    }
  }

  const spyChg = spy?.change ?? spy?.changePercentage ?? null;
  const spyColor =
    spyChg == null ? ARIA.textMuted : spyChg >= 0 ? ARIA.green : ARIA.red;

  return (
    <div
      style={{
        padding: "3px 10px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 8,
        fontFamily: "monospace",
      }}
    >
      {pipelineText && (
        <span style={{ color: ARIA.green, fontWeight: 600 }}>{pipelineText}</span>
      )}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: spy ? ARIA.green : "#555",
            display: "inline-block",
          }}
        />
        <span style={{ color: spyColor }}>
          Live: SPY{" "}
          {spyChg != null
            ? (spyChg >= 0 ? "+" : "") + Number(spyChg).toFixed(2) + "%"
            : "—"}
        </span>
      </span>
    </div>
  );
}

function ChartScanRow({
  chartTicker,
  handleTickerClick,
  stockMap,
  themeHealth,
  stocks,
  pipelineMeta,
  tickerStrengthMap,
}) {
  // Default 320px to match Aria's #sw-column initial width.
  const [scanW, setScanW] = useState(() => {
    const saved = parseFloat(localStorage.getItem("themepulse-scan-width") || "");
    return Number.isFinite(saved) && saved >= 150 && saved <= 900 ? saved : 400;
  });
  const rowRef = React.useRef(null);
  useEffect(() => {
    localStorage.setItem("themepulse-scan-width", String(scanW));
  }, [scanW]);
  const startDrag = useCallback((e) => {
    e.preventDefault();
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    function onMove(ev) {
      // Right column width = distance from right edge of row to mouse
      const w = rect.right - (ev.clientX || 0);
      setScanW(Math.max(150, Math.min(900, w)));
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
      <div style={{ flex: 1, minWidth: 0 }}>
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
        width: scanW, flexShrink: 0, minWidth: 150,
        display: "flex", flexDirection: "column",
        // Pin to viewport so the watchlist/scan stays visible when the
        // left chart panel scrolls past the fold
        position: "sticky", top: 0, alignSelf: "flex-start",
        maxHeight: "100vh", overflowY: "auto",
      }}>
        <PipelineLiveBar pipelineMeta={pipelineMeta} />
        <ThemeIntelPanel onTickerClick={handleTickerClick} />
        <SupercycleMap chartTicker={chartTicker} onTickerClick={handleTickerClick} />
        <EarningsCalendar stocks={stocks} stockMap={stockMap} onTickerClick={handleTickerClick} chartTicker={chartTicker} />
        <DrawerThemes onTickerClick={handleTickerClick} chartTicker={chartTicker} stockMap={stockMap} tickerStrengthMap={tickerStrengthMap} onLayerClick={handleLayerClick} activeFilterNames={chainFilters.map((f) => f.name)} />
        <ScanWatch stocks={stocks} onTickerClick={handleTickerClick} chartTicker={chartTicker} stockMap={stockMap} themeHealth={themeHealth} tickerStrengthMap={tickerStrengthMap} chainFilters={chainFilters} clearChainFilters={() => setChainFilters([])} removeChainFilter={(name) => setChainFilters((p) => p.filter((f) => f.name !== name))} onLayerClick={handleLayerClick} />
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

  // stockMap depends on data.pipeline.stocks. Compute it BEFORE the early
  // returns so the hook count is stable across loading→loaded transitions.
  const stocks = data.pipeline?.stocks || [];
  const stockMap = useMemo(() => {
    const m = {};
    stocks.forEach((s) => {
      if (s.ticker) m[s.ticker] = s;
    });
    return m;
  }, [stocks]);

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
        background: ARIA.bg,
        color: ARIA.text,
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
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
          style={{
            fontSize: 16,
            fontWeight: 800,
            background: `linear-gradient(135deg, ${ARIA.green}, ${ARIA.cyan})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: -0.3,
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
        {/* Top: Market Breadth Bar (full width) */}
        <MarketBreadthBar stocks={stocks} onTickerClick={handleTickerClick} />

        {/* Charts + Scan Watch row — chart left (flex 1), draggable divider, Scan Watch right (resizable) */}
        <ChartScanRow
          chartTicker={chartTicker}
          handleTickerClick={handleTickerClick}
          stockMap={stockMap}
          themeHealth={data.pipeline?.theme_health || []}
          stocks={stocks}
          pipelineMeta={data.pipeline?.pipeline_meta}
          tickerStrengthMap={tickerStrengthMap}
        />

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
  { theme: "AI Infra", themeId: "ai", layer: "Compute Silicon", tickers: ["NVDA","AMD","AVGO","INTC","MRVL","ARM","ALAB","TSM"] },
  { theme: "AI Infra", themeId: "ai", layer: "AI Connectivity", tickers: ["ALAB","CRDO","MRVL","AAOI","MXL","AVGO"] },
  { theme: "AI Infra", themeId: "ai", layer: "Networking + Components", tickers: ["ANET","CSCO","CIEN","APH","TEL","CLS","JBL"] },
  { theme: "AI Infra", themeId: "ai", layer: "Memory + Storage", tickers: ["MU","SNDK","WDC","STX","RMBS","SIMO"] },
  { theme: "AI Infra", themeId: "ai", layer: "DC + Cooling", tickers: ["DLR","EQIX","VRT","EME","SMCI","DELL","HPE","ETN","MOD","NVT","CARR","JCI","FIX"] },
  { theme: "AI Infra", themeId: "ai", layer: "Photonics", tickers: ["AAOI","CIEN","COHR","FN","CRDO","LITE","VIAV","AXTI","MTSI","POET","LWLG","SIVEF"] },
  { theme: "AI Infra", themeId: "ai", layer: "Neoclouds + Hyperscalers", tickers: ["MSFT","GOOGL","AMZN","META","ORCL","NBIS","IREN","CRWV","APLD","WULF","HUT","CORZ"] },
  { theme: "AI Infra", themeId: "ai", layer: "Power Generation (IPPs)", tickers: ["VST","CEG","TLN","NRG","NEE"] },
  { theme: "AI Infra", themeId: "ai", layer: "Grid Equipment + EPC", tickers: ["AGX","DY","EME","GEV","ETN","PWR","MYRG","PRIM"] },
  { theme: "AI Infra", themeId: "ai", layer: "Nuclear / SMR", tickers: ["OKLO","SMR","NNE","BWXT"] },
  { theme: "AI Infra", themeId: "ai", layer: "Energy Storage + Fuel Cell", tickers: ["BE","EOSE"] },
  { theme: "AI Infra", themeId: "ai", layer: "Semicap + Materials", tickers: ["AMAT","LRCX","ASML","KLAC","MKSI","ENTG"] },
  { theme: "Software", themeId: "software", layer: "AI Agents + Apps", tickers: ["PLTR","NOW","CRM","AI","BBAI","SOUN","PATH","IOT"] },
  { theme: "Software", themeId: "software", layer: "Data Platforms", tickers: ["SNOW","MDB","DDOG","ESTC","CFLT","TDC"] },
  { theme: "Software", themeId: "software", layer: "Enterprise SaaS", tickers: ["INTU","ADBE","WDAY","VEEV","HUBS","SAP","IBM"] },
  { theme: "Software", themeId: "software", layer: "DevOps + Observability", tickers: ["DDOG","GTLB","TEAM","FROG","PD","SWI","ESTC"] },
  { theme: "Software", themeId: "software", layer: "Collab + Productivity", tickers: ["ASAN","MNDY","ZM","DOCU","BOX","SMAR","RNG"] },
  { theme: "Software", themeId: "software", layer: "Vertical SaaS", tickers: ["TYL","GWRE","MANH","PCOR","OLO","CCC","VERX"] },
  { theme: "Software", themeId: "software", layer: "CDN + Edge Cloud", tickers: ["NET","FSLY","AKAM"] },
  { theme: "Software", themeId: "software", layer: "Gaming", tickers: ["TTWO","EA","RBLX","NTES","U"] },
  { theme: "Software", themeId: "software", layer: "E-Commerce", tickers: ["SHOP","MELI","SE","ETSY","BABA","JD","PDD","CHWY"] },
  { theme: "Cyber", themeId: "cyber", layer: "Platform + Endpoint", tickers: ["PANW","CRWD","FTNT","ZS","S","GEN"] },
  { theme: "Cyber", themeId: "cyber", layer: "Identity + Access", tickers: ["OKTA","CYBR","SAIL","OSPN","LAES"] },
  { theme: "Cyber", themeId: "cyber", layer: "Cloud + Network Sec", tickers: ["ZS","NET","AKAM","CHKP","RDWR","RBRK"] },
  { theme: "Cyber", themeId: "cyber", layer: "Threat Operations", tickers: ["TENB","QLYS","RPD","VRNS"] },
  { theme: "Cyber", themeId: "cyber", layer: "Defense Cyber", tickers: ["BAH","CACI","SAIC","LDOS"] },
  { theme: "Fintech", themeId: "fintech", layer: "Crypto Infra + Exchanges", tickers: ["COIN","MSTR","HOOD","GLXY"] },
  { theme: "Fintech", themeId: "fintech", layer: "Crypto Miners", tickers: ["MARA","RIOT","CLSK","CIFR","IREN","WULF","HUT","CORZ","BTDR","BITF"] },
  { theme: "Fintech", themeId: "fintech", layer: "Bitcoin ETFs", tickers: ["IBIT","FBTC","BITB","BITO","BITW","GBTC","BRRR"] },
  { theme: "Fintech", themeId: "fintech", layer: "Neobanks + Digital", tickers: ["SOFI","NU","ALLY","HOOD","LC","DAVE","KSPI"] },
  { theme: "Fintech", themeId: "fintech", layer: "Payments", tickers: ["V","MA","PYPL","SQ","AFRM","FOUR","TOST","PAGS","DLO"] },
  { theme: "Fintech", themeId: "fintech", layer: "Asset Mgmt + Trading", tickers: ["SCHW","BLK","KKR","BX","IBKR","FUTU","TIGR","RJF","MS","GS","EVR","PIPR","LAZ","JEF","MC"] },
  { theme: "Defense", themeId: "defense", layer: "Prime Contractors", tickers: ["LMT","RTX","NOC","GD","BA","LHX","HII","TDG","GE","HEI","TXT","TDY","VSEC","MRCY"] },
  { theme: "Defense", themeId: "defense", layer: "Aerospace Aftermarket", tickers: ["FTAI","HWM","WWD","LOAR","HXL","TDG","HEI"] },
  { theme: "Defense", themeId: "defense", layer: "Drones + EVTOL", tickers: ["AVAV","KTOS","ONDS","RCAT","UMAC","ACHR","JOBY","EH","EVTL","PDYN"] },
  { theme: "Defense", themeId: "defense", layer: "Space Defense", tickers: ["RKLB","ASTS","LUNR","GSAT","IRDM","BKSY","PL","BWXT"] },
  { theme: "Defense", themeId: "defense", layer: "Autonomous + AI Defense", tickers: ["PLTR","LDOS","BBAI","BAH","CACI","SAIC"] },
  { theme: "Defense", themeId: "defense", layer: "Cyber Defense", tickers: ["BAH","CACI","LDOS","SAIC"] },
  { theme: "Defense", themeId: "defense", layer: "Weapons + Munitions", tickers: ["AXON","GD","LHX","RTX","RGR","SWBI"] },
  { theme: "Robotics", themeId: "robotics", layer: "Humanoid", tickers: ["TSLA","NVDA"] },
  { theme: "Robotics", themeId: "robotics", layer: "Industrial Automation", tickers: ["EMR","ETN","ROK","NDSN","NNDM","SYM"] },
  { theme: "Robotics", themeId: "robotics", layer: "Service + Delivery", tickers: ["SERV","RR","KSCP"] },
  { theme: "Robotics", themeId: "robotics", layer: "Machine Vision + LiDAR", tickers: ["CGNX","AEVA","OUST","LAZR","MVIS","HSAI","INVZ","LIDR"] },
  { theme: "Robotics", themeId: "robotics", layer: "AV + Self-Driving", tickers: ["TSLA","MBLY","AUR","GOOGL"] },
  { theme: "Robotics", themeId: "robotics", layer: "Medical Robotics", tickers: ["ISRG","SYK","MDT","STXS"] },
  { theme: "Robotics", themeId: "robotics", layer: "Warehouse + Logistics", tickers: ["AMZN","SYM","GXO","SERV"] },
  { theme: "EV", themeId: "ev", layer: "Makers", tickers: ["TSLA","RIVN","F","GM","NIO","LI","XPEV"] },
  { theme: "EV", themeId: "ev", layer: "Batteries + Cells", tickers: ["ABAT","AMPX","ENVX","QS","SLDP","MVST"] },
  { theme: "EV", themeId: "ev", layer: "Battery Materials", tickers: ["ALB","SQM","LAC","MP","LITM"] },
  { theme: "EV", themeId: "ev", layer: "Charging Infra", tickers: ["SHLS","BLNK","CHPT"] },
  { theme: "EV", themeId: "ev", layer: "LiDAR + Sensing", tickers: ["HSAI","INVZ","LIDR","LAZR","MVIS","AEVA","OUST","MBLY"] },
  { theme: "EV", themeId: "ev", layer: "Auto Parts + Suppliers", tickers: ["APTV","MGA","LEA","WOLF","NVTS","BWA","ALV"] },
  { theme: "Quantum", themeId: "quantum", layer: "Pure-Play Hardware", tickers: ["IONQ","RGTI","QUBT","QBTS"] },
  { theme: "Quantum", themeId: "quantum", layer: "Mega-Cap Quantum", tickers: ["GOOGL","MSFT","AMZN","IBM","NVDA"] },
  { theme: "Quantum", themeId: "quantum", layer: "Software + Algos", tickers: ["ARQQ"] },
  { theme: "Quantum", themeId: "quantum", layer: "Enabling Tech", tickers: ["COHR","FORM","HON","NOVT","POET"] },
  { theme: "Space", themeId: "space", layer: "Launch Vehicles", tickers: ["RKLB"] },
  { theme: "Space", themeId: "space", layer: "Defense Space", tickers: ["LMT","NOC","RTX","BA","LHX","BWXT"] },
  { theme: "Space", themeId: "space", layer: "Earth Observation", tickers: ["PL","BKSY","SPIR"] },
  { theme: "Space", themeId: "space", layer: "Satellites + Connect", tickers: ["ASTS","GSAT","IRDM","VSAT","BKSY"] },
  { theme: "Space", themeId: "space", layer: "Lunar + Deep Space", tickers: ["LUNR","LDOS","LMT"] },
  { theme: "Space", themeId: "space", layer: "Space Infrastructure", tickers: ["BWXT","RDW","GHM"] },
  { theme: "Materials", themeId: "materials", layer: "Rare Earths", tickers: ["MP","USAR","IDR"] },
  { theme: "Materials", themeId: "materials", layer: "Uranium", tickers: ["CCJ","NXE","UEC","DNN","UUUU","LEU"] },
  { theme: "Materials", themeId: "materials", layer: "Lithium", tickers: ["ALB","SQM","LAC","SGML","RIO"] },
  { theme: "Materials", themeId: "materials", layer: "Graphite & Anode", tickers: ["NVX","NMG","WWR"] },
  { theme: "Materials", themeId: "materials", layer: "Copper", tickers: ["FCX","SCCO","TGB","HBM","ERO","BHP"] },
  { theme: "Materials", themeId: "materials", layer: "Steel & Iron", tickers: ["NUE","STLD","CLF","X","CMC","RS","TS","VALE"] },
  { theme: "Materials", themeId: "materials", layer: "Specialty Chemicals", tickers: ["EMN","CE","AVNT","OLN","LYB","TROX","HUN","MTRN"] },
  { theme: "Materials", themeId: "materials", layer: "Fertilizers & Ag", tickers: ["MOS","NTR","CF","FMC","CTVA","IPI"] },
  { theme: "Materials", themeId: "materials", layer: "Precious Metals", tickers: ["NEM","AEM","GOLD","WPM","FNV","AG","HL","EGO","KGC"] },
  { theme: "Materials", themeId: "materials", layer: "Industrial Gases", tickers: ["LIN","APD"] },
  { theme: "Materials", themeId: "materials", layer: "Multi Minerals", tickers: ["CRML","TMRC","UAMY","NVA"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Analog", tickers: ["MPWR","ON","ADI","TXN","NXPI","MCHP","STM","ALGM","AOSL","CRUS","POWI","VSH","SMTC","SITM","SYNA","DIOD"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Compute", tickers: ["NVDA","AMD","ARM","ALAB","MRVL","AVGO","INTC","QCOM","AMBA","LSCC"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Packaging", tickers: ["AMKR","FORM","ONTO","KLIC","COHU","ASX","IMOS"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Glass Substrate", tickers: ["GLW","INTC","AMAT","LRCX","KLAC","CAMT","ONTO","IPGP","COHR"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Foundries", tickers: ["TSM","GFS","UMC","SKYT"] },
  { theme: "Semiconductors", themeId: "semis", layer: "Equipment", tickers: ["AMAT","LRCX","ASML","KLAC","ACLS","TER","NVMI","MKSI","ENTG","VECO","CAMT","AEHR"] },
  { theme: "Healthcare", themeId: "health", layer: "GLP-1 / Metabolic", tickers: ["LLY","NVO","AMGN","VKTX","ALT","RVMD","ETNB","TERN"] },
  { theme: "Healthcare", themeId: "health", layer: "Oncology", tickers: ["TGTX","IBRX","RYTM","REGN","EXEL","LEGN","FTRE","MRNA"] },
  { theme: "Healthcare", themeId: "health", layer: "Genomics / Gene Editing", tickers: ["CRSP","EDIT","NTLA","BEAM","VRTX","RXRX","SDGR","RGEN"] },
  { theme: "Healthcare", themeId: "health", layer: "Diagnostics", tickers: ["DGX","LH","EXAS","NTRA","GH","ICLR"] },
  { theme: "Healthcare", themeId: "health", layer: "Devices", tickers: ["ISRG","BSX","EW","ABT","MDT","SYK","DXCM","PODD"] },
  { theme: "Healthcare", themeId: "health", layer: "Telemedicine / Health IT", tickers: ["TDOC","AMWL","HIMS","DOCS","OSCR","CLOV"] },
  { theme: "Energy", themeId: "energy", layer: "Oil Majors", tickers: ["XOM","CVX","COP","EOG","OXY","FANG","HES"] },
  { theme: "Energy", themeId: "energy", layer: "Oil Services", tickers: ["SLB","HAL","BKR","FTI","NOV","PTEN","LBRT","CHX"] },
  { theme: "Energy", themeId: "energy", layer: "Natural Gas / LNG", tickers: ["EQT","AR","RRC","CHK","LNG","CQP","AROC"] },
  { theme: "Energy", themeId: "energy", layer: "Refining", tickers: ["VLO","MPC","PSX","PARR","DK","CVI","DINO"] },
  { theme: "Energy", themeId: "energy", layer: "Solar", tickers: ["FSLR","ENPH","SEDG","ARRY","NXT","RUN"] },
  { theme: "Energy", themeId: "energy", layer: "Wind / Hydrogen", tickers: ["BEPC","NEE","PLUG","BE","BLDP","FCEL"] },
  { theme: "Internet", themeId: "internet", layer: "Social Media", tickers: ["META","SNAP","PINS","RDDT","MTCH"] },
  { theme: "Internet", themeId: "internet", layer: "E-Commerce", tickers: ["AMZN","SHOP","MELI","SE","ETSY","BABA","JD","PDD","CHWY"] },
  { theme: "Internet", themeId: "internet", layer: "Streaming / Media", tickers: ["NFLX","DIS","WBD","SPOT","PARA","ROKU","FUBO"] },
  { theme: "Internet", themeId: "internet", layer: "Gaming", tickers: ["TTWO","EA","RBLX","NTES","U"] },
  { theme: "Internet", themeId: "internet", layer: "Adtech", tickers: ["TTD","APP","MGNI","CRTO","PUBM","DV"] },
  { theme: "Internet", themeId: "internet", layer: "Sports Betting", tickers: ["DKNG","FLUT","MGM","CZR","PENN","RSI"] },
];

const DRAWER_COLORS = {
  ai:        { bg: "rgba(108,213,232,0.12)", border: "#3a8a9e", color: "#6cd5e8" },
  defense:   { bg: "rgba(251,191,36,0.12)",  border: "#a07a1f", color: "#fbbf24" },
  robotics:  { bg: "rgba(34,211,238,0.12)",  border: "#1a8aa4", color: "#22d3ee" },
  ev:        { bg: "rgba(109,222,142,0.12)", border: "#2c5e3e", color: "#6dde8e" },
  quantum:   { bg: "rgba(184,106,252,0.12)", border: "#5a3e8e", color: "#b86afc" },
  space:     { bg: "rgba(106,158,255,0.12)", border: "#3a5a8a", color: "#6a9eff" },
  software:  { bg: "rgba(167,139,250,0.12)", border: "#5a3e8e", color: "#a78bfa" },
  cyber:     { bg: "rgba(239,68,68,0.12)",   border: "#7e2828", color: "#ef4444" },
  fintech:   { bg: "rgba(251,191,36,0.12)",  border: "#a07a1f", color: "#fbbf24" },
  materials: { bg: "rgba(163,230,53,0.12)",  border: "#4a6e1a", color: "#a3e635" },
  semis:     { bg: "rgba(251,146,60,0.12)",  border: "#9a4e1a", color: "#fb923c" },
  health:    { bg: "rgba(236,72,153,0.12)",  border: "#7e2860", color: "#ec4899" },
  energy:    { bg: "rgba(250,204,21,0.12)",  border: "#7e6a14", color: "#facc15" },
  internet:  { bg: "rgba(20,184,166,0.12)",  border: "#0d6e62", color: "#14b8a6" },
};

const CHAIN_ABBR = {
  ai: "AI", software: "SW", cyber: "CY", fintech: "FT",
  defense: "DEF", robotics: "ROB", ev: "EV", quantum: "QTM",
  space: "SPC", materials: "MAT", semis: "SEM",
  health: "HLT", energy: "ENG", internet: "WEB",
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

// ──────────────────────────────────────────────────────────────────────────
// Theme Value-Chain Drawers — multiple slide-out drawers, one per theme
// ──────────────────────────────────────────────────────────────────────────
// Each theme has its own right-edge handle (stacked vertically). Click any
// handle to slide in a drawer with the iframe visualization for that theme.
// ESC or click outside to close.
const VALUE_CHAIN_THEMES = [
  { id: "leaderboard", label: "📊 RANK", src: "/theme-leaderboard.html",            gradient: "linear-gradient(135deg, #ffffff 0%, #fbbf24 100%)", title: "Subtheme Leaderboard — Composite Strength Ranking" },
  { id: "ai",       label: "⛓ AI INFRA",  src: "/ai-infrastructure.html",          gradient: "linear-gradient(135deg, #ec4899 0%, #6cd5e8 100%)", title: "AI INFRASTRUCTURE — Data Centre Value Chain" },
  { id: "software", label: "💻 SOFTWARE", src: "/theme-chain.html?id=software",    gradient: "linear-gradient(135deg, #a78bfa 0%, #6cd5e8 100%)", title: "SOFTWARE + AI APPS Value Chain" },
  { id: "cyber",    label: "🛡 CYBER",    src: "/theme-chain.html?id=cyber",       gradient: "linear-gradient(135deg, #ef4444 0%, #fbbf24 100%)", title: "CYBER SECURITY Value Chain" },
  { id: "fintech",  label: "₿ FINTECH",   src: "/theme-chain.html?id=fintech",     gradient: "linear-gradient(135deg, #fbbf24 0%, #6dde8e 100%)", title: "FINTECH + CRYPTO Value Chain" },
  { id: "defense",  label: "✈ DEFENSE",   src: "/theme-chain.html?id=defense",     gradient: "linear-gradient(135deg, #fbbf24 0%, #f97316 100%)", title: "DEFENSE Value Chain" },
  { id: "robotics", label: "🤖 ROBOTICS", src: "/theme-chain.html?id=robotics",    gradient: "linear-gradient(135deg, #22d3ee 0%, #6dde8e 100%)", title: "ROBOTICS + AUTONOMOUS Value Chain" },
  { id: "ev",       label: "🚗 EV",       src: "/theme-chain.html?id=ev",          gradient: "linear-gradient(135deg, #6dde8e 0%, #fbbf24 100%)", title: "EV + BATTERY Value Chain" },
  { id: "quantum",  label: "⚛ QUANTUM",   src: "/theme-chain.html?id=quantum",     gradient: "linear-gradient(135deg, #b86afc 0%, #6a9eff 100%)", title: "QUANTUM COMPUTING Value Chain" },
  { id: "space",     label: "🚀 SPACE",     src: "/theme-chain.html?id=space",       gradient: "linear-gradient(135deg, #6a9eff 0%, #22d3ee 100%)", title: "SPACE ECOSYSTEM Value Chain" },
  { id: "materials", label: "⛏ MATERIALS", src: "/theme-chain.html?id=materials",  gradient: "linear-gradient(135deg, #a3e635 0%, #84cc16 100%)", title: "CRITICAL MATERIALS — Rare Earths, Uranium, Lithium, Copper" },
  { id: "semis",    label: "🔬 SEMIS",     src: "/theme-chain.html?id=semis",       gradient: "linear-gradient(135deg, #fb923c 0%, #f59e0b 100%)", title: "SEMICONDUCTORS — Analog, Compute, Memory, Packaging, Foundries, Equipment" },
];

function AIInfraDrawer() {
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e) => { if (e.key === "Escape") setOpenId(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openId]);
  useEffect(() => {
    // External components (e.g., TickerInfoBox theme pills) can request a
    // drawer open via window.dispatchEvent(new CustomEvent('tp-open-drawer', { detail: 'ai' }))
    const onOpen = (e) => { if (e?.detail) setOpenId(e.detail); };
    window.addEventListener("tp-open-drawer", onOpen);
    // The leaderboard iframe posts messages back to switch drawers
    // when a row is clicked.
    const onMsg = (e) => {
      if (e?.data?.type === "tp-open-drawer" && e.data.id) {
        setOpenId(e.data.id);
      }
    };
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("tp-open-drawer", onOpen);
      window.removeEventListener("message", onMsg);
    };
  }, []);
  const open = openId != null;
  const active = VALUE_CHAIN_THEMES.find((t) => t.id === openId);
  return (
    <>
      {/* Stacked left-edge handles — one per theme. Sized so all 9 fit
          comfortably on a typical 900-1080px viewport. */}
      <div style={{
        position: "fixed",
        left: 0,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 998,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        opacity: open ? 0 : 1,
        pointerEvents: open ? "none" : "auto",
        transition: "opacity 0.2s",
      }}>
        {VALUE_CHAIN_THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setOpenId(t.id)}
            title={`Open ${t.title}`}
            style={{
              padding: "5px 3px",
              background: t.gradient,
              color: "#0a0a14",
              border: "none",
              borderRadius: "0 5px 5px 0",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 7,
              fontWeight: 800,
              letterSpacing: 1.2,
              writingMode: "vertical-rl",
              textOrientation: "mixed",
              boxShadow: "2px 3px 8px rgba(0,0,0,0.35)",
              opacity: 0.92,
              minHeight: 60,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Backdrop */}
      <div
        onClick={() => setOpenId(null)}
        style={{
          position: "fixed", inset: 0, zIndex: 999,
          background: "rgba(0,0,0,0.55)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s",
        }}
      />
      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0, left: 0, bottom: 0,
          width: "min(1320px, 92vw)",
          zIndex: 1000,
          background: "#0a0a14",
          boxShadow: "12px 0 40px rgba(0,0,0,0.6)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 14px", borderBottom: "1px solid #1f1f2e",
          background: "#0d0d1a", flexShrink: 0,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#c0c0d8", letterSpacing: 1 }}>
            {active ? active.title : ""}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {active && (
              <a href={active.src} target="_blank" rel="noopener noreferrer"
                 title="Open in new tab"
                 style={{
                   fontSize: 9, color: "#7a7a8a", textDecoration: "none",
                   padding: "3px 8px", border: "1px solid #2a2a40", borderRadius: 3,
                   fontFamily: "monospace",
                 }}>
                ↗ NEW TAB
              </a>
            )}
            <button onClick={() => setOpenId(null)}
              title="Close (ESC)"
              style={{
                fontSize: 11, color: "#c0c0d8", background: "transparent",
                border: "1px solid #2a2a40", borderRadius: 3,
                padding: "2px 8px", cursor: "pointer", fontFamily: "monospace",
              }}>
              ✕
            </button>
          </div>
        </div>
        {active && (
          <iframe
            key={active.id}
            src={active.src}
            title={active.title}
            style={{ flex: 1, width: "100%", border: "none", background: "#0a0a14" }}
          />
        )}
      </div>
    </>
  );
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
