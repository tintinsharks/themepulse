import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "../utils.js";
import {
  AdrFilter,
  Card,
  CopyTickersBtn,
  EPS_TIP,
  FlagButton,
  LayerLink,
  MONO,
  RslDot,
  TierMark,
  fmtDollarVol,
  isHealthcareItem,
  rsLeads,
  stockThrust,
  td,
  th,
  useFlags,
  useRvolProfiles,
  useScanQuotes,
  zvrFor,
} from "./core.jsx";
import {
  ALL_SCANS,
  CLASSIC_SCANS,
  ELITE_RS_SCANS,
  SCAN_NOTES,
  evalScanHits,
} from "./scannerMath.js";
import { analyze30mPivot, score30mSetup } from "./pivot30mMath.js";

// ── Scanner: Elite RS + 30m Pivot + preset momentum & Stockbee scans ───────
const PIVOT30_SCAN = "pivot30";
const PIVOT30_ACCENT = "#fb923c";
const PIVOT30_MAX = 24;
const PIVOT30_REFRESH_MS = 120_000;
const PIVOT30_NOTE =
  "30m Pivot (DKS red-bar sequence + Opening Range + Floor Pivots) · top 24 liquid leaders · click any row to open its 30m chart";
const PIVOT30_UNIVERSES = [
  ["both", "Both"],
  ["elite", "Elite RS"],
  ["adr5liq", "ADR 5%+ Liquid"],
  ["topdv", "Top $Vol"],
  ["user", "Port · Watch · Flg"],
];
const VALID_PIVOT_UNIVERSES = new Set(PIVOT30_UNIVERSES.map(([k]) => k));

const VALID_SCANS = new Set([...ALL_SCANS.map(([k]) => k), PIVOT30_SCAN]);
const ELITE_IDS = new Set(ELITE_RS_SCANS.map(([k]) => k));

function normTicker(x) {
  const raw = typeof x === "string" ? x : x?.ticker ?? x?.t ?? "";
  return String(raw).trim().toUpperCase();
}

function defaultSortFor(k) {
  if (k === PIVOT30_SCAN) return { k: "score", d: -1 };
  if (k === "s20") return { k: "ago", d: 1 };
  return { k: "thrust", d: -1 };
}

function toneHex(tone, A) {
  if (tone === "green" || tone === "bull" || tone === "positive") return A.green;
  if (tone === "amber" || tone === "yellow" || tone === "warn") return "#fbbf24";
  if (tone === "cyan" || tone === "blue" || tone === "info") return A.cyan || "#38bdf8";
  if (tone === "red" || tone === "bear" || tone === "negative") return A.red;
  return A.textMuted;
}

function orMeta(openingRange, A) {
  if (!openingRange) return null;
  const st = String(openingRange.status || "").toUpperCase();
  if (st === "ORH_BO") return { label: "ORH BO", color: A.green, rank: 5 };
  if (st === "FAILED_LOW") return { label: "FAILED LO", color: A.cyan || "#38bdf8", rank: 4 };
  if (st === "INSIDE") return { label: "INSIDE", color: A.textDim, rank: 3 };
  if (st === "FAILED_HIGH") return { label: "FAILED HI", color: "#fbbf24", rank: 2 };
  if (st === "ORL_BD") return { label: "ORL BD", color: A.red, rank: 1 };
  return openingRange.label ? { label: openingRange.label, color: A.textDim, rank: 3 } : null;
}

function fmtPx(v) {
  return v == null || !Number.isFinite(v) ? "—" : `$${v.toFixed(2)}`;
}

function fmtRisk(v) {
  return v == null || !Number.isFinite(v) ? "—" : `-${Math.abs(v).toFixed(1)}%`;
}

