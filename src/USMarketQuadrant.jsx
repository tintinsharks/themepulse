import { useState, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════════
//  US MARKET QUADRANT — W09/2026
//  Adapted from Stocksgeeks/FinallyNitin for US equities
//  Pipeline: theme_definitions.py → 01→02→03→09→09b→09d→09e→10
// ═══════════════════════════════════════════════════════════════════

const P = {
  bg: "#050608", fg: "#0c0e14", card: "#111420", raised: "#161a28",
  stroke: "#1a1f32", strokeLt: "#252b42",
  g: "#00e676", gDim: "#0b4d2d", gBg: "rgba(0,230,118,0.05)",
  r: "#ff3d57", rDim: "#501020", rBg: "rgba(255,61,87,0.04)",
  y: "#ffab00", yBg: "rgba(255,171,0,0.04)",
  w: "#edf0fa", tx: "#b8bdd2", dm: "#5d6484", mu: "#343854",
  ac: "#6080ff", ac2: "#40ddff",
};
const M = "'Geist Mono', 'IBM Plex Mono', 'JetBrains Mono', monospace";
const S = "'Geist', 'DM Sans', -apple-system, sans-serif";

// ─── COMPLETE PIPELINE THEME MAP ─────────────────────────────────
// Maps each quadrant indicator → exact data source + script + calculation
const MAP = [
  {
    q: "MOMENTUM", c: P.g,
    ind: "Homma MSwing",
    what: "EMA(13) slope of index ETF price. Positive = above zero & above its own MA. Measures directional conviction at index level.",
    src: [
      { api: "yfinance", ep: "yf.download('SPY QQQ IWM DIA MDY') → pandas EMA(13)", tier: "Free" },
      { api: "FMP Starter", ep: "/stable/index-quote ^GSPC ^NDX ^DJI ^RUT ^SP400", tier: "$14/mo" },
    ],
    scripts: [
      "10_market_monitor.py → calculate_index_ma_status() — above/below 10/20/50/200 SMA per ETF",
      "03_analyze.py → RS_Score (weighted 1M/3M/6M/1Y returns per stock)",
      "09e_theme_health.py → momentum pillar (avg RS, return accel, weekly boost)",
    ],
    calc: "MSwing[i] = EMA(13)[i] − EMA(13)[i−1]. Signal = sign × magnitude. 4/5 positive = bullish.",
  },
  {
    q: "SWING", c: P.r,
    ind: "% above 10/20 SMA + MBI + SwiCo",
    what: "Short-term breadth across full S&P 500+ universe. MBI = daily advancing − declining count. SwiCo = swing confidence composite.",
    src: [
      { api: "Finviz Elite", ep: "01_finviz_extract.py → CSV view 171 (Technical) → SMA20, SMA50 cols", tier: "Elite $25/mo" },
      { api: "yfinance", ep: "02_historical_prices.py → 10Y OHLCV → rolling(10/20).mean()", tier: "Free" },
      { api: "FMP Starter", ep: "/stable/technical-indicator/sma?period=10&symbol={ticker}", tier: "$14/mo" },
    ],
    scripts: [
      "01_finviz_extract.py → 6 CSV views merged (Overview/Perf/Tech/Val/Fin/Own)",
      "03_analyze.py → Above_SMA20, Above_SMA10 flags per stock",
      "10_market_monitor.py → t2108 (% above 40-day MA), up_4pct/down_4pct counts",
      "09_export_web_data.py → breadth field per theme",
    ],
    calc: "% abv = Σ(close > SMA) / N × 100. MBI = advancing − declining. SwiCo = breadth + momentum + structure composite (09e).",
  },
  {
    q: "TREND", c: P.r,
    ind: "52-wk Net New Highs + % above 50 SMA",
    what: "Intermediate trend health. NNH = stocks at 52W high minus stocks at 52W low. Plus % of universe above 50-day SMA.",
    src: [
      { api: "Finviz Elite", ep: "CSV view 171 → 52W High, 52W Low columns", tier: "Elite" },
      { api: "yfinance", ep: "02_historical_prices.py → 10Y history → rolling(252).max/min", tier: "Free" },
      { api: "FMP Starter", ep: "/stable/stock-price-change (52W from quote endpoint)", tier: "$14/mo" },
    ],
    scripts: [
      "02_historical_prices.py → 10Y OHLCV for all tickers (batches of 50, yfinance)",
      "03_analyze.py → High_52W, Low_52W, Above_SMA50, Pct_From_52W_High",
      "10_market_monitor.py → up_25q/down_25q (quarter movers), 13%/34d movers",
      "09d_episodic_pivots.py → gap ≥4%, vol ≥2.5×avg, close in upper 50%",
    ],
    calc: "NNH = Σ(close ≥ 0.98 × 52W_high) − Σ(close ≤ 1.02 × 52W_low). Trend UP when NNH positive + >50% above 50SMA.",
  },
  {
    q: "BIAS", c: P.r,
    ind: "% above 200-day SMA",
    what: "Long-term structural regime — the tide beneath the waves. >60% = bullish, 40-60% = neutral, <40% = bearish.",
    src: [
      { api: "Finviz Elite", ep: "CSV view 171 → SMA200 col (% distance from 200MA)", tier: "Elite" },
      { api: "yfinance", ep: "close.rolling(200).mean() vs last close", tier: "Free" },
      { api: "FMP Starter", ep: "/stable/technical-indicator/sma?period=200", tier: "$14/mo" },
    ],
    scripts: [
      "03_analyze.py → Above_SMA200, SMA50_Above_SMA200 flags",
      "09e_theme_health.py → structure pillar (above_20, above_50, above_200, MA stacking)",
      "10_market_monitor.py → additional regime confirmation",
    ],
    calc: "% abv 200 = Σ(close > SMA200) / N × 100. Threshold: >60 bull, 40-60 neutral, <40 bear.",
  },
];

// ─── FULL PIPELINE STEPS (from daily.sh + run_daily.sh) ──────────
const PIPELINE = [
  { step: "01", name: "finviz_extract", desc: "6 CSV views from Finviz Elite (Overview/Perf/Tech/Val/Fin/Own)", api: "Finviz" },
  { step: "02", name: "historical_prices", desc: "10Y OHLCV via yfinance (batches of 50, resume-capable)", api: "yfinance" },
  { step: "03", name: "analyze", desc: "RS/TS/RTS rankings, ATR, MA alignment, grades A+ → G", api: "—" },
  { step: "08", name: "build_theme_map", desc: "Maps tickers → 21 themes from theme_definitions.py", api: "—" },
  { step: "09", name: "export_web_data", desc: "Snapshot + themes → dashboard_data.json", api: "—" },
  { step: "09b", name: "enrich_web_data", desc: "Finviz CSV fields: RSI, ATR, beta, float, earnings_date", api: "Finviz" },
  { step: "09c", name: "earnings_enrich", desc: "Quarterly EPS/revenue + surprise + guidance", api: "FMP" },
  { step: "09d", name: "episodic_pivots", desc: "EP scan: gap ≥4%, vol ≥2.5×, close in upper 50%", api: "yfinance" },
  { step: "09e", name: "vcs + theme_health", desc: "VCS from OHLC + 4-pillar theme health scoring", api: "yfinance" },
  { step: "09f", name: "institutional + margins", desc: "13F holder counts + quarterly profit margins", api: "FMP" },
  { step: "09g", name: "earnings_calendar", desc: "FMP batch calendar ±14 days", api: "FMP" },
  { step: "09h", name: "earnings_sessions", desc: "Pre/intra/post-market session data via yfinance 2m bars", api: "yfinance" },
  { step: "09i", name: "momentum_burst", desc: "Stockbee $ breakout + 4% breakout scan", api: "—" },
  { step: "10", name: "market_monitor", desc: "Stockbee breadth: 4% movers, T2108, quarter/month movers", api: "yfinance" },
];

// ─── MOCK LIVE DATA ──────────────────────────────────────────────
const D = {
  date: "2026-02-27", week: 9, total: 2847,
  momentum: { status: "positive", data: [
    { n: "S&P 500 (SPY)", v: 28 }, { n: "NASDAQ 100 (QQQ)", v: 35 },
    { n: "Dow Jones (DIA)", v: 18 }, { n: "Russell 2000 (IWM)", v: -4 }, { n: "S&P MidCap (MDY)", v: 12 },
  ]},
  swing: { status: "negative",
    pct: [{ d: "02/27", a10: 32, a20: 28 }, { d: "02/26", a10: 36, a20: 34 }, { d: "02/25", a10: 38, a20: 35 }],
    mbi: [{ d: "02/27", v: -62 }, { d: "02/26", v: -175 }, { d: "02/25", v: -220 }, { d: "02/24", v: -410 }, { d: "02/21", v: -85 }, { d: "02/20", v: 150 }, { d: "02/19", v: -290 }],
    swico: 0,
  },
  trend: { status: "negative",
    nnh: [{ d: "02/27", h: 8, l: -22, n: -14 }, { d: "02/26", h: 5, l: -18, n: -13 }, { d: "02/25", h: 6, l: -25, n: -19 }],
    sma: [{ d: "02/27", a50: 34, a200: 42 }, { d: "02/26", a50: 37, a200: 44 }, { d: "02/25", a50: 36, a200: 43 }],
  },
  bias: { status: "negative",
    hist: [{ d: "02/27", v: 42 }, { d: "02/26", v: 44 }, { d: "02/25", v: 43 }, { d: "02/24", v: 45 }, { d: "02/21", v: 47 }],
  },
  // From 10_market_monitor.py output
  monitor: {
    up4: 42, dn4: 187, ratio5d: 0.31, ratio10d: 0.48,
    up25q: 312, dn25q: 195, up25m: 88, dn25m: 142,
    t2108: 34.2, total: 6842,
  },
  themes: [
    { t: "AI Infrastructure", s: "LEADING", c: 78.2 },
    { t: "Defense", s: "LEADING", c: 74.5 },
    { t: "Semiconductors", s: "EMERGING", c: 62.1 },
    { t: "Fintech", s: "EMERGING", c: 60.4 },
    { t: "Cyber", s: "EMERGING", c: 58.8 },
    { t: "Commodities", s: "HOLDING", c: 51.2 },
    { t: "Energy", s: "HOLDING", c: 48.3 },
    { t: "Software", s: "HOLDING", c: 45.1 },
    { t: "Healthcare", s: "WEAKENING", c: 35.2 },
    { t: "EV", s: "LAGGING", c: 22.4 },
  ],
};

// ─── MICRO COMPONENTS ────────────────────────────────────────────
const Dot = ({ s, sz = 9 }) => {
  const c = s === "positive" || s === "LEADING" || s === "EMERGING" ? P.g : s === "negative" || s === "LAGGING" || s === "WEAKENING" ? P.r : P.y;
  return <span style={{ display: "inline-block", width: sz, height: sz, borderRadius: "50%", background: c, boxShadow: `0 0 ${sz + 2}px ${c}40` }} />;
};

const Tag = ({ children, color = P.dm }) => (
  <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 3, fontSize: 9.5, fontWeight: 700, fontFamily: M, color, background: `${color}10`, border: `1px solid ${color}22`, letterSpacing: "0.03em" }}>{children}</span>
);

