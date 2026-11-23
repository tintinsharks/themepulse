import React, { useMemo, useState } from "react";
import { Card, EPS_TIP, FlagButton, LayerLink, RslDot, TierMark, rsLeads, td, th, useScanQuotes } from "./core.jsx";

// ── Scanner: preset scans over the ThemePulse universe ─────────────────────
// Momentum / Strongest / Liquid Leaders reuse the old dashboard's definitions;
// Hottest Stock mirrors the TradingView screen; 20% study and Bullish
// Anticipation are Stockbee's. Bar-derived fields (adr5, ti65, burst20_*,
// sma20_lvl) come from 09_export_web_data's scan levels.
const SCANS = [
  ["m1w", "Momentum 1W"], ["m1m", "Momentum 1M"], ["m3m", "Momentum 3M"], ["m6m", "Momentum 6M"],
  ["strong", "Strongest Stock"], ["s20", "20% study"], ["antic", "Bullish Anticipation"],
  ["hot", "Hottest Stocks"], ["liquid", "Liquid Leaders"],
];
const SCAN_NOTES = {
  m1w: "Up 20%+ in a week · above 52w low ≥ 50% · avg vol ≥ 300K · <$10B: float ≤ 50M, 0–20% above SMA20 · $10B+: float ≤ 150M, 0–10% above SMA20",
  m1m: "Up 30%+ in a month · same base as 1W",
  m3m: "Up 70%+ in 3 months · ≥ 100% above the 52w low · ADR ≥ 3% · same base as 1W",
  m6m: "Up 100%+ in 6 months · ≥ 100% above the 52w low · ADR ≥ 3% · same base as 1W",
  strong: "≥ 70% above the 52w low · EPS & sales growth ≥ 25% · avg vol ≥ 500K · <$10B: float ≤ 50M, ADR ≥ 3% · $10B+: float ≤ 150M, ADR ≥ 2% · near SMA20, ≥ SMA50 −3%",
  s20: "Stockbee: up 20%+ in 5 sessions within the last 15 · still above the 50-day and within 25% of the high · price ≥ $3 · avg $vol ≥ $5M · Ago = sessions since the burst, Pullback = from the high since",
  antic: "Stockbee: quiet day (−1% to +1%) · TI65 (7d ÷ 65d avg close) ≥ 1.05 · above SMA20 & SMA50 · within 15% of the high · ADR ≥ 2.5% · price ≥ $5, avg $vol ≥ $10M",
  hot: "TradingView Hottest Stock: mkt cap > $25M · perf 1M > 30% · avg vol > 300K · vol > 100K · price > $1 · float < 75M · volatility 1W > 3% · perf 1W −10% to +10%",
  liquid: "Price > $10 · mkt cap ≥ $300M · avg vol ≥ 1M · avg $vol ≥ $100M · ADR > 3% · EPS growth this year > 20% or 5y sales growth > 15% · RS ≥ 70 · above the 50-day",
};

function scanHits(s, q) {
  const c = q?.price ?? s.close ?? s.price;
  if (!c) return null;
  const mcap = s.market_cap_raw || 0, av = s.avg_volume_raw || 0, adv = s.avg_dollar_vol_raw || av * c;
  const adr = s.adr20 ?? s.adr_pct ?? 0;
  const fl = s.shares_float_raw ?? (mcap && s.close ? mcap / s.close : null);
  const sma20 = s.sma20_lvl ? (s.close / s.sma20_lvl - 1) * 100 : s.sma20_pct;
  const sma50 = s.sma50_lvl ? (s.close / s.sma50_lvl - 1) * 100 : s.sma50_pct;
  const lo = s.above_52w_low ?? 0;
  const off = s.off_52w_high ?? s.pct_from_high;
  const chg = q?.change ?? s.change_pct;
  const big = mcap >= 10e9;
  const momBase = mcap >= 300e6 && av >= 300e3 && lo >= 50 && sma20 != null &&
    (big ? (fl == null || fl <= 150e6) && sma20 >= 0 && sma20 <= 10
         : (fl == null || fl <= 50e6) && sma20 >= 0 && sma20 <= 20);
  const out = {};
  const tag = big ? "L" : "S";
  if (momBase && (s.return_1w ?? 0) >= 20) out.m1w = tag;
  if (momBase && (s.return_1m ?? 0) >= 30) out.m1m = tag;
  if (momBase && lo >= 100 && (s.return_3m ?? 0) >= 70 && adr >= 3) out.m3m = tag;
  if (momBase && lo >= 100 && (s.return_6m ?? 0) >= 100 && adr >= 3) out.m6m = tag;
  const eg = s.eps_yoy ?? s.eps_qq ?? -1, sg = s.sales_yoy ?? s.sales_qq ?? -1;
  if (mcap >= 300e6 && lo >= 70 && eg >= 25 && sg >= 25 && av >= 500e3 && (sma50 == null || sma50 >= -3) && sma20 != null) {
    if (!big && (fl == null || fl <= 50e6) && sma20 >= -2 && sma20 <= 18 && adr >= 3) out.strong = "S";
    else if (big && (fl == null || fl <= 150e6) && sma20 >= -2 && sma20 <= 12 && adr >= 2) out.strong = "L";
  }
  if (s.burst20_pct != null && c >= 3 && adv >= 5e6 && sma50 > 0 && off != null && off >= -25) out.s20 = true;
  if (chg != null && chg >= -1 && chg <= 1 && (s.ti65 ?? 0) >= 1.05 && sma20 > 0 && sma50 > 0 && adr >= 2.5 &&
      off != null && off >= -15 && c >= 5 && adv >= 10e6) out.antic = true;
  const vol = q?.volume;
  if (mcap > 25e6 && (s.return_1m ?? 0) > 30 && av > 300e3 && (vol == null || vol > 100e3) && c > 1 &&
      fl != null && fl < 75e6 && (s.adr5 ?? 0) > 3 && (s.return_1w ?? 99) >= -10 && (s.return_1w ?? 99) <= 10) out.hot = true;
  const epsY = s.eps_this_y ?? s.eps_past_5y;
  if (c > 10 && mcap >= 300e6 && av >= 1e6 && adv >= 100e6 && adr > 3 && (s.rs_rank ?? 0) >= 70 && sma50 > 0 &&
      ((epsY != null && epsY > 20) || (s.sales_past_5y != null && s.sales_past_5y > 15))) out.liquid = true;
  return out;
}

