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
  STRONG: { bg: "#064e3b", text: "#6ee7b7", tag: "#059669" },
  IMPROVING: { bg: "#422006", text: "#fcd34d", tag: "#d97706" },
  WEAKENING: { bg: "#431407", text: "#fdba74", tag: "#ea580c" },
  WEAK: { bg: "#450a0a", text: "#fca5a5", tag: "#dc2626" },
};

function Ret({ v, bold }) {
  if (v == null) return <span style={{ color: "#666" }}>—</span>;
  const c = v > 0 ? "#4ade80" : v < 0 ? "#f87171" : "#888";
  return <span style={{ color: c, fontWeight: bold ? 700 : 400, fontFamily: "monospace", fontSize: 12 }}>{v > 0 ? "+" : ""}{v.toFixed(1)}%</span>;
}

function Badge({ grade }) {
  if (!grade) return null;
  const bg = GRADE_COLORS[grade] || "#444";
  const light = ["C+","C","C-","D+","D","D-"].includes(grade);
  return <span style={{ background: bg, color: light ? "#222" : "#fff", padding: "1px 5px", borderRadius: 3, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>{grade}</span>;
}

// ── STOCK STAT (label: value pair for chart panel) ──
function StockStat({ label, value, color = "#888" }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: "#555" }}>{label}: </span>
      <span style={{ color, fontFamily: "monospace", fontWeight: 600 }}>{value}</span>
    </span>
  );
}

// ── PERSISTENT CHART PANEL (right side) ──
const TV_LAYOUT = "nS7up88o";

