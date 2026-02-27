import { useState, useMemo } from "react";

/*  ═══════════════════════════════════════════════════════════
    US MARKET QUADRANT
    Sits inside ThemePulse tp-data-panel (which provides bg, padding, scroll)
    All colors pulled from App.jsx palette.
    ═══════════════════════════════════════════════════════════ */

/* ── palette (exact App.jsx values) ─────────────────────── */
const X = {
  bg:    "#121218",   // surface
  card:  "#1a1a24",   // card bg
  row:   "#16161e",   // alternating row
  bd:    "#2a2a38",   // border
  bdH:   "#3a3a4a",   // border hover
  w:     "#d4d4e0",   // primary text
  t:     "#9090a0",   // secondary text
  d:     "#787888",   // dim but readable
  m:     "#686878",   // muted labels
  f:     "#505060",   // faintest
  g:     "#2bb886",   // green
  gL:    "#4aad8c",   // green light
  r:     "#f87171",   // red
  y:     "#f59e0b",   // amber
  o:     "#f97316",   // orange
  a:     "#818cf8",   // accent / purple
};

/* ── status helpers ─────────────────────────────────────── */
const STATUS_CLR = { LEADING: X.g, EMERGING: X.y, HOLDING: X.d, WEAKENING: X.o, LAGGING: X.r };
const STATUS_LBL = { LEADING: "Leading", EMERGING: "Emerging", HOLDING: "Holding", WEAKENING: "Weak'ng", LAGGING: "Lagging" };
function sc(v) { return v >= 65 ? X.g : v >= 50 ? X.gL : v >= 40 ? X.y : v >= 25 ? X.o : X.r; }
function rc(v) { return v > 0 ? X.g : v < 0 ? X.r : X.t; }
function pf(v) { return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1); }

/* ══════════════════════════════════════════════════════════
   MOCK DATA (replace with fetch('/dashboard_data.json') + '/market_monitor.json')
   ═══════════════════════════════════════════════════════════ */
const QD = {
  date: "2026-02-27", wk: 9, n: 2847,
  mom: { ok: true, rows: [
    { n: "S&P 500", e: "SPY", v: 28 }, { n: "NASDAQ 100", e: "QQQ", v: 35 },
    { n: "Dow Jones", e: "DIA", v: 18 }, { n: "Russell 2000", e: "IWM", v: -4 },
    { n: "S&P MidCap", e: "MDY", v: 12 },
  ]},
  swg: { ok: false,
    tbl: [["27-Feb",32,28],["26-Feb",36,34],["25-Feb",38,35]],
    mbi: [-62,-175,-220,-410,-85,150,-290],
    mbiL: ["27","26","25","24","21","20","19"],
  },
  trd: { ok: false,
    nnh: [[8,-22,-14],[5,-18,-13],[6,-25,-19]],
    nnhL: ["27-Feb","26-Feb","25-Feb"],
    sma: [[34,42],[37,44],[36,43]],
    smaL: ["27-Feb","26-Feb","25-Feb"],
  },
  bias: { ok: false, hist: [42,44,43,45,47], histL: ["27","26","25","24","21"] },
  mm: { u4:42, d4:187, r5:0.31, t2108:34.2, u25q:312, d25q:195, u25m:88, d25m:142 },
};

