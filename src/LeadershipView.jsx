// ──────────────────────────────────────────────────────────────────────────
// LeadershipView — computes universe themes, layers, tiers, and live RS,
// then renders the active workspace view (BRIEF default, or SCANNER) beside
// the sticky chart panel.
// ──────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import {
  Card,
  LEAD_INDEXES,
  LayerMembers,
  PEAK_LOOKBACK,
  SPARK_N,
  TierCtx,
  classify,
  computeLayerDayFlow,
  computeTiers,
  layerConfirm,
  layerRanksFrom,
  layerStats,
  rankHeld,
  rankTrend,
  sessionElapsedFrac,
  useIndexBars,
  useJson,
  useLiveRS,
  withEpsRating,
} from "./lead/core.jsx";
export { LEAD_INDEXES, zvrFor, useRvolProfiles, useJson, TierMark, computeTiers } from "./lead/core.jsx";

function lazyWithReload(load) {
  return React.lazy(() =>
    load().catch((err) => {
      const msg = String(err?.message || err || "");
      const isChunkErr = /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg);
      if (isChunkErr && typeof window !== "undefined") {
        try {
          const last = Number(sessionStorage.getItem("tp_chunk_reload_at") || 0);
          if (Date.now() - last > 15000) {
            sessionStorage.setItem("tp_chunk_reload_at", String(Date.now()));
            window.location.reload();
            return new Promise(() => {});
          }
        } catch {
          window.location.reload();
          return new Promise(() => {});
        }
      }
      throw err;
    })
  );
}
const BriefPanel = lazyWithReload(() => import("./lead/Brief.jsx"));
const QqqPanel = lazyWithReload(() => import("./lead/QqqPanel.jsx"));
const ScannerPanel = lazyWithReload(() => import("./lead/Scanner.jsx"));
const OptionsPanel = lazyWithReload(() => import("./lead/OptionsPanel.jsx"));

