import { useEffect, useMemo, useState } from "react";
import { STATUS, computeStageDistribution, estimateStageHistory, etClock } from "../lead/math.js";
import { LayerTable, MarketGate, Tabs, ThemeBoard } from "../lead/core.jsx";
import { authFetch } from "../utils.js";
import {
  buildCumulativeAdSeries,
  buildMaBreadthSeries,
  buildMcClellanSeries,
  detectBreadthSignals,
  filterStageStocks,
} from "./breadthChartMath.js";

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

function fmtCompactSigned(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 10000) return `${sign}${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

function fmtSigned(v, decimals = 0) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return decimals > 0 ? `${sign}${v.toFixed(decimals)}` : `${sign}${Math.round(v).toLocaleString()}`;
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
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
  cyan: "#06b6d4",
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

const STAGE_META = {
  1: { label: "Stage 1", hint: "Basing" },
  2: { label: "Stage 2", hint: "Uptrend" },
  3: { label: "Stage 3", hint: "Topping" },
  4: { label: "Stage 4", hint: "Downtrend" },
};

function signalToneColor(tone, A) {
  if (tone === "good") return A?.green || "#22c55e";
  if (tone === "bad") return COLORS.pink;
  return COLORS.gold;
}

function getDateSignals(signalByDate, date, allowedTypes) {
  if (!signalByDate || !date) return [];
  const list = signalByDate.get(date);
  if (!list?.length) return [];
  if (!allowedTypes) return list;
  return list.filter((s) => allowedTypes.has(s.type));
}

// Crisp vertical pin + top dot markers inside SVG charts for breadth thrusts, 90% days, hooks & SPX divergences
function SignalMarkers({ series, signalByDate, allowedTypes, padL, step, padT, plotH, A }) {
  if (!signalByDate || !series?.length) return null;
  const markers = [];
  for (let i = 0; i < series.length; i++) {
    const sigs = getDateSignals(signalByDate, series[i].date, allowedTypes);
    if (sigs.length) markers.push({ idx: i, sig: sigs[0], all: sigs });
  }
  if (!markers.length) return null;
  const showText = series.length <= 90 && markers.length <= 10;
  return (
    <g style={{ pointerEvents: "none" }}>
      {markers.map(({ idx, sig }) => {
        const x = padL + idx * step + step / 2;
        const c = signalToneColor(sig.tone, A);
        return (
          <g key={`${sig.date}-${sig.type}`}>
            <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke={c} strokeWidth="1" strokeDasharray="2 2" strokeOpacity="0.55" />
            <circle cx={x} cy={padT + 3.5} r="2.8" fill={c} stroke={A?.bg || "#0d1117"} strokeWidth="1" />
            {showText && (
              <text x={x} y={padT - 1.5} textAnchor="middle" fontSize="7.5" fontWeight="700" fill={c} fontFamily="monospace">
                {sig.short}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

const SIGNAL_EXPLAIN = {
  ninety_up: {
    meaning: "Institutional accumulation thrust — nearly all stocks rallying together on broad demand.",
    rule: "Triggered when ≥ 88% of advancing + declining issues close higher (≥ 500 issues).",
  },
  ninety_down: {
    meaning: "Broad liquidation / capitulation day — indiscriminate selling across the market.",
    rule: "Triggered when ≥ 88% of advancing + declining issues close lower (≥ 500 issues).",
  },
  zbt: {
    meaning: "Martin Zweig's rare breadth thrust — historically marks major bullish regime shifts.",
    rule: "Triggered when the 10-day EMA of Adv/(Adv+Dec) surges from <40% to >61.5% within 10 sessions.",
  },
  mc_os_hook: {
    meaning: "Short-term breadth washout turning up — early bounce / mean-reversion tell.",
    rule: "Triggered when the McClellan Oscillator drops ≤ −60 and hooks higher from a local low.",
  },
  mc_ob_hook: {
    meaning: "Short-term breadth momentum cooling from overbought territory.",
    rule: "Triggered when the McClellan Oscillator reaches ≥ +60 and rolls over from a local peak.",
  },
  div_bear: {
    meaning: "Thin rally warning — index price is pushing higher while fewer stocks participate underneath.",
    rule: "Triggered when SPX is within 0.5% of a 20d high while Cum A/D or >50d SMA lags meaningfully below its 20d peak.",
  },
  div_bull: {
    meaning: "Positive breadth divergence — fewer stocks are making new lows even as the index retests lows.",
    rule: "Triggered when SPX is within 0.5% of a 20d low while Cum A/D or >50d SMA holds meaningfully above its 20d trough.",
  },
};

function BreadthTagTip({ A, accent, heading, meaning, why, hint, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 60,
            width: 270,
            maxWidth: "78vw",
            padding: "8px 10px",
            borderRadius: 8,
            background: A.bgCard,
            border: `1px solid ${accent}88`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            pointerEvents: "none",
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, color: accent, fontFamily: "monospace", marginBottom: 3 }}>
            {heading}
          </div>
          {meaning && (
            <div style={{ fontSize: 10.5, color: A.text, marginBottom: 4 }}>
              {meaning}
            </div>
          )}
          {why && (
            <div style={{ fontSize: 10, color: A.textDim, fontFamily: "monospace", borderTop: `1px solid ${A.border}`, paddingTop: 4 }}>
              {why}
            </div>
          )}
          {hint && (
            <div style={{ fontSize: 9.5, color: A.textMuted, fontFamily: "monospace", marginTop: 4 }}>
              {hint}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function HoverSignalPills({ signals, A }) {
  if (!signals?.length) return null;
  return signals.map((sig) => {
    const c = signalToneColor(sig.tone, A);
    const ex = SIGNAL_EXPLAIN[sig.type];
    const fullTip = [ex?.meaning, sig.detail, ex?.rule].filter(Boolean).join(" — ");
    return (
      <span
        key={`${sig.type}-${sig.date}`}
        title={fullTip}
        style={{
          fontSize: 9,
          fontWeight: 800,
          padding: "0 5px",
          borderRadius: 4,
          background: `${c}22`,
          border: `1px solid ${c}77`,
          color: c,
          cursor: "help",
        }}
      >
        {sig.label}
      </span>
    );
  });
}

const AD_SIG_TYPES = new Set(["ninety_up", "ninety_down", "zbt"]);
const CUM_SIG_TYPES = new Set(["div_bear", "div_bull", "zbt"]);
const MC_SIG_TYPES = new Set(["mc_os_hook", "mc_ob_hook"]);
const MA50_SIG_TYPES = new Set(["div_bear", "div_bull"]);

const RANGE_OPTIONS = [
  [22, "1M"],
  [63, "3M"],
  [126, "6M"],
  [252, "1Y"],
];

function ChartControls({ A, range, onRange, onResetHover, spxData, showSpx, onToggleSpx, mode, onMode }) {
  return (
    <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {mode && onMode && (
        <div style={{ display: "inline-flex", gap: 2, marginRight: 2 }}>
          {[
            ["daily", "Daily"],
            ["cum", "Cum A/D"],
          ].map(([val, lbl]) => {
            const active = mode === val;
            return (
              <button
                key={val}
                type="button"
                onClick={() => { onResetHover?.(); onMode(val); }}
                style={{
                  background: active ? A.bgHover : "transparent",
                  border: `1px solid ${active ? COLORS.cyan : A.border}`,
                  color: active ? COLORS.cyan : A.textMuted,
                  borderRadius: 6,
                  padding: "1px 6px",
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                {lbl}
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={onToggleSpx}
        title={`Toggle ${spxData?.label || "SPX"} price line overlay`}
        style={{
          background: showSpx ? A.bgHover : "transparent",
          border: `1px solid ${showSpx ? A.text : A.border}`,
          color: showSpx ? A.text : A.textMuted,
          borderRadius: 6,
          padding: "1px 6px",
          fontSize: 10,
          fontWeight: 700,
          fontFamily: "monospace",
          cursor: "pointer",
        }}
      >
        {spxData?.label || "SPX"}
      </button>
      {RANGE_OPTIONS.map(([days, lbl]) => (
        <button
          key={lbl}
          type="button"
          onClick={() => { onResetHover?.(); onRange(days); }}
          style={{
            background: range === days ? A.bgHover : "transparent",
            border: `1px solid ${range === days ? COLORS.blue : A.border}`,
            color: range === days ? COLORS.blue : A.textMuted,
            borderRadius: 6,
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
  );
}

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
function BreadthHistoryChart({ A, series, posLabel, negLabel, range, onRange, spxData, showSpx, onToggleSpx, todayStr, mode, onMode, signalByDate, signalTypes }) {
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
          <HoverSignalPills signals={getDateSignals(signalByDate, cur.date, signalTypes)} A={A} />
        </div>
        <ChartControls
          A={A}
          range={range}
          onRange={onRange}
          onResetHover={() => setHoverIdx(null)}
          spxData={spxData}
          showSpx={showSpx}
          onToggleSpx={onToggleSpx}
          mode={mode}
          onMode={onMode}
        />
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
        <SignalMarkers series={series} signalByDate={signalByDate} allowedTypes={signalTypes} padL={padL} step={step} padT={padT} plotH={plotH} A={A} />

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

// Cumulative Advance-Decline Line chart with subtle area fill + SPX right-axis overlay for divergence reads
function CumAdHistoryChart({ A, series, range, onRange, spxData, showSpx, onToggleSpx, todayStr, mode, onMode, signalByDate, signalTypes }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!series || series.length === 0) {
    return (
      <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 10px", marginBottom: 14, background: A.bg, border: `1px solid ${A.border}`, borderRadius: 8 }}>
        No cumulative A/D series available yet.
      </div>
    );
  }

  const W = 600, H = 152;
  const n = series.length;
  const padL = 46, padT = 10, padB = 22;
  const hasSpx = Boolean(showSpx && spxData?.map && series.filter((d) => spxData.map.has(d.isLive ? todayStr : d.date)).length >= 2);
  const padR = hasSpx ? 44 : 10;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const step = plotW / n;
  const spx = hasSpx ? buildSpxOverlay(series, spxData, todayStr, padL, step, padT, plotH) : null;

  const vals = series.map((d) => d.cumAd);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const span = Math.max(maxVal - minVal, 1);
  const lo = minVal - span * 0.08;
  const hi = maxVal + span * 0.08;
  const midVal = (minVal + maxVal) / 2;

  const xOf = (i) => padL + i * step + step / 2;
  const yOf = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  const hasZero = lo < 0 && hi > 0;
  const zeroY = hasZero ? yOf(0) : null;

  const activeIdx = hoverIdx != null && hoverIdx < n ? hoverIdx : n - 1;
  const cur = series[activeIdx];
  const curSpx = spx ? spx.values[activeIdx] : null;
  const spxStroke = A.text || "#f8fafc";
  const spxHalo = A.bg || "#0d1117";

  const linePts = series.map((d, i) => `${xOf(i).toFixed(1)},${yOf(d.cumAd).toFixed(1)}`);
  const lineD = linePts.map((pt, i) => `${i === 0 ? "M" : "L"}${pt}`).join(" ");
  const baseY = padT + plotH;
  const areaD = n >= 2
    ? `${lineD} L${xOf(n - 1).toFixed(1)},${baseY.toFixed(1)} L${xOf(0).toFixed(1)},${baseY.toFixed(1)} Z`
    : "";

  const spansYear = series[0]?.date && series[n - 1]?.date && String(series[0].date).slice(0, 4) !== String(series[n - 1].date).slice(0, 4);
  const fmtShortDate = (d) => (d === "Today (Live)" ? "Live" : spansYear ? String(d || "").slice(2) : String(d || "").slice(5));
  const midIdx = Math.floor((n - 1) / 2);
  const partialNote = n < range ? `${n}d shown (earliest ${series[0].date})` : null;
  const midY = padT + plotH / 2;
  const showZeroLabel = hasZero && Math.abs(zeroY - (padT + 8)) > 11 && Math.abs(zeroY - midY) > 11 && Math.abs(zeroY - (padT + plotH)) > 11;

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
          <span style={{ color: COLORS.cyan, fontWeight: 700 }}>Cum A/D {fmtSigned(cur.cumAd)}</span>
          <span style={{ color: cur.net >= 0 ? COLORS.blue : COLORS.pink }}>
            Net {fmtSigned(cur.net)}
          </span>
          {curSpx != null && (
            <span style={{ color: A.text, fontWeight: 700 }}>
              {spx.label} {fmtSpx(curSpx)}
            </span>
          )}
          <HoverSignalPills signals={getDateSignals(signalByDate, cur.date, signalTypes)} A={A} />
        </div>
        <ChartControls
          A={A}
          range={range}
          onRange={onRange}
          onResetHover={() => setHoverIdx(null)}
          spxData={spxData}
          showSpx={showSpx}
          onToggleSpx={onToggleSpx}
          mode={mode}
          onMode={onMode}
        />
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <line x1={padL} y1={padT} x2={W - padR} y2={padT} stroke={A.border} strokeDasharray="2 3" strokeOpacity="0.6" />
        <line x1={padL} y1={midY} x2={W - padR} y2={midY} stroke={A.border} strokeDasharray="2 3" strokeOpacity="0.45" />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={A.border} strokeDasharray="2 3" strokeOpacity="0.6" />
        {hasZero && (
          <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke={A.textMuted} strokeDasharray="3 3" strokeOpacity="0.65" />
        )}

        {/* Left Y-axis labels */}
        <text x={padL - 5} y={padT + 8} textAnchor="end" fontSize="9" fill={COLORS.cyan} fontFamily="monospace">{fmtCompactSigned(maxVal)}</text>
        <text x={padL - 5} y={midY + 3} textAnchor="end" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtCompactSigned(midVal)}</text>
        <text x={padL - 5} y={padT + plotH} textAnchor="end" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtCompactSigned(minVal)}</text>
        {showZeroLabel && (
          <text x={padL - 5} y={zeroY + 3} textAnchor="end" fontSize="9" fill={A.textMuted} fontFamily="monospace">0</text>
        )}

        {/* Right Y-axis scale labels (SPX) */}
        {spx && (
          <>
            <text x={W - padR + 5} y={padT + 8} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtSpx(spx.max)}</text>
            <text x={W - padR + 5} y={midY + 3} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtSpx(spx.mid)}</text>
            <text x={W - padR + 5} y={padT + plotH} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtSpx(spx.min)}</text>
          </>
        )}

        {/* Subtle area fill */}
        {areaD && <path d={areaD} fill={COLORS.cyan} fillOpacity="0.13" style={{ pointerEvents: "none" }} />}
        <SignalMarkers series={series} signalByDate={signalByDate} allowedTypes={signalTypes} padL={padL} step={step} padT={padT} plotH={plotH} A={A} />

        {/* Hover hit zones */}
        {series.map((d, i) => {
          const isActive = i === activeIdx;
          return (
            <g key={d.date} onMouseEnter={() => setHoverIdx(i)} style={{ cursor: "crosshair" }}>
              <rect x={padL + i * step} y={padT} width={step} height={plotH} fill={isActive ? A.text : "transparent"} fillOpacity={isActive ? 0.06 : 0} />
              {isActive && (
                <line x1={xOf(i)} y1={padT} x2={xOf(i)} y2={padT + plotH} stroke={A.textMuted} strokeDasharray="2 2" strokeOpacity="0.45" />
              )}
            </g>
          );
        })}

        {/* Cumulative A/D curve */}
        {n >= 2 && (
          <path
            d={lineD}
            fill="none"
            stroke={COLORS.cyan}
            strokeWidth="1.9"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ pointerEvents: "none" }}
          />
        )}
        <circle
          cx={xOf(activeIdx)}
          cy={yOf(cur.cumAd)}
          r="3.4"
          fill={COLORS.cyan}
          stroke={spxHalo}
          strokeWidth="1.3"
          style={{ pointerEvents: "none" }}
        />

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
        <text x={padL} y={H - 5} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtShortDate(series[0].date)}</text>
        {n > 4 && (
          <text x={padL + midIdx * step + step / 2} y={H - 5} textAnchor="middle" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtShortDate(series[midIdx].date)}</text>
        )}
        <text x={W - padR} y={H - 5} textAnchor="end" fontSize="9" fill={series[n - 1].isLive ? A.green : A.textMuted} fontFamily="monospace">{fmtShortDate(series[n - 1].date)}</text>
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4, fontSize: 10, color: A.textMuted, fontFamily: "monospace" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span><span style={{ color: COLORS.cyan }}>━</span> Cum A/D Line (left)</span>
          {spx && <span><span style={{ color: A.text }}>━</span> {spx.label} (right)</span>}
        </div>
        {partialNote && <span>{partialNote}</span>}
      </div>
    </div>
  );
}

// 0%-100% MA Breadth history chart with >80% overbought band, <20% oversold washout band, + SPX overlay
function MaBreadthHistoryChart({ A, title, series, range, onRange, spxData, showSpx, onToggleSpx, todayStr, signalByDate, signalTypes }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!series || series.length === 0) {
    return (
      <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 10px", marginBottom: 14, background: A.bg, border: `1px solid ${A.border}`, borderRadius: 8 }}>
        No historical {title} series available yet.
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
  const step = plotW / n;
  const spx = hasSpx ? buildSpxOverlay(series, spxData, todayStr, padL, step, padT, plotH) : null;

  const xOf = (i) => padL + i * step + step / 2;
  const yOf = (pct) => padT + plotH - (Math.max(0, Math.min(100, pct)) / 100) * plotH;
  const y80 = yOf(80);
  const y50 = yOf(50);
  const y20 = yOf(20);
  const baseY = padT + plotH;

  const activeIdx = hoverIdx != null && hoverIdx < n ? hoverIdx : n - 1;
  const cur = series[activeIdx];
  const curSpx = spx ? spx.values[activeIdx] : null;
  const spxStroke = A.text || "#f8fafc";
  const spxHalo = A.bg || "#0d1117";
  const curColor = cur.pct < 20 ? COLORS.pink : cur.pct > 80 ? COLORS.blue : COLORS.cyan;
  const zoneTag = cur.pct < 20
    ? { label: "Oversold", color: COLORS.pink, tip: `${title} is below 20% (${cur.pct.toFixed(1)}%) — washout zone where breadth often bounces.` }
    : cur.pct > 80
    ? { label: "Overbought", color: COLORS.blue, tip: `${title} is above 80% (${cur.pct.toFixed(1)}%) — stretched short-term breadth; watch for pullbacks.` }
    : null;

  const linePts = series.map((d, i) => `${xOf(i).toFixed(1)},${yOf(d.pct).toFixed(1)}`);
  const lineD = linePts.map((pt, i) => `${i === 0 ? "M" : "L"}${pt}`).join(" ");
  const areaD = n >= 2
    ? `${lineD} L${xOf(n - 1).toFixed(1)},${baseY.toFixed(1)} L${xOf(0).toFixed(1)},${baseY.toFixed(1)} Z`
    : "";

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
          <span style={{ color: curColor, fontWeight: 700 }}>{cur.pct.toFixed(1)}% {title}</span>
          {zoneTag && (
            <span
              title={zoneTag.tip}
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: "0 5px",
                borderRadius: 4,
                background: `${zoneTag.color}22`,
                border: `1px solid ${zoneTag.color}66`,
                color: zoneTag.color,
                cursor: "help",
              }}
            >
              {zoneTag.label}
            </span>
          )}
          {curSpx != null && (
            <span style={{ color: A.text, fontWeight: 700 }}>
              {spx.label} {fmtSpx(curSpx)}
            </span>
          )}
          <HoverSignalPills signals={getDateSignals(signalByDate, cur.date, signalTypes)} A={A} />
        </div>
        <ChartControls
          A={A}
          range={range}
          onRange={onRange}
          onResetHover={() => setHoverIdx(null)}
          spxData={spxData}
          showSpx={showSpx}
          onToggleSpx={onToggleSpx}
        />
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Shaded overbought (>80%) & oversold washout (<20%) bands */}
        <rect x={padL} y={padT} width={plotW} height={y80 - padT} fill={COLORS.blue} fillOpacity="0.11" />
        <rect x={padL} y={y20} width={plotW} height={baseY - y20} fill={COLORS.pink} fillOpacity="0.12" />

        {/* Horizontal guide lines */}
        <line x1={padL} y1={padT} x2={W - padR} y2={padT} stroke={A.border} strokeDasharray="2 3" strokeOpacity="0.55" />
        <line x1={padL} y1={y80} x2={W - padR} y2={y80} stroke={COLORS.blue} strokeDasharray="3 3" strokeOpacity="0.5" />
        <line x1={padL} y1={y50} x2={W - padR} y2={y50} stroke={A.textMuted} strokeDasharray="3 3" strokeOpacity="0.45" />
        <line x1={padL} y1={y20} x2={W - padR} y2={y20} stroke={COLORS.pink} strokeDasharray="3 3" strokeOpacity="0.55" />
        <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke={A.border} strokeOpacity="0.7" />

        {/* Left Y-axis labels */}
        <text x={padL - 5} y={padT + 7} textAnchor="end" fontSize="8.5" fill={A.textMuted} fontFamily="monospace">100%</text>
        <text x={padL - 5} y={y80 + 3} textAnchor="end" fontSize="8.5" fill={COLORS.blue} fontFamily="monospace">80%</text>
        <text x={padL - 5} y={y50 + 3} textAnchor="end" fontSize="8.5" fill={A.textMuted} fontFamily="monospace">50%</text>
        <text x={padL - 5} y={y20 + 3} textAnchor="end" fontSize="8.5" fill={COLORS.pink} fontFamily="monospace">20%</text>
        <text x={padL - 5} y={baseY} textAnchor="end" fontSize="8.5" fill={A.textMuted} fontFamily="monospace">0%</text>

        {/* Right Y-axis scale labels (SPX) */}
        {spx && (
          <>
            <text x={W - padR + 5} y={padT + 8} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtSpx(spx.max)}</text>
            <text x={W - padR + 5} y={y50 + 3} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtSpx(spx.mid)}</text>
            <text x={W - padR + 5} y={baseY} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtSpx(spx.min)}</text>
          </>
        )}

        {/* Subtle area fill under MA% line */}
        {areaD && <path d={areaD} fill={COLORS.blue} fillOpacity="0.10" style={{ pointerEvents: "none" }} />}
        <SignalMarkers series={series} signalByDate={signalByDate} allowedTypes={signalTypes} padL={padL} step={step} padT={padT} plotH={plotH} A={A} />

        {/* Hover hit zones */}
        {series.map((d, i) => {
          const isActive = i === activeIdx;
          return (
            <g key={d.date} onMouseEnter={() => setHoverIdx(i)} style={{ cursor: "crosshair" }}>
              <rect x={padL + i * step} y={padT} width={step} height={plotH} fill={isActive ? A.text : "transparent"} fillOpacity={isActive ? 0.06 : 0} />
              {isActive && (
                <line x1={xOf(i)} y1={padT} x2={xOf(i)} y2={baseY} stroke={A.textMuted} strokeDasharray="2 2" strokeOpacity="0.45" />
              )}
            </g>
          );
        })}

        {/* MA% line */}
        {n >= 2 && (
          <path
            d={lineD}
            fill="none"
            stroke={COLORS.cyan}
            strokeWidth="1.9"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ pointerEvents: "none" }}
          />
        )}
        <circle
          cx={xOf(activeIdx)}
          cy={yOf(cur.pct)}
          r="3.4"
          fill={curColor}
          stroke={spxHalo}
          strokeWidth="1.3"
          style={{ pointerEvents: "none" }}
        />

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
        <text x={padL} y={H - 5} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtShortDate(series[0].date)}</text>
        {n > 4 && (
          <text x={padL + midIdx * step + step / 2} y={H - 5} textAnchor="middle" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtShortDate(series[midIdx].date)}</text>
        )}
        <text x={W - padR} y={H - 5} textAnchor="end" fontSize="9" fill={series[n - 1].isLive ? A.green : A.textMuted} fontFamily="monospace">{fmtShortDate(series[n - 1].date)}</text>
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4, fontSize: 10, color: A.textMuted, fontFamily: "monospace" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span><span style={{ color: COLORS.cyan }}>━</span> {title} (left)</span>
          <span><span style={{ color: COLORS.blue }}>■</span> &gt;80% OB</span>
          <span><span style={{ color: COLORS.pink }}>■</span> &lt;20% OS</span>
          {spx && <span><span style={{ color: A.text }}>━</span> {spx.label} (right)</span>}
        </div>
        {partialNote && <span>{partialNote}</span>}
      </div>
    </div>
  );
}

// Mirrored McClellan Oscillator bar chart around 0 with ±60 overbought/oversold guide lines + SPX overlay
function McClellanHistoryChart({ A, series, range, onRange, spxData, showSpx, onToggleSpx, todayStr, signalByDate, signalTypes }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!series || series.length === 0) {
    return (
      <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 10px", marginTop: 8, background: A.bg, border: `1px solid ${A.border}`, borderRadius: 8 }}>
        No historical McClellan Oscillator series available yet.
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

  const peak = Math.max(...series.map((d) => Math.abs(d.osc || 0)), 0);
  const maxAbs = Math.max(100, Math.ceil(peak / 10) * 10);
  const yOf = (v) => midY - (v / maxAbs) * halfH;
  const yPos60 = yOf(60);
  const yNeg60 = yOf(-60);
  const barW = Math.max(1.5, Math.min(16, step * 0.72));

  const activeIdx = hoverIdx != null && hoverIdx < n ? hoverIdx : n - 1;
  const cur = series[activeIdx];
  const curSpx = spx ? spx.values[activeIdx] : null;
  const spxStroke = A.text || "#f8fafc";
  const spxHalo = A.bg || "#0d1117";
  const zoneTag = cur.osc <= -60
    ? { label: "Oversold", color: COLORS.pink, tip: `McClellan Oscillator is ≤ −60 (${cur.osc.toFixed(1)}) — deeply oversold breadth; watch for an upward hook.` }
    : cur.osc >= 60
    ? { label: "Overbought", color: COLORS.blue, tip: `McClellan Oscillator is ≥ +60 (+${cur.osc.toFixed(1)}) — short-term overbought breadth; momentum may pause.` }
    : null;

  const spansYear = series[0]?.date && series[n - 1]?.date && String(series[0].date).slice(0, 4) !== String(series[n - 1].date).slice(0, 4);
  const fmtShortDate = (d) => (d === "Today (Live)" ? "Live" : spansYear ? String(d || "").slice(2) : String(d || "").slice(5));
  const midIdx = Math.floor((n - 1) / 2);
  const partialNote = n < range ? `${n}d shown (earliest ${series[0].date})` : null;

  return (
    <div
      style={{
        marginTop: 8,
        padding: "10px 12px 8px",
        background: A.bg,
        border: `1px solid ${A.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 6, fontSize: 11, fontFamily: "monospace" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ color: A.text }}>{cur.date}</strong>
          <span style={{ color: cur.osc >= 0 ? COLORS.blue : COLORS.pink, fontWeight: 700 }}>
            Osc {fmtSigned(cur.osc, 1)}
          </span>
          <span style={{ color: A.textMuted }}>
            Sum {cur.summation.toLocaleString()}
          </span>
          {zoneTag && (
            <span
              title={zoneTag.tip}
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: "0 5px",
                borderRadius: 4,
                background: `${zoneTag.color}22`,
                border: `1px solid ${zoneTag.color}66`,
                color: zoneTag.color,
                cursor: "help",
              }}
            >
              {zoneTag.label}
            </span>
          )}
          {curSpx != null && (
            <span style={{ color: A.text, fontWeight: 700 }}>
              {spx.label} {fmtSpx(curSpx)}
            </span>
          )}
          <HoverSignalPills signals={getDateSignals(signalByDate, cur.date, signalTypes)} A={A} />
        </div>
        <ChartControls
          A={A}
          range={range}
          onRange={onRange}
          onResetHover={() => setHoverIdx(null)}
          spxData={spxData}
          showSpx={showSpx}
          onToggleSpx={onToggleSpx}
        />
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Guide lines: +max, +60 OB, 0, -60 OS, -max */}
        <line x1={padL} y1={padT} x2={W - padR} y2={padT} stroke={A.border} strokeDasharray="2 3" strokeOpacity="0.55" />
        <line x1={padL} y1={yPos60} x2={W - padR} y2={yPos60} stroke={COLORS.blue} strokeDasharray="3 3" strokeOpacity="0.6" />
        <line x1={padL} y1={midY} x2={W - padR} y2={midY} stroke={A.textMuted} strokeOpacity="0.5" />
        <line x1={padL} y1={yNeg60} x2={W - padR} y2={yNeg60} stroke={COLORS.pink} strokeDasharray="3 3" strokeOpacity="0.6" />
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={A.border} strokeDasharray="2 3" strokeOpacity="0.55" />
        <SignalMarkers series={series} signalByDate={signalByDate} allowedTypes={signalTypes} padL={padL} step={step} padT={padT} plotH={plotH} A={A} />

        {/* Left Y-axis labels */}
        <text x={padL - 5} y={padT + 7} textAnchor="end" fontSize="8.5" fill={A.textMuted} fontFamily="monospace">+{maxAbs}</text>
        <text x={padL - 5} y={yPos60 + 3} textAnchor="end" fontSize="8.5" fill={COLORS.blue} fontFamily="monospace">+60</text>
        <text x={padL - 5} y={midY + 3} textAnchor="end" fontSize="8.5" fill={A.textMuted} fontFamily="monospace">0</text>
        <text x={padL - 5} y={yNeg60 + 3} textAnchor="end" fontSize="8.5" fill={COLORS.pink} fontFamily="monospace">-60</text>
        <text x={padL - 5} y={padT + plotH} textAnchor="end" fontSize="8.5" fill={A.textMuted} fontFamily="monospace">-{maxAbs}</text>

        {/* Right Y-axis scale labels (SPX) */}
        {spx && (
          <>
            <text x={W - padR + 5} y={padT + 8} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtSpx(spx.max)}</text>
            <text x={W - padR + 5} y={midY + 3} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtSpx(spx.mid)}</text>
            <text x={W - padR + 5} y={padT + plotH} textAnchor="start" fontSize="9" fill={A.textDim} fontFamily="monospace">{fmtSpx(spx.min)}</text>
          </>
        )}

        {/* Mirrored oscillator bars around 0 */}
        {series.map((d, i) => {
          const cx = padL + i * step + step / 2;
          const x = cx - barW / 2;
          const v = d.osc || 0;
          const h = Math.min(halfH, Math.max(0.8, (Math.abs(v) / maxAbs) * halfH));
          const isPos = v >= 0;
          const isActive = i === activeIdx;
          return (
            <g key={d.date} onMouseEnter={() => setHoverIdx(i)} style={{ cursor: "crosshair" }}>
              <rect x={padL + i * step} y={padT} width={step} height={plotH} fill={isActive ? A.text : "transparent"} fillOpacity={isActive ? 0.06 : 0} />
              <rect
                x={x}
                y={isPos ? midY - h : midY}
                width={barW}
                height={h}
                rx={n > 150 ? 0.5 : 1.5}
                fill={isPos ? COLORS.blue : COLORS.pink}
                fillOpacity={isActive ? 1 : d.isLive ? 0.92 : 0.76}
              />
            </g>
          );
        })}

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
        <text x={padL} y={H - 5} textAnchor="start" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtShortDate(series[0].date)}</text>
        {n > 4 && (
          <text x={padL + midIdx * step + step / 2} y={H - 5} textAnchor="middle" fontSize="9" fill={A.textMuted} fontFamily="monospace">{fmtShortDate(series[midIdx].date)}</text>
        )}
        <text x={W - padR} y={H - 5} textAnchor="end" fontSize="9" fill={series[n - 1].isLive ? A.green : A.textMuted} fontFamily="monospace">{fmtShortDate(series[n - 1].date)}</text>
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4, fontSize: 10, color: A.textMuted, fontFamily: "monospace" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span><span style={{ color: COLORS.blue }}>■</span> &gt;0 Bullish</span>
          <span><span style={{ color: COLORS.pink }}>■</span> &lt;0 Bearish</span>
          <span><span style={{ color: A.textDim }}>┄</span> ±60 OB/OS</span>
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
        <ChartControls
          A={A}
          range={range}
          onRange={onRange}
          onResetHover={() => setHoverIdx(null)}
          spxData={spxData}
          showSpx={showSpx}
          onToggleSpx={onToggleSpx}
        />
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