const TD = [
  { t:"AI Infrastructure", s:"LEADING", c:78, rs:82, r1m:4.2, b50:68,
    p:[75,85,72,78],
    sub:[
      { n:"AI Compute", c:88, rs:91, r:6.1, b:82, k:36 },
      { n:"Hyperscalers", c:82, rs:88, r:5.2, b:85, k:7 },
      { n:"Net Fabric", c:74, rs:78, r:3.8, b:65, k:38 },
      { n:"Cooling", c:71, rs:75, r:3.5, b:60, k:5 },
      { n:"Security & Obs", c:68, rs:72, r:2.8, b:57, k:7 },
      { n:"Power Infra", c:65, rs:70, r:2.1, b:55, k:44 },
      { n:"SemiCap", c:60, rs:65, r:1.4, b:50, k:12 },
    ]},
  { t:"Defense", s:"LEADING", c:75, rs:80, r1m:5.8, b50:72,
    p:[72,80,70,75],
    sub:[
      { n:"Aerospace", c:80, rs:85, r:6.5, b:78, k:42 },
      { n:"Cyber Def", c:74, rs:79, r:5.8, b:75, k:4 },
      { n:"Drones", c:72, rs:78, r:5.2, b:65, k:8 },
      { n:"Space", c:68, rs:74, r:4.1, b:66, k:3 },
    ]},
  { t:"Semiconductors", s:"EMERGING", c:62, rs:68, r1m:2.9, b50:50,
    p:[58,70,55,62],
    sub:[
      { n:"Broad Semis", c:62, rs:68, r:2.9, b:50, k:51 },
      { n:"Supply Chain", c:55, rs:58, r:1.2, b:40, k:2 },
    ]},
  { t:"Fintech", s:"EMERGING", c:60, rs:66, r1m:3.1, b50:55,
    p:[55,68,52,62],
    sub:[
      { n:"Blockchain", c:72, rs:78, r:8.2, b:60, k:9 },
      { n:"Neobanks", c:65, rs:70, r:4.5, b:50, k:6 },
      { n:"Payments", c:58, rs:62, r:1.8, b:55, k:10 },
      { n:"Exchanges", c:52, rs:55, r:0.8, b:50, k:8 },
    ]},
  { t:"Cyber", s:"EMERGING", c:59, rs:64, r1m:2.4, b50:52,
    p:[54,65,50,60],
    sub:[
      { n:"Endpoint", c:65, rs:70, r:3.2, b:60, k:5 },
      { n:"Zero Trust", c:58, rs:62, r:2.1, b:50, k:2 },
      { n:"Identity", c:52, rs:56, r:1.0, b:50, k:2 },
    ]},
  { t:"Commodities", s:"HOLDING", c:51, rs:55, r1m:1.8, b50:48,
    p:[48,55,45,52],
    sub:[
      { n:"Metals", c:62, rs:68, r:4.5, b:58, k:67 },
      { n:"Silver", c:58, rs:64, r:3.8, b:55, k:9 },
      { n:"Industrial", c:48, rs:50, r:0.5, b:42, k:48 },
      { n:"Gas & LNG", c:42, rs:44, r:-1.2, b:38, k:5 },
    ]},
  { t:"Energy", s:"HOLDING", c:48, rs:50, r1m:-1.2, b50:44,
    p:[44,50,42,52],
    sub:[
      { n:"Smart Grid", c:55, rs:58, r:1.2, b:50, k:9 },
      { n:"Oil & Gas", c:52, rs:55, r:0.5, b:48, k:26 },
      { n:"Uranium", c:45, rs:48, r:-2.1, b:40, k:6 },
      { n:"Solar", c:32, rs:30, r:-5.8, b:25, k:7 },
    ]},
  { t:"Software", s:"HOLDING", c:45, rs:48, r1m:-0.8, b50:41,
    p:[40,48,42,48],
    sub:[
      { n:"AI Enterprise", c:55, rs:60, r:1.5, b:52, k:47 },
      { n:"AI Data", c:52, rs:56, r:0.8, b:48, k:8 },
      { n:"Gaming", c:48, rs:50, r:-0.2, b:44, k:11 },
      { n:"Ads", c:40, rs:42, r:-2.5, b:35, k:48 },
      { n:"Enterprise", c:38, rs:38, r:-3.2, b:32, k:115 },
    ]},
  { t:"Healthcare", s:"WEAKENING", c:35, rs:38, r1m:-3.5, b50:32,
    p:[30,35,32,40],
    sub:[
      { n:"Devices", c:45, rs:48, r:-0.5, b:50, k:3 },
      { n:"Metabolic", c:42, rs:45, r:-1.8, b:40, k:7 },
      { n:"Therapeutics", c:38, rs:40, r:-2.5, b:35, k:8 },
      { n:"Genomics", c:22, rs:20, r:-8.2, b:15, k:8 },
    ]},
  { t:"EV", s:"LAGGING", c:22, rs:20, r1m:-7.1, b50:18,
    p:[18,22,15,28],
    sub:[
      { n:"Batteries", c:28, rs:30, r:-4.5, b:25, k:7 },
      { n:"Makers", c:18, rs:15, r:-9.5, b:12, k:9 },
      { n:"Charging", c:15, rs:12, r:-11.2, b:10, k:6 },
    ]},
];


