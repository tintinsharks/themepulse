import { useMemo, useState } from "react";
import {
  Card,
  CopyTickersBtn,
  EPS_TIP,
  FlagButton,
  RslDot,
  TierMark,
  etClock,
  layerFlags,
  pinReason,
  scoreZangerCandidate,
  statusColor,
  td,
  th,
  useRvolProfiles,
  useScanQuotes,
} from "./core.jsx";

const MODES = [
  ["zanger", "⚡ All Movers", "Any of the 4 breakouts (Zanger, Stockbee 4%, Stockbee $, Qullamaggie) OR ZVR ≥ 1.5x volume surge in a leading/emerging theme"],
  ["bo", "🔥 Breakouts", "Zanger Breakout (ZVR ≥ 2x, +3%, CR ≥ 70%, ≤10% off 52wH) · Stockbee 4% (+4% on vol) · Stockbee $ (+$0.90 & +1.5% on vol) · Qullamaggie (momentum + tight structure + ADR thrust)"],
  ["rsl", "🔵 RS Leading", "RS line at a new 52-week high on a green close while price bases 5–15% off highs"],
  ["leaders", "⭐ Core Leaders", "RS 90+ Tier Leaders in Leading theme layers (sorted by RS / EPS / ZVR)"],
];

const BO_META = {
  ZANGER: { label: "🔥 ZNG", full: "Zanger BO", color: "#fbbf24", tip: "Dan Zanger Breakout: ZVR ≥ 2.0x, up ≥ +3%, CR ≥ 70%, within 10% of 52wH" },
  "SB4%": { label: "⚡ 4%",  full: "Stockbee 4%", color: "#34d399", tip: "Stockbee 4% Momentum Burst: up ≥ +4% on ≥ 1.0x volume, CR ≥ 60%" },
  "SB$":  { label: "💵 $BO", full: "Stockbee $", color: "#22d3ee", tip: "Stockbee $ Breakout: up ≥ $0.90 (and ≥ +1.5%) on ≥ 1.2x volume, CR ≥ 60%" },
  QMAG:   { label: "🚀 QMAG", full: "Qullamaggie", color: "#a855f7", tip: "Qullamaggie Breakout: prior momentum leader + tight/EMA structure + ≥0.7x ADR thrust on ≥ 1.3x vol" },
};
const BO_KEYS = ["ZANGER", "SB4%", "SB$", "QMAG"];

const fmtPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);