const SCAN_SORT = { m1w: "r1w", m1m: "r1m", m3m: "r3m", m6m: "r6m", strong: "rs", s20: "ago", antic: "ti65", hot: "r1m", liquid: "rs" };

function ScannerPanel({ A, stockMap, onTicker, chartTicker, tickerLayer, onLayer }) {
  const [scan, setScan] = useState(() => { try { return localStorage.getItem("tp-scan-tab") || "m1w"; } catch { return "m1w"; } });
  const [sort, setSort] = useState({ k: SCAN_SORT[scan] || "rs", d: -1 });
  const pick = (k) => { setScan(k); setSort({ k: SCAN_SORT[k] || "rs", d: k === "s20" ? 1 : -1 }); try { localStorage.setItem("tp-scan-tab", k); } catch { /* */ } };
  // pass 1 on pipeline data (cheap) to know which names to quote live
  const pre = useMemo(() => {
    const m = {};
    Object.values(stockMap || {}).forEach((s) => { if (s?.ticker) { const h = scanHits(s, null); if (h) m[s.ticker] = h; } });
    return m;
  }, [stockMap]);
  // Anticipation and Hottest use today's change / volume: quote a wider net for them
  const live = useMemo(() => Object.keys(pre).filter((t) => pre[t][scan] ||
    ((scan === "antic" || scan === "hot") && stockMap[t] && (scan === "hot" ? (stockMap[t].return_1m ?? 0) > 30 : (stockMap[t].ti65 ?? 0) >= 1.05))),
  [pre, scan, stockMap]);
  const { quotes, at } = useScanQuotes(live, true);
  const counts = useMemo(() => {
    const n = {};
    SCANS.forEach(([k]) => { n[k] = 0; });
    Object.entries(pre).forEach(([t, h]) => {
      const hh = quotes.size ? scanHits(stockMap[t], quotes.get(t)) || h : h;
      SCANS.forEach(([k]) => { if (hh[k]) n[k]++; });
    });
    return n;
  }, [pre, quotes, stockMap]);
  const rows = useMemo(() => {
    const out = [];
    Object.values(stockMap || {}).forEach((s) => {
      if (!s?.ticker) return;
      const q = quotes.get(s.ticker);
      const h = scanHits(s, q);
      if (!h?.[scan]) return;
      const L = tickerLayer[s.ticker];
      const px = q?.price ?? s.close;
      out.push({
        t: s.ticker, tag: typeof h[scan] === "string" ? h[scan] : null, px,
        chg: q?.change ?? s.change_pct ?? null,
        r1w: s.return_1w, r1m: s.return_1m, r3m: s.return_3m, r6m: s.return_6m,
        adr: s.adr20 ?? s.adr_pct, adr5: s.adr5, off: s.off_52w_high ?? s.pct_from_high, rs: s.rs_rank, eps: s.eps_rating ?? null, epsTip: s.eps_tip, epsAcc: s.eps_accel,
        burst: s.burst20_pct, ago: s.burst20_ago, pb: s.burst20_pullback, ti65: s.ti65, rsl: rsLeads(s),
        layer: L?.name, layerSt: L?.st,
      });
    });
    const { k, d } = sort;
    out.sort((x, y) => {
      const a = x[k], b = y[k];
      if (a == null && b == null) return x.t.localeCompare(y.t);
      if (a == null) return 1;
      if (b == null) return -1;
      return (a - b) * d || x.t.localeCompare(y.t);
    });
    return out;
  }, [stockMap, quotes, scan, sort, tickerLayer]);
  const col = (k, label, title) => (
    <th key={k} style={{ ...th(A, "right"), cursor: "pointer", userSelect: "none", color: sort.k === k ? A.text : A.textMuted }} title={title}
      onClick={() => setSort((p) => ({ k, d: p.k === k ? -p.d : (k === "ago" ? 1 : -1) }))}>{label}{sort.k === k ? (sort.d < 0 ? " ▼" : " ▲") : ""}</th>
  );
  const pct = (v, dg = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dg)}%`);
  const pc = (v) => (v == null ? A.textMuted : v >= 0 ? A.green : A.red);
  const extra = scan === "s20" ? [["burst", "Burst", (r) => pct(r.burst)], ["ago", "Ago", (r) => r.ago ?? "—"], ["pb", "Pullback", (r) => pct(r.pb)]]
    : scan === "antic" ? [["ti65", "TI65", (r) => (r.ti65 == null ? "—" : r.ti65.toFixed(2))]]
    : scan === "hot" ? [["adr5", "Vol 1W", (r) => (r.adr5 == null ? "—" : `${r.adr5.toFixed(1)}%`)]]
    : [];
  return (
    <Card A={A} title="Scanner" right={at ? <span style={{ fontSize: 10, color: A.textMuted }}>Live · {at.toLocaleTimeString()}</span> : null}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
        {SCANS.map(([k, label]) => (
          <button key={k} onClick={() => pick(k)}
            style={{ background: scan === k ? "rgba(13,145,99,0.14)" : "transparent", border: `1px solid ${scan === k ? A.green : A.border}`,
              color: scan === k ? A.green : A.textDim, borderRadius: 14, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {label} <span style={{ color: A.textMuted, fontWeight: 400 }}>{counts[k]}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: A.textMuted, marginBottom: 6 }}>{SCAN_NOTES[scan]}
        {" "}· <span style={{ color: A.blue || "#3b82f6" }}>●</span> RS line at a new 52-week high on an up close while price is 5–15% off its high</div>
      {!rows.length ? <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 2px" }}>No names pass right now.</div> : (
        <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 230px)", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: A.bg }}>
              <tr>
                <th style={th(A)}>Ticker</th>
                {col("px", "Price")}{col("chg", "Chg")}
                {extra.map(([k, l]) => col(k, l))}
                {col("r1w", "1W")}{col("r1m", "1M")}{col("r3m", "3M")}{col("r6m", "6M")}
                {col("adr", "ADR")}{col("off", "Off high")}{col("rs", "RS")}{col("eps", "EPS", EPS_TIP)}
                <th style={th(A)}>Layer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t} data-nav={r.t} onClick={() => onTicker(r.t)} style={{ cursor: "pointer", background: chartTicker === r.t ? A.bgHover : "transparent" }}>
                  <td style={td(A)}><FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span><TierMark t={r.t} />
                    {r.tag ? <span title={r.tag === "L" ? "$10B+ scan" : "under-$10B scan"} style={{ marginLeft: 5, fontSize: 9, color: A.textMuted }}>{r.tag}</span> : null}<RslDot tip={r.rsl} A={A} /></td>
                  <td style={{ ...td(A, "right"), color: A.text }}>{r.px != null ? r.px.toFixed(2) : "—"}</td>
                  <td style={{ ...td(A, "right"), color: pc(r.chg), fontWeight: 700 }}>{pct(r.chg, 2)}</td>
                  {extra.map(([k, , f]) => <td key={k} style={{ ...td(A, "right"), color: A.text }}>{f(r)}</td>)}
                  <td style={{ ...td(A, "right"), color: pc(r.r1w) }}>{pct(r.r1w)}</td>
                  <td style={{ ...td(A, "right"), color: pc(r.r1m) }}>{pct(r.r1m)}</td>
                  <td style={{ ...td(A, "right"), color: pc(r.r3m) }}>{pct(r.r3m)}</td>
                  <td style={{ ...td(A, "right"), color: pc(r.r6m) }}>{pct(r.r6m)}</td>
                  <td style={td(A, "right")}>{r.adr == null ? "—" : `${r.adr.toFixed(1)}%`}</td>
                  <td style={td(A, "right")}>{pct(r.off)}</td>
                  <td style={{ ...td(A, "right"), color: r.rs >= 90 ? A.green : r.rs >= 70 ? A.yellow : r.rs != null ? A.red : A.textMuted }}>{r.rs ?? "—"}</td>
                  <td title={r.epsTip || ""} style={{ ...td(A, "right"), color: r.eps >= 80 ? A.green : r.eps >= 50 ? A.yellow : r.eps != null ? A.red : A.textMuted }}>{r.eps ?? "—"}{r.epsAcc ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
                  <td style={{ ...td(A), fontSize: 11, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }}>
                    <LayerLink r={r} A={A} onLayer={onLayer} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


export default ScannerPanel;
