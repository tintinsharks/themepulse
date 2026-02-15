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

// ── PERSISTENT CHART PANEL (right side) ──
const TV_LAYOUT = "nS7up88o";

function ChartPanel({ ticker, stock, onClose }) {
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

      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}

// ── CLICKABLE TICKER ──
function Ticker({ children, ticker, style, onClick, activeTicker, ...props }) {
  const isActive = ticker === activeTicker;
  return (
    <span {...props}
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
function Leaders({ themes, stockMap, filters, onTickerClick, activeTicker }) {
  const [open, setOpen] = useState({});
  const [sort, setSort] = useState("rts");
  const list = useMemo(() => {
    let t = [...themes];
    if (filters.minRTS > 0) t = t.filter(x => x.rts >= filters.minRTS);
    if (filters.quad) t = t.filter(x => getQuad(x.weekly_rs, x.monthly_rs) === filters.quad);
    if (filters.search) {
      const q = filters.search.toUpperCase();
      t = t.filter(x => x.theme.toUpperCase().includes(q) || x.subthemes.some(s => s.tickers.some(tk => tk.includes(q))));
    }
    t.sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
    return t;
  }, [themes, filters, sort]);
  const toggle = (name) => setOpen(p => ({ ...p, [name]: !p[name] }));

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["rts","RTS"],["return_1m","1M"],["return_3m","3M"],["breadth","Brdth"],["a_grades","A's"]].map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)} style={{ padding: "4px 10px", borderRadius: 4,
            border: sort === k ? "1px solid #10b981" : "1px solid #333",
            background: sort === k ? "#10b98120" : "transparent", color: sort === k ? "#6ee7b7" : "#888", fontSize: 11, cursor: "pointer" }}>{l}</button>
        ))}
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
            </div>
            {isOpen && (
              <div style={{ background: "#0a0a0a", padding: "4px 8px" }}>
                {theme.subthemes.map(sub => (
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

function Scan({ stocks, themes, onTickerClick, activeTicker }) {
  const leading = useMemo(() => new Set(themes.filter(t => t.rts >= 50).map(t => t.theme)), [themes]);
  const candidates = useMemo(() => {
    return stocks.filter(s => {
      const good = ["A+","A","A-","B+"].includes(s.grade);
      const inLead = s.themes.some(t => leading.has(t.theme));
      return good && inLead && s.atr_to_50 > 0 && s.atr_to_50 < 7 && s.above_50ma && s.return_3m >= 21;
    }).sort((a, b) => ((b.pct_from_high >= -5 ? 1000 : 0) + b.rs_rank) - ((a.pct_from_high >= -5 ? 1000 : 0) + a.rs_rank));
  }, [stocks, leading]);

  return (
    <div>
      <div style={{ color: "#888", fontSize: 11, marginBottom: 8 }}>
        A/B+ | Leading theme | 21%+ 3M | Above 50MA | Not 7x+ — <span style={{ color: "#4ade80", fontWeight: 700 }}>{candidates.length} candidates</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead><tr style={{ borderBottom: "2px solid #333" }}>
          {["Action","Ticker","Grade","RS","1M%","3M%","FrHi%","ATR/50","Theme"].map(h => (
            <th key={h} style={{ padding: "6px 8px", color: "#666", fontWeight: 700, textAlign: "center", fontSize: 10 }}>{h}</th>
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
            <tr key={s.ticker} onClick={() => onTickerClick(s.ticker)}
              style={{ borderBottom: "1px solid #1a1a1a", cursor: "pointer",
                background: isActive ? "#10b98115" : "transparent" }}>
              <td style={{ padding: "4px 8px", textAlign: "center" }}><span style={{ background: ac, color: "#fff", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700 }}>{action}</span></td>
              <td style={{ padding: "4px 8px", textAlign: "center", color: isActive ? "#10b981" : "#fff", fontWeight: 700 }}>{s.ticker}</td>
              <td style={{ padding: "4px 8px", textAlign: "center" }}><Badge grade={s.grade} /></td>
              <td style={{ padding: "4px 8px", textAlign: "center", color: "#ccc", fontFamily: "monospace" }}>{s.rs_rank}</td>
              <td style={{ padding: "4px 8px", textAlign: "center" }}><Ret v={s.return_1m} /></td>
              <td style={{ padding: "4px 8px", textAlign: "center" }}><Ret v={s.return_3m} bold /></td>
              <td style={{ padding: "4px 8px", textAlign: "center", color: near ? "#4ade80" : "#888", fontWeight: near ? 700 : 400, fontFamily: "monospace" }}>{s.pct_from_high}%</td>
              <td style={{ padding: "4px 8px", textAlign: "center", color: "#888", fontFamily: "monospace" }}>{s.atr_to_50}</td>
              <td style={{ padding: "4px 8px", color: "#666", fontSize: 10 }}>{theme?.theme}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

// ── GAUGE DIAL COMPONENT ──
function Gauge({ value, min, max, label, zones, description, unit = "" }) {
  const w = 130, h = 80;
  const cx = w / 2, cy = h - 8;
  const r = 52;
  // 180-degree arc: left to right (π to 0)
  const startAngle = Math.PI; // left (180°)
  const endAngle = 0; // right (0°)
  
  const clampedVal = Math.max(min, Math.min(max, value));
  const pct = max > min ? (clampedVal - min) / (max - min) : 0;
  // Needle angle: π (left) to 0 (right)
  const needleAngle = Math.PI - pct * Math.PI;
  const needleLen = r - 10;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy - needleLen * Math.sin(needleAngle);
  
  // Determine zone color for current value
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
  
  // Draw arc segment (half-circle, angles in math convention: 0=right, π=left)
  function arcPath(startPct, endPct) {
    // pct 0 = left (π), pct 1 = right (0)
    const a1 = Math.PI - startPct * Math.PI;
    const a2 = Math.PI - endPct * Math.PI;
    const x1 = cx + r * Math.cos(a1), y1 = cy - r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy - r * Math.sin(a2);
    const large = (endPct - startPct) > 0.5 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }
  
  // Zone arcs
  const zoneArcs = [];
  if (zones) {
    const allZones = [
      { key: "red_low", color: "#ef444450" }, { key: "red", color: "#ef444450" },
      { key: "yellow_low", color: "#eab30840" }, { key: "yellow", color: "#eab30840" },
      { key: "green", color: "#22c55e40" },
      { key: "yellow_high", color: "#eab30840" },
      { key: "red_high", color: "#ef444450" },
    ];
    allZones.forEach(({ key, color }) => {
      if (zones[key]) {
        const s = Math.max(0, (zones[key][0] - min) / (max - min));
        const e = Math.min(1, (zones[key][1] - min) / (max - min));
        if (e > s) zoneArcs.push({ path: arcPath(s, e), color });
      }
    });
  }
  
  const displayVal = typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) : value;
  
  return (
    <div style={{ textAlign: "center", width: w }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {/* Background arc */}
        <path d={arcPath(0, 1)} fill="none" stroke="#1a1a1a" strokeWidth={10} strokeLinecap="round" />
        {/* Zone arcs */}
        {zoneArcs.map((z, i) => <path key={i} d={z.path} fill="none" stroke={z.color} strokeWidth={10} />)}
        {/* Filled arc up to value */}
        {pct > 0.01 && <path d={arcPath(0, pct)} fill="none" stroke={zoneColor} strokeWidth={4} strokeLinecap="round" />}
        {/* Tick marks at 0%, 25%, 50%, 75%, 100% */}
        {[0, 0.25, 0.5, 0.75, 1].map(p => {
          const a = Math.PI - p * Math.PI;
          const ix = cx + (r + 6) * Math.cos(a), iy = cy - (r + 6) * Math.sin(a);
          const ox = cx + (r + 1) * Math.cos(a), oy = cy - (r + 1) * Math.sin(a);
          return <line key={p} x1={ox} y1={oy} x2={ix} y2={iy} stroke="#333" strokeWidth={1} />;
        })}
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={zoneColor} strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={3.5} fill={zoneColor} />
        <circle cx={cx} cy={cy} r={1.5} fill="#0a0a0a" />
      </svg>
      <div style={{ marginTop: -2, fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: zoneColor }}>{displayVal}{unit}</div>
      <div style={{ fontSize: 9, color: "#666", marginTop: 2, lineHeight: 1.2 }}>{label}</div>
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
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: "#10b981", fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Primary Indicators</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          <Gauge value={c.up_4pct} min={0} max={maxUp4} label="Up 4%+ Today" zones={gz("up_4pct")} />
          <Gauge value={c.down_4pct} min={0} max={maxDn4} label="Down 4%+ Today" zones={gz("down_4pct")} />
          <Gauge value={c.up_25q} min={0} max={maxQ} label="Up 25%+ Quarter" zones={gz("up_25q")} />
          <Gauge value={c.down_25q} min={0} max={maxQ} label="Down 25%+ Quarter" zones={gz("down_25q")} />
          <Gauge value={ratio5d} min={0} max={5} label="5-Day Ratio" zones={gz("ratio_5d")} />
          <Gauge value={ratio10d} min={0} max={5} label="10-Day Ratio" zones={gz("ratio_10d")} />
        </div>
      </div>

      {/* SECONDARY INDICATORS */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: "#60a5fa", fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Secondary Indicators</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          <Gauge value={c.up_25m} min={0} max={Math.max(500, c.up_25m)} label="Up 25%+ Month" zones={gz("up_25m")} />
          <Gauge value={c.down_25m} min={0} max={Math.max(500, c.down_25m)} label="Down 25%+ Month" zones={gz("down_25m")} />
          <Gauge value={c.up_50m} min={0} max={Math.max(100, c.up_50m)} label="Up 50%+ Month" zones={gz("up_50m")} />
          <Gauge value={c.down_50m} min={0} max={Math.max(100, c.down_50m)} label="Down 50%+ Month" zones={gz("down_50m")} />
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
              <tbody>{[...history].reverse().map((row, i) => {
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
                const cc = (val, key) => ({ padding: "3px 6px", textAlign: "center", fontFamily: "monospace", color: cellColor(val, key), fontWeight: i === 0 ? 700 : 400 });
                return (
                  <tr key={row.date} style={{ borderBottom: "1px solid #1a1a1a", background: i === 0 ? "#10b98108" : "transparent" }}>
                    <td style={{ padding: "3px 6px", color: i === 0 ? "#fff" : "#666", fontWeight: i === 0 ? 700 : 400, whiteSpace: "nowrap" }}>{row.date}</td>
                    <td style={cc(row.up_4pct, "up_4pct")}>{row.up_4pct}</td>
                    <td style={cc(row.down_4pct, "down_4pct")}>{row.down_4pct}</td>
                    <td style={cc(row.up_25q, "up_25q")}>{row.up_25q}</td>
                    <td style={cc(row.down_25q, "down_25q")}>{row.down_25q}</td>
                    <td style={cc(row.ratio_5d, "ratio_5d")}>{row.ratio_5d?.toFixed(1)}</td>
                    <td style={cc(row.ratio_10d, "ratio_10d")}>{row.ratio_10d?.toFixed(1)}</td>
                    <td style={cc(row.up_25m, "up_25m")}>{row.up_25m}</td>
                    <td style={cc(row.down_25m, "down_25m")}>{row.down_25m}</td>
                    <td style={cc(row.up_50m, "up_50m")}>{row.up_50m}</td>
                    <td style={cc(row.down_50m, "down_50m")}>{row.down_50m}</td>
                    <td style={cc(row.up_13_34d, "up_13_34d")}>{row.up_13_34d}</td>
                    <td style={cc(row.down_13_34d, "down_13_34d")}>{row.down_13_34d}</td>
                    <td style={cc(row.t2108, "t2108")}>{row.t2108}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Grid({ stocks, onTickerClick, activeTicker }) {
  const grades = ["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-","E+","E","E-","F+","F","F-","G+","G"];
  const groups = useMemo(() => {
    const g = {}; grades.forEach(gr => { g[gr] = stocks.filter(s => s.grade === gr).sort((a, b) => b.rts_score - a.rts_score); }); return g;
  }, [stocks]);
  return (
    <div style={{ overflowX: "auto" }}>
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

  // Layout: when chart is open, split view 50/50
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
        {[["leaders","Theme Leaders"],["rotation","Rotation"],["scan","Scan Watch"],["grid","RTS Grid"],["mm","Mkt Monitor"]].map(([id, label]) => (
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
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Left: data views */}
        <div style={{ width: chartOpen ? "50%" : "100%", overflowY: "auto", padding: 16, transition: "width 0.2s" }}>
          {view === "leaders" && <Leaders themes={data.themes} stockMap={stockMap} filters={filters} onTickerClick={openChart} activeTicker={chartTicker} />}
          {view === "rotation" && <Rotation themes={data.themes} />}
          {view === "scan" && <Scan stocks={data.stocks} themes={data.themes} onTickerClick={openChart} activeTicker={chartTicker} />}
          {view === "grid" && <Grid stocks={data.stocks} onTickerClick={openChart} activeTicker={chartTicker} />}
          {view === "mm" && <MarketMonitor mmData={mmData} />}
        </div>

        {/* Right: chart panel */}
        {chartOpen && (
          <div style={{ width: "50%", height: "100%" }}>
            <ChartPanel ticker={chartTicker} stock={stockMap[chartTicker]} onClose={closeChart} />
          </div>
        )}
      </div>
    </div>
  );
}
