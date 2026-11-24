// ──────────────────────────────────────────────────────────────────────────
// LeadershipView — computes universe themes, layers, tiers, and live RS,
// then renders the active workspace view (BRIEF default, or SCANNER) beside
// the sticky chart panel.
// ──────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
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
const ScannerPanel = lazyWithReload(() => import("./lead/Scanner.jsx"));

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

  return (
    <TierCtx.Provider value={tiers}>
      <Suspense fallback={<div style={{ padding: 20, fontSize: 11, color: A.textMuted }}>Loading…</div>}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }} className="tp-lead-row">
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
          <div style={{ flex: "1 1 640px", minWidth: 0 }} ref={stocksRef}>
            {shownLayer && (
              <Card
                A={A}
                title={`${shownLayer.key.startsWith("t:") ? "Theme" : "Layer"}: ${shownLayer.name}`}
                right={
                  <button
                    onClick={closeLayer}
                    title="Close this layer"
                    style={{ background: "transparent", border: `1px solid ${A.border}`, color: A.textMuted, borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}
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
            <div style={{ flex: "1 1 520px", minWidth: 0, position: "sticky", top: 52, maxHeight: "calc(100vh - 56px)", overflowY: "auto" }} className="tp-lead-chart">
              {chartSlot}
            </div>
          )}
        </div>
      </Suspense>
    </TierCtx.Provider>
  );
}
