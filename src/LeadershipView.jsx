// ──────────────────────────────────────────────────────────────────────────
// LeadershipView — the one question ThemePulse now answers first:
//   what is LEADING, and what is BREAKING DOWN?
// Three levels, top-down: themes → layers → stocks.
//
// Data (all static, already produced by the pipeline):
//   /data/rs_rotation.json   — 162 layers with now/d1/w1/w2/m1 RS ranks, regime, holds
//   /data/rank_history.json  — daily layer ranks (key "themeId|layer"), ~90 sessions
//   /data/ticker_seats.json  — per-ticker top-decile persistence over the quarter
//   dashboard_data.json      — per-stock rs_rank / MAs (passed in as stockMap)
//
// Thresholds follow the layer backtest: rank >= 88 is the only level with an
// edge, so "leading" means >= 88 and holding. Early rotation (emerging) tested
// NEGATIVE, so it is shown but labelled unproven, never mixed in with leaders.
// ──────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from "react";

const LEAD = 88;          // layer leadership threshold (backtest)
const PEAK_LOOKBACK = 40; // sessions to look back for "was leading"
const SPARK_N = 60;       // sessions in each sparkline

const STATUS = {
  lead:  { label: "Leading",        hint: `Rank ≥ ${LEAD} and held ≥ 80 a week ago` },
  emerg: { label: "Emerging",       hint: "Rank ≥ 70 and up 20+ pts in a month — unproven: early rotation backtested negative" },
  weak:  { label: "Weakening",      hint: `Led (≥ ${LEAD}) within ${PEAK_LOOKBACK} sessions, now 60–87 and falling` },
  brk:   { label: "Breaking down",  hint: `Led (≥ ${LEAD}) within ${PEAK_LOOKBACK} sessions, now below 60` },
  lag:   { label: "Lagging",        hint: "Not leading and no recent leadership" },
};

function useJson(path) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    fetch(path, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setD(j); })
      .catch(() => {});
    return () => { live = false; };
  }, [path]);
  return d;
}

function statusColor(st, A) {
  return { lead: A.green, emerg: A.cyan, weak: A.yellow, brk: A.red, lag: A.textMuted }[st];
}

function classify({ now, w1, m1 }, hist) {
  const recent = hist.slice(-PEAK_LOOKBACK).filter((x) => x != null);
  const peak = recent.length ? Math.max(...recent) : now;
  if (now >= LEAD && (w1 ?? now) >= 80) return { st: "lead", peak };
  if (peak >= LEAD && now < 60) return { st: "brk", peak };
  if (peak >= LEAD && now < LEAD && now <= peak - 10) return { st: "weak", peak };
  if (now >= 70 && now - (m1 ?? now) >= 20) return { st: "emerg", peak };
  if (now >= LEAD) return { st: "lead", peak };
  return { st: "lag", peak };
}

function Spark({ vals, color, A, w = 90, h = 22 }) {
  const pts = vals.filter((v) => v != null);
  if (pts.length < 2) return <span style={{ display: "inline-block", width: w }} />;
  const step = w / (vals.length - 1);
  const y = (v) => h - (v / 100) * h;
  let d = "";
  vals.forEach((v, i) => { if (v != null) d += `${d ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`; });
  return (
    <svg width={w} height={h} style={{ display: "block", flexShrink: 0 }} aria-hidden>
      <line x1="0" x2={w} y1={y(LEAD)} y2={y(LEAD)} stroke={A.borderLight} strokeDasharray="2 2" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function Delta({ v, A }) {
  if (v == null || !Number.isFinite(v)) return <span style={{ color: A.textMuted }}>—</span>;
  const c = v > 0 ? A.green : v < 0 ? A.red : A.textMuted;
  return <span style={{ color: c }}>{v > 0 ? "+" : ""}{Math.round(v)}</span>;
}

function Card({ title, sub, right, children, A }) {
  return (
    <div style={{ background: A.bgCard, border: `1px solid ${A.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, color: A.text }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: A.textMuted }}>{sub}</div>}
        <div style={{ marginLeft: "auto" }}>{right}</div>
      </div>
      {children}
    </div>
  );
}

const th = (A, align = "left") => ({ textAlign: align, fontSize: 10, fontWeight: 600, color: A.textMuted, padding: "4px 6px", borderBottom: `1px solid ${A.border}`, whiteSpace: "nowrap", letterSpacing: 0.3 });
const td = (A, align = "left") => ({ textAlign: align, fontSize: 12, color: A.textDim, padding: "5px 6px", borderBottom: `1px solid ${A.border}`, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" });

function TickerChip({ t, onClick, active, A, dim }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(t); }}
      style={{
        background: active ? A.glowGreen : "transparent", border: `1px solid ${active ? A.green : A.border}`,
        color: dim ? A.textMuted : A.text, borderRadius: 4, padding: "1px 5px", fontSize: 11, cursor: "pointer",
        fontFamily: "monospace", marginRight: 3, marginBottom: 2,
      }}>{t}</button>
  );
}

// ── Themes ────────────────────────────────────────────────────────────────
function ThemeBoard({ themes, A, selected, onSelect }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
      {themes.map((t) => {
        const c = statusColor(t.st, A);
        const on = selected === t.themeId;
        return (
          <button key={t.themeId} onClick={() => onSelect(on ? null : t.themeId)}
            title={STATUS[t.st].hint}
            style={{
              textAlign: "left", cursor: "pointer", background: on ? A.bgHover : A.bgRow,
              borderStyle: "solid", borderWidth: "1px 1px 1px 3px", borderColor: `${on ? c : A.border} ${on ? c : A.border} ${on ? c : A.border} ${c}`, borderRadius: 6, padding: "7px 9px", color: A.text,
            }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{t.theme}</span>
              <span style={{ marginLeft: "auto", fontSize: 16, fontWeight: 700, color: c, fontVariantNumeric: "tabular-nums" }}>{Math.round(t.now)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <Spark vals={t.hist} color={c} A={A} w={96} h={20} />
              <div style={{ fontSize: 10, color: A.textMuted, lineHeight: 1.35 }}>
                <div>1w <Delta v={t.now - t.w1} A={A} /> · 1m <Delta v={t.now - t.m1} A={A} /></div>
                <div>
                  <span style={{ color: A.green }}>{t.counts.lead}▲</span>{" "}
                  <span style={{ color: A.yellow }}>{t.counts.weak}</span>{" "}
                  <span style={{ color: A.red }}>{t.counts.brk}▼</span>{" "}
                  / {t.layers.length}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Layers ────────────────────────────────────────────────────────────────
function LayerTable({ rows, A, onTicker, chartTicker, stockMap, showPeak, members, expanded, onToggle, focus }) {
  if (!rows.length) return <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 2px" }}>None.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th(A)}>Layer</th>
            <th style={th(A, "right")}>Rank</th>
            <th style={th(A, "right")}>1w</th>
            <th style={th(A, "right")}>1m</th>
            {showPeak && <th style={th(A, "right")}>Peak</th>}
            <th className="tp-hide-sm" style={th(A)}>{SPARK_N}d</th>
            <th className="tp-hide-sm" style={th(A, "right")} title="Share of the trailing quarter this layer ranked ≥ 88">Held</th>
            <th style={th(A)}>Strongest names <span style={{ fontWeight: 400 }}>· click a row for all</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const c = statusColor(l.st, A);
            const all = (members?.[l.key] || (l.holds || []).map((h) => h.t))
              .filter((t) => stockMap[t])
              .sort((a, b) => (stockMap[b]?.rs_rank ?? 0) - (stockMap[a]?.rs_rank ?? 0));
            const names = all.slice(0, 5).map((t) => ({ t }));
            const open = expanded === l.key;
            const cols = showPeak ? 8 : 7;
            return (
              <React.Fragment key={l.key}>
              <tr onClick={() => onToggle?.(open ? null : l.key)} style={{ cursor: "pointer", background: open ? A.bgHover : "transparent" }}>
                <td style={td(A)}>
                  <div style={{ color: A.text, fontWeight: 600 }}><span style={{ color: A.textMuted, fontSize: 9, marginRight: 4 }}>{open ? "▼" : "▶"}</span>{l.name}</div>
                  <div style={{ fontSize: 10, color: A.textMuted }}>{l.theme}</div>
                </td>
                <td style={{ ...td(A, "right"), color: c, fontWeight: 700 }}>{l.now}</td>
                <td style={td(A, "right")}><Delta v={l.now - l.w1} A={A} /></td>
                <td style={td(A, "right")}><Delta v={l.now - l.m1} A={A} /></td>
                {showPeak && <td style={td(A, "right")}>{l.peak}</td>}
                <td className="tp-hide-sm" style={td(A)}><Spark vals={l.hist} color={c} A={A} /></td>
                <td className="tp-hide-sm" style={td(A, "right")}>{l.persist != null ? `${l.persist}%` : "—"}</td>
                <td style={{ ...td(A), whiteSpace: "normal", minWidth: 160 }}>
                  {names.map((h) => (
                    <TickerChip key={h.t} t={h.t} onClick={(t) => { onTicker(t); }} active={chartTicker === h.t || focus === h.t} A={A}
                      dim={(stockMap[h.t]?.rs_rank ?? 0) < 80} />
                  ))}
                  {all.length > 5 && <span style={{ fontSize: 10, color: A.textMuted }}>+{all.length - 5}</span>}
                </td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={cols} style={{ ...td(A), whiteSpace: "normal", background: A.bgRow, padding: "8px 10px" }}>
                    <div style={{ fontSize: 10, color: A.textMuted, marginBottom: 5 }}>All {all.length} members by RS rank · click to chart</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {all.map((t) => {
                        const rs = stockMap[t]?.rs_rank;
                        const rc = rs >= 90 ? A.green : rs >= 70 ? A.yellow : A.red;
                        const hi = focus === t || chartTicker === t;
                        return (
                          <button key={t} onClick={(e) => { e.stopPropagation(); onTicker(t); }}
                            style={{ background: hi ? A.glowGreen : "transparent", border: `1px solid ${hi ? A.green : A.border}`, borderRadius: 4,
                              padding: "1px 6px", fontSize: 11, cursor: "pointer", color: A.text, fontFamily: "monospace" }}>
                            {t} <span style={{ color: rc, fontWeight: 700 }}>{rs ?? "—"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Stocks ────────────────────────────────────────────────────────────────
function StockTable({ rows, A, onTicker, chartTicker, mode }) {
  if (!rows.length) return <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 2px" }}>None.</div>;
  return (
    <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ position: "sticky", top: 0, background: A.bg }}>
          <tr>
            <th style={th(A)}>Ticker</th>
            <th style={th(A, "right")}>RS</th>
            {mode === "brk" && <th style={th(A, "right")} title="Share of the quarter in the top decile of RS">Held</th>}
            <th style={th(A, "right")}>vs 50d</th>
            <th style={th(A, "right")}>Off high</th>
            <th style={th(A, "right")}>1m</th>
            <th style={th(A)}>Layer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const on = chartTicker === r.ticker;
            const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
            return (
              <tr key={r.ticker} data-nav={r.ticker} onClick={() => onTicker(r.ticker)} style={{ cursor: "pointer", background: on ? A.bgHover : "transparent" }}>
                <td style={td(A)}>
                  <FlagButton t={r.ticker} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.ticker}</span>
                  {r.inLead && mode === "lead" && <span title="In a leading layer" style={{ color: A.green, marginLeft: 4 }}>●</span>}
                </td>
                <td style={{ ...td(A, "right"), color: r.rs >= 90 ? A.green : r.rs < 70 ? A.red : A.yellow, fontWeight: 700 }}>{r.rs ?? "—"}</td>
                {mode === "brk" && <td style={td(A, "right")}>{r.persist}%</td>}
                <td style={{ ...td(A, "right"), color: (r.sma50 ?? 0) >= 0 ? A.green : A.red }}>{pct(r.sma50)}</td>
                <td style={td(A, "right")}>{pct(r.off)}</td>
                <td style={{ ...td(A, "right"), color: (r.r1m ?? 0) >= 0 ? A.green : A.red }}>{pct(r.r1m)}</td>
                <td style={{ ...td(A), fontSize: 11, color: A.textMuted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.layer ? <span style={{ color: statusColor(r.layerSt, A) }}>{r.layer}</span> : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Tabs({ value, onChange, items, A }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {items.map(([k, label, n, color]) => (
        <button key={k} onClick={() => onChange(k)}
          style={{
            background: value === k ? A.bgHover : "transparent",
            border: `1px solid ${value === k ? color : A.border}`,
            color: value === k ? color : A.textDim, borderRadius: 4, padding: "3px 9px",
            fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}>{label} <span style={{ opacity: 0.7 }}>{n}</span></button>
      ))}
    </div>
  );
}

// ── Major indexes ─────────────────────────────────────────────────────────
// Daily bars from /api/ohlc (FMP) + today's live quote from /api/live, so the
// panel is current even when breadth.json is days old. Everything — trend
// state, MA distances, distribution days — is computed here from the bars.
export const LEAD_INDEXES = [
  { t: "SPY", name: "S&P 500" },
  { t: "QQQ", name: "Nasdaq 100" },
  { t: "IWM", name: "Russell 2000" },
  { t: "DIA", name: "Dow" },
  { t: "MDY", name: "S&P MidCap" },
  { t: "RSP", name: "S&P Equal Wt" },
];

const _ohlcCache = {};
function useIndexBars(tickers) {
  const [bars, setBars] = useState(() => {
    const m = {};
    tickers.forEach((t) => { if (_ohlcCache[t]) m[t] = _ohlcCache[t]; });
    return m;
  });
  const key = tickers.join(",");
  useEffect(() => {
    let live = true;
    key.split(",").forEach((t) => {
      if (_ohlcCache[t]) return;
      fetch(`/api/ohlc?ticker=${encodeURIComponent(t)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d?.ohlc?.length) return;
          _ohlcCache[t] = d.ohlc;
          if (live) setBars((p) => ({ ...p, [t]: d.ohlc }));
        })
        .catch(() => {});
    });
    return () => { live = false; };
  }, [key]);
  return bars;
}

