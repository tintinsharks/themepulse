import { useEffect, useMemo, useState } from "react";
import { computeStageDistribution, estimateStageHistory, etClock } from "../lead/math.js";
import { authFetch } from "../utils.js";

// Shared 60s cache for Finviz homepage market_stats (Adv/Dec, New High/Low, >50/200 SMA)
const HP_TTL_MS = 60 * 1000;
let _hpCache = { ts: 0, stats: null, inflight: null };

// Shared 10m cache for daily SPX (^GSPC, fallback SPY) closing prices for chart overlays
const SPX_TTL_MS = 10 * 60 * 1000;
let _spxCache = { ts: 0, data: null, inflight: null };

function fetchSpxHistory() {
  const now = Date.now();
  if (_spxCache.data && now - _spxCache.ts < SPX_TTL_MS) {
    return Promise.resolve(_spxCache.data);
  }
  if (_spxCache.inflight) return _spxCache.inflight;
  const pullTicker = (ticker, label) =>
    authFetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}&interval=1d`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const rows = Array.isArray(d?.ohlc) ? d.ohlc : [];
        if (rows.length < 5) return null;
        const map = new Map();
        for (const c of rows) {
          if (c?.date && typeof c.close === "number" && Number.isFinite(c.close)) {
            map.set(c.date, c.close);
          }
        }
        return map.size >= 5 ? { label, map } : null;
      })
      .catch(() => null);

  _spxCache.inflight = pullTicker("^GSPC", "SPX")
    .then((res) => res || pullTicker("SPY", "SPY"))
    .then((res) => {
      if (res) _spxCache = { ts: Date.now(), data: res, inflight: null };
      else _spxCache.inflight = null;
      return res || _spxCache.data;
    });
  return _spxCache.inflight;
}

function fmtSpx(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1);
}

function buildSpxOverlay(series, spxData, todayStr, padL, step, padT, plotH) {
  if (!spxData?.map || !series?.length) return null;
  const values = series.map((d) => {
    const key = d.isLive ? todayStr : d.date;
    const p = spxData.map.get(key);
    return typeof p === "number" && Number.isFinite(p) ? p : null;
  });
  const valid = values.filter((v) => v != null);
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = Math.max(max - min, 0.01);
  const lo = min - span * 0.06;
  const hi = max + span * 0.06;
  const xOf = (i) => padL + i * step + step / 2;
  const yOf = (p) => padT + plotH - ((p - lo) / (hi - lo)) * plotH;
  const segs = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    segs.push(`${segs.length === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(values[i]).toFixed(1)}`);
  }
  return {
    label: spxData.label || "SPX",
    values,
    pathD: segs.join(" "),
    min,
    max,
    mid: (min + max) / 2,
    xOf,
    yOf,
  };
}

function fetchHomepageStats() {
  const now = Date.now();
  if (_hpCache.stats && now - _hpCache.ts < HP_TTL_MS) {
    return Promise.resolve(_hpCache.stats);
  }
  if (_hpCache.inflight) return _hpCache.inflight;
  _hpCache.inflight = authFetch("/api/live?homepage=1", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const ms = d?.homepage?.market_stats;
      if (ms && Object.keys(ms).length > 0) {
        _hpCache = { ts: Date.now(), stats: ms, inflight: null };
        return ms;
      }
      _hpCache.inflight = null;
      return _hpCache.stats;
    })
    .catch(() => {
      _hpCache.inflight = null;
      return _hpCache.stats;
    });
  return _hpCache.inflight;
}

// Deepvue-inspired color tokens (vivid on dark, crisp on light)
const COLORS = {
  blue: "#3b82f6",
  pink: "#ec4899",
  gold: "#eab308",
  slate: "#64748b",
};

const STAGE_COLOR = {
  1: COLORS.slate,
  2: COLORS.blue,
  3: COLORS.gold,
  4: COLORS.pink,
};

function RatioBar({ title, pct, leftLabel, rightLabel, accentColor, trackBg, textColor, mutedColor, onClick, expanded }) {
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      title={onClick ? (expanded ? "Hide history chart" : "Click to view daily history chart (1M / 3M / 6M / 1Y)") : undefined}
      style={{ marginBottom: expanded ? 8 : 14, cursor: onClick ? "pointer" : "default", userSelect: onClick ? "none" : "auto" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: textColor, letterSpacing: -0.1 }}>
          <span>{title}</span>
          {onClick && (
            <span style={{ fontSize: 10, fontWeight: 500, color: mutedColor, fontFamily: "monospace" }}>
              {expanded ? "▾ hide" : "▸ chart"}
            </span>
          )}
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, color: accentColor, fontVariantNumeric: "tabular-nums" }}>
          {Number.isFinite(pct) ? `${Math.round(pct)}%` : "—"}
        </span>
      </div>
      <div style={{ height: 8, width: "100%", borderRadius: 999, background: trackBg, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${safePct}%`,
            background: accentColor,
            borderRadius: 999,
            transition: "width 0.35s ease",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 11, color: mutedColor, fontVariantNumeric: "tabular-nums" }}>
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

