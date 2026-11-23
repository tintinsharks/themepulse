import { useMemo, useState } from "react";
import { STATUS } from "./core.jsx";

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


export default RotationView;
