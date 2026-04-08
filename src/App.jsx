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
// Phase 2.4 — Lightweight Charts panel + Watchlist + Ticker Info + TQQQ
// Phase 3   — Vercel KV picks endpoints
// Phase 4   — Repoint local cron to Vercel
// Phase 5   — Cutover
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { ARIA_DARK, ARIA_LIGHT, ARIA } from "./styles.js";
import {
  LWChart as LegacyLWChart,
  IntradayChart as LegacyIntradayChart,
} from "./LWChartLegacy.jsx";

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
const DEFAULT_FILTERS = {
  noBio: true,
  greenOnly: true,    // Chg>0% on chgOpen
  adrMin: 3,
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
  { ticker: "TQQQ", name: "TQQQ" },
];

function MarketBreadthBar({ stocks, onTickerClick }) {
  const ARIA = useAriaTheme();
  // Live index quotes via existing /api/live (poll every 30s during market hours)
  const indexTickers = useMemo(() => INDEX_LIST.map((i) => i.ticker), []);
  const { quotes } = useLiveQuotes(indexTickers, 30000);

  // Breadth computed from the static pipeline snapshot.
  // Note: this is "since previous close" — refreshes once per pipeline run.
  const breadth = useMemo(() => {
    if (!stocks || !stocks.length) return null;
    const n = stocks.length;
    let adv = 0,
      dec = 0,
      nh = 0,
      nl = 0;
    stocks.forEach((s) => {
      const c = s.change_pct || 0;
      if (c > 0) adv++;
      else if (c < 0) dec++;
      const offHi = s.off_52w_high;
      if (offHi != null && offHi >= -2) nh++;
      const offLo = s.above_52w_low;
      if (offLo != null && offLo <= 2) nl++;
    });
    return {
      n,
      advCount: adv,
      decCount: dec,
      advPct: Math.round((adv / n) * 100),
      decPct: Math.round((dec / n) * 100),
      nhCount: nh,
      nlCount: nl,
      nhPct: Math.round((nh / n) * 100),
      nlPct: Math.round((nl / n) * 100),
    };
  }, [stocks]);

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
          title="Breadth from pipeline snapshot (since previous close)"
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
};