const SPLIT_STORAGE_KEY = "tp-split-pct";
const SPLIT_MIN = 38;
const SPLIT_MAX = 72;
const SPLIT_DEFAULT = 55;
const SPLIT_PRESETS = [
  { id: "wide-table", label: "Wide Table", pct: 65 },
  { id: "balanced", label: "Balanced", pct: 55 },
  { id: "wide-chart", label: "Wide Chart", pct: 42 },
];
const clampSplit = (v) => Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, Math.round(v * 10) / 10));
const readSavedSplit = () => {
  try {
    const raw = parseFloat(localStorage.getItem(SPLIT_STORAGE_KEY) || "");
    return Number.isFinite(raw) ? clampSplit(raw) : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
};

export default function LeadershipView({
  ARIA: A,
  stockMap: stockMapIn,
  onTickerClick,
  chartTicker,
  chartSlot,
  indexQuotes,
  pipeline,
  view = "brief",
  portfolio = [],
  setPortfolio,
  watchlist = [],
  setWatchlist,
}) {
  const rot = useJson("/data/rs_rotation.json");
  const hist = useJson("/data/rank_history.json");
  const seats = useJson("/data/ticker_seats.json");
  const breadth = useJson("/data/breadth.json");
  const monitor = useJson("/market_monitor.json");
  const idxBars = useIndexBars(LEAD_INDEXES.map((x) => x.t));
  const epsMap = useMemo(() => withEpsRating(stockMapIn), [stockMapIn]);
  const liveRs = useLiveRS(epsMap);
  const stockMap = liveRs.map;

  // ↑/↓ steps through visible table rows and loads each ticker in the chart.
  const stocksRef = useRef(null);
  const navRef = useRef({ chartTicker, onTickerClick });
  navRef.current = { chartTicker, onTickerClick };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const box = stocksRef.current;
      if (!box) return;
      const rows = [...box.querySelectorAll("tr[data-nav]")];
      if (!rows.length) return;
      e.preventDefault();
      const { chartTicker: cur, onTickerClick: go } = navRef.current;
      const i = rows.findIndex((r) => r.dataset.nav === cur);
      const j = i < 0 ? (e.key === "ArrowDown" ? 0 : rows.length - 1)
        : Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      if (j === i) return;
      rows[j].scrollIntoView({ block: "nearest" });
      go(rows[j].dataset.nav);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [expanded, setExpanded] = useState(null);
  const [themeLayer, setThemeLayer] = useState(null);
  const chain = useJson("/data/chain_layers.json");
  const layerBreadth = useJson("/data/layer_breadth.json");

  const members = useMemo(() => {
    const m = {};
    (Array.isArray(chain) ? chain : []).forEach((l) => { m[`${l.themeId}|${l.layer}`] = l.tickers || []; });
    return m;
  }, [chain]);

  const dates = useMemo(() => (hist ? Object.keys(hist).sort() : []), [hist]);

  const isLive = !!liveRs.at;
  const liveRank = useMemo(() => {
    if (!isLive || !rot?.layers) return null;
    const keys = rot.layers.map((l) => `${l.themeId}|${l.name}`);
    const c = layerRanksFrom(keys, members, stockMap, "rs_score_close");
    const v = layerRanksFrom(keys, members, stockMap, "rs_score_live");
    const d = {};
    for (const k of keys) if (c[k] != null && v[k] != null) d[k] = v[k] - c[k];
    return d;
  }, [isLive, rot, members, stockMap]);

  const layers = useMemo(() => {
    if (!rot?.layers) return [];
    const sparkDates = dates.slice(-SPARK_N);
    const peakDates = dates.slice(-PEAK_LOOKBACK);
    const volFrac = isLive ? sessionElapsedFrac() : 1;
    return rot.layers.map((l0) => {
      const key = `${l0.themeId}|${l0.name}`;
      const tks = members[key] || (l0.holds || []).map((x) => x.t);
      const dl = liveRank?.[key];
      const l = dl == null ? l0 : { ...l0, now_close: l0.now, now: Math.max(0, Math.min(100, Math.round(l0.now + dl))) };
      const hClose = sparkDates.map((d) => hist?.[d]?.layers?.[key] ?? null);
      const h = dl == null ? hClose : [...hClose.slice(1), l.now];
      const ph0 = peakDates.map((d) => hist?.[d]?.layers?.[key] ?? null);
      const ph = dl == null ? ph0 : [...ph0, l.now];
      const { st, peak } = classify(l, ph.length ? ph : [l.now, l.w1, l.m1]);
      const stats = layerStats(tks, stockMap || {});
      let conf = layerConfirm(layerBreadth?.layers?.[key]);
      if (conf && isLive) {
        const lbRow = layerBreadth?.layers?.[key];
        const arr = lbRow?.l90 || [];
        let i = arr.length - 1; while (i >= 0 && arr[i] == null) i--;
        const p = i - 4 >= 0 ? arr[i - 4] : null;
        const l90 = tks.filter((t) => (stockMap[t]?.rs_rank ?? 0) >= 90).length;
        const l90d = p != null ? l90 - p : null;
        const passed = conf.passed.filter((k) => k !== "leaders").concat(l90d != null && l90d >= 2 ? ["leaders"] : []);
        conf = { ...conf, l90, l90d, passed, l90Live: true };
      }
      const dayFlow = computeLayerDayFlow(tks, stockMap || {}, { isLive, volFrac });
      return { ...l, key, hist: h, st, peak, trend: rankTrend(h), held: rankHeld(hClose), stats, conf, today: dayFlow.today, dayFlow, rankLive: dl != null };
    });
  }, [rot, hist, dates, members, stockMap, layerBreadth, liveRank, isLive]);

  const themes = useMemo(() => {
    const by = {};
    layers.forEach((l) => { (by[l.themeId] ||= { themeId: l.themeId, theme: l.theme, layers: [] }).layers.push(l); });
    const avg = (arr) => arr.reduce((s, x) => s + x, 0) / (arr.length || 1);
    const volFrac = isLive ? sessionElapsedFrac() : 1;
    return Object.values(by).map((t) => {
      const L = t.layers;
      const counts = { lead: 0, emerg: 0, weak: 0, brk: 0, lag: 0 };
      L.forEach((l) => counts[l.st]++);
      const now = avg(L.map((l) => l.now)), w1 = avg(L.map((l) => l.w1 ?? l.now)), m1 = avg(L.map((l) => l.m1 ?? l.now));
      const h = L[0].hist.map((_, i) => {
        const v = L.map((l) => l.hist[i]).filter((x) => x != null);
        return v.length ? avg(v) : null;
      });
      const share = (n) => n / L.length;
      let st = "lag";
      if (share(counts.lead) >= 0.5 || (now >= 75 && counts.lead >= 1 && counts.brk === 0)) st = "lead";
      else if (share(counts.brk + counts.weak) >= 0.4 && m1 - now >= 10) st = "brk";
      else if (counts.weak + counts.brk >= 1 && now < m1) st = "weak";
      else if (now - m1 >= 15 && now >= 55) st = "emerg";
      const tks = [...new Set(L.flatMap((l) => members[l.key] || (l.holds || []).map((x) => x.t)))];
      const dayFlow = computeLayerDayFlow(tks, stockMap || {}, { isLive, volFrac });
      const heldAvg = avg(L.map((l) => l.held?.held ?? 0));
      return { ...t, counts, now, w1, m1, hist: h, st, trend: rankTrend(h), stats: layerStats(tks, stockMap || {}), today: dayFlow.today, dayFlow, heldAvg };
    }).sort((a, b) => b.now - a.now);
  }, [layers, members, stockMap, isLive]);

  // ticker → best layer it sits in (leading layers win ties)
  const tickerLayer = useMemo(() => {
    const rank = { lead: 4, emerg: 2, weak: 1, brk: 0, lag: 0 };
    const m = {};
    layers.forEach((l) => (l.holds || []).forEach(({ t }) => {
      const cur = m[t];
      if (!cur || rank[l.st] > rank[cur.st] || (rank[l.st] === rank[cur.st] && l.now > cur.now)) m[t] = l;
    }));
    return m;
  }, [layers]);

  // EPS position inside the stock's own layer
  const stockMapX = useMemo(() => {
    const out = { ...stockMap };
    for (const [t, l] of Object.entries(tickerLayer)) {
      const s = stockMap[t];
      if (!s || s.eps_rating == null) continue;
      const mem = (members[l.key] || (l.holds || []).map((h) => h.t))
        .filter((x) => stockMap[x]?.eps_rating != null)
        .sort((a, b) => stockMap[b].eps_rating - stockMap[a].eps_rating);
      const pos = mem.indexOf(t) + 1;
      if (pos > 0) {
        out[t] = {
          ...s,
          eps_layer_pos: pos,
          eps_layer_n: mem.length,
          eps_tip: `${s.eps_tip} · #${pos} of ${mem.length} in ${l.name}`,
        };
      }
    }
    return out;
  }, [stockMap, tickerLayer, members]);

  // Leaders breaking down (used by LiveBrief Breakdowns card)
  const brkStocks = useMemo(() => {
    const pm = seats?.persistMap || {};
    const brk = [];
    Object.values(stockMapX || {}).forEach((s) => {
      if (!s?.ticker || (s.avg_dollar_vol_raw ?? 0) < 20e6) return;
      const persist = pm[s.ticker]?.[0] ?? 0;
      if (persist >= 40 && ((s.rs_rank ?? 0) < 70 || (s.sma50_pct ?? 0) <= -8)) {
        const L = tickerLayer[s.ticker];
        brk.push({
          ticker: s.ticker,
          rs: s.rs_rank,
          eps: s.eps_rating ?? null,
          epsTip: s.eps_tip,
          epsAcc: s.eps_accel,
          sma50: s.sma50_pct,
          off: s.off_52w_high,
          r1m: s.return_1m,
          layer: L?.name,
          layerSt: L?.st,
          inLead: L?.st === "lead",
          persist,
        });
      }
    });
    brk.sort((a, b) => b.persist - a.persist || (a.rs ?? 0) - (b.rs ?? 0));
    return brk.slice(0, 60);
  }, [stockMapX, seats, tickerLayer]);

  const tiers = useMemo(() => computeTiers(stockMapX, tickerLayer), [stockMapX, tickerLayer]);

  const showLayer = (l, chart = true) => {
    setExpanded(l.key);
    if (chart) {
      const top = (members[l.key] || (l.holds || []).map((h) => h.t)).filter((t) => stockMap[t])
        .sort((a, b) => (stockMap[b]?.rs_rank ?? 0) - (stockMap[a]?.rs_rank ?? 0))[0];
      if (top) onTickerClick(top);
    }
    setTimeout(() => stocksRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };
  const closeLayer = () => setExpanded(null);

  const viewRef = useRef(view);
  useEffect(() => {
    if (viewRef.current !== view) {
      viewRef.current = view;
      setExpanded(null);
    }
  }, [view]);

  const showTheme = (themeId) => {
    const t = themes.find((x) => x.themeId === themeId);
    if (!t) return;
    const tks = [...new Set(t.layers.flatMap((l) => members[l.key] || (l.holds || []).map((h) => h.t)))];
    const pseudo = {
      key: `t:${themeId}`,
      name: t.theme,
      theme: `${t.layers.length} layers`,
      themeId,
      st: t.st,
      now: Math.round(t.now),
      w1: t.w1,
      m1: t.m1,
      stats: t.stats,
      holds: tks.map((x) => ({ t: x })),
    };
    setThemeLayer(pseudo);
    showLayer(pseudo);
  };

  const openLayerEvtRef = useRef(null);
  openLayerEvtRef.current = ({ themeId, layer }) => {
    const key = `${themeId}|${layer}`;
    const match = layers.find((l) => l.key === key);
    if (match) showLayer(match, false);
    else if (themeId) showTheme(themeId);
  };
  useEffect(() => {
    const onOpenLayer = (e) => { if (e?.detail) openLayerEvtRef.current?.(e.detail); };
    window.addEventListener("tp-open-layer", onOpenLayer);
    return () => window.removeEventListener("tp-open-layer", onOpenLayer);
  }, []);

  const shownLayer = expanded
    ? (layers.find((l) => l.key === expanded) || (themeLayer?.key === expanded ? themeLayer : null))
    : null;

  const layerOfTicker = (t) => {
    const l = tickerLayer[t];
    if (!l) return;
    showLayer(l, false);
    onTickerClick(t);
  };

  // Sync global CSS variables used by index.html row hover / active highlight
  // rules so both dark and light themes look crisp.
  useEffect(() => {
    if (typeof document === "undefined" || !A) return;
    const root = document.documentElement.style;
    const isLight = A.bg === "#f8f9fc" || /^#?[e-f]/i.test(String(A.bg || ""));
    root.setProperty("--tp-row-hover", isLight ? "rgba(15, 23, 42, 0.055)" : "rgba(255, 255, 255, 0.045)");
    root.setProperty("--tp-row-active-hover", isLight ? "rgba(228, 231, 240, 0.78)" : "rgba(40, 40, 55, 0.65)");
    root.setProperty("--tp-row-active-bar", A.green || "#22c55e");
  }, [A]);

  // Resizable desktop split-pane (feed column % clamped to 38–72%, persisted).
  const [splitPct, setSplitPct] = useState(readSavedSplit);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const splitRowRef = useRef(null);
  const splitPctRef = useRef(splitPct);
  splitPctRef.current = splitPct;
  const dragCleanupRef = useRef(null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const applySplitPreset = useCallback((pct) => {
    const clamped = clampSplit(pct);
    setSplitPct(clamped);
    splitPctRef.current = clamped;
    try { localStorage.setItem(SPLIT_STORAGE_KEY, String(clamped)); } catch { /* storage blocked */ }
  }, []);

  const onSplitDragStart = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragCleanupRef.current?.();
    setDraggingSplit(true);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const updateFromClientX = (clientX) => {
      const box = splitRowRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      if (!rect.width) return;
      const pct = clampSplit(((clientX - rect.left) / rect.width) * 100);
      setSplitPct(pct);
      splitPctRef.current = pct;
    };

    const onMove = (ev) => updateFromClientX(ev.clientX);
    const cleanup = (persist = true) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      setDraggingSplit(false);
      dragCleanupRef.current = null;
      if (persist) {
        try { localStorage.setItem(SPLIT_STORAGE_KEY, String(splitPctRef.current)); } catch { /* storage blocked */ }
      }
    };
    const onUp = () => cleanup(true);
    dragCleanupRef.current = () => cleanup(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const onSplitKeyDown = useCallback((e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      applySplitPreset(splitPctRef.current - 2);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      applySplitPreset(splitPctRef.current + 2);
    } else if (e.key === "Home") {
      e.preventDefault();
      applySplitPreset(SPLIT_MIN);
    } else if (e.key === "End") {
      e.preventDefault();
      applySplitPreset(SPLIT_MAX);
    }
  }, [applySplitPreset]);

  return (
    <TierCtx.Provider value={tiers}>
      <Suspense fallback={<div style={{ padding: 20, fontSize: 11, color: A.textMuted }}>Loading…</div>}>
        <style>{`
          .tp-split-handle {
            flex: 0 0 12px;
            align-self: stretch;
            cursor: col-resize;
            display: flex;
            justify-content: center;
            position: relative;
            user-select: none;
            touch-action: none;
          }
          .tp-split-handle:focus-visible {
            outline: 1px solid ${A.green};
            border-radius: 4px;
          }
          .tp-split-handle .tp-split-rail {
            position: sticky;
            top: calc(50vh - 28px);
            width: 3px;
            height: 56px;
            border-radius: 999px;
            background: ${A.borderLight};
            opacity: 0.65;
            transition: background-color 140ms ease, opacity 140ms ease, height 140ms ease, width 140ms ease;
          }
          .tp-split-handle:hover .tp-split-rail,
          .tp-split-handle[data-dragging="true"] .tp-split-rail {
            background: ${A.green};
            opacity: 1;
            width: 4px;
            height: 76px;
          }
          .tp-split-handle::before {
            content: "";
            position: absolute;
            top: 0;
            bottom: 0;
            left: 50%;
            width: 1px;
            transform: translateX(-0.5px);
            background: transparent;
            transition: background-color 140ms ease;
          }
          .tp-split-handle:hover::before,
          .tp-split-handle[data-dragging="true"]::before {
            background: ${A.borderLight};
          }
          @media (max-width: 900px) {
            .tp-split-presets { display: none !important; }
            .tp-lead-row { flex-direction: column; align-items: stretch !important; gap: 10px !important; }
            .tp-lead-row > div { flex: 1 1 auto !important; width: 100% !important; }
            .tp-split-handle { display: none !important; }
            .tp-lead-chart { position: static !important; max-height: none !important; }
            .tp-lead-label { width: 84px !important; }
            .tp-topbar { padding: 8px 12px !important; }
          }
          @media (max-width: 520px) {
            .tp-hide-sm { display: none; }
          }
        `}</style>
        {chartSlot && (
          <div
            className="tp-split-presets"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: A.textMuted,
              }}
            >
              Layout
            </span>
            <div
              role="group"
              aria-label="Split pane width presets"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                padding: 2,
                borderRadius: 6,
                background: A.bgCard,
                border: `1px solid ${A.border}`,
              }}
            >
              {SPLIT_PRESETS.map((p) => {
                const active = Math.abs(splitPct - p.pct) <= 1;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applySplitPreset(p.pct)}
                    title={`Set feed column to ${p.pct}% / chart to ${100 - p.pct}%`}
                    style={{
                      background: active ? A.bgHover : "transparent",
                      border: `1px solid ${active ? A.green : "transparent"}`,
                      color: active ? A.green : A.textDim,
                      borderRadius: 5,
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: active ? 700 : 600,
                      cursor: "pointer",
                      lineHeight: 1.3,
                      transition: "background-color 140ms ease, border-color 140ms ease, color 140ms ease",
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <span
              title="Feed / Chart width ratio (drag vertical divider between panes to customize)"
              style={{
                fontSize: 10,
                fontFamily: "monospace",
                color: A.textMuted,
                fontVariantNumeric: "tabular-nums",
                minWidth: 38,
                textAlign: "right",
              }}
            >
              {Math.round(splitPct)}/{Math.round(100 - splitPct)}
            </span>
          </div>
        )}
        <div
          ref={splitRowRef}
          style={{
            display: "flex",
            gap: chartSlot ? 0 : 10,
            alignItems: "flex-start",
          }}
          className="tp-lead-row"
        >
          <div
            style={{
              flex: chartSlot ? `0 0 calc(${splitPct}% - 6px)` : "1 1 auto",
              minWidth: 0,
              pointerEvents: draggingSplit ? "none" : undefined,
            }}
            ref={stocksRef}
          >
            {shownLayer && (
              <Card
                A={A}
                title={`${shownLayer.key.startsWith("t:") ? "Theme" : "Layer"}: ${shownLayer.name}`}
                right={
                  <button
                    type="button"
                    onClick={closeLayer}
                    title="Close this layer"
                    style={{ background: "transparent", border: `1px solid ${A.border}`, color: A.textMuted, borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: "pointer", transition: "border-color 140ms ease, color 140ms ease" }}
                  >
                    ✕ Close
                  </button>
                }
              >
                <LayerMembers
                  A={A}
                  layer={shownLayer}
                  tickers={members[shownLayer.key] || (shownLayer.holds || []).map((h) => h.t)}
                  stockMap={stockMapX}
                  onTicker={onTickerClick}
                  chartTicker={chartTicker}
                />
              </Card>
            )}
            {view === "scanner" ? (
              <ScannerPanel
                A={A}
                stockMap={stockMapX}
                onTicker={onTickerClick}
                chartTicker={chartTicker}
                tickerLayer={tickerLayer}
                onLayer={layerOfTicker}
                indexQuotes={indexQuotes}
              />
            ) : view === "options" ? (
              <OptionsPanel
                A={A}
                stockMap={stockMapX}
                portfolio={portfolio}
                watchlist={watchlist}
                chartTicker={chartTicker}
                onTicker={onTickerClick}
              />
            ) : view === "qqq" ? (
              <QqqPanel
                A={A}
                stockMap={stockMapX}
                tickerLayer={tickerLayer}
                indexQuotes={indexQuotes}
                portfolio={portfolio}
                setPortfolio={setPortfolio}
                watchlist={watchlist}
                setWatchlist={setWatchlist}
                onTicker={onTickerClick}
                chartTicker={chartTicker}
              />
            ) : (
              <BriefPanel
                A={A}
                themes={themes}
                layers={layers}
                stockMap={stockMapX}
                tickerLayer={tickerLayer}
                tiers={tiers}
                members={members}
                breadth={breadth}
                monitor={monitor}
                indexQuotes={indexQuotes}
                idxBars={idxBars}
                portfolio={portfolio}
                setPortfolio={setPortfolio}
                watchlist={watchlist}
                setWatchlist={setWatchlist}
                brk={brkStocks}
                pipeline={pipeline}
                dates={dates}
                theme={null}
                lb={layerBreadth}
                onTicker={onTickerClick}
                chartTicker={chartTicker}
                onLayer={(l) => showLayer(l)}
                onTheme={showTheme}
                layerOfTicker={layerOfTicker}
              />
            )}
          </div>
          {chartSlot && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize feed and chart panels"
              aria-valuenow={Math.round(splitPct)}
              aria-valuemin={SPLIT_MIN}
              aria-valuemax={SPLIT_MAX}
              tabIndex={0}
              data-dragging={draggingSplit ? "true" : "false"}
              className="tp-split-handle"
              title="Drag to resize · Double-click to reset (55%)"
              onMouseDown={onSplitDragStart}
              onDoubleClick={() => applySplitPreset(SPLIT_DEFAULT)}
              onKeyDown={onSplitKeyDown}
            >
              <span className="tp-split-rail" />
            </div>
          )}
          {chartSlot && (
            <div
              style={{
                flex: `0 0 calc(${100 - splitPct}% - 6px)`,
                minWidth: 0,
                position: "sticky",
                top: 52,
                maxHeight: "calc(100vh - 56px)",
                overflowY: "auto",
                pointerEvents: draggingSplit ? "none" : undefined,
              }}
              className="tp-lead-chart"
            >
              {chartSlot}
            </div>
          )}
        </div>
      </Suspense>
    </TierCtx.Provider>
  );
}
