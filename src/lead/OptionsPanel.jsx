import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "../utils.js";
import {
  Card,
  FlagButton,
  MONO,
  RslDot,
  TierMark,
  etClock,
  fmtDollarVol,
  isEliteRs,
  rsLeads,
  td,
  th,
  useFlags,
} from "./core.jsx";
import {
  aggregateMultiTickerScan,
  analyzeOptionChain,
  detectUnusualFlow,
  findSwingCallSetups,
} from "./optionsMath.js";
import { NDX_CONSTITUENTS } from "./qqqMath.js";

// ── Formatting helpers ───────────────────────────────────────────────────────
const fmtPx = (v) => (v == null || !Number.isFinite(v) ? "—" : `$${v.toFixed(2)}`);
const fmtStrike = (v) => (v == null || !Number.isFinite(v) ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));
const fmtPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const fmtIv = (v) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtInt = (v) => (v == null || !Number.isFinite(v) ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : v.toLocaleString());
const fmtExpShort = (iso) => {
  if (!iso || iso.length < 10) return iso || "—";
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m - 1] || m} ${d}`;
};
const isMonthlyOpex = (iso) => {
  if (!iso || iso.length < 10) return false;
  const dt = new Date(`${iso}T12:00:00Z`);
  return dt.getUTCDay() === 5 && dt.getUTCDate() >= 15 && dt.getUTCDate() <= 21;
};

const INDEX_CHIPS = ["SPY", "QQQ", "IWM"];

// ── Strike OI / Net GEX Wall SVG Chart ───────────────────────────────────────
function StrikeProfileChart({ analysis, A }) {
  const [mode, setMode] = useState("oi"); // "oi" | "gex"
  const [hoverIdx, setHoverIdx] = useState(null);
  const rows = analysis?.strikeProfile || [];
  if (rows.length < 3) return null;

  const W = 680;
  const H = 148;
  const pad = { top: 18, right: 14, bottom: 24, left: 46 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const midY = pad.top + plotH / 2;
  const n = rows.length;
  const step = plotW / n;
  const barW = Math.max(3, Math.min(18, step * 0.68));

  const maxOi = Math.max(1, ...rows.map((r) => Math.max(r.callOi, r.putOi)));
  const maxGex = Math.max(1, ...rows.map((r) => Math.abs(r.netGex)));

  const xOfIdx = (i) => pad.left + (i + 0.5) * step;
  const xOfPrice = (px) => {
    if (px == null || !Number.isFinite(px)) return null;
    const first = rows[0].strike;
    const last = rows[n - 1].strike;
    if (last <= first) return null;
    if (px < first || px > last) return null;
    // Piecewise linear interpolation across strike indices
    for (let i = 0; i < n - 1; i++) {
      if (px >= rows[i].strike && px <= rows[i + 1].strike) {
        const frac = (px - rows[i].strike) / Math.max(1e-9, rows[i + 1].strike - rows[i].strike);
        return xOfIdx(i + frac);
      }
    }
    return null;
  };

  const spotX = xOfPrice(analysis.spot);
  const mpX = xOfPrice(analysis.maxPain?.strike);
  const emLoX = xOfPrice(analysis.expectedMove?.lower);
  const emHiX = xOfPrice(analysis.expectedMove?.upper);
  const hovered = hoverIdx != null ? rows[hoverIdx] : null;

  const labelStep = Math.max(1, Math.ceil(n / 9));

  return (
    <div style={{ marginTop: 10, paddingTop: 9, borderTop: `1px solid ${A.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: A.textDim, letterSpacing: 0.4, textTransform: "uppercase" }}>
            Strike Positioning
          </span>
          {[["oi", "OI Walls"], ["gex", "Net GEX"]].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              style={{
                background: mode === k ? `${A.green}20` : "transparent",
                border: `1px solid ${mode === k ? A.green : A.border}`,
                color: mode === k ? A.green : A.textMuted,
                borderRadius: 5,
                padding: "1px 7px",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 10, color: A.textMuted, fontFamily: MONO }}>
          {hovered ? (
            <>
              <strong style={{ color: A.text }}>${fmtStrike(hovered.strike)}</strong>
              <span style={{ color: A.green }}>C-OI {fmtInt(hovered.callOi)}</span>
              <span style={{ color: A.red }}>P-OI {fmtInt(hovered.putOi)}</span>
              <span style={{ color: hovered.netGex >= 0 ? A.green : A.red }}>
                GEX {fmtDollarVol(hovered.netGex, true)}
              </span>
            </>
          ) : (
            <>
              <span><span style={{ color: A.green }}>■</span> {mode === "oi" ? "Call OI" : "+GEX"}</span>
              <span><span style={{ color: A.red }}>■</span> {mode === "oi" ? "Put OI" : "−GEX"}</span>
              {analysis.expectedMove && <span><span style={{ color: A.cyan }}>░</span> ±1σ EM</span>}
              {analysis.maxPain && <span><span style={{ color: "#fbbf24" }}>┊</span> Max Pain ${fmtStrike(analysis.maxPain.strike)}</span>}
            </>
          )}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Expected Move band */}
        {emLoX != null && emHiX != null && emHiX > emLoX && (
          <rect
            x={emLoX}
            y={pad.top}
            width={emHiX - emLoX}
            height={plotH}
            fill={`${A.cyan || "#22d3ee"}14`}
          />
        )}

        {/* Zero midline */}
        <line x1={pad.left} x2={W - pad.right} y1={midY} y2={midY} stroke={A.borderLight} strokeWidth="1" />

        {/* Y-axis labels */}
        <text x={pad.left - 5} y={pad.top + 8} textAnchor="end" fontSize="9" fontFamily={MONO} fill={A.green}>
          {mode === "oi" ? fmtInt(maxOi) : fmtDollarVol(maxGex, true)}
        </text>
        <text x={pad.left - 5} y={midY + 3} textAnchor="end" fontSize="9" fontFamily={MONO} fill={A.textMuted}>
          0
        </text>
        <text x={pad.left - 5} y={H - pad.bottom - 2} textAnchor="end" fontSize="9" fontFamily={MONO} fill={A.red}>
          {mode === "oi" ? fmtInt(maxOi) : fmtDollarVol(-maxGex, true)}
        </text>

        {/* Strike bars */}
        {rows.map((r, i) => {
          const cx = xOfIdx(i);
          const x = cx - barW / 2;
          const isHover = hoverIdx === i;
          const isCW = analysis.callWall?.strike === r.strike;
          const isPW = analysis.putWall?.strike === r.strike;

          if (mode === "oi") {
            const cH = (r.callOi / maxOi) * (plotH / 2 - 3);
            const pH = (r.putOi / maxOi) * (plotH / 2 - 3);
            return (
              <g key={r.strike} onMouseEnter={() => setHoverIdx(i)} style={{ cursor: "crosshair" }}>
                <rect x={cx - step / 2} y={pad.top} width={step} height={plotH} fill={isHover ? `${A.text}0c` : "transparent"} />
                {cH > 0.5 && (
                  <rect
                    x={x}
                    y={midY - cH}
                    width={barW}
                    height={cH}
                    rx="1.5"
                    fill={isCW ? A.green : `${A.green}b0`}
                  />
                )}
                {pH > 0.5 && (
                  <rect
                    x={x}
                    y={midY}
                    width={barW}
                    height={pH}
                    rx="1.5"
                    fill={isPW ? A.red : `${A.red}b0`}
                  />
                )}
              </g>
            );
          }

          const gH = (Math.abs(r.netGex) / maxGex) * (plotH / 2 - 3);
          const pos = r.netGex >= 0;
          return (
            <g key={r.strike} onMouseEnter={() => setHoverIdx(i)} style={{ cursor: "crosshair" }}>
              <rect x={cx - step / 2} y={pad.top} width={step} height={plotH} fill={isHover ? `${A.text}0c` : "transparent"} />
              {gH > 0.5 && (
                <rect
                  x={x}
                  y={pos ? midY - gH : midY}
                  width={barW}
                  height={gH}
                  rx="1.5"
                  fill={pos ? A.green : A.red}
                  opacity={isHover ? 1 : 0.85}
                />
              )}
            </g>
          );
        })}

        {/* Max Pain dashed marker */}
        {mpX != null && (
          <line x1={mpX} x2={mpX} y1={pad.top} y2={H - pad.bottom} stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="3 2" />
        )}

        {/* Spot vertical marker */}
        {spotX != null && (
          <g>
            <line x1={spotX} x2={spotX} y1={pad.top - 4} y2={H - pad.bottom} stroke={A.text} strokeWidth="1.4" strokeDasharray="2 2" />
            <text x={spotX} y={pad.top - 6} textAnchor="middle" fontSize="9" fontWeight="700" fontFamily={MONO} fill={A.text}>
              Spot {analysis.spot.toFixed(1)}
            </text>
          </g>
        )}

        {/* Strike X-axis ticks */}
        {rows.map((r, i) => {
          if (i % labelStep !== 0 && i !== n - 1) return null;
          return (
            <text
              key={`lbl-${r.strike}`}
              x={xOfIdx(i)}
              y={H - 7}
              textAnchor="middle"
              fontSize="9"
              fontFamily={MONO}
              fill={A.textMuted}
            >
              {fmtStrike(r.strike)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ── Main OptionsPanel ────────────────────────────────────────────────────────
export default function OptionsPanel({
  A,
  stockMap,
  portfolio = [],
  watchlist = [],
  chartTicker = "QQQ",
  onTicker,
}) {
  const ticker = (chartTicker || "QQQ").toUpperCase();
  const { flagged } = useFlags();

  const [subTab, setSubTab] = useState(() => {
    try {
      const s = localStorage.getItem("tp-options-subtab");
      if (s === "chain" || s === "swing" || s === "flow") return s;
    } catch { /* ignore */ }
    return "chain";
  });
  const pickSubTab = (t) => {
    setSubTab(t);
    try { localStorage.setItem("tp-options-subtab", t); } catch { /* ignore */ }
  };

  const [tickerInput, setTickerInput] = useState("");
  const [selectedDate, setSelectedDate] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Chain view controls
  const [chainSide, setChainSide] = useState("straddle"); // "straddle" | "calls" | "puts"
  const [strikeWindow, setStrikeWindow] = useState(12); // 10 | 20 | 999
  const [unusualOnly, setUnusualOnly] = useState(false);
  const [swingUseSelected, setSwingUseSelected] = useState(false);

  // Multi-ticker scanner state (shared by Swing Calls & Unusual Flow)
  const [scanUniverse, setScanUniverse] = useState("focus"); // "focus" | "elite" | "qqq"
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [scanCache, setScanCache] = useState({}); // { [universe]: { items, asOf } }
  const [flowSideFilter, setFlowSideFilter] = useState("all"); // "all" | "call" | "put"
  const [flowMinVolOi, setFlowMinVolOi] = useState(1.5);
  const [swingSort, setSwingSort] = useState({ k: "rs", d: -1 });
  const [flowSort, setFlowSort] = useState({ k: "notional", d: -1 });

  // Reset selected expiration when ticker changes
  const prevTickerRef = useRef(ticker);
  useEffect(() => {
    if (prevTickerRef.current !== ticker) {
      prevTickerRef.current = ticker;
      setSelectedDate(null);
      setSwingUseSelected(false);
    }
  }, [ticker]);

  // Fetch single-ticker live options chain
  useEffect(() => {
    let alive = true;
    const load = async (silent = false) => {
      if (!silent) { setLoading(true); setError(null); }
      try {
        const qs = new URLSearchParams({ ticker, swing: "1" });
        if (selectedDate) qs.set("date", String(selectedDate));
        const r = await authFetch(`/api/options?${qs.toString()}`);
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !j?.selected) {
          setError(j?.error || `No options data for ${ticker}`);
          if (!silent) setBundle(null);
        } else {
          setBundle(j);
          setError(null);
        }
      } catch (e) {
        if (alive && !silent) setError(e?.message || "Failed to load options chain");
      } finally {
        if (alive && !silent) setLoading(false);
      }
    };
    load(false);
    // Live 60s auto-refresh during RTH
    const id = setInterval(() => {
      if (!document.hidden && etClock().rth) load(true);
    }, 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [ticker, selectedDate, refreshNonce]);

  const stockInfo = stockMap?.[ticker] || null;
  const adr20 = stockInfo?.adr20 ?? stockInfo?.adr_pct ?? null;
  const earningsDays = stockInfo?.earnings_days ?? null;
  const earningsDisplay = stockInfo?.earnings_display || "";

  // Compute primary chain analytics
  const analysis = useMemo(() => {
    if (!bundle?.selected || !bundle?.spot) return null;
    return analyzeOptionChain(bundle.selected, bundle.spot, {
      ticker: bundle.ticker || ticker,
      adr20,
      earningsDays,
    });
  }, [bundle, ticker, adr20, earningsDays]);

  // Compute swing-expiry analytics (30–60 DTE preferred)
  const swingAnalysis = useMemo(() => {
    if (!bundle?.spot) return null;
    if (swingUseSelected || !bundle.swingChain) return analysis;
    return analyzeOptionChain(bundle.swingChain, bundle.spot, {
      ticker: bundle.ticker || ticker,
      adr20,
      earningsDays,
    });
  }, [bundle, analysis, swingUseSelected, ticker, adr20, earningsDays]);

  const swingSetups = useMemo(
    () => (swingAnalysis ? findSwingCallSetups(swingAnalysis, { earningsDays }) : []),
    [swingAnalysis, earningsDays]
  );

  // Active ticker unusual flow (selected + swing expiry deduplicated)
  const tickerFlow = useMemo(() => {
    const a = analysis ? detectUnusualFlow(analysis, { minVol: 50, minVolOi: 1.5, minNotional: 75_000, limit: 20 }) : [];
    const b = swingAnalysis && swingAnalysis !== analysis
      ? detectUnusualFlow(swingAnalysis, { minVol: 50, minVolOi: 1.5, minNotional: 100_000, limit: 12 })
      : [];
    const seen = new Set();
    return [...a, ...b]
      .filter((r) => {
        const k = r.sym || `${r.expDate}-${r.type}-${r.strike}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((x, y) => y.notional - x.notional || y.volOi - x.volOi);
  }, [analysis, swingAnalysis]);

  // Quick-switch ticker pools
  const eliteTop = useMemo(() => {
    return Object.values(stockMap || {})
      .filter((s) => isEliteRs(s))
      .sort((a, b) => (b.rs_rank ?? 0) - (a.rs_rank ?? 0) || (b.change_pct ?? 0) - (a.change_pct ?? 0))
      .slice(0, 18)
      .map((s) => s.ticker);
  }, [stockMap]);

  const focusTickers = useMemo(() => {
    const flaggedArr = [...(flagged || [])];
    const merged = [...new Set([...(portfolio || []), ...flaggedArr, ...(watchlist || [])])];
    return merged.filter(Boolean).slice(0, 20);
  }, [portfolio, watchlist, flagged]);

  const qqqTop = useMemo(() => {
    const inMap = NDX_CONSTITUENTS
      .map((x) => stockMap?.[x.t])
      .filter(Boolean)
      .sort((a, b) => (b.market_cap_raw ?? 0) - (a.market_cap_raw ?? 0))
      .slice(0, 18)
      .map((s) => s.ticker);
    return inMap.length ? ["QQQ", ...inMap.slice(0, 17)] : ["QQQ", "NVDA", "AAPL", "MSFT", "AMZN", "META", "AVGO", "GOOGL", "TSLA", "PLTR", "NFLX", "AMD"];
  }, [stockMap]);

  const scanTargetList = useMemo(() => {
    if (scanUniverse === "elite") return eliteTop;
    if (scanUniverse === "qqq") return qqqTop;
    return focusTickers.length ? focusTickers : ["SPY", "QQQ", ...eliteTop.slice(0, 14)];
  }, [scanUniverse, focusTickers, eliteTop, qqqTop]);

  const runBatchScan = useCallback(async (univKey, list) => {
    const tickers = (list || []).slice(0, 20);
    if (!tickers.length) return;
    setScanLoading(true);
    setScanError(null);
    try {
      const qs = new URLSearchParams({ mode: "scan", tickers: tickers.join(",") });
      const r = await authFetch(`/api/options?${qs.toString()}`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j?.items)) {
        setScanError(j?.error || "Options scan failed");
      } else {
        setScanCache((prev) => ({
          ...prev,
          [univKey]: { items: j.items, asOf: j.asOf || new Date().toISOString() },
        }));
      }
    } catch (e) {
      setScanError(e?.message || "Options scan failed");
    } finally {
      setScanLoading(false);
    }
  }, []);

  // Auto-run batch scan once when user opens Swing Calls or Unusual Flow and cache for active universe is empty
  useEffect(() => {
    if ((subTab === "swing" || subTab === "flow") && !scanCache[scanUniverse] && !scanLoading && scanTargetList.length > 0) {
      runBatchScan(scanUniverse, scanTargetList);
    }
  }, [subTab, scanUniverse, scanCache, scanLoading, scanTargetList, runBatchScan]);

  const scanAgg = useMemo(() => {
    const cached = scanCache[scanUniverse];
    if (!cached?.items?.length) return null;
    return aggregateMultiTickerScan(cached.items, stockMap);
  }, [scanCache, scanUniverse, stockMap]);

  // Chain rows centered around ATM
  const chainRows = useMemo(() => {
    if (!analysis) return [];
    const callByK = new Map(analysis.calls.map((c) => [c.strike, c]));
    const putByK = new Map(analysis.puts.map((p) => [p.strike, p]));
    const strikes = analysis.allStrikes;
    const atmIdx = strikes.indexOf(analysis.atmStrike);
    const slice = strikeWindow >= 999
      ? strikes
      : strikes.slice(Math.max(0, atmIdx - strikeWindow), Math.min(strikes.length, atmIdx + strikeWindow + 1));

    const out = slice.map((k) => ({
      strike: k,
      call: callByK.get(k) || null,
      put: putByK.get(k) || null,
      isAtm: k === analysis.atmStrike,
      isCW: analysis.callWall?.strike === k,
      isPW: analysis.putWall?.strike === k,
      isMP: analysis.maxPain?.strike === k,
    }));

    if (unusualOnly) {
      return out.filter((r) => r.call?.unusual || r.put?.unusual);
    }
    return out;
  }, [analysis, strikeWindow, unusualOnly]);

  // Sorted multi-ticker Swing Calls table
  const sortedSwingRows = useMemo(() => {
    const rows = [...(scanAgg?.swingRows || [])];
    const { k, d } = swingSort;
    const val = (r) => {
      if (k === "rs") return r.rs;
      if (k === "chg") return r.changePct;
      if (k === "dte") return r.setup?.dte;
      if (k === "delta") return r.setup?.delta;
      if (k === "mid") return r.setup?.mid;
      if (k === "spr") return r.setup?.spreadPct;
      if (k === "iv") return r.atmIv;
      if (k === "be") return r.setup?.breakevenPct;
      if (k === "gain") return r.setup?.estGain1Em;
      return r.rs;
    };
    rows.sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * d || a.ticker.localeCompare(b.ticker);
    });
    return rows;
  }, [scanAgg, swingSort]);

  // Filtered & sorted multi-ticker Unusual Flow table
  const sortedFlowRows = useMemo(() => {
    const rows = (scanAgg?.flowRows || []).filter((r) => {
      if (flowSideFilter !== "all" && r.type !== flowSideFilter) return false;
      if (flowMinVolOi > 0 && (r.volOi ?? 0) < flowMinVolOi && (r.notional ?? 0) < 250_000) return false;
      return true;
    });
    const { k, d } = flowSort;
    rows.sort((a, b) => {
      const av = a[k], bv = b[k];
      if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * d || b.notional - a.notional;
    });
    return rows;
  }, [scanAgg, flowSideFilter, flowMinVolOi, flowSort]);

  const submitTicker = (e) => {
    e.preventDefault();
    const sym = tickerInput.trim().toUpperCase();
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(sym)) {
      onTicker?.(sym);
      setTickerInput("");
    }
  };

  const pc = (v) => (v == null ? A.textMuted : v >= 0 ? A.green : A.red);
  const gradeColor = (g) => (g === "A" ? A.green : g === "B" ? A.cyan : g === "C" ? "#fbbf24" : A.red);
  const ctd = (align = "right", extra) => ({ ...td(A, align), padding: "4px 5px", fontSize: 11, ...extra });
  const cth = (align = "right", extra) => ({ ...th(A, align), padding: "5px 5px", fontSize: 9.5, ...extra });

  const chipStyle = (active, accent = A.green) => ({
    background: active ? `${accent}20` : "transparent",
    border: `1px solid ${active ? accent : A.border}`,
    color: active ? accent : A.textDim,
    borderRadius: 5,
    padding: "2px 7px",
    fontSize: 10.5,
    fontFamily: MONO,
    fontWeight: active ? 700 : 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  const ivBadge = useMemo(() => {
    const r = analysis?.ivHvRatio;
    if (r == null) return null;
    if (r <= 0.95) return { label: `CHEAP ${r.toFixed(2)}×`, color: A.green };
    if (r >= 1.25) return { label: `RICH ${r.toFixed(2)}×`, color: "#fbbf24" };
    return { label: `FAIR ${r.toFixed(2)}×`, color: A.textDim };
  }, [analysis, A]);

  const callShare = useMemo(() => {
    if (!analysis) return null;
    const tot = analysis.totalCallPrem + analysis.totalPutPrem;
    return tot > 0 ? Math.round((analysis.totalCallPrem / tot) * 100) : null;
  }, [analysis]);

  const portChips = useMemo(() => (portfolio || []).slice(0, 7), [portfolio]);
  const flagChips = useMemo(() => [...(flagged || [])].filter((t) => !portChips.includes(t)).slice(0, 6), [flagged, portChips]);
  const eliteChips = useMemo(
    () => eliteTop.filter((t) => !INDEX_CHIPS.includes(t) && !portChips.includes(t) && !flagChips.includes(t)).slice(0, 6),
    [eliteTop, portChips, flagChips]
  );

  return (
    <div>
      {/* ── Header: Ticker Switcher, Quick Pills & Search ────────────────── */}
      <Card
        A={A}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            <span>Options</span>
            <span style={{ fontFamily: MONO, color: A.green, fontWeight: 800 }}>{ticker}</span>
            <FlagButton t={ticker} A={A} />
            <TierMark t={ticker} />
            <RslDot tip={rsLeads(stockInfo)} A={A} />
            {bundle?.spot != null && (
              <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: A.text, marginLeft: 4 }}>
                {fmtPx(bundle.spot)}{" "}
                <span style={{ color: pc(bundle.changePct), fontSize: 11 }}>{fmtPct(bundle.changePct, 2)}</span>
              </span>
            )}
            {stockInfo?.rs_rank != null && (
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: stockInfo.rs_rank >= 90 ? A.green : A.textMuted }}>
                RS {stockInfo.rs_rank}
              </span>
            )}
            {adr20 != null && (
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: A.textMuted }}>
                ADR {adr20.toFixed(1)}%
              </span>
            )}
            {earningsDays != null && earningsDays >= 0 && earningsDays <= 45 && (
              <span
                title={earningsDisplay || `Earnings in ${earningsDays} days`}
                style={{
                  fontSize: 10,
                  fontFamily: MONO,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: earningsDays <= 14 ? "rgba(245,158,11,0.2)" : "rgba(148,163,184,0.14)",
                  border: `1px solid ${earningsDays <= 14 ? "rgba(245,158,11,0.6)" : A.border}`,
                  color: earningsDays <= 14 ? "#fbbf24" : A.textDim,
                }}
              >
                ER {earningsDays}d
              </span>
            )}
          </span>
        }
        right={
          <form onSubmit={submitTicker} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder="Ticker..."
              aria-label="Jump to options ticker"
              style={{
                width: 78,
                padding: "3px 7px",
                fontSize: 11,
                fontFamily: MONO,
                background: A.bg,
                color: A.text,
                border: `1px solid ${A.border}`,
                borderRadius: 5,
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => setRefreshNonce((n) => n + 1)}
              title="Refresh live options chain"
              style={{
                background: "transparent",
                border: `1px solid ${A.border}`,
                color: A.textDim,
                borderRadius: 5,
                padding: "3px 8px",
                fontSize: 10.5,
                cursor: "pointer",
              }}
            >
              {loading ? "…" : "↻"}
            </button>
          </form>
        }
      >
        {/* Quick-switch pills */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
          {INDEX_CHIPS.map((t) => (
            <button key={t} type="button" onClick={() => onTicker?.(t)} style={chipStyle(ticker === t, A.cyan)}>
              {t}
            </button>
          ))}
          {portChips.length > 0 && (
            <>
              <span style={{ fontSize: 9.5, color: A.textMuted, marginLeft: 4, fontWeight: 700 }}>PORT</span>
              {portChips.map((t) => (
                <button key={`p-${t}`} type="button" onClick={() => onTicker?.(t)} style={chipStyle(ticker === t, A.green)}>
                  {t}
                </button>
              ))}
            </>
          )}
          {flagChips.length > 0 && (
            <>
              <span style={{ fontSize: 9.5, color: "#f97316", marginLeft: 4, fontWeight: 700 }}>FLG</span>
              {flagChips.map((t) => (
                <button key={`f-${t}`} type="button" onClick={() => onTicker?.(t)} style={chipStyle(ticker === t, "#f97316")}>
                  {t}
                </button>
              ))}
            </>
          )}
          {eliteChips.length > 0 && (
            <>
              <span style={{ fontSize: 9.5, color: "#fbbf24", marginLeft: 4, fontWeight: 700 }}>● ELITE RS</span>
              {eliteChips.map((t) => (
                <button key={`e-${t}`} type="button" onClick={() => onTicker?.(t)} style={chipStyle(ticker === t, "#fbbf24")}>
                  {t}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Expiration Selector */}
        {bundle?.expirations?.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${A.border}` }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, marginRight: 2 }}>EXP</span>
            {bundle.expirations.slice(0, 10).map((ex) => {
              const active = bundle.selected?.unix === ex.unix;
              const monthly = isMonthlyOpex(ex.date);
              const postEr = earningsDays != null && earningsDays >= 0 && ex.dte >= earningsDays && ex.dte <= earningsDays + 7;
              return (
                <button
                  key={ex.unix}
                  type="button"
                  onClick={() => setSelectedDate(ex.unix)}
                  title={`${ex.date} (${ex.dte} DTE)${monthly ? " · Monthly OPEX" : ""}${postEr ? " · Includes Earnings" : ""}`}
                  style={{
                    background: active ? `${A.green}20` : "transparent",
                    border: `1px solid ${active ? A.green : monthly ? A.borderLight : A.border}`,
                    color: active ? A.green : A.textDim,
                    borderRadius: 5,
                    padding: "2px 7px",
                    fontSize: 10.5,
                    fontFamily: MONO,
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <span>{fmtExpShort(ex.date)}</span>
                  <span style={{ fontSize: 9.5, color: active ? A.green : A.textMuted }}>{ex.dte}d</span>
                  {postEr && <span style={{ color: "#fbbf24", fontSize: 9, fontWeight: 800 }}>ER</span>}
                </button>
              );
            })}
            {bundle.expirations.length > 10 && (
              <select
                aria-label="More expiration dates"
                value={bundle.selected?.unix || ""}
                onChange={(e) => setSelectedDate(Number(e.target.value) || null)}
                style={{
                  background: A.bg,
                  color: A.textDim,
                  border: `1px solid ${A.border}`,
                  borderRadius: 5,
                  padding: "2px 6px",
                  fontSize: 10.5,
                  fontFamily: MONO,
                }}
              >
                {bundle.expirations.map((ex) => (
                  <option key={ex.unix} value={ex.unix}>
                    {ex.date} ({ex.dte}d)
                  </option>
                ))}
              </select>
            )}
            {bundle.asOf && (
              <span style={{ marginLeft: "auto", fontSize: 10, color: A.textMuted, fontFamily: MONO }}>
                Live {new Date(bundle.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </div>
        )}
      </Card>

      {/* Error / Loading state */}
      {error && (
        <Card A={A} title="Options Chain Unavailable">
          <div style={{ fontSize: 11.5, color: A.red }}>{error}</div>
        </Card>
      )}
      {loading && !analysis && !error && (
        <Card A={A} title={`Loading ${ticker} live options chain…`}>
          <div className="tp-shimmer" style={{ height: 84, borderRadius: 6 }} />
        </Card>
      )}

      {/* ── Key Levels & Positioning Card ────────────────────────────────── */}
      {analysis && (
        <Card
          A={A}
          title="Key Levels & Positioning"
          sub={`${analysis.expDate} (${analysis.dte} DTE)`}
          right={
            analysis.earningsBeforeExpiry ? (
              <span
                title={`Earnings in ${analysis.earningsDays}d falls on or before ${analysis.expDate} — expect elevated IV & binary gap risk`}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: MONO,
                  padding: "2px 7px",
                  borderRadius: 5,
                  background: "rgba(245,158,11,0.18)",
                  border: "1px solid rgba(245,158,11,0.55)",
                  color: "#fbbf24",
                }}
              >
                ⚠ ER IN {analysis.earningsDays}D BEFORE EXPIRY
              </span>
            ) : null
          }
        >
          {/* KPI Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap: 7 }}>
            {/* ATM IV / HV20 */}
            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 9px" }}>
              <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 700, letterSpacing: 0.4 }}>ATM IV / HV20</div>
              <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 800, color: A.text, marginTop: 2 }}>
                {fmtIv(analysis.atmIv)}
                {analysis.hv20 != null && (
                  <span style={{ fontSize: 10.5, fontWeight: 500, color: A.textMuted }}> / {fmtIv(analysis.hv20)}</span>
                )}
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, marginTop: 2, color: ivBadge?.color || A.textMuted, fontWeight: 700 }}>
                {ivBadge ? ivBadge.label : "Implied Vol"}
              </div>
            </div>

            {/* Expected Move */}
            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 9px" }}>
              <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 700, letterSpacing: 0.4 }}>EXPECTED MOVE</div>
              <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 800, color: A.cyan, marginTop: 2 }}>
                {analysis.expectedMove ? `±${analysis.expectedMove.pct.toFixed(1)}%` : "—"}
                {analysis.expectedMove && (
                  <span style={{ fontSize: 10.5, fontWeight: 500, color: A.textDim }}> (±${analysis.expectedMove.dollars.toFixed(2)})</span>
                )}
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: A.textMuted, marginTop: 2 }}>
                {analysis.expectedMove ? `$${analysis.expectedMove.lower.toFixed(1)} – $${analysis.expectedMove.upper.toFixed(1)}` : "—"}
              </div>
            </div>

            {/* Max Pain */}
            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 9px" }}>
              <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 700, letterSpacing: 0.4 }}>MAX PAIN</div>
              <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 800, color: "#fbbf24", marginTop: 2 }}>
                {analysis.maxPain ? `$${fmtStrike(analysis.maxPain.strike)}` : "—"}
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: A.textMuted, marginTop: 2 }}>
                {analysis.maxPain ? `${fmtPct(analysis.maxPain.pctFromSpot, 1)} vs spot` : "—"}
              </div>
            </div>

            {/* Call / Put Walls */}
            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 9px" }}>
              <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 700, letterSpacing: 0.4 }}>OI WALLS (P / C)</div>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, marginTop: 2 }}>
                <span style={{ color: A.red }}>{analysis.putWall ? `$${fmtStrike(analysis.putWall.strike)}` : "—"}</span>
                <span style={{ color: A.textMuted }}> / </span>
                <span style={{ color: A.green }}>{analysis.callWall ? `$${fmtStrike(analysis.callWall.strike)}` : "—"}</span>
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: A.textMuted, marginTop: 2 }}>
                {analysis.putWall ? fmtInt(analysis.putWall.oi) : "—"} / {analysis.callWall ? fmtInt(analysis.callWall.oi) : "—"} OI
              </div>
            </div>

            {/* Net GEX & Gamma Flip */}
            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 9px" }}>
              <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 700, letterSpacing: 0.4 }}>NET GEX / FLIP</div>
              <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 800, color: analysis.netGex >= 0 ? A.green : A.red, marginTop: 2 }}>
                {fmtDollarVol(analysis.netGex, true)}
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: A.textMuted, marginTop: 2 }}>
                {analysis.gammaFlip != null ? `Flip ~$${analysis.gammaFlip.toFixed(1)}` : (analysis.netGex >= 0 ? "Pinning regime" : "Vol expansion")}
              </div>
            </div>

            {/* P/C Ratio & Skew */}
            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 9px" }}>
              <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 700, letterSpacing: 0.4 }}>P/C VOL · 25Δ SKEW</div>
              <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 800, color: analysis.pcVolRatio == null ? A.textMuted : analysis.pcVolRatio <= 0.7 ? A.green : analysis.pcVolRatio >= 1.2 ? A.red : A.text, marginTop: 2 }}>
                {analysis.pcVolRatio != null ? analysis.pcVolRatio.toFixed(2) : "—"}
                <span style={{ fontSize: 10.5, fontWeight: 500, color: A.textMuted }}>
                  {analysis.ivSkew != null ? ` · ${analysis.ivSkew > 0 ? "+" : ""}${analysis.ivSkew.toFixed(1)}p` : ""}
                </span>
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: A.textMuted, marginTop: 2 }}>
                OI P/C {analysis.pcOiRatio != null ? analysis.pcOiRatio.toFixed(2) : "—"} · Vol {fmtInt(analysis.totalCallVol + analysis.totalPutVol)}
              </div>
            </div>
          </div>

          {/* Call vs Put Dollar Flow Bar */}
          {callShare != null && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, fontFamily: MONO }}>
              <span style={{ color: A.green, fontWeight: 700 }}>Calls {callShare}% ({fmtDollarVol(analysis.totalCallPrem)})</span>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: `${A.red}55`, overflow: "hidden", minWidth: 80 }}>
                <div style={{ width: `${callShare}%`, height: "100%", background: A.green }} />
              </div>
              <span style={{ color: A.red, fontWeight: 700 }}>Puts {100 - callShare}% ({fmtDollarVol(analysis.totalPutPrem)})</span>
            </div>
          )}

          {/* Strike Positioning Chart */}
          <StrikeProfileChart analysis={analysis} A={A} />
        </Card>
      )}

      {/* ── Sub-Tab Switcher: Chain | Swing Calls | Unusual Flow ─────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {[
          ["chain", "Option Chain", analysis ? `${analysis.allStrikes.length} strikes` : null],
          ["swing", "Breakout / Swing Calls", swingSetups.length ? `${swingSetups.length} picks` : null],
          ["flow", "Unusual Flow", tickerFlow.length ? `${tickerFlow.length} alerts` : null],
        ].map(([k, lbl, badge]) => {
          const on = subTab === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => pickSubTab(k)}
              style={{
                background: on ? `${A.green}20` : A.bgCard,
                border: `1px solid ${on ? A.green : A.border}`,
                color: on ? A.green : A.textDim,
                borderRadius: 7,
                padding: "5px 12px",
                fontSize: 11.5,
                fontWeight: on ? 700 : 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>{lbl}</span>
              {badge && <span style={{ fontFamily: MONO, fontSize: 10, color: on ? A.green : A.textMuted }}>{badge}</span>}
            </button>
          );
        })}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SUB-TAB 1: LIVE OPTION CHAIN                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {subTab === "chain" && analysis && (
        <Card
          A={A}
          title={`${ticker} Option Chain`}
          sub={`${analysis.expDate} · ${analysis.dte} DTE · Spot ${fmtPx(analysis.spot)}`}
          right={
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
              {[["straddle", "Straddle"], ["calls", "Calls"], ["puts", "Puts"]].map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setChainSide(k)} style={chipStyle(chainSide === k, A.green)}>
                  {lbl}
                </button>
              ))}
              {[[10, "±10"], [20, "±20"], [999, "All"]].map(([n, lbl]) => (
                <button key={n} type="button" onClick={() => setStrikeWindow(n)} style={chipStyle(strikeWindow === n, A.cyan)}>
                  {lbl}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setUnusualOnly((v) => !v)}
                style={chipStyle(unusualOnly, "#fbbf24")}
                title="Show only strikes with unusual Vol/OI ≥ 1.5× or $100K+ premium"
              >
                Unusual
              </button>
            </div>
          }
        >
          {chainRows.length === 0 ? (
            <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 2px" }}>No strikes match the current filter.</div>
          ) : chainSide === "straddle" ? (
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 2 }}>
                  <tr>
                    <th colSpan={7} style={{ ...cth("center"), color: A.green, borderBottom: `1px solid ${A.border}` }}>CALLS</th>
                    <th style={{ ...cth("center"), color: A.text, background: A.bgRow }}>STRIKE</th>
                    <th colSpan={7} style={{ ...cth("center"), color: A.red, borderBottom: `1px solid ${A.border}` }}>PUTS</th>
                  </tr>
                  <tr>
                    <th style={cth("right")} title="Volume / Open Interest">V/OI</th>
                    <th style={cth("right")}>OI</th>
                    <th style={cth("right")}>Vol</th>
                    <th style={cth("right")}>Δ</th>
                    <th style={cth("right")}>IV</th>
                    <th style={cth("right")}>Bid</th>
                    <th style={cth("right")}>Ask</th>
                    <th style={{ ...cth("center"), background: A.bgRow }}>Strike</th>
                    <th style={cth("right")}>Bid</th>
                    <th style={cth("right")}>Ask</th>
                    <th style={cth("right")}>IV</th>
                    <th style={cth("right")}>Δ</th>
                    <th style={cth("right")}>Vol</th>
                    <th style={cth("right")}>OI</th>
                    <th style={cth("right")} title="Volume / Open Interest">V/OI</th>
                  </tr>
                </thead>
                <tbody>
                  {chainRows.map((r) => {
                    const c = r.call;
                    const p = r.put;
                    const cItmBg = c?.itm ? `${A.green}0f` : "transparent";
                    const pItmBg = p?.itm ? `${A.red}0f` : "transparent";
                    return (
                      <tr
                        key={r.strike}
                        style={{
                          borderTop: r.isAtm ? `1.5px solid ${A.cyan}` : undefined,
                          borderBottom: r.isAtm ? `1.5px solid ${A.cyan}` : undefined,
                        }}
                      >
                        {/* CALL SIDE */}
                        <td style={ctd("right", { background: cItmBg, color: c?.unusual ? "#fbbf24" : A.textMuted, fontWeight: c?.unusual ? 700 : 400 })}>
                          {c && c.vol > 0 ? `${c.volOi.toFixed(1)}×` : "—"}
                        </td>
                        <td style={ctd("right", { background: cItmBg, color: r.isCW ? A.green : A.textDim, fontWeight: r.isCW ? 700 : 400 })}>
                          {c ? fmtInt(c.oi) : "—"}
                        </td>
                        <td style={ctd("right", { background: cItmBg, color: c?.unusual ? "#fbbf24" : A.text })}>
                          {c ? fmtInt(c.vol) : "—"}
                        </td>
                        <td style={ctd("right", { background: cItmBg, color: A.textDim })}>
                          {c ? c.delta.toFixed(2) : "—"}
                        </td>
                        <td style={ctd("right", { background: cItmBg, color: A.textMuted })}>
                          {c ? fmtIv(c.iv) : "—"}
                        </td>
                        <td style={ctd("right", { background: cItmBg, color: A.textDim })}>
                          {c ? c.bid.toFixed(2) : "—"}
                        </td>
                        <td style={ctd("right", { background: cItmBg, color: A.green, fontWeight: 600 })}>
                          {c ? c.ask.toFixed(2) : "—"}
                        </td>

                        {/* CENTER STRIKE */}
                        <td
                          style={ctd("center", {
                            background: r.isAtm ? `${A.cyan}22` : A.bgRow,
                            color: r.isAtm ? A.cyan : A.text,
                            fontWeight: 800,
                            fontFamily: MONO,
                            borderLeft: `1px solid ${A.border}`,
                            borderRight: `1px solid ${A.border}`,
                          })}
                        >
                          <span>{fmtStrike(r.strike)}</span>
                          {r.isCW && <span title="Call OI Wall" style={{ marginLeft: 3, fontSize: 8.5, color: A.green }}>CW</span>}
                          {r.isPW && <span title="Put OI Wall" style={{ marginLeft: 3, fontSize: 8.5, color: A.red }}>PW</span>}
                          {r.isMP && <span title="Max Pain Strike" style={{ marginLeft: 3, fontSize: 8.5, color: "#fbbf24" }}>MP</span>}
                        </td>

                        {/* PUT SIDE */}
                        <td style={ctd("right", { background: pItmBg, color: A.textDim })}>
                          {p ? p.bid.toFixed(2) : "—"}
                        </td>
                        <td style={ctd("right", { background: pItmBg, color: A.red, fontWeight: 600 })}>
                          {p ? p.ask.toFixed(2) : "—"}
                        </td>
                        <td style={ctd("right", { background: pItmBg, color: A.textMuted })}>
                          {p ? fmtIv(p.iv) : "—"}
                        </td>
                        <td style={ctd("right", { background: pItmBg, color: A.textDim })}>
                          {p ? p.delta.toFixed(2) : "—"}
                        </td>
                        <td style={ctd("right", { background: pItmBg, color: p?.unusual ? "#fbbf24" : A.text })}>
                          {p ? fmtInt(p.vol) : "—"}
                        </td>
                        <td style={ctd("right", { background: pItmBg, color: r.isPW ? A.red : A.textDim, fontWeight: r.isPW ? 700 : 400 })}>
                          {p ? fmtInt(p.oi) : "—"}
                        </td>
                        <td style={ctd("right", { background: pItmBg, color: p?.unusual ? "#fbbf24" : A.textMuted, fontWeight: p?.unusual ? 700 : 400 })}>
                          {p && p.vol > 0 ? `${p.volOi.toFixed(1)}×` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* Single-side Detailed Greeks Table (Calls or Puts) */
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 2 }}>
                  <tr>
                    <th style={cth("left")}>Strike</th>
                    <th style={cth("right")}>Bid</th>
                    <th style={cth("right")}>Ask</th>
                    <th style={cth("right")}>Mid</th>
                    <th style={cth("right")} title="Bid-Ask spread % of Mid">Spr%</th>
                    <th style={cth("right")}>IV</th>
                    <th style={cth("right")}>Δ</th>
                    <th style={cth("right")}>Γ</th>
                    <th style={cth("right")}>Θ/d</th>
                    <th style={cth("right")}>Vega</th>
                    <th style={cth("right")} title="Breakeven % from spot">BE%</th>
                    <th style={cth("right")}>Vol</th>
                    <th style={cth("right")}>OI</th>
                    <th style={cth("right")}>V/OI</th>
                    <th style={cth("right")}>Est $</th>
                    <th style={cth("center")}>Liq</th>
                  </tr>
                </thead>
                <tbody>
                  {chainRows.map((r) => {
                    const c = chainSide === "calls" ? r.call : r.put;
                    if (!c) return null;
                    const bg = c.itm ? (chainSide === "calls" ? `${A.green}0f` : `${A.red}0f`) : "transparent";
                    return (
                      <tr key={r.strike} style={{ background: bg, borderTop: r.isAtm ? `1.5px solid ${A.cyan}` : undefined }}>
                        <td style={ctd("left", { fontWeight: 700, fontFamily: MONO, color: r.isAtm ? A.cyan : A.text })}>
                          ${fmtStrike(c.strike)}
                          {r.isCW && chainSide === "calls" && <span style={{ marginLeft: 4, fontSize: 9, color: A.green }}>CW</span>}
                          {r.isPW && chainSide === "puts" && <span style={{ marginLeft: 4, fontSize: 9, color: A.red }}>PW</span>}
                        </td>
                        <td style={ctd("right")}>{c.bid.toFixed(2)}</td>
                        <td style={ctd("right")}>{c.ask.toFixed(2)}</td>
                        <td style={ctd("right", { fontWeight: 700, color: A.text })}>{c.mid.toFixed(2)}</td>
                        <td style={ctd("right", { color: (c.spreadPct ?? 99) <= 5 ? A.green : (c.spreadPct ?? 99) <= 10 ? A.textDim : A.red })}>
                          {c.spreadPct != null ? `${c.spreadPct.toFixed(1)}%` : "—"}
                        </td>
                        <td style={ctd("right")}>{fmtIv(c.iv)}</td>
                        <td style={ctd("right", { fontWeight: 700, color: A.text })}>{c.delta.toFixed(2)}</td>
                        <td style={ctd("right", { color: A.textMuted })}>{c.gamma.toFixed(3)}</td>
                        <td style={ctd("right", { color: A.red })}>{c.theta.toFixed(2)}</td>
                        <td style={ctd("right", { color: A.textMuted })}>{c.vega.toFixed(2)}</td>
                        <td style={ctd("right", { color: A.textDim })}>{fmtPct(c.breakevenPct, 1)}</td>
                        <td style={ctd("right", { color: c.unusual ? "#fbbf24" : A.text, fontWeight: c.unusual ? 700 : 400 })}>{fmtInt(c.vol)}</td>
                        <td style={ctd("right")}>{fmtInt(c.oi)}</td>
                        <td style={ctd("right", { color: c.unusual ? "#fbbf24" : A.textMuted, fontWeight: c.unusual ? 700 : 400 })}>
                          {c.vol > 0 ? `${c.volOi.toFixed(1)}×` : "—"}
                        </td>
                        <td style={ctd("right", { color: c.notional >= 100_000 ? "#fbbf24" : A.textMuted })}>{fmtDollarVol(c.notional)}</td>
                        <td style={ctd("center", { fontWeight: 800, color: gradeColor(c.grade) })}>{c.grade}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SUB-TAB 2: BREAKOUT / SWING CALL FINDER                             */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {subTab === "swing" && (
        <>
          <Card
            A={A}
            title={`${ticker} Swing Call & Spread Picks`}
            sub={
              swingAnalysis
                ? `${swingAnalysis.expDate} (${swingAnalysis.dte} DTE) · ATM IV ${fmtIv(swingAnalysis.atmIv)}${swingAnalysis.expectedMove ? ` · ±1σ EM ${swingAnalysis.expectedMove.pct.toFixed(1)}%` : ""}`
                : ""
            }
            right={
              bundle?.swingChain ? (
                <div style={{ display: "inline-flex", gap: 4 }}>
                  <button type="button" onClick={() => setSwingUseSelected(false)} style={chipStyle(!swingUseSelected, A.green)}>
                    Swing ({bundle.swingChain.dte}d)
                  </button>
                  <button type="button" onClick={() => setSwingUseSelected(true)} style={chipStyle(swingUseSelected, A.cyan)}>
                    Selected ({bundle.selected.dte}d)
                  </button>
                </div>
              ) : null
            }
          >
            {swingSetups.length === 0 ? (
              <div style={{ fontSize: 11, color: A.textMuted }}>No liquid call setups found on this expiration. Try a monthly expiration with higher open interest.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(225px, 1fr))", gap: 8 }}>
                {swingSetups.map((s) => (
                  <div
                    key={s.style}
                    style={{
                      background: A.bg,
                      border: `1px solid ${s.accent}44`,
                      borderTop: `2px solid ${s.accent}`,
                      borderRadius: 8,
                      padding: "9px 11px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: s.accent }}>{s.style}</span>
                      <span
                        title="Liquidity Grade (spread %, OI, volume)"
                        style={{
                          fontSize: 10,
                          fontFamily: MONO,
                          fontWeight: 800,
                          padding: "1px 5px",
                          borderRadius: 4,
                          border: `1px solid ${gradeColor(s.grade)}66`,
                          color: gradeColor(s.grade),
                        }}
                      >
                        Liq {s.grade}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: A.textMuted, marginTop: 2 }}>{s.subtitle}</div>

                    <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 800, color: A.text, marginTop: 7 }}>
                      {s.kind === "spread"
                        ? `${fmtStrike(s.strike)}/${fmtStrike(s.shortStrike)}C · ${fmtExpShort(s.expDate)}`
                        : `$${fmtStrike(s.strike)}C · ${fmtExpShort(s.expDate)}`}
                      <span style={{ fontSize: 10.5, fontWeight: 500, color: A.textMuted }}> ({s.dte}d)</span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px", marginTop: 7, fontSize: 11, fontFamily: MONO }}>
                      <div>
                        <span style={{ color: A.textMuted }}>Cost </span>
                        <strong style={{ color: A.text }}>${s.mid.toFixed(2)}</strong>
                        <span style={{ color: A.textMuted, fontSize: 9.5 }}> (${s.maxRiskPerContract})</span>
                      </div>
                      <div>
                        <span style={{ color: A.textMuted }}>Spr </span>
                        <strong style={{ color: (s.spreadPct ?? 99) <= 5 ? A.green : (s.spreadPct ?? 99) <= 10 ? A.text : A.red }}>
                          {s.spreadPct != null ? `${s.spreadPct.toFixed(1)}%` : "—"}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: A.textMuted }}>Δ / Θ </span>
                        <strong style={{ color: A.text }}>{s.delta.toFixed(2)}</strong>
                        <span style={{ color: A.red, fontSize: 10 }}> / {s.theta.toFixed(2)}</span>
                      </div>
                      <div>
                        <span style={{ color: A.textMuted }}>BE </span>
                        <strong style={{ color: A.text }}>${s.breakeven.toFixed(2)}</strong>
                        <span style={{ color: A.textMuted, fontSize: 9.5 }}> ({fmtPct(s.breakevenPct, 1)})</span>
                      </div>
                      <div>
                        <span style={{ color: A.textMuted }}>{s.kind === "spread" ? "Max R:R " : "Lev "}</span>
                        <strong style={{ color: A.cyan }}>
                          {s.kind === "spread" ? `${s.rr.toFixed(2)}×` : (s.leverage != null ? `${s.leverage.toFixed(1)}×` : "—")}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: A.textMuted }}>{s.kind === "spread" ? "Max Gain " : "+1σ EM "}</span>
                        <strong style={{ color: A.green }}>
                          {s.estGain1Em != null ? `+${s.estGain1Em}%` : "—"}
                        </strong>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 7, paddingTop: 5, borderTop: `1px solid ${A.border}`, fontSize: 10, fontFamily: MONO, color: A.textMuted }}>
                      <span>IV {fmtIv(s.iv)} · OI {fmtInt(s.oi)} · Vol {fmtInt(s.vol)}</span>
                      {s.earningsBeforeExpiry && (
                        <span style={{ color: "#fbbf24", fontWeight: 700 }}>⚠ ER {s.earningsDays}d</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Multi-Ticker Breakout Call Scanner */}
          <Card
            A={A}
            title="Multi-Ticker Breakout Call Scanner"
            sub="Liquid ~30–60 DTE Momentum Swing calls (0.55–0.70 Δ) · click row to load chain & chart"
            right={
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                {[
                  ["focus", "Port / Watch / Flg"],
                  ["elite", "Elite RS 95+"],
                  ["qqq", "QQQ Top"],
                ].map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => setScanUniverse(k)} style={chipStyle(scanUniverse === k, "#fbbf24")}>
                    {lbl}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => runBatchScan(scanUniverse, scanTargetList)}
                  disabled={scanLoading}
                  style={chipStyle(false, A.green)}
                >
                  {scanLoading ? "Scanning…" : "↻ Scan"}
                </button>
              </div>
            }
          >
            {scanError && <div style={{ fontSize: 11, color: A.red, marginBottom: 6 }}>{scanError}</div>}
            {scanLoading && !scanAgg ? (
              <div className="tp-shimmer" style={{ height: 120, borderRadius: 6 }} />
            ) : sortedSwingRows.length === 0 ? (
              <div style={{ fontSize: 11, color: A.textMuted }}>No liquid swing call setups returned for this universe.</div>
            ) : (
              <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                    <tr>
                      <th style={cth("left")}>Ticker</th>
                      {[
                        ["rs", "RS"],
                        ["chg", "Chg%"],
                        ["dte", "Contract"],
                        ["delta", "Δ"],
                        ["mid", "Mid"],
                        ["spr", "Spr%"],
                        ["iv", "IV (IV/HV)"],
                        ["be", "BE%"],
                        ["gain", "+1σ EM"],
                      ].map(([k, lbl]) => (
                        <th
                          key={k}
                          style={{ ...cth("right"), cursor: "pointer", color: swingSort.k === k ? A.text : A.textMuted }}
                          onClick={() => setSwingSort((p) => ({ k, d: p.k === k ? -p.d : (k === "spr" || k === "be" ? 1 : -1) }))}
                        >
                          {lbl}{swingSort.k === k ? (swingSort.d < 0 ? "▼" : "▲") : ""}
                        </th>
                      ))}
                      <th style={cth("center")}>Liq</th>
                      <th style={cth("right")}>Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSwingRows.map((r) => {
                      const on = r.ticker === ticker;
                      const st = stockMap?.[r.ticker];
                      const s = r.setup;
                      return (
                        <tr
                          key={r.ticker}
                          data-nav={r.ticker}
                          className={on ? "tp-click-row tp-row-active" : "tp-click-row"}
                          onClick={() => onTicker?.(r.ticker)}
                          style={{
                            cursor: "pointer",
                            background: on ? A.bgHover : "transparent",
                            boxShadow: on ? `inset 2px 0 0 ${A.green}` : "none",
                          }}
                        >
                          <td style={ctd("left")}>
                            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                              <FlagButton t={r.ticker} A={A} />
                              <span style={{ fontFamily: MONO, fontWeight: 700, color: on ? A.green : A.text }}>{r.ticker}</span>
                              <TierMark t={r.ticker} />
                              <RslDot tip={rsLeads(st)} A={A} />
                            </div>
                          </td>
                          <td style={ctd("right", { fontWeight: 700, color: (r.rs ?? 0) >= 90 ? A.green : A.textDim })}>{r.rs ?? "—"}</td>
                          <td style={ctd("right", { fontWeight: 700, color: pc(r.changePct) })}>{fmtPct(r.changePct, 1)}</td>
                          <td style={ctd("right", { fontWeight: 700, color: A.text })}>
                            ${fmtStrike(s.strike)}C · {fmtExpShort(s.expDate)} <span style={{ color: A.textMuted, fontWeight: 400 }}>({s.dte}d)</span>
                          </td>
                          <td style={ctd("right")}>{s.delta.toFixed(2)}</td>
                          <td style={ctd("right", { fontWeight: 600, color: A.text })}>${s.mid.toFixed(2)}</td>
                          <td style={ctd("right", { color: (s.spreadPct ?? 99) <= 5 ? A.green : (s.spreadPct ?? 99) <= 10 ? A.textDim : A.red })}>
                            {s.spreadPct != null ? `${s.spreadPct.toFixed(1)}%` : "—"}
                          </td>
                          <td style={ctd("right")}>
                            {fmtIv(r.atmIv)}
                            {r.ivHvRatio != null && (
                              <span style={{ marginLeft: 3, fontSize: 9.5, color: r.ivHvRatio <= 0.95 ? A.green : r.ivHvRatio >= 1.25 ? "#fbbf24" : A.textMuted }}>
                                ({r.ivHvRatio.toFixed(1)}×)
                              </span>
                            )}
                          </td>
                          <td style={ctd("right")}>{fmtPct(s.breakevenPct, 1)}</td>
                          <td style={ctd("right", { color: A.green, fontWeight: 700 })}>{s.estGain1Em != null ? `+${s.estGain1Em}%` : "—"}</td>
                          <td style={ctd("center", { fontWeight: 800, color: gradeColor(s.grade) })}>{s.grade}</td>
                          <td style={ctd("right")}>
                            {s.earningsBeforeExpiry ? (
                              <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: 10 }}>ER {s.earningsDays}d</span>
                            ) : (
                              <span style={{ color: A.green, fontSize: 10 }}>Clean</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SUB-TAB 3: UNUSUAL OPTIONS ACTIVITY / FLOW                          */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {subTab === "flow" && (
        <>
          {/* Active Ticker Unusual Contracts */}
          <Card
            A={A}
            title={`${ticker} Unusual Contracts`}
            sub="Vol ≥ 50 with Vol/OI ≥ 1.5× or Est $ Prem ≥ $75K"
          >
            {tickerFlow.length === 0 ? (
              <div style={{ fontSize: 11, color: A.textMuted }}>No unusual Vol/OI or block contracts detected on {ticker} for the loaded expirations.</div>
            ) : (
              <div style={{ overflowX: "auto", maxHeight: 260, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, background: A.bgCard }}>
                    <tr>
                      <th style={cth("left")}>Signal</th>
                      <th style={cth("left")}>Contract</th>
                      <th style={cth("right")}>Vol</th>
                      <th style={cth("right")}>OI</th>
                      <th style={cth("right")}>V/OI</th>
                      <th style={cth("right")}>Est $ Prem</th>
                      <th style={cth("right")}>Mid</th>
                      <th style={cth("right")}>IV</th>
                      <th style={cth("right")}>Δ</th>
                      <th style={cth("right")}>OTM%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickerFlow.map((r) => {
                      const isCall = r.type === "call";
                      const c = isCall ? A.green : A.red;
                      return (
                        <tr key={r.sym || `${r.expDate}-${r.type}-${r.strike}`}>
                          <td style={ctd("left")}>
                            <span style={{ fontSize: 9.5, fontWeight: 800, fontFamily: MONO, padding: "1px 5px", borderRadius: 4, background: `${c}20`, border: `1px solid ${c}55`, color: c }}>
                              {r.tag}
                            </span>
                          </td>
                          <td style={ctd("left", { fontFamily: MONO, fontWeight: 700, color: A.text })}>
                            ${fmtStrike(r.strike)}{isCall ? "C" : "P"} · {fmtExpShort(r.expDate)} <span style={{ color: A.textMuted, fontWeight: 400 }}>({r.dte}d)</span>
                          </td>
                          <td style={ctd("right", { fontWeight: 700, color: A.text })}>{fmtInt(r.vol)}</td>
                          <td style={ctd("right")}>{fmtInt(r.oi)}</td>
                          <td style={ctd("right", { fontWeight: 800, color: r.volOi >= 3 ? "#fbbf24" : c })}>{r.volOi.toFixed(1)}×</td>
                          <td style={ctd("right", { fontWeight: 800, color: c })}>{fmtDollarVol(r.notional)}</td>
                          <td style={ctd("right")}>${r.mid.toFixed(2)}</td>
                          <td style={ctd("right")}>{fmtIv(r.iv)}</td>
                          <td style={ctd("right")}>{r.delta.toFixed(2)}</td>
                          <td style={ctd("right", { color: r.itm ? A.cyan : A.textMuted })}>{r.itm ? "ITM" : fmtPct(r.otmPct, 1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Multi-Ticker Unusual Activity & P/C Spikes */}
          <Card
            A={A}
            title="Cross-Ticker Unusual Flow & P/C Spikes"
            sub="High Vol/OI sweeps & institutional blocks · click any row to inspect chain"
            right={
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                {[
                  ["focus", "Port / Watch / Flg"],
                  ["elite", "Elite RS 95+"],
                  ["qqq", "QQQ Top"],
                ].map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => setScanUniverse(k)} style={chipStyle(scanUniverse === k, "#fbbf24")}>
                    {lbl}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => runBatchScan(scanUniverse, scanTargetList)}
                  disabled={scanLoading}
                  style={chipStyle(false, A.green)}
                >
                  {scanLoading ? "Scanning…" : "↻ Scan"}
                </button>
              </div>
            }
          >
            {/* Ticker P/C Sentiment Strip */}
            {scanAgg?.tickerSummaries?.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8, paddingBottom: 7, borderBottom: `1px solid ${A.border}` }}>
                {scanAgg.tickerSummaries
                  .filter((t) => (t.totalCallPrem + t.totalPutPrem) >= 50_000)
                  .sort((a, b) => Math.abs(b.netFlowPrem) - Math.abs(a.netFlowPrem))
                  .slice(0, 10)
                  .map((t) => {
                    const col = t.sentiment === "BULLISH" ? A.green : t.sentiment === "BEARISH" ? A.red : A.textMuted;
                    return (
                      <button
                        key={t.ticker}
                        type="button"
                        onClick={() => onTicker?.(t.ticker)}
                        title={`Calls ${t.callShare}% (${fmtDollarVol(t.totalCallPrem)}) vs Puts ${100 - (t.callShare ?? 50)}% (${fmtDollarVol(t.totalPutPrem)}) · P/C Vol ${t.pcVolRatio ?? "—"}`}
                        style={{
                          background: `${col}14`,
                          border: `1px solid ${col}44`,
                          color: A.text,
                          borderRadius: 6,
                          padding: "2px 7px",
                          fontSize: 10.5,
                          fontFamily: MONO,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <strong>{t.ticker}</strong>
                        <span style={{ color: col, fontWeight: 700 }}>{t.callShare != null ? `${t.callShare}%C` : "—"}</span>
                        <span style={{ color: A.textMuted, fontSize: 9.5 }}>P/C {t.pcVolRatio != null ? t.pcVolRatio.toFixed(2) : "—"}</span>
                      </button>
                    );
                  })}
              </div>
            )}

            {/* Flow side & Vol/OI filters */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
              {[["all", "All"], ["call", "Calls Only"], ["put", "Puts Only"]].map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setFlowSideFilter(k)} style={chipStyle(flowSideFilter === k, k === "put" ? A.red : A.green)}>
                  {lbl}
                </button>
              ))}
              <span style={{ fontSize: 10, color: A.textMuted, marginLeft: 6 }}>Min V/OI:</span>
              {[[0, "Any"], [1.5, "≥1.5×"], [3, "≥3×"]].map(([v, lbl]) => (
                <button key={v} type="button" onClick={() => setFlowMinVolOi(v)} style={chipStyle(flowMinVolOi === v, A.cyan)}>
                  {lbl}
                </button>
              ))}
            </div>

            {scanError && <div style={{ fontSize: 11, color: A.red, marginBottom: 6 }}>{scanError}</div>}
            {scanLoading && !scanAgg ? (
              <div className="tp-shimmer" style={{ height: 140, borderRadius: 6 }} />
            ) : sortedFlowRows.length === 0 ? (
              <div style={{ fontSize: 11, color: A.textMuted }}>No unusual contracts matched the current filter.</div>
            ) : (
              <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                    <tr>
                      <th style={cth("left")}>Ticker</th>
                      <th style={cth("left")}>Signal</th>
                      <th style={cth("left")}>Contract</th>
                      {[
                        ["vol", "Vol"],
                        ["oi", "OI"],
                        ["volOi", "V/OI"],
                        ["notional", "Est $ Prem"],
                        ["mid", "Mid"],
                        ["iv", "IV"],
                        ["delta", "Δ"],
                        ["pcVolRatio", "P/C"],
                      ].map(([k, lbl]) => (
                        <th
                          key={k}
                          style={{ ...cth("right"), cursor: "pointer", color: flowSort.k === k ? A.text : A.textMuted }}
                          onClick={() => setFlowSort((p) => ({ k, d: p.k === k ? -p.d : -1 }))}
                        >
                          {lbl}{flowSort.k === k ? (flowSort.d < 0 ? "▼" : "▲") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFlowRows.slice(0, 60).map((r) => {
                      const on = r.ticker === ticker;
                      const isCall = r.type === "call";
                      const c = isCall ? A.green : A.red;
                      const st = stockMap?.[r.ticker];
                      return (
                        <tr
                          key={r.sym || `${r.ticker}-${r.expDate}-${r.type}-${r.strike}`}
                          data-nav={r.ticker}
                          className={on ? "tp-click-row tp-row-active" : "tp-click-row"}
                          onClick={() => onTicker?.(r.ticker)}
                          style={{
                            cursor: "pointer",
                            background: on ? A.bgHover : "transparent",
                            boxShadow: on ? `inset 2px 0 0 ${A.green}` : "none",
                          }}
                        >
                          <td style={ctd("left")}>
                            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                              <FlagButton t={r.ticker} A={A} />
                              <span style={{ fontFamily: MONO, fontWeight: 700, color: on ? A.green : A.text }}>{r.ticker}</span>
                              <TierMark t={r.ticker} />
                              <RslDot tip={rsLeads(st)} A={A} />
                            </div>
                          </td>
                          <td style={ctd("left")}>
                            <span style={{ fontSize: 9.5, fontWeight: 800, fontFamily: MONO, padding: "1px 5px", borderRadius: 4, background: `${c}20`, border: `1px solid ${c}55`, color: c }}>
                              {r.tag}
                            </span>
                          </td>
                          <td style={ctd("left", { fontFamily: MONO, fontWeight: 700, color: A.text })}>
                            ${fmtStrike(r.strike)}{isCall ? "C" : "P"} · {fmtExpShort(r.expDate)} <span style={{ color: A.textMuted, fontWeight: 400 }}>({r.dte}d)</span>
                          </td>
                          <td style={ctd("right", { fontWeight: 700, color: A.text })}>{fmtInt(r.vol)}</td>
                          <td style={ctd("right")}>{fmtInt(r.oi)}</td>
                          <td style={ctd("right", { fontWeight: 800, color: r.volOi >= 3 ? "#fbbf24" : c })}>{r.volOi.toFixed(1)}×</td>
                          <td style={ctd("right", { fontWeight: 800, color: c })}>{fmtDollarVol(r.notional)}</td>
                          <td style={ctd("right")}>${r.mid.toFixed(2)}</td>
                          <td style={ctd("right")}>{fmtIv(r.iv)}</td>
                          <td style={ctd("right")}>{r.delta.toFixed(2)}</td>
                          <td style={ctd("right", { color: r.pcVolRatio == null ? A.textMuted : r.pcVolRatio <= 0.7 ? A.green : r.pcVolRatio >= 1.2 ? A.red : A.textDim })}>
                            {r.pcVolRatio != null ? r.pcVolRatio.toFixed(2) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