/* ── SVG mini charts ────────────────────────────────────── */
function Bars({ data, mid = 50 }) {
  const h = 28, w = "100%";
  const mx = Math.max(...data.map(Math.abs), mid) * 1.2;
  const n = data.length;
  return (
    <svg viewBox={`0 0 ${n * 8} ${h}`} style={{ width: w, height: h, display: "block" }} preserveAspectRatio="none">
      <line x1="0" y1={h - (mid / mx) * h} x2={n * 8} y2={h - (mid / mx) * h} stroke={X.f} strokeWidth="0.5" strokeDasharray="2,2" />
      {data.map((v, i) => {
        const bh = (Math.abs(v) / mx) * h;
        return <rect key={i} x={i * 8 + 1} y={h - bh} width="6" height={bh} rx="1" fill={v >= mid ? X.g : X.r} opacity="0.55" />;
      })}
    </svg>
  );
}
function Bipolar({ data }) {
  const h = 28;
  const mx = Math.max(...data.map(Math.abs)) * 1.2 || 1;
  const n = data.length;
  const mid = h / 2;
  return (
    <svg viewBox={`0 0 ${n * 10} ${h}`} style={{ width: "100%", height: h, display: "block" }} preserveAspectRatio="none">
      <line x1="0" y1={mid} x2={n * 10} y2={mid} stroke={X.f} strokeWidth="0.5" />
      {data.map((v, i) => {
        const bh = (Math.abs(v) / mx) * (mid - 1);
        return <rect key={i} x={i * 10 + 1} y={v >= 0 ? mid - bh : mid} width="8" height={bh} rx="1" fill={v >= 0 ? X.g : X.r} opacity="0.6" />;
      })}
    </svg>
  );
}

