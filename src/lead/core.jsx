// Shared helpers, data hooks and small components for the Leaders / Scanner /
// Brief views. Split out of LeadershipView.jsx.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "../utils.js";
import { quoteStore } from "../liveQuotes.js";

import {
  LEAD,
  SPARK_N,
  STATUS,
  layerFlags,
  withLive,
  indexStats,
  sessionElapsedFrac,
  etClock,
  scanBase,
  rthMinute,
  expectedVolAt,
  EPS_TIP,
  rsScore,
  closingRange,
  rsLeads,
  fmtDollarVol,
} from "./math.js";
export * from "./math.js";

const _jsonCache = new Map();
const _jsonInflight = new Map();

export function useJson(path) {
  const [d, setD] = useState(() => (_jsonCache.has(path) ? _jsonCache.get(path) : null));
  useEffect(() => {
    if (!path) return;
    if (_jsonCache.has(path)) { setD(_jsonCache.get(path)); return; }
    let live = true;
    let p = _jsonInflight.get(path);
    if (!p) {
      p = fetch(path, { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j != null) _jsonCache.set(path, j);
          _jsonInflight.delete(path);
          return j;
        })
        .catch(() => {
          _jsonInflight.delete(path);
          return null;
        });
      _jsonInflight.set(path, p);
    }
    p.then((j) => { if (live && j != null) setD(j); });
    return () => { live = false; };
  }, [path]);
  return d;
}

export function statusColor(st, A) {
  return { lead: A.green, emerg: A.cyan, weak: A.yellow, brk: A.red, lag: A.textMuted }[st];
}

export function Spark({ vals, color, A, w = 90, h = 22 }) {
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

export function Delta({ v, A }) {
  if (v == null || !Number.isFinite(v)) return <span style={{ color: A.textMuted }}>—</span>;
  const c = v > 0 ? A.green : v < 0 ? A.red : A.textMuted;
  return <span style={{ color: c }}>{v > 0 ? "+" : ""}{Math.round(v)}</span>;
}

export function Card({ title, sub, right, children, A }) {
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

export const th = (A, align = "left") => ({ textAlign: align, fontSize: 10, fontWeight: 600, color: A.textMuted, padding: "4px 6px", borderBottom: `1px solid ${A.border}`, whiteSpace: "nowrap", letterSpacing: 0.3 });
export const td = (A, align = "left") => ({ textAlign: align, fontSize: 12, color: A.textDim, padding: "5px 6px", borderBottom: `1px solid ${A.border}`, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" });

export function TickerChip({ t, onClick, active, A, dim }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(t); }}
      style={{
        background: active ? A.glowGreen : "transparent", border: `1px solid ${active ? A.green : A.border}`,
        color: dim ? A.textMuted : A.text, borderRadius: 4, padding: "1px 5px", fontSize: 11, cursor: "pointer",
        fontFamily: "monospace", marginRight: 3, marginBottom: 2,
      }}>{t}</button>
  );
}

export function CopyTickersBtn({ tickers = [], A, label = "Copy Tickers", title }) {
  const [copied, setCopied] = useState(0);
  const timerRef = useRef(null);
  const list = useMemo(
    () => [...new Set((tickers || []).map((t) => String(t || "").trim()).filter(Boolean))],
    [tickers]
  );

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const flash = (n) => {
    setCopied(n);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(0), 1800);
  };

  const onCopy = (e) => {
    e.stopPropagation();
    if (!list.length) return;
    const text = list.join(",");
    const fallbackCopy = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        flash(list.length);
      } catch { /* ignore */ }
    };
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => flash(list.length)).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  };

  const disabled = list.length === 0;
  const active = copied > 0;
  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled}
      title={title || (disabled ? "No tickers to copy" : `Copy ${list.length} ticker${list.length === 1 ? "" : "s"} in TradingView comma-separated format`)}
      style={{
        background: active ? `${A.green}1f` : "transparent",
        border: `1px solid ${active ? A.green : A.border}`,
        color: active ? A.green : A.textDim,
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: active ? 700 : 600,
        fontFamily: "monospace",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        whiteSpace: "nowrap",
        transition: "border-color 0.15s, color 0.15s",
      }}
    >
      {active ? `Copied ${copied} ✓` : label}
    </button>
  );
}

