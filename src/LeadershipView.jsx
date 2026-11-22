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
  emerg: { label: "Emerging",       hint: "Rank ≥ 70, up 20+ pts in a month, rising in 6+ of the last 10 sessions — unproven: early rotation backtested negative" },
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

// Rank trend from the daily history, so one noisy session can't make or
// break a status: slope = least-squares points/session over the last 5
// sessions; ups = sessions out of the last 10 the rank rose.
// Rank stability: sessions of the last 20 the rank held >= 80. Separates a
// layer that has sat in the top tier for a month from one that spiked there.
function rankHeld(hist, n = 20, lvl = 80) {
  const v = hist.filter((x) => x != null).slice(-n);
  return { held: v.filter((x) => x >= lvl).length, of: v.length };
}

function rankTrend(hist) {
  const v = hist.filter((x) => x != null);
  const t5 = v.slice(-5);
  let slope = null;
  if (t5.length >= 3) {
    const n = t5.length, mx = (n - 1) / 2, my = t5.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    t5.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
    slope = num / den;
  }
  const t10 = v.slice(-11);
  let ups = 0;
  for (let i = 1; i < t10.length; i++) if (t10[i] > t10[i - 1]) ups++;
  return { slope, ups, of: Math.max(0, t10.length - 1) };
}

function classify({ now, w1, m1 }, hist) {
  const recent = hist.slice(-PEAK_LOOKBACK).filter((x) => x != null);
  const peak = recent.length ? Math.max(...recent) : now;
  const tr = rankTrend(hist);
  if (now >= LEAD && (w1 ?? now) >= 80) return { st: "lead", peak };
  if (peak >= LEAD && now < 60) return { st: "brk", peak };
  if (peak >= LEAD && now < LEAD && now <= peak - 10) return { st: "weak", peak };
  // Emerging also needs a steady climb — rising in 6+ of the last 10 sessions
  // and still rising over the last 5 — not one jump off a single day.
  if (now >= 70 && now - (m1 ?? now) >= 20 && (tr.of < 6 || (tr.ups >= 6 && (tr.slope ?? 0) > 0))) return { st: "emerg", peak };
  if (now >= LEAD) return { st: "lead", peak };
  return { st: "lag", peak };
}

// Breadth + volume inside a layer, from its members' per-stock fields:
//   a50 — % above their 50-day · rs80 — % with RS ≥ 80 · nh — % closing at a
//   20-session high · udv — median up-day ÷ down-day volume (20 sessions) ·
//   dv — median 5-day ÷ 20-day dollar volume.
// The median rank alone can be held up by 2-3 names; these show whether the
// whole layer is moving. Context only — none of it is backtested yet.
function layerStats(tickers, stockMap) {
  const S = tickers.map((t) => stockMap[t]).filter(Boolean);
  if (!S.length) return null;
  const pct = (f) => Math.round((S.filter(f).length / S.length) * 100);
  const med = (k) => {
    const v = S.map((s) => s[k]).filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  return {
    n: S.length,
    a50: pct((s) => (s.sma50_pct ?? -1) > 0),
    rs80: pct((s) => (s.rs_rank ?? 0) >= 80),
    nh: pct((s) => s.nh20 === 1),
    udv: med("udv20"),
    dv: med("dvol_ratio_5_20"),
    rsMed: med("rs_rank"),
  };
}

// Volume / participation confirmation for a layer, from layer_breadth.json
// (pipeline 10f). Each check is one way a rising group shows institutions are
// actually behind it:
//   acc     accumulation days (member up >= 1% on >= 1.5x 50-day volume) over
//           10 sessions >= 3 and at least twice the distribution days
//   money   layer's share of universe dollar volume, 5d vs 20d, >= 1.15x
//   leaders members at stock RS >= 90 up by 2+ vs 5 sessions ago
// Percent-of-members measures (% above MAs, RS-line highs, breadth thrust)
// were dropped 2026-11-21: layers run 4-140 members, so a small layer moves
// in 25-point jumps. Counts and ratios only.
function layerConfirm(lbRow) {
  if (!lbRow || !lbRow.acc) return null;
  const lastOf = (arr, back = 0) => {
    if (!arr) return null;
    let i = arr.length - 1;
    while (i >= 0 && arr[i] == null) i--;
    i -= back;
    return i >= 0 ? arr[i] : null;
  };
  const acc = lastOf(lbRow.acc), dist = lastOf(lbRow.dist), dvs = lastOf(lbRow.dvs);
  const l90 = lastOf(lbRow.l90), l90p = lastOf(lbRow.l90, 5);
  const lx = lastOf(lbRow.lx), lxT = lbRow.lx_t || [];
  const checks = {
    acc: acc != null && acc >= 3 && acc >= 2 * (dist ?? 0),
    money: dvs != null && dvs >= 1.15,
    leaders: l90 != null && l90p != null && l90 - l90p >= 2,
  };
  const passed = Object.keys(checks).filter((k) => checks[k]);
  return { acc, dist, dvs, lx, lxT, l90, l90d: l90 != null && l90p != null ? l90 - l90p : null, passed,
    distHeavy: dist != null && dist >= 3 && dist >= 2 * (acc ?? 0) };
}
const CONF_LABEL = { acc: "accumulation days", money: "money flowing in", leaders: "new RS 90+ leaders" };

function layerFlags(l) {
  const b = l.stats;
  if (!b || b.n < 3) return [];
  const f = [];
  const hd = l.held;
  if (hd?.of >= 15) {
    if (l.now >= 80 && hd.held <= 5) f.push(["spiky", `Only ${hd.held} of the last ${hd.of} sessions at 80+ — a fresh spike, not established`]);
  }
  const cf = l.conf;
  if (cf && cf.lx >= 2) f.push(["exiting", `${cf.lx} leaders cracked this week (were RS 90+, now below the 50-day or under RS 80): ${cf.lxT.join(", ")}`]);
  if (cf) {
    if ((l.st === "lead" || l.st === "weak") && cf.distHeavy)
      f.push(["distrib", `Distribution: ${cf.dist} heavy-volume down days vs ${cf.acc} accumulation days across members over 10 sessions`]);
    // "rising" = Emerging, or a non-leader whose rank is climbing (+10 in a month, still rising)
    const rising = l.st === "emerg" || (l.st !== "lead" && (l.now - (l.m1 ?? l.now)) >= 10 && (l.trend?.slope ?? 0) > 0);
    if (rising) {
      if (cf.passed.length >= 2) f.push(["confirmed", `Rank rising with ${cf.passed.length} of 3 confirmations: ${cf.passed.map((k) => CONF_LABEL[k]).join(", ")}`]);
      else f.push(["unconfirmed", `Rank rising without volume/participation confirmation${cf.passed.length ? ` (only ${CONF_LABEL[cf.passed[0]]})` : ""}`]);
    }
  } else if ((l.st === "lead" || l.st === "weak") && b.udv != null && b.udv < 0.8) {
    f.push(["distrib", "Down-day volume outweighs up-day volume over 20 sessions"]);
  }
  return f;
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

// ── Rotation (Themes card, second tab) ───────────────────────────────────
// Bars answer "what is rotating in / out right now": rank change over the
// chosen period, diverging from zero, biggest gains on top, biggest losses at
// the bottom. Lines answer "how did it unfold": rank history for up to six
// picked layers. Line hues are the validated categorical slots minus green/red
// (those mean up/down on the bars); every line is end-labelled, so identity
// never rests on colour alone.
const ROT_HUES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];
const ROT_HUES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"];
const isLightBg = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) > 150;
};