/* ── Pillar mini-bar (inline, 4 segments) ───────────────── */
function Pillars({ vals }) {
  // vals = [str, mom, brk, brd]
  const colors = [X.g, X.y, X.a, "#6ee7b7"];
  return (
    <div style={{ display: "flex", gap: 1, alignItems: "flex-end", height: 14 }}>
      {vals.map((v, i) => (
        <div key={i} style={{ width: 6, background: X.bd, borderRadius: 1, height: 14, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", bottom: 0, width: "100%", height: `${v}%`, background: colors[i], borderRadius: 1 }} />
        </div>
      ))}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════
   THEME ROW — click to expand subthemes + pillar detail
   ═══════════════════════════════════════════════════════════ */
function ThemeRow({ th, even }) {
  const [open, setOpen] = useState(false);
  const clr = STATUS_CLR[th.s];
  return (
    <>
      {/* ── parent row ── */}
      <tr onClick={() => setOpen(o => !o)} style={{ cursor: "pointer", background: open ? `${clr}0a` : even ? X.row : "transparent" }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = "#ffffff06"; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = even ? X.row : "transparent"; }}>
        <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: clr, flexShrink: 0 }} />
            <span style={{ color: X.w, fontWeight: 600, fontSize: 12.5 }}>{th.t}</span>
          </span>
        </td>
        <td style={{ textAlign: "center", padding: "7px 6px" }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: clr, background: `${clr}18`, padding: "1px 6px", borderRadius: 3 }}>{STATUS_LBL[th.s]}</span>
        </td>
        <td style={{ textAlign: "right", padding: "7px 8px" }}>
          <span style={{ color: sc(th.c), fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>{th.c}</span>
        </td>
        <td style={{ textAlign: "right", padding: "7px 8px" }}>
          <span style={{ color: X.t, fontFamily: "monospace", fontSize: 11.5 }}>{th.rs}</span>
        </td>
        <td style={{ textAlign: "right", padding: "7px 8px" }}>
          <span style={{ color: rc(th.r1m), fontFamily: "monospace", fontSize: 11.5 }}>{pf(th.r1m)}%</span>
        </td>
        <td style={{ textAlign: "right", padding: "7px 8px" }}>
          <span style={{ color: th.b50 >= 50 ? X.g : th.b50 >= 35 ? X.y : X.r, fontFamily: "monospace", fontSize: 11.5 }}>{th.b50}%</span>
        </td>
        <td style={{ padding: "7px 8px" }}><Pillars vals={th.p} /></td>
        <td style={{ textAlign: "center", padding: "7px 4px", color: X.m, fontSize: 9 }}>
          <span style={{ display: "inline-block", transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
        </td>
      </tr>

      {/* ── expanded detail ── */}
      {open && (
        <tr><td colSpan={8} style={{ padding: 0, background: "#0d0d14" }}>
          <div style={{ padding: "8px 10px 10px" }}>
            {/* pillar bars */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 20px", marginBottom: 10, maxWidth: 420 }}>
              {[["Structure",th.p[0],X.g],["Momentum",th.p[1],X.y],["Breakouts",th.p[2],X.a],["Breadth",th.p[3],"#6ee7b7"]].map(([l,v,c]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: X.d, fontSize: 10, width: 58, textAlign: "right" }}>{l}</span>
                  <div style={{ flex: 1, height: 5, background: X.bd, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${v}%`, height: "100%", background: c, borderRadius: 3 }} />
                  </div>
                  <span style={{ color: c, fontFamily: "monospace", fontSize: 11, fontWeight: 600, width: 22, textAlign: "right" }}>{v}</span>
                </div>
              ))}
            </div>
            {/* subtheme table */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
              <thead><tr style={{ fontSize: 9, color: X.m, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <th style={{ textAlign: "left", padding: "3px 8px", fontWeight: 600 }}>Subtheme</th>
                <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>Score</th>
                <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>RS</th>
                <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>1M</th>
                <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>B50</th>
                <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 600 }}>#</th>
              </tr></thead>
              <tbody>{th.sub.map((s, si) => (
                <tr key={s.n} style={{ borderTop: `1px solid ${X.bd}60` }}
                  onMouseEnter={e => e.currentTarget.style.background = "#ffffff05"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "4px 8px", color: X.w, fontSize: 11 }}>{s.n}</td>
                  <td style={{ textAlign: "right", padding: "4px 6px", color: sc(s.c), fontWeight: 600 }}>{s.c}</td>
                  <td style={{ textAlign: "right", padding: "4px 6px", color: X.t }}>{s.rs}</td>
                  <td style={{ textAlign: "right", padding: "4px 6px", color: rc(s.r) }}>{pf(s.r)}%</td>
                  <td style={{ textAlign: "right", padding: "4px 6px", color: s.b >= 50 ? X.g : s.b >= 35 ? X.y : X.r }}>{s.b}%</td>
                  <td style={{ textAlign: "right", padding: "4px 6px", color: X.d }}>{s.k}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </td></tr>
      )}
    </>
  );
}


/* ══════════════════════════════════════════════════════════
   QUADRANT CARD
   ═══════════════════════════════════════════════════════════ */
function QCard({ title, ok, label, children, note }) {
  const clr = ok ? X.g : X.r;
  return (
    <div style={{ background: X.bg, border: `1px solid ${X.bd}`, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px",
        borderBottom: `1px solid ${X.bd}`, background: ok ? "#0d916308" : "#f8717108" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: clr }} />
          <span style={{ color: X.w, fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em" }}>{title}</span>
        </span>
        <span style={{ color: clr, fontSize: 10, fontWeight: 700, fontFamily: "monospace",
          padding: "1px 7px", borderRadius: 3, background: `${clr}15` }}>{label}</span>
      </div>
      <div style={{ padding: "8px 10px" }}>{children}</div>
      {note && <div style={{ padding: "6px 10px", borderTop: `1px solid ${X.bd}`, fontSize: 11, color: X.t, lineHeight: 1.5 }}>{note}</div>}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════ */
export default function USMarketQuadrant() {
  const d = QD;
  const m = d.mm;

  // random mock bars (stable via useMemo)
  const swB = useMemo(() => Array.from({length:25},()=>Math.random()*70+15),[]);
  const trB = useMemo(() => Array.from({length:25},()=>Math.random()*50+20),[]);
  const biB = useMemo(() => Array.from({length:25},()=>Math.random()*48+20),[]);

  const comp = [d.mom.ok, d.swg.ok, d.trd.ok, d.bias.ok].filter(Boolean).length;
  const cClr = comp <= 1 ? X.r : comp <= 2 ? X.y : X.g;
  const verdict = comp <= 1 ? "DEFENSIVE" : comp <= 2 ? "CAUTIOUS" : "RISK ON";

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: X.t }}>

      {/* ── HEADER ─────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: X.w }}>Market Quadrant
            <span style={{ color: X.d, fontWeight: 500, fontSize: 12, marginLeft: 6 }}>W{String(d.wk).padStart(2,"0")}/2026</span>
          </div>
          <div style={{ fontSize: 10, color: X.d, fontFamily: "monospace", marginTop: 1 }}>{d.n.toLocaleString()} stocks · {d.date}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* quad pills */}
          <div style={{ display: "flex", gap: 3 }}>
            {[["MOM",d.mom.ok],["SWG",d.swg.ok],["TRD",d.trd.ok],["BIAS",d.bias.ok]].map(([l,ok])=>(
              <span key={l} style={{ padding:"3px 7px", borderRadius:4, fontSize:10, fontWeight:600, fontFamily:"monospace",
                color: ok ? X.g : X.r, background: ok ? "#0d916315" : "#f8717112", border:`1px solid ${ok?X.g:X.r}20` }}>{l}</span>
            ))}
          </div>
          <span style={{ padding:"4px 12px", borderRadius:5, fontWeight:700, fontSize:12, fontFamily:"monospace",
            color:cClr, background:`${cClr}12`, border:`1px solid ${cClr}22` }}>{comp}/4 {verdict}</span>
        </div>
      </div>

      {/* ── STOCKBEE MONITOR ───────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 5, marginBottom: 14 }}>
        {[
          ["4% Up", m.u4, X.g], ["4% Dn", m.d4, X.r],
          ["5d Ratio", m.r5, m.r5>=1?X.g:X.r], ["T2108", `${m.t2108}%`, m.t2108>=50?X.g:m.t2108>=30?X.y:X.r],
          ["25%Q↑", m.u25q, X.g], ["25%Q↓", m.d25q, X.r],
          ["25%M↑", m.u25m, X.g], ["25%M↓", m.d25m, X.r],
        ].map(([l,v,c]) => (
          <div key={l} style={{ background:X.bg, border:`1px solid ${X.bd}`, borderRadius:5, padding:"5px 6px", textAlign:"center" }}>
            <div style={{ fontSize:9, color:X.d, marginBottom:2 }}>{l}</div>
            <div style={{ fontSize:13, fontWeight:700, fontFamily:"monospace", color:c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* ── QUADRANT GRID ──────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 8, marginBottom: 14 }}>

        {/* MOMENTUM */}
        <QCard title="Momentum" ok={d.mom.ok} label="POSITIVE"
          note={<><span style={{color:X.g,fontWeight:600}}>4/5 positive.</span> IWM diverging. Large-cap momentum intact.</>}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11.5, fontFamily:"monospace" }}>
            <thead><tr>{["Index","","MSwing",""].map((h,i)=>
              <th key={i} style={{ textAlign:i>=2?"right":"left", padding:"2px 6px", color:X.m, fontSize:9, fontWeight:600, borderBottom:`1px solid ${X.bd}` }}>{h}</th>
            )}</tr></thead>
            <tbody>{d.mom.rows.map(r=>(
              <tr key={r.e}>
                <td style={{padding:"3px 6px",color:X.w,fontSize:11.5}}>{r.n}</td>
                <td style={{padding:"3px 4px",color:X.d,fontSize:10}}>{r.e}</td>
                <td style={{textAlign:"right",padding:"3px 6px",color:r.v>=0?X.g:X.r,fontWeight:600}}>{r.v>0?"+":""}{r.v}</td>
                <td style={{textAlign:"right",padding:"3px 4px",color:r.v>=0?X.g:X.r,fontSize:10}}>{r.v>=0?"▲":"▼"}</td>
              </tr>
            ))}</tbody>
          </table>
        </QCard>

        {/* SWING */}
        <QCard title="Swing" ok={d.swg.ok} label="DOWN"
          note={<><span style={{color:X.r,fontWeight:600}}>32% above 10MA.</span> MBI red 5 sessions straight.</>}>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <Bars data={swB} />
              <div style={{fontSize:9,color:X.m,marginTop:2}}>% above 10-SMA (25 days)</div>
              <div style={{marginTop:6}}>
                <Bipolar data={d.swg.mbi} />
                <div style={{fontSize:9,color:X.m,marginTop:2}}>MBI net breadth</div>
              </div>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10.5,fontFamily:"monospace"}}>
                <thead><tr>{["","10","20"].map((h,i)=>
                  <th key={i} style={{textAlign:i?"right":"left",padding:"2px 4px",color:X.m,fontSize:8,fontWeight:600,borderBottom:`1px solid ${X.bd}`}}>{h}</th>
                )}</tr></thead>
                <tbody>{d.swg.tbl.map(([dt,a10,a20])=>(
                  <tr key={dt}>
                    <td style={{padding:"2px 4px",color:X.d,fontSize:10}}>{dt}</td>
                    <td style={{textAlign:"right",padding:"2px 4px",color:a10<50?X.r:X.g}}>{a10}%</td>
                    <td style={{textAlign:"right",padding:"2px 4px",color:a20<50?X.r:X.g}}>{a20}%</td>
                  </tr>
                ))}</tbody>
              </table>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10.5,fontFamily:"monospace",marginTop:6}}>
                <thead><tr>{["","MBI"].map((h,i)=>
                  <th key={i} style={{textAlign:i?"right":"left",padding:"2px 4px",color:X.m,fontSize:8,fontWeight:600,borderBottom:`1px solid ${X.bd}`}}>{h}</th>
                )}</tr></thead>
                <tbody>{d.swg.mbi.slice(0,5).map((v,i)=>(
                  <tr key={i}>
                    <td style={{padding:"2px 4px",color:X.d,fontSize:10}}>{d.swg.mbiL[i]}</td>
                    <td style={{textAlign:"right",padding:"2px 4px",color:v<0?X.r:X.g,fontWeight:500}}>{v>0?"+":""}{v}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </QCard>

        {/* TREND */}
        <QCard title="Trend" ok={d.trd.ok} label="DOWN"
          note={<><span style={{color:X.r,fontWeight:600}}>NNH negative 3 sessions.</span> 34% above 50MA.</>}>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <Bars data={trB} />
              <div style={{fontSize:9,color:X.m,marginTop:2}}>% above 50-SMA</div>
              <div style={{marginTop:6}}>
                <Bipolar data={d.trd.nnh.map(r=>r[2])} />
                <div style={{fontSize:9,color:X.m,marginTop:2}}>Net New Highs</div>
              </div>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10.5,fontFamily:"monospace"}}>
                <thead><tr>{["","Hi","Lo","NNH"].map((h,i)=>
                  <th key={i} style={{textAlign:i?"right":"left",padding:"2px 4px",color:X.m,fontSize:8,fontWeight:600,borderBottom:`1px solid ${X.bd}`}}>{h}</th>
                )}</tr></thead>
                <tbody>{d.trd.nnh.map((r,i)=>(
                  <tr key={i}>
                    <td style={{padding:"2px 4px",color:X.d,fontSize:10}}>{d.trd.nnhL[i]}</td>
                    <td style={{textAlign:"right",padding:"2px 4px",color:X.g}}>{r[0]}</td>
                    <td style={{textAlign:"right",padding:"2px 4px",color:X.r}}>{r[1]}</td>
                    <td style={{textAlign:"right",padding:"2px 4px",color:r[2]<0?X.r:X.g,fontWeight:600}}>{r[2]}</td>
                  </tr>
                ))}</tbody>
              </table>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10.5,fontFamily:"monospace",marginTop:6}}>
                <thead><tr>{["","50SMA","200SMA"].map((h,i)=>
                  <th key={i} style={{textAlign:i?"right":"left",padding:"2px 4px",color:X.m,fontSize:8,fontWeight:600,borderBottom:`1px solid ${X.bd}`}}>{h}</th>
                )}</tr></thead>
                <tbody>{d.trd.sma.map((r,i)=>(
                  <tr key={i}>
                    <td style={{padding:"2px 4px",color:X.d,fontSize:10}}>{d.trd.smaL[i]}</td>
                    <td style={{textAlign:"right",padding:"2px 4px",color:r[0]<50?X.r:X.g}}>{r[0]}%</td>
                    <td style={{textAlign:"right",padding:"2px 4px",color:r[1]<50?X.r:X.g}}>{r[1]}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </QCard>

        {/* BIAS */}
        <QCard title="Bias" ok={d.bias.ok} label="BEARISH"
          note={<><span style={{color:X.r,fontWeight:600}}>42% above 200MA.</span> Long-term bearish regime.</>}>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <Bars data={biB} />
              <div style={{fontSize:9,color:X.m,marginTop:2}}>% above 200-SMA</div>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10.5,fontFamily:"monospace"}}>
                <thead><tr>{["","% > 200"].map((h,i)=>
                  <th key={i} style={{textAlign:i?"right":"left",padding:"2px 4px",color:X.m,fontSize:8,fontWeight:600,borderBottom:`1px solid ${X.bd}`}}>{h}</th>
                )}</tr></thead>
                <tbody>{d.bias.hist.map((v,i)=>(
                  <tr key={i}>
                    <td style={{padding:"2px 4px",color:X.d,fontSize:10}}>{d.bias.histL[i]}-Feb</td>
                    <td style={{textAlign:"right",padding:"2px 4px",color:v<50?X.r:X.g,fontWeight:500}}>{v}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </QCard>
      </div>

      {/* ── THEME HEALTH TABLE ─────────────────────────── */}
      <div style={{ background:X.bg, border:`1px solid ${X.bd}`, borderRadius:6, overflow:"hidden", marginBottom:14 }}>
        <div style={{ padding:"8px 10px", borderBottom:`1px solid ${X.bd}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:13, fontWeight:700, color:X.w }}>Theme Health</span>
          <div style={{ display:"flex", gap:8, fontSize:9, color:X.d }}>
            {[["STR",X.g],["MOM",X.y],["BRK",X.a],["BRD","#6ee7b7"]].map(([l,c])=>(
              <span key={l} style={{display:"flex",alignItems:"center",gap:3}}>
                <span style={{width:8,height:4,background:c,borderRadius:1}} />{l}
              </span>
            ))}
            <span style={{color:X.m,marginLeft:4}}>Click row to expand</span>
          </div>
        </div>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ fontSize:9, color:X.m, textTransform:"uppercase", letterSpacing:"0.04em" }}>
            <th style={{ textAlign:"left", padding:"5px 10px", fontWeight:600 }}>Theme</th>
            <th style={{ textAlign:"center", padding:"5px 6px", fontWeight:600, width:65 }}>Status</th>
            <th style={{ textAlign:"right", padding:"5px 8px", fontWeight:600, width:46 }}>Score</th>
            <th style={{ textAlign:"right", padding:"5px 8px", fontWeight:600, width:36 }}>RS</th>
            <th style={{ textAlign:"right", padding:"5px 8px", fontWeight:600, width:52 }}>1M Ret</th>
            <th style={{ textAlign:"right", padding:"5px 8px", fontWeight:600, width:40 }}>B50</th>
            <th style={{ padding:"5px 8px", fontWeight:600, width:30 }}>Pillars</th>
            <th style={{ width:20 }} />
          </tr></thead>
          <tbody>
            {TD.map((th, i) => <ThemeRow key={th.t} th={th} even={i % 2 === 1} />)}
          </tbody>
        </table>
      </div>

      {/* ── GRADIENT BAR ───────────────────────────────── */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ height:4, borderRadius:2, background:`linear-gradient(90deg, ${X.r} 0%, ${X.y} 50%, ${X.g} 100%)`, position:"relative" }}>
          <div style={{ position:"absolute", left:`${(comp/4)*100}%`, top:-4, width:12, height:12, borderRadius:"50%",
            background:X.w, border:`2px solid ${cClr}`, transform:"translateX(-50%)", boxShadow:`0 0 8px ${cClr}50` }} />
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:X.m, marginTop:3, fontFamily:"monospace" }}>
          <span>BEARISH</span><span>NEUTRAL</span><span>BULLISH</span>
        </div>
      </div>
    </div>
  );
}