function ScanWatch({ stocks, onTickerClick }) {
  const ARIA = useAriaTheme();
  // ── State: filters + sort + tags + preset ──────────────────────────────
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [activePreset, setActivePreset] = useState(null);
  const [activeTags, setActiveTags] = useState(() => new Set());

  const updateFilter = useCallback((patch) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);

  // Toggle preset on/off (clicking again clears it). Clears tags too,
  // matching Aria behavior (presets and tags are mutually exclusive).
  const togglePreset = useCallback((key) => {
    setActivePreset((cur) => (cur === key ? null : key));
    setActiveTags(new Set());
  }, []);

  // Toggle a tag on/off. Also clears the active preset (mutex).
  const toggleTag = useCallback((tag) => {
    setActivePreset(null);
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
      // Apply preset filter (if active)
      if (activePreset && PRESETS[activePreset]) {
        if (!PRESETS[activePreset].test(s)) return false;
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
  }, [stocks, filters, activePreset, activeTags]);

  // ── Step 2: rank candidates by stale chg_pct, take top 150 ──────────────
  // Live-enrichment universe — capped at 500 (FMP batch-quote single-call
  // limit). 'Infinity' on the final result slice means we show every row
  // that passes the filters, drawn from this 500-stock pre-filtered pool.
  const topCandidates = useMemo(() => {
    return candidates
      .slice()
      .sort((a, b) => Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0))
      .slice(0, 500);
  }, [candidates]);

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
      const avgVol = s.avg_volume_raw || 0;
      const rvol =
        liveVol && avgVol > 0
          ? Math.round((liveVol / avgVol) * 100) / 100
          : s.rel_volume || 0;
      const chgOpen =
        open != null && open > 0
          ? Math.round(((price - open) / open) * 10000) / 100
          : null;
      // CR% (closing range): how close to high of day. (close-low)/(high-low)*100
      const cr =
        high != null && low != null && high > low
          ? Math.round(((price - low) / (high - low)) * 100)
          : null;

      // Chg>0% filter — applies to either Open or Chg mode
      if (filters.greenOnly) {
        const gainKey =
          filters.chgMode === "open" && chgOpen != null ? chgOpen : chg;
        if (gainKey <= 0) continue;
      }
      // Chg≥ slider
      if (filters.minChg > 0 && chg < filters.minChg) continue;
      // RV≥ slider
      if (filters.minRvol > 0 && rvol < filters.minRvol) continue;
      // 9M tag — today's vol >= 8.9M but avg < 8.9M (unusual institutional)
      if (want9m) {
        if (!liveVol || liveVol < 8_900_000 || avgVol >= 8_900_000) continue;
      }

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
    // No cap — show all candidates that pass the filters
    return out;
  }, [topCandidates, liveQuotes, filters, sort, activeTags]);

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
      }}
    >
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
          const on = activePreset === key;
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

      {/* Active preset description box */}
      {activePreset && PRESETS[activePreset] && (
        <div
          style={{
            padding: "5px 12px",
            borderBottom: `1px solid ${ARIA.border}`,
            background: ARIA.bgRow,
            fontSize: 9,
            color: ARIA.textDim,
            lineHeight: 1.4,
          }}
        >
          <b style={{ color: ARIA.text }}>{PRESETS[activePreset].label}</b> —{" "}
          {PRESETS[activePreset].desc}
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
          const accent = key === "9M" ? ARIA.yellow : ARIA.green;
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

      {/* Results table — Aria default column order: Ticker | BO | Open%/Chg% | RV | Vol | CR% | ADR | Sub */}
      <div
        style={{
          maxHeight: 480,
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
        />
      </div>
    </div>
  );
}

// ── ScanWatchTable: Aria-faithful results table with click-to-sort headers ──
function ScanWatchTable({ rows, sort, onSort, onSort2, chgMode, onTickerClick }) {
  const ARIA = useAriaTheme();
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
          <Th k="qm_bo" label="BO" />
          <Th k={chgKey} label={chgLabel} />
          <Th k="rvol" label="RV" />
          <Th k="liveVol" label="Vol" />
          <Th k="cr" label="CR%" />
          <Th k="adr" label="ADR" />
          <Th k="rs" label="RS" />
          <Th k="subtheme" label="Sub" align="left" />
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td
              colSpan={9}
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
          return (
            <tr
              key={r.ticker}
              onClick={() => onTickerClick && onTickerClick(r.ticker)}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = ARIA.bgHover)
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
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
                {r.ticker}
              </td>
              <td style={{ ...bodyCell, color: colorBo(r.qmagScore), fontWeight: 700 }}>
                {r.qmagScore || "—"}
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
              <td
                style={{
                  ...bodyCell,
                  textAlign: "left",
                  color: ARIA.cyan,
                  fontSize: 8,
                  maxWidth: 90,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={r.subtheme}
              >
                {r.subtheme || "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
      // Show in user's analysis order (newest first), not by Chg%
      arr = (analyzedPicks || []).map((p) => ({
        ...p,
        source: "ANALYZED",
        _chg: extractChg(p),
      }));
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

  const scoreColor = (score) =>
    score >= 80
      ? ARIA.green
      : score >= 60
      ? ARIA.blue
      : score >= 40
      ? ARIA.textDim
      : ARIA.textMuted;

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
          return (
            <div
              key={p.ticker}
              style={{
                padding: "6px 10px",
                borderBottom: `1px solid ${ARIA.border}`,
                background: p.rank === 1 ? ARIA.bgHover : "transparent",
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
// Analyzed picks: on-demand 4-agent analysis stored in localStorage
// ──────────────────────────────────────────────────────────────────────────
//
// User clicks "Analyze" on a ticker → POST to /api/analyze-ticker → result
// is prepended to the local list (cap 50, dedupe by ticker, newest first).
// The Agent Picks subtab renders this list under a new "Analyzed" tab.

const ANALYZED_KEY = "themepulse-analyzed-picks";
const ANALYZED_MAX = 50;
const ANALYZED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function loadAnalyzed() {
  try {
    const raw = JSON.parse(localStorage.getItem(ANALYZED_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    // Drop entries older than ANALYZED_TTL_MS based on `analyzed_at` field.
    // analyzed_at is set server-side by /api/analyze-ticker as ISO 8601.
    const cutoff = Date.now() - ANALYZED_TTL_MS;
    const fresh = raw.filter((p) => {
      if (!p || !p.analyzed_at) return false;
      const t = Date.parse(p.analyzed_at);
      return Number.isFinite(t) && t >= cutoff;
    });
    // Persist back if we filtered anything (keeps storage clean)
    if (fresh.length !== raw.length) {
      try {
        localStorage.setItem(ANALYZED_KEY, JSON.stringify(fresh));
      } catch {}
    }
    return fresh;
  } catch {
    return [];
  }
}
function saveAnalyzed(list) {
  try {
    localStorage.setItem(ANALYZED_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent("tp-analyzed-changed"));
  } catch {}
}

function useAnalyzedPicks() {
  const [list, setList] = useState(() => loadAnalyzed());
  useEffect(() => {
    const reread = () => setList(loadAnalyzed());
    window.addEventListener("tp-analyzed-changed", reread);
    window.addEventListener("storage", reread);
    return () => {
      window.removeEventListener("tp-analyzed-changed", reread);
      window.removeEventListener("storage", reread);
    };
  }, []);
  const addPick = useCallback((pick) => {
    if (!pick || !pick.ticker) return;
    const cur = loadAnalyzed();
    const filtered = cur.filter((p) => p.ticker !== pick.ticker);
    const next = [pick, ...filtered].slice(0, ANALYZED_MAX);
    saveAnalyzed(next);
    setList(next);
  }, []);
  const removePick = useCallback((ticker) => {
    const cur = loadAnalyzed();
    const next = cur.filter((p) => p.ticker !== ticker);
    saveAnalyzed(next);
    setList(next);
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
  const [list, setList] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      return [];
    }
  });
  // Subscribe to updates from any component (or other tabs via storage event)
  useEffect(() => {
    const reread = () => {
      try {
        setList(JSON.parse(localStorage.getItem(key) || "[]"));
      } catch {
        setList([]);
      }
    };
    window.addEventListener("tp-pw-changed", reread);
    window.addEventListener("storage", reread);
    return () => {
      window.removeEventListener("tp-pw-changed", reread);
      window.removeEventListener("storage", reread);
    };
  }, [key]);
  // Setter writes to localStorage and notifies other subscribers
  const update = useCallback(
    (next) => {
      const value = typeof next === "function" ? next(list) : next;
      localStorage.setItem(key, JSON.stringify(value));
      setList(value);
      window.dispatchEvent(new CustomEvent("tp-pw-changed"));
    },
    [key, list]
  );
  return [list, update];
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

function ChartPanelInline({
  ticker,
  onTickerChange,
  height = 580,
  stockMap,
  // Agent picks data — when present, the right pane gets a Chart/Picks subtab
  rvolPicks,
  pmPicks,
  ahPicks,
  analyzedPicks,
  onAnalyze,
  isAnalyzing,
  analyzingTicker,
  onAnalyzedRemove,
}) {
  const ARIA = useAriaTheme();
  const [tf, setTf] = useState("D"); // "D" or "W"
  const [intradayTf, setIntradayTf] = useState("5m"); // "5m" or "30m"
  const [tickerInput, setTickerInput] = useState("");
  // Right pane subtab: 'chart' (intraday OHLC) or 'picks' (agent picks list)
  const [rightTab, setRightTab] = useState(
    () => localStorage.getItem("themepulse-chart-righttab") || "chart"
  );
  const setRightTabPersist = useCallback((t) => {
    setRightTab(t);
    localStorage.setItem("themepulse-chart-righttab", t);
  }, []);

  // Draggable split between daily (left) and intraday (right) panes.
  // Stored as a 0..1 fraction of the chart body width assigned to the LEFT.
  // Default 0.55 ≈ Aria's flex 6/(6+5).
  const [splitFrac, setSplitFrac] = useState(() => {
    const saved = parseFloat(localStorage.getItem("themepulse-chart-split") || "");
    return Number.isFinite(saved) && saved > 0.15 && saved < 0.85 ? saved : 0.55;
  });
  const chartBodyRef = React.useRef(null);
  const startDrag = useCallback((e) => {
    e.preventDefault();
    const body = chartBodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    function onMove(ev) {
      const x = (ev.clientX || 0) - rect.left;
      const f = Math.max(0.15, Math.min(0.85, x / rect.width));
      setSplitFrac(f);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // Persist after drag ends
      try {
        const body2 = chartBodyRef.current;
        if (body2) {
          const r2 = body2.getBoundingClientRect();
          // Read latest splitFrac via DOM measurement
        }
      } catch {}
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);
  // Persist whenever splitFrac changes
  useEffect(() => {
    localStorage.setItem("themepulse-chart-split", String(splitFrac));
  }, [splitFrac]);

  const dailyInterval = tf === "W" ? "1d" : "1d";
  const intradayInterval = intradayTf === "30m" ? "30m" : "5m";

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
  const salesYoy = stockInfo.sales_yoy ?? null;
  const salesYoyPrev = stockInfo.sales_yoy_prev ?? null;
  const epsThisY = stockInfo.eps_this_y ?? null;
  const eps5y = stockInfo.eps_past_5y ?? null;
  const sales5y = stockInfo.sales_past_5y ?? null;
  const margin = (() => {
    const m = stockInfo.profit_margin ?? null;
    return m != null ? (m < 1 ? m * 100 : m) : null;
  })();
  const magna = stockInfo.magna ?? null;
  const adr = stockInfo.adr_pct ?? null;
  const erDate = stockInfo.earnings_display || "";

  // Portfolio/Watchlist via shared cross-component hook (Aria's +WL / +PF)
  const [portfolio, setPortfolio] = useLocalStorageList("themepulse-portfolio");
  const [watchlist, setWatchlist] = useLocalStorageList("themepulse-watchlist");
  const inPF = portfolio.includes(ticker);
  const inWL = watchlist.includes(ticker);
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

  const submitTicker = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t) {
      onTickerChange(t);
      setTickerInput("");
    }
  };

  const tfBtn = (key, label, current, setter) => {
    const on = current === key;
    return (
      <button
        onClick={() => setter(key)}
        style={{
          fontSize: 9,
          padding: "2px 8px",
          borderRadius: 3,
          cursor: "pointer",
          fontFamily: "monospace",
          border: `1px solid ${on ? ARIA.green : ARIA.border}`,
          color: on ? ARIA.green : ARIA.textMuted,
          background: on ? ARIA.glowGreen : "transparent",
        }}
      >
        {label}
      </button>
    );
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
      {/* Header row 1: Title + OHLC + Chg + Vol + RV + badges + buttons */}
      <div
        style={{
          padding: "6px 14px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: ARIA.text,
            fontFamily: "monospace",
            flexShrink: 0,
          }}
        >
          {ticker}
        </span>
        {/* OHLC line — alternating muted/dim colors like Aria */}
        <span
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "flex",
            alignItems: "baseline",
            gap: 4,
          }}
        >
          <span style={{ color: ARIA.textMuted }}>O</span>
          <span style={{ color: ARIA.textDim }}>{o.toFixed(2)}</span>
          <span style={{ color: ARIA.textMuted }}>H</span>
          <span style={{ color: ARIA.textDim }}>{h.toFixed(2)}</span>
          <span style={{ color: ARIA.textMuted }}>L</span>
          <span style={{ color: ARIA.textDim }}>{l.toFixed(2)}</span>
          <span style={{ color: ARIA.textMuted }}>C</span>
          <span style={{ color: ARIA.textDim }}>{c.toFixed(2)}</span>
          {chgPct != null && (
            <span style={{ fontWeight: 700, color: chgColor, marginLeft: 4 }}>
              {(chgAbs >= 0 ? "+" : "") + chgAbs.toFixed(2)} ({(chgPct >= 0 ? "+" : "") + chgPct.toFixed(2)}%)
            </span>
          )}
          <span style={{ color: ARIA.textMuted, marginLeft: 4 }}>Vol</span>
          <span style={{ color: ARIA.textDim }}>{fmtVol(liveVol)}</span>
          {rvol != null && (
            <>
              <span style={{ color: ARIA.textMuted, marginLeft: 4 }}>RV</span>
              <span style={{ color: rvColor, fontWeight: rvol >= 1.5 ? 700 : 400 }}>
                {rvol.toFixed(1)}x
              </span>
            </>
          )}
          {/* Badges: 9M / VOL / HI / Grade / ER / ADR */}
          {has9M && (
            <span style={badgeStyle("#f59e0b")} title="Unusual institutional volume">9M</span>
          )}
          {rvol != null && rvol >= 2 && (
            <span style={badgeStyle("#c084fc")}>VOL</span>
          )}
          {fromHi != null && fromHi >= -3 && (
            <span style={badgeStyle(ARIA.green)}>HI</span>
          )}
          {grade && (
            <span style={badgeStyle(gradeColor)}>{grade}</span>
          )}
          {erDate && (
            <>
              <span style={{ color: ARIA.textMuted, marginLeft: 4 }}>ER</span>
              <span style={{ color: ARIA.textDim }}>{erDate.replace(/~/g, " ").trim()}</span>
            </>
          )}
          {adr != null && (
            <>
              <span style={{ color: ARIA.textMuted, marginLeft: 4 }}>ADR</span>
              <span style={{ color: ARIA.cyan }}>{adr.toFixed(1)}%</span>
            </>
          )}
        </span>
        {/* +WL +PF buttons */}
        <button
          onClick={toggleWL}
          title={inWL ? "Remove from Watchlist" : "Add to Watchlist"}
          style={{
            fontSize: 8,
            padding: "2px 6px",
            borderRadius: 3,
            border: `1px solid ${ARIA.cyan}80`,
            color: inWL ? ARIA.bg : ARIA.cyan,
            background: inWL ? ARIA.cyan : "transparent",
            cursor: "pointer",
            fontFamily: "monospace",
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {inWL ? "✓WL" : "+WL"}
        </button>
        <button
          onClick={togglePF}
          title={inPF ? "Remove from Portfolio" : "Add to Portfolio"}
          style={{
            fontSize: 8,
            padding: "2px 6px",
            borderRadius: 3,
            border: `1px solid ${ARIA.yellow}80`,
            color: inPF ? ARIA.bg : ARIA.yellow,
            background: inPF ? ARIA.yellow : "transparent",
            cursor: "pointer",
            fontFamily: "monospace",
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {inPF ? "✓PF" : "+PF"}
        </button>
        {/* Analyze button — runs the 4-agent analysis on the active ticker */}
        {onAnalyze && (
          <button
            onClick={() => onAnalyze(ticker)}
            disabled={isAnalyzing}
            title={
              isAnalyzing && analyzingTicker === ticker
                ? "Analyzing…"
                : "Run 4-agent analysis (Fund / Tech / Sent / Attn + catalyst)"
            }
            style={{
              fontSize: 8,
              padding: "2px 6px",
              borderRadius: 3,
              border: `1px solid ${ARIA.purple}80`,
              color:
                isAnalyzing && analyzingTicker === ticker
                  ? ARIA.bg
                  : ARIA.purple,
              background:
                isAnalyzing && analyzingTicker === ticker
                  ? ARIA.purple
                  : "transparent",
              cursor: isAnalyzing ? "wait" : "pointer",
              fontFamily: "monospace",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {isAnalyzing && analyzingTicker === ticker ? "…" : "🔬 ANALYZE"}
          </button>
        )}
        <span style={{ color: ARIA.borderLight, margin: "0 2px" }}>|</span>
        {tfBtn("D", "D", tf, setTf)}
        {tfBtn("W", "W", tf, setTf)}
        <span style={{ color: ARIA.borderLight, margin: "0 2px" }}>|</span>
        {tfBtn("5m", "5m", intradayTf, setIntradayTf)}
        {tfBtn("30m", "30m", intradayTf, setIntradayTf)}
        <a
          href={`https://www.tradingview.com/chart/?symbol=${ticker}`}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 9,
            color: ARIA.cyan,
            textDecoration: "none",
            padding: "2px 6px",
            borderRadius: 3,
            border: `1px solid ${ARIA.cyan}40`,
          }}
        >
          TV ↗
        </a>
        <input
          value={tickerInput}
          onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && submitTicker()}
          placeholder="Ticker"
          style={{
            width: 60,
            fontSize: 9,
            padding: "2px 6px",
            background: ARIA.bg,
            border: `1px solid ${ARIA.border}`,
            borderRadius: 3,
            color: ARIA.textDim,
            fontFamily: "monospace",
            textTransform: "uppercase",
            outline: "none",
            marginLeft: "auto",
          }}
        />
      </div>

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
        <CSStat label="EPS" v={epsYoy} clr={csClr(epsYoy)} ARIA={ARIA} />
        <CSStat label="Prev" v={epsYoyPrev} clr={csClr(epsYoyPrev)} ARIA={ARIA} />
        <span style={{ color: ARIA.border }}>|</span>
        <CSStat label="Sales" v={salesYoy} clr={csClr(salesYoy)} ARIA={ARIA} />
        <CSStat label="Prev" v={salesYoyPrev} clr={csClr(salesYoyPrev)} ARIA={ARIA} />
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

      {/* Body: dual-pane chart split with draggable divider.
          splitFrac controls how much horizontal space the LEFT pane gets
          (0.15 .. 0.85). Persisted to localStorage so the choice survives
          reloads. Each pane is in its own ErrorBoundary so a chart crash
          can't take down the page. */}
      <div
        ref={chartBodyRef}
        style={{
          display: "flex",
          gap: 0,
          height,
          position: "relative",
        }}
      >
        {/* Left pane: Daily/Weekly chart with all indicators */}
        <div
          style={{
            width: `${splitFrac * 100}%`,
            display: "flex",
            flexDirection: "column",
            minWidth: 100,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <ErrorBoundary>
            <LegacyLWChart ticker={ticker} tf={tf} />
          </ErrorBoundary>
        </div>

        {/* Draggable divider — matches Aria's chart-split-divider */}
        <div
          onMouseDown={startDrag}
          style={{
            width: 6,
            cursor: "col-resize",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            zIndex: 5,
            userSelect: "none",
          }}
          onMouseEnter={(e) => {
            const inner = e.currentTarget.firstChild;
            if (inner) inner.style.background = ARIA.green;
          }}
          onMouseLeave={(e) => {
            const inner = e.currentTarget.firstChild;
            if (inner) inner.style.background = ARIA.border;
          }}
        >
          <div
            style={{
              width: 1,
              height: "100%",
              background: ARIA.border,
              transition: "background 0.15s",
            }}
          />
        </div>

        {/* Right pane: subtab between intraday chart and agent picks */}
        <div
          style={{
            width: `${(1 - splitFrac) * 100}%`,
            display: "flex",
            flexDirection: "column",
            minWidth: 100,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* Subtab bar */}
          <div
            style={{
              display: "flex",
              gap: 0,
              padding: "4px 8px",
              borderBottom: `1px solid ${ARIA.border}`,
              background: ARIA.bgCard,
              flexShrink: 0,
            }}
          >
            {[
              { key: "chart", label: "CHART" },
              { key: "picks", label: "AGENT PICKS" },
              { key: "watchlist", label: "WATCHLIST" },
            ].map((t, i, arr) => {
              const on = rightTab === t.key;
              const isFirst = i === 0;
              const isLast = i === arr.length - 1;
              return (
                <button
                  key={t.key}
                  onClick={() => setRightTabPersist(t.key)}
                  style={{
                    fontSize: 9,
                    padding: "3px 10px",
                    borderRadius: isFirst
                      ? "4px 0 0 4px"
                      : isLast
                      ? "0 4px 4px 0"
                      : "0",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontWeight: 700,
                    border: `1px solid ${on ? ARIA.green : ARIA.border}`,
                    borderLeft: isFirst ? undefined : "none",
                    color: on ? ARIA.green : ARIA.textMuted,
                    background: on ? ARIA.glowGreen : "transparent",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Subtab content */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {rightTab === "chart" && (
              <ErrorBoundary>
                <LegacyIntradayChart ticker={ticker} />
              </ErrorBoundary>
            )}
            {rightTab === "picks" && (
              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <ErrorBoundary>
                  <AgentPicks
                    rvolPicks={rvolPicks}
                    pmPicks={pmPicks}
                    ahPicks={ahPicks}
                    analyzedPicks={analyzedPicks}
                    onAnalyzedRemove={onAnalyzedRemove}
                    onTickerClick={onTickerChange}
                  />
                </ErrorBoundary>
              </div>
            )}
            {rightTab === "watchlist" && (
              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <ErrorBoundary>
                  <Watchlist
                    stockMap={stockMap}
                    onTickerClick={onTickerChange}
                  />
                </ErrorBoundary>
              </div>
            )}
          </div>
        </div>
      </div>
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

function Watchlist({ stockMap, onTickerClick }) {
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
  const [pInput, setPInput] = useState("");
  const [wInput, setWInput] = useState("");
  const [expandedThemes, setExpandedThemes] = useState(() => new Set());

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
      const avgVol = s.avg_volume_raw || 0;
      const change = q?.change ?? s.change_pct ?? 0;
      const chgOpen =
        open != null && open > 0
          ? Math.round(((price - open) / open) * 10000) / 100
          : null;
      const cr =
        high != null && low != null && high > low
          ? Math.round(((price - low) / (high - low)) * 100)
          : null;
      const rvol =
        liveVol && avgVol > 0
          ? Math.round((liveVol / avgVol) * 100) / 100
          : s.rel_volume || 0;
      return {
        ticker,
        price,
        change,
        chgOpen,
        cr,
        rvol,
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
    return themeGroups.slice().sort((a, b) => themeAvg(b) - themeAvg(a));
  }, [themeGroups, themeAvg]);

  const colorChg = (v) =>
    v == null ? ARIA.textMuted : v > 0 ? ARIA.green : v < 0 ? ARIA.red : ARIA.textMuted;
  const fmtChg = (v) =>
    v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";

  // ── List view: simple table for one section ──
  const SectionTable = ({ rows, accent, list, onAddInput, onAddSubmit, addInput, count }) => (
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
      {rows.length === 0 ? (
        <div style={{ color: ARIA.textMuted, fontSize: 8, padding: "2px 0" }}>
          Empty
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {rows.map((r) => (
            <div
              key={r.ticker}
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                fontSize: 9,
              }}
            >
              <span
                onClick={() => onTickerClick && onTickerClick(r.ticker)}
                style={{
                  fontWeight: 700,
                  color: ARIA.text,
                  cursor: "pointer",
                  minWidth: 48,
                }}
              >
                {r.ticker}
              </span>
              <span style={{ color: ARIA.textDim, minWidth: 50 }}>
                {r.price != null ? "$" + r.price.toFixed(2) : "—"}
              </span>
              <span
                style={{
                  color: colorChg(r.change),
                  fontWeight: 700,
                  minWidth: 56,
                }}
              >
                {fmtChg(r.change)}
              </span>
              <span
                style={{
                  color: ARIA.cyan,
                  fontSize: 7,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={r.subtheme}
              >
                {r.subtheme || "—"}
              </span>
              <button
                onClick={() => removeTicker(list, r.ticker)}
                title="Remove"
                style={{
                  background: "transparent",
                  border: "none",
                  color: ARIA.textMuted,
                  cursor: "pointer",
                  fontSize: 12,
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

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
            maxHeight: 320,
            overflowY: "auto",
            fontFamily: "monospace",
          }}
        >
          <SectionTable
            rows={portRows}
            accent={ARIA.yellow}
            list="portfolio"
            count={portfolio.length}
            addInput={pInput}
            onAddInput={setPInput}
            onAddSubmit={addPortfolio}
          />
          <SectionTable
            rows={watchRows}
            accent={ARIA.green}
            list="watchlist"
            count={watchlist.length}
            addInput={wInput}
            onAddInput={setWInput}
            onAddSubmit={addWatchlist}
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
// TQQQ Trade Panel (Phase 2.4)
// ──────────────────────────────────────────────────────────────────────────
//
// Reads /tqqq_analysis.json (already published by the pipeline) and shows
// current bias, key levels, EMA structure, and recent trades.
// ──────────────────────────────────────────────────────────────────────────

function TQQQPanel() {
  const ARIA = useAriaTheme();
  const [data, setData] = useState(null);
  const [view, setView] = useState("model"); // "model" or "trades"

  useEffect(() => {
    let cancelled = false;
    fetch("/tqqq_analysis.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) {
    return (
      <div
        style={{
          background: ARIA.bgCard,
          border: `1px solid ${ARIA.border}`,
          borderRadius: 14,
          padding: 12,
          marginBottom: 8,
          color: ARIA.textMuted,
          fontSize: 9,
          textAlign: "center",
        }}
      >
        Loading TQQQ analysis…
      </div>
    );
  }

  const biasColor =
    data.bias === "BULLISH"
      ? ARIA.green
      : data.bias === "BEARISH"
      ? ARIA.red
      : ARIA.textMuted;

  const stat = (label, value, color = ARIA.text) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "0 10px",
        borderRight: `1px solid ${ARIA.border}`,
        minWidth: 70,
      }}
    >
      <span
        style={{
          fontSize: 7,
          color: ARIA.textMuted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color,
          fontFamily: "monospace",
        }}
      >
        {value}
      </span>
    </div>
  );

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
      {/* Header */}
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
          TQQQ Model
        </span>
        <span style={{ fontSize: 8, color: ARIA.textMuted }}>
          {data.date || "—"}
        </span>
        <div style={{ display: "flex", gap: 2, marginLeft: 6 }}>
          <button
            onClick={() => setView("model")}
            style={pillStyle(view === "model", ARIA.green)}
          >
            Model
          </button>
          <button
            onClick={() => setView("trades")}
            style={pillStyle(view === "trades", ARIA.green)}
          >
            Trades
          </button>
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 9,
            fontWeight: 800,
            color: biasColor,
            padding: "2px 8px",
            borderRadius: 3,
            border: `1px solid ${biasColor}`,
            background: `${biasColor}20`,
          }}
        >
          {data.bias || "—"}
        </span>
      </div>

      {view === "model" && (
        <>
          {/* Top stats row */}
          <div
            style={{
              padding: "8px 0",
              display: "flex",
              borderBottom: `1px solid ${ARIA.border}`,
              flexWrap: "wrap",
            }}
          >
            {stat("Close", data.close ? "$" + data.close.toFixed(2) : "—")}
            {stat("ADR%", data.adr_pct ? data.adr_pct.toFixed(2) + "%" : "—")}
            {stat(
              "9 EMA",
              data.above_9_ema ? "ABOVE" : "BELOW",
              data.above_9_ema ? ARIA.green : ARIA.red
            )}
            {stat(
              "21 EMA",
              data.above_21_ema ? "ABOVE" : "BELOW",
              data.above_21_ema ? ARIA.green : ARIA.red
            )}
            {stat(
              "50 SMA",
              data.above_50_sma ? "ABOVE" : "BELOW",
              data.above_50_sma ? ARIA.green : ARIA.red
            )}
            {stat(
              "8W EMA",
              data.above_8w_ema ? "ABOVE" : "BELOW",
              data.above_8w_ema ? ARIA.green : ARIA.red
            )}
          </div>
          {/* Key levels */}
          {data.key_levels && (
            <div
              style={{
                padding: "8px 12px",
                borderBottom: `1px solid ${ARIA.border}`,
                fontSize: 9,
                fontFamily: "monospace",
                color: ARIA.textDim,
              }}
            >
              <div
                style={{
                  fontSize: 7,
                  fontWeight: 700,
                  color: ARIA.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 4,
                }}
              >
                Key Levels
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {Object.entries(data.key_levels).map(([k, v]) => (
                  <div key={k}>
                    <span style={{ color: ARIA.textMuted }}>{k}: </span>
                    <span style={{ color: ARIA.text, fontWeight: 700 }}>
                      {typeof v === "number" ? "$" + v.toFixed(2) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Briefing */}
          {data.briefing && typeof data.briefing === "object" && (
            <div
              style={{
                padding: "8px 12px",
                fontSize: 9,
                color: ARIA.textDim,
                lineHeight: 1.5,
              }}
            >
              <div
                style={{
                  fontSize: 7,
                  fontWeight: 700,
                  color: ARIA.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 4,
                }}
              >
                Briefing
              </div>
              {Object.entries(data.briefing)
                .slice(0, 6)
                .map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 3 }}>
                    <span style={{ color: ARIA.textMuted }}>{k}: </span>
                    <span style={{ color: ARIA.text }}>
                      {typeof v === "string" ? v : JSON.stringify(v)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      {view === "trades" && (
        <div
          style={{
            maxHeight: 320,
            overflowY: "auto",
            fontSize: 9,
            fontFamily: "monospace",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Side", "Entry", "Exit", "P&L%", "R"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "4px 8px",
                      fontSize: 7,
                      fontWeight: 700,
                      color: ARIA.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: 0.3,
                      textAlign: "left",
                      borderBottom: `1px solid ${ARIA.border}`,
                      position: "sticky",
                      top: 0,
                      background: ARIA.bgCard,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.recent_trades || []).slice(0, 30).map((t, i) => {
                const pnl = t.pnl_pct ?? t.return_pct ?? null;
                const r = t.r_multiple ?? t.r ?? null;
                const c =
                  pnl == null
                    ? ARIA.textMuted
                    : pnl > 0
                    ? ARIA.green
                    : ARIA.red;
                return (
                  <tr key={i}>
                    <td
                      style={{
                        padding: "3px 8px",
                        color: ARIA.textDim,
                        borderBottom: `1px solid ${ARIA.border}`,
                      }}
                    >
                      {t.entry_date || t.date || "—"}
                    </td>
                    <td
                      style={{
                        padding: "3px 8px",
                        color: ARIA.text,
                        borderBottom: `1px solid ${ARIA.border}`,
                      }}
                    >
                      {t.side || "—"}
                    </td>
                    <td
                      style={{
                        padding: "3px 8px",
                        color: ARIA.textDim,
                        borderBottom: `1px solid ${ARIA.border}`,
                      }}
                    >
                      {t.entry_price != null
                        ? "$" + Number(t.entry_price).toFixed(2)
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "3px 8px",
                        color: ARIA.textDim,
                        borderBottom: `1px solid ${ARIA.border}`,
                      }}
                    >
                      {t.exit_price != null
                        ? "$" + Number(t.exit_price).toFixed(2)
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "3px 8px",
                        color: c,
                        fontWeight: 700,
                        borderBottom: `1px solid ${ARIA.border}`,
                      }}
                    >
                      {pnl != null
                        ? (pnl > 0 ? "+" : "") + Number(pnl).toFixed(1) + "%"
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "3px 8px",
                        color: c,
                        borderBottom: `1px solid ${ARIA.border}`,
                      }}
                    >
                      {r != null ? Number(r).toFixed(2) + "R" : "—"}
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

// ──────────────────────────────────────────────────────────────────────────
// AppMain
// ──────────────────────────────────────────────────────────────────────────

function AppMain() {
  // ── ALL hooks must be at the top, before any conditional return ────────
  // Phase 2.7 had useMemo(stockMap) AFTER the data.loading early return,
  // which caused React error #310 ("Rendered more hooks than during the
  // previous render") on the loading→loaded transition.
  const ARIA = useAriaTheme();
  const { themeMode, toggleTheme, zoom, changeZoom } = useAriaThemeControls();
  const data = useDashboardData();
  // usePicks disabled — auto sources (PM/AH/RVol) no longer fired by CI.
  // Agent Picks panel is now driven entirely by useAnalyzedPicks.
  const picks = { rvolPicks: null, pmPicks: null, ahPicks: null };
  const { list: analyzedPicks, removePick: removeAnalyzed } = useAnalyzedPicks();
  const { isAnalyzing, activeTicker: analyzingTicker, analyze } = useAnalyzer();
  // After analyze succeeds, switch the right pane to the picks subtab so the
  // user immediately sees the new analysis. The analyze() helper handles
  // localStorage append; we just trigger the UI flip.
  const handleAnalyze = useCallback(
    async (ticker) => {
      const result = await analyze(ticker);
      if (result) {
        try {
          localStorage.setItem("themepulse-chart-righttab", "picks");
          localStorage.setItem("aria-ap-tab", "analyzed");
          window.dispatchEvent(new CustomEvent("tp-pw-changed"));
        } catch {}
      }
      return result;
    },
    [analyze]
  );

  // Active ticker for the inline chart panel.
  // Default to TQQQ to match Aria's behavior. Persists in localStorage.
  const [chartTicker, setChartTicker] = useState(() => {
    return localStorage.getItem("themepulse-chart-ticker") || "TQQQ";
  });
  const handleTickerClick = useCallback((ticker) => {
    if (!ticker) return;
    setChartTicker(ticker);
    localStorage.setItem("themepulse-chart-ticker", ticker);
  }, []);

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

        {/* Charts + Scan Watch row — chart on left (flex 1), Scan Watch column 320px on right */}
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "stretch",
            marginBottom: 8,
          }}
        >
          <ChartPanelInline
            ticker={chartTicker}
            onTickerChange={handleTickerClick}
            stockMap={stockMap}
            rvolPicks={picks.rvolPicks}
            pmPicks={picks.pmPicks}
            ahPicks={picks.ahPicks}
            analyzedPicks={analyzedPicks}
            onAnalyze={handleAnalyze}
            isAnalyzing={isAnalyzing}
            analyzingTicker={analyzingTicker}
            onAnalyzedRemove={removeAnalyzed}
          />
          <div style={{ width: 340, flexShrink: 0, minWidth: 280 }}>
            <ScanWatch
              stocks={stocks}
              onTickerClick={handleTickerClick}
            />
          </div>
        </div>

        {/* Agent Picks + Watchlist moved into ChartPanelInline as right-pane
            subtabs. See ChartPanelInline rightTab state. */}

        {/* Bottom row: TQQQ Model panel */}
        <TQQQPanel />
      </div>
    </div>
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
