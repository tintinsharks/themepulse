import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../utils.js";
import {
  AdrFilter,
  Card,
  CopyTickersBtn,
  FlagButton,
  MONO,
  RslDot,
  TierMark,
  etClock,
  th,
  td,
  useRvolProfiles,
  useScanQuotes,
  zvrFor,
} from "./core.jsx";
import {
  NDX_CONSTITUENTS,
  NDX_GROUPS,
  NDX_TICKERS,
  buildQqqBreadthSeries,
  computeNdxInternals,
  computeQqqBreadthTrend,
  computeQqqIntradayPredictor,
  computeQqqShortTermBias,
  computeQqqTechnicals,
} from "./qqqMath.js";

const BENCH_TKS = ["QQQ", "QQQE", "SPY", "IWM", "TQQQ", "SQQQ"];
const ALL_QUOTE_TKS = [...new Set([...BENCH_TKS, ...NDX_TICKERS])];
const STAGE_COLOR = { 1: "#64748b", 2: "#3b82f6", 3: "#eab308", 4: "#ec4899" };
const GROUP_COLOR = Object.fromEntries(NDX_GROUPS.map((g) => [g.id, g.color]));
const GROUP_SHORT = { mag7: "MAG7", semi: "SEMI", soft: "SOFT", cons: "CONS", health: "HLTH", ind: "IND" };
const BREADTH_RANGES = [
  [63, "3M"],
  [126, "6M"],
  [252, "1Y"],
  [504, "2Y"],
  [780, "3Y"],
];

let _qqqBreadthCache = { ts: 0, rows: null, inflight: null };
function fetchQqqBreadthHistory() {
  const now = Date.now();
  if (_qqqBreadthCache.rows && now - _qqqBreadthCache.ts < 10 * 60 * 1000) {
    return Promise.resolve(_qqqBreadthCache.rows);
  }
  if (_qqqBreadthCache.inflight) return _qqqBreadthCache.inflight;
  _qqqBreadthCache.inflight = fetch("/data/qqq_breadth_history.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const rows = Array.isArray(d?.history) ? d.history : [];
      if (rows.length > 0) {
        _qqqBreadthCache = { ts: Date.now(), rows, inflight: null };
        return rows;
      }
      _qqqBreadthCache.inflight = null;
      return _qqqBreadthCache.rows || [];
    })
    .catch(() => {
      _qqqBreadthCache.inflight = null;
      return _qqqBreadthCache.rows || [];
    });
  return _qqqBreadthCache.inflight;
}

