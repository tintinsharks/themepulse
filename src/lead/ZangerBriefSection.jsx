import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CopyTickersBtn,
  EPS_TIP,
  FlagButton,
  RslDot,
  TierMark,
  closingRange,
  pinReason,
  scoreZangerCandidate,
  statusColor,
  td,
  th,
  useRvolProfiles,
  useScanQuotes,
} from "./core.jsx";
import { authFetch } from "../utils.js";
import { computeLivePortfolioPulse, filterRecentHeadlines } from "./briefLive.js";
import BreakoutFollowThroughCard from "./BreakoutFollowThroughCard.jsx";

const BRIEF_DIR = "/data/briefs/";
const INDEX_TKS = ["SPY", "QQQ", "IWM", "DIA"];
const NEWS_TTL_MS = 5 * 60 * 1000;
const _newsCache = new Map();
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

const BO_COLORS = {
  ZANGER: "#fbbf24",
  "SB4%": "#4ade80",
  "SB$": "#38bdf8",
  QMAG: "#c084fc",
};

const BO_META = {
  ZANGER: { label: "🔥 ZNG", color: "#fbbf24", tip: "Dan Zanger Breakout: ZVR ≥ 2.0x, up ≥ +3%, CR ≥ 70%, within 10% of 52wH" },
  "SB4%": { label: "⚡ 4%", color: "#4ade80", tip: "Stockbee 4% Momentum Burst: up ≥ +4% on ≥ 1.0x volume, CR ≥ 60%" },
  "SB$": { label: "💵 $BO", color: "#38bdf8", tip: "Stockbee $ Breakout: up ≥ $0.90 (and ≥ +1.5%) on ≥ 1.2x volume, CR ≥ 60%" },
  QMAG: { label: "🚀 QMAG", color: "#c084fc", tip: "Qullamaggie Breakout: prior momentum leader + tight/EMA structure + ≥0.7x ADR thrust on ≥ 1.3x vol" },
};
const BO_KEYS = ["ZANGER", "SB4%", "SB$", "QMAG"];

const CAT_TABS = [
  ["bo", "🔥 Breakouts", "#fbbf24", "Any of the 4 breakouts: Zanger, Stockbee 4%, Stockbee $, Qullamaggie"],
  ["zanger", "⚡ All Movers", "#4ade80", "Any breakout OR ZVR ≥ 1.5x volume surge in a leading/emerging theme"],
  ["rsl", "🔵 RS Leading", "#38bdf8", "RS line at a new 52-week high on a green close while basing 5–15% off highs"],
  ["leaders", "⭐ Core Leaders", "#f59e0b", "RS 90+ Tier Leaders in Leading theme layers"],
];

const fmtPct = (v, dg = 1) =>
  typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(dg)}%` : "—";

const fmtVol = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
};

function ZvrMeter({ zvr, A }) {
  if (zvr == null) return <span style={{ color: A.textMuted }}>—</span>;
  const pct = Math.min(100, Math.round((zvr / 3.5) * 100));
  const color = zvr >= 2.0 ? "#fbbf24" : zvr >= 1.5 ? A.green : A.textDim;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 48 }}>
      <span style={{ color, fontWeight: zvr >= 1.5 ? 800 : 500, fontFamily: "monospace", fontSize: 11 }}>{zvr.toFixed(2)}x</span>
      <div style={{ width: 44, height: 3, borderRadius: 2, background: A.border, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function CrMeter({ cr, A }) {
  if (cr == null) return <span style={{ color: A.textMuted }}>—</span>;
  const color = cr >= 75 ? A.green : cr >= 60 ? A.cyan : cr >= 40 ? A.textDim : A.red;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 40 }}>
      <span style={{ color, fontWeight: cr >= 70 ? 700 : 400, fontFamily: "monospace", fontSize: 11 }}>{cr}%</span>
      <div style={{ width: 36, height: 3, borderRadius: 2, background: A.border, position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: `${Math.max(4, Math.min(100, cr))}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

const VALID_CAT_TABS = new Set(["bo", "zanger", "rsl", "leaders"]);