const T = ({ hd, rows }) => (
  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10.5, fontFamily: M }}>
    <thead><tr>{hd.map((h, i) => <th key={i} style={{ padding: "2px 5px", borderBottom: `1px solid ${P.stroke}`, color: P.dm, fontWeight: 600, fontSize: 8.5, textAlign: i ? "right" : "left", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => { const o = typeof c === "object" && c; return <td key={ci} style={{ padding: "2px 5px", color: o ? o.c : P.tx, fontWeight: ci ? 400 : 500, textAlign: ci ? "right" : "left" }}>{o ? o.v : c}</td>; })}</tr>)}</tbody>
  </table>
);

const Bars = ({ data, w = 240, h = 34, thr = 50 }) => {
  const mx = Math.max(...data.map(Math.abs), thr) * 1.15;
  const bw = Math.max(2, (w - 10) / data.length - 1);
  return <svg width={w} height={h}><line x1={5} y1={h - 3 - (thr / mx) * (h - 6)} x2={w - 5} y2={h - 3 - (thr / mx) * (h - 6)} stroke={P.mu} strokeWidth={0.5} strokeDasharray="2,2" />{data.map((v, i) => <rect key={i} x={5 + i * ((w - 10) / data.length)} y={h - 3 - (Math.abs(v) / mx) * (h - 6)} width={bw} height={(Math.abs(v) / mx) * (h - 6)} fill={v >= thr ? P.g : P.r} opacity={0.55} rx={1} />)}</svg>;
};