function ema(vals, n) {
  const k = 2 / (n + 1);
  const out = [];
  let e = null;
  vals.forEach((v, i) => {
    e = e == null ? v : v * k + e * (1 - k);
    out.push(i >= n - 1 ? e : null);
  });
  return out;
}
function sma(vals, n) {
  const out = [];
  let s = 0;
  vals.forEach((v, i) => {
    s += v;
    if (i >= n) s -= vals[i - n];
    out.push(i >= n - 1 ? s / n : null);
  });
  return out;
}

// Append/patch today's bar from the live quote when the OHLC feed lags.
function withLive(bars, q) {
  if (!bars?.length || !q?.price) return bars;
  const last = bars[bars.length - 1];
  const near = (a, b) => a && b && Math.abs(a - b) / b < 0.0005;
  if (near(last.close, q.previousClose) && !near(q.price, q.previousClose)) {
    return [...bars, {
      date: "live", open: q.open ?? q.price, high: q.dayHigh ?? q.price, low: q.dayLow ?? q.price,
      close: q.price, volume: q.volume ?? 0,
    }];
  }
  return bars;
}

function indexStats(rawBars, q) {
  const bars = withLive(rawBars, q);
  if (!bars || bars.length < 210) return null;
  const c = bars.map((b) => b.close);
  const n = c.length, i = n - 1, px = c[i];
  const e21 = ema(c, 21), s50 = sma(c, 50), s200 = sma(c, 200);
  const pct = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);
  const yr = String(new Date().getFullYear());
  const prevYearIdx = bars.findIndex((b) => b.date !== "live" && String(b.date).startsWith(yr)) - 1;
  const hi52 = Math.max(...bars.slice(-252).map((b) => b.high));
  // Distribution days: down ≥ 0.2% on higher volume than the prior session,
  // within the last 25 sessions; one drops off once the index closes 5% above it.
  let dd = 0;
  for (let j = Math.max(1, n - 25); j < n; j++) {
    const ch = (c[j] - c[j - 1]) / c[j - 1];
    if (ch <= -0.002 && bars[j].volume > bars[j - 1].volume) {
      const later = Math.max(...c.slice(j + 1).concat([c[j]]));
      if (later < c[j] * 1.05) dd++;
    }
  }
  const s50Rising = s50[i] != null && s50[i - 10] != null && s50[i] > s50[i - 10];
  let trend, tone;
  if (px > e21[i] && e21[i] > s50[i] && s50[i] > s200[i]) { trend = "Uptrend"; tone = "green"; }
  else if (px > s50[i] && px > s200[i]) { trend = "Pullback"; tone = "yellow"; }
  else if (px > s200[i]) { trend = "Correction"; tone = "orange"; }
  else { trend = "Downtrend"; tone = "red"; }
  const spark = bars.slice(-63);
  return {
    px,
    day: q?.change ?? pct(c[i], c[i - 1]),
    w1: pct(px, c[i - 5]), m1: pct(px, c[i - 21]),
    ytd: prevYearIdx >= 0 ? pct(px, c[prevYearIdx]) : null,
    off: pct(px, hi52),
    v21: pct(px, e21[i]), v50: pct(px, s50[i]), v200: pct(px, s200[i]),
    s50Rising, trend, tone, dd,
    spark: { c: spark.map((b) => b.close), e21: e21.slice(-63), s50: s50.slice(-63) },
    asOf: bars[i].date === "live" ? "live" : bars[i].date,
  };
}

function IndexSpark({ s, A, color, w = 120, h = 30 }) {
  const all = [...s.c, ...s.e21, ...s.s50].filter((v) => v != null);
  const lo = Math.min(...all), hi = Math.max(...all), rng = hi - lo || 1;
  const step = w / (s.c.length - 1);
  const path = (arr) => {
    let d = "";
    arr.forEach((v, i) => { if (v != null) d += `${d ? "L" : "M"}${(i * step).toFixed(1)},${(h - ((v - lo) / rng) * h).toFixed(1)}`; });
    return d;
  };
  return (
    <svg width={w} height={h} style={{ display: "block" }} aria-hidden>
      <path d={path(s.s50)} fill="none" stroke={A.textMuted} strokeWidth="1" strokeDasharray="3 2" />
      <path d={path(s.e21)} fill="none" stroke={A.blue} strokeWidth="1" opacity="0.7" />
      <path d={path(s.c)} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function IndexPanel({ A, liveQuotes, onTicker, chartTicker, bars }) {
  const rows = LEAD_INDEXES.map((x) => ({ ...x, s: indexStats(bars[x.t], liveQuotes?.get?.(x.t)) }));
  const ready = rows.filter((r) => r.s);
  const toneC = (t) => ({ green: A.green, yellow: A.yellow, orange: "#fb923c", red: A.red }[t] || A.textDim);
  const up = ready.filter((r) => r.s.trend === "Uptrend").length;
  const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
  const pc = (v) => ({ color: v == null ? A.textMuted : v >= 0 ? A.green : A.red });
  const asOf = ready.find((r) => r.s.asOf)?.s.asOf;
  return (
    <Card A={A} title="Major indexes"
      sub={ready.length
        ? `${up} of ${ready.length} in an uptrend (above a rising 21e > 50d > 200d) · ${asOf === "live" ? "live" : `as of ${asOf}`} · line = price, blue = 21e, dashed = 50d`
        : "Loading index data…"}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 8 }}>
        {rows.map(({ t, name, s }) => {
          const on = chartTicker === t;
          const col = s ? toneC(s.tone) : A.textMuted;
          const stat = (label, v, title) => (
            <div title={title}>
              <div style={{ fontSize: 9, color: A.textMuted, letterSpacing: 0.3 }}>{label}</div>
              <div style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", ...pc(v) }}>{fmt(v)}</div>
            </div>
          );
          return (
            <button key={t} onClick={() => onTicker(t)}
              style={{
                textAlign: "left", cursor: "pointer", background: on ? A.bgHover : A.bgRow, color: A.text,
                borderStyle: "solid", borderWidth: "1px 1px 1px 3px",
                borderColor: `${on ? col : A.border} ${on ? col : A.border} ${on ? col : A.border} ${col}`,
                borderRadius: 6, padding: "7px 9px",
              }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 13 }}>{t}</span>
                <span style={{ color: A.textMuted, fontSize: 10 }}>{name}</span>
                {s && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: col }}>{s.trend.toUpperCase()}</span>}
              </div>
              {s ? (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.px.toFixed(2)}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, ...pc(s.day) }}>{fmt(s.day, 2)}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: s.dd >= 6 ? A.red : s.dd >= 4 ? A.yellow : A.textMuted, fontWeight: s.dd >= 4 ? 700 : 400 }}
                      title="Distribution days, last 25 sessions (down ≥ 0.2% on higher volume; drops off after a 5% rally)">
                      {s.dd} dist
                    </span>
                  </div>
                  <div style={{ margin: "4px 0" }}><IndexSpark s={s.spark} A={A} color={col} w={195} h={32} /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 }}>
                    {stat("1W", s.w1)}{stat("1M", s.m1)}{stat("YTD", s.ytd)}{stat("OFF HI", s.off, "Off the 52-week high")}
                    {stat("21E", s.v21, "Distance from the 21-day EMA")}
                    {stat(`50D ${s.s50Rising ? "↗" : "↘"}`, s.v50, s.s50Rising ? "50-day rising" : "50-day falling")}
                    {stat("200D", s.v200, "Distance from the 200-day")}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: A.textMuted, padding: "14px 0" }}>loading…</div>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ── What changed today ────────────────────────────────────────────────────