function ChartPanel({ ticker, stock, onClose, watchlist, onAddWatchlist, onRemoveWatchlist, portfolio, onAddPortfolio, onRemovePortfolio }) {
  const containerRef = useRef(null);
  const [tf, setTf] = useState("D");

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
          toolbar_bg: "#0a0a0a",
          enable_publishing: false,
          allow_symbol_change: true,
          save_image: false,
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", borderLeft: "1px solid #222", background: "#0a0a0a" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px",
        borderBottom: "1px solid #222", flexShrink: 0, background: "#111" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: "#fff" }}>{ticker}</span>
          {watchlist && (
            watchlist.includes(ticker)
              ? <button onClick={() => onRemoveWatchlist(ticker)} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "#10b98120", border: "1px solid #10b98140", color: "#10b981" }}>✓ Watch</button>
              : <button onClick={() => onAddWatchlist(ticker)} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", border: "1px solid #333", color: "#666" }}>+ Watch</button>
          )}
          {portfolio && (
            portfolio.includes(ticker)
              ? <button onClick={() => onRemovePortfolio(ticker)} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "#fbbf2420", border: "1px solid #fbbf2440", color: "#fbbf24" }}>✓ Portfolio</button>
              : <button onClick={() => onAddPortfolio(ticker)} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", border: "1px solid #333", color: "#666" }}>+ Portfolio</button>
          )}
          {stock && (<>
            <Badge grade={stock.grade} />
            <span style={{ color: "#666", fontSize: 11 }}>RS:{stock.rs_rank}</span>
            <Ret v={stock.return_1m} />
            <Ret v={stock.return_3m} bold />
            <span style={{ color: stock.pct_from_high >= -5 ? "#4ade80" : "#888", fontSize: 10, fontFamily: "monospace" }}>FrHi:{stock.pct_from_high}%</span>
            <span style={{ color: "#666", fontSize: 10, fontFamily: "monospace" }}>ATR/50:{stock.atr_to_50}</span>
          </>)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {tfOptions.map(([val, label]) => (
            <button key={val} onClick={() => setTf(val)}
              style={{ padding: "2px 6px", borderRadius: 3, fontSize: 10, cursor: "pointer",
                border: tf === val ? "1px solid #10b981" : "1px solid #333",
                background: tf === val ? "#10b98120" : "transparent",
                color: tf === val ? "#6ee7b7" : "#666" }}>
              {label}
            </button>
          ))}
          <a href={tvLayoutUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: "#10b981", fontSize: 11, textDecoration: "none", padding: "4px 12px", border: "1px solid #10b98140",
              borderRadius: 4, fontWeight: 700, marginLeft: 4 }}>
            Full Chart ↗</a>
          <button onClick={onClose} style={{ background: "none", border: "1px solid #444", borderRadius: 4, color: "#666", fontSize: 14,
            width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginLeft: 4 }}>×</button>
        </div>
      </div>

      {stock && (
        <div style={{ display: "flex", gap: 12, padding: "4px 12px", borderBottom: "1px solid #1a1a1a", fontSize: 10, flexShrink: 0 }}>
          <span style={{ color: "#888" }}>{stock.company}</span>
          <span style={{ color: "#666" }}>{stock.sector}</span>
          <span style={{ color: "#666" }}>{stock.industry}</span>
          {stock.themes && stock.themes.length > 0 && (
            <span style={{ color: "#10b981" }}>{stock.themes.map(t => t.theme).join(", ")}</span>
          )}
          <span style={{ color: "#888" }}>1W: <Ret v={stock.return_1w} /></span>
          <span style={{ color: "#888" }}>6M: <Ret v={stock.return_6m} /></span>
          <span style={{ color: "#888" }}>1Y: <Ret v={stock.return_1y} /></span>
        </div>
      )}

      {/* Stock detail row — matches Swing Data Pine Script color thresholds */}
      {stock && (stock.market_cap || stock.atr || stock.adr_pct) && (
        <div style={{ display: "flex", gap: 16, padding: "4px 12px", borderBottom: "1px solid #1a1a1a", fontSize: 10, flexShrink: 0, flexWrap: "wrap" }}>
          {/* ADR%: >8% teal, >5% green, >3% yellow, else default */}
          {stock.adr_pct != null && <StockStat label="ADR%" value={`${stock.adr_pct}%`}
            color={stock.adr_pct > 8 ? "#2dd4bf" : stock.adr_pct > 5 ? "#4ade80" : stock.adr_pct > 3 ? "#fbbf24" : "#f97316"} />}
          {stock.atr != null && <StockStat label="ATR" value={stock.atr} />}
          {/* Off 52W High: >= -25% green, else default */}
          {stock.off_52w_high != null && <StockStat label="Off 52W Hi" value={`${stock.off_52w_high}%`}
            color={stock.off_52w_high >= -25 ? "#4ade80" : "#f97316"} />}
          {stock.above_52w_low != null && <StockStat label="Ab 52W Lo" value={`+${stock.above_52w_low}%`} />}
          {/* Earnings: <14 days red (matches Pine Script) */}
          {(stock.earnings_display || stock.earnings_date) && <StockStat
            label="Earnings"
            value={stock.earnings_display || stock.earnings_date}
            color={stock.earnings_days != null && stock.earnings_days < 14 ? "#f87171" : "#c084fc"} />}
          {/* Avg $ Vol: >20M green, >10M yellow, else default */}
          {stock.avg_dollar_vol && <StockStat label="Avg $Vol" value={`$${stock.avg_dollar_vol}`}
            color={stock.avg_dollar_vol_raw > 20000000 ? "#4ade80" : stock.avg_dollar_vol_raw > 10000000 ? "#fbbf24" : "#f97316"} />}
          {/* Avg Vol: >1M green, else default */}
          {stock.avg_volume && <StockStat label="Avg Vol" value={stock.avg_volume}
            color={stock.avg_volume_raw > 1000000 ? "#4ade80" : "#f97316"} />}
          {/* RS Rating: >90 green, else default */}
          {stock.rs_rank != null && <StockStat label="RS" value={stock.rs_rank}
            color={stock.rs_rank > 90 ? "#4ade80" : "#f97316"} />}
          {stock.market_cap && <StockStat label="MCap" value={`$${stock.market_cap}`} />}
          {/* Float: <10M green, <25M yellow, else default */}
          {stock.shares_float && <StockStat label="Float" value={stock.shares_float}
            color={stock.shares_float_raw < 10000000 ? "#4ade80" : stock.shares_float_raw < 25000000 ? "#fbbf24" : "#f97316"} />}
          {stock.short_float != null && <StockStat label="Short%" value={`${stock.short_float}%`} />}
          {stock.vcs != null && <StockStat label="VCS" value={stock.vcs}
            color={stock.vcs >= 80 ? "#4ade80" : stock.vcs >= 60 ? "#60a5fa" : "#f97316"} />}
          {stock.rel_volume != null && <StockStat label="RVol" value={`${stock.rel_volume}x`} />}
        </div>
      )}

      {/* ATRX Pro style MA distances — matches Pine Script color thresholds */}
      {stock && (stock.dist_50sma_atrx != null || stock.dist_20dma_atrx != null) && (
        <div style={{ display: "flex", gap: 16, padding: "4px 12px", borderBottom: "1px solid #1a1a1a", fontSize: 10, flexShrink: 0 }}>
          {stock.sma50_pct != null && stock.dist_50sma_atrx != null && (() => {
            const atrx = Math.abs(stock.dist_50sma_atrx);
            const col = atrx >= 10 ? "#f87171" : atrx >= 6 ? "#fbbf24" : "#f97316";
            return <StockStat label="Dist 50 SMA" value={`${stock.sma50_pct > 0 ? '+' : ''}${stock.sma50_pct}% / ${stock.dist_50sma_atrx}x`} color={col} />;
          })()}
          {stock.sma20_pct != null && stock.dist_20dma_atrx != null && (() => {
            const atrx = Math.abs(stock.dist_20dma_atrx);
            const col = atrx >= 10 ? "#f87171" : atrx >= 6 ? "#fbbf24" : "#f97316";
            return <StockStat label="Dist 20 DMA" value={`${stock.sma20_pct > 0 ? '+' : ''}${stock.sma20_pct}% / ${stock.dist_20dma_atrx}x`} color={col} />;
          })()}
          {stock.sma200_pct != null && stock.dist_200sma_atrx != null && (() => {
            const atrx = Math.abs(stock.dist_200sma_atrx);
            const col = atrx >= 10 ? "#f87171" : atrx >= 6 ? "#fbbf24" : "#f97316";
            return <StockStat label="Dist 200 SMA" value={`${stock.sma200_pct > 0 ? '+' : ''}${stock.sma200_pct}% / ${stock.dist_200sma_atrx}x`} color={col} />;
          })()}
        </div>
      )}

      {/* Fundamentals row */}
      {stock && (stock.eps_yoy != null || stock.sales_yoy != null || stock.eps_qq != null || stock.pe != null) && (
        <div style={{ display: "flex", gap: 16, padding: "4px 12px", borderBottom: "1px solid #1a1a1a", fontSize: 10, flexShrink: 0, flexWrap: "wrap" }}>
          {/* YoY metrics (from FMP) — preferred */}
          {stock.eps_yoy != null && <StockStat label="EPS YoY" value={`${stock.eps_yoy > 0 ? '+' : ''}${stock.eps_yoy}%`}
            color={stock.eps_yoy > 25 ? "#4ade80" : stock.eps_yoy > 0 ? "#888" : "#f87171"} />}
          {stock.sales_yoy != null && <StockStat label="Rev YoY" value={`${stock.sales_yoy > 0 ? '+' : ''}${stock.sales_yoy}%`}
            color={stock.sales_yoy > 25 ? "#4ade80" : stock.sales_yoy > 0 ? "#888" : "#f87171"} />}
          {/* Acceleration: compare current YoY to previous quarter YoY */}
          {stock.eps_yoy != null && stock.eps_yoy_prev != null && (() => {
            const accel = stock.eps_yoy > stock.eps_yoy_prev;
            return <StockStat label="EPS Accel" value={accel ? "▲ Yes" : "▼ No"} color={accel ? "#4ade80" : "#f87171"} />;
          })()}
          {stock.sales_yoy != null && stock.sales_yoy_prev != null && (() => {
            const accel = stock.sales_yoy > stock.sales_yoy_prev;
            return <StockStat label="Rev Accel" value={accel ? "▲ Yes" : "▼ No"} color={accel ? "#4ade80" : "#f87171"} />;
          })()}
          {/* Fallback to Finviz Q/Q if no FMP data */}
          {stock.eps_yoy == null && stock.eps_qq != null && <StockStat label="EPS Q/Q" value={`${stock.eps_qq > 0 ? '+' : ''}${stock.eps_qq}%`}
            color={stock.eps_qq > 25 ? "#4ade80" : stock.eps_qq > 0 ? "#888" : "#f87171"} />}
          {stock.sales_yoy == null && stock.sales_qq != null && <StockStat label="Rev Q/Q" value={`${stock.sales_qq > 0 ? '+' : ''}${stock.sales_qq}%`}
            color={stock.sales_qq > 25 ? "#4ade80" : stock.sales_qq > 0 ? "#888" : "#f87171"} />}
          {stock.eps_growth_y != null && <StockStat label="EPS Y" value={`${stock.eps_growth_y > 0 ? '+' : ''}${stock.eps_growth_y}%`}
            color={stock.eps_growth_y > 25 ? "#4ade80" : stock.eps_growth_y > 0 ? "#888" : "#f87171"} />}
          {stock.pe != null && <StockStat label="P/E" value={stock.pe} />}
          {stock.fwd_pe != null && <StockStat label="Fwd P/E" value={stock.fwd_pe} />}
          {stock.peg != null && <StockStat label="PEG" value={stock.peg}
            color={stock.peg > 0 && stock.peg < 1.5 ? "#4ade80" : stock.peg > 3 ? "#f87171" : "#888"} />}
          {stock.roe != null && <StockStat label="ROE" value={`${stock.roe}%`}
            color={stock.roe > 15 ? "#4ade80" : stock.roe > 0 ? "#888" : "#f87171"} />}
          {stock.profit_margin != null && <StockStat label="Margin" value={`${stock.profit_margin}%`}
            color={stock.profit_margin > 10 ? "#4ade80" : stock.profit_margin > 0 ? "#888" : "#f87171"} />}
        </div>
      )}

      {/* Quarterly earnings mini-table (from FMP) */}
      {stock && stock.quarters && stock.quarters.length > 0 && (
        <div style={{ padding: "4px 12px", borderBottom: "1px solid #1a1a1a", flexShrink: 0, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 9, fontFamily: "monospace" }}>
            <thead><tr>
              <td style={{ padding: "1px 6px", color: "#555", fontWeight: 700 }}>Quarterly</td>
              {stock.quarters.map(q => (
                <td key={q.label} style={{ padding: "1px 8px", color: "#888", textAlign: "center", fontWeight: 700 }}>{q.label}</td>
              ))}
            </tr></thead>
            <tbody>
              <tr>
                <td style={{ padding: "1px 6px", color: "#555" }}>EPS ($)</td>
                {stock.quarters.map(q => (
                  <td key={q.label} style={{ padding: "1px 8px", textAlign: "center", color: q.eps > 0 ? "#ccc" : "#f87171" }}>{q.eps}</td>
                ))}
              </tr>
              <tr>
                <td style={{ padding: "1px 6px", color: "#555" }}>Sales ($)</td>
                {stock.quarters.map(q => (
                  <td key={q.label} style={{ padding: "1px 8px", textAlign: "center", color: "#ccc" }}>{q.revenue_fmt}</td>
                ))}
              </tr>
              <tr>
                <td style={{ padding: "1px 6px", color: "#555" }}>Margin %</td>
                {stock.quarters.map(q => (
                  <td key={q.label} style={{ padding: "1px 8px", textAlign: "center",
                    color: q.net_margin > 10 ? "#4ade80" : q.net_margin > 0 ? "#888" : "#f87171" }}>{q.net_margin}%</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

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
        outline: isActive ? "2px solid #10b981" : "none",
        outlineOffset: 1 }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.7"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}>
      {children}
    </span>
  );
}

// ── THEME LEADERS ──
function Leaders({ themes, stockMap, filters, onTickerClick, activeTicker, mmData, onVisibleTickers, themeHealth }) {
  const [open, setOpen] = useState({});
  const [sort, setSort] = useState("rts");
  const [detailTheme, setDetailTheme] = useState(null); // full table view for a theme
  const [detailSort, setDetailSort] = useState("rs");
  const [healthFilter, setHealthFilter] = useState(null); // null = all, or "ADD"/"REMOVE"/"LEADING" etc
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
      return_1m: (a, b) => (b.return_1m || 0) - (a.return_1m || 0),
      return_3m: (a, b) => (b.return_3m || 0) - (a.return_3m || 0),
      breadth: (a, b) => (b.breadth || 0) - (a.breadth || 0),
      a_grades: (a, b) => (b.a_grades || 0) - (a.a_grades || 0),
      health: (a, b) => (healthMap[b.theme]?.composite || 0) - (healthMap[a.theme]?.composite || 0),
    };
    t.sort(sorters[sort] || sorters.rts);
    return t;
  }, [themes, filters, sort, healthFilter, healthMap]);
  const toggle = (name) => setOpen(p => ({ ...p, [name]: !p[name] }));

  // Report visible ticker order to parent for keyboard nav
  useEffect(() => {
    if (onVisibleTickers) {
      const tickers = list.flatMap(t => t.subthemes.flatMap(s =>
        s.tickers.map(tk => stockMap[tk]).filter(Boolean).sort((a, b) => b.rs_rank - a.rs_rank).map(s => s.ticker)
      )).filter((v, i, a) => a.indexOf(v) === i);
      onVisibleTickers(tickers);
    }
  }, [list, onVisibleTickers, stockMap]);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {[["rts","RTS"],["return_1m","1M"],["return_3m","3M"],["breadth","Brdth"],["a_grades","A's"],["health","Health"]].map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)} style={{ padding: "4px 10px", borderRadius: 4,
            border: sort === k ? "1px solid #10b981" : "1px solid #333",
            background: sort === k ? "#10b98120" : "transparent", color: sort === k ? "#6ee7b7" : "#888", fontSize: 11, cursor: "pointer" }}>{l}</button>
        ))}
        {Object.keys(healthMap).length > 0 && (<>
          <span style={{ color: "#333", margin: "0 2px" }}>|</span>
          {[["All", null],["★ ADD","ADD"],["✗ REMOVE","REMOVE"],["Leading","LEADING"],["Emerging","EMERGING"],["Weakening","WEAKENING"],["Lagging","LAGGING"]].map(([label, val]) => (
            <button key={label} onClick={() => setHealthFilter(healthFilter === val ? null : val)} style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, cursor: "pointer",
              border: healthFilter === val ? "1px solid #10b981" : "1px solid #333",
              background: healthFilter === val ? "#10b98120" : "transparent",
              color: healthFilter === val ? "#6ee7b7" : val === "ADD" ? "#4ade80" : val === "REMOVE" ? "#f87171" : "#666" }}>{label}</button>
          ))}
        </>)}
      </div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 12, padding: "6px 12px", marginBottom: 6, background: "#111", borderRadius: 4, fontSize: 9, color: "#666", flexWrap: "wrap", alignItems: "center", lineHeight: 1.8 }}>
        <span><b style={{ color: "#059669" }}>STRONG</b>/<b style={{ color: "#d97706" }}>IMPROVING</b>/<b style={{ color: "#ea580c" }}>WEAKENING</b>/<b style={{ color: "#dc2626" }}>WEAK</b> — Quadrant (Weekly vs Monthly RS)</span>
        <span style={{ color: "#333" }}>|</span>
        <span><b style={{ color: "#888" }}>11</b> — Stock count</span>
        <span style={{ color: "#333" }}>|</span>
        <span><b style={{ color: "#6ee7b7" }}>78.5</b> — RTS Score (0-100, composite theme momentum)</span>
        <span style={{ color: "#333" }}>|</span>
        <span><b style={{ color: "#888" }}>B:100%</b> — Breadth (% of stocks above 50MA; <span style={{ color: "#4ade80" }}>≥60%</span> healthy, <span style={{ color: "#fbbf24" }}>≥40%</span> mixed, <span style={{ color: "#f87171" }}>&lt;40%</span> weak)</span>
        <span style={{ color: "#333" }}>|</span>
        <span><b style={{ color: "#888" }}>1W% 1M%</b> <b style={{ color: "#ccc" }}>3M%</b> — Returns (bold = 3 month)</span>
        <span style={{ color: "#333" }}>|</span>
        <span><b style={{ color: "#888" }}>4A</b> — Count of A+/A/A- graded stocks (top momentum names)</span>
        <span style={{ color: "#333" }}>|</span>
        <span><span style={{ color: "#4ade80" }}>4%↑2</span> <span style={{ color: "#f87171" }}>↓1</span> — Today's 4%+ movers on above-avg volume (green = buying, red = selling)</span>
        {Object.keys(healthMap).length > 0 && (<>
          <span style={{ color: "#333" }}>|</span>
          <span><b style={{ color: "#4ade80" }}>★ ADD</b> / <b style={{ color: "#f87171" }}>✗ REMOVE</b> — Theme health signal (structure + momentum + breakouts + breadth composite)</span>
        </>)}
      </div>
      {list.map(theme => {
        const quad = getQuad(theme.weekly_rs, theme.monthly_rs);
        const qc = QC[quad]; const isOpen = open[theme.theme];
        const barW = Math.max(5, Math.min(100, theme.rts));
        return (
          <div key={theme.theme} style={{ marginBottom: 4, borderRadius: 6, border: "1px solid #333", overflow: "hidden" }}>
            <div onClick={() => toggle(theme.theme)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
              background: `linear-gradient(90deg, ${qc.bg} ${barW}%, #111 ${barW}%)` }}>
              <span style={{ color: "#fff", fontSize: 14, width: 16 }}>{isOpen ? "▾" : "▸"}</span>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 13, flex: 1 }}>{theme.theme}</span>
              <span style={{ background: qc.tag, color: "#fff", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700 }}>{quad}</span>
              <span style={{ color: "#888", fontSize: 11 }}>{theme.count}</span>
              <span style={{ color: qc.text, fontWeight: 700, fontSize: 12, fontFamily: "monospace" }}>{theme.rts}</span>
              <span style={{ color: "#888", fontSize: 11 }}>B:{theme.breadth}%</span>
              <Ret v={theme.return_1w} /><Ret v={theme.return_1m} /><Ret v={theme.return_3m} bold />
              <span style={{ color: "#888", fontSize: 11 }}>{theme.a_grades}A</span>
              {(() => { const h = healthMap[theme.theme]; if (!h) return null;
                const sc = { LEADING: { bg: "#22c55e18", border: "#22c55e50", color: "#4ade80" },
                  EMERGING: { bg: "#fbbf2418", border: "#fbbf2450", color: "#fbbf24" },
                  HOLDING: { bg: "#88888812", border: "#88888830", color: "#888" },
                  WEAKENING: { bg: "#f9731618", border: "#f9731640", color: "#f97316" },
                  LAGGING: { bg: "#ef444418", border: "#ef444440", color: "#f87171" } }[h.status] || {};
                const sig = h.signal === "ADD" ? "★" : h.signal === "REMOVE" ? "✗" : "";
                return <span title={`Health: ${h.composite} | Struct: ${h.pillars.structure} | Mom: ${h.pillars.momentum} | Brk: ${h.pillars.breakouts} | Brdth: ${h.pillars.breadth}`}
                  style={{ padding: "1px 6px", borderRadius: 3, fontSize: 8, fontWeight: 700,
                    background: sc.bg, border: `1px solid ${sc.border}`, color: sc.color }}>
                  {sig}{sig ? " " : ""}{h.status} {h.composite}</span>;
              })()}
              {(() => { const tb = breadthMap[theme.theme]; if (!tb || (tb.up_4pct === 0 && tb.down_4pct === 0)) return null;
                return <span style={{ fontSize: 9, fontFamily: "monospace", padding: "1px 5px", borderRadius: 3, marginLeft: 2,
                  background: tb.net > 0 ? "#22c55e15" : tb.net < 0 ? "#ef444415" : "#33333330",
                  border: `1px solid ${tb.net > 0 ? "#22c55e30" : tb.net < 0 ? "#ef444430" : "#33333340"}`,
                  color: tb.net > 0 ? "#4ade80" : tb.net < 0 ? "#f87171" : "#666" }}>
                  4%↑{tb.up_4pct} ↓{tb.down_4pct}</span>;
              })()}
            </div>
            {isOpen && (
              <div style={{ background: "#0a0a0a", padding: "4px 8px" }}>
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
                  <div style={{ display: "flex", gap: 16, padding: "6px 8px", marginBottom: 6, background: "#111", borderRadius: 4, fontSize: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ color: "#888" }}>Stocks: <b style={{ color: "#fff" }}>{theme.count}</b></span>
                    <span style={{ color: "#888" }}>A grades: <b style={{ color: "#4ade80" }}>{theme.a_grades}</b></span>
                    <span style={{ color: "#888" }}>Breadth: <b style={{ color: theme.breadth >= 60 ? "#4ade80" : theme.breadth >= 40 ? "#fbbf24" : "#f87171" }}>{theme.breadth}%</b></span>
                    <span style={{ color: "#888" }}>Avg RS: <b style={{ color: "#ccc" }}>{Math.round(allStocks.reduce((a, s) => a + (s.rs_rank || 0), 0) / total)}</b></span>
                    {(() => { const best = [...allStocks].sort((a, b) => b.return_3m - a.return_3m)[0];
                      return best ? <span style={{ color: "#888" }}>Top 3M: <b style={{ color: "#4ade80" }}>{best.ticker}</b> <Ret v={best.return_3m} bold /></span> : null;
                    })()}
                    {/* 52W High Proximity Distribution */}
                    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 1, marginLeft: 4 }} title={`Within 5%: ${hi5}\n5-10%: ${hi10}\n10-25%: ${hi25}\n25-50%: ${hi50}\n>50%: ${hiRest}`}>
                      <span style={{ fontSize: 8, color: "#555", marginRight: 2, alignSelf: "center" }}>52WH:</span>
                      {[[hi5,"#4ade80","<5%"],[hi10,"#60a5fa","5-10"],[hi25,"#fbbf24","10-25"],[hi50,"#f97316","25-50"],[hiRest,"#f87171",">50"]].map(([cnt, col, lbl]) => (
                        <span key={lbl} title={`${lbl}%: ${cnt}`} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                          <span style={{ width: 14, background: col + "60", borderRadius: "2px 2px 0 0",
                            height: Math.max(2, Math.round(cnt / total * 40)) }} />
                          <span style={{ fontSize: 7, color: "#555" }}>{cnt}</span>
                        </span>
                      ))}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); setDetailTheme(detailTheme === theme.theme ? null : theme.theme); }}
                      style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 4, fontSize: 9, cursor: "pointer",
                        border: detailTheme === theme.theme ? "1px solid #10b981" : "1px solid #333",
                        background: detailTheme === theme.theme ? "#10b98120" : "transparent",
                        color: detailTheme === theme.theme ? "#6ee7b7" : "#666" }}>
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
                    <div style={{ display: "flex", gap: 10, padding: "4px 8px", marginBottom: 4, fontSize: 9, alignItems: "center" }}>
                      <span style={{ color: "#555", fontSize: 8, minWidth: 45 }}>HEALTH</span>
                      {bars.map(([label, val, tip]) => (
                        <span key={label} title={tip} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <span style={{ color: "#666" }}>{label}</span>
                          <span style={{ width: 40, height: 4, background: "#222", borderRadius: 2, overflow: "hidden", display: "inline-block" }}>
                            <span style={{ width: `${val}%`, height: "100%", display: "block", borderRadius: 2,
                              background: val >= 65 ? "#4ade80" : val >= 40 ? "#fbbf24" : "#f87171" }} />
                          </span>
                          <span style={{ color: val >= 65 ? "#4ade80" : val >= 40 ? "#fbbf24" : "#f87171", fontFamily: "monospace" }}>{Math.round(val)}</span>
                        </span>
                      ))}
                    </div>
                  );
                })()}

                {/* Detail table view */}
                {detailTheme === theme.theme && (() => {
                  const allStocks = theme.subthemes.flatMap(sub => sub.tickers.map(t => stockMap[t]).filter(Boolean));
                  const cols = [["Ticker","ticker"],["Grade","grade"],["RS","rs"],["1M%","ret1m"],["3M%","ret3m"],["FrHi%","fromhi"],["VCS","vcs"],["ADR%","adr"],["Vol","vol"],["RVol","rvol"],["Subtheme",null]];
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
                    ret1m: safe(s => s.return_1m),
                    ret3m: safe(s => s.return_3m),
                    fromhi: safe(s => s.pct_from_high),
                    vcs: safe(s => s.vcs),
                    adr: safe(s => s.adr_pct),
                    vol: safe(s => s.avg_volume_raw && s.rel_volume ? s.avg_volume_raw * s.rel_volume : null),
                    rvol: safe(s => s.rel_volume),
                  };
                  // Build ticker→subtheme map
                  const subMap = {};
                  theme.subthemes.forEach(sub => sub.tickers.forEach(t => { subMap[t] = sub.name; }));
                  const sorted = [...allStocks].sort(dSorters[detailSort] || dSorters.rs);
                  return (
                    <div style={{ marginBottom: 8 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                        <thead><tr style={{ borderBottom: "2px solid #333" }}>
                          {cols.map(([h, sk]) => (
                            <th key={h} onClick={sk ? () => setDetailSort(prev => prev === sk ? "rs" : sk) : undefined}
                              style={{ padding: "4px 6px", color: detailSort === sk ? "#6ee7b7" : "#666", fontWeight: 700, textAlign: "center", fontSize: 9,
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
                              style={{ borderBottom: "1px solid #1a1a1a", cursor: "pointer", background: isAct ? "#10b98115" : "transparent" }}>
                              <td style={{ padding: "3px 6px", textAlign: "center", color: isAct ? "#10b981" : "#fff", fontWeight: 700 }}>{s.ticker}</td>
                              <td style={{ padding: "3px 6px", textAlign: "center" }}><Badge grade={s.grade} /></td>
                              <td style={{ padding: "3px 6px", textAlign: "center", color: "#ccc", fontFamily: "monospace" }}>{s.rs_rank}</td>
                              <td style={{ padding: "3px 6px", textAlign: "center" }}><Ret v={s.return_1m} /></td>
                              <td style={{ padding: "3px 6px", textAlign: "center" }}><Ret v={s.return_3m} bold /></td>
                              <td style={{ padding: "3px 6px", textAlign: "center", color: near ? "#4ade80" : "#888", fontWeight: near ? 700 : 400, fontFamily: "monospace" }}>{s.pct_from_high}%</td>
                              <td style={{ padding: "3px 6px", textAlign: "center", fontFamily: "monospace",
                                color: s.vcs >= 80 ? "#4ade80" : s.vcs >= 60 ? "#60a5fa" : s.vcs != null ? "#888" : "#333" }}>
                                {s.vcs != null ? s.vcs : '—'}</td>
                              <td style={{ padding: "3px 6px", textAlign: "center", fontFamily: "monospace",
                                color: s.adr_pct > 8 ? "#2dd4bf" : s.adr_pct > 5 ? "#4ade80" : s.adr_pct > 3 ? "#fbbf24" : "#f97316" }}>
                                {s.adr_pct != null ? `${s.adr_pct}%` : '—'}</td>
                              {(() => { const v = s.avg_volume_raw && s.rel_volume ? Math.round(s.avg_volume_raw * s.rel_volume) : null;
                                const fmt = v == null ? '—' : v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : `${v}`;
                                return <td style={{ padding: "3px 6px", textAlign: "center", fontFamily: "monospace",
                                  color: v >= 1e6 ? "#888" : v != null ? "#f97316" : "#333" }}>{fmt}</td>; })()}
                              <td style={{ padding: "3px 6px", textAlign: "center", fontFamily: "monospace",
                                color: s.rel_volume >= 2 ? "#c084fc" : s.rel_volume >= 1.5 ? "#a78bfa" : s.rel_volume != null ? "#555" : "#333" }}>
                                {s.rel_volume != null ? `${s.rel_volume.toFixed(1)}x` : '—'}</td>
                              <td style={{ padding: "3px 6px", color: "#555", fontSize: 9 }}>{subMap[s.ticker]}</td>
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
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderBottom: "1px solid #1a1a1a", fontSize: 11 }}>
                      <span style={{ color: "#ccc", fontWeight: 600, width: 160, textAlign: "left" }}>{sub.name}</span>
                      <span style={{ color: "#666", width: 24, textAlign: "center" }}>{sub.count}</span>
                      <span style={{ color: sub.rts >= 65 ? "#4ade80" : sub.rts >= 50 ? "#60a5fa" : "#fbbf24", fontWeight: 700, fontFamily: "monospace", width: 32 }}>{sub.rts}</span>
                      <Ret v={sub.return_1m} /><Ret v={sub.return_3m} bold />
                      <span style={{ color: "#666", fontSize: 10 }}>B:{sub.breadth}%</span>
                      <span style={{ color: "#666", fontSize: 10 }}>{sub.a_grades}A</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "4px 8px" }}>
                      {sub.tickers.map(t => stockMap[t]).filter(Boolean).sort((a, b) => b.rs_rank - a.rs_rank).map(s => {
                        const ext = s.atr_to_50 >= 7 ? "#f87171" : s.atr_to_50 >= 5 ? "#c084fc" : null;
                        const gc = GRADE_COLORS[s.grade] || "#333";
                        return (
                          <Ticker key={s.ticker} ticker={s.ticker} onClick={onTickerClick} activeTicker={activeTicker}
                            title={`${s.company}\nGrade: ${s.grade} | RS: ${s.rs_rank}\n3M: ${s.return_3m}% | ATR/50: ${s.atr_to_50}\nFrom High: ${s.pct_from_high}%`}
                            style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px", borderRadius: 4, fontSize: 11, fontFamily: "monospace",
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
      <div style={{ color: "#555", fontSize: 11, marginTop: 8 }}>{list.length} themes shown</div>
    </div>
  );
}

function Rotation({ themes }) {
  const quads = useMemo(() => {
    const q = { STRONG: [], IMPROVING: [], WEAKENING: [], WEAK: [] };
    themes.forEach(t => q[getQuad(t.weekly_rs, t.monthly_rs)].push(t));
    Object.keys(q).forEach(k => q[k].sort((a, b) => b.rts - a.rts));
    return q;
  }, [themes]);
  const QuadBox = ({ quad, title, desc, items }) => {
    const qc = QC[quad];
    return (
      <div style={{ background: qc.bg, border: `1px solid ${qc.tag}40`, borderRadius: 8, padding: 12, minHeight: 200 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ color: qc.text, fontWeight: 700, fontSize: 14 }}>{title}</span>
          <span style={{ background: qc.tag, color: "#fff", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{items.length}</span>
        </div>
        <div style={{ color: qc.text + "88", fontSize: 10, marginBottom: 8 }}>{desc}</div>
        {items.map(t => (
          <div key={t.theme} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", borderRadius: 4, marginBottom: 2, background: qc.bg + "80" }}>
            <span style={{ color: qc.text, fontWeight: 600, fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.theme}</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: qc.text, fontSize: 11, fontFamily: "monospace" }}>RTS {t.rts}</span>
              <Ret v={t.return_1m} /><Ret v={t.return_3m} />
            </div>
          </div>
        ))}
      </div>
    );
  };
  return (
    <div>
      <div style={{ textAlign: "center", color: "#666", fontSize: 11, marginBottom: 8 }}>↑ MONTHLY RS STRONG</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <QuadBox quad="WEAKENING" title="WEAKENING" desc="Monthly strong, Weekly fading — tighten stops" items={quads.WEAKENING} />
        <QuadBox quad="STRONG" title="STRONG" desc="Both strong — BUY these themes" items={quads.STRONG} />
        <QuadBox quad="WEAK" title="WEAK" desc="Both weak — AVOID" items={quads.WEAK} />
        <QuadBox quad="IMPROVING" title="IMPROVING" desc="Weekly rising — WATCH for breakout" items={quads.IMPROVING} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#666", fontSize: 11, marginTop: 8 }}>
        <span>← WEEKLY WEAK</span><span>WEEKLY STRONG →</span>
      </div>
    </div>
  );
}

function Scan({ stocks, themes, onTickerClick, activeTicker, onVisibleTickers }) {
  const [sortBy, setSortBy] = useState("default");
  const [nearPivot, setNearPivot] = useState(false);
  const [scanMode, setScanMode] = useState("theme"); // "theme" = original, "winners" = Best Winners, "liquid" = Liquid Leaders
  const leading = useMemo(() => new Set(themes.filter(t => t.rts >= 50).map(t => t.theme)), [themes]);
  const candidates = useMemo(() => {
    let list;
    if (scanMode === "winners") {
      // Best Winners filter
      list = stocks.filter(s => {
        const price = s.price || 0;
        const adr = s.adr_pct || 0;
        const aboveLow = s.above_52w_low || 0;
        const avgDolVol = s.avg_dollar_vol_raw || 0;
        const sma20 = s.sma20_pct;
        const sma50 = s.sma50_pct;
        return price > 1
          && adr > 4.5
          && aboveLow >= 70
          && avgDolVol >= 7000000
          && sma20 != null && sma20 > 0
          && sma50 != null && sma50 > 0;
      });
    } else if (scanMode === "liquid") {
      // Liquid Leaders filter — high-quality liquid institutional names
      // Revenue Growth Q/Q > 25%, Price > $10, MCap > $300M, AvgVol > 1M, Avg$Vol > $100M, ADR > 3%
      list = stocks.filter(s => {
        const price = s.price || 0;
        const mcap = s.market_cap_raw || 0;
        const avgVol = s.avg_volume_raw || 0;
        const avgDolVol = s.avg_dollar_vol_raw || 0;
        const adr = s.adr_pct || 0;
        const salesGrowth = s.sales_yoy ?? s.sales_qq;
        return price > 10
          && mcap >= 300000000
          && avgVol >= 1000000
          && avgDolVol >= 100000000
          && adr > 3
          && salesGrowth != null && salesGrowth > 25;
      });
    } else {
      // Original theme-based filter
      list = stocks.filter(s => {
        const good = ["A+","A","A-","B+"].includes(s.grade);
        const inLead = s.themes.some(t => leading.has(t.theme));
        return good && inLead && s.atr_to_50 > 0 && s.atr_to_50 < 7 && s.above_50ma && s.return_3m >= 21;
      });
    }
    if (nearPivot) list = list.filter(s => s.pct_from_high >= -3);
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
      ticker: (a, b) => a.ticker.localeCompare(b.ticker),
      grade: safe(s => GRADE_ORDER[s.grade] ?? null),
      rs: safe(s => s.rs_rank),
      ret1m: safe(s => s.return_1m),
      ret3m: safe(s => s.return_3m),
      fromhi: safe(s => s.pct_from_high),
      vcs: safe(s => s.vcs),
      adr: safe(s => s.adr_pct),
      vol: safe(s => s.avg_volume_raw && s.rel_volume ? s.avg_volume_raw * s.rel_volume : null),
      rvol: safe(s => s.rel_volume),
    };
    return list.sort(sorters[sortBy] || sorters.default);
  }, [stocks, leading, sortBy, nearPivot, scanMode]);

  // Report visible ticker order to parent for keyboard nav
  useEffect(() => {
    if (onVisibleTickers) onVisibleTickers(candidates.map(s => s.ticker));
  }, [candidates, onVisibleTickers]);

  const filterDesc = scanMode === "winners"
    ? "Price>$1 | ADR>4.5% | Ab52WLo≥70% | Avg$Vol>$7M | >20SMA | >50SMA"
    : scanMode === "liquid"
    ? "Price>$10 | MCap>$300M | AvgVol>1M | Avg$Vol>$100M | ADR>3% | RevQ/Q>25%"
    : "A/B+ | Leading theme | 21%+ 3M | Above 50MA | Not 7x+";

  // Column header config: [label, sortKey or null]
  const columns = [
    ["Action", null], ["Ticker", "ticker"], ["Grade", "grade"], ["RS", "rs"], ["1M%", "ret1m"], ["3M%", "ret3m"],
    ["FrHi%", "fromhi"], ["VCS", "vcs"], ["ADR%", "adr"], ["Vol", "vol"], ["RVol", "rvol"], ["Theme", null],
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        {[["theme","Theme Scan"],["winners","Best Winners"],["liquid","Liquid Leaders"]].map(([k, l]) => (
          <button key={k} onClick={() => setScanMode(k)} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
            border: scanMode === k ? "1px solid #10b981" : "1px solid #333",
            background: scanMode === k ? "#10b98118" : "transparent", color: scanMode === k ? "#6ee7b7" : "#666" }}>{l}</button>
        ))}
        <span style={{ color: "#555", fontSize: 10 }}>|</span>
        <span style={{ color: "#888", fontSize: 10 }}>{filterDesc}</span>
        <span style={{ color: "#4ade80", fontWeight: 700, fontSize: 11 }}>{candidates.length}</span>
        <button onClick={() => setNearPivot(p => !p)} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, cursor: "pointer", marginLeft: "auto",
          border: nearPivot ? "1px solid #c084fc" : "1px solid #333",
          background: nearPivot ? "#c084fc20" : "transparent", color: nearPivot ? "#c084fc" : "#666" }}>Near Pivot (&lt;3%)</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead><tr style={{ borderBottom: "2px solid #333" }}>
          {columns.map(([h, sk]) => (
            <th key={h} onClick={sk ? () => setSortBy(prev => prev === sk ? "default" : sk) : undefined}
              style={{ padding: "6px 8px", color: sortBy === sk ? "#6ee7b7" : "#666", fontWeight: 700, textAlign: "center", fontSize: 10,
                cursor: sk ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>
              {h}{sortBy === sk ? " ▼" : ""}</th>
          ))}
        </tr></thead>
        <tbody>{candidates.map(s => {
          const near = s.pct_from_high >= -5;
          const pb = s.pct_from_high < -10 && s.pct_from_high >= -25;
          const action = near ? "BUY ZONE" : pb ? "WATCH PB" : "ON RADAR";
          const ac = near ? "#059669" : pb ? "#d97706" : "#555";
          const theme = s.themes.find(t => leading.has(t.theme));
          const isActive = s.ticker === activeTicker;
          return (
            <tr key={s.ticker} ref={isActive ? (el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" }) : undefined}
              onClick={() => onTickerClick(s.ticker)}
              style={{ borderBottom: "1px solid #1a1a1a", cursor: "pointer",
                background: isActive ? "#10b98115" : "transparent" }}>
              <td style={{ padding: "4px 8px", textAlign: "center" }}><span style={{ background: ac, color: "#fff", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700 }}>{action}</span></td>
              <td style={{ padding: "4px 8px", textAlign: "center", color: isActive ? "#10b981" : "#fff", fontWeight: 700 }}>{s.ticker}</td>
              <td style={{ padding: "4px 8px", textAlign: "center" }}><Badge grade={s.grade} /></td>
              <td style={{ padding: "4px 8px", textAlign: "center", color: "#ccc", fontFamily: "monospace" }}>{s.rs_rank}</td>
              <td style={{ padding: "4px 8px", textAlign: "center" }}><Ret v={s.return_1m} /></td>
              <td style={{ padding: "4px 8px", textAlign: "center" }}><Ret v={s.return_3m} bold /></td>
              <td style={{ padding: "4px 8px", textAlign: "center", color: near ? "#4ade80" : "#888", fontWeight: near ? 700 : 400, fontFamily: "monospace" }}>{s.pct_from_high}%</td>
              <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                color: s.vcs >= 80 ? "#4ade80" : s.vcs >= 60 ? "#60a5fa" : s.vcs != null ? "#888" : "#333",
                fontWeight: s.vcs >= 60 ? 700 : 400 }}
                title={s.vcs_detail ? `ATR:${s.vcs_detail.atr ?? '-'} Vol:${s.vcs_detail.vol ?? '-'} Cons:${s.vcs_detail.cons ?? '-'} Struc:${s.vcs_detail.struc ?? '-'}` : ''}>
                {s.vcs != null ? s.vcs : '—'}</td>
              <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                color: s.adr_pct > 8 ? "#2dd4bf" : s.adr_pct > 5 ? "#4ade80" : s.adr_pct > 3 ? "#fbbf24" : "#f97316" }}>
                {s.adr_pct != null ? `${s.adr_pct}%` : '—'}</td>
              {(() => { const v = s.avg_volume_raw && s.rel_volume ? Math.round(s.avg_volume_raw * s.rel_volume) : null;
                const fmt = v == null ? '—' : v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : `${v}`;
                return <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                  color: v >= 1e6 ? "#888" : v != null ? "#f97316" : "#333" }}>{fmt}</td>; })()}
              <td style={{ padding: "4px 8px", textAlign: "center", fontFamily: "monospace",
                color: s.rel_volume >= 2 ? "#c084fc" : s.rel_volume >= 1.5 ? "#a78bfa" : s.rel_volume != null ? "#555" : "#333" }}>
                {s.rel_volume != null ? `${s.rel_volume.toFixed(1)}x` : '—'}</td>
              <td style={{ padding: "4px 8px", color: "#666", fontSize: 10 }}>{theme?.theme}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

// ── BAR GAUGE COMPONENT ──
function Gauge({ value, min, max, label, zones, unit = "" }) {
  const pct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;
  
  let zoneColor = "#666";
  if (zones) {
    if (zones.green && value >= zones.green[0] && value <= zones.green[1]) zoneColor = "#22c55e";
    else if (zones.yellow && value >= zones.yellow[0] && value <= zones.yellow[1]) zoneColor = "#eab308";
    else if (zones.yellow_low && value >= zones.yellow_low[0] && value <= zones.yellow_low[1]) zoneColor = "#eab308";
    else if (zones.yellow_high && value >= zones.yellow_high[0] && value <= zones.yellow_high[1]) zoneColor = "#eab308";
    else if (zones.red && value >= zones.red[0] && value <= zones.red[1]) zoneColor = "#ef4444";
    else if (zones.red_low && value >= zones.red_low[0] && value <= zones.red_low[1]) zoneColor = "#ef4444";
    else if (zones.red_high && value >= zones.red_high[0] && value <= zones.red_high[1]) zoneColor = "#ef4444";
    else zoneColor = "#eab308";
  }
  
  const displayVal = typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) : value;
  
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: "#888" }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: zoneColor }}>{displayVal}{unit}</span>
      </div>
      <div style={{ height: 6, background: "#1a1a1a", borderRadius: 3, overflow: "hidden", position: "relative" }}>
        {/* Zone background segments */}
        {zones && (() => {
          const segs = [];
          const allZones = [
            { key: "red_low", color: "#ef444425" }, { key: "red", color: "#ef444425" },
            { key: "yellow_low", color: "#eab30820" }, { key: "yellow", color: "#eab30820" },
            { key: "green", color: "#22c55e20" },
            { key: "yellow_high", color: "#eab30820" },
            { key: "red_high", color: "#ef444425" },
          ];
          allZones.forEach(({ key, color }) => {
            if (zones[key]) {
              const left = Math.max(0, (zones[key][0] - min) / (max - min) * 100);
              const right = Math.min(100, (zones[key][1] - min) / (max - min) * 100);
              if (right > left) segs.push(<div key={key} style={{ position: "absolute", left: `${left}%`, width: `${right - left}%`, height: "100%", background: color }} />);
            }
          });
          return segs;
        })()}
        {/* Value bar */}
        <div style={{ height: "100%", width: `${pct}%`, background: zoneColor, borderRadius: 3, position: "relative", transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

// ── MARKET MONITOR ──
function MarketMonitor({ mmData }) {
  if (!mmData) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 24, fontWeight: 900, color: "#fff", marginBottom: 8 }}>MARKET MONITOR</div>
        <div style={{ color: "#666", fontSize: 13, marginBottom: 24 }}>Stockbee-style Breadth Tracker</div>
        <div style={{ color: "#888", fontSize: 12, padding: 20, border: "1px dashed #333", borderRadius: 8, maxWidth: 400, margin: "0 auto" }}>
          No market monitor data found. Run <code style={{ color: "#10b981" }}>10_market_monitor.py</code> to generate data, then copy <code style={{ color: "#10b981" }}>market_monitor.json</code> to your themepulse/public/ folder.
        </div>
      </div>
    );
  }

  const c = mmData.current;
  const gauges = mmData.gauges;
  const history = mmData.history || [];
  
  // Ratios might be in history but not in current (calculated after append)
  const lastHist = history.length > 0 ? history[history.length - 1] : {};
  const ratio5d = c.ratio_5d || lastHist.ratio_5d || 0;
  const ratio10d = c.ratio_10d || lastHist.ratio_10d || 0;
  
  // Helper to get gauge zones from config
  const gz = (key) => gauges[key] || {};
  
  // Determine max values for gauges dynamically
  const maxUp4 = Math.max(1000, c.up_4pct, ...history.map(h => h.up_4pct || 0));
  const maxDn4 = Math.max(1000, c.down_4pct, ...history.map(h => h.down_4pct || 0));
  const maxQ = Math.max(2000, c.up_25q, c.down_25q, ...history.map(h => Math.max(h.up_25q || 0, h.down_25q || 0)));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>MARKET MONITOR</span>
        <span style={{ color: "#666", fontSize: 11 }}>{mmData.date}</span>
        <span style={{ color: "#555", fontSize: 10 }}>{c.total_stocks} stocks scanned</span>
      </div>

      {/* PRIMARY INDICATORS */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ color: "#10b981", fontSize: 11, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>Primary Indicators</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", maxWidth: 700 }}>
          <Gauge value={c.up_4pct} min={0} max={maxUp4} label="Up 4%+ Today" zones={gz("up_4pct")} />
          <Gauge value={c.down_4pct} min={0} max={maxDn4} label="Down 4%+ Today" zones={gz("down_4pct")} />
          <Gauge value={c.up_25q} min={0} max={maxQ} label="Up 25%+ Qtr" zones={gz("up_25q")} />
          <Gauge value={c.down_25q} min={0} max={maxQ} label="Down 25%+ Qtr" zones={gz("down_25q")} />
          <Gauge value={ratio5d} min={0} max={5} label="5-Day Ratio" zones={gz("ratio_5d")} />
          <Gauge value={ratio10d} min={0} max={5} label="10-Day Ratio" zones={gz("ratio_10d")} />
        </div>
      </div>

      {/* SECONDARY INDICATORS */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ color: "#60a5fa", fontSize: 11, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>Secondary Indicators</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", maxWidth: 700 }}>
          <Gauge value={c.up_25m} min={0} max={Math.max(500, c.up_25m)} label="Up 25%+ Mo" zones={gz("up_25m")} />
          <Gauge value={c.down_25m} min={0} max={Math.max(500, c.down_25m)} label="Down 25%+ Mo" zones={gz("down_25m")} />
          <Gauge value={c.up_50m} min={0} max={Math.max(100, c.up_50m)} label="Up 50%+ Mo" zones={gz("up_50m")} />
          <Gauge value={c.down_50m} min={0} max={Math.max(100, c.down_50m)} label="Down 50%+ Mo" zones={gz("down_50m")} />
          <Gauge value={c.up_13_34d} min={0} max={Math.max(800, c.up_13_34d)} label="Up 13%+ 34d" zones={gz("up_13_34d")} />
          <Gauge value={c.down_13_34d} min={0} max={Math.max(800, c.down_13_34d)} label="Down 13%+ 34d" zones={gz("down_13_34d")} />
          <Gauge value={c.t2108} min={0} max={100} label="T2108 (% > 40MA)" zones={gz("t2108")} unit="%" />
        </div>
      </div>

      {/* HISTORY TABLE */}
      {history.length > 0 && (
        <div>
          <div style={{ color: "#888", fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>History</div>
          <div style={{ overflowX: "auto", maxHeight: "40vh", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead><tr style={{ position: "sticky", top: 0, background: "#111", borderBottom: "2px solid #333", zIndex: 1 }}>
                {["Date","4%↑","4%↓","25%Q↑","25%Q↓","5dR","10dR","25%M↑","25%M↓","50%M↑","50%M↓","13%/34↑","13%/34↓","T2108"].map(h => (
                  <th key={h} style={{ padding: "4px 6px", color: "#666", fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>{[...history].reverse().map((row, i, arr) => {
                const prev = arr[i + 1]; // previous day (next in reversed array)
                const cellColor = (val, key) => {
                  const g = gauges[key];
                  if (!g) return "#888";
                  if (g.green && val >= g.green[0] && val <= g.green[1]) return "#4ade80";
                  if (g.red && val >= g.red[0] && val <= g.red[1]) return "#f87171";
                  if (g.red_low && val >= g.red_low[0] && val <= g.red_low[1]) return "#f87171";
                  if (g.red_high && val >= g.red_high[0] && val <= g.red_high[1]) return "#f87171";
                  if (g.yellow && val >= g.yellow[0] && val <= g.yellow[1]) return "#fbbf24";
                  if (g.yellow_low && val >= g.yellow_low[0] && val <= g.yellow_low[1]) return "#fbbf24";
                  if (g.yellow_high && val >= g.yellow_high[0] && val <= g.yellow_high[1]) return "#fbbf24";
                  return "#888";
                };
                const delta = (val, prevVal) => {
                  if (prev == null || prevVal == null || val == null) return "";
                  const d = val - prevVal;
                  if (d > 0) return " ▲";
                  if (d < 0) return " ▼";
                  return "";
                };
                const deltaCol = (val, prevVal) => {
                  if (prev == null || prevVal == null || val == null) return undefined;
                  const d = val - prevVal;
                  if (d > 0) return "#4ade8060";
                  if (d < 0) return "#f8717160";
                  return undefined;
                };
                const cc = (val, key, prevVal) => ({ padding: "3px 6px", textAlign: "center", fontFamily: "monospace", color: cellColor(val, key), fontWeight: i === 0 ? 700 : 400 });
                const cv = (val, key, prevKey) => {
                  const pv = prev ? prev[prevKey || key] : null;
                  const d = delta(val, pv);
                  const fmt = typeof val === 'number' && !Number.isInteger(val) ? val?.toFixed(1) : val;
                  return <>{fmt}<span style={{ fontSize: 7, color: d.includes("▲") ? "#4ade80" : "#f87171" }}>{d}</span></>;
                };
                return (
                  <tr key={row.date} style={{ borderBottom: "1px solid #1a1a1a", background: i === 0 ? "#10b98108" : "transparent" }}>
                    <td style={{ padding: "3px 6px", color: i === 0 ? "#fff" : "#666", fontWeight: i === 0 ? 700 : 400, whiteSpace: "nowrap" }}>{row.date}</td>
                    <td style={cc(row.up_4pct, "up_4pct")}>{cv(row.up_4pct, "up_4pct")}</td>
                    <td style={cc(row.down_4pct, "down_4pct")}>{cv(row.down_4pct, "down_4pct")}</td>
                    <td style={cc(row.up_25q, "up_25q")}>{cv(row.up_25q, "up_25q")}</td>
                    <td style={cc(row.down_25q, "down_25q")}>{cv(row.down_25q, "down_25q")}</td>
                    <td style={cc(row.ratio_5d, "ratio_5d")}>{cv(row.ratio_5d, "ratio_5d")}</td>
                    <td style={cc(row.ratio_10d, "ratio_10d")}>{cv(row.ratio_10d, "ratio_10d")}</td>
                    <td style={cc(row.up_25m, "up_25m")}>{cv(row.up_25m, "up_25m")}</td>
                    <td style={cc(row.down_25m, "down_25m")}>{cv(row.down_25m, "down_25m")}</td>
                    <td style={cc(row.up_50m, "up_50m")}>{cv(row.up_50m, "up_50m")}</td>
                    <td style={cc(row.down_50m, "down_50m")}>{cv(row.down_50m, "down_50m")}</td>
                    <td style={cc(row.up_13_34d, "up_13_34d")}>{cv(row.up_13_34d, "up_13_34d")}</td>
                    <td style={cc(row.down_13_34d, "down_13_34d")}>{cv(row.down_13_34d, "down_13_34d")}</td>
                    <td style={cc(row.t2108, "t2108")}>{cv(row.t2108, "t2108")}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* THEME BREADTH — 4% movers by theme */}
      {/* Theme Breadth Sparklines */}
      {(() => {
        const hist = mmData.theme_breadth_history;
        const todayBreadth = mmData.theme_breadth || [];
        // Get all themes that have either sparkline history or today's 4% movers
        const allThemes = new Set([
          ...(hist ? Object.keys(hist) : []),
          ...todayBreadth.map(tb => tb.theme),
        ]);
        if (allThemes.size === 0) return null;

        // Build lookup for today's 4% movers
        const todayMap = {};
        todayBreadth.forEach(tb => { todayMap[tb.theme] = tb; });

        // Build theme list with current breadth, sort by latest breadth desc
        const themes = [...allThemes].map(name => {
          const points = hist?.[name] || [];
          const latest = points.length > 0 ? points[points.length - 1].breadth : 0;
          const tb = todayMap[name];
          return { name, points, latest, tb };
        }).sort((a, b) => b.latest - a.latest);

        return (
          <div style={{ marginTop: 20 }}>
            <div style={{ color: "#c084fc", fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
              Theme Breadth — % Above 50MA (30-day trend)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", maxWidth: 800 }}>
              {themes.map(({ name, points, latest, tb }) => {
                const vals = points.map(p => p.breadth);
                const sparkW = 80, sparkH = 20;
                const mn = Math.min(0, ...vals);
                const mx = Math.max(100, ...vals);
                const range = mx - mn || 1;
                // Build SVG path
                let pathD = "";
                let areaD = "";
                if (vals.length > 1) {
                  const pts = vals.map((v, i) => {
                    const x = (i / (vals.length - 1)) * sparkW;
                    const y = sparkH - ((v - mn) / range) * sparkH;
                    return [x, y];
                  });
                  pathD = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
                  areaD = pathD + ` L${sparkW},${sparkH} L0,${sparkH} Z`;
                }
                // Trend: compare last vs 5 days ago
                const prev = vals.length >= 6 ? vals[vals.length - 6] : vals[0];
                const delta = latest - (prev || 0);
                const trendColor = delta > 3 ? "#4ade80" : delta < -3 ? "#f87171" : "#888";
                const lineColor = latest >= 60 ? "#4ade80" : latest >= 40 ? "#fbbf24" : "#f87171";
                const netColor = tb ? (tb.net > 0 ? "#4ade80" : tb.net < 0 ? "#f87171" : "#555") : "#555";

                return (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                    <span style={{ fontSize: 10, color: "#aaa", width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{name}</span>
                    {vals.length > 1 ? (
                      <svg width={sparkW} height={sparkH} style={{ flexShrink: 0 }}>
                        {/* 50% reference line */}
                        <line x1={0} y1={sparkH - ((50 - mn) / range) * sparkH} x2={sparkW} y2={sparkH - ((50 - mn) / range) * sparkH}
                          stroke="#333" strokeWidth={0.5} strokeDasharray="2,2" />
                        {/* Area fill */}
                        <path d={areaD} fill={lineColor} opacity={0.1} />
                        {/* Sparkline */}
                        <path d={pathD} fill="none" stroke={lineColor} strokeWidth={1.5} />
                        {/* Current dot */}
                        <circle cx={sparkW} cy={sparkH - ((latest - mn) / range) * sparkH} r={2} fill={lineColor} />
                      </svg>
                    ) : (
                      <div style={{ width: sparkW, height: sparkH, flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: lineColor, width: 30, textAlign: "right", flexShrink: 0 }}>{latest}%</span>
                    <span style={{ fontSize: 9, fontFamily: "monospace", color: trendColor, width: 28, textAlign: "right", flexShrink: 0 }}>
                      {delta >= 0 ? '+' : ''}{delta.toFixed(0)}
                    </span>
                    {tb && (tb.up_4pct > 0 || tb.down_4pct > 0) && (
                      <span style={{ fontSize: 9, fontFamily: "monospace", color: netColor, flexShrink: 0 }}>
                        <span style={{ color: "#4ade80" }}>↑{tb.up_4pct}</span>
                        <span style={{ color: "#555" }}>/</span>
                        <span style={{ color: "#f87171" }}>↓{tb.down_4pct}</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── EPISODIC PIVOTS ──
function EpisodicPivots({ epSignals, stockMap, onTickerClick, activeTicker, onVisibleTickers }) {
  const [sortBy, setSortBy] = useState("date");
  const [minGap, setMinGap] = useState(8);
  const [minVol, setMinVol] = useState(3);
  const [maxDays, setMaxDays] = useState(60);
  const [statusFilter, setStatusFilter] = useState(null); // null = all

  const filtered = useMemo(() => {
    if (!epSignals || !epSignals.length) return [];
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
      theme: (a, b) => (stockMap[a.ticker]?.themes?.[0]?.theme || "ZZZ").localeCompare(stockMap[b.ticker]?.themes?.[0]?.theme || "ZZZ"),
    };
    return epSignals
      .filter(ep => ep.gap_pct >= minGap && ep.vol_ratio >= minVol && ep.days_ago <= maxDays)
      .filter(ep => !statusFilter || ep.consol?.status === statusFilter)
      .sort(sorters[sortBy] || sorters.date);
  }, [epSignals, stockMap, sortBy, minGap, minVol, maxDays, statusFilter]);

  useEffect(() => {
    if (onVisibleTickers) onVisibleTickers(filtered.map(ep => ep.ticker));
  }, [filtered, onVisibleTickers]);

  const STATUS_STYLE = {
    consolidating: { bg: "#fbbf2418", border: "#fbbf2450", color: "#fbbf24", label: "★ CONSOLIDATING" },
    basing:        { bg: "#60a5fa10", border: "#60a5fa30", color: "#60a5fa", label: "BASING" },
    fresh:         { bg: "#4ade8010", border: "#4ade8030", color: "#4ade80", label: "FRESH" },
    holding:       { bg: "#88888810", border: "#88888830", color: "#888",    label: "HOLDING" },
    failed:        { bg: "#ef444410", border: "#ef444430", color: "#f87171", label: "FAILED" },
    extended_pullback: { bg: "#f9731610", border: "#f9731630", color: "#f97316", label: "DEEP PB" },
  };

  const columns = [
    ["Ticker", "ticker"], ["Grade", "grade"], ["Date", "date"], ["Days", "days"], ["Gap%", "gap"],
    ["Chg%", "change"], ["VolX", "vol"], ["ClRng", "clrng"], ["Status", "status"],
    ["PB%", "pb"], ["VolCon", "volcon"], ["RS", "rs"], ["Theme", "theme"],
  ];

  if (!epSignals || !epSignals.length) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div style={{ color: "#fbbf24", fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Episodic Pivots</div>
        <div style={{ color: "#666", fontSize: 12, marginBottom: 20 }}>No EP data yet. Run the scanner to populate:</div>
        <code style={{ color: "#10b981", fontSize: 11, background: "#111", padding: "8px 16px", borderRadius: 6 }}>
          python3 -u scripts/09d_episodic_pivots.py
        </code>
      </div>
    );
  }

  const consolCount = epSignals.filter(ep => ep.consol?.status === "consolidating").length;

  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 12, padding: "6px 12px", marginBottom: 6, background: "#111", borderRadius: 4, fontSize: 9, color: "#666", flexWrap: "wrap", alignItems: "center", lineHeight: 1.8 }}>
        <span style={{ color: "#fbbf24", fontWeight: 700 }}>EPISODIC PIVOT</span>
        <span>Gap ≥8% on open, Volume ≥3x 50d avg, Close in upper 40% of range</span>
        <span style={{ color: "#333" }}>|</span>
        <span style={{ color: "#fbbf24", fontWeight: 700 }}>★ CONSOLIDATING</span>
        <span>= Delayed entry (Bonde): 3+ days after EP, pullback ≤10%, volume contracting ≤70% of EP day, gap held</span>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: 12 }}>{filtered.length} EPs</span>
        {consolCount > 0 && <span style={{ color: "#fbbf24", fontSize: 10, background: "#fbbf2418", border: "1px solid #fbbf2440", padding: "1px 8px", borderRadius: 10 }}>★ {consolCount} consolidating</span>}
        <span style={{ color: "#555", fontSize: 10 }}>Gap≥</span>
        <input type="range" min={5} max={25} value={minGap} onChange={e => setMinGap(+e.target.value)}
          style={{ width: 50, accentColor: "#fbbf24" }} />
        <span style={{ fontSize: 10, color: "#fbbf24", fontFamily: "monospace" }}>{minGap}%</span>
        <span style={{ color: "#555", fontSize: 10 }}>Vol≥</span>
        <input type="range" min={2} max={10} step={0.5} value={minVol} onChange={e => setMinVol(+e.target.value)}
          style={{ width: 50, accentColor: "#fbbf24" }} />
        <span style={{ fontSize: 10, color: "#fbbf24", fontFamily: "monospace" }}>{minVol}x</span>
        <span style={{ color: "#333" }}>|</span>
        {[5, 10, 20, 30, 60].map(d => (
          <button key={d} onClick={() => setMaxDays(d)} style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, cursor: "pointer",
            border: maxDays === d ? "1px solid #fbbf24" : "1px solid #333",
            background: maxDays === d ? "#fbbf2420" : "transparent", color: maxDays === d ? "#fbbf24" : "#666" }}>{d}d</button>
        ))}
        <span style={{ color: "#333" }}>|</span>
        {[["all", null],["★ Consol", "consolidating"],["Fresh", "fresh"],["Basing", "basing"],["Failed", "failed"]].map(([label, val]) => (
          <button key={label} onClick={() => setStatusFilter(val)} style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, cursor: "pointer",
            border: statusFilter === val ? "1px solid #fbbf24" : "1px solid #333",
            background: statusFilter === val ? "#fbbf2420" : "transparent",
            color: statusFilter === val ? "#fbbf24" : val === "consolidating" ? "#fbbf24" : "#666" }}>{label}</button>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead><tr style={{ borderBottom: "2px solid #333" }}>
          {columns.map(([h, sk]) => (
            <th key={h} onClick={sk ? () => setSortBy(sk) : undefined}
              style={{ padding: "5px 6px", color: sortBy === sk ? "#fbbf24" : "#666", fontWeight: 700, textAlign: "center", fontSize: 9,
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
              style={{ borderBottom: `1px solid ${isConsol ? "#fbbf2425" : "#1a1a1a"}`, cursor: "pointer",
                background: isActive ? "#fbbf2415" : isConsol ? "#fbbf2408" : "transparent" }}>
              <td style={{ padding: "4px 6px", textAlign: "center" }}>
                <span style={{ color: isActive ? "#fbbf24" : "#fff", fontWeight: 700 }}>{isConsol && "★ "}{ep.ticker}</span>
              </td>
              <td style={{ padding: "4px 6px", textAlign: "center" }}>{s ? <Badge grade={s.grade} /> : "—"}</td>
              <td style={{ padding: "4px 6px", textAlign: "center", color: ep.days_ago <= 5 ? "#fbbf24" : "#888", fontSize: 10 }}>{ep.date}</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: ep.days_ago === 0 ? "#fbbf24" : ep.days_ago <= 5 ? "#fcd34d" : "#666" }}>
                {ep.days_ago === 0 ? "TODAY" : `${ep.days_ago}d`}</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontWeight: 700,
                color: ep.gap_pct >= 15 ? "#fbbf24" : "#4ade80" }}>+{ep.gap_pct}%</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: ep.change_pct > 0 ? "#4ade80" : "#f87171" }}>{ep.change_pct > 0 ? "+" : ""}{ep.change_pct}%</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontWeight: 700,
                color: ep.vol_ratio >= 8 ? "#fbbf24" : ep.vol_ratio >= 5 ? "#4ade80" : "#60a5fa" }}>{ep.vol_ratio}x</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: ep.close_range >= 80 ? "#4ade80" : "#888" }}>{ep.close_range}%</td>
              <td style={{ padding: "4px 6px", textAlign: "center" }}>
                <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 8, fontWeight: 700,
                  background: st.bg, border: `1px solid ${st.border}`, color: st.color }}>{st.label}</span>
              </td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: c.pullback_pct >= -3 ? "#4ade80" : c.pullback_pct >= -7 ? "#888" : "#f87171" }}>
                {c.pullback_pct != null ? `${c.pullback_pct}%` : "—"}</td>
              <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace",
                color: c.vol_contraction <= 0.5 ? "#4ade80" : c.vol_contraction <= 0.7 ? "#60a5fa" : "#888" }}>
                {c.vol_contraction ? `${c.vol_contraction}x` : "—"}</td>
              <td style={{ padding: "4px 6px", textAlign: "center", color: "#ccc", fontFamily: "monospace" }}>{s?.rs_rank || "—"}</td>
              <td style={{ padding: "4px 6px", color: "#555", fontSize: 9 }}>{s?.themes?.[0]?.theme || "—"}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {filtered.length === 0 && (
        <div style={{ textAlign: "center", color: "#555", padding: 20, fontSize: 12 }}>
          No EPs match current filters. Try lowering the gap% or volume threshold.
        </div>
      )}
    </div>
  );
}

// ── INDEX CHART (SPY/QQQ/IWM/DIA with MA status) ──
function IndexChart({ symbol, name, maData }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.id = `tv_index_${symbol}`;
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
          symbol: symbol,
          interval: "D",
          timezone: "America/New_York",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#0a0a0a",
          enable_publishing: false,
          allow_symbol_change: false,
          save_image: false,
          hide_top_toolbar: true,
          hide_legend: true,
          backgroundColor: "rgba(10, 10, 10, 1)",
          gridColor: "rgba(20, 20, 20, 1)",
          container_id: `tv_index_${symbol}`,
          studies: [
            { id: "MAExp@tv-basicstudies", inputs: { length: 10 } },
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
  }, [symbol]);

  const MaBadge = ({ label, above }) => (
    <span style={{
      padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, fontFamily: "monospace",
      background: above ? "#22c55e25" : "#ef444425",
      color: above ? "#4ade80" : "#f87171",
      border: `1px solid ${above ? "#22c55e40" : "#ef444440"}`,
    }}>{label}</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", borderBottom: "1px solid #222", borderRight: "1px solid #222", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: "#111", flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: "#fff" }}>{symbol}</span>
        <span style={{ fontSize: 9, color: "#666" }}>{name}</span>
        {maData && <>
          <span style={{ fontSize: 10, color: "#ccc", fontFamily: "monospace", marginLeft: "auto" }}>${maData.price}</span>
          <MaBadge label="10E" above={maData.above_ema10} />
          <MaBadge label="21E" above={maData.above_ema21} />
          <MaBadge label="50S" above={maData.above_sma50} />
          <MaBadge label="200S" above={maData.above_sma200} />
        </>}
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}

function Grid({ stocks, onTickerClick, activeTicker, onVisibleTickers }) {
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
      <div style={{ display: "flex", gap: 20, marginBottom: 10, padding: "8px 12px", background: "#111", borderRadius: 6, fontSize: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "#888", fontWeight: 700 }}>COLUMN GRADE (RTS Score):</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#1B7A2B" }} /> <span style={{ color: "#aaa" }}>A+ to A- — Strongest momentum</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#5CB85C" }} /> <span style={{ color: "#aaa" }}>B+ to B- — Above average</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#CCF2CC" }} /> <span style={{ color: "#aaa" }}>C — Neutral</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#e5e5e5" }} /> <span style={{ color: "#aaa" }}>D — Below average</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#FF5050" }} /> <span style={{ color: "#aaa" }}>E to G — Weakest momentum</span>
        </span>
        <span style={{ color: "#333" }}>|</span>
        <span style={{ color: "#888", fontWeight: 700 }}>TICKER TEXT:</span>
        <span style={{ color: "#f87171", fontWeight: 700, fontFamily: "monospace" }}>Red</span><span style={{ color: "#aaa" }}> = ATR/50 ≥ 7x (extremely extended)</span>
        <span style={{ color: "#c084fc", fontWeight: 700, fontFamily: "monospace" }}>Purple</span><span style={{ color: "#aaa" }}> = ATR/50 ≥ 5x (extended)</span>
        <span style={{ color: "#bbb", fontFamily: "monospace" }}>Default</span><span style={{ color: "#aaa" }}> = Not extended</span>
      </div>
      <div style={{ display: "flex", gap: 2, minWidth: 1300 }}>
        {grades.map(g => {
          const light = ["C+","C","C-","D+","D","D-"].includes(g);
          return (
            <div key={g} style={{ width: 64, flexShrink: 0 }}>
              <div style={{ background: GRADE_COLORS[g], color: light ? "#222" : "#fff", textAlign: "center", padding: "4px 0", borderRadius: "4px 4px 0 0", fontSize: 11, fontWeight: 700 }}>
                {g}<br/><span style={{ fontWeight: 400, opacity: 0.7, fontSize: 10 }}>{groups[g].length}</span></div>
              <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
                {groups[g].slice(0, 60).map(s => (
                  <div key={s.ticker} title={`${s.company} | RS:${s.rs_rank} | 3M:${s.return_3m}%`}
                    onClick={() => onTickerClick(s.ticker)}
                    style={{ textAlign: "center", fontSize: 10, padding: "2px 0", fontFamily: "monospace",
                      background: s.ticker === activeTicker ? "#10b98130" : GRADE_COLORS[g] + "25",
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
  ["", null], ["Ticker", "ticker"], ["Grade", null], ["RS", "rs"], ["Chg%", "change"], ["RVol", "rel_volume"],
  ["ZVR", "zvr"], ["1M%", null], ["3M%", "ret3m"], ["FrHi%", "fromhi"], ["VCS", "vcs"], ["ADR%", "adr"],
  ["ROE", "roe"], ["Mgn%", "margin"],
];

function LiveSortHeader({ setter, current }) {
  return (
    <thead><tr style={{ borderBottom: "2px solid #333" }}>
      {LIVE_COLUMNS.map(([h, sk]) => (
        <th key={h || "act"} onClick={sk ? () => setter(prev => prev === sk ? "change" : sk) : undefined}
          style={{ padding: "6px 6px", color: current === sk ? "#6ee7b7" : "#666", fontWeight: 700, textAlign: "center", fontSize: 10,
            cursor: sk ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>
          {h}{current === sk ? " ▼" : ""}</th>
      ))}
    </tr></thead>
  );
}

function LiveRow({ s, onRemove, onAdd, addLabel, activeTicker, onTickerClick }) {
  const isActive = s.ticker === activeTicker;
  const near = s.pct_from_high != null && s.pct_from_high >= -5;
  const chg = (v) => !v && v !== 0 ? "#555" : v > 0 ? "#4ade80" : v < 0 ? "#f87171" : "#888";
  return (
    <tr onClick={() => onTickerClick(s.ticker)} style={{ borderBottom: "1px solid #1a1a1a", cursor: "pointer",
      background: isActive ? "#10b98115" : "transparent" }}>
      <td style={{ padding: "4px 4px", textAlign: "center", whiteSpace: "nowrap" }}>
        {onRemove && <span onClick={(e) => { e.stopPropagation(); onRemove(s.ticker); }}
          style={{ color: "#555", cursor: "pointer", fontSize: 10, marginRight: 2 }}>✕</span>}
        {onAdd && <span onClick={(e) => { e.stopPropagation(); onAdd(s.ticker); }}
          style={{ color: "#10b981", cursor: "pointer", fontSize: 10 }}>{addLabel || "+watch"}</span>}
      </td>
      <td style={{ padding: "4px 6px", textAlign: "center", color: isActive ? "#10b981" : "#fff", fontWeight: 700, fontSize: 11 }}>{s.ticker}</td>
      <td style={{ padding: "4px 6px", textAlign: "center" }}>{s.grade ? <Badge grade={s.grade} /> : <span style={{ color: "#333" }}>—</span>}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", color: "#ccc", fontFamily: "monospace", fontSize: 11 }}>{s.rs_rank ?? '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", color: chg(s.change), fontWeight: 700, fontFamily: "monospace", fontSize: 11 }}>
        {s.change != null ? `${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%` : '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11,
        color: s.rel_volume >= 2 ? "#c084fc" : s.rel_volume >= 1.5 ? "#a78bfa" : "#555" }}>
        {s.rel_volume != null ? `${s.rel_volume.toFixed(1)}x` : '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11, fontWeight: 700,
        color: s.zvr >= 200 ? "#f43f5e" : s.zvr >= 150 ? "#c084fc" : s.zvr >= 120 ? "#60a5fa" : s.zvr != null ? "#555" : "#333" }}
        title={s.zvr != null ? `Projected EOD volume: ${s.zvr}% of avg` : ''}>
        {s.zvr != null ? `${s.zvr}%` : '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center" }}><Ret v={s.return_1m} /></td>
      <td style={{ padding: "4px 6px", textAlign: "center" }}><Ret v={s.return_3m} bold /></td>
      <td style={{ padding: "4px 6px", textAlign: "center", color: near ? "#4ade80" : "#888", fontWeight: near ? 700 : 400, fontFamily: "monospace", fontSize: 11 }}>
        {s.pct_from_high != null ? `${s.pct_from_high.toFixed != null ? s.pct_from_high.toFixed(0) : s.pct_from_high}%` : '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11,
        color: s.vcs >= 80 ? "#4ade80" : s.vcs >= 60 ? "#60a5fa" : s.vcs != null ? "#888" : "#333",
        fontWeight: s.vcs >= 60 ? 700 : 400 }}
        title={s.vcs_detail ? `ATR:${s.vcs_detail.atr ?? '-'} Vol:${s.vcs_detail.vol ?? '-'} Cons:${s.vcs_detail.cons ?? '-'} Struc:${s.vcs_detail.struc ?? '-'}` : ''}>
        {s.vcs != null ? s.vcs : '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11,
        color: s.adr_pct > 8 ? "#2dd4bf" : s.adr_pct > 5 ? "#4ade80" : s.adr_pct > 3 ? "#fbbf24" : s.adr_pct != null ? "#f97316" : "#333" }}>
        {s.adr_pct != null ? `${s.adr_pct}%` : '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11,
        color: s.roe != null ? (s.roe > 20 ? "#4ade80" : s.roe > 10 ? "#888" : s.roe > 0 ? "#f97316" : "#f87171") : "#333" }}>
        {s.roe != null ? `${s.roe}%` : '—'}</td>
      <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11,
        color: s.profit_margin != null ? (s.profit_margin > 15 ? "#4ade80" : s.profit_margin > 5 ? "#888" : s.profit_margin > 0 ? "#f97316" : "#f87171") : "#333" }}>
        {s.profit_margin != null ? `${s.profit_margin}%` : '—'}</td>
    </tr>
  );
}

function LiveSectionTable({ data, sortKey, setter, onRemove, onAdd, addLabel, activeTicker, onTickerClick }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
      <LiveSortHeader setter={setter} current={sortKey} />
      <tbody>
        {data.map(s => <LiveRow key={s.ticker} s={s} onRemove={onRemove} onAdd={onAdd} addLabel={addLabel}
          activeTicker={activeTicker} onTickerClick={onTickerClick} />)}
      </tbody>
    </table>
  );
}

function TickerInput({ value, setValue, onAdd, placeholder }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input value={value} onChange={e => setValue(e.target.value.toUpperCase())}
        onKeyDown={e => e.key === "Enter" && onAdd()}
        placeholder={placeholder || "Add ticker..."}
        style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 4, padding: "3px 8px",
          fontSize: 11, color: "#fff", width: 80, outline: "none", fontFamily: "monospace" }} />
      <button onClick={onAdd} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
        background: "#10b98120", border: "1px solid #10b98140", color: "#10b981" }}>+</button>
    </span>
  );
}

function LiveView({ stockMap, onTickerClick, activeTicker, onVisibleTickers, portfolio, setPortfolio, watchlist, setWatchlist, addToWatchlist, removeFromWatchlist, addToPortfolio, removeFromPortfolio }) {
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [addTickerP, setAddTickerP] = useState("");
  const [addTickerW, setAddTickerW] = useState("");
  const [pSort, setPSort] = useState("change");
  const [wlSort, setWlSort] = useState("change");
  const [vgSort, setVgSort] = useState("change");

  // Combine all tickers for API call
  const allTickers = useMemo(() => [...new Set([...portfolio, ...watchlist])], [portfolio, watchlist]);

  const fetchLive = useCallback(async () => {
    try {
      const tickerParam = allTickers.length > 0 ? `?tickers=${allTickers.join(",")}` : "";
      const resp = await fetch(`/api/live${tickerParam}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || "API error");
      setLiveData(json);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [allTickers]);

  useEffect(() => { fetchLive(); const iv = setInterval(fetchLive, 60000); return () => clearInterval(iv); }, [fetchLive]);

  useEffect(() => {
    if (!liveData || !onVisibleTickers) return;
    const tickers = [
      ...(liveData.watchlist || []).map(s => s.ticker),
      ...(liveData.top_gainers || []).slice(0, 30).map(s => s.ticker),
    ];
    onVisibleTickers(tickers);
  }, [liveData, onVisibleTickers]);

  // Build merged lookup: live data + pipeline stockMap
  const liveLookup = useMemo(() => {
    const m = {};
    (liveData?.watchlist || []).forEach(s => { m[s.ticker] = s; });
    return m;
  }, [liveData?.watchlist]);

  // Merge live + pipeline data for a ticker
  const mergeStock = useCallback((ticker) => {
    const live = liveLookup[ticker] || {};
    const pipe = stockMap?.[ticker] || {};
    return {
      ticker,
      price: live.price ?? pipe.price,
      change: live.change,
      rel_volume: live.rel_volume ?? pipe.rel_volume,
      zvr: live.zvr ?? null,
      grade: pipe.grade,
      rs_rank: pipe.rs_rank,
      return_1m: live.perf_month ?? pipe.return_1m,
      return_3m: live.perf_quart ?? pipe.return_3m,
      pct_from_high: live.high_52w ?? pipe.pct_from_high,
      atr_to_50: pipe.atr_to_50,
      vcs: pipe.vcs,
      vcs_detail: pipe.vcs_detail,
      adr_pct: pipe.adr_pct,
      eps_past_5y: pipe.eps_past_5y,
      sales_past_5y: pipe.sales_past_5y,
      pe: live.pe ?? pipe.pe,
      roe: pipe.roe,
      profit_margin: pipe.profit_margin,
      rsi: live.rsi ?? pipe.rsi,
      theme: pipe.themes?.[0]?.theme || live.sector || "",
      company: live.company || pipe.company || "",
    };
  }, [liveLookup, stockMap]);

  // Merge for volume gainers (no pipeline data typically)
  const mergeGainer = useCallback((g) => {
    const pipe = stockMap?.[g.ticker] || {};
    return {
      ticker: g.ticker,
      price: g.price,
      change: g.change,
      rel_volume: g.rel_volume,
      zvr: g.zvr ?? null,
      grade: pipe.grade,
      rs_rank: pipe.rs_rank,
      return_1m: g.perf_month ?? pipe.return_1m,
      return_3m: g.perf_quart ?? pipe.return_3m,
      pct_from_high: g.high_52w ?? pipe.pct_from_high,
      atr_to_50: pipe.atr_to_50,
      vcs: pipe.vcs,
      vcs_detail: pipe.vcs_detail,
      adr_pct: pipe.adr_pct,
      eps_past_5y: pipe.eps_past_5y,
      sales_past_5y: pipe.sales_past_5y,
      pe: pipe.pe,
      roe: pipe.roe,
      profit_margin: pipe.profit_margin,
      rsi: g.rsi ?? pipe.rsi,
      theme: pipe.themes?.[0]?.theme || g.sector || "",
      company: g.company || pipe.company || "",
    };
  }, [stockMap]);

  const handleAddP = () => { const t = addTickerP.trim().toUpperCase(); if (t) addToPortfolio(t); setAddTickerP(""); };
  const handleAddW = () => { const t = addTickerW.trim().toUpperCase(); if (t) addToWatchlist(t); setAddTickerW(""); };

  const sortFn = (key, desc = true) => (a, b) => {
    const av = a[key] ?? (desc ? -Infinity : Infinity);
    const bv = b[key] ?? (desc ? -Infinity : Infinity);
    return desc ? bv - av : av - bv;
  };

  const makeSorters = () => ({
    ticker: (a, b) => a.ticker.localeCompare(b.ticker),
    change: sortFn("change"), rs: sortFn("rs_rank"), ret3m: sortFn("return_3m"),
    fromhi: (a, b) => (b.pct_from_high ?? -999) - (a.pct_from_high ?? -999),
    atr50: sortFn("atr_to_50"), vcs: sortFn("vcs"), adr: sortFn("adr_pct"),
    eps: sortFn("eps_past_5y"), rev: sortFn("sales_past_5y"),
    pe: (a, b) => (a.pe ?? 9999) - (b.pe ?? 9999),
    roe: sortFn("roe"), margin: sortFn("profit_margin"),
    rel_volume: sortFn("rel_volume"), zvr: sortFn("zvr"), rsi: sortFn("rsi"), price: sortFn("price"),
  });

  const sortList = (list, sortKey) => {
    const sorters = makeSorters();
    const sorted = [...list];
    if (sorters[sortKey]) sorted.sort(sorters[sortKey]);
    return sorted;
  };

  const portfolioMerged = useMemo(() => sortList(portfolio.map(mergeStock), pSort), [portfolio, mergeStock, pSort, liveLookup]);
  const watchlistMerged = useMemo(() => sortList(watchlist.map(mergeStock), wlSort), [watchlist, mergeStock, wlSort, liveLookup]);
  const gainersMerged = useMemo(() => sortList((liveData?.top_gainers || []).map(mergeGainer), vgSort), [liveData?.top_gainers, mergeGainer, vgSort]);

  return (
    <div>
      {/* Status bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: loading ? "#fbbf24" : "#4ade80" }}>●</span>
          <span style={{ fontSize: 11, color: "#888" }}>
            {loading ? "Loading..." : lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : ""}
          </span>
          <span style={{ fontSize: 10, color: "#555" }}>Auto-refresh 60s</span>
          <button onClick={fetchLive} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
            background: "#1a1a1a", border: "1px solid #333", color: "#888" }}>↻ Refresh</button>
        </div>
        {error && <span style={{ fontSize: 10, color: "#f87171" }}>Error: {error}</span>}
      </div>

      {/* ── 1. Portfolio ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "#fbbf24", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            Portfolio ({portfolio.length})
          </span>
          <TickerInput value={addTickerP} setValue={setAddTickerP} onAdd={handleAddP} />
        </div>
        {portfolio.length === 0 ? (
          <div style={{ color: "#555", fontSize: 11, padding: 10, background: "#0d0d0d", borderRadius: 6, border: "1px solid #1a1a1a" }}>
            Add your holdings above to track live.
          </div>
        ) : (
          <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={portfolioMerged} sortKey={pSort} setter={setPSort} onRemove={removeFromPortfolio} />
        )}
      </div>

      {/* ── 2. Watchlist ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "#10b981", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            Watchlist ({watchlist.length})
          </span>
          <TickerInput value={addTickerW} setValue={setAddTickerW} onAdd={handleAddW} />
        </div>
        {watchlist.length === 0 ? (
          <div style={{ color: "#555", fontSize: 11, padding: 10, background: "#0d0d0d", borderRadius: 6, border: "1px solid #1a1a1a" }}>
            Add tickers above or click <span style={{ color: "#10b981" }}>+watch</span> on volume gainers below.
          </div>
        ) : (
          <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={watchlistMerged} sortKey={wlSort} setter={setWlSort} onRemove={removeFromWatchlist} />
        )}
      </div>

      {/* ── 3. Top Gainers ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "#c084fc", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            Top Gainers
          </span>
          <span style={{ fontSize: 10, color: "#555" }}>{gainersMerged.length} stocks | Mid cap+</span>
        </div>
        {gainersMerged.length > 0 ? (
          <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={gainersMerged} sortKey={vgSort} setter={setVgSort}
            onAdd={(t) => { addToWatchlist(t); }} addLabel="+watch" />
        ) : (
          <div style={{ color: "#555", fontSize: 11, padding: 10 }}>
            {loading ? "Loading top gainers..." : "No top gainers right now (market may be closed)."}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("leaders");
  const [filters, setFilters] = useState({ minRTS: 0, quad: null, search: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chartTicker, setChartTicker] = useState(null);
  const [mmData, setMmData] = useState(null);

  useEffect(() => {
    fetch("/dashboard_data.json").then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(p => { if (!p.stocks || !p.themes) throw new Error(); setData(p); setLoading(false); })
      .catch(() => setLoading(false));
    // Also load market monitor data (optional, won't block)
    fetch("/market_monitor.json").then(r => r.ok ? r.json() : null).then(d => { if (d) setMmData(d); }).catch(() => {});
  }, []);

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
  const openChart = useCallback((t) => setChartTicker(t), []);
  const closeChart = useCallback(() => setChartTicker(null), []);

  // Watchlist + Portfolio state (hoisted for access from ChartPanel)
  const [portfolio, setPortfolio] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_portfolio") || "[]"); } catch { return []; }
  });
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_watchlist") || "[]"); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem("tp_portfolio", JSON.stringify(portfolio)); }, [portfolio]);
  useEffect(() => { localStorage.setItem("tp_watchlist", JSON.stringify(watchlist)); }, [watchlist]);
  const addToWatchlist = useCallback((t) => { const u = t.toUpperCase(); if (!watchlist.includes(u)) setWatchlist(p => [...p, u]); }, [watchlist]);
  const removeFromWatchlist = useCallback((t) => setWatchlist(p => p.filter(x => x !== t)), []);
  const addToPortfolio = useCallback((t) => { const u = t.toUpperCase(); if (!portfolio.includes(u)) setPortfolio(p => [...p, u]); }, [portfolio]);
  const removeFromPortfolio = useCallback((t) => setPortfolio(p => p.filter(x => x !== t)), []);

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
      if (e.target.tagName === "INPUT") return; // don't hijack search box
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
      <div style={{ minHeight: "100vh", background: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 40, fontWeight: 900, color: "#fff", letterSpacing: -2, marginBottom: 4 }}>THEME<span style={{ color: "#10b981" }}>PULSE</span></div>
          <div style={{ color: "#666", marginBottom: 32, fontSize: 14 }}>Leading Stocks in Leading Themes</div>
          {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 16, padding: 12, background: "#450a0a", borderRadius: 8 }}>{error}</div>}
          <div style={{ border: "2px dashed #333", borderRadius: 12, padding: 40 }}>
            {loading ? <div style={{ color: "#888" }}>Loading...</div> : (<>
              <div style={{ color: "#666", marginBottom: 16, fontSize: 13 }}>Load <code style={{ color: "#10b981" }}>dashboard_data.json</code></div>
              <label style={{ display: "inline-block", padding: "12px 32px", background: "#10b981", color: "#000", fontWeight: 700, borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
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
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#ccc", fontFamily: "system-ui, -apple-system, sans-serif", display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #222", background: "#111", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: "#fff", letterSpacing: -1 }}>THEME<span style={{ color: "#10b981" }}>PULSE</span></span>
          <span style={{ color: "#555", fontSize: 11 }}>{data.date}</span>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
          <span style={{ color: "#666" }}>Stocks: <b style={{ color: "#fff" }}>{data.total_stocks}</b></span>
          <span style={{ color: "#666" }}>Strong: <b style={{ color: "#4ade80" }}>{strongC}</b></span>
          <span style={{ color: "#666" }}>A Grades: <b style={{ color: "#4ade80" }}>{aCount}</b></span>
          <span style={{ color: "#666" }}>Breadth: <b style={{ color: breadth >= 60 ? "#4ade80" : breadth >= 40 ? "#fbbf24" : "#f87171" }}>{breadth}%</b></span>
        </div>
      </div>

      {/* Nav + filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
        {[["leaders","Theme Leaders"],["rotation","Rotation"],["scan","Scan Watch"],["ep","EP Scan"],["grid","RTS Grid"],["mm","Mkt Monitor"],["live","Live"]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
            border: view === id ? "1px solid #10b98150" : "1px solid transparent",
            background: view === id ? "#10b98115" : "transparent", color: view === id ? "#6ee7b7" : "#666" }}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Search..." value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
          style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#fff", width: 120, outline: "none" }} />
        <div style={{ display: "flex", gap: 4 }}>
          {[null,"STRONG","IMPROVING","WEAKENING","WEAK"].map(q => (
            <button key={q||"all"} onClick={() => setFilters(p => ({ ...p, quad: q }))}
              style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                border: filters.quad === q ? "1px solid #10b981" : "1px solid #333",
                background: filters.quad === q ? "#10b98120" : "transparent", color: filters.quad === q ? "#6ee7b7" : "#666" }}>{q||"All"}</button>
          ))}
        </div>
        <span style={{ fontSize: 10, color: "#666" }}>RTS≥</span>
        <input type="range" min={0} max={80} value={filters.minRTS} onChange={e => setFilters(p => ({ ...p, minRTS: +e.target.value }))}
          style={{ width: 80, accentColor: "#10b981" }} />
        <span style={{ fontSize: 10, color: "#888", fontFamily: "monospace" }}>{filters.minRTS}</span>
      </div>

      {/* Main content: split layout when chart is open */}
      <div ref={containerRef} style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
        {/* Left: data views */}
        <div style={{ width: (chartOpen && view !== "mm") ? `${splitPct}%` : view === "mm" ? `${splitPct}%` : "100%", overflowY: "auto", padding: 16, transition: "none" }}>
          {view === "leaders" && <Leaders themes={data.themes} stockMap={stockMap} filters={filters} onTickerClick={openChart} activeTicker={chartTicker} mmData={mmData} onVisibleTickers={onVisibleTickers} themeHealth={data.theme_health} />}
          {view === "rotation" && <Rotation themes={data.themes} />}
          {view === "scan" && <Scan stocks={data.stocks} themes={data.themes} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers} />}
          {view === "grid" && <Grid stocks={data.stocks} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers} />}
          {view === "ep" && <EpisodicPivots epSignals={data.ep_signals} stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers} />}
          {view === "mm" && <MarketMonitor mmData={mmData} />}
          {view === "live" && <LiveView stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers}
            portfolio={portfolio} setPortfolio={setPortfolio} watchlist={watchlist} setWatchlist={setWatchlist}
            addToWatchlist={addToWatchlist} removeFromWatchlist={removeFromWatchlist}
            addToPortfolio={addToPortfolio} removeFromPortfolio={removeFromPortfolio} />}
        </div>

        {/* Draggable divider */}
        {((chartOpen && view !== "mm") || view === "mm") && (
          <div
            onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
            style={{ width: 9, flexShrink: 0, cursor: "col-resize", position: "relative", zIndex: 10,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 1, height: "100%", background: isDragging ? "#10b981" : "#333", transition: "background 0.15s" }} />
          </div>
        )}

        {/* Right: chart panel (individual ticker) — NOT on MM tab */}
        {chartOpen && view !== "mm" && (
          <div style={{ width: `${100 - splitPct}%`, height: "100%", transition: "none" }}>
            <ChartPanel ticker={chartTicker} stock={stockMap[chartTicker]} onClose={closeChart}
              watchlist={watchlist} onAddWatchlist={addToWatchlist} onRemoveWatchlist={removeFromWatchlist}
              portfolio={portfolio} onAddPortfolio={addToPortfolio} onRemovePortfolio={removeFromPortfolio} />
          </div>
        )}

        {/* Right: Index charts grid — MM tab only */}
        {view === "mm" && (
          <div style={{ width: `${100 - splitPct}%`, height: "100%", borderLeft: "1px solid #222", background: "#0a0a0a", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 0, transition: "none" }}>
            {[
              { symbol: "SPY", name: "S&P 500" },
              { symbol: "QQQ", name: "NASDAQ 100" },
              { symbol: "IWM", name: "Russell 2000" },
              { symbol: "DIA", name: "Dow Jones" },
            ].map(idx => (
              <IndexChart key={idx.symbol} symbol={idx.symbol} name={idx.name} maData={mmData?.indices?.[idx.symbol]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