// ── Themes ────────────────────────────────────────────────────────────────
export function ThemeBoard({ themes, A, selected, onSelect }) {
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
              <div title="Rank trend (5d slope, up/10 sessions) and today's median move + net dollar volume"
                style={{ fontSize: 10, color: A.textMuted, marginTop: 3, fontVariantNumeric: "tabular-nums", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
                {t.dayFlow?.today != null && (
                  <span style={{ color: t.dayFlow.today >= 0 ? A.green : A.red, fontWeight: 700 }}>
                    {t.dayFlow.today > 0 ? "+" : ""}{t.dayFlow.today.toFixed(1)}%
                    {t.dayFlow.n > 0 && <span style={{ color: A.textMuted, fontWeight: 400 }}> ({t.dayFlow.green}/{t.dayFlow.n})</span>}
                  </span>
                )}
                {t.dayFlow?.netDv != null && (
                  <span style={{ color: t.dayFlow.netDv >= 0 ? A.green : A.red }}>
                    {fmtDollarVol(t.dayFlow.netDv, true)}
                  </span>
                )}
                {t.dayFlow?.rvol != null && (
                  <span style={{ color: t.dayFlow.rvol >= 2 ? "#fbbf24" : t.dayFlow.rvol >= 1.35 ? A.green : A.textMuted, fontWeight: t.dayFlow.rvol >= 1.35 ? 700 : 400 }}>
                    {t.dayFlow.rvol.toFixed(1)}×
                  </span>
                )}
                {!t.dayFlow && t.trend?.slope != null && (
                  <span>trend <span style={{ color: t.trend.slope > 0.5 ? A.green : t.trend.slope < -0.5 ? A.red : A.textMuted }}>{t.trend.slope > 0 ? "+" : ""}{t.trend.slope.toFixed(1)}</span> {t.trend.ups}/{t.trend.of}</span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Layers ────────────────────────────────────────────────────────────────
// Sort keys for the Layers table. Click a header to sort (high → low first,
// A → Z for names); click again to flip; a third click restores the default
// order. The choice is remembered across tabs and reloads.
export const LAYER_SORT = {
  name: (l) => l.name?.toLowerCase(),
  rank: (l) => l.now,
  mbr: (l) => l.stats?.rsMed,
  w1: (l) => (l.w1 == null ? null : l.now - l.w1),
  m1: (l) => (l.m1 == null ? null : l.now - l.m1),
  peak: (l) => l.peak,
  spark: (l) => (l.hist?.length ? l.hist[l.hist.length - 1] - l.hist[0] : null),
  trend: (l) => l.trend?.slope,
  today: (l) => l.today,
  dvol: (l) => l.dayFlow?.dv,
  netDvol: (l) => l.dayFlow?.netDv,
  rvol: (l) => l.dayFlow?.rvol,
  vol: (l) => (l.conf?.acc != null ? l.conf.acc - l.conf.dist : null),
  rs90: (l) => l.conf?.l90,
  held20: (l) => (l.held?.held == null ? null : l.held.held * 1000 + (l.now ?? 0)),
  held: (l) => l.persist,
};

export function LayerTable({ rows: rowsIn, A, onTicker, chartTicker, stockMap, showPeak, members, expanded, onToggle, focus, compact, inlineExpand = false, maxHeight = 640, sort: extSort, onSort }) {
  const [innerSort, setInnerSort] = useState(() => { try { return JSON.parse(localStorage.getItem("tp_layer_sort")) || null; } catch { return null; } });
  const sort = onSort ? extSort : innerSort;
  const setSortVal = (next) => {
    if (onSort) onSort(next);
    else setInnerSort(next);
    try { localStorage.setItem("tp_layer_sort", JSON.stringify(next)); } catch { /* ignore */ }
  };
  const rows = useMemo(() => {
    if (!sort || !LAYER_SORT[sort.k]) return rowsIn;
    const f = LAYER_SORT[sort.k], dir = sort.d === "asc" ? 1 : -1;
    return [...rowsIn].sort((a, b) => {
      const x = f(a), y = f(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;            // blanks last either way
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (b.now ?? 0) - (a.now ?? 0);
    });
  }, [rowsIn, sort]);
  const clickSort = (k) => {
    const first = k === "name" ? "asc" : "desc";
    const next = !sort || sort.k !== k ? { k, d: first } : sort.d === first ? { k, d: first === "asc" ? "desc" : "asc" } : null;
    setSortVal(next);
  };
  const sh = (k, label, align, title, cls) => (
    <th className={cls} title={title} onClick={() => clickSort(k)}
      style={{ ...th(A, align), cursor: "pointer", userSelect: "none", color: sort?.k === k ? A.text : th(A).color }}>
      {label}{sort?.k === k ? (sort.d === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
  const colSpan = 11 + (showPeak ? 1 : 0) + (!compact ? 5 : 0);
  if (!rows.length) return <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 2px" }}>None.</div>;
  return (
    <div style={{ overflowX: "auto", maxHeight, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ position: "sticky", top: 0, background: A.bg, zIndex: 2 }}>
          <tr>
            {sh("name", "Layer", "left")}
            {sh("rank", "Rank", "right", "Layer RS rank among all layers (0–100)")}
            {sh("mbr", "Mbr RS", "right", "Typical (median) member's own stock RS — a top-ranked layer can still be made of middling stocks")}
            {sh("w1", "1w", "right", "Rank change over a week")}
            {sh("m1", "1m", "right", "Rank change over a month")}
            {sh("today", "Today", "right", "Median move of the layer's members today + green/total breadth — live during the session (hourly), otherwise the last close")}
            {sh("dvol", "$Vol", "right", "Total daily dollar volume traded across the layer's members today")}
            {sh("netDvol", "Net $Vol", "right", "Directional daily dollar flow: green members' $Vol minus red members' $Vol — surfaces the strongest institutional buying on the day")}
            {sh("rvol", "$Vol×", "right", "Today's layer $Vol ÷ 20-day average $Vol (pace-adjusted intraday) — spots thematic volume surges regardless of market cap", "tp-hide-sm")}
            {showPeak && sh("peak", "Peak", "right")}
            {!compact && sh("spark", `${SPARK_N}d`, "left", `Rank change over ${SPARK_N} sessions`, "tp-hide-sm")}
            {!compact && sh("trend", "Trend", "right", "Rank change per session, least-squares over the last 5 sessions · sessions out of the last 10 the rank rose", "tp-hide-sm")}
            {!compact && sh("vol", "Volume", "right", "Accumulation / distribution days across members over 10 sessions (up or down ≥ 1% on ≥ 1.5× 50-day volume) · layer's share of universe dollar volume, 5-day vs 20-day · sorts by accumulation minus distribution", "tp-hide-sm")}
            {sh("rs90", "RS 90+", "right", "Members at stock RS 90+ (change vs 5 sessions ago) · leaders that cracked this week (were RS 90+, now below the 50-day or under RS 80)", "tp-hide-sm")}
            {sh("held20", "80+ of 20", "right", "Holding up: sessions of the last 20 the layer ranked 80 or higher (ties broken by current RS rank)", "tp-hide-sm")}
            {!compact && sh("held", "Held", "right", "Share of the trailing quarter this layer ranked ≥ 88", "tp-hide-sm")}
            {!compact && <th style={th(A)}>Strongest names <span style={{ fontWeight: 400 }}>· click a row for every member</span></th>}
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
            const b = l.stats, tr = l.trend, df = l.dayFlow;
            const flags = layerFlags(l);
            return (
              <React.Fragment key={l.key}>
              <tr onClick={() => onToggle?.(l)} title={inlineExpand ? (open ? "Collapse members" : "Expand members below") : "Show every member in the Stocks box"}
                style={{ cursor: "pointer", background: open ? A.bgHover : "transparent", boxShadow: open ? `inset 3px 0 0 ${c}` : "none" }}>
                <td style={compact ? { ...td(A), whiteSpace: "normal", minWidth: 120 } : td(A)}>
                  <div style={{ color: A.text, fontWeight: 600 }}>
                    {inlineExpand && <span style={{ color: open ? c : A.textMuted, fontSize: 10, marginRight: 5, fontFamily: "monospace" }}>{open ? "▾" : "▸"}</span>}
                    {l.name}
                  </div>
                  <div style={{ fontSize: 10, color: A.textMuted }}>{l.theme}
                    {flags.map(([k, why]) => (
                      <span key={k} title={why} style={{ marginLeft: 5, padding: "0 4px", borderRadius: 3, fontSize: 9, fontWeight: 700,
                        border: `1px solid ${k === "confirmed" || k === "steady" ? A.green : k === "unconfirmed" || k === "spiky" ? A.textMuted : k === "exiting" ? A.red : A.yellow}`,
                        color: k === "confirmed" || k === "steady" ? A.green : k === "unconfirmed" || k === "spiky" ? A.textMuted : k === "exiting" ? A.red : A.yellow }}>{k}</span>
                    ))}
                  </div>
                </td>
                <td title={l.rankLive ? `Live — ${l.now_close} at the close, ${l.now - l.now_close >= 0 ? "+" : ""}${l.now - l.now_close} today` : undefined}
                  style={{ ...td(A, "right"), color: c, fontWeight: 700 }}>{l.now}{l.rankLive && l.now !== l.now_close
                    ? <span style={{ fontSize: 9, color: l.now > l.now_close ? A.green : A.red }}>{l.now > l.now_close ? "▲" : "▼"}</span> : null}</td>
                <td style={{ ...td(A, "right"), color: b?.rsMed == null ? A.textMuted : b.rsMed >= 80 ? A.green : b.rsMed >= 60 ? A.yellow : A.red }}>{b?.rsMed ?? "—"}</td>
                <td style={td(A, "right")}><Delta v={l.now - l.w1} A={A} /></td>
                <td style={td(A, "right")}><Delta v={l.now - l.m1} A={A} /></td>
                <td style={{ ...td(A, "right"), whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  <span style={{ color: l.today == null ? A.textMuted : l.today >= 0 ? A.green : A.red, fontWeight: 700 }}>
                    {l.today == null ? "—" : `${l.today > 0 ? "+" : ""}${l.today.toFixed(1)}%`}
                  </span>
                  {df?.n > 0 && (
                    <span style={{ color: A.textMuted, fontSize: 9, marginLeft: 4 }}>{df.green}/{df.n}</span>
                  )}
                </td>
                <td style={{ ...td(A, "right"), color: A.textDim, fontFamily: "monospace", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {fmtDollarVol(df?.dv)}
                </td>
                <td style={{ ...td(A, "right"), color: df?.netDv == null ? A.textMuted : df.netDv > 0 ? A.green : df.netDv < 0 ? A.red : A.textMuted, fontWeight: df?.netDv != null && Math.abs(df.netDv) >= 1e9 ? 700 : 500, fontFamily: "monospace", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {fmtDollarVol(df?.netDv, true)}
                </td>
                <td className="tp-hide-sm" style={{ ...td(A, "right"), color: df?.rvol == null ? A.textMuted : df.rvol >= 2.0 ? "#fbbf24" : df.rvol >= 1.35 ? A.green : A.textDim, fontWeight: (df?.rvol ?? 0) >= 1.35 ? 700 : 400, fontFamily: "monospace", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {df?.rvol != null ? `${df.rvol.toFixed(2)}×` : "—"}
                </td>
                {showPeak && <td style={td(A, "right")}>{l.peak}</td>}
                {!compact && <td className="tp-hide-sm" style={td(A)}><Spark vals={l.hist} color={c} A={A} /></td>}
                {!compact && <td className="tp-hide-sm" style={{ ...td(A, "right"), whiteSpace: "nowrap" }}>
                  {tr?.slope != null ? <span style={{ color: tr.slope > 0.5 ? A.green : tr.slope < -0.5 ? A.red : A.textMuted }}>{tr.slope > 0 ? "+" : ""}{tr.slope.toFixed(1)}</span> : "—"}
                  <span style={{ color: A.textMuted, fontSize: 10 }}> {tr?.of ? `${tr.ups}/${tr.of}` : ""}</span>
                </td>}
                {!compact && <td className="tp-hide-sm" style={{ ...td(A, "right"), whiteSpace: "nowrap", fontSize: 11 }}>
                  {l.conf?.acc != null ? (<>
                    <span style={{ color: l.conf.passed.includes("acc") ? A.green : l.conf.distHeavy ? A.red : A.textDim }}>{l.conf.acc}/{l.conf.dist}</span>
                    {l.conf.dvs != null && <span style={{ color: l.conf.dvs >= 1.15 ? A.green : l.conf.dvs < 0.87 ? A.red : A.textMuted }}> · {l.conf.dvs.toFixed(2)}×</span>}
                  </>) : b?.udv != null ? <span style={{ color: A.textMuted }}>{b.udv.toFixed(2)}</span> : "—"}
                </td>}
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
                {!compact && <td className="tp-hide-sm" style={td(A, "right")}>{l.persist != null ? `${l.persist}%` : "—"}</td>}
                {!compact && <td style={{ ...td(A), whiteSpace: "normal", minWidth: 160 }}>
                  {names.map((h) => (
                    <TickerChip key={h.t} t={h.t} onClick={(t) => { onTicker(t); }} active={chartTicker === h.t || focus === h.t} A={A}
                      dim={(stockMap[h.t]?.rs_rank ?? 0) < 80} />
                  ))}
                  {all.length > 5 && <span style={{ fontSize: 10, color: A.textMuted }}>+{all.length - 5}</span>}
                </td>}
              </tr>
              {inlineExpand && open && (
                <tr onClick={(e) => e.stopPropagation()}>
                  <td
                    colSpan={colSpan}
                    style={{
                      padding: "8px 10px 10px 12px",
                      background: A.bg,
                      borderBottom: `1px solid ${A.border}`,
                      boxShadow: `inset 3px 0 0 ${c}`,
                    }}
                  >
                    <LayerMembers
                      A={A}
                      layer={l}
                      tickers={members?.[l.key] || (l.holds || []).map((h) => h.t)}
                      stockMap={stockMap}
                      onTicker={onTicker}
                      chartTicker={chartTicker}
                      maxHeight={340}
                      onClose={() => onToggle?.(l)}
                    />
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
// Layer name in a stock row — click opens that layer's members in the Stocks
// box (and charts this stock) instead of selecting the row.
export function LayerLink({ r, A, onLayer }) {
  if (!r.layer) return <span style={{ color: A.textMuted }}>—</span>;
  return (
    <span onClick={onLayer ? (e) => { e.stopPropagation(); onLayer(r.t ?? r.ticker); } : undefined}
      title={onLayer ? "Show every stock in this layer" : undefined}
      style={{ color: statusColor(r.layerSt, A), cursor: onLayer ? "pointer" : "inherit", textDecoration: onLayer ? "underline dotted" : "none", textUnderlineOffset: 2 }}>
      {r.layer}
    </span>
  );
}

export function StockTable({ rows, A, onTicker, chartTicker, mode, onLayer }) {
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

export function Tabs({ value, onChange, items, A }) {
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

export const _ohlcCache = {};
export function useIndexBars(tickers) {
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
      authFetch(`/api/ohlc?ticker=${encodeURIComponent(t)}`)
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

export function IndexSpark({ s, A, color, w = 120, h = 30 }) {
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

export function IndexPanel({ A, liveQuotes, onTicker, chartTicker, bars }) {
  // Open by default; collapsing leaves a one-line strip of day change + trend.
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("tp_indexes_open") !== "0"; } catch { return true; } });
  const toggle = () => setOpen((v) => { try { localStorage.setItem("tp_indexes_open", v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  const rows = LEAD_INDEXES.map((x) => ({ ...x, s: indexStats(bars[x.t], liveQuotes?.get?.(x.t)) }));
  const ready = rows.filter((r) => r.s);
  const toneC = (t) => ({ green: A.green, yellow: A.yellow, orange: "#fb923c", red: A.red }[t] || A.textDim);
  const up = ready.filter((r) => r.s.trend === "Uptrend").length;
  const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
  const pc = (v) => ({ color: v == null ? A.textMuted : v >= 0 ? A.green : A.red });
  const asOf = ready.find((r) => r.s.asOf)?.s.asOf;
  return (
    <Card A={A} title={<span onClick={toggle} style={{ cursor: "pointer" }}>{open ? "▾" : "▸"} Major indexes</span>}
      sub={!ready.length ? "Loading index data…" : open
        ? `${up} of ${ready.length} in an uptrend (above a rising 21e > 50d > 200d) · ${asOf === "live" ? "live" : `as of ${asOf}`} · line = price, blue = 21e, dashed = 50d`
        : <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 10 }}>
            {ready.map(({ t, s }) => (
              <span key={t} onClick={() => onTicker(t)} title={`${t} · ${s.trend}`} style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
                <b style={{ color: chartTicker === t ? A.green : A.text }}>{t}</b> <span style={pc(s.day)}>{fmt(s.day, 2)}</span>
                <span style={{ color: toneC(s.tone), fontSize: 10 }}> {s.trend}</span>
              </span>
            ))}
          </span>}
      right={<button onClick={toggle} style={{ background: "transparent", border: `1px solid ${A.border}`, color: A.textMuted, borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>{open ? "Hide" : "Show"}</button>}>
      {open && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 8 }}>
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
      </div>}
    </Card>
  );
}

// ── Market gate (O'Neil direction + exposure) ───────────────────────────────
// From breadth.json → conditions.market_gate (stock-pipeline market_gate.py):
// correction → rally attempt (day count) → follow-through day → uptrend, per
// SPY and QQQ, with distribution days and a suggested exposure range. During
// the session a live quote previews whether today could be the follow-through
// (or an undercut that resets the count) — confirmed only at the close.
export const GATE_COLOR = (st, A) => (st === "uptrend" ? A.green : st === "ftd" ? A.cyan : st === "rally" ? A.yellow : A.red);
export const GATE_NAME = { correction: "Correction", rally: "Rally attempt", ftd: "Follow-through", uptrend: "Uptrend" };
export function MarketGate({ A, gate, liveQuotes }) {
  if (!gate?.overall) return null;
  const o = gate.overall;
  const live = Object.entries(gate.indices || {}).map(([t, g]) => {
    const q = liveQuotes?.get?.(t);
    if (!g || !q?.price || !q.previousClose || Math.abs(q.previousClose - g.close) / g.close > 0.0005) return null;
    const chg = (q.price / q.previousClose - 1) * 100;
    const volUp = g.volume && q.volume ? q.volume > g.volume : null;
    if ((g.state === "rally" || g.state === "correction") && g.low != null && (q.dayLow ?? q.price) < g.low)
      return { t, tone: A.red, text: `${t} undercutting the low (${g.low}) — the rally count resets` };
    if (g.state === "correction" && chg > 0) return { t, tone: A.yellow, text: `${t} up ${chg.toFixed(2)}% — rally day 1 if it closes up` };
    if (g.state === "rally" && g.rally_day + 1 >= 4 && chg >= 1.2)
      return { t, tone: A.cyan, text: `${t} +${chg.toFixed(2)}% on rally day ${g.rally_day + 1} — possible follow-through if it holds into the close${volUp == null ? "" : volUp ? " (volume already above yesterday)" : " (needs volume above yesterday's)"}` };
    if (g.state === "ftd" && g.low != null && q.price < g.low) return { t, tone: A.red, text: `${t} below the rally low ${g.low} — follow-through failing` };
    return null;
  }).filter(Boolean);
  const idx = (t) => {
    const g = gate.indices?.[t];
    if (!g) return null;
    const ev = (g.events || []).slice().reverse().map((e) => `${e.date}  ${e.event.replace("_", " ")}`).join("\n");
    const detail = g.state === "rally" ? `day ${g.rally_day} · low ${g.low}` : g.state === "ftd" ? `FTD ${g.ftd_date} +${g.ftd_chg}%` : g.state === "correction" ? `low ${g.low}` : g.ftd_date ? `since FTD ${g.ftd_date}` : "";
    return (
      <span key={t} title={`Recent events (as of ${g.asof}):\n${ev}\n\nDistribution days (25 sessions): ${(g.dist_dates || []).join(", ") || "none"}`}
        style={{ fontSize: 11, color: A.textDim, whiteSpace: "nowrap" }}>
        <b style={{ color: A.text }}>{t}</b> <span style={{ color: GATE_COLOR(g.state, A) }}>{GATE_NAME[g.state]}</span>
        {detail ? ` · ${detail}` : ""} · {g.dist_days} dist · {g.off_high}% off high
      </span>
    );
  };
  return (
    <div style={{ width: "100%", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", borderTop: `1px solid ${A.border}`, paddingTop: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: A.textMuted, letterSpacing: 0.4 }}>MARKET GATE</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: GATE_COLOR(o.state, A) }}>{o.label}</div>
      </div>
      <div title="Suggested total exposure for the market state — a guide, not a rule"
        style={{ border: `1px solid ${GATE_COLOR(o.state, A)}`, borderRadius: 6, padding: "3px 10px", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: GATE_COLOR(o.state, A), lineHeight: 1.1 }}>{o.exposure}</div>
        <div style={{ fontSize: 9, color: A.textMuted }}>exposure</div>
      </div>
      <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 11, color: A.textDim, lineHeight: 1.45 }}>{o.note}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{idx("SPY")}{idx("QQQ")}</div>
      {live.map((l) => (
        <div key={l.t} style={{ width: "100%", fontSize: 11, color: l.tone, fontWeight: 600 }}>● Live: {l.text}</div>
      ))}
    </div>
  );
}

// ── What changed today ────────────────────────────────────────────────────
// Diff of today vs the prior session: layers crossing the leadership line,
// layers breaking down, the biggest rank moves, theme moves, and index trend
// changes (computed by re-running indexStats without today's bar).
export function ChangesPanel({ A, layers, themes, bars, liveQuotes, date, onTicker, onLayer, onTheme }) {
  // Collapsed by default; the choice is remembered.
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("tp_changes_open") === "1"; } catch { return false; } });
  const toggle = () => setOpen((v) => { try { localStorage.setItem("tp_changes_open", v ? "0" : "1"); } catch { /* ignore */ } return !v; });
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
    <Card A={A} title={<span onClick={toggle} style={{ cursor: "pointer" }}>{open ? "▾" : "▸"} What changed today</span>}
      sub={open ? `vs the prior session${date ? ` · layers as of ${date}` : ""} · click a layer to jump to it`
        : empty ? "No notable changes" : [idxEvents.length && `${idxEvents.length} index event${idxEvents.length > 1 ? "s" : ""}`, gained.length && `${gained.length} new leaders`,
            lost.length && `${lost.length} lost leadership`, broke.length && `${broke.length} broke down`].filter(Boolean).join(" · ") || "Rank moves only"}
      right={<button onClick={toggle} style={{ background: "transparent", border: `1px solid ${A.border}`, color: A.textMuted, borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>{open ? "Hide" : "Show"}</button>}>
      {open && <>
      {empty && <div style={{ fontSize: 11, color: A.textMuted }}>No notable changes.</div>}
      {row("INDEXES", A.text, idxEvents.map((e, i) => chip(`${e.t}${i}`, e.t, e.text, e.good ? A.green : A.red, () => onTicker(e.t))))}
      {row("NEW LEADERS", A.green, gained.map((l) => layerChip(l, A.green)))}
      {row("LOST LEADERSHIP", A.yellow, lost.map((l) => layerChip(l, A.yellow)))}
      {row("BROKE DOWN", A.red, broke.map((l) => layerChip(l, A.red)))}
      {row("BIGGEST GAINS", A.green, up.map(({ l, d }) => layerChip(l, A.green, `+${d}`)))}
      {row("BIGGEST DROPS", A.red, dn.map(({ l, d }) => layerChip(l, A.red, `${d}`)))}
      {row("THEMES", A.textDim, themeMoves.map(({ t, d }) => chip(t.themeId, t.theme, `${d > 0 ? "+" : ""}${d.toFixed(0)}`, d > 0 ? A.green : A.red, () => onTheme(t.themeId))))}
      </>}
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
export function useScanQuotes(tickers, active) {
  const [tick, setTick] = useState(0);
  const key = tickers.join(",");
  useEffect(() => {
    if (!active || !key) return;
    const list = key.split(",");
    // 60s polls during RTH, slow 15-min refresh outside — coalesced through shared quoteStore
    const id = quoteStore.register(list, { rthMs: 60000, extMs: 15 * 60000, offMs: 15 * 60000 });
    const unsub = quoteStore.subscribe(() => setTick((n) => n + 1));
    return () => {
      unsub();
      quoteStore.unregister(id);
    };
  }, [key, active]);
  const quotes = useMemo(() => {
    void tick;
    return active && key ? quoteStore.getMap(key.split(",")) : new Map();
  }, [key, active, tick]);
  return { quotes, at: quotes.size ? quoteStore.getUpdated() : null };
}

export const ZVR_SNAP_KEY = "tp-zvr-close-v2"; // v2: ratio vs 10-session avg (v1 was % vs 50d)
export function readZvrSnap() {
  try { return JSON.parse(localStorage.getItem(ZVR_SNAP_KEY) || "null"); } catch { return null; }
}
export function writeZvrSnap(date, map) {
  try { localStorage.setItem(ZVR_SNAP_KEY, JSON.stringify({ date, at: new Date().toISOString(), z: map })); } catch { /* storage off */ }
}

export function useRvolProfiles() { return useJson("/data/rvol_profiles.json"); }
// ADR floor for the Stocks box: one click toggles it (last value, 4% the first
// time); type a value to change it. Filters every Stocks tab by 20-day ADR.
export function AdrFilter({ A, value, onChange }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const last = () => { try { return parseFloat(localStorage.getItem("tp_adr_last")) || 4; } catch { return 4; } };
  const commit = (v) => { const n = parseFloat(v); if (n > 0) { try { localStorage.setItem("tp_adr_last", String(n)); } catch { /* ignore */ } onChange(n); } else onChange(null); };
  const on = value != null;
  return (
    <span title="Show only stocks with a 20-day ADR at or above this — applies to every Stocks tab"
      style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${on ? A.cyan : A.border}`, borderRadius: 4, background: on ? A.bgHover : "transparent", marginRight: 4 }}>
      <button onClick={() => (on ? onChange(null) : commit(last()))}
        style={{ background: "transparent", border: "none", color: on ? A.cyan : A.textDim, padding: "3px 4px 3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>ADR ≥</button>
      <input value={draft} inputMode="decimal" aria-label="Minimum ADR percent" placeholder="—"
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={() => commit(draft)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{ width: 30, background: "transparent", border: "none", color: on ? A.cyan : A.textDim, fontSize: 11, fontWeight: 600, textAlign: "right", padding: "3px 0", outline: "none" }} />
      <span style={{ color: on ? A.cyan : A.textMuted, fontSize: 11, padding: "0 7px 0 1px" }}>%</span>
    </span>
  );
}

export function IntradayScan({ A, stockMap, onTicker, chartTicker, tickerLayer, allowed, onLayer, keep }) {
  const profiles = useJson("/data/rvol_profiles.json");
  const base = useMemo(() => Object.values(stockMap || {}).map((x) => scanBase(x, etClock().session)).filter(Boolean)
    .filter((b) => (!allowed || allowed.has(b.t)) && (!keep || keep(b.t))), [stockMap, allowed, keep]);
  const { quotes, at } = useScanQuotes(base.map((b) => b.t), true);
  const [sort, setSort] = useState({ k: "fromOpen", d: -1 });
  const clock = etClock();
  const snap = useMemo(() => { if (clock.rth) return null; void quotes; return readZvrSnap(); }, [clock.rth, quotes]);
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
                  <td style={td(A)}><FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span><TierMark t={r.t} /></td>
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
export function extRows(snap, stockMap, tickerLayer, universeOnly) {
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

export function ExtHoursMovers({ A, pipeline, stockMap, tickerLayer, onTicker, chartTicker, onLayer, keep }) {
  const [uOnly, setUOnly] = useState(true);
  const today = etClock().today;
  const pmSnap = useMemo(() => pipeline?.last_pm || (pipeline?.pm_sip_movers?.length || pipeline?.pm_earnings_movers?.length
    ? { session: null, earnings: pipeline.pm_earnings_movers, movers: pipeline.pm_sip_movers, top: pipeline.pm_top_movers } : null), [pipeline]);
  const ahSnap = useMemo(() => pipeline?.last_ah || (pipeline?.ah_sip_movers?.length || pipeline?.ah_earnings_movers?.length
    ? { session: null, earnings: pipeline.ah_earnings_movers, movers: pipeline.ah_sip_movers, top: pipeline.ah_top_movers } : null), [pipeline]);
  const pmRows = useMemo(() => extRows(pmSnap, stockMap, tickerLayer, uOnly).filter((r) => !keep || keep(r.t)), [pmSnap, stockMap, tickerLayer, uOnly, keep]);
  const ahRows = useMemo(() => extRows(ahSnap, stockMap, tickerLayer, uOnly).filter((r) => !keep || keep(r.t)), [ahSnap, stockMap, tickerLayer, uOnly, keep]);
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
                    <FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span><TierMark t={r.t} />
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
export const FLAG_ORDER = ["red", "blue", "gold"];
export const FLAG_LS = "tp-flags";
export const _flags = { map: {}, subs: new Set(), loading: null };
try { _flags.map = JSON.parse(localStorage.getItem(FLAG_LS) || "{}") || {}; } catch { _flags.map = {}; }
export function _flagsNotify() {
  try { localStorage.setItem(FLAG_LS, JSON.stringify(_flags.map)); } catch { /* storage off */ }
  _flags.subs.forEach((fn) => fn({ ..._flags.map }));
}
export function _flagsMerge(remote) {
  let changed = false;
  for (const [t, v] of Object.entries(remote || {})) {
    const cur = _flags.map[t];
    if (!cur || String(cur.at || "") < String(v.at || "")) { _flags.map[t] = v; changed = true; }
  }
  return changed;
}
export const _flagsPending = {};
export function _flagsPost(entries) {
  return authFetch("/api/userdata?scope=flags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flags: entries }),
  })
    .then((r) => {
      if (r.status === 401) Object.assign(_flagsPending, entries);
      return r;
    })
    .catch(() => {});
}
if (typeof window !== "undefined") {
  window.addEventListener("tp-auth-changed", (e) => {
    if (e?.detail?.unlocked && Object.keys(_flagsPending).length) {
      const batch = { ..._flagsPending };
      for (const k of Object.keys(_flagsPending)) delete _flagsPending[k];
      _flagsPost(batch);
    }
  });
}
export function _flagsPull() {
  if (_flags.loading) return _flags.loading;
  _flags.loading = authFetch("/api/userdata?scope=flags", { cache: "no-store" })
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
export function setFlag(ticker, color) {
  const v = { c: color || null, at: new Date().toISOString() };
  _flags.map[ticker] = v;
  _flagsNotify();
  _flagsPost({ [ticker]: v });
}
export function useFlags() {
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
export const flagHex = (c, A) => ({ red: A.red, blue: A.blue, gold: A.gold || "#e3b341" }[c]);

export function FlagButton({ t, A }) {
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

export function FlaggedTab({ A, stockMap, tickerLayer, onTicker, chartTicker, onLayer, keep }) {
  const flags = useFlags();
  const profiles = useJson("/data/rvol_profiles.json");
  const [only, setOnly] = useState(null);
  const tickers = Object.entries(flags).filter(([, v]) => v?.c).map(([t]) => t).filter((t) => !keep || keep(t)).sort();
  const { quotes, at } = useScanQuotes(tickers, true);
  // default: grouped by flag colour; header clicks sort like the Intraday scan
  const [sort, setSort] = useState({ k: "flag", d: 1 });
  const clock = etClock();
  const snap = useMemo(() => { if (clock.rth) return null; void quotes; return readZvrSnap(); }, [clock.rth, quotes]);
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
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <CopyTickersBtn tickers={rows.map((r) => r.t)} A={A} />
          {at && tickers.length ? <span style={{ fontSize: 10, color: A.textMuted }}>{`Live · ${at.toLocaleTimeString()}`}</span> : null}
        </span>
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
                  <td style={td(A)}><FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span><TierMark t={r.t} /></td>
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

// ── Watchlist / Portfolio tab ─────────────────────────────────────────────
// Synced across devices via /api/userdata (shared with ChartPanelInline +PF/+WL
// and the hourly Zanger email Portfolio & Watchlist Pulse).
export function WatchlistPortfolioTab({
  A,
  stockMap,
  tickerLayer,
  onTicker,
  chartTicker,
  onLayer,
  portfolio = [],
  setPortfolio,
  watchlist = [],
  setWatchlist,
}) {
  const profiles = useJson("/data/rvol_profiles.json");
  const [only, setOnly] = useState(null); // null = all | "pf" | "wl"
  const [input, setInput] = useState("");
  const [sort, setSort] = useState({ k: "group", d: 1 });

  const pfSet = useMemo(() => new Set(portfolio || []), [portfolio]);
  const wlSet = useMemo(() => new Set(watchlist || []), [watchlist]);
  const allTickers = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const t of portfolio || []) { if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
    for (const t of watchlist || []) { if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
    return out;
  }, [portfolio, watchlist]);

  const visibleTickers = useMemo(() => {
    if (only === "pf") return allTickers.filter((t) => pfSet.has(t));
    if (only === "wl") return allTickers.filter((t) => wlSet.has(t));
    return allTickers;
  }, [allTickers, only, pfSet, wlSet]);

  const { quotes, at } = useScanQuotes(allTickers, true);
  const clock = etClock();
  const snap = useMemo(() => { if (clock.rth) return null; void quotes; return readZvrSnap(); }, [clock.rth, quotes]);
  const snapOk = !clock.rth && snap?.date === clock.session && snap?.z;
  const frac = sessionElapsedFrac();
  const rm = rthMinute();

  const parseTickers = (raw) =>
    [...new Set(
      String(raw || "")
        .toUpperCase()
        .split(/[\s,;]+/)
        .map((s) => s.replace(/[^A-Z0-9.-]/g, ""))
        .filter((s) => s.length >= 1 && s.length <= 8)
    )];

  const addTo = (target) => {
    const list = parseTickers(input);
    if (!list.length) return;
    const setter = target === "pf" ? setPortfolio : setWatchlist;
    if (setter) {
      setter((prev) => {
        const cur = new Set(prev || []);
        const next = [...(prev || [])];
        for (const t of list) {
          if (!cur.has(t)) { cur.add(t); next.push(t); }
        }
        return next;
      });
    }
    setInput("");
  };

  const toggleIn = (t, target) => {
    const setter = target === "pf" ? setPortfolio : setWatchlist;
    if (!setter) return;
    setter((prev) => ((prev || []).includes(t) ? prev.filter((x) => x !== t) : [...(prev || []), t]));
  };

  const removeTicker = (t) => {
    if (only === "pf") {
      if (setPortfolio) setPortfolio((prev) => (prev || []).filter((x) => x !== t));
    } else if (only === "wl") {
      if (setWatchlist) setWatchlist((prev) => (prev || []).filter((x) => x !== t));
    } else {
      if (pfSet.has(t) && setPortfolio) setPortfolio((prev) => (prev || []).filter((x) => x !== t));
      if (wlSet.has(t) && setWatchlist) setWatchlist((prev) => (prev || []).filter((x) => x !== t));
    }
  };

  const rows = useMemo(() => {
    const out = visibleTickers.map((t) => {
      const q = quotes.get(t), s = stockMap?.[t] || {}, L = tickerLayer?.[t];
      const inPf = pfSet.has(t), inWl = wlSet.has(t);
      const c0 = s.close || s.price;
      const px = q?.rthPrice ?? q?.price ?? c0 ?? null;
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
        t,
        inPf,
        inWl,
        group: inPf ? 0 : 1,
        px,
        zvr,
        chg: q?.change ?? (q?.previousClose && px ? (px / q.previousClose - 1) * 100 : s.change_pct ?? null),
        fromOpen: q?.open && px ? (px / q.open - 1) * 100 : null,
        cr: closingRange(q, s),
        adr: s.adr20 ?? s.adr_pct ?? null,
        offHi: hi && px ? (px / hi - 1) * 100 : (s.off_52w_high ?? null),
        rs: s.rs_rank ?? null,
        eps: s.eps_rating ?? null,
        epsTip: s.eps_tip,
        epsAcc: s.eps_accel,
        erDays: s.earnings_days ?? null,
        rslTip: rsLeads(s),
        layer: L?.name,
        layerSt: L?.st,
      };
    });
    const { k, d } = sort;
    out.sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null && y == null) return a.t.localeCompare(b.t);
      if (x == null) return 1;
      if (y == null) return -1;
      return ((x - y) * d) || a.t.localeCompare(b.t);
    });
    return out;
  }, [visibleTickers, quotes, stockMap, tickerLayer, pfSet, wlSet, clock.session, snapOk, snap, profiles, rm, frac, sort]);

  const col = (k, label, align = "right", title) => (
    <th
      key={k}
      style={{ ...th(A, align), cursor: "pointer", userSelect: "none", color: sort.k === k ? A.text : A.textMuted }}
      title={title}
      onClick={() => setSort((p) => ({ k, d: p.k === k ? -p.d : k === "group" ? 1 : -1 }))}
    >
      {label}{sort.k === k ? (sort.d < 0 ? " ▼" : " ▲") : ""}
    </th>
  );
  const pct = (v, dgt = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dgt)}%`);
  const pfColor = A.green;
  const wlColor = A.cyan || "#38bdf8";

  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        {[
          [null, "All", allTickers.length, null],
          ["pf", "Portfolio", portfolio.length, pfColor],
          ["wl", "Watchlist", watchlist.length, wlColor],
        ].map(([k, label, n, dot]) => (
          <button
            key={k || "all"}
            onClick={() => setOnly(k)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: only === k ? A.bgHover : "transparent",
              border: `1px solid ${only === k ? (dot || A.borderLight) : A.border}`,
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 11,
              color: only === k && dot ? dot : A.text,
              fontWeight: only === k ? 700 : 500,
              cursor: "pointer",
            }}
          >
            {dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />}
            {label} <span style={{ color: A.textMuted }}>{n}</span>
          </button>
        ))}

        <form
          onSubmit={(e) => { e.preventDefault(); addTo(only === "pf" ? "pf" : "wl"); }}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 4 }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add tickers (NVDA, CLS)…"
            style={{
              background: A.bg,
              border: `1px solid ${A.border}`,
              borderRadius: 4,
              padding: "2px 7px",
              fontSize: 11,
              fontFamily: "monospace",
              color: A.text,
              width: 155,
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => addTo("pf")}
            title="Add to Portfolio"
            style={{
              background: "transparent",
              border: `1px solid ${pfColor}`,
              color: pfColor,
              borderRadius: 4,
              padding: "2px 7px",
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >
            +PF
          </button>
          <button
            type="button"
            onClick={() => addTo("wl")}
            title="Add to Watchlist"
            style={{
              background: "transparent",
              border: `1px solid ${wlColor}`,
              color: wlColor,
              borderRadius: 4,
              padding: "2px 7px",
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >
            +WL
          </button>
        </form>

        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <CopyTickersBtn tickers={rows.map((r) => r.t)} A={A} />
          <span style={{ fontSize: 10, color: A.textMuted }}>
            {at && allTickers.length ? `Live · ${at.toLocaleTimeString()} · synced to email alerts` : "Synced across devices & hourly email"}
          </span>
        </span>
      </div>

      {!rows.length ? (
        <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 2px" }}>
          {allTickers.length
            ? `No tickers in ${only === "pf" ? "Portfolio" : "Watchlist"} yet.`
            : "No holdings or watched stocks yet. Add tickers above or use +PF / +WL in the chart header."}
        </div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: A.bg, zIndex: 1 }}>
              <tr>
                {col("group", "List", "left", "Grouped by Portfolio then Watchlist")}
                <th style={th(A, "left")}>Ticker</th>
                {col("zvr", "ZVR", "right", "Relative volume at time vs 10-day intraday volume profile")}
                {col("chg", "Chg")}
                {col("fromOpen", "From open")}
                {col("cr", "CR%", "right", "Closing Range — where price sits in today's low-to-high range")}
                {col("adr", "ADR")}
                {col("offHi", "Off high")}
                {col("rs", "RS")}
                {col("eps", "EPS", "right", EPS_TIP)}
                <th style={th(A)}>Layer</th>
                <th style={th(A, "right")}>Edit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.t}
                  data-nav={r.t}
                  onClick={() => onTicker(r.t)}
                  style={{ cursor: "pointer", background: chartTicker === r.t ? A.bgHover : "transparent" }}
                >
                  <td style={td(A)}>
                    <span style={{ display: "inline-flex", gap: 3 }}>
                      {r.inPf && (
                        <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "1px 4px", borderRadius: 3, background: `${pfColor}22`, color: pfColor, border: `1px solid ${pfColor}66` }}>
                          PF
                        </span>
                      )}
                      {r.inWl && (
                        <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "1px 4px", borderRadius: 3, background: `${wlColor}22`, color: wlColor, border: `1px solid ${wlColor}66` }}>
                          WL
                        </span>
                      )}
                    </span>
                  </td>
                  <td style={td(A)}>
                    <FlagButton t={r.t} A={A} />
                    <span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span>
                    <TierMark t={r.t} />
                    <RslDot tip={r.rslTip} A={A} />
                    {r.erDays != null && r.erDays >= 0 && r.erDays <= 5 && (
                      <span
                        title={`Earnings in ${r.erDays === 0 ? "today" : `${r.erDays} days`}`}
                        style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "0px 4px", borderRadius: 3, background: "rgba(245,158,11,0.18)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.45)" }}
                      >
                        ER {r.erDays}d
                      </span>
                    )}
                  </td>
                  <td style={{ ...td(A, "right"), color: r.zvr >= 1.5 ? A.green : r.zvr >= 1 ? A.text : A.textMuted, fontWeight: r.zvr >= 1.5 ? 700 : 400 }}>
                    {r.zvr == null ? "—" : r.zvr.toFixed(2)}
                  </td>
                  <td style={{ ...td(A, "right"), color: (r.chg ?? 0) >= 0 ? A.green : A.red, fontWeight: 600 }}>
                    {pct(r.chg, 2)}
                  </td>
                  <td style={{ ...td(A, "right"), color: (r.fromOpen ?? 0) >= 0 ? A.green : A.red, fontWeight: 700 }}>
                    {pct(r.fromOpen, 2)}
                  </td>
                  <td style={{ ...td(A, "right"), color: r.cr == null ? A.textMuted : r.cr >= 75 ? A.green : r.cr >= 50 ? A.yellow : A.red, fontWeight: 600 }}>
                    {r.cr == null ? "—" : `${r.cr}%`}
                  </td>
                  <td style={td(A, "right")}>{r.adr == null ? "—" : `${r.adr.toFixed(1)}%`}</td>
                  <td style={td(A, "right")}>{pct(r.offHi)}</td>
                  <td style={{ ...td(A, "right"), color: r.rs >= 90 ? A.green : r.rs >= 70 ? A.yellow : r.rs != null ? A.red : A.textMuted }}>
                    {r.rs ?? "—"}
                  </td>
                  <td title={r.epsTip || ""} style={{ ...td(A, "right"), color: r.eps >= 80 ? A.green : r.eps >= 50 ? A.yellow : r.eps != null ? A.red : A.textMuted }}>
                    {r.eps ?? "—"}{r.epsAcc ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}
                  </td>
                  <td style={{ ...td(A), fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                    <LayerLink r={r} A={A} onLayer={onLayer} />
                  </td>
                  <td style={td(A, "right")} onClick={(e) => e.stopPropagation()}>
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <button
                        title={r.inPf ? "Remove from Portfolio" : "Add to Portfolio"}
                        onClick={() => toggleIn(r.t, "pf")}
                        style={{
                          background: r.inPf ? `${pfColor}22` : "transparent",
                          border: `1px solid ${r.inPf ? pfColor : A.border}`,
                          color: r.inPf ? pfColor : A.textMuted,
                          borderRadius: 3,
                          padding: "1px 4px",
                          fontSize: 9,
                          fontFamily: "monospace",
                          cursor: "pointer",
                        }}
                      >
                        PF
                      </button>
                      <button
                        title={r.inWl ? "Remove from Watchlist" : "Add to Watchlist"}
                        onClick={() => toggleIn(r.t, "wl")}
                        style={{
                          background: r.inWl ? `${wlColor}22` : "transparent",
                          border: `1px solid ${r.inWl ? wlColor : A.border}`,
                          color: r.inWl ? wlColor : A.textMuted,
                          borderRadius: 3,
                          padding: "1px 4px",
                          fontSize: 9,
                          fontFamily: "monospace",
                          cursor: "pointer",
                        }}
                      >
                        WL
                      </button>
                      <button
                        title={`Remove ${r.t}`}
                        onClick={() => removeTicker(r.t)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: A.textMuted,
                          padding: "0 2px",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        ✕
                      </button>
                    </span>
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


// Buyout-pinned / no-range names: a stock trading in a fixed deal band keeps
// RS 96–99 and sits ~0% off its high, so it floats to the top of Leaders
// without being a live breakout. Pinned = 20-day OR 5-day ADR under 0.8%, or
// the 5-day ADR has collapsed below half its long-run ADR (< 1.5%) while
// sitting within 2% of the high — the 20-day window still holds the
// announcement-day jump for a week or two, so it misses fresh deals (SGRY).
export const TierCtx = createContext(null);
export function TierMark({ t, label }) {
  const tiers = useContext(TierCtx);
  if (!tiers || !t) return null;
  const L = tiers.leaders.has(t), E = !L && tiers.emerging.has(t);
  if (!L && !E) return null;
  return <span title={L ? "⭐ Leader — passes the Leaders screen (RS 90+, above 50d, within 25% of high)"
    : "🌱 Emerging — RS 75+ in a leading/emerging layer, near its high or RS line at a new high; not a leader yet"}
    style={{ marginLeft: label ? 0 : 4, fontSize: 9, color: L ? "#f59e0b" : "#4ade80", fontWeight: 700 }}>{L ? "⭐" : "🌱"}{label ? (L ? " Leader" : " Emerging") : ""}</span>;
}
export const RslDot = ({ tip, A }) => (tip ? <span title={tip} style={{ color: A.blue || "#3b82f6", marginLeft: 4 }}>●</span> : null);

// ── Layer members ─────────────────────────────────────────────────────────
// Every stock in one layer, shown in the Stocks box when a layer row is
// clicked. Same columns as the Scanner plus vs-50d; ★ = fastest EPS grower.
export function LayerMembers({ A, layer, tickers, stockMap, onTicker, chartTicker, keep, maxHeight = 560, onClose }) {
  const [sort, setSort] = useState({ k: "rs", d: -1 });
  const list = useMemo(() => tickers.filter((t) => stockMap[t] && (!keep || keep(t))), [tickers, stockMap, keep]);
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 10, color: A.textMuted, marginBottom: 6 }}>
        <div>
          <span style={{ color: statusColor(layer.st, A), fontWeight: 700 }}>{STATUS[layer.st].label}</span> · rank {layer.now}{b?.rsMed != null && <> · typical member RS {b.rsMed}</>}
          {" "}(<Delta v={layer.now - layer.w1} A={A} /> 1w, <Delta v={layer.now - layer.m1} A={A} /> 1m) · {layer.theme}
          {at && <> · live {at.toLocaleTimeString()}</>}
          {" "}· ★ fastest EPS grower · ↑/↓ to step through
        </div>
        {onClose && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Collapse layer"
            style={{ background: "transparent", border: `1px solid ${A.border}`, color: A.textMuted, borderRadius: 4, padding: "1px 6px", fontSize: 10, cursor: "pointer", flexShrink: 0 }}
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ overflowX: "auto", maxHeight, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: A.bg, zIndex: 1 }}>
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
                <td style={td(A)}><FlagButton t={r.t} A={A} /><span style={{ color: A.text, fontWeight: 700, fontFamily: "monospace" }}>{r.t}</span><TierMark t={r.t} />
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

export function useLiveRS(stockMap) {
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
      const list = key.split(",");
      const qMap = await quoteStore.fetchQuotes(list, { maxAgeMs: 55 * 60000 });
      const m = new Map();
      qMap.forEach((q, t) => {
        const px = q?.rthPrice ?? q?.price;
        if (px > 0) m.set(t, { price: px, volume: q?.volume > 0 ? q.volume : null });
      });
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
      const s = stockMap[t], p = quotes.get(t)?.price;
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
      const q = quotes.get(t);
      const px = q?.price ?? null;
      const vol = q?.volume ?? null;
      out[t] = { ...stockMap[t], rs_rank_close: stockMap[t].rs_rank, rs_rank: rs, rs_live: true,
        rs_score_close: v0, rs_score_live: v, px_live: px, vol_live: vol, chg_live: px ? (px / stockMap[t].close - 1) * 100 : null };
    }
    // out-of-pool (stale history) names rank 0, matching the pipeline
    for (const t of Object.keys(stockMap)) if (!pool.has(t) && stockMap[t]?.ticker) out[t] = { ...stockMap[t], rs_rank_close: stockMap[t].rs_rank, rs_rank: 0 };
    return { map: out, at };
  }, [quotes, at, stockMap, meta]);
}