// Inline stock drill-down drawer for a clicked Stage 1-4 bucket
function StageStockDrawer({
  A,
  stageNum,
  totalCount,
  stocks,
  leadingOnly,
  onToggleLeading,
  minRs,
  onSetMinRs,
  onClose,
  onTicker,
  chartTicker,
}) {
  const color = STAGE_COLOR[stageNum] || COLORS.blue;
  const meta = STAGE_META[stageNum] || { label: `Stage ${stageNum}`, hint: "" };
  const rows = stocks.slice(0, 30);
  const filtered = leadingOnly || minRs > 0;
  const chipStyle = (active, accent) => ({
    background: active ? `${accent}22` : "transparent",
    border: `1px solid ${active ? accent : A.border}`,
    color: active ? accent : A.textMuted,
    borderRadius: 6,
    padding: "1px 6px",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "monospace",
    cursor: "pointer",
  });
  const thStyle = (align = "left") => ({
    textAlign: align,
    padding: "4px 6px",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "monospace",
    color: A.textMuted,
    borderBottom: `1px solid ${A.border}`,
    position: "sticky",
    top: 0,
    background: A.bg,
    whiteSpace: "nowrap",
  });
  const tdStyle = (align = "left") => ({
    textAlign: align,
    padding: "4px 6px",
    fontSize: 11,
    fontFamily: "monospace",
    fontVariantNumeric: "tabular-nums",
    borderBottom: `1px solid ${A.border}66`,
    whiteSpace: "nowrap",
  });

  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px 8px",
        background: A.bg,
        border: `1px solid ${color}66`,
        borderRadius: 8,
      }}
    >
      {/* Drawer header: stage badge + count + filter chips + close */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 10,
              fontWeight: 800,
              fontFamily: "monospace",
              padding: "2px 7px",
              borderRadius: 4,
              background: `${color}22`,
              border: `1px solid ${color}77`,
              color,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
            {meta.label} · {meta.hint}
          </span>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: A.textMuted }}>
            <strong style={{ color: A.text }}>{stocks.length.toLocaleString()}</strong>
            {filtered && totalCount != null ? ` of ${totalCount.toLocaleString()}` : ""} stocks
          </span>
        </div>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onToggleLeading}
            title="Show only stocks in Leading or Emerging themes"
            style={chipStyle(leadingOnly, A.green || COLORS.blue)}
          >
            Leading themes
          </button>
          <button
            type="button"
            onClick={() => onSetMinRs(minRs === 80 ? 0 : 80)}
            style={chipStyle(minRs === 80, COLORS.blue)}
          >
            RS ≥ 80
          </button>
          <button
            type="button"
            onClick={() => onSetMinRs(minRs === 90 ? 0 : 90)}
            style={chipStyle(minRs === 90, COLORS.cyan)}
          >
            RS ≥ 90
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close stage stock drawer"
            title="Close drawer"
            style={{
              background: "transparent",
              border: `1px solid ${A.border}`,
              color: A.textMuted,
              borderRadius: 6,
              padding: "1px 6px",
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "monospace",
              cursor: "pointer",
              marginLeft: 2,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Scrollable compact table (top 30 matches) */}
      {rows.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 4px", fontSize: 11, color: A.textMuted, fontFamily: "monospace" }}>
          <span>No {meta.label} stocks match the active filters.</span>
          {filtered && (
            <button
              type="button"
              onClick={() => { if (leadingOnly) onToggleLeading(); if (minRs > 0) onSetMinRs(0); }}
              style={{ background: "transparent", border: `1px solid ${A.border}`, color: A.text, borderRadius: 6, padding: "2px 7px", fontSize: 10, fontFamily: "monospace", cursor: "pointer" }}
            >
              Reset filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={{ maxHeight: 240, overflowY: "auto", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle("left")}>Ticker</th>
                  <th style={thStyle("left")}>Theme · Layer</th>
                  <th style={thStyle("right")}>RS</th>
                  <th style={thStyle("right")}>Chg%</th>
                  <th style={thStyle("right")}>vs 50d</th>
                  <th style={thStyle("right")}>Off 52wH</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const active = Boolean(chartTicker && s.ticker === chartTicker);
                  const l = s.layer;
                  const themeText = l?.theme || s.sector || "";
                  const layerText = l?.name || s.industry || "";
                  const groupLabel = themeText && layerText && themeText !== layerText
                    ? `${themeText} · ${layerText}`
                    : themeText || layerText || "—";
                  const layerDot = l?.st === "lead" ? (A.green || COLORS.blue) : l?.st === "emerg" ? COLORS.cyan : null;
                  const chgColor = s.change_pct == null ? A.textMuted : s.change_pct > 0 ? (A.green || COLORS.blue) : s.change_pct < 0 ? COLORS.pink : A.textDim;
                  const s50Color = s.sma50_pct == null ? A.textMuted : s.sma50_pct >= 0 ? COLORS.blue : COLORS.pink;
                  const rsColor = (s.rs_rank ?? 0) >= 90 ? COLORS.cyan : (s.rs_rank ?? 0) >= 80 ? A.text : A.textMuted;

                  return (
                    <tr
                      key={s.ticker}
                      className={onTicker ? "tp-click-row" : undefined}
                      onClick={onTicker ? () => onTicker(s.ticker) : undefined}
                      style={{
                        cursor: onTicker ? "pointer" : "default",
                        background: active ? `${color}20` : "transparent",
                        boxShadow: active ? `inset 2px 0 0 ${A.green}` : "none",
                      }}
                    >
                      <td style={{ ...tdStyle("left"), fontWeight: 800, color: active ? color : A.text }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {active && <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />}
                          {s.ticker}
                        </span>
                      </td>
                      <td
                        title={s.company ? `${s.company} — ${groupLabel}` : groupLabel}
                        style={{
                          ...tdStyle("left"),
                          fontFamily: "inherit",
                          color: A.textDim,
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {layerDot && <span style={{ color: layerDot, marginRight: 4, fontSize: 9 }}>●</span>}
                        {groupLabel}
                      </td>
                      <td style={{ ...tdStyle("right"), fontWeight: 700, color: rsColor }}>
                        {s.rs_rank != null && Number.isFinite(s.rs_rank) ? Math.round(s.rs_rank) : "—"}
                      </td>
                      <td style={{ ...tdStyle("right"), fontWeight: 700, color: chgColor }}>
                        {fmtPct(s.change_pct)}
                      </td>
                      <td style={{ ...tdStyle("right"), color: s50Color }}>
                        {fmtPct(s.sma50_pct)}
                      </td>
                      <td style={{ ...tdStyle("right"), color: A.textDim }}>
                        {fmtPct(s.off_52w_high)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {stocks.length > 30 && (
            <div style={{ marginTop: 4, fontSize: 10, color: A.textMuted, fontFamily: "monospace", textAlign: "right" }}>
              Showing top 30 of {stocks.length.toLocaleString()} matches (sorted by RS, then Chg%)
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MarketBreadthCard({
  A,
  stockMap,
  breadth,
  monitor,
  indexQuotes,
  onTicker,
  chartTicker,
  tickerLayer,
  themes = [],
  layers = [],
  members = {},
  onTheme,
  embedded = false,
}) {
  const [cardTab, setCardTab] = useState("breadth"); // "breadth" | "themes" | "layers"
  const [selThemeId, setSelThemeId] = useState(null);
  const [layerTab, setLayerTab] = useState("all"); // "all" | "lead" | "weak" | "brk" | "emerg" | "lag"
  const [expandedLayerKey, setExpandedLayerKey] = useState(null);
  const [layerSort, setLayerSort] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("tp_layer_sort")) || null;
      return saved?.k === "netDvol" ? { ...saved, k: "thrust" } : saved;
    } catch { return null; }
  });
  const [themeSort, setThemeSort] = useState("rank"); // "rank" | "hold" | "today" | "thrust" | "rvol"
  const [slide, setSlide] = useState(0); // 0 = Breadth + Stage Analysis (Deepvue view), 1 = MA Breadth + 4% Movers
  const [openChart, setOpenChart] = useState(null); // null | "nhnl" | "ad" | "stage" | "p20" | "p50" | "p200" | "mcclellan"
  const [adMode, setAdMode] = useState("daily"); // "daily" | "cum"
  const [histRange, setHistRange] = useState(126); // 22 (~1M) | 63 (~3M) | 126 (~6M) | 252 (~1Y)
  const [showSpx, setShowSpx] = useState(true);
  const [spxData, setSpxData] = useState(() => _spxCache.data);
  const [liveStats, setLiveStats] = useState(() => _hpCache.stats);
  const [liveAt, setLiveAt] = useState(() => (_hpCache.ts ? new Date(_hpCache.ts) : null));
  const [selectedStage, setSelectedStage] = useState(null); // null | 1 | 2 | 3 | 4
  const [stageLeadingOnly, setStageLeadingOnly] = useState(false);
  const [stageMinRs, setStageMinRs] = useState(0); // 0 | 80 | 90
  const todayStr = etClock().today;

  // Load daily SPX (^GSPC, fallback SPY) closes once on mount (10m module cache) for chart overlays & divergence detection
  useEffect(() => {
    if (spxData) return;
    let alive = true;
    fetchSpxHistory().then((res) => {
      if (alive && res) setSpxData(res);
    });
    return () => { alive = false; };
  }, [spxData]);

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

  // Historical daily series for New Highs vs New Lows, Advance vs Decline, Cumulative A/D, and McClellan
  const { nhnlSeries, adSeries, cumAdSeries, mcclellanSeries } = useMemo(() => {
    const raw = Array.isArray(breadth?.ad_history) ? breadth.ad_history : [];
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

    const fullCumAd = buildCumulativeAdSeries(raw, advDec, todayStr);
    const fullMcClellan = buildMcClellanSeries(raw, advDec, todayStr);

    return {
      nhnlSeries: nhRows,
      adSeries: adRows,
      cumAdSeries: fullCumAd.slice(-histRange),
      mcclellanSeries: fullMcClellan.slice(-histRange),
    };
  }, [breadth, histRange, nhNl, advDec, todayStr]);

  // Historical daily series for Slide 2 MA Breadth (Above 20d / 50d / 200d SMA)
  const maSeries = useMemo(() => {
    const hist = breadth?.history;
    const live50 = liveStats?.sma50_above?.pct ?? null;
    const live200 = liveStats?.sma200_above?.pct ?? null;
    return {
      p20: buildMaBreadthSeries(hist, "p20", null, todayStr).slice(-histRange),
      p50: buildMaBreadthSeries(hist, "p50", live50, todayStr).slice(-histRange),
      p200: buildMaBreadthSeries(hist, "p200", live200, todayStr).slice(-histRange),
    };
  }, [breadth, liveStats, histRange, todayStr]);

  // 3. Stan Weinstein Stage Analysis (Stages 1-4 across stockMap universe) + daily lookback
  const stageDist = useMemo(() => computeStageDistribution(stockMap), [stockMap]);
  const stageSeries = useMemo(
    () => estimateStageHistory(breadth?.history, stageDist, breadth?.date).slice(-histRange),
    [breadth, stageDist, histRange]
  );

  // Filtered stocks for the clicked Stage Analysis bucket drawer
  const stageDrawerStocks = useMemo(() => {
    if (selectedStage == null) return [];
    return filterStageStocks(stockMap, selectedStage, {
      tickerLayer,
      leadingOnly: stageLeadingOnly,
      minRs: stageMinRs,
    });
  }, [stockMap, selectedStage, tickerLayer, stageLeadingOnly, stageMinRs]);

  // Contextual tape read (e.g. Ted Zhang's "Junk rally" tell: big Adv% while Stage 4 >= 50% and NH/NL weak)
  const tapeTag = useMemo(() => {
    const s2 = stageDist.stages[1]?.pct ?? 0;
    const s4 = stageDist.stages[3]?.pct ?? 0;
    const advPct = advDec?.pct ?? null;
    const nhPct = nhNl?.pct ?? null;
    const statsLine = `Now: S2 ${s2}% · S4 ${s4}%${advPct != null ? ` · Adv ${Math.round(advPct)}%` : ""}${nhPct != null ? ` · NH ${Math.round(nhPct)}%` : ""}`;
    if (advPct != null && advPct >= 65 && s4 >= 50 && (nhPct == null || nhPct < 35)) {
      return {
        label: "Bear-Market / Junk Rally",
        color: COLORS.pink,
        meaning: "Short-covering bounce led by beaten-down names while most stocks remain in Stage 4 downtrends with weak New Highs.",
        why: `Rule: Adv ≥65% + Stage 4 ≥50% + NH <35%. ${statsLine}`,
      };
    }
    if (s2 >= 50 && (nhPct == null || nhPct >= 60)) {
      return {
        label: "Broad Stage 2 Uptrend",
        color: COLORS.blue,
        meaning: "Healthy bull market — majority of stocks are in Stage 2 uptrends and New Highs dominate New Lows.",
        why: `Rule: Stage 2 ≥50% + NH ≥60%. ${statsLine}`,
      };
    }
    if (s4 >= 55) {
      return {
        label: "Stage 4 Bear Regime",
        color: COLORS.pink,
        meaning: "Broad structural downtrend — over half the market is trading below declining 50d & 200d MAs. Stay defensive.",
        why: `Rule: Stage 4 ≥55%. ${statsLine}`,
      };
    }
    if (s2 >= 35 && s4 <= 35) {
      return {
        label: "Constructive Breadth",
        color: A.green,
        meaning: "Supportive trend environment with solid Stage 2 leadership and limited Stage 4 damage.",
        why: `Rule: Stage 2 ≥35% + Stage 4 ≤35%. ${statsLine}`,
      };
    }
    return {
      label: "Mixed / Transitional",
      color: COLORS.gold,
      meaning: "Choppy or rotating market — neither broad Stage 2 expansion nor full Stage 4 bear regime. Be selective.",
      why: `Rule: Between bull (S2 ≥35%, S4 ≤35%) and bear (S4 ≥55%) thresholds. ${statsLine}`,
    };
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
    const latestMc = mcclellanSeries.length ? mcclellanSeries[mcclellanSeries.length - 1].osc : null;
    return {
      s20,
      s50,
      s200,
      m4: { up: up4, dn: dn4, pct: tot4 > 0 ? (up4 / tot4) * 100 : 50 },
      t2108: cur?.t2108 ?? null,
      mcclellan: breadth?.conditions?.qulla?.mcclellan?.osc ?? latestMc,
    };
  }, [stockMap, liveStats, monitor, breadth, mcclellanSeries]);

  const breadthSignals = useMemo(
    () => detectBreadthSignals({
      adHistory: breadth?.ad_history,
      history: breadth?.history,
      spxMap: spxData?.map || null,
      liveAdvDec: advDec,
      todayStr,
    }),
    [breadth, spxData, advDec, todayStr]
  );

  const hasLeaderTabs = (Array.isArray(themes) && themes.length > 0) || (Array.isArray(layers) && layers.length > 0);
  const selThemeObj = useMemo(
    () => (selThemeId ? (themes || []).find((t) => t.themeId === selThemeId) || null : null),
    [themes, selThemeId]
  );
  const visLayers = useMemo(
    () => (selThemeId ? (layers || []).filter((l) => l.themeId === selThemeId) : (layers || [])),
    [layers, selThemeId]
  );
  const layerBuckets = useMemo(() => {
    const b = { all: [...visLayers].sort((x, y) => (y.now ?? -1) - (x.now ?? -1)), lead: [], weak: [], brk: [], emerg: [], lag: [] };
    for (const l of visLayers) {
      if (b[l.st]) b[l.st].push(l);
    }
    return b;
  }, [visLayers]);

  const pickTheme = (id) => {
    setSelThemeId(id);
    setExpandedLayerKey(null);
    if (id) {
      if (layerTab !== "all") {
        const subset = (layers || []).filter((l) => l.themeId === id);
        if (subset.length && !subset.some((l) => l.st === layerTab)) {
          setLayerTab("all");
        }
      }
      setCardTab("layers");
    }
  };
  const sortedThemes = useMemo(() => {
    const arr = [...(themes || [])];
    const keyVal = (t) => {
      if (themeSort === "hold") return (t.heldAvg ?? 0) * 1000 + (t.now ?? 0);
      if (themeSort === "today") return t.dayFlow?.today ?? null;
      if (themeSort === "thrust") return t.dayFlow?.thrust ?? null;
      if (themeSort === "rvol") return t.dayFlow?.rvol ?? null;
      return t.now ?? 0;
    };
    return arr.sort((a, b) => {
      const va = keyVal(a), vb = keyVal(b);
      if (va == null && vb == null) return (b.now ?? 0) - (a.now ?? 0);
      if (va == null) return 1;
      if (vb == null) return -1;
      return vb - va || (b.now ?? 0) - (a.now ?? 0);
    });
  }, [themes, themeSort]);

  const sortPillStyle = (active, accent) => ({
    background: active ? `${accent || A.green}20` : "transparent",
    border: `1px solid ${active ? (accent || A.green) : A.border}`,
    color: active ? (accent || A.green) : A.textDim,
    borderRadius: 6,
    padding: "2px 7px",
    fontSize: 10,
    fontFamily: "monospace",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  const pickLayerPreset = (k) => {
    const next = k === "rank" ? null : { k, d: "desc" };
    setLayerSort(next);
    try { localStorage.setItem("tp_layer_sort", JSON.stringify(next)); } catch { /* ignore */ }
  };

  const toggleInlineLayer = (l) => {
    if (!l) return;
    const next = expandedLayerKey === l.key ? null : l.key;
    setExpandedLayerKey(next);
    if (next && onTicker) {
      const top = (members?.[l.key] || (l.holds || []).map((h) => h.t))
        .filter((t) => stockMap?.[t])
        .sort((a, b) => (stockMap[b]?.rs_rank ?? 0) - (stockMap[a]?.rs_rank ?? 0))[0];
      if (top) onTicker(top);
    }
  };

  const openSignalChart = (sig) => {
    setCardTab("breadth");
    if (sig.chart === "mcclellan") {
      setSlide(1);
      setOpenChart("mcclellan");
    } else if (sig.chart === "p50") {
      setSlide(1);
      setOpenChart("p50");
    } else if (sig.chart === "cum") {
      setSlide(0);
      setAdMode("cum");
      setOpenChart("ad");
    } else {
      setSlide(0);
      setAdMode("daily");
      setOpenChart("ad");
    }
  };

  const isDark = A.bg === "#0a0d12" || A.bg === "#0d1117" || /^#0|^#1/.test(String(A.bg || ""));
  const trackBg = isDark ? "#2d333b" : "#e2e8f0";
  const isLive = Boolean(nhNl?.isLive || advDec?.isLive);
  const toggleChart = (id) => setOpenChart((cur) => (cur === id ? null : id));

  return (
    <div style={embedded ? { marginTop: 12, paddingTop: 12, borderTop: `1px solid ${A.border}` } : { marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: embedded ? 10 : 6, padding: embedded ? 0 : "0 2px" }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <span style={{ fontSize: embedded ? 11 : 13, fontWeight: 800, color: embedded ? A.textDim : A.text, letterSpacing: embedded ? 0.4 : 0.1, textTransform: embedded ? "uppercase" : "none", fontFamily: embedded ? "monospace" : "inherit" }}>
            Market Breadth
          </span>
          <BreadthTagTip
            A={A}
            accent={tapeTag.color}
            heading={tapeTag.label}
            meaning={tapeTag.meaning}
            why={tapeTag.why}
          >
            <span
              tabIndex={0}
              style={{
                fontSize: 9,
                fontWeight: 700,
                fontFamily: "monospace",
                padding: "1px 6px",
                borderRadius: 4,
                background: `${tapeTag.color}20`,
                border: `1px solid ${tapeTag.color}66`,
                color: tapeTag.color,
                cursor: "help",
              }}
            >
              {tapeTag.label}
            </span>
          </BreadthTagTip>
          {breadthSignals.recent.slice(0, 3).map((sig) => {
            const c = signalToneColor(sig.tone, A);
            const ex = SIGNAL_EXPLAIN[sig.type];
            const dateLbl = sig.date === "Today (Live)" ? "Live" : sig.date.slice(5);
            return (
              <BreadthTagTip
                key={`${sig.type}-${sig.date}`}
                A={A}
                accent={c}
                heading={`${sig.label} (${sig.date})`}
                meaning={ex?.meaning}
                why={`${sig.detail}${ex?.rule ? ` · ${ex.rule}` : ""}`}
                hint="Click tag to open chart →"
              >
                <button
                  type="button"
                  onClick={() => openSignalChart(sig)}
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    fontFamily: "monospace",
                    padding: "1px 6px",
                    borderRadius: 6,
                    background: `${c}1f`,
                    border: `1px solid ${c}77`,
                    color: c,
                    cursor: "pointer",
                  }}
                >
                  {sig.label} · {dateLbl}
                </button>
              </BreadthTagTip>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: 10, fontFamily: "monospace", color: A.textMuted }}>
          {!embedded && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: isLive ? A.green : A.textMuted }}>
              {isLive && <span className="tp-livedot" style={{ width: 6, height: 6, borderRadius: 3, background: A.green, display: "inline-block" }} />}
              {isLive ? `LIVE${liveAt ? ` · ${liveAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : `EOD${breadth?.date ? ` · ${breadth.date}` : ""}`}
            </span>
          )}
          {hasLeaderTabs && (
            <Tabs
              A={A}
              value={cardTab}
              onChange={setCardTab}
              items={[
                ["breadth", "Breadth", "", COLORS.blue],
                ["themes", "Themes", themes.length || "", A.green],
                ["layers", "Layers", visLayers.length || "", A.cyan],
              ]}
            />
          )}
          {cardTab === "breadth" && (
            <button
              type="button"
              onClick={() => setSlide((s) => (s === 0 ? 1 : 0))}
              style={{
                background: "transparent",
                border: `1px solid ${A.border}`,
                color: A.textDim,
                borderRadius: 6,
                padding: "2px 7px",
                fontSize: 10,
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              {slide === 0 ? "MA Breadth →" : "← Stages"}
            </button>
          )}
        </div>
      </div>

      <div
        style={
          embedded
            ? { padding: "2px 0 0" }
            : {
                background: A.bgCard,
                border: `1px solid ${A.border}`,
                borderRadius: 12,
                padding: "16px 18px 14px",
              }
        }
      >
        {cardTab === "themes" ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 8, fontSize: 10, color: A.textMuted, fontFamily: "monospace" }}>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                <span style={{ color: A.textMuted, marginRight: 2 }}>SORT</span>
                {[
                  ["rank", "RS Rank", A.green, "Best overall RS rank"],
                  ["hold", "Holding Up", A.cyan, "Consistent RS ≥ 80 over last 20 sessions"],
                  ["today", "Today %", COLORS.blue, "Strongest median % move today"],
                  ["thrust", "Day Thrust", "#fbbf24", "Today's strength: median % × $Vol× × dollar-flow alignment (no mega-cap bias)"],
                  ["rvol", "$Vol×", "#c084fc", "Biggest volume surge vs 20d avg $Vol today"],
                ].map(([k, lbl, acc, tip]) => (
                  <button key={k} type="button" onClick={() => setThemeSort(k)} title={tip} style={sortPillStyle(themeSort === k, acc)}>
                    {lbl}
                  </button>
                ))}
              </div>
              {selThemeObj && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSelThemeId(null)}
                    style={{ background: "transparent", border: `1px solid ${A.border}`, color: A.cyan, borderRadius: 6, padding: "1px 6px", fontSize: 10, fontFamily: "monospace", cursor: "pointer" }}
                  >
                    {selThemeObj.theme} ✕
                  </button>
                  {onTheme && (
                    <button
                      type="button"
                      onClick={() => onTheme(selThemeObj.themeId)}
                      style={{ background: `${A.green}18`, border: `1px solid ${A.green}66`, color: A.green, borderRadius: 6, padding: "1px 6px", fontSize: 10, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}
                    >
                      Open Stocks
                    </button>
                  )}
                </span>
              )}
            </div>
            <div style={{ maxHeight: 460, overflowY: "auto" }}>
              <ThemeBoard themes={sortedThemes} A={A} selected={selThemeId} onSelect={pickTheme} />
            </div>
          </div>
        ) : cardTab === "layers" ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              <Tabs
                A={A}
                value={layerTab}
                onChange={setLayerTab}
                items={[
                  ["all", "All", layerBuckets.all.length, A.text],
                  ["lead", "Leading", layerBuckets.lead.length, A.green],
                  ["weak", "Weakening", layerBuckets.weak.length, A.yellow],
                  ["brk", "Breaking down", layerBuckets.brk.length, A.red],
                  ["emerg", "Emerging", layerBuckets.emerg.length, A.cyan],
                  ["lag", "Lagging", layerBuckets.lag.length, A.textDim],
                ]}
              />
              {selThemeObj && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontFamily: "monospace" }}>
                  <button
                    type="button"
                    onClick={() => setSelThemeId(null)}
                    title="Clear theme filter"
                    style={{ background: `${A.cyan}18`, border: `1px solid ${A.cyan}66`, color: A.cyan, borderRadius: 6, padding: "1px 6px", fontSize: 10, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}
                  >
                    Theme: {selThemeObj.theme} ✕
                  </button>
                  {onTheme && (
                    <button
                      type="button"
                      onClick={() => onTheme(selThemeObj.themeId)}
                      style={{ background: "transparent", border: `1px solid ${A.border}`, color: A.green, borderRadius: 6, padding: "1px 6px", fontSize: 10, fontFamily: "monospace", cursor: "pointer" }}
                    >
                      All Stocks
                    </button>
                  )}
                </span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, fontSize: 10, fontFamily: "monospace" }}>
                <span style={{ color: A.textMuted, marginRight: 2 }}>SORT</span>
                {[
                  ["rank", "RS Rank", A.green, "Best overall layer RS rank"],
                  ["held20", "Holding Up", A.cyan, "Most sessions at RS ≥ 80 over last 20 (ties by current RS)"],
                  ["mbr", "Mbr RS", A.green, "Highest median member stock RS"],
                  ["today", "Today %", COLORS.blue, "Strongest median % move today"],
                  ["thrust", "Day Thrust", "#fbbf24", "Today's strength: median % × $Vol× × dollar-flow alignment (no mega-cap bias)"],
                  ["rvol", "$Vol×", "#c084fc", "Biggest volume surge vs 20d avg $Vol today"],
                ].map(([k, lbl, acc, tip]) => {
                  const active = k === "rank" ? (!layerSort || (layerSort.k === "rank" && layerSort.d === "desc")) : (layerSort?.k === k && layerSort?.d === "desc");
                  return (
                    <button key={k} type="button" onClick={() => pickLayerPreset(k)} title={tip} style={sortPillStyle(active, acc)}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
              <span style={{ fontSize: 10, color: A.textMuted }}>
                {layerTab === "all" ? "Click any layer to expand members below" : STATUS[layerTab]?.hint}
              </span>
            </div>
            <LayerTable
              rows={layerBuckets[layerTab] || []}
              A={A}
              onTicker={onTicker}
              chartTicker={chartTicker}
              stockMap={stockMap}
              showPeak={layerTab === "weak" || layerTab === "brk"}
              members={members}
              expanded={expandedLayerKey}
              onToggle={toggleInlineLayer}
              sort={layerSort}
              onSort={setLayerSort}
              inlineExpand
              maxHeight={expandedLayerKey ? 620 : 460}
              compact
            />
          </div>
        ) : slide === 0 ? (
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
              onClick={() => toggleChart("nhnl")}
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
              onClick={() => toggleChart("ad")}
            />
            {openChart === "ad" && (
              adMode === "cum" ? (
                <CumAdHistoryChart
                  A={A}
                  series={cumAdSeries}
                  range={histRange}
                  onRange={setHistRange}
                  spxData={spxData}
                  showSpx={showSpx}
                  onToggleSpx={() => setShowSpx((v) => !v)}
                  todayStr={todayStr}
                  mode={adMode}
                  onMode={setAdMode}
                  signalByDate={breadthSignals.byDate}
                  signalTypes={CUM_SIG_TYPES}
                />
              ) : (
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
                  mode={adMode}
                  onMode={setAdMode}
                  signalByDate={breadthSignals.byDate}
                  signalTypes={AD_SIG_TYPES}
                />
              )
            )}

            {/* Stan Weinstein Stage Analysis */}
            <div>
              <div
                onClick={() => toggleChart("stage")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleChart("stage"); } }}
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
                      title={`${st.label} (${STAGE_META[st.stage]?.hint || st.hint}): ${st.count.toLocaleString()} (${st.pct}%)`}
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
                  {stageDist.stages.map((st) => {
                    const active = selectedStage === st.stage;
                    const c = STAGE_COLOR[st.stage];
                    const hint = STAGE_META[st.stage]?.hint || st.hint;
                    return (
                      <div
                        key={st.stage}
                        role="button"
                        tabIndex={0}
                        title={`Click to inspect ${st.label} (${hint}) stocks`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedStage((cur) => (cur === st.stage ? null : st.stage));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedStage((cur) => (cur === st.stage ? null : st.stage));
                          }
                        }}
                        style={{
                          padding: "5px 7px",
                          borderRadius: 6,
                          border: `1px solid ${active ? c : "transparent"}`,
                          background: active ? `${c}18` : "transparent",
                          cursor: "pointer",
                          transition: "border-color 0.15s ease, background 0.15s ease",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, fontSize: 11, fontWeight: 700, color: A.text }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />
                            <span>{st.label}</span>
                          </span>
                          <span style={{ fontSize: 9, color: active ? c : A.textMuted, fontFamily: "monospace" }}>
                            {active ? "▾" : "▸"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: A.textMuted, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                          {st.count.toLocaleString()} · <strong style={{ color: A.textDim }}>{st.pct}%</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {selectedStage != null && (
                <StageStockDrawer
                  A={A}
                  stageNum={selectedStage}
                  totalCount={stageDist.stages[selectedStage - 1]?.count ?? null}
                  stocks={stageDrawerStocks}
                  leadingOnly={stageLeadingOnly}
                  onToggleLeading={() => setStageLeadingOnly((v) => !v)}
                  minRs={stageMinRs}
                  onSetMinRs={setStageMinRs}
                  onClose={() => setSelectedStage(null)}
                  onTicker={onTicker}
                  chartTicker={chartTicker}
                />
              )}

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
              expanded={openChart === "p20"}
              onClick={() => toggleChart("p20")}
            />
            {openChart === "p20" && (
              <MaBreadthHistoryChart
                A={A}
                title="Above 20-Day SMA"
                series={maSeries.p20}
                range={histRange}
                onRange={setHistRange}
                spxData={spxData}
                showSpx={showSpx}
                onToggleSpx={() => setShowSpx((v) => !v)}
                todayStr={todayStr}
              />
            )}

            <RatioBar
              title="Above 50-Day SMA"
              pct={maStats.s50.pct}
              leftLabel={`${maStats.s50.above.toLocaleString()} Above`}
              rightLabel={`${maStats.s50.below.toLocaleString()} Below`}
              accentColor={maStats.s50.pct >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
              expanded={openChart === "p50"}
              onClick={() => toggleChart("p50")}
            />
            {openChart === "p50" && (
              <MaBreadthHistoryChart
                A={A}
                title="Above 50-Day SMA"
                series={maSeries.p50}
                range={histRange}
                onRange={setHistRange}
                spxData={spxData}
                showSpx={showSpx}
                onToggleSpx={() => setShowSpx((v) => !v)}
                todayStr={todayStr}
                signalByDate={breadthSignals.byDate}
                signalTypes={MA50_SIG_TYPES}
              />
            )}

            <RatioBar
              title="Above 200-Day SMA"
              pct={maStats.s200.pct}
              leftLabel={`${maStats.s200.above.toLocaleString()} Above`}
              rightLabel={`${maStats.s200.below.toLocaleString()} Below`}
              accentColor={maStats.s200.pct >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
              expanded={openChart === "p200"}
              onClick={() => toggleChart("p200")}
            />
            {openChart === "p200" && (
              <MaBreadthHistoryChart
                A={A}
                title="Above 200-Day SMA"
                series={maSeries.p200}
                range={histRange}
                onRange={setHistRange}
                spxData={spxData}
                showSpx={showSpx}
                onToggleSpx={() => setShowSpx((v) => !v)}
                todayStr={todayStr}
              />
            )}

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

            {(maStats.t2108 != null || maStats.mcclellan != null || mcclellanSeries.length > 0) && (
              <div>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, fontSize: 11, fontFamily: "monospace", color: A.textMuted }}>
                  {maStats.t2108 != null && (
                    <span>T2108 <strong style={{ color: A.text }}>{maStats.t2108}%</strong></span>
                  )}
                  {(maStats.mcclellan != null || mcclellanSeries.length > 0) && (
                    <button
                      type="button"
                      onClick={() => toggleChart("mcclellan")}
                      title={openChart === "mcclellan" ? "Hide McClellan Oscillator chart" : "Click to view McClellan Oscillator history chart (1M / 3M / 6M / 1Y)"}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: openChart === "mcclellan" ? A.bgHover : "transparent",
                        border: `1px solid ${openChart === "mcclellan" ? COLORS.blue : A.border}`,
                        borderRadius: 6,
                        padding: "2px 8px",
                        fontSize: 11,
                        fontFamily: "monospace",
                        color: A.textMuted,
                        cursor: "pointer",
                      }}
                    >
                      <span>
                        McClellan Osc{" "}
                        <strong style={{ color: (maStats.mcclellan ?? 0) >= 0 ? COLORS.blue : COLORS.pink }}>
                          {maStats.mcclellan != null ? fmtSigned(maStats.mcclellan, 1) : "—"}
                        </strong>
                      </span>
                      <span style={{ fontSize: 10, color: A.textMuted }}>
                        {openChart === "mcclellan" ? "▾ hide" : "▸ chart"}
                      </span>
                    </button>
                  )}
                </div>
                {openChart === "mcclellan" && (
                  <McClellanHistoryChart
                    A={A}
                    series={mcclellanSeries}
                    range={histRange}
                    onRange={setHistRange}
                    spxData={spxData}
                    showSpx={showSpx}
                    onToggleSpx={() => setShowSpx((v) => !v)}
                    todayStr={todayStr}
                    signalByDate={breadthSignals.byDate}
                    signalTypes={MC_SIG_TYPES}
                  />
                )}
              </div>
            )}
          </>
        )}

        {/* Carousel dots matching the Deepvue widget */}
        {cardTab === "breadth" && (
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 12 }}>
            {[0, 1].map((i) => (
              <button
                key={i}
                type="button"
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
        )}

        {/* Market Gate (moved from retired Leaders tab) */}
        {cardTab === "breadth" && breadth?.conditions?.market_gate?.overall && (
          <div style={{ marginTop: 12 }}>
            <MarketGate A={A} gate={breadth.conditions.market_gate} liveQuotes={indexQuotes} />
          </div>
        )}
      </div>
    </div>
  );
}
