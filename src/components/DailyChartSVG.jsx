// ──────────────────────────────────────────────────────────────────────────
// DailyChartSVG — inline SVG candlestick chart with MAs, volume overlays,
// pocket pivots, VCP tightness, +4% breakout hatching, dry-up dots, and
// earnings markers.
// ──────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { authFetch } from "../utils.js";
import { useAriaTheme } from "../themeContext.js";
import { computeRvolAtTime, formatEtTime } from "../lead/pivot30mMath.js";

// Cached daily OHLC fetch (shared across chart selections).
const _ohlcCache = new Map();
export async function fetchOhlcBars(ticker) {
  if (_ohlcCache.has(ticker)) return _ohlcCache.get(ticker);
  try {
    const r = await authFetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}`);
    const d = r.ok ? await r.json() : null;
    const bars = (d?.ohlc || []).filter((x) => x.close != null);
    _ohlcCache.set(ticker, bars);
    return bars;
  } catch {
    _ohlcCache.set(ticker, []);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// RS Rotation Board — sector/industry relative-strength rank rotation
// ──────────────────────────────────────────────────────────────────────────
// Reads /data/rs_rotation.json (pipeline 10c_rs_rotation.py). Collapsible.
// SPY daily closes (date -> close), cached once — RS-line denominator (stock / SPY)
// for the IBD-style RS line on the ticker chart.
let _spyClosesCache = null, _spyClosesFetching = false; const _spyClosesListeners = [];
export function useSpyCloses() {
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

function fmtEtShortDate(dateStr) {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}`;
  return dateStr;
}

function fmtEtBarLabel(bar) {
  if (!bar) return "";
  if (bar.time != null) {
    const et = formatEtTime(bar.time);
    if (et && (et.date || et.hhmm)) {
      const md = fmtEtShortDate(et.date);
      return `${md}${md && et.hhmm ? " " : ""}${et.hhmm || ""} ET`.trim();
    }
  }
  return bar.date || "";
}