const fmtPx = (v) => (typeof v === "number" && Number.isFinite(v) ? `$${v.toFixed(2)}` : "—");
const fmtPct = (v, dg = 1) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(dg)}%` : "—");
const fmtBps = (v) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : "—");

function QqqBreadthHistoryChart({ A, fullSeries, trend, range, onRange }) {
  const [mode, setMode] = useState("ma"); // "ma" | "ad"
  const [showQqq, setShowQqq] = useState(true);
  const [hoverIdx, setHoverIdx] = useState(null);

  const series = useMemo(
    () => (Array.isArray(fullSeries) ? fullSeries.slice(-range) : []),
    [fullSeries, range]
  );

  if (!series.length) {
    return (
      <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 10px", marginTop: 8, background: A.bg, border: `1px solid ${A.border}`, borderRadius: 8 }}>
        Loading 3-year Nasdaq-100 breadth history…
      </div>
    );
  }

  const W = 620, H = 178;
  const n = series.length;
  const padL = 34, padT = 12, padB = 22;
  const qVals = series.map((d) => d.qqq).filter((v) => typeof v === "number" && Number.isFinite(v));
  const hasQqq = showQqq && qVals.length >= 2;
  const padR = hasQqq ? 42 : 10;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xOf = (i) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);

  // QQQ right-axis scaling
  const qMin = hasQqq ? Math.min(...qVals) : 0;
  const qMax = hasQqq ? Math.max(...qVals) : 1;
  const qSpan = Math.max(qMax - qMin, 1);
  const qLo = qMin - qSpan * 0.05;
  const qHi = qMax + qSpan * 0.05;
  const yQqq = (v) => padT + plotH - ((v - qLo) / (qHi - qLo)) * plotH;
  const qqqPath = hasQqq
    ? series.reduce((segs, d, i) => {
        if (d.qqq == null) return segs;
        segs.push(`${segs.length === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yQqq(d.qqq).toFixed(1)}`);
        return segs;
      }, []).join(" ")
    : "";

  // Left-axis scaling: 0..100% for MA mode, min..max for Cum A/D mode
  const yPct = (v) => padT + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;
  const adBase = series[0]?.cumAd ?? 0;
  const relAd = series.map((d) => (d.cumAd ?? 0) - adBase);
  const adMin = Math.min(0, ...relAd);
  const adMax = Math.max(0, ...relAd);
  const adSpan = Math.max(adMax - adMin, 10);
  const adLo = adMin - adSpan * 0.06;
  const adHi = adMax + adSpan * 0.06;
  const yAd = (v) => padT + plotH - ((v - adLo) / (adHi - adLo)) * plotH;

  const linePath = (getter, yFn) => {
    const segs = [];
    for (let i = 0; i < n; i++) {
      const v = getter(series[i], i);
      if (v == null || !Number.isFinite(v)) continue;
      segs.push(`${segs.length === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yFn(v).toFixed(1)}`);
    }
    return segs.join(" ");
  };

  const p20Path = mode === "ma" ? linePath((d) => d.p20, yPct) : "";
  const p50Path = mode === "ma" ? linePath((d) => d.p50, yPct) : "";
  const p200Path = mode === "ma" ? linePath((d) => d.p200, yPct) : "";
  const ema20Path = mode === "ma" ? linePath((d) => d.p50Ema20, yPct) : "";
  const adPath = mode === "ad" ? linePath((_, i) => relAd[i], yAd) : "";
  const adZeroY = yAd(0);
  const adArea = mode === "ad" && n >= 2
    ? `${adPath} L${xOf(n - 1).toFixed(1)},${adZeroY.toFixed(1)} L${xOf(0).toFixed(1)},${adZeroY.toFixed(1)} Z`
    : "";

  const activeIdx = hoverIdx != null && hoverIdx < n ? hoverIdx : n - 1;
  const cur = series[activeIdx];
  const curRelAd = relAd[activeIdx];
  const activeX = xOf(activeIdx);

  const onSvgMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = (svgX - padL) / plotW;
    const idx = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
    setHoverIdx(idx);
  };

  const fmtAxisDate = (d) => (d === "Today (Live)" ? "Live" : n > 260 ? String(d || "").slice(0, 7) : String(d || "").slice(2));
  const q1Idx = Math.floor((n - 1) * 0.25);
  const midIdx = Math.floor((n - 1) * 0.5);
  const q3Idx = Math.floor((n - 1) * 0.75);
  const qqqStroke = A.text || "#f8fafc";
  const qqqHalo = A.bg || "#0d1117";

  const fmtD = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);

  return (
    <div style={{ marginTop: 10, marginBottom: 12, padding: "10px 12px 8px", background: A.bg, border: `1px solid ${A.border}`, borderRadius: 8 }}>
      {/* Top readout & controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 6, fontSize: 11 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
          <strong style={{ color: A.text }}>{cur.date}</strong>
          {mode === "ma" ? (
            <>
              <span style={{ color: "#eab308" }}>&gt;20d <strong>{cur.p20 != null ? `${cur.p20.toFixed(1)}%` : "—"}</strong></span>
              <span style={{ color: "#3b82f6" }}>&gt;50d <strong>{cur.p50.toFixed(1)}%</strong></span>
              <span style={{ color: "#4ade80" }}>&gt;200d <strong>{cur.p200 != null ? `${cur.p200.toFixed(1)}%` : "—"}</strong></span>
            </>
          ) : (
            <>
              <span style={{ color: curRelAd >= 0 ? "#3b82f6" : "#ec4899" }}>
                Cum A/D <strong>{curRelAd > 0 ? `+${curRelAd}` : curRelAd}</strong>
              </span>
              {cur.adv != null && cur.dec != null && (
                <span style={{ color: A.textDim }}>
                  Day <strong style={{ color: A.green }}>{cur.adv}↑</strong>/<strong style={{ color: A.red }}>{cur.dec}↓</strong>
                </span>
              )}
            </>
          )}
          {hasQqq && cur.qqq != null && (
            <span style={{ color: A.text, fontWeight: 700 }}>QQQ ${cur.qqq.toFixed(2)}</span>
          )}
        </div>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {[["ma", "MA %"], ["ad", "Cum A/D"]].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              style={{
                background: mode === k ? A.bgHover : "transparent",
                border: `1px solid ${mode === k ? A.cyan : A.border}`,
                color: mode === k ? A.cyan : A.textMuted,
                borderRadius: 6,
                padding: "1px 6px",
                fontSize: 10.5,
                fontWeight: mode === k ? 700 : 600,
                cursor: "pointer",
              }}
            >
              {lbl}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowQqq((v) => !v)}
            title="Toggle QQQ closing price overlay (right axis)"
            style={{
              background: showQqq ? A.bgHover : "transparent",
              border: `1px solid ${showQqq ? A.text : A.border}`,
              color: showQqq ? A.text : A.textMuted,
              borderRadius: 6,
              padding: "1px 6px",
              fontSize: 10.5,
              fontWeight: showQqq ? 700 : 600,
              cursor: "pointer",
            }}
          >
            QQQ
          </button>
          {BREADTH_RANGES.map(([days, lbl]) => (
            <button
              key={lbl}
              type="button"
              onClick={() => { setHoverIdx(null); onRange(days); }}
              style={{
                background: range === days ? A.bgHover : "transparent",
                border: `1px solid ${range === days ? "#3b82f6" : A.border}`,
                color: range === days ? "#3b82f6" : A.textMuted,
                borderRadius: 6,
                padding: "1px 6px",
                fontSize: 10.5,
                fontWeight: range === days ? 700 : 600,
                cursor: "pointer",
              }}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Trend deltas + 3Y percentile strip */}
      {trend && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6, fontSize: 10.5, fontFamily: MONO, color: A.textMuted }}>
          <span>
            &gt;50d Δ:{" "}
            {[["5d", trend.d5.p50], ["10d", trend.d10.p50], ["20d", trend.d20.p50], ["60d", trend.d60.p50]].map(([lbl, v], i) => (
              <span key={lbl} style={{ marginLeft: i ? 6 : 0 }}>
                {lbl} <strong style={{ color: v == null ? A.textMuted : v >= 0 ? A.green : A.red }}>{fmtD(v)}</strong>
              </span>
            ))}
          </span>
          <span title={`3-year >50d SMA range: min ${trend.min50}% · median ${trend.med}% · max ${trend.max50}% (${trend.sessions} sessions)`}>
            3Y %ile <strong style={{ color: trend.pctile >= 60 ? A.green : trend.pctile <= 30 ? "#f59e0b" : A.text }}>{trend.pctile}th</strong>
            <span style={{ opacity: 0.75 }}> (med {trend.med}%)</span>
          </span>
        </div>
      )}

      {/* SVG Plot */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
        onMouseMove={onSvgMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {mode === "ma" ? (
          <>
            {/* Overbought / Midline / Oversold zones */}
            <rect x={padL} y={padT} width={plotW} height={yPct(80) - padT} fill={A.green} fillOpacity="0.05" />
            <rect x={padL} y={yPct(20)} width={plotW} height={padT + plotH - yPct(20)} fill="#ec4899" fillOpacity="0.06" />
            {[80, 50, 20].map((lvl) => (
              <g key={lvl}>
                <line
                  x1={padL}
                  y1={yPct(lvl)}
                  x2={W - padR}
                  y2={yPct(lvl)}
                  stroke={lvl === 50 ? A.textMuted : lvl === 80 ? A.green : "#ec4899"}
                  strokeDasharray={lvl === 50 ? "3 3" : "2 3"}
                  strokeOpacity={lvl === 50 ? 0.55 : 0.4}
                />
                <text x={padL - 5} y={yPct(lvl) + 3} textAnchor="end" fontSize="9" fill={A.textMuted} fontFamily={MONO}>
                  {lvl}%
                </text>
              </g>
            ))}

            {p20Path && <path d={p20Path} fill="none" stroke="#eab308" strokeWidth="1" strokeOpacity="0.55" strokeLinejoin="round" />}
            {p200Path && <path d={p200Path} fill="none" stroke="#4ade80" strokeWidth="1.35" strokeOpacity="0.85" strokeLinejoin="round" />}
            {ema20Path && <path d={ema20Path} fill="none" stroke="#f472b6" strokeWidth="1.2" strokeDasharray="3 2" strokeOpacity="0.85" />}
            {p50Path && <path d={p50Path} fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinejoin="round" />}
          </>
        ) : (
          <>
            <line x1={padL} y1={adZeroY} x2={W - padR} y2={adZeroY} stroke={A.textMuted} strokeDasharray="3 3" strokeOpacity="0.55" />
            <text x={padL - 5} y={padT + 8} textAnchor="end" fontSize="9" fill={A.textMuted} fontFamily={MONO}>{Math.round(adMax)}</text>
            <text x={padL - 5} y={adZeroY + 3} textAnchor="end" fontSize="9" fill={A.textMuted} fontFamily={MONO}>0</text>
            <text x={padL - 5} y={padT + plotH} textAnchor="end" fontSize="9" fill={A.textMuted} fontFamily={MONO}>{Math.round(adMin)}</text>
            {adArea && <path d={adArea} fill={curRelAd >= 0 ? "#3b82f6" : "#ec4899"} fillOpacity="0.12" />}
            {adPath && <path d={adPath} fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinejoin="round" />}
          </>
        )}

        {/* Right Y-axis QQQ price overlay */}
        {hasQqq && (
          <>
            <text x={W - padR + 5} y={padT + 8} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily={MONO}>${Math.round(qMax)}</text>
            <text x={W - padR + 5} y={padT + plotH / 2 + 3} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily={MONO}>${Math.round((qMax + qMin) / 2)}</text>
            <text x={W - padR + 5} y={padT + plotH} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily={MONO}>${Math.round(qMin)}</text>
            <path d={qqqPath} fill="none" stroke={qqqHalo} strokeWidth="3" strokeOpacity="0.65" strokeLinejoin="round" />
            <path d={qqqPath} fill="none" stroke={qqqStroke} strokeWidth="1.5" strokeLinejoin="round" />
          </>
        )}

        {/* Hover vertical crosshair & markers */}
        <line x1={activeX} y1={padT} x2={activeX} y2={padT + plotH} stroke={A.textMuted} strokeWidth="1" strokeDasharray="2 2" strokeOpacity="0.6" />
        {mode === "ma" ? (
          <circle cx={activeX} cy={yPct(cur.p50)} r="3.2" fill="#3b82f6" stroke={qqqHalo} strokeWidth="1.2" />
        ) : (
          <circle cx={activeX} cy={yAd(curRelAd)} r="3.2" fill="#3b82f6" stroke={qqqHalo} strokeWidth="1.2" />
        )}
        {hasQqq && cur.qqq != null && (
          <circle cx={activeX} cy={yQqq(cur.qqq)} r="3" fill={qqqStroke} stroke={qqqHalo} strokeWidth="1.2" />
        )}

        {/* X-axis ticks */}
        <text x={padL} y={H - 5} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily={MONO}>{fmtAxisDate(series[0].date)}</text>
        {n > 40 && (
          <text x={xOf(q1Idx)} y={H - 5} textAnchor="middle" fontSize="9" fill={A.textMuted} fontFamily={MONO}>{fmtAxisDate(series[q1Idx].date)}</text>
        )}
        {n > 6 && (
          <text x={xOf(midIdx)} y={H - 5} textAnchor="middle" fontSize="9" fill={A.textMuted} fontFamily={MONO}>{fmtAxisDate(series[midIdx].date)}</text>
        )}
        {n > 40 && (
          <text x={xOf(q3Idx)} y={H - 5} textAnchor="middle" fontSize="9" fill={A.textMuted} fontFamily={MONO}>{fmtAxisDate(series[q3Idx].date)}</text>
        )}
        <text x={W - padR} y={H - 5} textAnchor="end" fontSize="9" fill={series[n - 1].isLive ? A.green : A.textMuted} fontFamily={MONO}>{fmtAxisDate(series[n - 1].date)}</text>
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4, fontSize: 10, color: A.textMuted }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {mode === "ma" ? (
            <>
              <span><span style={{ color: "#3b82f6" }}>━</span> &gt;50d SMA</span>
              <span><span style={{ color: "#f472b6" }}>╌</span> 20d EMA (&gt;50d)</span>
              <span><span style={{ color: "#4ade80" }}>━</span> &gt;200d SMA</span>
              <span><span style={{ color: "#eab308" }}>━</span> &gt;20d SMA</span>
            </>
          ) : (
            <span><span style={{ color: "#3b82f6" }}>━</span> NDX Cumulative A/D (window-rebased)</span>
          )}
          {hasQqq && <span><span style={{ color: A.text }}>━</span> QQQ (right)</span>}
        </div>
        <span>{n} sessions ({series[0].date} → {series[n - 1].date})</span>
      </div>
    </div>
  );
}

function MiniBar({ title, pct, left, right, color, A }) {
  const safe = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: A.text }}>{title}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
          {Number.isFinite(pct) ? `${Math.round(pct)}%` : "—"}
        </span>
      </div>
      <div style={{ height: 7, width: "100%", borderRadius: 999, background: A.border, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${safe}%`, background: color, borderRadius: 999, transition: "width 0.3s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 10.5, color: A.textMuted, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

