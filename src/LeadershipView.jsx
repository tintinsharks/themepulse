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
import React, { useEffect, useMemo, useState } from "react";

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
    <button onClick={() => onClick(t)}
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
function LayerTable({ rows, A, onTicker, chartTicker, stockMap, showPeak }) {
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
            <th style={th(A)}>{SPARK_N}d</th>
            <th style={th(A, "right")} title="Share of the trailing quarter this layer ranked ≥ 88">Held</th>
            <th style={th(A)}>Strongest names</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const c = statusColor(l.st, A);
            const names = (l.holds || [])
              .filter((h) => stockMap[h.t])
              .sort((a, b) => (stockMap[b.t]?.rs_rank ?? 0) - (stockMap[a.t]?.rs_rank ?? 0))
              .slice(0, 5);
            return (
              <tr key={l.key}>
                <td style={td(A)}>
                  <div style={{ color: A.text, fontWeight: 600 }}>{l.name}</div>
                  <div style={{ fontSize: 10, color: A.textMuted }}>{l.theme}</div>
                </td>
                <td style={{ ...td(A, "right"), color: c, fontWeight: 700 }}>{l.now}</td>
                <td style={td(A, "right")}><Delta v={l.now - l.w1} A={A} /></td>
                <td style={td(A, "right")}><Delta v={l.now - l.m1} A={A} /></td>
                {showPeak && <td style={td(A, "right")}>{l.peak}</td>}
                <td style={td(A)}><Spark vals={l.hist} color={c} A={A} /></td>
                <td style={td(A, "right")}>{l.persist != null ? `${l.persist}%` : "—"}</td>
                <td style={{ ...td(A), whiteSpace: "normal", minWidth: 160 }}>
                  {names.map((h) => (
                    <TickerChip key={h.t} t={h.t} onClick={onTicker} active={chartTicker === h.t} A={A}
                      dim={(stockMap[h.t]?.rs_rank ?? 0) < 80} />
                  ))}
                </td>
              </tr>
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
              <tr key={r.ticker} onClick={() => onTicker(r.ticker)} style={{ cursor: "pointer", background: on ? A.bgHover : "transparent" }}>
                <td style={td(A)}>
                  <span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.ticker}</span>
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
      <div style={{ width: 118, flexShrink: 0, fontSize: 10, fontWeight: 700, color, letterSpacing: 0.3, paddingTop: 4 }}>{label}</div>
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

export default function LeadershipView({ ARIA: A, stockMap, onTickerClick, chartTicker, chartSlot, indexQuotes }) {
  const rot = useJson("/data/rs_rotation.json");
  const hist = useJson("/data/rank_history.json");
  const seats = useJson("/data/ticker_seats.json");
  const breadth = useJson("/data/breadth.json");
  const [theme, setTheme] = useState(null);
  const idxBars = useIndexBars(LEAD_INDEXES.map((x) => x.t));
  const [layerTab, setLayerTab] = useState("lead");
  const [stockTab, setStockTab] = useState("lead");

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
    const b = { lead: [], emerg: [], weak: [], brk: [] };
    visLayers.forEach((l) => { if (b[l.st]) b[l.st].push(l); });
    b.lead.sort((x, y) => y.now - x.now || (y.persist ?? 0) - (x.persist ?? 0));
    b.emerg.sort((x, y) => (y.now - y.m1) - (x.now - x.m1));
    b.weak.sort((x, y) => (x.now - x.peak) - (y.now - y.peak));
    b.brk.sort((x, y) => (x.now - x.peak) - (y.now - y.peak));
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
          <div style={{ fontSize: 10, color: A.textMuted, width: "100%" }}>
            Layers as of {rot?.date || "…"} · {layers.length} layers · leading = RS rank ≥ {LEAD}
            {selTheme ? <> · filtered to <b style={{ color: A.text }}>{selTheme.theme}</b> <button onClick={() => setTheme(null)} style={{ background: "none", border: "none", color: A.cyan, cursor: "pointer", fontSize: 10 }}>clear</button></> : null}
          </div>
        </div>

        {loading ? (
          <div style={{ color: A.textMuted, fontSize: 12, padding: 20 }}>Loading leadership data…</div>
        ) : (
          <>
            <ChangesPanel A={A} layers={layers} themes={themes} bars={idxBars} liveQuotes={indexQuotes} date={rot?.date}
              onTicker={onTickerClick} onLayer={(l) => { setTheme(l.themeId); if (["lead", "weak", "brk", "emerg"].includes(l.st)) setLayerTab(l.st); }}
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
              ]} />}>
              <LayerTable rows={layerBuckets[layerTab]} A={A} onTicker={onTickerClick} chartTicker={chartTicker} stockMap={stockMap}
                showPeak={layerTab === "weak" || layerTab === "brk"} />
            </Card>

            <Card A={A} title="Stocks"
              sub={stockTab === "lead"
                ? "RS ≥ 90, above the 50-day, within 25% of the high · ● = in a leading layer"
                : "Held the top RS decile ≥ 40% of the quarter, now RS < 70 or ≥ 8% below the 50-day"}
              right={<Tabs A={A} value={stockTab} onChange={setStockTab} items={[
                ["lead", "Leaders", stocks.lead.length, A.green],
                ["brk", "Leaders breaking down", stocks.brk.length, A.red],
              ]} />}>
              <StockTable rows={stocks[stockTab]} A={A} onTicker={onTickerClick} chartTicker={chartTicker} mode={stockTab} />
            </Card>
          </>
        )}
      </div>
      {chartSlot && (
        <div style={{ flex: "1 1 520px", minWidth: 0, position: "sticky", top: 0, maxHeight: "100vh", overflowY: "auto" }} className="tp-lead-chart">
          {chartSlot}
        </div>
      )}
    </div>
  );
}
