import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CopyTickersBtn,
  EPS_TIP,
  FlagButton,
  TierMark,
  closingRange,
  pinReason,
  scoreZangerCandidate,
  td,
  th,
  useRvolProfiles,
  useScanQuotes,
} from "./core.jsx";
import { authFetch } from "../utils.js";

const BRIEF_DIR = "/data/briefs/";
const INDEX_TKS = ["SPY", "QQQ", "IWM", "DIA"];

const BO_COLORS = {
  ZANGER: "#fbbf24",
  "SB4%": "#4ade80",
  "SB$": "#38bdf8",
  QMAG: "#c084fc",
};

const fmtPct = (v, dg = 1) =>
  typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(dg)}%` : "—";

const fmtVol = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
};

export default function ZangerBriefSection({ A, stockMap, tickerLayer, layers, tiers, onTicker, chartTicker }) {
  const [index, setIndex] = useState(null);
  const [sel, setSel] = useState(null);
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(null);
  const [liveOn, setLiveOn] = useState(true);
  const [mq, setMq] = useState(null);
  const [moverSort, setMoverSort] = useState({ k: "score", d: -1 });
  const [flowSort, setFlowSort] = useState({ k: "avgChg", d: -1 });
  const [portSort, setPortSort] = useState({ k: "list", d: 1 });
  const profiles = useRvolProfiles();

  useEffect(() => {
    let live = true;
    fetch(`${BRIEF_DIR}zanger-index.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((ix) => {
        if (!live) return;
        const list = Array.isArray(ix?.briefs) ? ix.briefs : [];
        setIndex(list);
        setSel(list[0]?.file || ix?.latest || "zanger-latest.json");
      })
      .catch(() => {
        if (!live) return;
        setIndex([]);
        setSel("zanger-latest.json");
      });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!sel || !/^zanger-[a-z0-9_-]+\.json$/i.test(sel)) return;
    let live = true;
    const isLatest = !index?.length || index[0]?.file === sel || sel === "zanger-latest.json";
    setLiveOn(isLatest);
    fetch(`${BRIEF_DIR}${sel}?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (live) { setSnap(d); setErr(null); } })
      .catch(() => { if (live) setErr("No Zanger briefing published yet."); });
    return () => { live = false; };
  }, [sel, index]);

  // Build liquid candidate pool matching Zanger.jsx so Breakouts & Movers update live every 60s
  const poolTickers = useMemo(() => {
    const out = [];
    for (const [t, s] of Object.entries(stockMap || {})) {
      if ((s.avg_dollar_vol_raw ?? 0) < 20e6 || !s.above_50ma || pinReason(s)) continue;
      const l = tickerLayer?.[t];
      if (tiers?.leaders?.has(t) || tiers?.emerging?.has(t) || (s.rs_rank ?? 0) >= 70 || l?.st === "lead" || l?.st === "emerg") {
        out.push(t);
      }
    }
    return out;
  }, [stockMap, tickerLayer, tiers]);

  const quoteTickers = useMemo(
    () => (liveOn ? [...new Set([...INDEX_TKS, ...poolTickers])] : []),
    [liveOn, poolTickers]
  );
  const { quotes, at } = useScanQuotes(quoteTickers, liveOn && quoteTickers.length > 0);

  // Poll /api/market-quality every 60s when liveOn is active
  useEffect(() => {
    if (!liveOn) return;
    let alive = true;
    const pull = () => {
      authFetch("/api/market-quality", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d?.ok) setMq(d); })
        .catch(() => {});
    };
    pull();
    const id = setInterval(() => { if (!document.hidden) pull(); }, 60000);
    return () => { alive = false; clearInterval(id); };
  }, [liveOn]);

  // Live recomputation of Breakouts & Movers, Theme Money Flow, Leader Damage, and On Deck RSL
  const liveComputed = useMemo(() => {
    if (!liveOn || !quotes || quotes.size === 0 || !poolTickers.length) return null;
    const now = new Date();
    const snapNewSet = new Set((snap?.zangerMovers || []).filter((m) => m.isNew).map((m) => m.ticker));
    const scored = [];
    for (const t of poolTickers) {
      const s = stockMap?.[t];
      if (!s) continue;
      const q = quotes.get(t) || null;
      const layer = tickerLayer?.[t] || null;
      const tier = tiers?.leaders?.has(t) ? "lead" : tiers?.emerging?.has(t) ? "emerg" : null;
      const res = scoreZangerCandidate({ s, q, layer, tier, profiles, now });
      if (res) {
        if (snapNewSet.has(t)) res.isNew = true;
        scored.push(res);
      }
    }

    const movers = scored
      .filter((r) => r.qualifiesZanger)
      .sort(
        (a, b) =>
          Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)) ||
          (b.breakoutTypes?.length || 0) - (a.breakoutTypes?.length || 0) ||
          b.score - a.score
      )
      .slice(0, 25);

    const boByTheme = new Map();
    for (const m of movers) {
      if (m.isBreakout && m.theme && m.theme !== "—") {
        boByTheme.set(m.theme, (boByTheme.get(m.theme) || 0) + 1);
      }
    }
    const buckets = new Map();
    for (const [tk, s] of Object.entries(stockMap || {})) {
      if ((s.avg_dollar_vol_raw ?? 0) < 20e6) continue;
      const theme = tickerLayer?.[tk]?.theme;
      if (!theme) continue;
      const q = quotes.get(tk);
      const chg = q?.change ?? s.change_pct;
      if (chg == null || !Number.isFinite(chg)) continue;
      let b = buckets.get(theme);
      if (!b) { b = { theme, sum: 0, count: 0, green: 0 }; buckets.set(theme, b); }
      b.sum += chg;
      b.count++;
      if (chg > 0) b.green++;
    }
    const flowRows = [...buckets.values()]
      .filter((b) => b.count >= 4)
      .map((b) => ({
        theme: b.theme,
        avgChg: Math.round((b.sum / b.count) * 100) / 100,
        pctGreen: Math.round((b.green / b.count) * 100),
        count: b.count,
        breakouts: boByTheme.get(b.theme) || 0,
      }))
      .sort((a, b) => b.avgChg - a.avgChg);

    const damagedLeaders = scored
      .filter((r) => {
        if (r.rs < 90 && r.tier !== "lead") return false;
        if (r.chg == null || r.chg > -3.0) return false;
        return (r.zvr != null && r.zvr >= 1.5) || (r.cr != null && r.cr <= 30) || r.chg <= -4.5;
      })
      .sort((a, b) => a.chg - b.chg || (b.zvr ?? 0) - (a.zvr ?? 0))
      .slice(0, 8);

    const onDeck = scored
      .filter((r) => r.rsl && !r.isBreakout && r.rs >= 85)
      .sort((a, b) => b.rs - a.rs || (b.off52 ?? -99) - (a.off52 ?? -99))
      .slice(0, 8);

    return {
      movers,
      themeFlow: {
        hottest: flowRows.slice(0, 5),
        coldest: flowRows.length > 5 ? flowRows.slice(-3).reverse() : [],
      },
      damagedLeaders,
      onDeck,
    };
  }, [liveOn, quotes, poolTickers, stockMap, tickerLayer, tiers, profiles, snap]);

  const pc = (v) => (typeof v !== "number" ? A.textMuted : v >= 0 ? A.green : A.red);
  const rsC = (v) => (v >= 90 ? A.green : v >= 70 ? A.yellow : typeof v === "number" ? A.red : A.textMuted);
  const epsC = (v) => (v >= 80 ? A.green : v >= 50 ? A.yellow : typeof v === "number" ? A.red : A.textMuted);

  const Tk = ({ t }) => (
    <span
      onClick={(e) => { e.stopPropagation(); onTicker && onTicker(t); }}
      style={{ cursor: "pointer", fontFamily: "monospace", fontWeight: 700, color: chartTicker === t ? A.green : A.text }}
    >
      {t}
    </span>
  );

  const picker = (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button
        onClick={() => setLiveOn((v) => !v)}
        title={liveOn ? "Recomputing breakouts, indices & flow live every 60s — click for frozen snapshot" : "Showing frozen hourly snapshot — click for live intraday updates"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: liveOn ? "rgba(34,197,94,0.14)" : "transparent",
          border: `1px solid ${liveOn ? A.green : A.border}`,
          color: liveOn ? A.green : A.textMuted,
          borderRadius: 4,
          padding: "2px 8px",
          fontSize: 10,
          fontWeight: 700,
          fontFamily: "monospace",
          cursor: "pointer",
        }}
      >
        <span className={liveOn && at ? "tp-livedot" : undefined} style={{ width: 6, height: 6, borderRadius: 3, background: liveOn ? A.green : A.textMuted, display: "inline-block" }} />
        {liveOn ? (at ? `LIVE · ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "LIVE") : "Snapshot"}
      </button>
      {index && index.length > 0 && (
        <select
          value={sel || ""}
          onChange={(e) => setSel(e.target.value)}
          style={{
            background: A.bg,
            color: A.text,
            border: `1px solid ${A.border}`,
            borderRadius: 4,
            fontSize: 11,
            padding: "2px 6px",
            maxWidth: 270,
            fontFamily: "monospace",
          }}
        >
          {index.map((b) => (
            <option key={b.id || b.file} value={b.file}>
              {b.label || b.et || b.id} ({b.breakoutCount ?? 0} BO)
            </option>
          ))}
        </select>
      )}
    </div>
  );

  if (err && !snap && !liveComputed) {
    return (
      <Card A={A} title="Zanger & Leadership Briefing" sub="Auto-updated hourly during market hours + live intraday overlay" right={picker}>
        <div style={{ fontSize: 11, color: A.textMuted }}>{err}</div>
      </Card>
    );
  }
  if (!snap && !liveComputed) {
    return (
      <Card A={A} title="Zanger & Leadership Briefing" right={picker}>
        <div style={{ fontSize: 11, color: A.textMuted }}>Loading latest Zanger briefing…</div>
      </Card>
    );
  }

  const baseMkt = snap?.market || {};
  const tapeMap = new Map((mq?.tape || []).filter((x) => x?.ticker).map((x) => [x.ticker, x]));
  const baseIndices = baseMkt.indices?.length
    ? baseMkt.indices
    : [["SPY", "S&P 500"], ["QQQ", "Nasdaq 100"], ["IWM", "Russell 2000"], ["DIA", "Dow 30"]].map(([ticker, name]) => ({ ticker, name }));
  const liveIndices = baseIndices.map((idx) => {
    if (!liveOn) return idx;
    const q = quotes.get(idx.ticker);
    const t = tapeMap.get(idx.ticker);
    const price = q?.rthPrice ?? q?.price ?? (t?.price != null ? Number(t.price) : idx.price);
    const change = q?.change ?? (t?.change != null ? Number(t.change) : idx.change);
    const cr = q ? closingRange(q, null) : idx.cr;
    return { ...idx, price, change, cr };
  });

  const liveVix = liveOn && tapeMap.get("VIX")?.price != null
    ? { price: Number(tapeMap.get("VIX").price), change: Number(tapeMap.get("VIX").change) }
    : baseMkt.vix;
  const liveTnx = liveOn && tapeMap.get("TNX")?.price != null
    ? { price: Number(tapeMap.get("TNX").price), change: Number(tapeMap.get("TNX").change) }
    : baseMkt.tnx;
  const liveSectors = liveOn && Array.isArray(mq?.sectors) && mq.sectors.length
    ? {
        positive: mq.sectors.filter((s) => (s.change ?? 0) > 0).length,
        total: mq.sectors.length,
        leaders: mq.sectors.slice(0, 3),
        laggards: mq.sectors.slice(-3).reverse(),
      }
    : baseMkt.sectors;
  const futures = liveOn && Array.isArray(mq?.futures) && mq.futures.length ? mq.futures : (baseMkt.futures || []);

  const dec = (liveOn && mq?.decision) || baseMkt.decision;
  const mktScore = (liveOn && mq?.total != null) ? mq.total : baseMkt.score;
  const posSize = (liveOn && mq?.position_size) || baseMkt.positionSize;
  const decColor = dec === "YES" ? A.green : dec === "CAUTION" ? "#f59e0b" : A.red;

  const movers = liveComputed ? liveComputed.movers : (snap?.zangerMovers || []);
  const bos = movers.filter((m) => m.isBreakout);
  const ph = snap?.phase || { id: "midday", label: "INTRADAY UPDATE", subtitle: "", accent: A.green };
  const portAlerts = snap?.portfolioAlerts || {};
  const portEarnings = snap?.portfolioEarnings || [];
  const epMovers = liveOn && Array.isArray(mq?.epCandidates) && mq.epCandidates.length
    ? mq.epCandidates.filter((e) => (e.chg ?? 0) >= 3).slice(0, 6).map((e) => ({
        ticker: e.ticker,
        chg: e.chg,
        volume: e.volume,
        category: e.category || "SIP",
        headline: (e.headlines || [])[0] || "",
      }))
    : (snap?.epMovers || []);
  const themeFlow = liveComputed ? liveComputed.themeFlow : (snap?.themeFlow || {});
  const damagedLeaders = liveComputed ? liveComputed.damagedLeaders : (snap?.leaderDamage?.damagedLeaders || []);
  const onDeck = liveComputed ? liveComputed.onDeck : (snap?.onDeckRsl || []);
  const faded = snap?.delta?.fadedBreakouts || [];
  const holdRate = snap?.delta?.holdRate || null;
  const headlines = snap?.headlines || {};
  const warnLayers = (layers || []).filter((l) => l.st === "lead" && (l.flags || []).some(([k]) => k === "distrib" || k === "exiting"));

  const boTickers = bos.map((m) => m.ticker);
  const allMoverTickers = movers.map((m) => m.ticker);
  const onDeckTickers = onDeck.map((r) => r.ticker);

  const cmpSort = (a, b, { k, d }, getVal, tie = (x) => x.ticker || x.theme || "") => {
    const va = getVal(a, k), vb = getVal(b, k);
    if (va == null && vb == null) return String(tie(a)).localeCompare(String(tie(b)));
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" || typeof vb === "string") {
      return String(va).localeCompare(String(vb)) * d || String(tie(a)).localeCompare(String(tie(b)));
    }
    return (va - vb) * d || String(tie(a)).localeCompare(String(tie(b)));
  };

  const makeSortTh = (sortState, setSortState) => (k, label, align = "right", title, textDefault = false) => (
    <th
      key={k}
      title={title}
      onClick={() => setSortState((p) => ({ k, d: p.k === k ? -p.d : (textDefault ? 1 : -1) }))}
      style={{
        ...th(A, align),
        cursor: "pointer",
        userSelect: "none",
        color: sortState.k === k ? A.text : A.textMuted,
      }}
    >
      {label}{sortState.k === k ? (sortState.d < 0 ? " ▼" : " ▲") : ""}
    </th>
  );

  const moverTh = makeSortTh(moverSort, setMoverSort);
  const flowTh = makeSortTh(flowSort, setFlowSort);
  const portTh = makeSortTh(portSort, setPortSort);

  const sortedMovers = [...movers].sort((a, b) => {
    if (moverSort.k === "score" && moverSort.d < 0) {
      const diffNew = Number(Boolean(b.isNew)) - Number(Boolean(a.isNew));
      if (diffNew) return diffNew;
      const diffBo = (b.breakoutTypes?.length || 0) - (a.breakoutTypes?.length || 0);
      if (diffBo) return diffBo;
    }
    return cmpSort(a, b, moverSort, (r, k) => {
      if (k === "sig") return (r.breakoutTypes?.length || 0) * 10 + (r.isNew ? 5 : 0) + (r.rsl ? 1 : 0);
      if (k === "theme") return `${r.theme || ""} ${r.layer || ""}`;
      return r[k];
    });
  });

  const sortedPortAlerts = [...(portAlerts.alerts || [])].sort((a, b) =>
    cmpSort(a, b, portSort, (r, k) => (k === "list" ? (r.list === "PORT" ? 0 : 1) : r[k]))
  );

  const sortedFlow = [...(themeFlow.hottest || []), ...(themeFlow.coldest || [])].sort((a, b) =>
    cmpSort(a, b, flowSort, (r, k) => r[k], (r) => r.theme)
  );

  const EpCard = epMovers.length > 0 ? (
    <Card A={A} title="EP / Gap-and-Go Movers" sub="High-momentum catalyst gaps ≥ +3%">
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {epMovers.map((e) => (
          <div key={e.ticker} style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", borderBottom: `1px solid ${A.border}`, paddingBottom: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "1px 5px", borderRadius: 3, background: e.category === "LAVA" ? "rgba(239,68,68,0.18)" : "rgba(245,158,11,0.18)", color: e.category === "LAVA" ? A.red : "#f59e0b" }}>
              {e.category}
            </span>
            <Tk t={e.ticker} />
            <span style={{ color: A.green, fontFamily: "monospace", fontWeight: 700 }}>{fmtPct(e.chg, 1)}</span>
            {e.volume ? <span style={{ color: A.textMuted, fontFamily: "monospace", fontSize: 10 }}>vol {fmtVol(e.volume)}</span> : null}
            {e.headline ? <span style={{ color: A.textDim }}>— {e.headline}</span> : null}
          </div>
        ))}
      </div>
    </Card>
  ) : null;

  return (
    <div style={{ marginTop: 14, borderTop: `2px solid ${A.border}`, paddingTop: 12 }}>
      {/* Header & General Market */}
      <Card
        A={A}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>Zanger &amp; Leadership Briefing</span>
            <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, border: `1px solid ${ph.accent || A.green}`, color: ph.accent || A.green }}>
              {liveComputed ? "LIVE INTRADAY" : ph.label}
            </span>
            {dec && (
              <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "2px 7px", borderRadius: 999, background: `${decColor}22`, border: `1px solid ${decColor}`, color: decColor }}>
                {dec}{mktScore != null ? ` · ${mktScore}/100` : ""}{posSize ? ` · ${posSize}` : ""}
              </span>
            )}
          </span>
        }
        sub={`${liveComputed && at ? `Live as of ${at.toLocaleTimeString()} (60s refresh)` : (snap?.stamp?.pretty || "")} · ${bos.length} breakouts · ${movers.length} movers${holdRate ? ` · Hold rate ${holdRate.holding}/${holdRate.totalToday} (${holdRate.pct}%)` : ""}`}
        right={picker}
      >
        {/* 4-Index Strip */}
        {liveIndices.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 10 }}>
            {liveIndices.map((idx) => (
              <div
                key={idx.ticker}
                onClick={() => onTicker && onTicker(idx.ticker)}
                style={{ cursor: "pointer", padding: "8px 10px", background: A.bg, border: `1px solid ${A.border}`, borderRadius: 6 }}
              >
                <div style={{ fontSize: 10, color: A.textMuted, fontFamily: "monospace" }}>
                  <strong style={{ color: A.text }}>{idx.ticker}</strong> {idx.name}
                </div>
                <div style={{ marginTop: 2, fontFamily: "monospace", display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: pc(idx.change) }}>{fmtPct(idx.change, 2)}</span>
                  <span style={{ fontSize: 11, color: A.textDim }}>{typeof idx.price === "number" ? idx.price.toFixed(2) : "—"}</span>
                </div>
                <div style={{ fontSize: 10, color: A.textMuted, marginTop: 2 }}>
                  {[idx.cr != null ? `CR ${idx.cr}%` : null, idx.maStatus].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Overnight Futures Strip */}
        {futures.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8, padding: "6px 8px", background: A.bg, border: `1px solid ${A.border}`, borderRadius: 6, fontSize: 10, fontFamily: "monospace" }}>
            <span style={{ color: A.textMuted, fontWeight: 700 }}>FUTURES:</span>
            {futures.map((f) => (
              <span key={f.name} style={{ color: A.textDim }}>
                <strong style={{ color: A.text }}>{f.name}</strong>{" "}
                <span style={{ color: pc(f.changePct), fontWeight: 700 }}>{fmtPct(f.changePct, 2)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Macro / Breadth / Sector Rotation Strip */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: A.textDim, fontFamily: "monospace", marginBottom: 6 }}>
          {liveVix && <span>VIX <strong style={{ color: A.text }}>{liveVix.price.toFixed(2)}</strong> ({fmtPct(liveVix.change, 1)})</span>}
          {liveTnx && <span>10Y <strong style={{ color: A.text }}>{liveTnx.price.toFixed(2)}%</strong></span>}
          {baseMkt.breadth?.pctAbove50 != null && <span>&gt;50MA <strong style={{ color: A.text }}>{baseMkt.breadth.pctAbove50}%</strong></span>}
          {baseMkt.breadth?.up4 != null && baseMkt.breadth?.down4 != null && (
            <span>4% Movers <strong style={{ color: A.green }}>{baseMkt.breadth.up4}↑</strong> / <strong style={{ color: A.red }}>{baseMkt.breadth.down4}↓</strong></span>
          )}
          {baseMkt.breadth?.t2108 != null && <span>T2108 <strong style={{ color: A.text }}>{baseMkt.breadth.t2108}%</strong></span>}
          {liveSectors && (
            <span>
              Sectors <strong style={{ color: A.text }}>{liveSectors.positive}/{liveSectors.total}</strong> green
              {" · "}Top: <span style={{ color: A.green }}>{liveSectors.leaders.map((s) => `${s.ticker} ${fmtPct(s.change, 1)}`).join(", ")}</span>
              {" · "}Lag: <span style={{ color: A.red }}>{liveSectors.laggards.map((s) => `${s.ticker} ${fmtPct(s.change, 1)}`).join(", ")}</span>
            </span>
          )}
        </div>

        {/* Market Commentary Bullets */}
        {Array.isArray(baseMkt.commentary) && baseMkt.commentary.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11, color: A.text, lineHeight: 1.5 }}>
            {baseMkt.commentary.map((c, i) => <li key={i} style={{ marginBottom: 3 }}>{c}</li>)}
          </ul>
        )}
      </Card>

      {/* Portfolio & Watchlist Pulse + Upcoming 10d Earnings */}
      {((portAlerts.alerts?.length > 0) || portEarnings.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
          {portAlerts.alerts?.length > 0 && (
            <Card A={A} title="Portfolio & Watchlist Pulse" sub={`${portAlerts.alerts.length} active across ${portAlerts.portfolioCount} holdings / ${portAlerts.watchlistCount} watchlist`}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {portTh("list", "List", "left", undefined, true)}
                    {portTh("ticker", "Ticker", "left", undefined, true)}
                    {portTh("chg", "Chg")}
                    {portTh("zvr", "ZVR")}
                    {portTh("cr", "CR%")}
                    <th style={th(A)}>Alert</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPortAlerts.map((a) => (
                    <tr key={a.ticker} onClick={() => onTicker && onTicker(a.ticker)} style={{ cursor: "pointer" }}>
                      <td style={{ ...td(A), fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: a.list === "PORT" ? A.green : A.cyan }}>{a.list}</td>
                      <td style={td(A)}><Tk t={a.ticker} /></td>
                      <td style={{ ...td(A, "right"), color: pc(a.chg), fontFamily: "monospace", fontWeight: 700 }}>{fmtPct(a.chg, 2)}</td>
                      <td style={{ ...td(A, "right"), fontFamily: "monospace" }}>{a.zvr != null ? `${a.zvr.toFixed(1)}x` : "—"}</td>
                      <td style={{ ...td(A, "right"), fontFamily: "monospace" }}>{a.cr != null ? `${a.cr}%` : "—"}</td>
                      <td style={{ ...td(A), fontSize: 10 }}>
                        {(a.tags || []).map((t, i) => (
                          <span key={i} style={{ marginRight: 4, padding: "1px 5px", borderRadius: 3, fontWeight: 700, color: t.tone === "bad" ? A.red : t.tone === "warn" ? "#f59e0b" : A.green, background: A.bg, border: `1px solid ${A.border}` }}>
                            {t.label}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {portEarnings.length > 0 && (
            <Card A={A} title="Upcoming Earnings (Portfolio & Watchlist · 10d)">
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {portEarnings.map((e) => (
                  <div key={e.ticker} style={{ fontSize: 11, display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${A.border}`, paddingBottom: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: e.list === "PORT" ? A.green : A.cyan }}>{e.list}</span>
                    <Tk t={e.ticker} />
                    <span style={{ color: A.textDim, fontFamily: "monospace", marginLeft: "auto" }}>
                      {e.display || "—"} {e.timing ? `(${e.timing})` : ""} · <strong style={{ color: e.days <= 2 ? "#f59e0b" : A.text }}>{e.days === 0 ? "Today" : `${e.days}d`}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {(ph.id === "premarket" || ph.id === "open") && EpCard}

      {/* Breakouts & Volume Movers Table */}
      <Card
        A={A}
        title="Breakouts & Intraday Volume Movers"
        sub={`${liveComputed ? "Live 60s scan · " : ""}Zanger · Stockbee 4% / $ · Qullamaggie · click any row to chart`}
        right={<CopyTickersBtn A={A} tickers={boTickers.length ? boTickers : allMoverTickers} label={boTickers.length ? "Copy BOs" : "Copy Movers"} />}
      >
        {movers.length === 0 ? (
          <div style={{ fontSize: 11, color: A.textMuted }}>No stocks currently pass breakout or ZVR ≥ 1.5x criteria.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {moverTh("sig", "Sig", "left")}
                  {moverTh("ticker", "Ticker", "left", undefined, true)}
                  {moverTh("theme", "Theme · Layer", "left", undefined, true)}
                  {moverTh("adr", "ADR")}
                  {moverTh("chg", "Chg%")}
                  {moverTh("zvr", "ZVR")}
                  {moverTh("cr", "CR%")}
                  {moverTh("rs", "RS")}
                  {moverTh("eps", "EPS", "right", EPS_TIP)}
                  {moverTh("off52", "Off 52wH")}
                  {moverTh("score", "Score")}
                </tr>
              </thead>
              <tbody>
                {sortedMovers.map((m) => (
                  <tr
                    key={m.ticker}
                    data-nav={m.ticker}
                    onClick={() => onTicker && onTicker(m.ticker)}
                    style={{ cursor: "pointer", background: chartTicker === m.ticker ? A.bgHover : m.isNew ? "rgba(56,189,248,0.06)" : "transparent" }}
                  >
                    <td style={td(A)}>
                      <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap" }}>
                        {m.isNew && (
                          <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "1px 4px", borderRadius: 3, background: "rgba(56,189,248,0.2)", color: A.cyan, border: `1px solid ${A.cyan}` }}>NEW</span>
                        )}
                        {m.breakoutTypes?.length ? m.breakoutTypes.map((k) => {
                          const c = BO_COLORS[k] || "#fbbf24";
                          return (
                            <span key={k} style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "1px 4px", borderRadius: 3, background: `${c}20`, color: c, border: `1px solid ${c}66` }}>{k}</span>
                          );
                        }) : (
                          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "1px 4px", borderRadius: 3, background: "rgba(34,197,94,0.16)", color: A.green }}>{m.rsl ? "RSL" : "VOL"}</span>
                        )}
                      </span>
                    </td>
                    <td style={td(A)}>
                      <FlagButton t={m.ticker} A={A} />
                      <Tk t={m.ticker} />
                      <TierMark t={m.ticker} />
                      {m.earningsDays != null && m.earningsDays >= 0 && m.earningsDays <= 5 && (
                        <span title={m.earningsDisplay || ""} style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "0 4px", borderRadius: 3, background: "rgba(245,158,11,0.18)", color: "#f59e0b" }}>
                          ER {m.earningsDays}d
                        </span>
                      )}
                    </td>
                    <td style={{ ...td(A), fontSize: 11, color: A.textDim }}>
                      <strong style={{ color: A.text }}>{m.theme}</strong> · {m.layer}
                    </td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: (m.adr ?? 0) >= 4 ? A.cyan : A.textDim }}>{m.adr != null ? `${m.adr.toFixed(1)}%` : "—"}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: pc(m.chg) }}>
                      {fmtPct(m.chg, 2)}
                      {m.dollarMove != null && m.dollarMove >= 0.9 && (
                        <span style={{ display: "block", fontSize: 9, fontWeight: 500, color: A.cyan }}>+${m.dollarMove.toFixed(2)}</span>
                      )}
                    </td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: (m.zvr ?? 0) >= 2.5 ? "#fbbf24" : (m.zvr ?? 0) >= 1.8 ? A.green : A.textDim }}>
                      {m.zvr != null ? `${m.zvr.toFixed(2)}x` : "—"}
                    </td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: m.cr == null ? A.textMuted : m.cr >= 75 ? A.green : m.cr >= 50 ? "#f59e0b" : A.red }}>
                      {m.cr != null ? `${m.cr}%` : "—"}
                    </td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: rsC(m.rs) }}>{m.rs}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: epsC(m.eps) }}>{m.eps ?? "—"}{m.epsAccel ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: (m.off52 ?? -99) >= -5 ? A.green : A.textDim }}>{fmtPct(m.off52, 1)}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 800, color: (m.score ?? 0) >= 70 ? "#fbbf24" : A.text }}>{m.score != null ? m.score.toFixed(1) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {faded.length > 0 && (
          <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(239,68,68,0.1)", border: `1px solid ${A.red}55`, borderRadius: 6, fontSize: 11, color: A.red }}>
            <strong>Faded / Squatted since last hour:</strong>{" "}
            {faded.map((f, i) => (
              <span key={f.ticker}>
                {i > 0 ? " · " : ""}
                <Tk t={f.ticker} /> ({fmtPct(f.chg, 1)}, {f.reason})
              </span>
            ))}
          </div>
        )}

        {/* Catalyst Check */}
        {movers.length > 0 && (
          <div style={{ marginTop: 10, borderTop: `1px solid ${A.border}`, paddingTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: A.text, marginBottom: 4 }}>Catalyst Check (Top Movers)</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: A.textDim, lineHeight: 1.45 }}>
              {movers.slice(0, 8).map((m) => {
                const liveH = headlines[m.ticker];
                const items = liveH?.length ? liveH.map((h) => `${h.title}${h.source ? ` (${h.source})` : ""}`) : (m.pipelineNews || []);
                return (
                  <li key={m.ticker} style={{ marginBottom: 3 }}>
                    <Tk t={m.ticker} /> <span style={{ color: A.textMuted }}>({m.theme}, {fmtPct(m.chg)}, ZVR {m.zvr != null ? `${m.zvr.toFixed(2)}x` : "—"}):</span>{" "}
                    {items.length ? items.join(" | ") : <em>No live headline returned</em>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      {ph.id !== "premarket" && ph.id !== "open" && EpCard}

      {/* Intraday Theme Money Flow + Leader Damage + On Deck */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
        {sortedFlow.length > 0 && (
          <Card A={A} title="Today's Theme Money Flow">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {flowTh("theme", "Theme", "left", undefined, true)}
                  {flowTh("avgChg", "Avg")}
                  {flowTh("pctGreen", "% Grn")}
                  {flowTh("breakouts", "BO")}
                </tr>
              </thead>
              <tbody>
                {sortedFlow.map((t) => {
                  const isCold = (themeFlow.coldest || []).some((c) => c.theme === t.theme);
                  return (
                    <tr key={t.theme}>
                      <td style={{ ...td(A), fontWeight: isCold ? 400 : 600, color: isCold ? A.textDim : A.text }}>{isCold ? `❄️ ${t.theme}` : t.theme}</td>
                      <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: pc(t.avgChg) }}>{fmtPct(t.avgChg, 2)}</td>
                      <td style={{ ...td(A, "right"), fontFamily: "monospace", color: isCold ? A.textMuted : A.textDim }}>{t.pctGreen}%</td>
                      <td style={{ ...td(A, "right"), fontFamily: "monospace", color: t.breakouts ? "#fbbf24" : A.textMuted }}>{t.breakouts || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        <Card A={A} title="Leader Damage Watch" sub="RS 90+ leaders hit hard on volume">
          {!damagedLeaders.length ? (
            <div style={{ fontSize: 11, color: A.green }}>✅ 0 RS 90+ leaders down ≥3% on heavy volume.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {damagedLeaders.map((d) => (
                <div key={d.ticker} onClick={() => onTicker && onTicker(d.ticker)} style={{ cursor: "pointer", fontSize: 11, display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${A.border}`, paddingBottom: 4 }}>
                  <Tk t={d.ticker} />
                  <span style={{ color: A.textMuted, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.theme}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "monospace", fontWeight: 700, color: A.red }}>{fmtPct(d.chg, 2)}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 10, color: A.textDim }}>{d.zvr != null ? `${d.zvr.toFixed(1)}x` : "—"}</span>
                </div>
              ))}
            </div>
          )}
          {warnLayers.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 10, color: "#f59e0b" }}>
              Distrib/Exiting: {warnLayers.slice(0, 4).map((l) => l.name).join(" · ")}
            </div>
          )}
        </Card>

        {onDeck.length > 0 && (
          <Card A={A} title="On Deck (🔵 RSL Basing)" sub="RS-line 52w highs consolidating near highs" right={<CopyTickersBtn A={A} tickers={onDeckTickers} label="Copy" />}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {onDeck.map((r) => (
                <div key={r.ticker} onClick={() => onTicker && onTicker(r.ticker)} style={{ cursor: "pointer", fontSize: 11, display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${A.border}`, paddingBottom: 4 }}>
                  <Tk t={r.ticker} />
                  <span style={{ color: A.textMuted, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.theme}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "monospace", color: A.green, fontWeight: 700 }}>RS {r.rs}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 10, color: A.textDim }}>{fmtPct(r.off52, 1)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Quick Copy TradingView Strip */}
      {(boTickers.length > 0 || allMoverTickers.length > 0 || onDeckTickers.length > 0) && (
        <Card A={A} title="Quick Copy (TradingView)">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, fontFamily: "monospace" }}>
            {boTickers.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: "#fbbf24", fontWeight: 700, minWidth: 85 }}>Breakouts:</span>
                <code style={{ color: A.text, background: A.bg, padding: "2px 6px", borderRadius: 4, border: `1px solid ${A.border}` }}>{boTickers.join(",")}</code>
                <CopyTickersBtn A={A} tickers={boTickers} label="Copy" />
              </div>
            )}
            {allMoverTickers.length > boTickers.length && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: A.green, fontWeight: 700, minWidth: 85 }}>All Movers:</span>
                <code style={{ color: A.text, background: A.bg, padding: "2px 6px", borderRadius: 4, border: `1px solid ${A.border}` }}>{allMoverTickers.join(",")}</code>
                <CopyTickersBtn A={A} tickers={allMoverTickers} label="Copy" />
              </div>
            )}
            {onDeckTickers.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: A.cyan, fontWeight: 700, minWidth: 85 }}>On Deck:</span>
                <code style={{ color: A.text, background: A.bg, padding: "2px 6px", borderRadius: 4, border: `1px solid ${A.border}` }}>{onDeckTickers.join(",")}</code>
                <CopyTickersBtn A={A} tickers={onDeckTickers} label="Copy" />
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
