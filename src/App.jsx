import { useState, useMemo, useCallback, useEffect, useRef } from "react";

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

function Ret({ v, bold }) {
  if (v == null) return <span style={{ color: "#787888" }}>—</span>;
  const c = v > 0 ? "#2bb886" : v < 0 ? "#f87171" : "#9090a0";
  return <span style={{ color: c, fontWeight: 400, fontFamily: "monospace" }}>{v > 0 ? "+" : ""}{v.toFixed(1)}%</span>;
}

function Badge({ grade }) {
  if (!grade) return null;
  const bg = GRADE_COLORS[grade] || "#505060";
  const light = ["B-","C+","C","C-","D+","D","D-","E+","E"].includes(grade);
  return <span style={{ background: bg, color: light ? "#2a2a38" : "#d4d4e0", padding: "1px 5px", borderRadius: 3, fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{grade}</span>;
}

// ── STOCK STAT (label: value pair for chart panel) ──
function StockStat({ label, value, color = "#9090a0" }) {
  return (
    <span style={{ whiteSpace: "nowrap", lineHeight: 1.1 }}>
      <span style={{ color: "#686878" }}>{label}: </span>
      <span style={{ color, fontFamily: "monospace" }}>{value}</span>
    </span>
  );
}

// ── PERSISTENT CHART PANEL (right side) ──
const TV_LAYOUT = "nkNPuLqj";

function ChartPanel({ ticker, stock, onClose, onTickerClick, watchlist, onAddWatchlist, onRemoveWatchlist, portfolio, onAddPortfolio, onRemovePortfolio, manualEPs, onAddEP, onRemoveEP, liveThemeData }) {
  const containerRef = useRef(null);
  const [tf, setTf] = useState("D");
  const [showDetails, setShowDetails] = useState(true);
  const [news, setNews] = useState(null);
  const [peers, setPeers] = useState(null);
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
    setDescription(null);
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
          setDescription(d.description || '');
          setFinvizQuarters(d.finvizQuarters && d.finvizQuarters.length > 0 ? d.finvizQuarters : null);
        } else { setNews([]); setPeers([]); setDescription(''); }
      })
      .catch(() => { setNews([]); setPeers([]); setDescription(''); });
  }, [ticker]);

  const tvLayoutUrl = `https://www.tradingview.com/chart/${TV_LAYOUT}/?symbol=${encodeURIComponent(ticker)}`;

  const tfOptions = [
    ["1", "1m"], ["5", "5m"], ["15", "15m"], ["60", "1H"],
    ["D", "D"], ["W", "W"], ["M", "M"],
  ];

  useEffect(() => {
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
  }, [ticker, tf]);


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", borderLeft: "1px solid #2a2a38", background: "#121218" }}>
      {/* Always visible: Ticker, Watch/Portfolio, Grade, RS, Theme, Close */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px",
        borderBottom: "1px solid #2a2a38", flexShrink: 0, background: "#1a1a24" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: "#d4d4e0" }}>{ticker}</span>
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
          {manualEPs && (
            manualEPs.some(e => e.ticker === ticker)
              ? <button onClick={() => onRemoveEP(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "#f9731620", border: "1px solid #f9731640", color: "#f97316" }}>✓ EP</button>
              : <button onClick={() => onAddEP(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", border: "1px solid #3a3a4a", color: "#787888" }}>+ EP</button>
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: "0 1 25%", minWidth: 0, fontSize: 10, fontFamily: "monospace", lineHeight: 1.4 }}>
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
          <div style={{ flex: "0 0 auto", minWidth: 258, fontSize: 10, fontFamily: "monospace" }}>
            <div style={{ color: "#686878", fontWeight: 700, marginBottom: 2 }}>Earnings</div>
            {/* Next earnings */}
            {(stock.earnings_display || stock.earnings_date) && (
              <div style={{ padding: "1px 0" }}>
                <span style={{ color: stock.earnings_days != null && stock.earnings_days <= 7 ? "#f87171" : stock.earnings_days != null && stock.earnings_days <= 14 ? "#fbbf24" : "#c084fc" }}>
                  ▶ {stock.earnings_display || stock.earnings_date}
                </span>
                {stock.earnings_days != null && stock.earnings_days >= 0 && (
                  <span style={{ color: "#686878", marginLeft: 4 }}>({stock.earnings_days}d)</span>
                )}
              </div>
            )}
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
                <div key={i} style={{ padding: "1px 0", color: "#505060", display: "flex", gap: 4,
                  borderBottom: rowBorder, background: rowBg, borderRadius: isCode33Q ? 2 : 0 }}>
                  <span style={{ width: 44, flexShrink: 0 }}>{q.report_date ? q.report_date.slice(5) : q.label}</span>
                  {q.eps != null && <span style={{ color: q.eps_yoy > 0 ? "#2bb886" : q.eps_yoy < 0 ? "#f87171" : "#9090a0", width: 72, flexShrink: 0,
                    background: epsBg, borderRadius: 2, padding: "0 2px" }}>
                    {epsIcon && <span style={{ fontSize: 8, marginRight: 1 }}>{epsIcon}</span>}
                    E:{q.eps_yoy != null ? `${q.eps_yoy > 0 ? "+" : ""}${q.eps_yoy.toFixed(0)}%` : q.eps}
                    {isEpsAccel && <span style={{ color: isCode33Q ? "#60a5fa" : "#2bb886", fontSize: 10, marginLeft: 1 }} title="EPS accelerating vs prior quarter">▲</span>}
                    {isEpsDecel && <span style={{ color: "#f87171", fontSize: 10, marginLeft: 1 }} title="EPS decelerating vs prior quarter">▼</span>}
                  </span>}
                  {q.sales_yoy != null && <span style={{ color: q.sales_yoy >= 20 ? "#2bb886" : q.sales_yoy > 0 ? "#9090a0" : "#f87171",
                    background: salesBg, borderRadius: 2, padding: "0 2px" }}>
                    S:{q.sales_yoy > 0 ? "+" : ""}{q.sales_yoy.toFixed(0)}%
                    {isSalesAccel && <span style={{ color: isCode33Q ? "#60a5fa" : "#2bb886", fontSize: 10, marginLeft: 1 }} title="Sales accelerating vs prior quarter">▲</span>}
                  </span>}
                  {margin != null && <span style={{
                    color: isMarginAccel ? (isCode33Q ? "#60a5fa" : "#a78bfa") : marginDelta != null && marginDelta < 0 ? "#f87171" : "#686878",
                    fontSize: 10, marginLeft: 2 }}
                    title={`${marginLabel}: ${margin.toFixed(1)}%${marginDelta != null ? ` (${marginDelta >= 0 ? "+" : ""}${marginDelta.toFixed(1)}pp)` : ""}`}>
                    {marginLabel}:{margin.toFixed(0)}%{isMarginAccel ? "▲" : marginDelta != null && marginDelta < 0 ? "▼" : ""}
                  </span>}
                </div>
                );
              })}
              </>);
            })()}
            {/* Annual EPS/Sales/Margins — CANSLIM A: Annual Earnings */}
            {stock.annual && stock.annual.length > 0 && (<>
              <div style={{ borderTop: "1px solid #2a2a38", margin: "3px 0 2px", width: "100%" }} />
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
                return (
                <div key={i} style={{ padding: "1px 0", color: "#505060", display: "flex", gap: 4 }}>
                  <span style={{ width: 44, flexShrink: 0 }}>{a.year}</span>
                  {a.eps != null && <span style={{ color: a.eps_yoy > 0 ? "#2bb886" : a.eps_yoy < 0 ? "#f87171" : "#9090a0", width: 72, flexShrink: 0,
                    background: epsBg, borderRadius: 2, padding: "0 2px" }}>
                    {epsIcon && <span style={{ fontSize: 8, marginRight: 1 }}>{epsIcon}</span>}
                    E:{a.eps_yoy != null ? `${a.eps_yoy > 0 ? "+" : ""}${a.eps_yoy.toFixed(0)}%` : a.eps}
                  </span>}
                  {a.sales_yoy != null && <span style={{ color: a.sales_yoy >= 20 ? "#2bb886" : a.sales_yoy > 0 ? "#9090a0" : "#f87171",
                    background: salesBg, borderRadius: 2, padding: "0 2px" }}>
                    S:{a.sales_yoy > 0 ? "+" : ""}{a.sales_yoy.toFixed(0)}%
                  </span>}
                  {margin != null && <span style={{
                    color: marginDelta != null && marginDelta > 0 ? "#a78bfa" : marginDelta != null && marginDelta < 0 ? "#f87171" : "#686878",
                    fontSize: 10, marginLeft: 2 }}
                    title={`${marginLabel}: ${margin.toFixed(1)}%${marginDelta != null ? ` (${marginDelta >= 0 ? "+" : ""}${marginDelta.toFixed(1)}pp)` : ""}`}>
                    {marginLabel}:{margin.toFixed(0)}%{marginDelta != null && marginDelta > 0 ? "▲" : marginDelta != null && marginDelta < 0 ? "▼" : ""}
                  </span>}
                </div>
                );
              })}
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

      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}