// Mirrored daily bar chart (Up = Highs/Advance in blue, Down = Lows/Decline in pink, + Net curve in gold + optional SPX overlay)
function BreadthHistoryChart({ A, series, posLabel, negLabel, range, onRange, spxData, showSpx, onToggleSpx, todayStr }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!series || series.length === 0) {
    return (
      <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 10px", marginBottom: 14, background: A.bg, border: `1px solid ${A.border}`, borderRadius: 8 }}>
        No historical daily breadth series available yet.
      </div>
    );
  }

  const W = 600, H = 152;
  const n = series.length;
  const padL = 36, padT = 10, padB = 22;
  const hasSpx = Boolean(showSpx && spxData?.map && series.filter((d) => spxData.map.has(d.isLive ? todayStr : d.date)).length >= 2);
  const padR = hasSpx ? 44 : 10;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const midY = padT + plotH / 2;
  const halfH = plotH / 2;
  const step = plotW / n;
  const spx = hasSpx ? buildSpxOverlay(series, spxData, todayStr, padL, step, padT, plotH) : null;

  const peaks = series.map((d) => Math.max(d.pos || 0, d.neg || 0)).sort((a, b) => a - b);
  const rawMax = peaks[peaks.length - 1] || 10;
  const p97 = peaks[Math.max(0, Math.floor((peaks.length - 1) * 0.97))] || rawMax;
  // Prevent a single pipeline glitch spike (e.g. 6x normal) from squashing 6M/1Y bars
  const maxVal = rawMax > p97 * 2.2 ? Math.max(10, Math.ceil(p97 * 1.15)) : Math.max(10, rawMax);
  const barW = Math.max(1.5, Math.min(16, step * 0.7));
  const activeIdx = hoverIdx != null && hoverIdx < n ? hoverIdx : n - 1;
  const cur = series[activeIdx];
  const curTot = (cur.pos || 0) + (cur.neg || 0);
  const curPct = curTot > 0 ? Math.round((cur.pos / curTot) * 100) : 0;
  const curNet = (cur.pos || 0) - (cur.neg || 0);
  const curSpx = spx ? spx.values[activeIdx] : null;
  const spxStroke = A.text || "#f8fafc";
  const spxHalo = A.bg || "#0d1117";

  const netPts = series.map((d, i) => {
    const x = padL + i * step + step / 2;
    const net = (d.pos || 0) - (d.neg || 0);
    const y = midY - (net / maxVal) * halfH;
    return `${x.toFixed(1)},${Math.max(padT, Math.min(padT + plotH, y)).toFixed(1)}`;
  }).join(" ");

  const spansYear = series[0]?.date && series[n - 1]?.date && String(series[0].date).slice(0, 4) !== String(series[n - 1].date).slice(0, 4);
  const fmtShortDate = (d) => (d === "Today (Live)" ? "Live" : spansYear ? String(d || "").slice(2) : String(d || "").slice(5));
  const midIdx = Math.floor((n - 1) / 2);
  const partialNote = n < range ? `${n}d shown (earliest ${series[0].date})` : null;

  return (
    <div
      style={{
        marginBottom: 14,
        padding: "10px 12px 8px",
        background: A.bg,
        border: `1px solid ${A.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 6, fontSize: 11, fontFamily: "monospace" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ color: A.text }}>{cur.date}</strong>
          <span style={{ color: COLORS.blue, fontWeight: 700 }}>{cur.pos.toLocaleString()} {posLabel}</span>
          <span style={{ color: COLORS.pink, fontWeight: 700 }}>{cur.neg.toLocaleString()} {negLabel}</span>
          <span style={{ color: curNet >= 0 ? COLORS.blue : COLORS.pink }}>
            Net {curNet > 0 ? `+${curNet.toLocaleString()}` : curNet.toLocaleString()} ({curPct}%)
          </span>
          {curSpx != null && (
            <span style={{ color: A.text, fontWeight: 700 }}>
              {spx.label} {fmtSpx(curSpx)}
            </span>
          )}
        </div>
        <div style={{ display: "inline-flex", gap: 4 }}>
          <button
            onClick={onToggleSpx}
            title={`Toggle ${spxData?.label || "SPX"} price line overlay`}
            style={{
              background: showSpx ? A.bgHover : "transparent",
              border: `1px solid ${showSpx ? A.text : A.border}`,
              color: showSpx ? A.text : A.textMuted,
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >
            {spxData?.label || "SPX"}
          </button>
          {[[22, "1M"], [63, "3M"], [126, "6M"], [252, "1Y"]].map(([days, lbl]) => (
            <button
              key={lbl}
              onClick={() => { setHoverIdx(null); onRange(days); }}
              style={{
                background: range === days ? A.bgHover : "transparent",
                border: `1px solid ${range === days ? COLORS.blue : A.border}`,
                color: range === days ? COLORS.blue : A.textMuted,
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: 10,
                fontWeight: 700,
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Subtle horizontal guide lines */}
        <line x1={padL} y1={padT} x2={W - padR} y2={padT} stroke={A.border} strokeDasharray="2 3" strokeOpacity="0.6" />
        <line x1={padL} y1={midY} x2={W - padR} y2={midY} stroke={A.textMuted} strokeOpacity="0.45" />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={A.border} strokeDasharray="2 3" strokeOpacity="0.6" />

        {/* Left Y-axis scale labels */}
        <text x={padL - 5} y={padT + 8} textAnchor="end" fontSize="9" fill={COLORS.blue} fontFamily="monospace">+{maxVal}</text>
        <text x={padL - 5} y={midY + 3} textAnchor="end" fontSize="9" fill={A.textMuted} fontFamily="monospace">0</text>
        <text x={padL - 5} y={padT + plotH} textAnchor="end" fontSize="9" fill={COLORS.pink} fontFamily="monospace">-{maxVal}</text>

        {/* Right Y-axis scale labels (SPX) */}
        {spx && (
          <>
            <text x={W - padR + 5} y={padT + 8} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtSpx(spx.max)}</text>
            <text x={W - padR + 5} y={midY + 3} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtSpx(spx.mid)}</text>
            <text x={W - padR + 5} y={padT + plotH} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtSpx(spx.min)}</text>
          </>
        )}

        {/* Mirrored bars per day */}
        {series.map((d, i) => {
          const cx = padL + i * step + step / 2;
          const x = cx - barW / 2;
          const posH = Math.min(halfH, Math.max(0, ((d.pos || 0) / maxVal) * halfH));
          const negH = Math.min(halfH, Math.max(0, ((d.neg || 0) / maxVal) * halfH));
          const isActive = i === activeIdx;
          return (
            <g key={d.date} onMouseEnter={() => setHoverIdx(i)} style={{ cursor: "crosshair" }}>
              {/* Full-height hit zone */}
              <rect x={padL + i * step} y={padT} width={step} height={plotH} fill={isActive ? A.text : "transparent"} fillOpacity={isActive ? 0.06 : 0} />
              {/* Upward bar: Highs / Advance */}
              <rect
                x={x}
                y={midY - posH}
                width={barW}
                height={posH}
                rx={n > 150 ? 0.5 : 1.5}
                fill={COLORS.blue}
                fillOpacity={isActive ? 1 : d.isLive ? 0.9 : 0.72}
              />
              {/* Downward bar: Lows / Decline */}
              <rect
                x={x}
                y={midY}
                width={barW}
                height={negH}
                rx={n > 150 ? 0.5 : 1.5}
                fill={COLORS.pink}
                fillOpacity={isActive ? 1 : d.isLive ? 0.9 : 0.72}
              />
            </g>
          );
        })}

        {/* Net line overlay */}
        {n >= 2 && (
          <polyline
            fill="none"
            stroke={COLORS.gold}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={netPts}
            style={{ pointerEvents: "none" }}
          />
        )}

        {/* SPX price line overlay */}
        {spx && (
          <g style={{ pointerEvents: "none" }}>
            <path d={spx.pathD} fill="none" stroke={spxHalo} strokeWidth="3.2" strokeOpacity="0.65" strokeLinejoin="round" strokeLinecap="round" />
            <path d={spx.pathD} fill="none" stroke={spxStroke} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
            {curSpx != null && (
              <circle cx={spx.xOf(activeIdx)} cy={spx.yOf(curSpx)} r="3.2" fill={spxStroke} stroke={spxHalo} strokeWidth="1.2" />
            )}
          </g>
        )}

        {/* X-axis date ticks */}
        <text x={padL} y={H - 5} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily="monospace">
          {fmtShortDate(series[0].date)}
        </text>
        {n > 4 && (
          <text x={padL + midIdx * step + step / 2} y={H - 5} textAnchor="middle" fontSize="9" fill={A.textMuted} fontFamily="monospace">
            {fmtShortDate(series[midIdx].date)}
          </text>
        )}
        <text x={W - padR} y={H - 5} textAnchor="end" fontSize="9" fill={series[n - 1].isLive ? A.green : A.textMuted} fontFamily="monospace">
          {fmtShortDate(series[n - 1].date)}
        </text>
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4, fontSize: 10, color: A.textMuted, fontFamily: "monospace" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span><span style={{ color: COLORS.blue }}>■</span> {posLabel} (up)</span>
          <span><span style={{ color: COLORS.pink }}>■</span> {negLabel} (down)</span>
          <span><span style={{ color: COLORS.gold }}>━</span> Net ({posLabel} − {negLabel})</span>
          {spx && <span><span style={{ color: A.text }}>━</span> {spx.label} (right)</span>}
        </div>
        {partialNote && <span>{partialNote}</span>}
      </div>
    </div>
  );
}

// 100% stacked daily bar chart for Stan Weinstein Stages 1-4 (bottom->top: Stage 2, Stage 1, Stage 3, Stage 4) + optional SPX overlay
function StageHistoryChart({ A, series, range, onRange, spxData, showSpx, onToggleSpx, todayStr }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!series || series.length === 0) {
    return (
      <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 10px", marginTop: 10, background: A.bg, border: `1px solid ${A.border}`, borderRadius: 8 }}>
        No historical stage series available yet.
      </div>
    );
  }

  const W = 600, H = 152;
  const n = series.length;
  const padL = 34, padT = 10, padB = 22;
  const hasSpx = Boolean(showSpx && spxData?.map && series.filter((d) => spxData.map.has(d.isLive ? todayStr : d.date)).length >= 2);
  const padR = hasSpx ? 44 : 10;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const step = plotW / n;
  const spx = hasSpx ? buildSpxOverlay(series, spxData, todayStr, padL, step, padT, plotH) : null;
  const barW = Math.max(1.5, Math.min(18, step * 0.76));
  const activeIdx = hoverIdx != null && hoverIdx < n ? hoverIdx : n - 1;
  const cur = series[activeIdx];
  const curSpx = spx ? spx.values[activeIdx] : null;
  const midIdx = Math.floor((n - 1) / 2);
  const spansYear = series[0]?.date && series[n - 1]?.date && String(series[0].date).slice(0, 4) !== String(series[n - 1].date).slice(0, 4);
  const fmtShortDate = (d) => (spansYear ? String(d || "").slice(2) : String(d || "").slice(5));
  const partialNote = n < range ? `${n}d available (since ${series[0].date})` : null;

  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px 8px",
        background: A.bg,
        border: `1px solid ${A.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 6, fontSize: 11, fontFamily: "monospace" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ color: A.text }}>{cur.date}</strong>
          <span style={{ color: STAGE_COLOR[2], fontWeight: 700 }}>S2 {cur.s2}%</span>
          <span style={{ color: STAGE_COLOR[1], fontWeight: 700 }}>S1 {cur.s1}%</span>
          <span style={{ color: STAGE_COLOR[3], fontWeight: 700 }}>S3 {cur.s3}%</span>
          <span style={{ color: STAGE_COLOR[4], fontWeight: 700 }}>S4 {cur.s4}%</span>
          {curSpx != null && (
            <span style={{ color: A.text, fontWeight: 700 }}>
              {spx.label} {fmtSpx(curSpx)}
            </span>
          )}
        </div>
        <div style={{ display: "inline-flex", gap: 4 }}>
          <button
            onClick={onToggleSpx}
            title={`Toggle ${spxData?.label || "SPX"} price line overlay`}
            style={{
              background: showSpx ? A.bgHover : "transparent",
              border: `1px solid ${showSpx ? A.text : A.border}`,
              color: showSpx ? A.text : A.textMuted,
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >
            {spxData?.label || "SPX"}
          </button>
          {[[22, "1M"], [63, "3M"], [126, "6M"], [252, "1Y"]].map(([days, lbl]) => (
            <button
              key={lbl}
              onClick={() => { setHoverIdx(null); onRange(days); }}
              style={{
                background: range === days ? A.bgHover : "transparent",
                border: `1px solid ${range === days ? COLORS.blue : A.border}`,
                color: range === days ? COLORS.blue : A.textMuted,
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: 10,
                fontWeight: 700,
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* 100%, 50%, 0% guide lines */}
        <line x1={padL} y1={padT} x2={W - padR} y2={padT} stroke={A.border} strokeDasharray="2 3" strokeOpacity="0.6" />
        <line x1={padL} y1={padT + plotH / 2} x2={W - padR} y2={padT + plotH / 2} stroke={A.textMuted} strokeDasharray="3 3" strokeOpacity="0.45" />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={A.border} strokeOpacity="0.7" />

        <text x={padL - 5} y={padT + 8} textAnchor="end" fontSize="9" fill={A.textMuted} fontFamily="monospace">100%</text>
        <text x={padL - 5} y={padT + plotH / 2 + 3} textAnchor="end" fontSize="9" fill={A.textMuted} fontFamily="monospace">50%</text>
        <text x={padL - 5} y={padT + plotH} textAnchor="end" fontSize="9" fill={A.textMuted} fontFamily="monospace">0%</text>

        {/* Right Y-axis scale labels (SPX) */}
        {spx && (
          <>
            <text x={W - padR + 5} y={padT + 8} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtSpx(spx.max)}</text>
            <text x={W - padR + 5} y={padT + plotH / 2 + 3} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtSpx(spx.mid)}</text>
            <text x={W - padR + 5} y={padT + plotH} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtSpx(spx.min)}</text>
          </>
        )}

        {series.map((d, i) => {
          const cx = padL + i * step + step / 2;
          const x = cx - barW / 2;
          const isActive = i === activeIdx;
          const op = isActive ? 1 : 0.78;
          // Stack bottom -> top: Stage 2 (blue), Stage 1 (slate), Stage 3 (gold), Stage 4 (pink)
          const h2 = (d.s2 / 100) * plotH;
          const h1 = (d.s1 / 100) * plotH;
          const h3 = (d.s3 / 100) * plotH;
          const h4 = Math.max(0, plotH - h2 - h1 - h3);
          const y2 = padT + plotH - h2;
          const y1 = y2 - h1;
          const y3 = y1 - h3;
          const y4 = padT;
          return (
            <g key={d.date} onMouseEnter={() => setHoverIdx(i)} style={{ cursor: "crosshair" }}>
              <rect x={padL + i * step} y={padT} width={step} height={plotH} fill={isActive ? A.text : "transparent"} fillOpacity={isActive ? 0.08 : 0} />
              <rect x={x} y={y4} width={barW} height={h4} fill={STAGE_COLOR[4]} fillOpacity={op} />
              <rect x={x} y={y3} width={barW} height={h3} fill={STAGE_COLOR[3]} fillOpacity={op} />
              <rect x={x} y={y1} width={barW} height={h1} fill={STAGE_COLOR[1]} fillOpacity={op} />
              <rect x={x} y={y2} width={barW} height={h2} fill={STAGE_COLOR[2]} fillOpacity={op} />
            </g>
          );
        })}

        {/* SPX price line overlay (white with dark casing so it pops over every stage color) */}
        {spx && (
          <g style={{ pointerEvents: "none" }}>
            <path d={spx.pathD} fill="none" stroke="rgba(0,0,0,0.72)" strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round" />
            <path d={spx.pathD} fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
            {curSpx != null && (
              <circle cx={spx.xOf(activeIdx)} cy={spx.yOf(curSpx)} r="3.4" fill="#ffffff" stroke="rgba(0,0,0,0.85)" strokeWidth="1.3" />
            )}
          </g>
        )}

        <text x={padL} y={H - 5} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtShortDate(series[0].date)}</text>
        {n > 4 && (
          <text x={padL + midIdx * step + step / 2} y={H - 5} textAnchor="middle" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtShortDate(series[midIdx].date)}</text>
        )}
        <text x={W - padR} y={H - 5} textAnchor="end" fontSize="9" fill={cur.exact ? A.green : A.textMuted} fontFamily="monospace">{fmtShortDate(series[n - 1].date)}</text>
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4, fontSize: 10, color: A.textMuted, fontFamily: "monospace" }}>
        <span>
          <span style={{ color: STAGE_COLOR[2] }}>■</span> S2 Up &nbsp;
          <span style={{ color: STAGE_COLOR[1] }}>■</span> S1 Base &nbsp;
          <span style={{ color: STAGE_COLOR[3] }}>■</span> S3 Top &nbsp;
          <span style={{ color: STAGE_COLOR[4] }}>■</span> S4 Down
          {spx && <> &nbsp;<span style={{ color: A.text }}>━</span> {spx.label} (right)</>}
        </span>
        <span>
          {cur.exact ? "Exact stock-level count" : "Derived from daily MA breadth"}
          {partialNote ? ` · ${partialNote}` : ""}
        </span>
      </div>
    </div>
  );
}