const MbiBar = ({ data, w = 240, h = 34 }) => {
  const mx = Math.max(...data.map(d => Math.abs(d.v))) * 1.15 || 1;
  const bw = Math.max(3, (w - 10) / data.length - 2); const mid = h / 2;
  return <svg width={w} height={h}><line x1={5} y1={mid} x2={w - 5} y2={mid} stroke={P.mu} strokeWidth={0.5} />{data.map((d, i) => <rect key={i} x={5 + i * ((w - 10) / data.length)} y={d.v >= 0 ? mid - (Math.abs(d.v) / mx) * (mid - 3) : mid} width={bw} height={(Math.abs(d.v) / mx) * (mid - 3)} fill={d.v >= 0 ? P.g : P.r} opacity={0.65} rx={1} />)}</svg>;
};

// ─── QUADRANT CARD ───────────────────────────────────────────────
const Q = ({ title, status, label, desc, summary, children }) => {
  const clr = status === "positive" ? P.g : status === "negative" ? P.r : P.y;
  const bg = status === "positive" ? P.gBg : status === "negative" ? P.rBg : P.yBg;
  return (
    <div style={{ background: P.card, border: `1px solid ${P.stroke}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 8px", borderBottom: `1px solid ${P.stroke}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}><Dot s={status} /><span style={{ fontSize: 11.5, fontWeight: 700, color: P.w, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: M }}>{title}</span></div>
        <Tag color={clr}>{label}</Tag>
      </div>
      <div style={{ padding: "4px 14px 1px", fontSize: 9.5, color: P.dm, lineHeight: 1.45 }}>{desc}</div>
      <div style={{ padding: "5px 10px 10px", flex: 1 }}>{children}</div>
      {summary && <div style={{ padding: "7px 14px", borderTop: `1px solid ${P.stroke}`, fontSize: 9.5, color: P.dm, lineHeight: 1.5, background: bg }}>{summary}</div>}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
export default function USMarketQuadrant() {
  const [mapOpen, setMapOpen] = useState(false);
  const [pipeOpen, setPipeOpen] = useState(false);
  const swingBars = useMemo(() => Array.from({ length: 35 }, () => Math.random() * 75 + 14), []);
  const trendBars = useMemo(() => Array.from({ length: 35 }, () => Math.random() * 55 + 20), []);
  const biasBars = useMemo(() => Array.from({ length: 35 }, () => Math.random() * 50 + 20), []);
  const comp = [D.momentum.status, D.swing.status, D.trend.status, D.bias.status].filter(s => s === "positive").length;
  const sc = { LEADING: P.g, EMERGING: "#70e000", HOLDING: P.y, WEAKENING: "#ff8c00", LAGGING: P.r };

  return (
    <div style={{ minHeight: "100vh", background: P.bg, color: P.tx, fontFamily: S, padding: "18px 14px 36px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect width="22" height="22" rx="5" fill={P.ac} fillOpacity={0.12} /><path d="M5 16L9 9L13 13L17 6" stroke={P.ac} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: P.w, margin: 0, fontFamily: M }}>MARKET QUADRANT <span style={{ color: P.dm, fontWeight: 500 }}>W{String(D.week).padStart(2, "0")}/2026</span></h1>
            </div>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: P.dm, fontFamily: M }}>US Equity · cap_smallover filter · {D.total.toLocaleString()} stocks · theme_definitions.py (21 themes) · {D.date}</p>
          </div>
          <div style={{ display: "flex", gap: 10, fontSize: 9.5, color: P.dm }}>{[{ c: P.g, l: "Bullish" }, { c: P.y, l: "Neutral" }, { c: P.r, l: "Bearish" }].map(x => <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: x.c }} />{x.l}</div>)}</div>
        </div>

        {/* THEME MAP TABLE */}
        <div style={{ background: P.card, border: `1px solid ${P.stroke}`, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
          <div onClick={() => setMapOpen(!mapOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", cursor: "pointer", borderBottom: mapOpen ? `1px solid ${P.stroke}` : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ color: P.ac, fontSize: 12 }}>◈</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: P.w, fontFamily: M, textTransform: "uppercase", letterSpacing: "0.07em" }}>Indicator → Data Source Theme Map</span>
              <Tag color={P.ac}>4 Quadrants × 3 APIs</Tag>
            </div>
            <span style={{ color: P.dm, fontSize: 15, transform: mapOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>⌄</span>
          </div>
          {mapOpen && <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: M }}>
              <thead><tr style={{ background: P.fg }}>{["Quadrant", "Indicator", "What It Measures", "Data Sources (API + Script)", "Calculation"].map((h, i) => <th key={i} style={{ padding: "6px 10px", textAlign: "left", color: P.dm, fontWeight: 600, fontSize: 8.5, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${P.stroke}`, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>{MAP.map((r, ri) => (
                <tr key={ri} style={{ borderBottom: `1px solid ${P.stroke}12` }}>
                  <td style={{ padding: "7px 10px", fontWeight: 700, color: r.c, whiteSpace: "nowrap", verticalAlign: "top", fontSize: 11 }}>{r.q}</td>
                  <td style={{ padding: "7px 10px", color: P.w, verticalAlign: "top", minWidth: 115, fontSize: 10 }}>{r.ind}</td>
                  <td style={{ padding: "7px 10px", color: P.tx, verticalAlign: "top", minWidth: 170, fontSize: 9, lineHeight: 1.45 }}>{r.what}</td>
                  <td style={{ padding: "7px 10px", verticalAlign: "top", minWidth: 240 }}>
                    {r.src.map((s, si) => <div key={si} style={{ marginBottom: 3 }}><Tag color={s.api.includes("FMP") ? P.ac : s.api.includes("Finviz") ? P.y : P.g}>{s.api}</Tag><span style={{ color: P.mu, fontSize: 8.5, marginLeft: 4 }}>{s.tier}</span><div style={{ color: P.mu, fontSize: 8, marginTop: 1 }}>{s.ep}</div></div>)}
                    <div style={{ borderTop: `1px solid ${P.stroke}15`, marginTop: 4, paddingTop: 3 }}>{r.scripts.map((s, si) => <div key={si} style={{ color: P.dm, fontSize: 8.5, marginBottom: 1 }}><span style={{ color: P.ac }}>→</span> {s}</div>)}</div>
                  </td>
                  <td style={{ padding: "7px 10px", color: P.dm, verticalAlign: "top", fontSize: 8.5, lineHeight: 1.45, minWidth: 170 }}>{r.calc}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>}
        </div>

        {/* THEME HEALTH + STOCKBEE MONITOR STRIP */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={{ background: P.card, border: `1px solid ${P.stroke}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: P.dm, fontFamily: M, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 7 }}>Theme Health (09e_theme_health.py)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{D.themes.map(t => (
              <div key={t.t} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9.5, fontFamily: M, background: `${sc[t.s]}08`, border: `1px solid ${sc[t.s]}18`, color: sc[t.s], fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: sc[t.s] }} />{t.t}<span style={{ color: P.dm, fontWeight: 400 }}>{t.c.toFixed(0)}</span>
              </div>
            ))}</div>
          </div>
          <div style={{ background: P.card, border: `1px solid ${P.stroke}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: P.dm, fontFamily: M, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 7 }}>Stockbee Monitor (10_market_monitor.py)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, fontSize: 10, fontFamily: M }}>
              {[
                { l: "4% Up", v: D.monitor.up4, c: P.g }, { l: "4% Down", v: D.monitor.dn4, c: P.r },
                { l: "5d Ratio", v: D.monitor.ratio5d, c: D.monitor.ratio5d >= 1 ? P.g : P.r },
                { l: "T2108", v: `${D.monitor.t2108}%`, c: D.monitor.t2108 >= 50 ? P.g : D.monitor.t2108 >= 30 ? P.y : P.r },
                { l: "25% Q↑", v: D.monitor.up25q, c: P.g }, { l: "25% Q↓", v: D.monitor.dn25q, c: P.r },
                { l: "25% M↑", v: D.monitor.up25m, c: P.g }, { l: "25% M↓", v: D.monitor.dn25m, c: P.r },
              ].map(x => (
                <div key={x.l} style={{ background: `${x.c}06`, border: `1px solid ${x.c}15`, borderRadius: 5, padding: "3px 6px", textAlign: "center" }}>
                  <div style={{ fontSize: 8, color: P.dm }}>{x.l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: x.c }}>{x.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* QUADRANT GRID */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: 12, marginBottom: 14 }}>
          <Q title="Momentum" status={D.momentum.status} label="POSITIVE" desc="Homma MSwing — EMA(13) slope across SPY, QQQ, DIA, IWM, MDY. Source: yfinance + FMP index-quote." summary={<><strong style={{ color: P.g }}>4/5 indices positive.</strong> Russell 2000 diverging. Large-cap momentum intact.</>}>
            <T hd={["Index", "MSwing", ""]} rows={D.momentum.data.map(i => [i.n, { v: i.v > 0 ? `+${i.v}` : i.v, c: i.v >= 0 ? P.g : P.r }, { v: i.v >= 0 ? "▲" : "▼", c: i.v >= 0 ? P.g : P.r }])} />
          </Q>
          <Q title="Swing" status={D.swing.status} label="DOWN" desc="% above 10/20 SMA + MBI. Source: 01_finviz CSV view 171 → 03_analyze.py → 10_market_monitor.py." summary={<><strong style={{ color: P.r }}>32% above 10MA, 28% above 20MA.</strong> MBI red 5 straight. SwiCo = 0.</>}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 48%", minWidth: 180 }}>
                <Bars data={swingBars} thr={50} /><div style={{ fontSize: 8, color: P.mu, fontFamily: M, marginTop: 1 }}>% above 10-SMA · 35 sessions</div>
                <div style={{ marginTop: 4 }}><MbiBar data={D.swing.mbi} /><div style={{ fontSize: 8, color: P.mu, fontFamily: M, marginTop: 1 }}>MBI · daily net breadth</div></div>
              </div>
              <div style={{ flex: "1 1 46%", minWidth: 140 }}>
                <T hd={["% Abv", "10SMA", "20SMA"]} rows={D.swing.pct.map(p => [p.d, { v: p.a10, c: p.a10 < 50 ? P.r : P.g }, { v: p.a20, c: p.a20 < 50 ? P.r : P.g }])} />
                <div style={{ marginTop: 4 }}><T hd={["MBI", "Net"]} rows={D.swing.mbi.slice(0, 5).map(m => [{ v: m.d, c: m.v < 0 ? P.r : P.tx }, { v: m.v > 0 ? `+${m.v}` : m.v, c: m.v < 0 ? P.r : P.g }])} /></div>
                <div style={{ marginTop: 4 }}><Tag color={P.r}>SwiCo: {D.swing.swico}</Tag></div>
              </div>
            </div>
          </Q>
          <Q title="Trend" status={D.trend.status} label="DOWN" desc="52-wk NNH + % above 50 SMA. Source: 02_historical_prices → 03_analyze → 09d_episodic_pivots." summary={<><strong style={{ color: P.r }}>NNH negative 3 sessions.</strong> 34% above 50MA. Intermediate trend weak.</>}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 48%", minWidth: 180 }}>
                <Bars data={trendBars} thr={50} /><div style={{ fontSize: 8, color: P.mu, fontFamily: M, marginTop: 1 }}>% above 50-SMA · 35 sessions</div>
                <div style={{ marginTop: 4 }}><MbiBar data={D.trend.nnh.map(n => ({ v: n.n }))} w={240} h={30} /><div style={{ fontSize: 8, color: P.mu, fontFamily: M, marginTop: 1 }}>Net New Highs (52W highs − lows)</div></div>
              </div>
              <div style={{ flex: "1 1 46%", minWidth: 140 }}>
                <T hd={["52wk", "Hi", "Lo", "NNH"]} rows={D.trend.nnh.map(n => [n.d, { v: n.h, c: P.g }, { v: n.l, c: P.r }, { v: n.n, c: n.n < 0 ? P.r : P.g }])} />
                <div style={{ marginTop: 5 }}><T hd={["% Abv", "50SMA", "200SMA"]} rows={D.trend.sma.map(s => [s.d, { v: s.a50, c: s.a50 < 50 ? P.r : P.g }, { v: s.a200, c: s.a200 < 50 ? P.r : P.g }])} /></div>
              </div>
            </div>
          </Q>
          <Q title="Bias" status={D.bias.status} label="BEARISH" desc="% above 200-day SMA. Source: Finviz SMA200 col + 03_analyze Above_SMA200 + 09e structure pillar." summary={<><strong style={{ color: P.r }}>Only 42% above 200-day SMA.</strong> Long-term bearish regime. Defensive posture.</>}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 48%", minWidth: 180 }}>
                <Bars data={biasBars} thr={50} /><div style={{ fontSize: 8, color: P.mu, fontFamily: M, marginTop: 1 }}>% above 200-SMA · 35 sessions</div>
              </div>
              <div style={{ flex: "1 1 46%", minWidth: 140 }}>
                <T hd={["Date", "% > 200SMA"]} rows={D.bias.hist.map(h => [h.d, { v: `${h.v}%`, c: h.v < 50 ? P.r : P.g }])} />
              </div>
            </div>
          </Q>
        </div>

        {/* COMPOSITE SCORE */}
        <div style={{ background: P.card, border: `1px solid ${P.stroke}`, borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 8.5, color: P.dm, fontFamily: M, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 1 }}>Composite</div>
              <span style={{ fontSize: 22, fontWeight: 700, color: comp <= 1 ? P.r : comp <= 2 ? P.y : P.g, fontFamily: M }}>{comp}/4</span>
              <span style={{ fontSize: 10, color: P.dm, marginLeft: 6 }}>bullish</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>{[{ l: "MOM", s: D.momentum.status }, { l: "SWG", s: D.swing.status }, { l: "TRD", s: D.trend.status }, { l: "BIAS", s: D.bias.status }].map(q => <div key={q.l} style={{ background: q.s === "positive" ? P.gBg : P.rBg, border: `1px solid ${q.s === "positive" ? P.g : P.r}18`, borderRadius: 5, padding: "4px 10px", textAlign: "center" }}><div style={{ fontSize: 7.5, color: P.dm, fontFamily: M, marginBottom: 1 }}>{q.l}</div><Dot s={q.s} sz={7} /></div>)}</div>
            <div style={{ background: comp <= 1 ? P.rBg : P.yBg, border: `1px solid ${comp <= 1 ? P.r : P.y}18`, borderRadius: 6, padding: "6px 14px" }}>
              <div style={{ fontSize: 7.5, color: P.dm, fontFamily: M, textTransform: "uppercase" }}>Verdict</div>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: M, color: comp <= 1 ? P.r : comp <= 2 ? P.y : P.g }}>{comp <= 1 ? "DEFENSIVE" : comp <= 2 ? "CAUTIOUS" : "RISK ON"}</div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ height: 4, borderRadius: 2, background: `linear-gradient(90deg, ${P.r}, ${P.y} 50%, ${P.g})`, position: "relative" }}>
              <div style={{ position: "absolute", left: `${comp / 4 * 100}%`, top: -4, width: 10, height: 10, borderRadius: "50%", background: P.w, border: `2px solid ${comp <= 1 ? P.r : P.y}`, transform: "translateX(-50%)", boxShadow: `0 0 6px ${comp <= 1 ? P.r : P.y}50` }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: P.mu, marginTop: 2, fontFamily: M }}><span>BEARISH</span><span>NEUTRAL</span><span>BULLISH</span></div>
          </div>
        </div>

        {/* PIPELINE ACCORDION */}
        <div style={{ background: P.card, border: `1px solid ${P.stroke}`, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
          <div onClick={() => setPipeOpen(!pipeOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", cursor: "pointer", borderBottom: pipeOpen ? `1px solid ${P.stroke}` : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ color: P.ac2, fontSize: 11 }}>⚙</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: P.w, fontFamily: M, textTransform: "uppercase", letterSpacing: "0.06em" }}>Full Pipeline (daily.sh)</span>
              <Tag color={P.ac2}>{PIPELINE.length} steps</Tag>
            </div>
            <span style={{ color: P.dm, fontSize: 15, transform: pipeOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>⌄</span>
          </div>
          {pipeOpen && <div style={{ padding: "6px 14px 10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 4 }}>
              {PIPELINE.map(p => (
                <div key={p.step} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "3px 0", fontSize: 9.5, fontFamily: M }}>
                  <span style={{ color: P.ac, fontWeight: 700, minWidth: 28 }}>{p.step}</span>
                  <span style={{ color: P.w, fontWeight: 600, minWidth: 100 }}>{p.name}</span>
                  <Tag color={p.api === "Finviz" ? P.y : p.api === "yfinance" ? P.g : p.api === "FMP" ? P.ac : P.dm}>{p.api}</Tag>
                </div>
              ))}
            </div>
          </div>}
        </div>

        {/* FOOTER */}
        <div style={{ padding: "8px 14px", background: P.fg, border: `1px solid ${P.stroke}`, borderRadius: 8, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "center" }}>
          {[{ n: "Finviz Elite", d: "Universe + 6 CSV views", c: P.y }, { n: "yfinance", d: "10Y OHLCV + sessions + EPs", c: P.g }, { n: "FMP Starter", d: "Index quotes + earnings + 13F", c: P.ac }].map(s => <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: s.c }} /><span style={{ fontSize: 9, fontWeight: 600, color: s.c, fontFamily: M }}>{s.n}</span><span style={{ fontSize: 8, color: P.mu }}>{s.d}</span></div>)}
          <span style={{ fontSize: 8, color: P.mu, fontFamily: M }}>→ Vercel deploy via git push</span>
        </div>
      </div>
    </div>
  );
}