// Diff of today vs the prior session: layers crossing the leadership line,
// layers breaking down, the biggest rank moves, theme moves, and index trend
// changes (computed by re-running indexStats without today's bar).
function ChangesPanel({ A, layers, themes, bars, liveQuotes, date, onTicker, onLayer, onTheme }) {
  const idxEvents = [];
  LEAD_INDEXES.forEach(({ t }) => {
    const q = liveQuotes?.get?.(t);
    const full = withLive(bars[t], q);
    if (!full || full.length < 212) return;
    const now = indexStats(bars[t], q), prev = indexStats(full.slice(0, -1), null);
    if (!now || !prev) return;
    if (now.trend !== prev.trend) idxEvents.push({ t, text: `${prev.trend} → ${now.trend}`, good: ["Uptrend", "Pullback", "Correction", "Downtrend"].indexOf(now.trend) < ["Uptrend", "Pullback", "Correction", "Downtrend"].indexOf(prev.trend) });
    [["21e", "v21"], ["50d", "v50"], ["200d", "v200"]].forEach(([lbl, k]) => {
      if (prev[k] != null && now[k] != null && Math.sign(prev[k]) !== Math.sign(now[k]))
        idxEvents.push({ t, text: `${now[k] > 0 ? "reclaimed" : "lost"} ${lbl}`, good: now[k] > 0 });
    });
    if (now.dd > prev.dd) idxEvents.push({ t, text: `distribution day (${now.dd})`, good: false });
  });

  const gained = layers.filter((l) => l.now >= LEAD && (l.d1 ?? l.now) < LEAD).sort((a, b) => b.now - a.now);
  const lost = layers.filter((l) => (l.d1 ?? 0) >= LEAD && l.now < LEAD).sort((a, b) => a.now - b.now);
  const broke = layers.filter((l) => l.st === "brk" && (l.d1 ?? 0) >= 60 && l.now < 60);
  const moves = layers.filter((l) => l.d1 != null).map((l) => ({ l, d: l.now - l.d1 }));
  const up = moves.filter((m) => m.d >= 5).sort((a, b) => b.d - a.d).slice(0, 6);
  const dn = moves.filter((m) => m.d <= -5).sort((a, b) => a.d - b.d).slice(0, 6);
  const themeMoves = themes.map((t) => {
    const d1 = t.layers.reduce((s, l) => s + (l.d1 ?? l.now), 0) / t.layers.length;
    return { t, d: t.now - d1 };
  }).filter((x) => Math.abs(x.d) >= 2).sort((a, b) => b.d - a.d);

  const chip = (key, label, sub, color, onClick, title) => (
    <button key={key} onClick={onClick} title={title}
      style={{
        background: "transparent", border: `1px solid ${A.border}`, borderRadius: 4, padding: "2px 7px",
        fontSize: 11, color: A.text, cursor: "pointer", marginRight: 4, marginBottom: 4, whiteSpace: "nowrap",
      }}>
      {label} <span style={{ color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{sub}</span>
    </button>
  );
  const row = (label, color, items) => items.length ? (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 2 }}>
      <div className="tp-lead-label" style={{ width: 118, flexShrink: 0, fontSize: 10, fontWeight: 700, color, letterSpacing: 0.3, paddingTop: 4 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap" }}>{items}</div>
    </div>
  ) : null;
  const layerChip = (l, color, sub) => chip(l.key, l.name, sub ?? `${l.d1}→${l.now}`, color, () => onLayer(l), `${l.theme} · ${STATUS[l.st].label}`);
  const empty = !idxEvents.length && !gained.length && !lost.length && !broke.length && !up.length && !dn.length && !themeMoves.length;

  return (
    <Card A={A} title="What changed today" sub={`vs the prior session${date ? ` · layers as of ${date}` : ""} · click a layer to jump to it`}>
      {empty && <div style={{ fontSize: 11, color: A.textMuted }}>No notable changes.</div>}
      {row("INDEXES", A.text, idxEvents.map((e, i) => chip(`${e.t}${i}`, e.t, e.text, e.good ? A.green : A.red, () => onTicker(e.t))))}
      {row("NEW LEADERS", A.green, gained.map((l) => layerChip(l, A.green)))}
      {row("LOST LEADERSHIP", A.yellow, lost.map((l) => layerChip(l, A.yellow)))}
      {row("BROKE DOWN", A.red, broke.map((l) => layerChip(l, A.red)))}
      {row("BIGGEST GAINS", A.green, up.map(({ l, d }) => layerChip(l, A.green, `+${d}`)))}
      {row("BIGGEST DROPS", A.red, dn.map(({ l, d }) => layerChip(l, A.red, `${d}`)))}
      {row("THEMES", A.textDim, themeMoves.map(({ t, d }) => chip(t.themeId, t.theme, `${d > 0 ? "+" : ""}${d.toFixed(0)}`, d > 0 ? A.green : A.red, () => onTheme(t.themeId))))}
    </Card>
  );
}


// ── Intraday scan ─────────────────────────────────────────────────────────
// Nitin's intraday screen. Structural filters (stored, from the pipeline)
// narrow the universe to a few hundred names; live filters run on fresh
// /api/live quotes, polled every 60s while the tab is open.
//   structural: mcap > $300M · ADR > 2% · avg vol ≥ 500K · avg $vol ≥ $25M · SMA50 > SMA200 ·
//               revenue (last FQ) > 0
//   live:       price >= $7 · vol > 50K · rel vol > 0.1 · chg > 0% ·
//               within 30% of the 52w high · >= 30% above the 52w low ·
//               price > SMA200 · price > EMA50
//   column:     change from open % (default sort)
function useScanQuotes(tickers, active) {
  const [quotes, setQuotes] = useState(() => new Map());
  const [at, setAt] = useState(null);
  const key = tickers.join(",");
  useEffect(() => {
    if (!active || !key) return;
    let live = true;
    const pull = async () => {
      if (document.hidden) return;
      const list = key.split(",");
      const m = new Map();
      for (let i = 0; i < list.length; i += 500) {
        try {
          const r = await fetch(`/api/live?universe=${encodeURIComponent(list.slice(i, i + 500).join(","))}`);
          const d = r.ok ? await r.json() : null;
          (d?.theme_universe || d?.universe || []).forEach((q) => { if (q?.ticker) m.set(q.ticker, q); });
        } catch { /* keep last */ }
      }
      if (live && m.size) { setQuotes(m); setAt(new Date()); }
    };
    // FMP budget: 60s polls only during regular hours. Outside them the scan
    // shows the saved closing ZVR, so a slow 15-min refresh is plenty.
    pull();
    let id;
    const schedule = () => {
      id = setTimeout(async () => { await pull(); if (live) schedule(); }, etClock().rth ? 60000 : 15 * 60000);
    };
    schedule();
    // fetch as soon as a background tab is brought forward, instead of
    // waiting for the next tick
    const onVis = () => { if (!document.hidden) pull(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { live = false; clearTimeout(id); document.removeEventListener("visibilitychange", onVis); };
  }, [key, active]);
  return { quotes, at };
}

// Zanger Volume Ratio — identical to the Scan/Chain tables' calcZVR fallback:
// live volume ÷ (avg volume × fraction of a normal day's volume done by now,
// from the intraday U-profile), × 100. 100 = average pace, 200 = double.
const VOL_PROFILE = [[0, 0], [5, 0.04], [15, 0.08], [30, 0.13], [60, 0.21], [90, 0.27], [120, 0.33], [150, 0.38], [180, 0.43], [210, 0.48], [240, 0.53], [270, 0.59], [300, 0.66], [330, 0.74], [360, 0.84], [375, 0.91], [390, 1]];
function sessionElapsedFrac() {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const m = et.getHours() * 60 + et.getMinutes() - 570;
  if (et.getDay() === 0 || et.getDay() === 6 || m < 0 || m >= 390) return 1;
  for (let i = 1; i < VOL_PROFILE.length; i++) {
    const [m1, f1] = VOL_PROFILE[i - 1], [m2, f2] = VOL_PROFILE[i];
    if (m <= m2) return Math.max(0.02, f1 + (f2 - f1) * (m - m1) / (m2 - m1));
  }
  return 1;
}

// Session clock in ET. Outside regular hours the scan shows each name's LAST
// ZVR from the session (saved to localStorage on every RTH refresh) instead of
// recomputing from a quote whose volume may include extended-hours trading.
function etClock() {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const mins = et.getHours() * 60 + et.getMinutes();
  const wkday = et.getDay() >= 1 && et.getDay() <= 5;
  const rth = wkday && mins >= 570 && mins < 960;
  // the session the closing values belong to: today once it has opened,
  // otherwise the previous weekday
  const last = new Date(et);
  if (!(wkday && mins >= 570)) {
    do { last.setDate(last.getDate() - 1); } while (last.getDay() === 0 || last.getDay() === 6);
  }
  return { rth, today: ymd(et), session: ymd(last) };
}
const ZVR_SNAP_KEY = "tp-zvr-close-v2"; // v2: ratio vs 10-session avg (v1 was % vs 50d)
function readZvrSnap() {
  try { return JSON.parse(localStorage.getItem(ZVR_SNAP_KEY) || "null"); } catch { return null; }
}
function writeZvrSnap(date, map) {
  try { localStorage.setItem(ZVR_SNAP_KEY, JSON.stringify({ date, at: new Date().toISOString(), z: map })); } catch { /* storage off */ }
}

function scanBase(s, session) {
  if (!s?.ticker) return null;
  const c = s.close || s.price;
  if (!c) return null;
  // Levels come straight from the pipeline's daily bars (TradingView-
  // equivalent: 20d ADR, SMA50/200, EMA50, 52w high/low). The older pct
  // fields are only a fallback — they disagreed with TV (PANW ADR 1.4% vs 5.6%).
  const lvl = (pct) => (pct == null ? null : c / (1 + pct / 100));
  const sma50 = s.sma50_lvl ?? lvl(s.sma50_pct);
  const sma200 = s.sma200_lvl ?? lvl(s.sma200_pct);
  const ema50 = s.ema50_lvl ?? lvl(s.ema50_pct);
  const hi52 = s.hi52_lvl ?? lvl(s.off_52w_high);
  const lo52 = s.lo52_lvl ?? lvl(s.above_52w_low);
  const adr = s.adr20 ?? s.adr_pct;
  const rev = s.last_earnings_actual_revenue ?? (Array.isArray(s.quarters) ? s.quarters[0]?.revenue : null);
  if ((s.market_cap_raw ?? 0) <= 300e6) return null;
  if ((adr ?? 0) <= 2) return null;                            // ADR (20d) > 2%
  if ((s.avg_volume_raw ?? 0) < 500e3) return null;           // avg volume ≥ 500K shares
  const adv = s.avg_dollar_vol_raw ?? ((s.avg_volume_raw ?? 0) * c);
  if (adv < 25e6) return null;                                 // avg $ volume ≥ $25M
  if (!(sma50 && sma200 && sma50 > sma200)) return null;
  if (!(rev > 0)) return null;
  // ZVR baseline = the 10 sessions BEFORE the one being measured: once the
  // pipeline has the measured session as its last bar, use the prior-10 avg
  const avg10 = (s.last_bar_date && s.last_bar_date === session && s.avg_vol_10d_prior) || s.avg_vol_10d || s.avg_volume_raw;
  return { t: s.ticker, sma200, ema50, hi52, lo52, avgVol: s.avg_volume_raw, avg10, adr, rs: s.rs_rank };
}


// Exact "relative volume at time": each stock's own average cumulative volume
// by this minute over the last 10 sessions (pipeline: 10e_rvol_profiles.py,
// 78 five-minute marks). Returns null outside RTH or without a profile, so the
// caller falls back to the generic session curve.
function rthMinute() {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const m = et.getHours() * 60 + et.getMinutes() + et.getSeconds() / 60 - 570;
  return et.getDay() >= 1 && et.getDay() <= 5 && m > 0 && m < 390 ? m : null;
}
function expectedVolAt(p, m) {
  if (!Array.isArray(p) || p.length < 78 || m == null) return null;
  const t = m / 5, k = Math.floor(t);
  const v = k === 0 ? p[0] * t : p[k - 1] + (p[Math.min(k, 77)] - p[k - 1]) * (t - k);
  return v > 0 ? v : null;
}

function IntradayScan({ A, stockMap, onTicker, chartTicker, tickerLayer, allowed }) {
  const profiles = useJson("/data/rvol_profiles.json");
  const base = useMemo(() => Object.values(stockMap || {}).map((x) => scanBase(x, etClock().session)).filter(Boolean)
    .filter((b) => !allowed || allowed.has(b.t)), [stockMap, allowed]);
  const { quotes, at } = useScanQuotes(base.map((b) => b.t), true);
  const [sort, setSort] = useState({ k: "fromOpen", d: -1 });
  const clock = etClock();
  const snap = useMemo(() => (clock.rth ? null : readZvrSnap()), [clock.rth, quotes]);
  const snapOk = !clock.rth && snap?.date === clock.session && snap?.z;
  const rows = useMemo(() => {
    const frac = sessionElapsedFrac();
    const rm = rthMinute();
    const zvrOf = (b, vol) => {
      const exp = expectedVolAt(profiles?.p?.[b.t], rm);
      if (exp) return +(vol / exp).toFixed(2);
      return b.avg10 ? +(vol / (b.avg10 * frac)).toFixed(2) : null;
    };
    const out = [];
    base.forEach((b) => {
      const q = quotes.get(b.t);
      if (!q?.price) return;
      const px = q.price, vol = q.volume ?? 0;
      const hi = Math.max(b.hi52 || 0, q.yearHigh || 0) || null;
      const lo = Math.min(...[b.lo52, q.yearLow].filter((v) => v > 0)) || null;
      const offHi = hi ? (px / hi - 1) * 100 : null;
      const aboveLo = lo ? (px / lo - 1) * 100 : null;
      const chg = q.change ?? (q.previousClose ? (px / q.previousClose - 1) * 100 : null);
      const fromOpen = q.open ? (px / q.open - 1) * 100 : null;
      // RVol at time (TradingView-style): today's volume ÷ (10-session avg ×
      // share of a normal day's volume done by now). 1.00 = normal pace.
      const liveZvr = zvrOf(b, vol);
      const zvr = snapOk && snap.z[b.t] != null ? snap.z[b.t] : liveZvr;
      if (px < 7 || vol <= 50e3 || !(zvr > 0.1) || !(chg > 0)) return;
      if (offHi == null || offHi < -30) return;
      if (aboveLo == null || aboveLo < 30) return;
      if (!(px > b.sma200) || !(b.ema50 && px > b.ema50)) return;
      const L = tickerLayer[b.t];
      out.push({ t: b.t, px, zvr, chg, fromOpen, adr: b.adr, offHi, rs: b.rs, layer: L?.name, layerSt: L?.st });
    });
    const k = sort.k, d = sort.d;
    out.sort((x, y) => ((x[k] ?? -1e9) - (y[k] ?? -1e9)) * d);
    return out;
  }, [base, quotes, tickerLayer, sort, snap, snapOk, profiles]);
  // During RTH, persist every structural-pass name's ZVR (not just the rows
  // that pass today's live filters) so the after-hours view has a value.
  useEffect(() => {
    if (!clock.rth || !quotes.size) return;
    const frac = sessionElapsedFrac();
    const rm = rthMinute();
    const z = {};
    base.forEach((b) => {
      const q = quotes.get(b.t);
      if (!q?.price || !b.avg10) return;
      const exp = expectedVolAt(profiles?.p?.[b.t], rm);
      z[b.t] = +(((q.volume ?? 0) / (exp || b.avg10 * frac))).toFixed(2);
    });
    writeZvrSnap(clock.today, z);
  }, [quotes, base, clock.rth, clock.today, profiles]);
  const col = (k, label, align = "right", title) => (
    <th style={{ ...th(A, align), cursor: "pointer", color: sort.k === k ? A.text : A.textMuted }} title={title}
      onClick={() => setSort((p) => ({ k, d: p.k === k ? -p.d : -1 }))}>{label}{sort.k === k ? (sort.d < 0 ? " ▼" : " ▲") : ""}</th>
  );
  const pct = (v, dgt = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dgt)}%`);
  return (
    <div>
      <div style={{ fontSize: 10, color: A.textMuted, marginBottom: 6 }}>
        {at ? `Live · ${at.toLocaleTimeString()} · refreshes every ${clock.rth ? "60s" : "15 min (market closed)"}` : "Loading live quotes…"}
        {!clock.rth && (snapOk
          ? ` · ZVR at close (${snap.date}, last saved ${new Date(snap.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`
          : " · ZVR = full-session volume ÷ average (no intraday snapshot saved for the last session)")} · {base.length} pass the structural filters · {rows.length} pass all
      </div>
      {!rows.length ? <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 2px" }}>{at ? "Nothing passes right now." : ""}</div> : (
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: A.bg }}>
              <tr>
                <th style={th(A)}>Ticker</th>
                {col("zvr", "ZVR", "right", "Relative volume at time (TradingView-style): today's volume ÷ the 10-session average × the share of a normal day's volume done by now. 1.00 = normal pace. After hours: the last value from the session")}{col("chg", "Chg")}{col("fromOpen", "From open")}
                {col("adr", "ADR")}{col("offHi", "Off high")}{col("rs", "RS")}
                <th style={th(A)}>Layer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t} data-nav={r.t} onClick={() => onTicker(r.t)} style={{ cursor: "pointer", background: chartTicker === r.t ? A.bgHover : "transparent" }}>
                  <td style={td(A)}><FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span></td>
                  <td style={{ ...td(A, "right"), color: r.zvr >= 1.5 ? A.green : r.zvr >= 1 ? A.text : A.textMuted, fontWeight: r.zvr >= 1.5 ? 700 : 400 }}>{r.zvr == null ? "—" : r.zvr.toFixed(2)}</td>
                  <td style={{ ...td(A, "right"), color: A.green }}>{pct(r.chg, 2)}</td>
                  <td style={{ ...td(A, "right"), color: (r.fromOpen ?? 0) >= 0 ? A.green : A.red, fontWeight: 700 }}>{pct(r.fromOpen, 2)}</td>
                  <td style={td(A, "right")}>{r.adr == null ? "—" : `${r.adr.toFixed(1)}%`}</td>
                  <td style={td(A, "right")}>{pct(r.offHi)}</td>
                  <td style={{ ...td(A, "right"), color: r.rs >= 90 ? A.green : r.rs >= 70 ? A.yellow : A.red }}>{r.rs ?? "—"}</td>
                  <td style={{ ...td(A), fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.layer ? <span style={{ color: statusColor(r.layerSt, A) }}>{r.layer}</span> : <span style={{ color: A.textMuted }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Pre/After-market movers ───────────────────────────────────────────────
// Today's pre-market movers and the last session's after-hours movers, from
// the pipeline's session-stamped snapshots (last_pm / last_ah — the live ah_*
// lists are emptied by the morning scrape). Earnings movers are flagged ER.
function extRows(snap, stockMap, tickerLayer, universeOnly) {
  if (!snap) return [];
  const seen = new Map();
  const add = (list, er) => (list || []).forEach((m) => {
    const t = m?.ticker;
    if (!t || seen.has(t)) return;
    const chg = m.ext_hours_change_pct ?? m.change_pct;
    const s = stockMap?.[t];
    const L = tickerLayer[t];
    const head = (m.headlines || [])[0] || "";
    seen.set(t, {
      t, chg, price: m.price, vol: m.volume, er,
      grade: m.ep_quality_label || null,
      catalyst: head.replace(/\s*\[[^\]]*\]\s*$/, ""),
      rs: s?.rs_rank ?? m.rs_rank ?? null,
      inU: !!s, layer: L?.name, layerSt: L?.st,
    });
  });
  add(snap.earnings, true);
  add(snap.movers, false);
  add(snap.top, false);
  return [...seen.values()]
    .filter((r) => r.chg != null && r.chg !== 0)
    .filter((r) => !universeOnly || (r.inU && (r.price ?? 0) >= 5))
    .sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
}

function ExtHoursMovers({ A, pipeline, stockMap, tickerLayer, onTicker, chartTicker }) {
  const [uOnly, setUOnly] = useState(true);
  const today = etClock().today;
  const pmSnap = pipeline?.last_pm || (pipeline?.pm_sip_movers?.length || pipeline?.pm_earnings_movers?.length
    ? { session: null, earnings: pipeline.pm_earnings_movers, movers: pipeline.pm_sip_movers, top: pipeline.pm_top_movers } : null);
  const ahSnap = pipeline?.last_ah || (pipeline?.ah_sip_movers?.length || pipeline?.ah_earnings_movers?.length
    ? { session: null, earnings: pipeline.ah_earnings_movers, movers: pipeline.ah_sip_movers, top: pipeline.ah_top_movers } : null);
  const pmRows = useMemo(() => extRows(pmSnap, stockMap, tickerLayer, uOnly), [pmSnap, stockMap, tickerLayer, uOnly]);
  const ahRows = useMemo(() => extRows(ahSnap, stockMap, tickerLayer, uOnly), [ahSnap, stockMap, tickerLayer, uOnly]);
  const fmtVol = (v) => (v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(v));
  // Click-to-sort, shared by both tables. Default: biggest move either way.
  const [sort, setSort] = useState({ k: "absChg", d: -1 });
  const TEXT = new Set(["t", "layer", "catalyst"]);
  const sorted = (rows) => {
    const { k, d } = sort;
    const val = (r) => (k === "absChg" ? Math.abs(r.chg) : r[k]);
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null || x === "") return 1;      // blanks always last
      if (y == null || y === "") return -1;
      return (TEXT.has(k) ? String(x).localeCompare(String(y)) : x - y) * d;
    });
  };
  const hdr = (k, label, align = "left", title) => {
    const on = sort.k === k || (k === "chg" && sort.k === "absChg");
    return (
      <th title={title} style={{ ...th(A, align), cursor: "pointer", userSelect: "none", color: on ? A.text : A.textMuted }}
        onClick={() => setSort((p) => (p.k === k ? { k, d: -p.d } : { k, d: TEXT.has(k) ? 1 : -1 }))}>
        {label}{sort.k === k ? (sort.d < 0 ? " ▼" : " ▲") : ""}
      </th>
    );
  };
  const section = (title, sub, rows0) => { const rows = sorted(rows0); return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "2px 0 6px" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: A.text }}>{title}</span>
        <span style={{ fontSize: 10, color: A.textMuted }}>{sub}</span>
      </div>
      {!rows.length ? <div style={{ fontSize: 11, color: A.textMuted, padding: "4px 2px" }}>No movers{uOnly ? " in the universe (≥ $5)" : ""}.</div> : (
        <div style={{ overflowX: "auto", maxHeight: 340, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: A.bg }}>
              <tr>
                {hdr("t", "Ticker")}{hdr("chg", "Chg", "right", "Default order is biggest move either way; click to sort high → low")}{hdr("price", "Price", "right")}
                {hdr("vol", "Vol", "right")}{hdr("rs", "RS", "right")}{hdr("layer", "Layer")}{hdr("catalyst", "Catalyst")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t} data-nav={r.t} onClick={() => onTicker(r.t)} style={{ cursor: "pointer", background: chartTicker === r.t ? A.bgHover : "transparent" }}>
                  <td style={td(A)}>
                    <FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span>
                    {r.er && <span title={r.grade ? `Earnings · EP quality ${r.grade}` : "Earnings"} style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: A.cyan, border: `1px solid ${A.cyan}`, borderRadius: 3, padding: "0 3px" }}>ER</span>}
                  </td>
                  <td style={{ ...td(A, "right"), color: r.chg >= 0 ? A.green : A.red, fontWeight: 700 }}>{r.chg > 0 ? "+" : ""}{r.chg.toFixed(2)}%</td>
                  <td style={td(A, "right")}>{r.price ? r.price.toFixed(2) : "—"}</td>
                  <td style={td(A, "right")}>{fmtVol(r.vol)}</td>
                  <td style={{ ...td(A, "right"), color: r.rs >= 90 ? A.green : r.rs >= 70 ? A.yellow : r.rs != null ? A.red : A.textMuted }}>{r.rs ?? "—"}</td>
                  <td style={{ ...td(A), fontSize: 11, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.layer ? <span style={{ color: statusColor(r.layerSt, A) }}>{r.layer}</span> : <span style={{ color: A.textMuted }}>—</span>}
                  </td>
                  <td title={r.catalyst} style={{ ...td(A), fontSize: 11, color: A.textDim, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>{r.catalyst || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  ); };
  const pmSub = pmSnap?.session
    ? (pmSnap.session === today ? `today · scanned ${String(pmSnap.scanned || "").slice(11)} ET` : `no scan yet today — last: ${pmSnap.session}`)
    : "today";
  const ahSub = ahSnap?.session ? `${ahSnap.session} close · scanned ${String(ahSnap.scanned || "").slice(5)} ET` : (ahSnap ? "last session" : "no after-hours scan saved yet");
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <label style={{ fontSize: 11, color: A.textDim, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={uOnly} onChange={(e) => setUOnly(e.target.checked)} /> Universe only, ≥ $5
        </label>
      </div>
      {section("Pre-market", pmSub, pmRows)}
      {section("After-hours", ahSub, ahRows)}
    </div>
  );
}

// ── Flags (red / blue / gold) ─────────────────────────────────────────────
// Synced across devices via /api/userdata?scope=flags (per-ticker, latest
// timestamp wins; clearing writes a null-color tombstone). A module-level
// store keeps every table on the page in step; localStorage gives an
// instant first paint before the server answers.
const FLAG_ORDER = ["red", "blue", "gold"];
const FLAG_LS = "tp-flags";
const _flags = { map: {}, subs: new Set(), loading: null };
try { _flags.map = JSON.parse(localStorage.getItem(FLAG_LS) || "{}") || {}; } catch { _flags.map = {}; }
function _flagsNotify() {
  try { localStorage.setItem(FLAG_LS, JSON.stringify(_flags.map)); } catch { /* storage off */ }
  _flags.subs.forEach((fn) => fn({ ..._flags.map }));
}
function _flagsMerge(remote) {
  let changed = false;
  for (const [t, v] of Object.entries(remote || {})) {
    const cur = _flags.map[t];
    if (!cur || String(cur.at || "") < String(v.at || "")) { _flags.map[t] = v; changed = true; }
  }
  return changed;
}
function _flagsPost(entries) {
  return fetch("/api/userdata?scope=flags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flags: entries }) }).catch(() => {});
}
function _flagsPull() {
  if (_flags.loading) return _flags.loading;
  _flags.loading = fetch("/api/userdata?scope=flags", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d?.flags) return;
      // push local entries the server hasn't seen (made offline / before it loaded)
      const mine = {};
      for (const [t, v] of Object.entries(_flags.map)) {
        const sv = d.flags[t];
        if (!sv || String(sv.at || "") < String(v.at || "")) mine[t] = v;
      }
      if (_flagsMerge(d.flags)) _flagsNotify();
      if (Object.keys(mine).length) _flagsPost(mine);
    })
    .catch(() => {})
    .finally(() => { _flags.loading = null; });
  return _flags.loading;
}
function setFlag(ticker, color) {
  const v = { c: color || null, at: new Date().toISOString() };
  _flags.map[ticker] = v;
  _flagsNotify();
  _flagsPost({ [ticker]: v });
}
function useFlags() {
  const [map, setMap] = useState(() => ({ ..._flags.map }));
  useEffect(() => {
    _flags.subs.add(setMap);
    _flagsPull();
    const onFocus = () => { if (!document.hidden) _flagsPull(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      _flags.subs.delete(setMap);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return map;
}
const flagHex = (c, A) => ({ red: A.red, blue: A.blue, gold: A.gold || "#e3b341" }[c]);

function FlagButton({ t, A }) {
  const flags = useFlags();
  const c = flags[t]?.c || null;
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block", marginRight: 5 }} onClick={(e) => e.stopPropagation()}>
      <button aria-label={c ? `Flagged ${c}, change flag` : "Flag"} title={c ? `Flagged ${c}` : "Flag"} onClick={() => setOpen((o) => !o)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, lineHeight: 1,
          color: c ? flagHex(c, A) : A.textMuted, opacity: c ? 1 : 0.45 }}>
        {c ? "⚑" : "⚐"}
      </button>
      {open && (
        <span style={{ position: "absolute", top: 16, left: -4, zIndex: 30, display: "flex", gap: 6, alignItems: "center",
          background: A.bgCard, border: `1px solid ${A.borderLight}`, borderRadius: 6, padding: "5px 7px", boxShadow: A.shadow, whiteSpace: "nowrap", backdropFilter: "blur(12px)" }}>
          {FLAG_ORDER.map((k) => (
            <button key={k} aria-label={`Flag ${k}`} title={k} onClick={() => { setFlag(t, k); setOpen(false); }}
              style={{ width: 16, height: 16, borderRadius: "50%", cursor: "pointer", background: flagHex(k, A),
                border: c === k ? `2px solid ${A.text}` : "2px solid transparent", padding: 0 }} />
          ))}
          {c && <button onClick={() => { setFlag(t, null); setOpen(false); }}
            style={{ background: "none", border: "none", color: A.textDim, cursor: "pointer", fontSize: 10, padding: "0 2px" }}>clear</button>}
        </span>
      )}
    </span>
  );
}

function FlaggedTab({ A, stockMap, tickerLayer, onTicker, chartTicker }) {
  const flags = useFlags();
  const profiles = useJson("/data/rvol_profiles.json");
  const [only, setOnly] = useState(null);
  const tickers = Object.entries(flags).filter(([, v]) => v?.c).map(([t]) => t).sort();
  const { quotes, at } = useScanQuotes(tickers, true);
  // default: grouped by flag colour; header clicks sort like the Intraday scan
  const [sort, setSort] = useState({ k: "flag", d: 1 });
  const clock = etClock();
  const snap = useMemo(() => (clock.rth ? null : readZvrSnap()), [clock.rth, quotes]);
  const snapOk = !clock.rth && snap?.date === clock.session && snap?.z;
  const frac = sessionElapsedFrac();
  const rm = rthMinute();
  // Same columns and maths as the Intraday scan, but no filters: a flagged
  // name shows even when it fails the scan today.
  const rows = tickers.filter((t) => !only || flags[t].c === only).map((t) => {
    const q = quotes.get(t), s = stockMap?.[t] || {}, L = tickerLayer[t];
    const c0 = s.close || s.price;
    const px = q?.price ?? c0 ?? null;
    const hiLvl = s.hi52_lvl ?? (c0 && s.off_52w_high != null ? c0 / (1 + s.off_52w_high / 100) : null);
    const hi = Math.max(hiLvl || 0, q?.yearHigh || 0) || null;
    const avg10 = (s.last_bar_date && s.last_bar_date === clock.session && s.avg_vol_10d_prior) || s.avg_vol_10d || s.avg_volume_raw;
    let zvr = null;
    if (snapOk && snap.z[t] != null) zvr = snap.z[t];
    else if (q?.volume != null) {
      const exp = expectedVolAt(profiles?.p?.[t], rm);
      zvr = exp ? +(q.volume / exp).toFixed(2) : avg10 ? +(q.volume / (avg10 * frac)).toFixed(2) : null;
    }
    return {
      t, c: flags[t].c, flag: FLAG_ORDER.indexOf(flags[t].c), px, zvr,
      chg: q?.change ?? (q?.previousClose ? (q.price / q.previousClose - 1) * 100 : s.change_pct ?? null),
      fromOpen: q?.open ? (q.price / q.open - 1) * 100 : null,
      adr: s.adr20 ?? s.adr_pct ?? null,
      offHi: hi && px ? (px / hi - 1) * 100 : null,
      rs: s.rs_rank ?? null, layer: L?.name, layerSt: L?.st,
    };
  });
  rows.sort((a, b) => {
    const { k, d } = sort;
    const x = a[k], y = b[k];
    if (x == null && y == null) return a.t.localeCompare(b.t);
    if (x == null) return 1;
    if (y == null) return -1;
    return ((x - y) * d) || a.t.localeCompare(b.t);
  });
  const col = (k, label, align = "right", title) => (
    <th style={{ ...th(A, align), cursor: "pointer", userSelect: "none", color: sort.k === k ? A.text : A.textMuted }} title={title}
      onClick={() => setSort((p) => ({ k, d: p.k === k ? -p.d : k === "flag" ? 1 : -1 }))}>{label}{sort.k === k ? (sort.d < 0 ? " ▼" : " ▲") : ""}</th>
  );
  const pct = (v, dgt = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dgt)}%`);
  const counts = Object.fromEntries(FLAG_ORDER.map((k) => [k, tickers.filter((t) => flags[t].c === k).length]));
  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        {[null, ...FLAG_ORDER].map((k) => (
          <button key={k || "all"} onClick={() => setOnly(k)}
            style={{ display: "flex", alignItems: "center", gap: 5, background: only === k ? A.bgHover : "transparent",
              border: `1px solid ${only === k ? A.borderLight : A.border}`, borderRadius: 4, padding: "2px 8px", fontSize: 11, color: A.text, cursor: "pointer" }}>
            {k ? <span style={{ width: 9, height: 9, borderRadius: "50%", background: flagHex(k, A) }} /> : null}
            {k ? k[0].toUpperCase() + k.slice(1) : "All"} <span style={{ color: A.textMuted }}>{k ? counts[k] : tickers.length}</span>
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 10, color: A.textMuted }}>{at && tickers.length ? `Live · ${at.toLocaleTimeString()}` : ""}</span>
      </div>
      {!rows.length ? (
        <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 2px" }}>
          {tickers.length ? "No flags of this color." : "Nothing flagged yet. Click the ⚐ next to any ticker in the other tabs."}
        </div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: A.bg }}>
              <tr>
                {col("flag", "Ticker", "left", "Click to group by flag colour")}
                {col("zvr", "ZVR", "right", "Relative volume at time: today's volume ÷ the stock's average volume by this time of day. 1.00 = normal pace. After hours: the last value from the session")}{col("chg", "Chg")}{col("fromOpen", "From open")}
                {col("adr", "ADR")}{col("offHi", "Off high")}{col("rs", "RS")}
                <th style={th(A)}>Layer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t} data-nav={r.t} onClick={() => onTicker(r.t)} style={{ cursor: "pointer", background: chartTicker === r.t ? A.bgHover : "transparent" }}>
                  <td style={td(A)}><FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span></td>
                  <td style={{ ...td(A, "right"), color: r.zvr >= 1.5 ? A.green : r.zvr >= 1 ? A.text : A.textMuted, fontWeight: r.zvr >= 1.5 ? 700 : 400 }}>{r.zvr == null ? "—" : r.zvr.toFixed(2)}</td>
                  <td style={{ ...td(A, "right"), color: (r.chg ?? 0) >= 0 ? A.green : A.red }}>{pct(r.chg, 2)}</td>
                  <td style={{ ...td(A, "right"), color: (r.fromOpen ?? 0) >= 0 ? A.green : A.red, fontWeight: 700 }}>{pct(r.fromOpen, 2)}</td>
                  <td style={td(A, "right")}>{r.adr == null ? "—" : `${r.adr.toFixed(1)}%`}</td>
                  <td style={td(A, "right")}>{pct(r.offHi)}</td>
                  <td style={{ ...td(A, "right"), color: r.rs >= 90 ? A.green : r.rs >= 70 ? A.yellow : r.rs != null ? A.red : A.textMuted }}>{r.rs ?? "—"}</td>
                  <td style={{ ...td(A), fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.layer ? <span style={{ color: statusColor(r.layerSt, A) }}>{r.layer}</span> : <span style={{ color: A.textMuted }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


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

export function ScannerPanel({ A, stockMap, onTicker, chartTicker, tickerLayer }) {
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
        adr: s.adr20 ?? s.adr_pct, adr5: s.adr5, off: s.off_52w_high ?? s.pct_from_high, rs: s.rs_rank,
        burst: s.burst20_pct, ago: s.burst20_ago, pb: s.burst20_pullback, ti65: s.ti65,
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
      <div style={{ fontSize: 10, color: A.textMuted, marginBottom: 6 }}>{SCAN_NOTES[scan]}</div>
      {!rows.length ? <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 2px" }}>No names pass right now.</div> : (
        <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 230px)", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: A.bg }}>
              <tr>
                <th style={th(A)}>Ticker</th>
                {col("px", "Price")}{col("chg", "Chg")}
                {extra.map(([k, l]) => col(k, l))}
                {col("r1w", "1W")}{col("r1m", "1M")}{col("r3m", "3M")}{col("r6m", "6M")}
                {col("adr", "ADR")}{col("off", "Off high")}{col("rs", "RS")}
                <th style={th(A)}>Layer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t} data-nav={r.t} onClick={() => onTicker(r.t)} style={{ cursor: "pointer", background: chartTicker === r.t ? A.bgHover : "transparent" }}>
                  <td style={td(A)}><FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span>
                    {r.tag ? <span title={r.tag === "L" ? "$10B+ scan" : "under-$10B scan"} style={{ marginLeft: 5, fontSize: 9, color: A.textMuted }}>{r.tag}</span> : null}</td>
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
                  <td style={{ ...td(A), fontSize: 11, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.layer ? <span style={{ color: statusColor(r.layerSt, A) }}>{r.layer}</span> : <span style={{ color: A.textMuted }}>—</span>}
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

// ── Live RS ───────────────────────────────────────────────────────────────
// The pipeline ranks RS once a night (0.40·1M + 0.20·3M + 0.20·6M + 0.20·1Y,
// percentile × 99 across the universe). During a session that rank is a day
// old, so a leader gapping up or breaking down doesn't move until tomorrow.
// This re-bases every return on the live price (refreshed hourly) — (1 + r) × price / close − 1 —
// and re-ranks the whole universe with the same weights. Only runs when the
// current session is newer than the pipeline's close; stale-history tickers
// (> 7 days behind) stay out of the pool, as in the pipeline.
const RS_W = [["return_1m", 0.4], ["return_3m", 0.2], ["return_6m", 0.2], ["return_1y", 0.2]];
function rsScore(s, f) {
  let sum = 0, w = 0;
  for (const [k, wt] of RS_W) {
    const r = s[k];
    if (r == null || !isFinite(r)) continue;
    sum += ((1 + r / 100) * f - 1) * 100 * wt; w += wt;
  }
  return w ? sum / w : null;
}
function useLiveRS(stockMap) {
  const [quotes, setQuotes] = useState(null);
  const [at, setAt] = useState(null);
  const meta = useMemo(() => {
    const all = Object.values(stockMap || {}).filter((s) => s?.ticker && s.close > 0);
    const newest = all.reduce((m, s) => (s.last_bar_date > m ? s.last_bar_date : m), "");
    const cut = newest ? new Date(new Date(newest).getTime() - 7 * 864e5).toISOString().slice(0, 10) : "";
    const pool = all.filter((s) => (s.last_bar_date || "") >= cut);
    return { newest, tickers: pool.map((s) => s.ticker) };
  }, [stockMap]);
  const key = meta.tickers.join(",");
  useEffect(() => {
    if (!key) return;
    let live = true, id;
    let last = 0;
    const pull = async () => {
      if (document.hidden) return;
      if (!(etClock().session > meta.newest)) { setQuotes(null); return; }
      // RS refreshes at most once an hour — tab refocus or a re-render
      // doesn't pull early
      if (Date.now() - last < 3600000) return;
      last = Date.now();
      const list = key.split(","), m = new Map();
      const chunks = [];
      for (let i = 0; i < list.length; i += 500) chunks.push(list.slice(i, i + 500));
      await Promise.all(chunks.map(async (c) => {
        try {
          const r = await fetch(`/api/live?universe=${encodeURIComponent(c.join(","))}`);
          const d = r.ok ? await r.json() : null;
          (d?.theme_universe || d?.universe || []).forEach((q) => { if (q?.ticker && q.price > 0) m.set(q.ticker, q.price); });
        } catch { /* keep last */ }
      }));
      if (live && m.size > list.length * 0.5) { setQuotes(m); setAt(new Date()); }
    };
    // Hourly during the session (Nitin's call: intraday RS should move on
    // the hour, not tick); 15-min checks otherwise just notice a new session.
    const schedule = () => { id = setTimeout(async () => { await pull(); if (live) schedule(); }, etClock().rth ? 3600000 : 15 * 60000); };
    pull(); schedule();
    const onVis = () => { if (!document.hidden) pull(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { live = false; clearTimeout(id); document.removeEventListener("visibilitychange", onVis); };
  }, [key, meta.newest]);
  return useMemo(() => {
    if (!quotes) return { map: stockMap, at: null };
    const pool = new Set(meta.tickers);
    const sc = [];
    for (const t of meta.tickers) {
      const s = stockMap[t], p = quotes.get(t);
      const v0 = rsScore(s, 1), v = rsScore(s, p ? p / s.close : 1);
      if (v != null) sc.push([t, v0, v]);
    }
    // pandas rank(pct=True) uses average ranks for ties: (lo + hi + 1) / 2 / n
    const ranker = (vals) => {
      const sorted = [...vals].sort((a, b) => a - b), n = sorted.length;
      return (v) => {
        let lo = 0, hi = n;
        while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] < v ? (lo = m + 1) : (hi = m); }
        let up = lo; while (up < n && sorted[up] === v) up++;
        return ((lo + up + 1) / 2) / n;
      };
    };
    const p0 = ranker(sc.map((x) => x[1])), p1 = ranker(sc.map((x) => x[2]));
    const out = { ...stockMap };
    // Applied as a change on top of the pipeline's rank: the pipeline ranks a
    // slightly larger pool, so re-ranking from scratch would shift names ±1-10
    // points at the open before any price had moved.
    for (const [t, v0, v] of sc) {
      const base = stockMap[t].rs_rank ?? Math.round(p0(v0) * 99);
      const rs = Math.max(0, Math.min(99, Math.round(base + (p1(v) - p0(v0)) * 99)));
      out[t] = { ...stockMap[t], rs_rank_close: stockMap[t].rs_rank, rs_rank: rs, rs_live: true };
    }
    // out-of-pool (stale history) names rank 0, matching the pipeline
    for (const t of Object.keys(stockMap)) if (!pool.has(t) && stockMap[t]?.ticker) out[t] = { ...stockMap[t], rs_rank_close: stockMap[t].rs_rank, rs_rank: 0 };
    return { map: out, at };
  }, [quotes, at, stockMap, meta]);
}

export default function LeadershipView({ ARIA: A, stockMap: stockMapIn, onTickerClick, chartTicker, chartSlot, indexQuotes, pipeline, view = "lead" }) {
  const rot = useJson("/data/rs_rotation.json");
  const hist = useJson("/data/rank_history.json");
  const seats = useJson("/data/ticker_seats.json");
  const breadth = useJson("/data/breadth.json");
  const [theme, setTheme] = useState(null);
  const idxBars = useIndexBars(LEAD_INDEXES.map((x) => x.t));
  const liveRs = useLiveRS(stockMapIn);
  const stockMap = liveRs.map;
  // ↑/↓ steps through the rows of the Stocks box (whatever tab/sort is showing)
  // and loads each one in the chart. Ignored while typing in a field.
  const stocksRef = useRef(null);
  const navRef = useRef({ chartTicker, onTickerClick });
  navRef.current = { chartTicker, onTickerClick };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const box = stocksRef.current;
      if (!box) return;
      const rows = [...box.querySelectorAll("tr[data-nav]")];
      if (!rows.length) return;
      e.preventDefault();
      const { chartTicker: cur, onTickerClick: go } = navRef.current;
      const i = rows.findIndex((r) => r.dataset.nav === cur);
      const j = i < 0 ? (e.key === "ArrowDown" ? 0 : rows.length - 1)
        : Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      if (j === i) return;
      rows[j].scrollIntoView({ block: "nearest" });
      go(rows[j].dataset.nav);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [layerTab, setLayerTab] = useState("lead");
  const [stockTab, setStockTab] = useState("intra");
  const [expanded, setExpanded] = useState(null);
  const [lookup, setLookup] = useState("");
  const [lookupQ, setLookupQ] = useState("");
  const layersRef = React.useRef(null);
  const chain = useJson("/data/chain_layers.json");
  const health = useJson("/data/universe_health.json");
  const [healthOpen, setHealthOpen] = useState(false);
  const members = useMemo(() => {
    const m = {};
    (Array.isArray(chain) ? chain : []).forEach((l) => { m[`${l.themeId}|${l.layer}`] = l.tickers || []; });
    return m;
  }, [chain]);

  const dates = useMemo(() => (hist ? Object.keys(hist).sort() : []), [hist]);

  const layers = useMemo(() => {
    if (!rot?.layers) return [];
    const sparkDates = dates.slice(-SPARK_N);
    const peakDates = dates.slice(-PEAK_LOOKBACK);
    return rot.layers.map((l) => {
      const key = `${l.themeId}|${l.name}`;
      const h = sparkDates.map((d) => hist?.[d]?.layers?.[key] ?? null);
      const ph = peakDates.map((d) => hist?.[d]?.layers?.[key] ?? null);
      const { st, peak } = classify(l, ph.length ? ph : [l.now, l.w1, l.m1]);
      return { ...l, key, hist: h, st, peak };
    });
  }, [rot, hist, dates]);

  const themes = useMemo(() => {
    const by = {};
    layers.forEach((l) => { (by[l.themeId] ||= { themeId: l.themeId, theme: l.theme, layers: [] }).layers.push(l); });
    const avg = (arr) => arr.reduce((s, x) => s + x, 0) / (arr.length || 1);
    return Object.values(by).map((t) => {
      const L = t.layers;
      const counts = { lead: 0, emerg: 0, weak: 0, brk: 0, lag: 0 };
      L.forEach((l) => counts[l.st]++);
      const now = avg(L.map((l) => l.now)), w1 = avg(L.map((l) => l.w1 ?? l.now)), m1 = avg(L.map((l) => l.m1 ?? l.now));
      const h = L[0].hist.map((_, i) => {
        const v = L.map((l) => l.hist[i]).filter((x) => x != null);
        return v.length ? avg(v) : null;
      });
      // Theme status: driven by its layers, not just the average.
      const share = (n) => n / L.length;
      let st = "lag";
      if (share(counts.lead) >= 0.5 || (now >= 75 && counts.lead >= 1 && counts.brk === 0)) st = "lead";
      else if (share(counts.brk + counts.weak) >= 0.4 && m1 - now >= 10) st = "brk";
      else if (counts.weak + counts.brk >= 1 && now < m1) st = "weak";
      else if (now - m1 >= 15 && now >= 55) st = "emerg";
      return { ...t, counts, now, w1, m1, hist: h, st };
    }).sort((a, b) => b.now - a.now);
  }, [layers]);

  const visLayers = theme ? layers.filter((l) => l.themeId === theme) : layers;
  const layerBuckets = useMemo(() => {
    const b = { lead: [], emerg: [], weak: [], brk: [], lag: [] };
    visLayers.forEach((l) => { if (b[l.st]) b[l.st].push(l); });
    b.lead.sort((x, y) => y.now - x.now || (y.persist ?? 0) - (x.persist ?? 0));
    b.emerg.sort((x, y) => (y.now - y.m1) - (x.now - x.m1));
    b.weak.sort((x, y) => (x.now - x.peak) - (y.now - y.peak));
    b.brk.sort((x, y) => (x.now - x.peak) - (y.now - y.peak));
    b.lag.sort((x, y) => y.now - x.now);
    return b;
  }, [visLayers]);

  // ticker → best layer it sits in (leading layers win ties)
  const tickerLayer = useMemo(() => {
    const rank = { lead: 4, emerg: 2, weak: 1, brk: 0, lag: 0 };
    const m = {};
    layers.forEach((l) => (l.holds || []).forEach(({ t }) => {
      const cur = m[t];
      if (!cur || rank[l.st] > rank[cur.st] || (rank[l.st] === rank[cur.st] && l.now > cur.now)) m[t] = l;
    }));
    return m;
  }, [layers]);

  const stocks = useMemo(() => {
    const pm = seats?.persistMap || {};
    const allowed = theme ? new Set(visLayers.flatMap((l) => (l.holds || []).map((h) => h.t))) : null;
    const lead = [], brk = [];
    Object.values(stockMap || {}).forEach((s) => {
      if (!s?.ticker) return;
      if (allowed && !allowed.has(s.ticker)) return;
      if ((s.avg_dollar_vol_raw ?? 0) < 20e6) return;
      const L = tickerLayer[s.ticker];
      const row = {
        ticker: s.ticker, rs: s.rs_rank, sma50: s.sma50_pct, off: s.off_52w_high, r1m: s.return_1m,
        layer: L?.name, layerSt: L?.st, inLead: L?.st === "lead", persist: pm[s.ticker]?.[0] ?? 0,
      };
      if ((s.rs_rank ?? 0) >= 90 && s.above_50ma && (s.off_52w_high ?? -100) >= -25) lead.push(row);
      // A leader 1-2% under its 50d is a dip (backtest: leaders' red days are
      // dip-buys), not a breakdown — require real damage.
      else if (row.persist >= 40 && ((s.rs_rank ?? 0) < 70 || (s.sma50_pct ?? 0) <= -8)) brk.push(row);
    });
    lead.sort((a, b) => (b.inLead - a.inLead) || (b.rs - a.rs) || (b.off - a.off));
    brk.sort((a, b) => b.persist - a.persist || (a.rs ?? 0) - (b.rs ?? 0));
    return { lead: lead.slice(0, 60), brk: brk.slice(0, 60) };
  }, [stockMap, seats, tickerLayer, theme, visLayers]);

  const lookupHits = useMemo(() => {
    const q = lookupQ;
    if (!q) return null;
    const hits = layers.filter((l) => (members[l.key] || (l.holds || []).map((h) => h.t)).includes(q)).map((l) => {
      const mem = (members[l.key] || []).filter((t) => stockMap[t])
        .sort((a, b) => (stockMap[b]?.rs_rank ?? 0) - (stockMap[a]?.rs_rank ?? 0));
      return { l, pos: mem.indexOf(q) + 1, n: mem.length };
    }).sort((a, b) => b.l.now - a.l.now);
    return hits;
  }, [lookupQ, layers, members, stockMap]);
  const runLookup = (raw) => {
    const t = String(raw || "").trim().toUpperCase();
    setLookupQ(t);
    if (t) onTickerClick(t);
  };
  const openLayer = (l) => {
    setTheme(null); setLayerTab(l.st); setExpanded(l.key);
    setTimeout(() => layersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const loading = !rot || !hist;
  const regime = breadth?.regime?.primary;
  const verdict = breadth?.conditions?.verdict;
  const cur = breadth?.current;
  const selTheme = themes.find((t) => t.themeId === theme);

  const summary = [
    ["Leading", layerBuckets.lead.length, A.green],
    ["Emerging", layerBuckets.emerg.length, A.cyan],
    ["Weakening", layerBuckets.weak.length, A.yellow],
    ["Breaking down", layerBuckets.brk.length, A.red],
  ];

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }} className="tp-lead-row">
      {/* Phone/tablet: stack the chart under the boards instead of squeezing
          it beside them (inline styles can't carry a media query). */}
      <style>{`@media (max-width: 900px) {
        .tp-lead-row { flex-direction: column; align-items: stretch !important; }
        .tp-lead-row > div { flex: 1 1 auto !important; width: 100%; }
        .tp-lead-chart { position: static !important; max-height: none !important; }
        .tp-lead-label { width: 84px !important; }
        .tp-topbar { padding: 8px 12px !important; }
      }
      @media (max-width: 520px) {
        .tp-hide-sm { display: none; }
      }`}</style>
      {view === "scanner" ? (
        <div style={{ flex: "1 1 640px", minWidth: 0 }} ref={stocksRef}>
          <ScannerPanel A={A} stockMap={stockMap} onTicker={onTickerClick} chartTicker={chartTicker} tickerLayer={tickerLayer} />
        </div>
      ) : (
      <div style={{ flex: "1 1 640px", minWidth: 0 }}>
        {/* Header strip: market backdrop + layer counts */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", background: A.bgCard, border: `1px solid ${A.border}`, borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: A.textMuted, letterSpacing: 0.4 }}>BREADTH{breadth?.date ? ` · ${breadth.date}` : ""}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: regime === "RISK ON" ? A.green : regime ? A.red : A.textDim }}>
              {regime || "—"}{verdict ? <span style={{ color: A.textDim, fontWeight: 500 }}> · {verdict}</span> : null}
            </div>
          </div>
          {cur && (
            <div style={{ fontSize: 11, color: A.textDim }}>
              Above 20d <b style={{ color: A.text }}>{cur.pct_above_20ema}%</b> · 50d <b style={{ color: A.text }}>{cur.pct_above_50ema}%</b> · 200d <b style={{ color: A.text }}>{cur.pct_above_200ema}%</b>
            </div>
          )}
          <div style={{ display: "flex", gap: 14, marginLeft: "auto" }}>
            {summary.map(([k, n, c]) => (
              <div key={k} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: c, lineHeight: 1 }}>{n}</div>
                <div style={{ fontSize: 10, color: A.textMuted }}>{k}</div>
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); runLookup(lookup); }} style={{ display: "flex", gap: 4 }}>
            <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Find ticker…" aria-label="Find a ticker's layers"
              style={{ width: 110, background: A.bgRow, border: `1px solid ${A.border}`, borderRadius: 4, color: A.text, fontSize: 12, padding: "4px 7px", fontFamily: "monospace", textTransform: "uppercase" }} />
            {lookupQ && <button type="button" onClick={() => { setLookup(""); setLookupQ(""); }}
              style={{ background: "transparent", border: `1px solid ${A.border}`, borderRadius: 4, color: A.textDim, fontSize: 11, cursor: "pointer" }}>×</button>}
          </form>
          <div style={{ fontSize: 10, color: A.textMuted, width: "100%" }}>
            Layers as of {rot?.date || "…"} · {layers.length} layers · leading = RS rank ≥ {LEAD}
            {selTheme ? <> · filtered to <b style={{ color: A.text }}>{selTheme.theme}</b> <button onClick={() => setTheme(null)} style={{ background: "none", border: "none", color: A.cyan, cursor: "pointer", fontSize: 10 }}>clear</button></> : null}
          </div>
        </div>

        {loading ? (
          <div style={{ color: A.textMuted, fontSize: 12, padding: 20 }}>Loading leadership data…</div>
        ) : (
          <>
            {lookupHits && (() => {
              const s = stockMap[lookupQ];
              const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`);
              return (
                <Card A={A} title={`${lookupQ}${s?.company && s.company !== 0 ? ` · ${s.company}` : ""}`}
                  sub={s ? `RS ${s.rs_rank ?? "—"}${s.rs_live ? ` live (close ${s.rs_rank_close ?? "—"})` : ""} · vs 50d ${pct(s.sma50_pct)} · off high ${pct(s.off_52w_high)} · ${s.industry || ""}` : "Not in the ThemePulse universe"}
                  right={<button onClick={() => { setLookup(""); setLookupQ(""); }} style={{ background: "transparent", border: "none", color: A.cyan, cursor: "pointer", fontSize: 11 }}>close</button>}>
                  {!lookupHits.length ? (
                    <div style={{ fontSize: 11, color: A.textMuted }}>{s ? "In the universe but not in any layer (trades under $10M/day, or no industry mapping)." : "No layers."}</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>
                        <th style={th(A)}>Layer</th><th style={th(A, "right")}>Rank</th><th style={th(A)}>Status</th>
                        <th style={th(A, "right")}>1m</th><th style={th(A, "right")} title="Position by RS rank among the layer's members">{lookupQ} in layer</th>
                      </tr></thead>
                      <tbody>
                        {lookupHits.map(({ l, pos, n }) => (
                          <tr key={l.key} onClick={() => openLayer(l)} style={{ cursor: "pointer" }} title="Open this layer below">
                            <td style={td(A)}><span style={{ color: A.text, fontWeight: 600 }}>{l.name}</span> <span style={{ fontSize: 10, color: A.textMuted }}>{l.theme}</span></td>
                            <td style={{ ...td(A, "right"), color: statusColor(l.st, A), fontWeight: 700 }}>{l.now}</td>
                            <td style={{ ...td(A), color: statusColor(l.st, A) }}>{STATUS[l.st].label}</td>
                            <td style={td(A, "right")}><Delta v={l.now - l.m1} A={A} /></td>
                            <td style={td(A, "right")}>{pos ? `${pos} of ${n}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              );
            })()}
            <div ref={stocksRef}>
            <Card A={A} title="Stocks"
              sub={stockTab === "lead"
                ? "RS ≥ 90, above the 50-day, within 25% of the high · ● = in a leading layer"
                : stockTab === "intra" || stockTab === "ext" || stockTab === "flag"
                ? undefined
                : "Held the top RS decile ≥ 40% of the quarter, now RS < 70 or ≥ 8% below the 50-day"}
              right={<Tabs A={A} value={stockTab} onChange={setStockTab} items={[
                ["lead", "Leaders", stocks.lead.length, A.green],
                ["brk", "Leaders breaking down", stocks.brk.length, A.red],
                ["intra", "Intraday scan", "", A.cyan],
                ["ext", "Pre/After-market", "", A.purple],
                ["flag", "Flagged", "", A.gold],
              ]} />}>
              {stockTab === "flag"
                ? <FlaggedTab A={A} stockMap={stockMap} tickerLayer={tickerLayer} onTicker={onTickerClick} chartTicker={chartTicker} />
                : stockTab === "ext"
                ? <ExtHoursMovers A={A} pipeline={pipeline} stockMap={stockMap} tickerLayer={tickerLayer} onTicker={onTickerClick} chartTicker={chartTicker} />
                : stockTab === "intra"
                ? <IntradayScan A={A} stockMap={stockMap} onTicker={onTickerClick} chartTicker={chartTicker} tickerLayer={tickerLayer}
                    allowed={theme ? new Set(visLayers.flatMap((l) => members[l.key] || (l.holds || []).map((h) => h.t))) : null} />
                : <StockTable rows={stocks[stockTab]} A={A} onTicker={onTickerClick} chartTicker={chartTicker} mode={stockTab} />}
            </Card>
            </div>

            <ChangesPanel A={A} layers={layers} themes={themes} bars={idxBars} liveQuotes={indexQuotes} date={rot?.date}
              onTicker={onTickerClick} onLayer={(l) => { setTheme(l.themeId); setLayerTab(l.st); setExpanded(l.key); }}
              onTheme={(id) => setTheme(id)} />
            <IndexPanel A={A} liveQuotes={indexQuotes} onTicker={onTickerClick} chartTicker={chartTicker} bars={idxBars} />

            <Card A={A} title="Themes" sub="Average layer RS rank · ▲ leading / weakening / ▼ breaking-down layers · click to filter">
              <ThemeBoard themes={themes} A={A} selected={theme} onSelect={setTheme} />
            </Card>

            <Card A={A} title="Layers" sub={STATUS[layerTab].hint}
              right={<Tabs A={A} value={layerTab} onChange={setLayerTab} items={[
                ["lead", "Leading", layerBuckets.lead.length, A.green],
                ["weak", "Weakening", layerBuckets.weak.length, A.yellow],
                ["brk", "Breaking down", layerBuckets.brk.length, A.red],
                ["emerg", "Emerging", layerBuckets.emerg.length, A.cyan],
                ["lag", "Lagging", layerBuckets.lag.length, A.textDim],
              ]} />}>
              <div ref={layersRef} />
              <LayerTable rows={layerBuckets[layerTab]} A={A} onTicker={onTickerClick} chartTicker={chartTicker} stockMap={stockMap}
                showPeak={layerTab === "weak" || layerTab === "brk"} members={members} expanded={expanded} onToggle={setExpanded} focus={lookupQ} />
            </Card>



            {health?.checks && (() => {
              const warn = health.checks.filter((c) => c.status === "warn");
              return (
                <Card A={A} title="Universe health"
                  sub={`${health.in_layer} of ${health.universe} names in a layer · ${health.layers} layers · checked ${String(health.generated || "").replace("T", " ")}`}
                  right={<button onClick={() => setHealthOpen((v) => !v)}
                    style={{ background: "transparent", border: `1px solid ${warn.length ? A.yellow : A.green}`, borderRadius: 4, cursor: "pointer",
                      color: warn.length ? A.yellow : A.green, fontSize: 11, padding: "2px 8px" }}>
                    {warn.length ? `${warn.length} to review` : "all clear"} {healthOpen ? "▲" : "▼"}</button>}>
                  {healthOpen && health.checks.map((c) => (
                    <div key={c.id} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: `1px solid ${A.border}`, fontSize: 11 }}>
                      <span style={{ color: c.status === "warn" ? A.yellow : A.green, width: 14 }}>{c.status === "warn" ? "!" : "✓"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: A.text }}>{c.label} <b>{c.count}</b></div>
                        {c.count > 0 && (
                          <div style={{ color: A.textMuted, fontFamily: "monospace", fontSize: 10, wordBreak: "break-word" }}>
                            {c.items.join(", ")}{c.count > c.items.length ? " …" : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </Card>
              );
            })()}
          </>
        )}
      </div>
      )}
      {chartSlot && (
        <div style={{ flex: "1 1 520px", minWidth: 0, position: "sticky", top: 0, maxHeight: "100vh", overflowY: "auto" }} className="tp-lead-chart">
          {chartSlot}
        </div>
      )}
    </div>
  );
}