export default function MarketBreadthCard({ A, stockMap, breadth, monitor }) {
  const [slide, setSlide] = useState(0); // 0 = Breadth + Stage Analysis (Deepvue view), 1 = MA Breadth + 4% Movers
  const [openChart, setOpenChart] = useState(null); // null | "nhnl" | "ad" | "stage"
  const [histRange, setHistRange] = useState(22); // 22 (~1M) | 63 (~3M) | 126 (~6M) | 252 (~1Y)
  const [showSpx, setShowSpx] = useState(true);
  const [spxData, setSpxData] = useState(() => _spxCache.data);
  const [liveStats, setLiveStats] = useState(() => _hpCache.stats);
  const [liveAt, setLiveAt] = useState(() => (_hpCache.ts ? new Date(_hpCache.ts) : null));
  const todayStr = etClock().today;

  // Lazily load daily SPX (^GSPC, fallback SPY) closes once any history chart is opened
  useEffect(() => {
    if (!openChart || spxData) return;
    let alive = true;
    fetchSpxHistory().then((res) => {
      if (alive && res) setSpxData(res);
    });
    return () => { alive = false; };
  }, [openChart, spxData]);

  useEffect(() => {
    let alive = true;
    const pull = () => {
      fetchHomepageStats().then((ms) => {
        if (alive && ms) {
          setLiveStats(ms);
          setLiveAt(new Date(_hpCache.ts || Date.now()));
        }
      });
    };
    pull();
    const id = setInterval(() => {
      if (!document.hidden && etClock().rth) pull();
    }, HP_TTL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // 1. New Highs vs New Lows: live Finviz full-market -> breadth.json fallback
  const nhNl = useMemo(() => {
    if (liveStats?.new_high?.count != null && liveStats?.new_low?.count != null) {
      const nh = liveStats.new_high.count;
      const nl = liveStats.new_low.count;
      const tot = nh + nl;
      return { nh, nl, pct: tot > 0 ? (nh / tot) * 100 : 0, isLive: true };
    }
    const q = breadth?.conditions?.qulla?.net_hl;
    if (q?.nh != null && q?.nl != null) {
      const tot = q.nh + q.nl;
      return { nh: q.nh, nl: q.nl, pct: tot > 0 ? (q.nh / tot) * 100 : 0, isLive: false };
    }
    return null;
  }, [liveStats, breadth]);

  // 2. Advance vs Decline: live Finviz full-market -> breadth.json ad_history fallback
  const advDec = useMemo(() => {
    if (liveStats?.advancing?.count != null && liveStats?.declining?.count != null) {
      const adv = liveStats.advancing.count;
      const dec = liveStats.declining.count;
      const tot = adv + dec;
      return { adv, dec, pct: tot > 0 ? (adv / tot) * 100 : 0, isLive: true };
    }
    const hist = breadth?.ad_history;
    const last = Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null;
    if (last?.adv != null && last?.dec != null) {
      const tot = last.adv + last.dec;
      return { adv: last.adv, dec: last.dec, pct: tot > 0 ? (last.adv / tot) * 100 : 0, isLive: false };
    }
    return null;
  }, [liveStats, breadth]);

  // Historical daily series for New Highs vs New Lows and Advance vs Decline (last 1M / 3M + live Today bar)
  const { nhnlSeries, adSeries } = useMemo(() => {
    const raw = Array.isArray(breadth?.ad_history) ? breadth.ad_history : [];
    const todayStr = etClock().today;
    const lastDate = raw.length ? raw[raw.length - 1]?.date : null;

    const nhRows = raw
      .filter((d) => d?.nh != null && d?.nl != null)
      .slice(-histRange)
      .map((d) => ({ date: d.date, pos: d.nh, neg: d.nl, isLive: false }));
    if (nhNl?.isLive && lastDate !== todayStr) {
      nhRows.push({ date: "Today (Live)", pos: nhNl.nh, neg: nhNl.nl, isLive: true });
    }

    const adRows = raw
      .filter((d) => d?.adv != null && d?.dec != null)
      .slice(-histRange)
      .map((d) => ({ date: d.date, pos: d.adv, neg: d.dec, isLive: false }));
    if (advDec?.isLive && lastDate !== todayStr) {
      adRows.push({ date: "Today (Live)", pos: advDec.adv, neg: advDec.dec, isLive: true });
    }

    return { nhnlSeries: nhRows, adSeries: adRows };
  }, [breadth, histRange, nhNl, advDec]);

  // 3. Stan Weinstein Stage Analysis (Stages 1-4 across stockMap universe) + daily lookback
  const stageDist = useMemo(() => computeStageDistribution(stockMap), [stockMap]);
  const stageSeries = useMemo(
    () => estimateStageHistory(breadth?.history, stageDist, breadth?.date).slice(-histRange),
    [breadth, stageDist, histRange]
  );

  // Contextual tape read (e.g. Ted Zhang's "Junk rally" tell: big Adv% while Stage 4 >= 50% and NH/NL weak)
  const tapeTag = useMemo(() => {
    const s2 = stageDist.stages[1]?.pct ?? 0;
    const s4 = stageDist.stages[3]?.pct ?? 0;
    const advPct = advDec?.pct ?? null;
    const nhPct = nhNl?.pct ?? null;
    if (advPct != null && advPct >= 65 && s4 >= 50 && (nhPct == null || nhPct < 35)) {
      return { label: "Bear-Market / Junk Rally", color: COLORS.pink };
    }
    if (s2 >= 50 && (nhPct == null || nhPct >= 60)) {
      return { label: "Broad Stage 2 Uptrend", color: COLORS.blue };
    }
    if (s4 >= 55) {
      return { label: "Stage 4 Bear Regime", color: COLORS.pink };
    }
    if (s2 >= 35 && s4 <= 35) {
      return { label: "Constructive Breadth", color: A.green };
    }
    return { label: "Mixed / Transitional", color: COLORS.gold };
  }, [stageDist, advDec, nhNl, A.green]);

  // Slide 2: Moving Average Breadth (>20d, >50d, >200d) + Stockbee 4% movers
  const maStats = useMemo(() => {
    const stocks = Object.values(stockMap || {});
    const n = stocks.length;
    const above20 = stocks.filter((s) => (s.sma20_pct ?? -1) > 0).length;
    const above50Local = stocks.filter((s) => s.above_50ma === 1 || (s.sma50_pct ?? -1) > 0).length;
    const above200Local = stocks.filter((s) => (s.sma200_pct ?? -1) > 0).length;

    const s50 = liveStats?.sma50_above?.count != null && liveStats?.sma50_below?.count != null
      ? { above: liveStats.sma50_above.count, below: liveStats.sma50_below.count, pct: liveStats.sma50_above.pct }
      : { above: above50Local, below: Math.max(0, n - above50Local), pct: n > 0 ? (above50Local / n) * 100 : 0 };

    const s200 = liveStats?.sma200_above?.count != null && liveStats?.sma200_below?.count != null
      ? { above: liveStats.sma200_above.count, below: liveStats.sma200_below.count, pct: liveStats.sma200_above.pct }
      : { above: above200Local, below: Math.max(0, n - above200Local), pct: n > 0 ? (above200Local / n) * 100 : 0 };

    const s20 = { above: above20, below: Math.max(0, n - above20), pct: n > 0 ? (above20 / n) * 100 : 0 };

    const cur = monitor?.current;
    const up4 = cur?.up_4pct ?? stocks.filter((s) => (s.change_pct ?? 0) >= 4).length;
    const dn4 = cur?.down_4pct ?? stocks.filter((s) => (s.change_pct ?? 0) <= -4).length;
    const tot4 = up4 + dn4;
    return {
      s20,
      s50,
      s200,
      m4: { up: up4, dn: dn4, pct: tot4 > 0 ? (up4 / tot4) * 100 : 50 },
      t2108: cur?.t2108 ?? null,
      mcclellan: breadth?.conditions?.qulla?.mcclellan?.osc ?? null,
    };
  }, [stockMap, liveStats, monitor, breadth]);

  const isDark = A.bg === "#0a0d12" || A.bg === "#0d1117" || /^#0|^#1/.test(String(A.bg || ""));
  const trackBg = isDark ? "#2d333b" : "#e2e8f0";
  const isLive = Boolean(nhNl?.isLive || advDec?.isLive);

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, padding: "0 2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: A.text, letterSpacing: 0.1 }}>Market Breadth</span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              fontFamily: "monospace",
              padding: "1px 6px",
              borderRadius: 999,
              background: `${tapeTag.color}20`,
              border: `1px solid ${tapeTag.color}66`,
              color: tapeTag.color,
            }}
          >
            {tapeTag.label}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, fontFamily: "monospace", color: A.textMuted }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: isLive ? A.green : A.textMuted }}>
            {isLive && <span className="tp-livedot" style={{ width: 6, height: 6, borderRadius: 3, background: A.green, display: "inline-block" }} />}
            {isLive ? `LIVE${liveAt ? ` · ${liveAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : `EOD${breadth?.date ? ` · ${breadth.date}` : ""}`}
          </span>
          <button
            onClick={() => setSlide((s) => (s === 0 ? 1 : 0))}
            style={{
              background: "transparent",
              border: `1px solid ${A.border}`,
              color: A.textDim,
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 10,
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >
            {slide === 0 ? "MA Breadth →" : "← Stages"}
          </button>
        </div>
      </div>

      <div
        style={{
          background: A.bgCard,
          border: `1px solid ${A.border}`,
          borderRadius: 12,
          padding: "16px 18px 14px",
        }}
      >
        {slide === 0 ? (
          <>
            <RatioBar
              title="New Highs vs New Lows"
              pct={nhNl?.pct}
              leftLabel={nhNl ? `${nhNl.nh.toLocaleString()} Highs` : "— Highs"}
              rightLabel={nhNl ? `${nhNl.nl.toLocaleString()} Lows` : "— Lows"}
              accentColor={(nhNl?.pct ?? 0) >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
              expanded={openChart === "nhnl"}
              onClick={() => setOpenChart((cur) => (cur === "nhnl" ? null : "nhnl"))}
            />
            {openChart === "nhnl" && (
              <BreadthHistoryChart
                A={A}
                series={nhnlSeries}
                posLabel="Highs"
                negLabel="Lows"
                range={histRange}
                onRange={setHistRange}
                spxData={spxData}
                showSpx={showSpx}
                onToggleSpx={() => setShowSpx((v) => !v)}
                todayStr={todayStr}
              />
            )}

            <RatioBar
              title="Advance vs Decline"
              pct={advDec?.pct}
              leftLabel={advDec ? `${advDec.adv.toLocaleString()} Advance` : "— Advance"}
              rightLabel={advDec ? `${advDec.dec.toLocaleString()} Decline` : "— Decline"}
              accentColor={(advDec?.pct ?? 0) >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
              expanded={openChart === "ad"}
              onClick={() => setOpenChart((cur) => (cur === "ad" ? null : "ad"))}
            />
            {openChart === "ad" && (
              <BreadthHistoryChart
                A={A}
                series={adSeries}
                posLabel="Advance"
                negLabel="Decline"
                range={histRange}
                onRange={setHistRange}
                spxData={spxData}
                showSpx={showSpx}
                onToggleSpx={() => setShowSpx((v) => !v)}
                todayStr={todayStr}
              />
            )}

            {/* Stan Weinstein Stage Analysis */}
            <div>
              <div
                onClick={() => setOpenChart((cur) => (cur === "stage" ? null : "stage"))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenChart((cur) => (cur === "stage" ? null : "stage")); } }}
                title={openChart === "stage" ? "Hide Stage Analysis history chart" : "Click to view daily Stage Analysis lookback (1M / 3M / 6M / 1Y)"}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: A.text, letterSpacing: -0.1 }}>
                    <span>Stage Analysis</span>
                    <span style={{ fontSize: 10, fontWeight: 500, color: A.textMuted, fontFamily: "monospace" }}>
                      {openChart === "stage" ? "▾ hide" : "▸ chart"}
                    </span>
                  </span>
                  <span style={{ fontSize: 10, color: A.textMuted, fontFamily: "monospace" }}>
                    {stageDist.total.toLocaleString()} stocks · Weinstein 1–4
                  </span>
                </div>
                <div style={{ display: "flex", height: 8, width: "100%", borderRadius: 999, background: trackBg, overflow: "hidden" }}>
                  {stageDist.stages.map((st) => (
                    <div
                      key={st.stage}
                      title={`${st.label} (${st.hint}): ${st.count.toLocaleString()} (${st.pct}%)`}
                      style={{
                        width: `${stageDist.total > 0 ? (st.count / stageDist.total) * 100 : 0}%`,
                        background: STAGE_COLOR[st.stage],
                        transition: "width 0.35s ease",
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {stageDist.stages.map((st) => (
                    <div key={st.stage} title={`${st.label} — ${st.hint}`}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: A.text }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: STAGE_COLOR[st.stage], flexShrink: 0 }} />
                        <span>{st.label}</span>
                      </div>
                      <div style={{ fontSize: 11, color: A.textMuted, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                        {st.count.toLocaleString()} · <strong style={{ color: A.textDim }}>{st.pct}%</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {openChart === "stage" && (
                <StageHistoryChart
                  A={A}
                  series={stageSeries}
                  range={histRange}
                  onRange={setHistRange}
                  spxData={spxData}
                  showSpx={showSpx}
                  onToggleSpx={() => setShowSpx((v) => !v)}
                  todayStr={todayStr}
                />
              )}
            </div>
          </>
        ) : (
          <>
            <RatioBar
              title="Above 20-Day SMA"
              pct={maStats.s20.pct}
              leftLabel={`${maStats.s20.above.toLocaleString()} Above`}
              rightLabel={`${maStats.s20.below.toLocaleString()} Below`}
              accentColor={maStats.s20.pct >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
            />
            <RatioBar
              title="Above 50-Day SMA"
              pct={maStats.s50.pct}
              leftLabel={`${maStats.s50.above.toLocaleString()} Above`}
              rightLabel={`${maStats.s50.below.toLocaleString()} Below`}
              accentColor={maStats.s50.pct >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
            />
            <RatioBar
              title="Above 200-Day SMA"
              pct={maStats.s200.pct}
              leftLabel={`${maStats.s200.above.toLocaleString()} Above`}
              rightLabel={`${maStats.s200.below.toLocaleString()} Below`}
              accentColor={maStats.s200.pct >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
            />
            <RatioBar
              title="Stockbee 4% Movers"
              pct={maStats.m4.pct}
              leftLabel={`${maStats.m4.up.toLocaleString()} Up 4%+`}
              rightLabel={`${maStats.m4.dn.toLocaleString()} Down 4%+`}
              accentColor={maStats.m4.pct >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
            />
            {(maStats.t2108 != null || maStats.mcclellan != null) && (
              <div style={{ display: "flex", gap: 14, fontSize: 11, fontFamily: "monospace", color: A.textMuted }}>
                {maStats.t2108 != null && <span>T2108 <strong style={{ color: A.text }}>{maStats.t2108}%</strong></span>}
                {maStats.mcclellan != null && (
                  <span>McClellan Osc <strong style={{ color: maStats.mcclellan >= 0 ? COLORS.blue : COLORS.pink }}>{maStats.mcclellan > 0 ? `+${maStats.mcclellan}` : maStats.mcclellan}</strong></span>
                )}
              </div>
            )}
          </>
        )}

        {/* Carousel dots matching the Deepvue widget */}
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 12 }}>
          {[0, 1].map((i) => (
            <button
              key={i}
              aria-label={i === 0 ? "Breadth & Stage Analysis" : "Moving Average Breadth"}
              onClick={() => setSlide(i)}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                padding: 0,
                cursor: "pointer",
                background: slide === i ? A.textMuted : "transparent",
                border: `1.5px solid ${A.textMuted}`,
                opacity: slide === i ? 0.95 : 0.45,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
