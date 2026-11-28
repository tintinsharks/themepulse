import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdrFilter,
  Card,
  CopyTickersBtn,
  EPS_TIP,
  ExtHoursMovers,
  FlagButton,
  flagHex,
  IndexSpark,
  LEAD_INDEXES,
  RslDot,
  TierMark,
  closingRange,
  extRows,
  indexStats,
  isHealthcareItem,
  pinReason,
  scoreZangerCandidate,
  statusColor,
  stockThrust,
  td,
  th,
  useFlags,
  useRvolProfiles,
  useScanQuotes,
} from "./core.jsx";
import { authFetch } from "../utils.js";
import { computeLivePortfolioPulse, filterRecentHeadlines } from "./briefLive.js";
import { evalScanHits } from "./scannerMath.js";
import { analyze30mPivot } from "./pivot30mMath.js";
import BreakoutFollowThroughCard from "./BreakoutFollowThroughCard.jsx";
import MarketBreadthCard from "../components/MarketBreadthCard.jsx";

const BRIEF_DIR = "/data/briefs/";
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const INDEX_TKS = LEAD_INDEXES.map((x) => x.t);
const MACRO_PILL_TKS = ["VIXY", "UUP", "IBIT", "GLD", "SLV", "USO"];
const NEWS_TTL_MS = 5 * 60 * 1000;
const _newsCache = new Map();
const BARS30_TTL_MS = 2 * 60 * 1000;
const BARS30_MAX = 48;
const BARS30_ACTIVE_MAX = 120;
const _bars30Cache = new Map();
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

const BASE_FILTERS = [
  ["all", "All Universe", "#e2e8f0", "Entire ThemePulse universe (no base filter applied)"],
  ["core", ">50d Leaders", "#a78bfa", "Original base: Avg $vol ≥ $20M · above 50d SMA · RS ≥ 70 or Leading/Emerging tier/layer"],
  ["adr5liq", "💧 ADR 5%+ Liq", "#fb923c", "Mkt cap > $100M · ADR > 5% · Avg vol (10D) > 500K · Price > 200d SMA · 1W $vol > $300M"],
];
const VALID_BASE_FILTERS = new Set(BASE_FILTERS.map(([k]) => k));

const GOTO_STORAGE_KEY = "tp-brief-goto-preset-v1";
const DEFAULT_GOTO_EXCLUDED = [
  "Financial Services",
  "Utilities",
  "Shipping",
  "Financials",
  "Basic Materials",
  "Communication Services",
  "Industrials",
  "Agriculture",
  "Energy",
  "Materials",
];
const DEFAULT_GOTO_PRESET = {
  catTab: "all",
  baseFilter: "all",
  boFilter: null,
  only9M: false,
  onlyOrh: false,
  only30m: false,
  onlyNear52w: true,
  noHealth: true,
  themeFilter: null,
  excludedThemes: DEFAULT_GOTO_EXCLUDED,
  minAdr: null,
  minZvr: 1.0,
  minRs: 0,
  epsOnly: false,
  cleanOnly: false,
};

function loadGotoPreset() {
  try {
    const raw = JSON.parse(localStorage.getItem(GOTO_STORAGE_KEY) || "null");
    if (!raw || typeof raw !== "object") return DEFAULT_GOTO_PRESET;
    return {
      catTab: VALID_CAT_TABS.has(raw.catTab) && raw.catTab !== "ext" ? raw.catTab : DEFAULT_GOTO_PRESET.catTab,
      baseFilter: VALID_BASE_FILTERS.has(raw.baseFilter) ? raw.baseFilter : DEFAULT_GOTO_PRESET.baseFilter,
      boFilter: BO_KEYS.includes(raw.boFilter) ? raw.boFilter : null,
      only9M: Boolean(raw.only9M),
      onlyOrh: Boolean(raw.onlyOrh),
      only30m: Boolean(raw.only30m),
      onlyNear52w: raw.onlyNear52w == null ? true : Boolean(raw.onlyNear52w),
      noHealth: raw.noHealth == null ? true : Boolean(raw.noHealth),
      themeFilter: typeof raw.themeFilter === "string" && raw.themeFilter ? raw.themeFilter : null,
      excludedThemes: Array.isArray(raw.excludedThemes)
        ? raw.excludedThemes.filter((x) => typeof x === "string" && x)
        : DEFAULT_GOTO_EXCLUDED,
      minAdr: typeof raw.minAdr === "number" && Number.isFinite(raw.minAdr) ? raw.minAdr : null,
      minZvr: typeof raw.minZvr === "number" && Number.isFinite(raw.minZvr) ? raw.minZvr : 1.0,
      minRs: typeof raw.minRs === "number" && Number.isFinite(raw.minRs) ? raw.minRs : 0,
      epsOnly: Boolean(raw.epsOnly),
      cleanOnly: Boolean(raw.cleanOnly),
    };
  } catch {
    return DEFAULT_GOTO_PRESET;
  }
}

function sameStringSet(setA, arrB) {
  const b = new Set(arrB || []);
  if (setA.size !== b.size) return false;
  for (const x of setA) if (!b.has(x)) return false;
  return true;
}

