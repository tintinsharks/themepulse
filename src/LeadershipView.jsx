// ──────────────────────────────────────────────────────────────────────────
// LeadershipView — the one question ThemePulse now answers first:
//   what is LEADING, and what is BREAKING DOWN?
// Three levels, top-down: themes → layers → stocks.
//
// Data (all static, already produced by the pipeline):
//   /data/rs_rotation.json   — 162 layers with now/d1/w1/w2/m1 RS ranks, regime, holds
//   /data/rank_history.json  — daily layer ranks (key "themeId|layer"), ~90 sessions
//   /data/ticker_seats.json  — per-ticker top-decile persistence over the quarter
//   dashboard_data.json      — per-stock rs_rank / MAs (passed in as stockMap)
//
// Thresholds follow the layer backtest: rank >= 88 is the only level with an
// edge, so "leading" means >= 88 and holding. Early rotation (emerging) tested
// NEGATIVE, so it is shown but labelled unproven, never mixed in with leaders.
// ──────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { AdrFilter, Card, ChangesPanel, Delta, ExtHoursMovers, FlaggedTab, IndexPanel, IntradayScan, LEAD, LEAD_INDEXES, LayerMembers, LayerTable, MarketGate, PEAK_LOOKBACK, PIN_ADR, SPARK_N, STATUS, StockTable, Tabs, ThemeBoard, TierCtx, WatchlistPortfolioTab, classify, computeTiers, layerConfirm, layerRanksFrom, layerStats, pinReason, rankHeld, rankTrend, rsLeads, statusColor, td, th, useIndexBars, useJson, useLiveRS, withEpsRating } from "./lead/core.jsx";
export { LEAD_INDEXES, zvrFor, useRvolProfiles, useJson, TierMark, computeTiers } from "./lead/core.jsx";
const BriefPanel = React.lazy(() => import("./lead/Brief.jsx"));
const ScannerPanel = React.lazy(() => import("./lead/Scanner.jsx"));
const RotationView = React.lazy(() => import("./lead/Rotation.jsx"));
const ZangerPanel = React.lazy(() => import("./lead/Zanger.jsx"));