export default function ZangerBriefSection({
  A,
  stockMap,
  tickerLayer,
  layers,
  themes,
  tiers,
  portfolio = [],
  setPortfolio,
  watchlist = [],
  setWatchlist,
  onTicker,
  chartTicker,
  onLayer,
}) {
  const [index, setIndex] = useState(null);
  const [sel, setSel] = useState(null);
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(null);
  const [liveOn, setLiveOn] = useState(true);
  const [mq, setMq] = useState(null);
  const [catTab, setCatTab] = useState(() => {
    try {
      const saved = localStorage.getItem("tp-brief-cat");
      if (VALID_CAT_TABS.has(saved)) return saved;
    } catch { /* ignore */ }
    return "zanger";
  });
  const [boFilter, setBoFilter] = useState(null); // null | "ZANGER" | "SB4%" | "SB$" | "QMAG"
  const [themeFilter, setThemeFilter] = useState(null);
  const [minZvr, setMinZvr] = useState(1.0);
  const [minRs, setMinRs] = useState(70);
  const [epsOnly, setEpsOnly] = useState(false);
  const [cleanOnly, setCleanOnly] = useState(false);
  const [moverSort, setMoverSort] = useState(() => (catTab === "leaders" || catTab === "rsl" ? { k: "rs", d: -1 } : { k: "score", d: -1 }));
  const [flowSort, setFlowSort] = useState({ k: "avgChg", d: -1 });
  const [portSort, setPortSort] = useState({ k: "list", d: 1 });
  const [liveNews, setLiveNews] = useState({});
  const profiles = useRvolProfiles();

  const pfSet = useMemo(() => new Set(portfolio || []), [portfolio]);
  const wlSet = useMemo(() => new Set(watchlist || []), [watchlist]);
  const toggleList = (t, target) => {
    const setter = target === "pf" ? setPortfolio : setWatchlist;
    if (!setter) return;
    setter((prev) => ((prev || []).includes(t) ? prev.filter((x) => x !== t) : [...(prev || []), t]));
  };

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
    () => (liveOn ? [...new Set([...INDEX_TKS, ...poolTickers, ...(portfolio || []), ...(watchlist || [])].filter(Boolean))] : []),
    [liveOn, poolTickers, portfolio, watchlist]
  );
  const { quotes, at } = useScanQuotes(quoteTickers, liveOn && quoteTickers.length > 0);

  const livePortAlerts = useMemo(() => {
    if (!liveOn || (!portfolio.length && !watchlist.length)) return null;
    return computeLivePortfolioPulse({
      portfolio,
      watchlist,
      stockMap,
      quotes,
      profiles,
      tickerLayer,
      tiers,
    });
  }, [liveOn, portfolio, watchlist, stockMap, quotes, profiles, tickerLayer, tiers]);

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
      allScored: scored,
      movers,
      themeFlow: {
        hottest: flowRows.slice(0, 5),
        coldest: flowRows.length > 5 ? flowRows.slice(-3).reverse() : [],
      },
      damagedLeaders,
      onDeck,
    };
  }, [liveOn, quotes, poolTickers, stockMap, tickerLayer, tiers, profiles, snap]);

  // Fetch fresh Finviz headlines via /api/live?news=TICKER for top 8 live movers (5m cache)
  const top8Key = useMemo(() => {
    const list = liveComputed ? liveComputed.movers : (snap?.zangerMovers || []);
    return list.slice(0, 8).map((m) => m.ticker).join(",");
  }, [liveComputed, snap]);

  useEffect(() => {
    if (!liveOn || !top8Key) return;
    let alive = true;
    const tickers = top8Key.split(",").filter(Boolean);
    const nowMs = Date.now();
    const initial = {};
    const toFetch = [];
    for (const tk of tickers) {
      const cached = _newsCache.get(tk);
      if (cached && nowMs - cached.ts < NEWS_TTL_MS) {
        initial[tk] = cached.items;
      } else {
        toFetch.push(tk);
      }
    }
    if (Object.keys(initial).length) {
      setLiveNews((prev) => ({ ...prev, ...initial }));
    }
    if (!toFetch.length) return () => { alive = false; };

    Promise.all(
      toFetch.map(async (tk) => {
        try {
          const r = await authFetch(`/api/live?news=${encodeURIComponent(tk)}`, { cache: "no-store" });
          if (!r.ok) return [tk, []];
          const d = await r.json();
          const raw = (d?.news || []).map((n) => ({
            title: n.title || n.headline || "",
            source: n.source || "",
            date: n.date || n.time || "",
            url: n.url || "",
          })).filter((n) => n.title);
          const fresh = filterRecentHeadlines(raw, new Date(), 14).slice(0, 2);
          _newsCache.set(tk, { ts: Date.now(), items: fresh });
          return [tk, fresh];
        } catch {
          return [tk, []];
        }
      })
    ).then((pairs) => {
      if (!alive) return;
      const patch = {};
      for (const [tk, items] of pairs) patch[tk] = items;
      setLiveNews((prev) => ({ ...prev, ...patch }));
    });
    return () => { alive = false; };
  }, [liveOn, top8Key]);

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
  const allPool = liveComputed ? liveComputed.allScored : [...(snap?.zangerMovers || []), ...(snap?.onDeckRsl || [])];
  const bos = allPool.filter((m) => m.isBreakout);
  const catCounts = {
    bo: bos.length,
    zanger: liveComputed ? allPool.filter((r) => r.qualifiesZanger).length : (snap?.zangerMovers || []).length,
    rsl: allPool.filter((r) => r.rsl).length,
    leaders: allPool.filter((r) => r.tier === "lead" && r.layerStatus === "lead").length,
  };
  const boTypeCounts = { ZANGER: 0, "SB4%": 0, "SB$": 0, QMAG: 0 };
  for (const r of allPool) {
    for (const k of r.breakoutTypes || []) if (boTypeCounts[k] != null) boTypeCounts[k]++;
  }
  const chipStyle = (active, accent) => ({
    background: active ? `${accent || A.green}22` : "transparent",
    border: `1px solid ${active ? (accent || A.green) : A.border}`,
    color: active ? (accent || A.green) : A.textDim,
    padding: "2px 7px",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: active ? 700 : 500,
    whiteSpace: "nowrap",
  });
  const pickCatTab = (t) => {
    setCatTab(t);
    if (t !== "bo" && t !== "zanger") setBoFilter(null);
    try { localStorage.setItem("tp-brief-cat", t); } catch { /* ignore */ }
    if (t === "leaders" || t === "rsl") setMoverSort({ k: "rs", d: -1 });
    else setMoverSort({ k: "score", d: -1 });
  };
  const topThemes = (() => {
    const list = (themes || []).filter((t) => t.st === "lead" || t.st === "emerg").slice(0, 12);
    const hitCount = {};
    for (const r of allPool) {
      if (!r.theme) continue;
      const inTab = catTab === "bo"
        ? r.isBreakout
        : catTab === "rsl"
        ? r.rsl
        : catTab === "leaders"
        ? (r.tier === "lead" && r.layerStatus === "lead")
        : r.qualifiesZanger;
      if (inTab) hitCount[r.theme] = (hitCount[r.theme] || 0) + 1;
    }
    return list.map((t) => {
      const hasWarn = (t.layers || []).some((l) => (l.flags || []).some(([k]) => k === "distrib" || k === "exiting"));
      return { ...t, hits: hitCount[t.theme] || 0, hasWarn };
    });
  })();
  const extraThemeChip = themeFilter && !topThemes.some((t) => t.theme === themeFilter) ? themeFilter : null;
  const ph = snap?.phase || { id: "midday", label: "INTRADAY UPDATE", subtitle: "", accent: A.green };
  const portAlerts = livePortAlerts || snap?.portfolioAlerts || {};
  const showPortPulse = Boolean(
    portAlerts.alerts?.length > 0 ||
    (portAlerts.isLive && (portAlerts.portfolioCount > 0 || portAlerts.watchlistCount > 0))
  );
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

  const filteredRows = allPool.filter((r) => {
    if (catTab === "bo" && !r.isBreakout) return false;
    if (catTab === "zanger" && !r.qualifiesZanger) return false;
    if (catTab === "rsl" && !r.rsl) return false;
    if (catTab === "leaders" && !(r.tier === "lead" && r.layerStatus === "lead")) return false;
    if (boFilter && !(r.breakoutTypes || []).includes(boFilter)) return false;
    if (themeFilter && r.theme !== themeFilter) return false;
    if ((catTab === "zanger" || catTab === "bo") && minZvr > 1.0 && (r.zvr ?? 0) < minZvr) return false;
    if (minRs > 70 && (r.rs ?? 0) < minRs) return false;
    if (epsOnly && (r.eps ?? 0) < 50) return false;
    if (cleanOnly && ((r.layerFlags?.length ? r.layerFlags : tickerLayer?.[r.ticker]?.flags) || []).some(([k]) => k === "distrib" || k === "exiting")) return false;
    return true;
  });

  const sortedMovers = [...filteredRows].sort((a, b) => {
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
  }).slice(0, 60);

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
      {(showPortPulse || portEarnings.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
          {showPortPulse && (
            <Card
              A={A}
              title="Portfolio & Watchlist Pulse"
              sub={
                portAlerts.isLive ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        fontFamily: "monospace",
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "rgba(34,197,94,0.14)",
                        border: `1px solid ${A.green}66`,
                        color: A.green,
                      }}
                    >
                      LIVE 60s
                    </span>
                    <span>
                      {portAlerts.alerts?.length || 0} active across {portAlerts.portfolioCount} holdings / {portAlerts.watchlistCount} watchlist
                    </span>
                  </span>
                ) : (
                  `${portAlerts.alerts.length} active across ${portAlerts.portfolioCount} holdings / ${portAlerts.watchlistCount} watchlist`
                )
              }
            >
              {sortedPortAlerts.length === 0 ? (
                <div style={{ fontSize: 11, color: A.green }}>
                  ✅ All {portAlerts.portfolioCount} holdings / {portAlerts.watchlistCount} watchlist quiet — no breakdowns or volume alerts.
                </div>
              ) : (
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
              )}
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
        sub={`${liveComputed ? "Live 60s scan · " : ""}${sortedMovers.length} shown · click any row to chart`}
        right={<CopyTickersBtn A={A} tickers={sortedMovers.map((m) => m.ticker)} label="Copy Shown" />}
      >
        {/* Category Tabs matching Zanger view */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {CAT_TABS.map(([id, label, color, tip]) => {
            const active = catTab === id;
            return (
              <button
                key={id}
                onClick={() => pickCatTab(id)}
                title={tip}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: active ? `${color}1f` : A.bg,
                  border: `1px solid ${active ? color : A.border}`,
                  color: active ? color : A.textDim,
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: active ? 800 : 600,
                  fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                <span>{label}</span>
                <span style={{ opacity: 0.85, fontSize: 11 }}>{catCounts[id]}</span>
              </button>
            );
          })}
        </div>

        {/* Leading & Emerging Themes Filter Strip */}
        {(topThemes.length > 0 || extraThemeChip) && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginBottom: 8, padding: "6px 8px", background: A.bg, border: `1px solid ${A.border}`, borderRadius: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: A.textMuted, fontFamily: "monospace", letterSpacing: 0.5, marginRight: 2 }}>THEMES</span>
            <button onClick={() => setThemeFilter(null)} style={chipStyle(!themeFilter, A.green)}>All</button>
            {topThemes.map((t) => {
              const active = themeFilter === t.theme;
              const c = statusColor(t.st, A);
              return (
                <button
                  key={t.themeId || t.theme}
                  onClick={() => setThemeFilter(active ? null : t.theme)}
                  title={`${t.theme} (rank ${Math.round(t.now)})${t.hasWarn ? " · contains layers with distrib/exiting flags" : ""}`}
                  style={chipStyle(active, c)}
                >
                  {t.theme}
                  <span style={{ opacity: 0.75, marginLeft: 4 }}>{t.hits}</span>
                  {t.hasWarn && <span style={{ color: "#f59e0b", marginLeft: 3 }}>•</span>}
                </button>
              );
            })}
            {extraThemeChip && (
              <button onClick={() => setThemeFilter(null)} style={chipStyle(true, A.cyan)} title="Clear theme filter">
                {extraThemeChip} ✕
              </button>
            )}
          </div>
        )}

        {/* Sub-filters: Breakout type, ZVR, RS, EPS, Clean layers */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${A.border}` }}>
          {(catTab === "bo" || catTab === "zanger") && (
            <div style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 9, color: A.textMuted, fontFamily: "monospace" }}>TYPE</span>
              <button onClick={() => setBoFilter(null)} style={chipStyle(!boFilter, A.green)}>All</button>
              {BO_KEYS.map((k) => {
                const bm = BO_META[k];
                return (
                  <button key={k} onClick={() => setBoFilter(boFilter === k ? null : k)} title={bm.tip} style={chipStyle(boFilter === k, bm.color)}>
                    {bm.label} <span style={{ opacity: 0.75 }}>{boTypeCounts[k]}</span>
                  </button>
                );
              })}
            </div>
          )}
          {(catTab === "bo" || catTab === "zanger") && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 9, color: A.textMuted, fontFamily: "monospace" }}>ZVR</span>
              {[1.0, 1.5, 2.0, 2.5].map((v) => (
                <button key={v} onClick={() => setMinZvr(v)} style={chipStyle(minZvr === v, "#fbbf24")}>{v === 1.0 ? "Any" : `≥${v.toFixed(1)}x`}</button>
              ))}
            </div>
          )}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 9, color: A.textMuted, fontFamily: "monospace" }}>RS</span>
            {[70, 80, 90].map((v) => (
              <button key={v} onClick={() => setMinRs(v)} style={chipStyle(minRs === v, A.cyan)}>≥{v}</button>
            ))}
          </div>
          <button onClick={() => setEpsOnly((v) => !v)} style={chipStyle(epsOnly, A.green)} title="Require O'Neil EPS Rating ≥ 50">EPS ≥ 50</button>
          <button onClick={() => setCleanOnly((v) => !v)} style={chipStyle(cleanOnly, A.green)} title="Hide layers with distribution or exiting-leader warnings">Clean layers</button>
        </div>

        {sortedMovers.length === 0 ? (
          <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 0" }}>
            No stocks match the current filters in this tab.
            {catTab !== "leaders" && (
              <>
                {" "}
                <button onClick={() => pickCatTab("leaders")} style={{ background: "none", border: "none", color: A.green, textDecoration: "underline", cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>
                  View Core Leaders ({catCounts.leaders})
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                <tr>
                  {moverTh("sig", "Sig", "left")}
                  {moverTh("ticker", "Ticker", "left", undefined, true)}
                  {moverTh("theme", "Theme · Layer", "left", undefined, true)}
                  {moverTh("adr", "ADR")}
                  {moverTh("chg", "Chg%")}
                  {moverTh("fromOpen", "Open%", "right", "Intraday gain/loss from today's open")}
                  {moverTh("zvr", "ZVR", "right", "Zanger Volume Ratio vs 10-day intraday volume profile")}
                  {moverTh("cr", "CR%", "right", "Closing Range — where price sits in today's low-to-high range")}
                  {moverTh("rs", "RS")}
                  {moverTh("eps", "EPS", "right", EPS_TIP)}
                  {moverTh("off52", "Off 52wH")}
                  {moverTh("score", "Score")}
                  {(setPortfolio || setWatchlist) && <th style={th(A, "right")}>List</th>}
                </tr>
              </thead>
              <tbody>
                {sortedMovers.map((m) => {
                  const inPf = pfSet.has(m.ticker);
                  const inWl = wlSet.has(m.ticker);
                  const company = m.company || stockMap?.[m.ticker]?.company || "";
                  const tl = tickerLayer?.[m.ticker];
                  const layerSt = m.layerStatus || tl?.st;
                  const dotColor = statusColor(layerSt, A) || A.textMuted;
                  const layerFlagsList = (m.layerFlags?.length ? m.layerFlags : tl?.flags) || [];
                  const warnFlags = layerFlagsList.filter(([k]) => k === "distrib" || k === "exiting");
                  const hasLayerWarn = warnFlags.length > 0;
                  const layerRank = m.layerRank ?? tl?.now ?? null;
                  const layerTip = [
                    `${m.theme || "—"} · ${m.layer || "—"}`,
                    layerRank != null ? `Rank ${Math.round(layerRank)}` : null,
                    ...warnFlags.map(([, msg]) => `⚠ ${msg}`),
                    onLayer ? "Click to open layer" : null,
                  ].filter(Boolean).join(" — ");
                  return (
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
                          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "1px 4px", borderRadius: 3, background: m.rsl ? "rgba(56,189,248,0.16)" : m.qualifiesZanger ? "rgba(34,197,94,0.16)" : "transparent", color: m.rsl ? A.cyan : m.qualifiesZanger ? A.green : A.textDim, border: m.rsl || m.qualifiesZanger ? "none" : `1px solid ${A.border}` }}>
                            {m.rsl ? "RSL" : m.qualifiesZanger ? "VOL" : "LEAD"}
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={td(A)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <FlagButton t={m.ticker} A={A} />
                        <Tk t={m.ticker} />
                        <TierMark t={m.ticker} />
                        <RslDot tip={m.rslTip} A={A} />
                        {m.earningsDays != null && m.earningsDays >= 0 && m.earningsDays <= 5 && (
                          <span title={m.earningsDisplay || ""} style={{ marginLeft: 3, fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "0 4px", borderRadius: 3, background: "rgba(245,158,11,0.18)", color: "#f59e0b" }}>
                            ER {m.earningsDays}d
                          </span>
                        )}
                      </div>
                      {company && (
                        <div style={{ fontSize: 9, color: A.textMuted, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {company}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td(A), fontSize: 11, color: A.textDim }}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onLayer && onLayer(m.ticker); }}
                        title={layerTip}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          margin: 0,
                          font: "inherit",
                          color: A.textDim,
                          cursor: onLayer ? "pointer" : "default",
                          textAlign: "left",
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            background: dotColor,
                            flexShrink: 0,
                            display: "inline-block",
                          }}
                        />
                        <span>
                          <strong style={{ color: A.text }}>{m.theme}</strong> · {m.layer}
                        </span>
                        {hasLayerWarn && (
                          <span style={{ color: "#f59e0b", fontSize: 11, lineHeight: 1 }} aria-label="Layer warning">
                            ⚠
                          </span>
                        )}
                      </button>
                    </td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: (m.adr ?? 0) >= 4 ? A.cyan : A.textDim }}>{m.adr != null ? `${m.adr.toFixed(1)}%` : "—"}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: pc(m.chg) }}>
                      {fmtPct(m.chg, 2)}
                      {m.dollarMove != null && m.dollarMove >= 0.9 && (
                        <span style={{ display: "block", fontSize: 9, fontWeight: 500, color: A.cyan }}>+${m.dollarMove.toFixed(2)}</span>
                      )}
                    </td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: pc(m.fromOpen) }}>
                      {fmtPct(m.fromOpen, 1)}
                    </td>
                    <td style={td(A, "right")}><ZvrMeter zvr={m.zvr} A={A} /></td>
                    <td style={td(A, "right")}><CrMeter cr={m.cr} A={A} /></td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: rsC(m.rs) }}>{m.rs}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: epsC(m.eps) }}>{m.eps ?? "—"}{m.epsAccel ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: (m.off52 ?? -99) >= -5 ? A.green : A.textDim }}>{fmtPct(m.off52, 1)}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 800, color: (m.score ?? 0) >= 70 ? "#fbbf24" : A.text }}>{m.score != null ? m.score.toFixed(1) : "—"}</td>
                    {(setPortfolio || setWatchlist) && (
                      <td style={td(A, "right")} onClick={(e) => e.stopPropagation()}>
                        <span style={{ display: "inline-flex", gap: 3 }}>
                          {setPortfolio && (
                            <button
                              title={inPf ? "Remove from Portfolio" : "Add to Portfolio"}
                              onClick={() => toggleList(m.ticker, "pf")}
                              style={{ background: inPf ? `${A.green}22` : "transparent", border: `1px solid ${inPf ? A.green : A.border}`, color: inPf ? A.green : A.textMuted, borderRadius: 3, padding: "1px 4px", fontSize: 9, fontFamily: "monospace", fontWeight: inPf ? 700 : 500, cursor: "pointer" }}
                            >
                              PF
                            </button>
                          )}
                          {setWatchlist && (
                            <button
                              title={inWl ? "Remove from Watchlist" : "Add to Watchlist"}
                              onClick={() => toggleList(m.ticker, "wl")}
                              style={{ background: inWl ? `${A.cyan}22` : "transparent", border: `1px solid ${inWl ? A.cyan : A.border}`, color: inWl ? A.cyan : A.textMuted, borderRadius: 3, padding: "1px 4px", fontSize: 9, fontFamily: "monospace", fontWeight: inWl ? 700 : 500, cursor: "pointer" }}
                            >
                              WL
                            </button>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                );
                })}
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
            <div style={{ fontSize: 11, fontWeight: 700, color: A.text, marginBottom: 4 }}>
              Catalyst Check (Top Movers)
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 400, color: A.textMuted }}>
                {liveOn ? "live Finviz news · last 14d only" : "snapshot · last 14d only"}
              </span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: A.textDim, lineHeight: 1.5 }}>
              {movers.slice(0, 8).map((m) => {
                const now = new Date();
                const hasLive = liveOn && Object.prototype.hasOwnProperty.call(liveNews, m.ticker);
                const liveList = hasLive ? liveNews[m.ticker] : null;
                const snapList = filterRecentHeadlines(headlines[m.ticker] || [], now, 14);
                const pipeList = filterRecentHeadlines(m.pipelineNews || [], now, 14).map((t) => ({ title: t }));
                const items = liveList?.length ? liveList : snapList.length ? snapList : pipeList;
                const loadingNews = liveOn && !hasLive && !items.length;
                return (
                  <li key={m.ticker} style={{ marginBottom: 4 }}>
                    <Tk t={m.ticker} /> <span style={{ color: A.textMuted }}>({m.theme}, {fmtPct(m.chg)}, ZVR {m.zvr != null ? `${m.zvr.toFixed(2)}x` : "—"}):</span>{" "}
                    {loadingNews ? (
                      <em style={{ color: A.textMuted }}>Fetching live headlines…</em>
                    ) : items.length ? (
                      items.slice(0, 2).map((h, i) => {
                        const href = safeUrl(h.url);
                        const meta = [h.date, h.source].filter(Boolean).join(" · ");
                        return (
                          <span key={i}>
                            {i > 0 ? " | " : ""}
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: A.text, textDecoration: "underline", textDecorationColor: A.border }}>
                                {h.title}
                              </a>
                            ) : (
                              <span style={{ color: A.text }}>{h.title}</span>
                            )}
                            {meta && <span style={{ color: A.textMuted, fontSize: 10 }}> ({meta})</span>}
                          </span>
                        );
                      })
                    ) : (
                      <em style={{ color: A.textMuted }}>No recent catalyst headline (last 14d)</em>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <BreakoutFollowThroughCard
        A={A}
        index={index}
        quotes={quotes}
        stockMap={stockMap}
        liveOn={liveOn}
        onTicker={onTicker}
        chartTicker={chartTicker}
      />

      {ph.id !== "premarket" && ph.id !== "open" && EpCard}

      {/* Intraday Theme Money Flow + Leader Damage + On Deck */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
        {sortedFlow.length > 0 && (
          <Card A={A} title="Today's Theme Money Flow" sub="Click a theme to filter movers above">
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
                  const selected = themeFilter === t.theme;
                  return (
                    <tr
                      key={t.theme}
                      onClick={() => setThemeFilter((cur) => (cur === t.theme ? null : t.theme))}
                      title={selected ? "Click to clear theme filter" : `Filter movers by ${t.theme}`}
                      style={{ cursor: "pointer", background: selected ? A.bgHover : "transparent" }}
                    >
                      <td style={{ ...td(A), fontWeight: selected || !isCold ? 600 : 400, color: selected ? A.cyan : isCold ? A.textDim : A.text }}>{isCold ? `❄️ ${t.theme}` : t.theme}</td>
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