function ScannerPanel({
  A,
  stockMap,
  onTicker,
  chartTicker,
  tickerLayer,
  onLayer,
  indexQuotes,
  portfolio = [],
  watchlist = [],
}) {
  const [scan, setScan] = useState(() => {
    try {
      const saved = localStorage.getItem("tp-scan-tab");
      if (VALID_SCANS.has(saved)) return saved;
    } catch { /* ignore */ }
    return "bluedot";
  });
  const [sort, setSort] = useState(() => {
    try {
      const saved = localStorage.getItem("tp-scan-tab");
      if (VALID_SCANS.has(saved)) return defaultSortFor(saved);
    } catch { /* ignore */ }
    return defaultSortFor("bluedot");
  });
  const [minAdr, setMinAdr] = useState(null);
  const [noHealth, setNoHealth] = useState(() => {
    try { return (localStorage.getItem("tp-no-health") ?? localStorage.getItem("tp-no-bio")) === "1"; } catch { return false; }
  });

  // 30m Pivot tab state
  const [pivotUniverse, setPivotUniverse] = useState(() => {
    try {
      const saved = localStorage.getItem("tp-pivot30-univ");
      if (VALID_PIVOT_UNIVERSES.has(saved)) return saved;
    } catch { /* ignore */ }
    return "both";
  });
  const pickPivotUniverse = (k) => {
    setPivotUniverse(k);
    try { localStorage.setItem("tp-pivot30-univ", k); } catch { /* ignore */ }
  };
  const [actionableOnly, setActionableOnly] = useState(true);
  const [pivotBars, setPivotBars] = useState({});
  const [pivotLoading, setPivotLoading] = useState(false);
  const [pivotErr, setPivotErr] = useState(null);
  const [pivotUpdatedAt, setPivotUpdatedAt] = useState(null);
  const [pivotNonce, setPivotNonce] = useState(0);

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

  const pick = (k) => {
    setScan(k);
    setSort(defaultSortFor(k));
    try { localStorage.setItem("tp-scan-tab", k); } catch { /* ignore */ }
  };

  const profiles = useRvolProfiles();
  const flags = useFlags();

  const passesFilters = useCallback((s) => {
    if (!s?.ticker) return false;
    const L = tickerLayer?.[s.ticker];
    if (noHealth && isHealthcareItem({
      theme: L?.theme,
      themeId: L?.themeId,
      layer: L?.name,
      sector: s.sector,
      industry: s.industry,
    })) return false;
    if (minAdr != null) {
      const adr = s.adr20 ?? s.adr_pct ?? -1;
      if (adr < minAdr) return false;
    }
    return true;
  }, [tickerLayer, noHealth, minAdr]);

  // User universe (Portfolio + Watchlist + Flagged)
  const { userTickers, pfSet, wlSet } = useMemo(() => {
    const pf = new Set();
    const wl = new Set();
    const seen = new Set();
    const out = [];
    const push = (t, bucket) => {
      const sym = normTicker(t);
      if (!sym) return;
      if (bucket) bucket.add(sym);
      if (!seen.has(sym)) {
        seen.add(sym);
        out.push(sym);
      }
    };
    (portfolio || []).forEach((t) => push(t, pf));
    (watchlist || []).forEach((t) => push(t, wl));
    Object.entries(flags || {})
      .filter(([, v]) => v?.c)
      .map(([t]) => normTicker(t))
      .filter(Boolean)
      .sort()
      .forEach((t) => push(t, null));
    return { userTickers: out, pfSet: pf, wlSet: wl };
  }, [portfolio, watchlist, flags]);

  // Top liquid Elite RS leaders (RS >= 90, avg $vol >= $20M, passes No Health & ADR filters)
  const elitePivotCandidates = useMemo(() => {
    const arr = [];
    Object.values(stockMap || {}).forEach((s) => {
      if (!passesFilters(s)) return;
      const rs = s.rs_rank ?? 0;
      const adv = s.avg_dollar_vol_raw ?? 0;
      if (rs < 90 || adv < 20e6) return;
      const rvol = s.rel_volume > 0 ? s.rel_volume : null;
      const thr = stockThrust(s.change_pct, rvol, s.adr20 ?? s.adr_pct);
      arr.push({ t: s.ticker, thr, rs });
    });
    arr.sort((a, b) => (b.thr ?? -999) - (a.thr ?? -999) || b.rs - a.rs || a.t.localeCompare(b.t));
    return arr.slice(0, PIVOT30_MAX).map((x) => x.t);
  }, [stockMap, passesFilters]);

  // Top ADR 5%+ Liquid screen hits (Mkt cap > $100M, ADR > 5%, 10D vol > 500K, > 200d SMA, 1W $vol > $300M)
  const adr5LiqPivotCandidates = useMemo(() => {
    const arr = [];
    Object.values(stockMap || {}).forEach((s) => {
      if (!passesFilters(s)) return;
      if (!evalScanHits(s, null, null)?.adr5liq) return;
      const rs = s.rs_rank ?? 0;
      const rvol = s.rel_volume > 0 ? s.rel_volume : null;
      const thr = stockThrust(s.change_pct, rvol, s.adr20 ?? s.adr_pct);
      arr.push({ t: s.ticker, thr, rs });
    });
    arr.sort((a, b) => (b.thr ?? -999) - (a.thr ?? -999) || b.rs - a.rs || a.t.localeCompare(b.t));
    return arr.slice(0, PIVOT30_MAX).map((x) => x.t);
  }, [stockMap, passesFilters]);

  // Top 24 highest daily $ volume stocks (mega-cap & institutional liquid bounce/reclaim plays like NVDA, TSLA, META)
  const topDvPivotCandidates = useMemo(() => {
    const arr = [];
    Object.values(stockMap || {}).forEach((s) => {
      if (!passesFilters(s)) return;
      const adv = s.avg_dollar_vol_raw ?? 0;
      if (adv < 100e6) return;
      arr.push({ t: s.ticker, adv });
    });
    arr.sort((a, b) => b.adv - a.adv || a.t.localeCompare(b.t));
    return arr.slice(0, PIVOT30_MAX).map((x) => x.t);
  }, [stockMap, passesFilters]);

  // Capped 24-ticker candidate list for 30m Pivot batch scan
  const pivotCandidates = useMemo(() => {
    if (pivotUniverse === "user") return userTickers.slice(0, PIVOT30_MAX);
    if (pivotUniverse === "elite") return elitePivotCandidates.slice(0, PIVOT30_MAX);
    if (pivotUniverse === "adr5liq") return adr5LiqPivotCandidates.slice(0, PIVOT30_MAX);
    if (pivotUniverse === "topdv") return topDvPivotCandidates.slice(0, PIVOT30_MAX);
    const seen = new Set();
    const out = [];
    for (const t of userTickers) {
      if (out.length >= PIVOT30_MAX) break;
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    for (const t of elitePivotCandidates) {
      if (out.length >= PIVOT30_MAX) break;
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }, [pivotUniverse, userTickers, elitePivotCandidates, adr5LiqPivotCandidates, topDvPivotCandidates]);

  const pivotCandidatesKey = pivotCandidates.join(",");

  // Fetch 30m OHLC bars in a single batch call while 30m Pivot tab is active
  useEffect(() => {
    if (scan !== PIVOT30_SCAN) return undefined;
    if (!pivotCandidatesKey) {
      setPivotBars({});
      setPivotErr(null);
      setPivotLoading(false);
      return undefined;
    }
    const ac = new AbortController();
    setPivotLoading(true);
    setPivotErr(null);
    authFetch(`/api/ohlc?tickers=${encodeURIComponent(pivotCandidatesKey)}&interval=30m`, {
      cache: "no-store",
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (ac.signal.aborted) return;
        if (!d?.ok || !d?.items) {
          setPivotErr(d?.error || "30m data unavailable");
          return;
        }
        setPivotBars(d.items);
        setPivotUpdatedAt(new Date());
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setPivotErr(err?.message || "Failed to load 30m bars");
      })
      .finally(() => {
        if (!ac.signal.aborted) setPivotLoading(false);
      });
    return () => ac.abort();
  }, [scan, pivotCandidatesKey, pivotNonce]);

  // Auto-refresh every 2 minutes while 30m Pivot tab is active
  useEffect(() => {
    if (scan !== PIVOT30_SCAN) return undefined;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setPivotNonce((n) => n + 1);
    }, PIVOT30_REFRESH_MS);
    return () => clearInterval(id);
  }, [scan]);

  // Pass 1 on pipeline data (cheap) to know which names to quote live
  const pre = useMemo(() => {
    const m = {};
    Object.values(stockMap || {}).forEach((s) => {
      if (s?.ticker) {
        const h = evalScanHits(s, null, null);
        if (h) m[s.ticker] = h;
      }
    });
    return m;
  }, [stockMap]);

  // Quote all hits for active scan + widened live candidate nets for all 5 Elite RS scans
  // (plus antic/hot) so names crossing 50d/8w/20EMA or rallying into 52wH bands enter live every 60s.
  const live = useMemo(() => {
    if (scan === PIVOT30_SCAN) return pivotCandidates;
    const set = new Set();
    for (const [t, h] of Object.entries(pre)) {
      if (h[scan]) { set.add(t); continue; }
      const s = stockMap?.[t];
      if (!s) continue;
      const adv = s.avg_dollar_vol_raw ?? 0;
      const rs = s.rs_rank ?? 0;
      const s50 = s.sma50_pct ?? -99;
      const off = s.off_52w_high ?? s.pct_from_high ?? -99;
      if (scan === "rs95" && rs >= 95 && adv >= 20e6 && s50 >= -5) set.add(t);
      else if (scan === "bluedot" && rs >= 90 && adv >= 20e6 && (s.rs_line_new_high || (s.rsl_hi_ago != null && s.rsl_hi_ago <= 5) || rsLeads(s)) && s50 >= -5 && off >= -22) set.add(t);
      else if (scan === "resil" && rs >= 90 && adv >= 20e6 && s.ma8w_rising && off >= -16 && (s.pct_from_8w ?? -99) >= -5) set.add(t);
      else if (scan === "rsvol" && rs >= 90 && adv >= 20e6 && s50 >= -4 && off >= -18) set.add(t);
      else if (scan === "grnred" && rs >= 85 && adv >= 20e6 && s50 >= -4 && off >= -20) set.add(t);
      else if (scan === "antic" && (s.ti65 ?? 0) >= 1.05) set.add(t);
      else if (scan === "hot" && (s.return_1m ?? 0) > 30) set.add(t);
      else if (
        scan === "adr5liq" &&
        (s.market_cap_raw ?? 0) > 100e6 &&
        (s.adr20 ?? s.adr_pct ?? 0) > 5 &&
        (s.avg_vol_10d ?? s.avg_volume_raw ?? 0) > 500e3 &&
        (s.sma200_pct ?? -99) >= -4
      ) set.add(t);
    }
    return [...set];
  }, [pre, scan, stockMap, pivotCandidates]);

  const { quotes, at } = useScanQuotes(live, true);

  const counts = useMemo(() => {
    const n = {};
    ALL_SCANS.forEach(([k]) => { n[k] = 0; });
    Object.entries(pre).forEach(([t, h]) => {
      const s = stockMap?.[t];
      if (!passesFilters(s)) return;
      const q = quotes.get(t);
      const zvr = q ? (zvrFor(s, q, profiles) ?? (s.rel_volume > 0 ? +s.rel_volume.toFixed(2) : null)) : null;
      const hh = q ? (evalScanHits(s, q, zvr) || h) : h;
      ALL_SCANS.forEach(([k]) => { if (hh[k]) n[k]++; });
    });
    return n;
  }, [pre, quotes, stockMap, profiles, passesFilters]);

  const rows = useMemo(() => {
    if (scan === PIVOT30_SCAN) return [];
    const out = [];
    Object.values(stockMap || {}).forEach((s) => {
      if (!passesFilters(s)) return;
      const q = quotes.get(s.ticker);
      const zvr = zvrFor(s, q, profiles) ?? (s.rel_volume > 0 ? +s.rel_volume.toFixed(2) : null);
      const h = evalScanHits(s, q, zvr);
      if (!h?.[scan]) return;
      const L = tickerLayer?.[s.ticker];
      const px = q?.rthPrice ?? q?.price ?? s.close;
      const chg = q?.change ?? s.change_pct ?? null;
      const thrust = stockThrust(chg, zvr, s.adr20 ?? s.adr_pct);
      const hi52 = Math.max(s.hi52_lvl || 0, q?.yearHigh || 0) || null;
      const off = hi52 && px ? ((px / hi52) - 1) * 100 : (s.off_52w_high ?? s.pct_from_high);
      const liveVol = q?.volume > 0 ? q.volume : null;
      const avgDv = s.avg_dollar_vol_raw || (s.avg_volume_raw && px ? s.avg_volume_raw * px : null);
      const dv = liveVol && px ? liveVol * px : avgDv;
      const ma8wLvl = s.ma8w_lvl ?? (s.close > 0 && s.pct_from_8w != null ? s.close / (1 + s.pct_from_8w / 100) : null);
      const p8w = ma8wLvl && px ? ((px / ma8wLvl) - 1) * 100 : (s.pct_from_8w ?? null);
      out.push({
        t: s.ticker,
        company: s.company || "",
        tag: typeof h[scan] === "string" ? h[scan] : null,
        px,
        dv,
        avgDv,
        er: s.earnings_days ?? null,
        erTip: s.earnings_display || "",
        chg,
        zvr,
        thrust,
        r1w: s.return_1w,
        r1m: s.return_1m,
        r3m: s.return_3m,
        r6m: s.return_6m,
        adr: s.adr20 ?? s.adr_pct,
        adr5: s.adr5,
        off,
        rs: s.rs_rank,
        eps: s.eps_rating ?? null,
        epsTip: s.eps_tip,
        epsAcc: s.eps_accel,
        burst: s.burst20_pct,
        ago: s.burst20_ago,
        pb: s.burst20_pullback,
        ti65: s.ti65,
        rsl: rsLeads(s),
        rslAgo: s.rsl_hi_ago ?? null,
        p8w,
        pp30: s.pp_count_30d ?? null,
        udv: s.udv20 ?? null,
        layer: L?.name || s.industry || "",
        layerSt: L?.st,
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
  }, [stockMap, quotes, profiles, scan, sort, tickerLayer, passesFilters]);

  // Evaluated 30m Pivot rows
  const pivotAllRows = useMemo(() => {
    if (scan !== PIVOT30_SCAN) return [];
    const out = pivotCandidates.map((t) => {
      const s = stockMap?.[t] || null;
      const L = tickerLayer?.[t];
      const q = quotes.get(t);
      const bars = pivotBars?.[t];
      const px = q?.rthPrice ?? q?.price ?? s?.close ?? null;
      const chg = q?.change ?? s?.change_pct ?? null;
      const zvr = s
        ? (zvrFor(s, q, profiles) ?? (s.rel_volume > 0 ? +s.rel_volume.toFixed(2) : null))
        : null;
      const thrust = stockThrust(chg, zvr, s?.adr20 ?? s?.adr_pct);
      const liveVol = q?.volume > 0 ? q.volume : null;
      const avgDv = s?.avg_dollar_vol_raw || (s?.avg_volume_raw && px ? s.avg_volume_raw * px : null);
      const dv = liveVol && px ? liveVol * px : avgDv;

      const analysis = Array.isArray(bars) && bars.length
        ? analyze30mPivot(bars, { livePrice: px })
        : null;
      const scored = analysis?.ok
        ? score30mSetup(analysis, s || { ticker: t })
        : { score: -1, badge: "NO DATA", tone: "muted", actionable: false };
      const pv = analysis?.pivot || null;
      const or = analysis?.openingRange || null;
      const orInfo = orMeta(or, A);
      const fp = analysis?.floorPivots || null;

      return {
        t,
        srcTag: pfSet.has(t) ? "P" : wlSet.has(t) ? "W" : null,
        score: scored?.score ?? -1,
        actionable: Boolean(scored?.actionable),
        badge: scored?.badge || pv?.shortLabel || "WATCH",
        tone: scored?.tone || pv?.tone || "muted",
        state: pv?.state || null,
        redCount: pv?.redCount ?? 0,
        entry: pv?.entry ?? null,
        stop: pv?.stop ?? null,
        riskPct: pv?.riskPct ?? null,
        target2R: pv?.target2R ?? null,
        rMultipleNow: pv?.rMultipleNow ?? null,
        distToEntryPct: pv?.distToEntryPct ?? null,
        orInfo,
        orRank: orInfo?.rank ?? null,
        orh: or?.orh ?? null,
        orl: or?.orl ?? null,
        fp,
        summary: analysis?.summary || "",
        px: px ?? analysis?.lastPrice ?? null,
        chg,
        zvr,
        thrust,
        rs: s?.rs_rank ?? null,
        dv,
        avgDv,
        er: s?.earnings_days ?? null,
        erTip: s?.earnings_display || "",
        rsl: s ? rsLeads(s) : null,
        layer: L?.name || s?.industry || "",
        layerSt: L?.st,
      };
    });

    const { k, d } = sort;
    out.sort((x, y) => {
      const a = x[k], b = y[k];
      if (a == null && b == null) return (y.score - x.score) || x.t.localeCompare(y.t);
      if (a == null) return 1;
      if (b == null) return -1;
      if (typeof a === "string" || typeof b === "string") {
        const cmp = String(a).localeCompare(String(b)) * d;
        return cmp || (y.score - x.score) || x.t.localeCompare(y.t);
      }
      return (a - b) * d || (y.score - x.score) || ((y.thrust ?? -999) - (x.thrust ?? -999)) || x.t.localeCompare(y.t);
    });
    return out;
  }, [scan, pivotCandidates, stockMap, tickerLayer, quotes, pivotBars, profiles, A, pfSet, wlSet, sort]);

  const pivotActionableRows = useMemo(
    () => pivotAllRows.filter((r) => r.actionable),
    [pivotAllRows]
  );

  const pivotShowingFallback =
    scan === PIVOT30_SCAN &&
    actionableOnly &&
    pivotActionableRows.length === 0 &&
    pivotAllRows.length > 0;

  const pivotDisplayRows = useMemo(() => {
    if (scan !== PIVOT30_SCAN) return [];
    if (actionableOnly && pivotActionableRows.length > 0) return pivotActionableRows;
    return pivotAllRows;
  }, [scan, actionableOnly, pivotActionableRows, pivotAllRows]);

  const copyTickers = useMemo(
    () => (scan === PIVOT30_SCAN ? pivotDisplayRows : rows).map((r) => r.t),
    [scan, pivotDisplayRows, rows]
  );

  const spyChg = indexQuotes?.SPY?.change ?? stockMap?.SPY?.change_pct ?? null;
  const qqqChg = indexQuotes?.QQQ?.change ?? stockMap?.QQQ?.change_pct ?? null;
  const spyOff = stockMap?.SPY?.off_52w_high ?? null;
  const qqqOff = stockMap?.QQQ?.off_52w_high ?? null;
  const redTape = (spyChg != null && spyChg < 0) || (qqqChg != null && qqqChg < 0);

  const col = (k, label, title, align = "right") => (
    <th
      key={k}
      style={{
        ...th(A, align),
        padding: "5px 5px",
        fontSize: 10,
        cursor: "pointer",
        userSelect: "none",
        color: sort.k === k ? A.text : A.textMuted,
      }}
      title={title}
      onClick={() =>
        setSort((p) => ({
          k,
          d: p.k === k ? -p.d : (k === "ago" || k === "rslAgo" || k === "er" || k === "t" || k === "layer" || k === "riskPct" ? 1 : -1),
        }))
      }
    >
      {label}{sort.k === k ? (sort.d < 0 ? "▼" : "▲") : ""}
    </th>
  );
  const std = (align = "left", extra) => ({ ...td(A, align), padding: "5px 5px", fontSize: 11, ...extra });
  const pct = (v, dg = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dg)}%`);
  const pc = (v) => (v == null ? A.textMuted : v >= 0 ? A.green : A.red);

  const extra = scan === "s20"
    ? [["burst", "Burst", "5d burst %", (r) => pct(r.burst)], ["ago", "Ago", "Sessions since burst", (r) => r.ago ?? "—"], ["pb", "PB", "Pullback from burst high", (r) => pct(r.pb)]]
    : scan === "antic"
      ? [["ti65", "TI65", "7d ÷ 65d close ratio", (r) => (r.ti65 == null ? "—" : r.ti65.toFixed(2))]]
      : scan === "hot"
        ? [["adr5", "Vol 1W", "5d average daily range", (r) => (r.adr5 == null ? "—" : `${r.adr5.toFixed(1)}%`)]]
        : scan === "bluedot"
          ? [["rslAgo", "RSL", "Sessions since RS line 52w high", (r) => (r.rslAgo != null ? `${r.rslAgo}d` : "NH")], ["pp30", "PP30", "Pocket pivots in last 30 sessions", (r) => r.pp30 ?? "—"]]
          : scan === "resil"
            ? [["p8w", "vs 8w", "% above rising 8-week MA", (r) => pct(r.p8w)], ["pp30", "PP30", "Pocket pivots in last 30 sessions", (r) => r.pp30 ?? "—"]]
            : ELITE_IDS.has(scan)
              ? [["pp30", "PP30", "Pocket pivots in last 30 sessions", (r) => r.pp30 ?? "—"], ["udv", "U/D", "20-day up/down volume ratio", (r) => (r.udv != null ? `${r.udv.toFixed(1)}×` : "—")]]
              : [];

  const onPivotRowClick = (ticker) => {
    onTicker(ticker);
    try {
      window.dispatchEvent(new CustomEvent("tp-chart-tf", { detail: "30m" }));
    } catch { /* ignore */ }
  };

  const pivotPillActive = scan === PIVOT30_SCAN;
  const pivotPillCount = pivotUpdatedAt
    ? pivotActionableRows.length
    : pivotCandidates.length;

  return (
    <Card
      A={A}
      title="Scanner"
      sub={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: MONO, fontSize: 10.5 }}>
          <span>
            SPY <strong style={{ color: pc(spyChg) }}>{pct(spyChg, 2)}</strong>
            {spyOff != null && <span style={{ color: A.textMuted }}> ({pct(spyOff, 1)} H)</span>}
          </span>
          <span>
            QQQ <strong style={{ color: pc(qqqChg) }}>{pct(qqqChg, 2)}</strong>
            {qqqOff != null && <span style={{ color: A.textMuted }}> ({pct(qqqOff, 1)} H)</span>}
          </span>
          {at && <span style={{ color: A.textMuted }}>· Live {at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
        </span>
      }
      right={<CopyTickersBtn A={A} tickers={copyTickers} label="Copy TV" />}
    >
      {/* Row 1: Elite Relative Strength Scans + 30m Pivot */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", letterSpacing: 0.5, marginRight: 2 }}>ELITE RS</span>
        {ELITE_RS_SCANS.map(([k, label, accent]) => {
          const active = scan === k;
          const isHotRed = k === "grnred" && redTape;
          return (
            <button
              key={k}
              type="button"
              onClick={() => pick(k)}
              style={{
                background: active ? `${accent}20` : "transparent",
                border: `1px solid ${active ? accent : A.border}`,
                color: active ? accent : A.textDim,
                borderRadius: 14,
                padding: "3px 10px",
                fontSize: 11,
                fontWeight: active ? 700 : 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>{label}</span>
              <span style={{ color: active ? accent : A.textMuted, fontFamily: MONO, fontSize: 10.5, fontWeight: 500 }}>{counts[k]}</span>
              {isHotRed && (
                <span title="SPY or QQQ is red today — prime Green-on-Red Tape conditions" style={{ width: 6, height: 6, borderRadius: 3, background: "#f472b6", display: "inline-block" }} />
              )}
            </button>
          );
        })}
        <button
          key={PIVOT30_SCAN}
          type="button"
          onClick={() => pick(PIVOT30_SCAN)}
          title={PIVOT30_NOTE}
          style={{
            background: pivotPillActive ? `${PIVOT30_ACCENT}20` : "transparent",
            border: `1px solid ${pivotPillActive ? PIVOT30_ACCENT : A.border}`,
            color: pivotPillActive ? PIVOT30_ACCENT : A.textDim,
            borderRadius: 14,
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: pivotPillActive ? 700 : 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span>30m Pivot</span>
          <span style={{ color: pivotPillActive ? PIVOT30_ACCENT : A.textMuted, fontFamily: MONO, fontSize: 10.5, fontWeight: 500 }}>
            {pivotPillCount}
          </span>
        </button>
      </div>

      {/* Row 2: Classic Momentum & Stockbee Scans */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.5, marginRight: 2 }}>SCANS</span>
        {CLASSIC_SCANS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => pick(k)}
            style={{
              background: scan === k ? "rgba(13,145,99,0.14)" : "transparent",
              border: `1px solid ${scan === k ? A.green : A.border}`,
              color: scan === k ? A.green : A.textDim,
              borderRadius: 14,
              padding: "3px 10px",
              fontSize: 11,
              fontWeight: scan === k ? 700 : 600,
              cursor: "pointer",
            }}
          >
            {label} <span style={{ color: A.textMuted, fontFamily: MONO, fontSize: 10.5, fontWeight: 400 }}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {/* Filter & Description Strip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8, paddingBottom: 7, borderBottom: `1px solid ${A.border}` }}>
        <div style={{ fontSize: 10.5, color: A.textMuted, flex: "1 1 260px" }}>
          {scan === PIVOT30_SCAN ? PIVOT30_NOTE : SCAN_NOTES[scan]}
          {" "}· <span style={{ color: "#fbbf24" }}>●</span> Elite RS (≥95)
          {" "}· <span style={{ color: A.blue || "#3b82f6" }}>●</span> RS line new 52w high before price
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={toggleNoHealth}
            title="Exclude all Healthcare stocks (Biotech, Pharma, MedTech, Providers, etc.)"
            style={{
              background: noHealth ? "rgba(244,114,182,0.18)" : "transparent",
              border: `1px solid ${noHealth ? "#f472b6" : A.border}`,
              color: noHealth ? "#f472b6" : A.textDim,
              borderRadius: 6,
              padding: "2px 8px",
              fontSize: 11,
              fontWeight: noHealth ? 700 : 600,
              cursor: "pointer",
            }}
          >
            No Health
          </button>
          <AdrFilter A={A} value={minAdr} onChange={setMinAdr} />
        </div>
      </div>

      {/* 30m Pivot Universe & Refresh Controls */}
      {scan === PIVOT30_SCAN && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <div style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 5 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.45, marginRight: 2 }}>UNIVERSE</span>
            {PIVOT30_UNIVERSES.map(([k, label]) => {
              const active = pivotUniverse === k;
              const tip = k === "adr5liq"
                ? SCAN_NOTES.adr5liq
                : k === "topdv"
                ? "Top 24 highest daily $ volume names (NVDA, TSLA, AMD, META, etc.) — catches liquid mega-cap bounces even below 200d SMA"
                : undefined;
              return (
                <button
                  key={k}
                  type="button"
                  title={tip}
                  onClick={() => pickPivotUniverse(k)}
                  style={{
                    background: active ? `${PIVOT30_ACCENT}1f` : "transparent",
                    border: `1px solid ${active ? PIVOT30_ACCENT : A.border}`,
                    color: active ? PIVOT30_ACCENT : A.textDim,
                    borderRadius: 12,
                    padding: "2px 8px",
                    fontSize: 10.5,
                    fontWeight: active ? 700 : 600,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setActionableOnly((v) => !v)}
              title="Show only TRIGGERED, ARMED, ORH BO, or PULLBACK setups"
              style={{
                marginLeft: 4,
                background: actionableOnly ? `${A.green}1f` : "transparent",
                border: `1px solid ${actionableOnly ? A.green : A.border}`,
                color: actionableOnly ? A.green : A.textDim,
                borderRadius: 6,
                padding: "2px 8px",
                fontSize: 10.5,
                fontWeight: actionableOnly ? 700 : 600,
                cursor: "pointer",
                fontFamily: MONO,
              }}
            >
              Actionable only{pivotUpdatedAt ? ` (${pivotActionableRows.length}/${pivotAllRows.length})` : ""}
            </button>
          </div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 10.5 }}>
            {pivotErr && (
              <span style={{ color: A.red }} title={pivotErr}>
                {pivotErr}
              </span>
            )}
            {pivotLoading ? (
              <span style={{ color: PIVOT30_ACCENT }}>Loading 30m…</span>
            ) : pivotUpdatedAt ? (
              <span style={{ color: A.textMuted }}>
                Updated {pivotUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : null}
            <button
              type="button"
              disabled={pivotLoading || !pivotCandidates.length}
              onClick={() => setPivotNonce((n) => n + 1)}
              title="Refresh 30m OHLC bars now (auto-refreshes every 2 min)"
              style={{
                background: "transparent",
                border: `1px solid ${A.border}`,
                color: pivotLoading ? A.textMuted : A.textDim,
                borderRadius: 6,
                padding: "2px 8px",
                fontSize: 10.5,
                fontWeight: 600,
                cursor: pivotLoading || !pivotCandidates.length ? "default" : "pointer",
                opacity: pivotLoading || !pivotCandidates.length ? 0.55 : 1,
              }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      )}

      {scan === PIVOT30_SCAN ? (
        !pivotCandidates.length ? (
          <div style={{ fontSize: 11, color: A.textMuted, padding: "8px 2px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>
              {pivotUniverse === "user"
                ? "No Portfolio, Watchlist, or Flagged tickers yet."
                : "No liquid RS ≥ 90 leaders match the current filters."}
            </span>
            {pivotUniverse === "user" && (
              <button
                type="button"
                onClick={() => setPivotUniverse("both")}
                style={{
                  background: "transparent",
                  border: `1px solid ${A.border}`,
                  color: A.textDim,
                  borderRadius: 6,
                  padding: "2px 8px",
                  fontSize: 10.5,
                  cursor: "pointer",
                }}
              >
                Switch to Both
              </button>
            )}
          </div>
        ) : pivotLoading && !pivotUpdatedAt ? (
          <div style={{ fontSize: 11, color: A.textMuted, padding: "10px 2px", fontFamily: MONO }}>
            Scanning 30m pivots across {pivotCandidates.length} leaders…
          </div>
        ) : (
          <>
            {pivotShowingFallback && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "5px 9px",
                  marginBottom: 6,
                  borderRadius: 6,
                  background: A.bgRow || "rgba(148,163,184,0.08)",
                  border: `1px solid ${A.border}`,
                  fontSize: 10.5,
                  color: A.textDim,
                }}
              >
                <span>
                  No actionable 30m setups right now — showing all {pivotAllRows.length} scanned names.
                </span>
                <button
                  type="button"
                  onClick={() => setActionableOnly(false)}
                  style={{
                    background: "transparent",
                    border: `1px solid ${A.border}`,
                    color: A.text,
                    borderRadius: 5,
                    padding: "1px 7px",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Show all
                </button>
              </div>
            )}
            <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 290px)", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                  <tr>
                    {col("t", "Ticker", "Sort by ticker", "left")}
                    {col("score", "Setup", "30m Pivot setup state & score", "left")}
                    {col("entry", "Entry", "30m Pivot trigger price (and % distance if ARMED)")}
                    {col("stop", "Stop", "Protective stop level (swing / red-bar low)")}
                    {col("riskPct", "Risk%", "Stop risk % from entry")}
                    {col("target2R", "+2R", "2R profit target from entry & stop")}
                    {col("orRank", "OR", "Opening Range (first 30m) status", "left")}
                    {col("chg", "Live", "Live price & day % change (sort by Chg%)")}
                    {col("zvr", "ZVR", "Zanger Volume Ratio vs 10d intraday profile (falls back to EOD RVol)")}
                    {col("rs", "RS", "Relative Strength rank")}
                    {col("dv", "$Vol", "Today's dollar volume (Price × Live Volume; falls back to avg daily $vol)")}
                    {col("er", "ER", "Calendar days until next earnings report")}
                    {col("layer", "Layer", "ThemePulse layer / industry", "left")}
                  </tr>
                </thead>
                <tbody>
                  {pivotDisplayRows.map((r) => {
                    const on = chartTicker === r.t;
                    const badgeColor = toneHex(r.tone, A);
                    const isArmed = String(r.state || "").toLowerCase().includes("arm") || r.badge === "ARMED";
                    const rMultStr = r.rMultipleNow != null && Number.isFinite(r.rMultipleNow)
                      ? `${r.rMultipleNow >= 0 ? "+" : ""}${r.rMultipleNow.toFixed(1)}R`
                      : null;
                    const orTipParts = [];
                    if (r.orh != null && r.orl != null) {
                      orTipParts.push(`ORH ${fmtPx(r.orh)} · ORL ${fmtPx(r.orl)}`);
                    }
                    if (r.fp && r.fp.p != null) {
                      orTipParts.push(`P ${fmtPx(r.fp.p)} · BC ${fmtPx(r.fp.bc)} · TC ${fmtPx(r.fp.tc)}${r.fp.bias ? ` (${r.fp.bias})` : ""}`);
                    }
                    const orTip = orTipParts.join(" | ");

                    return (
                      <tr
                        key={r.t}
                        data-nav={r.t}
                        className={on ? "tp-click-row tp-row-active" : "tp-click-row"}
                        onClick={() => onPivotRowClick(r.t)}
                        style={{
                          cursor: "pointer",
                          background: on ? A.bgHover : "transparent",
                          boxShadow: on ? `inset 2px 0 0 ${A.green}` : "none",
                        }}
                      >
                        <td style={std()}>
                          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <FlagButton t={r.t} A={A} />
                            <span style={{ color: on ? A.green : A.text, fontWeight: 700, fontFamily: MONO }}>{r.t}</span>
                            <TierMark t={r.t} />
                            {r.srcTag ? (
                              <span
                                title={r.srcTag === "P" ? "In Portfolio" : "In Watchlist"}
                                style={{ marginLeft: 3, fontSize: 9.5, color: A.textMuted, fontFamily: MONO }}
                              >
                                {r.srcTag}
                              </span>
                            ) : null}
                            <RslDot tip={r.rsl} A={A} />
                          </div>
                        </td>
                        <td style={std("left", { whiteSpace: "nowrap" })} title={r.summary || undefined}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "1px 6px",
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: 0.25,
                                fontFamily: MONO,
                                color: badgeColor,
                                background: `${badgeColor}1f`,
                                border: `1px solid ${badgeColor}55`,
                              }}
                            >
                              {r.badge}
                            </span>
                            {rMultStr ? (
                              <span
                                style={{
                                  fontFamily: MONO,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: r.rMultipleNow >= 0 ? A.green : A.red,
                                }}
                              >
                                {rMultStr}
                              </span>
                            ) : r.redCount > 0 ? (
                              <span
                                title={`${r.redCount} consecutive 30m red bar${r.redCount === 1 ? "" : "s"}`}
                                style={{ fontFamily: MONO, fontSize: 10, color: A.textMuted }}
                              >
                                {r.redCount}r
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td style={std("right", { fontFamily: MONO, color: r.entry != null ? A.text : A.textMuted, fontWeight: r.entry != null ? 600 : 400, whiteSpace: "nowrap" })}>
                          <span>{fmtPx(r.entry)}</span>
                          {isArmed && r.distToEntryPct != null && Number.isFinite(r.distToEntryPct) && (
                            <span style={{ marginLeft: 4, fontSize: 9.5, color: "#fbbf24" }}>
                              {r.distToEntryPct > 0 ? "+" : ""}{r.distToEntryPct.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td style={std("right", { fontFamily: MONO, color: A.textDim, whiteSpace: "nowrap" })}>
                          {fmtPx(r.stop)}
                        </td>
                        <td style={std("right", { fontFamily: MONO, color: r.riskPct == null ? A.textMuted : Math.abs(r.riskPct) <= 2.5 ? A.green : Math.abs(r.riskPct) <= 4.5 ? "#fbbf24" : A.red, whiteSpace: "nowrap" })}>
                          {fmtRisk(r.riskPct)}
                        </td>
                        <td style={std("right", { fontFamily: MONO, color: r.target2R != null ? A.green : A.textMuted, whiteSpace: "nowrap" })}>
                          {fmtPx(r.target2R)}
                        </td>
                        <td style={std("left", { whiteSpace: "nowrap" })} title={orTip || undefined}>
                          {r.orInfo ? (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "1px 5px",
                                borderRadius: 4,
                                fontSize: 9.5,
                                fontWeight: 700,
                                fontFamily: MONO,
                                color: r.orInfo.color,
                                background: `${r.orInfo.color}18`,
                                border: `1px solid ${r.orInfo.color}44`,
                              }}
                            >
                              {r.orInfo.label}
                            </span>
                          ) : (
                            <span style={{ color: A.textMuted, fontFamily: MONO }}>—</span>
                          )}
                        </td>
                        <td style={std("right", { fontFamily: MONO, whiteSpace: "nowrap" })}>
                          <span style={{ color: A.text }}>{fmtPx(r.px)}</span>{" "}
                          <span style={{ color: pc(r.chg), fontWeight: 700 }}>{pct(r.chg, 1)}</span>
                        </td>
                        <td style={std("right", { fontFamily: MONO, color: r.zvr == null ? A.textMuted : r.zvr >= 2 ? "#fbbf24" : r.zvr >= 1.5 ? A.green : A.textDim, fontWeight: (r.zvr ?? 0) >= 1.5 ? 700 : 400, whiteSpace: "nowrap" })}>
                          {r.zvr != null ? `${r.zvr.toFixed(1)}×` : "—"}
                        </td>
                        <td style={std("right", { fontFamily: MONO, fontWeight: 700, color: r.rs >= 90 ? A.green : r.rs >= 70 ? A.yellow : r.rs != null ? A.red : A.textMuted })}>
                          {r.rs ?? "—"}
                        </td>
                        <td title={r.avgDv ? `Avg daily $Vol: ${fmtDollarVol(r.avgDv)}` : undefined} style={std("right", { fontFamily: MONO, color: (r.dv ?? 0) >= 100e6 ? A.text : A.textDim, whiteSpace: "nowrap" })}>
                          {fmtDollarVol(r.dv)}
                        </td>
                        <td title={r.erTip || ""} style={std("right", { fontFamily: MONO, fontWeight: r.er != null && r.er <= 14 ? 700 : 400, color: r.er == null ? A.textMuted : r.er <= 5 ? A.red : r.er <= 14 ? "#fbbf24" : A.textMuted, whiteSpace: "nowrap" })}>
                          {r.er == null ? "—" : `${r.er}d`}
                        </td>
                        <td style={std("left", { fontSize: 10.5, maxWidth: 145, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                          <LayerLink r={r} A={A} onLayer={onLayer} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : !rows.length ? (
        <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 2px" }}>No names pass right now.</div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 260px)", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
              <tr>
                <th style={{ ...th(A), padding: "5px 5px", fontSize: 10 }}>Ticker</th>
                {col("thrust", "Thr", "ADR-adjusted Stock Thrust: (Chg% ÷ ADR%) × ZVR")}
                {col("chg", "Chg%")}
                {col("zvr", "ZVR", "Zanger Volume Ratio vs 10d intraday profile (falls back to EOD RVol)")}
                {extra.map(([k, l, tip]) => col(k, l, tip))}
                {col("r1w", "1W")}
                {col("r1m", "1M")}
                {col("r3m", "3M")}
                {col("adr", "ADR")}
                {col("dv", "$Vol", "Today's dollar volume (Price × Live Volume; falls back to avg daily $vol)")}
                {col("off", "52wH", "% off 52-week high")}
                {col("rs", "RS")}
                {col("eps", "EPS", EPS_TIP)}
                {col("er", "ER", "Calendar days until next earnings report")}
                <th style={{ ...th(A), padding: "5px 5px", fontSize: 10 }}>Layer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = chartTicker === r.t;
                return (
                  <tr
                    key={r.t}
                    data-nav={r.t}
                    className={on ? "tp-click-row tp-row-active" : "tp-click-row"}
                    onClick={() => onTicker(r.t)}
                    style={{
                      cursor: "pointer",
                      background: on ? A.bgHover : "transparent",
                      boxShadow: on ? `inset 2px 0 0 ${A.green}` : "none",
                    }}
                  >
                    <td style={std()}>
                      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <FlagButton t={r.t} A={A} />
                        <span style={{ color: on ? A.green : A.text, fontWeight: 700, fontFamily: MONO }}>{r.t}</span>
                        <TierMark t={r.t} />
                        {r.tag ? <span title={r.tag === "L" ? "$10B+ scan" : "under-$10B scan"} style={{ marginLeft: 3, fontSize: 10, color: A.textMuted, fontFamily: MONO }}>{r.tag}</span> : null}
                        <RslDot tip={r.rsl} A={A} />
                      </div>
                    </td>
                    <td style={std("right", { fontFamily: MONO, fontWeight: r.thrust != null && Math.abs(r.thrust) >= 1.5 ? 800 : 500, color: r.thrust == null ? A.textMuted : r.thrust > 0 ? A.green : r.thrust < 0 ? A.red : A.textMuted, whiteSpace: "nowrap" })}>
                      {r.thrust != null ? `${r.thrust > 0 ? "+" : ""}${r.thrust.toFixed(1)}` : "—"}
                    </td>
                    <td style={std("right", { fontFamily: MONO, color: pc(r.chg), fontWeight: 700, whiteSpace: "nowrap" })}>{pct(r.chg, 1)}</td>
                    <td style={std("right", { fontFamily: MONO, color: r.zvr == null ? A.textMuted : r.zvr >= 2 ? "#fbbf24" : r.zvr >= 1.5 ? A.green : A.textDim, fontWeight: (r.zvr ?? 0) >= 1.5 ? 700 : 400, whiteSpace: "nowrap" })}>
                      {r.zvr != null ? `${r.zvr.toFixed(1)}×` : "—"}
                    </td>
                    {extra.map(([k, , , f]) => (
                      <td key={k} style={std("right", { fontFamily: MONO, color: A.text, whiteSpace: "nowrap" })}>{f(r)}</td>
                    ))}
                    <td style={std("right", { fontFamily: MONO, color: pc(r.r1w), whiteSpace: "nowrap" })}>{pct(r.r1w)}</td>
                    <td style={std("right", { fontFamily: MONO, color: pc(r.r1m), whiteSpace: "nowrap" })}>{pct(r.r1m)}</td>
                    <td style={std("right", { fontFamily: MONO, color: pc(r.r3m), whiteSpace: "nowrap" })}>{pct(r.r3m)}</td>
                    <td style={std("right", { fontFamily: MONO, color: (r.adr ?? 0) >= 4 ? A.cyan : A.textDim, whiteSpace: "nowrap" })}>{r.adr == null ? "—" : `${r.adr.toFixed(1)}%`}</td>
                    <td title={r.avgDv ? `Avg daily $Vol: ${fmtDollarVol(r.avgDv)}` : undefined} style={std("right", { fontFamily: MONO, color: (r.dv ?? 0) >= 100e6 ? A.text : A.textDim, whiteSpace: "nowrap" })}>{fmtDollarVol(r.dv)}</td>
                    <td style={std("right", { fontFamily: MONO, color: (r.off ?? -99) >= -5 ? A.green : A.textDim, whiteSpace: "nowrap" })}>{pct(r.off)}</td>
                    <td style={std("right", { fontFamily: MONO, fontWeight: 700, color: r.rs >= 90 ? A.green : r.rs >= 70 ? A.yellow : r.rs != null ? A.red : A.textMuted })}>{r.rs ?? "—"}</td>
                    <td title={r.epsTip || ""} style={std("right", { fontFamily: MONO, color: r.eps >= 80 ? A.green : r.eps >= 50 ? A.yellow : r.eps != null ? A.red : A.textMuted, whiteSpace: "nowrap" })}>
                      {r.eps ?? "—"}{r.epsAcc ? <span style={{ color: A.green, fontSize: 10 }}>▲</span> : null}
                    </td>
                    <td title={r.erTip || ""} style={std("right", { fontFamily: MONO, fontWeight: r.er != null && r.er <= 14 ? 700 : 400, color: r.er == null ? A.textMuted : r.er <= 5 ? A.red : r.er <= 14 ? "#fbbf24" : A.textMuted, whiteSpace: "nowrap" })}>
                      {r.er == null ? "—" : `${r.er}d`}
                    </td>
                    <td style={std("left", { fontSize: 10.5, maxWidth: 145, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                      <LayerLink r={r} A={A} onLayer={onLayer} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default ScannerPanel;