// ── CLICKABLE TICKER ──
function Ticker({ children, ticker, style, onClick, activeTicker, ...props }) {
  const isActive = ticker === activeTicker;
  return (
    <span {...props}
      ref={isActive ? (el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" }) : undefined}
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
  const [open, setOpen] = useState({});
  const [sort, setSort] = useState("rts");
  const [detailTheme, setDetailTheme] = useState(null);
  const [detailSort, setDetailSort] = useState("rs");
  const [healthFilter, setHealthFilter] = useState(null);
  const [showLegend, setShowLegend] = useState(false);
  const [showIntraday, setShowIntraday] = useState(true);
  const [intradaySort, setIntradaySort] = useState("chg");
  const [localLiveData, setLocalLiveData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);

  // Use external data from LiveView if available, otherwise fetch our own
  const liveThemeData = externalLiveData || localLiveData;

  // Auto-fetch theme universe when Leaders tab is active and no data exists
  useEffect(() => {
    if (liveThemeData || !themes || liveLoading) return;
    setLiveLoading(true);
    const tickers = new Set();
    themes.forEach(t => t.subthemes?.forEach(s => s.tickers?.forEach(tk => tickers.add(tk))));
    if (tickers.size === 0) { setLiveLoading(false); return; }
    const allTickers = [...tickers];
    const BATCH = 500;
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
        }
        if (results.length > 0) setLocalLiveData(prev => mergeThemeData(prev, results));
      } catch (e) {}
      finally { setLiveLoading(false); }
    })();
  }, [liveThemeData, themes, liveLoading]);

  // Merge new data with previous — keeps old entries if new fetch missed them
  function mergeThemeData(prev, next) {
    if (!prev || prev.length === 0) return next;
    if (!next || next.length === 0) return prev;
    const map = {};
    prev.forEach(s => { map[s.ticker] = s; });
    next.forEach(s => { map[s.ticker] = s; }); // new overwrites old
    return Object.values(map);
  }

  // Auto-refresh removed — parent now handles global theme universe refresh every 30s

  // Build liveLookup from liveThemeData (ticker → {change, rel_volume, ...})
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
      // Δ Breadth: live intraday breadth vs pipeline daily breadth (above 50MA %)
      const pipelineBreadth = t.breadth ?? 50;
      const deltaBreadth = liveBreadth - pipelineBreadth;
      // Rotation Score: composite of breadth, RVol, and Δ breadth (0-100 scale)
      // Breadth component: 0-40 pts (high % green = money flowing in)
      const breadthScore = Math.min(40, (liveBreadth / 100) * 40);
      // RVol component: 0-35 pts (institutional participation)
      const rvolScore = avgRvol != null ? Math.min(35, ((Math.min(avgRvol, 3) - 0.5) / 2.5) * 35) : 0;
      // Δ Breadth component: 0-25 pts (acceleration — live breadth gaining vs daily)
      const deltaScore = Math.max(0, Math.min(25, ((deltaBreadth + 30) / 60) * 25));
      const rotationScore = Math.round(Math.max(0, breadthScore + rvolScore + deltaScore));
      perf[t.theme] = { avg, up, total: changes.length, breadth: liveBreadth, avgRvol, deltaBreadth, rotationScore };
    });
    return perf;
  }, [liveThemeData, themes]);

  // Build theme breadth lookup from MM data
  const breadthMap = useMemo(() => {
    const m = {};
    if (mmData?.theme_breadth) {
      mmData.theme_breadth.forEach(tb => { m[tb.theme] = tb; });
    }
    return m;
  }, [mmData]);
  // Build theme health lookup
  const healthMap = useMemo(() => {
    const m = {};
    if (themeHealth) {
      themeHealth.forEach(h => { m[h.theme] = h; });
    }
    return m;
  }, [themeHealth]);

  // Intraday ranked themes
  const liveRanked = useMemo(() => {
    if (!hasLive) return [];
    const ranked = themes
      .map(t => ({ ...t, live: liveThemePerf[t.theme] }))
      .filter(t => t.live);
    const sorters = {
      chg: (a, b) => b.live.avg - a.live.avg,
      breadth: (a, b) => b.live.breadth - a.live.breadth,
      rvol: (a, b) => (b.live.avgRvol ?? 0) - (a.live.avgRvol ?? 0),
      rts: (a, b) => b.rts - a.rts,
      ret3m: (a, b) => (b.return_3m ?? 0) - (a.return_3m ?? 0),
      rotScore: (a, b) => (b.live.rotationScore ?? 0) - (a.live.rotationScore ?? 0),
      delta: (a, b) => (b.live.deltaBreadth ?? 0) - (a.live.deltaBreadth ?? 0),
      ret1w: (a, b) => (b.return_1w ?? 0) - (a.return_1w ?? 0),
    };
    ranked.sort(sorters[intradaySort] || sorters.chg);
    return ranked;
  }, [themes, liveThemePerf, hasLive, intradaySort]);

  const list = useMemo(() => {
    let t = [...themes];
    if (filters.minRTS > 0) t = t.filter(x => x.rts >= filters.minRTS);
    if (filters.quad) t = t.filter(x => getQuad(x.weekly_rs, x.monthly_rs) === filters.quad);
    if (filters.search) {
      const q = filters.search.toUpperCase();
      t = t.filter(x => x.theme.toUpperCase().includes(q) || x.subthemes.some(s => s.tickers.some(tk => tk.includes(q))));
    }
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
      a_grades: (a, b) => (b.a_grades || 0) - (a.a_grades || 0),
      health: (a, b) => (healthMap[b.theme]?.composite || 0) - (healthMap[a.theme]?.composite || 0),
    };
    t.sort(sorters[sort] || sorters.rts);
    return t;
  }, [themes, filters, sort, healthFilter, healthMap, liveThemePerf]);
  const toggle = (name) => {
    setOpen(p => ({ ...p, [name]: !p[name] }));
    setDetailTheme(name);
  };

  // Report visible ticker order to parent for keyboard nav
  useEffect(() => {
    if (onVisibleTickers) {
      if (detailTheme) {
        const theme = list.find(t => t.theme === detailTheme);
        if (theme) {
          const allStocks = theme.subthemes.flatMap(sub => sub.tickers.map(t => stockMap[t]).filter(Boolean));
          const safe = (fn) => (a, b) => {
            const av = fn(a), bv = fn(b);
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return bv - av;
          };
          const GRADE_ORDER = {"A+":12,"A":11,"A-":10,"B+":9,"B":8,"B-":7,"C+":6,"C":5,"C-":4,"D+":3,"D":2,"D-":1};
          const dSorters = {
            ticker: (a, b) => a.ticker.localeCompare(b.ticker),
            grade: safe(s => GRADE_ORDER[s.grade] ?? null),
            rs: safe(s => s.rs_rank),
            change: safe(s => liveLookup[s.ticker]?.change),
            ret3m: safe(s => s.return_3m),
            fromhi: safe(s => s.pct_from_high), adr: safe(s => s.adr_pct),
            vol: safe(s => { const rv = liveLookup[s.ticker]?.rel_volume ?? s.rel_volume; return s.avg_volume_raw && rv ? s.avg_volume_raw * rv : null; }),
            rvol: safe(s => liveLookup[s.ticker]?.rel_volume ?? s.rel_volume),
          };
          const sorted = [...allStocks].sort(dSorters[detailSort] || dSorters.rs);
          onVisibleTickers(sorted.map(s => s.ticker));
        }
      } else {
        const tickers = list.flatMap(t => t.subthemes.flatMap(s =>
          s.tickers.map(tk => stockMap[tk]).filter(Boolean).sort((a, b) => b.rs_rank - a.rs_rank).map(s => s.ticker)
        )).filter((v, i, a) => a.indexOf(v) === i);
        onVisibleTickers(tickers);
      }
    }
  }, [list, onVisibleTickers, stockMap, detailTheme, detailSort, liveLookup]);

  return (
    <div>
      {/* Intraday Theme Rotation Table */}
      {hasLive && (
        <div style={{ marginBottom: 12 }}>
          <div onClick={() => setShowIntraday(p => !p)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
              background: "#141420", border: "1px solid #222230", borderRadius: showIntraday ? "8px 8px 0 0" : 8 }}>
            <span style={{ color: "#0d9163", fontSize: 11 }}>●</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0d9163", textTransform: "uppercase", letterSpacing: 1 }}>
              Theme Rotation
            </span>
            <span style={{ color: "#686878", fontSize: 11 }}>{liveRanked.length} themes</span>
            {liveLoading && <span style={{ color: "#fbbf24", fontSize: 11 }}>Loading...</span>}
            <span style={{ marginLeft: "auto", color: "#686878", fontSize: 13 }}>{showIntraday ? "▾" : "▸"}</span>
          </div>
          {showIntraday && (
            <div style={{ background: "#141420", border: "1px solid #222230", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "4px 0" }}>
              <div style={{ display: "flex", gap: 12, padding: "4px 12px 6px", fontSize: 10, color: "#686878", flexWrap: "wrap", borderBottom: "1px solid #1a1a2a", alignItems: "center" }}>
                <span style={{ color: "#787888", fontWeight: 700 }}>SIGNAL:</span>
                <span><span style={{ display: "inline-block", padding: "0px 3px", borderRadius: 2, fontSize: 8, fontWeight: 700, color: "#2bb886", background: "#05966925", border: "1px solid #2bb88630", marginRight: 3, verticalAlign: "middle" }}>LEAD</span>Confirmed leader</span>
                <span><span style={{ display: "inline-block", padding: "0px 3px", borderRadius: 2, fontSize: 8, fontWeight: 700, color: "#0d916390", background: "#0d916312", border: "1px solid #0d916320", marginRight: 3, verticalAlign: "middle" }}>REST</span>Strong but quiet</span>
                <span><span style={{ display: "inline-block", padding: "0px 3px", borderRadius: 2, fontSize: 8, fontWeight: 700, color: "#fbbf24", background: "#fbbf2418", border: "1px solid #fbbf2430", marginRight: 3, verticalAlign: "middle" }}>ROT↑</span>Rotation in</span>
                <span><span style={{ display: "inline-block", padding: "0px 3px", borderRadius: 2, fontSize: 8, fontWeight: 700, color: "#dc262670", background: "#dc262610", border: "1px solid #dc262620", marginRight: 3, verticalAlign: "middle" }}>SKIP</span>Avoid</span>
                <span style={{ marginLeft: "auto", color: "#4a4a5a" }}>ROT = Breadth×.4 + RVol×.35 + ΔBrdth×.25</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #3a3a4a" }}>
                    {[
                      ["#", null, 24],
                      ["Theme", null, null],
                      ["Quad", null, 52],
                      ["ROT", "rotScore", 44],
                      ["Chg%", "chg", 56],
                      ["Breadth", "breadth", 64],
                      ["↑/Tot", null, 50],
                      ["RVol", "rvol", 44],
                      ["ΔBrdth", "delta", 52],
                      ["1W%", "ret1w", 48],
                      ["RTS", "rts", 36],
                      ["3M%", "ret3m", 48],
                    ].map(([h, sk, w]) => (
                      <th key={h} onClick={sk ? () => setIntradaySort(prev => prev === sk ? "chg" : sk) : undefined}
                        style={{ padding: "4px 4px", color: intradaySort === sk ? "#4aad8c" : "#787888", fontWeight: 600, textAlign: "center", fontSize: 10,
                          cursor: sk ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap", width: w || undefined }}>
                        {h}{intradaySort === sk ? " ▼" : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>{liveRanked.map((t, i) => {
                  const quad = getQuad(t.weekly_rs, t.monthly_rs);
                  const qc = QC[quad];
                  const chg = t.live.avg;
                  const brdth = t.live.breadth;
                  const rvol = t.live.avgRvol;
                  const delta = t.live.deltaBreadth;
                  const rotScore = t.live.rotationScore;
                  const isSelected = detailTheme === t.theme;
                  // Rotation signal classification
                  const isStructurallyStrong = quad === "STRONG" || quad === "IMPROVING";
                  const isTacticallyHot = brdth >= 60 && (rvol == null || rvol >= 1.0);
                  let sigLabel, sigColor, sigBg, rowGlow;
                  if (isStructurallyStrong && isTacticallyHot) {
                    sigLabel = "LEAD"; sigColor = "#2bb886"; sigBg = "#05966925"; rowGlow = "#05966910";
                  } else if (isStructurallyStrong && !isTacticallyHot) {
                    sigLabel = "REST"; sigColor = "#0d916390"; sigBg = "#0d916312"; rowGlow = "transparent";
                  } else if (!isStructurallyStrong && isTacticallyHot) {
                    sigLabel = "ROT↑"; sigColor = "#fbbf24"; sigBg = "#fbbf2418"; rowGlow = "#fbbf2408";
                  } else {
                    sigLabel = "SKIP"; sigColor = "#dc262670"; sigBg = "#dc262610"; rowGlow = "transparent";
                  }
                  // Rotation score bar color
                  const rotBarColor = rotScore >= 70 ? "#059669" : rotScore >= 50 ? "#2bb886" : rotScore >= 35 ? "#fbbf24" : "#686878";
                  return (
                    <tr key={t.theme} onClick={() => toggle(t.theme)}
                      style={{ borderBottom: "1px solid #222230", cursor: "pointer",
                        background: isSelected ? "#0d916315" : rowGlow }}>
                      {/* # */}
                      <td style={{ padding: "4px 4px", textAlign: "center", color: "#686878", fontFamily: "monospace", fontSize: 10, width: 24 }}>{i + 1}</td>
                      {/* Theme + signal tag */}
                      <td style={{ padding: "4px 6px", fontWeight: isSelected ? 600 : 400, color: isSelected ? "#0d9163" : "#b8b8c8",
                        maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderLeft: `3px solid ${qc.tag}` }}>
                        <span style={{ display: "inline-block", padding: "1px 4px", borderRadius: 3, fontSize: 8, fontWeight: 700,
                          color: sigColor, background: sigBg, border: `1px solid ${sigColor}30`, marginRight: 5, verticalAlign: "middle",
                          letterSpacing: 0.5, lineHeight: "14px" }}>{sigLabel}</span>
                        {t.theme}
                      </td>
                      {/* Quad */}
                      <td style={{ padding: "4px 4px", textAlign: "center" }}>
                        <span style={{ background: qc.tag, color: "#d4d4e0", padding: "1px 5px", borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{quad.slice(0, 4)}</span>
                      </td>
                      {/* Rotation Score — bar + number */}
                      <td style={{ padding: "4px 4px", textAlign: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "center" }}>
                          <div style={{ width: 22, height: 6, background: "#1a1a2a", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${rotScore}%`, height: "100%", background: rotBarColor, borderRadius: 3 }}></div>
                          </div>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, color: rotBarColor }}>{rotScore}</span>
                        </div>
                      </td>
                      {/* Chg% */}
                      <td style={{ padding: "4px 4px", textAlign: "center", fontWeight: 700, fontFamily: "monospace",
                        color: chg > 0 ? "#2bb886" : chg < 0 ? "#f87171" : "#9090a0" }}>
                        {chg > 0 ? "+" : ""}{chg.toFixed(2)}%
                      </td>
                      {/* Breadth — bar + % */}
                      <td style={{ padding: "4px 4px", textAlign: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "center" }}>
                          <div style={{ width: 28, height: 6, background: "#1a1a2a", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${brdth}%`, height: "100%", borderRadius: 3,
                              background: brdth >= 70 ? "#2bb886" : brdth >= 50 ? "#fbbf24" : "#f87171" }}></div>
                          </div>
                          <span style={{ fontFamily: "monospace", fontSize: 11,
                            color: brdth >= 70 ? "#2bb886" : brdth >= 50 ? "#fbbf24" : "#f87171" }}>{brdth}%</span>
                        </div>
                      </td>
                      {/* ↑/Total */}
                      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", color: "#9090a0", fontSize: 11 }}>
                        <span style={{ color: "#2bb886" }}>{t.live.up}</span>/<span style={{ color: "#787888" }}>{t.live.total}</span>
                      </td>
                      {/* RVol */}
                      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontWeight: rvol >= 1.5 ? 700 : 400,
                        color: rvol == null ? "#3a3a4a" : rvol < 1.0 ? "#686878" :
                          chg > 0 ? (rvol >= 2 ? "#22a06a" : rvol >= 1.5 ? "#2bb886" : "#2bb88688") :
                          chg < 0 ? (rvol >= 2 ? "#ef4444" : rvol >= 1.5 ? "#f87171" : "#f8717188") : "#9090a0" }}>
                        {rvol != null ? `${rvol.toFixed(1)}x` : '—'}
                      </td>
                      {/* Δ Breadth */}
                      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontWeight: Math.abs(delta) >= 15 ? 700 : 400,
                        color: delta > 15 ? "#22a06a" : delta > 5 ? "#2bb886" : delta > 0 ? "#2bb88688" : delta < -15 ? "#ef4444" : delta < -5 ? "#f87171" : delta < 0 ? "#f8717188" : "#686878" }}>
                        {delta > 0 ? "+" : ""}{delta}%
                      </td>
                      {/* 1W% */}
                      <td style={{ padding: "4px 4px", textAlign: "center" }}><Ret v={t.return_1w} bold /></td>
                      {/* RTS */}
                      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", color: qc.text, fontWeight: 700 }}>
                        {t.rts}
                      </td>
                      {/* 3M% */}
                      <td style={{ padding: "4px 4px", textAlign: "center" }}><Ret v={t.return_3m} bold /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sort buttons */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {[["rts","RTS"],
          ...(hasLive ? [["live_change","Chg%"]] : []),
          ["return_3m","3M"],["breadth","Brdth"],["a_grades","A's"],["health","Health"]].map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)} style={{ padding: "4px 10px", borderRadius: 4,
            border: sort === k ? "1px solid #0d9163" : "1px solid #3a3a4a",
            background: sort === k ? "#0d916320" : "transparent", color: sort === k ? "#4aad8c" : "#9090a0", fontSize: 12, cursor: "pointer" }}>{l}</button>
        ))}
        {Object.keys(healthMap).length > 0 && (<>
          <span style={{ color: "#3a3a4a", margin: "0 2px" }}>|</span>
          {[["All", null],["★ ADD","ADD"],["✗ REMOVE","REMOVE"],["Leading","LEADING"],["Emerging","EMERGING"],["Weakening","WEAKENING"],["Lagging","LAGGING"]].map(([label, val]) => (
            <button key={label} onClick={() => setHealthFilter(healthFilter === val ? null : val)} style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, cursor: "pointer",
              border: healthFilter === val ? "1px solid #0d9163" : "1px solid #3a3a4a",
              background: healthFilter === val ? "#0d916320" : "transparent",
              color: healthFilter === val ? "#4aad8c" : val === "ADD" ? "#2bb886" : val === "REMOVE" ? "#f87171" : "#787888" }}>{label}</button>
          ))}
        </>)}
      </div>
      {/* Legend */}
      <div onClick={() => setShowLegend(p => !p)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", marginBottom: showLegend ? 0 : 6, background: "#1a1a24",
          borderRadius: showLegend ? "4px 4px 0 0" : 4, fontSize: 10, color: "#787888", cursor: "pointer", userSelect: "none" }}>
        <span style={{ fontSize: 11 }}>{showLegend ? "▾" : "▸"}</span>
        <span style={{ fontWeight: 700 }}>LEGEND</span>
      </div>
      {showLegend && (
      <div style={{ display: "flex", gap: 12, padding: "6px 12px", marginBottom: 6, background: "#1a1a24", borderRadius: "0 0 4px 4px", fontSize: 10, color: "#787888", flexWrap: "wrap", alignItems: "center", lineHeight: 1.8 }}>
        <span><span style={{ color: "#059669" }}>STRONG</span>/<span style={{ color: "#d97706" }}>IMPROVING</span>/<span style={{ color: "#ea580c" }}>WEAKENING</span>/<span style={{ color: "#dc2626" }}>WEAK</span> — Quadrant (Weekly vs Monthly RS)</span>
        <span style={{ color: "#3a3a4a" }}>|</span>
        <span><span style={{ color: "#9090a0" }}>11</span> — Stock count</span>
        <span style={{ color: "#3a3a4a" }}>|</span>
        <span><span style={{ color: "#4aad8c" }}>78.5</span> — RTS Score (0-100, composite theme momentum)</span>
        <span style={{ color: "#3a3a4a" }}>|</span>
        <span><span style={{ color: "#9090a0" }}>B:100%</span> — Breadth (% of stocks above 50MA; <span style={{ color: "#2bb886" }}>≥60%</span> healthy, <span style={{ color: "#fbbf24" }}>≥40%</span> mixed, <span style={{ color: "#f87171" }}>&lt;40%</span> weak)</span>
        <span style={{ color: "#3a3a4a" }}>|</span>
        <span><span style={{ color: "#9090a0" }}>1W% 1M%</span> <span style={{ color: "#b8b8c8" }}>3M%</span> — Returns</span>
        <span style={{ color: "#3a3a4a" }}>|</span>
        <span><span style={{ color: "#9090a0" }}>4A</span> — Count of A+/A/A- graded stocks (top momentum names)</span>
        <span style={{ color: "#3a3a4a" }}>|</span>
        <span><span style={{ color: "#2bb886" }}>4%↑2</span> <span style={{ color: "#f87171" }}>↓1</span> — Today's 4%+ movers on above-avg volume (green = buying, red = selling)</span>
        {Object.keys(healthMap).length > 0 && (<>
          <span style={{ color: "#3a3a4a" }}>|</span>
          <span><span style={{ color: "#2bb886" }}>★ ADD</span> / <span style={{ color: "#f87171" }}>✗ REMOVE</span> — Theme health signal (structure + momentum + breakouts + breadth composite)</span>
        </>)}
      </div>)}
      {list.map(theme => {
        const quad = getQuad(theme.weekly_rs, theme.monthly_rs);
        const qc = QC[quad]; const isOpen = open[theme.theme];
        const barW = Math.max(5, Math.min(100, theme.rts));
        return (
          <div key={theme.theme} style={{ marginBottom: 4, borderRadius: 6, border: "1px solid #3a3a4a", overflow: "hidden" }}>
            <div onClick={() => toggle(theme.theme)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
              background: `linear-gradient(90deg, ${qc.bg} ${barW}%, #111 ${barW}%)` }}>
              <span style={{ color: "#d4d4e0", fontSize: 14, width: 16 }}>{isOpen ? "▾" : "▸"}</span>
              <span style={{ color: "#d4d4e0", fontWeight: 600, fontSize: 13, flex: 1 }}>
                {theme.theme}
                {onThemeDrillDown && <span onClick={(e) => { e.stopPropagation(); onThemeDrillDown(theme.theme); }}
                  title={`View ${theme.theme} in Scan Watch`}
                  style={{ marginLeft: 6, fontSize: 10, color: "#686878", cursor: "pointer", padding: "1px 4px", borderRadius: 3,
                    border: "1px solid #3a3a4a" }}
                  onMouseEnter={e => { e.target.style.color = "#4aad8c"; e.target.style.borderColor = "#0d9163"; }}
                  onMouseLeave={e => { e.target.style.color = "#686878"; e.target.style.borderColor = "#3a3a4a"; }}>⇢ Scan</span>}
              </span>
              <span style={{ background: qc.tag, color: "#d4d4e0", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{quad}</span>
              <span style={{ color: "#9090a0", fontSize: 12 }}>{theme.count}</span>
              <span style={{ color: qc.text, fontWeight: 600, fontSize: 13, fontFamily: "monospace" }}>{theme.rts}</span>
              {(() => { const lp = liveThemePerf[theme.theme]; if (!lp) return null;
                return <span style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 13,
                  color: lp.avg > 0 ? "#2bb886" : lp.avg < 0 ? "#f87171" : "#9090a0" }}>
                  {lp.avg > 0 ? "+" : ""}{lp.avg.toFixed(2)}%
                </span>;
              })()}
              <span style={{ color: "#9090a0", fontSize: 12 }}>B:{theme.breadth}%</span>
              <Ret v={theme.return_3m} bold />
              <span style={{ color: "#9090a0", fontSize: 12 }}>{theme.a_grades}A</span>
              {(() => { const h = healthMap[theme.theme]; if (!h) return null;
                const sc = { LEADING: { bg: "#22a06a18", border: "#22a06a50", color: "#2bb886" },
                  EMERGING: { bg: "#fbbf2418", border: "#fbbf2450", color: "#fbbf24" },
                  HOLDING: { bg: "#88888812", border: "#88888830", color: "#9090a0" },
                  WEAKENING: { bg: "#f9731618", border: "#f9731640", color: "#f97316" },
                  LAGGING: { bg: "#ef444418", border: "#ef444440", color: "#f87171" } }[h.status] || {};
                const sig = h.signal === "ADD" ? "★" : h.signal === "REMOVE" ? "✗" : "";
                return <span title={`Health: ${h.composite} | Struct: ${h.pillars.structure} | Mom: ${h.pillars.momentum} | Brk: ${h.pillars.breakouts} | Brdth: ${h.pillars.breadth}`}
                  style={{ padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                    background: sc.bg, border: `1px solid ${sc.border}`, color: sc.color }}>
                  {sig}{sig ? " " : ""}{h.status} {h.composite}</span>;
              })()}
              {(() => { const tb = breadthMap[theme.theme]; if (!tb || (tb.up_4pct === 0 && tb.down_4pct === 0)) return null;
                return <span style={{ fontSize: 10, fontFamily: "monospace", padding: "1px 5px", borderRadius: 3, marginLeft: 2,
                  background: tb.net > 0 ? "#22a06a15" : tb.net < 0 ? "#ef444415" : "#3a3a4a30",
                  border: `1px solid ${tb.net > 0 ? "#22a06a30" : tb.net < 0 ? "#ef444430" : "#3a3a4a40"}`,
                  color: tb.net > 0 ? "#2bb886" : tb.net < 0 ? "#f87171" : "#787888" }}>
                  4%↑{tb.up_4pct} ↓{tb.down_4pct}</span>;
              })()}
            </div>
            {isOpen && (
              <div style={{ background: "#121218", padding: "4px 8px" }}>
                {/* Theme summary bar */}
                {(() => {
                  const allStocks = theme.subthemes.flatMap(sub => sub.tickers.map(t => stockMap[t]).filter(Boolean));
                  // 52W high proximity distribution
                  const hi5 = allStocks.filter(s => s.pct_from_high >= -5).length;
                  const hi10 = allStocks.filter(s => s.pct_from_high >= -10 && s.pct_from_high < -5).length;
                  const hi25 = allStocks.filter(s => s.pct_from_high >= -25 && s.pct_from_high < -10).length;
                  const hi50 = allStocks.filter(s => s.pct_from_high >= -50 && s.pct_from_high < -25).length;
                  const hiRest = allStocks.filter(s => s.pct_from_high < -50).length;
                  const total = allStocks.length || 1;
                  return (
                  <div style={{ display: "flex", gap: 16, padding: "6px 8px", marginBottom: 6, background: "#1a1a24", borderRadius: 4, fontSize: 11, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ color: "#9090a0" }}>Stocks: <span style={{ color: "#d4d4e0" }}>{theme.count}</span></span>
                    <span style={{ color: "#9090a0" }}>A grades: <span style={{ color: "#2bb886" }}>{theme.a_grades}</span></span>
                    <span style={{ color: "#9090a0" }}>Breadth: <span style={{ color: theme.breadth >= 60 ? "#2bb886" : theme.breadth >= 40 ? "#fbbf24" : "#f87171" }}>{theme.breadth}%</span></span>
                    <span style={{ color: "#9090a0" }}>Avg RS: <span style={{ color: "#b8b8c8" }}>{Math.round(allStocks.reduce((a, s) => a + (s.rs_rank || 0), 0) / total)}</span></span>
                    {(() => { const best = [...allStocks].sort((a, b) => b.return_3m - a.return_3m)[0];
                      return best ? <span style={{ color: "#9090a0" }}>Top 3M: <span style={{ color: "#2bb886" }}>{best.ticker}</span> <Ret v={best.return_3m} bold /></span> : null;
                    })()}
                    {/* 52W High Proximity Distribution */}
                    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 1, marginLeft: 4 }} title={`Within 5%: ${hi5}\n5-10%: ${hi10}\n10-25%: ${hi25}\n25-50%: ${hi50}\n>50%: ${hiRest}`}>
                      <span style={{ fontSize: 10, color: "#686878", marginRight: 2, alignSelf: "center" }}>52WH:</span>
                      {[[hi5,"#2bb886","<5%"],[hi10,"#60a5fa","5-10"],[hi25,"#fbbf24","10-25"],[hi50,"#f97316","25-50"],[hiRest,"#f87171",">50"]].map(([cnt, col, lbl]) => (
                        <span key={lbl} title={`${lbl}%: ${cnt}`} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                          <span style={{ width: 14, background: col + "60", borderRadius: "2px 2px 0 0",
                            height: Math.max(2, Math.round(cnt / total * 40)) }} />
                          <span style={{ fontSize: 9, color: "#686878" }}>{cnt}</span>
                        </span>
                      ))}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); setDetailTheme(detailTheme === theme.theme ? null : theme.theme); }}
                      style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                        border: detailTheme === theme.theme ? "1px solid #0d9163" : "1px solid #3a3a4a",
                        background: detailTheme === theme.theme ? "#0d916320" : "transparent",
                        color: detailTheme === theme.theme ? "#4aad8c" : "#787888" }}>
                      {detailTheme === theme.theme ? "Close Table" : "Detail Table"}</button>
                  </div>
                  );
                })()}

                {/* Health pillar breakdown */}
                {(() => { const h = healthMap[theme.theme]; if (!h) return null;
                  const bars = [
                    ["Structure", h.pillars.structure, `>20MA: ${h.detail.above_20}% | >50MA: ${h.detail.above_50}% | >200MA: ${h.detail.above_200}% | Stacked: ${h.detail.ma_stacked}%`],
                    ["Momentum", h.pillars.momentum, `Avg RS: ${h.detail.avg_rs} | Accel: ${h.detail.accelerating ? "Yes" : "No"}`],
                    ["Breakouts", h.pillars.breakouts, `<5% from high: ${h.detail.near_high_5}% | <10%: ${h.detail.near_high_10}% | A-density: ${h.detail.a_density}%`],
                    ["Breadth", h.pillars.breadth, `Positive 1M: ${h.detail.positive_1m_pct}% | Dispersion: ${h.detail.ret_dispersion}`],
                  ];
                  return (
                    <div style={{ display: "flex", gap: 10, padding: "4px 8px", marginBottom: 4, fontSize: 10, alignItems: "center" }}>
                      <span style={{ color: "#686878", fontSize: 10, minWidth: 45 }}>HEALTH</span>
                      {bars.map(([label, val, tip]) => (
                        <span key={label} title={tip} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <span style={{ color: "#787888" }}>{label}</span>
                          <span style={{ width: 40, height: 4, background: "#2a2a38", borderRadius: 2, overflow: "hidden", display: "inline-block" }}>
                            <span style={{ width: `${val}%`, height: "100%", display: "block", borderRadius: 2,
                              background: val >= 65 ? "#2bb886" : val >= 40 ? "#fbbf24" : "#f87171" }} />
                          </span>
                          <span style={{ color: val >= 65 ? "#2bb886" : val >= 40 ? "#fbbf24" : "#f87171", fontFamily: "monospace" }}>{Math.round(val)}</span>
                        </span>
                      ))}
                    </div>
                  );
                })()}

                {/* Detail table view */}
                {detailTheme === theme.theme && (() => {
                  const allStocks = theme.subthemes.flatMap(sub => sub.tickers.map(t => stockMap[t]).filter(Boolean));
                  const cols = [["Ticker","ticker"],["Grade","grade"],["RS","rs"],["Chg%","change"],["3M%","ret3m"],["FrHi%","fromhi"],["ADR%","adr"],["$Vol","dvol"],["Vol","vol"],["RVol","rvol"],["Subtheme",null]];
                  const safe = (fn) => (a, b) => {
                    const av = fn(a), bv = fn(b);
                    if (av == null && bv == null) return 0;
                    if (av == null) return 1;
                    if (bv == null) return -1;
                    return bv - av;
                  };
                  const GRADE_ORDER = {"A+":12,"A":11,"A-":10,"B+":9,"B":8,"B-":7,"C+":6,"C":5,"C-":4,"D+":3,"D":2,"D-":1};
                  const dSorters = {
                    ticker: (a, b) => a.ticker.localeCompare(b.ticker),
                    grade: safe(s => GRADE_ORDER[s.grade] ?? null),
                    rs: safe(s => s.rs_rank),
                    change: safe(s => liveLookup[s.ticker]?.change),
                    ret3m: safe(s => s.return_3m),
                    fromhi: safe(s => s.pct_from_high),
                    adr: safe(s => s.adr_pct),
                    dvol: safe(s => s.avg_dollar_vol_raw),
                    vol: safe(s => s.avg_volume_raw && s.rel_volume ? s.avg_volume_raw * s.rel_volume : null),
                    rvol: safe(s => s.rel_volume),
                  };
                  // Build ticker→subtheme map
                  const subMap = {};
                  theme.subthemes.forEach(sub => sub.tickers.forEach(t => { subMap[t] = sub.name; }));
                  const sorted = [...allStocks].sort(dSorters[detailSort] || dSorters.rs);
                  return (
                    <div style={{ marginBottom: 8 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead><tr style={{ borderBottom: "2px solid #3a3a4a" }}>
                          {cols.map(([h, sk]) => (
                            <th key={h} onClick={sk ? () => setDetailSort(prev => prev === sk ? "rs" : sk) : undefined}
                              style={{ padding: "4px 6px", color: detailSort === sk ? "#4aad8c" : "#787888", fontWeight: 600, textAlign: "center", fontSize: 10,
                                cursor: sk ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>
                              {h}{detailSort === sk ? " ▼" : ""}</th>
                          ))}
                        </tr></thead>
                        <tbody>{sorted.map(s => {
                          const near = s.pct_from_high >= -5;
                          const isAct = s.ticker === activeTicker;
                          return (
                            <tr key={s.ticker}
                              ref={isAct ? (el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" }) : undefined}
                              onClick={() => onTickerClick(s.ticker)}
                              style={{ borderBottom: "1px solid #222230", cursor: "pointer",
                                background: isAct ? "#0d916315"
                                  : s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 1 ? "rgba(248, 113, 113, 0.12)"
                                  : s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 3 ? "rgba(248, 113, 113, 0.07)"
                                  : s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 7 ? "rgba(248, 113, 113, 0.03)"
                                  : "transparent" }}>
                              <td style={{ padding: "3px 6px", textAlign: "center", color: isAct ? "#0d9163" : "#d4d4e0", fontWeight: 600 }}>{s.ticker}</td>
                              <td style={{ padding: "3px 6px", textAlign: "center" }}><Badge grade={s.grade} /></td>
                              <td style={{ padding: "3px 6px", textAlign: "center", color: "#b8b8c8", fontFamily: "monospace" }}>{s.rs_rank}</td>
                              {(() => { const chg = liveLookup[s.ticker]?.change; const c = chg > 0 ? "#2bb886" : chg < 0 ? "#f87171" : "#9090a0";
                                return <td style={{ padding: "3px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11, color: chg != null ? c : "#3a3a4a" }}>
                                  {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}</td>; })()}
                              <td style={{ padding: "3px 6px", textAlign: "center" }}><Ret v={s.return_3m} bold /></td>
                              <td style={{ padding: "3px 6px", textAlign: "center", color: near ? "#2bb886" : "#9090a0", fontFamily: "monospace" }}>{s.pct_from_high}%</td>
                              <td style={{ padding: "3px 6px", textAlign: "center", fontFamily: "monospace",
                                color: s.adr_pct > 8 ? "#2dd4bf" : s.adr_pct > 5 ? "#2bb886" : s.adr_pct > 3 ? "#fbbf24" : "#f97316" }}>
                                {s.adr_pct != null ? `${s.adr_pct}%` : '—'}</td>
                              <td style={{ padding: "3px 6px", textAlign: "center", fontFamily: "monospace",
                                color: s.avg_dollar_vol_raw > 20000000 ? "#2bb886" : s.avg_dollar_vol_raw > 10000000 ? "#fbbf24" : s.avg_dollar_vol_raw > 5000000 ? "#f97316" : "#f87171" }}>
                                {s.avg_dollar_vol ? `$${s.avg_dollar_vol}` : '—'}</td>
                              {(() => { const lv = liveLookup[s.ticker]; const rv = lv?.rel_volume ?? s.rel_volume;
                                const v = s.avg_volume_raw && rv ? Math.round(s.avg_volume_raw * rv) : null;
                                const fmt = v == null ? '—' : v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : `${v}`;
                                return <td style={{ padding: "3px 6px", textAlign: "center", fontFamily: "monospace",
                                  color: v >= 1e6 ? "#9090a0" : v != null ? "#f97316" : "#3a3a4a" }}>{fmt}</td>; })()}
                              {(() => { const lv = liveLookup[s.ticker]; const rv = lv?.rel_volume ?? s.rel_volume;
                                return <td style={{ padding: "3px 6px", textAlign: "center", fontFamily: "monospace",
                                color: rv >= 2 ? "#c084fc" : rv >= 1.5 ? "#a78bfa" : rv != null ? "#686878" : "#3a3a4a" }}>
                                {rv != null ? `${Number(rv).toFixed(1)}x` : '—'}</td>; })()}
                              <td style={{ padding: "3px 6px", color: "#686878", fontSize: 10 }}>{subMap[s.ticker]}</td>
                            </tr>
                          );
                        })}</tbody>
                      </table>
                    </div>
                  );
                })()}

                {/* Compact badge view (original) — shown when detail table is NOT active */}
                {detailTheme !== theme.theme && theme.subthemes.map(sub => (
                  <div key={sub.name} style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderBottom: "1px solid #222230", fontSize: 12 }}>
                      <span style={{ color: "#b8b8c8", fontWeight: 400, width: 160, textAlign: "left" }}>{sub.name}</span>
                      <span style={{ color: "#787888", width: 24, textAlign: "center" }}>{sub.count}</span>
                      <span style={{ color: sub.rts >= 65 ? "#2bb886" : sub.rts >= 50 ? "#60a5fa" : "#fbbf24", fontWeight: 600, fontFamily: "monospace", width: 32 }}>{sub.rts}</span>
                      <Ret v={sub.return_1m} /><Ret v={sub.return_3m} bold />
                      <span style={{ color: "#787888", fontSize: 11 }}>B:{sub.breadth}%</span>
                      <span style={{ color: "#787888", fontSize: 11 }}>{sub.a_grades}A</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "4px 8px" }}>
                      {sub.tickers.map(t => stockMap[t]).filter(Boolean).sort((a, b) => b.rs_rank - a.rs_rank).map(s => {
                        const ext = s.atr_to_50 >= 7 ? "#f87171" : s.atr_to_50 >= 5 ? "#c084fc" : null;
                        const gc = GRADE_COLORS[s.grade] || "#3a3a4a";
                        return (
                          <Ticker key={s.ticker} ticker={s.ticker} onClick={onTickerClick} activeTicker={activeTicker}
                            title={`${s.company}\nGrade: ${s.grade} | RS: ${s.rs_rank}\n3M: ${s.return_3m}% | ATR/50: ${s.atr_to_50}\nFrom High: ${s.pct_from_high}%`}
                            style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px", borderRadius: 4, fontSize: 12, fontFamily: "monospace",
                              background: gc + "20", border: `1px solid ${gc}40`, color: ext || "#ddd", fontWeight: ext ? 700 : 400 }}>
                            <Badge grade={s.grade} /> {s.ticker}
                          </Ticker>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ color: "#686878", fontSize: 12, marginTop: 8 }}>{list.length} themes shown</div>
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
  let score = 0;
  const factors = [];
  let hasAnyData = false;

  // ── Current Year EPS (primary available signal) — Zanger: 40%+ minimum ──
  const epsThisY = s.eps_this_y;
  if (epsThisY != null) {
    hasAnyData = true;
    if (epsThisY >= 100) { score += 35; factors.push("C↑↑"); }       // Monster growth
    else if (epsThisY >= 40) { score += 25; factors.push("C↑"); }    // Zanger minimum
    else if (epsThisY >= 25) { score += 15; }                         // O'Neil A minimum
    else if (epsThisY >= 10) { score += 5; }
    else if (epsThisY < 0) { score -= 10; factors.push("C↓"); }
  }

  // ── Long-term EPS (confirms sustained growth) ──
  const eps5Y = s.eps_past_5y;
  if (eps5Y != null) {
    hasAnyData = true;
    if (eps5Y >= 40) { score += 20; factors.push("A↑"); }
    else if (eps5Y >= 25) { score += 12; }
    else if (eps5Y >= 10) { score += 5; }
    else if (eps5Y < 0) { score -= 8; factors.push("A↓"); }
  }

  // ── Sales growth (proves revenue-driven, not cost-cutting) ──
  const salesAnn = s.sales_past_5y;
  const salesQQ = s.sales_qq;  // null until yfinance/FMP added
  if (salesQQ != null) {
    hasAnyData = true;
    if (salesQQ >= 40) { score += 20; factors.push("S↑↑"); }
    else if (salesQQ >= 25) { score += 15; factors.push("S↑"); }
    else if (salesQQ >= 10) { score += 8; }
    else if (salesQQ < -10) { score -= 5; }
  } else if (salesAnn != null) {
    hasAnyData = true;
    if (salesAnn >= 25) { score += 15; factors.push("S↑"); }
    else if (salesAnn >= 10) { score += 8; }
    else if (salesAnn < 0) { score -= 5; factors.push("S↓"); }
  }

  // ── Quarterly EPS Q/Q boost (when available from yfinance/FMP) ──
  const epsQQ = s.eps_qq;
  if (epsQQ != null) {
    hasAnyData = true;
    if (epsQQ >= 100) { score += 15; factors.push("QQ↑↑"); }
    else if (epsQQ >= 40) { score += 10; factors.push("QQ↑"); }
    else if (epsQQ < 0) { score -= 5; }
  }

  // ── Acceleration: this year > 5-year avg = growth speeding up ──
  if (epsThisY != null && eps5Y != null && epsThisY > eps5Y && epsThisY >= 25) {
    score += 10; factors.push("Acc");
  }

  if (!hasAnyData) return { score: null, factors: [] };

  // Normalize: max realistic score ~100 (35+20+15+15+10=95 best case with all data)
  const normalized = Math.min(100, Math.max(0, score));

  return { score: normalized, factors };
}

function computeStockQuality(s, leadingThemes) {
  if (!s) return { quality: 0, q_factors: [] };
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
  return { quality: q, q_factors: factors };
}

function Scan({ stocks, themes, onTickerClick, activeTicker, onVisibleTickers, liveThemeData: externalLiveData, onLiveThemeData, portfolio, watchlist, initialThemeFilter, onConsumeThemeFilter, epSignals, manualEPs }) {
  const [sortBy, setSortBy] = useState("default");
  const [nearPivot, setNearPivot] = useState(false);
  const [greenOnly, setGreenOnly] = useState(false);
  const [minRS, setMinRS] = useState(70);
  const [scanFilters, setScanFilters] = useState(new Set(["T"]));
  const [activeTheme, setActiveTheme] = useState(null);
  const [mcapFilter, setMcapFilter] = useState("small"); // "small" = all, "mid" = mid+large, "large" = large only
  const [volFilter, setVolFilter] = useState(0); // 0 = no filter, 50000, 100000

  // Build EP ticker lookup: ticker → most recent EP signal (pipeline + manual)
  const epLookup = useMemo(() => {
    const m = {};
    if (epSignals) {
      epSignals.forEach(ep => {
        if (!m[ep.ticker] || ep.days_ago < m[ep.ticker].days_ago) m[ep.ticker] = ep;
      });
    }
    // Manual EPs override / supplement — update days_ago based on current date
    if (manualEPs) {
      const today = new Date();
      manualEPs.forEach(ep => {
        const daysAgo = ep.date ? Math.round((today - new Date(ep.date)) / 86400000) : 0;
        const entry = { ...ep, days_ago: daysAgo, consol: ep.consol || { status: daysAgo <= 1 ? "fresh" : "holding" }, manual: true };
        if (!m[ep.ticker] || daysAgo < m[ep.ticker].days_ago) m[ep.ticker] = entry;
      });
    }
    return m;
  }, [epSignals, manualEPs]);

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
      if (epLookup[s.ticker]) hits.push("EP");

      // ── CANSLIM tag ──
      const epsG = s.eps_this_y ?? s.eps_past_5y;
      const salesG = s.sales_qq ?? s.sales_past_5y;
      const csC = (s.eps_qq != null && s.eps_qq >= 40) || (epsG != null && epsG >= 40);
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
    });

    // No tag filters = show all stocks (with tags attached), tag filters = AND filter
    if (scanFilters.size === 0) {
      list = stocks.map(s => ({ ...s, _scanHits: hitMap[s.ticker] || [], _mfPct: mfRankMap[s.ticker] }));
    } else {
      list = stocks.filter(s => {
        const hits = new Set(hitMap[s.ticker] || []);
        for (const f of scanFilters) {
          if (!hits.has(f)) return false;
        }
        return true;
      }).map(s => ({ ...s, _scanHits: hitMap[s.ticker] || [], _mfPct: mfRankMap[s.ticker] }));
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
    };
    return list.sort(sorters[sortBy] || sorters.hits);
  }, [stocks, leading, sortBy, nearPivot, greenOnly, minRS, activeTheme, scanFilters, mcapFilter, volFilter, liveLookup, epLookup]);

  // Report visible ticker order to parent for keyboard nav
  useEffect(() => {
    if (onVisibleTickers) onVisibleTickers(candidates.map(s => s.ticker));
  }, [candidates, onVisibleTickers]);

  const tagCounts = useMemo(() => {
    const counts = { T: 0, W: 0, L: 0, E: 0, EP: 0, CS: 0, ZM: 0, "MF+": 0, "MF-": 0 };
    candidates.forEach(s => (s._scanHits || []).forEach(h => { if (counts[h] !== undefined) counts[h]++; }));
    return counts;
  }, [candidates]);

  const columns = [
    ["Ticker", "ticker"],
    ["Tags", "hits"],
    ["Q", "quality"], ["VCS", "vcs"], ["MF", "mf"],
    ["Grade", "grade"], ["RS", "rs"],
    ["Chg%", "change"], ["3M%", "ret3m"],
    ["FrHi%", "fromhi"], ["ADR%", "adr"], ["$Vol", "dvol"], ["Vol", "vol"], ["RVol", "rvol"], ["Theme", null], ["Subtheme", null],
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {/* Tag filter toggles */}
        {[
          ["T", "Theme", "#2bb886"], ["W", "Winners", "#c084fc"], ["L", "Liquid", "#60a5fa"],
          ["E", "Early", "#fbbf24"], ["EP", "EP", "#f97316"], ["CS", "CANSLIM", "#22d3ee"], ["ZM", "Zanger", "#a78bfa"],
          ["MF+", "MF+", "#2bb886"], ["MF-", "MF−", "#f87171"]
        ].map(([tag, label, color]) => {
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
        <span style={{ color: "#2bb886", fontWeight: 600, fontSize: 12 }}>{candidates.length}</span>
        {scanFilters.size > 0 && (
          <span style={{ color: "#9090a0", fontSize: 9, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(() => {
              const descs = { T: "A/B+ grade, leading theme, 3M≥21%, >50MA",
                W: "ADR>4.5%, ab52WL≥70%, $Vol>7M, >20/50MA",
                L: "MCap>300M, AvgVol>1M, $Vol>100M, ADR>3%, EPS>20%",
                E: ">50MA(<10%), >200MA, RS:50-85, FrHi<-10%",
                EP: "Gap + volume surge on earnings/news",
                CS: "EPS≥40%, near highs, RS≥80, supply/demand",
                ZM: "Leading theme, >MAs, near highs, tight to 50MA" };
              const active = [...scanFilters];
              if (active.length === 1) return descs[active[0]] || "";
              return active.map(f => f).join(" + ");
            })()}
          </span>
        )}
        <button onClick={() => setNearPivot(p => !p)} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer", marginLeft: "auto",
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
            <tr key={s.ticker} ref={isActive ? (el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" }) : undefined}
              onClick={() => onTickerClick(s.ticker)}
              style={{ borderBottom: "1px solid #222230", cursor: "pointer",
                borderLeft: inPortfolio ? "3px solid #fbbf24" : inWatchlist ? "3px solid #60a5fa" : "3px solid transparent",
                background: isActive ? "rgba(251, 191, 36, 0.10)"
                  : s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 1 ? "rgba(248, 113, 113, 0.12)"
                  : s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 3 ? "rgba(248, 113, 113, 0.07)"
                  : s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 7 ? "rgba(248, 113, 113, 0.03)"
                  : "transparent" }}>
              <td style={{ padding: "4px 8px", textAlign: "center", color: isActive ? "#0d9163" : "#d4d4e0", fontWeight: 600 }}>
                <span>{s.ticker}</span>
                {s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 14 && (
                  <span title={s.earnings_display || s.earnings_date || `${s.earnings_days}d`}
                    style={{ marginLeft: 3, padding: "0px 3px", borderRadius: 2, fontSize: 7, fontWeight: 700, verticalAlign: "super",
                      color: s.earnings_days <= 1 ? "#fff" : "#f87171",
                      background: s.earnings_days <= 1 ? "#dc2626" : "#f8717120",
                      border: `1px solid ${s.earnings_days <= 1 ? "#dc2626" : "#f8717130"}` }}>
                    ER{s.earnings_days === 0 ? "" : s.earnings_days}
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
                      ZM: { bg: "#a78bfa20", color: "#a78bfa", label: "ZM" } }[h];
                    if (!hc) return null;
                    return <span key={h} style={{ padding: "0px 3px", borderRadius: 2, fontSize: 8, fontWeight: 700,
                      color: hc.color, background: hc.bg, border: `1px solid ${hc.color}30` }}>{hc.label}</span>;
                  })}
                </div>
              </td>
              <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
                color: s._quality >= 80 ? "#2bb886" : s._quality >= 60 ? "#60a5fa" : s._quality >= 40 ? "#9090a0" : "#686878" }}
                title={s._q_factors?.length ? s._q_factors.map(f => {
                  const labels = { "C↑↑": "EPS This Y ≥100%", "C↑": "EPS This Y ≥40%", "A↑": "EPS 5Y ≥40%", "A↑": "Annual EPS ≥40%", "A↓": "Neg annual EPS",
                    "S↑": "Sales ≥25%", "NH": "New 52W high", "LF": "Low float <15M", "MF": "Float <50M", "L": "RS leader ≥90",
                    "NI": "Low inst <30%", "SR": "Short ratio ≥5d", "SQ": "Short ≥15%",
                    "SC": "Small cap <$2B", "MC": "Mid cap <$10B", "IPO": "Young IPO", "TH": "Leading theme",
                    "S↓": "Neg sales", "S↑↑": "Sales Q/Q ≥40%", "QQ↑↑": "EPS Q/Q ≥100%", "QQ↑": "EPS Q/Q ≥40%", "Acc": "EPS accelerating", "Gr": "A-grade", "Deep": "Deep off highs" };
                  return labels[f] || f; }).join("\n") : ""}>
                {s._quality ?? "—"}</td>
              <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
                color: s.vcs >= 80 ? "#2bb886" : s.vcs >= 60 ? "#fbbf24" : s.vcs != null ? "#686878" : "#3a3a4a" }}
                title={s.vcs_components ? `ATR:${s.vcs_components.atr_contraction} Range:${s.vcs_components.range_compression} MA:${s.vcs_components.ma_convergence} Vol:${s.vcs_components.volume_dryup} Prox:${s.vcs_components.proximity_highs}` : ""}>
                {s.vcs ?? "—"}</td>
              <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
                color: s.mf > 30 ? "#2bb886" : s.mf > 0 ? "#4a9070" : s.mf < -30 ? "#f87171" : s.mf < 0 ? "#c06060" : s.mf != null ? "#686878" : "#3a3a4a" }}
                title={s.mf_components ? `P${s._mfPct ?? '—'} | DVol:${s.mf_components.dvol_trend} RVPers:${s.mf_components.rvol_persistence} UpVol:${s.mf_components.up_vol_ratio} PVDir:${s.mf_components.price_vol_dir}` : ""}>
                {s.mf != null ? <>{s.mf > 0 ? `+${s.mf}` : s.mf}<sup style={{ fontSize: 7, color: "#505060", marginLeft: 1 }}>{s._mfPct ?? ''}</sup></> : "—"}</td>
              <td style={{ padding: "4px 8px", textAlign: "center" }}><Badge grade={s.grade} /></td>
              <td style={{ padding: "4px 8px", textAlign: "center", color: "#b8b8c8", fontFamily: "monospace" }}>{s.rs_rank}</td>
              {(() => {
                const lv = liveLookup[s.ticker];
                const chg = lv?.change;
                const chgColor = chg > 0 ? "#2bb886" : chg < 0 ? "#f87171" : "#9090a0";
                return <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace", fontSize: 12, color: chg != null ? chgColor : "#3a3a4a" }}>
                  {chg != null ? `${chg > 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}</td>;
              })()}
              <td style={{ padding: "4px 8px", textAlign: "center" }}><Ret v={s.return_3m} bold /></td>
              <td style={{ padding: "4px 8px", textAlign: "center", color: near ? "#2bb886" : "#9090a0", fontFamily: "monospace" }}>{s.pct_from_high}%</td>
              <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                color: s.adr_pct > 8 ? "#2dd4bf" : s.adr_pct > 5 ? "#2bb886" : s.adr_pct > 3 ? "#fbbf24" : "#f97316" }}>
                {s.adr_pct != null ? `${s.adr_pct}%` : '—'}</td>
              <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                color: s.avg_dollar_vol_raw > 20000000 ? "#2bb886" : s.avg_dollar_vol_raw > 10000000 ? "#fbbf24" : s.avg_dollar_vol_raw > 5000000 ? "#f97316" : "#f87171" }}>
                {s.avg_dollar_vol ? `$${s.avg_dollar_vol}` : '—'}</td>
              {(() => { const rv = liveLookup[s.ticker]?.rel_volume ?? s.rel_volume;
                const v = s.avg_volume_raw && rv ? Math.round(s.avg_volume_raw * rv) : null;
                const fmt = v == null ? '—' : v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : `${v}`;
                return <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                  color: v >= 1e6 ? "#9090a0" : v != null ? "#f97316" : "#3a3a4a" }}>{fmt}</td>; })()}
              {(() => { const rv = liveLookup[s.ticker]?.rel_volume ?? s.rel_volume;
                return <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                color: rv >= 2 ? "#c084fc" : rv >= 1.5 ? "#a78bfa" : rv != null ? "#686878" : "#3a3a4a" }}>
                {rv != null ? `${Number(rv).toFixed(1)}x` : '—'}</td>; })()}
              <td style={{ padding: "4px 8px", color: "#787888", fontSize: 11, cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); setActiveTheme(theme?.theme || null); }}
                onMouseEnter={e => e.target.style.color = "#4aad8c"}
                onMouseLeave={e => e.target.style.color = "#787888"}>{theme?.theme}</td>
              <td style={{ padding: "4px 8px", color: "#686878", fontSize: 10 }}>{theme?.subtheme}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}


// ── EPISODIC PIVOTS ──
function EpisodicPivots({ epSignals, stockMap, onTickerClick, activeTicker, onVisibleTickers, manualEPs }) {
  const [sortBy, setSortBy] = useState("date");
  const [minGap, setMinGap] = useState(8);
  const [minVol, setMinVol] = useState(4);
  const [maxDays, setMaxDays] = useState(60);
  const [statusFilter, setStatusFilter] = useState(null);
  const [showLegend, setShowLegend] = useState(false);
  const [liveEPs, setLiveEPs] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [lastScan, setLastScan] = useState(null);

  // Fetch live EPs on mount and on manual refresh
  const fetchLiveEPs = useCallback(() => {
    setLiveLoading(true);
    fetch('/api/live?ep=scan')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.ok && d.ep_signals) {
          setLiveEPs(d.ep_signals);
          setLastScan(new Date().toLocaleTimeString());
        }
        setLiveLoading(false);
      })
      .catch(() => setLiveLoading(false));
  }, []);

  useEffect(() => { fetchLiveEPs(); }, [fetchLiveEPs]);

  // Merge: live EPs (today) + pipeline EPs (historical) + manual EPs
  const mergedSignals = useMemo(() => {
    const all = [];
    const seen = new Set();
    const today = new Date();
    // Live EPs first (today's fresh signals)
    if (liveEPs) {
      liveEPs.forEach(ep => {
        const key = `${ep.ticker}_${ep.date}`;
        if (!seen.has(key)) { seen.add(key); all.push(ep); }
      });
    }
    // Pipeline EPs (historical with consolidation status)
    if (epSignals) {
      epSignals.forEach(ep => {
        const key = `${ep.ticker}_${ep.date}`;
        if (!seen.has(key)) { seen.add(key); all.push(ep); }
      });
    }
    // Manual EPs
    if (manualEPs) {
      manualEPs.forEach(ep => {
        const key = `${ep.ticker}_${ep.date}`;
        if (!seen.has(key)) {
          const daysAgo = ep.date ? Math.round((today - new Date(ep.date)) / 86400000) : 0;
          seen.add(key);
          all.push({ ...ep, days_ago: daysAgo, gap_pct: ep.gap_pct || 0, change_pct: ep.change_pct || 0,
            vol_ratio: ep.vol_ratio || 0, close_range: 0, manual: true,
            consol: ep.consol || { status: daysAgo <= 1 ? "fresh" : "holding" } });
        }
      });
    }
    return all;
  }, [liveEPs, epSignals, manualEPs]);

  // Enhance quality scores: shared stock quality (fundamentals + structure) + EP-specific bonuses (gap, volume, catalyst)
  const enhancedSignals = useMemo(() => {
    if (!mergedSignals) return [];
    return mergedSignals.map(ep => {
      const s = stockMap[ep.ticker];
      const base = computeStockQuality(s);
      
      // Start with shared stock quality, then add EP-specific bonuses
      let q = base.quality;
      const factors = [...base.q_factors];
      
      // EP-specific: live scanner already scored gap/vol into ep.quality (base 50)
      // Add the delta from live scanner's EP-specific scoring
      const liveBonus = (ep.quality || 0) - 50;  // extract just the EP-specific part
      if (liveBonus > 0) q += liveBonus;
      
      // EP-specific: consolidation quality (Bonde delayed entry)
      const c = ep.consol || {};
      if (c.status === "consolidating") { q += 8; factors.push("★C"); }
      else if (c.status === "fresh") { q += 3; }
      else if (c.status === "failed") { q -= 10; factors.push("Fail"); }
      
      // EP-specific: close range shows conviction
      if (ep.close_range >= 80) { q += 3; }
      
      q = Math.min(100, Math.max(0, q));
      return { ...ep, quality: q, q_factors: factors };
    });
  }, [mergedSignals, stockMap]);

  const filtered = useMemo(() => {
    if (!enhancedSignals || !enhancedSignals.length) return [];
    const sorters = {
      ticker: (a, b) => a.ticker.localeCompare(b.ticker),
      grade: (a, b) => {
        const go = ["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-","E+","E","E-","F+","F","F-","G+","G"];
        return (go.indexOf(stockMap[a.ticker]?.grade || "G") - go.indexOf(stockMap[b.ticker]?.grade || "G"));
      },
      date: (a, b) => a.days_ago - b.days_ago,
      days: (a, b) => a.days_ago - b.days_ago,
      gap: (a, b) => b.gap_pct - a.gap_pct,
      change: (a, b) => b.change_pct - a.change_pct,
      vol: (a, b) => b.vol_ratio - a.vol_ratio,
      clrng: (a, b) => b.close_range - a.close_range,
      status: (a, b) => {
        const order = { consolidating: 0, fresh: 1, basing: 2, holding: 3, extended_pullback: 4, failed: 5 };
        return (order[a.consol?.status] ?? 9) - (order[b.consol?.status] ?? 9);
      },
      pb: (a, b) => (b.consol?.pullback_pct ?? -99) - (a.consol?.pullback_pct ?? -99),
      volcon: (a, b) => (a.consol?.vol_contraction ?? 99) - (b.consol?.vol_contraction ?? 99),
      rs: (a, b) => (stockMap[b.ticker]?.rs_rank ?? 0) - (stockMap[a.ticker]?.rs_rank ?? 0),
      fromhi: (a, b) => (stockMap[b.ticker]?.pct_from_high ?? -999) - (stockMap[a.ticker]?.pct_from_high ?? -999),
      quality: (a, b) => (b.quality ?? 0) - (a.quality ?? 0),
      theme: (a, b) => (stockMap[a.ticker]?.themes?.[0]?.theme || "ZZZ").localeCompare(stockMap[b.ticker]?.themes?.[0]?.theme || "ZZZ"),
    };
    return enhancedSignals
      .filter(ep => ep.manual || (ep.gap_pct >= minGap && ep.vol_ratio >= minVol))
      .filter(ep => ep.days_ago <= maxDays)
      .filter(ep => !statusFilter || ep.consol?.status === statusFilter)
      .sort(sorters[sortBy] || sorters.date);
  }, [enhancedSignals, stockMap, sortBy, minGap, minVol, maxDays, statusFilter]);

  useEffect(() => {
    if (onVisibleTickers) onVisibleTickers(filtered.map(ep => ep.ticker));
  }, [filtered, onVisibleTickers]);

  const STATUS_STYLE = {
    consolidating: { bg: "#fbbf2418", border: "#fbbf2450", color: "#fbbf24", label: "★ CONSOLIDATING" },
    basing:        { bg: "#60a5fa10", border: "#60a5fa30", color: "#60a5fa", label: "BASING" },
    fresh:         { bg: "#2bb88610", border: "#2bb88630", color: "#2bb886", label: "FRESH" },
    holding:       { bg: "#88888810", border: "#88888830", color: "#9090a0",    label: "HOLDING" },
    failed:        { bg: "#ef444410", border: "#ef444430", color: "#f87171", label: "FAILED" },
    extended_pullback: { bg: "#f9731610", border: "#f9731630", color: "#f97316", label: "DEEP PB" },
  };

  const columns = [
    ["Ticker", "ticker"], ["Q", "quality"], ["Grade", "grade"], ["Date", "date"], ["Days", "days"], ["Gap%", "gap"],
    ["Chg%", "change"], ["VolX", "vol"], ["ClRng", "clrng"], ["Status", "status"],
    ["PB%", "pb"], ["VolCon", "volcon"], ["FrHi%", "fromhi"], ["RS", "rs"], ["Theme", "theme"],
  ];

  if (!enhancedSignals || (!enhancedSignals.length && !liveLoading)) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div style={{ color: "#fbbf24", fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Episodic Pivots</div>
        <div style={{ color: "#787888", fontSize: 13, marginBottom: 20 }}>
          {liveLoading ? "Scanning Finviz for today's EPs..." : "No EP signals found. Market may be closed."}
        </div>
        <button onClick={fetchLiveEPs} style={{ padding: "6px 16px", borderRadius: 4, border: "1px solid #fbbf24",
          background: "#fbbf2420", color: "#fbbf24", cursor: "pointer", fontSize: 12 }}>
          {liveLoading ? "Scanning..." : "Scan Now"}
        </button>
      </div>
    );
  }

  const consolCount = enhancedSignals.filter(ep => ep.consol?.status === "consolidating").length;

  return (
    <div>
      {/* Legend */}
      <div onClick={() => setShowLegend(p => !p)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", marginBottom: showLegend ? 0 : 6, background: "#1a1a24",
          borderRadius: showLegend ? "4px 4px 0 0" : 4, fontSize: 10, color: "#787888", cursor: "pointer", userSelect: "none" }}>
        <span style={{ fontSize: 11 }}>{showLegend ? "▾" : "▸"}</span>
        <span style={{ fontWeight: 700 }}>LEGEND & COLUMNS</span>
      </div>
      {showLegend && (
      <div style={{ padding: "8px 12px", marginBottom: 6, background: "#1a1a24", borderRadius: "0 0 4px 4px", fontSize: 10, color: "#787888", lineHeight: 1.9, marginTop: -1 }}>
        {/* What is an EP */}
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: "#fbbf24", fontWeight: 700 }}>EPISODIC PIVOT</span>
          <span> — A stock gaps up ≥4% on ≥4x avg volume, driven by a catalyst (earnings, guidance, contract). The Gap% + VolX confirm institutional conviction.</span>
        </div>
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: "#fbbf24", fontWeight: 700 }}>★ CONSOLIDATING (Delayed Entry)</span>
          <span> — Pradeep Bonde method: 3+ days after EP, pullback ≤10%, volume contracting to ≤70% of EP day, gap held. This is the ideal re-entry for those who missed the initial move.</span>
        </div>
        {/* Column explanations */}
        <div style={{ borderTop: "1px solid #2a2a38", paddingTop: 6, marginBottom: 6 }}>
          <span style={{ color: "#9090a0", fontWeight: 700 }}>COLUMNS</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: "2px 8px" }}>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>Ticker</span><span>Stock symbol. 📊 = near earnings catalyst. ★ = consolidating.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>Q</span><span>Quality score (0-100). Multi-framework: CANSLIM earnings + Zanger resistance/group + MAGNA53 neglect/squeeze. Hover for breakdown.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>Grade</span><span>RTS composite grade (RS + Trend Strength). A+ = top percentile momentum + structure.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>Date</span><span>Date the EP signal triggered.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>Days</span><span>Trading days since the EP. TODAY = just happened. Gold = fresh ≤5 days.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>Gap%</span><span>Opening gap vs previous close. ≥15% = exceptional institutional demand.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>Chg%</span><span>Total close-to-close change on EP day. Gap + intraday follow-through.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>VolX</span><span>Volume / 50-day avg. 4x+ = institutional, 8x+ = extreme. Qullamaggie minimum: 4x.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>ClRng</span><span>Close position in day's range (0=low, 100=high). ≥70% = strong close, no selling into the gap.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>Status</span><span>Post-EP behavior: Fresh (≤1d), Basing (holding, not contracting), ★ Consolidating (delayed entry), Failed (gap filled), Deep PB (pullback &gt;15%).</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>PB%</span><span>Max pullback from EP close. Green ≥-3%, gray ≥-7%, red &gt;-7%. Zanger: if stock "goes to sleep" = exit signal.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>VolCon</span><span>Avg volume since EP ÷ EP day volume. ≤0.5x = strong dry-up (bullish). ≤0.7x = good contraction.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>FrHi%</span><span>Distance from 52-week high. Near 0% = broke through resistance (Zanger).</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>EPS</span><span>EPS Score (0-100). Current year EPS is primary (Zanger ≥40%), 5Y confirms, sales validates, acceleration bonuses. Hover for breakdown.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>RS</span><span>Relative Strength rank (0-99). ≥80 = leader. CANSLIM L: buy leaders, not laggards.</span>
          <span style={{ color: "#d4d4e0", fontWeight: 700 }}>Theme</span><span>Primary theme/group. Zanger: "I focus on the strongest stocks in the strongest groups."</span>
        </div>
        {/* Quality factor key */}
        <div style={{ borderTop: "1px solid #2a2a38", paddingTop: 6, marginTop: 6, marginBottom: 4 }}>
          <span style={{ color: "#9090a0", fontWeight: 700 }}>QUALITY FACTOR KEY</span><span style={{ color: "#686878" }}> — hover Q score to see which factors apply</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 40px 1fr)", gap: "2px 6px" }}>
          <span style={{ color: "#22d3ee", fontWeight: 700 }}>C↑</span><span>EPS This Y ≥40%</span>
          <span style={{ color: "#22d3ee", fontWeight: 700 }}>A↑</span><span>EPS 5Y ≥40%</span>
          <span style={{ color: "#22d3ee", fontWeight: 700 }}>S↑</span><span>Sales ≥25%</span>
          <span style={{ color: "#22d3ee", fontWeight: 700 }}>NH</span><span>Near 52W high</span>
          <span style={{ color: "#22d3ee", fontWeight: 700 }}>L</span><span>RS leader ≥90</span>
          <span style={{ color: "#22d3ee", fontWeight: 700 }}>NI</span><span>Low inst &lt;30%</span>
          <span style={{ color: "#a78bfa", fontWeight: 700 }}>LF</span><span>Low float &lt;15M</span>
          <span style={{ color: "#a78bfa", fontWeight: 700 }}>SQ</span><span>Short ≥15%</span>
          <span style={{ color: "#a78bfa", fontWeight: 700 }}>SR</span><span>Short ratio ≥5d</span>
          <span style={{ color: "#a78bfa", fontWeight: 700 }}>SC</span><span>Small cap &lt;$2B</span>
          <span style={{ color: "#a78bfa", fontWeight: 700 }}>IPO</span><span>Young IPO &lt;3yr</span>
          <span style={{ color: "#a78bfa", fontWeight: 700 }}>Acc</span><span>EPS accelerating</span>
          <span style={{ color: "#2bb886", fontWeight: 700 }}>Gr</span><span>A-grade struct</span>
          <span style={{ color: "#2bb886", fontWeight: 700 }}>TH</span><span>Leading theme</span>
          <span style={{ color: "#fbbf24", fontWeight: 700 }}>★C</span><span>EP consolidating</span>
          <span style={{ color: "#f87171", fontWeight: 700 }}>A↓</span><span>Neg annual EPS</span>
          <span style={{ color: "#f87171", fontWeight: 700 }}>Deep</span><span>Deep off highs</span>
          <span style={{ color: "#f87171", fontWeight: 700 }}>Fail</span><span>EP gap filled</span>
        </div>
      </div>)}

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: 13 }}>{filtered.length} EPs</span>
        {liveEPs && <span style={{ color: "#2bb886", fontSize: 10, background: "#2bb88618", padding: "1px 6px", borderRadius: 8 }}>LIVE{lastScan ? ` ${lastScan}` : ""}</span>}
        <button onClick={fetchLiveEPs} disabled={liveLoading} style={{ padding: "1px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
          border: "1px solid #fbbf2450", background: liveLoading ? "#fbbf2410" : "transparent", color: "#fbbf24" }}>
          {liveLoading ? "⟳" : "↻ Scan"}</button>
        {consolCount > 0 && <span style={{ color: "#fbbf24", fontSize: 11, background: "#fbbf2418", border: "1px solid #fbbf2440", padding: "1px 8px", borderRadius: 10 }}>★ {consolCount} consolidating</span>}
        <span style={{ color: "#686878", fontSize: 11 }}>Gap≥</span>
        <input type="range" min={5} max={25} value={minGap} onChange={e => setMinGap(+e.target.value)}
          style={{ width: 50, accentColor: "#fbbf24" }} />
        <span style={{ fontSize: 11, color: "#fbbf24", fontFamily: "monospace" }}>{minGap}%</span>
        <span style={{ color: "#686878", fontSize: 11 }}>Vol≥</span>
        <input type="range" min={2} max={10} step={0.5} value={minVol} onChange={e => setMinVol(+e.target.value)}
          style={{ width: 50, accentColor: "#fbbf24" }} />
        <span style={{ fontSize: 11, color: "#fbbf24", fontFamily: "monospace" }}>{minVol}x</span>
        <span style={{ color: "#3a3a4a" }}>|</span>
        {[5, 10, 20, 30, 60].map(d => (
          <button key={d} onClick={() => setMaxDays(d)} style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, cursor: "pointer",
            border: maxDays === d ? "1px solid #fbbf24" : "1px solid #3a3a4a",
            background: maxDays === d ? "#fbbf2420" : "transparent", color: maxDays === d ? "#fbbf24" : "#787888" }}>{d}d</button>
        ))}
        <span style={{ color: "#3a3a4a" }}>|</span>
        {[["all", null],["★ Consol", "consolidating"],["Fresh", "fresh"],["Basing", "basing"],["Failed", "failed"]].map(([label, val]) => (
          <button key={label} onClick={() => setStatusFilter(val)} style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, cursor: "pointer",
            border: statusFilter === val ? "1px solid #fbbf24" : "1px solid #3a3a4a",
            background: statusFilter === val ? "#fbbf2420" : "transparent",
            color: statusFilter === val ? "#fbbf24" : val === "consolidating" ? "#fbbf24" : "#787888" }}>{label}</button>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr style={{ borderBottom: "2px solid #3a3a4a" }}>
          {columns.map(([h, sk]) => (
            <th key={h} onClick={sk ? () => setSortBy(sk) : undefined}
              style={{ padding: "5px 6px", color: sortBy === sk ? "#fbbf24" : "#787888", fontWeight: 600, textAlign: "center", fontSize: 10,
                cursor: sk ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>
              {h}{sortBy === sk ? " ▼" : ""}</th>
          ))}
        </tr></thead>
        <tbody>{filtered.map((ep) => {
          const s = stockMap[ep.ticker];
          const isActive = ep.ticker === activeTicker;
          const c = ep.consol || {};
          const st = STATUS_STYLE[c.status] || STATUS_STYLE.holding;
          const isConsol = c.status === "consolidating";
          return (
            <tr key={`${ep.ticker}-${ep.date}`}
              ref={isActive ? (el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" }) : undefined}
              onClick={() => onTickerClick(ep.ticker)}
              style={{ borderBottom: `1px solid ${isConsol ? "#fbbf2425" : "#222230"}`, cursor: "pointer",
                background: isActive ? "#fbbf2415" : isConsol ? "#fbbf2408" : "transparent" }}>
              <td style={{ padding: "4px 6px", textAlign: "center" }}>
                <span style={{ color: isActive ? "#fbbf24" : "#d4d4e0", fontWeight: 600 }}>{isConsol && "★ "}{ep.ticker}</span>
                {ep.near_earnings && <span title="Near earnings" style={{ marginLeft: 3, fontSize: 9, color: "#fbbf24" }}>📊</span>}
              </td>
              <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
                color: ep.quality >= 80 ? "#2bb886" : ep.quality >= 60 ? "#60a5fa" : "#9090a0" }}
                title={ep.q_factors?.length ? ep.q_factors.map(f => {
                  const labels = { "C↑↑": "EPS This Y ≥100%", "C↑": "EPS This Y ≥40%", "A↑": "EPS 5Y ≥40%", "A↑": "Annual EPS ≥40%", "A↓": "Neg annual EPS",
                    "S↑": "Sales growth ≥25%", "NH": "New 52W high", "LF": "Low float <15M", "MF": "Float <50M", "L": "RS leader ≥90",
                    "NI": "Low inst own <30%", "SR": "Short ratio ≥5d", "SQ": "Short squeeze ≥15%",
                    "SC": "Small cap <$2B", "MC": "Mid cap <$10B", "IPO": "Young IPO <3yr",
                    "S↓": "Neg sales", "S↑↑": "Sales Q/Q ≥40%", "QQ↑↑": "EPS Q/Q ≥100%", "QQ↑": "EPS Q/Q ≥40%", "Acc": "EPS accelerating", "Gr": "A-grade structure", "Deep": "Deep off highs",
                    "TH": "Leading theme", "★C": "EP consolidating", "Fail": "EP gap filled" };
                  return labels[f] || f; }).join("\n") : "No factors"}>
                {ep.quality ?? "—"}</td>
              <td style={{ padding: "4px 6px", textAlign: "center" }}>{s ? <Badge grade={s.grade} /> : "—"}</td>
              <td style={{ padding: "4px 6px", textAlign: "center", color: ep.days_ago <= 5 ? "#fbbf24" : "#9090a0", fontSize: 11 }}>{ep.date}</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: ep.days_ago === 0 ? "#fbbf24" : ep.days_ago <= 5 ? "#fcd34d" : "#787888" }}>
                {ep.days_ago === 0 ? "TODAY" : `${ep.days_ago}d`}</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: ep.gap_pct >= 15 ? "#fbbf24" : "#2bb886" }}>+{ep.gap_pct}%</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: ep.change_pct > 0 ? "#2bb886" : "#f87171" }}>{ep.change_pct > 0 ? "+" : ""}{ep.change_pct}%</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: ep.vol_ratio >= 8 ? "#fbbf24" : ep.vol_ratio >= 5 ? "#2bb886" : "#60a5fa" }}>{ep.vol_ratio}x</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: ep.close_range >= 80 ? "#2bb886" : "#9090a0" }}>{ep.close_range}%</td>
              <td style={{ padding: "4px 6px", textAlign: "center" }}>
                <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                  background: st.bg, border: `1px solid ${st.border}`, color: st.color }}>{st.label}</span>
              </td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: c.pullback_pct >= -3 ? "#2bb886" : c.pullback_pct >= -7 ? "#9090a0" : "#f87171" }}>
                {c.pullback_pct != null ? `${c.pullback_pct}%` : "—"}</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: c.vol_contraction <= 0.5 ? "#2bb886" : c.vol_contraction <= 0.7 ? "#60a5fa" : "#9090a0" }}>
                {c.vol_contraction ? `${c.vol_contraction}x` : "—"}</td>
              {(() => {
                const frhi = s?.pct_from_high;
                return <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                  color: frhi != null && frhi >= -3 ? "#2bb886" : frhi != null && frhi >= -10 ? "#60a5fa" : "#9090a0" }}>
                  {frhi != null ? `${frhi}%` : "—"}</td>;
              })()}
              <td style={{ padding: "4px 6px", textAlign: "center", color: "#b8b8c8", fontFamily: "monospace" }}>{s?.rs_rank || "—"}</td>
              <td style={{ padding: "4px 6px", color: "#686878", fontSize: 10 }}>{s?.themes?.[0]?.theme || "—"}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {filtered.length === 0 && (
        <div style={{ textAlign: "center", color: "#686878", padding: 20, fontSize: 13 }}>
          No EPs match current filters. Try lowering the gap% or volume threshold.
        </div>
      )}
    </div>
  );
}

// ── INDEX CHART (SPY/QQQ/IWM/DIA with MA status) ──

function Grid({ stocks, onTickerClick, activeTicker, onVisibleTickers }) {
  const [showLegend, setShowLegend] = useState(false);
  const grades = ["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-","E+","E","E-","F+","F","F-","G+","G"];
  const groups = useMemo(() => {
    const g = {}; grades.forEach(gr => { g[gr] = stocks.filter(s => s.grade === gr).sort((a, b) => b.rts_score - a.rts_score); }); return g;
  }, [stocks]);

  // Report visible ticker order to parent
  useEffect(() => {
    if (onVisibleTickers) {
      const tickers = grades.flatMap(gr => groups[gr].slice(0, 60).map(s => s.ticker));
      onVisibleTickers(tickers);
    }
  }, [groups, onVisibleTickers]);
  return (
    <div style={{ overflowX: "auto" }}>
      {/* Legend */}
      <div onClick={() => setShowLegend(p => !p)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", marginBottom: showLegend ? 0 : 10, background: "#1a1a24",
          borderRadius: showLegend ? "6px 6px 0 0" : 6, fontSize: 11, color: "#787888", cursor: "pointer", userSelect: "none" }}>
        <span style={{ fontSize: 11 }}>{showLegend ? "▾" : "▸"}</span>
        <span style={{ fontWeight: 700, fontSize: 10 }}>LEGEND</span>
      </div>
      {showLegend && (
      <div style={{ display: "flex", gap: 20, marginBottom: 10, padding: "8px 12px", background: "#1a1a24", borderRadius: "0 0 6px 6px", fontSize: 11, flexWrap: "wrap", alignItems: "center", marginTop: -1 }}>
        <span style={{ color: "#9090a0", fontWeight: 700 }}>COLUMN GRADE (RTS Score):</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#1B7A2B" }} /> <span style={{ color: "#b0b0be" }}>A+ to A- — Strongest momentum</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#5CB85C" }} /> <span style={{ color: "#b0b0be" }}>B+ to B- — Above average</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#CCF2CC" }} /> <span style={{ color: "#b0b0be" }}>C — Neutral</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#e5e5e5" }} /> <span style={{ color: "#b0b0be" }}>D — Below average</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#FF5050" }} /> <span style={{ color: "#b0b0be" }}>E to G — Weakest momentum</span>
        </span>
        <span style={{ color: "#3a3a4a" }}>|</span>
        <span style={{ color: "#9090a0", fontWeight: 700 }}>TICKER TEXT:</span>
        <span style={{ color: "#f87171", fontWeight: 700, fontFamily: "monospace" }}>Red</span><span style={{ color: "#b0b0be" }}> = ATR/50 ≥ 7x (extremely extended)</span>
        <span style={{ color: "#c084fc", fontWeight: 700, fontFamily: "monospace" }}>Purple</span><span style={{ color: "#b0b0be" }}> = ATR/50 ≥ 5x (extended)</span>
        <span style={{ color: "#bbb", fontFamily: "monospace" }}>Default</span><span style={{ color: "#b0b0be" }}> = Not extended</span>
      </div>)}
      <div style={{ display: "flex", gap: 2, minWidth: 1300 }}>
        {grades.map(g => {
          const light = ["C+","C","C-","D+","D","D-"].includes(g);
          return (
            <div key={g} style={{ width: 64, flexShrink: 0 }}>
              <div style={{ background: GRADE_COLORS[g], color: light ? "#2a2a38" : "#d4d4e0", textAlign: "center", padding: "4px 0", borderRadius: "4px 4px 0 0", fontSize: 12, fontWeight: 700 }}>
                {g}<br/><span style={{ fontWeight: 400, opacity: 0.7, fontSize: 11 }}>{groups[g].length}</span></div>
              <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
                {groups[g].slice(0, 60).map(s => (
                  <div key={s.ticker} title={`${s.company} | RS:${s.rs_rank} | 3M:${s.return_3m}%`}
                    onClick={() => onTickerClick(s.ticker)}
                    style={{ textAlign: "center", fontSize: 11, padding: "2px 0", fontFamily: "monospace",
                      background: s.ticker === activeTicker ? "#0d916330" : GRADE_COLORS[g] + "25",
                      color: s.atr_to_50 >= 7 ? "#f87171" : s.atr_to_50 >= 5 ? "#c084fc" : "#bbb",
                      fontWeight: s.atr_to_50 >= 5 ? 700 : 400, cursor: "pointer" }}>{s.ticker}</div>
                ))}
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
  ["", null], ["Ticker", "ticker"], ["Tags", "hits"], ["Q", "quality"], ["VCS", "vcs"], ["MF", "mf"], ["Grade", null], ["RS", "rs"], ["Chg%", "change"],
  ["3M%", "ret3m"], ["FrHi%", "fromhi"], ["ADR%", "adr"],
  ["$Vol", "dvol"], ["Vol", "vol"], ["RVol", "rel_volume"], ["Theme", null], ["Subtheme", null],
];

function LiveSortHeader({ setter, current }) {
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
}

function LiveRow({ s, onRemove, onAdd, addLabel, activeTicker, onTickerClick }) {
  const isActive = s.ticker === activeTicker;
  const rowRef = useRef(null);
  useEffect(() => {
    if (isActive && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);
  const near = s.pct_from_high != null && s.pct_from_high >= -5;
  const chg = (v) => !v && v !== 0 ? "#686878" : v > 0 ? "#2bb886" : v < 0 ? "#f87171" : "#9090a0";
  return (
    <tr ref={rowRef} onClick={() => onTickerClick(s.ticker)} style={{ borderBottom: "1px solid #222230", cursor: "pointer",
      background: isActive ? "rgba(251, 191, 36, 0.10)"
        : s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 1 ? "rgba(248, 113, 113, 0.12)"
        : s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 3 ? "rgba(248, 113, 113, 0.07)"
        : s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 7 ? "rgba(248, 113, 113, 0.03)"
        : "transparent" }}>
      <td style={{ padding: "4px 4px", textAlign: "center", whiteSpace: "nowrap" }}>
        {onRemove && <span onClick={(e) => { e.stopPropagation(); onRemove(s.ticker); }}
          style={{ color: "#686878", cursor: "pointer", fontSize: 11, marginRight: 2 }}>✕</span>}
        {onAdd && <span onClick={(e) => { e.stopPropagation(); onAdd(s.ticker); }}
          style={{ color: "#0d9163", cursor: "pointer", fontSize: 11 }}>{addLabel || "+watch"}</span>}
      </td>
      <td style={{ padding: "4px 6px", textAlign: "center", color: isActive ? "#0d9163" : "#d4d4e0", fontWeight: 600, fontSize: 12 }}>
        <span>{s.ticker}</span>
        {s.earnings_days != null && s.earnings_days >= 0 && s.earnings_days <= 14 && (
          <span title={s.earnings_display || s.earnings_date || `${s.earnings_days}d`}
            style={{ marginLeft: 3, padding: "0px 3px", borderRadius: 2, fontSize: 7, fontWeight: 700, verticalAlign: "super",
              color: s.earnings_days <= 1 ? "#fff" : "#f87171",
              background: s.earnings_days <= 1 ? "#dc2626" : "#f8717120",
              border: `1px solid ${s.earnings_days <= 1 ? "#dc2626" : "#f8717130"}` }}>
            ER{s.earnings_days === 0 ? "" : s.earnings_days}
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
              ZM: { bg: "#a78bfa20", color: "#a78bfa", label: "ZM" } }[h];
            if (!hc) return null;
            return <span key={h} style={{ padding: "0px 3px", borderRadius: 2, fontSize: 8, fontWeight: 700,
              color: hc.color, background: hc.bg, border: `1px solid ${hc.color}30` }}>{hc.label}</span>;
          })}
        </div>
      </td>
      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
        color: s._quality >= 80 ? "#2bb886" : s._quality >= 60 ? "#60a5fa" : s._quality >= 40 ? "#9090a0" : "#686878" }}
        title={s._q_factors?.length ? s._q_factors.map(f => {
          const labels = { "C↑↑": "EPS This Y ≥100%", "C↑": "EPS This Y ≥40%", "A↑": "EPS 5Y ≥40%", "A↑": "Annual EPS ≥40%", "A↓": "Neg annual EPS",
            "S↑": "Sales ≥25%", "NH": "New 52W high", "LF": "Low float <15M", "MF": "Float <50M", "L": "RS leader ≥90",
            "NI": "Low inst <30%", "SR": "Short ratio ≥5d", "SQ": "Short ≥15%",
            "SC": "Small cap <$2B", "MC": "Mid cap <$10B", "IPO": "Young IPO", "TH": "Leading theme",
            "S↓": "Neg sales", "S↑↑": "Sales Q/Q ≥40%", "QQ↑↑": "EPS Q/Q ≥100%", "QQ↑": "EPS Q/Q ≥40%", "Acc": "EPS accelerating", "Gr": "A-grade", "Deep": "Deep off highs" };
          return labels[f] || f; }).join("\n") : ""}>
        {s._quality ?? "—"}</td>
      {/* VCS */}
      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
        color: s.vcs >= 80 ? "#2bb886" : s.vcs >= 60 ? "#fbbf24" : s.vcs != null ? "#686878" : "#3a3a4a" }}
        title={s.vcs_components ? `ATR:${s.vcs_components.atr_contraction} Range:${s.vcs_components.range_compression} MA:${s.vcs_components.ma_convergence} Vol:${s.vcs_components.volume_dryup} Prox:${s.vcs_components.proximity_highs}` : ""}>
        {s.vcs ?? "—"}</td>
      {/* MF */}
      <td style={{ padding: "4px 4px", textAlign: "center", fontFamily: "monospace", fontSize: 10,
        color: s.mf > 30 ? "#2bb886" : s.mf > 0 ? "#4a9070" : s.mf < -30 ? "#f87171" : s.mf < 0 ? "#c06060" : s.mf != null ? "#686878" : "#3a3a4a" }}
        title={s.mf_components ? `P${s._mfPct ?? '—'} | DVol:${s.mf_components.dvol_trend} RVPers:${s.mf_components.rvol_persistence} UpVol:${s.mf_components.up_vol_ratio} PVDir:${s.mf_components.price_vol_dir}` : ""}>
        {s.mf != null ? <>{s.mf > 0 ? `+${s.mf}` : s.mf}<sup style={{ fontSize: 7, color: "#505060", marginLeft: 1 }}>{s._mfPct ?? ''}</sup></> : "—"}</td>
      <td style={{ padding: "4px 6px", textAlign: "center" }}>{s.grade ? <Badge grade={s.grade} /> : <span style={{ color: "#3a3a4a" }}>—</span>}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", color: "#b8b8c8", fontFamily: "monospace", fontSize: 12 }}>{s.rs_rank ?? '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", color: chg(s.change), fontFamily: "monospace", fontSize: 12 }}>
        {s.change != null ? `${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%` : '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center" }}><Ret v={s.return_3m} /></td>
      <td style={{ padding: "4px 6px", textAlign: "center", color: near ? "#2bb886" : "#9090a0", fontFamily: "monospace", fontSize: 12 }}>
        {s.pct_from_high != null ? `${s.pct_from_high.toFixed != null ? s.pct_from_high.toFixed(0) : s.pct_from_high}%` : '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 12,
        color: s.adr_pct > 8 ? "#2dd4bf" : s.adr_pct > 5 ? "#2bb886" : s.adr_pct > 3 ? "#fbbf24" : s.adr_pct != null ? "#f97316" : "#3a3a4a" }}>
        {s.adr_pct != null ? `${s.adr_pct}%` : '—'}</td>
      {/* $Vol */}
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 12,
        color: s.avg_dollar_vol_raw > 20000000 ? "#2bb886" : s.avg_dollar_vol_raw > 10000000 ? "#fbbf24" : s.avg_dollar_vol_raw > 5000000 ? "#f97316" : "#f87171" }}>
        {s.avg_dollar_vol ? `$${s.avg_dollar_vol}` : '—'}</td>
      {(() => { const rv = s.rel_volume;
        const v = s.avg_volume_raw && rv ? Math.round(s.avg_volume_raw * rv) : null;
        const fmt = v == null ? '—' : v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : `${v}`;
        return <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 12,
          color: v >= 1e6 ? "#9090a0" : v != null ? "#f97316" : "#3a3a4a" }}>{fmt}</td>; })()}
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 12,
        color: s.rel_volume >= 2 ? "#c084fc" : s.rel_volume >= 1.5 ? "#a78bfa" : s.rel_volume != null ? "#686878" : "#3a3a4a" }}>
        {s.rel_volume != null ? `${s.rel_volume.toFixed(1)}x` : '—'}</td>
      <td style={{ padding: "4px 6px", color: "#787888", fontSize: 11 }}>{s.themes?.[0]?.theme || '—'}</td>
      <td style={{ padding: "4px 6px", color: "#686878", fontSize: 10 }}>{s.themes?.[0]?.subtheme || '—'}</td>
    </tr>
  );
}

function LiveSectionTable({ data, sortKey, setter, onRemove, onAdd, addLabel, activeTicker, onTickerClick }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <LiveSortHeader setter={setter} current={sortKey} />
      <tbody>
        {data.map(s => <LiveRow key={s.ticker} s={s} onRemove={onRemove} onAdd={onAdd} addLabel={addLabel}
          activeTicker={activeTicker} onTickerClick={onTickerClick} />)}
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
                <span style={{ fontWeight: 600, fontSize: 12, color: "#d4d4e0", width: 50 }}>{e.ticker}</span>
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

function LiveView({ stockMap, onTickerClick, activeTicker, onVisibleTickers, portfolio, setPortfolio, watchlist, setWatchlist, addToWatchlist, removeFromWatchlist, addToPortfolio, removeFromPortfolio, liveThemeData, homepage }) {
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [addTickerP, setAddTickerP] = useState("");
  const [addTickerW, setAddTickerW] = useState("");
  const [pSort, setPSort] = useState("change");
  const [wlSort, setWlSort] = useState("change");
  const [marketOpen, setMarketOpen] = useState(true);

  // Combine all tickers for API call — watchlist + portfolio only
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

  useEffect(() => { fetchLive(); const iv = setInterval(fetchLive, 30000); return () => clearInterval(iv); }, [fetchLive]);

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
      sales_past_5y: pipe.sales_past_5y,
      sales_qq: pipe.sales_qq,
      pe: live.pe ?? pipe.pe,
      roe: pipe.roe,
      profit_margin: pipe.profit_margin,
      rsi: live.rsi ?? pipe.rsi,
      themes: pipe.themes || [],
      theme: pipe.themes?.[0]?.theme || live.sector || "",
      company: live.company || pipe.company || "",
      // Additional fields for column parity with Scan
      vcs: pipe.vcs,
      vcs_components: pipe.vcs_components,
      mf: pipe.mf,
      mf_components: pipe.mf_components,
      _mfPct: pipe._mfPct,
      avg_dollar_vol: pipe.avg_dollar_vol,
      avg_dollar_vol_raw: pipe.avg_dollar_vol_raw,
      earnings_days: pipe.earnings_days,
      earnings_display: pipe.earnings_display,
      earnings_date: pipe.earnings_date,
      _scanHits: pipe._scanHits || [],
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
    pe: (a, b) => (a.pe ?? 9999) - (b.pe ?? 9999),
    roe: sortFn("roe"), margin: sortFn("profit_margin"),
    rsi: sortFn("rsi"), price: sortFn("price"),
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
          <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={portfolioMerged} sortKey={pSort} setter={setPSort} onRemove={removeFromPortfolio} />
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
            <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={watchlistMerged} sortKey={wlSort} setter={setWlSort} onRemove={removeFromWatchlist} />
          </div>
        )}
      </div>
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

  const stockMap = useMemo(() => { if (!data) return {}; const m = {}; data.stocks.forEach(s => { m[s.ticker] = s; }); return m; }, [data]);
  const openChart = useCallback((t) => setChartTicker(prev => prev === t ? null : t), []);
  const closeChart = useCallback(() => setChartTicker(null), []);

  // Watchlist + Portfolio + Manual EPs state (hoisted for access from ChartPanel)
  const [portfolio, setPortfolio] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_portfolio") || "[]"); } catch { return []; }
  });
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_watchlist") || "[]"); } catch { return []; }
  });
  const [manualEPs, setManualEPs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_manual_eps") || "[]"); } catch { return []; }
  });
  const [serverLoaded, setServerLoaded] = useState(false);

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
          if (d.data.manualEPs) setManualEPs(d.data.manualEPs);
          console.log("Loaded from server:", d.data);
        }
      })
      .catch(err => console.warn("Failed to load server data:", err))
      .finally(() => setServerLoaded(true));
  }, [authToken]);

  // Save to localStorage
  useEffect(() => { localStorage.setItem("tp_portfolio", JSON.stringify(portfolio)); }, [portfolio]);
  useEffect(() => { localStorage.setItem("tp_watchlist", JSON.stringify(watchlist)); }, [watchlist]);
  useEffect(() => { localStorage.setItem("tp_manual_eps", JSON.stringify(manualEPs)); }, [manualEPs]);

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
        body: JSON.stringify({ portfolio, watchlist, manualEPs }),
      })
        .then(r => r.json())
        .then(d => console.log("Save result:", d))
        .catch(err => console.warn("Save failed:", err));
    }, 2000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [portfolio, watchlist, authToken, serverLoaded]);
  const addToWatchlist = useCallback((t) => { const u = t.toUpperCase(); if (!watchlist.includes(u)) setWatchlist(p => [...p, u]); }, [watchlist]);
  const removeFromWatchlist = useCallback((t) => setWatchlist(p => p.filter(x => x !== t)), []);
  const addToPortfolio = useCallback((t) => { const u = t.toUpperCase(); if (!portfolio.includes(u)) setPortfolio(p => [...p, u]); }, [portfolio]);
  const removeFromPortfolio = useCallback((t) => setPortfolio(p => p.filter(x => x !== t)), []);
  const addToEP = useCallback((t) => {
    const u = t.toUpperCase();
    const today = new Date().toISOString().split("T")[0];
    setManualEPs(p => {
      if (p.some(e => e.ticker === u)) return p;
      return [...p, { ticker: u, date: today, days_ago: 0, manual: true }];
    });
  }, []);
  const removeFromEP = useCallback((t) => setManualEPs(p => p.filter(e => e.ticker !== t)), []);

  // Visible ticker list — reported by whichever view is active
  const [visibleTickers, setVisibleTickers] = useState([]);
  const onVisibleTickers = useCallback((tickers) => setVisibleTickers(tickers), []);

  // Resizable split panel
  const [splitPct, setSplitPct] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (ev) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.max(15, Math.min(85, pct)));
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
        {[["live","Live"],["leaders","Theme Leaders"],["scan","Scan Watch"],["ep","EP Scan"],["grid","RTS Grid"]].map(([id, label]) => (
          <button key={id} onClick={() => { setView(id); setVisibleTickers([]); }} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
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
        <button onClick={() => setShowEarnings(p => !p)} style={{ marginLeft: 8, padding: "3px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer",
          background: showEarnings ? "#c084fc20" : "transparent", border: showEarnings ? "1px solid #c084fc" : "1px solid #3a3a4a",
          color: showEarnings ? "#c084fc" : "#787888" }}>Earnings</button>
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
          {view === "leaders" && <Leaders themes={data.themes} stockMap={stockMap} filters={filters} onTickerClick={openChart} activeTicker={chartTicker} mmData={mmData} onVisibleTickers={onVisibleTickers} themeHealth={data.theme_health} liveThemeData={liveThemeData}
            onThemeDrillDown={(themeName) => { setScanThemeFilter(themeName); setView("scan"); }} />}

          {view === "scan" && <Scan stocks={data.stocks} themes={data.themes} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers} liveThemeData={liveThemeData} onLiveThemeData={setLiveThemeData} portfolio={portfolio} watchlist={watchlist} initialThemeFilter={scanThemeFilter} onConsumeThemeFilter={() => setScanThemeFilter(null)} epSignals={data.ep_signals} manualEPs={manualEPs} />}
          {view === "grid" && <Grid stocks={data.stocks} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers} />}
          {view === "ep" && <EpisodicPivots epSignals={data.ep_signals} stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers} manualEPs={manualEPs} />}
          {view === "live" && <LiveView stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers}
            portfolio={portfolio} setPortfolio={setPortfolio} watchlist={watchlist} setWatchlist={setWatchlist}
            addToWatchlist={addToWatchlist} removeFromWatchlist={removeFromWatchlist}
            addToPortfolio={addToPortfolio} removeFromPortfolio={removeFromPortfolio}
            liveThemeData={liveThemeData} homepage={homepage} />}
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
            <ChartPanel ticker={chartTicker} stock={stockMap[chartTicker]} onClose={closeChart} onTickerClick={openChart}
              watchlist={watchlist} onAddWatchlist={addToWatchlist} onRemoveWatchlist={removeFromWatchlist}
              portfolio={portfolio} onAddPortfolio={addToPortfolio} onRemovePortfolio={removeFromPortfolio}
              manualEPs={manualEPs} onAddEP={addToEP} onRemoveEP={removeFromEP}
              liveThemeData={liveThemeData} />
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
