// ════════════════════════════════════════════════════════════════════════════
// ThemePulse — Aria Trading Dashboard (Vercel-hosted)
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useMemo, useCallback } from "react";
import { ARIA_DARK, ARIA_LIGHT, FONT_SANS, FONT_MONO } from "./styles.js";
import { isPipelineStale } from "./utils.js";
import LeadershipView, { LEAD_INDEXES } from "./LeadershipView.jsx";
import { AriaThemeContext, useAriaTheme, useAriaThemeControls } from "./themeContext.js";
import { useLiveQuotes } from "./hooks/useLiveQuotes.js";
import { useLocalStorageList } from "./hooks/useUserData.js";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { AuthGate, LockButton } from "./components/AuthGate.jsx";
import { ChartPanelInline } from "./components/ChartPanelInline.jsx";
import { useTradeAlerts, AlertsBell } from "./components/TradeAlerts.jsx";

// One-time cleanup: preferences saved by the retired Dash tab (Scan Watch,
// rotation board, chain table, earnings calendar). Nothing reads them now.
try {
  if (!localStorage.getItem("tp_dash_cleanup_v1")) {
    ["themepulse-scan-width2", "tp-breadth-sym", "tp-chain-crp-only", "tp-chain-fc-only", "tp-chain-heat-alpha", "tp-chain-leaders-only", "tp-chain-pf-only", "tp-chain-pos-only", "tp-chain-setups-only", "tp-chain-sort", "tp-er-cal-mode", "tp-er-cal-open", "tp-exthours-collapsed", "tp-funnel-layers", "tp-holdings-w", "tp-regime-collapsed", "tp-regime-h2", "tp-rs-board-open", "tp-scan-height", "tp-scan-panel-h", "tp-tags-open", "tp-stack-snapshot"].forEach((k) => localStorage.removeItem(k));
    localStorage.setItem("tp_dash_cleanup_v1", "1");
  }
} catch { /* storage blocked — nothing to clean */ }

const LEAD_INDEX_TICKERS = LEAD_INDEXES.map((x) => x.t);

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

// ──────────────────────────────────────────────────────────────────────────
// Data fetching hooks
// ──────────────────────────────────────────────────────────────────────────

