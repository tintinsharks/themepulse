// ════════════════════════════════════════════════════════════════════════════
// LWChart + IntradayChart — verbatim extract from src/App.jsx.legacy.bak
// (originally lines 6493-8056)
// ════════════════════════════════════════════════════════════════════════════
//
// These are the original Aria/legacy themepulse chart components with all
// custom indicator logic intact:
//   - LWChart: Daily/Weekly with EMAs (8/21/50/200), SMA20/50, ATR-X overlay,
//     CR% pane, CRP, 4% lines, RS line vs SPY, volume + volume MA
//   - IntradayChart: 5min OHLC with Opening Range (ORB) highlight + ZVR pane
//
// Loaded via the same Lightweight Charts CDN (jsdelivr 4.1.1). The shared
// loadLW() helper deduplicates the script tag across all chart instances.
//
// Imported into App.jsx and rendered inside ChartPanelInline.
// ════════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";

const LW_CDN = "https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.1/dist/lightweight-charts.standalone.production.js";
let lwLoading = false;
let lwLoaded = false;
const lwCallbacks = [];

function loadLW(cb) {
  if (lwLoaded && window.LightweightCharts) { cb(); return; }
  lwCallbacks.push(cb);
  if (lwLoading) return;
  lwLoading = true;
  const script = document.createElement("script");
  script.src = LW_CDN;
  script.onload = () => { lwLoaded = true; lwCallbacks.forEach(fn => fn()); lwCallbacks.length = 0; };
  script.onerror = () => { lwLoading = false; console.error("Failed to load LW charts"); };
  document.head.appendChild(script);
}