function ZvrMeter({ zvr, A }) {
  if (zvr == null) return <span style={{ color: A.textMuted }}>—</span>;
  const pct = Math.min(100, Math.round((zvr / 3.5) * 100));
  const color = zvr >= 2.0 ? "#fbbf24" : zvr >= 1.5 ? A.green : A.textDim;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 50 }}>
      <span style={{ color, fontWeight: zvr >= 1.5 ? 800 : 500, fontFamily: "monospace", fontSize: 11 }}>{zvr.toFixed(2)}x</span>
      <div style={{ width: 46, height: 3, borderRadius: 2, background: A.border, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function CrMeter({ cr, A }) {
  if (cr == null) return <span style={{ color: A.textMuted }}>—</span>;
  const color = cr >= 75 ? A.green : cr >= 60 ? A.cyan : cr >= 40 ? A.textDim : A.red;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 42 }}>
      <span style={{ color, fontWeight: cr >= 70 ? 700 : 400, fontFamily: "monospace", fontSize: 11 }}>{cr}%</span>
      <div style={{ width: 38, height: 3, borderRadius: 2, background: A.border, position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: `${Math.max(4, Math.min(100, cr))}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function SignalPill({ r, A }) {
  if (r.breakoutTypes?.length) {
    return (
      <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 3 }}>
        {r.breakoutTypes.map((k) => {
          const m = BO_META[k] || { label: k, color: A.green, tip: k };
          return (
            <span
              key={k}
              title={m.tip}
              style={{
                fontSize: 9,
                fontWeight: 800,
                fontFamily: "monospace",
                padding: "1px 5px",
                borderRadius: 4,
                color: m.color,
                background: `${m.color}1f`,
                border: `1px solid ${m.color}66`,
                whiteSpace: "nowrap",
              }}
            >
              {m.label}
            </span>
          );
        })}
      </div>
    );
  }
  if (r.rsl) {
    return (
      <span title={r.rslTip || "RS line leading price"}
        style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, color: A.cyan, background: "rgba(34,211,238,0.12)", border: `1px solid ${A.cyan}55`, whiteSpace: "nowrap" }}>
        🔵 RSL
      </span>
    );
  }
  if (r.qualifiesZanger) {
    return (
      <span title="Dan Zanger Volume Surge: ZVR ≥ 1.5x, green thrust, CR ≥ 60%"
        style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, color: A.green, background: "rgba(13,145,99,0.14)", border: `1px solid ${A.green}55`, whiteSpace: "nowrap" }}>
        ⚡ VOL
      </span>
    );
  }
  return (
    <span title="Core Tier Leader in a Leading theme layer"
      style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, color: A.textDim, background: "transparent", border: `1px solid ${A.border}`, whiteSpace: "nowrap" }}>
      ⭐ LEAD
    </span>
  );
}

function ZangerPanel({
  A,
  stockMap,
  layers,
  themes,
  tickerLayer,
  tiers,
  onTicker,
  chartTicker,
  onLayer,
  portfolio = [],
  setPortfolio,
  watchlist = [],
  setWatchlist,
}) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem("tp-zanger-mode") || "zanger"; } catch { return "zanger"; }
  });
  const [boFilter, setBoFilter] = useState(null); // null = all | "ZANGER" | "SB4%" | "SB$" | "QMAG"
  const [themeId, setThemeId] = useState(null);
  const [minZvr, setMinZvr] = useState(1.0);
  const [minRs, setMinRs] = useState(70);
  const [cleanOnly, setCleanOnly] = useState(false);
  const [epsOnly, setEpsOnly] = useState(false);
  const [showIntel, setShowIntel] = useState(() => {
    try { return localStorage.getItem("tp-zanger-intel") !== "0"; } catch { return true; }
  });
  const [sort, setSort] = useState({ k: "score", d: -1 });

  const toggleIntel = () => setShowIntel((v) => {
    try { localStorage.setItem("tp-zanger-intel", v ? "0" : "1"); } catch { /* ignore */ }
    return !v;
  });

  const pfSet = useMemo(() => new Set(portfolio || []), [portfolio]);
  const wlSet = useMemo(() => new Set(watchlist || []), [watchlist]);
  const pfColor = A.green;
  const wlColor = A.cyan || "#38bdf8";

  const toggleIn = (t, target) => {
    const setter = target === "pf" ? setPortfolio : setWatchlist;
    if (!setter) return;
    setter((prev) => ((prev || []).includes(t) ? prev.filter((x) => x !== t) : [...(prev || []), t]));
  };

  const pickMode = (m) => {
    setMode(m);
    if (m !== "bo" && m !== "zanger") setBoFilter(null);
    try { localStorage.setItem("tp-zanger-mode", m); } catch {}
    if (m === "leaders") setSort({ k: "rs", d: -1 });
    else setSort({ k: "score", d: -1 });
  };

  // Candidate universe to stream live quotes for (same pool as scripts/zanger-scan.mjs)
  const poolTickers = useMemo(() => {
    const out = [];
    for (const [t, s] of Object.entries(stockMap || {})) {
      if (!s?.ticker || (s.avg_dollar_vol_raw ?? 0) < 20e6 || !s.above_50ma || pinReason(s)) continue;
      const l = tickerLayer[t];
      if (tiers?.leaders?.has(t) || tiers?.emerging?.has(t) || (s.rs_rank ?? 0) >= 70 || l?.st === "lead" || l?.st === "emerg") {
        out.push(t);
      }
    }
    return out.sort();
  }, [stockMap, tickerLayer, tiers]);

  const { quotes, at } = useScanQuotes(poolTickers, true);
  const profiles = useRvolProfiles();
  const clock = etClock();

  // Score every candidate using the exact shared Dan Zanger engine from src/lead/math.js
  const allScored = useMemo(() => {
    const out = [];
    for (const t of poolTickers) {
      const s = stockMap[t];
      if (!s) continue;
      const q = quotes.get(t) || null;
      const layer = tickerLayer[t] || null;
      const tier = tiers?.leaders?.has(t) ? "lead" : tiers?.emerging?.has(t) ? "emerg" : null;
      const r = scoreZangerCandidate({ s, q, layer, tier, profiles });
      if (r) out.push(r);
    }
    return out;
  }, [poolTickers, stockMap, quotes, tickerLayer, tiers, profiles]);

  // Top-level KPI counts (unfiltered by theme/extra toggles so counts stay honest)
  const counts = useMemo(() => {
    const byBo = { ZANGER: 0, "SB4%": 0, "SB$": 0, QMAG: 0 };
    for (const r of allScored) {
      for (const k of r.breakoutTypes || []) if (byBo[k] != null) byBo[k]++;
    }
    return {
      bo: allScored.filter((r) => r.isBreakout).length,
      zanger: allScored.filter((r) => r.qualifiesZanger).length,
      rsl: allScored.filter((r) => r.rsl).length,
      leaders: allScored.filter((r) => r.tier === "lead" && r.layerStatus === "lead").length,
      byBo,
    };
  }, [allScored]);

  // Leading & confirmed-emerging themes for the quick filter strip
  const topThemes = useMemo(() => {
    const list = (themes || []).filter((t) => t.st === "lead" || t.st === "emerg").slice(0, 12);
    const hitCount = {};
    for (const r of allScored) {
      if (!r.themeId) continue;
      if (mode === "bo" ? r.isBreakout : mode === "rsl" ? r.rsl : mode === "leaders" ? (r.tier === "lead" && r.layerStatus === "lead") : r.qualifiesZanger) {
        hitCount[r.themeId] = (hitCount[r.themeId] || 0) + 1;
      }
    }
    return list.map((t) => {
      const hasWarn = (t.layers || []).some((l) => (l.flags || []).some(([k]) => k === "distrib" || k === "exiting"));
      return { ...t, hits: hitCount[t.themeId] || 0, hasWarn };
    });
  }, [themes, allScored, mode]);

  // Live Intraday Theme Money Flow (top 5 hottest & bottom 3 coldest, min 4 liquid stocks)
  const themeFlow = useMemo(() => {
    const boByTheme = new Map();
    for (const r of allScored) {
      if (!r.isBreakout || !r.themeId) continue;
      boByTheme.set(r.themeId, (boByTheme.get(r.themeId) || 0) + 1);
    }

    const buckets = new Map();
    for (const [tk, s] of Object.entries(stockMap || {})) {
      if ((s?.avg_dollar_vol_raw ?? 0) < 20e6) continue;
      const L = tickerLayer?.[tk];
      if (!L?.themeId || !L?.theme) continue;
      const q = quotes.get(tk);
      const chg = q?.change ?? s.chg_live ?? s.change_pct;
      if (chg == null || !Number.isFinite(chg)) continue;
      let b = buckets.get(L.themeId);
      if (!b) {
        b = { themeId: L.themeId, theme: L.theme, sum: 0, count: 0, green: 0, best: null };
        buckets.set(L.themeId, b);
      }
      b.sum += chg;
      b.count++;
      if (chg > 0) b.green++;
      if (!b.best || chg > b.best.chg) b.best = { ticker: tk, chg };
    }

    const list = [];
    for (const b of buckets.values()) {
      if (b.count < 4) continue;
      list.push({
        themeId: b.themeId,
        theme: b.theme,
        avgChg: Math.round((b.sum / b.count) * 100) / 100,
        pctGreen: Math.round((b.green / b.count) * 100),
        count: b.count,
        breakouts: boByTheme.get(b.themeId) || 0,
        topMover: b.best,
      });
    }
    list.sort((a, b) => b.avgChg - a.avgChg || b.pctGreen - a.pctGreen);
    const hottest = list.slice(0, 5);
    const hottestIds = new Set(hottest.map((x) => x.themeId));
    const coldest = list.filter((x) => !hottestIds.has(x.themeId)).slice(-3).reverse();
    return { hottest, coldest };
  }, [stockMap, tickerLayer, quotes, allScored]);

  // Leader Damage Watch ("Generals Getting Hit")
  const leaderDamage = useMemo(() => {
    const damaged = allScored
      .filter((r) => {
        if (r.rs < 90 && r.tier !== "lead") return false;
        if (r.chg == null || r.chg > -3.0) return false;
        const heavyVol = r.zvr != null && r.zvr >= 1.5;
        const weakClose = r.cr != null && r.cr <= 30;
        return heavyVol || weakClose || r.chg <= -4.5;
      })
      .sort((a, b) => a.chg - b.chg || (b.zvr ?? 0) - (a.zvr ?? 0))
      .slice(0, 12);

    const warnLayers = (layers || [])
      .map((l) => {
        const fl = l.flags?.length ? l.flags : layerFlags(l);
        const bad = fl.filter(([k]) => k === "distrib" || k === "exiting").map(([k]) => k);
        return l.st === "lead" && bad.length ? { key: l.key, themeId: l.themeId, theme: l.theme, layer: l.name, rank: l.now, flags: bad } : null;
      })
      .filter(Boolean)
      .slice(0, 6);

    return { damaged, warnLayers };
  }, [allScored, layers]);

  const activeExtraTheme = useMemo(() => {
    if (!themeId || topThemes.some((t) => t.themeId === themeId)) return null;
    const match = (themes || []).find((t) => t.themeId === themeId)
      || [...themeFlow.hottest, ...themeFlow.coldest].find((t) => t.themeId === themeId);
    return match ? { themeId, theme: match.theme } : { themeId, theme: themeId };
  }, [themeId, topThemes, themes, themeFlow]);

  const rows = useMemo(() => {
    let list = allScored.filter((r) => {
      if (mode === "bo") return r.isBreakout;
      if (mode === "rsl") return r.rsl;
      if (mode === "leaders") return r.tier === "lead" && r.layerStatus === "lead";
      return r.qualifiesZanger;
    });
    if (boFilter) list = list.filter((r) => (r.breakoutTypes || []).includes(boFilter));
    if (themeId) list = list.filter((r) => r.themeId === themeId);
    if ((mode === "zanger" || mode === "bo") && minZvr > 1.0) list = list.filter((r) => (r.zvr ?? 0) >= minZvr);
    if (minRs > 70) list = list.filter((r) => r.rs >= minRs);
    if (epsOnly) list = list.filter((r) => (r.eps ?? 0) >= 50);
    if (cleanOnly) list = list.filter((r) => !(r.layerFlags || []).some(([k]) => k === "distrib" || k === "exiting"));

    const { k, d } = sort;
    return [...list].sort((a, b) => {
      if (k === "score" && d < 0) {
        const diffBo = (b.breakoutTypes?.length || 0) - (a.breakoutTypes?.length || 0);
        if (diffBo) return diffBo;
      }
      const va = a[k], vb = b[k];
      if (va == null && vb == null) return a.ticker.localeCompare(b.ticker);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return va.localeCompare(vb) * d;
      return (va - vb) * d || a.ticker.localeCompare(b.ticker);
    });
  }, [allScored, mode, boFilter, themeId, minZvr, minRs, epsOnly, cleanOnly, sort]);

  const col = (k, label, align = "right", title) => (
    <th
      key={k}
      onClick={() => setSort((p) => ({ k, d: p.k === k ? -p.d : -1 }))}
      title={title}
      style={{
        ...th(A, align),
        cursor: "pointer",
        userSelect: "none",
        color: sort.k === k ? A.text : A.textMuted,
      }}
    >
      {label}{sort.k === k ? (sort.d < 0 ? " ▼" : " ▲") : ""}
    </th>
  );

  const chipStyle = (active, accent) => ({
    background: active ? `${accent || A.green}22` : "transparent",
    border: `1px solid ${active ? (accent || A.green) : A.border}`,
    color: active ? (accent || A.green) : A.textDim,
    padding: "3px 8px",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: active ? 700 : 500,
    whiteSpace: "nowrap",
  });

  const leadLayerCount = useMemo(() => (layers || []).filter((l) => l.st === "lead").length, [layers]);
  const modeMeta = MODES.find(([m]) => m === mode) || MODES[0];

  return (
    <div>
      {/* Top KPI & Live Status Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 10 }}>
        {[
          ["bo", "🔥 Breakouts", counts.bo, "#fbbf24", "Zanger · SB 4% · SB $ · QMAG"],
          ["zanger", "⚡ All Movers", counts.zanger, A.green, "Any breakout or ZVR ≥ 1.5x"],
          ["rsl", "🔵 RS Leading", counts.rsl, A.cyan, "RS line 52w high · basing"],
          ["leaders", "⭐ Core Leaders", counts.leaders, "#f59e0b", `RS 90+ in ${leadLayerCount} lead layers`],
        ].map(([k, label, n, color, sub]) => {
          const active = mode === k;
          return (
            <button
              key={k}
              onClick={() => pickMode(k)}
              style={{
                textAlign: "left",
                background: active ? `${color}16` : A.bgCard,
                border: `1px solid ${active ? color : A.border}`,
                borderRadius: 8,
                padding: "9px 12px",
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: active ? color : A.textDim, fontFamily: "monospace" }}>{label}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: n > 0 ? color : A.textMuted, fontFamily: "monospace", lineHeight: 1 }}>{n}</span>
              </div>
              <div style={{ fontSize: 9, color: A.textMuted, marginTop: 4, fontFamily: "monospace" }}>{sub}</div>
            </button>
          );
        })}
      </div>

      {/* Leading Themes Filter Strip */}
      {(topThemes.length > 0 || activeExtraTheme) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, background: A.bgCard, border: `1px solid ${A.border}`, borderRadius: 8, padding: "7px 10px", marginBottom: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: A.textMuted, fontFamily: "monospace", letterSpacing: 0.5, marginRight: 2 }}>THEMES</span>
          <button onClick={() => setThemeId(null)} style={chipStyle(!themeId, A.green)}>All</button>
          {topThemes.map((t) => {
            const active = themeId === t.themeId;
            const c = statusColor(t.st, A);
            return (
              <button
                key={t.themeId}
                onClick={() => setThemeId(active ? null : t.themeId)}
                title={`${t.theme} (rank ${Math.round(t.now)})${t.hasWarn ? " · contains layers with distrib/exiting flags" : ""}`}
                style={chipStyle(active, c)}
              >
                {t.theme}
                <span style={{ opacity: 0.75, marginLeft: 4 }}>{t.hits}</span>
                {t.hasWarn && <span style={{ color: "#f59e0b", marginLeft: 3 }}>•</span>}
              </button>
            );
          })}
          {activeExtraTheme && (
            <button
              onClick={() => setThemeId(null)}
              title={`Filtered to ${activeExtraTheme.theme} — click to clear`}
              style={chipStyle(true, A.cyan)}
            >
              {activeExtraTheme.theme} ✕
            </button>
          )}
        </div>
      )}

      {/* Main Dan Zanger Table Card */}
      <Card
        A={A}
        title={modeMeta[1]}
        sub={modeMeta[2]}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 10, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: clock.rth ? A.green : A.textMuted }}>
              <span className={clock.rth ? "tp-livedot" : undefined} style={{ width: 6, height: 6, borderRadius: 3, background: clock.rth ? A.green : A.textMuted, display: "inline-block" }} />
              {clock.rth ? `LIVE${at ? ` · ${at.toLocaleTimeString()}` : ""}` : `EOD · ${clock.session}`}
            </span>
            <span style={{ color: A.textMuted }}>{rows.length} shown</span>
            <CopyTickersBtn tickers={rows.map((r) => r.ticker)} A={A} />
          </div>
        }
      >
        {/* Filter controls row */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${A.border}` }}>
          {(mode === "bo" || mode === "zanger") && (
            <div style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 9, color: A.textMuted, fontFamily: "monospace" }}>TYPE</span>
              <button onClick={() => setBoFilter(null)} style={chipStyle(!boFilter, A.green)}>All</button>
              {BO_KEYS.map((k) => {
                const m = BO_META[k];
                return (
                  <button key={k} onClick={() => setBoFilter(boFilter === k ? null : k)} title={m.tip} style={chipStyle(boFilter === k, m.color)}>
                    {m.label} <span style={{ opacity: 0.75, marginLeft: 2 }}>{counts.byBo[k]}</span>
                  </button>
                );
              })}
            </div>
          )}
          {(mode === "zanger" || mode === "bo") && (
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
          <button onClick={() => setEpsOnly((v) => !v)} style={chipStyle(epsOnly, A.green)} title="Require O'Neil EPS Rating ≥ 50">
            EPS ≥ 50
          </button>
          <button onClick={() => setCleanOnly((v) => !v)} style={chipStyle(cleanOnly, A.green)} title="Hide stocks whose layer has distribution or exiting-leader warnings">
            Clean layers only
          </button>
          <button
            onClick={toggleIntel}
            style={chipStyle(showIntel, leaderDamage.damaged.length > 0 ? A.red : A.cyan)}
            title="Toggle Today's Intraday Theme Money Flow & Leader Damage Watch strip below"
          >
            {showIntel ? "▾" : "▸"} Flow &amp; Damage
            {leaderDamage.damaged.length > 0 && (
              <span style={{ marginLeft: 4, color: A.red, fontWeight: 800 }}>({leaderDamage.damaged.length})</span>
            )}
          </button>
          <span style={{ marginLeft: "auto", fontSize: 9, color: A.textMuted, fontFamily: "monospace" }}>
            ↑/↓ step chart · updates every 60s RTH
          </span>
        </div>

        {/* Results table */}
        {rows.length === 0 ? (
          <div style={{ padding: "28px 16px", textAlign: "center", color: A.textMuted, fontSize: 11, fontFamily: "monospace" }}>
            No stocks match the current Dan Zanger filters
            {themeId ? " in this theme" : ""}.
            {mode !== "leaders" && (
              <span>
                {" "}Switch to{" "}
                <button onClick={() => pickMode("leaders")} style={{ background: "transparent", border: "none", color: A.green, textDecoration: "underline", cursor: "pointer", fontFamily: "monospace", fontSize: 11 }}>
                  ⭐ Core Leaders ({counts.leaders})
                </button>{" "}
                to watch top setups building volume.
              </span>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 310px)", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 2 }}>
                <tr>
                  <th style={th(A, "left")}>Sig</th>
                  {col("ticker", "Ticker", "left")}
                  {col("layer", "Theme · Layer", "left")}
                  {col("adr", "ADR")}
                  {col("chg", "Chg%")}
                  {col("fromOpen", "Open%")}
                  {col("zvr", "ZVR", "right", "Zanger Volume Ratio vs 10-day intraday volume profile")}
                  {col("cr", "CR%", "right", "Closing Range — where price sits in today's low-to-high range")}
                  {col("rs", "RS")}
                  {col("eps", "EPS", "right", EPS_TIP)}
                  {col("off52", "Off 52wH")}
                  {col("score", "Score", "right", "Composite Zanger score: ZVR + RS + Layer + CR + EPS + 52w proximity")}
                  <th style={th(A, "right")}>List</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 80).map((r) => {
                  const active = chartTicker === r.ticker;
                  const inPf = pfSet.has(r.ticker);
                  const inWl = wlSet.has(r.ticker);
                  const warn = (r.layerFlags || []).some(([k]) => k === "distrib" || k === "exiting");
                  const lColor = statusColor(r.layerStatus, A) || A.textMuted;
                  const chgColor = r.chg == null ? A.textMuted : r.chg >= 0 ? A.green : A.red;
                  const openColor = r.fromOpen == null ? A.textMuted : r.fromOpen >= 0 ? A.green : A.red;
                  const showEr = r.earningsDays != null && r.earningsDays >= 0 && r.earningsDays <= 5;
                  return (
                    <tr
                      key={r.ticker}
                      data-nav={r.ticker}
                      onClick={() => onTicker(r.ticker)}
                      style={{
                        cursor: "pointer",
                        background: active ? A.bgHover : r.isBreakout ? "rgba(251,191,36,0.04)" : "transparent",
                      }}
                    >
                      <td style={td(A)}><SignalPill r={r} A={A} /></td>
                      <td style={td(A)}>
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <FlagButton t={r.ticker} A={A} />
                          <span style={{ color: A.text, fontWeight: 800, fontFamily: "monospace" }}>{r.ticker}</span>
                          <TierMark t={r.ticker} />
                          <RslDot tip={r.rslTip} A={A} />
                          {showEr && (
                            <span
                              title={r.earningsDisplay ? `Earnings: ${r.earningsDisplay}` : `Earnings ${r.earningsDays === 0 ? "today" : `in ${r.earningsDays} days`}`}
                              style={{
                                marginLeft: 3,
                                fontSize: 9,
                                fontWeight: 700,
                                fontFamily: "monospace",
                                padding: "0px 4px",
                                borderRadius: 3,
                                background: "rgba(245,158,11,0.18)",
                                color: "#f59e0b",
                                border: "1px solid rgba(245,158,11,0.45)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              ER {r.earningsDays}d
                            </span>
                          )}
                        </div>
                        {r.company && (
                          <div style={{ fontSize: 9, color: A.textMuted, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.company}
                          </div>
                        )}
                      </td>
                      <td style={td(A)}>
                        <button
                          onClick={(e) => { e.stopPropagation(); onLayer && onLayer(r.ticker); }}
                          title={`Open ${r.theme} · ${r.layer}${r.layerRank != null ? ` (rank ${r.layerRank})` : ""}${warn ? " — warning: distrib/exiting" : ""}`}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            textAlign: "left",
                            fontFamily: "monospace",
                            fontSize: 10,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            color: A.textDim,
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: lColor, flexShrink: 0 }} />
                          <span style={{ color: A.text, fontWeight: 600 }}>{r.theme}</span>
                          <span style={{ color: A.textMuted }}>·</span>
                          <span>{r.layer}</span>
                          {warn && <span style={{ color: "#f59e0b", fontSize: 9 }}>⚠</span>}
                        </button>
                      </td>
                      <td style={{ ...td(A, "right"), fontFamily: "monospace", color: r.adr != null && r.adr >= 4 ? A.cyan : A.textDim }}>
                        {r.adr != null ? `${r.adr.toFixed(1)}%` : "—"}
                      </td>
                      <td style={{ ...td(A, "right"), color: chgColor, fontWeight: 700, fontFamily: "monospace" }}>
                        <div>{fmtPct(r.chg, 2)}</div>
                        {r.dollarMove != null && r.dollarMove >= 0.9 && (
                          <div style={{ fontSize: 9, fontWeight: 500, color: A.cyan }}>+${r.dollarMove.toFixed(2)}</div>
                        )}
                      </td>
                      <td style={{ ...td(A, "right"), color: openColor, fontFamily: "monospace" }}>
                        {fmtPct(r.fromOpen, 1)}
                      </td>
                      <td style={td(A, "right")}><ZvrMeter zvr={r.zvr} A={A} /></td>
                      <td style={td(A, "right")}><CrMeter cr={r.cr} A={A} /></td>
                      <td style={{ ...td(A, "right"), fontWeight: 700, fontFamily: "monospace", color: r.rs >= 90 ? A.green : r.rs >= 80 ? A.cyan : A.textDim }}>
                        {r.rs}
                      </td>
                      <td title={r.epsTip} style={{ ...td(A, "right"), fontFamily: "monospace", color: r.eps >= 80 ? A.green : r.eps >= 50 ? A.yellow : A.textMuted }}>
                        {r.eps ?? "—"}{r.epsAccel ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}
                      </td>
                      <td style={{ ...td(A, "right"), fontFamily: "monospace", color: r.off52 != null && r.off52 >= -5 ? A.green : A.textDim }}>
                        {fmtPct(r.off52, 1)}
                      </td>
                      <td style={{ ...td(A, "right"), fontWeight: 800, fontFamily: "monospace", color: r.score >= 70 ? "#fbbf24" : r.score >= 55 ? A.green : A.textDim }}>
                        {r.score.toFixed(1)}
                      </td>
                      <td style={td(A, "right")} onClick={(e) => e.stopPropagation()}>
                        <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                          <button
                            type="button"
                            title={inPf ? "Remove from Portfolio" : "Add to Portfolio"}
                            onClick={() => toggleIn(r.ticker, "pf")}
                            style={{
                              background: inPf ? `${pfColor}22` : "transparent",
                              border: `1px solid ${inPf ? pfColor : A.border}`,
                              color: inPf ? pfColor : A.textMuted,
                              borderRadius: 3,
                              padding: "1px 4px",
                              fontSize: 9,
                              fontWeight: inPf ? 700 : 500,
                              fontFamily: "monospace",
                              cursor: setPortfolio ? "pointer" : "default",
                            }}
                          >
                            PF
                          </button>
                          <button
                            type="button"
                            title={inWl ? "Remove from Watchlist" : "Add to Watchlist"}
                            onClick={() => toggleIn(r.ticker, "wl")}
                            style={{
                              background: inWl ? `${wlColor}22` : "transparent",
                              border: `1px solid ${inWl ? wlColor : A.border}`,
                              color: inWl ? wlColor : A.textMuted,
                              borderRadius: 3,
                              padding: "1px 4px",
                              fontSize: 9,
                              fontWeight: inWl ? 700 : 500,
                              fontFamily: "monospace",
                              cursor: setWatchlist ? "pointer" : "default",
                            }}
                          >
                            WL
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Live Intraday Theme Money Flow & Leader Damage Intelligence Strip */}
      {showIntel && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
          {/* Today's Intraday Theme Money Flow */}
          <div style={{ background: A.bgCard, border: `1px solid ${A.border}`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: A.text, letterSpacing: 0.3 }}>
                Intraday Theme Money Flow
              </div>
              <span style={{ fontSize: 9, color: A.textMuted, fontFamily: "monospace" }}>
                ≥4 liquid · click theme to filter
              </span>
            </div>
            {themeFlow.hottest.length === 0 ? (
              <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 0" }}>Waiting for theme breadth…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: A.green, fontFamily: "monospace", letterSpacing: 0.5, marginBottom: 4 }}>
                    HOTTEST INFLOWS
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {themeFlow.hottest.map((t) => {
                      const active = themeId === t.themeId;
                      return (
                        <button
                          key={t.themeId}
                          type="button"
                          onClick={() => setThemeId(active ? null : t.themeId)}
                          title={`${t.theme}: avg ${fmtPct(t.avgChg, 2)} · ${t.pctGreen}% green (${t.count} liquid)${t.topMover ? ` · leader ${t.topMover.ticker} ${fmtPct(t.topMover.chg, 1)}` : ""} — click to filter table`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            width: "100%",
                            textAlign: "left",
                            padding: "4px 7px",
                            borderRadius: 5,
                            cursor: "pointer",
                            background: active ? `${A.green}1c` : A.bgRow,
                            border: `1px solid ${active ? A.green : A.border}`,
                            fontFamily: "monospace",
                            fontSize: 10,
                          }}
                        >
                          <span style={{ color: A.text, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.theme}
                          </span>
                          {t.breakouts > 0 && (
                            <span style={{ fontSize: 9, fontWeight: 800, padding: "0px 4px", borderRadius: 3, color: "#fbbf24", background: "rgba(251,191,36,0.16)", border: "1px solid rgba(251,191,36,0.45)" }}>
                              🔥 {t.breakouts}
                            </span>
                          )}
                          <span style={{ color: A.textMuted, minWidth: 46, textAlign: "right" }}>{t.pctGreen}% grn</span>
                          <span style={{ color: t.avgChg >= 0 ? A.green : A.red, fontWeight: 800, minWidth: 52, textAlign: "right" }}>
                            {fmtPct(t.avgChg, 2)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {themeFlow.coldest.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: A.red, fontFamily: "monospace", letterSpacing: 0.5, marginBottom: 4 }}>
                      COLDEST OUTFLOWS
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {themeFlow.coldest.map((t) => {
                        const active = themeId === t.themeId;
                        return (
                          <button
                            key={t.themeId}
                            type="button"
                            onClick={() => setThemeId(active ? null : t.themeId)}
                            title={`${t.theme}: avg ${fmtPct(t.avgChg, 2)} · ${t.pctGreen}% green (${t.count} liquid) — click to filter table`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              width: "100%",
                              textAlign: "left",
                              padding: "4px 7px",
                              borderRadius: 5,
                              cursor: "pointer",
                              background: active ? `${A.red}1c` : A.bgRow,
                              border: `1px solid ${active ? A.red : A.border}`,
                              fontFamily: "monospace",
                              fontSize: 10,
                            }}
                          >
                            <span style={{ color: A.textDim, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t.theme}
                            </span>
                            {t.breakouts > 0 && (
                              <span style={{ fontSize: 9, fontWeight: 800, padding: "0px 4px", borderRadius: 3, color: "#fbbf24", background: "rgba(251,191,36,0.16)", border: "1px solid rgba(251,191,36,0.45)" }}>
                                🔥 {t.breakouts}
                              </span>
                            )}
                            <span style={{ color: A.textMuted, minWidth: 46, textAlign: "right" }}>{t.pctGreen}% grn</span>
                            <span style={{ color: t.avgChg >= 0 ? A.green : A.red, fontWeight: 800, minWidth: 52, textAlign: "right" }}>
                              {fmtPct(t.avgChg, 2)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Leader Damage Watch ("Generals Getting Hit") */}
          <div style={{ background: A.bgCard, border: `1px solid ${A.border}`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: leaderDamage.damaged.length > 0 ? A.red : A.text, letterSpacing: 0.3 }}>
                Leader Damage Watch
              </div>
              <span style={{ fontSize: 9, color: A.textMuted, fontFamily: "monospace" }}>
                Generals Getting Hit · RS 90+ / Core ≤ -3%
              </span>
            </div>
            {leaderDamage.damaged.length === 0 ? (
              <div style={{ fontSize: 11, color: A.green, fontFamily: "monospace", padding: "8px 0" }}>
                ✓ No RS 90+ or Core Leaders taking heavy volume / weak-close damage.
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {leaderDamage.damaged.map((r) => {
                  const active = chartTicker === r.ticker;
                  return (
                    <button
                      key={r.ticker}
                      type="button"
                      onClick={() => onTicker(r.ticker)}
                      title={`${r.ticker} (${r.theme} · ${r.layer}) · RS ${r.rs} · Chg ${fmtPct(r.chg, 2)}${r.zvr != null ? ` · ZVR ${r.zvr.toFixed(2)}x` : ""}${r.cr != null ? ` · CR ${r.cr}%` : ""}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "4px 8px",
                        borderRadius: 5,
                        cursor: "pointer",
                        background: active ? `${A.red}28` : `${A.red}10`,
                        border: `1px solid ${active ? A.red : `${A.red}55`}`,
                        fontFamily: "monospace",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ color: A.text, fontWeight: 800 }}>{r.ticker}</span>
                      <span style={{ color: A.red, fontWeight: 800 }}>{fmtPct(r.chg, 1)}</span>
                      {r.zvr != null && r.zvr >= 1.5 && (
                        <span style={{ fontSize: 9, color: "#fbbf24", fontWeight: 700 }}>{r.zvr.toFixed(1)}x</span>
                      )}
                      {r.cr != null && r.cr <= 30 && (
                        <span style={{ fontSize: 9, color: A.textMuted }}>CR {r.cr}%</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {leaderDamage.warnLayers.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${A.border}` }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#f59e0b", fontFamily: "monospace", letterSpacing: 0.5, marginBottom: 4 }}>
                  LEADING LAYERS WITH DISTRIB / EXITING FLAGS
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {leaderDamage.warnLayers.map((wl) => {
                    const active = themeId === wl.themeId;
                    return (
                      <button
                        key={wl.key}
                        type="button"
                        onClick={() => setThemeId(active ? null : wl.themeId)}
                        title={`${wl.theme} · ${wl.layer} (rank ${wl.rank}) — ${wl.flags.join(", ")}`}
                        style={{
                          background: active ? "rgba(245,158,11,0.22)" : A.bgRow,
                          border: `1px solid ${active ? "#f59e0b" : A.border}`,
                          color: A.textDim,
                          borderRadius: 4,
                          padding: "2px 6px",
                          fontSize: 9,
                          fontFamily: "monospace",
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ color: A.text, fontWeight: 600 }}>{wl.layer}</span>{" "}
                        <span style={{ color: "#f59e0b" }}>{wl.flags.join("/")}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ZangerPanel;