const CAT_TABS = [
  ["bo", "🔥 Breakouts", "#fbbf24", "Any of the 4 breakouts: Zanger, Stockbee 4%, Stockbee $, Qullamaggie"],
  ["zanger", "⚡ All Movers", "#4ade80", "Any breakout OR ZVR ≥ 1.5x volume surge with strong close"],
  ["rsl", "🔵 RS Leading", "#38bdf8", "RS line at a new 52-week high on a green close while basing 5–15% off highs"],
  ["leaders", "⭐ Core Leaders", "#f59e0b", "RS 90+ Tier Leaders in Leading theme layers"],
  ["all", "📋 All Stocks", "#94a3b8", "Every stock matching the selected Base filter (including quiet consolidations)"],
  ["ext", "🌙 Pre/Postmarket", "#c084fc", "Pre-market & after-hours movers with earnings flags and catalysts"],
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
    <div title={`${zvr.toFixed(2)}x`} style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 34 }}>
      <span style={{ color, fontWeight: zvr >= 1.5 ? 800 : 500, fontFamily: MONO, fontSize: 10.5 }}>{zvr.toFixed(1)}x</span>
      <div style={{ width: 32, height: 3, borderRadius: 2, background: A.border, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function CrMeter({ cr, A }) {
  if (cr == null) return <span style={{ color: A.textMuted }}>—</span>;
  const color = cr >= 75 ? A.green : cr >= 60 ? A.cyan : cr >= 40 ? A.textDim : A.red;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 28 }}>
      <span style={{ color, fontWeight: cr >= 70 ? 700 : 400, fontFamily: MONO, fontSize: 10.5 }}>{cr}%</span>
      <div style={{ width: 26, height: 3, borderRadius: 2, background: A.border, position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: `${Math.max(4, Math.min(100, cr))}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

const VALID_CAT_TABS = new Set(["bo", "zanger", "rsl", "leaders", "all", "ext"]);

export default function ZangerBriefSection({
  A,
  stockMap,
  tickerLayer = {},
  layers,
  themes,
  members = {},
  tiers,
  breadth,
  monitor,
  pipeline,
  indexQuotes,
  idxBars = {},
  portfolio = [],
  setPortfolio,
  watchlist = [],
  setWatchlist,
  onTicker,
  chartTicker,
  onLayer,
  onTheme,
  breadthFocus = null,
  onBreadthTabChange,
}) {
  const [index, setIndex] = useState(null);
  const [sel, setSel] = useState(null);
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(null);
  const [liveOn, setLiveOn] = useState(true);
  const [mq, setMq] = useState(null);
  const [gotoPreset, setGotoPreset] = useState(loadGotoPreset);
  const [gotoSavedToast, setGotoSavedToast] = useState(false);
  const [baseFilter, setBaseFilter] = useState(() => {
    try {
      const savedBase = localStorage.getItem("tp-brief-base");
      if (VALID_BASE_FILTERS.has(savedBase)) return savedBase;
      if (localStorage.getItem("tp-brief-cat") === "adr5liq") return "adr5liq";
    } catch { /* ignore */ }
    return loadGotoPreset().baseFilter;
  });
  const pickBaseFilter = (b) => {
    setBaseFilter(b);
    try { localStorage.setItem("tp-brief-base", b); } catch { /* ignore */ }
  };
  const [catTab, setCatTab] = useState(() => {
    try {
      const saved = localStorage.getItem("tp-brief-cat");
      if (saved === "adr5liq") return "all";
      if (VALID_CAT_TABS.has(saved)) return saved;
    } catch { /* ignore */ }
    return loadGotoPreset().catTab;
  });
  const [boFilter, setBoFilter] = useState(() => loadGotoPreset().boFilter); // null | "ZANGER" | "SB4%" | "SB$" | "QMAG"
  const [only9M, setOnly9M] = useState(() => loadGotoPreset().only9M); // secondary filter: day share volume >= 8.9M
  const [onlyOrh, setOnlyOrh] = useState(() => loadGotoPreset().onlyOrh); // secondary filter: 30m Opening Range High breakout
  const [only30m, setOnly30m] = useState(() => loadGotoPreset().only30m); // secondary filter: triggered 30-Minute Pivot
  const [onlyNear52w, setOnlyNear52w] = useState(() => {
    try {
      const saved = localStorage.getItem("tp-brief-near52w");
      if (saved === "1" || saved === "0") return saved === "1";
    } catch { /* ignore */ }
    return loadGotoPreset().onlyNear52w;
  }); // secondary filter: within 15% of 52-week high
  const toggleNear52w = () => {
    setOnlyNear52w((prev) => {
      const next = !prev;
      try { localStorage.setItem("tp-brief-near52w", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  const [bars30Map, setBars30Map] = useState({});
  const [bars30Loading, setBars30Loading] = useState(false);
  const [bars30Tick, setBars30Tick] = useState(0);
  const [themeFilter, setThemeFilter] = useState(() => loadGotoPreset().themeFilter);
  const [excludedThemes, setExcludedThemes] = useState(() => {
    try {
      const saved = localStorage.getItem("tp-excluded-themes");
      if (saved != null) {
        const raw = JSON.parse(saved);
        return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string" && x) : []);
      }
    } catch { /* ignore */ }
    return new Set(loadGotoPreset().excludedThemes);
  });
  const [themesMenuOpen, setThemesMenuOpen] = useState(false);
  const [themeSearch, setThemeSearch] = useState("");
  const themesMenuRef = useRef(null);
  const saveExcludedThemes = (nextSet) => {
    setExcludedThemes(nextSet);
    try { localStorage.setItem("tp-excluded-themes", JSON.stringify([...nextSet])); } catch { /* ignore */ }
  };
  const toggleExcludedTheme = (name) => {
    const next = new Set(excludedThemes);
    if (next.has(name)) next.delete(name);
    else {
      next.add(name);
      if (themeFilter === name) setThemeFilter(null);
    }
    saveExcludedThemes(next);
  };
  useEffect(() => {
    if (!themesMenuOpen) return undefined;
    const onDown = (e) => {
      if (themesMenuRef.current && !themesMenuRef.current.contains(e.target)) {
        setThemesMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setThemesMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [themesMenuOpen]);
  const [minZvr, setMinZvr] = useState(() => loadGotoPreset().minZvr);
  const [minRs, setMinRs] = useState(() => loadGotoPreset().minRs);
  const [minAdr, setMinAdr] = useState(() => loadGotoPreset().minAdr);
  const [noHealth, setNoHealth] = useState(() => {
    try {
      const saved = localStorage.getItem("tp-no-health") ?? localStorage.getItem("tp-no-bio");
      if (saved === "1" || saved === "0") return saved === "1";
    } catch { /* ignore */ }
    return loadGotoPreset().noHealth;
  });
  const toggleNoHealth = () => {
    setNoHealth((prev) => {
      const next = !prev;
      try { localStorage.setItem("tp-no-health", next ? "1" : "0"); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent("tp-no-health", { detail: next })); } catch { /* ignore */ }
      return next;
    });
  };
  useEffect(() => {
    const onSync = (e) => setNoHealth(Boolean(e?.detail));
    window.addEventListener("tp-no-health", onSync);
    return () => window.removeEventListener("tp-no-health", onSync);
  }, []);
  const [epsOnly, setEpsOnly] = useState(() => loadGotoPreset().epsOnly);
  const [cleanOnly, setCleanOnly] = useState(() => loadGotoPreset().cleanOnly);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const applyGotoPreset = (preset = gotoPreset) => {
    setCatTab(preset.catTab);
    setBaseFilter(preset.baseFilter);
    setBoFilter(preset.boFilter);
    setOnly9M(preset.only9M);
    setOnlyOrh(preset.onlyOrh);
    setOnly30m(preset.only30m);
    setOnlyNear52w(preset.onlyNear52w);
    setNoHealth(preset.noHealth);
    setThemeFilter(preset.themeFilter);
    saveExcludedThemes(new Set(preset.excludedThemes || []));
    setMinAdr(preset.minAdr);
    setMinZvr(preset.minZvr);
    setMinRs(preset.minRs);
    setEpsOnly(preset.epsOnly);
    setCleanOnly(preset.cleanOnly);
    setMoverSort({ k: "thrust", d: -1 });
    try {
      localStorage.setItem("tp-brief-cat", preset.catTab);
      localStorage.setItem("tp-brief-base", preset.baseFilter);
      localStorage.setItem("tp-brief-near52w", preset.onlyNear52w ? "1" : "0");
      localStorage.setItem("tp-no-health", preset.noHealth ? "1" : "0");
      window.dispatchEvent(new CustomEvent("tp-no-health", { detail: preset.noHealth }));
    } catch { /* ignore */ }
  };

  const saveCurrentAsGoto = () => {
    const next = {
      catTab: catTab === "ext" ? "all" : catTab,
      baseFilter,
      boFilter,
      only9M,
      onlyOrh,
      only30m,
      onlyNear52w,
      noHealth,
      themeFilter,
      excludedThemes: [...excludedThemes],
      minAdr,
      minZvr,
      minRs,
      epsOnly,
      cleanOnly,
    };
    setGotoPreset(next);
    try { localStorage.setItem(GOTO_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setGotoSavedToast(true);
    setTimeout(() => setGotoSavedToast(false), 1800);
  };

  const isGotoActive = useMemo(() => (
    catTab === gotoPreset.catTab &&
    baseFilter === gotoPreset.baseFilter &&
    boFilter === gotoPreset.boFilter &&
    only9M === gotoPreset.only9M &&
    onlyOrh === gotoPreset.onlyOrh &&
    only30m === gotoPreset.only30m &&
    onlyNear52w === gotoPreset.onlyNear52w &&
    noHealth === gotoPreset.noHealth &&
    themeFilter === gotoPreset.themeFilter &&
    sameStringSet(excludedThemes, gotoPreset.excludedThemes) &&
    minAdr === gotoPreset.minAdr &&
    minZvr === gotoPreset.minZvr &&
    minRs === gotoPreset.minRs &&
    epsOnly === gotoPreset.epsOnly &&
    cleanOnly === gotoPreset.cleanOnly
  ), [
    catTab, baseFilter, boFilter, only9M, onlyOrh, only30m, onlyNear52w,
    noHealth, themeFilter, excludedThemes, minAdr, minZvr, minRs, epsOnly, cleanOnly, gotoPreset,
  ]);

  // Support bookmarkable URL hotlink (?preset=goto or #goto)
  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("preset") === "goto" || window.location.hash === "#goto") {
        applyGotoPreset(loadGotoPreset());
        setTimeout(() => {
          document.getElementById("sec-breakouts")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [extrasOpen, setExtrasOpen] = useState(() => {
    try {
      return localStorage.getItem("tp-brief-extras-open") === "1";
    } catch {
      return false;
    }
  });
  const toggleExtras = () => {
    setExtrasOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem("tp-brief-extras-open", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  const [moverSort, setMoverSort] = useState({ k: "thrust", d: -1 });
  const [flowSort, setFlowSort] = useState({ k: "avgChg", d: -1 });
  const [portSort, setPortSort] = useState({ k: "thrust", d: -1 });
  const [portFilter, setPortFilter] = useState("all"); // "all" | "pf" | "wl" | "alerts"
  const [liveNews, setLiveNews] = useState({});
  const [breadthChartFocus, setBreadthChartFocus] = useState(null);
  const flags = useFlags();
  const flaggedTickers = useMemo(
    () => Object.entries(flags || {}).filter(([, v]) => v?.c).map(([t]) => t),
    [flags]
  );
  const profiles = useRvolProfiles();

  const openBreadthChart = (chart, slide = 1) => {
    setBreadthChartFocus({ chart, slide, seq: Date.now() });
    const el = document.getElementById("sec-layers") || document.getElementById("sec-breadth");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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

  // Entire active ThemePulse universe (no hidden base filter — users pick Base via pills)
  const poolTickers = useMemo(() => {
    const out = [];
    for (const [t, s] of Object.entries(stockMap || {})) {
      if (!s?.ticker || !(s.close > 0) || pinReason(s)) continue;
      out.push(t);
    }
    return out;
  }, [stockMap]);

  const quoteTickers = useMemo(
    () => (liveOn ? [...new Set([...INDEX_TKS, ...MACRO_PILL_TKS, ...poolTickers, ...(portfolio || []), ...(watchlist || []), ...flaggedTickers].filter(Boolean))] : []),
    [liveOn, poolTickers, portfolio, watchlist, flaggedTickers]
  );
  const { quotes, at } = useScanQuotes(quoteTickers, liveOn && quoteTickers.length > 0);

  const livePortAlerts = useMemo(() => {
    if (!portfolio.length && !watchlist.length && !flaggedTickers.length) return null;
    const res = computeLivePortfolioPulse({
      portfolio,
      watchlist,
      flagged: flaggedTickers,
      stockMap,
      quotes: liveOn ? quotes : new Map(),
      profiles,
      tickerLayer,
      tiers,
    });
    return { ...res, isLive: liveOn };
  }, [liveOn, portfolio, watchlist, flaggedTickers, stockMap, quotes, profiles, tickerLayer, tiers]);

  const extMeta = useMemo(() => {
    const pmSnap = pipeline?.last_pm || (pipeline?.pm_sip_movers?.length || pipeline?.pm_earnings_movers?.length
      ? { session: null, earnings: pipeline.pm_earnings_movers, movers: pipeline.pm_sip_movers, top: pipeline.pm_top_movers } : null);
    const ahSnap = pipeline?.last_ah || (pipeline?.ah_sip_movers?.length || pipeline?.ah_earnings_movers?.length
      ? { session: null, earnings: pipeline.ah_earnings_movers, movers: pipeline.ah_sip_movers, top: pipeline.ah_top_movers } : null);
    const pm = extRows(pmSnap, stockMap, tickerLayer, true);
    const ah = extRows(ahSnap, stockMap, tickerLayer, true);
    const tickers = [...new Set([...pm.map((r) => r.t), ...ah.map((r) => r.t)])];
    return { count: tickers.length, pmCount: pm.length, ahCount: ah.length, tickers, tickerSet: new Set(tickers) };
  }, [pipeline, stockMap, tickerLayer]);

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

  // Live recomputation across the entire ThemePulse universe (Base filters applied via pills)
  const liveComputed = useMemo(() => {
    if (!poolTickers.length) return null;
    const hasLiveQuotes = Boolean(liveOn && quotes && quotes.size > 0);
    if (liveOn && !hasLiveQuotes && snap) return null;
    const now = new Date();
    const snapNewSet = new Set((snap?.zangerMovers || []).filter((m) => m.isNew).map((m) => m.ticker));
    const scored = [];
    for (const t of poolTickers) {
      const s = stockMap?.[t];
      if (!s) continue;
      const q = hasLiveQuotes ? (quotes.get(t) || null) : null;
      const layer = tickerLayer?.[t] || null;
      const tier = tiers?.leaders?.has(t) ? "lead" : tiers?.emerging?.has(t) ? "emerg" : null;
      const res = scoreZangerCandidate({ s, q, layer, tier, profiles, now, unfiltered: true });
      if (res) {
        res.inAdr5Liq = Boolean(evalScanHits(s, q, res.zvr)?.adr5liq);
        if (snapNewSet.has(t)) res.isNew = true;
        scored.push(res);
      }
    }

    const coreScored = scored.filter((r) => r.inCoreBase);
    const movers = coreScored
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
      const q = hasLiveQuotes ? quotes.get(tk) : null;
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

    const damagedLeaders = coreScored
      .filter((r) => {
        if (r.rs < 90 && r.tier !== "lead") return false;
        if (r.chg == null || r.chg > -3.0) return false;
        return (r.zvr != null && r.zvr >= 1.5) || (r.cr != null && r.cr <= 30) || r.chg <= -4.5;
      })
      .sort((a, b) => a.chg - b.chg || (b.zvr ?? 0) - (a.zvr ?? 0))
      .slice(0, 8);

    const onDeck = coreScored
      .filter((r) => r.rsl && !r.isBreakout && r.rs >= 85)
      .sort((a, b) => b.rs - a.rs || (b.off52 ?? -99) - (a.off52 ?? -99))
      .slice(0, 8);

    return {
      isLive: hasLiveQuotes,
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

  // Top active movers AFTER all synchronous filters for live 30m ORH & Triggered 30m Pivot tagging.
  // Expands scan budget from 48 -> 120 when ORH or 30m is explicitly toggled ON.
  const pivot30Scan = useMemo(() => {
    if (catTab === "ext") return { key: "", total: 0, scanned: 0, cap: BARS30_MAX };
    const raw = liveComputed ? liveComputed.allScored : [...(snap?.zangerMovers || []), ...(snap?.onDeckRsl || [])];
    const pool = raw.filter((r) => {
      if (baseFilter === "core" && !(r.inCoreBase ?? true)) return false;
      if (baseFilter === "adr5liq" && !r.inAdr5Liq) return false;
      if (catTab === "bo" && !r.isBreakout) return false;
      if (catTab === "zanger" && !r.qualifiesZanger) return false;
      if (catTab === "rsl" && !r.rsl) return false;
      if (catTab === "leaders" && !(r.tier === "lead" && r.layerStatus === "lead")) return false;
      if (boFilter && !(r.breakoutTypes || []).includes(boFilter)) return false;
      if (only9M) {
        const v = r?.volume ?? stockMap?.[r?.ticker]?.volume ?? 0;
        if (!r?.is9M && v < 8_900_000) return false;
      }
      if (onlyNear52w && !(typeof r?.off52 === "number" && Number.isFinite(r.off52) && r.off52 >= -15)) return false;
      if ((catTab === "zanger" || catTab === "bo" || catTab === "all") && minZvr > 1.0 && (r.zvr ?? 0) < minZvr) return false;
      if (minRs > 0 && (r.rs ?? 0) < minRs) return false;
      if (minAdr != null && (r.adr ?? -1) < minAdr) return false;
      if (noHealth && isHealthcareItem({
        theme: r.theme || tickerLayer?.[r.ticker]?.theme,
        themeId: tickerLayer?.[r.ticker]?.themeId,
        layer: r.layer || tickerLayer?.[r.ticker]?.name,
        sector: stockMap?.[r.ticker]?.sector,
        industry: stockMap?.[r.ticker]?.industry,
      })) return false;
      if (epsOnly && (r.eps ?? 0) < 50) return false;
      if (cleanOnly && ((r.layerFlags?.length ? r.layerFlags : tickerLayer?.[r.ticker]?.flags) || []).some(([k]) => k === "distrib" || k === "exiting")) return false;
      if (excludedThemes.size > 0 && r.theme && excludedThemes.has(r.theme)) return false;
      if (themeFilter && r.theme !== themeFilter) return false;
      return true;
    });
    const cap = onlyOrh || only30m ? BARS30_ACTIVE_MAX : BARS30_MAX;
    const picked = pool
      .slice()
      .sort((a, b) => (stockThrust(b.chg, b.zvr, b.adr) ?? -999) - (stockThrust(a.chg, a.zvr, a.adr) ?? -999) || (b.rs ?? 0) - (a.rs ?? 0))
      .slice(0, cap);
    return {
      key: picked.map((r) => r.ticker).join(","),
      total: pool.length,
      scanned: picked.length,
      cap,
    };
  }, [
    catTab,
    baseFilter,
    boFilter,
    only9M,
    onlyNear52w,
    onlyOrh,
    only30m,
    minZvr,
    minRs,
    minAdr,
    noHealth,
    epsOnly,
    cleanOnly,
    excludedThemes,
    themeFilter,
    liveComputed,
    snap,
    stockMap,
    tickerLayer,
  ]);
  const pivot30ScanKey = pivot30Scan.key;

  useEffect(() => {
    if (!liveOn) return undefined;
    const id = setInterval(() => {
      if (!document.hidden) setBars30Tick((n) => n + 1);
    }, BARS30_TTL_MS);
    return () => clearInterval(id);
  }, [liveOn]);

  useEffect(() => {
    if (!pivot30ScanKey) {
      setBars30Loading(false);
      return undefined;
    }
    let alive = true;
    const tickers = pivot30ScanKey.split(",").filter(Boolean);
    const nowMs = Date.now();
    const cachedHit = {};
    const missing = [];
    for (const tk of tickers) {
      const entry = _bars30Cache.get(tk);
      if (entry && nowMs - entry.ts < BARS30_TTL_MS) {
        cachedHit[tk] = entry.bars;
      } else {
        missing.push(tk);
      }
    }
    if (Object.keys(cachedHit).length) {
      setBars30Map((prev) => ({ ...prev, ...cachedHit }));
    }
    if (!missing.length) {
      setBars30Loading(false);
      return () => { alive = false; };
    }

    const ac = new AbortController();
    setBars30Loading(true);
    const chunks = [];
    for (let i = 0; i < missing.length; i += 24) {
      chunks.push(missing.slice(i, i + 24));
    }
    const timerId = setTimeout(() => {
      (async () => {
        try {
          for (const chunk of chunks) {
            if (!alive || ac.signal.aborted) break;
            const resp = await authFetch(
              `/api/ohlc?tickers=${encodeURIComponent(chunk.join(","))}&interval=30m`,
              { cache: "no-store", signal: ac.signal }
            );
            if (!resp.ok) continue;
            const d = await resp.json();
            if (!alive || ac.signal.aborted || !d?.items) continue;
            const ts = Date.now();
            const batch = {};
            for (const tk of chunk) {
              const bars = Array.isArray(d.items[tk]) ? d.items[tk] : [];
              _bars30Cache.set(tk, { ts, bars });
              batch[tk] = bars;
            }
            setBars30Map((prev) => ({ ...prev, ...batch }));
          }
        } catch {
          // ignore aborted or transient network errors
        } finally {
          if (alive) setBars30Loading(false);
        }
      })();
    }, 180);

    return () => {
      alive = false;
      clearTimeout(timerId);
      ac.abort();
    };
  }, [pivot30ScanKey, bars30Tick]);

  const pivot30ByTicker = useMemo(() => {
    const map = new Map();
    for (const [tk, bars] of Object.entries(bars30Map || {})) {
      if (!Array.isArray(bars) || !bars.length) continue;
      const q = liveOn ? quotes.get(tk) : null;
      const s = stockMap?.[tk];
      const livePrice = q?.rthPrice ?? q?.price ?? s?.price ?? s?.close ?? undefined;
      map.set(tk, analyze30mPivot(bars, { livePrice }));
    }
    return map;
  }, [bars30Map, quotes, stockMap, liveOn]);

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
      style={{ cursor: "pointer", fontFamily: MONO, fontWeight: 700, color: chartTicker === t ? A.green : A.text }}
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
          borderRadius: 6,
          padding: "2px 8px",
          fontSize: liveOn ? 10 : 11,
          fontWeight: liveOn ? 700 : 600,
          fontFamily: liveOn ? MONO : "inherit",
          cursor: "pointer",
        }}
      >
        <span className={liveOn && at ? "tp-livedot" : undefined} style={{ width: 6, height: 6, borderRadius: 3, background: liveOn ? A.green : A.textMuted, display: "inline-block" }} />
        {liveOn ? (at ? `LIVE · ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "LIVE") : "Snapshot"}
      </button>
    </div>
  );

  const macroPills = useMemo(() => {
    const tapeList = Array.isArray(mq?.tape) ? mq.tape : [];
    const futList = Array.isArray(mq?.futures) && mq.futures.length ? mq.futures : (snap?.market?.futures || []);
    const findTape = (tk) => tapeList.find((x) => x?.ticker === tk);
    const findFut = (re) => futList.find((f) => re.test(String(f?.name || "")));
    const qOf = (tk) => (liveOn ? quotes.get(tk) : null) || stockMap?.[tk] || null;
    const numOr = (v) => {
      const n = Number(v);
      return v != null && v !== "" && Number.isFinite(n) ? n : null;
    };
    const mk = (id, label, chartTk, spotObj, proxyTk, accent, note, invertColor = false) => {
      const q = qOf(proxyTk);
      const spPx = numOr(spotObj?.price);
      const spChg = numOr(spotObj?.changePct ?? spotObj?.change);
      const px = spPx ?? numOr(q?.rthPrice ?? q?.price ?? q?.close);
      const chg = spChg ?? numOr(q?.change ?? q?.change_pct);
      return {
        id,
        label,
        chartTicker: chartTk,
        price: px,
        change: chg,
        accent,
        invertColor,
        tip: `${note}${spPx == null ? ` (${proxyTk} proxy)` : ""} · click to chart ${chartTk}`,
      };
    };
    return [
      mk("vix", "VIX", "VIXY", findTape("VIX") || snap?.market?.vix, "VIXY", "#f472b6", "CBOE Volatility Index", true),
      mk("dxy", "DXY", "UUP", findTape("DXY"), "UUP", "#38bdf8", "US Dollar Index"),
      mk("btc", "BTC", "IBIT", findFut(/btc|bitcoin/i), "IBIT", "#f59e0b", "Bitcoin"),
      mk("gold", "GOLD", "GLD", findFut(/gold/i), "GLD", "#eab308", "Gold"),
      mk("silver", "SILVER", "SLV", findFut(/silver/i), "SLV", "#cbd5e1", "Silver"),
      mk("oil", "OIL", "USO", findFut(/crude|oil|wti/i), "USO", "#fb923c", "WTI Crude Oil"),
    ];
  }, [mq, snap, liveOn, quotes, stockMap]);

  const mergedBreadthFocus = useMemo(() => {
    if (!breadthFocus) return breadthChartFocus;
    if (!breadthChartFocus) return breadthFocus;
    return (breadthFocus.seq || 0) >= (breadthChartFocus.seq || 0) ? breadthFocus : breadthChartFocus;
  }, [breadthFocus, breadthChartFocus]);

  const breadthEmbedded = (
    <div id="sec-layers" style={{ scrollMarginTop: 96 }}>
      <MarketBreadthCard
        A={A}
        stockMap={stockMap}
        breadth={breadth}
        monitor={monitor}
        indexQuotes={indexQuotes}
        onTicker={onTicker}
        chartTicker={chartTicker}
        tickerLayer={tickerLayer}
        themes={themes}
        layers={layers}
        members={members}
        onTheme={onTheme}
        embedded
        chartFocus={mergedBreadthFocus}
        onCardTabChange={onBreadthTabChange}
      />
    </div>
  );

  if (err && !snap && !liveComputed) {
    return (
      <div id="sec-breadth" style={{ scrollMarginTop: 96 }}>
        <Card A={A} title="Market Breadth & Leadership Briefing" sub="Auto-updated hourly during market hours + live intraday overlay" right={picker}>
          <div style={{ fontSize: 11, color: A.textMuted }}>{err}</div>
          {breadthEmbedded}
        </Card>
      </div>
    );
  }
  if (!snap && !liveComputed) {
    return (
      <div id="sec-breadth" style={{ scrollMarginTop: 96 }}>
        <Card A={A} title="Market Breadth & Leadership Briefing" right={picker}>
          <div style={{ fontSize: 11, color: A.textMuted }}>Loading latest Zanger briefing…</div>
          {breadthEmbedded}
        </Card>
      </div>
    );
  }

  const baseMkt = snap?.market || {};
  const tapeMap = new Map((mq?.tape || []).filter((x) => x?.ticker).map((x) => [x.ticker, x]));
  const snapIdxMap = new Map((baseMkt.indices || []).filter((x) => x?.ticker).map((x) => [x.ticker, x]));
  const liveIndices = LEAD_INDEXES.map(({ t: ticker, name }) => {
    const snapIdx = snapIdxMap.get(ticker) || {};
    const q = liveOn ? (quotes.get(ticker) || indexQuotes?.get?.(ticker) || null) : null;
    const tp = liveOn ? tapeMap.get(ticker) : null;
    const stats = indexStats(idxBars?.[ticker], q);
    const price = stats?.px ?? q?.rthPrice ?? q?.price ?? (tp?.price != null ? Number(tp.price) : snapIdx.price);
    const change = stats?.day ?? q?.change ?? (tp?.change != null ? Number(tp.change) : snapIdx.change);
    const cr = q ? closingRange(q, null) : snapIdx.cr;
    return { ticker, name, price, change, cr, maStatus: snapIdx.maStatus, stats };
  });
  const readyIndices = liveIndices.filter((x) => x.stats);
  const uptrendCount = readyIndices.filter((x) => x.stats.trend === "Uptrend").length;
  const idxToneC = (tone) => ({ green: A.green, yellow: A.yellow, orange: "#fb923c", red: A.red }[tone] || A.textDim);

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
  const universePool = liveComputed ? liveComputed.allScored : [...(snap?.zangerMovers || []), ...(snap?.onDeckRsl || [])];
  const matchesTab = (r) => {
    if (catTab === "bo") return Boolean(r.isBreakout);
    if (catTab === "zanger") return Boolean(r.qualifiesZanger);
    if (catTab === "rsl") return Boolean(r.rsl);
    if (catTab === "leaders") return r.tier === "lead" && r.layerStatus === "lead";
    return true;
  };
  const baseCounts = {
    all: universePool.filter(matchesTab).length,
    core: universePool.filter((r) => (r.inCoreBase ?? true) && matchesTab(r)).length,
    adr5liq: universePool.filter((r) => Boolean(r.inAdr5Liq) && matchesTab(r)).length,
  };
  const allPool = universePool.filter((r) => {
    if (baseFilter === "core") return r.inCoreBase ?? true;
    if (baseFilter === "adr5liq") return Boolean(r.inAdr5Liq);
    return true;
  });
  const bos = allPool.filter((m) => m.isBreakout);
  const catCounts = {
    bo: bos.length,
    zanger: liveComputed
      ? allPool.filter((r) => r.qualifiesZanger).length
      : (snap?.zangerMovers || []).length,
    rsl: allPool.filter((r) => r.rsl).length,
    leaders: allPool.filter((r) => r.tier === "lead" && r.layerStatus === "lead").length,
    all: allPool.length,
    ext: extMeta.count,
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
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: active ? 700 : 600,
    whiteSpace: "nowrap",
    flexShrink: 0,
  });
  const pickCatTab = (t) => {
    setCatTab(t);
    if (t !== "bo" && t !== "zanger" && t !== "all") setBoFilter(null);
    try { localStorage.setItem("tp-brief-cat", t); } catch { /* ignore */ }
    setMoverSort({ k: "thrust", d: -1 });
  };
  const ph = snap?.phase || { id: "midday", label: "INTRADAY UPDATE", subtitle: "", accent: A.green };
  const portAlerts = livePortAlerts || snap?.portfolioAlerts || {};
  const portItems = Array.isArray(portAlerts.items) ? portAlerts.items : (portAlerts.alerts || []);
  const showPortPulse = Boolean(
    portItems.length > 0 ||
    portAlerts.portfolioCount > 0 ||
    portAlerts.watchlistCount > 0 ||
    portAlerts.flaggedCount > 0
  );
  const portEarnings = livePortAlerts
    ? (livePortAlerts.upcomingEarnings || [])
    : (snap?.portfolioEarnings || []);
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
  const headlines = snap?.headlines || {};
  const warnLayers = (layers || []).filter((l) => l.st === "lead" && (l.flags || []).some(([k]) => k === "distrib" || k === "exiting"));

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

  const makeSortTh = (sortState, setSortState, styleOverride) => (k, label, align = "right", title, textDefault = false) => (
    <th
      key={k}
      title={title}
      onClick={() => setSortState((p) => ({ k, d: p.k === k ? -p.d : (textDefault ? 1 : -1) }))}
      style={{
        ...th(A, align),
        ...styleOverride,
        cursor: "pointer",
        userSelect: "none",
        color: sortState.k === k ? A.text : A.textMuted,
      }}
    >
      {label}{sortState.k === k ? (sortState.d < 0 ? "▼" : "▲") : ""}
    </th>
  );

  const moverTh = makeSortTh(moverSort, setMoverSort, { padding: "5px 4px", fontSize: 10, letterSpacing: 0.25 });
  const mtd = (align = "left", extra) => ({ ...td(A, align), padding: "5px 4px", fontSize: 11, ...extra });
  const flowTh = makeSortTh(flowSort, setFlowSort);
  const portTh = makeSortTh(portSort, setPortSort);

  const getRowVol = (r) => {
    const v = r?.volume ?? stockMap?.[r?.ticker]?.volume ?? null;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  };
  const isRow9M = (r) => Boolean(r?.is9M || (getRowVol(r) ?? 0) >= 8_900_000);
  const isRowOrh = (r) => pivot30ByTicker.get(r?.ticker)?.openingRange?.status === "ORH_BO";
  const isRow30m = (r) => pivot30ByTicker.get(r?.ticker)?.pivot?.state === "TRIGGERED";
  const isRowNear52w = (r) => typeof r?.off52 === "number" && Number.isFinite(r.off52) && r.off52 >= -15;

  const tabBaseRows = allPool.filter((r) => {
    if (catTab === "bo" && !r.isBreakout) return false;
    if (catTab === "zanger" && !r.qualifiesZanger) return false;
    if (catTab === "rsl" && !r.rsl) return false;
    if (catTab === "leaders" && !(r.tier === "lead" && r.layerStatus === "lead")) return false;
    if (boFilter && !(r.breakoutTypes || []).includes(boFilter)) return false;
    return true;
  });
  const passesSyncFilters = (r) => {
    if (only9M && !isRow9M(r)) return false;
    if (onlyNear52w && !isRowNear52w(r)) return false;
    if ((catTab === "zanger" || catTab === "bo" || catTab === "all") && minZvr > 1.0 && (r.zvr ?? 0) < minZvr) return false;
    if (minRs > 0 && (r.rs ?? 0) < minRs) return false;
    if (minAdr != null && (r.adr ?? -1) < minAdr) return false;
    if (noHealth && isHealthcareItem({
      theme: r.theme || tickerLayer?.[r.ticker]?.theme,
      themeId: tickerLayer?.[r.ticker]?.themeId,
      layer: r.layer || tickerLayer?.[r.ticker]?.name,
      sector: stockMap?.[r.ticker]?.sector,
      industry: stockMap?.[r.ticker]?.industry,
    })) return false;
    if (epsOnly && (r.eps ?? 0) < 50) return false;
    if (cleanOnly && ((r.layerFlags?.length ? r.layerFlags : tickerLayer?.[r.ticker]?.flags) || []).some(([k]) => k === "distrib" || k === "exiting")) return false;
    return true;
  };
  const syncFilteredNoTheme = tabBaseRows.filter(passesSyncFilters);
  const syncFilteredRows = syncFilteredNoTheme.filter((r) => {
    if (excludedThemes.size > 0 && r.theme && excludedThemes.has(r.theme)) return false;
    if (themeFilter && r.theme !== themeFilter) return false;
    return true;
  });
  const count9M = tabBaseRows.filter(isRow9M).length;
  const countOrh = syncFilteredRows.filter(isRowOrh).length;
  const count30m = syncFilteredRows.filter(isRow30m).length;
  const countNear52w = tabBaseRows.filter(isRowNear52w).length;

  const filteredNoTheme = syncFilteredNoTheme.filter((r) => {
    if (onlyOrh && !isRowOrh(r)) return false;
    if (only30m && !isRow30m(r)) return false;
    return true;
  });

  // Cover 100% of themes with >= 1 row in the current filtered table (no lead/emerg or 12-pill cutoff),
  // sorted left-to-right by live Day Thrust descending.
  const topThemes = (() => {
    const themeMeta = new Map();
    for (const t of themes || []) {
      if (t?.theme) themeMeta.set(t.theme, t);
    }
    const buckets = new Map();
    for (const r of filteredNoTheme) {
      const name = r?.theme;
      if (!name || name === "—") continue;
      let b = buckets.get(name);
      if (!b) {
        b = { hits: 0, thrSum: 0, thrN: 0, chgSum: 0, chgN: 0 };
        buckets.set(name, b);
      }
      b.hits += 1;
      const sthr = stockThrust(r.chg, r.zvr, r.adr);
      if (sthr != null && Number.isFinite(sthr)) { b.thrSum += sthr; b.thrN += 1; }
      if (typeof r.chg === "number" && Number.isFinite(r.chg)) { b.chgSum += r.chg; b.chgN += 1; }
    }
    const out = [];
    for (const [name, b] of buckets.entries()) {
      const meta = themeMeta.get(name);
      if (meta) {
        const hasWarn = (meta.layers || []).some((l) => (l.flags || []).some(([k]) => k === "distrib" || k === "exiting"));
        out.push({ ...meta, hits: b.hits, hasWarn });
      } else {
        const fallbackThr = b.thrN > 0 ? Math.round((b.thrSum / b.thrN) * 10) / 10 : null;
        const fallbackToday = b.chgN > 0 ? Math.round((b.chgSum / b.chgN) * 100) / 100 : null;
        out.push({
          theme: name,
          themeId: `sec:${name}`,
          st: "lag",
          now: null,
          today: fallbackToday,
          dayFlow: { thrust: fallbackThr },
          hits: b.hits,
          hasWarn: false,
        });
      }
    }
    out.sort((a, b) => {
      const ta = a.dayFlow?.thrust;
      const tb = b.dayFlow?.thrust;
      if (ta != null && tb != null && tb !== ta) return tb - ta;
      if (ta == null && tb != null) return 1;
      if (ta != null && tb == null) return -1;
      return (b.today ?? -999) - (a.today ?? -999) || (b.hits ?? 0) - (a.hits ?? 0) || (b.now ?? -1) - (a.now ?? -1) || a.theme.localeCompare(b.theme);
    });
    return out;
  })();
  const visibleTopThemes = topThemes.filter((t) => !excludedThemes.has(t.theme));
  const extraThemeChip = themeFilter && !visibleTopThemes.some((t) => t.theme === themeFilter) ? themeFilter : null;

  // Multi-select/deselect theme picker list: all themes in the current table + any currently deselected themes
  const pickerThemes = (() => {
    const seen = new Set(topThemes.map((t) => t.theme));
    const extras = [];
    for (const name of excludedThemes) {
      if (!seen.has(name)) {
        extras.push({ theme: name, themeId: `ex:${name}`, st: "lag", hits: 0, dayFlow: { thrust: null } });
      }
    }
    extras.sort((a, b) => a.theme.localeCompare(b.theme));
    return [...topThemes, ...extras];
  })();
  const hiddenInTableCount = topThemes.filter((t) => excludedThemes.has(t.theme)).length;
  const selectedInTableCount = topThemes.length - hiddenInTableCount;
  const totalExcludedCount = excludedThemes.size;
  const filteredPickerThemes = themeSearch.trim()
    ? pickerThemes.filter((t) => t.theme.toLowerCase().includes(themeSearch.trim().toLowerCase()))
    : pickerThemes;

  const filteredRows = filteredNoTheme.filter((r) => {
    if (excludedThemes.size > 0 && r.theme && excludedThemes.has(r.theme)) return false;
    if (themeFilter && r.theme !== themeFilter) return false;
    return true;
  });

  const sortedMovers = [...filteredRows].sort((a, b) => {
    return cmpSort(a, b, moverSort, (r, k) => {
      if (k === "sig") {
        return (r.breakoutTypes?.length || 0) * 10
          + (isRow30m(r) ? 6 : 0)
          + (isRowOrh(r) ? 3 : 0)
          + (r.isNew ? 5 : 0)
          + (r.rsl ? 1 : 0);
      }
      if (k === "theme") return `${r.theme || ""} ${r.layer || ""}`;
      if (k === "thrust") return stockThrust(r.chg, r.zvr, r.adr);
      return r[k];
    });
  }).slice(0, 60);

  const filteredPortRows = portItems.filter((r) => {
    if (portFilter === "pf") return r.inPf ?? r.list === "PORT";
    if (portFilter === "wl") return r.inWl ?? r.list === "WATCH";
    if (portFilter === "flag") return r.inFlag ?? r.list === "FLAG";
    if (portFilter === "alerts") return (r.tags || []).length > 0;
    return true;
  });

  const sortedPortAlerts = [...filteredPortRows].sort((a, b) =>
    cmpSort(a, b, portSort, (r, k) => {
      if (k === "list") return r.list === "PORT" ? 0 : r.list === "WATCH" ? 1 : 2;
      if (k === "thrust") return stockThrust(r.chg, r.zvr, r.adr ?? stockMap?.[r.ticker]?.adr20 ?? stockMap?.[r.ticker]?.adr_pct);
      return r[k];
    })
  );

  const sortedFlow = [...(themeFlow.hottest || []), ...(themeFlow.coldest || [])].sort((a, b) =>
    cmpSort(a, b, flowSort, (r, k) => r[k], (r) => r.theme)
  );

  const showZvrFilter = catTab === "bo" || catTab === "zanger" || catTab === "all";
  const activeFilterCount =
    (showZvrFilter && minZvr > 1.0 ? 1 : 0) +
    (minRs > 0 ? 1 : 0) +
    (epsOnly ? 1 : 0) +
    (cleanOnly ? 1 : 0);
  const resetSecondaryFilters = () => {
    setMinZvr(1.0);
    setMinRs(0);
    setEpsOnly(false);
    setCleanOnly(false);
  };

  const EpCard = epMovers.length > 0 ? (
    <Card A={A} title="EP / Gap-and-Go Movers" sub="High-momentum catalyst gaps ≥ +3%">
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {epMovers.map((e) => (
          <div key={e.ticker} style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", borderBottom: `1px solid ${A.border}`, paddingBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, fontFamily: MONO, padding: "1px 5px", borderRadius: 4, background: e.category === "LAVA" ? "rgba(239,68,68,0.18)" : "rgba(245,158,11,0.18)", color: e.category === "LAVA" ? A.red : "#f59e0b" }}>
              {e.category}
            </span>
            <Tk t={e.ticker} />
            <span style={{ color: A.green, fontFamily: MONO, fontWeight: 700 }}>{fmtPct(e.chg, 1)}</span>
            {e.volume ? <span style={{ color: A.textMuted, fontFamily: MONO, fontSize: 10 }}>vol {fmtVol(e.volume)}</span> : null}
            {e.headline ? <span style={{ color: A.textDim }}>— {e.headline}</span> : null}
          </div>
        ))}
      </div>
    </Card>
  ) : null;

  return (
    <div>
      {/* Unified Market Breadth & Leadership Briefing */}
      <div id="sec-breadth" style={{ scrollMarginTop: 96 }}>
      <Card
        A={A}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>Market Breadth &amp; Leadership Briefing</span>
            {dec && (
              <span style={{ fontSize: 10, fontWeight: 800, fontFamily: MONO, padding: "2px 7px", borderRadius: 4, background: `${decColor}22`, border: `1px solid ${decColor}`, color: decColor }}>
                {dec}{mktScore != null ? ` · ${mktScore}/100` : ""}{posSize ? ` · ${posSize}` : ""}
              </span>
            )}
          </span>
        }
        right={picker}
      >
        {/* Merged Major Indexes Strip (SPY, QQQ, IWM, DIA, MDY, RSP — sparklines, MAs, dist days, CR%) */}
        {liveIndices.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {readyIndices.length > 0 && (
              <div style={{ fontSize: 11, color: A.textMuted, marginBottom: 6 }}>
                <strong style={{ color: A.text, fontFamily: MONO }}>{uptrendCount} of {readyIndices.length}</strong> major indexes in an uptrend (above rising 21e &gt; 50d &gt; 200d) · line = price, blue = 21e, dashed = 50d
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 8 }}>
              {liveIndices.map((idx) => {
                const s = idx.stats;
                const on = chartTicker === idx.ticker;
                const col = s ? idxToneC(s.tone) : A.border;
                const statCell = (label, v, tip) => (
                  <div key={label} title={tip}>
                    <div style={{ fontSize: 10, color: A.textMuted, letterSpacing: 0.3 }}>{label}</div>
                    <div style={{ fontSize: 11, fontFamily: MONO, fontVariantNumeric: "tabular-nums", color: pc(v) }}>{fmtPct(v, 1)}</div>
                  </div>
                );
                return (
                  <button
                    key={idx.ticker}
                    type="button"
                    className="tp-card-btn"
                    onClick={() => onTicker && onTicker(idx.ticker)}
                    style={{
                      textAlign: "left",
                      cursor: "pointer",
                      background: on ? A.bgHover : A.bg,
                      color: A.text,
                      borderStyle: "solid",
                      borderWidth: "1px 1px 1px 3px",
                      borderColor: `${on ? col : A.border} ${on ? col : A.border} ${on ? col : A.border} ${col}`,
                      borderRadius: 6,
                      padding: "7px 9px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontWeight: 800, fontFamily: MONO, fontSize: 13 }}>{idx.ticker}</span>
                      <span style={{ color: A.textMuted, fontSize: 10 }}>{idx.name}</span>
                      {s && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: col }}>{s.trend.toUpperCase()}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 2, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{typeof idx.price === "number" ? idx.price.toFixed(2) : "—"}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: pc(idx.change) }}>{fmtPct(idx.change, 2)}</span>
                      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 10 }}>
                        {idx.cr != null && <span style={{ color: idx.cr >= 70 ? A.green : idx.cr <= 30 ? A.red : A.textMuted }}>CR {idx.cr}%</span>}
                        {s && (
                          <span
                            style={{ color: s.dd >= 6 ? A.red : s.dd >= 4 ? A.yellow : A.textMuted, fontWeight: s.dd >= 4 ? 700 : 400 }}
                            title="Distribution days, last 25 sessions (down ≥ 0.2% on higher volume; drops off after a 5% rally)"
                          >
                            {s.dd} dist
                          </span>
                        )}
                      </span>
                    </div>
                    {s ? (
                      <>
                        <div style={{ margin: "4px 0" }}><IndexSpark s={s.spark} A={A} color={col} w={195} h={32} /></div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 }}>
                          {statCell("1W", s.w1)}
                          {statCell("1M", s.m1)}
                          {statCell("YTD", s.ytd)}
                          {statCell("OFF HI", s.off, "Off the 52-week high")}
                          {statCell("21E", s.v21, "Distance from the 21-day EMA")}
                          {statCell(`50D ${s.s50Rising ? "↗" : "↘"}`, s.v50, s.s50Rising ? "50-day rising" : "50-day falling")}
                          {statCell("200D", s.v200, "Distance from the 200-day")}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 10, color: A.textMuted, marginTop: 4 }}>
                        {idx.maStatus || "Loading index bars…"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Macro Cross-Asset & Breadth Pills (VIX, DXY, BTC, GOLD, SILVER, OIL, 10Y, >50MA, 4% Movers, T2108) */}
        {(macroPills.length > 0 || liveTnx || baseMkt.breadth?.pctAbove50 != null || (baseMkt.breadth?.up4 != null && baseMkt.breadth?.down4 != null) || baseMkt.breadth?.t2108 != null) && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8 }}>
            {macroPills.map((p) => {
              const active = chartTicker === p.chartTicker;
              const isPos = p.invertColor ? p.change <= 0 : p.change >= 0;
              const chgColor = p.change == null ? A.textMuted : isPos ? A.green : A.red;
              const pxStr = p.price == null
                ? null
                : p.price >= 1000
                  ? Math.round(p.price).toLocaleString()
                  : p.price.toFixed(2);
              const chgStr = p.change != null ? `${p.change > 0 ? "+" : ""}${p.change.toFixed(2)}%` : "—";
              return (
                <button
                  key={p.id}
                  type="button"
                  className="tp-card-btn"
                  onClick={() => onTicker && onTicker(p.chartTicker)}
                  title={p.tip}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    fontFamily: MONO,
                    fontVariantNumeric: "tabular-nums",
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: active ? `${p.accent}22` : A.bg,
                    border: `1px solid ${active ? p.accent : A.border}`,
                    color: A.text,
                    cursor: onTicker ? "pointer" : "default",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ color: p.accent, fontWeight: 800 }}>{p.label}</span>
                  {pxStr && <span style={{ color: A.textDim, fontWeight: 600 }}>{pxStr}</span>}
                  <span style={{ color: chgColor, fontWeight: 700 }}>{chgStr}</span>
                </button>
              );
            })}
            {liveTnx && (
              <button
                type="button"
                className="tp-card-btn"
                onClick={() => onTicker && onTicker("TLT")}
                title={`US 10-Year Treasury Yield${liveTnx.change != null ? ` (${fmtPct(liveTnx.change, 2)})` : ""} · click to chart TLT`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontFamily: MONO,
                  fontVariantNumeric: "tabular-nums",
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: chartTicker === "TLT" ? "rgba(167,139,250,0.16)" : A.bg,
                  border: `1px solid ${chartTicker === "TLT" ? "#a78bfa" : A.border}`,
                  color: A.text,
                  cursor: onTicker ? "pointer" : "default",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: "#a78bfa", fontWeight: 800 }}>10Y</span>
                <span style={{ color: A.text, fontWeight: 700 }}>{liveTnx.price.toFixed(2)}%</span>
              </button>
            )}
            {baseMkt.breadth?.pctAbove50 != null && (
              <span
                title="% of stocks trading above their 50-day moving average"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontFamily: MONO,
                  fontVariantNumeric: "tabular-nums",
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: A.bg,
                  border: `1px solid ${A.border}`,
                  color: A.text,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: A.textMuted, fontWeight: 700 }}>&gt;50MA</span>
                <span style={{ color: baseMkt.breadth.pctAbove50 >= 50 ? A.green : baseMkt.breadth.pctAbove50 <= 30 ? A.red : A.yellow, fontWeight: 700 }}>
                  {baseMkt.breadth.pctAbove50}%
                </span>
              </span>
            )}
            {baseMkt.breadth?.up4 != null && baseMkt.breadth?.down4 != null && (
              <button
                type="button"
                className="tp-pill"
                onClick={() => openBreadthChart("m4", 1)}
                title="Stockbee 4% daily movers (up 4%+ vs down 4%+) — click to view historical chart"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontFamily: MONO,
                  fontVariantNumeric: "tabular-nums",
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: A.bg,
                  border: `1px solid ${A.border}`,
                  color: A.textDim,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                <span style={{ color: A.textMuted, fontWeight: 700 }}>4% Movers</span>
                <span>
                  <strong style={{ color: A.green }}>{baseMkt.breadth.up4}↑</strong>
                  {" / "}
                  <strong style={{ color: A.red }}>{baseMkt.breadth.down4}↓</strong>
                </span>
              </button>
            )}
            {baseMkt.breadth?.t2108 != null && (
              <span
                title="T2108 (% of NYSE stocks above their 40-day MA)"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontFamily: MONO,
                  fontVariantNumeric: "tabular-nums",
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: A.bg,
                  border: `1px solid ${A.border}`,
                  color: A.text,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: A.textMuted, fontWeight: 700 }}>T2108</span>
                <span style={{ color: baseMkt.breadth.t2108 >= 60 ? A.green : baseMkt.breadth.t2108 <= 25 ? A.red : A.text, fontWeight: 700 }}>
                  {baseMkt.breadth.t2108}%
                </span>
              </span>
            )}
          </div>
        )}

        {/* Overnight Futures Strip */}
        {futures.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8, padding: "6px 8px", background: A.bg, border: `1px solid ${A.border}`, borderRadius: 6, fontSize: 10, fontFamily: MONO }}>
            <span style={{ color: A.textMuted, fontWeight: 700 }}>FUTURES:</span>
            {futures.map((f) => (
              <span key={f.name} style={{ color: A.textDim }}>
                <strong style={{ color: A.text }}>{f.name}</strong>{" "}
                <span style={{ color: pc(f.changePct), fontWeight: 700 }}>{fmtPct(f.changePct, 2)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Sector Rotation Strip */}
        {liveSectors && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: A.textDim, fontFamily: MONO, marginBottom: 6 }}>
            <span>
              Sectors <strong style={{ color: A.text }}>{liveSectors.positive}/{liveSectors.total}</strong> green
              {" · "}Top: <span style={{ color: A.green }}>{liveSectors.leaders.map((s) => `${s.ticker} ${fmtPct(s.change, 1)}`).join(", ")}</span>
              {" · "}Lag: <span style={{ color: A.red }}>{liveSectors.laggards.map((s) => `${s.ticker} ${fmtPct(s.change, 1)}`).join(", ")}</span>
            </span>
          </div>
        )}

        {/* Market Commentary Bullets */}
        {Array.isArray(baseMkt.commentary) && baseMkt.commentary.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11.5, color: A.text, lineHeight: 1.55 }}>
            {baseMkt.commentary.map((c, i) => <li key={i} style={{ marginBottom: 3 }}>{c}</li>)}
          </ul>
        )}

        {/* Embedded Market Breadth, Stages, Themes/Layers & Market Gate */}
        {breadthEmbedded}
      </Card>
      </div>

      {/* Portfolio & Watchlist Pulse + Upcoming 10d Earnings */}
      {(showPortPulse || portEarnings.length > 0) && (
        <div id="sec-portfolio" style={{ scrollMarginTop: 96, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
          {showPortPulse && (
            <Card
              A={A}
              title="Portfolio, Watchlist &amp; Flagged"
              sub={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {portAlerts.isLive && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        fontFamily: MONO,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: "rgba(34,197,94,0.14)",
                        border: `1px solid ${A.green}66`,
                        color: A.green,
                      }}
                    >
                      LIVE 60s
                    </span>
                  )}
                  <span>
                    {portAlerts.portfolioCount || 0} holdings / {portAlerts.watchlistCount || 0} watchlist / {portAlerts.flaggedCount || 0} flagged · {portAlerts.alerts?.length || 0} alerts
                  </span>
                </span>
              }
              right={sortedPortAlerts.length > 0 ? <CopyTickersBtn A={A} tickers={sortedPortAlerts.map((a) => a.ticker)} label="Copy" /> : null}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {[
                  ["all", "All", portItems.length, A.text],
                  ["pf", "PF", portAlerts.portfolioCount || 0, A.green],
                  ["wl", "WL", portAlerts.watchlistCount || 0, A.cyan],
                  ["flag", "Flagged", portAlerts.flaggedCount || 0, "#e3b341"],
                  ["alerts", "Alerts", portAlerts.alerts?.length || 0, "#f59e0b"],
                ].map(([k, lbl, cnt, accent]) => (
                  <button
                    key={k}
                    onClick={() => setPortFilter(k)}
                    style={chipStyle(portFilter === k, accent)}
                  >
                    {lbl} <span style={{ opacity: 0.75, fontFamily: MONO }}>{cnt}</span>
                  </button>
                ))}
              </div>
              {sortedPortAlerts.length === 0 ? (
                <div style={{ fontSize: 11, color: portFilter === "alerts" ? A.green : A.textMuted }}>
                  {portFilter === "alerts"
                    ? `✅ All ${portAlerts.portfolioCount || 0} holdings / ${portAlerts.watchlistCount || 0} watchlist / ${portAlerts.flaggedCount || 0} flagged quiet — no breakdowns or volume alerts.`
                    : "No tickers in this filter."}
                </div>
              ) : (
                <div style={{ overflowX: "auto", maxHeight: 340, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                      <tr>
                        {portTh("list", "List", "left", undefined, true)}
                        {portTh("ticker", "Ticker", "left", undefined, true)}
                        {portTh("chg", "Chg")}
                        {portTh("zvr", "ZVR")}
                        {portTh("thrust", "Thrust", "right", "ADR-adjusted Stock Thrust: (Chg% ÷ ADR%) × ZVR")}
                        {portTh("cr", "CR%")}
                        {portTh("rs", "RS")}
                        <th style={th(A)}>Alert</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPortAlerts.map((a) => {
                        const aAdr = a.adr ?? stockMap?.[a.ticker]?.adr20 ?? stockMap?.[a.ticker]?.adr_pct;
                        const thr = stockThrust(a.chg, a.zvr, aAdr);
                        const flagCol = flags?.[a.ticker]?.c ? flagHex(flags[a.ticker].c, A) : "#e3b341";
                        const listParts = [];
                        if (a.inPf || a.list === "PORT") listParts.push("PF");
                        if (a.inWl || a.list === "WATCH") listParts.push("WL");
                        if (a.inFlag || a.list === "FLAG") listParts.push("FLG");
                        const listLabel = listParts.join("·") || "—";
                        const listColor = (a.inPf || a.list === "PORT")
                          ? A.green
                          : (a.inWl || a.list === "WATCH")
                            ? A.cyan
                            : flagCol;
                        return (
                        <tr
                          key={a.ticker}
                          data-nav={a.ticker}
                          className="tp-click-row"
                          onClick={() => onTicker && onTicker(a.ticker)}
                          style={{
                            cursor: "pointer",
                            background: chartTicker === a.ticker ? A.bgHover : "transparent",
                            boxShadow: chartTicker === a.ticker ? `inset 2px 0 0 ${A.green}` : "none",
                          }}
                        >
                          <td style={{ ...td(A), fontSize: 10, fontFamily: MONO, fontWeight: 700, color: listColor, whiteSpace: "nowrap" }}>
                            {listLabel}
                          </td>
                          <td style={td(A)}>
                            <FlagButton t={a.ticker} A={A} />
                            <Tk t={a.ticker} />
                            <TierMark t={a.ticker} />
                          </td>
                          <td style={{ ...td(A, "right"), color: pc(a.chg), fontFamily: MONO, fontWeight: 700 }}>{fmtPct(a.chg, 2)}</td>
                          <td style={{ ...td(A, "right"), fontFamily: MONO, color: (a.zvr ?? 0) >= 1.5 ? A.green : A.textDim }}>{a.zvr != null ? `${a.zvr.toFixed(1)}x` : "—"}</td>
                          <td style={{ ...td(A, "right"), fontFamily: MONO, color: thr == null ? A.textMuted : thr > 0 ? A.green : thr < 0 ? A.red : A.textMuted, fontWeight: thr != null && Math.abs(thr) >= 1.5 ? 700 : 500 }}>{thr != null ? `${thr > 0 ? "+" : ""}${thr.toFixed(1)}` : "—"}</td>
                          <td style={{ ...td(A, "right"), fontFamily: MONO, color: a.cr == null ? A.textMuted : a.cr >= 70 ? A.green : a.cr <= 30 ? A.red : A.textDim }}>{a.cr != null ? `${a.cr}%` : "—"}</td>
                          <td style={{ ...td(A, "right"), fontFamily: MONO, fontWeight: 700, color: rsC(a.rs) }}>{a.rs ?? "—"}</td>
                          <td style={{ ...td(A), fontSize: 10 }}>
                            {(a.tags || []).length > 0 ? (
                              a.tags.map((t, i) => (
                                <span key={i} style={{ marginRight: 4, padding: "1px 5px", borderRadius: 4, fontWeight: 700, color: t.tone === "bad" ? A.red : t.tone === "warn" ? "#f59e0b" : A.green, background: A.bg, border: `1px solid ${A.border}` }}>
                                  {t.label}
                                </span>
                              ))
                            ) : (
                              <span style={{ color: A.textMuted }}>—</span>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          {portEarnings.length > 0 && (
            <Card A={A} title="Upcoming Earnings (PF / WL / Flagged · 10d)">
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {portEarnings.map((e) => (
                  <div key={e.ticker} style={{ fontSize: 11, display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${A.border}`, paddingBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO, color: e.list === "PORT" ? A.green : e.list === "WATCH" ? A.cyan : "#e3b341" }}>{e.list}</span>
                    <Tk t={e.ticker} />
                    <span style={{ color: A.textDim, fontFamily: MONO, marginLeft: "auto" }}>
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
      <div id="sec-breakouts" style={{ scrollMarginTop: 96 }}>
      <Card
        A={A}
        title="Breakouts & Intraday Volume Movers"
        sub={
          catTab === "ext"
            ? `Pre-market (${extMeta.pmCount}) & after-hours (${extMeta.ahCount}) · click any row to chart`
            : `${liveComputed?.isLive ? "Live 60s · " : ""}${baseFilter === "adr5liq" ? "Base: ADR 5%+ Liq · " : baseFilter === "core" ? "Base: >50d Leaders · " : "Entire universe · "}${sortedMovers.length} shown · click any row to chart`
        }
        right={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => applyGotoPreset()}
              title={`1-click Go-To screen (${gotoPreset.catTab === "all" ? "All Stocks" : gotoPreset.catTab} · ${gotoPreset.baseFilter === "all" ? "All Universe" : gotoPreset.baseFilter}${gotoPreset.onlyNear52w ? " · ≤15% 52wH" : ""}${gotoPreset.noHealth ? " · No Health" : ""}${gotoPreset.excludedThemes?.length ? ` · ${gotoPreset.excludedThemes.length} themes excluded` : ""}) · bookmark ?preset=goto`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: isGotoActive ? "rgba(251,191,36,0.18)" : "transparent",
                border: `1px solid ${isGotoActive ? "#fbbf24" : A.border}`,
                color: isGotoActive ? "#fbbf24" : A.textDim,
                borderRadius: 6,
                padding: "3px 8px",
                fontSize: 11,
                fontWeight: isGotoActive ? 800 : 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span>{gotoSavedToast ? "★ Go-To Saved ✓" : "★ Go-To"}</span>
            </button>
            {!isGotoActive && catTab !== "ext" && (
              <button
                type="button"
                onClick={saveCurrentAsGoto}
                title="Save your current tab & filters as your new ★ Go-To screen"
                style={{
                  background: "transparent",
                  border: `1px solid ${A.border}`,
                  color: A.textMuted,
                  borderRadius: 6,
                  padding: "3px 7px",
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Save Go-To
              </button>
            )}
            <CopyTickersBtn
              A={A}
              tickers={catTab === "ext" ? extMeta.tickers : sortedMovers.map((m) => m.ticker)}
              label="Copy Shown"
            />
          </div>
        }
      >
        {/* Category Tabs */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 7 }}>
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
                  fontWeight: active ? 700 : 600,
                  cursor: "pointer",
                }}
              >
                <span>{label}</span>
                <span style={{ opacity: 0.85, fontSize: 11, fontFamily: MONO }}>{catCounts[id]}</span>
              </button>
            );
          })}
        </div>

        {catTab === "ext" ? (
          <ExtHoursMovers
            A={A}
            pipeline={pipeline}
            stockMap={stockMap}
            tickerLayer={tickerLayer}
            onTicker={onTicker}
            chartTicker={chartTicker}
            onLayer={onLayer}
          />
        ) : (
        <>
        {/* Base Screen Filter Row (All Universe by default — no hidden base filter) */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginBottom: 7 }}>
          <span
            title="Optional base universe filter — defaults to All Universe (no base filter)"
            style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.5, marginRight: 2 }}
          >
            BASE
          </span>
          {BASE_FILTERS.map(([id, label, color, tip]) => {
            const active = baseFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => pickBaseFilter(id)}
                title={tip}
                style={{
                  ...chipStyle(active, color),
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span>{label}</span>
                <span style={{ opacity: 0.75, fontFamily: MONO, fontSize: 10 }}>{baseCounts[id]}</span>
              </button>
            );
          })}
        </div>
        {/* Leading & Emerging Themes Filter Strip (single-row horizontal scroll) */}
        {(visibleTopThemes.length > 0 || extraThemeChip) && (
          <div
            style={{
              display: "flex",
              flexWrap: "nowrap",
              alignItems: "center",
              gap: 5,
              overflowX: "auto",
              scrollbarWidth: "thin",
              marginBottom: 8,
              padding: "5px 8px",
              background: A.bg,
              border: `1px solid ${A.border}`,
              borderRadius: 6,
            }}
          >
            <span
              title="All themes with stocks in the current table, ordered left-to-right by live Day Thrust"
              style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.5, marginRight: 2, flexShrink: 0 }}
            >
              THEMES
            </span>
            <button onClick={() => setThemeFilter(null)} style={chipStyle(!themeFilter, A.green)}>All</button>
            {visibleTopThemes.map((t) => {
              const active = themeFilter === t.theme;
              const c = statusColor(t.st, A);
              const thr = t.dayFlow?.thrust;
              const thrTip = thr != null ? `Day Thrust ${thr > 0 ? "+" : ""}${thr.toFixed(1)}` : null;
              const rankTip = t.now != null ? `rank ${Math.round(t.now)}` : "sector";
              return (
                <button
                  key={t.themeId || t.theme}
                  onClick={() => setThemeFilter(active ? null : t.theme)}
                  title={`${t.theme} · ${[thrTip, rankTip].filter(Boolean).join(" · ")}${t.hasWarn ? " · contains layers with distrib/exiting flags" : ""}`}
                  style={chipStyle(active, c)}
                >
                  {t.theme}
                  <span style={{ opacity: 0.75, marginLeft: 4, fontFamily: MONO }}>{t.hits}</span>
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

        {/* Sub-filters: TYPE + 9M directly visible, secondary filters tucked behind Filters toggle */}
        <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${A.border}` }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            {showZvrFilter ? (
              <div style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4 }}>TYPE</span>
                <button onClick={() => setBoFilter(null)} style={chipStyle(!boFilter, A.green)}>All</button>
                {BO_KEYS.map((k) => {
                  const bm = BO_META[k];
                  return (
                    <button key={k} onClick={() => setBoFilter(boFilter === k ? null : k)} title={bm.tip} style={{ ...chipStyle(boFilter === k, bm.color), fontFamily: MONO, fontSize: 10.5 }}>
                      {bm.label} <span style={{ opacity: 0.75 }}>{boTypeCounts[k]}</span>
                    </button>
                  );
                })}
                <span style={{ color: A.border, fontSize: 10, userSelect: "none" }}>+</span>
                <button
                  onClick={() => setOnly9M((v) => !v)}
                  title="Secondary filter: ≥ 8.9M shares traded on the day (combines with ZNG / 4% / $BO / QMAG)"
                  style={{ ...chipStyle(only9M, "#f97316"), fontFamily: MONO, fontSize: 10.5 }}
                >
                  9M <span style={{ opacity: 0.75 }}>{count9M}</span>
                </button>
                <button
                  onClick={() => setOnlyOrh((v) => !v)}
                  title="30m Opening Range High breakout (price > 9:30–10:00 ET high) · combines with TYPE filters · row click opens 30m chart"
                  style={{ ...chipStyle(onlyOrh, "#22d3ee"), fontFamily: MONO, fontSize: 10.5 }}
                >
                  ORH <span style={{ opacity: 0.75 }}>{countOrh}</span>
                </button>
                <button
                  onClick={() => setOnly30m((v) => !v)}
                  title="Triggered 30-Minute Pivot (broke above last red 30m bar high, not stopped) · combines with TYPE filters · row click opens 30m chart"
                  style={{ ...chipStyle(only30m, "#10b981"), fontFamily: MONO, fontSize: 10.5 }}
                >
                  30m <span style={{ opacity: 0.75 }}>{count30m}</span>
                </button>
                <button
                  onClick={toggleNear52w}
                  title="Within 15% of 52-week high (off 52wH ≥ −15%) · combines with TYPE filters"
                  style={{ ...chipStyle(onlyNear52w, "#fbbf24"), fontFamily: MONO, fontSize: 10.5 }}
                >
                  ≤15% 52wH <span style={{ opacity: 0.75 }}>{countNear52w}</span>
                </button>
                {bars30Loading ? (
                  <span style={{ fontSize: 9.5, fontFamily: MONO, color: A.textMuted }}>
                    30m… ({pivot30Scan.scanned})
                  </span>
                ) : (onlyOrh || only30m) && pivot30Scan.total > pivot30Scan.scanned ? (
                  <span
                    title={`Checked 30m intraday bars for the top ${pivot30Scan.scanned} of ${pivot30Scan.total} matching stocks (ranked by live Thrust). Narrow BASE, ADR, or Themes to scan 100%.`}
                    style={{ fontSize: 9.5, fontFamily: MONO, color: A.textMuted }}
                  >
                    top {pivot30Scan.scanned}/{pivot30Scan.total} checked
                  </span>
                ) : null}
              </div>
            ) : (
              <div style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                <button
                  onClick={() => setOnly9M((v) => !v)}
                  title="Secondary filter: ≥ 8.9M shares traded on the day"
                  style={{ ...chipStyle(only9M, "#f97316"), fontFamily: MONO, fontSize: 10.5 }}
                >
                  9M <span style={{ opacity: 0.75 }}>{count9M}</span>
                </button>
                <button
                  onClick={() => setOnlyOrh((v) => !v)}
                  title="30m Opening Range High breakout (price > 9:30–10:00 ET high) · row click opens 30m chart"
                  style={{ ...chipStyle(onlyOrh, "#22d3ee"), fontFamily: MONO, fontSize: 10.5 }}
                >
                  ORH <span style={{ opacity: 0.75 }}>{countOrh}</span>
                </button>
                <button
                  onClick={() => setOnly30m((v) => !v)}
                  title="Triggered 30-Minute Pivot (broke above last red 30m bar high, not stopped) · row click opens 30m chart"
                  style={{ ...chipStyle(only30m, "#10b981"), fontFamily: MONO, fontSize: 10.5 }}
                >
                  30m <span style={{ opacity: 0.75 }}>{count30m}</span>
                </button>
                <button
                  onClick={toggleNear52w}
                  title="Within 15% of 52-week high (off 52wH ≥ −15%)"
                  style={{ ...chipStyle(onlyNear52w, "#fbbf24"), fontFamily: MONO, fontSize: 10.5 }}
                >
                  ≤15% 52wH <span style={{ opacity: 0.75 }}>{countNear52w}</span>
                </button>
                {bars30Loading ? (
                  <span style={{ fontSize: 9.5, fontFamily: MONO, color: A.textMuted }}>
                    30m… ({pivot30Scan.scanned})
                  </span>
                ) : (onlyOrh || only30m) && pivot30Scan.total > pivot30Scan.scanned ? (
                  <span
                    title={`Checked 30m intraday bars for the top ${pivot30Scan.scanned} of ${pivot30Scan.total} matching stocks (ranked by live Thrust). Narrow BASE, ADR, or Themes to scan 100%.`}
                    style={{ fontSize: 9.5, fontFamily: MONO, color: A.textMuted }}
                  >
                    top {pivot30Scan.scanned}/{pivot30Scan.total} checked
                  </span>
                ) : null}
              </div>
            )}
            <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={toggleNoHealth}
                title="Exclude all Healthcare stocks (Biotech, Pharma, MedTech, Providers, etc.)"
                style={chipStyle(noHealth, "#f472b6")}
              >
                No Health
              </button>
              <div ref={themesMenuRef} style={{ position: "relative", display: "inline-flex" }}>
                <button
                  type="button"
                  onClick={() => setThemesMenuOpen((v) => !v)}
                  aria-expanded={themesMenuOpen}
                  title="Select or deselect specific themes to include/exclude from this table"
                  style={chipStyle(themesMenuOpen || totalExcludedCount > 0, totalExcludedCount > 0 ? A.cyan : A.text)}
                >
                  Themes
                  {totalExcludedCount > 0 && (
                    <span style={{ fontFamily: MONO, fontSize: 10, marginLeft: 4 }}>
                      {topThemes.length > 0 && hiddenInTableCount > topThemes.length / 2
                        ? `${selectedInTableCount} on`
                        : `${totalExcludedCount} off`}
                    </span>
                  )}
                  {" "}{themesMenuOpen ? "▴" : "▾"}
                </button>
                {themesMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 5px)",
                      zIndex: 40,
                      width: 264,
                      background: A.bgCard,
                      border: `1px solid ${A.borderLight || A.border}`,
                      borderRadius: 8,
                      boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
                      padding: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                      <button
                        type="button"
                        onClick={() => saveExcludedThemes(new Set())}
                        style={{ ...chipStyle(totalExcludedCount === 0, A.green), fontSize: 10, padding: "2px 6px" }}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setThemeFilter(null);
                          saveExcludedThemes(new Set(pickerThemes.map((t) => t.theme)));
                        }}
                        style={{ ...chipStyle(topThemes.length > 0 && selectedInTableCount === 0, "#fb923c"), fontSize: 10, padding: "2px 6px" }}
                      >
                        None
                      </button>
                      <input
                        type="text"
                        value={themeSearch}
                        onChange={(e) => setThemeSearch(e.target.value)}
                        placeholder="Filter themes…"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          background: A.bg,
                          border: `1px solid ${A.border}`,
                          borderRadius: 5,
                          color: A.text,
                          fontSize: 10.5,
                          padding: "2px 6px",
                          outline: "none",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setThemesMenuOpen(false)}
                        title="Close"
                        style={{ background: "none", border: "none", color: A.textMuted, cursor: "pointer", fontSize: 11, padding: "0 2px" }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                      {filteredPickerThemes.length === 0 ? (
                        <div style={{ fontSize: 10.5, color: A.textMuted, padding: "6px 4px" }}>No matching themes.</div>
                      ) : (
                        filteredPickerThemes.map((t) => {
                          const checked = !excludedThemes.has(t.theme);
                          const c = statusColor(t.st, A);
                          const thr = t.dayFlow?.thrust;
                          return (
                            <label
                              key={t.themeId || t.theme}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "3px 5px",
                                borderRadius: 5,
                                cursor: "pointer",
                                fontSize: 11,
                                color: checked ? A.text : A.textMuted,
                                opacity: checked ? 1 : 0.6,
                                background: checked ? "transparent" : "rgba(255,255,255,0.02)",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleExcludedTheme(t.theme)}
                                style={{ margin: 0, accentColor: A.green, cursor: "pointer" }}
                              />
                              <span style={{ width: 6, height: 6, borderRadius: 3, background: c || A.textMuted, flexShrink: 0 }} />
                              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {t.theme}
                              </span>
                              {thr != null && (
                                <span style={{ fontFamily: MONO, fontSize: 9.5, color: thr >= 0 ? A.green : A.red, opacity: 0.85 }}>
                                  {thr > 0 ? "+" : ""}{thr.toFixed(1)}
                                </span>
                              )}
                              <span style={{ fontFamily: MONO, fontSize: 10, color: A.textMuted, minWidth: 16, textAlign: "right" }}>
                                {t.hits}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              <AdrFilter A={A} value={minAdr} onChange={setMinAdr} />
              {filtersOpen && activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetSecondaryFilters}
                  style={{
                    background: "none",
                    border: "none",
                    color: A.textMuted,
                    fontSize: 11,
                    fontWeight: 600,
                    textDecoration: "underline",
                    cursor: "pointer",
                    padding: "1px 4px",
                  }}
                >
                  Reset
                </button>
              )}
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
                title="Toggle ZVR, RS, EPS and Clean layers filters"
                style={chipStyle(filtersOpen || activeFilterCount > 0, activeFilterCount > 0 ? A.cyan : A.text)}
              >
                Filters{activeFilterCount > 0 ? <> · <span style={{ fontFamily: MONO }}>{activeFilterCount}</span></> : ""} {filtersOpen ? "▴" : "▾"}
              </button>
            </div>
          </div>

          {filtersOpen && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                marginTop: 7,
                padding: "6px 8px",
                background: A.bg,
                border: `1px solid ${A.border}`,
                borderRadius: 6,
              }}
            >
              {showZvrFilter && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4 }}>ZVR</span>
                  {[1.0, 1.5, 2.0, 2.5].map((v) => (
                    <button key={v} onClick={() => setMinZvr(v)} style={{ ...chipStyle(minZvr === v, "#fbbf24"), fontFamily: v === 1.0 ? undefined : MONO }}>{v === 1.0 ? "Any" : `≥${v.toFixed(1)}x`}</button>
                  ))}
                </div>
              )}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4 }}>RS</span>
                {[0, 70, 80, 90].map((v) => (
                  <button key={v} onClick={() => setMinRs(v)} style={{ ...chipStyle(minRs === v, A.cyan), fontFamily: v === 0 ? undefined : MONO }}>{v === 0 ? "Any" : `≥${v}`}</button>
                ))}
              </div>
              <button onClick={() => setEpsOnly((v) => !v)} style={chipStyle(epsOnly, A.green)} title="Require O'Neil EPS Rating ≥ 50">EPS ≥ 50</button>
              <button onClick={() => setCleanOnly((v) => !v)} style={chipStyle(cleanOnly, A.green)} title="Hide layers with distribution or exiting-leader warnings">Clean layers</button>
            </div>
          )}
        </div>

        {sortedMovers.length === 0 ? (
          <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 0" }}>
            No stocks match the current filters in this tab.
            {catTab !== "leaders" && (
              <>
                {" "}
                <button onClick={() => pickCatTab("leaders")} style={{ background: "none", border: "none", color: A.green, textDecoration: "underline", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                  View Core Leaders (<span style={{ fontFamily: MONO }}>{catCounts.leaders}</span>)
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
                  {moverTh("theme", "Theme", "left", "Theme & Layer", true)}
                  {moverTh("thrust", "Thr", "right", "ADR-adjusted Stock Thrust: (Chg% ÷ ADR%) × ZVR")}
                  {moverTh("adr", "ADR")}
                  {moverTh("chg", "Chg%")}
                  {moverTh("fromOpen", "Opn%", "right", "Intraday gain/loss from today's open")}
                  {moverTh("zvr", "ZVR", "right", "Zanger Volume Ratio vs 10-day intraday volume profile")}
                  {moverTh("cr", "CR", "right", "Closing Range — where price sits in today's low-to-high range")}
                  {moverTh("rs", "RS")}
                  {moverTh("eps", "EPS", "right", EPS_TIP)}
                  {moverTh("off52", "52wH", "right", "% off 52-week high")}
                  {(setPortfolio || setWatchlist) && (
                    <th style={{ ...th(A, "right"), padding: "5px 4px", fontSize: 10, letterSpacing: 0.25 }}>List</th>
                  )}
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
                  const p30 = pivot30ByTicker.get(m.ticker);
                  const rowOrh = p30?.openingRange?.status === "ORH_BO";
                  const row30m = p30?.pivot?.state === "TRIGGERED";
                  const open30m = (e) => {
                    e.stopPropagation();
                    onTicker && onTicker(m.ticker);
                    try { window.dispatchEvent(new CustomEvent("tp-chart-tf", { detail: "30m" })); } catch { /* ignore */ }
                  };
                  const orhTip = rowOrh && p30?.openingRange
                    ? `30m ORH Breakout · ORH $${p30.openingRange.orh.toFixed(2)} / ORL $${p30.openingRange.orl.toFixed(2)} — click to open 30m chart`
                    : "";
                  const p30Tip = row30m && p30?.pivot
                    ? `30m Pivot TRIGGERED · Entry $${p30.pivot.entry?.toFixed(2)} · Stop $${p30.pivot.stop?.toFixed(2)}${p30.pivot.riskPct != null ? ` (-${p30.pivot.riskPct.toFixed(1)}%)` : ""}${p30.pivot.target2R != null ? ` · +2R $${p30.pivot.target2R.toFixed(2)}` : ""}${p30.pivot.rMultipleNow != null ? ` · ${p30.pivot.rMultipleNow >= 0 ? "+" : ""}${p30.pivot.rMultipleNow.toFixed(1)}R` : ""} — click to open 30m chart`
                    : "";
                  return (
                  <tr
                    key={m.ticker}
                    data-nav={m.ticker}
                    className="tp-click-row"
                    onClick={() => {
                      onTicker && onTicker(m.ticker);
                      if (onlyOrh || only30m) {
                        try { window.dispatchEvent(new CustomEvent("tp-chart-tf", { detail: "30m" })); } catch { /* ignore */ }
                      }
                    }}
                    style={{
                      cursor: "pointer",
                      background: chartTicker === m.ticker ? A.bgHover : m.isNew ? "rgba(56,189,248,0.06)" : "transparent",
                      boxShadow: chartTicker === m.ticker ? `inset 2px 0 0 ${A.green}` : "none",
                    }}
                  >
                    <td style={mtd()}>
                      <span style={{ display: "inline-flex", gap: 2, flexWrap: "wrap", maxWidth: 92 }}>
                        {m.isNew && (
                          <span style={{ fontSize: 10, fontWeight: 800, fontFamily: MONO, padding: "1px 3px", lineHeight: 1.15, borderRadius: 3, background: "rgba(56,189,248,0.2)", color: A.cyan, border: `1px solid ${A.cyan}` }}>NEW</span>
                        )}
                        {m.breakoutTypes?.length ? m.breakoutTypes.map((k) => {
                          const c = BO_COLORS[k] || "#fbbf24";
                          const shortLabel = k === "ZANGER" ? "ZNG" : k;
                          return (
                            <span key={k} title={BO_META[k]?.tip || k} style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO, padding: "1px 3px", lineHeight: 1.15, borderRadius: 3, background: `${c}20`, color: c, border: `1px solid ${c}66` }}>{shortLabel}</span>
                          );
                        }) : (
                          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO, padding: "1px 3px", lineHeight: 1.15, borderRadius: 3, background: m.rsl ? "rgba(56,189,248,0.16)" : m.qualifiesZanger ? "rgba(34,197,94,0.16)" : "transparent", color: m.rsl ? A.cyan : m.qualifiesZanger ? A.green : A.textDim, border: m.rsl || m.qualifiesZanger ? "none" : `1px solid ${A.border}` }}>
                            {m.rsl ? "RSL" : m.qualifiesZanger ? "VOL" : m.inAdr5Liq ? "ADR5" : "LEAD"}
                          </span>
                        )}
                        {m.reclaim50 && (
                          <span
                            title="Reclaiming 50d SMA intraday (entered via ADR 5%+ Liquid base)"
                            style={{ fontSize: 9.5, fontWeight: 800, fontFamily: MONO, padding: "1px 3px", lineHeight: 1.15, borderRadius: 3, background: "rgba(34,197,94,0.18)", color: A.green, border: `1px solid ${A.green}80` }}
                          >
                            50d↑
                          </span>
                        )}
                        {!m.reclaim50 && m.below50 && (
                          <span
                            title="Below 50d SMA, above 200d SMA (entered via ADR 5%+ Liquid base)"
                            style={{ fontSize: 9.5, fontWeight: 700, fontFamily: MONO, padding: "1px 3px", lineHeight: 1.15, borderRadius: 3, background: "rgba(251,146,60,0.16)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.55)" }}
                          >
                            50d↓
                          </span>
                        )}
                        {isRow9M(m) && (
                          <span
                            title={`${fmtVol(getRowVol(m))} shares traded today (≥ 8.9M)`}
                            style={{ fontSize: 10, fontWeight: 800, fontFamily: MONO, padding: "1px 3px", lineHeight: 1.15, borderRadius: 3, background: "rgba(249,115,22,0.18)", color: "#f97316", border: "1px solid rgba(249,115,22,0.6)" }}
                          >
                            9M
                          </span>
                        )}
                        {row30m && (
                          <span
                            onClick={open30m}
                            title={p30Tip}
                            style={{ fontSize: 9.5, fontWeight: 800, fontFamily: MONO, padding: "1px 3px", lineHeight: 1.15, borderRadius: 3, background: "rgba(16,185,129,0.18)", color: "#10b981", border: "1px solid rgba(16,185,129,0.65)", cursor: "pointer" }}
                          >
                            30m
                          </span>
                        )}
                        {rowOrh && (
                          <span
                            onClick={open30m}
                            title={orhTip}
                            style={{ fontSize: 9.5, fontWeight: 800, fontFamily: MONO, padding: "1px 3px", lineHeight: 1.15, borderRadius: 3, background: "rgba(34,211,238,0.16)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.6)", cursor: "pointer" }}
                          >
                            ORH
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={mtd()}>
                      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <FlagButton t={m.ticker} A={A} />
                        <Tk t={m.ticker} />
                        {m.isBreakout ? (
                          <span
                            title={`🔥 Breakout (${(m.breakoutTypes || []).join(", ")})`}
                            style={{ fontSize: 10, lineHeight: 1, marginLeft: 1 }}
                          >
                            🔥
                          </span>
                        ) : m.qualifiesZanger ? (
                          <span
                            title="⚡ All Movers — ZVR ≥ 1.5x volume surge with strong close"
                            style={{ fontSize: 10, lineHeight: 1, marginLeft: 1 }}
                          >
                            ⚡
                          </span>
                        ) : null}
                        <TierMark t={m.ticker} />
                        <RslDot tip={m.rslTip} A={A} />
                        {m.inAdr5Liq && (
                          <span
                            title="💧 ADR 5%+ Liquid — Mkt cap > $100M · ADR > 5% · 10D vol > 500K · > 200d SMA · 1W $vol > $300M"
                            style={{ fontSize: 10, lineHeight: 1, marginLeft: 1 }}
                          >
                            💧
                          </span>
                        )}
                        {extMeta.tickerSet?.has(m.ticker) && (
                          <span
                            title="🌙 Pre/Postmarket Mover"
                            style={{ fontSize: 10, lineHeight: 1, marginLeft: 1 }}
                          >
                            🌙
                          </span>
                        )}
                        {m.earningsDays != null && m.earningsDays >= 0 && m.earningsDays <= 5 && (
                          <span title={m.earningsDisplay || ""} style={{ marginLeft: 2, fontSize: 10, fontWeight: 700, fontFamily: MONO, padding: "0 3px", borderRadius: 3, background: "rgba(245,158,11,0.18)", color: "#f59e0b" }}>
                            ER{m.earningsDays}d
                          </span>
                        )}
                      </div>
                      {company && (
                        <div title={company} style={{ fontSize: 10, color: A.textMuted, maxWidth: 92, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {company}
                        </div>
                      )}
                    </td>
                    <td style={mtd("left", { color: A.textDim })}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onLayer && onLayer(m.ticker); }}
                        title={layerTip}
                        style={{
                          display: "inline-flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 1,
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          margin: 0,
                          font: "inherit",
                          color: A.textDim,
                          cursor: onLayer ? "pointer" : "default",
                          textAlign: "left",
                          maxWidth: 108,
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%" }}>
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
                          <strong style={{ color: A.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.theme}
                          </strong>
                          {hasLayerWarn && (
                            <span style={{ color: "#f59e0b", fontSize: 11, lineHeight: 1, flexShrink: 0 }} aria-label="Layer warning">
                              ⚠
                            </span>
                          )}
                        </span>
                        {m.layer && (
                          <span style={{ fontSize: 10, color: A.textMuted, paddingLeft: 10, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.layer}
                          </span>
                        )}
                      </button>
                    </td>
                    {(() => {
                      const thr = stockThrust(m.chg, m.zvr, m.adr);
                      const thrTip = [
                        thr != null
                          ? `ADR-adjusted Thrust: (${fmtPct(m.chg, 2)} ÷ ${m.adr != null ? `${m.adr.toFixed(1)}%` : "4.0%"} ADR) × ${m.zvr.toFixed(2)}x = ${thr > 0 ? "+" : ""}${thr.toFixed(1)}`
                          : null,
                        m.score != null ? `Breakout score: ${m.score.toFixed(1)}` : null,
                      ].filter(Boolean).join(" · ");
                      return (
                        <td
                          title={thrTip || undefined}
                          style={mtd("right", {
                            fontFamily: MONO,
                            fontWeight: thr != null && Math.abs(thr) >= 1.5 ? 800 : 500,
                            color: thr == null ? A.textMuted : thr > 0 ? A.green : thr < 0 ? A.red : A.textMuted,
                            whiteSpace: "nowrap",
                          })}
                        >
                          {thr != null ? `${thr > 0 ? "+" : ""}${thr.toFixed(1)}` : "—"}
                        </td>
                      );
                    })()}
                    <td style={mtd("right", { fontFamily: MONO, color: (m.adr ?? 0) >= 4 ? A.cyan : A.textDim, whiteSpace: "nowrap" })}>{m.adr != null ? `${m.adr.toFixed(1)}%` : "—"}</td>
                    <td style={mtd("right", { fontFamily: MONO, fontWeight: 700, color: pc(m.chg), whiteSpace: "nowrap" })}>
                      {fmtPct(m.chg, 1)}
                      {m.dollarMove != null && m.dollarMove >= 0.9 && (
                        <span style={{ display: "block", fontSize: 10, fontWeight: 500, color: A.cyan }}>+${m.dollarMove.toFixed(2)}</span>
                      )}
                    </td>
                    <td style={mtd("right", { fontFamily: MONO, color: pc(m.fromOpen), whiteSpace: "nowrap" })}>
                      {fmtPct(m.fromOpen, 1)}
                    </td>
                    <td style={mtd("right")}><ZvrMeter zvr={m.zvr} A={A} /></td>
                    <td style={mtd("right")}><CrMeter cr={m.cr} A={A} /></td>
                    <td style={mtd("right", { fontFamily: MONO, fontWeight: 700, color: rsC(m.rs) })}>{m.rs}</td>
                    <td style={mtd("right", { fontFamily: MONO, color: epsC(m.eps), whiteSpace: "nowrap" })}>{m.eps ?? "—"}{m.epsAccel ? <span style={{ color: A.green, fontSize: 10 }}>▲</span> : null}</td>
                    <td style={mtd("right", { fontFamily: MONO, color: (m.off52 ?? -99) >= -5 ? A.green : A.textDim, whiteSpace: "nowrap" })}>{fmtPct(m.off52, 1)}</td>
                    {(setPortfolio || setWatchlist) && (
                      <td style={mtd("right")} onClick={(e) => e.stopPropagation()}>
                        <span style={{ display: "inline-flex", gap: 2 }}>
                          {setPortfolio && (
                            <button
                              title={inPf ? "Remove from Portfolio" : "Add to Portfolio"}
                              onClick={() => toggleList(m.ticker, "pf")}
                              style={{ background: inPf ? `${A.green}22` : "transparent", border: `1px solid ${inPf ? A.green : A.border}`, color: inPf ? A.green : A.textMuted, borderRadius: 3, padding: "1px 3px", fontSize: 10, fontFamily: MONO, fontWeight: inPf ? 700 : 500, cursor: "pointer" }}
                            >
                              PF
                            </button>
                          )}
                          {setWatchlist && (
                            <button
                              title={inWl ? "Remove from Watchlist" : "Add to Watchlist"}
                              onClick={() => toggleList(m.ticker, "wl")}
                              style={{ background: inWl ? `${A.cyan}22` : "transparent", border: `1px solid ${inWl ? A.cyan : A.border}`, color: inWl ? A.cyan : A.textMuted, borderRadius: 3, padding: "1px 3px", fontSize: 10, fontFamily: MONO, fontWeight: inWl ? 700 : 500, cursor: "pointer" }}
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
                    <Tk t={m.ticker} /> <span style={{ color: A.textMuted }}>({m.theme}, <span style={{ fontFamily: MONO }}>{fmtPct(m.chg)}</span>, ZVR <span style={{ fontFamily: MONO }}>{m.zvr != null ? `${m.zvr.toFixed(2)}x` : "—"}</span>):</span>{" "}
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
        </>
        )}
      </Card>
      </div>

      <div id="sec-followthrough" style={{ scrollMarginTop: 96 }}>
        <BreakoutFollowThroughCard
          A={A}
          index={index}
          quotes={quotes}
          stockMap={stockMap}
          liveOn={liveOn}
          onTicker={onTicker}
          chartTicker={chartTicker}
        />
      </div>

      {ph.id !== "premarket" && ph.id !== "open" && EpCard}

      {/* Consolidated Collapsible Additional Briefing Signals (Theme Flow + Leader Damage + On Deck RSL) */}
      <div
        style={{
          background: A.bgCard,
          border: `1px solid ${A.border}`,
          borderRadius: 8,
          padding: extrasOpen ? "10px 12px" : "8px 12px",
          marginBottom: 10,
        }}
      >
        <div
          role="button"
          tabIndex={0}
          aria-expanded={extrasOpen}
          onClick={toggleExtras}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExtras(); } }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", color: A.text }}>
              Additional Briefing Signals
            </span>
            <span style={{ fontSize: 11, color: A.textDim }}>
              Theme Flow{sortedFlow.length > 0 ? <> (<span style={{ fontFamily: MONO }}>{sortedFlow.length}</span>)</> : ""}
              {" · "}
              <span style={{ color: damagedLeaders.length > 0 ? A.red : A.green, fontWeight: damagedLeaders.length > 0 ? 700 : 500 }}>
                <span style={{ fontFamily: MONO }}>{damagedLeaders.length}</span> Damaged {damagedLeaders.length === 1 ? "Leader" : "Leaders"}
              </span>
              {" · "}
              <span style={{ color: onDeck.length > 0 ? A.cyan : A.textMuted }}>
                <span style={{ fontFamily: MONO }}>{onDeck.length}</span> On Deck RSL
              </span>
            </span>
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: A.textDim,
              border: `1px solid ${A.border}`,
              borderRadius: 6,
              padding: "2px 8px",
            }}
          >
            {extrasOpen ? "Collapse ▴" : "Expand ▾"}
          </span>
        </div>

        {extrasOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${A.border}` }}>
            {sortedFlow.length > 0 && (
              <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: A.text }}>Today&apos;s Theme Money Flow</div>
                  <div style={{ fontSize: 10, color: A.textMuted }}>Click a theme to filter movers above</div>
                </div>
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
                          className="tp-click-row"
                          onClick={() => setThemeFilter((cur) => (cur === t.theme ? null : t.theme))}
                          title={selected ? "Click to clear theme filter" : `Filter movers by ${t.theme}`}
                          style={{
                            cursor: "pointer",
                            background: selected ? A.bgHover : "transparent",
                            boxShadow: selected ? `inset 2px 0 0 ${A.cyan}` : "none",
                          }}
                        >
                          <td style={{ ...td(A), fontWeight: selected || !isCold ? 600 : 400, color: selected ? A.cyan : isCold ? A.textDim : A.text }}>{isCold ? `❄️ ${t.theme}` : t.theme}</td>
                          <td style={{ ...td(A, "right"), fontFamily: MONO, fontWeight: 700, color: pc(t.avgChg) }}>{fmtPct(t.avgChg, 2)}</td>
                          <td style={{ ...td(A, "right"), fontFamily: MONO, color: isCold ? A.textMuted : A.textDim }}>{t.pctGreen}%</td>
                          <td style={{ ...td(A, "right"), fontFamily: MONO, color: t.breakouts ? "#fbbf24" : A.textMuted }}>{t.breakouts || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: A.text }}>Leader Damage Watch</div>
                <div style={{ fontSize: 10, color: A.textMuted }}>RS 90+ leaders hit hard on volume</div>
              </div>
              {!damagedLeaders.length ? (
                <div style={{ fontSize: 11, color: A.green }}>✅ 0 RS 90+ leaders down ≥3% on heavy volume.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {damagedLeaders.map((d) => (
                    <div
                      key={d.ticker}
                      className="tp-click-row"
                      onClick={() => onTicker && onTicker(d.ticker)}
                      style={{
                        cursor: "pointer",
                        fontSize: 11,
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        borderBottom: `1px solid ${A.border}`,
                        padding: "4px 4px",
                        background: chartTicker === d.ticker ? A.bgHover : "transparent",
                        boxShadow: chartTicker === d.ticker ? `inset 2px 0 0 ${A.green}` : "none",
                      }}
                    >
                      <Tk t={d.ticker} />
                      <span style={{ color: A.textMuted, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.theme}</span>
                      <span style={{ marginLeft: "auto", fontFamily: MONO, fontWeight: 700, color: A.red }}>{fmtPct(d.chg, 2)}</span>
                      <span style={{ fontFamily: MONO, fontSize: 10, color: A.textDim }}>{d.zvr != null ? `${d.zvr.toFixed(1)}x` : "—"}</span>
                    </div>
                  ))}
                </div>
              )}
              {warnLayers.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 10, color: "#f59e0b" }}>
                  Distrib/Exiting: {warnLayers.slice(0, 4).map((l) => l.name).join(" · ")}
                </div>
              )}
            </div>

            {onDeck.length > 0 && (
              <div style={{ background: A.bg, border: `1px solid ${A.border}`, borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: A.text }}>On Deck (🔵 RSL Basing)</div>
                  <div style={{ fontSize: 10, color: A.textMuted }}>RS-line 52w highs consolidating</div>
                  <div style={{ marginLeft: "auto" }}><CopyTickersBtn A={A} tickers={onDeckTickers} label="Copy" /></div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {onDeck.map((r) => (
                    <div
                      key={r.ticker}
                      className="tp-click-row"
                      onClick={() => onTicker && onTicker(r.ticker)}
                      style={{
                        cursor: "pointer",
                        fontSize: 11,
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        borderBottom: `1px solid ${A.border}`,
                        padding: "4px 4px",
                        background: chartTicker === r.ticker ? A.bgHover : "transparent",
                        boxShadow: chartTicker === r.ticker ? `inset 2px 0 0 ${A.green}` : "none",
                      }}
                    >
                      <Tk t={r.ticker} />
                      <span style={{ color: A.textMuted, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.theme}</span>
                      <span style={{ marginLeft: "auto", fontFamily: MONO, color: A.green, fontWeight: 700 }}>RS {r.rs}</span>
                      <span style={{ fontFamily: MONO, fontSize: 10, color: A.textDim }}>{fmtPct(r.off52, 1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