function useDashboardData() {
  const [data, setData] = useState({
    loading: true,
    error: null,
    pipeline: null,
  });
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => {
    setData({ loading: true, error: null, pipeline: null });
    setRetryNonce((n) => n + 1);
  }, []);

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
      fetch("/dashboard_data.json", { cache: "no-cache" })
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
  }, [retryNonce]);

  return { ...data, retry };
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
  const { quotes: indexQuotes } = useLiveQuotes(LEAD_INDEX_TICKERS);
  const [portfolio, setPortfolio] = useLocalStorageList("themepulse-portfolio");
  const [watchlist, setWatchlist] = useLocalStorageList("themepulse-watchlist");
  // Active ticker & top-level view: URL query (?view=...&ticker=...) takes precedence over localStorage.
  const [chartTicker, setChartTicker] = useState(() => {
    try {
      const q = (new URLSearchParams(window.location.search).get("ticker") || "").trim().toUpperCase();
      if (/^[A-Z][A-Z0-9.\-]{0,11}$/.test(q)) return q;
    } catch {}
    return localStorage.getItem("themepulse-chart-ticker") || "QQQ";
  });
  const [mainView, setMainView] = useState(() => {
    const valid = (x) => x === "brief" || x === "scanner" || x === "qqq";
    const normalize = (x) => (x === "zanger" || x === "lead" ? "brief" : x);
    try {
      const qv = normalize((new URLSearchParams(window.location.search).get("view") || "").trim().toLowerCase());
      if (valid(qv)) return qv;
    } catch {}
    const v = normalize(localStorage.getItem("themepulse-view"));
    return valid(v) ? v : "brief";
  });
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("view", mainView);
      if (chartTicker) url.searchParams.set("ticker", chartTicker);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {}
  }, [mainView, chartTicker]);
  const switchView = useCallback((v) => {
    setMainView(v);
    try { localStorage.setItem("themepulse-view", v); } catch {}
    if (v === "qqq") {
      setChartTicker("QQQ");
      try { localStorage.setItem("themepulse-chart-ticker", "QQQ"); } catch {}
    }
  }, []);
  const handleTickerClick = useCallback((ticker) => {
    if (!ticker) return;
    setChartTicker(ticker);
    try { localStorage.setItem("themepulse-chart-ticker", ticker); } catch {}
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
    fetch("/data/framework_scores.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.scores) setFrameworkScoresRaw(d.scores); })
      .catch(() => {});
  }, []);

  // stockMap depends on data.pipeline.stocks. Compute it BEFORE the early
  // returns so the hook count is stable across loading→loaded transitions.
  const stocks = useMemo(() => data.pipeline?.stocks || [], [data.pipeline?.stocks]);
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
          fontFamily: FONT_MONO,
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
          fontFamily: FONT_SANS,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700 }}>{data.error}</div>
        <div style={{ fontSize: 12, color: ARIA.textDim, marginTop: 6 }}>
          Pipeline data is required. Check that /dashboard_data.json exists.
        </div>
        <button
          onClick={data.retry}
          style={{
            marginTop: 12,
            padding: "6px 14px",
            background: ARIA.glowGreen || "rgba(13,145,99,0.14)",
            border: `1px solid ${ARIA.green}`,
            color: ARIA.green,
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: FONT_SANS,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Retry
        </button>
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
        fontFamily: FONT_SANS,
      }}
    >
      <AlertsBell alerts={tradeAlerts} onTicker={handleTickerClick} ARIA={ARIA} />
      {/* Topbar */}
      <div
        className="tp-topbar"
        style={{
          display: "flex",
          flexWrap: "wrap",
          rowGap: 6,
          alignItems: "center",
          padding: "10px 24px",
          background: ARIA.bgCardGlass || ARIA.bgCard,
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
        <div style={{ display: "flex", gap: 4, marginLeft: 18 }}>
          {[["brief", "BRIEF"], ["qqq", "QQQ"], ["scanner", "SCANNER"]].map(([v, label]) => (
            <button key={v} onClick={() => switchView(v)}
              style={{
                background: mainView === v ? (ARIA.glowGreen || "rgba(13,145,99,0.14)") : "transparent",
                border: `1px solid ${mainView === v ? ARIA.green : ARIA.border}`,
                color: mainView === v ? ARIA.green : ARIA.textDim,
                padding: "4px 11px", borderRadius: 6, cursor: "pointer",
                fontFamily: FONT_SANS, fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
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
          <span
            style={{
              color: isPipelineStale(data.pipeline?.date) ? "#f59e0b" : ARIA.textMuted,
              fontFamily: FONT_MONO,
              fontSize: 10.5,
            }}
            title={isPipelineStale(data.pipeline?.date) ? "Pipeline data is more than 2 trading days old — check GitHub Actions" : undefined}
          >
            {stocks.length.toLocaleString()} stocks · {data.pipeline?.date || ""}
            {isPipelineStale(data.pipeline?.date) && (
              <span
                style={{
                  marginLeft: 6,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "rgba(245,158,11,0.16)",
                  border: "1px solid rgba(245,158,11,0.45)",
                  color: "#f59e0b",
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                STALE
              </span>
            )}
          </span>
          <LockButton ARIA={ARIA} />
          <button
            onClick={toggleTheme}
            title={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
            style={{
              background: "transparent",
              border: `1px solid ${ARIA.border}`,
              color: ARIA.textDim,
              padding: "4px 10px",
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: FONT_SANS,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.2,
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
                padding: "4px 7px",
                borderRadius: "6px 0 0 6px",
                cursor: "pointer",
                fontFamily: FONT_SANS,
                fontSize: 11,
                fontWeight: 600,
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
                padding: "4px 7px",
                borderRadius: "0 6px 6px 0",
                cursor: "pointer",
                fontFamily: FONT_SANS,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              A+
            </button>
          </div>
          <span
            style={{
              fontSize: 10.5,
              color: ARIA.textMuted,
              fontFamily: FONT_MONO,
              minWidth: 32,
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
          // full window width (was capped at 1600px, leaving empty margins on wide screens)
          margin: "0 auto",
          zoom: zoom,
        }}
      >
        <ErrorBoundary>
          <LeadershipView
            view={mainView}
            ARIA={ARIA}
            indexQuotes={indexQuotes}
            pipeline={data.pipeline}
            stockMap={stockMap}
            chartTicker={chartTicker}
            onTickerClick={handleTickerClick}
            portfolio={portfolio}
            setPortfolio={setPortfolio}
            watchlist={watchlist}
            setWatchlist={setWatchlist}
            chartSlot={
              <ChartPanelInline
                ticker={chartTicker}
                onTickerChange={handleTickerClick}
                stockMap={stockMap}
              />
            }
          />
        </ErrorBoundary>
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
      try { localStorage.setItem("themepulse-theme", next); } catch {}
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
      try { localStorage.setItem("themepulse-zoom", String(next)); } catch {}
      return next;
    });
  }, []);

  const ARIA = themeMode === "light" ? ARIA_LIGHT : ARIA_DARK;
  // Set body bg & sync :root interactive/scrollbar CSS variables on theme switch
  useEffect(() => {
    document.body.style.background = ARIA.bg;
    const isLight = themeMode === "light";
    const root = document.documentElement.style;
    root.setProperty("--tp-btn-hover-bg", isLight ? "rgba(15, 23, 42, 0.05)" : "rgba(255, 255, 255, 0.06)");
    root.setProperty("--tp-btn-hover-border", isLight ? "rgba(15, 23, 42, 0.26)" : "rgba(255, 255, 255, 0.22)");
    root.setProperty("--tp-focus-ring", isLight ? "rgba(5, 150, 105, 0.50)" : "rgba(52, 211, 153, 0.55)");
    root.setProperty("--tp-scroll-thumb", isLight ? "#cbd5e1" : "#2b2b3d");
    root.setProperty("--tp-scroll-thumb-hover", isLight ? "#94a3b8" : "#3d3d54");
  }, [ARIA.bg, themeMode]);
  const ctxValue = useMemo(
    () => ({ ARIA, themeMode, toggleTheme, zoom, changeZoom }),
    [ARIA, themeMode, toggleTheme, zoom, changeZoom]
  );
  return (
    <AriaThemeContext.Provider value={ctxValue}>
      <ErrorBoundary>
        <AuthGate>
          <AppMain />
        </AuthGate>
      </ErrorBoundary>
    </AriaThemeContext.Provider>
  );
}