// ── Intraday 5-Min Chart with Opening Range + ZVR Pane ──
function IntradayChart({ ticker, avgVolume }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volSeriesRef = useRef(null);
  const zvrContainerRef = useRef(null);
  const zvrChartRef = useRef(null);
  const zvrSeriesRef = useRef(null);
  const linesRef = useRef([]);
  const roRef = useRef(null);
  const ivRef = useRef(null);
  const avgVolRef = useRef(avgVolume);
  avgVolRef.current = avgVolume;
  const pmVolContainerRef = useRef(null);
  const pmVolChartRef = useRef(null);
  const pmVolSeriesRef = useRef(null);
  const pmVolAvgRef = useRef(null);
  const [orRange, setOrRange] = useState(null);
  const [pmRange, setPmRange] = useState(null);
  const [zvrPct, setZvrPct] = useState(null);
  const [ahInfo, setAhInfo] = useState(null); // { chg, vol }
  const [pmVolInfo, setPmVolInfo] = useState(null); // { total }

  useEffect(() => {
    if (!ticker) return;
    const el = document.createElement("div");
    el.style.width = "100%";
    el.style.height = "100%";
    if (containerRef.current) containerRef.current.appendChild(el);

    let disposed = false;

    const init = () => {
      if (disposed) return;
      const LW = window.LightweightCharts;
      if (!LW || !el.parentNode) return;

      const chart = LW.createChart(el, {
        width: el.clientWidth || 400, height: el.clientHeight || 280,
        layout: { background: { type: "solid", color: "#0d0d14" }, textColor: "#787888", fontFamily: "monospace", fontSize: 10 },
        grid: { vertLines: { color: "#1a1a24" }, horzLines: { color: "#1a1a24" } },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: "#2a2a38" },
        timeScale: { borderColor: "#2a2a38", timeVisible: true, secondsVisible: false, rightOffset: 5 },
      });
      chartRef.current = chart;

      // ── Session background shading (rendered behind candles) ──
      const pmBg = chart.addAreaSeries({
        topColor: "rgba(56, 189, 248, 0.06)", bottomColor: "rgba(56, 189, 248, 0.02)",
        lineColor: "rgba(0,0,0,0)", lineWidth: 0,
        lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        priceScaleId: "session-bg",
      });
      const ahBg = chart.addAreaSeries({
        topColor: "rgba(249, 115, 22, 0.06)", bottomColor: "rgba(249, 115, 22, 0.02)",
        lineColor: "rgba(0,0,0,0)", lineWidth: 0,
        lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        priceScaleId: "session-bg",
      });
      chart.priceScale("session-bg").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
      const pmBgRef = pmBg, ahBgRef = ahBg;

      const cs = chart.addCandlestickSeries({
        upColor: "#2bb886", downColor: "#f87171", borderVisible: false,
        wickUpColor: "#2bb886", wickDownColor: "#f87171",
        lastValueVisible: false, priceLineVisible: false,
      });
      seriesRef.current = cs;

      const vs = chart.addHistogramSeries({
        priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#2bb88640",
        lastValueVisible: false, priceLineVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      volSeriesRef.current = vs;

      // ── ZVR pane (below main chart) ──
      if (zvrContainerRef.current) {
        const zvrChart = LW.createChart(zvrContainerRef.current, {
          width: zvrContainerRef.current.clientWidth || 400, height: 55,
          layout: { background: { type: "solid", color: "#0d0d14" }, textColor: "#505060", fontFamily: "monospace", fontSize: 8 },
          grid: { vertLines: { visible: false }, horzLines: { color: "#1a1a2080" } },
          crosshair: { mode: 0 },
          rightPriceScale: { borderColor: "#2a2a38" },
          timeScale: { visible: false },
          handleScroll: false, handleScale: false,
        });
        zvrChartRef.current = zvrChart;
        zvrSeriesRef.current = zvrChart.addHistogramSeries({
          priceFormat: { type: "price", precision: 0, minMove: 1 },
          lastValueVisible: false, priceLineVisible: false,
        });
        // Sync time scales: main chart drives ZVR pane
        chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
          if (range && zvrChartRef.current) {
            try { zvrChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {}
          }
        });
      }

      // ── PM Volume Profile pane (below main chart) ──
      if (pmVolContainerRef.current) {
        const pmVolChart = LW.createChart(pmVolContainerRef.current, {
          width: pmVolContainerRef.current.clientWidth || 400, height: 50,
          layout: { background: { type: "solid", color: "#0d0d14" }, textColor: "#505060", fontFamily: "monospace", fontSize: 8 },
          grid: { vertLines: { visible: false }, horzLines: { color: "#1a1a2080" } },
          crosshair: { mode: 0 },
          rightPriceScale: { borderColor: "#2a2a38" },
          timeScale: { visible: false },
          handleScroll: false, handleScale: false,
        });
        pmVolChartRef.current = pmVolChart;
        pmVolSeriesRef.current = pmVolChart.addHistogramSeries({
          priceFormat: { type: "volume" },
          lastValueVisible: false, priceLineVisible: false,
        });
        pmVolAvgRef.current = pmVolChart.addLineSeries({
          color: "#f97316", lineWidth: 1, lineStyle: 2,
          lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        });
        chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
          if (range && pmVolChartRef.current) {
            try { pmVolChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {}
          }
        });
      }

      roRef.current = new ResizeObserver(() => {
        if (chartRef.current && el.parentNode) {
          try { chartRef.current.resize(el.clientWidth || 400, el.clientHeight || 280); } catch {}
        }
        if (pmVolChartRef.current && pmVolContainerRef.current) {
          try { pmVolChartRef.current.resize(pmVolContainerRef.current.clientWidth || 400, 50); } catch {}
        }
        if (zvrChartRef.current && zvrContainerRef.current) {
          try { zvrChartRef.current.resize(zvrContainerRef.current.clientWidth || 400, 55); } catch {}
        }
      });
      roRef.current.observe(el);

      // ET minutes helper (handles DST via Intl)
      const toETMinutes = (unixSec) => {
        const dt = new Date(unixSec * 1000);
        const etStr = dt.toLocaleString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
        const [h, m] = etStr.split(":").map(Number);
        return h * 60 + m;
      };

      const fetchBars = () => {
        if (disposed) return;
        fetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}&interval=5m`)
          .then(r => r.json())
          .then(d => {
            if (disposed || !d?.ok || !d.ohlc?.length) return;
            const bars = d.ohlc;
            const ptOff = (() => {
              if (!bars.length) return -8 * 3600;
              const d2 = new Date(bars[0].time * 1000);
              const utcStr = d2.toLocaleString("en-US", { timeZone: "UTC" });
              const pacStr = d2.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
              return Math.round((new Date(pacStr) - new Date(utcStr)) / 1000);
            })();
            cs.setData(bars.map(b => ({ time: b.time + ptOff, open: b.open, high: b.high, low: b.low, close: b.close })));
            vs.setData(bars.map(b => ({ time: b.time + ptOff, value: b.volume, color: b.close >= b.open ? "#2bb88640" : "#f8717140" })));

            // ── Session background shading data ──
            const pmBgData = [], ahBgData = [];
            for (const b of bars) {
              const t = b.time + ptOff;
              const etMin = toETMinutes(b.time);
              if (etMin >= 240 && etMin < 570) {
                pmBgData.push({ time: t, value: 1 });
                ahBgData.push({ time: t });
              } else if (etMin >= 960) {
                pmBgData.push({ time: t });
                ahBgData.push({ time: t, value: 1 });
              } else {
                pmBgData.push({ time: t });
                ahBgData.push({ time: t });
              }
            }
            pmBgRef.setData(pmBgData);
            ahBgRef.setData(ahBgData);

            // ── PM Volume Profile: histogram + EMA × 2.5 threshold ──
            if (pmVolSeriesRef.current) {
              const pmVolBars = [], pmVolAvgData = [];
              let pmEma = null, pmVolTotal = 0;
              const pmAlpha = 2 / 22; // EMA(21)
              for (const b of bars) {
                const etMin = toETMinutes(b.time);
                if (etMin >= 240 && etMin < 570) {
                  const vol = b.volume || 0;
                  pmVolTotal += vol;
                  pmEma = pmEma === null ? vol : vol * pmAlpha + pmEma * (1 - pmAlpha);
                  const threshold = pmEma * 2.5;
                  pmVolBars.push({ time: b.time + ptOff, value: vol, color: vol > threshold ? "#38bdf8" : "#38bdf880" });
                  pmVolAvgData.push({ time: b.time + ptOff, value: threshold });
                }
              }
              pmVolSeriesRef.current.setData(pmVolBars);
              if (pmVolAvgRef.current && pmVolAvgData.length > 0) pmVolAvgRef.current.setData(pmVolAvgData);
              if (pmVolChartRef.current) try { pmVolChartRef.current.timeScale().fitContent(); } catch {}
              setPmVolInfo(pmVolBars.length > 0 ? { total: pmVolTotal } : null);
            }

            // Clear old price lines
            linesRef.current.forEach(l => { try { cs.removePriceLine(l); } catch {} });
            linesRef.current = [];

            // ORB: find 9:30 AM ET bar
            let firstBar = null;
            for (const b of bars) {
              if (toETMinutes(b.time) === 570) { firstBar = b; break; }
            }
            if (!firstBar) {
              for (const b of bars) {
                const etMin = toETMinutes(b.time);
                if (etMin >= 570 && etMin < 600) { firstBar = b; break; }
              }
            }

            if (firstBar) {
              setOrRange({ high: firstBar.high, low: firstBar.low });
              try { linesRef.current.push(cs.createPriceLine({ price: firstBar.high, color: "#2bb886", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "ORH" })); } catch {}
              try { linesRef.current.push(cs.createPriceLine({ price: firstBar.low, color: "#f87171", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "ORL" })); } catch {}
            }

            // ── Premarket High/Low — scan 4:00 AM to 9:29 AM ET ──
            let pmHigh = -Infinity, pmLow = Infinity, hasPM = false;
            for (const b of bars) {
              const etMin = toETMinutes(b.time);
              if (etMin >= 570) break;
              if (etMin >= 240) {
                pmHigh = Math.max(pmHigh, b.high);
                pmLow = Math.min(pmLow, b.low);
                hasPM = true;
              }
            }
            if (hasPM) {
              setPmRange({ high: pmHigh, low: pmLow });
              try { linesRef.current.push(cs.createPriceLine({ price: pmHigh, color: "#38bdf8", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "PMH" })); } catch {}
              try { linesRef.current.push(cs.createPriceLine({ price: pmLow,  color: "#fb923c", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "PML" })); } catch {}
            } else {
              setPmRange(null);
            }

            // ── Aftermarket Change% & Volume ──
            let regClose = null, ahLastClose = null, ahVol = 0, hasAH = false;
            for (let i = bars.length - 1; i >= 0; i--) {
              const etMin = toETMinutes(bars[i].time);
              if (etMin >= 570 && etMin < 960 && regClose == null) {
                regClose = bars[i].close; // last regular session bar close
              }
              if (etMin >= 960) {
                hasAH = true;
                if (ahLastClose == null) ahLastClose = bars[i].close; // last AH bar
                ahVol += bars[i].volume || 0;
              }
            }
            if (hasAH && regClose && ahLastClose) {
              const chg = Math.round(((ahLastClose - regClose) / regClose) * 10000) / 100;
              setAhInfo({ chg, vol: ahVol, price: ahLastClose });
            } else {
              setAhInfo(null);
            }

            // ── ZVR (Zanger Volume Ratio) — intraday cumulative vs time-adjusted avg ──
            const aVol = avgVolRef.current;
            if (zvrSeriesRef.current && aVol > 0) {
              // 78 five-min bars in a 6.5hr trading day (9:30-4:00 ET)
              const BARS_IN_DAY = 78;
              const avgBarVol = aVol / BARS_IN_DAY;
              let cumVol = 0, sessionBars = 0;
              const zvrData = [];
              for (let i = 0; i < bars.length; i++) {
                const etMin = toETMinutes(bars[i].time);
                const vol = bars[i].volume || 0;
                cumVol += vol;
                if (etMin >= 570 && etMin < 960) sessionBars++;
                // Per-bar ZVR: bar volume vs average 5-min bar volume
                const barZvr = avgBarVol > 0 ? Math.round((vol / avgBarVol) * 100) : 100;
                const c = barZvr > 200 ? "#ff5252" : barZvr > 150 ? "#fb78c0" : barZvr > 110 ? "#c393f2" : barZvr > 85 ? "#878fc1" : "#787b86";
                zvrData.push({ time: bars[i].time + ptOff, value: barZvr, color: c });
              }
              zvrSeriesRef.current.setData(zvrData);
              // Cumulative ZVR %: total volume so far / expected volume at this time of day
              const expectedCum = sessionBars > 0 ? aVol * (sessionBars / BARS_IN_DAY) : aVol;
              const cumZvr = expectedCum > 0 ? Math.round((cumVol / expectedCum) * 100) : 100;
              const cumColor = cumZvr > 200 ? "#ff5252" : cumZvr > 150 ? "#fb78c0" : cumZvr > 110 ? "#c393f2" : cumZvr > 85 ? "#878fc1" : "#787b86";
              setZvrPct({ value: cumZvr, color: cumColor });
            }

            chart.timeScale().fitContent();
          })
          .catch(() => {});
      };

      fetchBars();
      ivRef.current = setInterval(fetchBars, 30000);
    };

    loadLW(init);

    return () => {
      disposed = true;
      if (ivRef.current) { clearInterval(ivRef.current); ivRef.current = null; }
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
      if (pmVolChartRef.current) { try { pmVolChartRef.current.remove(); } catch {} pmVolChartRef.current = null; }
      if (zvrChartRef.current) { try { zvrChartRef.current.remove(); } catch {} zvrChartRef.current = null; }
      if (chartRef.current) { try { chartRef.current.remove(); } catch {} chartRef.current = null; }
      seriesRef.current = null; volSeriesRef.current = null; zvrSeriesRef.current = null; pmVolSeriesRef.current = null; pmVolAvgRef.current = null; linesRef.current = [];
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, [ticker]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Main 5m ORB chart */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div style={{ position: "absolute", top: 4, left: 8, zIndex: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b" }}>5m ORB</span>
          <span style={{ fontSize: 9, color: "#555", fontFamily: "monospace" }}>PT</span>
          {orRange && (<>
            <span style={{ fontSize: 10, color: "#2bb886", fontFamily: "monospace" }}>ORH {orRange.high.toFixed(2)}</span>
            <span style={{ fontSize: 10, color: "#f87171", fontFamily: "monospace" }}>ORL {orRange.low.toFixed(2)}</span>
            <span style={{ fontSize: 10, color: "#787888", fontFamily: "monospace" }}>
              Range ${(orRange.high - orRange.low).toFixed(2)} ({((orRange.high - orRange.low) / orRange.low * 100).toFixed(1)}%)
            </span>
          </>)}
          {pmRange && (<>
            <span style={{ fontSize: 10, color: "#38bdf8", fontFamily: "monospace" }}>PMH {pmRange.high.toFixed(2)}</span>
            <span style={{ fontSize: 10, color: "#fb923c", fontFamily: "monospace" }}>PML {pmRange.low.toFixed(2)}</span>
          </>)}
          {ahInfo && (<>
            <span style={{ fontSize: 10, color: ahInfo.chg >= 0 ? "#2bb886" : "#f87171", fontFamily: "monospace" }}>
              AH {ahInfo.chg > 0 ? "+" : ""}{ahInfo.chg.toFixed(2)}%
            </span>
            <span style={{ fontSize: 9, color: "#f9731680", fontFamily: "monospace" }}>
              {ahInfo.vol >= 1e6 ? (ahInfo.vol / 1e6).toFixed(1) + "M" : ahInfo.vol >= 1e3 ? (ahInfo.vol / 1e3).toFixed(0) + "K" : ahInfo.vol}
            </span>
          </>)}
          {pmVolInfo && (
            <span style={{ fontSize: 10, color: "#38bdf8", fontFamily: "monospace" }}>
              PM Vol {pmVolInfo.total >= 1e6 ? (pmVolInfo.total / 1e6).toFixed(1) + "M" : pmVolInfo.total >= 1e3 ? (pmVolInfo.total / 1e3).toFixed(0) + "K" : pmVolInfo.total}
            </span>
          )}
        </div>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      </div>
      {/* PM Vol + ZVR panes removed per user request. The chart init code
          checks `if (pmVolContainerRef.current)` before creating those
          sub-charts, so leaving the refs unattached makes the init silently
          skip them. The refs themselves stay declared at the top of the
          component so hook order doesn't change. */}
    </div>
  );
}

function LWChart({ ticker, tf = "D", entry, stop, target, quarters }) {
  const wrapperRef = useRef(null);
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volSeriesRef = useRef(null);
  const roRef = useRef(null);
  const linesRef = useRef([]);
  const volMaRef = useRef(null);
  const maRefs = useRef({}); // ema10, ema21hi, ema21close, ema21lo, sma50, ema200
  const crContainerRef = useRef(null);
  const crChartRef = useRef(null);
  const crSeriesRef = useRef(null);
  const crMaRef = useRef(null);
  const crpSeriesRef = useRef(null);
  const fourPctSeriesRef = useRef(null);
  const crErLineRef = useRef(null);
  const mainErLineRef = useRef(null);
  const atrxContainerRef = useRef(null);
  const atrxChartRef = useRef(null);
  const atrxSeriesRefs = useRef({});
  const volChartRef = useRef(null);
  const volContainerRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [libReady, setLibReady] = useState(!!window.LightweightCharts);
  const [showCR, setShowCR] = useState(false);
  const [showCRP, setShowCRP] = useState(true);
  const [show4Pct, setShow4Pct] = useState(true);
  const [showATRX, setShowATRX] = useState(true);
  const [atrxStats, setAtrxStats] = useState(null);
  const [topPaneOpen, setTopPaneOpen] = useState(false);
  const [volStats, setVolStats] = useState(null);
  const [rawBars, setRawBars] = useState(null);

  // Aggregate daily bars into weekly or monthly
  const aggregateBars = useCallback((dailyBars, timeframe) => {
    if (timeframe === "D" || timeframe === "30m") return dailyBars;
    const groups = {};
    for (const bar of dailyBars) {
      let key;
      if (timeframe === "W") {
        const d = new Date(bar.date + "T12:00:00");
        const day = d.getDay();
        const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7));
        key = mon.toISOString().slice(0, 10);
      } else {
        key = bar.date.slice(0, 7) + "-01";
      }
      if (!groups[key]) groups[key] = { date: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume || 0 };
      else {
        const g = groups[key];
        g.high = Math.max(g.high, bar.high);
        g.low = Math.min(g.low, bar.low);
        g.close = bar.close;
        g.volume += (bar.volume || 0);
      }
    }
    return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
  }, []);

  // Load library
  useEffect(() => {
    if (!libReady) loadLW(() => setLibReady(true));
  }, [libReady]);

  // Create a dedicated DOM element for chart (outside React's DOM control)
  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = document.createElement("div");
    el.style.cssText = "width:100%;height:100%;position:absolute;top:0;left:0;";
    wrapperRef.current.appendChild(el);
    chartContainerRef.current = el;
    return () => {
      if (chartRef.current) { try { chartRef.current.remove(); } catch {} chartRef.current = null; seriesRef.current = null; linesRef.current = []; }
      if (crChartRef.current) { try { crChartRef.current.remove(); } catch {} crChartRef.current = null; crSeriesRef.current = null; crMaRef.current = null; crpSeriesRef.current = null; fourPctSeriesRef.current = null; crErLineRef.current = null; }
      if (atrxChartRef.current) { try { atrxChartRef.current.remove(); } catch {} atrxChartRef.current = null; atrxSeriesRefs.current = {}; }
      if (volChartRef.current) { try { volChartRef.current.remove(); } catch {} volChartRef.current = null; volSeriesRef.current = null; volMaRef.current = null; }
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
      if (el.parentNode) el.parentNode.removeChild(el);
      chartContainerRef.current = null;
    };
  }, []);

  // Create chart once lib + container ready
  useEffect(() => {
    if (!libReady || !chartContainerRef.current || chartRef.current) return;
    const LW = window.LightweightCharts;
    if (!LW) return;
    try {
      const chart = LW.createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth || 400,
        height: chartContainerRef.current.clientHeight || 400,
        layout: { background: { type: "solid", color: "#0d0d14" }, textColor: "#787888", fontFamily: "monospace", fontSize: 10 },
        grid: { vertLines: { color: "#1a1a24" }, horzLines: { color: "#1a1a24" } },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: "#2a2a38" },
        timeScale: { borderColor: "#2a2a38", timeVisible: false, rightOffset: 15 },
      });
      chartRef.current = chart;

      seriesRef.current = chart.addCandlestickSeries({
        upColor: "#2bb886", downColor: "#f87171", borderVisible: false,
        wickUpColor: "#2bb886", wickDownColor: "#f87171",
      });

      // Earnings EPS/Sales YoY text line — invisible line on an overlay
      // priceScale pinned to the bottom ~5% of the main pane. Text markers
      // attached here render below the candle area at the earnings date.
      mainErLineRef.current = chart.addLineSeries({
        priceScaleId: "er-overlay",
        color: "transparent",
        lineWidth: 0,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      try {
        chart.priceScale("er-overlay").applyOptions({
          scaleMargins: { top: 0.93, bottom: 0 },
          visible: false,
        });
      } catch {}

      // ── Price overlay MAs ──
      maRefs.current.ema10 = chart.addLineSeries({
        color: "#ff828c", lineWidth: 1, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });
      maRefs.current.ema21hi = chart.addLineSeries({
        color: "#80808060", lineWidth: 1, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });
      maRefs.current.ema21lo = chart.addLineSeries({
        color: "#80808060", lineWidth: 1, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });
      maRefs.current.ema21close = chart.addLineSeries({
        color: "#808080", lineWidth: 2, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });
      maRefs.current.sma50 = chart.addLineSeries({
        color: "#2dd4bf", lineWidth: 1, lineStyle: 2, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });
      maRefs.current.ema200 = chart.addLineSeries({
        color: "#8232c8", lineWidth: 1, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });
      maRefs.current.ema40step = chart.addLineSeries({
        color: "#fbbf24", lineWidth: 2, lineStyle: 0, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });

      // Volume series are on a separate chart panel (created below)

      roRef.current = new ResizeObserver(() => {
        if (chartRef.current && chartContainerRef.current) {
          try { chartRef.current.resize(chartContainerRef.current.clientWidth || 400, chartContainerRef.current.clientHeight || 400); } catch {}
        }
        if (crChartRef.current && crContainerRef.current) {
          try { crChartRef.current.resize(crContainerRef.current.clientWidth || 400, 90); } catch {}
        }
        if (atrxChartRef.current && atrxContainerRef.current) {
          try { atrxChartRef.current.resize(atrxContainerRef.current.clientWidth || 400, 110); } catch {}
        }
        if (volChartRef.current && volContainerRef.current) {
          try { volChartRef.current.resize(volContainerRef.current.clientWidth || 400, 120); } catch {}
        }
      });
      roRef.current.observe(chartContainerRef.current);

      // ── CR% + 4% Days combined pane (top) ──
      if (crContainerRef.current) {
        const crChart = LW.createChart(crContainerRef.current, {
          width: crContainerRef.current.clientWidth || 400, height: 90,
          layout: { background: { type: "solid", color: "#0d0d14" }, textColor: "#505060", fontFamily: "monospace", fontSize: 8 },
          grid: { vertLines: { visible: false }, horzLines: { color: "#1a1a2080" } },
          crosshair: { mode: 0 },
          rightPriceScale: { borderColor: "#2a2a38", scaleMargins: { top: 0.05, bottom: 0.05 } },
          timeScale: { visible: false },
          handleScroll: false,
          handleScale: false,
        });
        crChartRef.current = crChart;
        // CR% histogram (0-100 scale) — primary layer
        crSeriesRef.current = crChart.addHistogramSeries({
          priceFormat: { type: "price", precision: 0, minMove: 1 },
          lastValueVisible: false, priceLineVisible: false,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        });
        // 10-period SMA of CR%
        crMaRef.current = crChart.addLineSeries({
          color: "#fbbf2480", lineWidth: 1,
          lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        });
        // CRP (rolling CR% persistence) — area series
        crpSeriesRef.current = crChart.addAreaSeries({
          topColor: "#60a5fa30", bottomColor: "#60a5fa05", lineColor: "#60a5fa", lineWidth: 2,
          lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        });
        // 4% Days overlay — line series with markers for ≥4% days
        // Mapped to 0-100 scale: 0% change → 50, +20% → 100, -20% → 0
        fourPctSeriesRef.current = crChart.addLineSeries({
          color: "transparent", lineWidth: 0,
          lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        });
        // Hidden line for earnings markers
        crErLineRef.current = crChart.addLineSeries({
          color: "transparent", lineWidth: 0,
          lastValueVisible: false, priceLineVisible: false,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        });
        // Sync time scale
        chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
          if (range) {
            if (crChartRef.current) try { crChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {}
            if (atrxChartRef.current) try { atrxChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {}
            if (volChartRef.current) try { volChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {}
          }
        });
      }

      // ── ATRX Pro pane ──
      if (atrxContainerRef.current) {
        const atrxChart = LW.createChart(atrxContainerRef.current, {
          width: atrxContainerRef.current.clientWidth || 400, height: 110,
          layout: { background: { type: "solid", color: "#0d0d14" }, textColor: "#505060", fontFamily: "monospace", fontSize: 8 },
          grid: { vertLines: { visible: false }, horzLines: { color: "#1a1a2080" } },
          crosshair: { mode: 0 },
          rightPriceScale: { borderColor: "#2a2a38", scaleMargins: { top: 0.05, bottom: 0.05 } },
          timeScale: { visible: false },
          handleScroll: false, handleScale: false,
        });
        atrxChartRef.current = atrxChart;
        // 50 SMA dist/ATR% line
        atrxSeriesRefs.current.sma50 = atrxChart.addLineSeries({
          color: "#2962FF", lineWidth: 2, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
        });
        // 20 DMA dist/ATR% line
        atrxSeriesRefs.current.dma20 = atrxChart.addLineSeries({
          color: "#00BCD4", lineWidth: 2, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
        });
        // 10W EMA dist/ATR% line
        atrxSeriesRefs.current.ema10w = atrxChart.addLineSeries({
          color: "#AB47BC", lineWidth: 2, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
        });
        // RMV background (low volatility highlight) — own scale so it doesn't distort ATRX lines
        atrxSeriesRefs.current.rmv = atrxChart.addHistogramSeries({
          color: "#2bb88630", lastValueVisible: false, priceLineVisible: false,
          priceScaleId: 'rmv',
          priceFormat: { type: "price", precision: 0, minMove: 1 },
        });
        atrxChart.priceScale('rmv').applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } });
        // VCS squares (invisible line + markers)
        atrxSeriesRefs.current.vcs = atrxChart.addLineSeries({
          color: "transparent", lineWidth: 0, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
        });
        // Reference lines
        try {
          atrxChart.addLineSeries({ color: "#ffffff40", lineWidth: 1, lineStyle: 0, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false })
            .setData([]);
          // Use price lines on sma50 series for reference
          const refSeries = atrxSeriesRefs.current.sma50;
          refSeries._atrxRefLines = true;
        } catch {}
      }

      // ── Volume panel (bottom) ──
      if (volContainerRef.current) {
        const volChart = LW.createChart(volContainerRef.current, {
          width: volContainerRef.current.clientWidth || 400, height: 120,
          layout: { background: { type: "solid", color: "#0d0d14" }, textColor: "#505060", fontFamily: "monospace", fontSize: 8 },
          grid: { vertLines: { visible: false }, horzLines: { color: "#1a1a2080" } },
          crosshair: { mode: 0 },
          rightPriceScale: { borderColor: "#2a2a38", scaleMargins: { top: 0.05, bottom: 0 } },
          timeScale: { visible: false },
          handleScroll: false,
          handleScale: false,
        });
        volChartRef.current = volChart;
        volSeriesRef.current = volChart.addHistogramSeries({
          priceFormat: { type: "volume" },
          color: "#2bb88640",
          lastValueVisible: false, priceLineVisible: false,
          priceScaleId: "right",
          autoscaleInfoProvider: (original) => {
            const res = original();
            if (res?.priceRange) res.priceRange.minValue = 0;
            return res;
          },
        });
        volMaRef.current = volChart.addLineSeries({
          color: "#fbbf2480", lineWidth: 1,
          lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
        });
      }
    } catch (e) {
      console.error("LW chart init error:", e);
      setError("Chart init failed: " + e.message);
    }
  }, [libReady]);

  // Fetch OHLC data — daily for D/W/M, intraday for 30m
  const isIntraday = tf === "30m";
  useEffect(() => {
    if (!ticker || !seriesRef.current || !chartRef.current) return;
    setLoading(true);
    setError(null);
    setRawBars(null);
    let cancelled = false;

    const url = isIntraday
      ? `/api/ohlc?ticker=${encodeURIComponent(ticker)}&interval=30m`
      : `/api/ohlc?ticker=${encodeURIComponent(ticker)}`;
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        if (cancelled) return;
        if (!data.ok || !data.ohlc || data.ohlc.length === 0) throw new Error(data.error || "No OHLC data");
        setRawBars(data.ohlc);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [ticker, libReady, isIntraday]);

  // Process bars when ticker loads or timeframe changes
  useEffect(() => {
    if (!rawBars || !seriesRef.current || !chartRef.current) return;
    const bars = aggregateBars(rawBars, tf);
    // Helper: get LWC time value (date string for daily, unix ts for intraday)
    const btime = (b) => b.date || b.time;

        // ── Pocket Pivot Volume Detection ──
        // Track highest up volume ever and in last year (252 trading days)
        let highestUpVolEver = 0;
        const upVolsAll = [];
        for (let i = 0; i < bars.length; i++) {
          if (bars[i].close >= bars[i].open) {
            upVolsAll.push({ idx: i, vol: bars[i].volume || 0 });
            if ((bars[i].volume || 0) > highestUpVolEver) highestUpVolEver = bars[i].volume || 0;
          }
        }
        // Highest up volume in last 252 bars (1 year)
        const yearStart = Math.max(0, bars.length - 252);
        let highestUpVolYear = 0;
        for (let i = yearStart; i < bars.length; i++) {
          if (bars[i].close >= bars[i].open && (bars[i].volume || 0) > highestUpVolYear) {
            highestUpVolYear = bars[i].volume || 0;
          }
        }

        // Highest up volume in last quarter (63 trading days)
        const qtrStart = Math.max(0, bars.length - 63);
        let highestUpVolQtr = 0, highestUpVolQtrIdx = -1;
        for (let i = qtrStart; i < bars.length; i++) {
          if (bars[i].close >= bars[i].open && (bars[i].volume || 0) > highestUpVolQtr) {
            highestUpVolQtr = bars[i].volume || 0;
            highestUpVolQtrIdx = i;
          }
        }

        const volumes = bars.map((c, i) => {
          const isUp = c.close >= c.open;
          const vol = c.volume || 0;

          if (!isUp) {
            return { time: btime(c), value: vol, color: "#6b7280cc" };
          }

          // Check highest up volume ever/year/quarter — all purple bars
          if (vol === highestUpVolEver && vol > 0) {
            return { time: btime(c), value: vol, color: "#a855f7" };
          }
          if (i >= yearStart && vol === highestUpVolYear && vol > 0 && vol !== highestUpVolEver) {
            return { time: btime(c), value: vol, color: "#a855f7" };
          }
          if (i >= qtrStart && vol === highestUpVolQtr && vol > 0 && vol !== highestUpVolEver && vol !== highestUpVolYear) {
            return { time: btime(c), value: vol, color: "#a855f7" };
          }

          // Pocket pivot detection
          const downVols = [];
          for (let j = i - 1; j >= 0 && downVols.length < 10; j--) {
            if (bars[j].close < bars[j].open) {
              downVols.push(bars[j].volume || 0);
            }
          }

          if (downVols.length >= 10) {
            const max10 = Math.max(...downVols.slice(0, 10));
            if (vol > max10) {
              return { time: btime(c), value: vol, color: "#2563eb" };
            }
          }
          if (downVols.length >= 5) {
            const max5 = Math.max(...downVols.slice(0, 5));
            if (vol > max5) {
              return { time: btime(c), value: vol, color: "#0d9488" };
            }
          }

          return { time: btime(c), value: vol, color: "#ffffffcc" };
        });

        // Find indices of HVE and HVY for markers
        let hveIdx = -1, hvyIdx = -1;
        for (let i = 0; i < bars.length; i++) {
          if (bars[i].close >= bars[i].open) {
            if ((bars[i].volume || 0) === highestUpVolEver) hveIdx = i;
            if (i >= yearStart && (bars[i].volume || 0) === highestUpVolYear) hvyIdx = i;
          }
        }

        seriesRef.current.setData(bars.map(c => ({ time: btime(c), open: c.open, high: c.high, low: c.low, close: c.close })));
        volSeriesRef.current.setData(volumes);

        // ── Compute Moving Averages ──
        const calcEMA = (data, period) => {
          const k = 2 / (period + 1);
          const result = [];
          let prev = null;
          for (let i = 0; i < data.length; i++) {
            if (data[i] == null) { result.push(null); continue; }
            if (prev == null) {
              // Seed with SMA of first `period` values
              if (i < period - 1) { result.push(null); continue; }
              let sum = 0;
              for (let j = i - period + 1; j <= i; j++) sum += data[j];
              prev = sum / period;
              result.push(prev);
            } else {
              prev = data[i] * k + prev * (1 - k);
              result.push(prev);
            }
          }
          return result;
        };
        const calcSMA = (data, period) => {
          const result = [];
          for (let i = 0; i < data.length; i++) {
            if (i < period - 1) { result.push(null); continue; }
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += (data[j] || 0);
            result.push(sum / period);
          }
          return result;
        };
        // Wilder ATR (RMA-based, like Pine Script ta.atr)
        const calcATR = (bars, period) => {
          const tr = [];
          for (let i = 0; i < bars.length; i++) {
            if (i === 0) { tr.push(bars[i].high - bars[i].low); continue; }
            tr.push(Math.max(
              bars[i].high - bars[i].low,
              Math.abs(bars[i].high - bars[i - 1].close),
              Math.abs(bars[i].low - bars[i - 1].close)
            ));
          }
          // RMA (Wilder's smoothing)
          const atr = [];
          for (let i = 0; i < tr.length; i++) {
            if (i < period - 1) { atr.push(null); continue; }
            if (i === period - 1) {
              let sum = 0; for (let j = 0; j < period; j++) sum += tr[j];
              atr.push(sum / period);
            } else {
              atr.push((atr[i - 1] * (period - 1) + tr[i]) / period);
            }
          }
          return atr;
        };

        const closes = bars.map(c => c.close);
        const highs = bars.map(c => c.high);
        const lows = bars.map(c => c.low);

        const ema10 = calcEMA(closes, 10);
        const ema21hi = calcEMA(highs, 21);
        const ema21close = calcEMA(closes, 21);
        const ema21lo = calcEMA(lows, 21);
        const sma20 = calcSMA(closes, 20);
        const sma50 = calcSMA(closes, 50);
        const ema200 = calcEMA(closes, 200);
        // 8-week stepped EMA: compute EMA(40) on weekly Friday closes, step onto daily bars
        const ema40raw = calcEMA(closes, 40);
        const ema40step = [];
        if (tf === "D" || tf === "W") {
          // Find weekly close values (last bar of each week)
          const weeklyCloses = [];
          const weeklyIdx = [];
          for (let i = 0; i < bars.length; i++) {
            const d = new Date(bars[i].date + "T00:00:00");
            const dow = d.getDay(); // 0=Sun, 5=Fri
            const isLastOfWeek = i === bars.length - 1 || (() => {
              const nd = new Date(bars[i + 1].date + "T00:00:00");
              return nd.getDay() <= dow || (nd - d) > 4 * 86400000;
            })();
            if (isLastOfWeek) { weeklyCloses.push(closes[i]); weeklyIdx.push(i); }
          }
          // EMA of weekly closes (8-period)
          const wEma = calcEMA(weeklyCloses, 8);
          // Step: hold each weekly EMA value until next weekly close
          let wIdx = 0;
          for (let i = 0; i < bars.length; i++) {
            if (wIdx < weeklyIdx.length - 1 && i > weeklyIdx[wIdx]) wIdx++;
            ema40step.push(wEma[wIdx] ?? null);
          }
        }
        const atr14 = calcATR(bars, 14);

        // ── ATR Extension Ladder (price lines from SMA50) ──
        const lastIdx = bars.length - 1;
        const lastSma50 = sma50[lastIdx];
        const lastAtr = atr14[lastIdx];
        const lastClose = bars[lastIdx].close;
        const lastLow = bars[lastIdx].low;
        const prevLow = lastIdx > 0 ? bars[lastIdx - 1].low : lastLow;

        // 52W high & ATH
        const lookback252 = Math.max(0, lastIdx - 252);
        let wk52High = 0, athHigh = 0;
        for (let i = 0; i <= lastIdx; i++) {
          athHigh = Math.max(athHigh, bars[i].high);
          if (i >= lookback252) wk52High = Math.max(wk52High, bars[i].high);
        }

        // Remove old price lines
        linesRef.current.forEach(l => { try { seriesRef.current.removePriceLine(l); } catch {} });
        linesRef.current = [];

        const addLine = (price, color, title, lineStyle = 2, lineWidth = 1) => {
          if (price > 0 && isFinite(price)) {
            try { linesRef.current.push(seriesRef.current.createPriceLine({ price, color, lineWidth, lineStyle, axisLabelVisible: true, title })); } catch {}
          }
        };

        // Canonical price levels only — ATR ladder / risk-stop / LOD+PDL
        // labels were removed to unclutter the right axis.
        {
          const addAxisLabel = (price, color, title) => {
            if (price > 0 && isFinite(price)) {
              try { linesRef.current.push(seriesRef.current.createPriceLine({ price, color, lineWidth: 0, lineStyle: 2, lineVisible: false, axisLabelVisible: true, title })); } catch {}
            }
          };
          if (wk52High > 0) addAxisLabel(wk52High, "#ffa500", "52W");
          if (athHigh > 0 && Math.abs(athHigh - wk52High) > lastClose * 0.001) addAxisLabel(athHigh, "#ff8c00", "ATH");
        }

        // Entry / Stop / Target from trade
        if (parseFloat(entry) > 0) addLine(parseFloat(entry), "#60a5fa", "Entry", 2, 1);
        if (parseFloat(stop) > 0) addLine(parseFloat(stop), "#f87171", "Stop", 2, 1);
        if (parseFloat(target) > 0) addLine(parseFloat(target), "#2bb886", "Target", 2, 1);

        const toLine = (arr) => arr.map((v, i) => v != null ? { time: btime(bars[i]), value: Math.round(v * 100) / 100 } : null).filter(Boolean);

        if (maRefs.current.ema10) maRefs.current.ema10.setData(toLine(ema10));

        if (maRefs.current.sma50) maRefs.current.sma50.setData(toLine(sma50));
        if (maRefs.current.ema200) maRefs.current.ema200.setData(toLine(ema200));
        if (maRefs.current.ema40step && ema40step.length > 0) maRefs.current.ema40step.setData(toLine(ema40step));
        if (maRefs.current.ema21hi) maRefs.current.ema21hi.setData(toLine(ema21hi));
        if (maRefs.current.ema21lo) maRefs.current.ema21lo.setData(toLine(ema21lo));

        // 21 EMA close — color based on all rising/falling
        if (maRefs.current.ema21close) {
          const ema21data = [];
          for (let i = 0; i < bars.length; i++) {
            if (ema21hi[i] == null || ema21close[i] == null || ema21lo[i] == null) continue;
            const allRising = i > 0 && ema21hi[i - 1] != null &&
              ema21hi[i] > ema21hi[i - 1] && ema21close[i] > ema21close[i - 1] && ema21lo[i] > ema21lo[i - 1];
            const allFalling = i > 0 && ema21hi[i - 1] != null &&
              ema21hi[i] < ema21hi[i - 1] && ema21close[i] < ema21close[i - 1] && ema21lo[i] < ema21lo[i - 1];
            ema21data.push({
              time: btime(bars[i]),
              value: Math.round(ema21close[i] * 100) / 100,
              color: allRising ? "#6495ed" : allFalling ? "#1e3a8a" : "#4169e1",
            });
          }
          maRefs.current.ema21close.setData(ema21data);
        }

        // ── HVE / HVY / HVQ markers above volume bars ──
        const volMarkers = [];
        const calcPctAboveAvg = (idx) => {
          if (idx < 49) return 0;
          let s = 0; for (let j = idx - 49; j <= idx; j++) s += (bars[j].volume || 0);
          const avg = s / 50;
          return avg > 0 ? Math.round(((bars[idx].volume || 0) / avg - 1) * 100) : 0;
        };

        if (hveIdx >= 0) {
          volMarkers.push({ time: btime(bars[hveIdx]), position: "aboveBar", color: "#d946ef",
            shape: "circle", size: 0.5, text: `HVE ${fmtVol(bars[hveIdx].volume)} (${calcPctAboveAvg(hveIdx)}%)` });
        }
        if (hvyIdx >= 0 && hvyIdx !== hveIdx) {
          volMarkers.push({ time: btime(bars[hvyIdx]), position: "aboveBar", color: "#a855f7",
            shape: "circle", size: 0.5, text: `HVY ${fmtVol(bars[hvyIdx].volume)} (${calcPctAboveAvg(hvyIdx)}%)` });
        }
        if (highestUpVolQtrIdx >= 0 && highestUpVolQtrIdx !== hveIdx && highestUpVolQtrIdx !== hvyIdx) {
          volMarkers.push({ time: btime(bars[highestUpVolQtrIdx]), position: "aboveBar", color: "#22d3ee",
            shape: "circle", size: 0.5, text: `HVQ ${fmtVol(bars[highestUpVolQtrIdx].volume)} (${calcPctAboveAvg(highestUpVolQtrIdx)}%)` });
        }

        // ── Zanger Volume Explosion Diamond ──
        // Conditions: volume > 2x 20-day SMA, close > prev close, close > open
        const zangerMult = 2.0;
        const zangerAvgLen = 20;
        for (let i = zangerAvgLen; i < bars.length; i++) {
          // 20-day volume SMA
          let vSum = 0;
          for (let j = i - zangerAvgLen; j < i; j++) vSum += (bars[j].volume || 0);
          const vAvg = vSum / zangerAvgLen;

          const vol = bars[i].volume || 0;
          const priceUp = bars[i].close > (bars[i - 1]?.close || 0);     // close > prev close
          const solidClose = bars[i].close > bars[i].open;                 // close > open
          const volExplosion = vol > (vAvg * zangerMult);                  // vol > 200% avg

          if (volExplosion && priceUp && solidClose) {
            volMarkers.push({
              time: btime(bars[i]), position: "belowBar", color: "#ffffff",
              shape: "square", size: 0.3,
            });
          }
        }

        volMarkers.sort((a, b) => typeof a.time === "string" ? a.time.localeCompare(b.time) : a.time - b.time);
        volSeriesRef.current.setMarkers(volMarkers);

        // ── 7x/10x ATRX dots on price series ──
        const priceMarkers = [];
        for (let i = 1; i < bars.length; i++) {
          if (sma50[i] == null || atr14[i] == null || atr14[i] === 0) continue;
          const atrx = (bars[i].close - sma50[i]) / atr14[i];
          if (atrx >= 10) {
            priceMarkers.push({ time: btime(bars[i]), position: "aboveBar", color: "#ff0000", shape: "circle", size: 0.5, text: "" });
          } else if (atrx >= 7) {
            priceMarkers.push({ time: btime(bars[i]), position: "aboveBar", color: "#ffd700", shape: "circle", size: 0.3, text: "" });
          } else if (atrx <= -10) {
            priceMarkers.push({ time: btime(bars[i]), position: "belowBar", color: "#ff0000", shape: "circle", size: 0.5, text: "" });
          } else if (atrx <= -7) {
            priceMarkers.push({ time: btime(bars[i]), position: "belowBar", color: "#ffd700", shape: "circle", size: 0.3, text: "" });
          }
        }
        priceMarkers.sort((a, b) => typeof a.time === "string" ? a.time.localeCompare(b.time) : a.time - b.time);
        seriesRef.current.setMarkers(priceMarkers);

        // ── 50-day Volume MA line ──
        if (volMaRef.current) {
          const maData = [];
          const dryUpMarkers = [];
          for (let i = 0; i < bars.length; i++) {
            if (i < 49) continue;
            let sum = 0;
            for (let j = i - 49; j <= i; j++) sum += (bars[j].volume || 0);
            const ma = sum / 50;
            maData.push({ time: btime(bars[i]), value: ma });

            // Volume dry-up detection
            const vol = bars[i].volume || 0;
            if (ma > 0) {
              const pctChange = ((vol - ma) / ma) * 100;
              if (pctChange <= -60) {
                dryUpMarkers.push({
                  time: btime(bars[i]), position: "aboveBar", color: "#f97316",
                  shape: "circle", size: 0.5,
                });
              } else if (pctChange <= -45) {
                dryUpMarkers.push({
                  time: btime(bars[i]), position: "aboveBar", color: "#fbbf24",
                  shape: "circle", size: 0.5,
                });
              }
            }
          }
          volMaRef.current.setData(maData);
          // Set markers on the MA line (shares vol price scale)
          if (dryUpMarkers.length > 0) {
            volMaRef.current.setMarkers(dryUpMarkers);
          } else {
            volMaRef.current.setMarkers([]);
          }
        }

        // ── CR% + 4% Days combined pane data ──
        if (crSeriesRef.current) {
          // CR% histogram
          const crData = [];
          const crVals = [];
          for (let i = 0; i < bars.length; i++) {
            const range = bars[i].high - bars[i].low;
            const cr = range > 0 ? ((bars[i].close - bars[i].low) / range) * 100 : 50;
            crVals.push(cr);
            const isUp = bars[i].close >= bars[i].open;
            let color;
            if (cr >= 85 && isUp) color = "#2bb886";
            else if (cr >= 70 && isUp) color = "#2bb88680";
            else if (cr <= 15 && !isUp) color = "#f87171";
            else if (cr <= 30 && !isUp) color = "#f8717180";
            else color = "#4a4a5a40";
            crData.push({ time: btime(bars[i]), value: Math.round(cr), color });
          }
          crSeriesRef.current.setData(crData);

          // 10-period SMA of CR%
          if (crMaRef.current) {
            const crMaData = [];
            for (let i = 0; i < crVals.length; i++) {
              if (i < 9) continue;
              let sum = 0;
              for (let j = i - 9; j <= i; j++) sum += crVals[j];
              crMaData.push({ time: btime(bars[i]), value: Math.round(sum / 10) });
            }
            crMaRef.current.setData(crMaData);
          }

          // Rolling CRP (CR% Persistence) — 10-bar lookback window
          if (crpSeriesRef.current && crVals.length >= 3) {
            const LOOKBACK = 10;
            const crpData = [];
            for (let i = 2; i < crVals.length; i++) {
              const window = crVals.slice(Math.max(0, i - LOOKBACK + 1), i + 1);
              const durPct = window.filter(v => v >= 80).length / window.length * 100;
              const floorSc = Math.min(Math.min(...window) / 80 * 100, 100);
              const last3 = window.slice(-Math.min(3, window.length));
              const avgAll = window.reduce((s, v) => s + v, 0) / window.length;
              const avgLast = last3.reduce((s, v) => s + v, 0) / last3.length;
              const trendSc = avgAll > 0 ? Math.min(avgLast / avgAll * 100, 100) : 0;
              const score = Math.round(durPct * 0.4 + floorSc * 0.3 + trendSc * 0.3);
              crpData.push({ time: btime(bars[i]), value: Math.min(score, 100) });
            }
            crpSeriesRef.current.setData(crpData);
          }

          // 4% Days overlay — diamond markers on an invisible line
          // Uses the fourPctSeries line at value=5 (bottom of pane) with markers above
          if (fourPctSeriesRef.current) {
            const fpLineData = [];
            const fpMarkers = [];
            for (let i = 1; i < bars.length; i++) {
              const prev = bars[i - 1].close;
              const pct = ((bars[i].close - prev) / prev) * 100;
              const volUp = (bars[i].volume || 0) > (bars[i - 1].volume || 0);
              fpLineData.push({ time: btime(bars[i]), value: 5 });
              if (pct >= 4 && volUp) {
                fpMarkers.push({ time: btime(bars[i]), position: "aboveBar", color: "#22d3ee", shape: "arrowUp", size: 0.5, text: `+${pct.toFixed(0)}%` });
              } else if (pct <= -4 && volUp) {
                fpMarkers.push({ time: btime(bars[i]), position: "aboveBar", color: "#f472b6", shape: "arrowDown", size: 0.5, text: `${pct.toFixed(0)}%` });
              }
            }
            fpMarkers.sort((a, b) => typeof a.time === "string" ? a.time.localeCompare(b.time) : a.time - b.time);
            fourPctSeriesRef.current.setData(fpLineData);
            fourPctSeriesRef.current.setMarkers(fpMarkers);
          }

          // Earnings markers (EPS | Sales YoY). Rendered on two hidden line
          // series:
          //   crErLineRef   — bottom of the CR% pane (legacy placement)
          //   mainErLineRef — bottom of the main price pane (user request;
          //                   aligned to the earnings candle, ~5% from the
          //                   pane floor via the 'er-overlay' priceScale)
          const erRows = [];
          if (quarters && quarters.length > 0 && tf !== "30m") {
            const barDates = new Set(bars.map(b => b.date));
            for (const q of quarters) {
              if (!q.report_date) continue;
              let matchDate = q.report_date;
              if (!barDates.has(matchDate)) {
                const d = new Date(matchDate + "T00:00:00");
                for (let j = 1; j <= 5; j++) {
                  d.setDate(d.getDate() + 1);
                  const ds = d.toISOString().slice(0, 10);
                  if (barDates.has(ds)) { matchDate = ds; break; }
                }
              }
              if (!barDates.has(matchDate)) continue;
              const ePct = q.eps_yoy != null ? `${q.eps_yoy > 0 ? "+" : ""}${q.eps_yoy.toFixed(0)}%` : "";
              const sPct = q.sales_yoy != null ? `${q.sales_yoy > 0 ? "+" : ""}${q.sales_yoy.toFixed(0)}%` : "";
              if (!ePct && !sPct) continue;
              const txt = ePct && sPct ? `${ePct} | ${sPct}` : ePct || sPct;
              const clr = q.eps_yoy > 0 ? "#2bb886" : q.eps_yoy < 0 ? "#f87171" : "#9090a0";
              erRows.push({ time: matchDate, txt, clr });
            }
            erRows.sort((a, b) => a.time.localeCompare(b.time));
          }
          if (crErLineRef.current) {
            crErLineRef.current.setData(erRows.map(r => ({ time: r.time, value: 5 })));
            crErLineRef.current.setMarkers(
              erRows.map(r => ({ time: r.time, position: "aboveBar", color: r.clr, shape: "square", size: 0, text: r.txt }))
            );
          }
          if (mainErLineRef.current) {
            mainErLineRef.current.setData(erRows.map(r => ({ time: r.time, value: 0 })));
            mainErLineRef.current.setMarkers(
              erRows.map(r => ({ time: r.time, position: "aboveBar", color: r.clr, shape: "square", size: 0, text: r.txt }))
            );
          }

          // Reference lines (create once)
          if (!crSeriesRef.current._refLinesAdded) {
            try {
              crSeriesRef.current.createPriceLine({ price: 85, color: "#2bb88640", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
              crSeriesRef.current.createPriceLine({ price: 50, color: "#4a4a5a30", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
              crSeriesRef.current._refLinesAdded = true;
            } catch {}
          }
        }

        // ── ATRX Pro: Distance from MAs in ATR% units + VCS ──
        if (atrxSeriesRefs.current.sma50 && bars.length > 50) {
          const ATR_LEN = 14, SMA50_LEN = 50, DMA20_LEN = 20, EMA10W_LEN = 50;
          // RMA (Wilder's smoothing) for ATR
          const calcRMA = (vals, period) => {
            const out = []; let prev = null;
            for (let i = 0; i < vals.length; i++) {
              if (i < period - 1) { out.push(null); continue; }
              if (prev == null) { prev = vals.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period; }
              else { prev = (prev * (period - 1) + vals[i]) / period; }
              out.push(prev);
            }
            return out;
          };
          // True Range
          const trArr = bars.map((b, i) => {
            if (i === 0) return b.high - b.low;
            const pc = bars[i - 1].close;
            return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
          });
          const atrArr = calcRMA(trArr, ATR_LEN);
          const atrPct = atrArr.map((a, i) => a != null && closes[i] > 0 ? a / closes[i] : null);

          // Distance from MAs in ATR% units
          const ema10wArr = calcEMA(closes, EMA10W_LEN);
          const dist50 = [], dist20 = [], dist10w = [];
          for (let i = 0; i < bars.length; i++) {
            const ap = atrPct[i];
            if (ap == null || ap === 0) { dist50.push(null); dist20.push(null); dist10w.push(null); continue; }
            const s50 = sma50[i]; const s20 = sma20[i]; const e10w = ema10wArr[i];
            dist50.push(s50 ? ((closes[i] - s50) / s50) / ap : null);
            dist20.push(s20 ? ((closes[i] - s20) / s20) / ap : null);
            dist10w.push(e10w ? ((closes[i] - e10w) / e10w) / ap : null);
          }

          // Include ALL bars so logical indices align with main chart (use value 0 for warmup)
          const toAtrxLine = (arr) => arr.map((v, i) => ({ time: btime(bars[i]), value: v != null ? Math.round(v * 100) / 100 : 0 }));

          atrxSeriesRefs.current.sma50.setData(toAtrxLine(dist50));
          atrxSeriesRefs.current.dma20.setData(toAtrxLine(dist20));
          atrxSeriesRefs.current.ema10w.setData(toAtrxLine(dist10w));

          // ATRX dashboard stats — last values + Day vs ADR
          const lastI = bars.length - 1;
          const ADR_LEN = 20;
          let adrSum = 0, adrCount = 0;
          for (let i = Math.max(0, lastI - ADR_LEN + 1); i <= lastI; i++) {
            if (bars[i - 1]) { adrSum += (bars[i].high - bars[i].low) / bars[i - 1].close; adrCount++; }
          }
          const adrPct = adrCount > 0 ? (adrSum / adrCount) * 100 : null;
          const dayChgPct = lastI > 0 ? Math.abs((closes[lastI] - closes[lastI - 1]) / closes[lastI - 1] * 100) : null;
          const dayVsAdr = adrPct > 0 && dayChgPct != null ? (dayChgPct / adrPct) * 100 : null;
          setAtrxStats({
            d20: dist20[lastI], d50: dist50[lastI], d10w: dist10w[lastI],
            dayVsAdr, adrPct,
            rawD20: sma20[lastI] ? ((closes[lastI] - sma20[lastI]) / sma20[lastI] * 100) : null,
            rawD50: sma50[lastI] ? ((closes[lastI] - sma50[lastI]) / sma50[lastI] * 100) : null,
            rawD10w: ema10wArr[lastI] ? ((closes[lastI] - ema10wArr[lastI]) / ema10wArr[lastI] * 100) : null,
          });

          // RMV (Relative Measured Volatility) — daily range vs 15-day avg range
          // RMV 0-15 = tight consolidation (highlighted green on ATRX pane)
          const RMV_LEN = 15;
          if (atrxSeriesRefs.current.rmv && bars.length > RMV_LEN) {
            const rmvData = [];
            const dailyRanges = bars.map(b => b.high - b.low);
            for (let i = 0; i < bars.length; i++) {
              if (i < RMV_LEN) { rmvData.push({ time: btime(bars[i]), value: 0, color: "transparent" }); continue; }
              const avgRange = dailyRanges.slice(i - RMV_LEN, i).reduce((s, v) => s + v, 0) / RMV_LEN;
              const rmv = avgRange > 0 ? (dailyRanges[i] / avgRange) * 100 : 50;
              // Highlight when RMV <= 15 (tight consolidation) — fill pane with color
              if (rmv <= 15) {
                rmvData.push({ time: btime(bars[i]), value: 100, color: "#2bb88630" });
              } else if (rmv <= 30) {
                rmvData.push({ time: btime(bars[i]), value: 100, color: "#2bb88615" });
              } else {
                rmvData.push({ time: btime(bars[i]), value: 0, color: "transparent" });
              }
            }
            atrxSeriesRefs.current.rmv.setData(rmvData);
            // Add RMV to stats
            const lastRmv = bars.length > RMV_LEN ? (() => {
              const avgR = dailyRanges.slice(-RMV_LEN - 1, -1).reduce((s, v) => s + v, 0) / RMV_LEN;
              return avgR > 0 ? Math.round(dailyRanges[lastI] / avgR * 100) : null;
            })() : null;
            setAtrxStats(prev => prev ? { ...prev, rmv: lastRmv } : prev);
          }

          // VCS (Volatility Contraction Score)
          const vcsMarkers = [];
          const vcsLine = [];
          const VCS_SHORT = 5, VCS_LONG = 20, VCS_PEAK_LB = 40, VCS_VOL_SHORT = 5, VCS_VOL_LONG = 50, VCS_RANGE_LEN = 10;
          const atrShort = calcRMA(trArr, VCS_SHORT);
          const atrLong = calcRMA(trArr, VCS_LONG);
          const volArr = bars.map(b => b.volume || 0);
          const volShort = calcSMA(volArr, VCS_VOL_SHORT);
          const volLong = calcSMA(volArr, VCS_VOL_LONG);

          for (let i = Math.max(VCS_PEAK_LB, VCS_VOL_LONG); i < bars.length; i++) {
            // ATR contraction: short vs peak
            let peakAtr = 0;
            for (let j = i - VCS_PEAK_LB; j <= i; j++) { if (atrLong[j] > peakAtr) peakAtr = atrLong[j]; }
            const peakRatio = peakAtr > 0 ? atrShort[i] / peakAtr : 1;
            const trendRatio = atrLong[i] > 0 ? atrShort[i] / atrLong[i] : 1;
            const blendRatio = peakRatio * 0.6 + trendRatio * 0.4;
            const atrScore = Math.max(0, Math.min(100, (1 - blendRatio) * 100));
            // Volume dry-up
            const volRatio = volLong[i] > 0 ? volShort[i] / volLong[i] : 1;
            const volScore = Math.max(0, Math.min(100, (1 - volRatio) * 100));
            // Range consistency
            let narrowCount = 0;
            for (let j = 0; j < VCS_RANGE_LEN && i - j - 1 >= 0; j++) {
              if ((highs[i - j] - lows[i - j]) < (highs[i - j - 1] - lows[i - j - 1])) narrowCount++;
            }
            const consScore = (narrowCount / VCS_RANGE_LEN) * 100;
            // Structure
            let strucScore = 0;
            const s50v = sma50[i], s20v = sma20[i], e10wv = ema10wArr[i];
            if (s20v && closes[i] >= s20v) { strucScore += 20; if ((closes[i] - s20v) / s20v < 0.03) strucScore += 5; }
            if (s50v && closes[i] >= s50v) { strucScore += 20; if ((closes[i] - s50v) / s50v < 0.05) strucScore += 5; }
            if (e10wv && closes[i] >= e10wv) { strucScore += 20; if ((closes[i] - e10wv) / e10wv < 0.05) strucScore += 5; }
            let recentHigh = 0;
            for (let j = i - VCS_PEAK_LB; j <= i; j++) { if (highs[j] > recentHigh) recentHigh = highs[j]; }
            const distHigh = recentHigh > 0 ? ((recentHigh - closes[i]) / recentHigh) * 100 : 100;
            if (distHigh <= 10) strucScore += 25 * (1 - distHigh / 10);
            strucScore = Math.min(100, strucScore);
            // Composite
            const vcs = (atrScore * 35 + volScore * 30 + consScore * 20 + strucScore * 15) / 100;
            vcsLine.push({ time: btime(bars[i]), value: 0 });
            const color = vcs >= 80 ? "#2bb886" : vcs >= 60 ? "#3b82f6" : "#68687840";
            if (vcs >= 60) {
              vcsMarkers.push({ time: btime(bars[i]), position: "aboveBar", color, shape: "square", size: 0, text: `${Math.round(vcs)}` });
            }
          }
          if (atrxSeriesRefs.current.vcs) {
            atrxSeriesRefs.current.vcs.setData(vcsLine);
            vcsMarkers.sort((a, b) => typeof a.time === "string" ? a.time.localeCompare(b.time) : a.time - b.time);
            atrxSeriesRefs.current.vcs.setMarkers(vcsMarkers);
          }

          // Reference lines (create once)
          if (!atrxSeriesRefs.current.sma50._refLinesAdded) {
            try {
              atrxSeriesRefs.current.sma50.createPriceLine({ price: 0, color: "#ffffff40", lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
              atrxSeriesRefs.current.sma50.createPriceLine({ price: 4, color: "#fbbf2440", lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
              atrxSeriesRefs.current.sma50.createPriceLine({ price: 6, color: "#f9731640", lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
              atrxSeriesRefs.current.sma50.createPriceLine({ price: 8, color: "#ef444440", lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
              atrxSeriesRefs.current.sma50._refLinesAdded = true;
            } catch {}
          }
        }

        // Show last 3 months (63 daily bars, 13 weekly, 3 monthly) — maximized
        const totalBars = bars.length;
        const visBars = tf === "30m" ? totalBars : tf === "W" ? 13 : tf === "M" ? 3 : 63;
        const fromBar = totalBars > visBars ? totalBars - visBars : 0;
        const visRange = { from: fromBar, to: totalBars + (tf === "30m" ? 5 : tf === "D" ? 5 : tf === "W" ? 2 : 1) };
        chartRef.current.timeScale().setVisibleLogicalRange(visRange);
        if (atrxChartRef.current) try { atrxChartRef.current.timeScale().setVisibleLogicalRange(visRange); } catch {}

        // ── Compute volume stats for data box ──
        const last = bars[bars.length - 1];
        const lastVol = last?.volume || 0;
        // 50-day avg volume
        const recent50 = bars.slice(-50);
        const avgVol50 = recent50.reduce((s, c) => s + (c.volume || 0), 0) / recent50.length;
        const volChgPct = avgVol50 > 0 ? ((lastVol / avgVol50 - 1) * 100) : 0;
        const avgDolVol = avgVol50 * (last?.close || 0);
        // U/D ratio (50 day)
        let upVol = 0, downVol = 0;
        recent50.forEach(c => {
          if (c.close >= c.open) upVol += (c.volume || 0);
          else downVol += (c.volume || 0);
        });
        const udRatio = downVol > 0 ? (upVol / downVol) : 0;
        // Count pocket pivots in visible range
        const ppCount10 = volumes.filter(v => v.color === "#2563eb").length;
        const ppCount5 = volumes.filter(v => v.color === "#0d9488").length;
        const hiVolEver = volumes.filter(v => v.color === "#d946ef").length;
        const hiVolYear = volumes.filter(v => v.color === "#a855f7").length;

        // ── MA Spread % + Percentile Rank ──
        const li = bars.length - 1;
        const lastEma10 = ema10[li], lastEma21 = ema21close[li];
        const spread10_21 = lastEma10 && lastEma21 ? ((lastEma10 - lastEma21) / lastEma21 * 100) : null;
        const spread21_50 = lastEma21 && lastSma50 ? ((lastEma21 - lastSma50) / lastSma50 * 100) : null;

        // Percentile rank over last 126 bars
        const pctRank = (series10, series21, lookback) => {
          const spreads = [];
          for (let i = 0; i < bars.length; i++) {
            if (series10[i] != null && series21[i] != null && series21[i] !== 0) {
              spreads.push({ idx: i, val: (series10[i] - series21[i]) / series21[i] * 100 });
            }
          }
          if (spreads.length < 2) return null;
          const current = spreads[spreads.length - 1].val;
          const window = spreads.slice(-lookback);
          let count = 0;
          for (let i = 0; i < window.length - 1; i++) {
            if (current > window[i].val) count++;
          }
          return Math.round((count / (window.length - 1)) * 100);
        };
        const rank10_21 = pctRank(ema10, ema21close, 126);
        const rank21_50 = pctRank(ema21close, sma50, 126);

        const rankLabel = (pctile, spread) => {
          if (pctile == null) return "—";
          const isLong = (spread || 0) >= 0;
          if (pctile >= 90) return isLong ? "OVEREXT" : "OVEREXT↓";
          if (pctile >= 75) return isLong ? "EXTENDED" : "EXTEND↓";
          if (pctile >= 25) return "NORMAL";
          if (pctile >= 10) return "TIGHT";
          return "COMPRESSED";
        };

        setVolStats({ avgVol50, lastVol, volChgPct, avgDolVol, udRatio, ppCount10, ppCount5, hiVolEver, hiVolYear,
          spread10_21, spread21_50, rank10_21, rank21_50,
          rankLbl10_21: rankLabel(rank10_21, spread10_21), rankLbl21_50: rankLabel(rank21_50, spread21_50),
          // ATRX current
          atrx: lastSma50 && lastAtr && lastAtr > 0 ? (lastClose - lastSma50) / lastAtr : null,
          // ATR ladder
          atr: lastAtr, sma50val: lastSma50,
          maxEntry: lastSma50 && lastAtr ? lastSma50 + 4 * lastAtr : null,
          atr7: lastSma50 && lastAtr ? lastSma50 + 7 * lastAtr : null,
          atr8: lastSma50 && lastAtr ? lastSma50 + 8 * lastAtr : null,
          atr10: lastSma50 && lastAtr ? lastSma50 + 10 * lastAtr : null,
          lodEntry: lastLow && lastAtr ? lastLow + lastAtr * 0.6 : null,
          tight: lastAtr ? lastClose - lastAtr * 0.5 : null,
          base: lastAtr ? lastClose - lastAtr : null,
          wide: lastAtr ? lastClose - lastAtr * 2.0 : null,
          // Reference prices
          wk52High, athHigh, dayLow: lastLow, prevDayLow: prevLow,
        });
  }, [rawBars, tf, libReady, aggregateBars, entry, stop, target, quarters]);

  // Toggle CR% / 4% Days visibility
  useEffect(() => {
    if (crSeriesRef.current) try { crSeriesRef.current.applyOptions({ visible: showCR }); } catch {}
    if (crMaRef.current) try { crMaRef.current.applyOptions({ visible: showCR }); } catch {}
    if (crpSeriesRef.current) try { crpSeriesRef.current.applyOptions({ visible: showCRP }); } catch {}
    if (fourPctSeriesRef.current) try { fourPctSeriesRef.current.applyOptions({ visible: show4Pct }); } catch {}
  }, [showCR, showCRP, show4Pct]);

  // Price lines now managed inside data fetch useEffect (with ATR ladder, risk stops, etc.)

  const fmtVol = (v) => {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return v.toFixed(0);
  };

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 300, display: "flex", flexDirection: "column" }}>
      {/* CR% + 4% Days combined panel (top, collapsible) */}
      <div style={{ position: "relative", flexShrink: 0, borderBottom: "1px solid #2a2a38" }}>
        <div ref={crContainerRef} style={{ width: "100%", height: topPaneOpen ? 90 : 0, overflow: "hidden", transition: "height 0.15s ease" }} />
        <div style={{ position: "absolute", top: 2, left: 4, fontSize: 8, zIndex: 5, display: "flex", gap: 6, alignItems: "center" }}>
          <span onClick={() => setTopPaneOpen(p => !p)}
            style={{ cursor: "pointer", color: "#505060", userSelect: "none", fontWeight: 600 }}>
            {topPaneOpen ? "▼" : "▶"}
          </span>
          <span onClick={() => setShowCR(p => !p)}
            style={{ cursor: "pointer", color: showCR ? "#2bb886" : "#3a3a4a", fontWeight: 600, userSelect: "none" }}>
            CR%
          </span>
          <span onClick={() => setShowCRP(p => !p)}
            style={{ cursor: "pointer", color: showCRP ? "#60a5fa" : "#3a3a4a", fontWeight: 600, userSelect: "none" }}>
            CRP
          </span>
          <span onClick={() => setShowATRX(p => !p)}
            style={{ cursor: "pointer", color: showATRX ? "#2962FF" : "#3a3a4a", fontWeight: 600, userSelect: "none" }}>
            ATRX
          </span>
          <span onClick={() => setShow4Pct(p => !p)}
            style={{ cursor: "pointer", userSelect: "none" }}>
            <span style={{ color: show4Pct ? "#22d3ee" : "#3a3a4a" }}>4%</span><span style={{ color: show4Pct ? "#f472b6" : "#3a3a4a" }}>Days</span>
          </span>
        </div>
        {!topPaneOpen && <div style={{ height: 16 }} />}
      </div>
      {/* ATRX Pro pane */}
      <div style={{ position: "relative", flexShrink: 0, borderBottom: showATRX ? "1px solid #2a2a38" : "none" }}>
        <div ref={atrxContainerRef} style={{ width: "100%", height: showATRX ? 110 : 0, overflow: "hidden", transition: "height 0.15s ease" }} />
        {showATRX && <>
          <div style={{ position: "absolute", top: 2, left: 4, fontSize: 8, zIndex: 5, display: "flex", gap: 8, alignItems: "center", pointerEvents: "none" }}>
            <span style={{ color: "#2962FF", fontWeight: 600 }}>50SMA</span>
            <span style={{ color: "#00BCD4", fontWeight: 600 }}>20DMA</span>
            <span style={{ color: "#AB47BC", fontWeight: 600 }}>10WEMA</span>
            <span style={{ color: "#505060" }}>ATRx</span>
          </div>
          {atrxStats && <div style={{ position: "absolute", top: 2, right: 4, zIndex: 5, pointerEvents: "none",
            fontSize: 9, fontFamily: "monospace", display: "flex", gap: 8, alignItems: "center" }}>
            {[
              { label: "20D", val: atrxStats.d20, raw: atrxStats.rawD20, color: "#00BCD4" },
              { label: "50S", val: atrxStats.d50, raw: atrxStats.rawD50, color: "#2962FF" },
              { label: "10W", val: atrxStats.d10w, raw: atrxStats.rawD10w, color: "#AB47BC" },
            ].map(({ label, val, raw, color }) => {
              const absV = Math.abs(val ?? 0);
              const c = absV >= 8 ? "#ef4444" : absV >= 6 ? "#f97316" : absV >= 4 ? "#fbbf24" : color;
              return <span key={label} style={{ color: c }}>
                {label} <b>{val != null ? `${val > 0 ? "+" : ""}${val.toFixed(1)}x` : "—"}</b>
                <span style={{ color: "#505060", fontSize: 8 }}>{raw != null ? ` ${raw > 0 ? "+" : ""}${raw.toFixed(1)}%` : ""}</span>
              </span>;
            })}
            {atrxStats.dayVsAdr != null && (() => {
              const dv = atrxStats.dayVsAdr;
              const c = dv >= 80 ? "#ef4444" : dv >= 60 ? "#fbbf24" : dv < 50 ? "#2bb886" : "#686878";
              return <span style={{ color: c }}>DvA <b>{dv.toFixed(0)}%</b></span>;
            })()}
            {atrxStats.rmv != null && (() => {
              const r = atrxStats.rmv;
              const c = r <= 15 ? "#2bb886" : r <= 30 ? "#4a9070" : r >= 80 ? "#ef4444" : "#686878";
              return <span style={{ color: c }}>RMV <b>{r}</b></span>;
            })()}
          </div>}
        </>}
      </div>
      {/* Main chart */}
      <div ref={wrapperRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      {loading && <div style={{ position: "absolute", top: 8, left: 8, fontSize: 10, color: "#fbbf24", zIndex: 5, pointerEvents: "none" }}>Loading {ticker}...</div>}
      {error && <div style={{ position: "absolute", top: 8, left: 8, fontSize: 10, color: "#f87171", zIndex: 5, pointerEvents: "none" }}>⚠ {error}</div>}
      {!libReady && <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 11, color: "#505060", zIndex: 5 }}>Loading chart library...</div>}
      {/* Volume stats data box — top left */}
      {volStats && (
        <div style={{ position: "absolute", top: 6, left: 8, zIndex: 5, pointerEvents: "none",
          fontSize: 9, fontFamily: "monospace", color: "#686878", lineHeight: 1.6 }}>
          {/* ATRX */}
          {volStats.atrx != null && (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: volStats.atrx >= 7 ? "#ffd700" : volStats.atrx >= 4 ? "#2bb886" : volStats.atrx <= -7 ? "#ffd700" : volStats.atrx <= -4 ? "#f87171" : "#787888" }}>
                ATRX: {volStats.atrx.toFixed(1)}
              </span>
            </div>
          )}
          <div>Daily Vol: <span style={{ color: "#b0b0be" }}>{fmtVol(volStats.lastVol)}</span>
            <span style={{ color: volStats.volChgPct >= 0 ? "#2bb886" : "#f87171", marginLeft: 4 }}>
              {volStats.volChgPct >= 0 ? "+" : ""}{volStats.volChgPct.toFixed(0)}%
            </span>
          </div>
          {/* MA Spread Table */}
          {volStats.spread10_21 != null && (
            <div style={{ marginTop: 4, borderTop: "1px solid #2a2a38", paddingTop: 3 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <span>10/21</span>
                <span style={{ color: volStats.spread10_21 >= 0 ? "#2bb886" : "#f87171" }}>
                  {volStats.spread10_21 >= 0 ? "+" : ""}{volStats.spread10_21.toFixed(2)}%
                </span>
                <span style={{ color: "#787888" }}>{volStats.rank10_21 != null ? `${volStats.rank10_21}th` : "—"}</span>
                <span style={{ color:
                  volStats.rankLbl10_21 === "OVEREXT" || volStats.rankLbl10_21 === "OVEREXT↓" ? "#f87171" :
                  volStats.rankLbl10_21 === "EXTENDED" || volStats.rankLbl10_21 === "EXTEND↓" ? "#f97316" :
                  volStats.rankLbl10_21 === "COMPRESSED" ? "#60a5fa" :
                  volStats.rankLbl10_21 === "TIGHT" ? "#9ca3af" : "#2bb886"
                }}>{volStats.rankLbl10_21}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <span>21/50</span>
                <span style={{ color: volStats.spread21_50 >= 0 ? "#2bb886" : "#f87171" }}>
                  {volStats.spread21_50 >= 0 ? "+" : ""}{volStats.spread21_50.toFixed(2)}%
                </span>
                <span style={{ color: "#787888" }}>{volStats.rank21_50 != null ? `${volStats.rank21_50}th` : "—"}</span>
                <span style={{ color:
                  volStats.rankLbl21_50 === "OVEREXT" || volStats.rankLbl21_50 === "OVEREXT↓" ? "#f87171" :
                  volStats.rankLbl21_50 === "EXTENDED" || volStats.rankLbl21_50 === "EXTEND↓" ? "#f97316" :
                  volStats.rankLbl21_50 === "COMPRESSED" ? "#60a5fa" :
                  volStats.rankLbl21_50 === "TIGHT" ? "#9ca3af" : "#2bb886"
                }}>{volStats.rankLbl21_50}</span>
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{ position: "absolute", bottom: 4, right: 8, fontSize: 8, color: "#2a2a38", zIndex: 5, pointerEvents: "none" }}>
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#2a2a38", textDecoration: "none", pointerEvents: "auto" }}>Powered by TradingView</a>
      </div>
      </div>
      {/* Volume panel */}
      <div style={{ position: "relative", flexShrink: 0, borderTop: "1px solid #2a2a38" }}>
        <div ref={volContainerRef} style={{ width: "100%", height: 120 }} />
        <div style={{ position: "absolute", top: 2, left: 4, fontSize: 8, color: "#505060", zIndex: 5, pointerEvents: "none" }}>Vol</div>
      </div>
    </div>
  );
}

// ── Exports ──────────────────────────────────────────────────────────
export { LWChart, IntradayChart, loadLW };