export default function QqqPanel({
  A,
  stockMap,
  tickerLayer = {},
  indexQuotes,
  portfolio = [],
  setPortfolio,
  watchlist = [],
  setWatchlist,
  onTicker,
  onOpenOptions,
  chartTicker,
}) {
  const { quotes, at } = useScanQuotes(ALL_QUOTE_TKS, true);
  const profiles = useRvolProfiles();
  const [qqqBars, setQqqBars] = useState([]);
  const [breadthArchive, setBreadthArchive] = useState(() => _qqqBreadthCache.rows);
  const [breadthRange, setBreadthRange] = useState(780); // default 3Y lookback
  const [mq, setMq] = useState(null);
  const [groupFilter, setGroupFilter] = useState("all"); // all | mag7 | semi | soft | cons | health | ind | bo | weak
  const [minAdr, setMinAdr] = useState(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ k: "thrust", d: -1 });
  const [activeSec, setActiveSec] = useState("qqq-tech");
  const [noHealth, setNoHealth] = useState(() => {
    try { return (localStorage.getItem("tp-no-health") ?? localStorage.getItem("tp-no-bio")) === "1"; } catch { return false; }
  });

  const toggleNoHealth = () => {
    setNoHealth((prev) => {
      const next = !prev;
      try { localStorage.setItem("tp-no-health", next ? "1" : "0"); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent("tp-no-health", { detail: next })); } catch { /* ignore */ }
      return next;
    });
  };
  useEffect(() => {
    const onSync = (e) => setNoHealth(Boolean(e?.detail));
    window.addEventListener("tp-no-health", onSync);
    return () => window.removeEventListener("tp-no-health", onSync);
  }, []);

  // Fetch archived 3-year Nasdaq-100 breadth history once on mount (10m module cache)
  useEffect(() => {
    if (breadthArchive) return;
    let alive = true;
    fetchQqqBreadthHistory().then((rows) => {
      if (alive && rows) setBreadthArchive(rows);
    });
    return () => { alive = false; };
  }, [breadthArchive]);

  // Fetch daily QQQ OHLC bars for exact 8/10/21 EMA, 50/200 SMA, ATR14, and key swing levels
  useEffect(() => {
    let alive = true;
    authFetch("/api/ohlc?ticker=QQQ&interval=1d", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.ohlc)) setQqqBars(d.ohlc);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Poll /api/market-quality every 60s for live NQ=F futures & VIX
  useEffect(() => {
    let alive = true;
    const pull = () => {
      authFetch("/api/market-quality", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d?.ok) setMq(d); })
        .catch(() => {});
    };
    pull();
    const id = setInterval(() => { if (!document.hidden) pull(); }, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const getBench = (tk) => quotes.get(tk) || indexQuotes?.[tk] || null;
  const qqqQ = getBench("QQQ");
  const qqqeQ = getBench("QQQE");
  const spyQ = getBench("SPY");
  const iwmQ = getBench("IWM");
  const tqqqQ = getBench("TQQQ");
  const sqqqQ = getBench("SQQQ");

  const tech = useMemo(
    () => computeQqqTechnicals(qqqBars, qqqQ, stockMap?.QQQ || null),
    [qqqBars, qqqQ, stockMap]
  );
  const qqqZvr = useMemo(
    () => (stockMap?.QQQ ? zvrFor(stockMap.QQQ, qqqQ, profiles) : null),
    [stockMap, qqqQ, profiles]
  );

  const internals = useMemo(
    () => computeNdxInternals({ constituents: NDX_CONSTITUENTS, stockMap, quotes, tickerLayer, profiles }),
    [stockMap, quotes, tickerLayer, profiles]
  );

  const todayStr = etClock().today;
  const breadthSeries = useMemo(
    () => buildQqqBreadthSeries(breadthArchive, internals, tech.price, todayStr),
    [breadthArchive, internals, tech.price, todayStr]
  );
  const breadthTrend = useMemo(
    () => computeQqqBreadthTrend(breadthSeries),
    [breadthSeries]
  );
  const intradayPred = useMemo(
    () => computeQqqIntradayPredictor({ qqqQ, qqqeQ, internals, quotes, stockMap }),
    [qqqQ, qqqeQ, internals, quotes, stockMap]
  );
  const shortTermBias = useMemo(
    () => computeQqqShortTermBias({ qqqBars, qqqQ, tech, internals, breadthTrend, intradayPredictor: intradayPred, stockMap }),
    [qqqBars, qqqQ, tech, internals, breadthTrend, intradayPred, stockMap]
  );
  const trendColor = !breadthTrend
    ? A.textMuted
    : breadthTrend.tone === "good"
      ? A.green
      : breadthTrend.tone === "cyan"
        ? A.cyan
        : breadthTrend.tone === "warn"
          ? "#f59e0b"
          : A.red;

  const nqFut = useMemo(() => {
    const futs = Array.isArray(mq?.futures) ? mq.futures : [];
    return futs.find((f) => /nasdaq|nq/i.test(String(f?.name || f?.ticker || ""))) || null;
  }, [mq]);

  const vixTape = useMemo(() => {
    const tape = Array.isArray(mq?.tape) ? mq.tape : [];
    return tape.find((t) => t?.ticker === "VIX") || null;
  }, [mq]);

  const pfSet = useMemo(() => new Set(portfolio || []), [portfolio]);
  const wlSet = useMemo(() => new Set(watchlist || []), [watchlist]);
  const toggleList = (t, target) => {
    const setter = target === "pf" ? setPortfolio : setWatchlist;
    if (!setter) return;
    setter((prev) => ((prev || []).includes(t) ? prev.filter((x) => x !== t) : [...(prev || []), t]));
  };

  const boCount = useMemo(() => internals.rows.filter((r) => r.isBreakout).length, [internals.rows]);
  const weakCount = useMemo(() => internals.rows.filter((r) => (r.chg ?? 0) <= -2 || (r.sma50 ?? 0) < -5).length, [internals.rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return internals.rows.filter((r) => {
      if (noHealth && r.isHealth) return false;
      if (minAdr != null && (r.adr ?? -1) < minAdr) return false;
      if (groupFilter === "bo" && !r.isBreakout) return false;
      else if (groupFilter === "weak" && !((r.chg ?? 0) <= -2 || (r.sma50 ?? 0) < -5)) return false;
      else if (groupFilter !== "all" && groupFilter !== "bo" && groupFilter !== "weak" && !r.groups.includes(groupFilter)) return false;
      if (q && !r.ticker.toLowerCase().includes(q) && !r.company.toLowerCase().includes(q) && !r.layer.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [internals.rows, groupFilter, minAdr, noHealth, query]);

  const sortedRows = useMemo(() => {
    const { k, d } = sort;
    return [...filteredRows].sort((a, b) => {
      const va = a[k], vb = b[k];
      if (va == null && vb == null) return a.ticker.localeCompare(b.ticker);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * d || a.ticker.localeCompare(b.ticker);
      }
      return (va - vb) * d || a.ticker.localeCompare(b.ticker);
    });
  }, [filteredRows, sort]);

  const pc = (v) => (v == null ? A.textMuted : v > 0 ? A.green : v < 0 ? A.red : A.textDim);
  const rsC = (v) => (v >= 90 ? A.green : v >= 70 ? A.yellow : v != null ? A.red : A.textMuted);

  const chipStyle = (active, accent = A.green) => ({
    background: active ? `${accent}20` : "transparent",
    border: `1px solid ${active ? accent : A.border}`,
    color: active ? accent : A.textDim,
    borderRadius: 6,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: active ? 700 : 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background-color 140ms ease, border-color 140ms ease, color 140ms ease",
  });

  const col = (k, label, align = "right", title, textDefault = false) => (
    <th
      key={k}
      title={title}
      onClick={() => setSort((p) => ({ k, d: p.k === k ? -p.d : (textDefault ? 1 : -1) }))}
      style={{
        ...th(A, align),
        padding: "5px 4px",
        fontSize: 10,
        letterSpacing: 0.25,
        cursor: "pointer",
        userSelect: "none",
        color: sort.k === k ? A.text : A.textMuted,
      }}
    >
      {label}{sort.k === k ? (sort.d < 0 ? "▼" : "▲") : ""}
    </th>
  );
  const mtd = (align = "left", extra) => ({ ...td(A, align), padding: "5px 4px", fontSize: 11, ...extra });

  const jumpTo = (id) => {
    setActiveSec(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const qqqChg = tech.chgPct;
  const qqqeChg = qqqeQ?.change ?? null;
  const spyChg = spyQ?.change ?? null;
  const iwmChg = iwmQ?.change ?? null;
  const vsQqqe = qqqChg != null && qqqeChg != null ? +(qqqChg - qqqeChg).toFixed(2) : null;
  const vsSpy = qqqChg != null && spyChg != null ? +(qqqChg - spyChg).toFixed(2) : null;
  const vsIwm = qqqChg != null && iwmChg != null ? +(qqqChg - iwmChg).toFixed(2) : null;

  const stackTone = tech.emaStack === "BULLISH" ? A.green : tech.emaStack === "BEARISH" ? A.red : "#f59e0b";
  const spreadLabel = internals.concentrationSpread == null
    ? null
    : internals.concentrationSpread >= 0.6
      ? { text: "Mega-Cap Led", color: "#f59e0b" }
      : internals.concentrationSpread <= -0.6
        ? { text: "Broadening", color: A.green }
        : { text: "Balanced", color: A.cyan };

  return (
    <div>
      {/* Sticky section jump bar */}
      <div
        role="navigation"
        aria-label="QQQ sections"
        style={{
          position: "sticky",
          top: 48,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          marginBottom: 10,
          background: A.bgCardGlass || A.bgCard,
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: `1px solid ${A.border}`,
          borderBottom: `1px solid ${A.borderLight || A.border}`,
          borderRadius: 8,
          boxShadow: A.shadow,
        }}
      >
        {[
          ["qqq-tech", "Technicals"],
          ["qqq-predictor", "Bias & Predictor"],
          ["qqq-internals", "NDX Breadth"],
          ["qqq-leverage", "TQQQ & Levels"],
          ["qqq-holdings", `Holdings (${internals.count})`],
        ].map(([id, lbl]) => {
          const active = activeSec === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => jumpTo(id)}
              style={{
                background: active ? A.glowGreen : "transparent",
                border: `1px solid ${active ? A.green : "transparent"}`,
                color: active ? A.green : A.textDim,
                borderRadius: 6,
                padding: "3px 9px",
                fontSize: 11,
                fontWeight: active ? 700 : 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {lbl}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: MONO, color: A.textMuted, whiteSpace: "nowrap" }}>
          {at ? `LIVE · ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Loading quotes…"}
        </span>
      </div>

      {/* 1. QQQ Technical Dashboard & Levels */}
      <div id="qqq-tech" style={{ scrollMarginTop: 96 }}>
        <Card
          A={A}
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>QQQ Command Center</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: MONO,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: `${stackTone}20`,
                  border: `1px solid ${stackTone}88`,
                  color: stackTone,
                }}
              >
                EMA {tech.emaStack}
              </span>
              {tech.stage != null && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: MONO,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: `${STAGE_COLOR[tech.stage]}20`,
                    border: `1px solid ${STAGE_COLOR[tech.stage]}88`,
                    color: STAGE_COLOR[tech.stage],
                  }}
                >
                  STAGE {tech.stage}
                </span>
              )}
            </span>
          }
          right={
            <button
              type="button"
              onClick={() => onTicker && onTicker("QQQ")}
              style={chipStyle(chartTicker === "QQQ", A.green)}
            >
              Chart QQQ
            </button>
          }
        >
          {/* Hero QQQ Live Readout + Cross-Index Comparison Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 6, marginBottom: 10 }}>
            {[
              {
                t: "QQQ",
                label: "QQQ",
                px: tech.price,
                chg: qqqChg,
                sub: `Opn ${fmtPct(tech.fromOpenPct, 1)} · CR ${tech.cr != null ? `${tech.cr}%` : "—"}${qqqZvr != null ? ` · ${qqqZvr.toFixed(1)}×` : ""}`,
                accent: A.green,
                clickable: true,
              },
              {
                t: "QQQ",
                label: "NQ=F",
                px: typeof nqFut?.price === "number" ? nqFut.price : null,
                chg: typeof nqFut?.changePct === "number" ? nqFut.changePct : null,
                sub: "Nasdaq-100 Futures",
                accent: A.cyan,
                clickable: true,
              },
              {
                t: "QQQE",
                label: "QQQE (EqWt)",
                px: qqqeQ?.price ?? null,
                chg: qqqeChg,
                sub: vsQqqe != null ? `QQQ ${vsQqqe >= 0 ? "+" : ""}${vsQqqe.toFixed(2)}% vs EqWt` : "Equal-Weight NDX",
                accent: "#c084fc",
                clickable: true,
              },
              {
                t: "SPY",
                label: "SPY",
                px: spyQ?.price ?? null,
                chg: spyChg,
                sub: vsSpy != null ? `QQQ ${vsSpy >= 0 ? "+" : ""}${vsSpy.toFixed(2)}% vs SPY` : "S&P 500",
                accent: A.textDim,
                clickable: true,
              },
              {
                t: "IWM",
                label: "IWM",
                px: iwmQ?.price ?? null,
                chg: iwmChg,
                sub: vsIwm != null ? `QQQ ${vsIwm >= 0 ? "+" : ""}${vsIwm.toFixed(2)}% vs IWM` : "Russell 2000",
                accent: A.textDim,
                clickable: true,
              },
              {
                t: "VIXY",
                label: "VIX",
                px: vixTape?.price != null ? Number(vixTape.price) : null,
                chg: vixTape?.change != null ? Number(vixTape.change) : null,
                sub: "Volatility (click VIXY)",
                invert: true,
                accent: "#f472b6",
                clickable: true,
              },
            ].map((item) => {
              const chgColor = item.chg == null
                ? A.textMuted
                : item.invert
                  ? (item.chg > 0 ? A.red : A.green)
                  : (item.chg >= 0 ? A.green : A.red);
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => item.clickable && onTicker && onTicker(item.t)}
                  className="tp-pill"
                  style={{
                    textAlign: "left",
                    padding: "7px 9px",
                    borderRadius: 8,
                    background: A.bg,
                    border: `1px solid ${chartTicker === item.t && item.label === item.t ? A.green : A.border}`,
                    cursor: item.clickable ? "pointer" : "default",
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: item.accent, fontFamily: MONO }}>{item.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: chgColor, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                      {fmtPct(item.chg, 2)}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: A.text, fontFamily: MONO, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                    {item.px != null ? (item.label === "VIX" ? item.px.toFixed(2) : item.px >= 1000 ? Math.round(item.px).toLocaleString() : `$${item.px.toFixed(2)}`) : "—"}
                  </div>
                  <div style={{ fontSize: 9.5, color: A.textMuted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO }}>
                    {item.sub}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Moving Average & ATR Extension Strip */}
          <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.45, textTransform: "uppercase", marginBottom: 5 }}>
            Moving Averages &amp; ATR Extension (14d ATR: {tech.atr14 != null ? `$${tech.atr14.toFixed(2)} / ${tech.atrPct?.toFixed(2)}%` : "—"})
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))", gap: 6 }}>
            {tech.mas.map((m) => {
              const extWarn = m.label === "21 EMA" && m.atrX != null && Math.abs(m.atrX) >= 3.0;
              const colr = m.above == null ? A.textMuted : m.above ? A.green : A.red;
              return (
                <div
                  key={m.label}
                  title={m.atrX != null ? `${m.label}: $${m.level} (${fmtPct(m.pct, 2)} · ${m.atrX > 0 ? "+" : ""}${m.atrX.toFixed(2)}× ATR)` : undefined}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: A.bg,
                    border: `1px solid ${extWarn ? "#f59e0b88" : A.border}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: A.textMuted, fontWeight: 700 }}>
                    <span>{m.label}</span>
                    <span style={{ color: colr, fontFamily: MONO }}>{fmtPct(m.pct, 1)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: A.text }}>{fmtPx(m.level)}</span>
                    <span style={{ fontSize: 10, fontWeight: extWarn ? 800 : 600, color: extWarn ? "#f59e0b" : colr }}>
                      {m.atrX != null ? `${m.atrX > 0 ? "+" : ""}${m.atrX.toFixed(1)}×` : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* 1B. Short-Term Options Bias & Live Intraday Recovery Predictor */}
      {(shortTermBias || intradayPred) && (() => {
        const toneCol = (t) => (t === "good" ? A.green : t === "cyan" ? A.cyan : t === "warn" ? "#f59e0b" : t === "bad" ? A.red : A.textMuted);
        const biasCol = shortTermBias ? toneCol(shortTermBias.tone) : A.textMuted;
        const predCol = intradayPred ? toneCol(intradayPred.tone) : A.textMuted;
        const gapCol = intradayPred ? toneCol(intradayPred.gapTone) : A.textMuted;
        return (
          <div id="qqq-predictor" style={{ scrollMarginTop: 96 }}>
            <Card
              A={A}
              title="Short-Term Options Bias & Intraday Recovery Predictor"
              sub="Weighted NDX internals + 5d breadth velocity + live reversal confirmation"
              right={
                shortTermBias && onOpenOptions ? (
                  <button
                    type="button"
                    onClick={() => onOpenOptions("QQQ", shortTermBias.outlook)}
                    style={{
                      background: `${biasCol}20`,
                      border: `1px solid ${biasCol}`,
                      color: biasCol,
                      borderRadius: 6,
                      padding: "3px 9px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Open QQQ {shortTermBias.outlook === "bearish" ? "Bearish" : "Bullish"} Options →
                  </button>
                ) : null
              }
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
                {/* LEFT: Short-Term Trend (3–15d) & Options Bias */}
                {shortTermBias && (
                  <div style={{ background: A.bg, border: `1px solid ${biasCol}44`, borderTop: `2px solid ${biasCol}`, borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.45, textTransform: "uppercase" }}>
                          Short-Term Trend &amp; Options Bias (3–15d)
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 2 }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: biasCol }}>
                            {shortTermBias.outlook === "bearish" ? "▼" : shortTermBias.score >= 15 ? "▲" : "◆"} {shortTermBias.label}
                          </span>
                          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 800, padding: "1px 6px", borderRadius: 4, background: `${biasCol}20`, color: biasCol }}>
                            {shortTermBias.score > 0 ? "+" : ""}{shortTermBias.score} / 100
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ fontSize: 11.5, color: A.text, marginTop: 6, lineHeight: 1.4 }}>
                      {shortTermBias.optionPlay}
                    </div>

                    {/* 5 Signed Factor Bars */}
                    <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 6 }}>
                      {shortTermBias.factors.map((f) => {
                        const colr = f.pts > 0 ? A.green : f.pts < 0 ? A.red : A.textMuted;
                        const pctW = Math.min(50, (Math.abs(f.pts) / f.max) * 50);
                        return (
                          <div key={f.key}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 2 }}>
                              <span style={{ color: A.textDim, fontWeight: 600 }}>{f.label}</span>
                              <span style={{ fontFamily: MONO, color: A.textMuted, fontSize: 10 }}>
                                {f.detail}{" "}
                                <strong style={{ color: colr }}>({f.pts > 0 ? "+" : ""}{f.pts})</strong>
                              </span>
                            </div>
                            <div style={{ position: "relative", height: 5, borderRadius: 3, background: A.border, overflow: "hidden" }}>
                              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: A.textMuted, opacity: 0.4 }} />
                              <div
                                style={{
                                  position: "absolute",
                                  top: 0,
                                  bottom: 0,
                                  left: f.pts >= 0 ? "50%" : `${50 - pctW}%`,
                                  width: `${pctW}%`,
                                  background: colr,
                                  borderRadius: 3,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Bullish Trigger & Downside Invalidation */}
                    {(shortTermBias.bullTrigger || shortTermBias.bearTrigger) && (
                      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginTop: 9, paddingTop: 7, borderTop: `1px solid ${A.border}`, fontSize: 10.5, fontFamily: MONO }}>
                        {shortTermBias.bullTrigger && (
                          <span style={{ color: A.green }}>
                            ▲ Confirm: {shortTermBias.bullTrigger.label} ${shortTermBias.bullTrigger.px.toFixed(2)}
                          </span>
                        )}
                        {shortTermBias.bearTrigger && (
                          <span style={{ color: A.red }}>
                            ▼ Risk/Stop: {shortTermBias.bearTrigger.label} ${shortTermBias.bearTrigger.px.toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* RIGHT: Live Intraday Recovery / Reversal Predictor */}
                {intradayPred && (
                  <div style={{ background: A.bg, border: `1px solid ${predCol}44`, borderTop: `2px solid ${predCol}`, borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.45, textTransform: "uppercase" }}>
                          Intraday Recovery / Reversal Predictor
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 2 }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: predCol }}>{intradayPred.verdict}</span>
                          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 800, padding: "1px 6px", borderRadius: 4, background: `${predCol}20`, color: predCol }}>
                            {intradayPred.score} / 100
                          </span>
                        </div>
                      </div>
                      <span
                        title={intradayPred.gapHint}
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          fontFamily: MONO,
                          padding: "2px 6px",
                          borderRadius: 4,
                          border: `1px solid ${gapCol}66`,
                          color: gapCol,
                        }}
                      >
                        {intradayPred.gapLabel}
                        {intradayPred.qqqGapPct != null ? ` (${fmtPct(intradayPred.qqqGapPct, 1)})` : ""}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: A.textDim, marginTop: 5, lineHeight: 1.4 }}>
                      {intradayPred.gapHint}
                      {intradayPred.eqMinusCapGap != null && (
                        <span style={{ fontFamily: MONO, color: A.textMuted }}> · Eq−Cap gap {fmtPct(intradayPred.eqMinusCapGap, 2)}</span>
                      )}
                    </div>

                    {/* 4 Component Progress Gauges */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 9 }}>
                      {intradayPred.components.map((c) => {
                        const pctFill = Math.round((c.pts / c.max) * 100);
                        const barCol = c.ok ? A.green : pctFill >= 50 ? A.cyan : "#f59e0b";
                        return (
                          <div key={c.key} style={{ background: A.bgCard, border: `1px solid ${A.border}`, borderRadius: 6, padding: "6px 8px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: A.textMuted }}>
                              <span>{c.label}</span>
                              <strong style={{ fontFamily: MONO, color: barCol }}>{c.pts}/{c.max}</strong>
                            </div>
                            <div style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: A.text, marginTop: 2 }}>
                              {c.value}
                            </div>
                            <div style={{ height: 4, borderRadius: 2, background: A.border, marginTop: 4, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pctFill}%`, background: barCol }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Top-8 Weight Anchors Live Move From Open */}
                    {intradayPred.anchorDrivers.length > 0 && (
                      <div style={{ marginTop: 9, paddingTop: 7, borderTop: `1px solid ${A.border}` }}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>
                          Top Weight Anchors vs Open ({intradayPred.fromOpenBps >= 0 ? "+" : ""}{intradayPred.fromOpenBps} bps NDX net)
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {intradayPred.anchorDrivers.slice(0, 8).map((a) => {
                            const colr = (a.fromOpen ?? a.chg ?? 0) >= 0 ? A.green : A.red;
                            return (
                              <button
                                key={a.ticker}
                                type="button"
                                onClick={() => onTicker && onTicker(a.ticker)}
                                title={`${a.ticker} (${a.weightPct}% wt) · Day ${fmtPct(a.chg, 2)} · vs Open ${fmtPct(a.fromOpen, 2)} (${a.fromOpenBps != null ? `${a.fromOpenBps >= 0 ? "+" : ""}${a.fromOpenBps} bps` : "—"})`}
                                style={{
                                  background: `${colr}14`,
                                  border: `1px solid ${colr}44`,
                                  color: A.text,
                                  borderRadius: 5,
                                  padding: "2px 6px",
                                  fontSize: 10,
                                  fontFamily: MONO,
                                  cursor: "pointer",
                                }}
                              >
                                <strong>{a.ticker}</strong>{" "}
                                <span style={{ color: colr, fontWeight: 700 }}>
                                  {a.fromOpenBps != null ? `${a.fromOpenBps >= 0 ? "+" : ""}${a.fromOpenBps.toFixed(0)}bp` : fmtPct(a.chg, 1)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        );
      })()}

      {/* 2. Nasdaq-100 Internals & Breadth */}
      <div id="qqq-internals" style={{ scrollMarginTop: 96 }}>
        <Card
          A={A}
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>Nasdaq-100 Internals &amp; Breadth</span>
              {breadthTrend && (
                <span
                  title={breadthTrend.summary}
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    fontFamily: MONO,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: `${trendColor}20`,
                    border: `1px solid ${trendColor}77`,
                    color: trendColor,
                  }}
                >
                  {breadthTrend.label}
                </span>
              )}
              {spreadLabel && (
                <span
                  title={`Top-10 weighted avg (${fmtPct(internals.top10Chg, 2)}) minus remaining holdings avg (${fmtPct(internals.restChg, 2)})`}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: MONO,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: `${spreadLabel.color}1e`,
                    border: `1px solid ${spreadLabel.color}66`,
                    color: spreadLabel.color,
                  }}
                >
                  {spreadLabel.text} ({fmtPct(internals.concentrationSpread, 2)})
                </span>
              )}
            </span>
          }
          sub={`${internals.count} holdings · ${internals.up4}↑ / ${internals.dn4}↓ 4% movers · ${internals.nearHighs} within 5% of 52wH`}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            <div>
              <MiniBar
                A={A}
                title="QQQ Advancers vs Decliners"
                pct={internals.advPct}
                left={`${internals.adv} Adv`}
                right={`${internals.dec} Dec`}
                color={internals.advPct >= 50 ? "#3b82f6" : "#ec4899"}
              />
              <MiniBar
                A={A}
                title="Above 20-Day SMA"
                pct={internals.ma20.pct}
                left={`${internals.ma20.above} Above`}
                right={`${internals.ma20.below} Below`}
                color={internals.ma20.pct >= 50 ? "#3b82f6" : "#ec4899"}
              />
            </div>
            <div>
              <MiniBar
                A={A}
                title="Above 50-Day SMA"
                pct={internals.ma50.pct}
                left={`${internals.ma50.above} Above`}
                right={`${internals.ma50.below} Below`}
                color={internals.ma50.pct >= 50 ? "#3b82f6" : "#ec4899"}
              />
              <MiniBar
                A={A}
                title="Above 200-Day SMA"
                pct={internals.ma200.pct}
                left={`${internals.ma200.above} Above`}
                right={`${internals.ma200.below} Below`}
                color={internals.ma200.pct >= 50 ? "#3b82f6" : "#ec4899"}
              />
            </div>
          </div>

          {/* Stage 1-4 Bar across NDX */}
          {internals.stageDist.total > 0 && (
            <div style={{ marginTop: 4, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: A.text }}>NDX Weinstein Stages (1–4)</span>
                <span style={{ fontSize: 10.5, fontFamily: MONO, color: A.textMuted }}>
                  {internals.stageDist.stages.map((s) => `S${s.stage} ${s.pct}%`).join(" · ")}
                </span>
              </div>
              <div style={{ display: "flex", height: 7, borderRadius: 999, overflow: "hidden", background: A.border }}>
                {internals.stageDist.stages.map((st) => (
                  <div
                    key={st.stage}
                    title={`${st.label} (${st.hint}): ${st.count} stocks (${st.pct}%)`}
                    style={{ width: `${(st.count / internals.stageDist.total) * 100}%`, background: STAGE_COLOR[st.stage] }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 3-Year Historical QQQ Breadth & Trend Chart */}
          <QqqBreadthHistoryChart
            A={A}
            fullSeries={breadthSeries}
            trend={breadthTrend}
            range={breadthRange}
            onRange={setBreadthRange}
          />

          {/* Concentration + Top Contributors */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, paddingTop: 8, borderTop: `1px solid ${A.border}` }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4, marginBottom: 5 }}>
                TOP-10 WEIGHT ({internals.top10Weight}%) VS REST
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                <span>Top 10 <strong style={{ color: pc(internals.top10Chg) }}>{fmtPct(internals.top10Chg, 2)}</strong></span>
                <span>Rest <strong style={{ color: pc(internals.restChg) }}>{fmtPct(internals.restChg, 2)}</strong></span>
                <span>EqWt <strong style={{ color: pc(internals.eqWeightChg) }}>{fmtPct(internals.eqWeightChg, 2)}</strong></span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                {internals.groupPerf.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGroupFilter((cur) => (cur === g.id ? "all" : g.id))}
                    title={`${g.label} (${g.count} stocks): median ${fmtPct(g.medianChg, 2)}, ${g.pctGreen ?? 0}% green, ${fmtBps(g.bps)} bps impact — click to filter table`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 7px",
                      borderRadius: 6,
                      fontSize: 10.5,
                      fontFamily: MONO,
                      cursor: "pointer",
                      background: groupFilter === g.id ? `${g.color}22` : A.bg,
                      border: `1px solid ${groupFilter === g.id ? g.color : A.border}`,
                      color: A.textDim,
                    }}
                  >
                    <span style={{ color: g.color, fontWeight: 700 }}>{g.label}</span>
                    <strong style={{ color: pc(g.medianChg) }}>{fmtPct(g.medianChg, 1)}</strong>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4, marginBottom: 5 }}>
                TOP QQQ CONTRIBUTORS (EST. BPS)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 5 }}>
                {internals.topPositive.map((r) => (
                  <button
                    key={r.ticker}
                    type="button"
                    onClick={() => onTicker && onTicker(r.ticker)}
                    title={`${r.ticker} (${r.weightPct}% wt × ${fmtPct(r.chg, 2)})`}
                    style={{ background: "rgba(34,197,94,0.12)", border: `1px solid ${A.green}55`, color: A.green, borderRadius: 5, padding: "1px 6px", fontSize: 10.5, fontFamily: MONO, fontWeight: 700, cursor: "pointer" }}
                  >
                    {r.ticker} {fmtBps(r.contribBps)}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {internals.topNegative.map((r) => (
                  <button
                    key={r.ticker}
                    type="button"
                    onClick={() => onTicker && onTicker(r.ticker)}
                    title={`${r.ticker} (${r.weightPct}% wt × ${fmtPct(r.chg, 2)})`}
                    style={{ background: "rgba(239,68,68,0.12)", border: `1px solid ${A.red}55`, color: A.red, borderRadius: 5, padding: "1px 6px", fontSize: 10.5, fontFamily: MONO, fontWeight: 700, cursor: "pointer" }}
                  >
                    {r.ticker} {fmtBps(r.contribBps)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* 3. QQQ Leverage (TQQQ / SQQQ) & Swing Levels / Expected Move */}
      <div id="qqq-leverage" style={{ scrollMarginTop: 96 }}>
        <Card A={A} title="Leverage, Expected Move &amp; Key Levels" sub="3× ETFs, ATR expected ranges &amp; swing stop zones for QQQ">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 8, marginBottom: 10 }}>
            {[
              { tk: "TQQQ", desc: "3× Bull QQQ", q: tqqqQ, accent: A.green },
              { tk: "SQQQ", desc: "3× Bear QQQ", q: sqqqQ, accent: A.red },
            ].map(({ tk, desc, q, accent }) => {
              const px = q?.price ?? null;
              const chg = q?.change ?? null;
              const opn = q?.open && px ? ((px / q.open) - 1) * 100 : null;
              const cr = q?.dayHigh && q?.dayLow && q.dayHigh > q.dayLow && px != null
                ? Math.round(((px - q.dayLow) / (q.dayHigh - q.dayLow)) * 100)
                : null;
              return (
                <button
                  key={tk}
                  type="button"
                  onClick={() => onTicker && onTicker(tk)}
                  className="tp-pill"
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: A.bg,
                    border: `1px solid ${chartTicker === tk ? accent : A.border}`,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12, color: accent }}>
                      {tk} <span style={{ fontWeight: 500, fontSize: 10, color: A.textMuted }}>{desc}</span>
                    </span>
                    <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12, color: pc(chg) }}>{fmtPct(chg, 2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 3, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: A.text }}>{fmtPx(px)}</span>
                    <span style={{ fontSize: 10, color: A.textMuted }}>
                      Opn {fmtPct(opn, 1)} · CR {cr != null ? `${cr}%` : "—"}
                    </span>
                  </div>
                </button>
              );
            })}
            <div style={{ padding: "8px 10px", borderRadius: 8, background: A.bg, border: `1px solid ${A.border}`, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted }}>EXPECTED MOVE (ATR)</div>
              <div style={{ fontSize: 11.5, color: A.text, marginTop: 3 }}>
                1D: <strong style={{ color: A.cyan }}>±{fmtPx(tech.expectedDayMove)}</strong>{" "}
                <span style={{ color: A.textMuted, fontSize: 10 }}>({tech.atrPct != null ? `±${tech.atrPct.toFixed(1)}%` : "—"})</span>
              </div>
              <div style={{ fontSize: 11.5, color: A.text, marginTop: 2 }}>
                1W: <strong style={{ color: "#fbbf24" }}>±{fmtPx(tech.expectedWeekMove)}</strong>{" "}
                <span style={{ color: A.textMuted, fontSize: 10 }}>
                  ({tech.expectedWeekMove && tech.price ? `±${((tech.expectedWeekMove / tech.price) * 100).toFixed(1)}%` : "—"})
                </span>
              </div>
            </div>
            <div style={{ padding: "8px 10px", borderRadius: 8, background: A.bg, border: `1px solid ${A.border}`, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted }}>KEY PRICE LEVELS</div>
              <div style={{ fontSize: 10.5, color: A.textDim, marginTop: 3 }}>
                Prev H/L: <strong style={{ color: A.text }}>{fmtPx(tech.prevHigh)}</strong> / <strong style={{ color: A.text }}>{fmtPx(tech.prevLow)}</strong>
              </div>
              <div style={{ fontSize: 10.5, color: A.textDim, marginTop: 2 }}>
                20d H/L: <strong style={{ color: A.text }}>{fmtPx(tech.high20)}</strong> / <strong style={{ color: A.text }}>{fmtPx(tech.low20)}</strong>
              </div>
              <div style={{ fontSize: 10.5, color: A.textDim, marginTop: 2 }}>
                52wH: <strong style={{ color: A.green }}>{fmtPx(tech.high52)}</strong>{" "}
                <span style={{ color: pc(tech.off52Pct) }}>({fmtPct(tech.off52Pct, 1)})</span>
              </div>
            </div>
          </div>

          {/* Swing Stop Zones */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(95px, 1fr))", gap: 6 }}>
            {tech.stops.map((s) => (
              <div key={s.label} style={{ padding: "5px 8px", borderRadius: 6, background: A.bg, border: `1px solid ${A.border}`, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: A.textMuted }}>{s.label}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: A.text, marginTop: 1 }}>{fmtPx(s.price)}</div>
                <div style={{ fontSize: 10, color: (s.distPct ?? 0) <= 0 ? A.red : A.green }}>{fmtPct(s.distPct, 1)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 4. Live Nasdaq-100 Holdings & Contributors Table */}
      <div id="qqq-holdings" style={{ scrollMarginTop: 96 }}>
        <Card
          A={A}
          title={`Nasdaq-100 Holdings (${sortedRows.length}/${internals.count})`}
          sub="Default sorted by Thrust (Chg% × ZVR) · click any row to chart · ↑/↓ to step through"
          right={<CopyTickersBtn A={A} tickers={sortedRows.map((r) => r.ticker)} label="Copy TV" />}
        >
          {/* Group & Quick Filter Pills */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 8 }}>
            <button type="button" onClick={() => setGroupFilter("all")} style={chipStyle(groupFilter === "all", A.green)}>
              All <span style={{ opacity: 0.75, fontFamily: MONO }}>{internals.count}</span>
            </button>
            {NDX_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupFilter((cur) => (cur === g.id ? "all" : g.id))}
                style={chipStyle(groupFilter === g.id, g.color)}
              >
                {g.label}
              </button>
            ))}
            <button type="button" onClick={() => setGroupFilter((cur) => (cur === "bo" ? "all" : "bo"))} style={chipStyle(groupFilter === "bo", "#fbbf24")}>
              🔥 Breakouts <span style={{ opacity: 0.75, fontFamily: MONO }}>{boCount}</span>
            </button>
            <button type="button" onClick={() => setGroupFilter((cur) => (cur === "weak" ? "all" : "weak"))} style={chipStyle(groupFilter === "weak", A.red)}>
              Weakest <span style={{ opacity: 0.75, fontFamily: MONO }}>{weakCount}</span>
            </button>
          </div>

          {/* Secondary Filter Bar: Search, No Health, ADR >= */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${A.border}` }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter ticker / company…"
              aria-label="Filter QQQ holdings"
              style={{
                background: A.bg,
                color: A.text,
                border: `1px solid ${A.border}`,
                borderRadius: 6,
                padding: "3px 8px",
                fontSize: 11,
                width: 170,
                outline: "none",
              }}
            />
            <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={toggleNoHealth}
                title="Exclude Healthcare / Biotech stocks"
                style={chipStyle(noHealth, "#f472b6")}
              >
                No Health
              </button>
              <AdrFilter A={A} value={minAdr} onChange={setMinAdr} />
            </div>
          </div>

          <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                <tr>
                  {col("ticker", "Ticker", "left", "Symbol & company", true)}
                  {col("group", "Grp", "left", "Nasdaq-100 sector group", true)}
                  {col("thrust", "Thr", "right", "Stock Thrust: Chg% × ZVR")}
                  {col("contribBps", "bps", "right", "Estimated QQQ basis points contribution (Weight% × Chg%)")}
                  {col("weightPct", "Wt%", "right", "Estimated Nasdaq-100 weight %")}
                  {col("chg", "Chg%")}
                  {col("fromOpen", "Opn%", "right", "Intraday move from today's open")}
                  {col("zvr", "ZVR", "right", "Zanger Volume Ratio vs 10d intraday profile")}
                  {col("cr", "CR", "right", "Closing Range %")}
                  {col("rs", "RS")}
                  {col("sma50", "50d", "right", "% distance vs 50-day SMA")}
                  {col("off52", "52wH", "right", "% off 52-week high")}
                  {(setPortfolio || setWatchlist) && (
                    <th style={{ ...th(A, "right"), padding: "5px 4px", fontSize: 10, letterSpacing: 0.25 }}>List</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => {
                  const on = chartTicker === r.ticker;
                  const inPf = pfSet.has(r.ticker);
                  const inWl = wlSet.has(r.ticker);
                  const gc = GROUP_COLOR[r.group] || A.textMuted;
                  return (
                    <tr
                      key={r.ticker}
                      data-nav={r.ticker}
                      className={on ? "tp-click-row tp-row-active" : "tp-click-row"}
                      onClick={() => onTicker && onTicker(r.ticker)}
                      style={{
                        cursor: "pointer",
                        background: on ? A.bgHover : "transparent",
                        boxShadow: on ? `inset 2px 0 0 ${A.green}` : "none",
                      }}
                    >
                      <td style={mtd()}>
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <FlagButton t={r.ticker} A={A} />
                          <span style={{ color: on ? A.green : A.text, fontWeight: 700, fontFamily: MONO }}>{r.ticker}</span>
                          <TierMark t={r.ticker} />
                          <RslDot tip={r.rsl} A={A} />
                        </div>
                        {r.company && (
                          <div title={r.company} style={{ fontSize: 10, color: A.textMuted, maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.company}
                          </div>
                        )}
                      </td>
                      <td style={mtd()}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: MONO, padding: "1px 4px", borderRadius: 3, background: `${gc}1c`, color: gc, border: `1px solid ${gc}44` }}>
                          {GROUP_SHORT[r.group] || r.group}
                        </span>
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, fontWeight: r.thrust != null && Math.abs(r.thrust) >= 5 ? 800 : 500, color: pc(r.thrust), whiteSpace: "nowrap" })}>
                        {r.thrust != null ? `${r.thrust > 0 ? "+" : ""}${r.thrust.toFixed(1)}` : "—"}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, fontWeight: r.contribBps != null && Math.abs(r.contribBps) >= 5 ? 700 : 400, color: pc(r.contribBps), whiteSpace: "nowrap" })}>
                        {fmtBps(r.contribBps)}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: A.textMuted, whiteSpace: "nowrap" })}>
                        {r.weightPct > 0 ? `${r.weightPct.toFixed(1)}%` : "—"}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, fontWeight: 700, color: pc(r.chg), whiteSpace: "nowrap" })}>
                        {fmtPct(r.chg, 1)}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: pc(r.fromOpen), whiteSpace: "nowrap" })}>
                        {fmtPct(r.fromOpen, 1)}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: r.zvr == null ? A.textMuted : r.zvr >= 2 ? "#fbbf24" : r.zvr >= 1.5 ? A.green : A.textDim, fontWeight: (r.zvr ?? 0) >= 1.5 ? 700 : 400, whiteSpace: "nowrap" })}>
                        {r.zvr != null ? `${r.zvr.toFixed(1)}×` : "—"}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: r.cr == null ? A.textMuted : r.cr >= 75 ? A.green : r.cr <= 30 ? A.red : A.textDim })}>
                        {r.cr != null ? `${r.cr}%` : "—"}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, fontWeight: 700, color: rsC(r.rs) })}>
                        {r.rs ?? "—"}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: pc(r.sma50), whiteSpace: "nowrap" })}>
                        {fmtPct(r.sma50, 1)}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: (r.off52 ?? -99) >= -5 ? A.green : A.textDim, whiteSpace: "nowrap" })}>
                        {fmtPct(r.off52, 1)}
                      </td>
                      {(setPortfolio || setWatchlist) && (
                        <td style={mtd("right")} onClick={(e) => e.stopPropagation()}>
                          <span style={{ display: "inline-flex", gap: 2 }}>
                            {setPortfolio && (
                              <button
                                type="button"
                                title={inPf ? "Remove from Portfolio" : "Add to Portfolio"}
                                onClick={() => toggleList(r.ticker, "pf")}
                                style={{ background: inPf ? `${A.green}22` : "transparent", border: `1px solid ${inPf ? A.green : A.border}`, color: inPf ? A.green : A.textMuted, borderRadius: 3, padding: "1px 3px", fontSize: 10, fontFamily: MONO, fontWeight: inPf ? 700 : 500, cursor: "pointer" }}
                              >
                                PF
                              </button>
                            )}
                            {setWatchlist && (
                              <button
                                type="button"
                                title={inWl ? "Remove from Watchlist" : "Add to Watchlist"}
                                onClick={() => toggleList(r.ticker, "wl")}
                                style={{ background: inWl ? `${A.cyan}22` : "transparent", border: `1px solid ${inWl ? A.cyan : A.border}`, color: inWl ? A.cyan : A.textMuted, borderRadius: 3, padding: "1px 3px", fontSize: 10, fontFamily: MONO, fontWeight: inWl ? 700 : 500, cursor: "pointer" }}
                              >
                                WL
                              </button>
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
