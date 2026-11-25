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
  findDirectionalPlays,
  pickExpirationForHorizon,
} from "./optionsMath.js";
import { NDX_CONSTITUENTS } from "./qqqMath.js";

// ── Formatting helpers ───────────────────────────────────────────────────────
const fmtPx = (v) => (v == null || !Number.isFinite(v) ? "—" : `$${v.toFixed(2)}`);
const fmtStrike = (v) => (v == null || !Number.isFinite(v) ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));
const fmtPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const fmtIv = (v) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(0)}%`);
const fmtInt = (v) => (v == null || !Number.isFinite(v) ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : v.toLocaleString());
const fmtExpShort = (iso) => {
  if (!iso || iso.length < 10) return iso || "—";
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m - 1] || m} ${d}`;
};

const INDEX_CHIPS = ["SPY", "QQQ", "IWM"];

// ── Main Simplified OptionsPanel ─────────────────────────────────────────────
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

  // Primary user choices: Bullish vs Bearish & Horizon
  const [outlook, setOutlook] = useState(() => {
    try {
      const s = localStorage.getItem("tp-options-outlook");
      if (s === "bullish" || s === "bearish") return s;
    } catch { /* ignore */ }
    return "bullish";
  });
  const pickOutlook = (o) => {
    setOutlook(o);
    try { localStorage.setItem("tp-options-outlook", o); } catch { /* ignore */ }
  };

  const [horizon, setHorizon] = useState("swing"); // "short" | "swing" | "leaps"
  const [customDate, setCustomDate] = useState(null); // explicit expiry override if chosen from dropdown

  const [tickerInput, setTickerInput] = useState("");
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Advanced drawer (collapsed by default so main view stays crystal clear)
  const [advOpen, setAdvOpen] = useState(false);
  const [advTab, setAdvTab] = useState("chain"); // "chain" | "flow" | "scanner"
  const [chainSide, setChainSide] = useState("straddle"); // "straddle" | "calls" | "puts"
  const [strikeWindow, setStrikeWindow] = useState(10);

  // Multi-ticker scanner (only runs when Advanced → Flow or Scanner is opened)
  const [scanUniverse, setScanUniverse] = useState("focus");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [scanCache, setScanCache] = useState({});
  const [flowSideFilter, setFlowSideFilter] = useState("all");

  // Reset custom expiry when ticker changes
  const prevTickerRef = useRef(ticker);
  useEffect(() => {
    if (prevTickerRef.current !== ticker) {
      prevTickerRef.current = ticker;
      setCustomDate(null);
    }
  }, [ticker]);

  // Resolve which expiration unix to request based on horizon or manual override
  const targetExp = useMemo(() => {
    if (customDate) return { unix: customDate };
    if (!bundle?.expirations?.length) return null;
    return pickExpirationForHorizon(bundle.expirations, horizon);
  }, [bundle?.expirations, horizon, customDate]);

  const requestedDateUnix = customDate || (
    horizon === "swing"
      ? null // api/options?swing=1 already returns the optimal 24-70d monthly OPEX in swingChain!
      : (targetExp?.unix || null)
  );

  // Fetch live options bundle
  useEffect(() => {
    let alive = true;
    const load = async (silent = false) => {
      if (!silent) { setLoading(true); setError(null); }
      try {
        const qs = new URLSearchParams({ ticker, swing: "1" });
        if (requestedDateUnix) qs.set("date", String(requestedDateUnix));
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
    const id = setInterval(() => {
      if (!document.hidden && etClock().rth) load(true);
    }, 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [ticker, requestedDateUnix, refreshNonce]);

  const stockInfo = stockMap?.[ticker] || null;
  const adr20 = stockInfo?.adr20 ?? stockInfo?.adr_pct ?? null;
  const earningsDays = stockInfo?.earnings_days ?? null;
  const earningsDisplay = stockInfo?.earnings_display || "";

  // Active chain for the chosen horizon (in Swing mode with no custom date, prefer swingChain when present)
  const activeRawChain = useMemo(() => {
    if (!bundle) return null;
    if (!customDate && horizon === "swing" && bundle.swingChain) return bundle.swingChain;
    return bundle.selected;
  }, [bundle, horizon, customDate]);

  const analysis = useMemo(() => {
    if (!activeRawChain || !bundle?.spot) return null;
    return analyzeOptionChain(activeRawChain, bundle.spot, {
      ticker: bundle.ticker || ticker,
      adr20,
      earningsDays,
    });
  }, [activeRawChain, bundle, ticker, adr20, earningsDays]);

  // Nearest-expiry flow for quick sentiment check if active chain is far out
  const nearAnalysis = useMemo(() => {
    if (!bundle?.selected || !bundle?.spot) return null;
    if (bundle.selected === activeRawChain) return analysis;
    return analyzeOptionChain(bundle.selected, bundle.spot, {
      ticker: bundle.ticker || ticker,
      adr20,
      earningsDays,
    });
  }, [bundle, activeRawChain, analysis, ticker, adr20, earningsDays]);

  // Main directional playbook (Bullish or Bearish)
  const playbook = useMemo(
    () => (analysis ? findDirectionalPlays(analysis, outlook, { earningsDays }) : null),
    [analysis, outlook, earningsDays]
  );

  // Quick-switch pools
  const eliteTop = useMemo(
    () =>
      Object.values(stockMap || {})
        .filter((s) => isEliteRs(s))
        .sort((a, b) => (b.rs_rank ?? 0) - (a.rs_rank ?? 0) || (b.change_pct ?? 0) - (a.change_pct ?? 0))
        .slice(0, 18)
        .map((s) => s.ticker),
    [stockMap]
  );
  const focusTickers = useMemo(() => {
    const merged = [...new Set([...(portfolio || []), ...[...(flagged || [])], ...(watchlist || [])])];
    return merged.filter(Boolean).slice(0, 20);
  }, [portfolio, watchlist, flagged]);
  const qqqTop = useMemo(() => {
    const inMap = NDX_CONSTITUENTS
      .map((x) => stockMap?.[x.t])
      .filter(Boolean)
      .sort((a, b) => (b.market_cap_raw ?? 0) - (a.market_cap_raw ?? 0))
      .slice(0, 18)
      .map((s) => s.ticker);
    return inMap.length ? ["QQQ", ...inMap.slice(0, 17)] : ["QQQ", "NVDA", "AAPL", "MSFT", "AMZN", "META", "AVGO", "GOOGL", "TSLA"];
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

  useEffect(() => {
    if (advOpen && (advTab === "flow" || advTab === "scanner") && !scanCache[scanUniverse] && !scanLoading && scanTargetList.length > 0) {
      runBatchScan(scanUniverse, scanTargetList);
    }
  }, [advOpen, advTab, scanUniverse, scanCache, scanLoading, scanTargetList, runBatchScan]);

  const scanAgg = useMemo(() => {
    const cached = scanCache[scanUniverse];
    if (!cached?.items?.length) return null;
    return aggregateMultiTickerScan(cached.items, stockMap);
  }, [scanCache, scanUniverse, stockMap]);

  const tickerFlow = useMemo(() => {
    const a = nearAnalysis ? detectUnusualFlow(nearAnalysis, { minVol: 50, minVolOi: 1.5, minNotional: 75_000, limit: 15 }) : [];
    const b = analysis && analysis !== nearAnalysis
      ? detectUnusualFlow(analysis, { minVol: 50, minVolOi: 1.5, minNotional: 100_000, limit: 10 })
      : [];
    const seen = new Set();
    return [...a, ...b]
      .filter((r) => {
        const k = r.sym || `${r.expDate}-${r.type}-${r.strike}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((x, y) => y.notional - x.notional);
  }, [analysis, nearAnalysis]);

  const chainRows = useMemo(() => {
    if (!analysis) return [];
    const callByK = new Map(analysis.calls.map((c) => [c.strike, c]));
    const putByK = new Map(analysis.puts.map((p) => [p.strike, p]));
    const strikes = analysis.allStrikes;
    const atmIdx = strikes.indexOf(analysis.atmStrike);
    const slice = strikeWindow >= 999
      ? strikes
      : strikes.slice(Math.max(0, atmIdx - strikeWindow), Math.min(strikes.length, atmIdx + strikeWindow + 1));
    return slice.map((k) => ({
      strike: k,
      call: callByK.get(k) || null,
      put: putByK.get(k) || null,
      isAtm: k === analysis.atmStrike,
      isCW: analysis.callWall?.strike === k,
      isPW: analysis.putWall?.strike === k,
      isMP: analysis.maxPain?.strike === k,
    }));
  }, [analysis, strikeWindow]);

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

  const flowStats = nearAnalysis || analysis;
  const callShare = useMemo(() => {
    if (!flowStats) return null;
    const tot = flowStats.totalCallPrem + flowStats.totalPutPrem;
    return tot > 0 ? Math.round((flowStats.totalCallPrem / tot) * 100) : null;
  }, [flowStats]);

  const portChips = useMemo(() => (portfolio || []).slice(0, 6), [portfolio]);
  const flagChips = useMemo(() => [...(flagged || [])].filter((t) => !portChips.includes(t)).slice(0, 5), [flagged, portChips]);
  const eliteChips = useMemo(
    () => eliteTop.filter((t) => !INDEX_CHIPS.includes(t) && !portChips.includes(t) && !flagChips.includes(t)).slice(0, 5),
    [eliteTop, portChips, flagChips]
  );

  const isBull = outlook === "bullish";
  const outlookColor = isBull ? A.green : A.red;

  return (
    <div>
      {/* ── 1. Compact Ticker Picker Bar ─────────────────────────────────── */}
      <Card
        A={A}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontSize: 15, color: A.text, fontWeight: 800 }}>{ticker}</span>
            <FlagButton t={ticker} A={A} />
            <TierMark t={ticker} />
            <RslDot tip={rsLeads(stockInfo)} A={A} />
            {bundle?.spot != null && (
              <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: A.text, marginLeft: 2 }}>
                {fmtPx(bundle.spot)}{" "}
                <span style={{ color: pc(bundle.changePct), fontSize: 11.5 }}>{fmtPct(bundle.changePct, 2)}</span>
              </span>
            )}
            {stockInfo?.rs_rank != null && (
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: stockInfo.rs_rank >= 90 ? A.green : A.textMuted }}>
                RS {stockInfo.rs_rank}
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
                ER in {earningsDays}d
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
              title="Refresh live options"
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
              <span style={{ fontSize: 9.5, color: "#fbbf24", marginLeft: 4, fontWeight: 700 }}>● ELITE</span>
              {eliteChips.map((t) => (
                <button key={`e-${t}`} type="button" onClick={() => onTicker?.(t)} style={chipStyle(ticker === t, "#fbbf24")}>
                  {t}
                </button>
              ))}
            </>
          )}
        </div>
      </Card>

      {error && (
        <Card A={A} title="Options Unavailable">
          <div style={{ fontSize: 11.5, color: A.red }}>{error}</div>
        </Card>
      )}
      {loading && !analysis && !error && (
        <Card A={A} title={`Loading ${ticker} options playbook…`}>
          <div className="tp-shimmer" style={{ height: 140, borderRadius: 8 }} />
        </Card>
      )}

      {/* ── 2. Main Bullish vs Bearish Playbook ──────────────────────────── */}
      {analysis && (
        <Card
          A={A}
          title="Options Playbook"
          sub={
            bundle?.asOf
              ? `Live ${new Date(bundle.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : ""
          }
          right={
            bundle?.expirations?.length > 0 ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                {[
                  ["short", "Short (1–3w)"],
                  ["swing", "Swing (30–60d)"],
                  ["leaps", "LEAPS (4m+)"],
                ].map(([h, lbl]) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => { setHorizon(h); setCustomDate(null); }}
                    style={chipStyle(!customDate && horizon === h, A.cyan)}
                  >
                    {lbl}
                  </button>
                ))}
                <select
                  aria-label="Choose exact expiration date"
                  value={activeRawChain?.unix || ""}
                  onChange={(e) => setCustomDate(Number(e.target.value) || null)}
                  style={{
                    background: A.bg,
                    color: A.textDim,
                    border: `1px solid ${customDate ? A.cyan : A.border}`,
                    borderRadius: 5,
                    padding: "2px 6px",
                    fontSize: 10.5,
                    fontFamily: MONO,
                  }}
                >
                  {bundle.expirations.map((ex) => (
                    <option key={ex.unix} value={ex.unix}>
                      {fmtExpShort(ex.date)} ({ex.dte}d)
                    </option>
                  ))}
                </select>
              </div>
            ) : null
          }
        >
          {/* BIG 2-WAY OUTLOOK SWITCHER */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => pickOutlook("bullish")}
              style={{
                padding: "11px 14px",
                borderRadius: 9,
                cursor: "pointer",
                textAlign: "left",
                background: isBull ? "rgba(52, 211, 153, 0.16)" : A.bg,
                border: `2px solid ${isBull ? A.green : A.border}`,
                color: isBull ? A.green : A.textDim,
                transition: "all 120ms ease",
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: 0.2 }}>
                ▲ BULLISH <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>· Expecting Move Up</span>
              </div>
              <div style={{ fontSize: 10.5, color: isBull ? A.text : A.textMuted, marginTop: 2 }}>
                Calls &amp; Bull Call Spreads for {ticker}
              </div>
            </button>

            <button
              type="button"
              onClick={() => pickOutlook("bearish")}
              style={{
                padding: "11px 14px",
                borderRadius: 9,
                cursor: "pointer",
                textAlign: "left",
                background: !isBull ? "rgba(248, 113, 113, 0.16)" : A.bg,
                border: `2px solid ${!isBull ? A.red : A.border}`,
                color: !isBull ? A.red : A.textDim,
                transition: "all 120ms ease",
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: 0.2 }}>
                ▼ BEARISH <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>· Expecting Move Down</span>
              </div>
              <div style={{ fontSize: 10.5, color: !isBull ? A.text : A.textMuted, marginTop: 2 }}>
                Puts &amp; Bear Put Spreads for {ticker}
              </div>
            </button>
          </div>

          {/* PLAIN-ENGLISH RECOMMENDATION BANNER */}
          {playbook?.reason && (
            <div
              style={{
                background: playbook.bestId === "spread"
                  ? "rgba(192, 132, 252, 0.12)"
                  : `${outlookColor}14`,
                border: `1px solid ${playbook.bestId === "spread" ? "rgba(192,132,252,0.45)" : `${outlookColor}44`}`,
                borderRadius: 8,
                padding: "9px 12px",
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 12, color: A.text, lineHeight: 1.45, flex: "1 1 320px" }}>
                <strong style={{ color: playbook.bestId === "spread" ? "#c084fc" : outlookColor }}>
                  ★ Best Fit: {playbook.plays.find((p) => p.recommended)?.title}
                </strong>
                {" — "}
                {playbook.reason}
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10.5 }}>
                <span
                  style={{
                    padding: "2px 7px",
                    borderRadius: 5,
                    fontWeight: 700,
                    background: A.bg,
                    border: `1px solid ${A.border}`,
                    color: playbook.ivRegime === "cheap" ? A.green : playbook.ivRegime === "expensive" ? "#fbbf24" : A.textDim,
                  }}
                >
                  IV {fmtIv(playbook.atmIv)} · {playbook.ivRegime === "cheap" ? "Cheap" : playbook.ivRegime === "expensive" ? "Expensive" : "Fair"}
                </span>
                {playbook.earningsBeforeExpiry && (
                  <span style={{ padding: "2px 7px", borderRadius: 5, fontWeight: 700, background: "rgba(245,158,11,0.2)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.5)" }}>
                    ⚠ ER in {playbook.earningsDays}d
                  </span>
                )}
              </div>
            </div>
          )}

          {/* THE 3 PLAIN-ENGLISH TRADE CARDS */}
          {!playbook?.plays?.length ? (
            <div style={{ fontSize: 11.5, color: A.textMuted, padding: "10px 2px" }}>
              No liquid {outlook} contracts found for {fmtExpShort(analysis.expDate)}. Try switching to <strong>Swing (30–60d)</strong>.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))", gap: 10 }}>
              {playbook.plays.map((p) => {
                const isRec = p.recommended;
                const cp = p.type === "call" ? "C" : "P";
                const actionLine = p.kind === "spread"
                  ? `Buy $${fmtStrike(p.strike)}${cp} / Sell $${fmtStrike(p.shortStrike)}${cp}`
                  : `Buy $${fmtStrike(p.strike)} ${p.type === "call" ? "Call" : "Put"}`;
                const moveLabel = p.kind === "spread"
                  ? "Max Profit"
                  : isBull ? "At +1σ Move" : "At −1σ Move";

                return (
                  <div
                    key={p.id}
                    style={{
                      background: isRec ? `${p.accent}0e` : A.bg,
                      border: `${isRec ? 2 : 1}px solid ${isRec ? p.accent : A.border}`,
                      borderRadius: 9,
                      padding: "11px 13px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: p.accent }}>{p.title}</span>
                        {isRec ? (
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 800,
                              fontFamily: MONO,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: p.accent,
                              color: "#09090e",
                              letterSpacing: 0.3,
                            }}
                          >
                            ★ BEST FIT
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 700, color: gradeColor(p.grade) }}>
                            Liq {p.grade}
                          </span>
                        )}
                      </div>

                      {/* Exact Contract Order Line */}
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 14,
                          fontWeight: 800,
                          color: A.text,
                          marginTop: 7,
                          padding: "6px 8px",
                          background: A.bgCard,
                          border: `1px solid ${A.border}`,
                          borderRadius: 6,
                        }}
                      >
                        {actionLine}
                        <div style={{ fontSize: 10.5, fontWeight: 500, color: A.textMuted, marginTop: 2 }}>
                          Exp {fmtExpShort(p.expDate)} · {p.dte} days
                          {p.costSavingsPct > 0 && (
                            <span style={{ color: "#c084fc", fontWeight: 700 }}> · {p.costSavingsPct}% cheaper</span>
                          )}
                        </div>
                      </div>

                      {/* Plain-English When to Use */}
                      <div style={{ fontSize: 11, color: A.textDim, lineHeight: 1.4, marginTop: 8 }}>
                        {p.whenToUse}
                      </div>

                      {/* 4 Clear Decision Numbers */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 10 }}>
                        <div style={{ background: A.bgCard, borderRadius: 6, padding: "6px 8px", border: `1px solid ${A.border}` }}>
                          <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 600 }}>COST (MAX RISK)</div>
                          <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: A.text, marginTop: 1 }}>
                            ${p.maxRisk.toLocaleString()}
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 9.5, color: A.textMuted }}>${p.mid.toFixed(2)} / sh</div>
                        </div>

                        <div style={{ background: A.bgCard, borderRadius: 6, padding: "6px 8px", border: `1px solid ${A.border}` }}>
                          <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 600 }}>BREAKEVEN</div>
                          <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: A.text, marginTop: 1 }}>
                            ${p.breakeven.toFixed(2)}
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 9.5, color: A.textMuted }}>{fmtPct(p.breakevenPct, 1)} move</div>
                        </div>

                        <div style={{ background: A.bgCard, borderRadius: 6, padding: "6px 8px", border: `1px solid ${A.border}` }}>
                          <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 600 }}>{moveLabel.toUpperCase()}</div>
                          <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: A.green, marginTop: 1 }}>
                            {p.estGain1Em != null ? `+${p.estGain1Em}%` : "—"}
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 9.5, color: A.textMuted }}>
                            {p.kind === "spread"
                              ? `$${p.maxProfit.toLocaleString()} (${p.rr.toFixed(1)}× R:R)`
                              : (p.leverage != null ? `${p.leverage.toFixed(1)}× leverage` : "projected")}
                          </div>
                        </div>

                        <div style={{ background: A.bgCard, borderRadius: 6, padding: "6px 8px", border: `1px solid ${A.border}` }}>
                          <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 600 }}>LIQUIDITY</div>
                          <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: gradeColor(p.grade), marginTop: 1 }}>
                            Grade {p.grade}
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 9.5, color: A.textMuted }}>
                            {p.spreadPct != null ? `${p.spreadPct.toFixed(1)}% spread` : `OI ${fmtInt(p.oi)}`}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Subtle Greeks Footer */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 9, paddingTop: 6, borderTop: `1px solid ${A.border}`, fontSize: 10, fontFamily: MONO, color: A.textMuted }}>
                      <span>Δ {p.delta.toFixed(2)} · Θ {p.theta.toFixed(2)}/d · OI {fmtInt(p.oi)}</span>
                      {p.earningsBeforeExpiry ? (
                        <span style={{ color: "#fbbf24", fontWeight: 700 }}>⚠ ER {p.earningsDays}d</span>
                      ) : (
                        <span style={{ color: A.green }}>No ER</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 4-TILE KEY LEVELS STRIP (ONLY WHAT MATTERS FOR TARGETS & STOPS) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 8, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${A.border}` }}>
            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 10px" }}>
              <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 700 }}>SUPPORT (PUT WALL)</div>
              <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 800, color: A.red, marginTop: 2 }}>
                {analysis.putWall ? `$${fmtStrike(analysis.putWall.strike)}` : "—"}
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: A.textMuted }}>
                {analysis.putWall ? `${fmtInt(analysis.putWall.oi)} Put OI` : "—"}
              </div>
            </div>

            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 10px" }}>
              <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 700 }}>RESISTANCE (CALL WALL)</div>
              <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 800, color: A.green, marginTop: 2 }}>
                {analysis.callWall ? `$${fmtStrike(analysis.callWall.strike)}` : "—"}
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: A.textMuted }}>
                {analysis.callWall ? `${fmtInt(analysis.callWall.oi)} Call OI` : "—"}
              </div>
            </div>

            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 10px" }}>
              <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 700 }}>EXPECTED MOVE ({analysis.dte}D)</div>
              <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 800, color: A.cyan, marginTop: 2 }}>
                {analysis.expectedMove ? `±${analysis.expectedMove.pct.toFixed(1)}%` : "—"}
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: A.textMuted }}>
                {analysis.expectedMove ? `$${analysis.expectedMove.lower.toFixed(0)} – $${analysis.expectedMove.upper.toFixed(0)}` : "—"}
              </div>
            </div>

            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 7, padding: "7px 10px" }}>
              <div style={{ fontSize: 9.5, color: A.textMuted, fontWeight: 700 }}>OPTIONS FLOW TODAY</div>
              <div style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 800, color: callShare == null ? A.textMuted : callShare >= 55 ? A.green : callShare <= 45 ? A.red : A.text, marginTop: 2 }}>
                {callShare == null ? "—" : callShare >= 55 ? `${callShare}% Calls` : callShare <= 45 ? `${100 - callShare}% Puts` : `Balanced ${callShare}%C`}
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: A.textMuted }}>
                {flowStats ? `${fmtDollarVol(flowStats.totalCallPrem)} C · ${fmtDollarVol(flowStats.totalPutPrem)} P` : "—"}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── 3. Collapsible Advanced Drawer (Chain, Flow, Multi-Ticker Scan) ─ */}
      {analysis && (
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setAdvOpen((v) => !v)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "9px 14px",
              background: A.bgCard,
              border: `1px solid ${A.border}`,
              borderRadius: advOpen ? "10px 10px 0 0" : 10,
              color: A.textDim,
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <span>
              {advOpen ? "▾" : "▸"} Advanced Tools{" "}
              <span style={{ fontWeight: 400, color: A.textMuted, fontSize: 11 }}>
                · Full Option Chain · Unusual Flow ({tickerFlow.length}) · Multi-Ticker Scanner
              </span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: A.textMuted }}>
              {analysis.maxPain ? `Max Pain $${fmtStrike(analysis.maxPain.strike)} · ` : ""}
              {analysis.netGex ? `GEX ${fmtDollarVol(analysis.netGex, true)}` : ""}
            </span>
          </button>

          {advOpen && (
            <div
              style={{
                background: A.bgCard,
                border: `1px solid ${A.border}`,
                borderTop: "none",
                borderRadius: "0 0 10px 10px",
                padding: "10px 14px",
                marginBottom: 12,
              }}
            >
              {/* Advanced Sub-Tab Buttons */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                <div style={{ display: "inline-flex", gap: 5 }}>
                  {[
                    ["chain", "Option Chain"],
                    ["flow", `Unusual Flow (${tickerFlow.length})`],
                    ["scanner", "Multi-Ticker Scanner"],
                  ].map(([k, lbl]) => (
                    <button key={k} type="button" onClick={() => setAdvTab(k)} style={chipStyle(advTab === k, A.green)}>
                      {lbl}
                    </button>
                  ))}
                </div>

                {advTab === "chain" && (
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    {[["straddle", "Straddle"], ["calls", "Calls"], ["puts", "Puts"]].map(([k, lbl]) => (
                      <button key={k} type="button" onClick={() => setChainSide(k)} style={chipStyle(chainSide === k, A.cyan)}>
                        {lbl}
                      </button>
                    ))}
                    {[[10, "±10"], [20, "±20"], [999, "All"]].map(([n, lbl]) => (
                      <button key={n} type="button" onClick={() => setStrikeWindow(n)} style={chipStyle(strikeWindow === n, A.textDim)}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                )}

                {(advTab === "flow" || advTab === "scanner") && (
                  <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
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
                )}
              </div>

              {/* ADVANCED 1: OPTION CHAIN */}
              {advTab === "chain" && (
                <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                  {chainSide === "straddle" ? (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 2 }}>
                        <tr>
                          <th colSpan={6} style={{ ...cth("center"), color: A.green }}>CALLS</th>
                          <th style={{ ...cth("center"), color: A.text, background: A.bgRow }}>STRIKE</th>
                          <th colSpan={6} style={{ ...cth("center"), color: A.red }}>PUTS</th>
                        </tr>
                        <tr>
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
                        </tr>
                      </thead>
                      <tbody>
                        {chainRows.map((r) => {
                          const c = r.call, p = r.put;
                          const cBg = c?.itm ? `${A.green}0f` : "transparent";
                          const pBg = p?.itm ? `${A.red}0f` : "transparent";
                          return (
                            <tr key={r.strike} style={{ borderTop: r.isAtm ? `1.5px solid ${A.cyan}` : undefined }}>
                              <td style={ctd("right", { background: cBg, color: r.isCW ? A.green : A.textDim, fontWeight: r.isCW ? 700 : 400 })}>{c ? fmtInt(c.oi) : "—"}</td>
                              <td style={ctd("right", { background: cBg, color: c?.unusual ? "#fbbf24" : A.text })}>{c ? fmtInt(c.vol) : "—"}</td>
                              <td style={ctd("right", { background: cBg })}>{c ? c.delta.toFixed(2) : "—"}</td>
                              <td style={ctd("right", { background: cBg, color: A.textMuted })}>{c ? fmtIv(c.iv) : "—"}</td>
                              <td style={ctd("right", { background: cBg })}>{c ? c.bid.toFixed(2) : "—"}</td>
                              <td style={ctd("right", { background: cBg, color: A.green, fontWeight: 600 })}>{c ? c.ask.toFixed(2) : "—"}</td>
                              <td style={ctd("center", { background: r.isAtm ? `${A.cyan}22` : A.bgRow, color: r.isAtm ? A.cyan : A.text, fontWeight: 800, fontFamily: MONO })}>
                                {fmtStrike(r.strike)}
                                {r.isCW && <span style={{ marginLeft: 3, fontSize: 8.5, color: A.green }}>CW</span>}
                                {r.isPW && <span style={{ marginLeft: 3, fontSize: 8.5, color: A.red }}>PW</span>}
                              </td>
                              <td style={ctd("right", { background: pBg })}>{p ? p.bid.toFixed(2) : "—"}</td>
                              <td style={ctd("right", { background: pBg, color: A.red, fontWeight: 600 })}>{p ? p.ask.toFixed(2) : "—"}</td>
                              <td style={ctd("right", { background: pBg, color: A.textMuted })}>{p ? fmtIv(p.iv) : "—"}</td>
                              <td style={ctd("right", { background: pBg })}>{p ? p.delta.toFixed(2) : "—"}</td>
                              <td style={ctd("right", { background: pBg, color: p?.unusual ? "#fbbf24" : A.text })}>{p ? fmtInt(p.vol) : "—"}</td>
                              <td style={ctd("right", { background: pBg, color: r.isPW ? A.red : A.textDim, fontWeight: r.isPW ? 700 : 400 })}>{p ? fmtInt(p.oi) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead style={{ position: "sticky", top: 0, background: A.bgCard }}>
                        <tr>
                          <th style={cth("left")}>Strike</th>
                          <th style={cth("right")}>Bid</th>
                          <th style={cth("right")}>Ask</th>
                          <th style={cth("right")}>Mid</th>
                          <th style={cth("right")}>Spr%</th>
                          <th style={cth("right")}>IV</th>
                          <th style={cth("right")}>Δ</th>
                          <th style={cth("right")}>Θ/d</th>
                          <th style={cth("right")}>BE%</th>
                          <th style={cth("right")}>Vol</th>
                          <th style={cth("right")}>OI</th>
                          <th style={cth("center")}>Liq</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chainRows.map((r) => {
                          const c = chainSide === "calls" ? r.call : r.put;
                          if (!c) return null;
                          return (
                            <tr key={r.strike} style={{ background: c.itm ? (chainSide === "calls" ? `${A.green}0f` : `${A.red}0f`) : "transparent", borderTop: r.isAtm ? `1.5px solid ${A.cyan}` : undefined }}>
                              <td style={ctd("left", { fontFamily: MONO, fontWeight: 700, color: r.isAtm ? A.cyan : A.text })}>${fmtStrike(c.strike)}</td>
                              <td style={ctd("right")}>{c.bid.toFixed(2)}</td>
                              <td style={ctd("right")}>{c.ask.toFixed(2)}</td>
                              <td style={ctd("right", { fontWeight: 700, color: A.text })}>{c.mid.toFixed(2)}</td>
                              <td style={ctd("right")}>{c.spreadPct != null ? `${c.spreadPct.toFixed(1)}%` : "—"}</td>
                              <td style={ctd("right")}>{fmtIv(c.iv)}</td>
                              <td style={ctd("right", { fontWeight: 700, color: A.text })}>{c.delta.toFixed(2)}</td>
                              <td style={ctd("right", { color: A.red })}>{c.theta.toFixed(2)}</td>
                              <td style={ctd("right")}>{fmtPct(c.breakevenPct, 1)}</td>
                              <td style={ctd("right", { color: c.unusual ? "#fbbf24" : A.text })}>{fmtInt(c.vol)}</td>
                              <td style={ctd("right")}>{fmtInt(c.oi)}</td>
                              <td style={ctd("center", { fontWeight: 800, color: gradeColor(c.grade) })}>{c.grade}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ADVANCED 2: UNUSUAL FLOW */}
              {advTab === "flow" && (
                <div>
                  <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
                    {[["all", "All"], ["call", "Calls"], ["put", "Puts"]].map(([k, lbl]) => (
                      <button key={k} type="button" onClick={() => setFlowSideFilter(k)} style={chipStyle(flowSideFilter === k, k === "put" ? A.red : A.green)}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  {scanError && <div style={{ fontSize: 11, color: A.red, marginBottom: 6 }}>{scanError}</div>}
                  {scanLoading && !scanAgg ? (
                    <div className="tp-shimmer" style={{ height: 110, borderRadius: 6 }} />
                  ) : (
                    <div style={{ overflowX: "auto", maxHeight: 380, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead style={{ position: "sticky", top: 0, background: A.bgCard }}>
                          <tr>
                            <th style={cth("left")}>Ticker</th>
                            <th style={cth("left")}>Signal</th>
                            <th style={cth("left")}>Contract</th>
                            <th style={cth("right")}>Vol</th>
                            <th style={cth("right")}>OI</th>
                            <th style={cth("right")}>V/OI</th>
                            <th style={cth("right")}>Est $ Prem</th>
                            <th style={cth("right")}>Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(scanAgg?.flowRows || tickerFlow)
                            .filter((r) => flowSideFilter === "all" || r.type === flowSideFilter)
                            .slice(0, 40)
                            .map((r) => {
                              const isCall = r.type === "call";
                              const col = isCall ? A.green : A.red;
                              return (
                                <tr
                                  key={r.sym || `${r.ticker}-${r.expDate}-${r.type}-${r.strike}`}
                                  className="tp-click-row"
                                  onClick={() => onTicker?.(r.ticker)}
                                  style={{ cursor: "pointer" }}
                                >
                                  <td style={ctd("left", { fontFamily: MONO, fontWeight: 700, color: r.ticker === ticker ? A.green : A.text })}>
                                    {r.ticker}
                                    <TierMark t={r.ticker} />
                                  </td>
                                  <td style={ctd("left")}>
                                    <span style={{ fontSize: 9.5, fontWeight: 800, fontFamily: MONO, padding: "1px 5px", borderRadius: 4, background: `${col}20`, color: col }}>
                                      {r.tag}
                                    </span>
                                  </td>
                                  <td style={ctd("left", { fontFamily: MONO, fontWeight: 700, color: A.text })}>
                                    ${fmtStrike(r.strike)}{isCall ? "C" : "P"} · {fmtExpShort(r.expDate)} ({r.dte}d)
                                  </td>
                                  <td style={ctd("right")}>{fmtInt(r.vol)}</td>
                                  <td style={ctd("right")}>{fmtInt(r.oi)}</td>
                                  <td style={ctd("right", { fontWeight: 800, color: r.volOi >= 3 ? "#fbbf24" : col })}>{r.volOi.toFixed(1)}×</td>
                                  <td style={ctd("right", { fontWeight: 800, color: col })}>{fmtDollarVol(r.notional)}</td>
                                  <td style={ctd("right")}>{r.delta.toFixed(2)}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ADVANCED 3: MULTI-TICKER SWING SCANNER */}
              {advTab === "scanner" && (
                <div>
                  {scanError && <div style={{ fontSize: 11, color: A.red, marginBottom: 6 }}>{scanError}</div>}
                  {scanLoading && !scanAgg ? (
                    <div className="tp-shimmer" style={{ height: 110, borderRadius: 6 }} />
                  ) : (
                    <div style={{ overflowX: "auto", maxHeight: 380, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead style={{ position: "sticky", top: 0, background: A.bgCard }}>
                          <tr>
                            <th style={cth("left")}>Ticker</th>
                            <th style={cth("right")}>RS</th>
                            <th style={cth("right")}>Chg%</th>
                            <th style={cth("right")}>Swing Call (30–60d)</th>
                            <th style={cth("right")}>Cost</th>
                            <th style={cth("right")}>BE%</th>
                            <th style={cth("right")}>IV</th>
                            <th style={cth("center")}>Liq</th>
                            <th style={cth("right")}>ER</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...(scanAgg?.swingRows || [])]
                            .sort((a, b) => (b.rs ?? 0) - (a.rs ?? 0))
                            .map((r) => {
                              const s = r.setup;
                              return (
                                <tr
                                  key={r.ticker}
                                  className="tp-click-row"
                                  onClick={() => onTicker?.(r.ticker)}
                                  style={{ cursor: "pointer" }}
                                >
                                  <td style={ctd("left", { fontFamily: MONO, fontWeight: 700, color: r.ticker === ticker ? A.green : A.text })}>
                                    <FlagButton t={r.ticker} A={A} />
                                    {r.ticker}
                                    <TierMark t={r.ticker} />
                                  </td>
                                  <td style={ctd("right", { fontWeight: 700, color: (r.rs ?? 0) >= 90 ? A.green : A.textDim })}>{r.rs ?? "—"}</td>
                                  <td style={ctd("right", { fontWeight: 700, color: pc(r.changePct) })}>{fmtPct(r.changePct, 1)}</td>
                                  <td style={ctd("right", { fontWeight: 700, color: A.text })}>
                                    ${fmtStrike(s.strike)}C · {fmtExpShort(s.expDate)} ({s.dte}d)
                                  </td>
                                  <td style={ctd("right")}>${s.maxRiskPerContract.toLocaleString()}</td>
                                  <td style={ctd("right")}>{fmtPct(s.breakevenPct, 1)}</td>
                                  <td style={ctd("right")}>{fmtIv(r.atmIv)}</td>
                                  <td style={ctd("center", { fontWeight: 800, color: gradeColor(s.grade) })}>{s.grade}</td>
                                  <td style={ctd("right")}>
                                    {s.earningsBeforeExpiry ? <span style={{ color: "#fbbf24", fontWeight: 700 }}>ER {s.earningsDays}d</span> : <span style={{ color: A.green }}>Clean</span>}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