export function DailyChartSVG({
  ohlc,
  quarters,
  height = 400,
  stopLines = [],
  owned = false,
  rsRating = null,
  rsRatingColor = null,
  isIntraday = false,
  pivot30 = null,
  showCpr = false,
}) {
  const MAX_BARS = 375;
  const defaultBars = isIntraday ? Math.min(ohlc?.length || 65, 65) : 168;   // ~8 months daily or ~5d 30m
  const minVisible = isIntraday ? 15 : 30;

  // Visible window: endIdx is always the right edge (exclusive), visibleCount is how many bars to show
  const [visibleCount, setVisibleCount] = useState(defaultBars);
  const [endIdx, setEndIdx] = useState(null);
  const svgRef = React.useRef(null);
  const containerRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [containerW, setContainerW] = useState(900);
  const [containerH, setContainerH] = useState(380);
  const [volSubTab, setVolSubTab] = useState(() => (isIntraday ? "rvol" : "vol"));
  const [hoverI, setHoverI] = useState(null); // crosshair bar index (visible window)
  const CH_ARIA = useAriaTheme();
  const [showRS, setShowRS] = useState(() => { try { return localStorage.getItem("tp-chart-rs") !== "0"; } catch { return true; } });
  const benchMap = useSpyCloses();
  const rvolAtTime = useMemo(
    () => (isIntraday && ohlc?.length ? computeRvolAtTime(ohlc) : null),
    [isIntraday, ohlc]
  );

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

  // Reset view when ticker or timeframe changes (ohlc / isIntraday changes)
  useEffect(() => {
    setVisibleCount(isIntraday ? Math.min(ohlc?.length || 65, 65) : 168);
    setEndIdx(null);
  }, [ohlc, isIntraday]);

  // Default indicator sub-pane to RVol@T on 30m intraday charts, Vol on D/W
  useEffect(() => {
    setVolSubTab((prev) => {
      if (isIntraday) return prev === "rsi" ? "rsi" : "rvol";
      return prev === "rvol" ? "vol" : prev;
    });
  }, [isIntraday]);

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
      ema20: calcEMA(fullC, 20),
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
    const rawMax = Math.max(...bars.map(b => b.high));
    const rawMin = Math.min(...bars.map(b => b.low));
    let pMax = rawMax;
    let pMin = rawMin;

    // In 30m intraday mode, include pivot / OR / CPR levels in y-axis scale
    // ONLY when reasonably close to visible candle highs/lows (within 12%) so
    // a distant R2/S2 or stale level never squashes the candles.
    if (isIntraday) {
      const candidates = [];
      const pv = pivot30?.pivot;
      if (pv && (pv.state === "TRIGGERED" || pv.state === "ARMED" || pv.state === "PULLBACK")) {
        if (pv.entry != null) candidates.push(pv.entry);
        if (pv.stop != null) candidates.push(pv.stop);
        if (pv.target2R != null) candidates.push(pv.target2R);
      }
      if (pivot30?.openingRange) {
        if (pivot30.openingRange.orh != null) candidates.push(pivot30.openingRange.orh);
        if (pivot30.openingRange.orl != null) candidates.push(pivot30.openingRange.orl);
      }
      if (showCpr && pivot30?.floorPivots) {
        const fp = pivot30.floorPivots;
        if (fp.p != null) candidates.push(fp.p);
        if (fp.bc != null) candidates.push(fp.bc);
        if (fp.tc != null) candidates.push(fp.tc);
        if (fp.r1 != null) candidates.push(fp.r1);
        if (fp.s1 != null) candidates.push(fp.s1);
      }
      for (const v of candidates) {
        if (Number.isFinite(v) && v > 0 && v <= rawMax * 1.12 && v >= rawMin * 0.88) {
          if (v > pMax) pMax = v;
          if (v < pMin) pMin = v;
        }
      }
      const padY = (pMax - pMin || rawMax * 0.01) * 0.04;
      pMax += padY;
      pMin = Math.max(0.01, pMin - padY);
    }

    const pRange = pMax - pMin || 1;
    const vMax = Math.max(...bars.map(b => b.volume)) || 1;
    const py = (v) => pad.t + (1 - (v - pMin) / pRange) * priceH;
    const volTop = pad.t + priceH + volGap;

    // Sell-discipline violation marker (held names only, daily/weekly only): the most recent bar
    // where price closed below a key MA while still above the 200-day — a leader
    // cracking support. Drawn as a 🔻 above that candle if it's in view.
    let violMarker = null;
    if (!isIntraday && owned && total > 50) {
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
    const ema10Src = isIntraday && Array.isArray(pivot30?.ema10) && pivot30.ema10.length === total ? pivot30.ema10 : precomputed.ema10;
    const ema20Src = isIntraday && Array.isArray(pivot30?.ema20) && pivot30.ema20.length === total ? pivot30.ema20 : precomputed.ema20;
    const ema10 = sliceMA(ema10Src);
    const ema20 = sliceMA(ema20Src);
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
      const src = isIntraday ? volMA20 : volMA;
      const pts = [];
      src.forEach((v, i) => { if (v != null) pts.push(`${pad.l + i * (bw + gap) + bw / 2},${volTop + (1 - v / vMax) * volH}`); });
      return pts.length >= 2 ? pts.join(" ") : null;
    };

    const candleElements = [];
    const volElements = [];
    const chLight = CH_ARIA.bg === "#f8f9fc";
    const pvActive = isIntraday ? pivot30?.pivot : null;
    const entryGlobalIdx =
      pvActive?.state === "TRIGGERED" && pvActive.triggerBarIdx != null
        ? pvActive.triggerBarIdx
        : pvActive?.state === "ARMED" && pvActive.pivotBarIdx != null
          ? pvActive.pivotBarIdx
          : null;
    const pivotGlobalIdx = pvActive?.pivotBarIdx ?? null;
    const entryHiColor = pvActive?.state === "TRIGGERED" ? "#22c55e" : "#f59e0b";
    bars.forEach((b, i) => {
      const gi = start + i;
      const x = pad.l + i * (bw + gap);
      const isUp = b.close >= b.open;
      const candleColor = isUp ? "#2bb886" : "#f87171";
      const isEntryBar = isIntraday && entryGlobalIdx != null && gi === entryGlobalIdx;
      const isSetupPivotBar =
        isIntraday &&
        pvActive?.state === "TRIGGERED" &&
        pivotGlobalIdx != null &&
        gi === pivotGlobalIdx &&
        !isEntryBar;
      const bodyTop = py(Math.max(b.open, b.close));
      const bodyBot = py(Math.min(b.open, b.close));
      const bodyH = Math.max(isEntryBar ? 2 : 1, bodyBot - bodyTop);
      const wickX = x + bw / 2;
      candleElements.push(
        <line key={`w${i}`} x1={wickX} y1={py(b.high)} x2={wickX} y2={py(b.low)}
          stroke={isEntryBar ? entryHiColor : candleColor}
          strokeWidth={isEntryBar ? 1.5 : 0.9}
          opacity={isEntryBar ? 1 : 0.9} />,
        <rect key={`b${i}`} x={x} y={bodyTop} width={bw} height={bodyH}
          fill={candleColor} rx={Math.min(1, bw / 4)}
          stroke={isEntryBar ? entryHiColor : isSetupPivotBar ? "#f59e0b" : "rgba(0,0,0,0.35)"}
          strokeWidth={isEntryBar ? 1.6 : isSetupPivotBar ? 1.1 : 0.4}
          filter={isEntryBar ? "url(#tpGlow)" : undefined} />
      );
      const vol = b.volume || 0;
      const vh = Math.max(0.5, (vol / vMax) * volH);
      const vy = volTop + volH - vh;
      if (isIntraday) {
        const vColor = isUp ? "#2bb886cc" : (chLight ? "#94a3b8cc" : "#f8717199");
        volElements.push(
          <rect key={`v${i}`} x={x} y={vy} width={bw} height={vh}
            fill={isEntryBar ? entryHiColor : vColor}
            stroke={isEntryBar ? entryHiColor : undefined}
            strokeWidth={isEntryBar ? 1.1 : 0}
            opacity={isEntryBar ? 0.95 : 0.72} rx={0.4} />
        );
      } else {
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
      }
    });

    const erMarkers = [];
    if (!isIntraday && quarters && quarters.length) {
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

    // X-axis labels at the top: ET session dividers for 30m intraday, month labels for D/W
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const xAxisElements = [];
    if (isIntraday) {
      let prevSession = null;
      let lastLabelX = -Infinity;
      bars.forEach((b, i) => {
        const et = b.time != null ? formatEtTime(b.time) : null;
        if (!et || !et.date) return;
        const x = pad.l + i * (bw + gap) + bw / 2;
        if (et.date !== prevSession) {
          const isFirstVisible = prevSession === null;
          prevSession = et.date;
          if (!isFirstVisible) {
            const divX = x - (bw + gap) / 2;
            xAxisElements.push(
              <line key={`sdiv_${et.date}_${i}`} x1={divX} y1={pad.t} x2={divX} y2={pad.t + priceH}
                stroke={CH_ARIA.borderLight || CH_ARIA.border} strokeWidth={0.8} strokeDasharray="3,3" opacity={0.75} />
            );
          }
          if (x < chartRight - 24 && x - lastLabelX >= 36) {
            lastLabelX = x;
            xAxisElements.push(
              <text key={`slbl_${et.date}_${i}`} x={Math.max(pad.l + 2, x)} y={pad.t - 4} fontSize={8} fontWeight={600}
                fill={CH_ARIA.textDim || "#8a8a9a"} fontFamily="ui-monospace,monospace" textAnchor="start">
                {fmtEtShortDate(et.date)}
              </text>
            );
          }
        } else if (et.hhmm === "10:00" || et.hhmm === "13:00") {
          if (x > pad.l + 18 && x < chartRight - 28 && x - lastLabelX >= 52) {
            lastLabelX = x;
            xAxisElements.push(
              <text key={`tlbl_${et.date}_${et.hhmm}_${i}`} x={x} y={pad.t - 4} fontSize={7.5}
                fill={CH_ARIA.textMuted || "#6a6a7a"} fontFamily="ui-monospace,monospace" textAnchor="start" opacity={0.8}>
                {et.hhmm}
              </text>
            );
          }
        }
      });
    } else {
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
    }

    // ── 30m Intraday Overlays: CPR (behind candles), Entry Bar Band, Opening Range, Pivot marker & lines ──
    const cprElements = [];
    const pivotBgElements = [];
    const orElements = [];
    const pivotElements = [];
    if (isIntraday && pivot30) {
      // 1) Floor Pivot / CPR (only when toggled on)
      if (showCpr && pivot30.floorPivots) {
        const fp = pivot30.floorPivots;
        if (fp.bc != null && fp.tc != null) {
          const hiBand = Math.max(fp.bc, fp.tc);
          const loBand = Math.min(fp.bc, fp.tc);
          if (hiBand >= pMin && loBand <= pMax) {
            const yTop = Math.max(pad.t, py(hiBand));
            const yBot = Math.min(pad.t + priceH, py(loBand));
            const hBand = Math.max(1.5, yBot - yTop);
            cprElements.push(
              <rect key="cpr_band" x={pad.l} y={yTop} width={chartRight - pad.l} height={hBand}
                fill="#818cf8" opacity={chLight ? 0.14 : 0.13} />
            );
            if (fp.tc >= pMin && fp.tc <= pMax) {
              cprElements.push(<line key="cpr_tc" x1={pad.l} y1={py(fp.tc)} x2={chartRight} y2={py(fp.tc)} stroke="#818cf8" strokeWidth={0.6} strokeDasharray="2,3" opacity={0.45} />);
            }
            if (fp.bc >= pMin && fp.bc <= pMax) {
              cprElements.push(<line key="cpr_bc" x1={pad.l} y1={py(fp.bc)} x2={chartRight} y2={py(fp.bc)} stroke="#818cf8" strokeWidth={0.6} strokeDasharray="2,3" opacity={0.45} />);
            }
          }
        }
        const fpLines = [
          { key: "r1", val: fp.r1, label: "R1", color: "#34d399" },
          { key: "p",  val: fp.p,  label: "P",  color: "#a78bfa" },
          { key: "s1", val: fp.s1, label: "S1", color: "#fb7185" },
        ];
        fpLines.forEach(({ key, val, label, color }) => {
          if (val == null || val < pMin || val > pMax) return;
          const ly = py(val);
          cprElements.push(
            <g key={`fp_${key}`}>
              <line x1={pad.l} y1={ly} x2={chartRight} y2={ly} stroke={color} strokeWidth={0.85} strokeDasharray="2,3" opacity={0.68} />
              <text x={pad.l + 4} y={Math.max(pad.t + 8, ly - 2)} fontSize={7} fontWeight={700}
                fontFamily="ui-monospace,monospace" fill={color} opacity={0.9}>
                {label} ${fmtPrice(val)}
              </text>
            </g>
          );
        });
      }

      // 2) Opening Range (ORH / ORL)
      if (pivot30.openingRange) {
        const orng = pivot30.openingRange;
        const visOrIdx = orng.barIdx != null ? orng.barIdx - start : 0;
        if (visOrIdx < bars.length) {
          const x0 = visOrIdx > 0 ? pad.l + visOrIdx * (bw + gap) : pad.l;
          const anchorEnd = chartRight - x0 < 62;
          const lblX = anchorEnd ? chartRight - 3 : x0 + 3;
          const anchor = anchorEnd ? "end" : "start";
          [
            { key: "orh", val: orng.orh, tag: "ORH", above: true },
            { key: "orl", val: orng.orl, tag: "ORL", above: false },
          ].forEach(({ key, val, tag, above }) => {
            if (val == null || val < pMin || val > pMax) return;
            const ly = py(val);
            const txtY = above ? Math.max(pad.t + 8, ly - 3) : Math.min(pad.t + priceH - 2, ly + 8);
            orElements.push(
              <g key={`or_${key}`}>
                <line x1={x0} y1={ly} x2={chartRight} y2={ly} stroke="#22d3ee" strokeWidth={0.95} strokeDasharray="4,3" opacity={0.7} />
                <text x={lblX} y={txtY} textAnchor={anchor} fontSize={7.5} fontWeight={700}
                  fontFamily="ui-monospace,monospace" fill="#22d3ee" opacity={0.9}>
                  {tag} ${fmtPrice(val)}
                </text>
              </g>
            );
          });
        }
      }

      // 3) Entry bar highlight + Pivot candle marker + Entry / Stop / +2R lines with right-edge tags
      const pv = pivot30.pivot;
      if (pv) {
        // Highlight the Entry bar (trigger bar when TRIGGERED; reversal pivot bar when ARMED)
        if (entryGlobalIdx != null) {
          const visEntryIdx = entryGlobalIdx - start;
          if (visEntryIdx >= 0 && visEntryIdx < bars.length) {
            const eb = bars[visEntryIdx];
            const bx0 = pad.l + visEntryIdx * (bw + gap) - Math.max(1.5, gap / 2);
            const bandW = bw + Math.max(3, gap);
            const cx = pad.l + visEntryIdx * (bw + gap) + bw / 2;
            const isTrig = pv.state === "TRIGGERED";
            const hiColor = isTrig ? "#22c55e" : "#f59e0b";
            const badgeText = isTrig ? "ENTRY" : "PIVOT";
            const badgeW = badgeText.length * 4.8 + 8;
            const barTopY = py(eb.high);
            const barBotY = py(eb.low);
            const placeAbove = barTopY - pad.t >= 24;
            const badgeX = Math.max(pad.l + 1, Math.min(chartRight - badgeW - 2, cx - badgeW / 2));
            const badgeY = placeAbove
              ? Math.max(pad.t + 2, barTopY - 21)
              : Math.min(pad.t + priceH - 15, barBotY + 9);
            const arrowPts = placeAbove
              ? `${cx},${barTopY - 3} ${cx - 4},${barTopY - 8.5} ${cx + 4},${barTopY - 8.5}`
              : `${cx},${barBotY + 3} ${cx - 4},${barBotY + 8.5} ${cx + 4},${barBotY + 8.5}`;
            const tipTitle = `${isTrig ? "30m Entry bar" : "30m Pivot setup bar"} (${fmtEtBarLabel(eb)})${pv.entry != null ? ` · Entry $${fmtPrice(pv.entry)}` : ""}${pv.stop != null ? ` · Stop $${fmtPrice(pv.stop)}` : ""}${pv.target2R != null ? ` · +2R $${fmtPrice(pv.target2R)}` : ""}`;

            // Vertical translucent highlight column behind candle & volume bar
            pivotBgElements.push(
              <g key="pv_entry_band">
                <rect x={bx0} y={pad.t} width={bandW} height={volTop + volH - pad.t}
                  fill={hiColor} fillOpacity={chLight ? 0.14 : 0.16} rx={2} />
                <line x1={bx0} y1={pad.t} x2={bx0} y2={volTop + volH}
                  stroke={hiColor} strokeWidth={0.75} strokeDasharray="2,2" opacity={0.55} />
                <line x1={bx0 + bandW} y1={pad.t} x2={bx0 + bandW} y2={volTop + volH}
                  stroke={hiColor} strokeWidth={0.75} strokeDasharray="2,2" opacity={0.55} />
              </g>
            );

            // Foreground ENTRY / PIVOT badge + pointer arrow + trigger price dot
            pivotElements.push(
              <g key="pv_entry_callout">
                <title>{tipTitle}</title>
                <polygon points={arrowPts} fill={hiColor} stroke={CH_ARIA.bg} strokeWidth={0.7} />
                <rect x={badgeX} y={badgeY} width={badgeW} height={12.5} rx={3}
                  fill={hiColor} stroke={CH_ARIA.bg} strokeWidth={0.8} />
                <text x={badgeX + badgeW / 2} y={badgeY + 9} textAnchor="middle"
                  fontSize={7.2} fontWeight={800} fontFamily="ui-monospace,monospace" fill="#06120c">
                  {badgeText}
                </text>
                {pv.entry != null && pv.entry >= pMin && pv.entry <= pMax && (
                  <circle cx={cx} cy={py(pv.entry)} r={3.2}
                    fill={hiColor} stroke={CH_ARIA.bg} strokeWidth={1.1} filter="url(#tpGlow)" />
                )}
              </g>
            );
          }
        }

        // Secondary compact triangle on the setup pivot candle (when TRIGGERED on a later bar, or STOPPED)
        if (pv.pivotBarIdx != null && pv.pivotBarIdx !== entryGlobalIdx) {
          const visIdx = pv.pivotBarIdx - start;
          if (visIdx >= 0 && visIdx < bars.length) {
            const cx = pad.l + visIdx * (bw + gap) + bw / 2;
            const tipY = Math.min(pad.t + priceH - 9, py(bars[visIdx].low) + 4);
            const triColor = pv.state === "STOPPED" ? "#f87171" : "#f59e0b";
            pivotElements.push(
              <polygon key="pv_tri"
                points={`${cx},${tipY} ${cx - 4},${tipY + 7} ${cx + 4},${tipY + 7}`}
                fill={triColor} stroke={CH_ARIA.bg} strokeWidth={0.8}>
                <title>{`30m Pivot candle (${fmtEtBarLabel(bars[visIdx])})${pv.entry != null ? ` · Trigger $${fmtPrice(pv.entry)}` : ""}${pv.stop != null ? ` · Stop $${fmtPrice(pv.stop)}` : ""}`}</title>
              </polygon>
            );
          }
        }

        if (pv.state === "TRIGGERED" || pv.state === "ARMED" || pv.state === "PULLBACK") {
          const anchorIdx = pv.pivotBarIdx != null ? pv.pivotBarIdx - start : (entryGlobalIdx != null ? entryGlobalIdx - start : 0);
          const lineStartX = anchorIdx > 0 && anchorIdx < bars.length
            ? pad.l + anchorIdx * (bw + gap)
            : pad.l;
          const rawLines = [];
          if (pv.entry != null && pv.entry >= pMin && pv.entry <= pMax) {
            rawLines.push({
              key: "ent",
              price: pv.entry,
              y: py(pv.entry),
              tag: `ENT $${fmtPrice(pv.entry)}`,
              color: pv.state === "TRIGGERED" ? "#22c55e" : "#f59e0b",
              dash: "5,3",
              width: 1.3,
            });
          }
          if (pv.stop != null && pv.stop >= pMin && pv.stop <= pMax) {
            rawLines.push({
              key: "stp",
              price: pv.stop,
              y: py(pv.stop),
              tag: `STP $${fmtPrice(pv.stop)}`,
              color: "#f87171",
              dash: "5,3",
              width: 1.2,
            });
          }
          if (pv.target2R != null && pv.target2R >= pMin && pv.target2R <= pMax) {
            rawLines.push({
              key: "t2r",
              price: pv.target2R,
              y: py(pv.target2R),
              tag: `2R $${fmtPrice(pv.target2R)}`,
              color: "#34d399",
              dash: "2,3",
              width: 1.1,
            });
          }
          // Avoid overlapping right-edge tag pills while keeping lines at exact prices
          rawLines.sort((a, b) => a.y - b.y);
          let lastTagY = -Infinity;
          rawLines.forEach((ln) => {
            const minY = pad.t + 7;
            const maxY = pad.t + priceH - 7;
            let ty = Math.max(minY, Math.min(maxY, ln.y));
            if (ty - lastTagY < 14) ty = Math.min(maxY, lastTagY + 14);
            lastTagY = ty;
            const tagW = ln.tag.length * 4.9 + 8;
            pivotElements.push(
              <g key={`pv_${ln.key}`}>
                <line x1={lineStartX} y1={ln.y} x2={chartRight} y2={ln.y}
                  stroke={ln.color} strokeWidth={ln.width} strokeDasharray={ln.dash} opacity={0.9} />
                <rect x={chartRight - tagW - 2} y={ty - 6.5} width={tagW} height={13} rx={2.5}
                  fill={CH_ARIA.bg} fillOpacity={0.94} stroke={ln.color} strokeWidth={0.85} />
                <text x={chartRight - tagW / 2 - 2} y={ty + 2.7} textAnchor="middle"
                  fontSize={7.5} fontWeight={800} fontFamily="ui-monospace,monospace" fill={ln.color}>
                  {ln.tag}
                </text>
              </g>
            );
          });
        }
      }
    }

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

    // ── RVol at Time of Day (RVol@T) log2 sub-pane for 30m intraday charts ──
    const rvolSlice = isIntraday && rvolAtTime?.bars?.length ? rvolAtTime.bars.slice(start, end) : null;
    let rvolPane = null;
    if (rvolSlice && rvolSlice.length) {
      let logMin = -1.25;
      let logMax = 2.25;
      for (const rv of rvolSlice) {
        if (rv?.logBar != null) {
          if (rv.logBar > logMax) logMax = Math.min(3.6, rv.logBar + 0.25);
          if (rv.logBar < logMin) logMin = Math.max(-3.1, rv.logBar - 0.15);
        }
        if (rv?.logCum != null) {
          if (rv.logCum > logMax) logMax = Math.min(3.6, rv.logCum + 0.25);
          if (rv.logCum < logMin) logMin = Math.max(-3.1, rv.logCum - 0.15);
        }
      }
      const logSpan = Math.max(0.5, logMax - logMin);
      const rvolY = (lv) => {
        const clamped = Math.max(logMin, Math.min(logMax, lv));
        return volTop + (1 - (clamped - logMin) / logSpan) * volH;
      };
      const y1x = rvolY(0);
      const rvolBarElements = [];
      let rvolCumPathD = "";
      let prevCumNull = true;
      let lastCumX = null, lastCumY = null, lastCumVal = null;

      rvolSlice.forEach((rv, i) => {
        if (!rv || !rv.inScope) { prevCumNull = true; return; }
        const x = pad.l + i * (bw + gap);
        const cx = x + bw / 2;
        if (rv.logBar != null && rv.rvolBar != null) {
          const yVal = rvolY(rv.logBar);
          const yTop = Math.min(y1x, yVal);
          const hBar = Math.max(1, Math.abs(yVal - y1x));
          const colColor = rv.isUp ? "#22c55e" : "#f87171";
          const colOp = rv.rvolBar >= 2.0 ? 0.96 : rv.rvolBar >= 1.0 ? 0.65 : 0.28;
          rvolBarElements.push(
            <rect key={`rvb_${i}`} x={x} y={yTop} width={bw} height={hBar}
              fill={colColor} opacity={colOp} rx={0.4} />
          );
        }
        if (rv.logCum != null && rv.rvolCum != null) {
          const cy = rvolY(rv.logCum);
          const cmd = prevCumNull || rv.newDay ? "M" : "L";
          rvolCumPathD += `${cmd}${cx.toFixed(1)},${cy.toFixed(1)} `;
          prevCumNull = false;
          lastCumX = cx;
          lastCumY = cy;
          lastCumVal = rv.rvolCum;
        } else {
          prevCumNull = true;
        }
      });

      const refLevels = [
        { mult: 0.5, lv: -1, label: "0.5x", color: "#64748b", dash: "2,3", opacity: 0.35 },
        { mult: 1.0, lv: 0, label: "1x", color: "#94a3b8", dash: "3,2", opacity: 0.65 },
        { mult: 2.0, lv: 1, label: "2x", color: "#22c55e", dash: "2,3", opacity: 0.5 },
        { mult: 4.0, lv: 2, label: "4x", color: "#64748b", dash: "2,3", opacity: 0.35 },
      ].filter((r) => r.lv >= logMin + 0.05 && r.lv <= logMax - 0.05)
        .map((r) => ({ ...r, y: rvolY(r.lv) }));

      rvolPane = {
        rvolBarElements,
        rvolCumPathD,
        lastCumX,
        lastCumY,
        lastCumVal,
        refLevels,
      };
    }

    // ── Mansfield RS oscillator: (stock/SPY) ÷ its own 21-day MA − 1, drawn
    // zero-centered in a bottom band of the price panel. Disabled in intraday mode.
    let rsLinePts = "", rsDots = [], rsCross = [], rsLabelY = null, rsEnd = null, rsBandTop = null, rsBandBot = null, divTint = [], rsPosD = null, rsNegD = null, rsZeroY = null;
    if (!isIntraday && benchMap && benchMap.size) {
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
      cprElements, pivotBgElements, orElements, pivotElements,
      maEma21hi: isIntraday ? null : maPoints(ema21hi),
      maEma21lo: isIntraday ? null : maPoints(ema21lo),
      maEma21close: isIntraday ? null : maPoints(ema21close),
      maEma10: maPoints(ema10),
      maEma20: isIntraday ? maPoints(ema20) : null,
      maSma50: isIntraday ? null : maPoints(sma50),
      maEma200: isIntraday ? null : maPoints(ema200),
      volMaPts: volMaPoints(),
      startDate: isIntraday ? fmtEtBarLabel(bars[0]) : bars[0]?.date,
      endDate: isIntraday ? fmtEtBarLabel(bars[bars.length - 1]) : bars[bars.length - 1]?.date,
      pMin, pMax, pRange, padT: pad.t, padL: pad.l, priceH, violMarker,
      volTop, volH, y60, y40, rsiPathD, lastRsiX, lastRsiY, lastRsi,
      rsiOverboughtPathD, rsiOversoldPathD, rvolPane, rvolSlice,
    };
  }, [ohlc, precomputed, quarters, visibleCount, endIdx, containerW, containerH, benchMap, owned, CH_ARIA, isIntraday, pivot30, showCpr, rvolAtTime]);

  // Wheel zoom — LightweightCharts style: right edge stays pinned,
  // ~3 bars per wheel tick (deltaY normalized to ±1 for trackpad smoothness)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    if (!ohlc || !ohlc.length) return;
    // Normalize: mouse wheel gives ±100–120, trackpad gives small floats
    const ticks = Math.sign(e.deltaY) * Math.max(1, Math.min(5, Math.abs(e.deltaY) / 30));
    const delta = Math.round(ticks * 3);
    const maxVis = isIntraday ? Math.max(65, ohlc.length) : MAX_BARS;
    setVisibleCount((prev) => Math.max(minVisible, Math.min(maxVis, prev + delta)));
  }, [ohlc, minVisible, isIntraday]);

  // Drag to pan — LightweightCharts style: drag right = see older data
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const total = ohlc?.length || 0;
    dragRef.current = { startX: e.clientX, startEndIdx: endIdx != null ? endIdx : total, accumulated: 0 };
    const onMove = (ev) => {
      if (!dragRef.current || !svgRef.current || !ohlc) return;
      const rect = svgRef.current.getBoundingClientRect();
      const t = ohlc.length;
      const vis = Math.max(1, Math.min(visibleCount, t));
      const pxPerBar = rect.width / vis;
      const dx = ev.clientX - dragRef.current.startX;
      const barShift = Math.round(dx / pxPerBar);
      const newEnd = Math.max(vis, Math.min(t, dragRef.current.startEndIdx - barShift));
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
    setVisibleCount(defaultBars);
    setEndIdx(null);
  }, [defaultBars]);

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
        {chartData.cprElements}
        {chartData.pivotBgElements}
        <line x1={0} y1={chartData.sepY} x2={chartData.chartRight} y2={chartData.sepY} stroke={CH_ARIA.borderLight} strokeWidth={0.5} />
        <line x1={chartData.chartRight} y1={0} x2={chartData.chartRight} y2={chartData.totalH} stroke={CH_ARIA.borderLight} strokeWidth={0.5} />
        {isIntraday ? (
          <>
            {chartData.maEma10 && <polyline points={chartData.maEma10} fill="none" stroke="#38bdf8" strokeWidth={1.25} />}
            {chartData.maEma20 && <polyline points={chartData.maEma20} fill="none" stroke="#fbbf24" strokeWidth={1.25} />}
          </>
        ) : (
          <>
            {chartData.maEma21hi && <polyline points={chartData.maEma21hi} fill="none" stroke="#80808060" strokeWidth={1} />}
            {chartData.maEma21lo && <polyline points={chartData.maEma21lo} fill="none" stroke="#80808060" strokeWidth={1} />}
            {chartData.maEma21close && <polyline points={chartData.maEma21close} fill="none" stroke="#808080" strokeWidth={1.5} />}
            {chartData.maEma10 && <polyline points={chartData.maEma10} fill="none" stroke="#ff828c" strokeWidth={1} />}
            {chartData.maSma50 && <polyline points={chartData.maSma50} fill="none" stroke="#2dd4bf" strokeWidth={1} strokeDasharray="4,2" />}
            {chartData.maEma200 && <polyline points={chartData.maEma200} fill="none" stroke="#8232c8" strokeWidth={1} />}
          </>
        )}
        {chartData.candleElements}
        {chartData.orElements}
        {chartData.pivotElements}
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
          const tsLabel = isIntraday ? fmtEtBarLabel(b) : (b.date || "");
          const rvPt = isIntraday ? chartData.rvolSlice?.[hoverI] : null;
          const rvTxt = rvPt && rvPt.rvolBar != null
            ? `  RVol ${rvPt.rvolBar.toFixed(1)}x${rvPt.rvolCum != null ? ` Cum ${rvPt.rvolCum.toFixed(1)}x` : ""}`
            : "";
          const txt = `${tsLabel}   O ${fmtP(b.open)}  H ${fmtP(b.high)}  L ${fmtP(b.low)}  C ${fmtP(b.close)}${chg != null ? `  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : ""}  V ${fmtV(b.volume)}${rvTxt}`;
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
                {tsLabel}   O {fmtP(b.open)}  H {fmtP(b.high)}  L {fmtP(b.low)}  C <tspan fill={up ? "#2bb886" : "#f87171"} fontWeight="700">{fmtP(b.close)}</tspan>{chg != null ? <tspan fill={up ? "#2bb886" : "#f87171"}>{`  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`}</tspan> : null}  V {fmtV(b.volume)}{rvPt && rvPt.rvolBar != null ? <tspan fill={rvPt.rvolBar >= 2 ? "#22c55e" : "#fb923c"} fontWeight="700">{rvTxt}</tspan> : null}
              </text>
            </g>
          );
        })()}
        {chartData.violMarker && (
          <text x={chartData.violMarker.x} y={chartData.violMarker.y} textAnchor="middle" fontSize={11} style={{ cursor: "default" }}>
            <title>{`Sell-discipline violation — closed below the ${chartData.violMarker.label} (leader cracking support). Ryan's trailing-stop trigger.`}</title>🔻
          </text>
        )}
        {!isIntraday && showRS && chartData.rsLinePts && (
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
        {!isIntraday && (
          <text x={chartData.padL + 3} y={10} fontSize={8} fontFamily="ui-monospace,monospace" fontWeight={700}
            fill={showRS ? "#3b82f6" : "#4a4a5a"} style={{ cursor: "pointer" }}
            onClick={() => setShowRS((v) => { const n = !v; try { localStorage.setItem("tp-chart-rs", n ? "1" : "0"); } catch {} return n; })}>
            <title>Toggle the IBD-style RS line (stock ÷ SPY)</title>RS
          </text>
        )}
        {volSubTab === "rvol" && isIntraday && chartData.rvolPane && (() => {
          const { padL, chartRight } = chartData;
          const { rvolBarElements, rvolCumPathD, lastCumX, lastCumY, lastCumVal, refLevels } = chartData.rvolPane;
          return (
            <>
              {refLevels.map((rf) => (
                <g key={`rvref_${rf.label}`}>
                  <line x1={padL} y1={rf.y} x2={chartRight} y2={rf.y}
                    stroke={rf.color} strokeWidth={rf.mult === 1 ? 0.75 : 0.55}
                    strokeDasharray={rf.dash} opacity={rf.opacity} />
                  <text x={chartRight + 4} y={rf.y + 2.5} fontSize={7}
                    fill={rf.color} fontFamily="ui-monospace,monospace" opacity={0.85}>
                    {rf.label}
                  </text>
                </g>
              ))}
              {rvolBarElements}
              {rvolCumPathD && (
                <path d={rvolCumPathD} fill="none" stroke="#fb923c" strokeWidth={1.6} opacity={0.95} />
              )}
              {lastCumX != null && lastCumY != null && (
                <>
                  <circle cx={lastCumX} cy={lastCumY} r={2.3} fill="#fb923c" stroke={CH_ARIA.bg} strokeWidth={0.7} />
                  {lastCumVal != null && (
                    <text x={chartRight + 4} y={lastCumY + 2.5} fontSize={7.2} fontWeight={800}
                      fill="#fb923c" fontFamily="ui-monospace,monospace">
                      {lastCumVal.toFixed(1)}x
                    </text>
                  )}
                </>
              )}
            </>
          );
        })()}
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
        {/* Indicator pane tab toggles (RVol@T on 30m + Vol + RSI) */}
        {isIntraday && (
          <text x={4} y={chartData.sepY + 11} fontSize={8} fontFamily="ui-monospace,monospace" fontWeight={700}
            fill={volSubTab === "rvol" ? "#fb923c" : "#4a4a5a"}
            style={{ cursor: "pointer", userSelect: "none" }}
            onMouseDown={(e) => { e.stopPropagation(); setVolSubTab("rvol"); }}>
            <title>RVol at Time of Day (log2 scale centered on 1×): per-bar columns + orange cumulative RVol line vs prior 20 sessions</title>
            RVol@T
          </text>
        )}
        <text x={isIntraday ? 44 : 4} y={chartData.sepY + 11} fontSize={8} fontFamily="ui-monospace,monospace" fontWeight={700}
          fill={volSubTab === "vol" ? "#0d9163" : "#4a4a5a"}
          style={{ cursor: "pointer", userSelect: "none" }}
          onMouseDown={(e) => { e.stopPropagation(); setVolSubTab("vol"); }}>Vol</text>
        <text x={isIntraday ? 66 : 26} y={chartData.sepY + 11} fontSize={8} fontFamily="ui-monospace,monospace" fontWeight={700}
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
        {isIntraday ? (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#38bdf8", fontWeight: 700 }}>10E</span>
              <span style={{ color: "#5a5a6a" }}>·</span>
              <span style={{ color: "#fbbf24", fontWeight: 700 }}>20E</span>
              <span style={{ color: "#5a5a6a" }}>·</span>
              <span style={{ color: "#fbbf24", opacity: 0.7 }}>Vol20</span>
            </span>
            {chartData.barCount < chartData.totalBars && (
              <span style={{ color: "#5a5a6a" }} title="Double-click to reset view">
                {chartData.startDate} → {chartData.endDate} · {chartData.barCount} bars
              </span>
            )}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
              <span style={{ color: "#22d3ee" }}>--- ORH/ORL</span>
              <span style={{ color: "#f59e0b" }}>--- ENT</span>
              <span style={{ color: "#f87171" }}>--- STP</span>
              <span style={{ color: "#34d399" }}>··· 2R</span>
              {showCpr && <span style={{ color: "#a78bfa" }}>▓ CPR</span>}
            </span>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
      {isIntraday && volSubTab === "rvol" && rvolAtTime?.summary && (() => {
        const s = rvolAtTime.summary;
        const pctCol = s.cumPctile == null ? "#94a3b8" : s.cumPctile >= 90 ? "#22c55e" : s.cumPctile >= 70 ? "#4ade80" : s.cumPctile <= 20 ? "#f87171" : "#cbd5e1";
        const barPctCol = s.barsAbovePct != null && s.barsAbovePct >= 60 ? "#22c55e" : "#cbd5e1";
        const upCol = s.upVolPct == null ? "#94a3b8" : s.upVolPct >= 60 ? "#22c55e" : s.upVolPct <= 40 ? "#f87171" : "#cbd5e1";
        const udTxt = s.upVolPct == null
          ? "—"
          : s.upDnRatio === Infinity
            ? `all up (100%)`
            : `${s.upDnRatio.toFixed(1)} (${s.upVolPct}%)`;
        return (
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            padding: "2px 8px 5px",
            fontSize: 9,
            fontFamily: "ui-monospace,monospace",
            color: "#8a8a9a",
            borderTop: `1px solid ${CH_ARIA.border}`,
          }}>
            <span style={{ color: "#fb923c", fontWeight: 800 }}>RVol@T</span>
            <span title="Cumulative volume so far today ÷ average cumulative volume by this time of day">
              Cum <strong style={{ color: "#fb923c" }}>{s.cumRvol != null ? `${s.cumRvol.toFixed(2)}×` : "—"}</strong>
            </span>
            <span title="Latest 30m bar volume ÷ average volume for this 30m time slot">
              Bar <strong style={{ color: CH_ARIA.text }}>{s.barRvol != null ? `${s.barRvol.toFixed(2)}×` : "—"}</strong>
            </span>
            <span title="Session persistence: number of 30m bars today trading ≥ 1.0× normal volume for their time slot">
              Bars ≥1× <strong style={{ color: barPctCol }}>{s.barsAbove}/{s.barsToday}{s.barsAbovePct != null ? ` (${s.barsAbovePct}%)` : ""}</strong>
            </span>
            <span title="Percentile rank of today's cumulative volume by this time vs prior sessions">
              %ile <strong style={{ color: pctCol }}>{s.cumPctileLabel}</strong>
            </span>
            <span title="Up/down volume ratio on today's above-normal (≥1×) 30m bars (share of volume on up bars in parentheses)">
              Up/Dn <strong style={{ color: upCol }}>{udTxt}</strong>
            </span>
            <span title={`Completed prior sessions averaged (target ${s.lookback})`} style={{ marginLeft: "auto" }}>
              Days <strong style={{ color: s.isShort ? "#fbbf24" : "#94a3b8" }}>{s.daysAvg}{s.isShort ? " (short)" : ""}</strong>
            </span>
          </div>
        );
      })()}
      {!isIntraday && showRS && (
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