export default function LeadershipView({
  ARIA: A,
  stockMap: stockMapIn,
  onTickerClick,
  chartTicker,
  chartSlot,
  indexQuotes,
  pipeline,
  view = "lead",
  portfolio = [],
  setPortfolio,
  watchlist = [],
  setWatchlist,
}) {
  const rot = useJson("/data/rs_rotation.json");
  const hist = useJson("/data/rank_history.json");
  const seats = useJson("/data/ticker_seats.json");
  const breadth = useJson("/data/breadth.json");
  const [theme, setTheme] = useState(null);
  const idxBars = useIndexBars(LEAD_INDEXES.map((x) => x.t));
  const epsMap = useMemo(() => withEpsRating(stockMapIn), [stockMapIn]);
  const liveRs = useLiveRS(epsMap);
  const stockMap = liveRs.map;
  // ↑/↓ steps through the rows of the Stocks box (whatever tab/sort is showing)
  // and loads each one in the chart. Ignored while typing in a field.
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
  const [layerTab, setLayerTab] = useState("lead");
  const [hidePinned, setHidePinned] = useState(() => { try { return localStorage.getItem("tp_hide_pinned") !== "0"; } catch { return true; } });
  // Stocks box ADR floor — every tab shows only names with 20-day ADR ≥ this (null = off)
  const [adrMin, setAdrMinS] = useState(() => { try { const v = parseFloat(localStorage.getItem("tp_adr_min")); return v > 0 ? v : null; } catch { return null; } });
  const setAdrMin = (v) => { const n = v > 0 ? v : null; setAdrMinS(n); try { localStorage.setItem("tp_adr_min", n ? String(n) : ""); } catch { /* ignore */ } };
  const togglePinned = () => setHidePinned((v) => { try { localStorage.setItem("tp_hide_pinned", v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  const [stockTab, setStockTab] = useState("intra");
  const [expanded, setExpanded] = useState(null);   // layer shown in the Stocks box
  const [themeView, setThemeView] = useState(() => { try { return localStorage.getItem("tp-theme-view") || "board"; } catch { return "board"; } });
  const pickThemeView = (v) => { setThemeView(v); try { localStorage.setItem("tp-theme-view", v); } catch { /* */ } };
  const prevTab = useRef("intra");
  const [lookup, setLookup] = useState("");
  const [lookupQ, setLookupQ] = useState("");
  const layersRef = React.useRef(null);
  const chain = useJson("/data/chain_layers.json");
  const layerBreadth = useJson("/data/layer_breadth.json");
  const health = useJson("/data/universe_health.json");
  const [healthOpen, setHealthOpen] = useState(false);
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
    const c = layerRanksFrom(keys, members, stockMap, "rs_score_close"), v = layerRanksFrom(keys, members, stockMap, "rs_score_live");
    const d = {};
    for (const k of keys) if (c[k] != null && v[k] != null) d[k] = v[k] - c[k];
    return d;
  }, [isLive, rot, members, stockMap]);

  const layers = useMemo(() => {
    if (!rot?.layers) return [];
    const sparkDates = dates.slice(-SPARK_N);
    const peakDates = dates.slice(-PEAK_LOOKBACK);
    const med = (a) => { const v = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    return rot.layers.map((l0) => {
      const key = `${l0.themeId}|${l0.name}`;
      const tks = members[key] || (l0.holds || []).map((x) => x.t);
      // live: rank moves by today's change in the layer's (shrunk) median RS
      const dl = liveRank?.[key];
      const l = dl == null ? l0 : { ...l0, now_close: l0.now, now: Math.max(0, Math.min(100, Math.round(l0.now + dl))) };
      const hClose = sparkDates.map((d) => hist?.[d]?.layers?.[key] ?? null);
      const h = dl == null ? hClose : [...hClose.slice(1), l.now];        // today's live rank as the newest point
      const ph0 = peakDates.map((d) => hist?.[d]?.layers?.[key] ?? null);
      const ph = dl == null ? ph0 : [...ph0, l.now];
      const { st, peak } = classify(l, ph.length ? ph : [l.now, l.w1, l.m1]);
      const stats = layerStats(tks, stockMap || {});
      let conf = layerConfirm(layerBreadth?.layers?.[key]);
      if (conf && isLive) {
        // RS 90+ from live stock RS; "vs 5 sessions ago" is 4 closes back now
        const lbRow = layerBreadth?.layers?.[key];
        const arr = lbRow?.l90 || [];
        let i = arr.length - 1; while (i >= 0 && arr[i] == null) i--;
        const p = i - 4 >= 0 ? arr[i - 4] : null;
        const l90 = tks.filter((t) => (stockMap[t]?.rs_rank ?? 0) >= 90).length;
        const l90d = p != null ? l90 - p : null;
        const passed = conf.passed.filter((k) => k !== "leaders").concat(l90d != null && l90d >= 2 ? ["leaders"] : []);
        conf = { ...conf, l90, l90d, passed, l90Live: true };
      }
      // Today: median member move — live during the session, else the last close
      const today = med(tks.map((t) => (isLive ? stockMap[t]?.chg_live : stockMap[t]?.change_pct)));
      return { ...l, key, hist: h, st, peak, trend: rankTrend(h), held: rankHeld(hClose), stats, conf, today, rankLive: dl != null };
    });
  }, [rot, hist, dates, members, stockMap, layerBreadth, liveRank, isLive]);

  const themes = useMemo(() => {
    const by = {};
    layers.forEach((l) => { (by[l.themeId] ||= { themeId: l.themeId, theme: l.theme, layers: [] }).layers.push(l); });
    const avg = (arr) => arr.reduce((s, x) => s + x, 0) / (arr.length || 1);
    return Object.values(by).map((t) => {
      const L = t.layers;
      const counts = { lead: 0, emerg: 0, weak: 0, brk: 0, lag: 0 };
      L.forEach((l) => counts[l.st]++);
      const now = avg(L.map((l) => l.now)), w1 = avg(L.map((l) => l.w1 ?? l.now)), m1 = avg(L.map((l) => l.m1 ?? l.now));
      const h = L[0].hist.map((_, i) => {
        const v = L.map((l) => l.hist[i]).filter((x) => x != null);
        return v.length ? avg(v) : null;
      });
      // Theme status: driven by its layers, not just the average.
      const share = (n) => n / L.length;
      let st = "lag";
      if (share(counts.lead) >= 0.5 || (now >= 75 && counts.lead >= 1 && counts.brk === 0)) st = "lead";
      else if (share(counts.brk + counts.weak) >= 0.4 && m1 - now >= 10) st = "brk";
      else if (counts.weak + counts.brk >= 1 && now < m1) st = "weak";
      else if (now - m1 >= 15 && now >= 55) st = "emerg";
      const tks = [...new Set(L.flatMap((l) => members[l.key] || (l.holds || []).map((x) => x.t)))];
      return { ...t, counts, now, w1, m1, hist: h, st, trend: rankTrend(h), stats: layerStats(tks, stockMap || {}) };
    }).sort((a, b) => b.now - a.now);
  }, [layers, members, stockMap]);

  const visLayers = theme ? layers.filter((l) => l.themeId === theme) : layers;
  const layerBuckets = useMemo(() => {
    const b = { lead: [], emerg: [], weak: [], brk: [], lag: [] };
    visLayers.forEach((l) => { if (b[l.st]) b[l.st].push(l); });
    b.lead.sort((x, y) => y.now - x.now || (y.persist ?? 0) - (x.persist ?? 0));
    b.emerg.sort((x, y) => (y.now - y.m1) - (x.now - x.m1));
    b.weak.sort((x, y) => (x.now - x.peak) - (y.now - y.peak));
    b.brk.sort((x, y) => (x.now - x.peak) - (y.now - y.peak));
    b.lag.sort((x, y) => y.now - x.now);
    return b;
  }, [visLayers]);

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

  // EPS position inside the stock's own layer (the one shown in its Layer
  // column): the rating stays universe-wide; this is the tiebreaker for
  // picking the fastest grower inside a leading layer.
  const stockMapX = useMemo(() => {
    const out = { ...stockMap };
    for (const [t, l] of Object.entries(tickerLayer)) {
      const s = stockMap[t];
      if (!s || s.eps_rating == null) continue;
      const mem = (members[l.key] || (l.holds || []).map((h) => h.t))
        .filter((x) => stockMap[x]?.eps_rating != null)
        .sort((a, b) => stockMap[b].eps_rating - stockMap[a].eps_rating);
      const pos = mem.indexOf(t) + 1;
      if (pos > 0) out[t] = { ...s, eps_layer_pos: pos, eps_layer_n: mem.length,
        eps_tip: `${s.eps_tip} · #${pos} of ${mem.length} in ${l.name}` };
    }
    return out;
  }, [stockMap, tickerLayer, members]);
  const keepAdr = useMemo(() => (adrMin ? (t) => ((stockMapX[t]?.adr20 ?? stockMapX[t]?.adr_pct) ?? -1) >= adrMin : null), [adrMin, stockMapX]);

  const stocks = useMemo(() => {
    const pm = seats?.persistMap || {};
    const allowed = theme ? new Set(visLayers.flatMap((l) => (l.holds || []).map((h) => h.t))) : null;
    const lead = [], brk = [], pinned = [];
    Object.values(stockMapX || {}).forEach((s) => {
      if (!s?.ticker) return;
      if (allowed && !allowed.has(s.ticker)) return;
      if ((s.avg_dollar_vol_raw ?? 0) < 20e6) return;
      if (keepAdr && !keepAdr(s.ticker)) return;
      const pin = pinReason(s);
      const L = tickerLayer[s.ticker];
      const row = {
        ticker: s.ticker, rs: s.rs_rank, eps: s.eps_rating ?? null, epsTip: s.eps_tip, epsAcc: s.eps_accel, sma50: s.sma50_pct, off: s.off_52w_high, r1m: s.return_1m,
        layer: L?.name, layerSt: L?.st, inLead: L?.st === "lead", persist: pm[s.ticker]?.[0] ?? 0, pin, rsl: rsLeads(s),
      };
      if ((s.rs_rank ?? 0) >= 90 && s.above_50ma && (s.off_52w_high ?? -100) >= -25) {
        if (pin && hidePinned) pinned.push(s.ticker); else lead.push(row);
      }
      // A leader 1-2% under its 50d is a dip (backtest: leaders' red days are
      // dip-buys), not a breakdown — require real damage.
      else if (row.persist >= 40 && ((s.rs_rank ?? 0) < 70 || (s.sma50_pct ?? 0) <= -8)) brk.push(row);
    });
    lead.sort((a, b) => (b.inLead - a.inLead) || (b.rs - a.rs) || (b.off - a.off));
    brk.sort((a, b) => b.persist - a.persist || (a.rs ?? 0) - (b.rs ?? 0));
    return { lead: lead.slice(0, 60), brk: brk.slice(0, 60), pinned: pinned.sort() };
  }, [stockMapX, seats, tickerLayer, theme, visLayers, hidePinned, keepAdr]);

  const tiers = useMemo(() => computeTiers(stockMapX, tickerLayer), [stockMapX, tickerLayer]);

  const lookupHits = useMemo(() => {
    const q = lookupQ;
    if (!q) return null;
    const hits = layers.filter((l) => (members[l.key] || (l.holds || []).map((h) => h.t)).includes(q)).map((l) => {
      const mem = (members[l.key] || []).filter((t) => stockMap[t])
        .sort((a, b) => (stockMap[b]?.rs_rank ?? 0) - (stockMap[a]?.rs_rank ?? 0));
      return { l, pos: mem.indexOf(q) + 1, n: mem.length };
    }).sort((a, b) => b.l.now - a.l.now);
    return hits;
  }, [lookupQ, layers, members, stockMap]);
  const runLookup = (raw) => {
    const t = String(raw || "").trim().toUpperCase();
    setLookupQ(t);
    if (t) onTickerClick(t);
  };
  // Show a layer's members in the Stocks box. chart: load its top-RS member.
  const showLayer = (l, chart = true) => {
    if (stockTab !== "layer") prevTab.current = stockTab;
    setExpanded(l.key); setStockTab("layer");
    if (chart) {
      const top = (members[l.key] || (l.holds || []).map((h) => h.t)).filter((t) => stockMap[t])
        .sort((a, b) => (stockMap[b]?.rs_rank ?? 0) - (stockMap[a]?.rs_rank ?? 0))[0];
      if (top) onTickerClick(top);
    }
    setTimeout(() => stocksRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };
  const closeLayer = () => { setExpanded(null); setStockTab(prevTab.current || "intra"); };
  // a layer opened in one view (LEADERS / SCANNER) doesn't follow you to the other
  const viewRef = useRef(view);
  useEffect(() => {
    if (viewRef.current !== view) { viewRef.current = view; if (stockTab === "layer") closeLayer(); }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const openLayer = (l) => {
    setTheme(null); setLayerTab(l.st); showLayer(l, false);
  };
  const openLayerEvtRef = useRef(null);
  openLayerEvtRef.current = ({ themeId, layer }) => {
    const key = `${themeId}|${layer}`;
    const match = layers.find((l) => l.key === key);
    if (match) openLayer(match);
    else if (themeId) showTheme(themeId);
  };
  useEffect(() => {
    const onOpenLayer = (e) => { if (e?.detail) openLayerEvtRef.current?.(e.detail); };
    window.addEventListener("tp-open-layer", onOpenLayer);
    return () => window.removeEventListener("tp-open-layer", onOpenLayer);
  }, []);
  const [themeLayer, setThemeLayer] = useState(null);   // a whole theme shown like a layer
  const shownLayer = expanded ? (layers.find((l) => l.key === expanded) || (themeLayer?.key === expanded ? themeLayer : null)) : null;
  const showTheme = (themeId) => {
    const t = themes.find((x) => x.themeId === themeId);
    if (!t) return;
    const tks = [...new Set(t.layers.flatMap((l) => members[l.key] || (l.holds || []).map((h) => h.t)))];
    const pseudo = { key: `t:${themeId}`, name: t.theme, theme: `${t.layers.length} layers`, themeId, st: t.st,
      now: Math.round(t.now), w1: t.w1, m1: t.m1, stats: t.stats, holds: tks.map((x) => ({ t: x })) };
    setThemeLayer(pseudo);
    showLayer(pseudo);
  };
  // Layer cell in any stock table: open that layer, keep this stock on the chart
  const layerOfTicker = (t) => {
    const l = tickerLayer[t];
    if (!l) return;
    showLayer(l, false);
    onTickerClick(t);
  };

  const loading = !rot || !hist;
  // Layers card width: when it sits beside Themes (< 900px) the table drops
  // its widest columns (names, sparkline, Held) so it fits without scrolling.
  const layersBoxRef = useRef(null);
  const [layersNarrow, setLayersNarrow] = useState(false);
  useEffect(() => {
    const el = layersBoxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setLayersNarrow(e.contentRect.width < 900));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, view]); // the box mounts once data has loaded, on the LEADERS view
  const regime = breadth?.regime?.primary;
  const verdict = breadth?.conditions?.verdict;
  const cur = breadth?.current;
  const selTheme = themes.find((t) => t.themeId === theme);

  const summary = [
    ["Leading", layerBuckets.lead.length, A.green],
    ["Emerging", layerBuckets.emerg.length, A.cyan],
    ["Weakening", layerBuckets.weak.length, A.yellow],
    ["Breaking down", layerBuckets.brk.length, A.red],
  ];

  return (
    <TierCtx.Provider value={tiers}>
    <Suspense fallback={<div style={{ padding: 20, fontSize: 11, color: A.textMuted }}>Loading…</div>}>
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }} className="tp-lead-row">
      {/* Phone/tablet: stack the chart under the boards instead of squeezing
          it beside them (inline styles can't carry a media query). */}
      <style>{`@media (max-width: 900px) {
        .tp-lead-row { flex-direction: column; align-items: stretch !important; }
        .tp-lead-row > div { flex: 1 1 auto !important; width: 100%; }
        .tp-lead-chart { position: static !important; max-height: none !important; }
        .tp-lead-label { width: 84px !important; }
        .tp-topbar { padding: 8px 12px !important; }
      }
      @media (max-width: 520px) {
        .tp-hide-sm { display: none; }
      }`}</style>
      {view === "scanner" || view === "brief" || view === "zanger" ? (
        <div style={{ flex: "1 1 640px", minWidth: 0 }} ref={stocksRef}>
          {stockTab === "layer" && shownLayer && (
            <Card A={A} title={`${shownLayer.key.startsWith("t:") ? "Theme" : "Layer"}: ${shownLayer.name}`} right={<button onClick={closeLayer} title="Close this layer"
              style={{ background: "transparent", border: `1px solid ${A.border}`, color: A.textMuted, borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>✕ Close</button>}>
              <LayerMembers A={A} layer={shownLayer} tickers={members[shownLayer.key] || (shownLayer.holds || []).map((h) => h.t)}
                stockMap={stockMapX} onTicker={onTickerClick} chartTicker={chartTicker} />
            </Card>
          )}
          {view === "brief"
            ? <BriefPanel A={A} themes={themes} layers={layers} stockMap={stockMapX} tickerLayer={tickerLayer} members={members}
                brk={stocks.brk} pipeline={pipeline} dates={dates} theme={theme} lb={layerBreadth}
                onTicker={onTickerClick} chartTicker={chartTicker} onLayer={(l) => showLayer(l)} onTheme={showTheme} layerOfTicker={layerOfTicker} />
            : view === "zanger"
            ? <ZangerPanel A={A} stockMap={stockMapX} layers={layers} themes={themes} tickerLayer={tickerLayer} tiers={tiers}
                onTicker={onTickerClick} chartTicker={chartTicker} onLayer={layerOfTicker} />
            : <ScannerPanel A={A} stockMap={stockMapX} onTicker={onTickerClick} chartTicker={chartTicker} tickerLayer={tickerLayer} onLayer={layerOfTicker} />}
        </div>
      ) : (
      <div style={{ flex: "1 1 640px", minWidth: 0 }}>
        {/* Header strip: market backdrop + layer counts */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", background: A.bgCard, border: `1px solid ${A.border}`, borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: A.textMuted, letterSpacing: 0.4 }}>BREADTH{breadth?.date ? ` · ${breadth.date}` : ""}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: regime === "RISK ON" ? A.green : regime ? A.red : A.textDim }}>
              {regime || "—"}{verdict ? <span style={{ color: A.textDim, fontWeight: 500 }}> · {verdict}</span> : null}
            </div>
          </div>
          {cur && (
            <div style={{ fontSize: 11, color: A.textDim }}>
              Above 20d <b style={{ color: A.text }}>{cur.pct_above_20ema}%</b> · 50d <b style={{ color: A.text }}>{cur.pct_above_50ema}%</b> · 200d <b style={{ color: A.text }}>{cur.pct_above_200ema}%</b>
            </div>
          )}
          <div style={{ display: "flex", gap: 14, marginLeft: "auto" }}>
            {summary.map(([k, n, c]) => (
              <div key={k} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: c, lineHeight: 1 }}>{n}</div>
                <div style={{ fontSize: 10, color: A.textMuted }}>{k}</div>
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); runLookup(lookup); }} style={{ display: "flex", gap: 4 }}>
            <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Find ticker…" aria-label="Find a ticker's layers"
              style={{ width: 110, background: A.bgRow, border: `1px solid ${A.border}`, borderRadius: 4, color: A.text, fontSize: 12, padding: "4px 7px", fontFamily: "monospace", textTransform: "uppercase" }} />
            {lookupQ && <button type="button" onClick={() => { setLookup(""); setLookupQ(""); }}
              style={{ background: "transparent", border: `1px solid ${A.border}`, borderRadius: 4, color: A.textDim, fontSize: 11, cursor: "pointer" }}>×</button>}
          </form>
          <MarketGate A={A} gate={breadth?.conditions?.market_gate} liveQuotes={indexQuotes} />
          <div style={{ fontSize: 10, color: A.textMuted, width: "100%" }}>
            Layers as of {rot?.date || "…"} · {layers.length} layers · leading = RS rank ≥ {LEAD}
            {selTheme ? <> · filtered to <b style={{ color: A.text }}>{selTheme.theme}</b> <button onClick={() => setTheme(null)} style={{ background: "none", border: "none", color: A.cyan, cursor: "pointer", fontSize: 10 }}>clear</button></> : null}
          </div>
        </div>

        {/* What changed today, then Major indexes, right under the header strip / market gate */}
        <ChangesPanel A={A} layers={layers} themes={themes} bars={idxBars} liveQuotes={indexQuotes} date={rot?.date}
          onTicker={onTickerClick} onLayer={(l) => { setTheme(l.themeId); setLayerTab(l.st); showLayer(l); }}
          onTheme={(id) => setTheme(id)} />
        <IndexPanel A={A} liveQuotes={indexQuotes} onTicker={onTickerClick} chartTicker={chartTicker} bars={idxBars} />

        {loading ? (
          <div style={{ color: A.textMuted, fontSize: 12, padding: 20 }}>Loading leadership data…</div>
        ) : (
          <>
            {lookupHits && (() => {
              const s = stockMap[lookupQ];
              const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`);
              return (
                <Card A={A} title={`${lookupQ}${s?.company && s.company !== 0 ? ` · ${s.company}` : ""}`}
                  sub={s ? `RS ${s.rs_rank ?? "—"}${s.rs_live ? ` live (close ${s.rs_rank_close ?? "—"})` : ""} · vs 50d ${pct(s.sma50_pct)} · off high ${pct(s.off_52w_high)} · ${s.industry || ""}` : "Not in the ThemePulse universe"}
                  right={<button onClick={() => { setLookup(""); setLookupQ(""); }} style={{ background: "transparent", border: "none", color: A.cyan, cursor: "pointer", fontSize: 11 }}>close</button>}>
                  {!lookupHits.length ? (
                    <div style={{ fontSize: 11, color: A.textMuted }}>{s ? "In the universe but not in any layer (trades under $10M/day, or no industry mapping)." : "No layers."}</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>
                        <th style={th(A)}>Layer</th><th style={th(A, "right")}>Rank</th><th style={th(A)}>Status</th>
                        <th style={th(A, "right")}>1m</th><th style={th(A, "right")} title="Position by RS rank among the layer's members">{lookupQ} in layer</th>
                      </tr></thead>
                      <tbody>
                        {lookupHits.map(({ l, pos, n }) => (
                          <tr key={l.key} onClick={() => openLayer(l)} style={{ cursor: "pointer" }} title="Open this layer below">
                            <td style={td(A)}><span style={{ color: A.text, fontWeight: 600 }}>{l.name}</span> <span style={{ fontSize: 10, color: A.textMuted }}>{l.theme}</span></td>
                            <td style={{ ...td(A, "right"), color: statusColor(l.st, A), fontWeight: 700 }}>{l.now}</td>
                            <td style={{ ...td(A), color: statusColor(l.st, A) }}>{STATUS[l.st].label}</td>
                            <td style={td(A, "right")}><Delta v={l.now - l.m1} A={A} /></td>
                            <td style={td(A, "right")}>{pos ? `${pos} of ${n}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              );
            })()}
            <div ref={stocksRef}>
            <Card A={A} title="Stocks"
              sub={stockTab === "layer" ? undefined : stockTab === "lead"
                ? <span>RS ≥ 90, above the 50-day, within 25% of the high · <span style={{ color: A.green }}>●</span> in a leading layer · <span style={{ color: A.blue || "#3b82f6" }}>●</span> RS line new high on an up close, price 5–15% off ·{" "}
                    <button onClick={togglePinned}
                      title={`Buyout-pinned / no-range names: 20-day or 5-day ADR under ${PIN_ADR}%, or a 5-day ADR collapsed to under half its normal while sitting at the high.${stocks.pinned.length ? `\nHidden: ${stocks.pinned.join(", ")}` : ""}`}
                      style={{ background: hidePinned ? A.bgHover : "transparent", border: `1px solid ${hidePinned ? A.yellow : A.border}`, color: hidePinned ? A.yellow : A.textMuted,
                        borderRadius: 4, padding: "1px 7px", fontSize: 10, cursor: "pointer" }}>
                      {hidePinned ? `Hiding ${stocks.pinned.length} pinned (ADR < ${PIN_ADR}% / M&A)` : `Show pinned names · click to hide`}
                    </button></span>
                : stockTab === "intra" || stockTab === "ext" || stockTab === "flag" || stockTab === "pw"
                ? undefined
                : "Held the top RS decile ≥ 40% of the quarter, now RS < 70 or ≥ 8% below the 50-day"}
              right={<div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                {shownLayer && (
                  <span style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${stockTab === "layer" ? statusColor(shownLayer.st, A) : A.border}`,
                    borderRadius: 4, background: stockTab === "layer" ? A.bgHover : "transparent" }}>
                    <button onClick={() => setStockTab("layer")}
                      style={{ background: "transparent", border: "none", color: stockTab === "layer" ? statusColor(shownLayer.st, A) : A.textDim,
                        padding: "3px 4px 3px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      {shownLayer.key.startsWith("t:") ? "Theme" : "Layer"}: {shownLayer.name} <span style={{ opacity: 0.7 }}>{(members[shownLayer.key] || shownLayer.holds || []).length}</span>
                    </button>
                    <button onClick={closeLayer} title="Close this layer"
                      style={{ background: "transparent", border: "none", color: A.textMuted, padding: "3px 7px 3px 3px", fontSize: 11, cursor: "pointer" }}>✕</button>
                  </span>
                )}
                <AdrFilter A={A} value={adrMin} onChange={setAdrMin} />
                <Tabs A={A} value={stockTab} onChange={setStockTab} items={[
                ["lead", "Leaders", stocks.lead.length, A.green],
                ["brk", "Leaders breaking down", stocks.brk.length, A.red],
                ["intra", "Intraday scan", "", A.cyan],
                ["ext", "Pre/After-market", "", A.purple],
                ["flag", "Flagged", "", A.gold],
                ["pw", "Watchlist / Portfolio", new Set([...(portfolio || []), ...(watchlist || [])]).size || "", A.blue || "#3b82f6"],
              ]} /></div>}>
              {stockTab === "layer" && shownLayer
                ? <LayerMembers A={A} layer={shownLayer} tickers={members[shownLayer.key] || (shownLayer.holds || []).map((h) => h.t)}
                    stockMap={stockMapX} onTicker={onTickerClick} chartTicker={chartTicker} keep={keepAdr} />
                : stockTab === "pw"
                ? <WatchlistPortfolioTab A={A} stockMap={stockMapX} tickerLayer={tickerLayer} onTicker={onTickerClick} chartTicker={chartTicker} onLayer={layerOfTicker}
                    portfolio={portfolio} setPortfolio={setPortfolio} watchlist={watchlist} setWatchlist={setWatchlist} />
                : stockTab === "flag"
                ? <FlaggedTab A={A} stockMap={stockMapX} tickerLayer={tickerLayer} onTicker={onTickerClick} chartTicker={chartTicker} onLayer={layerOfTicker} keep={keepAdr} />
                : stockTab === "ext"
                ? <ExtHoursMovers A={A} pipeline={pipeline} stockMap={stockMapX} tickerLayer={tickerLayer} onTicker={onTickerClick} chartTicker={chartTicker} onLayer={layerOfTicker} keep={keepAdr} />
                : stockTab === "intra"
                ? <IntradayScan A={A} stockMap={stockMapX} onTicker={onTickerClick} chartTicker={chartTicker} tickerLayer={tickerLayer} onLayer={layerOfTicker} keep={keepAdr}
                    allowed={theme ? new Set(visLayers.flatMap((l) => members[l.key] || (l.holds || []).map((h) => h.t))) : null} />
                : <StockTable rows={stocks[stockTab]} A={A} onTicker={onTickerClick} chartTicker={chartTicker} mode={stockTab} onLayer={layerOfTicker} />}
            </Card>
            </div>


            {/* Themes and Layers side by side. The Rotation tab's charts need
                the full width, so the pair stacks while it is open; narrow
                screens wrap to a stack as well. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
            <div style={{ flex: themeView === "rot" ? "1 1 100%" : "0 1 200px", minWidth: 0 }}>
            <Card A={A} title="Themes"
              sub={themeView === "rot" ? "Who is rotating in and out — RS rank change by layer or theme" : "Average layer RS rank · ▲ leading / weakening / ▼ breaking-down layers · click to filter"}
              right={<Tabs A={A} value={themeView} onChange={pickThemeView} items={[["board", "Board", "", A.green], ["rot", "Rotation", "", A.cyan]]} />}>
              {themeView === "rot"
                ? <RotationView A={A} layers={layers} themes={themes} dates={dates} theme={theme} lb={layerBreadth}
                    onLayer={(l) => showLayer(l)} onTheme={(id, stocks) => (stocks ? showTheme(id) : setTheme(id))} />
                : <div style={{ maxHeight: 640, overflowY: "auto" }}><ThemeBoard themes={themes} A={A} selected={theme} onSelect={setTheme} /></div>}
            </Card>
            </div>
            <div ref={layersBoxRef} style={{ flex: themeView === "rot" ? "1 1 100%" : "1 1 560px", minWidth: 0 }}>
            <Card A={A} title="Layers" sub={<>{STATUS[layerTab].hint}{liveRs.at
                ? <span style={{ color: A.cyan }}> · Rank, 1w/1m, Trend, RS 90+ and Today live as of {liveRs.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (hourly)</span>
                : null}</>}
              right={<Tabs A={A} value={layerTab} onChange={setLayerTab} items={[
                ["lead", "Leading", layerBuckets.lead.length, A.green],
                ["weak", "Weakening", layerBuckets.weak.length, A.yellow],
                ["brk", "Breaking down", layerBuckets.brk.length, A.red],
                ["emerg", "Emerging", layerBuckets.emerg.length, A.cyan],
                ["lag", "Lagging", layerBuckets.lag.length, A.textDim],
              ]} />}>
              <div ref={layersRef} />
              <LayerTable rows={layerBuckets[layerTab]} A={A} onTicker={onTickerClick} chartTicker={chartTicker} stockMap={stockMapX}
                showPeak={layerTab === "weak" || layerTab === "brk"} members={members} expanded={expanded} onToggle={(l) => showLayer(l)} focus={lookupQ}
                compact={layersNarrow} />
            </Card>
            </div>
            </div>



            {health?.checks && (() => {
              const warn = health.checks.filter((c) => c.status === "warn");
              return (
                <Card A={A} title="Universe health"
                  sub={`${health.in_layer} of ${health.universe} names in a layer · ${health.layers} layers · checked ${String(health.generated || "").replace("T", " ")}`}
                  right={<button onClick={() => setHealthOpen((v) => !v)}
                    style={{ background: "transparent", border: `1px solid ${warn.length ? A.yellow : A.green}`, borderRadius: 4, cursor: "pointer",
                      color: warn.length ? A.yellow : A.green, fontSize: 11, padding: "2px 8px" }}>
                    {warn.length ? `${warn.length} to review` : "all clear"} {healthOpen ? "▲" : "▼"}</button>}>
                  {healthOpen && health.checks.map((c) => (
                    <div key={c.id} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: `1px solid ${A.border}`, fontSize: 11 }}>
                      <span style={{ color: c.status === "warn" ? A.yellow : A.green, width: 14 }}>{c.status === "warn" ? "!" : "✓"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: A.text }}>{c.label} <b>{c.count}</b></div>
                        {c.count > 0 && (
                          <div style={{ color: A.textMuted, fontFamily: "monospace", fontSize: 10, wordBreak: "break-word" }}>
                            {c.items.join(", ")}{c.count > c.items.length ? " …" : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </Card>
              );
            })()}
          </>
        )}
      </div>
      )}
      {chartSlot && (
        <div style={{ flex: "1 1 520px", minWidth: 0, position: "sticky", top: 0, maxHeight: "100vh", overflowY: "auto" }} className="tp-lead-chart">
          {chartSlot}
        </div>
      )}
    </div>
    </Suspense>
    </TierCtx.Provider>
  );
}

