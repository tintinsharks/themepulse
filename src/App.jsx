import { useState, useMemo, useCallback, useEffect, useRef, Fragment, memo, Component } from "react";
import USMarketQuadrant from "./USMarketQuadrant.jsx";

// ── Error Boundary ──
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: "#f87171", background: "#1a1a24", borderRadius: 6, margin: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Something went wrong in {this.props.name || "this section"}</div>
          <div style={{ color: "#686878", fontSize: 10 }}>{this.state.error?.message}</div>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 8, padding: "4px 12px", borderRadius: 4, border: "1px solid #f87171", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 10 }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const GRADE_COLORS = {
  "A+":"#1B7A2B","A":"#2E8B3C","A-":"#44A04D",
  "B+":"#5CB85C","B":"#78C878","B-":"#93D893",
  "C+":"#B0E8B0","C":"#CCF2CC","C-":"#E8F8E8",
  "D+":"#e5e5e5","D":"#FFF0F0","D-":"#FFE0E0",
  "E+":"#FFCECE","E":"#FFBABA","E-":"#FFA5A5",
  "F+":"#FF8C8C","F":"#FF7070","F-":"#FF5050",
  "G+":"#FF3030","G":"#E01010",
};

function getQuad(wrs, mrs) {
  if (wrs >= 50 && mrs >= 50) return "STRONG";
  if (wrs >= 50) return "IMPROVING";
  if (mrs >= 50) return "WEAKENING";
  return "WEAK";
}

const QC = {
  STRONG: { bg: "#064e3b", text: "#4aad8c", tag: "#059669" },
  IMPROVING: { bg: "#422006", text: "#fcd34d", tag: "#d97706" },
  WEAKENING: { bg: "#431407", text: "#fdba74", tag: "#ea580c" },
  WEAK: { bg: "#450a0a", text: "#fca5a5", tag: "#dc2626" },
};

const Ret = memo(function Ret({ v, bold }) {
  if (v == null) return <span style={{ color: "#787888" }}>—</span>;
  const c = v > 0 ? "#2bb886" : v < 0 ? "#f87171" : "#9090a0";
  return <span style={{ color: c, fontWeight: 400, fontFamily: "monospace" }}>{v > 0 ? "+" : ""}{v.toFixed(1)}%</span>;
});

const Badge = memo(function Badge({ grade }) {
  if (!grade) return null;
  const bg = GRADE_COLORS[grade] || "#505060";
  const light = ["B-","C+","C","C-","D+","D","D-","E+","E"].includes(grade);
  return <span style={{ background: bg, color: light ? "#2a2a38" : "#d4d4e0", padding: "1px 5px", borderRadius: 3, fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{grade}</span>;
});

// ── SOURCE BADGE (ER / PM-SIP / AH-SIP tag) ──
const SOURCE_BADGE_STYLES = {
  er:     { label: "ER",     color: "#c084fc", bg: "#c084fc18", border: "#c084fc30" },
  pm_sip: { label: "PM-SIP", color: "#38bdf8", bg: "#38bdf818", border: "#38bdf830" },
  ah_sip: { label: "AH-SIP", color: "#f97316", bg: "#f9731618", border: "#f9731630" },
};
const SourceBadge = memo(function SourceBadge({ source }) {
  const s = SOURCE_BADGE_STYLES[source];
  if (!s) return null;
  return <span style={{ padding: "0px 3px", borderRadius: 2, fontSize: 8, fontWeight: 700,
    color: s.color, background: s.bg, border: `1px solid ${s.border}`, verticalAlign: "super", marginLeft: 3 }}>{s.label}</span>;
});

// ── STOCK STAT (label: value pair for chart panel) ──
const StockStat = memo(function StockStat({ label, value, color = "#9090a0" }) {
  return (
    <span style={{ whiteSpace: "nowrap", lineHeight: 1.1 }}>
      <span style={{ color: "#686878" }}>{label}: </span>
      <span style={{ color, fontFamily: "monospace" }}>{value}</span>
    </span>
  );
});

// ── PERSISTENT CHART PANEL (right side) ──
const TV_LAYOUT = "nkNPuLqj";

function ChartPanel({ ticker, stock, onClose, onTickerClick, watchlist, onAddWatchlist, onRemoveWatchlist, portfolio, onAddPortfolio, onRemovePortfolio, pkn, onAddPkn, onRemovePkn, pknWatch, onAddPknWatch, onRemovePknWatch, liveThemeData, lwChartProps, erSipLookup }) {
  const containerRef = useRef(null);
  const [tf, setTf] = useState("D");
  const [showDetails, setShowDetails] = useState(true);
  const [news, setNews] = useState(null);
  const [peers, setPeers] = useState(null);
  const [analyst, setAnalyst] = useState(null);
  const [description, setDescription] = useState(null);
  const [finvizQuarters, setFinvizQuarters] = useState(null);

  // Live data for this ticker from theme universe
  const live = useMemo(() => {
    if (!liveThemeData) return null;
    return liveThemeData.find(s => s.ticker === ticker) || null;
  }, [liveThemeData, ticker]);

  // Fetch news, peers, description, and FactSet quarters when ticker changes
  useEffect(() => {
    setNews(null);
    setPeers(null);
    setAnalyst(null);    setDescription(null);
    setFinvizQuarters(null);
    fetch(`/api/live?news=${ticker}`)
      .then(r => {
        if (!r.ok) { setNews([]); setPeers([]); setDescription(''); return null; }
        return r.json();
      })
      .then(d => {
        if (d?.ok) {
          setNews(d.news && d.news.length > 0 ? d.news : []);
          setPeers(d.peers && d.peers.length > 0 ? d.peers : []);
          setAnalyst(d.analyst || null);
          setDescription(d.description || '');
          setFinvizQuarters(d.finvizQuarters && d.finvizQuarters.length > 0 ? d.finvizQuarters : null);
        } else { setNews([]); setPeers([]); setAnalyst(null); setDescription(''); }
      })
      .catch(() => { setNews([]); setPeers([]); setAnalyst(null); setDescription(''); });
  }, [ticker]);

  const tvLayoutUrl = `https://www.tradingview.com/chart/${TV_LAYOUT}/?symbol=${encodeURIComponent(ticker)}`;

  const tfOptions = [
    ["1", "1m"], ["5", "5m"], ["15", "15m"], ["60", "1H"],
    ["D", "D"], ["W", "W"], ["M", "M"],
  ];

  const hasLwChart = !!lwChartProps;
  useEffect(() => {
    if (hasLwChart) {
      // Clean up TradingView when switching to LW chart
      if (containerRef.current) containerRef.current.innerHTML = "";
      return;
    }
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.id = "tv_chart_container";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";
    containerRef.current.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => {
      if (window.TradingView) {
        new window.TradingView.widget({
          autosize: true,
          symbol: ticker,
          interval: tf,
          timezone: "America/New_York",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#121218",
          enable_publishing: false,
          allow_symbol_change: false,
          save_image: false,
          hide_top_toolbar: true,
          hide_legend: true,
          backgroundColor: "rgba(10, 10, 10, 1)",
          gridColor: "rgba(30, 30, 30, 1)",
          container_id: "tv_chart_container",
          studies: [
            { id: "MAExp@tv-basicstudies", inputs: { length: 8 } },
            { id: "MAExp@tv-basicstudies", inputs: { length: 21 } },
            { id: "MASimple@tv-basicstudies", inputs: { length: 50 } },
            { id: "MASimple@tv-basicstudies", inputs: { length: 200 } },
          ],
        });
      }
    };
    document.head.appendChild(script);

    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, [ticker, tf, hasLwChart]);


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", borderLeft: "1px solid #2a2a38", background: "#121218" }}>
      {/* Always visible: Ticker, Watch/Portfolio, Grade, RS, Theme, Close */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px",
        borderBottom: "1px solid #2a2a38", flexShrink: 0, background: "#1a1a24" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: "#d4d4e0" }}>{ticker}</span>
          {erSipLookup && erSipLookup[ticker] && <SourceBadge source={erSipLookup[ticker]} />}
          {watchlist && (
            watchlist.includes(ticker)
              ? <button onClick={() => onRemoveWatchlist(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "#0d916320", border: "1px solid #0d916340", color: "#0d9163" }}>✓ Watch</button>
              : <button onClick={() => onAddWatchlist(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", border: "1px solid #3a3a4a", color: "#787888" }}>+ Watch</button>
          )}
          {portfolio && (
            portfolio.includes(ticker)
              ? <button onClick={() => onRemovePortfolio(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "#fbbf2420", border: "1px solid #fbbf2440", color: "#fbbf24" }}>✓ Portfolio</button>
              : <button onClick={() => onAddPortfolio(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", border: "1px solid #3a3a4a", color: "#787888" }}>+ Portfolio</button>
          )}
          {pkn && (
            pkn.includes(ticker)
              ? <button onClick={() => onRemovePkn(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "#e879f920", border: "1px solid #e879f940", color: "#e879f9" }}>✓ PKN</button>
              : <button onClick={() => onAddPkn(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", border: "1px solid #3a3a4a", color: "#787888" }}>+ PKN</button>
          )}
          {pknWatch && (
            pknWatch.includes(ticker)
              ? <button onClick={() => onRemovePknWatch(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "#a78bfa20", border: "1px solid #a78bfa40", color: "#a78bfa" }}>✓ PKN W</button>
              : <button onClick={() => onAddPknWatch(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", border: "1px solid #3a3a4a", color: "#787888" }}>+ PKN W</button>
          )}
          {stock && (<>
            <Badge grade={stock.grade} />
            <span style={{ color: "#787888", fontSize: 12 }}>RS:{stock.rs_rank}</span>
            {stock.themes && stock.themes.length > 0 && (
              <span style={{ color: "#0d9163", fontSize: 11 }}>{stock.themes.map(t => t.subtheme ? `${t.theme} › ${t.subtheme}` : t.theme).join(", ")}</span>
            )}
          </>)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <a href={tvLayoutUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: "#0d9163", fontSize: 12, textDecoration: "none", padding: "4px 12px", border: "1px solid #0d916340",
              borderRadius: 4, fontWeight: 700 }}>
            Full Chart ↗</a>
          <button onClick={onClose} style={{ background: "none", border: "1px solid #505060", borderRadius: 4, color: "#787888", fontSize: 14,
            width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
      </div>

      {/* Toggle bar: price, change, timeframes, details toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 12px",
        borderBottom: "1px solid #222230", flexShrink: 0, background: "#141420" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {live && live.price != null && (
            <span style={{ fontSize: 16, fontWeight: 900, color: "#d4d4e0", fontFamily: "monospace" }}>
              ${live.price.toFixed(2)}
            </span>
          )}
          {live && live.change != null && (
            <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "monospace",
              color: live.change > 0 ? "#2bb886" : live.change < 0 ? "#f87171" : "#9090a0" }}>
              {live.change > 0 ? "+" : ""}{live.change.toFixed(2)}%
            </span>
          )}
          <span style={{ color: "#3a3a4a", margin: "0 2px" }}>|</span>
          {tfOptions.map(([val, label]) => (
            <button key={val} onClick={() => setTf(val)}
              style={{ padding: "2px 6px", borderRadius: 3, fontSize: 11, cursor: "pointer",
                border: tf === val ? "1px solid #0d9163" : "1px solid #3a3a4a",
                background: tf === val ? "#0d916320" : "transparent",
                color: tf === val ? "#4aad8c" : "#787888" }}>
              {label}
            </button>
          ))}
          {stock && stock.off_52w_high != null && (<>
            <span style={{ color: "#3a3a4a", margin: "0 2px" }}>|</span>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: stock.off_52w_high >= -25 ? "#2bb886" : "#f97316" }}>
              Off 52W Hi:{stock.off_52w_high}%</span>
          </>)}
          {stock && stock.hv52_vol != null && (<>
            <span style={{ color: "#3a3a4a", margin: "0 2px" }}>|</span>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "#60a5fa" }}
              title={`Highest Volume 52W: ${stock.hv52_date}`}>
              HV52:{stock.hv52_date?.slice(5)} {stock.hv52_vol >= 1e9 ? (stock.hv52_vol/1e9).toFixed(1)+"B" : stock.hv52_vol >= 1e6 ? (stock.hv52_vol/1e6).toFixed(1)+"M" : stock.hv52_vol >= 1e3 ? (stock.hv52_vol/1e3).toFixed(0)+"K" : stock.hv52_vol}</span>
          </>)}
          {stock && stock.hvq_vol != null && (<>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "#a78bfa", marginLeft: 4 }}
              title={`Highest Volume Quarter: ${stock.hvq_date}`}>
              HVQ:{stock.hvq_date?.slice(5)} {stock.hvq_vol >= 1e9 ? (stock.hvq_vol/1e9).toFixed(1)+"B" : stock.hvq_vol >= 1e6 ? (stock.hvq_vol/1e6).toFixed(1)+"M" : stock.hvq_vol >= 1e3 ? (stock.hvq_vol/1e3).toFixed(0)+"K" : stock.hvq_vol}</span>
          </>)}
        </div>
        <span onClick={() => setShowDetails(p => !p)}
          style={{ color: "#686878", fontSize: 11, cursor: "pointer", padding: "2px 6px" }}>
          {showDetails ? "▾ details" : "▸ details"}
        </span>
      </div>

      {/* Collapsible: company, sector, stats, earnings */}
      {showDetails && (<>

      {stock && (
        <div style={{ display: "flex", gap: 12, padding: "4px 12px", borderBottom: "1px solid #222230", fontSize: 11, flexShrink: 0, alignItems: "center" }}>
          <span style={{ color: "#9090a0" }}>{stock.company}</span>
          <span style={{ color: "#505060", fontSize: 10 }}>{stock.sector} · {stock.industry}</span>
        </div>
      )}

      {/* Stock detail row — metrics left, news right */}
      {stock && (
        <div style={{ display: "flex", padding: "4px 12px", borderBottom: "1px solid #222230", fontSize: 11, flexShrink: 0, gap: 0 }}>
          {/* Left: metrics */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: "0 1 27%", minWidth: 0, fontSize: 10, fontFamily: "monospace", lineHeight: 1.4, overflow: "hidden", wordBreak: "break-all" }}>
          {/* ADR | RVol */}
          <div style={{ width: "100%", display: "flex", gap: 0, alignItems: "center" }}>
            {stock.adr_pct != null && <span style={{ color: stock.adr_pct > 8 ? "#2dd4bf" : stock.adr_pct > 5 ? "#2bb886" : stock.adr_pct > 3 ? "#fbbf24" : "#f97316" }}>ADR:{stock.adr_pct}%</span>}
            {stock.adr_pct != null && <span style={{ color: "#3a3a4a", margin: "0 6px" }}>│</span>}
            {(() => { const rv = live?.rel_volume ?? stock.rel_volume;
              return rv != null ? <span style={{ color: rv >= 2 ? "#c084fc" : rv >= 1.5 ? "#a78bfa" : "#686878" }}>RVol:{Number(rv).toFixed(1)}x</span> : null;
            })()}
          </div>
          {/* 1M / 3M / 6M */}
          <div style={{ width: "100%", display: "flex", gap: 8 }}>
            <span>1M:<Ret v={stock.return_1m} /></span>
            <span>3M:<Ret v={stock.return_3m} /></span>
            <span>6M:<Ret v={stock.return_6m} /></span>
          </div>
          {stock.avg_dollar_vol && <StockStat label="Avg $Vol" value={`$${stock.avg_dollar_vol}`}
            color={stock.avg_dollar_vol_raw > 20000000 ? "#2bb886" : stock.avg_dollar_vol_raw > 10000000 ? "#fbbf24" : stock.avg_dollar_vol_raw > 5000000 ? "#f97316" : "#f87171"} />}
          {stock.avg_volume && <StockStat label="Avg Vol" value={stock.avg_volume}
            color={stock.avg_volume_raw > 1000000 ? "#2bb886" : "#f97316"} />}
          {stock.volume != null && <StockStat label="Vol" value={(() => { const v = stock.volume; if (v >= 1e9) return (v/1e9).toFixed(2)+"B"; if (v >= 1e6) return (v/1e6).toFixed(2)+"M"; if (v >= 1e3) return (v/1e3).toFixed(0)+"K"; return v; })()}
            color={stock.avg_volume_raw && stock.volume > stock.avg_volume_raw ? "#2bb886" : "#f97316"} />}
          {stock.shares_float && <StockStat label="Float" value={stock.shares_float}
            color={stock.shares_float_raw < 10000000 ? "#2bb886" : stock.shares_float_raw < 25000000 ? "#fbbf24" : "#f97316"} />}
          {stock.short_float != null && <StockStat label="Short%" value={`${stock.short_float}%`} />}
          {stock.sma20_pct != null && stock.dist_20dma_atrx != null && (() => {
            const atrx = Math.abs(stock.dist_20dma_atrx);
            const col = atrx >= 10 ? "#f87171" : atrx >= 6 ? "#fbbf24" : "#f97316";
            return <StockStat label="20d" value={`${stock.sma20_pct > 0 ? '+' : ''}${stock.sma20_pct}% / ${stock.dist_20dma_atrx}x`} color={col} />;
          })()}
          {stock.sma50_pct != null && stock.dist_50sma_atrx != null && (() => {
            const atrx = Math.abs(stock.dist_50sma_atrx);
            const col = atrx >= 10 ? "#f87171" : atrx >= 6 ? "#fbbf24" : "#f97316";
            return <StockStat label="50d" value={`${stock.sma50_pct > 0 ? '+' : ''}${stock.sma50_pct}% / ${stock.dist_50sma_atrx}x`} color={col} />;
          })()}
          {stock.sma200_pct != null && stock.dist_200sma_atrx != null && (() => {
            const atrx = Math.abs(stock.dist_200sma_atrx);
            const col = atrx >= 10 ? "#f87171" : atrx >= 6 ? "#fbbf24" : "#f97316";
            return <StockStat label="200d" value={`${stock.sma200_pct > 0 ? '+' : ''}${stock.sma200_pct}% / ${stock.dist_200sma_atrx}x`} color={col} />;
          })()}
          {(stock.inst_own != null || stock.inst_trans != null) && (
            <div style={{ width: "100%", display: "flex", gap: 0, alignItems: "center" }}>
              {stock.inst_own != null && <StockStat label="Inst" value={`${stock.inst_own}%`}
                color={stock.inst_own >= 80 ? "#2bb886" : stock.inst_own >= 50 ? "#9090a0" : "#f97316"} />}
              {stock.inst_own != null && stock.inst_trans != null && <span style={{ color: "#3a3a4a", margin: "0 6px" }}>│</span>}
              {stock.inst_trans != null && <StockStat label="Trans" value={`${stock.inst_trans > 0 ? '+' : ''}${stock.inst_trans}%`}
                color={stock.inst_trans > 0 ? "#2bb886" : stock.inst_trans < 0 ? "#f87171" : "#686878"} />}
            </div>
          )}
          </div>
          {/* Earnings Timeline */}
          <div style={{ width: 1, background: "#3a3a4a", margin: "0 8px", flexShrink: 0, alignSelf: "stretch" }} />
          <div style={{ flex: "0 0 auto", minWidth: 203, fontSize: 10, fontFamily: "monospace" }}>
            <div style={{ color: "#686878", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "baseline", gap: 6 }}>
              <span>Earnings</span>
              {(stock.earnings_display || stock.earnings_date) && (() => {
                const raw = stock.earnings_display || stock.earnings_date || "";
                const trimmed = raw.replace(/:00(?=\s|$)/g, "");
                const days = stock.earnings_days != null ? Number(stock.earnings_days) : null;
                const showDays = days != null && !isNaN(days);
                return (
                <span style={{ fontWeight: 400, fontSize: 10 }}>
                  <span style={{ color: showDays && days <= 7 ? "#f87171" : showDays && days <= 14 ? "#fbbf24" : "#c084fc" }}>
                    ▶ {trimmed}
                  </span>
                  {showDays && <span style={{ color: "#686878", marginLeft: 4 }}>({days}d)</span>}
                </span>
                );
              })()}
            </div>
            {/* Earnings beat/miss from 09g — show if er data present */}
            {stock.er && stock.er.eps != null && (() => {
              const er = stock.er;
              const epsBeat = er.eps != null && er.eps_estimated != null ? er.eps - er.eps_estimated : null;
              const revBeat = er.revenue != null && er.revenue_estimated != null ? er.revenue - er.revenue_estimated : null;
              const epsBeatColor = epsBeat != null ? (epsBeat >= 0 ? "#2bb886" : "#f87171") : "#484858";
              const revBeatColor = revBeat != null ? (revBeat >= 0 ? "#2bb886" : "#f87171") : "#484858";
              const fmtRev = (v) => { if (!v) return "—"; const n = Math.abs(v); return n >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : n >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${v.toLocaleString()}`; };
              return (
                <div style={{ padding: "3px 6px", marginBottom: 4, background: "#ffffff06", border: "1px solid #2a2a3a",
                  borderRadius: 3, fontSize: 10, fontFamily: "monospace", display: "flex", gap: 10, alignItems: "center" }}>
                  <span>
                    <span style={{ color: "#686878" }}>EPS </span>
                    <span style={{ color: "#a8a8b8", fontWeight: 600 }}>${er.eps?.toFixed(2)}</span>
                    {er.eps_estimated != null && <span style={{ color: "#505060" }}> / ${er.eps_estimated.toFixed(2)}</span>}
                    {epsBeat != null && <span style={{ color: epsBeatColor, fontWeight: 700, marginLeft: 3 }}>{epsBeat >= 0 ? "✓" : "✗"}{epsBeat >= 0 ? "+" : ""}{epsBeat.toFixed(2)}</span>}
                  </span>
                  {er.revenue != null && <span>
                    <span style={{ color: "#686878" }}>Rev </span>
                    <span style={{ color: "#a8a8b8", fontWeight: 600 }}>{fmtRev(er.revenue)}</span>
                    {er.revenue_estimated != null && <span style={{ color: "#505060" }}> / {fmtRev(er.revenue_estimated)}</span>}
                    {revBeat != null && <span style={{ color: revBeatColor, fontWeight: 700, marginLeft: 3 }}>{revBeat >= 0 ? "✓" : "✗"}{revBeat >= 0 ? "+" : ""}{fmtRev(Math.abs(revBeat)).replace("$","")}</span>}
                  </span>}
                </div>
              );
            })()}
            {/* Past earnings from quarterly data — CANSLIM C: Current Quarterly */}
            {/* Code 33: 3 consecutive quarters of acceleration in EPS, Sales, and Profit Margins */}
            {(() => {
              const qs = stock.quarters || [];
              // Detect acceleration sequences (each quarter vs next older quarter)
              const accel = qs.map((q, i) => {
                const prev = qs[i + 1];
                if (!prev) return null;
                const epsA = q.eps_yoy != null && prev.eps_yoy != null && q.eps_yoy > prev.eps_yoy && q.eps_yoy > 0;
                const salesA = q.sales_yoy != null && prev.sales_yoy != null && q.sales_yoy > prev.sales_yoy && q.sales_yoy > 0;
                // Margin: use real net_margin from FMP if available, else fall back to op_margin, then gross_margin
                const qMargin = q.net_margin ?? q.op_margin ?? q.gross_margin;
                const pMargin = prev.net_margin ?? prev.op_margin ?? prev.gross_margin;
                const marginA = qMargin != null && pMargin != null && qMargin > pMargin;
                const marginExp = qMargin != null && pMargin != null && qMargin > pMargin;
                return { eps: epsA, sales: salesA, margin: marginA, marginExp };
              });
              // Code 33: 3 consecutive quarters (indices 0,1,2) all show acceleration in all three
              const code33 = accel[0] && accel[1] && accel[2]
                && accel[0].eps && accel[1].eps && accel[2].eps
                && accel[0].sales && accel[1].sales && accel[2].sales
                && accel[0].margin && accel[1].margin && accel[2].margin;
              return (<>
              {code33 && (
                <div style={{ padding: "2px 4px", marginBottom: 2, background: "rgba(96, 165, 250, 0.12)", border: "1px solid rgba(96, 165, 250, 0.30)",
                  borderRadius: 3, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "#60a5fa", fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>CODE 33</span>
                  <span style={{ color: "#60a5fa", fontSize: 10 }}>3Q accel: EPS + Sales + Margins</span>
                </div>
              )}
              {qs.map((q, i) => {
                // Quarterly EPS tiers (O'Neil): ≥25% minimum, 50-100%+ winner standard
                const epsYoy = q.eps_yoy;
                const epsTier = epsYoy >= 100 ? 3 : epsYoy >= 50 ? 2 : epsYoy >= 25 ? 1 : 0;
                const epsBg = epsTier === 3 ? "rgba(43, 184, 134, 0.18)" : epsTier === 2 ? "rgba(43, 184, 134, 0.10)" : epsTier === 1 ? "rgba(43, 184, 134, 0.05)" : "transparent";
                const epsIcon = epsTier === 3 ? "★" : epsTier === 2 ? "●" : epsTier === 1 ? "○" : "";
                // Quarterly Sales tiers (O'Neil): ≥20% minimum, 25%+ strong
                const salesYoy = q.sales_yoy;
                const salesTier = salesYoy >= 50 ? 3 : salesYoy >= 25 ? 2 : salesYoy >= 20 ? 1 : 0;
                const salesBg = salesTier === 3 ? "rgba(43, 184, 134, 0.18)" : salesTier === 2 ? "rgba(43, 184, 134, 0.10)" : salesTier === 1 ? "rgba(43, 184, 134, 0.05)" : "transparent";
                // Acceleration/deceleration for this quarter
                const a = accel[i];
                const isEpsAccel = a?.eps;
                const isEpsDecel = !isEpsAccel && epsYoy != null && qs[i+1]?.eps_yoy != null && epsYoy < qs[i+1].eps_yoy && epsYoy > 0 && qs[i+1].eps_yoy > 0;
                const isSalesAccel = a?.sales;
                const isMarginAccel = a?.marginExp;
                // Real margin data (prefer net > op > gross)
                const margin = q.net_margin ?? q.op_margin ?? q.gross_margin;
                const marginLabel = q.net_margin != null ? "NM" : q.op_margin != null ? "OM" : q.gross_margin != null ? "GM" : null;
                const prevMargin = qs[i+1] ? (qs[i+1].net_margin ?? qs[i+1].op_margin ?? qs[i+1].gross_margin) : null;
                const marginDelta = margin != null && prevMargin != null ? margin - prevMargin : null;
                // Code 33 quarter highlighting (blue)
                const isCode33Q = code33 && i <= 2 && accel[i]?.eps && accel[i]?.sales && accel[i]?.margin;
                const rowBorder = isCode33Q ? "1px solid rgba(96, 165, 250, 0.30)"
                  : isEpsAccel ? "1px solid #2bb88650" : isEpsDecel ? "1px solid #f8717130" : "none";
                const rowBg = isCode33Q ? "rgba(96, 165, 250, 0.06)" : "transparent";
                return (
                <div key={i} style={{ padding: "1px 0", color: "#505060", display: "flex", gap: 3,
                  borderBottom: rowBorder, background: rowBg, borderRadius: isCode33Q ? 2 : 0 }}>
                  <span style={{ width: 40, flexShrink: 0 }}>{q.report_date ? q.report_date.slice(5) : q.label}</span>
                  <span style={{ color: q.eps_yoy > 0 ? "#2bb886" : q.eps_yoy < 0 ? "#f87171" : "#9090a0", width: 66, flexShrink: 0,
                    background: epsBg, borderRadius: 2, padding: "0 2px" }}>
                    {q.eps != null ? <>
                      {epsIcon && <span style={{ fontSize: 8, marginRight: 1 }}>{epsIcon}</span>}
                      E:{q.eps_yoy != null ? `${q.eps_yoy > 0 ? "+" : ""}${q.eps_yoy.toFixed(0)}%` : q.eps}
                      {isEpsAccel && <span style={{ color: isCode33Q ? "#60a5fa" : "#2bb886", fontSize: 10, marginLeft: 3 }} title="EPS accelerating vs prior quarter">▲</span>}
                      {isEpsDecel && <span style={{ color: "#f87171", fontSize: 10, marginLeft: 3 }} title="EPS decelerating vs prior quarter">▼</span>}
                    </> : ""}
                  </span>
                  <span style={{ color: q.sales_yoy >= 20 ? "#2bb886" : q.sales_yoy > 0 ? "#9090a0" : q.sales_yoy < 0 ? "#f87171" : "#505060",
                    width: 56, flexShrink: 0, background: salesBg, borderRadius: 2, padding: "0 2px" }}>
                    {q.sales_yoy != null ? <>
                      S:{q.sales_yoy > 0 ? "+" : ""}{q.sales_yoy.toFixed(0)}%
                      {isSalesAccel && <span style={{ color: isCode33Q ? "#60a5fa" : "#2bb886", fontSize: 10, marginLeft: 3 }} title="Sales accelerating vs prior quarter">▲</span>}
                    </> : ""}
                  </span>
                  <span style={{
                    color: isMarginAccel ? (isCode33Q ? "#60a5fa" : "#22d3ee") : marginDelta != null && marginDelta < 0 ? "#f87171" : "#686878",
                    width: 52, flexShrink: 0, fontSize: 10 }}
                    title={margin != null ? `${marginLabel}: ${margin.toFixed(1)}%${marginDelta != null ? ` (${marginDelta >= 0 ? "+" : ""}${marginDelta.toFixed(1)}pp)` : ""}` : undefined}>
                    {margin != null ? <>M:{margin.toFixed(0)}%{isMarginAccel ? " ▲" : marginDelta != null && marginDelta < 0 ? " ▼" : ""}</> : ""}
                  </span>
                </div>
                );
              })}
              </>);
            })()}
            {/* Annual EPS/Sales/Margins — CANSLIM A: Annual Earnings */}
            {stock.annual && stock.annual.length > 0 && (<>
              <div style={{ borderTop: "1px solid #2a2a38", margin: "5px 0 4px", width: "100%" }} />
              <div style={{ color: "#686878", fontWeight: 700, marginBottom: 1 }}>Annual</div>
              {stock.annual.slice(0, 3).map((a, i) => {
                // Annual EPS tiers (O'Neil): ≥25% CAGR minimum over 3-5 years
                const epsYoy = a.eps_yoy;
                const epsTier = epsYoy >= 100 ? 3 : epsYoy >= 50 ? 2 : epsYoy >= 25 ? 1 : 0;
                const epsBg = epsTier === 3 ? "rgba(43, 184, 134, 0.18)" : epsTier === 2 ? "rgba(43, 184, 134, 0.10)" : epsTier === 1 ? "rgba(43, 184, 134, 0.05)" : "transparent";
                const epsIcon = epsTier === 3 ? "★" : epsTier === 2 ? "●" : epsTier === 1 ? "○" : "";
                // Annual Sales tiers (O'Neil): ≥20-25% annual growth
                const salesYoy = a.sales_yoy;
                const salesTier = salesYoy >= 50 ? 3 : salesYoy >= 25 ? 2 : salesYoy >= 20 ? 1 : 0;
                const salesBg = salesTier === 3 ? "rgba(43, 184, 134, 0.18)" : salesTier === 2 ? "rgba(43, 184, 134, 0.10)" : salesTier === 1 ? "rgba(43, 184, 134, 0.05)" : "transparent";
                // Annual margin
                const margin = a.net_margin ?? a.op_margin ?? a.gross_margin;
                const marginLabel = a.net_margin != null ? "NM" : a.op_margin != null ? "OM" : a.gross_margin != null ? "GM" : null;
                const prevA = stock.annual[i + 1];
                const prevMargin = prevA ? (prevA.net_margin ?? prevA.op_margin ?? prevA.gross_margin) : null;
                const marginDelta = margin != null && prevMargin != null ? margin - prevMargin : null;
                // Annual acceleration: compare growth rate vs prior year
                const isEpsAccel = epsYoy != null && prevA?.eps_yoy != null && epsYoy > prevA.eps_yoy && epsYoy > 0;
                const isEpsDecel = epsYoy != null && prevA?.eps_yoy != null && epsYoy < prevA.eps_yoy && epsYoy > 0 && prevA.eps_yoy > 0;
                const isSalesAccel = salesYoy != null && prevA?.sales_yoy != null && salesYoy > prevA.sales_yoy && salesYoy > 0;
                return (
                <div key={i} style={{ padding: "1px 0", color: "#505060", display: "flex", gap: 3 }}>
                  <span style={{ width: 40, flexShrink: 0 }}>{a.year}</span>
                  <span style={{ color: a.eps_yoy > 0 ? "#2bb886" : a.eps_yoy < 0 ? "#f87171" : "#9090a0", width: 66, flexShrink: 0,
                    background: epsBg, borderRadius: 2, padding: "0 2px" }}>
                    {a.eps != null ? <>
                      {epsIcon && <span style={{ fontSize: 8, marginRight: 1 }}>{epsIcon}</span>}
                      E:{a.eps_yoy != null ? `${a.eps_yoy > 0 ? "+" : ""}${a.eps_yoy.toFixed(0)}%` : a.eps}
                      {isEpsAccel && <span style={{ color: "#2bb886", fontSize: 10, marginLeft: 3 }}>▲</span>}
                      {isEpsDecel && <span style={{ color: "#f87171", fontSize: 10, marginLeft: 3 }}>▼</span>}
                    </> : ""}
                  </span>
                  <span style={{ color: a.sales_yoy >= 20 ? "#2bb886" : a.sales_yoy > 0 ? "#9090a0" : a.sales_yoy < 0 ? "#f87171" : "#505060",
                    width: 56, flexShrink: 0, background: salesBg, borderRadius: 2, padding: "0 2px" }}>
                    {a.sales_yoy != null ? <>S:{a.sales_yoy > 0 ? "+" : ""}{a.sales_yoy.toFixed(0)}%
                      {isSalesAccel && <span style={{ color: "#2bb886", fontSize: 10, marginLeft: 3 }}>▲</span>}
                    </> : ""}
                  </span>
                  <span style={{
                    color: marginDelta != null && marginDelta > 0 ? "#22d3ee" : marginDelta != null && marginDelta < 0 ? "#f87171" : "#686878",
                    width: 52, flexShrink: 0, fontSize: 10 }}
                    title={margin != null ? `${marginLabel}: ${margin.toFixed(1)}%${marginDelta != null ? ` (${marginDelta >= 0 ? "+" : ""}${marginDelta.toFixed(1)}pp)` : ""}` : undefined}>
                    {margin != null ? <>M:{margin.toFixed(0)}%{marginDelta != null && marginDelta > 0 ? " ▲" : marginDelta != null && marginDelta < 0 ? " ▼" : ""}</> : ""}
                  </span>
                </div>
                );
              })}
            </>)}
            {/* EPS + MS + MF Composite Scores */}
            {(stock._epsScore != null || stock._msScore != null || stock.mf != null) && (<>
              <div style={{ borderTop: "1px solid #2a2a38", margin: "5px 0 4px", width: "100%" }} />
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                {stock._epsScore != null && <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ color: "#686878", fontWeight: 700 }}>EPS</span>
                  <span style={{
                    color: stock._epsScore >= 80 ? "#22d3ee" : stock._epsScore >= 60 ? "#60a5fa" : stock._epsScore >= 40 ? "#9090a0" : "#686878",
                    fontWeight: 700, fontSize: 14 }}>{stock._epsScore}</span>
                  <span style={{ color: "#505060", fontSize: 9 }}>/ 99</span>
                </span>}
                {stock._msScore != null && <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ color: "#686878", fontWeight: 700 }}>MS</span>
                  <span style={{
                    color: stock._msScore >= 80 ? "#2bb886" : stock._msScore >= 60 ? "#60a5fa" : stock._msScore >= 40 ? "#9090a0" : "#686878",
                    fontWeight: 700, fontSize: 14 }}>{stock._msScore}</span>
                  <span style={{ color: "#505060", fontSize: 9 }}>/ 99</span>
                </span>}
                {stock._mfPct != null && <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ color: "#686878", fontWeight: 700 }}>MF</span>
                  <span style={{
                    color: stock._mfPct >= 80 ? "#2bb886" : stock._mfPct >= 60 ? "#4a9070" : stock._mfPct <= 20 ? "#f87171" : stock._mfPct <= 40 ? "#c06060" : "#686878",
                    fontWeight: 700, fontSize: 14 }}>{stock._mfPct}</span>
                  <span style={{ color: "#505060", fontSize: 9 }}>/ 99</span>
                </span>}
              </div>
            </>)}
            {/* End of earnings timeline */}
          </div>
          {/* Divider */}
          <div style={{ width: 1, background: "#3a3a4a", margin: "0 12px", flexShrink: 0, alignSelf: "stretch" }} />
          {/* Right: news */}
          <div style={{ flex: "1 1 55%", minWidth: 200, overflow: "hidden" }}>
            {news === null ? (
              <span style={{ color: "#505060", fontSize: 10, fontFamily: "monospace" }}>Loading news...</span>
            ) : news.length > 0 ? (
              <div style={{ fontSize: 10, fontFamily: "monospace" }}>
                <div style={{ color: "#686878", fontWeight: 700, marginBottom: 2 }}>News</div>
                {news.map((n, i) => {
                  // Shorten date: "Feb-19-26 08:00AM" → "Feb 19" or "2/19 8AM"
                  const shortDate = (() => {
                    if (!n.date) return '';
                    const parts = n.date.replace(/-/g, ' ').split(' ');
                    if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
                    return n.date;
                  })();
                  return (
                  <div key={i} style={{ display: "flex", gap: 6, padding: "1px 0" }}>
                    <span style={{ color: "#505060", whiteSpace: "nowrap", flexShrink: 0, fontSize: 9 }}>{shortDate}</span>
                    <a href={n.url} target="_blank" rel="noopener noreferrer"
                      style={{ color: "#b8b8c8", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      onMouseEnter={e => e.target.style.color = "#0d9163"}
                      onMouseLeave={e => e.target.style.color = "#b8b8c8"}>
                      {n.headline}
                    </a>
                  </div>
                  );
                })}
              </div>
            ) : (
              <span style={{ color: "#505060", fontSize: 10, fontFamily: "monospace" }}>No news found</span>
            )}
            {peers && peers.length > 0 && (
              <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid #3a3a4a", fontSize: 10, fontFamily: "monospace", display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: "#686878", fontWeight: 700 }}>Peers:</span>
                {peers.map(p => (
                  <span key={p} onClick={() => { if (onTickerClick) onTickerClick(p); }}
                    style={{ color: "#9090a0", cursor: "pointer", padding: "1px 4px", borderRadius: 3, background: "#222230" }}
                    onMouseEnter={e => { e.target.style.color = "#0d9163"; e.target.style.background = "#0d916318"; }}
                    onMouseLeave={e => { e.target.style.color = "#9090a0"; e.target.style.background = "#222230"; }}>
                    {p}
                  </span>
                ))}
                {analyst && analyst.target_price && (<>
                  <span style={{ color: "#3a3a4a", margin: "0 2px" }}>│</span>
                  <span style={{ color: "#686878", fontWeight: 700 }}>Analyst</span>
                  <span style={{ color: "#9090a0" }}>
                    {analyst.recommendation != null && <span style={{
                      color: analyst.recommendation <= 2 ? "#2bb886" : analyst.recommendation <= 3 ? "#fbbf24" : "#f87171",
                      fontWeight: 700, marginRight: 4
                    }}>{analyst.recommendation <= 1.5 ? "Buy" : analyst.recommendation <= 2.5 ? "Outperform" : analyst.recommendation <= 3.5 ? "Hold" : analyst.recommendation <= 4.5 ? "Underperform" : "Sell"}</span>}
                    PT:{analyst.target_price}
                  </span>
                </>)}
              </div>
            )}
            {description && (
              <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid #3a3a4a", fontSize: 10, color: "#787888", lineHeight: 1.4, maxHeight: 50, overflowY: "auto" }}>
                {description}
              </div>
            )}
          </div>
        </div>
      )}


      </>)}

      {lwChartProps ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <LWChart ticker={ticker} entry={lwChartProps.entry || ""} stop={lwChartProps.stop || ""} target={lwChartProps.target || ""} />
        </div>
      ) : (
        <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      )}
    </div>
  );
}

// ── CLICKABLE TICKER ──
function Ticker({ children, ticker, style, onClick, activeTicker, ...props }) {
  const isActive = ticker === activeTicker;
  return (
    <span {...props}
      ref={undefined}
      onClick={(e) => { e.stopPropagation(); onClick(ticker); }}
      style={{ ...style, cursor: "pointer", transition: "all 0.15s",
        outline: isActive ? "2px solid #0d9163" : "none",
        outlineOffset: 1 }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.7"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}>
      {children}
    </span>
  );
}

// ── THEME LEADERS ──
function Leaders({ themes, stockMap, filters, onTickerClick, activeTicker, mmData, onVisibleTickers, themeHealth, liveThemeData: externalLiveData, onThemeDrillDown }) {
  const [sort, setSort] = useState("rts");
  const [intradaySort, setIntradaySort] = useState("chg");
  const [localLiveData, setLocalLiveData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [healthFilter, setHealthFilter] = useState(null);
  const [fetchProg, setFetchProg] = useState({ done: 0, total: 0 });

  // Merge external + local for best coverage
  const liveThemeData = useMemo(() => {
    if (!externalLiveData && !localLiveData) return null;
    if (!externalLiveData) return localLiveData;
    if (!localLiveData) return externalLiveData;
    const m = {};
    externalLiveData.forEach(s => { m[s.ticker] = s; });
    localLiveData.forEach(s => { m[s.ticker] = s; }); // local overwrites — it's our own complete fetch
    return Object.values(m);
  }, [externalLiveData, localLiveData]);

  // Fetch theme universe once on mount, then refresh hourly
  const lastFetchRef = useRef(0);
  useEffect(() => {
    if (!themes || liveLoading) return;
    const now = Date.now();
    if (lastFetchRef.current > 0 && now - lastFetchRef.current < 3600000) return; // 1 hour
    lastFetchRef.current = now;
    setLiveLoading(true);
    const tickers = new Set();
    themes.forEach(t => t.subthemes?.forEach(s => s.tickers?.forEach(tk => tickers.add(tk))));
    if (tickers.size === 0) { setLiveLoading(false); return; }
    const allTickers = [...tickers];
    const BATCH = 500;
    const totalBatches = Math.ceil(allTickers.length / BATCH);
    setFetchProg({ done: 0, total: totalBatches });
    (async () => {
      try {
        const results = [];
        for (let i = 0; i < allTickers.length; i += BATCH) {
          const batch = allTickers.slice(i, i + BATCH);
          const params = new URLSearchParams();
          params.set("universe", batch.join(","));
          const resp = await fetch(`/api/live?${params}`);
          if (resp.ok) {
            const d = await resp.json();
            if (d?.ok && d.theme_universe) results.push(...d.theme_universe);
          }
          setFetchProg(prev => ({ ...prev, done: prev.done + 1 }));
        }
        if (results.length > 0) setLocalLiveData(results);
      } catch (e) {}
      finally { setLiveLoading(false); }
    })();
  }, [themes]);

  // Hourly refresh interval
  useEffect(() => {
    const interval = setInterval(() => {
      lastFetchRef.current = 0; // reset so next render triggers fetch
      setLocalLiveData(prev => prev); // trigger re-render
    }, 3600000);
    return () => clearInterval(interval);
  }, []);

  const liveLookup = useMemo(() => {
    const m = {};
    if (liveThemeData) liveThemeData.forEach(s => { m[s.ticker] = s; });
    return m;
  }, [liveThemeData]);
  const hasLive = Object.keys(liveLookup).length > 0;

  // Compute live theme performance + rotation score
  const liveThemePerf = useMemo(() => {
    if (!liveThemeData || liveThemeData.length === 0 || !themes) return {};
    const lookup = {};
    liveThemeData.forEach(s => { lookup[s.ticker] = s; });
    const perf = {};
    themes.forEach(t => {
      const tickers = t.subthemes?.flatMap(s => s.tickers || []) || [];
      const changes = [], rvols = [];
      tickers.forEach(tk => {
        const s = lookup[tk];
        if (s?.change != null) changes.push(s.change);
        if (s?.rel_volume != null && s.rel_volume > 0) rvols.push(s.rel_volume);
      });
      if (changes.length === 0) return;
      const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
      const up = changes.filter(c => c > 0).length;
      const liveBreadth = Math.round(up / changes.length * 100);
      const avgRvol = rvols.length > 0 ? rvols.reduce((a, b) => a + b, 0) / rvols.length : null;
      const pipelineBreadth = t.breadth ?? 50;
      const deltaBreadth = liveBreadth - pipelineBreadth;
      const breadthScore = Math.min(40, (liveBreadth / 100) * 40);
      const rvolScore = avgRvol != null ? Math.min(35, ((Math.min(avgRvol, 3) - 0.5) / 2.5) * 35) : 0;
      const deltaScore = Math.max(0, Math.min(25, ((deltaBreadth + 30) / 60) * 25));
      const rotationScore = Math.round(Math.max(0, breadthScore + rvolScore + deltaScore));
      perf[t.theme] = { avg, up, total: changes.length, breadth: liveBreadth, avgRvol, deltaBreadth, rotationScore };
    });
    return perf;
  }, [liveThemeData, themes]);

  const healthMap = useMemo(() => {
    const m = {};
    if (themeHealth) themeHealth.forEach(h => { m[h.theme] = h; });
    return m;
  }, [themeHealth]);

  const breadthMap = useMemo(() => {
    const m = {};
    if (mmData?.theme_breadth) mmData.theme_breadth.forEach(tb => { m[tb.theme] = tb; });
    return m;
  }, [mmData]);

  // Intraday ranked themes — show ALL themes, with or without live data
  const liveRanked = useMemo(() => {
    const ranked = themes.map(t => ({ ...t, live: liveThemePerf[t.theme] || null }));
    const sorters = {
      chg: (a, b) => (b.live?.avg ?? -999) - (a.live?.avg ?? -999),
      breadth: (a, b) => (b.live?.breadth ?? -1) - (a.live?.breadth ?? -1),
      rvol: (a, b) => (b.live?.avgRvol ?? 0) - (a.live?.avgRvol ?? 0),
      rts: (a, b) => (b.rts || 0) - (a.rts || 0),
      rotScore: (a, b) => (b.live?.rotationScore ?? 0) - (a.live?.rotationScore ?? 0),
      delta: (a, b) => (b.live?.deltaBreadth ?? 0) - (a.live?.deltaBreadth ?? 0),
      ret1w: (a, b) => (b.return_1w ?? 0) - (a.return_1w ?? 0),
      ret3m: (a, b) => (b.return_3m ?? 0) - (a.return_3m ?? 0),
    };
    ranked.sort(sorters[intradaySort] || sorters.chg);
    return ranked;
  }, [themes, liveThemePerf, intradaySort]);

  // Theme list sorted for cards view
  const list = useMemo(() => {
    let t = [...themes];
    if (healthFilter) {
      t = t.filter(x => {
        const h = healthMap[x.theme];
        if (!h) return false;
        if (healthFilter === "ADD" || healthFilter === "REMOVE") return h.signal === healthFilter;
        return h.status === healthFilter;
      });
    }
    const sorters = {
      rts: (a, b) => (b.rts || 0) - (a.rts || 0),
      live_change: (a, b) => (liveThemePerf[b.theme]?.avg ?? -999) - (liveThemePerf[a.theme]?.avg ?? -999),
      return_3m: (a, b) => (b.return_3m || 0) - (a.return_3m || 0),
      breadth: (a, b) => (b.breadth || 0) - (a.breadth || 0),
      health: (a, b) => (healthMap[b.theme]?.composite || 0) - (healthMap[a.theme]?.composite || 0),
    };
    t.sort(sorters[sort] || sorters.rts);
    return t;
  }, [themes, sort, healthFilter, healthMap, liveThemePerf]);

  return (
    <div style={{ padding: "4px 0" }}>
      {/* ── Sort & Filter Controls ── */}
      <div style={{ display: "flex", gap: 3, padding: "4px 6px", marginBottom: 4, flexWrap: "wrap", alignItems: "center" }}>
        {hasLive && !liveLoading && <span style={{ color: "#0d9163", fontSize: 9, fontWeight: 700 }}>● LIVE</span>}
        {liveLoading && fetchProg.total > 0 && (
          <span style={{ fontSize: 9, color: "#fbbf24", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 40, height: 3, background: "#3a3a4a", borderRadius: 2, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(fetchProg.done / fetchProg.total) * 100}%`, background: "#fbbf24", borderRadius: 2, transition: "width 0.3s" }} />
            </span>
            {fetchProg.done}/{fetchProg.total}
          </span>
        )}
        {liveLoading && fetchProg.total === 0 && <span style={{ color: "#fbbf24", fontSize: 9 }}>Loading...</span>}
        <span style={{ color: "#3a3a4a" }}>|</span>
        {[["rts","RTS"],
          ...(hasLive ? [["live_change","Chg"]] : []),
          ["return_3m","3M"],["breadth","Brd"],["health","Health"]].map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)} style={{ padding: "2px 6px", borderRadius: 3, fontSize: 9, cursor: "pointer",
            border: sort === k ? "1px solid #0d9163" : "1px solid #2a2a38",
            background: sort === k ? "#0d916320" : "transparent", color: sort === k ? "#4aad8c" : "#686878" }}>{l}</button>
        ))}
        {Object.keys(healthMap).length > 0 && (<>
          <span style={{ color: "#3a3a4a" }}>|</span>
          {[["All", null],["★","ADD"],["✗","REMOVE"]].map(([label, val]) => (
            <button key={label} onClick={() => setHealthFilter(healthFilter === val ? null : val)} style={{ padding: "2px 5px", borderRadius: 3, fontSize: 9, cursor: "pointer",
              border: healthFilter === val ? "1px solid #0d9163" : "1px solid #2a2a38",
              background: healthFilter === val ? "#0d916320" : "transparent",
              color: healthFilter === val ? "#4aad8c" : val === "ADD" ? "#2bb886" : val === "REMOVE" ? "#f87171" : "#686878" }}>{label}</button>
          ))}
        </>)}
      </div>

      {list.map(theme => {
        const quad = getQuad(theme.weekly_rs, theme.monthly_rs);
        const qc = QC[quad];
        const barW = Math.max(5, Math.min(100, theme.rts));
        const h = healthMap[theme.theme];
        const lp = liveThemePerf[theme.theme];
        const tb = breadthMap[theme.theme];
        const hBg = h ? ({ LEADING: "#2bb88618", EMERGING: "#fbbf2415", HOLDING: "#9090a010", WEAKENING: "#f9731615", LAGGING: "#f8717115" }[h.status] || "#1a1a2a") : "#1a1a2a";
        return (
          <div key={theme.theme} onClick={() => onThemeDrillDown && onThemeDrillDown(theme.theme)}
            style={{ marginBottom: 2, borderRadius: 4, border: "1px solid #2a2a38", overflow: "hidden", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#0d9163"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2a38"}>
            <div style={{ padding: "5px 8px",
              background: `linear-gradient(90deg, ${hBg} ${barW}%, #111 ${barW}%)` }}>
              {/* Row 1: Theme name + health */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                <span style={{ color: "#e4e4f0", fontWeight: 700, fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {theme.theme}
                </span>
                {h && (() => {
                  const sc = { LEADING: "#2bb886", EMERGING: "#fbbf24", HOLDING: "#9090a0", WEAKENING: "#f97316", LAGGING: "#f87171" }[h.status] || "#686878";
                  const sig = h.signal === "ADD" ? "★ " : h.signal === "REMOVE" ? "✗ " : "";
                  return <span style={{ fontSize: 8, fontWeight: 700, color: sc, padding: "0 3px", borderRadius: 2,
                    background: sc + "18", border: `1px solid ${sc}30` }}>{sig}{h.status.slice(0, 4)}</span>;
                })()}
              </div>
              {/* Row 2: Metrics — pipeline + live */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontFamily: "monospace" }}>
                <span style={{ color: h ? ({ LEADING: "#2bb886", EMERGING: "#fbbf24", HOLDING: "#9090a0", WEAKENING: "#f97316", LAGGING: "#f87171" }[h.status] || "#b8b8c8") : qc.text, fontWeight: 600 }}>{theme.rts}</span>
                {lp && <span style={{ fontWeight: 600,
                  color: lp.avg > 0 ? "#2bb886" : lp.avg < 0 ? "#f87171" : "#686878" }}>
                  {lp.avg > 0 ? "+" : ""}{lp.avg.toFixed(1)}%
                </span>}
                {lp && lp.avgRvol != null && <span style={{ fontSize: 9,
                  color: lp.avgRvol >= 1.5 ? "#c084fc" : lp.avgRvol >= 1.0 ? "#787888" : "#505060",
                  fontWeight: lp.avgRvol >= 1.5 ? 700 : 400 }}>{lp.avgRvol.toFixed(1)}x</span>}
                <span style={{ color: "#787888", fontSize: 9 }}>B:{lp ? `${lp.breadth}%` : `${theme.breadth}%`}</span>
                <Ret v={theme.return_3m} />
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ color: "#505060", fontSize: 9, padding: "4px 8px" }}>{list.length} themes · click → scan</div>
    </div>
  );
}

// ── Shared Stock Quality Score (0-100) ──
// Multi-framework: CANSLIM (earnings, new highs, leader, supply) + MAGNA53 (neglect, squeeze, cap) + Zanger (group, resistance) + MB (VCS)
// Used by Scan, Watchlist, EP (as base score before EP-specific bonuses)
// EPS Score (0-100): O'Neil/Zanger weighted
// Works with available Finviz data: eps_this_y, eps_past_5y, sales_past_5y
// When eps_qq/sales_qq available (yfinance/FMP later), they boost as primary signals
function computeEPSScore(s) {
  if (!s) return { score: null, factors: [] };
  const factors = [];
  let total = 0;
  let maxPossible = 0;

  const qs = s.quarters || [];
  const q0 = qs[0] || {};  // most recent quarter
  const q1 = qs[1] || {};  // quarter before
  const q2 = qs[2] || {};  // two quarters back

  // ══════ 1. EPS Growth — Last 2 Quarters (0–25 pts) ══════
  // Average of last 2Q EPS YoY — the core CANSLIM signal
  const eps0 = q0.eps_yoy;
  const eps1 = q1.eps_yoy;
  if (eps0 != null || eps1 != null) {
    maxPossible += 25;
    const vals = [eps0, eps1].filter(v => v != null);
    const avgEps = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avgEps >= 100) { total += 25; factors.push("E" + Math.round(avgEps)); }
    else if (avgEps >= 50) { total += 20; factors.push("E" + Math.round(avgEps)); }
    else if (avgEps >= 25) { total += 15; factors.push("E" + Math.round(avgEps)); }
    else if (avgEps >= 10) { total += 8; }
    else if (avgEps > 0) { total += 3; }
    else { total -= 5; factors.push("E↓"); }
  }

  // ══════ 2. Sales Growth — Last 2 Quarters (0–25 pts) ══════
  const sal0 = q0.sales_yoy;
  const sal1 = q1.sales_yoy;
  if (sal0 != null || sal1 != null) {
    maxPossible += 25;
    const vals = [sal0, sal1].filter(v => v != null);
    const avgSales = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avgSales >= 40) { total += 25; factors.push("S" + Math.round(avgSales)); }
    else if (avgSales >= 25) { total += 20; factors.push("S" + Math.round(avgSales)); }
    else if (avgSales >= 15) { total += 12; factors.push("S" + Math.round(avgSales)); }
    else if (avgSales >= 5) { total += 6; }
    else if (avgSales > 0) { total += 2; }
    else { total -= 5; factors.push("S↓"); }
  }

  // ══════ 3. EPS Acceleration (0–20 pts) ══════
  // Is EPS growth speeding up? Q0 > Q1 > Q2
  if (eps0 != null && eps1 != null) {
    maxPossible += 20;
    if (eps0 > eps1 && eps0 > 0) {
      const accelDelta = eps0 - eps1;
      if (eps1 > 0 && q2.eps_yoy != null && eps1 > q2.eps_yoy) {
        // Triple acceleration: Q0 > Q1 > Q2 — strongest signal
        total += 20; factors.push("EA▲▲");
      } else if (accelDelta >= 20) {
        total += 15; factors.push("EA▲");
      } else {
        total += 10; factors.push("EA↑");
      }
    } else if (eps0 != null && eps1 != null && eps0 < eps1 && eps0 > 0) {
      // Decelerating but still positive
      total += 2;
    } else if (eps0 != null && eps0 < 0) {
      total -= 5; factors.push("EA↓");
    }
  }

  // ══════ 4. Sales Acceleration (0–15 pts) ══════
  if (sal0 != null && sal1 != null) {
    maxPossible += 15;
    if (sal0 > sal1 && sal0 > 0) {
      const accelDelta = sal0 - sal1;
      if (sal1 > 0 && q2.sales_yoy != null && sal1 > q2.sales_yoy) {
        total += 15; factors.push("SA▲▲");
      } else if (accelDelta >= 10) {
        total += 12; factors.push("SA▲");
      } else {
        total += 8; factors.push("SA↑");
      }
    } else if (sal0 < sal1 && sal0 > 0) {
      total += 2;
    } else if (sal0 < 0) {
      total -= 3; factors.push("SA↓");
    }
  }

  // ══════ 5. Margin Expansion (0–15 pts) ══════
  // Compute net margin proxy from EPS * implied_shares / revenue
  const computeMargin = (q, mcapRaw, price) => {
    if (!q.eps || !q.revenue || !mcapRaw || !price || q.revenue <= 0) return null;
    const shares = mcapRaw / price;
    return (q.eps * shares / q.revenue) * 100;
  };
  const m0 = computeMargin(q0, s.market_cap_raw, s.price);
  const m1 = computeMargin(q1, s.market_cap_raw, s.price);
  const m2 = computeMargin(q2, s.market_cap_raw, s.price);
  if (m0 != null && m1 != null) {
    maxPossible += 15;
    const mDelta = m0 - m1;
    if (mDelta > 3 && m0 > 0) {
      // Strong margin expansion
      if (m2 != null && m1 > m2) {
        total += 15; factors.push("M▲▲");  // Accelerating margins
      } else {
        total += 12; factors.push("M▲");
      }
    } else if (mDelta > 0 && m0 > 0) {
      total += 6; factors.push("M↑");
    } else if (mDelta < -3) {
      total -= 3; factors.push("M↓");
    }
  }

  if (maxPossible === 0) {
    // Fallback: use annual data if no quarterly data
    const epsThisY = s.eps_this_y;
    const salesQQ = s.sales_yoy ?? s.sales_qq;
    if (epsThisY == null && salesQQ == null) return { score: null, factors: [] };
    let fallback = 0;
    if (epsThisY != null) {
      if (epsThisY >= 40) { fallback += 30; factors.push("C↑"); }
      else if (epsThisY >= 25) { fallback += 20; }
      else if (epsThisY >= 10) { fallback += 10; }
    }
    if (salesQQ != null) {
      if (salesQQ >= 25) { fallback += 20; factors.push("S↑"); }
      else if (salesQQ >= 10) { fallback += 10; }
    }
    return { score: Math.min(49, fallback), factors };  // Cap at 49 — not enough data for conviction
  }

  // Normalize to 0–99 scale based on points earned vs possible
  // Apply data confidence: need at least 3 of 5 components for full score
  const componentCount = [eps0 != null || eps1 != null, sal0 != null || sal1 != null,
    eps0 != null && eps1 != null, sal0 != null && sal1 != null, m0 != null && m1 != null]
    .filter(Boolean).length;
  const confidenceCap = componentCount >= 4 ? 99 : componentCount >= 3 ? 85 : componentCount >= 2 ? 65 : 45;
  const normalized = Math.round((Math.max(0, total) / maxPossible) * 99);
  return { score: Math.min(confidenceCap, normalized), factors };
}

const _qualityCache = new WeakMap();
function computeStockQuality(s, leadingThemes) {
  if (!s) return { quality: 0, q_factors: [] };
  if (!leadingThemes && _qualityCache.has(s)) return _qualityCache.get(s);
  let q = 30;  // base for non-EP stocks
  const factors = [];

  // EPS Score (reweighted: quarterly is primary signal per O'Neil/Zanger)
  const eps = computeEPSScore(s);
  if (eps.score != null) {
    // Map EPS score (0-100) to quality bonus: max +18
    if (eps.score >= 80) { q += 18; factors.push(...eps.factors.slice(0, 2)); }
    else if (eps.score >= 60) { q += 12; factors.push(...eps.factors.slice(0, 1)); }
    else if (eps.score >= 40) { q += 6; }
    else if (eps.score < 20) { q -= 5; if (eps.factors.includes("C↓") || eps.factors.includes("A↓")) factors.push("EPS↓"); }
  }

  // CANSLIM N: New highs
  if (s.pct_from_high != null) {
    if (s.pct_from_high >= -3) { q += 10; factors.push("NH"); }
    else if (s.pct_from_high >= -10) { q += 5; }
    else if (s.pct_from_high < -30) { q -= 8; factors.push("Deep"); }
  }

  // CANSLIM S: Low float
  const floatRaw = s.shares_float_raw;
  if (floatRaw != null) {
    if (floatRaw <= 15_000_000) { q += 8; factors.push("LF"); }
    else if (floatRaw <= 50_000_000) { q += 4; factors.push("MF"); }
  }

  // CANSLIM L: Leader
  if (s.rs_rank >= 90) { q += 5; factors.push("L"); }
  else if (s.rs_rank >= 80) { q += 3; }

  // MAGNA53 N: Neglect — low institutional ownership
  if (s.inst_own != null) {
    if (s.inst_own <= 30) { q += 6; factors.push("NI"); }
    else if (s.inst_own <= 50) { q += 3; }
    else if (s.inst_own >= 90) { q -= 3; }
  }

  // MAGNA53 5: Short squeeze fuel
  const shortRatio = s.short_ratio;
  if (shortRatio != null && shortRatio >= 5) { q += 5; factors.push("SR"); }
  if (s.short_float != null && s.short_float >= 15) { q += 6; factors.push("SQ"); }
  else if (s.short_float != null && s.short_float >= 8) { q += 3; }

  // MAGNA53 CAP: Small/mid-cap
  const mcap = s.market_cap_raw;
  if (mcap != null) {
    if (mcap <= 2_000_000_000) { q += 5; factors.push("SC"); }
    else if (mcap <= 10_000_000_000) { q += 3; factors.push("MC"); }
  }

  // MAGNA53 CAP: Young IPO
  if (s.ipo_date) {
    try {
      const ipoAge = (new Date() - new Date(s.ipo_date)) / (365.25 * 86400000);
      if (ipoAge <= 3) { q += 5; factors.push("IPO"); }
      else if (ipoAge <= 10) { q += 2; }
    } catch(e) {}
  }

  // Zanger: Leading theme/group
  if (leadingThemes && s.themes?.some(t => leadingThemes.has(t.theme))) { q += 5; factors.push("TH"); }

  // ADR%
  if (s.adr_pct != null && s.adr_pct >= 5) { q += 3; }

  // Grade
  if (["A+","A","A-"].includes(s.grade)) { q += 5; factors.push("Gr"); }
  else if (["B+","B"].includes(s.grade)) { q += 2; }

  // RSI penalty
  if (s.rsi != null && s.rsi > 85) { q -= 5; }

  q = Math.min(100, Math.max(0, q));
  const result = { quality: q, q_factors: factors };
  if (!leadingThemes) _qualityCache.set(s, result);
  return result;
}

function Scan({ stocks, themes, onTickerClick, activeTicker, onVisibleTickers, liveThemeData: externalLiveData, onLiveThemeData, portfolio, watchlist, initialThemeFilter, onConsumeThemeFilter, stockMap, filters, mmData, themeHealth, momentumBurst, erSipLookup }) {
  const [sortBy, setSortBy] = useState("default");
  const [nearPivot, setNearPivot] = useState(false);
  const [greenOnly, setGreenOnly] = useState(false);
  const [minRS, setMinRS] = useState(70);
  const [scanFilters, setScanFilters] = useState(new Set(["T"]));
  const [activeTheme, setActiveTheme] = useState(null);
  const [mcapFilter, setMcapFilter] = useState("small"); // "small" = all, "mid" = mid+large, "large" = large only
  const [volFilter, setVolFilter] = useState(0); // 0 = no filter, 50000, 100000
  const [showLeaders, setShowLeaders] = useState(false);
  const [scanTab, setScanTab] = useState("scan"); // "scan" or "burst"

  // Apply theme filter from Leaders drill-down
  useEffect(() => {
    if (initialThemeFilter) {
      setActiveTheme(initialThemeFilter);
      if (onConsumeThemeFilter) onConsumeThemeFilter();
    }
  }, [initialThemeFilter]);
  const [liveOverlay, setLiveOverlay] = useState(true);
  const [localLiveData, setLocalLiveData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveProg, setLiveProg] = useState({ done: 0, total: 0 });
  const themeData = externalLiveData || localLiveData;

  // Merge new data with previous — keeps old entries if new fetch missed them
  function mergeThemeData(prev, next) {
    if (!prev || prev.length === 0) return next;
    if (!next || next.length === 0) return prev;
    const map = {};
    prev.forEach(s => { map[s.ticker] = s; });
    next.forEach(s => { map[s.ticker] = s; });
    return Object.values(map);
  }

  const leading = useMemo(() => new Set(themes.filter(t => t.rts >= 50).map(t => t.theme)), [themes]);

  // Fetch live data for full theme universe (batched 500 at a time)
  useEffect(() => {
    if (themeData || !themes || liveLoading) return;
    setLiveLoading(true);
    const tickers = new Set();
    themes.forEach(t => t.subthemes?.forEach(s => s.tickers?.forEach(tk => tickers.add(tk))));
    if (tickers.size === 0) { setLiveLoading(false); return; }
    const allTickers = [...tickers];
    const BATCH = 500;
    const totalBatches = Math.ceil(allTickers.length / BATCH);
    setLiveProg({ done: 0, total: totalBatches });
    (async () => {
      try {
        let batchDone = 0;
        for (let i = 0; i < allTickers.length; i += BATCH) {
          const batch = allTickers.slice(i, i + BATCH);
          const params = new URLSearchParams();
          params.set("universe", batch.join(","));
          const resp = await fetch(`/api/live?${params}`);
          if (resp.ok) {
            const d = await resp.json();
            if (d?.ok && d.theme_universe) {
              setLocalLiveData(prev => mergeThemeData(prev, d.theme_universe));
              if (onLiveThemeData) onLiveThemeData(d.theme_universe);
            }
          }
          batchDone++;
          setLiveProg({ done: batchDone, total: totalBatches });
        }
      } catch (e) {}
      finally { setLiveLoading(false); setLiveProg({ done: 0, total: 0 }); }
    })();
  }, [themeData, themes, liveLoading]);

  // Auto-fetch removed — parent now handles global theme universe refresh every 30s

  // Build live lookup
  const liveLookup = useMemo(() => {
    if (!themeData) return {};
    const m = {};
    themeData.forEach(s => { m[s.ticker] = s; });
    return m;
  }, [themeData]);

  const hasLive = Object.keys(liveLookup).length > 0;

  const candidates = useMemo(() => {
    // Individual scan filters
    const winnersFilter = s => {
      const price = s.price || 0;
      const adr = s.adr_pct || 0;
      const aboveLow = s.above_52w_low || 0;
      const avgDolVol = s.avg_dollar_vol_raw || 0;
      const sma20 = s.sma20_pct;
      const sma50 = s.sma50_pct;
      return price > 1 && adr > 4.5 && aboveLow >= 70 && avgDolVol >= 7000000
        && sma20 != null && sma20 > 0 && sma50 != null && sma50 > 0;
    };
    const liquidFilter = s => {
      const price = s.price || 0;
      const mcap = s.market_cap_raw || 0;
      const avgVol = s.avg_volume_raw || 0;
      const avgDolVol = s.avg_dollar_vol_raw || 0;
      const adr = s.adr_pct || 0;
      const epsGrowth = s.eps_this_y ?? s.eps_past_5y;
      const salesGrowth = s.sales_past_5y;
      return price > 10 && mcap >= 300000000 && avgVol >= 1000000 && avgDolVol >= 100000000
        && adr > 3 && ((epsGrowth != null && epsGrowth > 20) || (salesGrowth != null && salesGrowth > 15));
    };
    const earlyFilter = s => {
      const sma50 = s.sma50_pct;
      const sma200 = s.sma200_pct;
      const rs = s.rs_rank;
      const avgDolVol = s.avg_dollar_vol_raw || 0;
      const price = s.price || 0;
      return price > 5 && avgDolVol >= 5000000
        && sma50 != null && sma50 > 0 && sma50 < 10
        && sma200 != null && sma200 > 0
        && rs != null && rs >= 50 && rs < 85
        && s.adr_pct > 2 && s.pct_from_high < -10;
    };
    const themeFilter = s => {
      const good = ["A+","A","A-","B+"].includes(s.grade);
      const inLead = s.themes.some(t => leading.has(t.theme));
      return good && inLead && s.atr_to_50 > 0 && s.atr_to_50 < 7 && s.above_50ma && s.return_3m >= 21;
    };

    let list;
    // Compute tags for all stocks
    const hitMap = {};
    stocks.forEach(s => {
      const hits = [];
      if (themeFilter(s)) hits.push("T");
      if (winnersFilter(s)) hits.push("W");
      if (liquidFilter(s)) hits.push("L");
      if (earlyFilter(s)) hits.push("E");

      // ── CANSLIM tag ──
      const epsG = s.eps_yoy ?? s.eps_this_y ?? s.eps_past_5y;
      const salesG = s.sales_yoy ?? s.sales_qq ?? s.sales_past_5y;
      const csC = (s.eps_yoy != null && s.eps_yoy >= 40) || (s.eps_qq != null && s.eps_qq >= 40) || (epsG != null && epsG >= 40);
      const csN = s.pct_from_high != null && s.pct_from_high >= -10;
      const csS = s.shares_float_raw != null && s.shares_float_raw <= 100_000_000;
      const csL = s.rs_rank >= 80;
      const csInst = s.inst_own == null || s.inst_own <= 70;
      const csSales = salesG != null && salesG >= 25;
      if (csC && csN && csL && (csSales || csS) && csInst) hits.push("CS");

      // ── Zanger/MB tag ──
      const inLeadTheme = s.themes?.some(t => leading.has(t.theme));
      const aboveMAs = s.above_50ma && s.sma20_pct != null && s.sma20_pct >= 0;
      const nearHigh = s.pct_from_high != null && s.pct_from_high >= -15;
      const goodGrade = ["A+","A","A-","B+","B"].includes(s.grade);
      const hasVolume = (s.avg_dollar_vol_raw || 0) >= 20_000_000;
      if (inLeadTheme && aboveMAs && nearHigh && goodGrade && hasVolume && s.atr_to_50 < 5) hits.push("ZM");

      if (hits.length > 0) hitMap[s.ticker] = hits;
    });

    // Compute MF percentile thresholds for top/bottom 10%
    const allMF = stocks.map(s => s.mf).filter(v => v != null).sort((a, b) => a - b);
    const mfPosThreshold = allMF.length > 0 ? allMF[Math.floor(allMF.length * 0.90)] : 50;
    const mfNegThreshold = allMF.length > 0 ? allMF[Math.floor(allMF.length * 0.10)] : -50;

    // Compute MF percentile rank for each stock
    const mfRankMap = {};
    if (allMF.length > 0) {
      stocks.forEach(s => {
        if (s.mf != null) {
          const rank = allMF.filter(v => v <= s.mf).length;
          mfRankMap[s.ticker] = Math.round(rank / allMF.length * 100);
        }
      });
    }

    // Add MF+/MF- tags
    stocks.forEach(s => {
      if (!hitMap[s.ticker]) hitMap[s.ticker] = [];
      if (s.mf != null && s.mf >= mfPosThreshold && s.mf > 0) hitMap[s.ticker].push("MF+");
      if (s.mf != null && s.mf <= mfNegThreshold && s.mf < 0) hitMap[s.ticker].push("MF-");
      // 9M: Today's volume ≥ 8.9M shares but avg daily volume < 8.9M (unusual institutional activity)
      const avgVol = s.avg_volume_raw || 0;
      const todayVol = avgVol * (s.rel_volume || 0);
      if (todayVol >= 8_900_000 && avgVol < 8_900_000) hitMap[s.ticker].push("9M");
    });

    // ── Composite EPS Score (0-99 percentile) ──
    // Weighted blend of CANSLIM fundamentals: C (current quarterly) + A (annual) + margins + consistency
    const epsRawScores = {};
    stocks.forEach(s => {
      const qs = s.quarters || [];
      const annuals = s.annual || [];
      // Current Q EPS YoY (most recent)
      const curEps = qs[0]?.eps_yoy;
      // EPS acceleration: current Q vs prior Q growth rate
      const prevEps = qs[1]?.eps_yoy;
      const epsAccel = (curEps != null && prevEps != null && prevEps !== 0) ? curEps - prevEps : null;
      // Current Q Sales YoY
      const curSales = qs[0]?.sales_yoy;
      // Annual EPS growth (most recent year)
      const annEps = annuals[0]?.eps_yoy;
      // Margin trend: current Q net margin vs prior Q
      const curMargin = qs[0]?.net_margin ?? qs[0]?.op_margin ?? qs[0]?.gross_margin;
      const prevMargin = qs[1]?.net_margin ?? qs[1]?.op_margin ?? qs[1]?.gross_margin;
      const marginDelta = (curMargin != null && prevMargin != null) ? curMargin - prevMargin : null;
      // Consistency: how many of last 4 quarters had positive EPS growth
      const posQs = qs.slice(0, 4).filter(q => q.eps_yoy != null && q.eps_yoy > 0).length;
      epsRawScores[s.ticker] = { curEps, epsAccel, curSales, annEps, marginDelta, posQs };
    });

    // Percentile rank helper
    const pctRank = (arr) => {
      const sorted = arr.filter(v => v != null).sort((a, b) => a - b);
      if (sorted.length === 0) return () => null;
      return (val) => {
        if (val == null) return null;
        let idx = 0;
        for (let i = 0; i < sorted.length; i++) { if (sorted[i] <= val) idx = i + 1; }
        return Math.round(idx / sorted.length * 99);
      };
    };

    const allCurEps = stocks.map(s => epsRawScores[s.ticker]?.curEps);
    const allAccel = stocks.map(s => epsRawScores[s.ticker]?.epsAccel);
    const allCurSales = stocks.map(s => epsRawScores[s.ticker]?.curSales);
    const allAnnEps = stocks.map(s => epsRawScores[s.ticker]?.annEps);
    const allMarginD = stocks.map(s => epsRawScores[s.ticker]?.marginDelta);
    const allPosQs = stocks.map(s => epsRawScores[s.ticker]?.posQs);

    const pCurEps = pctRank(allCurEps);
    const pAccel = pctRank(allAccel);
    const pCurSales = pctRank(allCurSales);
    const pAnnEps = pctRank(allAnnEps);
    const pMarginD = pctRank(allMarginD);
    const pPosQs = pctRank(allPosQs);

    // Weighted composite: C(30%) + Accel(20%) + Sales(15%) + A(15%) + Margin(10%) + Consistency(10%)
    const epsCompositeMap = {};
    stocks.forEach(s => {
      const r = epsRawScores[s.ticker];
      const scores = [
        { p: pCurEps(r.curEps), w: 0.30 },
        { p: pAccel(r.epsAccel), w: 0.20 },
        { p: pCurSales(r.curSales), w: 0.15 },
        { p: pAnnEps(r.annEps), w: 0.15 },
        { p: pMarginD(r.marginDelta), w: 0.10 },
        { p: pPosQs(r.posQs), w: 0.10 },
      ];
      let totalW = 0, totalS = 0;
      scores.forEach(({ p, w }) => { if (p != null) { totalS += p * w; totalW += w; } });
      epsCompositeMap[s.ticker] = totalW > 0 ? Math.round(totalS / totalW) : null;
    });

    // Re-rank composites into final percentile
    const allComposites = Object.values(epsCompositeMap).filter(v => v != null).sort((a, b) => a - b);
    const pComposite = pctRank(allComposites);
    const epsFinalMap = {};
    stocks.forEach(s => {
      epsFinalMap[s.ticker] = pComposite(epsCompositeMap[s.ticker]);
    });

    // No tag filters = show all stocks (with tags attached), tag filters = AND filter
    if (scanFilters.size === 0) {
      list = stocks.map(s => ({ ...s, _scanHits: hitMap[s.ticker] || [], _mfPct: mfRankMap[s.ticker], _epsScore: epsFinalMap[s.ticker] }));
    } else {
      list = stocks.filter(s => {
        const hits = new Set(hitMap[s.ticker] || []);
        for (const f of scanFilters) {
          if (!hits.has(f)) return false;
        }
        return true;
      }).map(s => ({ ...s, _scanHits: hitMap[s.ticker] || [], _mfPct: mfRankMap[s.ticker], _epsScore: epsFinalMap[s.ticker] }));
    }

    // Compute stock quality score for each candidate
    list = list.map(s => {
      const { quality, q_factors } = computeStockQuality(s, leading);
      return { ...s, _quality: quality, _q_factors: q_factors };
    });

    if (nearPivot) list = list.filter(s => s.pct_from_high >= -3);
    if (greenOnly && hasLive) list = list.filter(s => { const chg = liveLookup[s.ticker]?.change; return chg != null && chg > 0; });
    if (minRS > 0) list = list.filter(s => (s.rs_rank ?? 0) >= minRS);
    if (activeTheme) list = list.filter(s => s.themes?.some(t => t.theme === activeTheme));
    if (mcapFilter === "mid") list = list.filter(s => (s.market_cap_raw || 0) >= 2_000_000_000);
    if (mcapFilter === "large") list = list.filter(s => (s.market_cap_raw || 0) >= 10_000_000_000);
    if (volFilter > 0) list = list.filter(s => (s.avg_volume_raw || 0) >= volFilter);
    const safe = (fn) => (a, b) => {
      const av = fn(a), bv = fn(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    };
    const GRADE_ORDER = {"A+":12,"A":11,"A-":10,"B+":9,"B":8,"B-":7,"C+":6,"C":5,"C-":4,"D+":3,"D":2,"D-":1};
    const sorters = {
      default: (a, b) => ((b.pct_from_high >= -5 ? 1000 : 0) + b.rs_rank) - ((a.pct_from_high >= -5 ? 1000 : 0) + a.rs_rank),
      hits: (a, b) => ((b._scanHits?.length || 0) - (a._scanHits?.length || 0)) || (b.rs_rank - a.rs_rank),
      quality: safe(s => s._quality),
      eps_score: safe(s => s._epsScore),
      ms_score: safe(s => s._msScore),
      vcs: safe(s => s.vcs),
      mf: safe(s => s.mf),
      ticker: (a, b) => a.ticker.localeCompare(b.ticker),
      grade: safe(s => GRADE_ORDER[s.grade] ?? null),
      rs: safe(s => s.rs_rank),
      ret1m: safe(s => s.return_1m),
      ret3m: safe(s => s.return_3m),
      fromhi: safe(s => s.pct_from_high),
      adr: safe(s => s.adr_pct),
      dvol: safe(s => s.avg_dollar_vol_raw),
      vol: safe(s => { const rv = liveLookup[s.ticker]?.rel_volume ?? s.rel_volume; return s.avg_volume_raw && rv ? s.avg_volume_raw * rv : null; }),
      rvol: safe(s => liveLookup[s.ticker]?.rel_volume ?? s.rel_volume),
      change: safe(s => liveLookup[s.ticker]?.change),
      theme: (a, b) => (a.themes?.[0]?.theme || "").localeCompare(b.themes?.[0]?.theme || ""),
      subtheme: (a, b) => (a.themes?.[0]?.subtheme || "").localeCompare(b.themes?.[0]?.subtheme || ""),
    };
    return list.sort(sorters[sortBy] || sorters.hits);
  }, [stocks, leading, sortBy, nearPivot, greenOnly, minRS, activeTheme, scanFilters, mcapFilter, volFilter, liveLookup]);

  const burstStocks = useMemo(() => {
    // Compute MF thresholds (same as scan watch)
    const allMF = stocks.map(s => s.mf).filter(v => v != null).sort((a, b) => a - b);
    const mfPosThreshold = allMF.length > 0 ? allMF[Math.floor(allMF.length * 0.90)] : 50;
    const mfNegThreshold = allMF.length > 0 ? allMF[Math.floor(allMF.length * 0.10)] : -50;

    let list = (momentumBurst || []).filter(b => stockMap[b.ticker]).map(b => {
      const s = stockMap[b.ticker];
      const avgVol = s?.avg_volume_raw || 0;
      const todayVol = avgVol * (s?.rel_volume || 0);
      const isMFPos = s?.mf != null && s.mf >= mfPosThreshold && s.mf > 0;
      const isMFNeg = s?.mf != null && s.mf <= mfNegThreshold && s.mf < 0;
      const is9M = todayVol >= 8_900_000 && avgVol < 8_900_000;
      return { ...b, _grade: s?.grade, _rs: s?.rs_rank, _company: s?.company, _themes: s?.themes, _atr50: s?.atr_to_50,
        _mcap: s?.market_cap_raw, _avgVol: s?.avg_volume_raw, _pctFromHigh: s?.pct_from_high,
        _above50ma: s?.above_50ma, _sma20_pct: s?.sma20_pct, _sma50_pct: s?.sma50_pct,
        _adr: s?.adr_pct, _aboveLow: s?.above_52w_low, _avgDolVol: s?.avg_dollar_vol_raw,
        _relVol: s?.rel_volume, _mf: s?.mf, _eps_this_y: s?.eps_this_y,
        _isMFPos: isMFPos, _isMFNeg: isMFNeg, _is9M: is9M };
    });
    // Apply same filters as scan watch
    if (minRS > 0) list = list.filter(b => (b._rs || 0) >= minRS);
    if (nearPivot) list = list.filter(b => (b._pctFromHigh || -99) >= -3);
    if (greenOnly) list = list.filter(b => b.change_pct > 0);
    if (activeTheme) list = list.filter(b => b._themes?.some(t => t.theme === activeTheme));
    if (mcapFilter === "mid") list = list.filter(b => (b._mcap || 0) >= 2_000_000_000);
    if (mcapFilter === "large") list = list.filter(b => (b._mcap || 0) >= 10_000_000_000);
    if (volFilter > 0) list = list.filter(b => (b._avgVol || 0) >= volFilter);
    // Apply MF+/MF-/9M tag filters
    if (scanFilters.has("MF+")) list = list.filter(b => b._isMFPos);
    if (scanFilters.has("MF-")) list = list.filter(b => b._isMFNeg);
    if (scanFilters.has("9M")) list = list.filter(b => b._is9M);
    return list.sort((a, b) => b.change_pct - a.change_pct);
  }, [momentumBurst, stocks, stockMap, minRS, nearPivot, greenOnly, activeTheme, mcapFilter, volFilter, scanFilters]);

  // Report visible ticker order to parent for keyboard nav
  useEffect(() => {
    const burstTickers = burstStocks.map(b => b.ticker);
    const candidateTickers = candidates.map(s => s.ticker);
    if (onVisibleTickers) onVisibleTickers(scanTab === "burst" ? burstTickers : [...candidateTickers, ...burstTickers.filter(t => !candidateTickers.includes(t))]);
  }, [candidates, burstStocks, scanTab, onVisibleTickers]);

  const tagCounts = useMemo(() => {
    const counts = { T: 0, W: 0, L: 0, E: 0, EP: 0, CS: 0, ZM: 0, "MF+": 0, "MF-": 0, "9M": 0 };
    candidates.forEach(s => (s._scanHits || []).forEach(h => { if (counts[h] !== undefined) counts[h]++; }));
    return counts;
  }, [candidates]);

  const columns = [
    ["Ticker", "ticker"], ["Tags", "hits"], ["Grade", "grade"], ["RS", "rs"],
    ["MS", "ms_score"], ["MF", "mf"], ["Chg%", "change"], ["Vol", "volume"], ["RVol", "rvol"],
    ["$Vol", "dvol"], ["ADR%", "adr"], ["VCS", "vcs"], ["EPS", "eps_score"],
    ["3M%", "ret3m"], ["FrHi%", "fromhi"], ["Theme", "theme"], ["Sub", "subtheme"],
  ];

  return (
    <div style={{ display: "flex", gap: 0, minHeight: 0 }}>
    <div style={{ flex: 1, minWidth: 0, overflowX: "auto", overflowY: "visible" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, marginBottom: 8 }}>
        <button onClick={() => setScanTab("scan")} style={{ padding: "4px 12px", borderRadius: "4px 4px 0 0", fontSize: 11, fontWeight: 700, cursor: "pointer",
          border: scanTab === "scan" ? "1px solid #3a3a4a" : "1px solid transparent", borderBottom: scanTab === "scan" ? "1px solid #121218" : "1px solid #3a3a4a",
          background: scanTab === "scan" ? "#121218" : "transparent", color: scanTab === "scan" ? "#2bb886" : "#686878" }}>
          Scan Watch <span style={{ fontSize: 10, fontWeight: 400, color: scanTab === "scan" ? "#4aad8c" : "#505060" }}>{candidates.length}</span>
        </button>
        <button onClick={() => setScanTab("burst")} style={{ padding: "4px 12px", borderRadius: "4px 4px 0 0", fontSize: 11, fontWeight: 700, cursor: "pointer",
          border: scanTab === "burst" ? "1px solid #3a3a4a" : "1px solid transparent", borderBottom: scanTab === "burst" ? "1px solid #121218" : "1px solid #3a3a4a",
          background: scanTab === "burst" ? "#121218" : "transparent", color: scanTab === "burst" ? "#f59e0b" : "#686878" }}>
          ⚡ Momentum Burst <span style={{ fontSize: 10, fontWeight: 400, color: scanTab === "burst" ? "#f59e0b" : "#505060" }}>{burstStocks.length}</span>
        </button>
        <div style={{ flex: 1, borderBottom: "1px solid #3a3a4a" }} />
      </div>

      {/* Shared filters — apply to both tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {/* Tag filters — scan tab gets all, burst tab gets MF+/MF-/9M */}
        {(scanTab === "scan" ? [
          ["T", "Theme", "#2bb886"], ["W", "Winners", "#c084fc"], ["L", "Liquid", "#60a5fa"],
          ["E", "Early", "#fbbf24"], ["EP", "EP", "#f97316"], ["CS", "CANSLIM", "#22d3ee"], ["ZM", "Zanger", "#a78bfa"],
          ["MF+", "MF+", "#2bb886"], ["MF-", "MF−", "#f87171"],
          ["9M", "9M", "#e879f9"]
        ] : [
          ["MF+", "MF+", "#2bb886"], ["MF-", "MF−", "#f87171"],
          ["9M", "9M", "#e879f9"]
        ]).map(([tag, label, color]) => {
          const active = scanFilters.has(tag);
          return (
            <button key={tag} onClick={() => setScanFilters(prev => {
              const next = new Set(prev);
              if (next.has(tag)) next.delete(tag); else next.add(tag);
              return next;
            })} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${active ? color : "#3a3a4a"}`,
              background: active ? `${color}20` : "transparent",
              color: active ? color : "#686878", display: "flex", alignItems: "center", gap: 3 }}>
              {label}
            </button>
          );
        })}
        {scanFilters.size > 0 && (
          <button onClick={() => setScanFilters(new Set())} style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, cursor: "pointer",
            border: "1px solid #505060", background: "transparent", color: "#787888" }}>Clear</button>
        )}
        <span style={{ color: "#3a3a4a" }}>|</span>
        <span style={{ color: scanTab === "burst" ? "#f59e0b" : "#2bb886", fontWeight: 600, fontSize: 12 }}>{scanTab === "burst" ? burstStocks.length : candidates.length}</span>
        {scanTab === "scan" && scanFilters.size > 0 && (
          <span style={{ color: "#9090a0", fontSize: 9, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(() => {
              const descs = { T: "A/B+ grade, leading theme, 3M≥21%, >50MA",
                W: "ADR>4.5%, ab52WL≥70%, $Vol>7M, >20/50MA",
                L: "MCap>300M, AvgVol>1M, $Vol>100M, ADR>3%, EPS>20%",
                E: ">50MA(<10%), >200MA, RS:50-85, FrHi<-10%",
                EP: "Gap + volume surge on earnings/news",
                CS: "EPS≥40%, near highs, RS≥80, supply/demand",
                ZM: "Leading theme, >MAs, near highs, tight to 50MA",
                "9M": "Today vol≥8.9M but avg vol<8.9M (unusual activity)" };
              const active = [...scanFilters];
              if (active.length === 1) return descs[active[0]] || "";
              return active.map(f => f).join(" + ");
            })()}
          </span>
        )}
        <button onClick={() => setNearPivot(p => !p)} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer", marginLeft: scanTab === "burst" ? 0 : "auto",
          border: nearPivot ? "1px solid #c084fc" : "1px solid #3a3a4a",
          background: nearPivot ? "#c084fc20" : "transparent", color: nearPivot ? "#c084fc" : "#787888" }}>Near Pivot (&lt;3%)</button>
        <button onClick={() => setGreenOnly(p => !p)} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
          border: greenOnly ? "1px solid #2bb886" : "1px solid #3a3a4a",
          background: greenOnly ? "#2bb88620" : "transparent", color: greenOnly ? "#2bb886" : "#787888" }}>Chg &gt;0%</button>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: minRS > 0 ? "#4aad8c" : "#686878", fontWeight: 600, whiteSpace: "nowrap" }}>RS≥{minRS}</span>
          <input type="range" min={0} max={95} step={5} value={minRS} onChange={e => setMinRS(Number(e.target.value))}
            style={{ width: 60, height: 4, accentColor: "#0d9163", cursor: "pointer" }} />
        </div>
        <span style={{ color: "#3a3a4a" }}>|</span>
        {[["small", "Small+"], ["mid", "Mid+"], ["large", "Large"]].map(([k, l]) => (
          <button key={k} onClick={() => setMcapFilter(k)} style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, cursor: "pointer",
            border: mcapFilter === k ? "1px solid #60a5fa" : "1px solid #3a3a4a",
            background: mcapFilter === k ? "#60a5fa20" : "transparent", color: mcapFilter === k ? "#60a5fa" : "#686878" }}>{l}</button>
        ))}
        <span style={{ color: "#3a3a4a" }}>|</span>
        {[[0, "All Vol"], [50000, ">50K"], [100000, ">100K"]].map(([v, l]) => (
          <button key={v} onClick={() => setVolFilter(v)} style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, cursor: "pointer",
            border: volFilter === v ? "1px solid #fbbf24" : "1px solid #3a3a4a",
            background: volFilter === v ? "#fbbf2420" : "transparent", color: volFilter === v ? "#fbbf24" : "#686878" }}>{l}</button>
        ))}
        {activeTheme && (
          <button onClick={() => setActiveTheme(null)} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
            border: "1px solid #60a5fa", background: "#60a5fa20", color: "#60a5fa", display: "flex", alignItems: "center", gap: 3 }}>
            {activeTheme} <span style={{ fontSize: 12, lineHeight: 1 }}>✕</span>
          </button>
        )}
      </div>

      {scanTab === "scan" && (<>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <button onClick={() => setLiveOverlay(p => !p)} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
          border: liveOverlay ? "1px solid #0d9163" : "1px solid #3a3a4a",
          background: liveOverlay ? "#0d916320" : "transparent", color: liveOverlay ? "#4aad8c" : "#787888" }}>
          {liveOverlay ? "● LIVE" : "○ Live"}</button>
        {liveOverlay && liveLoading && liveProg.total > 0 && (
          <span style={{ fontSize: 10, color: "#fbbf24", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 60, height: 4, background: "#3a3a4a", borderRadius: 2, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(liveProg.done / liveProg.total) * 100}%`, background: "#fbbf24", borderRadius: 2, transition: "width 0.3s" }} />
            </span>
            {liveProg.done}/{liveProg.total}
          </span>
        )}
        {liveOverlay && liveLoading && liveProg.total === 0 && <span style={{ fontSize: 10, color: "#fbbf24" }}>Loading live data...</span>}
        {liveOverlay && !hasLive && !liveLoading && <span style={{ fontSize: 10, color: "#f87171" }}>No live data — market may be closed</span>}
        <button onClick={() => setShowLeaders(p => !p)} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
          marginLeft: "auto",
          border: showLeaders ? "1px solid #c084fc" : "1px solid #3a3a4a",
          background: showLeaders ? "#c084fc20" : "transparent", color: showLeaders ? "#c084fc" : "#686878" }}>
          {showLeaders ? "◀ Themes" : "Themes ▶"}</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr style={{ borderBottom: "2px solid #3a3a4a" }}>
          {columns.map(([h, sk]) => (
            <th key={h} onClick={sk ? () => setSortBy(prev => prev === sk ? "default" : sk) : undefined}
              style={{ padding: "6px 8px", color: sortBy === sk ? "#4aad8c" : "#787888", fontWeight: 600, textAlign: "center", fontSize: 11,
                cursor: sk ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>
              {h}{sortBy === sk ? " ▼" : ""}</th>
          ))}
        </tr></thead>
        <tbody>{candidates.map(s => {
          const near = s.pct_from_high >= -5;
          const pb = s.pct_from_high < -10 && s.pct_from_high >= -25;
          const action = near ? "BUY ZONE" : pb ? "WATCH PB" : "ON RADAR";
          const ac = near ? "#059669" : pb ? "#d97706" : "#686878";
          const theme = s.themes.find(t => leading.has(t.theme));
          const isActive = s.ticker === activeTicker;
          const inPortfolio = portfolio?.includes(s.ticker);
          const inWatchlist = watchlist?.includes(s.ticker);
          return (
            <tr key={s.ticker} data-ticker={s.ticker} ref={undefined}
              onClick={() => onTickerClick(s.ticker)}
              style={{ borderBottom: "1px solid #222230", cursor: "pointer",
                borderLeft: inPortfolio ? "3px solid #fbbf24" : inWatchlist ? "3px solid #60a5fa" : "3px solid transparent",
                background: isActive ? "rgba(251, 191, 36, 0.10)" : "transparent" }}>
              <td style={{ padding: "4px 8px", textAlign: "center", color: isActive ? "#0d9163" : "#a8a8b8", fontWeight: 500 }}>
                <span>{s.ticker}</span>
                {erSipLookup && erSipLookup[s.ticker] && <SourceBadge source={erSipLookup[s.ticker]} />}
                {s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 14 && (
                  <span title={s.er && s.er.eps != null ? `EPS: $${s.er.eps.toFixed(2)} vs est $${(s.er.eps_estimated ?? 0).toFixed(2)}${s.er.revenue ? ` | Rev: $${(s.er.revenue/1e6).toFixed(0)}M` : ''}` : (s.earnings_display || s.earnings_date || `${s.earnings_days}d`)}
                    style={{ marginLeft: 3, padding: "0px 3px", borderRadius: 2, fontSize: 7, fontWeight: 700, verticalAlign: "super",
                      color: s.earnings_days <= 1 ? "#fff" : "#f87171",
                      background: s.earnings_days <= 1 ? "#dc2626" : "#f8717120",
                      border: `1px solid ${s.earnings_days <= 1 ? "#dc2626" : "#f8717130"}` }}>
                    ER{s.earnings_days === 0 ? "" : s.earnings_days}
                    {s.er && s.er.eps != null && s.er.eps_estimated != null && (
                      <span style={{ marginLeft: 1, color: s.er.eps >= s.er.eps_estimated ? "#4ade80" : "#fca5a5" }}>
                        {s.er.eps >= s.er.eps_estimated ? "✓" : "✗"}
                      </span>
                    )}
                  </span>
                )}
              </td>
              {/* Tags: scan hits + methodology tags */}
              <td style={{ padding: "4px 6px", textAlign: "center" }}>
                <div style={{ display: "flex", gap: 2, justifyContent: "center", flexWrap: "wrap" }}>
                  {(s._scanHits || []).map(h => {
                    const hc = { T: { bg: "#05966920", color: "#2bb886", label: "T" }, W: { bg: "#c084fc20", color: "#c084fc", label: "W" },
                      L: { bg: "#60a5fa20", color: "#60a5fa", label: "L" }, E: { bg: "#fbbf2420", color: "#fbbf24", label: "E" },
                      EP: { bg: "#f9731620", color: "#f97316", label: "EP" },
                      CS: { bg: "#22d3ee20", color: "#22d3ee", label: "CS" },
                      ZM: { bg: "#a78bfa20", color: "#a78bfa", label: "ZM" },
                      "9M": { bg: "#e879f920", color: "#e879f9", label: "9M" } }[h];
                    if (!hc) return null;
                    return <span key={h} style={{ padding: "0px 3px", borderRadius: 2, fontSize: 8, fontWeight: 700,
                      color: hc.color, background: hc.bg, border: `1px solid ${hc.color}30` }}>{hc.label}</span>;
                  })}
                </div>
              </td>
              {/* Grade */}
              <td style={{ padding: "4px 8px", textAlign: "center" }}><Badge grade={s.grade} /></td>
              {/* RS */}
              <td style={{ padding: "4px 8px", textAlign: "center", color: "#b8b8c8", fontFamily: "monospace" }}>{s.rs_rank}</td>
              {/* MS */}
              <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
                color: s._msScore >= 80 ? "#2bb886" : s._msScore >= 60 ? "#60a5fa" : s._msScore >= 40 ? "#9090a0" : s._msScore != null ? "#686878" : "#3a3a4a" }}
                title={`RS:${s.rs_rank ?? '—'} FrHi:${s.pct_from_high ?? '—'}% 3M:${s.return_3m ?? '—'}% VCS:${s.vcs ?? '—'} EPS:${s._epsScore ?? '—'} MF:${s.mf ?? '—'} ADR:${s.adr_pct ?? '—'}%`}>
                {s._msScore ?? "—"}</td>
              {/* MF */}
              <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
                color: s.mf > 30 ? "#2bb886" : s.mf > 0 ? "#4a9070" : s.mf < -30 ? "#f87171" : s.mf < 0 ? "#c06060" : s.mf != null ? "#686878" : "#3a3a4a" }}
                title={s.mf_components ? `P${s._mfPct ?? '—'} | DVol:${s.mf_components.dvol_trend} RVPers:${s.mf_components.rvol_persistence} UpVol:${s.mf_components.up_vol_ratio} PVDir:${s.mf_components.price_vol_dir}` : ""}>
                {s.mf != null ? <>{s.mf > 0 ? `+${s.mf}` : s.mf}<sup style={{ fontSize: 7, color: "#505060", marginLeft: 1 }}>{s._mfPct ?? ''}</sup></> : "—"}</td>
              {/* Chg% */}
              {(() => {
                const lv = liveLookup[s.ticker];
                const chg = lv?.change;
                const chgColor = chg > 0 ? "#2bb886" : chg < 0 ? "#f87171" : "#9090a0";
                return <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace", fontSize: 12, color: chg != null ? chgColor : "#3a3a4a" }}>
                  {chg != null ? `${chg > 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}</td>;
              })()}
              {/* Vol */}
              {(() => {
                const rv = liveLookup[s.ticker]?.rel_volume ?? s.rel_volume;
                const curVol = s.avg_volume_raw && rv ? s.avg_volume_raw * rv : null;
                const fmt = (v) => v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : v?.toFixed(0) || "—";
                return <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                color: rv >= 2 ? "#c084fc" : rv >= 1.5 ? "#a78bfa" : curVol != null ? "#686878" : "#3a3a4a" }}>
                {curVol != null ? fmt(curVol) : '—'}</td>; })()}
              {/* RVol */}
              {(() => { const rv = liveLookup[s.ticker]?.rel_volume ?? s.rel_volume;
                return <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                color: rv >= 2 ? "#c084fc" : rv >= 1.5 ? "#a78bfa" : rv != null ? "#686878" : "#3a3a4a" }}>
                {rv != null ? `${Number(rv).toFixed(1)}x` : '—'}</td>; })()}
              {/* $Vol */}
              <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                color: s.avg_dollar_vol_raw > 20000000 ? "#2bb886" : s.avg_dollar_vol_raw > 10000000 ? "#fbbf24" : s.avg_dollar_vol_raw > 5000000 ? "#f97316" : "#f87171" }}
                title={s.dvol_accel != null ? `$Vol Accel: ${s.dvol_accel > 0 ? '+' : ''}${s.dvol_accel} | 5d/20d: ${s.dvol_ratio_5_20}x | WoW: ${s.dvol_wow_chg > 0 ? '+' : ''}${s.dvol_wow_chg}%` : ""}>
                {s.avg_dollar_vol ? `$${s.avg_dollar_vol}` : '—'}
                {s.dvol_accel != null && <span style={{ fontSize: 8, marginLeft: 2,
                  color: s.dvol_accel >= 30 ? "#2bb886" : s.dvol_accel >= 10 ? "#4a9070" : s.dvol_accel <= -30 ? "#f87171" : s.dvol_accel <= -10 ? "#c06060" : "#505060" }}>
                  {s.dvol_accel >= 30 ? "▲▲" : s.dvol_accel >= 10 ? "▲" : s.dvol_accel <= -30 ? "▼▼" : s.dvol_accel <= -10 ? "▼" : "─"}</span>}
              </td>
              {/* ADR% */}
              <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                color: s.adr_pct > 8 ? "#2dd4bf" : s.adr_pct > 5 ? "#2bb886" : s.adr_pct > 3 ? "#fbbf24" : "#f97316" }}>
                {s.adr_pct != null ? `${s.adr_pct}%` : '—'}</td>
              {/* VCS */}
              <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
                color: s.vcs >= 80 ? "#2bb886" : s.vcs >= 60 ? "#fbbf24" : s.vcs != null ? "#686878" : "#3a3a4a" }}
                title={s.vcs_components ? `ATR:${s.vcs_components.atr_contraction} Range:${s.vcs_components.range_compression} MA:${s.vcs_components.ma_convergence} Vol:${s.vcs_components.volume_dryup} Prox:${s.vcs_components.proximity_highs}` : ""}>
                {s.vcs ?? "—"}</td>
              {/* EPS */}
              <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
                color: s._epsScore >= 80 ? "#22d3ee" : s._epsScore >= 60 ? "#60a5fa" : s._epsScore >= 40 ? "#9090a0" : s._epsScore != null ? "#686878" : "#3a3a4a" }}
                title={(() => {
                  const qs = s.quarters || []; const an = s.annual || [];
                  const parts = [];
                  if (qs[0]?.eps_yoy != null) parts.push(`CurQ EPS: ${qs[0].eps_yoy > 0 ? "+" : ""}${qs[0].eps_yoy.toFixed(0)}%`);
                  if (qs[0]?.sales_yoy != null) parts.push(`CurQ Sales: ${qs[0].sales_yoy > 0 ? "+" : ""}${qs[0].sales_yoy.toFixed(0)}%`);
                  if (qs[1]?.eps_yoy != null && qs[0]?.eps_yoy != null) parts.push(`Accel: ${qs[0].eps_yoy > qs[1].eps_yoy ? "▲" : "▼"}`);
                  if (an[0]?.eps_yoy != null) parts.push(`Ann EPS: ${an[0].eps_yoy > 0 ? "+" : ""}${an[0].eps_yoy.toFixed(0)}%`);
                  const m = qs[0]?.net_margin ?? qs[0]?.op_margin ?? qs[0]?.gross_margin;
                  const pm = qs[1]?.net_margin ?? qs[1]?.op_margin ?? qs[1]?.gross_margin;
                  if (m != null && pm != null) parts.push(`Margin: ${(m - pm) >= 0 ? "+" : ""}${(m - pm).toFixed(1)}pp`);
                  const posQs = qs.slice(0, 4).filter(q => q.eps_yoy != null && q.eps_yoy > 0).length;
                  parts.push(`${posQs}/4 pos Qs`);
                  return parts.join("\n");
                })()}>
                {s._epsScore ?? "—"}</td>
              {/* 3M% */}
              <td style={{ padding: "4px 8px", textAlign: "center" }}><Ret v={s.return_3m} bold /></td>
              {/* FrHi% */}
              <td style={{ padding: "4px 8px", textAlign: "center", color: near ? "#2bb886" : "#9090a0", fontFamily: "monospace" }}>{s.pct_from_high}%</td>
              {/* Theme */}
              <td style={{ padding: "4px 8px", textAlign: "center", color: "#686878", fontSize: 9, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.themes?.[0]?.theme}>{s.themes?.[0]?.theme || "—"}</td>
              {/* Subtheme */}
              <td style={{ padding: "4px 8px", textAlign: "center", color: "#505060", fontSize: 9, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.themes?.[0]?.subtheme}>{s.themes?.[0]?.subtheme || "—"}</td>
            </tr>
          );
        })}</tbody>
      </table>
      </>)}

      {/* Momentum Burst tab */}
      {scanTab === "burst" && burstStocks.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "#686878" }}>Stockbee $ + 4% Breakout — stocks quiet yesterday, bursting today</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ borderBottom: "2px solid #3a3a4a" }}>
              <th style={{ padding: "6px 8px", color: "#787888", fontWeight: 600, textAlign: "left", fontSize: 11 }}>Ticker</th>
              <th style={{ padding: "6px 8px", color: "#787888", fontWeight: 600, textAlign: "center", fontSize: 11 }}>Type</th>
              <th style={{ padding: "6px 8px", color: "#787888", fontWeight: 600, textAlign: "right", fontSize: 11 }}>Chg%</th>
              <th style={{ padding: "6px 8px", color: "#787888", fontWeight: 600, textAlign: "right", fontSize: 11 }}>$Move</th>
              <th style={{ padding: "6px 8px", color: "#787888", fontWeight: 600, textAlign: "right", fontSize: 11 }}>Close</th>
              <th style={{ padding: "6px 8px", color: "#787888", fontWeight: 600, textAlign: "right", fontSize: 11 }}>ClRng</th>
              <th style={{ padding: "6px 8px", color: "#787888", fontWeight: 600, textAlign: "right", fontSize: 11 }}>RVol</th>
              <th style={{ padding: "6px 8px", color: "#787888", fontWeight: 600, textAlign: "right", fontSize: 11 }}>Vol</th>
              <th style={{ padding: "6px 8px", color: "#787888", fontWeight: 600, textAlign: "right", fontSize: 11 }}>RS</th>
              <th style={{ padding: "6px 8px", color: "#787888", fontWeight: 600, textAlign: "left", fontSize: 11 }}>Theme</th>
            </tr></thead>
            <tbody>{burstStocks.map(b => {
              const isActive = b.ticker === activeTicker;
              const scanTag = b.scan.join("+");
              const tagColor = b.scan.includes("$") && b.scan.includes("4%") ? "#f59e0b" : b.scan.includes("$") ? "#60a5fa" : "#2bb886";
              return (
                <tr key={b.ticker} data-ticker={b.ticker} onClick={() => onTickerClick(b.ticker)}
                  style={{ borderBottom: "1px solid #222230", cursor: "pointer",
                    background: isActive ? "#f59e0b18" : "transparent" }}>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace", fontWeight: 700,
                    color: isActive ? "#f59e0b" : "#d4d4e0" }}>
                    <Badge grade={b._grade} />{" "}{b.ticker}
                    {erSipLookup && erSipLookup[b.ticker] && <SourceBadge source={erSipLookup[b.ticker]} />}
                    <span style={{ fontSize: 9, color: "#505060", fontWeight: 400, marginLeft: 4 }}>{b._company}</span>
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "center" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: tagColor, padding: "2px 6px", borderRadius: 3, background: tagColor + "20" }}>{scanTag}</span>
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace",
                    color: b.change_pct >= 8 ? "#2bb886" : b.change_pct >= 4 ? "#60a5fa" : "#9090a0", fontWeight: 600 }}>
                    {b.change_pct > 0 ? "+" : ""}{b.change_pct.toFixed(1)}%
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: "#b8b8c8" }}>
                    ${b.dollar_move.toFixed(2)}
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: "#d4d4e0" }}>
                    ${b.close.toFixed(2)}
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace",
                    color: b.close_range >= 90 ? "#2bb886" : b.close_range >= 70 ? "#60a5fa" : "#9090a0" }}>
                    {b.close_range.toFixed(0)}%
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace",
                    color: b.vol_ratio >= 3 ? "#c084fc" : b.vol_ratio >= 2 ? "#a78bfa" : "#9090a0" }}>
                    {b.vol_ratio.toFixed(1)}x
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: "#9090a0" }}>
                    {b.volume >= 1e6 ? (b.volume / 1e6).toFixed(1) + "M" : (b.volume / 1e3).toFixed(0) + "K"}
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace",
                    color: (b._rs || 0) >= 80 ? "#2bb886" : (b._rs || 0) >= 60 ? "#60a5fa" : "#9090a0" }}>
                    {b._rs || "—"}
                  </td>
                  <td style={{ padding: "5px 8px", color: "#686878", fontSize: 10, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={b._themes?.[0]?.theme}>
                    {b._themes?.[0]?.theme || "—"}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
    {/* Theme Leaders side panel */}
    {showLeaders && (
      <div style={{ width: "30%", minWidth: 280, borderLeft: "2px solid #3a3a4a", overflowY: "auto", flexShrink: 0,
        position: "sticky", top: 0, maxHeight: "100vh", alignSelf: "flex-start" }}>
        <Leaders themes={themes} stockMap={stockMap} filters={filters} onTickerClick={onTickerClick}
          activeTicker={activeTicker} mmData={mmData} onVisibleTickers={() => {}} themeHealth={themeHealth}
          liveThemeData={externalLiveData}
          onThemeDrillDown={(themeName) => { setActiveTheme(themeName); }} />
      </div>
    )}
    </div>
  );
}


// ── EPISODIC PIVOTS ──
function EpisodicPivots({ stockMap, onTickerClick, activeTicker, onVisibleTickers, earningsMovers, headlinesMap, pmEarningsMovers, ahEarningsMovers, pmSipMovers, ahSipMovers, historicalEarningsMovers }) {
  // STATE: Unified table with source filter
  const [sort, setSort] = useState({ col: "date", dir: "desc" });
  const [sourceFilter, setSourceFilter] = useState("all"); // "all" | "er" | "sip"

  // STATE: Filters
  const [minRS, setMinRS] = useState(0);
  const [minDvol, setMinDvol] = useState(0); // min avg $Vol in millions
  const [maxDays, setMaxDays] = useState(60);
  const [noBio, setNoBio] = useState(true);

  // STATE: ER Filters
  const [erUniverseOnly, setErUniverseOnly] = useState(false);
  const [er9M, setEr9M] = useState(false);
  const [erBeatFilter, setErBeatFilter] = useState(null);

  // STATE: Calendar & PM/AH collapsible sections
  const [showLegend, setShowLegend] = useState(false);
  const [pmCollapsed, setPmCollapsed] = useState(false);
  const [ahCollapsed, setAhCollapsed] = useState(false);
  const [histCollapsed, setHistCollapsed] = useState(false);

  // Sort state for PM/AH/Historical tables
  const [pmSort, setPmSort] = useState({ col: "change", dir: "desc" });
  const [ahSort, setAhSort] = useState({ col: "change", dir: "desc" });
  const [histSort, setHistSort] = useState({ col: "days", dir: "asc" });

  const erSortedTickersRef = useRef([]);

  // Build earnings data
  const earningsData = useMemo(() => {
    const reportedTickers = new Set((earningsMovers || []).map(m => m.ticker));
    const todayAMCTickers = new Set();
    Object.values(stockMap).forEach(s => {
      if (s.earnings_days === 0) {
        const disp = (s.earnings_display || s.earnings_date || "").toUpperCase();
        if (disp.includes("AMC")) todayAMCTickers.add(s.ticker);
      }
    });

    const upcomingAMC = Object.values(stockMap).filter(s => {
      if (reportedTickers.has(s.ticker)) return false;
      return todayAMCTickers.has(s.ticker);
    }).map(s => ({
      ticker: s.ticker,
      company: s.company || s.ticker,
      price: s.price,
      change_pct: s.change_pct,
      volume: s.volume || s.avg_volume_raw,
      er: { time: "amc_today" },
      in_universe: true,
      grade: s.grade,
      _upcoming: true,
    }));

    const allMovers = [...(earningsMovers || []), ...upcomingAMC].map(m => {
      const er = m.er || {};
      const chg = m.change_pct ?? 0;
      const isUpcoming = !!m._upcoming || todayAMCTickers.has(m.ticker);

      const parts = [];
      if (!isUpcoming) {
        if (er.eps != null) {
          const epsStr = `${m.company || m.ticker} GAAP EPS of $${er.eps.toFixed(2)}`;
          if (er.eps_estimated != null) {
            const diff = er.eps - er.eps_estimated;
            parts.push(`${epsStr} ${diff >= 0 ? "beats" : "misses"} by $${Math.abs(diff).toFixed(2)}`);
          } else {
            parts.push(epsStr);
          }
        }
        if (er.revenue != null) {
          const revStr = er.revenue >= 1e9 ? `$${(er.revenue/1e9).toFixed(2)}B` : `$${(er.revenue/1e6).toFixed(2)}M`;
          if (er.revenue_estimated != null) {
            const diff = er.revenue - er.revenue_estimated;
            const diffStr = Math.abs(diff) >= 1e9 ? `$${(Math.abs(diff)/1e9).toFixed(2)}B` : `$${(Math.abs(diff)/1e6).toFixed(2)}M`;
            parts.push(`revenue of ${revStr} ${diff >= 0 ? "beats" : "misses"} by ${diffStr}`);
          } else {
            parts.push(`revenue of ${revStr}`);
          }
        }
      }

      // Scraped headlines from TheStockCatalyst (rich multi-headline), fallback to computed
      const scrapedHL = m.recent_headlines || (headlinesMap[m.ticker]?.headlines) || [];
      const computedHL = isUpcoming ? "" : parts.join(", ");

      return {
        ticker: m.ticker,
        company: m.company || m.ticker,
        price: m.price ?? stockMap[m.ticker]?.price ?? null,
        _chg: chg,
        _er: er,
        _headline: computedHL,
        _recentHeadlines: scrapedHL,
        _vol: m.volume || 0,
        _inUniverse: !!m.in_universe,
        grade: m.grade || null,
        _pmChg: m.pm_change_pct ?? null,
        _idChg: m.id_change_pct ?? null,
        _idVol: m.id_volume ?? null,
        _ahChg: m.ah_change_pct ?? null,
        _upcoming: isUpcoming,
        _industry: stockMap[m.ticker]?.industry || m.industry || "",
        _rvol: stockMap[m.ticker]?.rel_volume ?? m._rel_volume ?? null,
        _avgVol: stockMap[m.ticker]?.avg_volume_raw ?? m._avg_volume ?? null,
        _epsBeat: !isUpcoming && er.eps != null && er.eps_estimated != null ? er.eps >= er.eps_estimated : null,
        _revBeat: !isUpcoming && er.revenue != null && er.revenue_estimated != null ? er.revenue >= er.revenue_estimated : null,
        _grossMargin: er.gross_margin ?? null,
        _netMargin: er.net_margin ?? null,
        _revGrowthYoY: er.rev_growth_yoy ?? null,
        _epsGrowthYoY: er.eps_growth_yoy ?? null,
        days_ago: m.days_ago ?? 0,
      };
    });

    return allMovers;
  }, [earningsMovers, stockMap, headlinesMap]);

  // Filter earnings movers
  const ER_EXCLUDED = new Set([
    "Biotechnology", "Investment Brokerage - National", "Investment Brokerage - Regional",
    "Investment Banks/Brokers", "Investment Banks and Brokerages",
    "Investment Management", "Investment Managers",
    "Closed-End Fund - Equity", "Closed-End Fund - Debt", "Closed-End Fund - Foreign",
    "Investment Trusts/Mutual Funds",
    "Drug Manufacturers - General", "Drug Manufacturers - Specialty & Generic",
    "Pharmaceutical Retailers", "Pharmaceuticals: Generic", "Pharmaceuticals: Major", "Pharmaceuticals: Other",
    "REIT - Diversified", "REIT - Healthcare Facilities", "REIT - Hotel & Motel",
    "REIT - Industrial", "REIT - Mortgage", "REIT - Office", "REIT - Residential",
    "REIT - Retail", "REIT - Specialty", "Real Estate Investment Trusts",
  ]);

  const filteredEarnings = useMemo(() => {
    let result = earningsData;

    if (noBio) {
      result = result.filter(s => {
        const ind = (s._industry || "").trim();
        if (!ind) return true;
        for (const ex of ER_EXCLUDED) { if (ind.toLowerCase() === ex.toLowerCase()) return false; }
        return true;
      });
    }

    if (er9M) {
      result = result.filter(s => {
        const todayVol = s._vol || 0;
        const avgVol = s._avgVol || Infinity;
        return todayVol >= 8_900_000 && avgVol < 8_900_000;
      });
    }

    if (erUniverseOnly) {
      result = result.filter(s => s._inUniverse);
    }

    if (erBeatFilter === "beat") {
      result = result.filter(s => s._epsBeat === true || s._revBeat === true);
    } else if (erBeatFilter === "miss") {
      result = result.filter(s => s._epsBeat === false || s._revBeat === false);
    }

    return result;
  }, [earningsData, noBio, er9M, erUniverseOnly, erBeatFilter]);

  // Unified row model: ERs + SIP
  const unifiedRows = useMemo(() => {
    const rows = [];
    const seen = new Set();

    // Add ER rows
    filteredEarnings.forEach(er => {
      const key = `${er.ticker}_er`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ ...er, _source: er._upcoming ? "upcoming" : "er", _key: key });
      }
    });

    // Add SIP movers (PM and AH stocks in play) not already in ERs
    const allSip = [...(pmSipMovers || []).map(m => ({ ...m, _sipSession: "PM" })), ...(ahSipMovers || []).map(m => ({ ...m, _sipSession: "AH" }))];
    allSip.forEach(m => {
      if (!seen.has(m.ticker + "_sip")) {
        seen.add(m.ticker + "_sip");
        const s = stockMap[m.ticker] || {};
        rows.push({
          ticker: m.ticker,
          _source: m._sipSession === "PM" ? "pm_sip" : "ah_sip",
          _key: m.ticker + "_sip",
          _headline: m.headlines?.[0] || "",
          _recentHeadlines: m.headlines || [],
          _chg: m.change_pct,
          vol_ratio: m.volume && s.avg_volume ? m.volume / s.avg_volume : null,
          days_ago: 0,
          _sipData: m,
        });
      }
    });

    // Filter by source
    let filtered = rows;
    if (sourceFilter === "er") {
      filtered = filtered.filter(r => r._source === "er" || r._source === "upcoming");
    } else if (sourceFilter === "sip") {
      filtered = filtered.filter(r => r._source === "pm_sip" || r._source === "ah_sip");
    }
    // Filter by RS
    if (minRS > 0) {
      filtered = filtered.filter(r => (stockMap[r.ticker]?.rs_rank ?? 0) >= minRS);
    }
    // Filter by avg $Vol (in millions)
    if (minDvol > 0) {
      filtered = filtered.filter(r => {
        const dv = stockMap[r.ticker]?.avg_dollar_vol_raw;
        return dv != null && dv >= minDvol * 1_000_000;
      });
    }
    return filtered;
  }, [filteredEarnings, pmSipMovers, ahSipMovers, sourceFilter, minRS, minDvol, stockMap]);

  // Detect if enough earnings rows have session data (PM/ID/AH) to show those columns
  const hasSessionData = useMemo(() => {
    if (filteredEarnings.length === 0) return false;
    const withSession = filteredEarnings.filter(s => s._pmChg != null || s._idChg != null || s._ahChg != null).length;
    return withSession / filteredEarnings.length > 0.15; // need >15% coverage to show session columns
  }, [filteredEarnings]);

  // Sort unified rows
  const sortedRows = useMemo(() => {
    const sorters = {
      type: (a, b) => {
        const order = { er: 0, upcoming: 1, pm_sip: 2, ah_sip: 3 };
        return (order[a._source] ?? 99) - (order[b._source] ?? 99);
      },
      ticker: (a, b) => (a.ticker || "").localeCompare(b.ticker || ""),
      grade: (a, b) => {
        const go = ["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-","E+","E","E-","F+","F","F-","G+","G"];
        return (go.indexOf(stockMap[a.ticker]?.grade || "G") - go.indexOf(stockMap[b.ticker]?.grade || "G"));
      },
      date: (a, b) => (a.days_ago ?? 999) - (b.days_ago ?? 999),
      days: (a, b) => (a.days_ago ?? 999) - (b.days_ago ?? 999),
      gap: (a, b) => (b.gap_pct ?? -999) - (a.gap_pct ?? -999),
      change: (a, b) => ((stockMap[b.ticker]?.change_pct ?? b._chg) ?? -999) - ((stockMap[a.ticker]?.change_pct ?? a._chg) ?? -999),
      dvol: (a, b) => (stockMap[b.ticker]?.avg_dollar_vol_raw ?? -999) - (stockMap[a.ticker]?.avg_dollar_vol_raw ?? -999),
      vol: (a, b) => {
        const av = a.vol_ratio ?? a._rvol ?? -999;
        const bv = b.vol_ratio ?? b._rvol ?? -999;
        return bv - av;
      },
      subtheme: (a, b) => (stockMap[a.ticker]?.themes?.[0]?.subtheme || "ZZZ").localeCompare(stockMap[b.ticker]?.themes?.[0]?.subtheme || "ZZZ"),
      pm: (a, b) => (b._pmChg ?? -999) - (a._pmChg ?? -999),
      id: (a, b) => (b._idChg ?? -999) - (a._idChg ?? -999),
      id_vol: (a, b) => (b._idVol ?? -999) - (a._idVol ?? -999),
      ah: (a, b) => (b._ahChg ?? -999) - (a._ahChg ?? -999),
      rev: (a, b) => (b._revGrowthYoY ?? -999) - (a._revGrowthYoY ?? -999),
      eps: (a, b) => (b._epsGrowthYoY ?? -999) - (a._epsGrowthYoY ?? -999),
      gm: (a, b) => (b._grossMargin ?? -999) - (a._grossMargin ?? -999),
      nm: (a, b) => (b._netMargin ?? -999) - (a._netMargin ?? -999),
      pct_from_high: (a, b) => (stockMap[b.ticker]?.pct_from_high ?? -999) - (stockMap[a.ticker]?.pct_from_high ?? -999),
      rs: (a, b) => (stockMap[b.ticker]?.rs_rank ?? 0) - (stockMap[a.ticker]?.rs_rank ?? 0),
      theme: (a, b) => (stockMap[a.ticker]?.themes?.[0]?.theme || "ZZZ").localeCompare(stockMap[b.ticker]?.themes?.[0]?.theme || "ZZZ"),
    };

    const sorted = [...unifiedRows].sort(sorters[sort.col] || sorters.date);
    if (sort.dir === "asc") sorted.reverse();
    return sorted;
  }, [unifiedRows, sort, stockMap]);

  // Filter historical earnings movers using the same filters as the main table
  const filteredHistoricalMovers = useMemo(() => {
    let list = historicalEarningsMovers || [];

    // Source filter: historical are all ER — hide when SIP-only
    if (sourceFilter === "sip") return [];

    // Bio/REIT filter
    if (noBio) {
      list = list.filter(m => {
        const ind = (stockMap[m.ticker]?.industry || m._industry || "").trim().toLowerCase();
        if (!ind) return true;
        for (const ex of ER_EXCLUDED) { if (ind === ex.toLowerCase()) return false; }
        return true;
      });
    }

    // Theme Only
    if (erUniverseOnly) {
      list = list.filter(m => m.in_universe);
    }

    // 9M filter (today vol ≥ 8.9M but avg vol < 8.9M)
    if (er9M) {
      list = list.filter(m => {
        const vol = m.volume || 0;
        const avgVol = m.avg_volume || stockMap[m.ticker]?.avg_volume_raw || Infinity;
        return vol >= 8_900_000 && avgVol < 8_900_000;
      });
    }

    // Beat / Miss filter
    if (erBeatFilter === "beat") {
      list = list.filter(m => {
        const er = m.er || {};
        return er.eps != null && er.eps_estimated != null && er.eps >= er.eps_estimated;
      });
    } else if (erBeatFilter === "miss") {
      list = list.filter(m => {
        const er = m.er || {};
        return er.eps != null && er.eps_estimated != null && er.eps < er.eps_estimated;
      });
    }

    // RS slider
    if (minRS > 0) {
      list = list.filter(m => (stockMap[m.ticker]?.rs_rank ?? m.rs_rank ?? 0) >= minRS);
    }

    // $Vol slider
    if (minDvol > 0) {
      list = list.filter(m => {
        const dv = stockMap[m.ticker]?.avg_dollar_vol_raw;
        return dv != null && dv >= minDvol * 1_000_000;
      });
    }

    return list;
  }, [historicalEarningsMovers, sourceFilter, noBio, erUniverseOnly, er9M, erBeatFilter, minRS, minDvol, stockMap]);

  // Generic sort helper for PM/AH/Historical tables
  const _sortSessionMovers = (list, sortState, getExtra) => {
    const { col, dir } = sortState;
    const sorted = [...list].sort((a, b) => {
      const ea = getExtra ? getExtra(a) : {};
      const eb = getExtra ? getExtra(b) : {};
      let cmp = 0;
      switch (col) {
        case "ticker": cmp = (a.ticker || "").localeCompare(b.ticker || ""); break;
        case "name": cmp = (a.name || a.company || "").localeCompare(b.name || b.company || ""); break;
        case "volume": cmp = (a.volume || 0) - (b.volume || 0); break;
        case "change": cmp = (a.change_pct ?? a.ext_hours_change_pct ?? -999) - (b.change_pct ?? b.ext_hours_change_pct ?? -999); break;
        case "price": cmp = (a.price || 0) - (b.price || 0); break;
        case "rvol": cmp = (ea.rvol ?? -999) - (eb.rvol ?? -999); break;
        case "days": cmp = (a.days_ago ?? 999) - (b.days_ago ?? 999); break;
        case "session": cmp = (a._session || a.er?.timing || "").localeCompare(b._session || b.er?.timing || ""); break;
        default: cmp = 0;
      }
      return dir === "desc" ? -cmp : cmp;
    });
    return sorted;
  };

  // Sorted PM movers
  const sortedPmMovers = useMemo(() => {
    return _sortSessionMovers(pmEarningsMovers || [], pmSort);
  }, [pmEarningsMovers, pmSort]);

  // Sorted AH movers
  const sortedAhMovers = useMemo(() => {
    return _sortSessionMovers(ahEarningsMovers || [], ahSort);
  }, [ahEarningsMovers, ahSort]);

  // Sorted Historical movers
  const sortedHistMovers = useMemo(() => {
    return _sortSessionMovers(filteredHistoricalMovers || [], histSort, (m) => ({
      rvol: m.volume && m.avg_volume ? (m.volume / m.avg_volume) : (stockMap[m.ticker]?.rel_volume ?? null),
    }));
  }, [filteredHistoricalMovers, histSort, stockMap]);

  // Report visible tickers
  useEffect(() => {
    if (onVisibleTickers) {
      onVisibleTickers(sortedRows.map(r => r.ticker));
    }
  }, [sortedRows, onVisibleTickers]);

  // STATUS & COLOR HELPERS
  const chgColor = (v) => {
    if (v == null) return "#3a3a4a";
    if (v >= 5) return "#2bb886"; if (v > 0) return "#4a9a6a";
    if (v <= -5) return "#f87171"; if (v < 0) return "#c06060";
    return "#686878";
  };

  const fmtVol = (v) => {
    if (v == null || v === 0) return "—";
    if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v/1e3).toFixed(0)}K`;
    return v.toLocaleString();
  };

  const gradeColor = (g) => {
    if (!g) return "#4a4a5a";
    if (g.startsWith("A")) return "#2bb886";
    if (g.startsWith("B")) return "#60a5fa";
    if (g.startsWith("C")) return "#fbbf24";
    return "#686878";
  };

  const getTypeColor = (source) => {
    if (source === "er") return "#c084fc";
    if (source === "upcoming") return "#f59e0b";
    if (source === "sip" || source === "pm_sip" || source === "ah_sip") return "#38bdf8";
    return "#686878";
  };

  const getTypeBg = (source) => {
    if (source === "er") return "#c084fc18";
    if (source === "upcoming") return "#f59e0b18";
    if (source === "sip" || source === "pm_sip" || source === "ah_sip") return "#38bdf818";
    return "#4a4a5a18";
  };

  const getSourceBorderColor = (source) => {
    if (source === "er") return "#c084fc40";
    if (source === "upcoming") return "#f59e0b40";
    if (source === "sip" || source === "pm_sip" || source === "ah_sip") return "#38bdf840";
    return "#4a4a5a40";
  };

  // Upcoming earnings calendar
  const upcomingEarnings = useMemo(() => {
    if (!stockMap) return [];
    const now = new Date();
    const results = [];
    Object.values(stockMap).forEach(s => {
      let days = s.earnings_days;
      if (days == null && s.earnings_date) {
        try {
          const raw = s.earnings_date.replace(/\s*(AMC|BMO|a|b)\s*$/i, "").trim();
          const parts = raw.split(/\s+/);
          if (parts.length >= 2) {
            for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
              const parsed = new Date(`${parts[0]} ${parts[1]}, ${y}`);
              if (!isNaN(parsed)) { const diff = Math.floor((parsed - now) / 86400000); if (diff >= -14 && diff <= 14) { days = diff; break; } }
            }
          }
        } catch {}
      }
      if (days != null && days >= -14 && days <= 14) {
        if (noBio && (String(s.industry || "") === "Biotechnology" || String(s.industry || "").includes("Drug Manufacturer"))) return;
        const epsScore = computeEPSScore(s);
        results.push({ ...s, _days: days, _epsScore: epsScore.score, _epsFactors: epsScore.factors });
      }
    });
    return results.sort((a, b) => a._days - b._days || (b._epsScore ?? -1) - (a._epsScore ?? -1));
  }, [stockMap, noBio]);

  const earningsCalendar = useMemo(() => {
    const now = new Date();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dayBuckets = {};
    upcomingEarnings.forEach(s => {
      const d = new Date(now);
      d.setDate(d.getDate() + s._days);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const dayLabel = `${dayNames[d.getDay()]} ${monthNames[d.getMonth()]} ${d.getDate()}`;
      if (!dayBuckets[dateKey]) dayBuckets[dateKey] = { dateKey, dayLabel, days: s._days, date: d, items: [] };
      dayBuckets[dateKey].items.push(s);
    });
    const weeks = {};
    Object.values(dayBuckets).sort((a, b) => a.days - b.days).forEach(day => {
      const d = day.date;
      const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
      const weekKey = `${monthNames[mon.getMonth()]} ${mon.getDate()}-${fri.getDate()}`;
      const isPast = day.days < 0;
      const isCurrent = mon <= now && fri >= now;
      if (!weeks[weekKey]) weeks[weekKey] = { weekKey, days: [], isPast, isCurrent, startDay: day.days };
      weeks[weekKey].days.push(day);
    });
    return Object.values(weeks).sort((a, b) => a.startDay - b.startDay);
  }, [upcomingEarnings]);

  const [collapsedWeeks, setCollapsedWeeks] = useState(() => {
    const collapsed = new Set();
    earningsCalendar.forEach(w => w.days.forEach(d => {
      if (d.days < 0) collapsed.add(d.dateKey);
    }));
    return collapsed;
  });
  const toggleWeek = (wk) => setCollapsedWeeks(prev => {
    const next = new Set(prev);
    if (next.has(wk)) next.delete(wk); else next.add(wk);
    return next;
  });

  return (
    <div>
      {/* ── UNIFIED CATALYSTS TABLE ── */}
      <div style={{ marginBottom: 16 }}>
        {/* Filter Bar */}
        <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#a8a8b8", fontWeight: 600 }}>
            Catalysts ({sortedRows.length})
          </span>

          {/* Source toggles */}
          <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            {["all", "er", "sip"].map(src => {
              const label = src === "all" ? "All" : src === "er" ? "ER" : "SIP";
              const isActive = sourceFilter === src;
              return (
                <button key={src} onClick={() => setSourceFilter(src)}
                  style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                    border: isActive ? `1px solid ${getTypeColor(src)}` : "1px solid #3a3a4a",
                    background: isActive ? getTypeBg(src) : "transparent",
                    color: isActive ? getTypeColor(src) : "#787888" }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* RS slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
            <span style={{ fontSize: 10, color: minRS > 0 ? "#4aad8c" : "#686878", fontWeight: 600, whiteSpace: "nowrap" }}>RS≥{minRS}</span>
            <input type="range" min={0} max={95} step={5} value={minRS} onChange={e => setMinRS(Number(e.target.value))}
              style={{ width: 60, height: 4, accentColor: "#0d9163", cursor: "pointer" }} />
          </div>

          {/* $Vol slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, color: minDvol > 0 ? "#fbbf24" : "#686878", fontWeight: 600, whiteSpace: "nowrap" }}>$Vol≥{minDvol}M</span>
            <input type="range" min={0} max={100} step={5} value={minDvol} onChange={e => setMinDvol(Number(e.target.value))}
              style={{ width: 60, height: 4, accentColor: "#fbbf24", cursor: "pointer" }} />
          </div>

          {/* Days filter */}
          <span style={{ fontSize: 9, color: "#4a4a5a" }}>
            Days≤<input type="number" value={maxDays} onChange={e => setMaxDays(+e.target.value)} min={1} max={120} step={1}
              style={{ width: 36, background: "#1a1a28", border: "1px solid #333344", borderRadius: 3, color: "#a8a8b8",
                fontSize: 9, textAlign: "center", padding: "1px 2px" }} />
          </span>

          {/* Bio/REIT filter */}
          <button onClick={() => setNoBio(prev => !prev)}
            style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
              border: noBio ? "1px solid #f97316" : "1px solid #3a3a4a",
              background: noBio ? "#f9731618" : "transparent",
              color: noBio ? "#f97316" : "#787888" }}>
            {noBio ? "⊘ Bio/REIT" : "○ Bio/REIT"}
          </button>

          {/* ER filters */}
          {(sourceFilter === "all" || sourceFilter === "er") && (
            <>
              <button onClick={() => setErUniverseOnly(prev => !prev)}
                style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                  border: erUniverseOnly ? "1px solid #fbbf24" : "1px solid #3a3a4a",
                  background: erUniverseOnly ? "#fbbf2418" : "transparent",
                  color: erUniverseOnly ? "#fbbf24" : "#787888" }}>
                {"★ Theme Only"}
              </button>
              <button onClick={() => setEr9M(prev => !prev)}
                style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                  border: er9M ? "1px solid #e879f9" : "1px solid #3a3a4a",
                  background: er9M ? "#e879f918" : "transparent",
                  color: er9M ? "#e879f9" : "#787888" }}
                title="Today vol≥8.9M but avg vol<8.9M (unusual activity)">
                9M
              </button>
              <button onClick={() => setErBeatFilter(p => p === "beat" ? null : "beat")}
                style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                  border: erBeatFilter === "beat" ? "1px solid #2bb886" : "1px solid #3a3a4a",
                  background: erBeatFilter === "beat" ? "#2bb88618" : "transparent",
                  color: erBeatFilter === "beat" ? "#2bb886" : "#787888" }}>
                Beat
              </button>
              <button onClick={() => setErBeatFilter(p => p === "miss" ? null : "miss")}
                style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                  border: erBeatFilter === "miss" ? "1px solid #f87171" : "1px solid #3a3a4a",
                  background: erBeatFilter === "miss" ? "#f8717118" : "transparent",
                  color: erBeatFilter === "miss" ? "#f87171" : "#787888" }}>
                Miss
              </button>
            </>
          )}
        </div>

        {/* Unified Table */}
        {sortedRows.length > 0 ? (
          <div style={{ overflowX: "auto", maxHeight: 375, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 30 }} />{/* RS */}
                <col style={{ width: 52 }} />{/* Type */}
                <col style={{ width: 52 }} />{/* Ticker */}
                <col style={{ width: 42 }} />{/* Rev% */}
                <col style={{ width: 42 }} />{/* EPS% */}
                <col />{/* Headline — takes remaining space */}
                <col style={{ width: 55 }} />{/* $Vol */}
                <col style={{ width: 42 }} />{/* Chg% */}
                <col style={{ width: 38 }} />{/* RVol */}
                <col style={{ width: 80 }} />{/* Sub */}
                <col style={{ width: 42 }} />{/* FrHi% */}
                <col style={{ width: 30 }} />{/* Days */}
              </colgroup>
              <thead>
                <tr style={{ borderBottom: "1px solid #222230", position: "sticky", top: 0, background: "#0d0d14", zIndex: 1 }}>
                  {[
                    { col: "rs", label: "RS", align: "right" },
                    { col: "type", label: "Type", align: "center" },
                    { col: "ticker", label: "Ticker", align: "left" },
                    { col: "rev", label: "Rev%", align: "right", color: "#34d399" },
                    { col: "eps", label: "EPS%", align: "right", color: "#34d399" },
                  ].map(({ col, label, align, color }) => (
                    <th key={col} onClick={() => setSort(prev => prev.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" })}
                      style={{ padding: "4px 2px", textAlign: align, color: sort.col === col ? "#fbbf24" : (color || "#686878"),
                        fontWeight: 600, fontSize: 9, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                        width: 42, maxWidth: 42 }}>
                      {label}{sort.col === col ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                  <th style={{ padding: "4px 4px", textAlign: "left", color: "#686878", fontWeight: 600, fontSize: 9 }}>Headline</th>
                  {[
                    { col: "dvol", label: "$Vol", align: "right" },
                    { col: "change", label: "Chg%", align: "right" },
                    { col: "vol", label: "RVol", align: "right" },
                    { col: "subtheme", label: "Sub", align: "left" },
                    { col: "pct_from_high", label: "FrHi%", align: "right" },
                    { col: "days", label: "Days", align: "right" },
                  ].map(({ col, label, align, color }) => (
                    <th key={col} onClick={() => setSort(prev => prev.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" })}
                      style={{ padding: "4px 4px", textAlign: align, color: sort.col === col ? "#fbbf24" : (color || "#686878"),
                        fontWeight: 600, fontSize: 9, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                      {label}{sort.col === col ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(row => {
                  const s = stockMap[row.ticker] || {};
                  const isActive = row.ticker === activeTicker;
                  const borderColor = getSourceBorderColor(row._source);

                  const displayGap = row.gap_pct != null ? `+${row.gap_pct.toFixed(1)}%` : "—";
                  const displayChg = row._chg != null ? `${row._chg >= 0 ? "+" : ""}${row._chg.toFixed(1)}%` :
                                     row.change_pct != null ? `${row.change_pct >= 0 ? "+" : ""}${row.change_pct.toFixed(1)}%` : "—";
                  const displayVol = row.vol_ratio != null ? `${row.vol_ratio.toFixed(1)}x` :
                                    row._rvol != null ? `${row._rvol.toFixed(1)}x` : "—";

                  const displayRev = row._revGrowthYoY != null ? `${row._revGrowthYoY >= 0 ? "+" : ""}${row._revGrowthYoY.toFixed(0)}%` : "—";
                  const displayEps = row._epsGrowthYoY != null ? `${row._epsGrowthYoY >= 0 ? "+" : ""}${row._epsGrowthYoY.toFixed(0)}%` : "—";

                  // Headline for ER rows
                  const headlineColor = row._epsBeat && row._revBeat ? "#2bb886" : row._epsBeat === false && row._revBeat === false ? "#f87171" : row._epsBeat ? "#4a9a6a" : row._epsBeat === false ? "#c06060" : "#686878";

                  const chgCell = (val, defColor) => (
                    <td style={{ padding: "3px 4px", textAlign: "right", fontFamily: "monospace", fontSize: 10 }}>
                      {val != null ? (
                        <span style={{ color: chgColor(val) }}>{val > 0 ? "+" : ""}{val.toFixed(1)}%</span>
                      ) : <span style={{ color: "#2a2a35" }}>—</span>}
                    </td>
                  );

                  return (
                    <tr key={row._key}
                      onClick={() => onTickerClick(row.ticker)}
                      style={{ borderBottom: "1px solid #1a1a26", cursor: "pointer", borderLeft: `2px solid ${borderColor}`,
                        background: isActive ? "#fbbf2420" : "transparent" }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "#ffffff08"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isActive ? "#fbbf2420" : "transparent"; }}>
                      {/* RS */}
                      <td style={{ padding: "3px 4px", textAlign: "right", fontSize: 10, fontFamily: "monospace",
                        color: (s.rs_rank || 0) >= 80 ? "#2bb886" : (s.rs_rank || 0) >= 60 ? "#686878" : "#4a4a5a" }}>
                        {s.rs_rank ?? "—"}
                      </td>
                      {/* Type Badge */}
                      <td style={{ padding: "3px 4px", textAlign: "center", fontSize: 8, fontWeight: 700 }}>
                        <span style={{ padding: "1px 4px", borderRadius: 3, background: getTypeBg(row._source),
                          color: getTypeColor(row._source), whiteSpace: "nowrap" }}>
                          {row._source === "upcoming" ? "AMC" : row._source === "pm_sip" ? "PM-SIP" :
                           row._source === "ah_sip" ? "AH-SIP" : row._source.toUpperCase()}
                        </span>
                      </td>
                      {/* Ticker */}
                      <td style={{ padding: "3px 4px", fontWeight: 600, fontSize: 10, fontFamily: "monospace",
                        color: isActive ? "#fbbf24" : "#a8a8b8" }}>
                        {row.ticker}
                      </td>
                      {/* Rev% */}
                      <td style={{ padding: "3px 2px", textAlign: "right", fontSize: 10, fontFamily: "monospace",
                        width: 42, maxWidth: 42, color: row._revGrowthYoY != null ? chgColor(row._revGrowthYoY) : "#3a3a4a" }}>
                        {displayRev}
                      </td>
                      {/* EPS% */}
                      <td style={{ padding: "3px 2px", textAlign: "right", fontSize: 10, fontFamily: "monospace",
                        width: 42, maxWidth: 42, color: row._epsGrowthYoY != null ? chgColor(row._epsGrowthYoY) : "#3a3a4a" }}>
                        {displayEps}
                      </td>
                      {/* Headline */}
                      <td style={{ padding: "3px 6px", fontSize: 9, color: row._upcoming ? "#787888" : "#a8a8b8",
                        lineHeight: 1.4, verticalAlign: "top", overflow: "hidden",
                        fontStyle: row._upcoming ? "italic" : "normal", whiteSpace: "normal", wordWrap: "break-word" }}>
                        {row._upcoming ? (
                          <span style={{ color: "#787888" }}>Reports after close today</span>
                        ) : row._recentHeadlines && row._recentHeadlines.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {row._recentHeadlines.slice(0, 3).map((hl, hi) => (
                              <div key={hi} style={{ overflow: "hidden", textOverflow: "ellipsis",
                                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                                fontSize: hi === 0 ? 9 : 8, color: hi === 0 ? headlineColor : "#606070",
                                fontWeight: hi === 0 ? 500 : 400 }}>
                                {typeof hl === "string" ? hl : hl.text || hl.headline || ""}
                              </div>
                            ))}
                          </div>
                        ) : row._headline ? (
                          <span style={{ color: headlineColor, overflow: "hidden", textOverflow: "ellipsis",
                            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                            {row._headline}
                          </span>
                        ) : "—"}
                      </td>
                      {/* $Vol */}
                      {(() => {
                        const dv = s.avg_dollar_vol_raw || (row._vol && row.price ? row._vol * row.price : null);
                        const dvFmt = s.avg_dollar_vol ? `$${s.avg_dollar_vol}` : dv ? (dv >= 1e9 ? `$${(dv/1e9).toFixed(1)}B` : dv >= 1e6 ? `$${(dv/1e6).toFixed(0)}M` : dv >= 1e3 ? `$${(dv/1e3).toFixed(0)}K` : `$${dv.toFixed(0)}`) : null;
                        return (
                        <td style={{ padding: "3px 4px", textAlign: "right", fontSize: 9, fontFamily: "monospace",
                          color: (s.avg_dollar_vol_raw || dv || 0) > 20000000 ? "#2bb886" : (s.avg_dollar_vol_raw || dv || 0) > 10000000 ? "#fbbf24" : (s.avg_dollar_vol_raw || dv || 0) > 5000000 ? "#f97316" : "#f87171" }}
                          title={s.dvol_accel != null ? `$Vol Accel: ${s.dvol_accel > 0 ? '+' : ''}${s.dvol_accel} | 5d/20d: ${s.dvol_ratio_5_20}x | WoW: ${s.dvol_wow_chg > 0 ? '+' : ''}${s.dvol_wow_chg}%` : ""}>
                          {dvFmt || '—'}
                          {s.dvol_accel != null && <span style={{ fontSize: 7, marginLeft: 1,
                            color: s.dvol_accel >= 30 ? "#2bb886" : s.dvol_accel >= 10 ? "#4a9070" : s.dvol_accel <= -30 ? "#f87171" : s.dvol_accel <= -10 ? "#c06060" : "#505060" }}>
                            {s.dvol_accel >= 30 ? "▲▲" : s.dvol_accel >= 10 ? "▲" : s.dvol_accel <= -30 ? "▼▼" : s.dvol_accel <= -10 ? "▼" : "─"}</span>}
                        </td>);
                      })()}
                      {/* Chg% — stockMap first, then mover data */}
                      {(() => {
                        const chgVal = s.change_pct ?? row._chg ?? null;
                        return (
                        <td style={{ padding: "3px 2px", textAlign: "right", fontSize: 10, fontFamily: "monospace",
                          color: chgColor(chgVal) }}>
                          {chgVal != null ? `${chgVal > 0 ? "+" : ""}${chgVal.toFixed(1)}%` : "—"}
                        </td>);
                      })()}
                      {/* VolX */}
                      <td style={{ padding: "3px 4px", textAlign: "right", fontSize: 10, fontFamily: "monospace",
                        color: (row.vol_ratio ?? row._rvol ?? -1) >= 8 ? "#c084fc" : (row.vol_ratio ?? row._rvol ?? -1) >= 4 ? "#a78bfa" : "#686878" }}>
                        {displayVol}
                      </td>
                      {/* Subtheme */}
                      <td style={{ padding: "3px 4px", textAlign: "left", fontSize: 9, color: "#505060",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={s.themes?.[0]?.subtheme}>
                        {s.themes?.[0]?.subtheme || "—"}
                      </td>
                      {/* FrHi% */}
                      <td style={{ padding: "3px 4px", textAlign: "right", fontSize: 10, fontFamily: "monospace",
                        color: (s.pct_from_high ?? -999) >= -5 ? "#2bb886" : (s.pct_from_high ?? -999) >= -15 ? "#686878" : "#4a4a5a" }}>
                        {s.pct_from_high != null ? `${s.pct_from_high.toFixed(0)}%` : "—"}
                      </td>
                      {/* Days */}
                      <td style={{ padding: "3px 4px", textAlign: "right", fontSize: 10, fontFamily: "monospace",
                        color: (row.days_ago ?? 999) <= 1 ? "#2bb886" : (row.days_ago ?? 999) <= 5 ? "#a8a8b8" : "#4a4a5a" }}>
                        {row.days_ago != null ? `${row.days_ago}d` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 16, textAlign: "center", color: "#4a4a5a", fontSize: 11 }}>
            No catalysts matching filters
          </div>
        )}
      </div>

      {/* ── PM EARNINGS MOVERS ── */}
      {pmEarningsMovers && pmEarningsMovers.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div onClick={() => setPmCollapsed(p => !p)}
            style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px",
              background: "#1a1a28", borderRadius: 4, cursor: "pointer", userSelect: "none",
              borderLeft: "3px solid #60a5fa" }}>
            <span style={{ fontSize: 9, color: "#60a5fa", fontWeight: 700 }}>{pmCollapsed ? "▶" : "▼"}</span>
            <span style={{ fontSize: 11, color: "#60a5fa", fontWeight: 600 }}>Pre-Market Earnings Movers</span>
            <span style={{ fontSize: 9, color: "#4a4a5a" }}>({pmEarningsMovers.length})</span>
          </div>
          {!pmCollapsed && (
            <div style={{ overflowX: "auto", maxHeight: 320 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #2a2a3a" }}>
                    {[
                      { key: "ticker", label: "Ticker", align: "left" },
                      { key: "name", label: "Name", align: "left" },
                      { key: "volume", label: "Volume", align: "right" },
                      { key: "change", label: "Chg%", align: "right" },
                      { key: "price", label: "Price", align: "right" },
                      { key: "headline", label: "Headline", align: "left" },
                    ].map(h => (
                      <th key={h.key} onClick={(e) => { e.stopPropagation(); setPmSort(prev => ({ col: h.key, dir: prev.col === h.key && prev.dir === "desc" ? "asc" : "desc" })); }}
                        style={{ padding: "4px 6px", textAlign: h.align, color: pmSort.col === h.key ? "#a8a8b8" : "#505060", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                        {h.label}{pmSort.col === h.key ? (pmSort.dir === "desc" ? " ▾" : " ▴") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedPmMovers.map((m, i) => {
                    const chg = m.change_pct ?? m.ext_hours_change_pct;
                    return (
                      <tr key={m.ticker + i} onClick={() => onTickerClick(m.ticker)}
                        style={{ cursor: "pointer", borderBottom: "1px solid #1a1a28",
                          background: activeTicker === m.ticker ? "#2a2a3a" : i % 2 === 0 ? "#0d0d14" : "transparent" }}>
                        <td style={{ padding: "3px 6px", fontWeight: 600, color: m.in_universe ? "#a8a8b8" : "#686878" }}>
                          {m.grade && <span style={{ fontSize: 8, color: gradeColor(m.grade), marginRight: 3 }}>{m.grade}</span>}
                          {m.ticker}
                        </td>
                        <td style={{ padding: "3px 6px", color: "#505060", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.name || "—"}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "monospace", color: "#686878" }}>
                          {fmtVol(m.volume)}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "monospace",
                          color: chg > 0 ? "#2bb886" : chg < 0 ? "#f87171" : "#686878" }}>
                          {chg != null ? `${chg > 0 ? "+" : ""}${chg.toFixed(1)}%` : "—"}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "monospace", color: "#a8a8b8" }}>
                          {m.price != null ? `$${m.price.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "3px 6px", color: "#606070", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9 }}>
                          {m.headlines && m.headlines.length > 0 ? m.headlines[0] : "—"}
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

      {/* ── AH EARNINGS MOVERS ── */}
      {ahEarningsMovers && ahEarningsMovers.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div onClick={() => setAhCollapsed(p => !p)}
            style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px",
              background: "#1a1a28", borderRadius: 4, cursor: "pointer", userSelect: "none",
              borderLeft: "3px solid #c084fc" }}>
            <span style={{ fontSize: 9, color: "#c084fc", fontWeight: 700 }}>{ahCollapsed ? "▶" : "▼"}</span>
            <span style={{ fontSize: 11, color: "#c084fc", fontWeight: 600 }}>After-Hours Earnings Movers</span>
            <span style={{ fontSize: 9, color: "#4a4a5a" }}>({ahEarningsMovers.length})</span>
          </div>
          {!ahCollapsed && (
            <div style={{ overflowX: "auto", maxHeight: 320 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #2a2a3a" }}>
                    {[
                      { key: "ticker", label: "Ticker", align: "left" },
                      { key: "name", label: "Name", align: "left" },
                      { key: "volume", label: "Volume", align: "right" },
                      { key: "change", label: "Chg%", align: "right" },
                      { key: "price", label: "Price", align: "right" },
                      { key: "headline", label: "Headline", align: "left" },
                    ].map(h => (
                      <th key={h.key} onClick={(e) => { e.stopPropagation(); setAhSort(prev => ({ col: h.key, dir: prev.col === h.key && prev.dir === "desc" ? "asc" : "desc" })); }}
                        style={{ padding: "4px 6px", textAlign: h.align, color: ahSort.col === h.key ? "#a8a8b8" : "#505060", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                        {h.label}{ahSort.col === h.key ? (ahSort.dir === "desc" ? " ▾" : " ▴") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedAhMovers.map((m, i) => {
                    const chg = m.change_pct ?? m.ext_hours_change_pct;
                    return (
                      <tr key={m.ticker + i} onClick={() => onTickerClick(m.ticker)}
                        style={{ cursor: "pointer", borderBottom: "1px solid #1a1a28",
                          background: activeTicker === m.ticker ? "#2a2a3a" : i % 2 === 0 ? "#0d0d14" : "transparent" }}>
                        <td style={{ padding: "3px 6px", fontWeight: 600, color: m.in_universe ? "#a8a8b8" : "#686878" }}>
                          {m.grade && <span style={{ fontSize: 8, color: gradeColor(m.grade), marginRight: 3 }}>{m.grade}</span>}
                          {m.ticker}
                        </td>
                        <td style={{ padding: "3px 6px", color: "#505060", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.name || "—"}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "monospace", color: "#686878" }}>
                          {fmtVol(m.volume)}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "monospace",
                          color: chg > 0 ? "#2bb886" : chg < 0 ? "#f87171" : "#686878" }}>
                          {chg != null ? `${chg > 0 ? "+" : ""}${chg.toFixed(1)}%` : "—"}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "monospace", color: "#a8a8b8" }}>
                          {m.price != null ? `$${m.price.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "3px 6px", color: "#606070", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9 }}>
                          {m.headlines && m.headlines.length > 0 ? m.headlines[0] : "—"}
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

      {/* ── HISTORICAL EARNINGS WINNERS (last 5 days) ── */}
      {(historicalEarningsMovers && historicalEarningsMovers.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          {/* Filter Bar */}
          <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span onClick={() => setHistCollapsed(p => !p)}
              style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
              {histCollapsed ? "▶" : "▼"} Historical Earnings Winners ({sortedHistMovers.length})
            </span>

            {/* Source toggles */}
            <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
              {["all", "er", "sip"].map(src => {
                const label = src === "all" ? "All" : src === "er" ? "ER" : "SIP";
                const isActive = sourceFilter === src;
                return (
                  <button key={src} onClick={() => setSourceFilter(src)}
                    style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                      border: isActive ? `1px solid ${getTypeColor(src)}` : "1px solid #3a3a4a",
                      background: isActive ? getTypeBg(src) : "transparent",
                      color: isActive ? getTypeColor(src) : "#787888" }}>
                    {label}
                  </button>
                );
              })}
            </div>

            {/* RS slider */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
              <span style={{ fontSize: 10, color: minRS > 0 ? "#4aad8c" : "#686878", fontWeight: 600, whiteSpace: "nowrap" }}>RS≥{minRS}</span>
              <input type="range" min={0} max={95} step={5} value={minRS} onChange={e => setMinRS(Number(e.target.value))}
                style={{ width: 60, height: 4, accentColor: "#0d9163", cursor: "pointer" }} />
            </div>

            {/* $Vol slider */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 10, color: minDvol > 0 ? "#fbbf24" : "#686878", fontWeight: 600, whiteSpace: "nowrap" }}>$Vol≥{minDvol}M</span>
              <input type="range" min={0} max={100} step={5} value={minDvol} onChange={e => setMinDvol(Number(e.target.value))}
                style={{ width: 60, height: 4, accentColor: "#fbbf24", cursor: "pointer" }} />
            </div>

            {/* Bio/REIT filter */}
            <button onClick={() => setNoBio(prev => !prev)}
              style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                border: noBio ? "1px solid #f97316" : "1px solid #3a3a4a",
                background: noBio ? "#f9731618" : "transparent",
                color: noBio ? "#f97316" : "#787888" }}>
              {noBio ? "⊘ Bio/REIT" : "○ Bio/REIT"}
            </button>

            {/* ER filters */}
            {(sourceFilter === "all" || sourceFilter === "er") && (
              <>
                <button onClick={() => setErUniverseOnly(prev => !prev)}
                  style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                    border: erUniverseOnly ? "1px solid #fbbf24" : "1px solid #3a3a4a",
                    background: erUniverseOnly ? "#fbbf2418" : "transparent",
                    color: erUniverseOnly ? "#fbbf24" : "#787888" }}>
                  {"★ Theme Only"}
                </button>
                <button onClick={() => setEr9M(prev => !prev)}
                  style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                    border: er9M ? "1px solid #e879f9" : "1px solid #3a3a4a",
                    background: er9M ? "#e879f918" : "transparent",
                    color: er9M ? "#e879f9" : "#787888" }}
                  title="Today vol≥8.9M but avg vol<8.9M (unusual activity)">
                  9M
                </button>
                <button onClick={() => setErBeatFilter(p => p === "beat" ? null : "beat")}
                  style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                    border: erBeatFilter === "beat" ? "1px solid #2bb886" : "1px solid #3a3a4a",
                    background: erBeatFilter === "beat" ? "#2bb88618" : "transparent",
                    color: erBeatFilter === "beat" ? "#2bb886" : "#787888" }}>
                  Beat
                </button>
                <button onClick={() => setErBeatFilter(p => p === "miss" ? null : "miss")}
                  style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                    border: erBeatFilter === "miss" ? "1px solid #f87171" : "1px solid #3a3a4a",
                    background: erBeatFilter === "miss" ? "#f8717118" : "transparent",
                    color: erBeatFilter === "miss" ? "#f87171" : "#787888" }}>
                  Miss
                </button>
              </>
            )}
          </div>

          {!histCollapsed && sortedHistMovers.length > 0 && (
            <div style={{ overflowX: "auto", maxHeight: 400 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #2a2a3a" }}>
                    {[
                      { key: "ticker", label: "Ticker", align: "left" },
                      { key: "name", label: "Name", align: "left" },
                      { key: "volume", label: "Volume", align: "right" },
                      { key: "change", label: "Chg%", align: "right" },
                      { key: "rvol", label: "RVol", align: "right" },
                      { key: "days", label: "Days", align: "center" },
                      { key: "session", label: "Session", align: "center" },
                      { key: "headline", label: "Headline", align: "left" },
                    ].map(h => (
                      <th key={h.key} onClick={(e) => { e.stopPropagation(); setHistSort(prev => ({ col: h.key, dir: prev.col === h.key && prev.dir === "desc" ? "asc" : "desc" })); }}
                        style={{ padding: "4px 6px", textAlign: h.align, color: histSort.col === h.key ? "#a8a8b8" : "#505060", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                        {h.label}{histSort.col === h.key ? (histSort.dir === "desc" ? " ▾" : " ▴") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedHistMovers.map((m, i) => {
                    const chg = m.change_pct;
                    const daysAgo = m.days_ago ?? 1;
                    const sess = m._session || m.er?.timing || "";
                    const rvol = m.volume && m.avg_volume ? (m.volume / m.avg_volume) : (stockMap[m.ticker]?.rel_volume ?? null);
                    return (
                      <tr key={m.ticker + "_hist_" + i} onClick={() => onTickerClick(m.ticker)}
                        style={{ cursor: "pointer", borderBottom: "1px solid #1a1a28",
                          background: activeTicker === m.ticker ? "#2a2a3a" : i % 2 === 0 ? "#0d0d14" : "transparent" }}>
                        <td style={{ padding: "3px 6px", fontWeight: 600, color: m.in_universe ? "#a8a8b8" : "#686878" }}>
                          {m.grade && <span style={{ fontSize: 8, color: gradeColor(m.grade), marginRight: 3 }}>{m.grade}</span>}
                          {m.ticker}
                        </td>
                        <td style={{ padding: "3px 6px", color: "#505060", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.company || "—"}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "monospace", color: "#686878" }}>
                          {fmtVol(m.volume)}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "monospace",
                          color: chg > 0 ? "#2bb886" : chg < 0 ? "#f87171" : "#686878" }}>
                          {chg != null ? `${chg > 0 ? "+" : ""}${chg.toFixed(1)}%` : "—"}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontFamily: "monospace",
                          color: rvol != null ? (rvol >= 3 ? "#f59e0b" : rvol >= 1.5 ? "#2bb886" : "#686878") : "#3a3a4a" }}>
                          {rvol != null ? `${rvol.toFixed(1)}x` : "—"}
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "center", fontFamily: "monospace",
                          color: daysAgo <= 1 ? "#2bb886" : daysAgo <= 3 ? "#a8a8b8" : "#686878" }}>
                          {daysAgo}d
                        </td>
                        <td style={{ padding: "3px 6px", textAlign: "center" }}>
                          <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, fontWeight: 600,
                            background: sess === "PM" ? "rgba(96,165,250,0.15)" : sess === "AH" ? "rgba(192,132,252,0.15)" : "rgba(100,100,120,0.1)",
                            color: sess === "PM" ? "#60a5fa" : sess === "AH" ? "#c084fc" : "#686878" }}>
                            {sess || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "3px 6px", color: "#606070", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9 }}>
                          {m.recent_headlines && m.recent_headlines.length > 0 ? m.recent_headlines[0] : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!histCollapsed && sortedHistMovers.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", color: "#4a4a5a", fontSize: 11 }}>
              No historical movers matching filters
            </div>
          )}
        </div>
      )}

      {/* ── UPCOMING EARNINGS CALENDAR ── */}
      {earningsCalendar.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#a8a8b8", fontWeight: 600 }}>Upcoming Earnings Calendar</span>
          </div>
          {earningsCalendar.map(week => (
            <div key={week.weekKey} style={{ marginBottom: 12 }}>
              <div onClick={() => toggleWeek(week.weekKey)}
                style={{ padding: "4px 8px", background: week.isPast ? "#1a1a1f" : week.isCurrent ? "#202028" : "#0d0d14",
                  borderRadius: 4, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 600, color: "#a8a8b8" }}>
                  {week.isCurrent ? "▼" : collapsedWeeks.has(week.weekKey) ? "▶" : "▼"}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: week.isCurrent ? "#fbbf24" : "#a8a8b8" }}>
                  {week.weekKey}
                </span>
                {week.isPast && <span style={{ fontSize: 8, color: "#4a4a5a" }}>PAST</span>}
              </div>
              {!collapsedWeeks.has(week.days[0]?.dateKey) && (
                <div style={{ paddingLeft: 16, paddingTop: 4 }}>
                  {week.days.map(day => (
                    <div key={day.dateKey} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: day.days < 0 ? "#4a4a5a" : day.days === 0 ? "#fbbf24" : "#a8a8b8", marginBottom: 4 }}>
                        {day.dayLabel} ({day.days > 0 ? `+${day.days}d` : day.days === 0 ? "Today" : `${day.days}d`})
                      </div>
                      <div style={{ paddingLeft: 8 }}>
                        {day.items.map((s, idx) => (
                          <div key={idx} style={{ fontSize: 9, color: "#686878", padding: "2px 0", cursor: "pointer" }}
                            onClick={() => onTickerClick(s.ticker)}>
                            <span style={{ fontWeight: 600, color: "#a8a8b8" }}>
                              {s.ticker}
                            </span>
                            {" "}
                            <span style={{ color: "#4a4a5a" }}>{s.company || "—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── INDEX CHART (SPY/QQQ/IWM/DIA with MA status) ──

function Grid({ stocks, onTickerClick, activeTicker, onVisibleTickers }) {
  const [showLegend, setShowLegend] = useState(false);
  const [filterOn, setFilterOn] = useState(true);
  const [activeBox, setActiveBox] = useState(null); // track which box was last clicked
  const grades = ["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-","E+","E","E-","F+","F","F-","G+","G"];

  // Filter out excluded industries
  const EXCLUDED_INDUSTRIES = new Set([
    "Biotechnology", "Investment Brokerage - National", "Investment Brokerage - Regional",
    "Investment Banks/Brokers", "Investment Banks and Brokerages",
    "Investment Management", "Investment Managers",
    "Closed-End Fund - Equity", "Closed-End Fund - Debt", "Closed-End Fund - Foreign",
    "Investment Trusts/Mutual Funds",
    "Drug Manufacturers - General", "Drug Manufacturers - Specialty & Generic",
    "Pharmaceutical Retailers", "Pharmaceuticals: Generic", "Pharmaceuticals: Major", "Pharmaceuticals: Other",
    "REIT - Diversified", "REIT - Healthcare Facilities", "REIT - Hotel & Motel",
    "REIT - Industrial", "REIT - Mortgage", "REIT - Office", "REIT - Residential",
    "REIT - Retail", "REIT - Specialty", "Real Estate Investment Trusts",
  ]);
  const filteredStocks = useMemo(() => {
    if (!filterOn) return stocks;
    return stocks.filter(s => {
      const ind = (s.industry || "").trim();
      if (!ind) return true;
      for (const ex of EXCLUDED_INDUSTRIES) {
        if (ind.toLowerCase() === ex.toLowerCase()) return false;
      }
      return true;
    });
  }, [stocks, filterOn]);

  const groups = useMemo(() => {
    const g = {}; grades.forEach(gr => { g[gr] = filteredStocks.filter(s => s.grade === gr).sort((a, b) => b.rts_score - a.rts_score); }); return g;
  }, [filteredStocks]);

  // 20% 1W screener: Price > $5, 1W return > 20%, Avg Vol > 100K
  const weekMovers = useMemo(() => {
    return filteredStocks.filter(s =>
      s.price >= 5 &&
      s.return_1w > 20 &&
      s.avg_volume_raw >= 100000
    ).sort((a, b) => (b.return_1w || 0) - (a.return_1w || 0));
  }, [filteredStocks]);

  // 20% 1M screener: Price > $5, 1M return > 20%, Avg Vol > 100K
  const monthMovers = useMemo(() => {
    return filteredStocks.filter(s =>
      s.price >= 5 &&
      s.return_1m > 20 &&
      s.avg_volume_raw >= 100000
    ).sort((a, b) => (b.return_1m || 0) - (a.return_1m || 0));
  }, [filteredStocks]);

  // Strongest Stocks: two scans combined (matching TradingView screeners)
  // TV uses SMA(10), we use SMA(20) as proxy — SMA20 is slower so we widen ranges
  // SMA10 0-10% ≈ SMA20 -2 to 18% | SMA10 0-3% ≈ SMA20 -2 to 12%
  const strongestStocks = useMemo(() => {
    const seen = new Set();
    const results = [];
    // Scan 1: Small/Mid (<10B)
    filteredStocks.forEach(s => {
      const mcap = s.market_cap_raw || 0;
      if (mcap < 300e6 || mcap > 10e9) return;
      if ((s.above_52w_low || 0) < 70) return;
      if ((s.eps_yoy ?? s.eps_qq ?? -1) < 25) return;
      if ((s.sales_yoy ?? s.sales_qq ?? -1) < 25) return;
      if ((s.avg_volume_raw || 0) < 500000) return;
      if (s.shares_float_raw != null && s.shares_float_raw > 50e6) return;
      if (s.sma20_pct != null && (s.sma20_pct < -2 || s.sma20_pct > 18)) return;
      if ((s.adr_pct ?? 0) < 3) return;
      if (s.sma50_pct != null && s.sma50_pct < -3) return;
      if (!seen.has(s.ticker)) { seen.add(s.ticker); results.push({ ...s, _scanSource: "S" }); }
    });
    // Scan 2: Large (10B+)
    filteredStocks.forEach(s => {
      const mcap = s.market_cap_raw || 0;
      if (mcap < 10e9) return;
      if ((s.above_52w_low || 0) < 70) return;
      if ((s.eps_yoy ?? s.eps_qq ?? -1) < 25) return;
      if ((s.sales_yoy ?? s.sales_qq ?? -1) < 25) return;
      if ((s.avg_volume_raw || 0) < 500000) return;
      if (s.shares_float_raw != null && s.shares_float_raw > 150e6) return;
      if (s.sma20_pct != null && (s.sma20_pct < -2 || s.sma20_pct > 12)) return;
      if ((s.adr_pct ?? 0) < 2) return;
      if (s.sma50_pct != null && s.sma50_pct < -3) return;
      if (!seen.has(s.ticker)) { seen.add(s.ticker); results.push({ ...s, _scanSource: "L" }); }
    });
    results.sort((a, b) => (b.rs_rank || 0) - (a.rs_rank || 0));
    return results;
  }, [filteredStocks]);

  // Momentum: 8 scans combined (1W/1M/3M/6M × <10B/10B+) — matching Finviz screeners
  const momentumStocks = useMemo(() => {
    const seen = new Set();
    const results = [];
    // Common base filters for <10B scans
    // Above Low 52W ≥50%, Mcap 300M-10B, AvgVol60D >300K, Float ≤50M, SMA10(≈SMA20) 0-20%
    const baseSmall = (s) => {
      const mcap = s.market_cap_raw || 0;
      return mcap >= 300e6 && mcap <= 10e9 && (s.avg_volume_raw || 0) >= 300000 &&
        (s.above_52w_low || 0) >= 50 && (s.shares_float_raw == null || s.shares_float_raw <= 50e6) &&
        s.sma20_pct != null && s.sma20_pct >= 0 && s.sma20_pct <= 20;
    };
    // Common base filters for 10B+ scans
    // Above Low 52W ≥50%, Mcap ≥10B, AvgVol60D >300K, Float ≤150M, SMA10(≈SMA20) 0-10%
    const baseLarge = (s) => {
      const mcap = s.market_cap_raw || 0;
      return mcap >= 10e9 && (s.avg_volume_raw || 0) >= 300000 &&
        (s.above_52w_low || 0) >= 50 && (s.shares_float_raw == null || s.shares_float_raw <= 150e6) &&
        s.sma20_pct != null && s.sma20_pct >= 0 && s.sma20_pct <= 10;
    };
    const add = (s, tag) => { if (!seen.has(s.ticker)) { seen.add(s.ticker); results.push({ ...s, _momTag: tag }); } };
    filteredStocks.forEach(s => {
      // 1W +20% <10B — no volatility filter
      if (baseSmall(s) && (s.return_1w || 0) >= 20) add(s, "1W·S");
      // 1W +20% 10B+ — no volatility filter
      if (baseLarge(s) && (s.return_1w || 0) >= 20) add(s, "1W·L");
      // 1M +30% <10B — no volatility filter
      if (baseSmall(s) && (s.return_1m || 0) >= 30) add(s, "1M·S");
      // 1M +30% 10B+ — no volatility filter
      if (baseLarge(s) && (s.return_1m || 0) >= 30) add(s, "1M·L");
      // 3M +70% <10B — above_52w ≥100%, Volatility 1M >3% (≈ADR >3%)
      if (baseSmall(s) && (s.above_52w_low || 0) >= 100 && (s.return_3m || 0) >= 70 && (s.adr_pct ?? 0) >= 3) add(s, "3M·S");
      // 3M +70% 10B+ — above_52w ≥100%, Volatility 1M >3% (≈ADR >3%)
      if (baseLarge(s) && (s.above_52w_low || 0) >= 100 && (s.return_3m || 0) >= 70 && (s.adr_pct ?? 0) >= 3) add(s, "3M·L");
      // 6M +100% <10B — above_52w ≥100%, Volatility 1M >3% (≈ADR >3%)
      if (baseSmall(s) && (s.above_52w_low || 0) >= 100 && (s.return_6m || 0) >= 100 && (s.adr_pct ?? 0) >= 3) add(s, "6M·S");
      // 6M +100% 10B+ — above_52w ≥100%, Volatility 1M >3% (≈ADR >3%)
      if (baseLarge(s) && (s.above_52w_low || 0) >= 100 && (s.return_6m || 0) >= 100 && (s.adr_pct ?? 0) >= 3) add(s, "6M·L");
    });
    results.sort((a, b) => (b.rs_rank || 0) - (a.rs_rank || 0));
    return results;
  }, [filteredStocks]);

  // Combo: tickers appearing in 2+ screener groups
  const comboStocks = useMemo(() => {
    const counts = {};
    const sources = {};
    const addGroup = (list, label) => {
      list.forEach(s => {
        counts[s.ticker] = (counts[s.ticker] || 0) + 1;
        if (!sources[s.ticker]) sources[s.ticker] = [];
        sources[s.ticker].push(label);
      });
    };
    addGroup(weekMovers, "1W");
    addGroup(monthMovers, "1M");
    addGroup(strongestStocks, "Strong");
    addGroup(momentumStocks, "Mom");
    const multi = Object.entries(counts).filter(([, c]) => c >= 2).map(([tk]) => tk);
    const sMap = {};
    [...weekMovers, ...monthMovers, ...strongestStocks, ...momentumStocks].forEach(s => {
      if (!sMap[s.ticker]) sMap[s.ticker] = s;
    });
    return multi.map(tk => ({ ...sMap[tk], _comboSources: sources[tk], _comboCount: counts[tk] }))
      .sort((a, b) => (b._comboCount - a._comboCount) || ((b.rs_rank || 0) - (a.rs_rank || 0)));
  }, [weekMovers, monthMovers, strongestStocks, momentumStocks]);

  // Build box-grouped ticker lists for keyboard navigation
  const boxLists = useMemo(() => ({
    rts: grades.flatMap(gr => groups[gr].slice(0, 60).map(s => s.ticker)),
    combo: comboStocks.map(s => s.ticker),
    w1: weekMovers.map(s => s.ticker),
    m1: monthMovers.map(s => s.ticker),
    strong: strongestStocks.map(s => s.ticker),
    mom: momentumStocks.map(s => s.ticker),
  }), [groups, comboStocks, weekMovers, monthMovers, strongestStocks, momentumStocks]);

  const boxListsRef = useRef(boxLists);
  boxListsRef.current = boxLists;

  // Report visible ticker order to parent based on which box was clicked
  useEffect(() => {
    if (!onVisibleTickers) return;
    const bl = boxListsRef.current;
    if (activeBox && bl[activeBox] && bl[activeBox].length > 0) {
      onVisibleTickers(bl[activeBox]);
    } else {
      onVisibleTickers(bl.combo && bl.combo.length > 0 ? bl.combo : bl.rts);
    }
  }, [activeBox, onVisibleTickers]);

  // Helper: click ticker in a specific box
  const clickInBox = useCallback((ticker, box) => {
    setActiveBox(prev => {
      // Force effect to re-fire even if same box by toggling
      if (prev === box) {
        // Same box - still need to update visibleTickers
        setTimeout(() => onVisibleTickers(boxListsRef.current[box] || []), 0);
      }
      return box;
    });
    onTickerClick(ticker);
  }, [onTickerClick, onVisibleTickers]);

  // Auto-open first combo ticker (or first A+ stock) on mount
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !onTickerClick) return;
    const first = comboStocks[0]?.ticker || groups["A+"]?.[0]?.ticker;
    if (first) {
      autoOpened.current = true;
      onTickerClick(first);
    }
  }, [comboStocks, groups]);
  return (
    <div style={{ overflowX: "auto" }}>
      {/* Filter toggle */}
      <div onClick={() => setFilterOn(p => !p)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", marginBottom: 6, fontSize: 10,
          cursor: "pointer", userSelect: "none",
          color: filterOn ? "#686878" : "#505060" }}>
        <span style={{ color: filterOn ? "#f97316" : "#3a3a4a", fontWeight: 700 }}>{filterOn ? "⊘ FILTERED" : "○ UNFILTERED"}</span>
        <span style={{ color: filterOn ? "#686878" : "#3a3a4a" }}>Biotech, Pharma, REITs, Investment Banks/Mgrs/Trusts</span>
        <span style={{ color: "#505060" }}>({stocks.length - filteredStocks.length} removed · {filteredStocks.length} shown)</span>
      </div>
      {/* Legend */}
      <div onClick={() => setShowLegend(p => !p)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", marginBottom: showLegend ? 0 : 10, background: "#1a1a24",
          borderRadius: showLegend ? "6px 6px 0 0" : 6, fontSize: 11, color: "#787888", cursor: "pointer", userSelect: "none" }}>
        <span style={{ fontSize: 11 }}>{showLegend ? "▾" : "▸"}</span>
        <span style={{ fontWeight: 700, fontSize: 10 }}>LEGEND</span>
      </div>
      {showLegend && (
      <div style={{ display: "flex", gap: 16, marginBottom: 10, padding: "8px 12px", background: "#1a1a24", borderRadius: "0 0 6px 6px", fontSize: 10, flexWrap: "wrap", alignItems: "flex-start", marginTop: -1 }}>
        {/* Grade columns */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ color: "#9090a0", fontWeight: 700 }}>RTS GRADE COLUMNS</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#1B7A2B" }} /> <span style={{ color: "#b0b0be" }}>A+ to A-</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#5CB85C" }} /> <span style={{ color: "#b0b0be" }}>B+ to B-</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#CCF2CC" }} /> <span style={{ color: "#b0b0be" }}>C range</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#e5e5e5" }} /> <span style={{ color: "#b0b0be" }}>D range</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#FF5050" }} /> <span style={{ color: "#b0b0be" }}>E to G</span></span>
        </div>
        {/* Ticker text — applies to all sections */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ color: "#9090a0", fontWeight: 700 }}>TICKER TEXT (all sections)</span>
          <span><span style={{ color: "#f87171", fontWeight: 700, fontFamily: "monospace" }}>Red bold</span><span style={{ color: "#b0b0be" }}> — ATR/50 ≥ 7x (very extended)</span></span>
          <span><span style={{ color: "#c084fc", fontWeight: 700, fontFamily: "monospace" }}>Purple bold</span><span style={{ color: "#b0b0be" }}> — ATR/50 ≥ 5x (extended)</span></span>
          <span><span style={{ color: "#bbb", fontFamily: "monospace" }}>Default</span><span style={{ color: "#b0b0be" }}> — Not extended</span></span>
        </div>
        {/* Screener headers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ color: "#9090a0", fontWeight: 700 }}>SCREENER HEADERS</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#c084fc" }} /> <span style={{ color: "#b0b0be" }}>20% 1W — Weekly +20%</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#60a5fa" }} /> <span style={{ color: "#b0b0be" }}>20% 1M — Monthly +20%</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#2bb886" }} /> <span style={{ color: "#b0b0be" }}>Strongest — EPS+Sales growth, tight base</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#f97316" }} /> <span style={{ color: "#b0b0be" }}>Momentum — 1W/1M/3M/6M multi-cap</span></span>
        </div>
        {/* Combo */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ color: "#9090a0", fontWeight: 700 }}>COMBO</span>
          <span style={{ color: "#b0b0be" }}>Tickers in 2+ screeners</span>
          <span><span style={{ color: "#fbbf24", fontFamily: "monospace", fontSize: 9 }}>superscript</span><span style={{ color: "#b0b0be" }}> — screener hit count</span></span>
        </div>
      </div>)}
      {/* Combo — tickers in 2+ screener groups */}
      {comboStocks.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24" }}>Combo</span>
            <span style={{ fontSize: 10, color: "#686878" }}>In 2+ screeners</span>
            <span style={{ fontSize: 10, color: "#505060" }}>{comboStocks.length} stocks</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {comboStocks.map(s => {
              const gc = GRADE_COLORS[s.grade] || "#3a3a4a";
              const isActive = s.ticker === activeTicker;
              return (
                <div key={s.ticker} data-ticker={s.ticker} onClick={() => clickInBox(s.ticker, "combo")}
                  title={`${s.company} | RS:${s.rs_rank} | In: ${s._comboSources.join(", ")} | Grade:${s.grade}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px", borderRadius: 4,
                    fontSize: 11, fontFamily: "monospace", cursor: "pointer",
                    background: isActive ? "#fbbf2430" : gc + "20",
                    border: isActive ? "1px solid #fbbf24" : `1px solid ${s._comboCount >= 3 ? "#fbbf24" : gc}40`,
                    color: s.atr_to_50 >= 7 ? "#f87171" : s.atr_to_50 >= 5 ? "#c084fc" : isActive ? "#fff" : "#bbb",
                    fontWeight: s.atr_to_50 >= 5 || isActive ? 700 : 400 }}>
                  <Badge grade={s.grade} />
                  {s.ticker}
                  <sup style={{ fontSize: 7, color: "#fbbf24", marginLeft: 1 }}>{s._comboCount}</sup>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Screeners */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#c084fc" }}>Screeners</span>
          <span style={{ fontSize: 10, color: "#686878" }}>Price &gt; $5 · Vol &gt; 100K</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          {/* 20% 1W */}
          <div style={{ width: 64, flexShrink: 0 }}>
            <div style={{ background: "#c084fc", color: "#fff", textAlign: "center", padding: "4px 0", borderRadius: "4px 4px 0 0", fontSize: 10, fontWeight: 700 }}>
              20%1W<br/><span style={{ fontWeight: 400, opacity: 0.7, fontSize: 11 }}>{weekMovers.length}</span></div>
            <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
              {weekMovers.map(s => {
                const isActive = s.ticker === activeTicker;
                return (
                <div key={s.ticker} data-ticker={s.ticker} title={`${s.company} | 1W:${s.return_1w != null ? s.return_1w.toFixed(1) : '—'}% | RS:${s.rs_rank} | $${s.price}`}
                  onClick={() => clickInBox(s.ticker, "w1")}
                  style={{ textAlign: "center", fontSize: 11, padding: "2px 0", fontFamily: "monospace",
                    background: isActive ? "#fbbf2430" : "#c084fc25",
                    color: s.atr_to_50 >= 7 ? "#f87171" : s.atr_to_50 >= 5 ? "#c084fc" : isActive ? "#fff" : "#bbb",
                    fontWeight: s.atr_to_50 >= 5 || isActive ? 700 : 400, cursor: "pointer",
                    outline: isActive ? "1px solid #fbbf24" : "none" }}>{s.ticker}</div>
                );
              })}
            </div>
          </div>
          {/* 20% 1M — wraps horizontally to match RTS grid height */}
          <div>
            <div style={{ background: "#60a5fa", color: "#fff", textAlign: "center", padding: "4px 8px", borderRadius: "4px 4px 0 0", fontSize: 10, fontWeight: 700 }}>
              20% 1M <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 11 }}>({monthMovers.length})</span></div>
            <div style={{ display: "flex", flexWrap: "wrap", flexDirection: "column", maxHeight: "55vh", gap: 0, alignContent: "flex-start" }}>
              {monthMovers.map(s => {
                const isActive = s.ticker === activeTicker;
                return (
                <div key={s.ticker} data-ticker={s.ticker} title={`${s.company} | 1M:${s.return_1m != null ? s.return_1m.toFixed(1) : '—'}% | RS:${s.rs_rank} | $${s.price}`}
                  onClick={() => clickInBox(s.ticker, "m1")}
                  style={{ textAlign: "center", fontSize: 11, padding: "2px 4px", fontFamily: "monospace", width: 56,
                    background: isActive ? "#fbbf2430" : "#60a5fa25",
                    color: s.atr_to_50 >= 7 ? "#f87171" : s.atr_to_50 >= 5 ? "#c084fc" : isActive ? "#fff" : "#bbb",
                    fontWeight: s.atr_to_50 >= 5 || isActive ? 700 : 400, cursor: "pointer",
                    outline: isActive ? "1px solid #fbbf24" : "none" }}>{s.ticker}</div>
                );
              })}
            </div>
          </div>
          {/* Strongest Stocks */}
          <div>
            <div style={{ background: "#2bb886", color: "#fff", textAlign: "center", padding: "4px 8px", borderRadius: "4px 4px 0 0", fontSize: 10, fontWeight: 700 }}>
              Strongest <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 11 }}>({strongestStocks.length})</span></div>
            <div style={{ display: "flex", flexWrap: "wrap", flexDirection: "column", maxHeight: "55vh", gap: 0, alignContent: "flex-start" }}>
              {strongestStocks.map(s => {
                const isActive = s.ticker === activeTicker;
                return (
                <div key={s.ticker} data-ticker={s.ticker} title={`${s.company} | RS:${s.rs_rank} | ${s._scanSource === "S" ? "<10B" : "10B+"} | EPS:${s.eps_yoy ?? s.eps_qq ?? s.eps_this_y ?? '—'}% | Sales:${s.sales_yoy ?? s.sales_qq ?? s.sales_past_5y ?? '—'}% | Float:${s.shares_float_raw ? (s.shares_float_raw / 1e6).toFixed(0) + 'M' : '—'}`}
                  onClick={() => clickInBox(s.ticker, "strong")}
                  style={{ textAlign: "center", fontSize: 11, padding: "2px 4px", fontFamily: "monospace", width: 56,
                    background: isActive ? "#fbbf2430" : "#2bb88625",
                    color: s.atr_to_50 >= 7 ? "#f87171" : s.atr_to_50 >= 5 ? "#c084fc" : isActive ? "#fff" : "#bbb",
                    fontWeight: s.atr_to_50 >= 5 || isActive ? 700 : 400, cursor: "pointer",
                    outline: isActive ? "1px solid #fbbf24" : "none" }}>{s.ticker}</div>
                );
              })}
            </div>
          </div>
          {/* Momentum */}
          <div>
            <div style={{ background: "#f97316", color: "#fff", textAlign: "center", padding: "4px 8px", borderRadius: "4px 4px 0 0", fontSize: 10, fontWeight: 700 }}>
              Momentum <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 11 }}>({momentumStocks.length})</span></div>
            <div style={{ display: "flex", flexWrap: "wrap", flexDirection: "column", maxHeight: "55vh", gap: 0, alignContent: "flex-start" }}>
              {momentumStocks.map(s => {
                const isActive = s.ticker === activeTicker;
                return (
                <div key={s.ticker} data-ticker={s.ticker} title={`${s.company} | RS:${s.rs_rank} | ${s._momTag} | 1W:${s.return_1w ?? '—'}% | 1M:${s.return_1m ?? '—'}% | 3M:${s.return_3m ?? '—'}% | 6M:${s.return_6m ?? '—'}%`}
                  onClick={() => clickInBox(s.ticker, "mom")}
                  style={{ textAlign: "center", fontSize: 11, padding: "2px 4px", fontFamily: "monospace", width: 56,
                    background: isActive ? "#fbbf2430" : "#f9731625",
                    color: s.atr_to_50 >= 7 ? "#f87171" : s.atr_to_50 >= 5 ? "#c084fc" : isActive ? "#fff" : "#bbb",
                    fontWeight: s.atr_to_50 >= 5 || isActive ? 700 : 400, cursor: "pointer",
                    outline: isActive ? "1px solid #fbbf24" : "none" }}>{s.ticker}</div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* RTS Grade Grid */}
      <div style={{ display: "flex", gap: 2, minWidth: 1300 }}>
        {grades.map(g => {
          const light = ["C+","C","C-","D+","D","D-"].includes(g);
          return (
            <div key={g} style={{ width: 64, flexShrink: 0 }}>
              <div style={{ background: GRADE_COLORS[g], color: light ? "#2a2a38" : "#d4d4e0", textAlign: "center", padding: "4px 0", borderRadius: "4px 4px 0 0", fontSize: 12, fontWeight: 700 }}>
                {g}<br/><span style={{ fontWeight: 400, opacity: 0.7, fontSize: 11 }}>{groups[g].length}</span></div>
              <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
                {groups[g].slice(0, 60).map(s => {
                  const isActive = s.ticker === activeTicker;
                  return (
                  <div key={s.ticker} data-ticker={s.ticker} title={`${s.company} | RS:${s.rs_rank} | 3M:${s.return_3m}%`}
                    onClick={() => clickInBox(s.ticker, "rts")}
                    style={{ textAlign: "center", fontSize: 11, padding: "2px 0", fontFamily: "monospace",
                      background: isActive ? "#fbbf2430" : GRADE_COLORS[g] + "25",
                      color: s.atr_to_50 >= 7 ? "#f87171" : s.atr_to_50 >= 5 ? "#c084fc" : isActive ? "#fff" : "#bbb",
                      fontWeight: s.atr_to_50 >= 5 || isActive ? 700 : 400, cursor: "pointer",
                      outline: isActive ? "1px solid #fbbf24" : "none" }}>{s.ticker}</div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── LIVE VIEW ──
const LIVE_COLUMNS = [
  ["", null], ["Ticker", "ticker"], ["Tags", "hits"], ["Grade", null], ["RS", "rs"],
  ["MS", "ms_score"], ["MF", "mf"], ["Chg%", "change"], ["Vol", "volume"], ["RVol", "rel_volume"],
  ["$Vol", "dvol"], ["ADR%", "adr"], ["VCS", "vcs"], ["EPS", "eps_score"],
  ["3M%", "ret3m"], ["FrHi%", "fromhi"], ["Theme", "theme"], ["Sub", "subtheme"],
];

// ── LIGHTWEIGHT CHART (for Execution tab) ──
// Pin to v4.1.1 which uses addCandlestickSeries/addHistogramSeries API
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

function LWChart({ ticker, entry, stop, target }) {
  const wrapperRef = useRef(null);
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volSeriesRef = useRef(null);
  const roRef = useRef(null);
  const linesRef = useRef([]);
  const volMaRef = useRef(null);
  const maRefs = useRef({}); // ema10, ema21hi, ema21close, ema21lo, sma50, ema200
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [libReady, setLibReady] = useState(!!window.LightweightCharts);
  const [volStats, setVolStats] = useState(null);

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
      if (chartRef.current) { try { chartRef.current.remove(); } catch {} chartRef.current = null; seriesRef.current = null; volSeriesRef.current = null; volMaRef.current = null; linesRef.current = []; }
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
        color: "#00bc9a", lineWidth: 1, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });
      maRefs.current.sma20 = chart.addLineSeries({
        color: "#4169e1", lineWidth: 2, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });
      maRefs.current.ema200 = chart.addLineSeries({
        color: "#8232c8", lineWidth: 1, lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });

      // ── Volume as overlay in bottom 20% ──
      volSeriesRef.current = chart.addHistogramSeries({
        priceFormat: { type: "volume" }, priceScaleId: "vol",
        color: "#2bb88640",
      });
      volMaRef.current = chart.addLineSeries({
        color: "#fbbf2480", lineWidth: 1, priceScaleId: "vol",
        lastValueVisible: false, crosshairMarkerVisible: false, priceLineVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      roRef.current = new ResizeObserver(() => {
        if (chartRef.current && chartContainerRef.current) {
          try { chartRef.current.resize(chartContainerRef.current.clientWidth || 400, chartContainerRef.current.clientHeight || 400); } catch {}
        }
      });
      roRef.current.observe(chartContainerRef.current);
    } catch (e) {
      console.error("LW chart init error:", e);
      setError("Chart init failed: " + e.message);
    }
  }, [libReady]);

  // Fetch data when ticker changes
  useEffect(() => {
    if (!ticker || !seriesRef.current || !chartRef.current) return;
    setLoading(true);
    setError(null);
    let cancelled = false;

    fetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        if (cancelled || !seriesRef.current) return;
        if (!data.ok || !data.ohlc || data.ohlc.length === 0) throw new Error(data.error || "No OHLC data");
        const bars = data.ohlc;

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
            return { time: c.date, value: vol, color: "#6b7280cc" };
          }

          // Check highest up volume ever/year/quarter — all purple bars
          if (vol === highestUpVolEver && vol > 0) {
            return { time: c.date, value: vol, color: "#a855f7" };
          }
          if (i >= yearStart && vol === highestUpVolYear && vol > 0 && vol !== highestUpVolEver) {
            return { time: c.date, value: vol, color: "#a855f7" };
          }
          if (i >= qtrStart && vol === highestUpVolQtr && vol > 0 && vol !== highestUpVolEver && vol !== highestUpVolYear) {
            return { time: c.date, value: vol, color: "#a855f7" };
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
              return { time: c.date, value: vol, color: "#2563eb" };
            }
          }
          if (downVols.length >= 5) {
            const max5 = Math.max(...downVols.slice(0, 5));
            if (vol > max5) {
              return { time: c.date, value: vol, color: "#0d9488" };
            }
          }

          return { time: c.date, value: vol, color: "#ffffffcc" };
        });

        // Find indices of HVE and HVY for markers
        let hveIdx = -1, hvyIdx = -1;
        for (let i = 0; i < bars.length; i++) {
          if (bars[i].close >= bars[i].open) {
            if ((bars[i].volume || 0) === highestUpVolEver) hveIdx = i;
            if (i >= yearStart && (bars[i].volume || 0) === highestUpVolYear) hvyIdx = i;
          }
        }

        seriesRef.current.setData(bars.map(c => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close })));
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

        if (lastSma50 && lastAtr && lastAtr > 0) {
          // ATR ladder — axis labels only (no visible lines)
          const addAxisLabel = (price, color, title) => {
            if (price > 0 && isFinite(price)) {
              try { linesRef.current.push(seriesRef.current.createPriceLine({ price, color, lineWidth: 0, lineStyle: 2, lineVisible: false, axisLabelVisible: true, title })); } catch {}
            }
          };
          addAxisLabel(lastSma50 + 10 * lastAtr, "#ff3232", "x10");
          addAxisLabel(lastSma50 + 8 * lastAtr, "#32cd32", "x8");
          addAxisLabel(lastSma50 + 7 * lastAtr, "#32cd32", "x7");
          addAxisLabel(lastSma50 + 4 * lastAtr, "#32cd32", "MaxE");
          addAxisLabel(lastLow + lastAtr * 0.6, "#9c27b0", "LoD+.6");
          // Risk stops — axis labels only
          addAxisLabel(lastClose - lastAtr * 0.5, "#ff5252", "0.5x");
          addAxisLabel(lastClose - lastAtr, "#ff5252", "1.0x");
          addAxisLabel(lastClose - lastAtr * 2.0, "#ff5252", "2.0x");
          // Reference levels
          addAxisLabel(lastLow, "#808080", "LOD");
          addAxisLabel(prevLow, "#ffa500", "PDL");
          if (wk52High > 0) addAxisLabel(wk52High, "#ffa500", "52W");
          if (athHigh > 0 && Math.abs(athHigh - wk52High) > lastClose * 0.001) addAxisLabel(athHigh, "#ff8c00", "ATH");
        }

        // Entry / Stop / Target from trade
        if (parseFloat(entry) > 0) addLine(parseFloat(entry), "#60a5fa", "Entry", 2, 1);
        if (parseFloat(stop) > 0) addLine(parseFloat(stop), "#f87171", "Stop", 2, 1);
        if (parseFloat(target) > 0) addLine(parseFloat(target), "#2bb886", "Target", 2, 1);

        const toLine = (arr) => arr.map((v, i) => v != null ? { time: bars[i].date, value: Math.round(v * 100) / 100 } : null).filter(Boolean);

        if (maRefs.current.ema10) maRefs.current.ema10.setData(toLine(ema10));
        if (maRefs.current.sma20) maRefs.current.sma20.setData(toLine(sma20));
        if (maRefs.current.sma50) maRefs.current.sma50.setData(toLine(sma50));
        if (maRefs.current.ema200) maRefs.current.ema200.setData(toLine(ema200));
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
              time: bars[i].date,
              value: Math.round(ema21close[i] * 100) / 100,
              color: allRising ? "#00ff00" : allFalling ? "#ff00ff" : "#808080",
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
          volMarkers.push({ time: bars[hveIdx].date, position: "aboveBar", color: "#d946ef",
            shape: "circle", size: 0.5, text: `HVE ${fmtVol(bars[hveIdx].volume)} (${calcPctAboveAvg(hveIdx)}%)` });
        }
        if (hvyIdx >= 0 && hvyIdx !== hveIdx) {
          volMarkers.push({ time: bars[hvyIdx].date, position: "aboveBar", color: "#a855f7",
            shape: "circle", size: 0.5, text: `HVY ${fmtVol(bars[hvyIdx].volume)} (${calcPctAboveAvg(hvyIdx)}%)` });
        }
        if (highestUpVolQtrIdx >= 0 && highestUpVolQtrIdx !== hveIdx && highestUpVolQtrIdx !== hvyIdx) {
          volMarkers.push({ time: bars[highestUpVolQtrIdx].date, position: "aboveBar", color: "#22d3ee",
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
              time: bars[i].date, position: "belowBar", color: "#ffffff",
              shape: "square", size: 0.3,
            });
          }
        }

        volMarkers.sort((a, b) => a.time.localeCompare(b.time));
        volSeriesRef.current.setMarkers(volMarkers);

        // ── 7x/10x ATRX dots on price series ──
        const priceMarkers = [];
        for (let i = 1; i < bars.length; i++) {
          if (sma50[i] == null || atr14[i] == null || atr14[i] === 0) continue;
          const atrx = (bars[i].close - sma50[i]) / atr14[i];
          if (atrx >= 10) {
            priceMarkers.push({ time: bars[i].date, position: "aboveBar", color: "#ff0000", shape: "circle", size: 0.5, text: "" });
          } else if (atrx >= 7) {
            priceMarkers.push({ time: bars[i].date, position: "aboveBar", color: "#ffd700", shape: "circle", size: 0.3, text: "" });
          } else if (atrx <= -10) {
            priceMarkers.push({ time: bars[i].date, position: "belowBar", color: "#ff0000", shape: "circle", size: 0.5, text: "" });
          } else if (atrx <= -7) {
            priceMarkers.push({ time: bars[i].date, position: "belowBar", color: "#ffd700", shape: "circle", size: 0.3, text: "" });
          }
        }
        priceMarkers.sort((a, b) => a.time.localeCompare(b.time));
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
            maData.push({ time: bars[i].date, value: ma });

            // Volume dry-up detection
            const vol = bars[i].volume || 0;
            if (ma > 0) {
              const pctChange = ((vol - ma) / ma) * 100;
              if (pctChange <= -60) {
                // 2nd level dry-up (≤ -60%) — orange dot
                dryUpMarkers.push({
                  time: bars[i].date, position: "aboveBar", color: "#f97316",
                  shape: "circle", size: 0.5,
                });
              } else if (pctChange <= -45) {
                // 1st level dry-up (≤ -45%) — yellow dot
                dryUpMarkers.push({
                  time: bars[i].date, position: "aboveBar", color: "#fbbf24",
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

        // Show last ~6 months (126 trading days) — use logical range to preserve rightOffset
        const totalBars = bars.length;
        const fromBar = totalBars > 126 ? totalBars - 126 : 0;
        chartRef.current.timeScale().setVisibleLogicalRange({ from: fromBar, to: totalBars + 27 });

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
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [ticker, libReady]);

  // Price lines now managed inside data fetch useEffect (with ATR ladder, risk stops, etc.)

  const fmtVol = (v) => {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return v.toFixed(0);
  };

  return (
    <div ref={wrapperRef} style={{ width: "100%", height: "100%", minHeight: 300, position: "relative" }}>
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
  );
}

// ── Trade state computed from transactions ──
function tradeState(trade) {
  const txs = trade.transactions || [];
  if (txs.length === 0) {
    // Legacy trade without transactions
    const entry = parseFloat(trade.entry) || 0;
    const shares = parseFloat(trade.shares) || 0;
    const stop = parseFloat(trade.stop) || 0;
    return { avgEntry: entry, curShares: shares, curStop: stop, totalBought: shares, totalSold: 0,
      costBasis: entry * shares, realizedPnl: 0, transactions: [] };
  }
  let totalBoughtShares = 0, totalBoughtCost = 0, totalSoldShares = 0, realizedPnl = 0;
  let curStop = parseFloat(trade.stop) || 0;
  for (const tx of txs) {
    if (tx.type === "buy") {
      totalBoughtShares += tx.shares;
      totalBoughtCost += tx.price * tx.shares;
    } else if (tx.type === "sell") {
      const avgEntry = totalBoughtShares > 0 ? totalBoughtCost / totalBoughtShares : 0;
      realizedPnl += (tx.price - avgEntry) * tx.shares;
      totalSoldShares += tx.shares;
    } else if (tx.type === "stop") {
      curStop = tx.price;
    }
  }
  const curShares = totalBoughtShares - totalSoldShares;
  const avgEntry = totalBoughtShares > 0 ? totalBoughtCost / totalBoughtShares : 0;
  return { avgEntry, curShares, curStop, totalBought: totalBoughtShares, totalSold: totalSoldShares,
    costBasis: totalBoughtCost, realizedPnl, transactions: txs };
}

// Migrate legacy trade to have transactions array
function migrateTrade(t) {
  if (t.transactions && t.transactions.length > 0) return t;
  const entry = parseFloat(t.entry) || 0;
  const shares = parseFloat(t.shares) || 0;
  const stop = parseFloat(t.stop) || 0;
  const txs = [];
  if (entry > 0 && shares > 0) {
    txs.push({ type: "buy", date: t.date || "", price: entry, shares, note: "Initial entry" });
  }
  if (stop > 0) {
    txs.push({ type: "stop", date: t.date || "", price: stop, note: "Initial stop" });
  }
  if (t.status === "closed" && t.exitPrice) {
    txs.push({ type: "sell", date: t.closeDate || "", price: parseFloat(t.exitPrice), shares, note: "Close all" });
  }
  return { ...t, transactions: txs };
}

// ── EXECUTION TAB ──
const SETUP_TAGS = ["Breakout", "Pullback", "EP Gap", "VCP", "IPO Base", "Power Earnings Gap", "Other"];

function Execution({ trades, setTrades, stockMap, onTickerClick, activeTicker, onVisibleTickers, portfolio, removeFromPortfolio, liveThemeData, erSipLookup }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [tab, setTab] = useState("calc"); // open | closed | calc
  const [pSort, setPSort] = useState("change");
  const [calcTicker, setCalcTicker] = useState("");

  // O(1) lookup for live prices instead of O(n) find() per row
  const liveMap = useMemo(() => {
    const m = {};
    if (liveThemeData) liveThemeData.forEach(s => { m[s.ticker] = s; });
    return m;
  }, [liveThemeData]);
  const [calcEntry, setCalcEntry] = useState("");
  const [calcStop, setCalcStop] = useState("");
  const [calcRisk, setCalcRisk] = useState(() => {
    try { return localStorage.getItem("tp_risk_pct") || "0.35"; } catch { return "0.35"; }
  });
  const [calcAccount, setCalcAccount] = useState(() => {
    try { return localStorage.getItem("tp_account_size") || "300000"; } catch { return "300000"; }
  });
  const [calcMaxAlloc, setCalcMaxAlloc] = useState(() => {
    try { return localStorage.getItem("tp_max_alloc") || "25"; } catch { return "25"; }
  });

  // Merge portfolio stocks with live data (same pattern as LiveView)
  const mergeStock = useCallback((ticker) => {
    const pipe = stockMap?.[ticker] || {};
    const { quality, q_factors } = computeStockQuality(pipe);
    return {
      ticker, price: pipe.price, change: null, rel_volume: pipe.rel_volume,
      avg_volume_raw: pipe.avg_volume_raw, grade: pipe.grade, rs_rank: pipe.rs_rank,
      return_1m: pipe.return_1m, return_3m: pipe.return_3m, pct_from_high: pipe.pct_from_high,
      atr_to_50: pipe.atr_to_50, adr_pct: pipe.adr_pct, eps_past_5y: pipe.eps_past_5y,
      eps_this_y: pipe.eps_this_y, eps_qq: pipe.eps_qq, eps_yoy: pipe.eps_yoy, sales_past_5y: pipe.sales_past_5y,
      sales_qq: pipe.sales_qq, sales_yoy: pipe.sales_yoy, pe: pipe.pe, roe: pipe.roe, profit_margin: pipe.profit_margin,
      rsi: pipe.rsi, themes: pipe.themes || [], theme: pipe.themes?.[0]?.theme || "",
      subtheme: pipe.themes?.[0]?.subtheme || "",
      company: pipe.company || "", vcs: pipe.vcs, vcs_components: pipe.vcs_components,
      mf: pipe.mf, mf_components: pipe.mf_components, _mfPct: pipe._mfPct,
      avg_dollar_vol: pipe.avg_dollar_vol, avg_dollar_vol_raw: pipe.avg_dollar_vol_raw,
      dvol_accel: pipe.dvol_accel, dvol_ratio_5_20: pipe.dvol_ratio_5_20, dvol_wow_chg: pipe.dvol_wow_chg,
      earnings_days: pipe.earnings_days, earnings_display: pipe.earnings_display,
      earnings_date: pipe.earnings_date, er: pipe.er, _scanHits: pipe._scanHits || [],
      _epsScore: pipe._epsScore, _msScore: pipe._msScore, _quality: quality, _q_factors: q_factors,
    };
  }, [stockMap]);

  const sortFn = (key, desc = true) => (a, b) => {
    const av = a[key] ?? (desc ? -Infinity : Infinity);
    const bv = b[key] ?? (desc ? -Infinity : Infinity);
    return desc ? bv - av : av - bv;
  };
  const sortList = (list, sk) => {
    const sorters = { ticker: (a, b) => a.ticker.localeCompare(b.ticker), quality: sortFn("_quality"),
      eps_score: sortFn("_epsScore"), ms_score: sortFn("_msScore"), vcs: sortFn("vcs"), mf: sortFn("mf"),
      change: sortFn("change"), rs: sortFn("rs_rank"), ret3m: sortFn("return_3m"),
      fromhi: (a, b) => (b.pct_from_high ?? -999) - (a.pct_from_high ?? -999),
      adr: sortFn("adr_pct"), dvol: sortFn("avg_dollar_vol_raw"), rel_volume: sortFn("rel_volume"),
      volume: sortFn("avg_volume_raw"), rvol: sortFn("rel_volume"),
      hits: (a, b) => ((b._scanHits?.length || 0) - (a._scanHits?.length || 0)),
      theme: (a, b) => (a.theme || "").localeCompare(b.theme || ""),
      subtheme: (a, b) => (a.subtheme || "").localeCompare(b.subtheme || ""),
    };
    const sorted = [...list]; if (sorters[sk]) sorted.sort(sorters[sk]); return sorted;
  };

  const portfolioMerged = useMemo(() => sortList(portfolio.map(mergeStock), pSort), [portfolio, mergeStock, pSort]);

  // Form state
  const emptyForm = { ticker: "", entry: "", stop: "", target: "", shares: "", date: new Date().toISOString().split("T")[0], setup: "Breakout", notes: "", status: "open" };
  const [form, setForm] = useState(emptyForm);

  // Persist account size
  useEffect(() => { localStorage.setItem("tp_account_size", calcAccount); }, [calcAccount]);
  useEffect(() => { localStorage.setItem("tp_risk_pct", calcRisk); }, [calcRisk]);
  useEffect(() => { localStorage.setItem("tp_max_alloc", calcMaxAlloc); }, [calcMaxAlloc]);

  // Report visible tickers
  const openTrades = useMemo(() => trades.filter(t => t.status === "open"), [trades]);
  const closedTrades = useMemo(() => trades.filter(t => t.status === "closed").sort((a, b) => (b.closeDate || "").localeCompare(a.closeDate || "")), [trades]);

  useEffect(() => {
    if (onVisibleTickers) {
      const tickers = (tab === "closed" ? closedTrades : openTrades).map(t => t.ticker);
      onVisibleTickers([...new Set(tickers)]);
    }
  }, [tab, openTrades, closedTrades, onVisibleTickers]);

  // Risk calculator
  const calcStock = stockMap[calcTicker.toUpperCase()];
  const calcADR = calcStock?.adr_pct;
  const calcPrice = calcStock?.price;
  const calcATR = calcADR && calcPrice ? (calcADR / 100 * calcPrice).toFixed(2) : null;

  const entryNum = parseFloat(calcEntry) || parseFloat(calcPrice) || 0;
  const stopNum = parseFloat(calcStop) || 0;
  const riskPct = parseFloat(calcRisk) || 0.35;
  const accountNum = parseFloat(calcAccount) || 100000;
  const maxAllocPct = parseFloat(calcMaxAlloc) || 25;
  const riskPerShare = entryNum > 0 && stopNum > 0 ? Math.abs(entryNum - stopNum) : 0;
  const dollarRisk = accountNum * (riskPct / 100);
  const maxAllocDollar = accountNum * (maxAllocPct / 100);
  const positionShares = riskPerShare > 0 ? Math.floor(dollarRisk / riskPerShare) : 0;
  const positionValue = positionShares * entryNum;
  const positionPct = accountNum > 0 ? ((positionValue / accountNum) * 100).toFixed(1) : 0;
  const rr1 = entryNum + riskPerShare;
  const rr2 = entryNum + riskPerShare * 2;
  const rr3 = entryNum + riskPerShare * 3;

  // ATR-based position sizing table (0.5x, 1.0x, 2.0x, Day Low, PDL)
  const [calcDayLow, setCalcDayLow] = useState("");
  const [calcPDL, setCalcPDL] = useState("");

  // Fetch day low / PDL when ticker changes in calc
  useEffect(() => {
    if (!calcTicker) return;
    const t = calcTicker.toUpperCase();
    fetch(`/api/ohlc?ticker=${encodeURIComponent(t)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.ok || !data.ohlc?.length) return;
        const bars = data.ohlc;
        const last = bars[bars.length - 1];
        const prev = bars.length > 1 ? bars[bars.length - 2] : null;
        if (last) { setCalcDayLow(String(last.low)); setCalcStop(String(last.low)); }
        if (prev) setCalcPDL(String(prev.low));
      })
      .catch(() => {});
  }, [calcTicker]);

  const atrStops = useMemo(() => {
    if (!calcATR || !entryNum || !accountNum) return null;
    const atr = parseFloat(calcATR);
    if (!atr || atr <= 0) return null;
    const dayLow = parseFloat(calcDayLow) || 0;
    const pdl = parseFloat(calcPDL) || 0;

    const makeStop = (label, stopPrice) => {
      const stopDist = entryNum - stopPrice;
      const stopPct = entryNum > 0 ? (stopDist / entryNum * 100) : 0;
      const sharesFromRisk = stopDist > 0 ? Math.floor(dollarRisk / stopDist) : 0;
      const sharesFromAlloc = entryNum > 0 ? Math.floor(maxAllocDollar / entryNum) : 0;
      const shares = Math.min(sharesFromRisk, sharesFromAlloc);
      const invested = shares * entryNum;
      const investedPct = accountNum > 0 ? (invested / accountNum * 100) : 0;
      const estRisk = shares * Math.abs(stopDist);
      const capped = sharesFromRisk > sharesFromAlloc;
      return { label, stopPrice, stopDist, stopPct, shares, invested, investedPct, estRisk, capped };
    };

    const stops = [
      makeStop("(0.5x)", entryNum - atr * 0.5),
      makeStop("(1.0x)", entryNum - atr),
      makeStop("(2.0x)", entryNum - atr * 2.0),
    ];
    if (dayLow > 0 && dayLow < entryNum) stops.push(makeStop("Day Low", dayLow));
    if (pdl > 0 && pdl < entryNum) stops.push(makeStop("PDL", pdl));
    return stops;
  }, [calcATR, entryNum, accountNum, dollarRisk, maxAllocDollar, calcDayLow, calcPDL]);

  // Auto-fill from active ticker
  useEffect(() => {
    if (tab === "calc" && activeTicker && activeTicker !== calcTicker.toUpperCase()) {
      setCalcTicker(activeTicker);
      const s = stockMap[activeTicker];
      if (s?.price) setCalcEntry(String(s.price));
    }
  }, [activeTicker, tab]);

  // Add / Edit trade
  const saveTrade = () => {
    const ticker = form.ticker.toUpperCase();
    const id = editId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const entry = parseFloat(form.entry) || 0;
    const shares = parseFloat(form.shares) || 0;
    const stop = parseFloat(form.stop) || 0;
    let t = { ...form, ticker, id };
    if (!editId) {
      // New trade — generate initial transactions
      const txs = [];
      if (entry > 0 && shares > 0) txs.push({ type: "buy", date: form.date, price: entry, shares, note: "Initial entry" });
      if (stop > 0) txs.push({ type: "stop", date: form.date, price: stop, note: "Initial stop" });
      t.transactions = txs;
    }
    if (editId) {
      setTrades(prev => prev.map(x => x.id === editId ? t : x));
    } else {
      setTrades(prev => [...prev, t]);
    }
    setForm(emptyForm);
    setEditId(null);
    setShowForm(false);
  };

  const closeTrade = (id, exitPrice, exitDate) => {
    setTrades(prev => prev.map(t => {
      if (t.id !== id) return t;
      const st = tradeState(t);
      const exit = parseFloat(exitPrice) || 0;
      const date = exitDate || new Date().toISOString().split("T")[0];
      const txs = [...(t.transactions || []), { type: "sell", date, price: exit, shares: st.curShares, note: "Close all" }];
      const finalSt = tradeState({ ...t, transactions: txs });
      return { ...t, transactions: txs, status: "closed", exitPrice: exit, closeDate: date,
        pnl: Math.round(finalSt.realizedPnl * 100) / 100,
        pnlPct: finalSt.avgEntry > 0 ? Math.round((exit - finalSt.avgEntry) / finalSt.avgEntry * 10000) / 100 : 0,
        entry: String(finalSt.avgEntry.toFixed(2)), shares: String(0) };
    }));
  };

  // Trim: sell partial shares
  const trimTrade = (id, trimShares, trimPrice) => {
    setTrades(prev => prev.map(t => {
      if (t.id !== id) return t;
      const date = new Date().toISOString().split("T")[0];
      const txs = [...(t.transactions || []), { type: "sell", date, price: parseFloat(trimPrice), shares: parseInt(trimShares), note: "Trim" }];
      const st = tradeState({ ...t, transactions: txs });
      if (st.curShares <= 0) {
        return { ...t, transactions: txs, status: "closed", closeDate: date, exitPrice: parseFloat(trimPrice),
          pnl: Math.round(st.realizedPnl * 100) / 100,
          pnlPct: st.avgEntry > 0 ? Math.round((parseFloat(trimPrice) - st.avgEntry) / st.avgEntry * 10000) / 100 : 0,
          entry: String(st.avgEntry.toFixed(2)), shares: String(0) };
      }
      return { ...t, transactions: txs, shares: String(st.curShares), entry: String(st.avgEntry.toFixed(2)) };
    }));
  };

  // Add shares
  const addToTrade = (id, addShares, addPrice) => {
    setTrades(prev => prev.map(t => {
      if (t.id !== id) return t;
      const date = new Date().toISOString().split("T")[0];
      const txs = [...(t.transactions || []), { type: "buy", date, price: parseFloat(addPrice), shares: parseInt(addShares), note: "Add" }];
      const st = tradeState({ ...t, transactions: txs });
      return { ...t, transactions: txs, shares: String(st.curShares), entry: String(st.avgEntry.toFixed(2)) };
    }));
  };

  // Move stop
  const moveStop = (id, newStop) => {
    setTrades(prev => prev.map(t => {
      if (t.id !== id) return t;
      const date = new Date().toISOString().split("T")[0];
      const txs = [...(t.transactions || []), { type: "stop", date, price: parseFloat(newStop), note: "Stop moved" }];
      return { ...t, transactions: txs, stop: String(parseFloat(newStop).toFixed(2)) };
    }));
  };

  const deleteTrade = (id) => setTrades(prev => prev.filter(t => t.id !== id));

  const startEdit = (t) => {
    setForm(t);
    setEditId(t.id);
    setShowForm(true);
  };

  // Quick add from calc
  const addFromCalc = () => {
    if (!calcTicker || !entryNum || !stopNum) return;
    const date = new Date().toISOString().split("T")[0];
    const t = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ticker: calcTicker.toUpperCase(), entry: String(entryNum), stop: String(stopNum),
      target: String(rr2.toFixed(2)), shares: String(positionShares),
      date, setup: "Breakout", notes: "", status: "open",
      transactions: [
        { type: "buy", date, price: entryNum, shares: positionShares, note: "Initial entry" },
        { type: "stop", date, price: stopNum, note: "Initial stop" },
      ],
    };
    setTrades(prev => [...prev, t]);
  };

  // Close trade prompt
  const [closingId, setClosingId] = useState(null);
  const [closePrice, setClosePrice] = useState("");
  const [actionModal, setActionModal] = useState(null); // { id, type: "add"|"trim"|"stop", price: "", shares: "" }

  const st = { label: { color: "#686878", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 },
    input: { background: "#1a1a24", border: "1px solid #3a3a4a", borderRadius: 4, color: "#d4d4e0", padding: "5px 8px", fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%" },
    btn: (c, bg) => ({ padding: "4px 10px", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer", border: `1px solid ${c}`, background: bg || "transparent", color: c }),
  };

  return (
    <div style={{ padding: 0 }}>
      {/* Portfolio Table */}
      {portfolio.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#4aad8c", marginBottom: 4 }}>Portfolio ({portfolio.length})</div>
          <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={portfolioMerged} sortKey={pSort} setter={setPSort} onRemove={removeFromPortfolio} erSipLookup={erSipLookup} />
        </div>
      )}

      {/* Sub-tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10, alignItems: "center" }}>
        {[["open", `Open (${openTrades.length})`], ["closed", `Closed (${closedTrades.length})`], ["calc", "Calculator"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer",
            border: tab === k ? "1px solid #0d9163" : "1px solid #3a3a4a",
            background: tab === k ? "#0d916320" : "transparent", color: tab === k ? "#4aad8c" : "#686878" }}>{l}</button>
        ))}
        {tab !== "calc" && (
          <button onClick={() => { setForm({ ...emptyForm, ticker: activeTicker || "" }); setEditId(null); setShowForm(true); }}
            style={st.btn("#0d9163", "#0d916320")}>+ New Trade</button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "#505060" }}>Acct:</span>
        <input value={calcAccount} onChange={e => setCalcAccount(e.target.value)}
          style={{ ...st.input, width: 80, textAlign: "right" }} />
        <span style={{ fontSize: 10, color: "#505060", marginLeft: 6 }}>Risk%:</span>
        <input value={calcRisk} onChange={e => setCalcRisk(e.target.value)}
          style={{ ...st.input, width: 45, textAlign: "right" }} />
        <span style={{ fontSize: 10, color: "#505060", marginLeft: 6 }}>MaxAlloc%:</span>
        <input value={calcMaxAlloc} onChange={e => setCalcMaxAlloc(e.target.value)}
          style={{ ...st.input, width: 40, textAlign: "right" }} />
      </div>

      {/* New/Edit Trade Form */}
      {showForm && (
        <div style={{ background: "#1a1a24", border: "1px solid #3a3a4a", borderRadius: 6, padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ width: 80 }}><div style={st.label}>Ticker</div>
              <input value={form.ticker} onChange={e => setForm(p => ({ ...p, ticker: e.target.value }))} style={st.input} /></div>
            <div style={{ width: 80 }}><div style={st.label}>Entry</div>
              <input value={form.entry} onChange={e => setForm(p => ({ ...p, entry: e.target.value }))} style={st.input} type="number" step="0.01" /></div>
            <div style={{ width: 80 }}><div style={st.label}>Stop</div>
              <input value={form.stop} onChange={e => setForm(p => ({ ...p, stop: e.target.value }))} style={st.input} type="number" step="0.01" /></div>
            <div style={{ width: 80 }}><div style={st.label}>Target</div>
              <input value={form.target} onChange={e => setForm(p => ({ ...p, target: e.target.value }))} style={st.input} type="number" step="0.01" /></div>
            <div style={{ width: 70 }}><div style={st.label}>Shares</div>
              <input value={form.shares} onChange={e => setForm(p => ({ ...p, shares: e.target.value }))} style={st.input} type="number" /></div>
            <div style={{ width: 90 }}><div style={st.label}>Date</div>
              <input value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} style={st.input} type="date" /></div>
            <div style={{ width: 100 }}><div style={st.label}>Setup</div>
              <select value={form.setup} onChange={e => setForm(p => ({ ...p, setup: e.target.value }))}
                style={{ ...st.input, cursor: "pointer" }}>
                {SETUP_TAGS.map(s => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div style={{ flex: 1, minWidth: 120 }}><div style={st.label}>Notes</div>
              <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} style={st.input} placeholder="Setup notes..." /></div>
            <button onClick={saveTrade} style={st.btn("#2bb886", "#2bb88620")}>{editId ? "Update" : "Add"}</button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} style={st.btn("#686878")}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Calculator Tab ── */}
      {tab === "calc" && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* Input panel */}
          <div style={{ background: "#1a1a24", border: "1px solid #3a3a4a", borderRadius: 6, padding: 12, width: 200 }}>
            <div style={{ ...st.label, marginBottom: 8, color: "#9090a0" }}>Position Sizer</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div><div style={st.label}>Ticker</div>
                <input value={calcTicker} onChange={e => { setCalcTicker(e.target.value); const s = stockMap[e.target.value.toUpperCase()]; if (s?.price) setCalcEntry(String(s.price)); }}
                  style={st.input} placeholder="AAPL" /></div>
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ flex: 1 }}><div style={st.label}>Entry $</div>
                  <input value={calcEntry} onChange={e => setCalcEntry(e.target.value)} style={st.input} type="number" step="0.01" /></div>
                <div style={{ flex: 1 }}><div style={st.label}>Stop $</div>
                  <input value={calcStop} onChange={e => setCalcStop(e.target.value)} style={st.input} type="number" step="0.01" /></div>
              </div>
              {calcATR && <div style={{ fontSize: 10, color: "#787888", marginTop: 2 }}>
                ADR: <span style={{ color: "#d4d4e0" }}>{calcADR}%</span> · ATR(14): <span style={{ color: "#d4d4e0" }}>${calcATR}</span>
                {entryNum > 0 && <span> · <span style={{ color: "#d4d4e0" }}>{(parseFloat(calcATR) / entryNum * 100).toFixed(2)}%</span></span>}
              </div>}
              <button onClick={addFromCalc} disabled={!calcTicker || !entryNum || !stopNum}
                style={{ ...st.btn("#2bb886", "#2bb88620"), opacity: !calcTicker || !entryNum || !stopNum ? 0.4 : 1, marginTop: 4 }}>
                Add to Open Trades ({positionShares} shares)</button>
            </div>
          </div>

          {/* Custom stop R/R panel */}
          {riskPerShare > 0 && (
            <div style={{ background: "#1a1a24", border: "1px solid #3a3a4a", borderRadius: 6, padding: 12, minWidth: 133 }}>
              <div style={{ ...st.label, marginBottom: 8, color: "#9090a0" }}>Custom Stop</div>
              <table style={{ borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                <tbody>
                  {[
                    ["Risk/Share", `$${riskPerShare.toFixed(2)}`, "#f87171"],
                    ["Stop Dist", `${(riskPerShare / entryNum * 100).toFixed(2)}%`, "#f87171"],
                    ["$ at Risk", `$${dollarRisk.toFixed(0)}`, "#f87171"],
                    ["Shares", String(positionShares), "#d4d4e0"],
                    ["Position $", `$${positionValue.toLocaleString()}`, "#d4d4e0"],
                    ["% Invested", `${positionPct}%`, parseFloat(positionPct) > maxAllocPct ? "#f87171" : "#d4d4e0"],
                    ["Est. Risk $", `$${(positionShares * riskPerShare).toFixed(2)}`, "#f87171"],
                    ["", "", ""],
                    ["1R Target", `$${rr1.toFixed(2)}`, "#fbbf24"],
                    ["2R Target", `$${rr2.toFixed(2)}`, "#2bb886"],
                    ["3R Target", `$${rr3.toFixed(2)}`, "#0d9163"],
                  ].map(([label, val, c], i) => (
                    <tr key={i}>
                      <td style={{ padding: "3px 8px 3px 0", color: "#686878" }}>{label}</td>
                      <td style={{ padding: "3px 0", color: c, fontWeight: 600 }}>{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ATR-based position sizing table */}
          {atrStops && (
            <div style={{ background: "#1a1a24", border: "1px solid #3a3a4a", borderRadius: 6, padding: 12, minWidth: 360 }}>
              <div style={{ ...st.label, marginBottom: 8, color: "#9090a0" }}>
                ATR (14): {(parseFloat(calcATR) / entryNum * 100).toFixed(2)}%
              </div>
              <table style={{ borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace", width: "100%" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #3a3a4a" }}>
                    <th style={{ padding: "4px 8px", color: "#686878", textAlign: "left", fontSize: 10 }}></th>
                    {atrStops.map(s => (
                      <th key={s.label} style={{ padding: "4px 8px", color: "#9090a0", textAlign: "right", fontSize: 10, fontWeight: 700 }}>
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Stop Price", fn: s => `$${s.stopPrice.toFixed(2)}`, color: "#d4d4e0" },
                    { label: "Shares", fn: s => `${s.shares.toLocaleString()}${s.capped ? "*" : ""}`, colorFn: s => s.capped ? "#ffa500" : "#d4d4e0" },
                    { label: "Stop Dist %", fn: s => `-${s.stopPct.toFixed(2)}%`, color: "#f87171" },
                    { label: "% Invested", fn: s => `${s.investedPct.toFixed(1)}%`, colorFn: s => s.investedPct > maxAllocPct ? "#f87171" : "#d4d4e0" },
                    { label: "Est. Risk $", fn: s => `$${s.estRisk.toFixed(2)}`, color: "#f87171" },
                  ].map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: "1px solid #222230" }}>
                      <td style={{ padding: "5px 8px", color: "#686878", fontSize: 10 }}>{row.label}</td>
                      {atrStops.map(s => (
                        <td key={s.label} style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600,
                          color: row.colorFn ? row.colorFn(s) : row.color }}>
                          {row.fn(s)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Open Trades ── */}
      {tab === "open" && (
        <div>
          {openTrades.length === 0 ? (
            <div style={{ color: "#505060", fontSize: 12, padding: 20, textAlign: "center" }}>No open trades. Click "+ New Trade" to start.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ borderBottom: "2px solid #3a3a4a" }}>
                {["Ticker", "Entry", "Stop", "Shares", "Risk$", "Cur R", "1R", "2R", "3R", "Setup", "Date", "P&L", "Theme", "Sub", ""].map(h => (
                  <th key={h} style={{ padding: "4px 6px", color: "#686878", fontWeight: 600, textAlign: "center", fontSize: 10 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>{openTrades.map(t => {
                const st2 = tradeState(t);
                const entry = st2.avgEntry;
                const stop = st2.curStop;
                const shares = st2.curShares;
                const live = stockMap[t.ticker];
                const livePrice = liveMap[t.ticker];
                const curPrice = livePrice?.price || live?.price || entry;
                const unrealPnl = (curPrice - entry) * shares;
                const unrealPct = entry > 0 ? ((curPrice - entry) / entry * 100) : 0;
                const riskPS = Math.abs(entry - stop);
                const riskDollar = riskPS * shares;
                const curR = riskPS > 0 ? ((curPrice - entry) / riskPS) : 0;
                const t1R = entry + riskPS;
                const t2R = entry + riskPS * 2;
                const t3R = entry + riskPS * 3;
                const isActive = t.ticker === activeTicker;
                const rColor = (r) => r >= 3 ? "#0d9163" : r >= 2 ? "#2bb886" : r >= 1 ? "#fbbf24" : r >= 0 ? "#9090a0" : "#f87171";
                return (
                  <Fragment key={t.id}>
                  <tr onClick={() => onTickerClick(t.ticker)}
                    style={{ borderBottom: "1px solid #222230", cursor: "pointer",
                      background: isActive ? "#fbbf2418" : closingId === t.id ? "#f8717110" : "transparent" }}>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 500, color: isActive ? "#fbbf24" : "#a8a8b8", fontFamily: "monospace" }}>
                      {t.ticker}
                      {live?.grade && <span style={{ marginLeft: 3 }}><Badge grade={live.grade} /></span>}
                    </td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontFamily: "monospace", color: "#d4d4e0" }}>${entry.toFixed(2)}</td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontFamily: "monospace", color: "#f87171" }}>{stop > 0 ? `$${stop.toFixed(2)}` : "—"}</td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontFamily: "monospace", color: "#d4d4e0" }}>{shares}</td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontFamily: "monospace", color: "#f87171" }}>${riskDollar.toFixed(0)}</td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontFamily: "monospace", fontWeight: 700,
                      color: rColor(curR) }}>
                      {curR >= 0 ? "+" : ""}{curR.toFixed(2)}R
                    </td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontFamily: "monospace", color: "#686878", fontSize: 10 }}>
                      {riskPS > 0 ? `$${t1R.toFixed(2)}` : "—"}
                    </td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontFamily: "monospace", color: "#686878", fontSize: 10 }}>
                      {riskPS > 0 ? `$${t2R.toFixed(2)}` : "—"}
                    </td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontFamily: "monospace", color: "#686878", fontSize: 10 }}>
                      {riskPS > 0 ? `$${t3R.toFixed(2)}` : "—"}
                    </td>
                    <td style={{ padding: "5px 6px", textAlign: "center" }}>
                      <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 2, background: "#3a3a4a30", color: "#9090a0", border: "1px solid #3a3a4a" }}>{t.setup}</span>
                    </td>
                    <td style={{ padding: "5px 6px", textAlign: "center", color: "#686878", fontSize: 10 }}>{t.date}</td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontFamily: "monospace", fontWeight: 600,
                      color: (unrealPnl + st2.realizedPnl) >= 0 ? "#2bb886" : "#f87171" }}>
                      {(unrealPnl + st2.realizedPnl) >= 0 ? "+" : ""}{(unrealPnl + st2.realizedPnl).toFixed(0)}
                      <span style={{ fontSize: 8, color: "#686878" }}> ({unrealPct >= 0 ? "+" : ""}{unrealPct.toFixed(1)}%)</span>
                      {st2.realizedPnl !== 0 && <div style={{ fontSize: 8, color: st2.realizedPnl >= 0 ? "#2bb88680" : "#f8717180" }}>
                        locked: {st2.realizedPnl >= 0 ? "+" : ""}{st2.realizedPnl.toFixed(0)}
                      </div>}
                    </td>
                    {/* Theme/Sub */}
                    <td style={{ padding: "5px 6px", textAlign: "center", color: "#686878", fontSize: 9, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={live?.themes?.[0]?.theme}>{live?.themes?.[0]?.theme || "—"}</td>
                    <td style={{ padding: "5px 6px", textAlign: "center", color: "#505060", fontSize: 9, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={live?.themes?.[0]?.subtheme}>{live?.themes?.[0]?.subtheme || "—"}</td>
                    <td style={{ padding: "5px 4px", textAlign: "center", whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
                      {closingId === t.id ? (
                        <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                          <input value={closePrice} onChange={e => setClosePrice(e.target.value)} placeholder="Exit $"
                            style={{ ...st.input, width: 60, padding: "2px 4px", fontSize: 10 }} type="number" step="0.01"
                            onKeyDown={e => { if (e.key === "Enter" && closePrice) { closeTrade(t.id, closePrice); setClosingId(null); setClosePrice(""); }}} autoFocus />
                          <span onClick={() => { if (closePrice) { closeTrade(t.id, closePrice); setClosingId(null); setClosePrice(""); }}}
                            style={{ color: "#2bb886", cursor: "pointer", fontSize: 10, fontWeight: 700 }}>✓</span>
                          <span onClick={() => { setClosingId(null); setClosePrice(""); }}
                            style={{ color: "#686878", cursor: "pointer", fontSize: 10 }}>✕</span>
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 3 }}>
                          <span onClick={() => setActionModal({ id: t.id, type: "edit",
                            entry: String(entry.toFixed(2)), stop: String(stop || ""), target: t.target || "",
                            shares: String(shares), date: t.date || "", setup: t.setup || "" })} title="Edit trade"
                            style={{ color: "#9090a0", cursor: "pointer", fontSize: 9, padding: "1px 3px", border: "1px solid #9090a030", borderRadius: 2 }}>Edit</span>
                          <span onClick={() => setActionModal({ id: t.id, type: "add", price: String(curPrice), shares: "" })} title="Add shares"
                            style={{ color: "#60a5fa", cursor: "pointer", fontSize: 9, padding: "1px 3px", border: "1px solid #60a5fa30", borderRadius: 2 }}>+Add</span>
                          <span onClick={() => setActionModal({ id: t.id, type: "trim", price: String(curPrice), shares: "" })} title="Trim shares"
                            style={{ color: "#fbbf24", cursor: "pointer", fontSize: 9, padding: "1px 3px", border: "1px solid #fbbf2430", borderRadius: 2 }}>Trim</span>
                          <span onClick={() => setActionModal({ id: t.id, type: "stop", price: String(stop), shares: "" })} title="Move stop"
                            style={{ color: "#f97316", cursor: "pointer", fontSize: 9, padding: "1px 3px", border: "1px solid #f9731630", borderRadius: 2 }}>Stop</span>
                          <span onClick={() => { setClosingId(t.id); setClosePrice(String(curPrice)); }} title="Close all"
                            style={{ color: "#f87171", cursor: "pointer", fontSize: 9, padding: "1px 3px", border: "1px solid #f8717130", borderRadius: 2 }}>Close</span>
                          <span onClick={() => deleteTrade(t.id)} title="Delete"
                            style={{ color: "#3a3a4a", cursor: "pointer", fontSize: 10 }}>✕</span>
                        </span>
                      )}
                    </td>
                  </tr>
                  {/* Inline action row for add/trim/stop/edit */}
                  {actionModal && actionModal.id === t.id && (
                    <tr style={{ background: "#1a1a2480" }}>
                      <td colSpan={15} style={{ padding: "6px 8px" }} onClick={e => e.stopPropagation()}>
                        {actionModal.type === "edit" ? (
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", fontSize: 10, flexWrap: "wrap" }}>
                            <span style={{ color: "#9090a0", fontWeight: 700, textTransform: "uppercase", alignSelf: "center" }}>EDIT</span>
                            <div><div style={st.label}>Entry</div>
                              <input value={actionModal.entry} onChange={e => setActionModal(a => ({ ...a, entry: e.target.value }))}
                                style={{ ...st.input, width: 70, padding: "2px 4px", fontSize: 10 }} type="number" step="0.01" autoFocus /></div>
                            <div><div style={st.label}>Stop</div>
                              <input value={actionModal.stop} onChange={e => setActionModal(a => ({ ...a, stop: e.target.value }))}
                                style={{ ...st.input, width: 70, padding: "2px 4px", fontSize: 10 }} type="number" step="0.01" /></div>
                            <div><div style={st.label}>Target</div>
                              <input value={actionModal.target} onChange={e => setActionModal(a => ({ ...a, target: e.target.value }))}
                                style={{ ...st.input, width: 70, padding: "2px 4px", fontSize: 10 }} type="number" step="0.01" /></div>
                            <div><div style={st.label}>Shares</div>
                              <input value={actionModal.shares} onChange={e => setActionModal(a => ({ ...a, shares: e.target.value }))}
                                style={{ ...st.input, width: 55, padding: "2px 4px", fontSize: 10 }} type="number" /></div>
                            <div><div style={st.label}>Date</div>
                              <input value={actionModal.date} onChange={e => setActionModal(a => ({ ...a, date: e.target.value }))}
                                style={{ ...st.input, width: 90, padding: "2px 4px", fontSize: 10 }} type="date" /></div>
                            <div><div style={st.label}>Setup</div>
                              <input value={actionModal.setup} onChange={e => setActionModal(a => ({ ...a, setup: e.target.value }))}
                                style={{ ...st.input, width: 70, padding: "2px 4px", fontSize: 10 }} /></div>
                            <span onClick={() => {
                              const am = actionModal;
                              setTrades(prev => prev.map(tr => {
                                if (tr.id !== am.id) return tr;
                                const newEntry = parseFloat(am.entry) || parseFloat(tr.entry) || 0;
                                const newStop = parseFloat(am.stop) || 0;
                                const newShares = parseInt(am.shares) || parseInt(tr.shares) || 0;
                                // Rebuild transactions from scratch with new values
                                const txs = [{ type: "buy", date: am.date || tr.date || "", price: newEntry, shares: newShares, note: "Edited" }];
                                if (newStop > 0) txs.push({ type: "stop", date: am.date || tr.date || "", price: newStop, note: "Edited" });
                                return { ...tr, entry: String(newEntry), stop: String(newStop), target: am.target || "0",
                                  shares: String(newShares), date: am.date || tr.date, setup: am.setup || tr.setup,
                                  transactions: txs };
                              }));
                              setActionModal(null);
                            }} style={{ color: "#2bb886", cursor: "pointer", fontWeight: 700, fontSize: 12, alignSelf: "center" }}
                              title="Save">✓</span>
                            <span onClick={() => setActionModal(null)} style={{ color: "#686878", cursor: "pointer", fontSize: 12, alignSelf: "center" }}>✕</span>
                          </div>
                        ) : (
                        <div style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 10 }}>
                          <span style={{ color: actionModal.type === "add" ? "#60a5fa" : actionModal.type === "trim" ? "#fbbf24" : "#f97316",
                            fontWeight: 700, textTransform: "uppercase" }}>{actionModal.type}</span>
                          {actionModal.type !== "stop" && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                              <span style={{ color: "#686878" }}>Shares:</span>
                              <input value={actionModal.shares} onChange={e => setActionModal(a => ({ ...a, shares: e.target.value }))}
                                style={{ ...st.input, width: 50, padding: "2px 4px", fontSize: 10 }} type="number" autoFocus />
                            </span>
                          )}
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <span style={{ color: "#686878" }}>{actionModal.type === "stop" ? "New Stop $:" : "Price $:"}</span>
                            <input value={actionModal.price} onChange={e => setActionModal(a => ({ ...a, price: e.target.value }))}
                              style={{ ...st.input, width: 65, padding: "2px 4px", fontSize: 10 }} type="number" step="0.01"
                              autoFocus={actionModal.type === "stop"}
                              onKeyDown={e => {
                                if (e.key === "Enter") {
                                  if (actionModal.type === "add" && actionModal.shares && actionModal.price) {
                                    addToTrade(actionModal.id, actionModal.shares, actionModal.price);
                                  } else if (actionModal.type === "trim" && actionModal.shares && actionModal.price) {
                                    trimTrade(actionModal.id, actionModal.shares, actionModal.price);
                                  } else if (actionModal.type === "stop" && actionModal.price) {
                                    moveStop(actionModal.id, actionModal.price);
                                  }
                                  setActionModal(null);
                                } else if (e.key === "Escape") { setActionModal(null); }
                              }} />
                          </span>
                          {actionModal.type === "trim" && (
                            <span style={{ color: "#686878" }}>
                              of {shares} ({actionModal.shares ? Math.round(parseInt(actionModal.shares) / shares * 100) : 0}%)
                            </span>
                          )}
                          <span onClick={() => {
                            if (actionModal.type === "add" && actionModal.shares && actionModal.price) addToTrade(actionModal.id, actionModal.shares, actionModal.price);
                            else if (actionModal.type === "trim" && actionModal.shares && actionModal.price) trimTrade(actionModal.id, actionModal.shares, actionModal.price);
                            else if (actionModal.type === "stop" && actionModal.price) moveStop(actionModal.id, actionModal.price);
                            setActionModal(null);
                          }} style={{ color: "#2bb886", cursor: "pointer", fontWeight: 700 }}>✓</span>
                          <span onClick={() => setActionModal(null)} style={{ color: "#686878", cursor: "pointer" }}>✕</span>
                        </div>
                        )}
                        {/* Transaction history */}
                        {t.transactions && t.transactions.length > 1 && (
                          <div style={{ marginTop: 4, fontSize: 9, color: "#505060", fontFamily: "monospace" }}>
                            {t.transactions.map((tx, ti) => (
                              <span key={ti} style={{ marginRight: 8 }}>
                                <span style={{ color: tx.type === "buy" ? "#60a5fa" : tx.type === "sell" ? "#fbbf24" : "#f97316" }}>
                                  {tx.type === "buy" ? "BUY" : tx.type === "sell" ? "SELL" : "STOP"}
                                </span>
                                {tx.shares ? ` ${tx.shares}` : ""}
                                {` @${tx.price.toFixed(2)}`}
                                <span style={{ color: "#3a3a4a" }}> {tx.date?.slice(5)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}</tbody>
            </table>
          )}
          {openTrades.length > 0 && (() => {
            const acct = parseFloat(calcAccount) || 100000;
            const totalRisk = openTrades.reduce((sum, t) => {
              const s = tradeState(t);
              return sum + Math.abs(s.avgEntry - s.curStop) * s.curShares;
            }, 0);
            const totalUnreal = openTrades.reduce((sum, t) => {
              const s = tradeState(t);
              const lp = liveMap[t.ticker];
              const cur = lp?.price || stockMap[t.ticker]?.price || s.avgEntry;
              return sum + (cur - s.avgEntry) * s.curShares;
            }, 0);
            const totalRealized = openTrades.reduce((sum, t) => sum + tradeState(t).realizedPnl, 0);
            const openHeat = acct > 0 ? (totalRisk / acct * 100) : 0;
            const totalExposure = openTrades.reduce((sum, t) => {
              const s = tradeState(t);
              const lp = liveMap[t.ticker];
              const cur = lp?.price || stockMap[t.ticker]?.price || s.avgEntry;
              return sum + cur * s.curShares;
            }, 0);
            const exposurePct = acct > 0 ? (totalExposure / acct * 100) : 0;
            return (
              <div style={{ display: "flex", gap: 16, padding: "8px 6px", borderTop: "1px solid #3a3a4a", fontSize: 10, color: "#686878", flexWrap: "wrap" }}>
                <span>Positions: {openTrades.length}</span>
                <span>Open Heat: <span style={{ color: openHeat > 6 ? "#f87171" : openHeat > 4 ? "#fbbf24" : "#2bb886", fontFamily: "monospace", fontWeight: 700 }}>
                  {openHeat.toFixed(2)}%</span> <span style={{ color: "#505060" }}>(${totalRisk.toFixed(0)})</span></span>
                <span>Exposure: <span style={{ color: exposurePct > 80 ? "#f87171" : exposurePct > 50 ? "#fbbf24" : "#9090a0", fontFamily: "monospace" }}>
                  {exposurePct.toFixed(1)}%</span></span>
                <span>Unrealized: <span style={{ color: totalUnreal >= 0 ? "#2bb886" : "#f87171", fontFamily: "monospace" }}>{totalUnreal >= 0 ? "+" : ""}${totalUnreal.toFixed(0)}</span></span>
                {totalRealized !== 0 && <span>Locked: <span style={{ color: totalRealized >= 0 ? "#2bb886" : "#f87171", fontFamily: "monospace" }}>{totalRealized >= 0 ? "+" : ""}${totalRealized.toFixed(0)}</span></span>}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Closed Trades Tab ── */}
      {tab === "closed" && (
        <TradeHistory trades={trades} setTrades={setTrades} stockMap={stockMap} onTickerClick={onTickerClick} activeTicker={activeTicker} />
      )}

    </div>
  );
}

const LiveSortHeader = memo(function LiveSortHeader({ setter, current }) {
  return (
    <thead><tr style={{ borderBottom: "2px solid #3a3a4a" }}>
      {LIVE_COLUMNS.map(([h, sk]) => (
        <th key={h || "act"} onClick={sk ? () => setter(prev => prev === sk ? "change" : sk) : undefined}
          style={{ padding: "6px 6px", color: current === sk ? "#4aad8c" : "#787888", fontWeight: 600, textAlign: "center", fontSize: 11,
            cursor: sk ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>
          {h}{current === sk ? " ▼" : ""}</th>
      ))}
    </tr></thead>
  );
});

const LiveRow = memo(function LiveRow({ s, onRemove, onAdd, addLabel, activeTicker, onTickerClick, erSipLookup }) {
  const isActive = s.ticker === activeTicker;
  const rowRef = useRef(null);
  useEffect(() => {
    // disabled auto-scroll
  }, [isActive]);
  const near = s.pct_from_high != null && s.pct_from_high >= -5;
  const chg = (v) => !v && v !== 0 ? "#686878" : v > 0 ? "#2bb886" : v < 0 ? "#f87171" : "#9090a0";
  return (
    <tr ref={rowRef} data-ticker={s.ticker} onClick={() => onTickerClick(s.ticker)} style={{ borderBottom: "1px solid #222230", cursor: "pointer",
      background: isActive ? "rgba(251, 191, 36, 0.10)" : "transparent" }}>
      <td style={{ padding: "4px 4px", textAlign: "center", whiteSpace: "nowrap" }}>
        {onRemove && <span onClick={(e) => { e.stopPropagation(); onRemove(s.ticker); }}
          style={{ color: "#686878", cursor: "pointer", fontSize: 11, marginRight: 2 }}>✕</span>}
        {onAdd && <span onClick={(e) => { e.stopPropagation(); onAdd(s.ticker); }}
          style={{ color: "#0d9163", cursor: "pointer", fontSize: 11 }}>{addLabel || "+watch"}</span>}
      </td>
      <td style={{ padding: "4px 6px", textAlign: "center", color: isActive ? "#0d9163" : "#a8a8b8", fontWeight: 500, fontSize: 12 }}>
        <span>{s.ticker}</span>
        {erSipLookup && erSipLookup[s.ticker] && <SourceBadge source={erSipLookup[s.ticker]} />}
        {s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 14 && (
          <span title={s.er && s.er.eps != null ? `EPS: $${s.er.eps.toFixed(2)} vs est $${(s.er.eps_estimated ?? 0).toFixed(2)}${s.er.revenue ? ` | Rev: $${(s.er.revenue/1e6).toFixed(0)}M` : ''}` : (s.earnings_display || s.earnings_date || `${s.earnings_days}d`)}
            style={{ marginLeft: 3, padding: "0px 3px", borderRadius: 2, fontSize: 7, fontWeight: 700, verticalAlign: "super",
              color: s.earnings_days <= 1 ? "#fff" : "#f87171",
              background: s.earnings_days <= 1 ? "#dc2626" : "#f8717120",
              border: `1px solid ${s.earnings_days <= 1 ? "#dc2626" : "#f8717130"}` }}>
            ER{s.earnings_days === 0 ? "" : s.earnings_days}
            {s.er && s.er.eps != null && s.er.eps_estimated != null && (
              <span style={{ marginLeft: 1, color: s.er.eps >= s.er.eps_estimated ? "#4ade80" : "#fca5a5" }}>
                {s.er.eps >= s.er.eps_estimated ? "✓" : "✗"}
              </span>
            )}
          </span>
        )}
      </td>
      {/* Tags */}
      <td style={{ padding: "4px 6px", textAlign: "center" }}>
        <div style={{ display: "flex", gap: 2, justifyContent: "center", flexWrap: "wrap" }}>
          {(s._scanHits || []).map(h => {
            const hc = { T: { bg: "#05966920", color: "#2bb886", label: "T" }, W: { bg: "#c084fc20", color: "#c084fc", label: "W" },
              L: { bg: "#60a5fa20", color: "#60a5fa", label: "L" }, E: { bg: "#fbbf2420", color: "#fbbf24", label: "E" },
              EP: { bg: "#f9731620", color: "#f97316", label: "EP" },
              CS: { bg: "#22d3ee20", color: "#22d3ee", label: "CS" },
              ZM: { bg: "#a78bfa20", color: "#a78bfa", label: "ZM" },
              "9M": { bg: "#e879f920", color: "#e879f9", label: "9M" } }[h];
            if (!hc) return null;
            return <span key={h} style={{ padding: "0px 3px", borderRadius: 2, fontSize: 8, fontWeight: 700,
              color: hc.color, background: hc.bg, border: `1px solid ${hc.color}30` }}>{hc.label}</span>;
          })}
        </div>
      </td>
      {/* Grade */}
      <td style={{ padding: "4px 6px", textAlign: "center" }}>{s.grade ? <Badge grade={s.grade} /> : <span style={{ color: "#3a3a4a" }}>—</span>}</td>
      {/* RS */}
      <td style={{ padding: "4px 6px", textAlign: "center", color: "#b8b8c8", fontFamily: "monospace", fontSize: 12 }}>{s.rs_rank ?? '—'}</td>
      {/* MS */}
      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
        color: s._msScore >= 80 ? "#2bb886" : s._msScore >= 60 ? "#60a5fa" : s._msScore >= 40 ? "#9090a0" : s._msScore != null ? "#686878" : "#3a3a4a" }}
        title={`RS:${s.rs_rank ?? '—'} FrHi:${s.pct_from_high ?? '—'}% 3M:${s.return_3m ?? '—'}% VCS:${s.vcs ?? '—'} EPS:${s._epsScore ?? '—'} MF:${s.mf ?? '—'} ADR:${s.adr_pct ?? '—'}%`}>
        {s._msScore ?? "—"}</td>
      {/* MF */}
      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
        color: s.mf > 30 ? "#2bb886" : s.mf > 0 ? "#4a9070" : s.mf < -30 ? "#f87171" : s.mf < 0 ? "#c06060" : s.mf != null ? "#686878" : "#3a3a4a" }}
        title={s.mf_components ? `P${s._mfPct ?? '—'} | DVol:${s.mf_components.dvol_trend} RVPers:${s.mf_components.rvol_persistence} UpVol:${s.mf_components.up_vol_ratio} PVDir:${s.mf_components.price_vol_dir}` : ""}>
        {s.mf != null ? <>{s.mf > 0 ? `+${s.mf}` : s.mf}<sup style={{ fontSize: 7, color: "#505060", marginLeft: 1 }}>{s._mfPct ?? ''}</sup></> : "—"}</td>
      {/* Chg% */}
      <td style={{ padding: "4px 6px", textAlign: "center", color: chg(s.change), fontFamily: "monospace", fontSize: 12 }}>
        {s.change != null ? `${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%` : '—'}</td>
      {/* Vol */}
      {(() => {
        const rv = s.rel_volume;
        const curVol = s.avg_volume_raw && rv ? s.avg_volume_raw * rv : null;
        const fmt = (v) => v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : v?.toFixed(0) || "—";
        return <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 12,
          color: rv >= 2 ? "#c084fc" : rv >= 1.5 ? "#a78bfa" : curVol != null ? "#686878" : "#3a3a4a" }}>
          {curVol != null ? fmt(curVol) : '—'}</td>;
      })()}
      {/* RVol */}
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 12,
        color: s.rel_volume >= 2 ? "#c084fc" : s.rel_volume >= 1.5 ? "#a78bfa" : s.rel_volume != null ? "#686878" : "#3a3a4a" }}>
        {s.rel_volume != null ? `${s.rel_volume.toFixed(1)}x` : '—'}</td>
      {/* $Vol */}
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 12,
        color: s.avg_dollar_vol_raw > 20000000 ? "#2bb886" : s.avg_dollar_vol_raw > 10000000 ? "#fbbf24" : s.avg_dollar_vol_raw > 5000000 ? "#f97316" : "#f87171" }}
        title={s.dvol_accel != null ? `$Vol Accel: ${s.dvol_accel > 0 ? '+' : ''}${s.dvol_accel} | 5d/20d: ${s.dvol_ratio_5_20}x | WoW: ${s.dvol_wow_chg > 0 ? '+' : ''}${s.dvol_wow_chg}%` : ""}>
        {s.avg_dollar_vol ? `$${s.avg_dollar_vol}` : '—'}
        {s.dvol_accel != null && <span style={{ fontSize: 8, marginLeft: 2,
          color: s.dvol_accel >= 30 ? "#2bb886" : s.dvol_accel >= 10 ? "#4a9070" : s.dvol_accel <= -30 ? "#f87171" : s.dvol_accel <= -10 ? "#c06060" : "#505060" }}>
          {s.dvol_accel >= 30 ? "▲▲" : s.dvol_accel >= 10 ? "▲" : s.dvol_accel <= -30 ? "▼▼" : s.dvol_accel <= -10 ? "▼" : "─"}</span>}
      </td>
      {/* ADR% */}
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 12,
        color: s.adr_pct > 8 ? "#2dd4bf" : s.adr_pct > 5 ? "#2bb886" : s.adr_pct > 3 ? "#fbbf24" : s.adr_pct != null ? "#f97316" : "#3a3a4a" }}>
        {s.adr_pct != null ? `${s.adr_pct}%` : '—'}</td>
      {/* VCS */}
      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
        color: s.vcs >= 80 ? "#2bb886" : s.vcs >= 60 ? "#fbbf24" : s.vcs != null ? "#686878" : "#3a3a4a" }}
        title={s.vcs_components ? `ATR:${s.vcs_components.atr_contraction} Range:${s.vcs_components.range_compression} MA:${s.vcs_components.ma_convergence} Vol:${s.vcs_components.volume_dryup} Prox:${s.vcs_components.proximity_highs}` : ""}>
        {s.vcs ?? "—"}</td>
      {/* EPS */}
      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
        color: s._epsScore >= 80 ? "#22d3ee" : s._epsScore >= 60 ? "#60a5fa" : s._epsScore >= 40 ? "#9090a0" : s._epsScore != null ? "#686878" : "#3a3a4a" }}>
        {s._epsScore ?? "—"}</td>
      {/* 3M% */}
      <td style={{ padding: "4px 6px", textAlign: "center" }}><Ret v={s.return_3m} /></td>
      {/* FrHi% */}
      <td style={{ padding: "4px 6px", textAlign: "center", color: near ? "#2bb886" : "#9090a0", fontFamily: "monospace", fontSize: 12 }}>
        {s.pct_from_high != null ? `${s.pct_from_high.toFixed != null ? s.pct_from_high.toFixed(0) : s.pct_from_high}%` : '—'}</td>
      {/* Theme */}
      <td style={{ padding: "4px 6px", textAlign: "center", color: "#686878", fontSize: 9, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.theme}>{s.theme || "—"}</td>
      {/* Sub */}
      <td style={{ padding: "4px 6px", textAlign: "center", color: "#505060", fontSize: 9, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.subtheme}>{s.subtheme || "—"}</td>
    </tr>
  );
});

function LiveSectionTable({ data, sortKey, setter, onRemove, onAdd, addLabel, activeTicker, onTickerClick, erSipLookup }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <LiveSortHeader setter={setter} current={sortKey} />
      <tbody>
        {data.map(s => <LiveRow key={s.ticker} s={s} onRemove={onRemove} onAdd={onAdd} addLabel={addLabel}
          activeTicker={activeTicker} onTickerClick={onTickerClick} erSipLookup={erSipLookup} />)}
      </tbody>
    </table>
  );
}

// ── EARNINGS CALENDAR SLIDE-OUT ──
function EarningsCalendar({ stockMap, onTickerClick, onClose }) {
  const [range, setRange] = useState(14); // days to show
  const [minRS, setMinRS] = useState(0);
  const [minGrade, setMinGrade] = useState("all"); // "all", "A", "B", "C"

  // ESC to close
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Build earnings list from entire stockMap
  const earningsList = useMemo(() => {
    if (!stockMap) return [];
    const now = new Date();
    const results = [];

    Object.values(stockMap).forEach(s => {
      let days = s.earnings_days;
      let dateStr = s.earnings_display || s.earnings_date || "";

      // If earnings_days not set but earnings_date exists, parse it
      if (days == null && s.earnings_date) {
        try {
          const raw = s.earnings_date.replace(/\s*(AMC|BMO|a|b)\s*$/i, "").trim();
          const parts = raw.split(/\s+/);
          if (parts.length >= 2) {
            const year = now.getFullYear();
            // Try current year, then next year
            for (const y of [year, year + 1]) {
              const parsed = new Date(`${parts[0]} ${parts[1]}, ${y}`);
              if (!isNaN(parsed)) {
                const diff = Math.floor((parsed - now) / 86400000);
                if (diff >= -1) {
                  days = diff;
                  dateStr = s.earnings_date + (s.earnings_display ? "" : ` (${diff}d)`);
                  break;
                }
              }
            }
          }
        } catch {}
      }

      if (days != null && days >= -1 && days <= range) {
        // Apply RS filter
        if (minRS > 0 && (s.rs_rank == null || s.rs_rank < minRS)) return;
        // Apply grade filter
        const GRADE_RANK = {"A+":12,"A":11,"A-":10,"B+":9,"B":8,"B-":7,"C+":6,"C":5,"C-":4,"D+":3,"D":2,"D-":1};
        const gradeThreshold = minGrade === "A" ? 10 : minGrade === "B" ? 7 : minGrade === "C" ? 4 : 0;
        if (gradeThreshold > 0 && (GRADE_RANK[s.grade] || 0) < gradeThreshold) return;
        results.push({
          ticker: s.ticker,
          company: s.company || "",
          days,
          date: dateStr,
          grade: s.grade,
          rs_rank: s.rs_rank,
          return_3m: s.return_3m,
          pct_from_high: s.pct_from_high,
          theme: s.themes?.[0]?.theme || "",
          market_cap: s.market_cap || "",
        });
      }
    });

    return results.sort((a, b) => a.days - b.days);
  }, [stockMap, range, minRS, minGrade]);

  // Group by day
  const grouped = useMemo(() => {
    const g = {};
    earningsList.forEach(e => {
      const key = e.days <= 0 ? "Today" : e.days === 1 ? "Tomorrow" : `${e.days}d`;
      if (!g[key]) g[key] = { label: key, days: e.days, items: [] };
      g[key].items.push(e);
    });
    return Object.values(g).sort((a, b) => a.days - b.days);
  }, [earningsList]);

  const dayColor = (days) => days <= 0 ? "#f87171" : days <= 1 ? "#f59e0b" : days <= 3 ? "#c084fc" : "#686878";

  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: 380, height: "100vh", background: "#121218",
      borderRight: "1px solid #2a2a38", zIndex: 1000, display: "flex", flexDirection: "column",
      boxShadow: "4px 0 20px rgba(0,0,0,0.5)" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #2a2a38", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#c084fc", letterSpacing: 1, flex: 1 }}>EARNINGS CALENDAR</span>
        <span style={{ fontSize: 11, color: "#9090a0" }}>{earningsList.length} reports</span>
        {earningsList.length === 0 && stockMap && (
          <span style={{ fontSize: 10, color: "#686878" }}>
            ({Object.values(stockMap).filter(s => s.earnings_date).length} have dates)
          </span>
        )}
        <select value={range} onChange={e => setRange(+e.target.value)}
          style={{ background: "#1a1a24", border: "1px solid #3a3a4a", color: "#9090a0", borderRadius: 4, fontSize: 11, padding: "2px 4px" }}>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={21}>21 days</option>
          <option value={30}>30 days</option>
        </select>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#787888", fontSize: 16, cursor: "pointer", padding: "0 4px" }}>×</button>
      </div>

      {/* Filters */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #222230", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "#787888" }}>RS≥</span>
        <input type="range" min={0} max={90} step={10} value={minRS} onChange={e => setMinRS(+e.target.value)}
          style={{ width: 70, accentColor: "#c084fc" }} />
        <span style={{ fontSize: 11, color: "#9090a0", fontFamily: "monospace", width: 20 }}>{minRS || "—"}</span>
        <span style={{ color: "#2a2a38" }}>|</span>
        {["all", "A", "B", "C"].map(g => (
          <button key={g} onClick={() => setMinGrade(g)} style={{ padding: "1px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
            border: minGrade === g ? "1px solid #c084fc" : "1px solid #2a2a38",
            background: minGrade === g ? "#c084fc18" : "transparent",
            color: minGrade === g ? "#c084fc" : "#686878" }}>{g === "all" ? "All" : `${g}+`}</button>
        ))}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {grouped.length === 0 && (
          <div style={{ color: "#686878", fontSize: 12, padding: 20, textAlign: "center" }}>No upcoming earnings in the theme universe.</div>
        )}
        {grouped.map(group => (
          <div key={group.label} style={{ marginBottom: 12 }}>
            {/* Day header */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "4px 0", borderBottom: "1px solid #222230" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: dayColor(group.days) }}>{group.label}</span>
              {group.items[0]?.date && <span style={{ fontSize: 10, color: "#686878" }}>{group.items[0].date}</span>}
              <span style={{ fontSize: 10, color: "#505060", background: "#1a1a24", padding: "1px 6px", borderRadius: 8 }}>{group.items.length}</span>
            </div>
            {/* Stocks */}
            {group.items.map(e => (
              <div key={e.ticker} onClick={() => onTickerClick(e.ticker)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 4,
                  cursor: "pointer", marginBottom: 1 }}
                onMouseEnter={ev => ev.currentTarget.style.background = "#1a1a24"}
                onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                <span style={{ fontWeight: 500, fontSize: 12, color: "#a8a8b8", width: 50 }}>{e.ticker}</span>
                {e.grade && <Badge grade={e.grade} />}
                <span style={{ fontSize: 11, color: "#9090a0", fontFamily: "monospace", width: 28, textAlign: "right" }}>{e.rs_rank ?? '—'}</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", width: 45, textAlign: "right",
                  color: e.return_3m > 0 ? "#2bb886" : e.return_3m < 0 ? "#f87171" : "#9090a0" }}>
                  {e.return_3m != null ? `${e.return_3m > 0 ? '+' : ''}${e.return_3m}%` : ''}</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", width: 40, textAlign: "right",
                  color: e.pct_from_high >= -5 ? "#2bb886" : "#9090a0" }}>
                  {e.pct_from_high != null ? `${e.pct_from_high}%` : ''}</span>
                <span style={{ flex: 1, fontSize: 10, color: "#686878", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.theme}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer legend */}
      <div style={{ padding: "8px 16px", borderTop: "1px solid #2a2a38", display: "flex", gap: 12, fontSize: 10, color: "#686878" }}>
        <span>RS | 3M% | FrHi% | Theme</span>
        <span style={{ marginLeft: "auto" }}>Click ticker to chart</span>
      </div>
    </div>
  );
}

function TickerInput({ value, setValue, onAdd, placeholder }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input value={value} onChange={e => setValue(e.target.value.toUpperCase())}
        onKeyDown={e => e.key === "Enter" && onAdd()}
        placeholder={placeholder || "Add ticker..."}
        style={{ background: "#222230", border: "1px solid #3a3a4a", borderRadius: 4, padding: "3px 8px",
          fontSize: 12, color: "#d4d4e0", width: 80, outline: "none", fontFamily: "monospace" }} />
      <button onClick={onAdd} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
        background: "#0d916320", border: "1px solid #0d916340", color: "#0d9163" }}>+</button>
    </span>
  );
}

function MorningBriefing({ portfolio, watchlist, stockMap, liveData, themeHealth, themes, onTickerClick }) {
  const allTickers = useMemo(() => [...new Set([...portfolio, ...watchlist])], [portfolio, watchlist]);

  // Build live lookup
  const liveLookup = useMemo(() => {
    const m = {};
    (liveData?.watchlist || []).forEach(s => { m[s.ticker] = s; });
    return m;
  }, [liveData]);

  // 1. Gaps — tickers with significant change% (>3% or <-3%)
  const gaps = useMemo(() => {
    return allTickers.map(t => {
      const live = liveLookup[t];
      const chg = live?.change;
      if (chg == null) return null;
      return { ticker: t, change: chg };
    }).filter(g => g && Math.abs(g.change) >= 3)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  }, [allTickers, liveLookup]);

  // 2. Earnings in next 7 days
  const earnings = useMemo(() => {
    return allTickers.map(t => {
      const s = stockMap?.[t];
      if (!s) return null;
      const days = s.earnings_days;
      const date = s.earnings_display || s.earnings_date;
      if (days == null || days < 0 || days > 7) return null;
      return { ticker: t, days, date };
    }).filter(Boolean).sort((a, b) => a.days - b.days);
  }, [allTickers, stockMap]);

  // 3. Theme rotation signals
  const rotation = useMemo(() => {
    if (!themeHealth || !themes) return { add: [], remove: [], weakening: [] };
    const trackedThemes = new Set();
    allTickers.forEach(t => {
      const s = stockMap?.[t];
      if (s?.themes) s.themes.forEach(th => trackedThemes.add(th.theme));
    });
    const add = [], remove = [], weakening = [];
    themeHealth.forEach(h => {
      if (h.action === "ADD") add.push(h.theme);
      else if (h.action === "REMOVE") remove.push(h.theme);
      else if (h.status === "WEAKENING" && trackedThemes.has(h.theme)) weakening.push(h.theme);
    });
    return { add, remove, weakening };
  }, [themeHealth, themes, allTickers, stockMap]);

  const [collapsed, setCollapsed] = useState(false);

  // All hooks called — now safe to return early
  if (allTickers.length === 0) return null;
  const hasAlerts = gaps.length > 0 || earnings.length > 0 || rotation.add.length > 0 || rotation.remove.length > 0 || rotation.weakening.length > 0;

  const chipStyle = (bg, color) => ({
    display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4,
    fontSize: 11, fontWeight: 700, fontFamily: "monospace", cursor: "pointer", background: bg, color
  });

  return (
    <div style={{ background: "linear-gradient(135deg, #0f1a14 0%, #111318 50%, #15101a 100%)",
      border: "1px solid #1a2a1f", borderRadius: 8, padding: collapsed ? "8px 16px" : "12px 16px", marginBottom: 16 }}>
      <div onClick={() => setCollapsed(p => !p)}
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
        <span style={{ fontSize: 11, color: "#686878" }}>{collapsed ? "▸" : "▾"}</span>
        <span style={{ fontSize: 13, fontWeight: 900, color: "#0d9163", letterSpacing: 1 }}>MORNING BRIEFING</span>
        <span style={{ fontSize: 10, color: "#686878" }}>{new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
        <span style={{ fontSize: 10, color: "#686878" }}>|</span>
        <span style={{ fontSize: 10, color: "#9090a0" }}>Tracking {allTickers.length} tickers</span>
        {!hasAlerts && <span style={{ fontSize: 10, color: "#686878" }}>— No alerts right now</span>}
        {hasAlerts && collapsed && <span style={{ fontSize: 10, color: "#0d9163" }}>
          {gaps.length > 0 ? `${gaps.length} gaps` : ""}{gaps.length > 0 && earnings.length > 0 ? " · " : ""}{earnings.length > 0 ? `${earnings.length} earnings` : ""}
        </span>}
      </div>

      {!collapsed && hasAlerts && (
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* Gaps */}
        {gaps.length > 0 && (
          <div style={{ minWidth: 140 }}>
            <div style={{ fontSize: 10, color: "#9090a0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
              Gaps ({gaps.length})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {gaps.map(g => (
                <span key={g.ticker} onClick={() => onTickerClick(g.ticker)}
                  style={chipStyle(g.change > 0 ? "#0d916318" : "#f8717118", g.change > 0 ? "#2bb886" : "#f87171")}>
                  {g.ticker} <span style={{ fontSize: 10 }}>{g.change > 0 ? "+" : ""}{g.change.toFixed(1)}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Earnings */}
        {earnings.length > 0 && (
          <div style={{ minWidth: 140 }}>
            <div style={{ fontSize: 10, color: "#9090a0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
              Earnings Next 7d ({earnings.length})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {earnings.map(e => (
                <span key={e.ticker} onClick={() => onTickerClick(e.ticker)}
                  style={chipStyle(e.days <= 1 ? "#f8717118" : "#c084fc18", e.days <= 1 ? "#f87171" : "#c084fc")}>
                  {e.ticker} <span style={{ fontSize: 10 }}>{e.days === 0 ? "TODAY" : e.days === 1 ? "TMR" : `${e.days}d`}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Theme Rotation */}
        {(rotation.add.length > 0 || rotation.remove.length > 0 || rotation.weakening.length > 0) && (
          <div style={{ minWidth: 140 }}>
            <div style={{ fontSize: 10, color: "#9090a0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
              Theme Rotation
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {rotation.add.map(t => (
                <span key={t} style={chipStyle("#0d916318", "#2bb886")}>★ {t}</span>
              ))}
              {rotation.remove.map(t => (
                <span key={t} style={chipStyle("#f8717118", "#f87171")}>✕ {t}</span>
              ))}
              {rotation.weakening.map(t => (
                <span key={t} style={chipStyle("#fbbf2418", "#fbbf24")}>↓ {t}</span>
              ))}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ── PKN TAB ──
function PknView({ stockMap, onTickerClick, activeTicker, onVisibleTickers, pkn, setPkn, pknWatch, setPknWatch, addToPkn, removeFromPkn, addToPknWatch, removeFromPknWatch, liveThemeData }) {
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [addTickerP, setAddTickerP] = useState("");
  const [addTickerW, setAddTickerW] = useState("");
  const [pSort, setPSort] = useState("change");
  const [wlSort, setWlSort] = useState("change");

  const allTickers = useMemo(() => [...new Set([...pkn, ...pknWatch])], [pkn, pknWatch]);

  const fetchLive = useCallback(async () => {
    if (allTickers.length === 0) { setLoading(false); return; }
    try {
      const params = new URLSearchParams();
      params.set("tickers", allTickers.join(","));
      const resp = await fetch(`/api/live?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || "API error");
      setLiveData(json);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [allTickers]);

  useEffect(() => { fetchLive(); const iv = setInterval(fetchLive, 60000); return () => clearInterval(iv); }, [fetchLive]);

  const liveLookup = useMemo(() => {
    const m = {};
    if (liveThemeData) liveThemeData.forEach(s => { if (s.ticker) m[s.ticker] = s; });
    (liveData?.watchlist || []).forEach(s => { if (s.ticker) m[s.ticker] = { ...m[s.ticker], ...s }; });
    return m;
  }, [liveData?.watchlist, liveThemeData]);

  const mergeStock = useCallback((ticker) => {
    const live = liveLookup[ticker] || {};
    const pipe = stockMap?.[ticker] || {};
    const { quality, q_factors } = computeStockQuality(pipe);
    return {
      ticker,
      price: live.price ?? pipe.price,
      change: live.change,
      rel_volume: live.rel_volume ?? pipe.rel_volume,
      avg_volume_raw: pipe.avg_volume_raw,
      grade: pipe.grade, rs_rank: pipe.rs_rank,
      return_1m: live.perf_month ?? pipe.return_1m,
      return_3m: live.perf_quart ?? pipe.return_3m,
      pct_from_high: live.high_52w ?? pipe.pct_from_high,
      atr_to_50: pipe.atr_to_50, adr_pct: pipe.adr_pct,
      eps_past_5y: pipe.eps_past_5y, eps_this_y: pipe.eps_this_y,
      eps_qq: pipe.eps_qq, eps_yoy: pipe.eps_yoy,
      sales_past_5y: pipe.sales_past_5y, sales_qq: pipe.sales_qq, sales_yoy: pipe.sales_yoy,
      pe: live.pe ?? pipe.pe, roe: pipe.roe, profit_margin: pipe.profit_margin,
      rsi: live.rsi ?? pipe.rsi,
      themes: pipe.themes || [],
      theme: pipe.themes?.[0]?.theme || live.sector || "",
      subtheme: pipe.themes?.[0]?.subtheme || "",
      company: live.company || pipe.company || "",
      vcs: pipe.vcs, vcs_components: pipe.vcs_components,
      mf: pipe.mf, mf_components: pipe.mf_components, _mfPct: pipe._mfPct,
      avg_dollar_vol: pipe.avg_dollar_vol, avg_dollar_vol_raw: pipe.avg_dollar_vol_raw,
      dvol_accel: pipe.dvol_accel, dvol_ratio_5_20: pipe.dvol_ratio_5_20, dvol_wow_chg: pipe.dvol_wow_chg,
      earnings_days: pipe.earnings_days, earnings_display: pipe.earnings_display, earnings_date: pipe.earnings_date, er: pipe.er,
      _scanHits: pipe._scanHits || [], _epsScore: pipe._epsScore, _msScore: pipe._msScore,
      _quality: quality, _q_factors: q_factors,
    };
  }, [liveLookup, stockMap]);

  const handleAddP = () => { const t = addTickerP.trim().toUpperCase(); if (t) addToPkn(t); setAddTickerP(""); };
  const handleAddW = () => { const t = addTickerW.trim().toUpperCase(); if (t) addToPknWatch(t); setAddTickerW(""); };

  const sortFn = (key, desc = true) => (a, b) => {
    const av = a[key] ?? (desc ? -Infinity : Infinity);
    const bv = b[key] ?? (desc ? -Infinity : Infinity);
    return desc ? bv - av : av - bv;
  };
  const makeSorters = () => ({
    ticker: (a, b) => a.ticker.localeCompare(b.ticker),
    quality: sortFn("_quality"), eps_score: sortFn("_epsScore"), ms_score: sortFn("_msScore"),
    hits: (a, b) => ((b._scanHits?.length || 0) - (a._scanHits?.length || 0)) || ((b.rs_rank ?? 0) - (a.rs_rank ?? 0)),
    vcs: sortFn("vcs"), mf: sortFn("mf"),
    change: sortFn("change"), rs: sortFn("rs_rank"), ret3m: sortFn("return_3m"),
    fromhi: (a, b) => (b.pct_from_high ?? -999) - (a.pct_from_high ?? -999),
    atr50: sortFn("atr_to_50"), adr: sortFn("adr_pct"), dvol: sortFn("avg_dollar_vol_raw"),
    vol: (a, b) => {
      const av = a.avg_volume_raw && a.rel_volume ? a.avg_volume_raw * a.rel_volume : 0;
      const bv = b.avg_volume_raw && b.rel_volume ? b.avg_volume_raw * b.rel_volume : 0;
      return bv - av;
    },
    rel_volume: sortFn("rel_volume"), volume: sortFn("avg_volume_raw"),
    pe: (a, b) => (a.pe ?? 9999) - (b.pe ?? 9999),
    roe: sortFn("roe"), margin: sortFn("profit_margin"),
    rsi: sortFn("rsi"), price: sortFn("price"),
    theme: (a, b) => (a.theme || "").localeCompare(b.theme || ""),
    subtheme: (a, b) => (a.subtheme || "").localeCompare(b.subtheme || ""),
  });
  const sortList = (list, sortKey) => {
    const sorters = makeSorters();
    const sorted = [...list];
    if (sorters[sortKey]) sorted.sort(sorters[sortKey]);
    return sorted;
  };

  const pknMerged = useMemo(() => sortList(pkn.map(mergeStock), pSort), [pkn, mergeStock, pSort, liveLookup]);
  const pknWatchMerged = useMemo(() => sortList(pknWatch.map(mergeStock), wlSort), [pknWatch, mergeStock, wlSort, liveLookup]);

  useEffect(() => {
    if (!onVisibleTickers) return;
    const pT = pknMerged.map(s => s.ticker);
    const wT = pknWatchMerged.map(s => s.ticker);
    onVisibleTickers([...pT, ...wT.filter(t => !pT.includes(t))]);
  }, [pSort, wlSort, pkn, pknWatch, liveData]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: loading ? "#fbbf24" : "#2bb886" }}>●</span>
          <span style={{ fontSize: 12, color: "#9090a0" }}>
            {loading ? "Loading..." : lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : ""}
          </span>
          <span style={{ fontSize: 11, color: "#686878" }}>Auto-refresh 60s</span>
          <button onClick={fetchLive} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
            background: "#222230", border: "1px solid #3a3a4a", color: "#9090a0" }}>↻ Refresh</button>
        </div>
        {error && <span style={{ fontSize: 11, color: "#f87171" }}>Error: {error}</span>}
      </div>

      {/* PKN */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "#e879f9", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            PKN ({pkn.length})
          </span>
          <TickerInput value={addTickerP} setValue={setAddTickerP} onAdd={handleAddP} />
        </div>
        {pkn.length === 0 ? (
          <div style={{ color: "#686878", fontSize: 12, padding: 10, background: "#141420", borderRadius: 6, border: "1px solid #222230" }}>
            Add tickers above or click <span style={{ color: "#e879f9" }}>+ PKN</span> on charts.
          </div>
        ) : (
          <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={pknMerged} sortKey={pSort} setter={setPSort} onRemove={removeFromPkn} />
        )}
      </div>

      {/* PKN Watch */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "#a78bfa", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            PKN Watch ({pknWatch.length})
          </span>
          <TickerInput value={addTickerW} setValue={setAddTickerW} onAdd={handleAddW} />
        </div>
        {pknWatch.length === 0 ? (
          <div style={{ color: "#686878", fontSize: 12, padding: 10, background: "#141420", borderRadius: 6, border: "1px solid #222230" }}>
            Add tickers above or click <span style={{ color: "#a78bfa" }}>+ PKN W</span> on charts.
          </div>
        ) : (
          <div style={{ maxHeight: 464, overflowY: "auto", border: "1px solid #222230", borderRadius: 4 }}>
            <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={pknWatchMerged} sortKey={wlSort} setter={setWlSort} onRemove={removeFromPknWatch} />
          </div>
        )}
      </div>
    </div>
  );
}

function LiveView({ stockMap, onTickerClick, activeTicker, onVisibleTickers, portfolio, setPortfolio, watchlist, setWatchlist, addToWatchlist, removeFromWatchlist, addToPortfolio, removeFromPortfolio, liveThemeData, homepage, erSipLookup }) {
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [addTickerP, setAddTickerP] = useState("");
  const [addTickerW, setAddTickerW] = useState("");
  const [pSort, setPSort] = useState("change");
  const [wlSort, setWlSort] = useState("change");
  const [marketOpen, setMarketOpen] = useState(true);

  // Combine all tickers for API call — watchlist + portfolio
  const allTickers = useMemo(() => [...new Set([...portfolio, ...watchlist])], [portfolio, watchlist]);

  const fetchLive = useCallback(async () => {
    if (allTickers.length === 0) { setLoading(false); return; }
    try {
      const params = new URLSearchParams();
      params.set("tickers", allTickers.join(","));
      const resp = await fetch(`/api/live?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || "API error");
      setLiveData(json);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [allTickers]);

  useEffect(() => { fetchLive(); const iv = setInterval(fetchLive, 60000); return () => clearInterval(iv); }, [fetchLive]);

  // Build merged lookup: live data + theme universe data + pipeline stockMap
  const liveLookup = useMemo(() => {
    const m = {};
    // Theme universe data as base (has change/rel_volume for all ~2012 tickers)
    if (liveThemeData) liveThemeData.forEach(s => { if (s.ticker) m[s.ticker] = s; });
    // Watchlist-specific data overwrites (has more fields like perf_month, pe, etc.)
    (liveData?.watchlist || []).forEach(s => { if (s.ticker) m[s.ticker] = { ...m[s.ticker], ...s }; });
    return m;
  }, [liveData?.watchlist, liveThemeData]);

  // Merge live + pipeline data for a ticker
  const mergeStock = useCallback((ticker) => {
    const live = liveLookup[ticker] || {};
    const pipe = stockMap?.[ticker] || {};
    const { quality, q_factors } = computeStockQuality(pipe);
    return {
      ticker,
      price: live.price ?? pipe.price,
      change: live.change,
      rel_volume: live.rel_volume ?? pipe.rel_volume,
      avg_volume_raw: pipe.avg_volume_raw,

      grade: pipe.grade,
      rs_rank: pipe.rs_rank,
      return_1m: live.perf_month ?? pipe.return_1m,
      return_3m: live.perf_quart ?? pipe.return_3m,
      pct_from_high: live.high_52w ?? pipe.pct_from_high,
      atr_to_50: pipe.atr_to_50,
      adr_pct: pipe.adr_pct,
      eps_past_5y: pipe.eps_past_5y,
      eps_this_y: pipe.eps_this_y,
      eps_qq: pipe.eps_qq,
      eps_yoy: pipe.eps_yoy,
      sales_past_5y: pipe.sales_past_5y,
      sales_qq: pipe.sales_qq,
      sales_yoy: pipe.sales_yoy,
      pe: live.pe ?? pipe.pe,
      roe: pipe.roe,
      profit_margin: pipe.profit_margin,
      rsi: live.rsi ?? pipe.rsi,
      themes: pipe.themes || [],
      theme: pipe.themes?.[0]?.theme || live.sector || "",
      subtheme: pipe.themes?.[0]?.subtheme || "",
      company: live.company || pipe.company || "",
      // Additional fields for column parity with Scan
      vcs: pipe.vcs,
      vcs_components: pipe.vcs_components,
      mf: pipe.mf,
      mf_components: pipe.mf_components,
      _mfPct: pipe._mfPct,
      avg_dollar_vol: pipe.avg_dollar_vol,
      avg_dollar_vol_raw: pipe.avg_dollar_vol_raw,
      dvol_accel: pipe.dvol_accel,
      dvol_ratio_5_20: pipe.dvol_ratio_5_20,
      dvol_wow_chg: pipe.dvol_wow_chg,
      earnings_days: pipe.earnings_days,
      earnings_display: pipe.earnings_display,
      earnings_date: pipe.earnings_date,
      er: pipe.er,
      _scanHits: pipe._scanHits || [],
      _epsScore: pipe._epsScore,
      _msScore: pipe._msScore,
      _quality: quality,
      _q_factors: q_factors,
    };
  }, [liveLookup, stockMap]);

  // Merge for volume gainers (no pipeline data typically)
  const handleAddP = () => { const t = addTickerP.trim().toUpperCase(); if (t) addToPortfolio(t); setAddTickerP(""); };
  const handleAddW = () => { const t = addTickerW.trim().toUpperCase(); if (t) addToWatchlist(t); setAddTickerW(""); };

  const sortFn = (key, desc = true) => (a, b) => {
    const av = a[key] ?? (desc ? -Infinity : Infinity);
    const bv = b[key] ?? (desc ? -Infinity : Infinity);
    return desc ? bv - av : av - bv;
  };

  const makeSorters = () => ({
    ticker: (a, b) => a.ticker.localeCompare(b.ticker),
    quality: sortFn("_quality"),
    eps_score: sortFn("_epsScore"),
    ms_score: sortFn("_msScore"),
    hits: (a, b) => ((b._scanHits?.length || 0) - (a._scanHits?.length || 0)) || ((b.rs_rank ?? 0) - (a.rs_rank ?? 0)),
    vcs: sortFn("vcs"),
    mf: sortFn("mf"),
    change: sortFn("change"), rs: sortFn("rs_rank"), ret3m: sortFn("return_3m"),
    fromhi: (a, b) => (b.pct_from_high ?? -999) - (a.pct_from_high ?? -999),
    atr50: sortFn("atr_to_50"), adr: sortFn("adr_pct"),
    dvol: sortFn("avg_dollar_vol_raw"),
    vol: (a, b) => {
      const av = a.avg_volume_raw && a.rel_volume ? a.avg_volume_raw * a.rel_volume : 0;
      const bv = b.avg_volume_raw && b.rel_volume ? b.avg_volume_raw * b.rel_volume : 0;
      return bv - av;
    },
    rel_volume: sortFn("rel_volume"),
    volume: sortFn("avg_volume_raw"),
    pe: (a, b) => (a.pe ?? 9999) - (b.pe ?? 9999),
    roe: sortFn("roe"), margin: sortFn("profit_margin"),
    rsi: sortFn("rsi"), price: sortFn("price"),
    theme: (a, b) => (a.theme || "").localeCompare(b.theme || ""),
    subtheme: (a, b) => (a.subtheme || "").localeCompare(b.subtheme || ""),
  });

  const sortList = (list, sortKey) => {
    const sorters = makeSorters();
    const sorted = [...list];
    if (sorters[sortKey]) sorted.sort(sorters[sortKey]);
    return sorted;
  };

  const portfolioMerged = useMemo(() => sortList(portfolio.map(mergeStock), pSort), [portfolio, mergeStock, pSort, liveLookup]);
  const watchlistMerged = useMemo(() => sortList(watchlist.map(mergeStock), wlSort), [watchlist, mergeStock, wlSort, liveLookup]);
  useEffect(() => {
    if (!onVisibleTickers) return;
    const pTickers = portfolioMerged.map(s => s.ticker);
    const wTickers = watchlistMerged.map(s => s.ticker);
    const combined = [...pTickers, ...wTickers.filter(t => !pTickers.includes(t))];
    onVisibleTickers(combined);
  }, [pSort, wlSort, portfolio, watchlist, liveData]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* Status bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: loading ? "#fbbf24" : "#2bb886" }}>●</span>
          <span style={{ fontSize: 12, color: "#9090a0" }}>
            {loading ? "Loading..." : lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : ""}
          </span>
          <span style={{ fontSize: 11, color: "#686878" }}>Auto-refresh 30s</span>
          <button onClick={fetchLive} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
            background: "#222230", border: "1px solid #3a3a4a", color: "#9090a0" }}>↻ Refresh</button>
        </div>
        {error && <span style={{ fontSize: 11, color: "#f87171" }}>Error: {error}</span>}
      </div>

      {/* Index ETF Strip — real-time from theme universe */}
      {liveThemeData && liveThemeData.length > 0 && (() => {
        const indices = [
          { ticker: "DIA", name: "DOW" },
          { ticker: "QQQ", name: "NASDAQ" },
          { ticker: "SPY", name: "S&P 500" },
          { ticker: "IWM", name: "RUSSELL" },
        ];
        const lookup = {};
        liveThemeData.forEach(s => { lookup[s.ticker] = s; });
        const found = indices.filter(idx => lookup[idx.ticker]);
        if (found.length === 0) return null;
        return (
          <div style={{ display: "flex", gap: 16, marginBottom: 10, padding: "6px 12px", background: "#141420", borderRadius: 6, border: "1px solid #222230", alignItems: "center", flexWrap: "wrap" }}>
            {found.map(idx => {
              const d = lookup[idx.ticker];
              const chg = d.change;
              const isPos = chg > 0;
              const isNeg = chg < 0;
              return (
                <div key={idx.ticker} style={{ display: "flex", alignItems: "baseline", gap: 6, cursor: "pointer" }}
                  onClick={() => onTickerClick(idx.ticker)}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: "#d4d4e0" }}>{idx.name}</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: "#9090a0" }}>{d.price?.toFixed(2)}</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700,
                    color: isPos ? "#2bb886" : isNeg ? "#f87171" : "#9090a0" }}>
                    {chg != null ? `${isPos ? '+' : ''}${chg.toFixed(2)}%` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Market Stats Breadth Bars */}
      {homepage?.market_stats && Object.keys(homepage.market_stats).length > 0 && (() => {
        const ms = homepage.market_stats;
        const StatBox = ({ leftLabel, leftPct, leftCount, rightLabel, rightPct, rightCount, midLabel }) => (
          <div style={{ background: "#141420", border: "1px solid #222230", borderRadius: 6, padding: "6px 10px", flex: 1, minWidth: 160 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
              <span style={{ color: "#9090a0" }}>{leftLabel}</span>
              {midLabel && <span style={{ color: "#686878", fontWeight: 700 }}>{midLabel}</span>}
              <span style={{ color: "#9090a0" }}>{rightLabel}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "monospace", marginBottom: 3 }}>
              <span style={{ color: "#2bb886", fontWeight: 700 }}>{leftPct}% <span style={{ color: "#505060", fontWeight: 400 }}>({leftCount})</span></span>
              <span style={{ color: "#f87171", fontWeight: 700 }}><span style={{ color: "#505060", fontWeight: 400 }}>({rightCount})</span> {rightPct}%</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: "#f87171", overflow: "hidden" }}>
              <div style={{ width: `${leftPct}%`, height: "100%", background: "#2bb886", borderRadius: 2 }} />
            </div>
          </div>
        );
        return (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {ms.advancing && ms.declining && (
              <StatBox leftLabel="Advancing" leftPct={ms.advancing.pct} leftCount={ms.advancing.count}
                rightLabel="Declining" rightPct={ms.declining.pct} rightCount={ms.declining.count} />
            )}
            {ms.new_high && ms.new_low && (
              <StatBox leftLabel="New High" leftPct={ms.new_high.pct} leftCount={ms.new_high.count}
                rightLabel="New Low" rightPct={ms.new_low.pct} rightCount={ms.new_low.count} />
            )}
            {ms.sma50_above && ms.sma50_below && (
              <StatBox leftLabel="Above" leftPct={ms.sma50_above.pct} leftCount={ms.sma50_above.count}
                midLabel="SMA50" rightLabel="Below" rightPct={ms.sma50_below.pct} rightCount={ms.sma50_below.count} />
            )}
            {ms.sma200_above && ms.sma200_below && (
              <StatBox leftLabel="Above" leftPct={ms.sma200_above.pct} leftCount={ms.sma200_above.count}
                midLabel="SMA200" rightLabel="Below" rightPct={ms.sma200_below.pct} rightCount={ms.sma200_below.count} />
            )}
          </div>
        );
      })()}

      {/* ── Homepage: Futures, Earnings, Major News ── */}
      {homepage && (
        <div style={{ marginBottom: 16 }}>
          <div onClick={() => setMarketOpen(p => !p)}
            style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: marketOpen ? 8 : 0, userSelect: "none" }}>
            <span style={{ color: "#505060", fontSize: 10, transition: "transform 0.2s", transform: marketOpen ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#686878", textTransform: "uppercase", letterSpacing: 0.5 }}>Market Overview</span>
          </div>
          {marketOpen && (
          <div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
          {/* Futures */}
          <div style={{ background: "#141420", border: "1px solid #222230", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#9090a0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Futures</div>
            {homepage.futures && homepage.futures.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                <tbody>
                  {homepage.futures.map((f, i) => {
                    const isPos = f.change_pct?.includes("+") || (!f.change_pct?.includes("-") && parseFloat(f.change) > 0);
                    const isNeg = f.change_pct?.includes("-") || parseFloat(f.change) < 0;
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #1a1a24" }}>
                        <td style={{ padding: "3px 4px", color: "#b8b8c8", fontWeight: 600 }}>{f.label}</td>
                        <td style={{ padding: "3px 4px", textAlign: "right", color: "#9090a0" }}>{f.last}</td>
                        <td style={{ padding: "3px 4px", textAlign: "right", color: isPos ? "#2bb886" : isNeg ? "#f87171" : "#9090a0" }}>{f.change}</td>
                        <td style={{ padding: "3px 4px", textAlign: "right", fontWeight: 700, color: isPos ? "#2bb886" : isNeg ? "#f87171" : "#9090a0" }}>{f.change_pct}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <span style={{ color: "#505060", fontSize: 10 }}>Loading futures...</span>}
          </div>

          {/* Earnings Release */}
          <div style={{ background: "#141420", border: "1px solid #222230", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#9090a0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Earnings Release</div>
            {homepage.earnings && homepage.earnings.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                <tbody>
                  {homepage.earnings.map((e, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1a1a24" }}>
                      <td style={{ padding: "3px 4px", color: "#686878", whiteSpace: "nowrap", width: 70, verticalAlign: "top" }}>{e.date}</td>
                      <td style={{ padding: "3px 4px" }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {e.tickers.map(t => (
                            <span key={t} onClick={() => onTickerClick(t)}
                              style={{ color: stockMap[t] ? "#60a5fa" : "#9090a0", cursor: "pointer", fontWeight: stockMap[t] ? 600 : 400 }}
                              onMouseEnter={e => e.target.style.color = "#0d9163"}
                              onMouseLeave={e => e.target.style.color = stockMap[t] ? "#60a5fa" : "#9090a0"}>
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <span style={{ color: "#505060", fontSize: 10 }}>Loading earnings...</span>}
          </div>

          {/* Major News */}
          <div style={{ background: "#141420", border: "1px solid #222230", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#9090a0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Major News</div>
            {homepage.major_news && homepage.major_news.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, fontSize: 11, fontFamily: "monospace" }}>
                {homepage.major_news.map((m, i) => {
                  const pct = parseFloat(m.change);
                  const big = Math.abs(pct) >= 5;
                  const isPos = pct > 0;
                  const isNeg = pct < 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 4px" }}>
                      <span onClick={() => onTickerClick(m.ticker)}
                        style={{ color: "#b8b8c8", fontWeight: 600, cursor: "pointer" }}
                        onMouseEnter={e => e.target.style.color = "#0d9163"}
                        onMouseLeave={e => e.target.style.color = "#b8b8c8"}>
                        {m.ticker}
                      </span>
                      <span style={{
                        color: big ? "#fff" : isPos ? "#2bb886" : isNeg ? "#f87171" : "#9090a0",
                        fontWeight: big ? 700 : 400,
                        ...(big ? { background: isPos ? "#16a34a" : "#dc2626", padding: "0px 4px", borderRadius: 3, fontSize: 10 } : {})
                      }}>
                        {m.change}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : <span style={{ color: "#505060", fontSize: 10 }}>Loading major news...</span>}
          </div>
          </div>
          </div>
          )}
        </div>
      )}

      {/* ── 1. Portfolio ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "#fbbf24", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            Portfolio ({portfolio.length})
          </span>
          <TickerInput value={addTickerP} setValue={setAddTickerP} onAdd={handleAddP} />
        </div>
        {portfolio.length === 0 ? (
          <div style={{ color: "#686878", fontSize: 12, padding: 10, background: "#141420", borderRadius: 6, border: "1px solid #222230" }}>
            Add your holdings above to track live.
          </div>
        ) : (
          <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={portfolioMerged} sortKey={pSort} setter={setPSort} onRemove={removeFromPortfolio} erSipLookup={erSipLookup} />
        )}
      </div>

      {/* ── 2. Watchlist ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "#0d9163", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            Watchlist ({watchlist.length})
          </span>
          <TickerInput value={addTickerW} setValue={setAddTickerW} onAdd={handleAddW} />
        </div>
        {watchlist.length === 0 ? (
          <div style={{ color: "#686878", fontSize: 12, padding: 10, background: "#141420", borderRadius: 6, border: "1px solid #222230" }}>
            Add tickers above or click <span style={{ color: "#0d9163" }}>+watch</span> on volume gainers below.
          </div>
        ) : (
          <div style={{ maxHeight: 464, overflowY: "auto", border: "1px solid #222230", borderRadius: 4 }}>
            <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={watchlistMerged} sortKey={wlSort} setter={setWlSort} onRemove={removeFromWatchlist} erSipLookup={erSipLookup} />
          </div>
        )}
      </div>

    </div>
  );
}

// ── TRADE HISTORY TAB ──
function TradeHistory({ trades, setTrades, stockMap, onTickerClick, activeTicker }) {
  const closedTrades = useMemo(() =>
    trades.filter(t => t.status === "closed").sort((a, b) => (b.closeDate || "").localeCompare(a.closeDate || "")),
  [trades]);

  const deleteTrade = (id) => setTrades(prev => prev.filter(t => t.id !== id));

  // Expanded row for transaction history
  const [expandedId, setExpandedId] = useState(null);

  const st = {
    cell: { padding: "5px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11 },
    header: { padding: "4px 6px", color: "#686878", fontWeight: 600, textAlign: "center", fontSize: 10 },
  };

  return (
    <div style={{ padding: 0 }}>
      {closedTrades.length === 0 ? (
        <div style={{ color: "#505060", fontSize: 12, padding: 20, textAlign: "center" }}>No closed trades yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead><tr style={{ borderBottom: "2px solid #3a3a4a" }}>
            {["Ticker", "Avg Entry", "Exit", "Shares", "P&L $", "P&L %", "R", "Setup", "Opened", "Closed", "Days", ""].map(h => (
              <th key={h} style={st.header}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{closedTrades.map(t => {
            const s = tradeState(t);
            const entry = s.avgEntry || parseFloat(t.entry) || 0;
            const exit = parseFloat(t.exitPrice) || 0;
            const days = t.date && t.closeDate ? Math.round((new Date(t.closeDate) - new Date(t.date)) / 86400000) : "—";
            const riskPS = Math.abs(entry - s.curStop);
            const finalR = riskPS > 0 ? ((exit - entry) / riskPS) : 0;
            const totalShares = s.totalBought;
            return (
              <Fragment key={t.id}>
                <tr onClick={() => onTickerClick(t.ticker)}
                  style={{ borderBottom: "1px solid #222230", cursor: "pointer",
                    background: t.ticker === activeTicker ? "#fbbf2418" : "transparent" }}>
                  <td style={{ ...st.cell, fontWeight: 600, color: "#d4d4e0" }}>
                    {t.ticker}
                    <span onClick={e => { e.stopPropagation(); setExpandedId(expandedId === t.id ? null : t.id); }}
                      style={{ marginLeft: 4, color: "#505060", cursor: "pointer", fontSize: 9 }}>
                      {expandedId === t.id ? "▾" : "▸"}
                    </span>
                  </td>
                  <td style={{ ...st.cell, color: "#9090a0" }}>${entry.toFixed(2)}</td>
                  <td style={{ ...st.cell, color: "#9090a0" }}>${exit.toFixed(2)}</td>
                  <td style={{ ...st.cell, color: "#9090a0" }}>{totalShares}</td>
                  <td style={{ ...st.cell, fontWeight: 600, color: (t.pnl || 0) >= 0 ? "#2bb886" : "#f87171" }}>
                    {(t.pnl || 0) >= 0 ? "+" : ""}${(t.pnl || 0).toFixed(0)}</td>
                  <td style={{ ...st.cell, color: (t.pnlPct || 0) >= 0 ? "#2bb886" : "#f87171" }}>
                    {(t.pnlPct || 0) >= 0 ? "+" : ""}{(t.pnlPct || 0).toFixed(1)}%</td>
                  <td style={{ ...st.cell, fontWeight: 600,
                    color: finalR >= 2 ? "#2bb886" : finalR >= 1 ? "#fbbf24" : finalR >= 0 ? "#9090a0" : "#f87171" }}>
                    {finalR >= 0 ? "+" : ""}{finalR.toFixed(1)}R</td>
                  <td style={{ ...st.cell, fontSize: 9 }}>
                    <span style={{ padding: "1px 4px", borderRadius: 2, background: "#3a3a4a30", color: "#9090a0", border: "1px solid #3a3a4a" }}>{t.setup}</span></td>
                  <td style={{ ...st.cell, color: "#686878", fontSize: 10 }}>{t.date}</td>
                  <td style={{ ...st.cell, color: "#686878", fontSize: 10 }}>{t.closeDate}</td>
                  <td style={{ ...st.cell, color: "#505060", fontSize: 10 }}>{days}d</td>
                  <td style={{ padding: "5px 4px", textAlign: "center" }} onClick={e => e.stopPropagation()}>
                    <span onClick={() => deleteTrade(t.id)} style={{ color: "#3a3a4a", cursor: "pointer", fontSize: 10 }}>✕</span>
                  </td>
                </tr>
                {/* Expanded transaction history */}
                {expandedId === t.id && t.transactions && t.transactions.length > 0 && (
                  <tr style={{ background: "#1a1a2480" }}>
                    <td colSpan={12} style={{ padding: "6px 12px", fontSize: 9, fontFamily: "monospace" }}>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        {t.transactions.map((tx, ti) => (
                          <span key={ti} style={{ color: "#686878" }}>
                            <span style={{ color: tx.type === "buy" ? "#60a5fa" : tx.type === "sell" ? "#fbbf24" : "#f97316", fontWeight: 600 }}>
                              {tx.type.toUpperCase()}
                            </span>
                            {tx.shares ? ` ${tx.shares}sh` : ""}
                            {` @$${tx.price.toFixed(2)}`}
                            <span style={{ color: "#3a3a4a" }}> {tx.date}</span>
                            {tx.note && <span style={{ color: "#505060" }}> — {tx.note}</span>}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}</tbody>
        </table>
      )}
    </div>
  );
}

// ── TRADE PERFORMANCE TAB ──
function TradePerformance({ trades, stockMap, accountSize, maxAllocPct }) {
  const closedTrades = useMemo(() =>
    trades.filter(t => t.status === "closed").sort((a, b) => (b.closeDate || "").localeCompare(a.closeDate || "")),
  [trades]);
  const openTrades = useMemo(() => trades.filter(t => t.status === "open"), [trades]);

  // ── Compute stats for a group of trades ──
  const computeStats = (arr) => {
    if (arr.length === 0) return null;
    const wins = arr.filter(t => (t.pnl || 0) > 0);
    const losses = arr.filter(t => (t.pnl || 0) < 0);
    const winRate = wins.length / arr.length;
    const avgWinPct = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPct || 0), 0) / wins.length : 0;
    const avgLossPct = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnlPct || 0), 0) / losses.length : 0;
    const winLossRatio = Math.abs(avgLossPct) > 0 ? avgWinPct / Math.abs(avgLossPct) : 0;
    const rValues = arr.map(t => {
      const s = tradeState(t);
      const entry = s.avgEntry || parseFloat(t.entry) || 0;
      const exit = parseFloat(t.exitPrice) || 0;
      const riskPS = Math.abs(entry - s.curStop);
      return riskPS > 0 ? (exit - entry) / riskPS : 0;
    });
    const avgR = rValues.length > 0 ? rValues.reduce((a, b) => a + b, 0) / rValues.length : 0;
    return { total: arr.length, wins: wins.length, losses: losses.length,
      winRate: winRate * 100, winLossRatio, avgWinPct, avgLossPct, avgR };
  };

  // ── Full stats for summary cards ──
  const stats = useMemo(() => {
    const s = computeStats(closedTrades);
    if (!s) return null;
    const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl || 0) < 0);
    const breakeven = closedTrades.filter(t => (t.pnl || 0) === 0);
    const adjustedWL = (1 - s.winRate / 100) > 0 && Math.abs(s.avgLossPct) > 0
      ? ((s.winRate / 100) * s.avgWinPct) / ((1 - s.winRate / 100) * Math.abs(s.avgLossPct)) : 0;
    const grossProfits = wins.reduce((a, t) => a + (t.pnl || 0), 0);
    const grossLosses = Math.abs(losses.reduce((a, t) => a + (t.pnl || 0), 0));
    const profitFactor = grossLosses > 0 ? grossProfits / grossLosses : 0;
    const wr = s.winRate / 100;
    const expectancyPct = (wr * s.avgWinPct) + ((1 - wr) * s.avgLossPct);
    const totalPnlPct = closedTrades.reduce((a, t) => a + (t.pnlPct || 0), 0);
    const totalPnl = closedTrades.reduce((a, t) => a + (t.pnl || 0), 0);
    const maxGainPct = wins.length > 0 ? Math.max(...wins.map(t => t.pnlPct || 0)) : 0;
    const maxLossPct = losses.length > 0 ? Math.min(...losses.map(t => t.pnlPct || 0)) : 0;
    const maxGainLossRatio = Math.abs(maxLossPct) > 0 ? maxGainPct / Math.abs(maxLossPct) : 0;
    const daysOf = (a) => a.filter(t => t.date && t.closeDate).map(t => Math.round((new Date(t.closeDate) - new Date(t.date)) / 86400000));
    const dW = daysOf(wins), dL = daysOf(losses), dA = daysOf(closedTrades);
    const avg = (a) => a.length > 0 ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const avgDW = avg(dW), avgDL = avg(dL), avgDA = avg(dA);
    let curStreak = 0, maxWinStreak = 0, maxLossStreak = 0;
    [...closedTrades].reverse().forEach(t => {
      if ((t.pnl || 0) > 0) { curStreak = curStreak > 0 ? curStreak + 1 : 1; maxWinStreak = Math.max(maxWinStreak, curStreak); }
      else if ((t.pnl || 0) < 0) { curStreak = curStreak < 0 ? curStreak - 1 : -1; maxLossStreak = Math.max(maxLossStreak, Math.abs(curStreak)); }
      else { curStreak = 0; }
    });
    return { ...s, breakeven: breakeven.length, adjustedWL, profitFactor, expectancyPct, totalPnlPct, totalPnl,
      maxGainPct, maxLossPct, maxGainLossRatio, avgDaysWin: avgDW, avgDaysLoss: avgDL, avgDays: avgDA,
      holdTimeRatio: avgDL > 0 ? avgDW / avgDL : 0, maxWinStreak, maxLossStreak };
  }, [closedTrades]);

  // ── Normalized metrics (adjust for position sizing vs target allocation) ──
  const normalizedStats = useMemo(() => {
    if (closedTrades.length === 0 || !accountSize) return null;
    const targetPosSize = accountSize * (maxAllocPct / 100); // e.g. 25% of equity

    const normalized = closedTrades.map(t => {
      const s = tradeState(t);
      const entry = s.avgEntry || parseFloat(t.entry) || 0;
      const positionSize = entry * s.totalBought; // actual $ invested
      const normFactor = targetPosSize > 0 ? positionSize / targetPosSize : 1;
      const normPnlPct = (t.pnlPct || 0) * normFactor;
      return { ...t, normPnlPct, normFactor };
    });

    const wins = normalized.filter(t => t.normPnlPct > 0);
    const losses = normalized.filter(t => t.normPnlPct < 0);
    const avgNormWinPct = wins.length > 0 ? wins.reduce((s, t) => s + t.normPnlPct, 0) / wins.length : 0;
    const avgNormLossPct = losses.length > 0 ? losses.reduce((s, t) => s + t.normPnlPct, 0) / losses.length : 0;
    const totalNormPnlPct = normalized.reduce((s, t) => s + t.normPnlPct, 0);
    const normWinLoss = Math.abs(avgNormLossPct) > 0 ? avgNormWinPct / Math.abs(avgNormLossPct) : 0;
    const wr = wins.length / normalized.length;
    const normExpectancy = (wr * avgNormWinPct) + ((1 - wr) * avgNormLossPct);
    const avgNormFactor = normalized.length > 0 ? normalized.reduce((s, t) => s + t.normFactor, 0) / normalized.length : 1;

    return { avgNormWinPct, avgNormLossPct, totalNormPnlPct, normWinLoss, normExpectancy, avgNormFactor,
      targetPosSize, wins: wins.length, losses: losses.length, total: normalized.length };
  }, [closedTrades, accountSize, maxAllocPct]);

  // ── Time period breakdown (year → month) ──
  const timePeriods = useMemo(() => {
    if (closedTrades.length === 0) return [];
    const byYear = {};
    closedTrades.forEach(t => {
      const d = t.closeDate || t.date || "";
      if (!d) return;
      const y = d.slice(0, 4);
      const m = d.slice(0, 7);
      if (!byYear[y]) byYear[y] = { trades: [], months: {} };
      byYear[y].trades.push(t);
      if (!byYear[y].months[m]) byYear[y].months[m] = [];
      byYear[y].months[m].push(t);
    });
    return Object.keys(byYear).sort().reverse().map(y => ({
      year: y, stats: computeStats(byYear[y].trades),
      months: Object.keys(byYear[y].months).sort().reverse().map(m => ({
        month: new Date(m + "-01").toLocaleString("en", { month: "long" }),
        stats: computeStats(byYear[y].months[m]),
      })),
    }));
  }, [closedTrades]);

  // ── Exposure Buckets (from open trades) ──
  const buckets = useMemo(() => {
    const numBuckets = 4;
    const bucketTarget = accountSize * (maxAllocPct / 100); // each bucket's $ target
    const totalTarget = bucketTarget * numBuckets;
    const positions = openTrades.map(t => {
      const s = tradeState(t);
      const curPrice = stockMap[t.ticker]?.price || s.avgEntry;
      const value = curPrice * s.curShares;
      const pctOfBucket = bucketTarget > 0 ? (value / bucketTarget * 100) : 0;
      return { ticker: t.ticker, value, pctOfBucket, shares: s.curShares };
    }).sort((a, b) => b.value - a.value);

    // Distribute positions across buckets (greedy fill)
    const bkts = Array.from({ length: numBuckets }, () => ({ positions: [], total: 0 }));
    positions.forEach(p => {
      // Find bucket with lowest fill
      const target = bkts.reduce((min, b, i) => b.total < bkts[min].total ? i : min, 0);
      bkts[target].positions.push(p);
      bkts[target].total += p.value;
    });

    const totalExposure = positions.reduce((s, p) => s + p.value, 0);
    const bucketsFull = bkts.filter(b => b.total >= bucketTarget * 0.8).length;
    const totalExposurePct = accountSize > 0 ? (totalExposure / accountSize * 100) : 0;

    return { bkts, bucketTarget, totalTarget, totalExposure, totalExposurePct, bucketsFull,
      numBuckets, activePositions: positions.length, uniqueTickers: new Set(positions.map(p => p.ticker)).size };
  }, [openTrades, stockMap, accountSize, maxAllocPct]);

  const [expandedYears, setExpandedYears] = useState({});
  const [openSections, setOpenSections] = useState({ perf: false, wl: false, risk: false, time: false, norm: false });
  const toggleSection = (key) => setOpenSections(p => ({ ...p, [key]: !p[key] }));

  const StatSection = ({ title, sKey, rows }) => (
    <div style={{ marginBottom: 6 }}>
      <div onClick={() => toggleSection(sKey)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0",
          cursor: "pointer", borderBottom: "1px solid #2a2a38" }}>
        <span style={{ color: "#d4d4e0", fontSize: 12, fontWeight: 600 }}>{title}</span>
        <span style={{ color: "#505060", fontSize: 12 }}>{openSections[sKey] ? "▾" : "▸"}</span>
      </div>
      {openSections[sKey] && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
          <thead><tr style={{ borderBottom: "1px solid #2a2a38" }}>
            <th style={{ padding: "6px 8px", color: "#686878", textAlign: "left", fontSize: 10, width: "25%" }}>Metric</th>
            <th style={{ padding: "6px 8px", color: "#686878", textAlign: "left", fontSize: 10, width: "15%" }}>Value</th>
            <th style={{ padding: "6px 8px", color: "#505060", textAlign: "left", fontSize: 10 }}>Description</th>
          </tr></thead>
          <tbody>{rows.map(([metric, value, color, desc], i) => (
            <tr key={i} style={{ borderBottom: "1px solid #1a1a24" }}>
              <td style={{ padding: "8px 8px", color: "#b0b0be", fontWeight: 500 }}>{metric}</td>
              <td style={{ padding: "8px 8px", color, fontWeight: 600, fontFamily: "monospace" }}>{value}</td>
              <td style={{ padding: "8px 8px", color: "#686878", fontSize: 10 }}>{desc}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );

  // Market conditions based on bucket fill
  const conditions = buckets.bucketsFull <= 0 ? ["Conservative/Defensive", "#686878"]
    : buckets.bucketsFull <= 1 ? ["Normal Conditions", "#2bb886"]
    : buckets.bucketsFull <= 2 ? ["Very Good Conditions", "#fbbf24"]
    : ["Premium Conditions", "#f97316"];

  return (
    <div style={{ padding: 0, overflowY: "auto" }}>
      {!stats && closedTrades.length === 0 && (
        <div style={{ color: "#505060", fontSize: 12, padding: 20, textAlign: "center", marginBottom: 16 }}>
          No closed trades yet. Performance metrics will appear once you close trades.
        </div>
      )}

      {/* ═══ Position Exposure Buckets (always visible — uses open trades) ═══ */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ background: "#1a1a24", border: "1px solid #2a2a38", borderRadius: 6, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ color: "#d4d4e0", fontSize: 13, fontWeight: 700 }}>Position Exposure Buckets</div>
              <div style={{ color: "#505060", fontSize: 10 }}>{buckets.numBuckets} buckets × {maxAllocPct}% each = {buckets.numBuckets * maxAllocPct}% total target ({maxAllocPct}% = 1 full position)</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#d4d4e0", fontFamily: "monospace" }}>{buckets.totalExposurePct.toFixed(1)}%</div>
              <div style={{ fontSize: 9, color: "#686878" }}>Total Exposure</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: buckets.bucketsFull >= 2 ? "#2bb886" : "#fbbf24", fontFamily: "monospace" }}>{(buckets.totalExposurePct / (maxAllocPct || 25)).toFixed(1)}</div>
              <div style={{ fontSize: 9, color: "#686878" }}>Buckets Full</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#d4d4e0", fontFamily: "monospace" }}>{buckets.activePositions}</div>
              <div style={{ fontSize: 9, color: "#686878" }}>Active Positions ({buckets.uniqueTickers} tickers)</div>
            </div>
            <div>
              <div style={{ display: "inline-block", padding: "4px 10px", borderRadius: 4, border: `1px solid ${conditions[1]}40`, color: conditions[1], fontSize: 11, fontWeight: 700 }}>{conditions[0].toUpperCase()}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${buckets.numBuckets}, 1fr)`, gap: 10 }}>
            {buckets.bkts.map((bkt, bi) => {
              const fillPct = buckets.bucketTarget > 0 ? (bkt.total / buckets.bucketTarget * 100) : 0;
              const capacityPct = accountSize > 0 ? (bkt.total / accountSize * 100) : 0;
              return (
                <div key={bi} style={{ background: "#0d0d14", border: "1px solid #2a2a38", borderRadius: 6, padding: 12, textAlign: "center" }}>
                  <div style={{ color: "#d4d4e0", fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Bucket {bi + 1}</div>
                  <div style={{ color: "#686878", fontSize: 9, marginBottom: 2 }}>{fillPct.toFixed(0)}% / 100%</div>
                  <div style={{ color: "#505060", fontSize: 9, marginBottom: 8 }}>{capacityPct.toFixed(1)}% of equity</div>
                  <div style={{ fontSize: 10, color: "#505060", marginBottom: 4 }}>{bkt.positions.length} position{bkt.positions.length !== 1 ? "s" : ""}</div>
                  <div style={{ height: 60, background: "#1a1a24", borderRadius: 4, position: "relative", overflow: "hidden", marginBottom: 8 }}>
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${Math.min(fillPct, 100)}%`, background: "#0d916340", transition: "height 0.3s" }} />
                    {bkt.positions.map((p, pi) => (
                      <div key={pi} style={{ position: "relative", zIndex: 1, padding: "1px 4px", fontSize: 8, color: "#d4d4e0",
                        background: "#0d916380", margin: "1px 2px", borderRadius: 2, textAlign: "left" }}>
                        {p.ticker} {(buckets.bucketTarget > 0 ? p.value / buckets.bucketTarget * 100 : 0).toFixed(0)}%
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#d4d4e0", fontFamily: "monospace" }}>{capacityPct.toFixed(1)}%</div>
                  <div style={{ fontSize: 9, color: "#686878" }}>Capacity</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══ Performance Summary Cards ═══ */}
      {stats && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: "#9090a0", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Performance Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
            {[
              ["Batting Average", `${stats.winRate.toFixed(1)}%`, stats.winRate >= 50 ? "#2bb886" : "#f87171"],
              ["Win/Loss Ratio", stats.winLossRatio.toFixed(2), stats.winLossRatio >= 1.5 ? "#2bb886" : stats.winLossRatio >= 1 ? "#fbbf24" : "#f87171"],
              ["Adjusted Win/Loss", stats.adjustedWL.toFixed(2), stats.adjustedWL >= 2 ? "#2bb886" : stats.adjustedWL >= 1 ? "#fbbf24" : "#f87171"],
              ["Average R-Ratio", stats.avgR.toFixed(2), stats.avgR >= 0.5 ? "#2bb886" : stats.avgR >= 0 ? "#fbbf24" : "#f87171"],
            ].map(([label, val, color], i) => (
              <div key={i} style={{ background: "#1a1a24", border: "1px solid #2a2a38", borderRadius: 6, padding: "10px 14px" }}>
                <div style={{ color: "#686878", fontSize: 10, marginBottom: 6 }}>{label}</div>
                <div style={{ color, fontWeight: 700, fontSize: 18, fontFamily: "monospace" }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[
              ["Total Trades", String(stats.total), "#d4d4e0"],
              ["W / L / BE", `${stats.wins} / ${stats.losses} / ${stats.breakeven}`, "#d4d4e0"],
              ["Avg Win %", `+${stats.avgWinPct.toFixed(2)}%`, "#2bb886"],
              ["Avg Loss %", `${stats.avgLossPct.toFixed(2)}%`, "#f87171"],
            ].map(([label, val, color], i) => (
              <div key={i} style={{ background: "#1a1a24", border: "1px solid #2a2a38", borderRadius: 6, padding: "10px 14px" }}>
                <div style={{ color: "#686878", fontSize: 10, marginBottom: 6 }}>{label}</div>
                <div style={{ color, fontWeight: 700, fontSize: 18, fontFamily: "monospace" }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Detailed Statistics ═══ */}
      {stats && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: "#9090a0", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Detailed Statistics</div>
          <StatSection title="Performance Metrics" sKey="perf" rows={[
            ["Profit Factor", stats.profitFactor.toFixed(2), stats.profitFactor >= 2 ? "#2bb886" : stats.profitFactor >= 1 ? "#fbbf24" : "#f87171",
              "Gross profits ÷ gross losses. Above 1 = profitable."],
            ["Expectancy", `${stats.expectancyPct >= 0 ? "+" : ""}${stats.expectancyPct.toFixed(2)}%`, stats.expectancyPct >= 0 ? "#2bb886" : "#f87171",
              "(Win% × Avg Win%) + ((1-Win%) × Avg Loss%)"],
            ["Total P/L %", `${stats.totalPnlPct >= 0 ? "+" : ""}${stats.totalPnlPct.toFixed(2)}%`, stats.totalPnlPct >= 0 ? "#2bb886" : "#f87171",
              "Sum of % gains/losses — not account equity."],
            ["Total P/L $", `${stats.totalPnl >= 0 ? "+" : ""}$${stats.totalPnl.toFixed(0)}`, stats.totalPnl >= 0 ? "#2bb886" : "#f87171",
              "Dollar P&L across all closed trades."],
          ]} />
          <StatSection title="Win/Loss Analysis" sKey="wl" rows={[
            ["Win Rate", `${stats.winRate.toFixed(2)}%`, stats.winRate >= 50 ? "#2bb886" : "#f87171", "Wins ÷ total trades."],
            ["Average Win", `+${stats.avgWinPct.toFixed(2)}%`, "#2bb886", "Mean % gain on winners."],
            ["Average Loss", `${stats.avgLossPct.toFixed(2)}%`, "#f87171", "Mean % loss on losers."],
            ["Win/Loss Ratio", stats.winLossRatio.toFixed(2), stats.winLossRatio >= 1 ? "#d4d4e0" : "#f87171", "Avg Win% ÷ |Avg Loss%|."],
            ["Adjusted Win/Loss", stats.adjustedWL.toFixed(2), stats.adjustedWL >= 1 ? "#d4d4e0" : "#f87171", "W/L ratio adjusted by win rate."],
            ["Win Streak", String(stats.maxWinStreak), "#2bb886", "Most consecutive wins."],
            ["Loss Streak", String(stats.maxLossStreak), "#f87171", "Most consecutive losses."],
          ]} />
          <StatSection title="Risk Metrics" sKey="risk" rows={[
            ["Average R-Ratio", stats.avgR.toFixed(2), stats.avgR >= 0 ? "#2bb886" : "#f87171", "Avg profit/loss relative to initial risk."],
            ["Max Gain %", `+${stats.maxGainPct.toFixed(2)}%`, "#2bb886", "Largest single trade % gain."],
            ["Max Loss %", `${stats.maxLossPct.toFixed(2)}%`, "#f87171", "Largest single trade % loss."],
            ["Max Gain/Loss Ratio", stats.maxGainLossRatio.toFixed(2), stats.maxGainLossRatio >= 1 ? "#d4d4e0" : "#f87171", "Max gain ÷ |max loss|."],
          ]} />
          <StatSection title="Time Metrics" sKey="time" rows={[
            ["Avg Days (Winners)", `${stats.avgDaysWin.toFixed(1)} days`, "#d4d4e0", "Avg hold time for winning trades."],
            ["Avg Days (Losers)", `${stats.avgDaysLoss.toFixed(1)} days`, "#d4d4e0", "Avg hold time for losing trades."],
            ["Hold Time Ratio", stats.holdTimeRatio.toFixed(2), "#d4d4e0", "Winner hold time ÷ loser hold time."],
            ["Avg Days (All)", `${stats.avgDays.toFixed(1)} days`, "#d4d4e0", "Overall average holding period."],
          ]} />

          {normalizedStats && (
            <StatSection title={`Normalized Metrics (target: ${maxAllocPct}% position)`} sKey="norm" rows={[
              ["Avg Norm Factor", normalizedStats.avgNormFactor.toFixed(2) + "x", "#d4d4e0",
                `Average actual position size ÷ target (${maxAllocPct}% of equity). 1.0 = exactly on target.`],
              ["Norm Avg Win %", `+${normalizedStats.avgNormWinPct.toFixed(2)}%`, "#2bb886",
                "Average win % adjusted as if all trades were full position size."],
              ["Norm Avg Loss %", `${normalizedStats.avgNormLossPct.toFixed(2)}%`, "#f87171",
                "Average loss % adjusted as if all trades were full position size."],
              ["Norm Win/Loss", normalizedStats.normWinLoss.toFixed(2),
                normalizedStats.normWinLoss >= 1.5 ? "#2bb886" : normalizedStats.normWinLoss >= 1 ? "#fbbf24" : "#f87171",
                "Normalized avg win ÷ |normalized avg loss|."],
              ["Norm Expectancy", `${normalizedStats.normExpectancy >= 0 ? "+" : ""}${normalizedStats.normExpectancy.toFixed(2)}%`,
                normalizedStats.normExpectancy >= 0 ? "#2bb886" : "#f87171",
                "(Win% × Norm Avg Win%) + ((1-Win%) × Norm Avg Loss%)"],
              ["Norm Total P/L %", `${normalizedStats.totalNormPnlPct >= 0 ? "+" : ""}${normalizedStats.totalNormPnlPct.toFixed(2)}%`,
                normalizedStats.totalNormPnlPct >= 0 ? "#2bb886" : "#f87171",
                "Sum of normalized % returns across all trades."],
            ]} />
          )}
        </div>
      )}

      {/* ═══ Trading Statistics By Time Period ═══ */}
      {timePeriods.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: "#9090a0", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Trading Statistics By Time Period</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr style={{ borderBottom: "2px solid #3a3a4a" }}>
              {["Period", "Trades", "Win Rate", "Win/Loss", "Avg Win %", "Avg Loss %", "R-Ratio"].map(h => (
                <th key={h} style={{ padding: "6px 8px", color: "#686878", fontWeight: 600, textAlign: h === "Period" ? "left" : "center", fontSize: 10 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {timePeriods.map(yp => (
                <Fragment key={yp.year}>
                  <tr style={{ borderBottom: "1px solid #2a2a38", cursor: "pointer", background: "#1a1a2440" }}
                    onClick={() => setExpandedYears(p => ({ ...p, [yp.year]: !p[yp.year] }))}>
                    <td style={{ padding: "6px 8px", color: "#d4d4e0", fontWeight: 700 }}>
                      <span style={{ color: "#505060", marginRight: 4 }}>{expandedYears[yp.year] ? "▾" : "▸"}</span>{yp.year}
                    </td>
                    {yp.stats ? (<>
                      <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: "#d4d4e0" }}>
                        {yp.stats.total} <span style={{ color: "#505060", fontSize: 9 }}>({yp.stats.wins}/{yp.stats.losses})</span></td>
                      <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: yp.stats.winRate >= 50 ? "#2bb886" : "#f87171" }}>{yp.stats.winRate.toFixed(1)}%</td>
                      <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: "#d4d4e0" }}>{yp.stats.winLossRatio.toFixed(2)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: "#2bb886" }}>+{yp.stats.avgWinPct.toFixed(2)}%</td>
                      <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: "#f87171" }}>{yp.stats.avgLossPct.toFixed(2)}%</td>
                      <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: yp.stats.avgR >= 0 ? "#2bb886" : "#f87171" }}>{yp.stats.avgR.toFixed(2)}</td>
                    </>) : <td colSpan={6} />}
                  </tr>
                  {expandedYears[yp.year] && yp.months.map(mp => (
                    <tr key={mp.month} style={{ borderBottom: "1px solid #1a1a24" }}>
                      <td style={{ padding: "6px 8px 6px 28px", color: "#9090a0" }}>{mp.month}</td>
                      {mp.stats ? (<>
                        <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: "#9090a0" }}>
                          {mp.stats.total} <span style={{ color: "#505060", fontSize: 9 }}>({mp.stats.wins}/{mp.stats.losses})</span></td>
                        <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: mp.stats.winRate >= 50 ? "#2bb886" : "#f87171" }}>{mp.stats.winRate.toFixed(1)}%</td>
                        <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: "#9090a0" }}>{mp.stats.winLossRatio.toFixed(2)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: "#2bb886" }}>+{mp.stats.avgWinPct.toFixed(2)}%</td>
                        <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: "#f87171" }}>{mp.stats.avgLossPct.toFixed(2)}%</td>
                        <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "monospace", color: mp.stats.avgR >= 0 ? "#2bb886" : "#f87171" }}>{mp.stats.avgR.toFixed(2)}</td>
                      </>) : <td colSpan={6} />}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

export default function App() {
  // Auth state
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("tp_auth_token") || null);
  const [authChecked, setAuthChecked] = useState(false);

  // Verify token on mount
  useEffect(() => {
    if (!authToken) { setAuthChecked(true); return; }
    fetch("/api/userdata", { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => { if (!r.ok) { setAuthToken(null); localStorage.removeItem("tp_auth_token"); } })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogin = useCallback(async (pin) => {
    const resp = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await resp.json();
    if (data.ok && data.token) {
      localStorage.setItem("tp_auth_token", data.token);
      setAuthToken(data.token);
      return true;
    }
    return false;
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("tp_auth_token");
    setAuthToken(null);
  }, []);

  if (!authChecked) {
    return <div style={{ background: "#121218", color: "#686878", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>Loading...</div>;
  }

  if (!authToken) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <AppMain authToken={authToken} onLogout={handleLogout} />;
}

function LoginScreen({ onLogin }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (!pin.trim()) return;
    setLoading(true); setError(null);
    const ok = await onLogin(pin.trim());
    if (!ok) { setError("Invalid PIN"); setLoading(false); }
  };

  return (
    <div style={{ background: "#121218", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>
      <div style={{ background: "#1a1a24", border: "1px solid #2a2a38", borderRadius: 12, padding: "40px 48px", textAlign: "center", minWidth: 320 }}>
        <div style={{ fontSize: 24, fontWeight: 900, color: "#0d9163", marginBottom: 4, letterSpacing: 2 }}>THEMEPULSE</div>
        <div style={{ fontSize: 12, color: "#686878", marginBottom: 32 }}>Momentum Dashboard</div>
        <input ref={inputRef} type="password" value={pin} onChange={e => setPin(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Enter PIN"
          style={{ background: "#121218", border: "1px solid #3a3a4a", borderRadius: 6, padding: "10px 16px",
            fontSize: 16, color: "#d4d4e0", width: "100%", outline: "none", fontFamily: "monospace",
            textAlign: "center", letterSpacing: 8, marginBottom: 16, boxSizing: "border-box" }} />
        {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <button onClick={submit} disabled={loading}
          style={{ width: "100%", padding: "10px 0", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer",
            background: "#0d916330", border: "1px solid #0d9163", color: "#0d9163", fontFamily: "monospace",
            opacity: loading ? 0.5 : 1 }}>
          {loading ? "..." : "LOGIN"}</button>
      </div>
    </div>
  );
}

function AppMain({ authToken, onLogout }) {
  // Inject responsive CSS and viewport meta once
  useEffect(() => {
    if (document.getElementById("tp-responsive")) return;
    // Viewport meta for mobile
    if (!document.querySelector('meta[name="viewport"]')) {
      const meta = document.createElement("meta");
      meta.name = "viewport";
      meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
      document.head.appendChild(meta);
    }
    const style = document.createElement("style");
    style.id = "tp-responsive";
    style.textContent = `
      @media (max-width: 768px) {
        .tp-topbar { flex-wrap: wrap; padding: 6px 10px !important; }
        .tp-topbar .tp-stats { display: none !important; }
        .tp-nav { overflow-x: auto; padding: 6px 8px !important; gap: 4px !important; -webkit-overflow-scrolling: touch; flex-wrap: nowrap !important; }
        .tp-nav button { padding: 5px 10px !important; font-size: 11px !important; white-space: nowrap; flex-shrink: 0; }
        .tp-nav .tp-search { width: 90px !important; font-size: 11px !important; }
        .tp-nav .tp-right-btns { display: none !important; }
        .tp-main { flex-direction: column !important; }
        .tp-data-panel { width: 100% !important; padding: 8px !important; }
        .tp-divider { display: none !important; }
        .tp-chart-panel { 
          position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
          width: 100vw !important; height: 100vh !important; z-index: 100 !important; background: #121218 !important;
          border-left: none !important;
        }
        .tp-chart-panel > div { height: 100% !important; }
        .tp-chart-close { width: 36px !important; height: 36px !important; font-size: 24px !important; }
        table { font-size: 10px !important; }
        td, th { padding: 3px 4px !important; }
      }
    `;
    document.head.appendChild(style);
  }, []);
  const [data, setData] = useState(null);
  const [view, setView] = useState("live");
  const [scanThemeFilter, setScanThemeFilter] = useState(null);
  const [filters, setFilters] = useState({ minRTS: 0, quad: null, search: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chartTicker, setChartTicker] = useState(null);
  const [mmData, setMmData] = useState(null);
  const [liveThemeData, setLiveThemeData] = useState(null);
  const [showEarnings, setShowEarnings] = useState(false);
  const [showPipeline, setShowPipeline] = useState(false);
  const [earningsOpen, setEarningsOpen] = useState(false);
  const [homepage, setHomepage] = useState(null);

  useEffect(() => {
    fetch("/dashboard_data.json").then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(p => { if (!p.stocks || !p.themes) throw new Error("Invalid data"); setData(p); setLoading(false); })
      .catch(e => { console.error("dashboard_data.json error:", e); setError(e.message); setLoading(false); });
    // Also load market monitor data (optional, won't block)
    fetch("/market_monitor.json").then(r => r.ok ? r.json() : null).then(d => { if (d) setMmData(d); }).catch(() => {});
    // Fetch Finviz homepage data (futures, earnings, major news, market stats) + refresh every 60s
    const fetchHomepage = () => {
      fetch("/api/live?homepage=1")
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.ok && d.homepage) setHomepage(d.homepage); })
        .catch(() => {});
    };
    fetchHomepage();
    const hpIv = setInterval(fetchHomepage, 60000);
    return () => clearInterval(hpIv);
  }, []);

  // Global theme universe live data fetch — batched for large universes, runs on load + every 30s
  useEffect(() => {
    if (!data?.themes) return;
    const tickers = new Set();
    data.themes.forEach(t => t.subthemes?.forEach(s => s.tickers?.forEach(tk => tickers.add(tk))));
    ["SPY","QQQ","DIA","IWM"].forEach(t => tickers.add(t));
    if (tickers.size === 0) return;
    const allTickers = [...tickers];
    const BATCH = 500;

    const fetchUniverse = async () => {
      try {
        const results = [];
        for (let i = 0; i < allTickers.length; i += BATCH) {
          const batch = allTickers.slice(i, i + BATCH);
          const params = new URLSearchParams();
          params.set("universe", batch.join(","));
          const resp = await fetch(`/api/live?${params}`);
          if (resp.ok) {
            const d = await resp.json();
            if (d?.ok && d.theme_universe) results.push(...d.theme_universe);
          }
        }
        if (results.length > 0) {
          setLiveThemeData(prev => {
            if (!prev || prev.length === 0) return results;
            const map = {};
            prev.forEach(s => { map[s.ticker] = s; });
            results.forEach(s => { map[s.ticker] = s; });
            return Object.values(map);
          });
        }
      } catch (e) { console.error("Theme universe fetch error:", e); }
    };
    fetchUniverse();
    const iv = setInterval(fetchUniverse, 30000);
    return () => clearInterval(iv);
  }, [data?.themes]);

  const handleFile = useCallback((e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true); setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try { const p = JSON.parse(ev.target.result); if (!p.stocks||!p.themes) throw new Error("Missing data"); setData(p); }
      catch (err) { setError("Failed: " + err.message); }
      setLoading(false);
    };
    reader.onerror = () => { setError("Read failed"); setLoading(false); };
    reader.readAsText(file);
  }, []);

  const stockMap = useMemo(() => {
    if (!data) return {};
    const m = {};
    data.stocks.forEach(s => { m[s.ticker] = s; });
    
    // Compute EPS composite scores for all stocks
    const allStocks = data.stocks;
    const rawScores = {};
    allStocks.forEach(s => {
      const qs = s.quarters || [];
      const annuals = s.annual || [];
      rawScores[s.ticker] = {
        curEps: qs[0]?.eps_yoy ?? null,
        epsAccel: (qs[0]?.eps_yoy != null && qs[1]?.eps_yoy != null) ? qs[0].eps_yoy - qs[1].eps_yoy : null,
        curSales: qs[0]?.sales_yoy ?? null,
        annEps: annuals[0]?.eps_yoy ?? null,
        marginDelta: (() => {
          const cm = qs[0]?.net_margin ?? qs[0]?.op_margin ?? qs[0]?.gross_margin;
          const pm = qs[1]?.net_margin ?? qs[1]?.op_margin ?? qs[1]?.gross_margin;
          return (cm != null && pm != null) ? cm - pm : null;
        })(),
        posQs: qs.slice(0, 4).filter(q => q.eps_yoy != null && q.eps_yoy > 0).length,
      };
    });
    const pctRank = (arr) => {
      const sorted = arr.filter(v => v != null).sort((a, b) => a - b);
      if (!sorted.length) return () => null;
      return (val) => { if (val == null) return null; let idx = 0; for (let i = 0; i < sorted.length; i++) { if (sorted[i] <= val) idx = i + 1; } return Math.round(idx / sorted.length * 99); };
    };
    const pCE = pctRank(allStocks.map(s => rawScores[s.ticker]?.curEps));
    const pAc = pctRank(allStocks.map(s => rawScores[s.ticker]?.epsAccel));
    const pCS = pctRank(allStocks.map(s => rawScores[s.ticker]?.curSales));
    const pAE = pctRank(allStocks.map(s => rawScores[s.ticker]?.annEps));
    const pMD = pctRank(allStocks.map(s => rawScores[s.ticker]?.marginDelta));
    const pPQ = pctRank(allStocks.map(s => rawScores[s.ticker]?.posQs));
    // Weighted composite then re-ranked
    const composites = {};
    allStocks.forEach(s => {
      const r = rawScores[s.ticker];
      const scores = [{p:pCE(r.curEps),w:.30},{p:pAc(r.epsAccel),w:.20},{p:pCS(r.curSales),w:.15},{p:pAE(r.annEps),w:.15},{p:pMD(r.marginDelta),w:.10},{p:pPQ(r.posQs),w:.10}];
      let tw=0,ts=0; scores.forEach(({p,w})=>{if(p!=null){ts+=p*w;tw+=w;}}); composites[s.ticker]=tw>0?Math.round(ts/tw):null;
    });
    const pFinal = pctRank(Object.values(composites).filter(v=>v!=null));
    allStocks.forEach(s => { m[s.ticker]._epsScore = pFinal(composites[s.ticker]); });
    
    // ── Momentum Score (0-99) ──
    // Blend of price action + EPS quality for swing/momentum trading
    const pRS = pctRank(allStocks.map(s => s.rs_rank));
    const pFrHi = pctRank(allStocks.map(s => s.pct_from_high));  // closer to 0 = better
    const pRet3m = pctRank(allStocks.map(s => s.return_3m));
    const pVCS = pctRank(allStocks.map(s => s.vcs));
    const pEPS = pctRank(allStocks.map(s => m[s.ticker]._epsScore));
    const pMF = pctRank(allStocks.map(s => s.mf));
    const pADR = pctRank(allStocks.map(s => s.adr_pct));
    
    const msComposites = {};
    allStocks.forEach(s => {
      const scores = [
        { p: pRS(s.rs_rank), w: 0.25 },
        { p: pFrHi(s.pct_from_high), w: 0.15 },
        { p: pRet3m(s.return_3m), w: 0.15 },
        { p: pVCS(s.vcs), w: 0.15 },
        { p: pEPS(m[s.ticker]._epsScore), w: 0.15 },
        { p: pMF(s.mf), w: 0.10 },
        { p: pADR(s.adr_pct), w: 0.05 },
      ];
      let tw = 0, ts = 0;
      scores.forEach(({ p, w }) => { if (p != null) { ts += p * w; tw += w; } });
      msComposites[s.ticker] = tw > 0 ? Math.round(ts / tw) : null;
    });
    const pMS = pctRank(Object.values(msComposites).filter(v => v != null));
    allStocks.forEach(s => { m[s.ticker]._msScore = pMS(msComposites[s.ticker]); });
    
    // MF percentile for display
    const pMFall = pctRank(allStocks.map(s => s.mf));
    allStocks.forEach(s => { m[s.ticker]._mfPct = pMFall(s.mf); });
    
    return m;
  }, [data]);
  // ER / SIP source lookup — lets every tab show where a ticker came from
  const erSipLookup = useMemo(() => {
    if (!data) return {};
    const m = {};
    // Earnings movers → ER
    (data.earnings_movers || []).forEach(e => { if (e.ticker && !m[e.ticker]) m[e.ticker] = "er"; });
    // PM earnings movers → ER (reported pre-market)
    (data.pm_earnings_movers || []).forEach(e => { if (e.ticker && !m[e.ticker]) m[e.ticker] = "er"; });
    // AH earnings movers → ER (reported after-hours)
    (data.ah_earnings_movers || []).forEach(e => { if (e.ticker && !m[e.ticker]) m[e.ticker] = "er"; });
    // PM SIP movers
    (data.pm_sip_movers || []).forEach(e => { if (e.ticker && !m[e.ticker]) m[e.ticker] = "pm_sip"; });
    // AH SIP movers
    (data.ah_sip_movers || []).forEach(e => { if (e.ticker && !m[e.ticker]) m[e.ticker] = "ah_sip"; });
    return m;
  }, [data]);

  const openChart = useCallback((t) => setChartTicker(prev => prev === t ? null : t), []);
  const closeChart = useCallback(() => setChartTicker(null), []);

  // Watchlist + Portfolio + Manual EPs state (hoisted for access from ChartPanel)
  const [portfolio, setPortfolio] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_portfolio") || "[]"); } catch { return []; }
  });
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_watchlist") || "[]"); } catch { return []; }
  });
  const [pkn, setPkn] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_pkn") || "[]"); } catch { return []; }
  });
  const [pknWatch, setPknWatch] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_pkn_watch") || "[]"); } catch { return []; }
  });
  const [trades, setTrades] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_trades") || "[]").map(migrateTrade); } catch { return []; }
  });
  const [serverLoaded, setServerLoaded] = useState(false);

  // Listen for external trade imports (from console) and storage changes from other tabs
  useEffect(() => {
    const handleImport = () => {
      try {
        const imported = JSON.parse(localStorage.getItem("tp_trades") || "[]").map(migrateTrade);
        setTrades(imported);
        console.log("Trades reloaded from localStorage:", imported.length);
      } catch {}
    };
    window.addEventListener("tp_trades_imported", handleImport);
    window.addEventListener("storage", (e) => { if (e.key === "tp_trades") handleImport(); });
    return () => {
      window.removeEventListener("tp_trades_imported", handleImport);
      window.removeEventListener("storage", handleImport);
    };
  }, []);

  // Load from server on mount
  useEffect(() => {
    if (!authToken) { setServerLoaded(true); return; }
    fetch("/api/userdata", { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (d?.ok && d.data) {
          // Server data takes priority over localStorage
          setPortfolio(d.data.portfolio || []);
          setWatchlist(d.data.watchlist || []);
          if (d.data.pkn) setPkn(d.data.pkn);
          if (d.data.pknWatch) setPknWatch(d.data.pknWatch);
          if (d.data.trades) setTrades(d.data.trades.map(migrateTrade));
          console.log("Loaded from server:", d.data);
        }
      })
      .catch(err => console.warn("Failed to load server data:", err))
      .finally(() => setServerLoaded(true));
  }, [authToken]);

  // Save to localStorage
  useEffect(() => { localStorage.setItem("tp_portfolio", JSON.stringify(portfolio)); }, [portfolio]);
  useEffect(() => { localStorage.setItem("tp_watchlist", JSON.stringify(watchlist)); }, [watchlist]);
  useEffect(() => { localStorage.setItem("tp_pkn", JSON.stringify(pkn)); }, [pkn]);
  useEffect(() => { localStorage.setItem("tp_pkn_watch", JSON.stringify(pknWatch)); }, [pknWatch]);
  useEffect(() => { localStorage.setItem("tp_trades", JSON.stringify(trades)); }, [trades]);

  // Save to server (debounced)
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!authToken || !serverLoaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      console.log("Saving to server:", { portfolio, watchlist });
      fetch("/api/userdata", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ portfolio, watchlist, trades, pkn, pknWatch }),
      })
        .then(r => r.json())
        .then(d => console.log("Save result:", d))
        .catch(err => console.warn("Save failed:", err));
    }, 2000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [portfolio, watchlist, trades, pkn, pknWatch, authToken, serverLoaded]);
  const addToWatchlist = useCallback((t) => { const u = t.toUpperCase(); if (!watchlist.includes(u)) setWatchlist(p => [...p, u]); }, [watchlist]);
  const removeFromWatchlist = useCallback((t) => setWatchlist(p => p.filter(x => x !== t)), []);
  const addToPortfolio = useCallback((t) => { const u = t.toUpperCase(); if (!portfolio.includes(u)) setPortfolio(p => [...p, u]); }, [portfolio]);
  const removeFromPortfolio = useCallback((t) => setPortfolio(p => p.filter(x => x !== t)), []);
  const addToPkn = useCallback((t) => { const u = t.toUpperCase(); if (!pkn.includes(u)) setPkn(p => [...p, u]); }, [pkn]);
  const removeFromPkn = useCallback((t) => setPkn(p => p.filter(x => x !== t)), []);
  const addToPknWatch = useCallback((t) => { const u = t.toUpperCase(); if (!pknWatch.includes(u)) setPknWatch(p => [...p, u]); }, [pknWatch]);
  const removeFromPknWatch = useCallback((t) => setPknWatch(p => p.filter(x => x !== t)), []);
  // Visible ticker list — reported by whichever view is active
  const [visibleTickers, setVisibleTickers] = useState([]);
  const onVisibleTickers = useCallback((tickers) => setVisibleTickers(tickers), []);

  // Resizable split panel
  const [splitPct, setSplitPct] = useState(50);
  const [userDragged, setUserDragged] = useState(false);
  // Auto-widen left panel on exec tab for calculator boxes
  useEffect(() => {
    if (!userDragged) {
      setSplitPct(view === "exec" ? 60 : 50);
    }
  }, [view, userDragged]);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (ev) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.max(15, Math.min(85, pct)));
      setUserDragged(true);
    };
    const onUp = () => {
      setIsDragging(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    // Prevent iframe from stealing mouse events during drag
    const iframes = document.querySelectorAll("iframe");
    iframes.forEach(f => { f.style.pointerEvents = "none"; });
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      iframes.forEach(f => { f.style.pointerEvents = ""; });
    };
  }, [isDragging]);

  // Keyboard navigation: ↑↓ to cycle tickers, Esc to close chart
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.key === "Escape") { closeChart(); return; }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && visibleTickers.length > 0) {
        e.preventDefault();
        setChartTicker(prev => {
          if (!prev) return visibleTickers[0];
          const idx = visibleTickers.indexOf(prev);
          if (idx === -1) return visibleTickers[0];
          const next = e.key === "ArrowDown" ? Math.min(idx + 1, visibleTickers.length - 1) : Math.max(idx - 1, 0);
          return visibleTickers[next];
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visibleTickers, closeChart]);

  // Scroll active ticker row into view on keyboard nav
  useEffect(() => {
    if (!chartTicker) return;
    const el = document.querySelector(`[data-ticker="${chartTicker}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [chartTicker]);

  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: "#121218", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 40, fontWeight: 900, color: "#d4d4e0", letterSpacing: -2, marginBottom: 4 }}>THEME<span style={{ color: "#0d9163" }}>PULSE</span></div>
          <div style={{ color: "#787888", marginBottom: 32, fontSize: 14 }}>Leading Stocks in Leading Themes</div>
          {error && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 16, padding: 12, background: "#450a0a", borderRadius: 8 }}>{error}</div>}
          <div style={{ border: "2px dashed #3a3a4a", borderRadius: 12, padding: 40 }}>
            {loading ? <div style={{ color: "#9090a0" }}>Loading...</div> : (<>
              <div style={{ color: "#787888", marginBottom: 16, fontSize: 13 }}>Load <code style={{ color: "#0d9163" }}>dashboard_data.json</code></div>
              <label style={{ display: "inline-block", padding: "12px 32px", background: "#0d9163", color: "#000", fontWeight: 700, borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
                Choose File<input type="file" accept=".json" onChange={handleFile} style={{ display: "none" }} /></label>
            </>)}
          </div>
        </div>
      </div>
    );
  }

  const aCount = data.stocks.filter(s => ["A+","A","A-"].includes(s.grade)).length;
  const breadth = Math.round(data.stocks.filter(s => s.above_50ma).length / data.stocks.length * 100);
  const strongC = data.themes.filter(t => getQuad(t.weekly_rs, t.monthly_rs) === "STRONG").length;

  // Layout: when chart is open, use resizable split
  const chartOpen = chartTicker !== null;

  return (
    <div style={{ minHeight: "100vh", background: "#121218", color: "#b8b8c8", fontFamily: "system-ui, -apple-system, sans-serif", display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Top bar */}
      <div className="tp-topbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #2a2a38", background: "#1a1a24", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: "#d4d4e0", letterSpacing: -1 }}>THEME<span style={{ color: "#0d9163" }}>PULSE</span></span>
          <span style={{ color: "#686878", fontSize: 12 }}>{data.date}</span>
        </div>
        <div className="tp-stats" style={{ display: "flex", gap: 16, fontSize: 12 }}>
          <span style={{ color: "#787888" }}>Stocks: <span style={{ color: "#d4d4e0" }}>{data.total_stocks}</span></span>
          <span style={{ color: "#787888" }}>Strong: <span style={{ color: "#2bb886" }}>{strongC}</span></span>
          <span style={{ color: "#787888" }}>A Grades: <span style={{ color: "#2bb886" }}>{aCount}</span></span>
          <span style={{ color: "#787888" }}>Breadth: <span style={{ color: breadth >= 60 ? "#2bb886" : breadth >= 40 ? "#fbbf24" : "#f87171" }}>{breadth}%</span></span>
        </div>
      </div>

      {/* Nav + filters */}
      <div className="tp-nav" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid #222230", flexShrink: 0 }}>
        {[["live","Live"],["pkn","PKN"],["scan","Scan Watch"],["ep","EP"],["grid","Research"],["exec","Execution"],["perf","Performance"],["quad","Quadrant"]].map(([id, label]) => (
          <button key={id} onClick={() => { setView(id); setVisibleTickers([]); if (id === "exec") setChartTicker(null); }} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
            border: view === id ? "1px solid #0d916350" : "1px solid transparent",
            background: view === id ? "#0d916315" : "transparent", color: view === id ? "#4aad8c" : "#787888" }}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative" }}>
          <input type="text" placeholder="Ticker..." value={filters.search}
            onChange={e => setFilters(p => ({ ...p, search: e.target.value.toUpperCase() }))}
            onKeyDown={e => {
              if (e.key === "Enter" && filters.search.trim()) {
                const q = filters.search.trim().toUpperCase();
                // Exact match first, then partial
                const exact = Object.keys(stockMap).find(t => t === q);
                if (exact) { openChart(exact); setFilters(p => ({ ...p, search: "" })); }
                else {
                  const partial = Object.keys(stockMap).filter(t => t.startsWith(q));
                  if (partial.length > 0) { openChart(partial[0]); setFilters(p => ({ ...p, search: "" })); }
                  else { openChart(q); setFilters(p => ({ ...p, search: "" })); }
                }
              }
              if (e.key === "Escape") setFilters(p => ({ ...p, search: "" }));
            }}
            style={{ background: "#222230", border: "1px solid #3a3a4a", borderRadius: 6, padding: "4px 10px", fontSize: 12, color: "#d4d4e0", width: 140, outline: "none", fontFamily: "monospace" }} className="tp-search" />
          {filters.search.length >= 1 && (() => {
            const q = filters.search.toUpperCase();
            const matches = Object.keys(stockMap).filter(t => t.startsWith(q)).slice(0, 8);
            if (matches.length === 0) return null;
            return (
              <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 2, background: "#1a1a24", border: "1px solid #3a3a4a", borderRadius: 6, zIndex: 9999, minWidth: 200, maxHeight: 240, overflow: "auto" }}>
                {matches.map(t => (
                  <div key={t} onClick={() => { openChart(t); setFilters(p => ({ ...p, search: "" })); }}
                    style={{ padding: "5px 10px", cursor: "pointer", fontSize: 12, fontFamily: "monospace", display: "flex", justifyContent: "space-between", gap: 12 }}
                    onMouseEnter={e => e.currentTarget.style.background = "#0d916318"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ color: "#d4d4e0", fontWeight: 700 }}>{t}</span>
                    <span style={{ color: "#686878", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stockMap[t]?.company || ""}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
        <div className="tp-right-btns" style={{ display: "flex", gap: 4 }}>
        <button onClick={() => { setView("ep"); setVisibleTickers([]); }} style={{ marginLeft: 8, padding: "3px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer",
          background: view === "ep" ? "#c084fc20" : "transparent", border: view === "ep" ? "1px solid #c084fc" : "1px solid #3a3a4a",
          color: view === "ep" ? "#c084fc" : "#787888" }}>Earnings</button>
        {/* Pipeline run button */}
        <div style={{ position: "relative" }}>
            <button onClick={() => setShowPipeline(p => !p)} style={{ padding: "3px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer",
              background: showPipeline ? "#f9731620" : "transparent", border: showPipeline ? "1px solid #f97316" : "1px solid #3a3a4a",
              color: showPipeline ? "#f97316" : "#686878" }}>▶ Pipeline</button>
            {showPipeline && (
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#1a1a24", border: "1px solid #3a3a4a", borderRadius: 8, padding: 12, zIndex: 9999, minWidth: 340, fontSize: 11 }}>
                <div style={{ color: "#686878", fontWeight: 700, marginBottom: 6 }}>Daily Pipeline</div>
                <div style={{ background: "#0a0a0f", borderRadius: 4, padding: "8px 10px", fontFamily: "monospace", fontSize: 10, color: "#d4d4e0", cursor: "pointer", marginBottom: 6, border: "1px solid #2a2a38" }}
                  onClick={() => { navigator.clipboard.writeText(`cd ~/Claude\\ Theme/stock-pipeline && bash scripts/daily.sh`); }}
                  title="Click to copy">
                  {"cd ~/Claude\\ Theme/stock-pipeline && bash scripts/daily.sh"}
                  <span style={{ color: "#0d9163", marginLeft: 8, fontSize: 9 }}>📋 copy</span>
                </div>
                <div style={{ background: "#0a0a0f", borderRadius: 4, padding: "8px 10px", fontFamily: "monospace", fontSize: 10, color: "#f97316", cursor: "pointer", border: "1px solid #2a2a38" }}
                  onClick={() => { navigator.clipboard.writeText(`cd ~/Claude\\ Theme/stock-pipeline && bash scripts/weekly.sh --force`); }}
                  title="Click to copy (weekly force)">
                  {"cd ~/Claude\\ Theme/stock-pipeline && bash scripts/weekly.sh --force"}
                  <span style={{ color: "#0d9163", marginLeft: 8, fontSize: 9 }}>📋 weekly</span>
                </div>
                <div style={{ marginTop: 6, color: "#505060", fontSize: 9, lineHeight: 1.4 }}>
                  Daily: export → finviz → earnings(reporters) → EP → VCS<br/>
                  Weekly: + full earnings + institutional
                </div>
              </div>
            )}
        </div>
        <button onClick={onLogout} style={{ padding: "3px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer",
          background: "transparent", border: "1px solid #3a3a4a", color: "#686878" }}>Logout</button>
        </div>
      </div>

      {/* Main content: split layout when chart is open */}
      <div ref={containerRef} className="tp-main" style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
        {/* Left: data views */}
        <div className="tp-data-panel" style={{ width: chartOpen ? `${splitPct}%` : "100%", overflowY: "auto", padding: 16, transition: "none" }}>
          <ErrorBoundary name="Scan Watch">
          {view === "scan" && <Scan stocks={data.stocks} themes={data.themes} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers} liveThemeData={liveThemeData} onLiveThemeData={setLiveThemeData} portfolio={portfolio} watchlist={watchlist} initialThemeFilter={scanThemeFilter} onConsumeThemeFilter={() => setScanThemeFilter(null)}
            stockMap={stockMap} filters={filters} mmData={mmData} themeHealth={data.theme_health} momentumBurst={data.momentum_burst} erSipLookup={erSipLookup} />}
          </ErrorBoundary>
          <ErrorBoundary name="Episodic Pivots">
          {view === "ep" && <EpisodicPivots stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers} earningsMovers={data.earnings_movers} headlinesMap={data.headlines || {}} pmEarningsMovers={data.pm_earnings_movers || []} ahEarningsMovers={data.ah_earnings_movers || []} pmSipMovers={data.pm_sip_movers || []} ahSipMovers={data.ah_sip_movers || []} historicalEarningsMovers={data.historical_earnings_movers || []} />}
          </ErrorBoundary>
          <ErrorBoundary name="Research">
          {view === "grid" && <Grid stocks={data.stocks} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers} />}
          </ErrorBoundary>
          <ErrorBoundary name="Execution">
          {view === "exec" && <Execution trades={trades} setTrades={setTrades} stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers}
            portfolio={portfolio} removeFromPortfolio={removeFromPortfolio} liveThemeData={liveThemeData} erSipLookup={erSipLookup} />}
          </ErrorBoundary>
          <ErrorBoundary name="Performance">
          {view === "perf" && <TradePerformance trades={trades} stockMap={stockMap}
            accountSize={parseFloat(localStorage.getItem("tp_account_size") || "100000")}
            maxAllocPct={parseFloat(localStorage.getItem("tp_max_alloc") || "25")} />}
          </ErrorBoundary>
          <ErrorBoundary name="Live">
          {view === "live" && <LiveView stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers}
            portfolio={portfolio} setPortfolio={setPortfolio} watchlist={watchlist} setWatchlist={setWatchlist}
            addToWatchlist={addToWatchlist} removeFromWatchlist={removeFromWatchlist}
            addToPortfolio={addToPortfolio} removeFromPortfolio={removeFromPortfolio}
            liveThemeData={liveThemeData} homepage={homepage} erSipLookup={erSipLookup} />}
          {view === "pkn" && <PknView stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers}
            pkn={pkn} setPkn={setPkn} pknWatch={pknWatch} setPknWatch={setPknWatch}
            addToPkn={addToPkn} removeFromPkn={removeFromPkn}
            addToPknWatch={addToPknWatch} removeFromPknWatch={removeFromPknWatch}
            liveThemeData={liveThemeData} />}
          </ErrorBoundary>
          <ErrorBoundary name="Market Quadrant">
          {view === "quad" && <USMarketQuadrant />}
          </ErrorBoundary>
        </div>

        {/* Draggable divider */}
        {chartOpen && (
          <div className="tp-divider"
            onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
            style={{ width: 9, flexShrink: 0, cursor: "col-resize", position: "relative", zIndex: 10,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 1, height: "100%", background: isDragging ? "#0d9163" : "#3a3a4a", transition: "background 0.15s" }} />
          </div>
        )}

        {/* Right: chart panel */}
        {chartOpen && (
          <div className="tp-chart-panel" style={{ width: `${100 - splitPct}%`, height: "100%", transition: "none" }}>
            <ErrorBoundary name="Chart Panel">
            {view === "exec" ? (
              <ChartPanel ticker={chartTicker} stock={stockMap[chartTicker]} onClose={closeChart} onTickerClick={openChart}
                watchlist={watchlist} onAddWatchlist={addToWatchlist} onRemoveWatchlist={removeFromWatchlist}
                portfolio={portfolio} onAddPortfolio={addToPortfolio} onRemovePortfolio={removeFromPortfolio}
                pkn={pkn} onAddPkn={addToPkn} onRemovePkn={removeFromPkn}
                pknWatch={pknWatch} onAddPknWatch={addToPknWatch} onRemovePknWatch={removeFromPknWatch}
                liveThemeData={liveThemeData} erSipLookup={erSipLookup}
                lwChartProps={(() => {
                  const openT = trades.find(t => t.ticker === chartTicker && t.status === "open");
                  if (!openT) return { entry: "", stop: "", target: "" };
                  const s = tradeState(openT);
                  return { entry: String(s.avgEntry), stop: String(s.curStop), target: openT.target || "" };
                })()} />
            ) : (
              <ChartPanel ticker={chartTicker} stock={stockMap[chartTicker]} onClose={closeChart} onTickerClick={openChart}
                watchlist={watchlist} onAddWatchlist={addToWatchlist} onRemoveWatchlist={removeFromWatchlist}
                portfolio={portfolio} onAddPortfolio={addToPortfolio} onRemovePortfolio={removeFromPortfolio}
                pkn={pkn} onAddPkn={addToPkn} onRemovePkn={removeFromPkn}
                pknWatch={pknWatch} onAddPknWatch={addToPknWatch} onRemovePknWatch={removeFromPknWatch}
                liveThemeData={liveThemeData} erSipLookup={erSipLookup} />
            )}
            </ErrorBoundary>
          </div>
        )}

      </div>

      {/* Earnings Calendar slide-out */}
      {showEarnings && data && (<>
        <div onClick={() => setShowEarnings(false)}
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.3)", zIndex: 999 }} />
        <EarningsCalendar stockMap={stockMap} onTickerClick={(t) => { openChart(t); }}
          onClose={() => setShowEarnings(false)} />
      </>)}
    </div>
  );
}