function RotationView({ A, layers, themes, dates, theme, onLayer, onTheme, lb }) {
  // measure: "rs" = RS rank (rank_history) · 20 / 50 / 200 = % of members above that MA (layer_breadth.json)
  // RS rank only: the "% of members above the 20/50/200-day" measure was
  // removed (2026-11-21) — layers range from 4 to 140 members, so a 4-name
  // layer moves in 25-point jumps and swamps the rotation bars.
  const measure = "rs";
  const breadthOn = false;
  const [period, setPeriod] = useState(() => { try { return localStorage.getItem("tp-rot-period") || "w1"; } catch { return "w1"; } });
  const [group, setGroup] = useState("layers");
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState(null);   // keys on the line chart; null = auto
  const [hover, setHover] = useState(null);
  const setP = (p) => { setPeriod(p); try { localStorage.setItem("tp-rot-period", p); } catch { /* */ } };
  const hues = isLightBg(A.bg) ? ROT_HUES_LIGHT : ROT_HUES_DARK;

  const items = useMemo(() => {
    const back = { d1: 1, w1: 5, m1: 21 }[period];
    // breadth series: last value = now, value `back` sessions earlier = base
    const fromSeries = (h) => {
      if (!h) return null;
      const iNow = h.length - 1 - [...h].reverse().findIndex((v) => v != null);
      if (iNow < 0 || iNow >= h.length) return null;
      const iB = iNow - back;
      return { now: h[iNow], base: iB >= 0 ? h[iB] : null, hist: h };
    };
    const src = group === "themes"
      ? themes.map((t) => {
          const b = breadthOn ? fromSeries(lb.themes?.[t.themeId]?.[`a${measure}`]) : null;
          return { key: `t:${t.themeId}`, name: t.theme, sub: `${t.layers.length} layers`, st: t.st, ref: t,
            ...(breadthOn ? (b || { now: null }) : { now: t.now, hist: t.hist,
              base: period === "d1" ? t.hist.filter((x) => x != null).slice(-2)[0] : t[period] }) };
        })
      : layers.filter((l) => !theme || l.themeId === theme).map((l) => {
          const b = breadthOn ? fromSeries(lb.layers?.[l.key]?.[`a${measure}`]) : null;
          return { key: l.key, name: l.name, sub: l.theme, st: l.st, ref: l,
            ...(breadthOn ? (b || { now: null }) : { now: l.now, hist: l.hist, base: l[period] }) };
        });
    return src.filter((x) => x.base != null && x.now != null).map((x) => ({ ...x, d: x.now - x.base }))
      .sort((a, b) => b.d - a.d || b.now - a.now);
  }, [group, themes, layers, theme, period, breadthOn, measure, lb]);
  const unit = breadthOn ? "%" : "";
  const what = breadthOn ? `% of stocks above the ${measure}-day` : "RS rank";

  const N = showAll ? items.length : 12;
  const ins = items.filter((x) => x.d > 0).slice(0, N);
  const outs = items.filter((x) => x.d < 0).slice(-N);
  const maxAbs = Math.max(10, ...items.map((x) => Math.abs(x.d)));

  const autoPick = useMemo(() => [...items.slice(0, 3), ...items.slice(-3).reverse()].filter((x) => x.d !== 0).map((x) => x.key), [items]);
  const lineKeys = (picked ?? autoPick).filter((k) => items.some((x) => x.key === k)).slice(0, 6);
  const lineItems = lineKeys.map((k) => items.find((x) => x.key === k));
  const open = (x) => (group === "themes" ? onTheme(x.ref.themeId, true) : onLayer(x.ref));
  const toggle = (k) => {
    const cur = picked ?? autoPick;
    setPicked(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k].slice(-6));
  };

  const periodLabel = { d1: "1 day", w1: "1 week", m1: "1 month" }[period];
  const Pill = ({ on, onClick, children, title }) => (
    <button onClick={onClick} title={title} style={{ background: on ? A.bgHover : "transparent", border: `1px solid ${on ? A.textDim : A.border}`,
      color: on ? A.text : A.textDim, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{children}</button>
  );

  const Bar = (x) => {
    const w = (Math.abs(x.d) / maxAbs) * 50;
    const up = x.d > 0;
    const onLine = lineKeys.includes(x.key);
    return (
      <div key={x.key} title={`${x.name} · ${x.sub} — ${what} ${Math.round(x.base)}${unit} → ${Math.round(x.now)}${unit} (${up ? "+" : ""}${Math.round(x.d)}) over ${periodLabel} · ${STATUS[x.st]?.label || ""}\nClick: add to / remove from the line chart · double-click: open`}
        onClick={() => toggle(x.key)}
        onDoubleClick={() => open(x)}
        style={{ display: "grid", gridTemplateColumns: "minmax(110px, 30%) 1fr 64px", alignItems: "center", gap: 8, padding: "2px 0", cursor: "pointer",
          background: onLine ? A.bgHover : "transparent", borderRadius: 3 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: A.text }}>
          {onLine && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 5, background: hues[lineKeys.indexOf(x.key)] }} />}
          {x.name} <span style={{ color: A.textMuted, fontSize: 10 }}>{group === "layers" ? x.sub : ""}</span>
        </div>
        <div style={{ position: "relative", height: 14 }}>
          <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: A.border }} />
          <div style={{ position: "absolute", top: 2, height: 10, background: up ? A.green : A.red,
            left: up ? "50%" : `${50 - w}%`, width: `${Math.max(w, 0.6)}%`,
            borderRadius: up ? "0 4px 4px 0" : "4px 0 0 4px" }} />
        </div>
        <div style={{ fontSize: 11, textAlign: "right", fontVariantNumeric: "tabular-nums", color: A.textDim, whiteSpace: "nowrap" }}>
          <span style={{ color: A.text, fontWeight: 700 }}>{up ? "+" : ""}{Math.round(x.d)}</span> <span style={{ color: A.textMuted }}>→{Math.round(x.now)}{unit}</span>
        </div>
      </div>
    );
  };

  // ── line chart (SVG, 0-100 rank scale) ──
  const W = 640, H = 200, padL = 28, padR = 120, padT = 8, padB = 20;
  const n = Math.max(...lineItems.map((x) => x.hist.length), 2);
  const X = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const Y = (v) => padT + (1 - v / 100) * (H - padT - padB);
  const path = (h) => h.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean).map((p, i) => (i ? "L" : "M") + p).join(" ");
  const sd = (breadthOn ? lb.dates : dates).slice(-n);
  // de-collide end labels
  const ends = lineItems.map((x, i) => ({ i, y: Y([...x.hist].reverse().find((v) => v != null) ?? 0) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 11) ends[k].y = ends[k - 1].y + 11;
  const endY = Object.fromEntries(ends.map((e) => [e.i, e.y]));

  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: A.textMuted }}>Change over</span>
        {[["d1", "1D"], ["w1", "1W"], ["m1", "1M"]].map(([k, l]) => <Pill key={k} on={period === k} onClick={() => setP(k)}>{l}</Pill>)}
        <span style={{ width: 8 }} />
        <Pill on={group === "layers"} onClick={() => { setGroup("layers"); setPicked(null); }}>Layers</Pill>
        <Pill on={group === "themes"} onClick={() => { setGroup("themes"); setPicked(null); }}>Themes</Pill>
        <span style={{ width: 8 }} />
        <Pill on={showAll} onClick={() => setShowAll((v) => !v)} title="Show every layer, not just the 12 biggest each way">{showAll ? "Top 12" : "All"}</Pill>
        {theme && group === "layers" && <span style={{ fontSize: 10, color: A.textMuted }}>· filtered to the selected theme</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 2 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: A.green, letterSpacing: 0.3, margin: "2px 0" }}>ROTATING IN · {breadthOn ? `${what}, pts gained` : "rank gained"} over {periodLabel}</div>
        {ins.length ? ins.map(Bar) : <div style={{ fontSize: 11, color: A.textMuted }}>None.</div>}
        <div style={{ fontSize: 10, fontWeight: 700, color: A.red, letterSpacing: 0.3, margin: "8px 0 2px" }}>ROTATING OUT · {breadthOn ? `${what}, pts lost` : "rank lost"} over {periodLabel}</div>
        {outs.length ? outs.map(Bar) : <div style={{ fontSize: 11, color: A.textMuted }}>None.</div>}
      </div>
      <div style={{ fontSize: 10, color: A.textMuted, margin: "6px 0 10px" }}>
        Bar = change in {what} {breadthOn ? "(percentage points)" : "(0–100)"} · number = change → now · click a bar to add it to the lines below · double-click a bar or click a line's name to show its stocks
      </div>

      {lineItems.length > 0 && (
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: A.text, marginBottom: 4 }}>{breadthOn ? `${what} · ` : "Rank history · "}last {n} sessions</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
            {lineItems.map((x, i) => (
              <span key={x.key} style={{ fontSize: 10, color: A.textDim }}>
                <span style={{ display: "inline-block", width: 10, height: 2, verticalAlign: "middle", marginRight: 4, background: hues[i] }} />
                <span onClick={() => open(x)} title={`Show the stocks in ${x.name}`} style={{ cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 2 }}>{x.name}</span>
                <span onClick={() => toggle(x.key)} title="Remove from the chart" style={{ cursor: "pointer", marginLeft: 3, color: A.textMuted }}>✕</span>
              </span>
            ))}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * W;
              const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1));
              setHover(i >= 0 && i < n ? i : null);
            }}
            onMouseLeave={() => setHover(null)}>
            {(breadthOn ? [0, 25, 50, 75, 100] : [0, 25, 50, 75, 88, 100]).map((v) => (
              <g key={v}>
                <line x1={padL} x2={W - padR} y1={Y(v)} y2={Y(v)} stroke={v === 88 ? A.green : A.border} strokeOpacity={v === 88 ? 0.5 : 1}
                  strokeDasharray={v === 88 ? "3 3" : undefined} strokeWidth={1} />
                <text x={padL - 4} y={Y(v) + 3} fontSize="9" textAnchor="end" fill={A.textMuted}>{v}</text>
              </g>
            ))}
            {!breadthOn && <text x={W - padR + 2} y={Y(88) - 2} fontSize="8" fill={A.textMuted}>lead ≥ 88</text>}
            {sd[0] && <text x={padL} y={H - 4} fontSize="9" fill={A.textMuted}>{sd[0]}</text>}
            {sd[n - 1] && <text x={W - padR} y={H - 4} fontSize="9" textAnchor="end" fill={A.textMuted}>{sd[n - 1]}</text>}
            {lineItems.map((x, i) => (
              <g key={x.key}>
                <path d={path(x.hist)} fill="none" stroke={hues[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <text x={W - padR + 6} y={endY[i] + 3} fontSize="10" fill={A.textDim} onClick={() => open(x)}
                  style={{ cursor: "pointer", textDecoration: "underline dotted" }}><title>{`Show the stocks in ${x.name}`}</title>
                  <tspan fill={hues[i]}>●</tspan> {x.name.length > 16 ? x.name.slice(0, 15) + "…" : x.name} {Math.round(x.now)}{unit}
                </text>
              </g>
            ))}
            {hover != null && (
              <g>
                <line x1={X(hover)} x2={X(hover)} y1={padT} y2={H - padB} stroke={A.textMuted} strokeWidth={1} />
                {lineItems.map((x, i) => x.hist[hover] != null && (
                  <circle key={x.key} cx={X(hover)} cy={Y(x.hist[hover])} r={4} fill={hues[i]} stroke={A.bgCard} strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
          {hover != null && (
            <div style={{ position: "absolute", top: 40, left: `${Math.min(70, (X(hover) / W) * 100 + 2)}%`, background: A.bgCard, border: `1px solid ${A.border}`,
              borderRadius: 6, padding: "5px 8px", fontSize: 10, color: A.text, pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
              <div style={{ color: A.textMuted, marginBottom: 2 }}>{sd[hover]}</div>
              {lineItems.map((x, i) => (
                <div key={x.key}><span style={{ color: hues[i] }}>●</span> {x.name} <b>{x.hist[hover] != null ? `${Math.round(x.hist[hover])}${unit}` : "—"}</b></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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
            {t.stats && (
              <div title="Rank trend: points per session over the last 5 · sessions rising of the last 10"
                style={{ fontSize: 10, color: A.textMuted, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                {t.trend?.slope != null && <>trend <span style={{ color: t.trend.slope > 0.5 ? A.green : t.trend.slope < -0.5 ? A.red : A.textMuted }}>{t.trend.slope > 0 ? "+" : ""}{t.trend.slope.toFixed(1)}</span> {t.trend.ups}/{t.trend.of}</>}
              </div>
            )}
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
            <th style={th(A, "right")} title="Layer RS rank among all layers (0–100)">Rank</th>
            <th style={th(A, "right")} title="Typical (median) member's own stock RS — a top-ranked layer can still be made of middling stocks">Mbr RS</th>
            <th style={th(A, "right")}>1w</th>
            <th style={th(A, "right")}>1m</th>
            {showPeak && <th style={th(A, "right")}>Peak</th>}
            <th className="tp-hide-sm" style={th(A)}>{SPARK_N}d</th>
            <th className="tp-hide-sm" style={th(A, "right")} title="Rank change per session, least-squares over the last 5 sessions · sessions out of the last 10 the rank rose">Trend</th>
            <th className="tp-hide-sm" style={th(A, "right")} title="Accumulation / distribution days across members over 10 sessions (up or down ≥ 1% on ≥ 1.5× 50-day volume) · layer's share of universe dollar volume, 5-day vs 20-day">Volume</th>
            <th className="tp-hide-sm" style={th(A, "right")} title="Members at stock RS 90+ (change vs 5 sessions ago) · leaders that cracked this week (were RS 90+, now below the 50-day or under RS 80)">RS 90+</th>
            <th className="tp-hide-sm" style={th(A, "right")} title="Rank stability: sessions of the last 20 the layer ranked 80 or higher">80+ of 20</th>
            <th className="tp-hide-sm" style={th(A, "right")} title="Share of the trailing quarter this layer ranked ≥ 88">Held</th>
            <th style={th(A)}>Strongest names <span style={{ fontWeight: 400 }}>· click a row for every member</span></th>
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
            const b = l.stats, tr = l.trend;
            const flags = layerFlags(l);
            return (
              <React.Fragment key={l.key}>
              <tr onClick={() => onToggle?.(l)} title="Show every member in the Stocks box"
                style={{ cursor: "pointer", background: open ? A.bgHover : "transparent", boxShadow: open ? `inset 3px 0 0 ${c}` : "none" }}>
                <td style={td(A)}>
                  <div style={{ color: A.text, fontWeight: 600 }}>{l.name}</div>
                  <div style={{ fontSize: 10, color: A.textMuted }}>{l.theme}
                    {flags.map(([k, why]) => (
                      <span key={k} title={why} style={{ marginLeft: 5, padding: "0 4px", borderRadius: 3, fontSize: 9, fontWeight: 700,
                        border: `1px solid ${k === "confirmed" || k === "steady" ? A.green : k === "unconfirmed" || k === "spiky" ? A.textMuted : k === "exiting" ? A.red : A.yellow}`,
                        color: k === "confirmed" || k === "steady" ? A.green : k === "unconfirmed" || k === "spiky" ? A.textMuted : k === "exiting" ? A.red : A.yellow }}>{k}</span>
                    ))}
                  </div>
                </td>
                <td style={{ ...td(A, "right"), color: c, fontWeight: 700 }}>{l.now}</td>
                <td style={{ ...td(A, "right"), color: b?.rsMed == null ? A.textMuted : b.rsMed >= 80 ? A.green : b.rsMed >= 60 ? A.yellow : A.red }}>{b?.rsMed ?? "—"}</td>
                <td style={td(A, "right")}><Delta v={l.now - l.w1} A={A} /></td>
                <td style={td(A, "right")}><Delta v={l.now - l.m1} A={A} /></td>
                {showPeak && <td style={td(A, "right")}>{l.peak}</td>}
                <td className="tp-hide-sm" style={td(A)}><Spark vals={l.hist} color={c} A={A} /></td>
                <td className="tp-hide-sm" style={{ ...td(A, "right"), whiteSpace: "nowrap" }}>
                  {tr?.slope != null ? <span style={{ color: tr.slope > 0.5 ? A.green : tr.slope < -0.5 ? A.red : A.textMuted }}>{tr.slope > 0 ? "+" : ""}{tr.slope.toFixed(1)}</span> : "—"}
                  <span style={{ color: A.textMuted, fontSize: 10 }}> {tr?.of ? `${tr.ups}/${tr.of}` : ""}</span>
                </td>
                <td className="tp-hide-sm" style={{ ...td(A, "right"), whiteSpace: "nowrap", fontSize: 11 }}>
                  {l.conf?.acc != null ? (<>
                    <span style={{ color: l.conf.passed.includes("acc") ? A.green : l.conf.distHeavy ? A.red : A.textDim }}>{l.conf.acc}/{l.conf.dist}</span>
                    {l.conf.dvs != null && <span style={{ color: l.conf.dvs >= 1.15 ? A.green : l.conf.dvs < 0.87 ? A.red : A.textMuted }}> · {l.conf.dvs.toFixed(2)}×</span>}
                  </>) : b?.udv != null ? <span style={{ color: A.textMuted }}>{b.udv.toFixed(2)}</span> : "—"}
                </td>
                <td className="tp-hide-sm" style={{ ...td(A, "right"), whiteSpace: "nowrap", fontSize: 11 }}>
                  {l.conf?.l90 != null ? (<>
                    <span style={{ color: A.text }}>{l.conf.l90}</span>
                    {l.conf.l90d ? <span style={{ color: l.conf.l90d > 0 ? A.green : A.red, fontSize: 10 }}> {l.conf.l90d > 0 ? "+" : ""}{l.conf.l90d}</span> : null}
                    {l.conf.lx > 0 && <span title={`Cracked this week: ${l.conf.lxT.join(", ")}`} style={{ color: A.red, fontSize: 10 }}> · {l.conf.lx} out</span>}
                  </>) : "—"}
                </td>
                <td className="tp-hide-sm" style={{ ...td(A, "right"), fontSize: 11 }}>
                  {l.held?.of ? <span style={{ color: l.held.held >= 15 ? A.green : l.held.held >= 8 ? A.yellow : A.textMuted }}>{l.held.held}</span> : "—"}
                </td>
                <td className="tp-hide-sm" style={td(A, "right")}>{l.persist != null ? `${l.persist}%` : "—"}</td>
                <td style={{ ...td(A), whiteSpace: "normal", minWidth: 160 }}>
                  {names.map((h) => (
                    <TickerChip key={h.t} t={h.t} onClick={(t) => { onTicker(t); }} active={chartTicker === h.t || focus === h.t} A={A}
                      dim={(stockMap[h.t]?.rs_rank ?? 0) < 80} />
                  ))}
                  {all.length > 5 && <span style={{ fontSize: 10, color: A.textMuted }}>+{all.length - 5}</span>}
                </td>
              </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Stocks ────────────────────────────────────────────────────────────────
// Layer name in a stock row — click opens that layer's members in the Stocks
// box (and charts this stock) instead of selecting the row.
function LayerLink({ r, A, onLayer }) {
  if (!r.layer) return <span style={{ color: A.textMuted }}>—</span>;
  return (
    <span onClick={onLayer ? (e) => { e.stopPropagation(); onLayer(r.t ?? r.ticker); } : undefined}
      title={onLayer ? "Show every stock in this layer" : undefined}
      style={{ color: statusColor(r.layerSt, A), cursor: onLayer ? "pointer" : "inherit", textDecoration: onLayer ? "underline dotted" : "none", textUnderlineOffset: 2 }}>
      {r.layer}
    </span>
  );
}

function StockTable({ rows, A, onTicker, chartTicker, mode, onLayer }) {
  if (!rows.length) return <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 2px" }}>None.</div>;
  return (
    <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ position: "sticky", top: 0, background: A.bg }}>
          <tr>
            <th style={th(A)}>Ticker</th>
            <th style={th(A, "right")}>RS</th>
            <th style={th(A, "right")} title={EPS_TIP}>EPS</th>
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
                  <RslDot tip={r.rsl} A={A} />
                  {r.pin && <span title={r.pin} style={{ color: A.yellow, marginLeft: 4, fontSize: 9, fontWeight: 700, border: `1px solid ${A.yellow}`, borderRadius: 3, padding: "0 3px" }}>PIN</span>}
                </td>
                <td style={{ ...td(A, "right"), color: r.rs >= 90 ? A.green : r.rs < 70 ? A.red : A.yellow, fontWeight: 700 }}>{r.rs ?? "—"}</td>
                <td title={r.epsTip || ""} style={{ ...td(A, "right"), color: r.eps >= 80 ? A.green : r.eps >= 50 ? A.yellow : r.eps != null ? A.red : A.textMuted }}>{r.eps ?? "—"}{r.epsAcc ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
                {mode === "brk" && <td style={td(A, "right")}>{r.persist}%</td>}
                <td style={{ ...td(A, "right"), color: (r.sma50 ?? 0) >= 0 ? A.green : A.red }}>{pct(r.sma50)}</td>
                <td style={td(A, "right")}>{pct(r.off)}</td>
                <td style={{ ...td(A, "right"), color: (r.r1m ?? 0) >= 0 ? A.green : A.red }}>{pct(r.r1m)}</td>
                <td style={{ ...td(A), fontSize: 11, color: A.textMuted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                  <LayerLink r={r} A={A} onLayer={onLayer} />
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
  return { t: s.ticker, sma200, ema50, hi52, lo52, avgVol: s.avg_volume_raw, avg10, adr, rs: s.rs_rank, eps: s.eps_rating ?? null, epsTip: s.eps_tip, epsAcc: s.eps_accel };
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

function IntradayScan({ A, stockMap, onTicker, chartTicker, tickerLayer, allowed, onLayer }) {
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
      out.push({ t: b.t, px, zvr, chg, fromOpen, adr: b.adr, offHi, rs: b.rs, eps: b.eps, epsTip: b.epsTip, epsAcc: b.epsAcc, layer: L?.name, layerSt: L?.st });
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
                {col("adr", "ADR")}{col("offHi", "Off high")}{col("rs", "RS")}{col("eps", "EPS", "right", EPS_TIP)}
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
                  <td title={r.epsTip || ""} style={{ ...td(A, "right"), color: r.eps >= 80 ? A.green : r.eps >= 50 ? A.yellow : r.eps != null ? A.red : A.textMuted }}>{r.eps ?? "—"}{r.epsAcc ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
                  <td style={{ ...td(A), fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                    <LayerLink r={r} A={A} onLayer={onLayer} />
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
      rs: s?.rs_rank ?? m.rs_rank ?? null, eps: s?.eps_rating ?? null, epsTip: s?.eps_tip, epsAcc: s?.eps_accel,
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

function ExtHoursMovers({ A, pipeline, stockMap, tickerLayer, onTicker, chartTicker, onLayer }) {
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
                {hdr("vol", "Vol", "right")}{hdr("rs", "RS", "right")}{hdr("eps", "EPS", "right", EPS_TIP)}{hdr("layer", "Layer")}{hdr("catalyst", "Catalyst")}
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
                  <td title={r.epsTip || ""} style={{ ...td(A, "right"), color: r.eps >= 80 ? A.green : r.eps >= 50 ? A.yellow : r.eps != null ? A.red : A.textMuted }}>{r.eps ?? "—"}{r.epsAcc ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
                  <td style={{ ...td(A), fontSize: 11, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
                    <LayerLink r={r} A={A} onLayer={onLayer} />
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

function FlaggedTab({ A, stockMap, tickerLayer, onTicker, chartTicker, onLayer }) {
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
      rs: s.rs_rank ?? null, eps: s.eps_rating ?? null, epsTip: s.eps_tip, epsAcc: s.eps_accel, layer: L?.name, layerSt: L?.st,
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
                {col("adr", "ADR")}{col("offHi", "Off high")}{col("rs", "RS")}{col("eps", "EPS", "right", EPS_TIP)}
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
                  <td title={r.epsTip || ""} style={{ ...td(A, "right"), color: r.eps >= 80 ? A.green : r.eps >= 50 ? A.yellow : r.eps != null ? A.red : A.textMuted }}>{r.eps ?? "—"}{r.epsAcc ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
                  <td style={{ ...td(A), fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                    <LayerLink r={r} A={A} onLayer={onLayer} />
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

// Buyout-pinned / no-range names: a stock trading in a fixed deal band keeps
// RS 96–99 and sits ~0% off its high, so it floats to the top of Leaders
// without being a live breakout. Pinned = 20-day OR 5-day ADR under 0.8%, or
// the 5-day ADR has collapsed below half its long-run ADR (< 1.5%) while
// sitting within 2% of the high — the 20-day window still holds the
// announcement-day jump for a week or two, so it misses fresh deals (SGRY).
const PIN_ADR = 0.8;
function pinReason(s) {
  if (!s) return null;
  const a20 = s.adr20 ?? s.adr_pct, a5 = s.adr5, lt = s.adr_pct, off = s.off_52w_high;
  const lo = Math.min(a20 ?? Infinity, a5 ?? Infinity);
  if (lo < PIN_ADR) return `ADR ${lo.toFixed(2)}% — pinned / no range`;
  if (a5 != null && lt && off != null && a5 < 1.5 && off >= -2 && a5 < 0.5 * lt)
    return `5-day ADR ${a5.toFixed(2)}% vs ${lt.toFixed(1)}% normal at the high — likely deal-pinned`;
  return null;
}

// RS line leads price: the stock's RS line (close ÷ SPY) set a 52-week high
// on the latest session, price is still 5–15% under its own high (basing, not
// extended), and the stock closed UP that day — the RS line rose because the
// stock rallied, not just because it fell less than the market. In a broad
// correction almost every defensive name's RS line is at a high; the green
// close is what separates accumulation from "falling slower".
// Uses the pipeline's close-of-day change, the same bar rsl_hi_ago is measured on.
const RSL_OFF = [-15, -5];
function rsLeads(s) {
  if (!s || s.rsl_hi_ago !== 0) return null;
  const off = s.off_52w_high ?? s.pct_from_high;
  if (off == null || off > RSL_OFF[1] || off < RSL_OFF[0]) return null;
  if (s.change_pct == null || s.change_pct < 0) return null;
  return `RS line at a new 52-week high on a +${s.change_pct.toFixed(1)}% close while price is ${off.toFixed(1)}% off its high — RS leading price`;
}
const RslDot = ({ tip, A }) => (tip ? <span title={tip} style={{ color: A.blue || "#3b82f6", marginLeft: 4 }}>●</span> : null);

const SCAN_SORT = { m1w: "r1w", m1m: "r1m", m3m: "r3m", m6m: "r6m", strong: "rs", s20: "ago", antic: "ti65", hot: "r1m", liquid: "rs" };

// ── Written briefs (BRIEF → Written) ─────────────────────────────────────
// Dated snapshots in public/data/briefs/ (brief-index.json + <id>.json),
// committed by the Gmail → GitHub bridge. Everything is rendered as text —
// never as HTML — and links are limited to http(s).
const BRIEF_DIR = "/data/briefs/";
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
const SESSION_LABEL = { am: "Premarket", pm: "Postmarket", intraday: "Intraday" };

function WrittenBrief({ A, onTicker, chartTicker, modeSwitch }) {
  const [index, setIndex] = useState(null);
  const [sel, setSel] = useState(null);
  const [brief, setBrief] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    fetch(`${BRIEF_DIR}brief-index.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((ix) => { const list = Array.isArray(ix?.briefs) ? ix.briefs : []; setIndex(list); setSel(list[0]?.file || ix?.latest || null); })
      .catch(() => setErr("No written briefs published yet."));
  }, []);
  useEffect(() => {
    if (!sel || !/^[a-z0-9_-]+\.json$/i.test(sel)) return;
    setBrief(null);
    fetch(`${BRIEF_DIR}${sel}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((b) => { setBrief(b); setErr(null); }).catch(() => setErr(`Couldn't load ${sel}.`));
  }, [sel]);

  const num = (v, dg = 2) => (typeof v === "number" ? v.toFixed(dg) : "—");
  const pct = (v, dg = 1) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(dg)}%` : "—");
  const pc = (v) => (typeof v !== "number" ? A.textMuted : v >= 0 ? A.green : A.red);
  const rsC = (v) => (v >= 90 ? A.green : v >= 70 ? A.yellow : typeof v === "number" ? A.red : A.textMuted);
  const arr = (x) => (Array.isArray(x) ? x : []);
  const td = (align = "left") => ({ padding: "5px 6px", fontSize: 11, color: A.text, borderBottom: `1px solid ${A.border}`, textAlign: align, verticalAlign: "top", fontVariantNumeric: "tabular-nums" });
  const Tk = ({ t }) => (typeof t === "string" && t
    ? <span onClick={() => onTicker(t)} style={{ cursor: "pointer", fontFamily: "monospace", fontWeight: 700, color: chartTicker === t ? A.green : A.text }}>{t}</span>
    : null);
  const Src = ({ u }) => { const h = safeUrl(u); return h ? <a href={h} target="_blank" rel="noopener noreferrer" style={{ color: A.cyan, fontSize: 10, marginLeft: 4 }}>src</a> : null; };
  const label = (b) => `${b.label || b.date || b.id}${b.session ? ` · ${SESSION_LABEL[b.session] || b.session}` : ""}`;

  const picker = (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {index && index.length > 0 && (
        <select value={sel || ""} onChange={(e) => setSel(e.target.value)}
          style={{ background: A.bg, color: A.text, border: `1px solid ${A.border}`, borderRadius: 4, fontSize: 11, padding: "2px 4px", maxWidth: 260 }}>
          {index.map((b) => <option key={b.id || b.file} value={b.file}>{label(b)}</option>)}
        </select>
      )}
      {modeSwitch}
    </div>
  );
  if (err && !brief) return <Card A={A} title="Written brief" right={picker}><div style={{ fontSize: 12, color: A.textMuted }}>{err}</div></Card>;
  if (!brief) return <Card A={A} title="Written brief" right={picker}><div style={{ fontSize: 12, color: A.textMuted }}>Loading…</div></Card>;

  const rg = brief.regime || {};
  const br = rg.breadth || {};
  const st = brief.skipTraps || {};
  return (
    <div>
      <Card A={A} title="Written brief" sub={`${SESSION_LABEL[brief.session] || brief.session || ""} · ${brief.date || ""}${brief.dataAsOf ? ` · data as of ${brief.dataAsOf}` : ""}`} right={picker}>
        {brief.headline && <div style={{ fontSize: 16, fontWeight: 700, color: A.text, lineHeight: 1.35, marginBottom: 6 }}>{String(brief.headline)}</div>}
        {rg.posture && <div style={{ fontSize: 12, fontWeight: 700, color: /correction|defensive|risk off/i.test(rg.posture) ? A.red : A.green }}>{String(rg.posture)}</div>}
        {rg.note && <div style={{ fontSize: 11, color: A.textDim, marginTop: 3, lineHeight: 1.45 }}>{String(rg.note)}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, borderTop: `1px solid ${A.border}`, paddingTop: 10 }}>
          {arr(rg.indexes).map((x) => (
            <div key={x.symbol} style={{ minWidth: 120 }}>
              <div style={{ fontSize: 11, color: A.textMuted }}><Tk t={x.symbol} /></div>
              <div style={{ fontSize: 16, fontWeight: 700, color: pc(x.chgPct), fontVariantNumeric: "tabular-nums" }}>{num(x.price)} <span style={{ fontSize: 11 }}>{pct(x.chgPct, 2)}</span></div>
              <div style={{ fontSize: 10, color: A.textMuted }}>off high {pct(x.offHighPct)} · CR {typeof x.closingRangePct === "number" ? `${x.closingRangePct.toFixed(0)}%` : "—"}{typeof x.afterHours === "number" ? ` · AH ${num(x.afterHours)}` : ""}</div>
            </div>
          ))}
          {Object.keys(br).length > 0 && (
            <div style={{ fontSize: 11, color: A.textDim, lineHeight: 1.6 }}>
              <span style={{ color: A.green }}>{br.leadingLayers ?? "—"} leading</span> · <span style={{ color: A.cyan }}>{br.emergingLayers ?? "—"} emerging</span><br />
              <span style={{ color: A.yellow }}>{br.weakeningLayers ?? "—"} weakening</span> · <span style={{ color: A.red }}>{br.breakingDownLayers ?? "—"} breaking down</span> · {br.laggingLayers ?? "—"} lagging
            </div>
          )}
        </div>
      </Card>

      {arr(brief.macroTape).length > 0 && (
        <Card A={A} title="Macro tape">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {arr(brief.macroTape).map((m, i) => (
              <div key={i}>
                <div style={{ fontSize: 10, color: A.textMuted }}>{String(m.name ?? "")}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: A.text }}>{String(m.value ?? "")} <span style={{ fontSize: 11, color: /^\+/.test(m.change) ? A.green : /^-/.test(m.change) ? A.red : A.textDim }}>{String(m.change ?? "")}</span></div>
                <div style={{ fontSize: 10, color: A.textDim, lineHeight: 1.4, marginTop: 2 }}>{String(m.impact ?? "")}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {arr(brief.focusSetups).length > 0 && (
        <Card A={A} title="Focus setups" sub="Pivot, buy zone and stop as written in the brief · click a ticker to chart">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th(A)}>Ticker</th><th style={th(A)}>Layer</th><th style={th(A, "right")}>RS</th><th style={th(A, "right")}>EPS</th>
                <th style={th(A, "right")}>Price</th><th style={th(A, "right")}>Pivot</th><th style={th(A, "right")}>Buy ≤</th><th style={th(A, "right")}>Stop</th>
                <th style={th(A)}>Stage</th><th style={th(A)}>Size</th><th style={th(A)}>Catalyst</th>
              </tr></thead>
              <tbody>{arr(brief.focusSetups).map((f, i) => (
                <tr key={`${f.ticker}-${i}`}>
                  <td style={td()}><Tk t={f.ticker} /><div style={{ fontSize: 10, color: A.textMuted }}>{String(f.company ?? "")}</div></td>
                  <td style={td()}>{String(f.layer ?? "")}<div style={{ fontSize: 10, color: A.textMuted }}>{String(f.theme ?? "")}</div></td>
                  <td style={{ ...td("right"), color: rsC(f.rs) }}>{f.rs ?? "—"}</td>
                  <td style={{ ...td("right"), color: rsC(f.eps) }}>{f.eps ?? "—"}</td>
                  <td style={td("right")}>{num(f.price)}</td><td style={td("right")}>{num(f.pivot)}</td>
                  <td style={td("right")}>{num(f.buyZoneMax)}</td><td style={{ ...td("right"), color: A.red }}>{num(f.stop)}</td>
                  <td style={td()}>{String(f.baseStage ?? "")}<div style={{ fontSize: 10, color: A.textMuted }}>{[f.continuity, f.rsLine].filter(Boolean).map(String).join(" · ")}</div></td>
                  <td style={td()}>{String(f.sizing ?? "")}</td>
                  <td style={{ ...td(), color: A.textDim, minWidth: 220 }}>{String(f.catalyst ?? "")}<Src u={f.sourceUrl} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}

      {arr(brief.extendedMovers).length > 0 && (
        <Card A={A} title="Pre / after-market movers">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th(A)}>Ticker</th><th style={th(A)}>Session</th><th style={th(A, "right")}>Chg</th><th style={th(A, "right")}>Price</th>
                <th style={th(A, "right")}>Vol</th><th style={th(A, "right")}>RS</th><th style={th(A)}>Catalyst</th><th style={th(A)}>Protocol</th></tr></thead>
              <tbody>{arr(brief.extendedMovers).map((m, i) => (
                <tr key={`${m.ticker}-${i}`}>
                  <td style={td()}><Tk t={m.ticker} /></td><td style={td()}>{String(m.session ?? "")}</td>
                  <td style={{ ...td("right"), color: pc(m.chgPct) }}>{pct(m.chgPct, 2)}</td><td style={td("right")}>{num(m.price)}</td>
                  <td style={td("right")}>{String(m.vol ?? "")}</td><td style={{ ...td("right"), color: rsC(m.rs) }}>{m.rs ?? "—"}</td>
                  <td style={{ ...td(), color: A.textDim, minWidth: 200 }}>{String(m.catalyst ?? "")}<Src u={m.sourceUrl} /></td>
                  <td style={{ ...td(), color: A.textDim, minWidth: 200 }}>{String(m.protocol ?? "")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}

      {arr(brief.breakdowns).length > 0 && (
        <Card A={A} title="Breakdowns">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th(A)}>Ticker</th><th style={th(A)}>Layer</th><th style={th(A, "right")}>vs 50d</th><th style={th(A, "right")}>1M</th><th style={th(A)}>Catalyst</th></tr></thead>
              <tbody>{arr(brief.breakdowns).map((b, i) => (
                <tr key={`${b.ticker}-${i}`}>
                  <td style={td()}><Tk t={b.ticker} /></td><td style={td()}>{String(b.layer ?? "")}</td>
                  <td style={{ ...td("right"), color: pc(b.vs50dPct) }}>{pct(b.vs50dPct)}</td><td style={{ ...td("right"), color: pc(b.chg1mPct) }}>{pct(b.chg1mPct)}</td>
                  <td style={{ ...td(), color: A.textDim, minWidth: 220 }}>{String(b.catalyst ?? "")}<Src u={b.sourceUrl} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}

      {(arr(brief.radar).length > 0 || Object.keys(st).length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {arr(brief.radar).length > 0 && (
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              <Card A={A} title="Radar">
                {arr(brief.radar).map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${A.border}` }}>
                    <span style={{ color: A.cyan, fontFamily: "monospace", whiteSpace: "nowrap" }}>{String(r.date ?? "")}</span>
                    <span style={{ color: A.text }}>{String(r.event ?? "")}</span>
                  </div>
                ))}
              </Card>
            </div>
          )}
          {Object.keys(st).length > 0 && (
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              <Card A={A} title="Skip / traps">
                {[["buyoutCapped", "Buyout-capped"], ["extended", "Extended"], ["stage4", "Stage 4"]].concat(
                  Object.keys(st).filter((k) => !["buyoutCapped", "extended", "stage4"].includes(k)).map((k) => [k, k]))
                  .filter(([k]) => arr(st[k]).length).map(([k, lab]) => (
                    <div key={k} style={{ fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${A.border}` }}>
                      <span style={{ color: A.textMuted, marginRight: 8 }}>{lab}</span>
                      <span style={{ color: A.text }}>{arr(st[k]).map(String).join(" · ")}</span>
                    </div>
                  ))}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BriefPanel(props) {
  const { A } = props;
  const [mode, setMode] = useState(() => { try { return localStorage.getItem("tp_brief_mode") || "live"; } catch { return "live"; } });
  const pick = (m) => { setMode(m); try { localStorage.setItem("tp_brief_mode", m); } catch { /* ignore */ } };
  const modeSwitch = (
    <div style={{ display: "inline-flex", border: `1px solid ${A.border}`, borderRadius: 4, overflow: "hidden" }}>
      {[["live", "Live"], ["written", "Written"]].map(([k, l]) => (
        <button key={k} onClick={() => pick(k)} style={{ background: mode === k ? A.border : "transparent", color: mode === k ? A.text : A.textMuted,
          border: "none", padding: "2px 10px", fontSize: 11, cursor: "pointer" }}>{l}</button>
      ))}
    </div>
  );
  return mode === "written"
    ? <WrittenBrief A={A} onTicker={props.onTicker} chartTicker={props.chartTicker} modeSwitch={modeSwitch} />
    : <LiveBrief {...props} modeSwitch={modeSwitch} />;
}

// ── Brief (BRIEF view) ────────────────────────────────────────────────────
// The market brief rebuilt from live ThemePulse data, in the order the static
// written brief uses: headline strip → strongest stocks in the strongest
// themes (RS & EPS >= 80) → pre/after-market → rotation → emerging layers
// (confirmed vs unconfirmed) → breakdowns (leaders cracking, leaders breaking
// down). Every ticker charts on click; every layer / theme opens its members.
const isRising = (l) => l.st === "emerg" || (l.st !== "lead" && (l.now - (l.m1 ?? l.now)) >= 10 && (l.trend?.slope ?? 0) > 0);

function LiveBrief({ A, themes, layers, stockMap, tickerLayer, members, brk, pipeline, dates, theme, lb,
  onTicker, chartTicker, onLayer, onTheme, layerOfTicker, modeSwitch }) {
  const pct = (v, dg = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dg)}%`);
  const pc = (v) => (v == null ? A.textMuted : v >= 0 ? A.green : A.red);
  const rsC = (v) => (v >= 90 ? A.green : v >= 70 ? A.yellow : v != null ? A.red : A.textMuted);
  const epsC = (v) => (v >= 80 ? A.green : v >= 50 ? A.yellow : v != null ? A.red : A.textMuted);
  const tks = (l) => members[l.key] || (l.holds || []).map((h) => h.t);

  const top = useMemo(() => [...themes].sort((a, b) => b.now - a.now).slice(0, 5), [themes]);
  const byM1 = useMemo(() => [...themes].filter((t) => t.m1 != null).sort((a, b) => (b.now - b.m1) - (a.now - a.m1)), [themes]);

  // strongest stocks in the strongest themes: RS >= 80 and EPS >= 80
  const strongest = useMemo(() => top.map((t) => {
    const set = [...new Set(t.layers.flatMap(tks))];
    const rows = set.map((x) => stockMap[x]).filter((s) => s && (s.rs_rank ?? 0) >= 80 && (s.eps_rating ?? 0) >= 80)
      .sort((a, b) => (b.rs_rank - a.rs_rank) || (b.eps_rating - a.eps_rating)).slice(0, 6);
    return { t, rows, leading: t.layers.filter((l) => l.st === "lead").length };
  }), [top, stockMap, members]); // eslint-disable-line react-hooks/exhaustive-deps

  const emerging = useMemo(() => layers.filter(isRising)
    .map((l) => ({ l, cf: l.conf, names: tks(l).map((x) => stockMap[x]).filter((s) => s && (s.rs_rank ?? 0) >= 80)
      .sort((a, b) => b.rs_rank - a.rs_rank).slice(0, 4) }))
    .sort((a, b) => ((b.cf?.passed.length ?? 0) - (a.cf?.passed.length ?? 0)) || ((b.l.now - b.l.m1) - (a.l.now - a.l.m1)))
    .slice(0, 12), [layers, stockMap, members]); // eslint-disable-line react-hooks/exhaustive-deps

  const exiting = useMemo(() => layers.filter((l) => (l.conf?.lx ?? 0) >= 2 && (l.st === "lead" || l.st === "weak" || l.now >= 70))
    .sort((a, b) => b.conf.lx - a.conf.lx).slice(0, 10), [layers]);
  const totalExits = layers.reduce((n, l) => n + (l.conf?.lx ?? 0), 0);
  const leadingN = layers.filter((l) => l.st === "lead").length;

  const H = ({ children, sub }) => (
    <div style={{ margin: "4px 0 8px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: A.text, letterSpacing: 0.3 }}>{children}</div>
      {sub && <div style={{ fontSize: 10, color: A.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const Tk = ({ t }) => (
    <span onClick={(e) => { e.stopPropagation(); onTicker(t); }} style={{ cursor: "pointer", fontFamily: "monospace", fontWeight: 700,
      color: chartTicker === t ? A.green : A.text }}>{t}</span>
  );
  const Metric = ({ big, color, label, sub }) => (
    <div style={{ flex: "1 1 180px", minWidth: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{big}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: A.text, marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: A.textMuted, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
  const up = byM1[0], dn = byM1[byM1.length - 1];

  return (
    <div>
      <Card A={A} title="Market brief" sub={`Live from ThemePulse · layers as of ${dates[dates.length - 1] || "—"}`}
        right={modeSwitch}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, borderTop: `1px solid ${A.border}`, borderBottom: `1px solid ${A.border}`, padding: "10px 0" }}>
          {top[0] && <Metric big={`${top[0].theme} ${Math.round(top[0].now)}`} color={A.green}
            label={`Strongest themes${top[1] ? ` · then ${top[1].theme} ${Math.round(top[1].now)}` : ""}`}
            sub={`${leadingN} layers leading (rank ≥ 88) across the universe`} />}
          {up && dn && <Metric big={`${up.theme} +${Math.round(up.now - up.m1)}`} color={A.cyan}
            label="Biggest 1-month rotation in"
            sub={`Out: ${dn.theme} ${Math.round(dn.now - dn.m1)} · rank change over a month`} />}
          <Metric big={`${totalExits} exits`} color={totalExits ? A.red : A.textMuted} label="Leaders cracking this week"
            sub={exiting[0] ? `Most in ${exiting[0].name} (${exiting[0].conf.lx}) — RS 90+ names now below the 50-day or under RS 80` : "No layer has 2+ leaders cracking"} />
        </div>
      </Card>

      <Card A={A} title="Strongest stocks in the strongest themes" sub="Top 5 themes by rank · members with RS ≥ 80 and EPS ≥ 80 · click a ticker to chart, a theme or layer to open its stocks">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th(A)}>Ticker</th><th style={th(A)}>Layer</th>
              <th style={th(A, "right")}>RS</th><th style={th(A, "right")} title={EPS_TIP}>EPS</th>
              <th style={th(A, "right")}>vs 50d</th><th style={th(A, "right")}>Off high</th><th style={th(A, "right")}>1M</th>
            </tr></thead>
            <tbody>
              {strongest.map(({ t, rows, leading }) => (
                <React.Fragment key={t.themeId}>
                  <tr onClick={() => onTheme(t.themeId)} style={{ cursor: "pointer" }} title="Show every stock in this theme">
                    <td colSpan={7} style={{ ...td(A), paddingTop: 10, color: A.text, fontWeight: 700, borderBottom: `1px solid ${A.textDim}` }}>
                      {t.theme} <span style={{ color: statusColor(t.st, A) }}>{Math.round(t.now)}</span>
                      <span style={{ color: A.textMuted, fontWeight: 400, fontSize: 11 }}> · {leading} of {t.layers.length} layers leading · 1m <Delta v={t.now - t.m1} A={A} /></span>
                    </td>
                  </tr>
                  {rows.length ? rows.map((s) => {
                    const L = tickerLayer[s.ticker];
                    return (
                      <tr key={s.ticker} data-nav={s.ticker} onClick={() => onTicker(s.ticker)} style={{ cursor: "pointer", background: chartTicker === s.ticker ? A.bgHover : "transparent" }}>
                        <td style={td(A)}><FlagButton t={s.ticker} A={A} /><Tk t={s.ticker} /></td>
                        <td style={{ ...td(A), fontSize: 11 }}><LayerLink r={{ t: s.ticker, layer: L?.name, layerSt: L?.st }} A={A} onLayer={layerOfTicker} /></td>
                        <td style={{ ...td(A, "right"), color: rsC(s.rs_rank), fontWeight: 700 }}>{s.rs_rank}</td>
                        <td title={s.eps_tip || ""} style={{ ...td(A, "right"), color: epsC(s.eps_rating) }}>{s.eps_rating}{s.eps_accel ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
                        <td style={{ ...td(A, "right"), color: pc(s.sma50_pct) }}>{pct(s.sma50_pct)}</td>
                        <td style={td(A, "right")}>{pct(s.off_52w_high)}</td>
                        <td style={{ ...td(A, "right"), color: pc(s.return_1m) }}>{pct(s.return_1m)}</td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={7} style={{ ...td(A), color: A.textMuted, fontSize: 11 }}>No member clears RS 80 and EPS 80.</td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card A={A} title="Pre-market & after-hours movers">
        <ExtHoursMovers A={A} pipeline={pipeline} stockMap={stockMap} tickerLayer={tickerLayer} onTicker={onTicker} chartTicker={chartTicker} onLayer={layerOfTicker} />
      </Card>

      <Card A={A} title="Rotation" sub="RS rank change by layer or theme">
        <RotationView A={A} layers={layers} themes={themes} dates={dates} theme={theme} lb={lb}
          onLayer={onLayer} onTheme={(id) => onTheme(id)} />
      </Card>

      <Card A={A} title="Emerging layers" sub="Rank rising (Emerging, or +10 in a month and still climbing) · confirmed = 2+ of accumulation days, money flowing in, new RS 90+ leaders · early rotation backtested negative, so unconfirmed is a watchlist only">
        {!emerging.length ? <div style={{ fontSize: 11, color: A.textMuted }}>None.</div> : emerging.map(({ l, cf, names }) => {
          const ok = (cf?.passed.length ?? 0) >= 2;
          return (
            <div key={l.key} onClick={() => onLayer(l)} title="Show every stock in this layer"
              style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "6px 0", borderBottom: `1px solid ${A.border}`, cursor: "pointer" }}>
              <span style={{ minWidth: 170, color: A.text, fontWeight: 600, fontSize: 12 }}>{l.name} <span style={{ color: A.textMuted, fontWeight: 400, fontSize: 10 }}>{l.theme}</span></span>
              <span style={{ fontSize: 11, color: statusColor(l.st, A), fontWeight: 700, minWidth: 70 }}>{l.now} <span style={{ color: A.textMuted, fontWeight: 400 }}>1m</span> <Delta v={l.now - l.m1} A={A} /></span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "0 5px", borderRadius: 3, border: `1px solid ${ok ? A.green : A.textMuted}`, color: ok ? A.green : A.textMuted }}>
                {cf ? (ok ? "confirmed" : "unconfirmed") : "no volume data"}
              </span>
              {cf?.passed.length ? <span style={{ fontSize: 10, color: A.textMuted }}>{cf.passed.map((k) => CONF_LABEL[k]).join(" · ")}</span> : null}
              <span style={{ fontSize: 11, marginLeft: "auto" }}>
                {names.map((s) => <span key={s.ticker} style={{ marginLeft: 8 }}><Tk t={s.ticker} /> <span style={{ color: rsC(s.rs_rank), fontSize: 10 }}>{s.rs_rank}</span></span>)}
              </span>
            </div>
          );
        })}
      </Card>

      <Card A={A} title="Breakdowns" sub="Layers losing leaders this week (were RS 90+, now below the 50-day or under RS 80), then individual leaders breaking down">
        {exiting.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {exiting.map((l) => (
              <div key={l.key} onClick={() => onLayer(l)} title="Show every stock in this layer"
                style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "5px 0", borderBottom: `1px solid ${A.border}`, cursor: "pointer" }}>
                <span style={{ minWidth: 170, color: A.text, fontWeight: 600, fontSize: 12 }}>{l.name} <span style={{ color: A.textMuted, fontWeight: 400, fontSize: 10 }}>{l.theme}</span></span>
                <span style={{ fontSize: 11, color: A.red, fontWeight: 700 }}>{l.conf.lx} out</span>
                <span style={{ fontSize: 11 }}>{l.conf.lxT.slice(0, 10).map((t) => <span key={t} style={{ marginRight: 8 }}><Tk t={t} /></span>)}</span>
              </div>
            ))}
          </div>
        )}
        <H sub="Held the top RS decile ≥ 40% of the quarter, now RS < 70 or ≥ 8% below the 50-day">Leaders breaking down</H>
        <StockTable rows={brk.slice(0, 20)} A={A} onTicker={onTicker} chartTicker={chartTicker} mode="brk" onLayer={layerOfTicker} />
      </Card>
    </div>
  );
}

// ── Layer members ─────────────────────────────────────────────────────────
// Every stock in one layer, shown in the Stocks box when a layer row is
// clicked. Same columns as the Scanner plus vs-50d; ★ = fastest EPS grower.
function LayerMembers({ A, layer, tickers, stockMap, onTicker, chartTicker }) {
  const [sort, setSort] = useState({ k: "rs", d: -1 });
  const list = useMemo(() => tickers.filter((t) => stockMap[t]), [tickers, stockMap]);
  const { quotes, at } = useScanQuotes(list, true);
  const rows = useMemo(() => {
    const topEps = Math.max(-1, ...list.map((t) => stockMap[t]?.eps_rating ?? -1));
    const out = list.map((t) => {
      const s = stockMap[t], q = quotes.get(t);
      return {
        t, px: q?.price ?? s.close, chg: q?.change ?? s.change_pct ?? null,
        r1w: s.return_1w, r1m: s.return_1m, r3m: s.return_3m,
        adr: s.adr20 ?? s.adr_pct, s50: s.sma50_pct, off: s.off_52w_high ?? s.pct_from_high,
        rs: s.rs_rank, eps: s.eps_rating ?? null, epsTip: s.eps_tip, epsAcc: s.eps_accel,
        top: s.eps_rating != null && s.eps_rating === topEps, nh: s.nh20 === 1,
      };
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
  }, [list, quotes, sort, stockMap]);
  const col = (k, label, title) => (
    <th key={k} style={{ ...th(A, "right"), cursor: "pointer", userSelect: "none", color: sort.k === k ? A.text : A.textMuted }} title={title}
      onClick={() => setSort((p) => ({ k, d: p.k === k ? -p.d : -1 }))}>{label}{sort.k === k ? (sort.d < 0 ? " ▼" : " ▲") : ""}</th>
  );
  const pct = (v, dg = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dg)}%`);
  const pc = (v) => (v == null ? A.textMuted : v >= 0 ? A.green : A.red);
  const b = layer.stats;
  return (
    <div>
      <div style={{ fontSize: 10, color: A.textMuted, marginBottom: 6 }}>
        <span style={{ color: statusColor(layer.st, A), fontWeight: 700 }}>{STATUS[layer.st].label}</span> · rank {layer.now}{b?.rsMed != null && <> · typical member RS {b.rsMed}</>}
        {" "}(<Delta v={layer.now - layer.w1} A={A} /> 1w, <Delta v={layer.now - layer.m1} A={A} /> 1m) · {layer.theme}
        {at && <> · live {at.toLocaleTimeString()}</>}
        {" "}· ★ fastest EPS grower · ↑/↓ to step through
      </div>
      <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: A.bg }}>
            <tr>
              <th style={th(A)}>Ticker</th>
              {col("px", "Price")}{col("chg", "Chg")}
              {col("r1w", "1W")}{col("r1m", "1M")}{col("r3m", "3M")}
              {col("adr", "ADR")}{col("s50", "vs 50d")}{col("off", "Off high")}{col("rs", "RS")}{col("eps", "EPS", EPS_TIP)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.t} data-nav={r.t} onClick={() => onTicker(r.t)} style={{ cursor: "pointer", background: chartTicker === r.t ? A.bgHover : "transparent" }}>
                <td style={td(A)}><FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span>
                  {r.top && <span title="Fastest EPS grower in this layer" style={{ color: A.green, marginLeft: 4 }}>★</span>}
                  {r.nh && <span title="Closed at a 20-session high" style={{ color: A.cyan, marginLeft: 4, fontSize: 9 }}>NH</span>}</td>
                <td style={{ ...td(A, "right"), color: A.text }}>{r.px != null ? r.px.toFixed(2) : "—"}</td>
                <td style={{ ...td(A, "right"), color: pc(r.chg), fontWeight: 700 }}>{pct(r.chg, 2)}</td>
                <td style={{ ...td(A, "right"), color: pc(r.r1w) }}>{pct(r.r1w)}</td>
                <td style={{ ...td(A, "right"), color: pc(r.r1m) }}>{pct(r.r1m)}</td>
                <td style={{ ...td(A, "right"), color: pc(r.r3m) }}>{pct(r.r3m)}</td>
                <td style={td(A, "right")}>{r.adr == null ? "—" : `${r.adr.toFixed(1)}%`}</td>
                <td style={{ ...td(A, "right"), color: pc(r.s50) }}>{pct(r.s50)}</td>
                <td style={td(A, "right")}>{pct(r.off)}</td>
                <td style={{ ...td(A, "right"), color: r.rs >= 90 ? A.green : r.rs >= 70 ? A.yellow : r.rs != null ? A.red : A.textMuted, fontWeight: 700 }}>{r.rs ?? "—"}</td>
                <td title={r.epsTip || ""} style={{ ...td(A, "right"), color: r.eps >= 80 ? A.green : r.eps >= 50 ? A.yellow : r.eps != null ? A.red : A.textMuted }}>{r.eps ?? "—"}{r.epsAcc ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ScannerPanel({ A, stockMap, onTicker, chartTicker, tickerLayer, onLayer }) {
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
                  <td style={td(A)}><FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span>
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

// ── EPS Rating (O'Neil / IBD-style) ───────────────────────────────────────
// IBD's EPS Rating blends the two most recent quarters' year-over-year EPS
// growth with the multi-year annual growth rate, then ranks 1-99 against the
// universe. Built from each stock's own quarters[] / annual[] (GAAP EPS from
// FMP, so names with non-GAAP-only profits — stock-comp-heavy software — score
// lower than on IBD):
//   raw = 0.35·Q1 + 0.25·Q2 + 0.40·A3
//   Q1/Q2  latest / prior quarter EPS growth vs the year-ago quarter
//   A3     median of the last 3 annual EPS growth rates, −10 pts per down
//          year among them (O'Neil wants steady annual growth)
// Each growth term is capped to −100…+200 so one tiny base can't dominate.
// A current loss scores −100 (no credit for a shrinking loss); a swing from a
// loss to a profit scores +100.
const EPS_TIP = "O'Neil-style EPS Rating 1-99: last two quarters' year-over-year EPS growth + 3-year annual growth, ranked vs the universe. ▲ = growth accelerating 3 quarters running";
const capG = (x) => Math.max(-100, Math.min(200, x));
function epsGrowth(cur, prev, pct) {
  if (cur == null) return null;
  if (cur <= 0) return -100;
  if (prev != null) return prev <= 0 ? 100 : capG((cur / prev - 1) * 100);
  return pct == null ? null : capG(pct);
}
function epsRaw(s) {
  const Q = (s.quarters || []).filter((q) => q.eps != null)
    .sort((a, b) => String(b.report_date || "").localeCompare(String(a.report_date || "")));
  const Y = (s.annual || []).filter((a) => a.eps != null).sort((a, b) => b.year - a.year);
  if (Q.length < 2 || Y.length < 2) return null;
  let q1 = epsGrowth(Q[0].eps, null, Q[0].eps_yoy), q2 = epsGrowth(Q[1].eps, null, Q[1].eps_yoy);
  if (q1 == null && q2 == null) return null;
  q1 = q1 ?? q2; q2 = q2 ?? q1;   // one quarter without a year-ago figure: lean on the other
  // median of the last three annual growth rates, not a CAGR off one endpoint:
  // a single depressed base year (GPN 2022 EPS $0.41) made the CAGR +132%/yr
  const yg = Y.slice(0, 3).map((a, i) => (Y[i + 1] ? epsGrowth(a.eps, Y[i + 1].eps) : null)).filter((x) => x != null).sort((a, b) => a - b);
  let a3;
  if (Y[0].eps <= 0) a3 = -100;
  else a3 = yg.length ? yg[Math.floor(yg.length / 2)] : -100;
  const down = Y.slice(0, 3).filter((a, i) => Y[i + 1] && a.eps < Y[i + 1].eps).length;
  a3 -= 10 * down;
  // acceleration: growth rising quarter over quarter for the last three
  const q3 = Q[2] ? epsGrowth(Q[2].eps, null, Q[2].eps_yoy) : null;
  const accel = q3 != null && q1 >= 25 && q1 > q2 && q2 > q3;
  return { raw: 0.35 * q1 + 0.25 * q2 + 0.4 * a3, q1, q2, a3, down, accel };
}
function withEpsRating(stockMap) {
  const rows = [];
  for (const [t, s] of Object.entries(stockMap || {})) {
    const r = s?.ticker ? epsRaw(s) : null;
    if (r) rows.push([t, r]);
  }
  const sorted = rows.map(([, r]) => r.raw).sort((a, b) => a - b), n = sorted.length;
  const out = { ...stockMap };
  const fmt = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}%`;
  for (const [t, r] of rows) {
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] < r.raw ? (lo = m + 1) : (hi = m); }
    let up = lo; while (up < n && sorted[up] === r.raw) up++;
    const rating = Math.max(1, Math.min(99, Math.round(((lo + up + 1) / 2) / n * 98 + 1)));
    out[t] = { ...stockMap[t], eps_rating: rating, eps_accel: r.accel,
      eps_tip: `EPS Rating ${rating} — last qtr ${fmt(r.q1)} · prior qtr ${fmt(r.q2)} · 3-yr median ${fmt(r.a3)}/yr${r.down ? ` (incl. −${10 * r.down} for ${r.down} down yr)` : ""}${r.accel ? " · accelerating" : ""}` };
  }
  return out;
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
  const epsMap = useMemo(() => withEpsRating(stockMapIn), [stockMapIn]);
  const liveRs = useLiveRS(epsMap);
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
  const [hidePinned, setHidePinned] = useState(() => { try { return localStorage.getItem("tp_hide_pinned") !== "0"; } catch { return true; } });
  const togglePinned = () => setHidePinned((v) => { try { localStorage.setItem("tp_hide_pinned", v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  const [stockTab, setStockTab] = useState("intra");
  const [expanded, setExpanded] = useState(null);   // layer shown in the Stocks box
  const [themeView, setThemeView] = useState(() => { try { return localStorage.getItem("tp-theme-view") || "board"; } catch { return "board"; } });
  const pickThemeView = (v) => { setThemeView(v); try { localStorage.setItem("tp-theme-view", v); } catch { /* */ } };
  const prevTab = useRef("intra");
  const [lookup, setLookup] = useState("");
  const [lookupQ, setLookupQ] = useState("");
  const layersRef = React.useRef(null);
  const chain = useJson("/data/chain_layers.json");
  const layerBreadth = useJson("/data/layer_breadth.json");
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
      const stats = layerStats(members[key] || (l.holds || []).map((x) => x.t), stockMap || {});
      return { ...l, key, hist: h, st, peak, trend: rankTrend(h), held: rankHeld(h), stats, conf: layerConfirm(layerBreadth?.layers?.[key]) };
    });
  }, [rot, hist, dates, members, stockMap, layerBreadth]);

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
      const tks = [...new Set(L.flatMap((l) => members[l.key] || (l.holds || []).map((x) => x.t)))];
      return { ...t, counts, now, w1, m1, hist: h, st, trend: rankTrend(h), stats: layerStats(tks, stockMap || {}) };
    }).sort((a, b) => b.now - a.now);
  }, [layers, members, stockMap]);

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

  // EPS position inside the stock's own layer (the one shown in its Layer
  // column): the rating stays universe-wide; this is the tiebreaker for
  // picking the fastest grower inside a leading layer.
  const stockMapX = useMemo(() => {
    const out = { ...stockMap };
    for (const [t, l] of Object.entries(tickerLayer)) {
      const s = stockMap[t];
      if (!s || s.eps_rating == null) continue;
      const mem = (members[l.key] || (l.holds || []).map((h) => h.t))
        .filter((x) => stockMap[x]?.eps_rating != null)
        .sort((a, b) => stockMap[b].eps_rating - stockMap[a].eps_rating);
      const pos = mem.indexOf(t) + 1;
      if (pos > 0) out[t] = { ...s, eps_layer_pos: pos, eps_layer_n: mem.length,
        eps_tip: `${s.eps_tip} · #${pos} of ${mem.length} in ${l.name}` };
    }
    return out;
  }, [stockMap, tickerLayer, members]);

  const stocks = useMemo(() => {
    const pm = seats?.persistMap || {};
    const allowed = theme ? new Set(visLayers.flatMap((l) => (l.holds || []).map((h) => h.t))) : null;
    const lead = [], brk = [], pinned = [];
    Object.values(stockMapX || {}).forEach((s) => {
      if (!s?.ticker) return;
      if (allowed && !allowed.has(s.ticker)) return;
      if ((s.avg_dollar_vol_raw ?? 0) < 20e6) return;
      const pin = pinReason(s);
      const L = tickerLayer[s.ticker];
      const row = {
        ticker: s.ticker, rs: s.rs_rank, eps: s.eps_rating ?? null, epsTip: s.eps_tip, epsAcc: s.eps_accel, sma50: s.sma50_pct, off: s.off_52w_high, r1m: s.return_1m,
        layer: L?.name, layerSt: L?.st, inLead: L?.st === "lead", persist: pm[s.ticker]?.[0] ?? 0, pin, rsl: rsLeads(s),
      };
      if ((s.rs_rank ?? 0) >= 90 && s.above_50ma && (s.off_52w_high ?? -100) >= -25) {
        if (pin && hidePinned) pinned.push(s.ticker); else lead.push(row);
      }
      // A leader 1-2% under its 50d is a dip (backtest: leaders' red days are
      // dip-buys), not a breakdown — require real damage.
      else if (row.persist >= 40 && ((s.rs_rank ?? 0) < 70 || (s.sma50_pct ?? 0) <= -8)) brk.push(row);
    });
    lead.sort((a, b) => (b.inLead - a.inLead) || (b.rs - a.rs) || (b.off - a.off));
    brk.sort((a, b) => b.persist - a.persist || (a.rs ?? 0) - (b.rs ?? 0));
    return { lead: lead.slice(0, 60), brk: brk.slice(0, 60), pinned: pinned.sort() };
  }, [stockMapX, seats, tickerLayer, theme, visLayers, hidePinned]);

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
  // Show a layer's members in the Stocks box. chart: load its top-RS member.
  const showLayer = (l, chart = true) => {
    if (stockTab !== "layer") prevTab.current = stockTab;
    setExpanded(l.key); setStockTab("layer");
    if (chart) {
      const top = (members[l.key] || (l.holds || []).map((h) => h.t)).filter((t) => stockMap[t])
        .sort((a, b) => (stockMap[b]?.rs_rank ?? 0) - (stockMap[a]?.rs_rank ?? 0))[0];
      if (top) onTickerClick(top);
    }
    setTimeout(() => stocksRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };
  const closeLayer = () => { setExpanded(null); setStockTab(prevTab.current || "intra"); };
  // a layer opened in one view (LEADERS / SCANNER) doesn't follow you to the other
  const viewRef = useRef(view);
  useEffect(() => {
    if (viewRef.current !== view) { viewRef.current = view; if (stockTab === "layer") closeLayer(); }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const openLayer = (l) => {
    setTheme(null); setLayerTab(l.st); showLayer(l, false);
  };
  const [themeLayer, setThemeLayer] = useState(null);   // a whole theme shown like a layer
  const shownLayer = expanded ? (layers.find((l) => l.key === expanded) || (themeLayer?.key === expanded ? themeLayer : null)) : null;
  const showTheme = (themeId) => {
    const t = themes.find((x) => x.themeId === themeId);
    if (!t) return;
    const tks = [...new Set(t.layers.flatMap((l) => members[l.key] || (l.holds || []).map((h) => h.t)))];
    const pseudo = { key: `t:${themeId}`, name: t.theme, theme: `${t.layers.length} layers`, themeId, st: t.st,
      now: Math.round(t.now), w1: t.w1, m1: t.m1, stats: t.stats, holds: tks.map((x) => ({ t: x })) };
    setThemeLayer(pseudo);
    showLayer(pseudo);
  };
  // Layer cell in any stock table: open that layer, keep this stock on the chart
  const layerOfTicker = (t) => {
    const l = tickerLayer[t];
    if (!l) return;
    showLayer(l, false);
    onTickerClick(t);
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
      {view === "scanner" || view === "brief" ? (
        <div style={{ flex: "1 1 640px", minWidth: 0 }} ref={stocksRef}>
          {stockTab === "layer" && shownLayer && (
            <Card A={A} title={`${shownLayer.key.startsWith("t:") ? "Theme" : "Layer"}: ${shownLayer.name}`} right={<button onClick={closeLayer} title="Close this layer"
              style={{ background: "transparent", border: `1px solid ${A.border}`, color: A.textMuted, borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>✕ Close</button>}>
              <LayerMembers A={A} layer={shownLayer} tickers={members[shownLayer.key] || (shownLayer.holds || []).map((h) => h.t)}
                stockMap={stockMapX} onTicker={onTickerClick} chartTicker={chartTicker} />
            </Card>
          )}
          {view === "brief"
            ? <BriefPanel A={A} themes={themes} layers={layers} stockMap={stockMapX} tickerLayer={tickerLayer} members={members}
                brk={stocks.brk} pipeline={pipeline} dates={dates} theme={theme} lb={layerBreadth}
                onTicker={onTickerClick} chartTicker={chartTicker} onLayer={(l) => showLayer(l)} onTheme={showTheme} layerOfTicker={layerOfTicker} />
            : <ScannerPanel A={A} stockMap={stockMapX} onTicker={onTickerClick} chartTicker={chartTicker} tickerLayer={tickerLayer} onLayer={layerOfTicker} />}
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
              sub={stockTab === "layer" ? undefined : stockTab === "lead"
                ? <span>RS ≥ 90, above the 50-day, within 25% of the high · <span style={{ color: A.green }}>●</span> in a leading layer · <span style={{ color: A.blue || "#3b82f6" }}>●</span> RS line new high on an up close, price 5–15% off ·{" "}
                    <button onClick={togglePinned}
                      title={`Buyout-pinned / no-range names: 20-day or 5-day ADR under ${PIN_ADR}%, or a 5-day ADR collapsed to under half its normal while sitting at the high.${stocks.pinned.length ? `\nHidden: ${stocks.pinned.join(", ")}` : ""}`}
                      style={{ background: hidePinned ? A.bgHover : "transparent", border: `1px solid ${hidePinned ? A.yellow : A.border}`, color: hidePinned ? A.yellow : A.textMuted,
                        borderRadius: 4, padding: "1px 7px", fontSize: 10, cursor: "pointer" }}>
                      {hidePinned ? `Hiding ${stocks.pinned.length} pinned (ADR < ${PIN_ADR}% / M&A)` : `Show pinned names · click to hide`}
                    </button></span>
                : stockTab === "intra" || stockTab === "ext" || stockTab === "flag"
                ? undefined
                : "Held the top RS decile ≥ 40% of the quarter, now RS < 70 or ≥ 8% below the 50-day"}
              right={<div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                {shownLayer && (
                  <span style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${stockTab === "layer" ? statusColor(shownLayer.st, A) : A.border}`,
                    borderRadius: 4, background: stockTab === "layer" ? A.bgHover : "transparent" }}>
                    <button onClick={() => setStockTab("layer")}
                      style={{ background: "transparent", border: "none", color: stockTab === "layer" ? statusColor(shownLayer.st, A) : A.textDim,
                        padding: "3px 4px 3px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      {shownLayer.key.startsWith("t:") ? "Theme" : "Layer"}: {shownLayer.name} <span style={{ opacity: 0.7 }}>{(members[shownLayer.key] || shownLayer.holds || []).length}</span>
                    </button>
                    <button onClick={closeLayer} title="Close this layer"
                      style={{ background: "transparent", border: "none", color: A.textMuted, padding: "3px 7px 3px 3px", fontSize: 11, cursor: "pointer" }}>✕</button>
                  </span>
                )}
                <Tabs A={A} value={stockTab} onChange={setStockTab} items={[
                ["lead", "Leaders", stocks.lead.length, A.green],
                ["brk", "Leaders breaking down", stocks.brk.length, A.red],
                ["intra", "Intraday scan", "", A.cyan],
                ["ext", "Pre/After-market", "", A.purple],
                ["flag", "Flagged", "", A.gold],
              ]} /></div>}>
              {stockTab === "layer" && shownLayer
                ? <LayerMembers A={A} layer={shownLayer} tickers={members[shownLayer.key] || (shownLayer.holds || []).map((h) => h.t)}
                    stockMap={stockMapX} onTicker={onTickerClick} chartTicker={chartTicker} />
                : stockTab === "flag"
                ? <FlaggedTab A={A} stockMap={stockMapX} tickerLayer={tickerLayer} onTicker={onTickerClick} chartTicker={chartTicker} onLayer={layerOfTicker} />
                : stockTab === "ext"
                ? <ExtHoursMovers A={A} pipeline={pipeline} stockMap={stockMapX} tickerLayer={tickerLayer} onTicker={onTickerClick} chartTicker={chartTicker} onLayer={layerOfTicker} />
                : stockTab === "intra"
                ? <IntradayScan A={A} stockMap={stockMapX} onTicker={onTickerClick} chartTicker={chartTicker} tickerLayer={tickerLayer} onLayer={layerOfTicker}
                    allowed={theme ? new Set(visLayers.flatMap((l) => members[l.key] || (l.holds || []).map((h) => h.t))) : null} />
                : <StockTable rows={stocks[stockTab]} A={A} onTicker={onTickerClick} chartTicker={chartTicker} mode={stockTab} onLayer={layerOfTicker} />}
            </Card>
            </div>

            <ChangesPanel A={A} layers={layers} themes={themes} bars={idxBars} liveQuotes={indexQuotes} date={rot?.date}
              onTicker={onTickerClick} onLayer={(l) => { setTheme(l.themeId); setLayerTab(l.st); showLayer(l); }}
              onTheme={(id) => setTheme(id)} />
            <IndexPanel A={A} liveQuotes={indexQuotes} onTicker={onTickerClick} chartTicker={chartTicker} bars={idxBars} />

            <Card A={A} title="Themes"
              sub={themeView === "rot" ? "Who is rotating in and out — RS rank change by layer or theme" : "Average layer RS rank · ▲ leading / weakening / ▼ breaking-down layers · click to filter"}
              right={<Tabs A={A} value={themeView} onChange={pickThemeView} items={[["board", "Board", "", A.green], ["rot", "Rotation", "", A.cyan]]} />}>
              {themeView === "rot"
                ? <RotationView A={A} layers={layers} themes={themes} dates={dates} theme={theme} lb={layerBreadth}
                    onLayer={(l) => showLayer(l)} onTheme={(id, stocks) => (stocks ? showTheme(id) : setTheme(id))} />
                : <ThemeBoard themes={themes} A={A} selected={theme} onSelect={setTheme} />}
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
              <LayerTable rows={layerBuckets[layerTab]} A={A} onTicker={onTickerClick} chartTicker={chartTicker} stockMap={stockMapX}
                showPeak={layerTab === "weak" || layerTab === "brk"} members={members} expanded={expanded} onToggle={(l) => showLayer(l)} focus={lookupQ} />
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
